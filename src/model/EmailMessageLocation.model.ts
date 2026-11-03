import { Repository } from "typeorm";
import { BaseDb } from "@/model/Basedb";
import { isUniqueConstraintError } from "@/model/dbConstraints";
import { EmailMessageLocationEntity } from "@/entity/EmailMessageLocation.entity";
import { emailMessageLocationWriteSchema } from "@/schemas/entity/emailMessageLocation";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { log } from "@/modules/Logger";

/**
 * Data access for folder-aware message locations (technical design §5.2).
 *
 * Concurrency: methods avoid process-level mutexes; correctness comes from
 * the unique indexes plus conditional (version-guarded) updates inside
 * transactions. A lost insert race is retried once as an update.
 */

export interface UpsertLocationInput {
  readonly messageId: number;
  readonly emailServiceId: number;
  readonly protocol: "imap" | "pop3";
  readonly folderPath: string | null;
  readonly uidValidity: string | null;
  readonly providerUid: string;
  readonly state: "verified" | "legacy_unverified" | "stale";
  readonly lastOperationId?: string | null;
}

export type UpsertLocationResult =
  | { readonly status: "ok"; readonly entity: EmailMessageLocationEntity }
  /** The identity tuple is occupied by a different message occurrence. */
  | { readonly status: "conflict" };

export interface ApplyMoveInput {
  readonly messageId: number;
  readonly expectedVersion: number;
  readonly folderPath: string | null;
  readonly uidValidity: string | null;
  readonly providerUid: string;
  readonly state: "verified" | "stale";
  readonly lastOperationId: string;
}

export interface LegacyBackfillEntry {
  readonly messageId: number;
  readonly emailServiceId: number;
  readonly protocol: "imap" | "pop3";
  readonly folderPath: string | null;
  readonly uidValidity: string | null;
  readonly providerUid: string;
}

export class EmailMessageLocationModel extends BaseDb {
  constructor(filepath: string) {
    super(filepath);
  }

  private get repository(): Repository<EmailMessageLocationEntity> {
    return this.sqliteDb.connection.getRepository(EmailMessageLocationEntity);
  }

  /**
   * Upsert the (single active) location for a message. When identity fields
   * change, the version increments so stale selections are rejected.
   */
  async upsertLocation(input: UpsertLocationInput): Promise<UpsertLocationResult> {
    const stripped = parseAndStrip(
      {
        messageId: input.messageId,
        emailServiceId: input.emailServiceId,
        protocol: input.protocol,
        folderPath: input.folderPath,
        uidValidity: input.uidValidity,
        providerUid: input.providerUid,
        state: input.state,
        lastVerifiedAt: input.state === "verified" ? new Date() : null,
        lastOperationId: input.lastOperationId ?? null,
      },
      emailMessageLocationWriteSchema()
    ) as unknown as EmailMessageLocationEntity;

    return await this.sqliteDb.connection.transaction(async (manager) => {
      const repo = manager.getRepository(EmailMessageLocationEntity);
      const existing = await repo.findOne({ where: { messageId: input.messageId } });

      if (existing) {
        existing.protocol = input.protocol;
        const identityChanged =
          existing.folderPath !== input.folderPath ||
          existing.uidValidity !== input.uidValidity ||
          existing.providerUid !== input.providerUid;
        existing.folderPath = input.folderPath;
        existing.uidValidity = input.uidValidity;
        existing.providerUid = input.providerUid;
        existing.state = input.state;
        existing.lastVerifiedAt = input.state === "verified" ? new Date() : null;
        if (input.lastOperationId !== undefined) {
          existing.lastOperationId = input.lastOperationId ?? null;
        }
        if (identityChanged) {
          existing.version = existing.version + 1;
        }
        await repo.save(existing);
        return { status: "ok", entity: existing } as UpsertLocationResult;
      }

      try {
        const created = repo.create(stripped);
        await repo.save(created);
        return { status: "ok", entity: created } as UpsertLocationResult;
      } catch (error) {
        // Concurrent insert for the same message (unique messageId) or the
        // tuple index occupied by another occurrence. Distinguish honestly.
        if (this.isUniqueViolation(error)) {
          const tupleCriteria: Record<string, unknown> = {
            emailServiceId: input.emailServiceId,
            providerUid: input.providerUid,
          };
          // NULL identity fields never match SQL equality; the tuple index
          // treats NULLs as distinct, so an exact lookup only applies when
          // both are non-null.
          if (input.folderPath !== null && input.uidValidity !== null) {
            tupleCriteria["folderPath"] = input.folderPath;
            tupleCriteria["uidValidity"] = input.uidValidity;
          }
          const tupleOwner = await repo.findOne({
            where: tupleCriteria,
          });
          if (tupleOwner && tupleOwner.messageId !== input.messageId) {
            log.warn(
              `[EmailMessageLocation] tuple conflict: account=${input.emailServiceId} ` +
                `folder=${String(input.folderPath)} uid=${input.providerUid} belongs to ` +
                `message ${tupleOwner.messageId}, requested for ${input.messageId}`
            );
            return { status: "conflict" } as UpsertLocationResult;
          }
          // Same messageId raced: retry as an update.
          const raced = await repo.findOne({ where: { messageId: input.messageId } });
          if (raced) {
            raced.protocol = input.protocol;
            raced.folderPath = input.folderPath;
            raced.uidValidity = input.uidValidity;
            raced.providerUid = input.providerUid;
            raced.state = input.state;
            raced.lastVerifiedAt = input.state === "verified" ? new Date() : null;
            raced.version = raced.version + 1;
            await repo.save(raced);
            return { status: "ok", entity: raced } as UpsertLocationResult;
          }
        }
        throw error;
      }
    });
  }

  async readByMessageId(messageId: number): Promise<EmailMessageLocationEntity | null> {
    return await this.repository.findOne({ where: { messageId } });
  }

  /**
   * Optimistic-concurrency location update after a verified move. Returns
   * false when the expected version no longer matches (another mutation won).
   */
  async applyMove(input: ApplyMoveInput): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(EmailMessageLocationEntity)
      .set({
        folderPath: input.folderPath,
        uidValidity: input.uidValidity,
        providerUid: input.providerUid,
        state: input.state,
        version: () => "version + 1",
        lastVerifiedAt: input.state === "verified" ? new Date() : null,
        lastOperationId: input.lastOperationId,
      })
      .where("messageId = :messageId AND version = :expectedVersion", {
        messageId: input.messageId,
        expectedVersion: input.expectedVersion,
      })
      .execute();
    return (result.affected ?? 0) === 1;
  }

  /** Mark a location stale (UID validity changed, external move detected). */
  async markStale(messageId: number): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(EmailMessageLocationEntity)
      .set({ state: "stale", version: () => "version + 1" })
      .where("messageId = :messageId AND state != :stale", {
        messageId,
        stale: "stale",
      })
      .execute();
    return (result.affected ?? 0) === 1;
  }

  /**
   * Idempotent startup backfill: insert `legacy_unverified` rows for messages
   * that have no location row yet (technical design §5.3 step 4). Rows are
   * never eligible for remote mutation until re-verified.
   */
  async backfillLegacyLocations(entries: readonly LegacyBackfillEntry[]): Promise<number> {
    if (entries.length === 0) return 0;
    let inserted = 0;
    await this.sqliteDb.connection.transaction(async (manager) => {
      const repo = manager.getRepository(EmailMessageLocationEntity);
      const messageIds = entries.map((entry) => entry.messageId);
      const existing = await repo
        .createQueryBuilder("loc")
        .where("loc.messageId IN (:...ids)", { ids: messageIds })
        .getMany();
      const existingByMessageId = new Set(existing.map((row) => row.messageId));
      for (const entry of entries) {
        if (existingByMessageId.has(entry.messageId)) continue;
        try {
          const stripped = parseAndStrip(
            {
              messageId: entry.messageId,
              emailServiceId: entry.emailServiceId,
              protocol: entry.protocol,
              folderPath: entry.folderPath === "" ? null : entry.folderPath,
              uidValidity: entry.uidValidity,
              providerUid: entry.providerUid,
              state: "legacy_unverified",
              lastVerifiedAt: null,
              lastOperationId: null,
            },
            emailMessageLocationWriteSchema()
          ) as unknown as EmailMessageLocationEntity;
          await repo.save(repo.create(stripped));
          inserted += 1;
        } catch (error) {
          // Skip-and-log: a unique violation means the message gained a row
          // concurrently; any other per-row error (malformed legacy data)
          // must not stall the whole migration batch.
          if (!isUniqueConstraintError(error)) {
            log.warn(
              `[EmailMessageLocation] backfill skipped message ${entry.messageId}:`,
              error instanceof Error ? error.message : String(error)
            );
          }
        }
      }
    });
    return inserted;
  }

  /** Message IDs among the given set that have no location row. */
  async findMessageIdsWithoutLocation(
    messageIds: readonly number[]
  ): Promise<number[]> {
    if (messageIds.length === 0) return [];
    const rows = await this.repository
      .createQueryBuilder("loc")
      .select("loc.messageId", "messageId")
      .where("loc.messageId IN (:...ids)", { ids: [...messageIds] })
      .getRawMany<{ messageId: number }>();
    const withLocation = new Set(rows.map((row) => Number(row.messageId)));
    return messageIds.filter((id) => !withLocation.has(id));
  }

  private isUniqueViolation(error: unknown): boolean {
    return isUniqueConstraintError(error);
  }
}
