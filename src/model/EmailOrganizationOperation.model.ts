import { EntityManager, In, Repository } from "typeorm";
import { BaseDb } from "@/model/Basedb";
import { runReplyTxn } from "@/model/replyTxn";
import { isUniqueConstraintError } from "@/model/dbConstraints";
import { EmailOrganizationOperationEntity } from "@/entity/EmailOrganizationOperation.entity";
import { EmailOrganizationOperationItemEntity } from "@/entity/EmailOrganizationOperationItem.entity";
import { EmailOrganizationAttemptEntity } from "@/entity/EmailOrganizationAttempt.entity";
import {
  emailOrganizationOperationWriteSchema,
  emailOrganizationOperationItemWriteSchema,
  emailOrganizationAttemptWriteSchema,
} from "@/schemas/entity/emailOrganization";
import { parseAndStrip } from "@/utils/parseAndStrip";
import {
  deriveOperationStatus,
  countItemsForDisplay,
} from "@/model/emailOrganizationAggregate";
import type {
  EmailOrganizationItemStatus,
  EmailOrganizationOperationKind,
  EmailOrganizationOperationStatus,
  EmailOrganizationOrigin,
} from "@/entityTypes/emailOrganizationTypes";
import { isTerminalOperationStatus } from "@/entityTypes/emailOrganizationTypes";

/**
 * Data access + transaction orchestration for organization operations
 * (technical design §6.2/§6.3). Claims and finalizations run inside the
 * shared reply write transaction (mutex) so operation state, attempt rows
 * and reply-approval coordination stay coherent. No transaction is held
 * across network I/O: claim() returns before dispatch; finalize() runs
 * after the external result is known.
 */

export interface CreateOperationInput {
  readonly operationId: string;
  readonly kind: EmailOrganizationOperationKind;
  readonly emailServiceId: number;
  readonly origin: EmailOrganizationOrigin;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  readonly conversationId?: number | null;
  readonly sourceUserMessageId?: string | null;
  readonly draftId?: number | null;
  readonly messageIds: readonly number[];
  readonly destinations?: Readonly<Record<number, string | null>>;
  readonly policyVersion?: string | null;
}

export type CreateOperationResult =
  | {
      readonly status: "created";
      readonly operation: EmailOrganizationOperationEntity;
      readonly items: EmailOrganizationOperationItemEntity[];
    }
  /** Duplicate invocation: attach to the existing operation. */
  | {
      readonly status: "existing";
      readonly operation: EmailOrganizationOperationEntity;
    };

export interface ClaimItemInput {
  readonly operationId: string;
  readonly messageId: number;
  readonly claimTokenHash: string;
  readonly leaseExpiresAt: Date;
  readonly location: {
    readonly version: number | null;
    readonly folderPath: string | null;
    readonly uidValidity: string | null;
    readonly providerUid: string | null;
  };
  readonly destinationFolderPath: string | null;
}

export type ClaimItemResult =
  | {
      readonly status: "claimed";
      readonly itemId: number;
      readonly attemptId: number;
      readonly attemptNumber: number;
    }
  | { readonly status: "item_not_pending" }
  | { readonly status: "operation_cancelled" }
  | { readonly status: "operation_terminal"; readonly operationStatus: EmailOrganizationOperationStatus };

export interface FinalizeItemInput {
  readonly itemId: number;
  readonly operationId: string;
  readonly status: Exclude<EmailOrganizationItemStatus, "pending" | "claimed">;
  readonly errorCode?: string | null;
  readonly sanitizedError?: string | null;
  readonly acceptedRecipients?: readonly string[];
  readonly rejectedRecipients?: readonly string[];
  readonly unknownRecipients?: readonly string[];
  readonly providerMessageId?: string | null;
  readonly resultJson?: string | null;
  readonly attemptId?: number | null;
}

export class EmailOrganizationOperationModel extends BaseDb {
  constructor(filepath: string) {
    super(filepath);
  }

  private get operationRepository(): Repository<EmailOrganizationOperationEntity> {
    return this.sqliteDb.connection.getRepository(EmailOrganizationOperationEntity);
  }

  private get itemRepository(): Repository<EmailOrganizationOperationItemEntity> {
    return this.sqliteDb.connection.getRepository(EmailOrganizationOperationItemEntity);
  }

  private get attemptRepository(): Repository<EmailOrganizationAttemptEntity> {
    return this.sqliteDb.connection.getRepository(EmailOrganizationAttemptEntity);
  }

  /**
   * Create an operation with its pending items in one transaction. A unique
   * idempotency key makes duplicate invocations resolve to the existing
   * operation (design §6.3 invariant 7).
   */
  async createOperation(input: CreateOperationInput): Promise<CreateOperationResult> {
    const existing = await this.operationRepository.findOne({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return { status: "existing", operation: existing };
    }

    try {
      const created = await runReplyTxn(this.sqliteDb, async (manager) => {
        const opRepo = manager.getRepository(EmailOrganizationOperationEntity);
        const itemRepo = manager.getRepository(EmailOrganizationOperationItemEntity);

        const stripped = parseAndStrip(
          {
            operationId: input.operationId,
            kind: input.kind,
            emailServiceId: input.emailServiceId,
            origin: input.origin,
            conversationId: input.conversationId ?? null,
            sourceUserMessageId: input.sourceUserMessageId ?? null,
            payloadHash: input.payloadHash,
            idempotencyKey: input.idempotencyKey,
            status: "prepared",
            draftId: input.draftId ?? null,
            pendingCount: input.messageIds.length,
            policyVersion: input.policyVersion ?? null,
            requestedAt: new Date(),
          },
          emailOrganizationOperationWriteSchema()
        ) as unknown as EmailOrganizationOperationEntity;
        const operation = await opRepo.save(opRepo.create(stripped));

        const items: EmailOrganizationOperationItemEntity[] = [];
        for (const messageId of input.messageIds) {
          const itemStripped = parseAndStrip(
            {
              operationId: input.operationId,
              messageId,
              status: "pending",
              beforeFolderPath: null,
              destinationFolderPath: input.destinations?.[messageId] ?? null,
            },
            emailOrganizationOperationItemWriteSchema()
          ) as unknown as EmailOrganizationOperationItemEntity;
          items.push(await itemRepo.save(itemRepo.create(itemStripped)));
        }
        return { operation, items };
      });
      return { status: "created", ...created };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const raced = await this.operationRepository.findOne({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (raced) return { status: "existing", operation: raced };
      }
      throw error;
    }
  }

  async findByIdempotencyKey(
    idempotencyKey: string
  ): Promise<EmailOrganizationOperationEntity | null> {
    return await this.operationRepository.findOne({ where: { idempotencyKey } });
  }

  async read(operationId: string): Promise<EmailOrganizationOperationEntity | null> {
    return await this.operationRepository.findOne({
      where: { operationId },
    });
  }

  async listItems(operationId: string): Promise<EmailOrganizationOperationItemEntity[]> {
    return await this.itemRepository.find({
      where: { operationId },
      order: { id: "ASC" },
    });
  }

  async findItemById(itemId: number): Promise<EmailOrganizationOperationItemEntity | null> {
    return await this.itemRepository.findOne({ where: { id: itemId } });
  }

  /**
   * Transactional claim (design §6.3): conditionally move the item from
   * `pending` to `claimed` and persist the attempt BEFORE any network I/O.
   * Only the winner of the CAS proceeds; a claimed item whose attempt row
   * exists is the durable evidence that dispatch may have happened.
   */
  async claimItem(input: ClaimItemInput): Promise<ClaimItemResult> {
    return await runReplyTxn(this.sqliteDb, async (manager) => {
      const opRepo = manager.getRepository(EmailOrganizationOperationEntity);
      const itemRepo = manager.getRepository(EmailOrganizationOperationItemEntity);
      const attemptRepo = manager.getRepository(EmailOrganizationAttemptEntity);

      const operation = await opRepo.findOne({ where: { operationId: input.operationId } });
      if (!operation) return { status: "item_not_pending" } as ClaimItemResult;
      if (operation.status === "cancelled") {
        return { status: "operation_cancelled" } as ClaimItemResult;
      }
      if (this.isTerminal(operation.status)) {
        return {
          status: "operation_terminal",
          operationStatus: operation.status,
        } as ClaimItemResult;
      }

      const claimUpdate = await itemRepo
        .createQueryBuilder()
        .update(EmailOrganizationOperationItemEntity)
        .set({
          status: "claimed",
          claimedAt: new Date(),
          beforeLocationVersion: input.location.version,
          beforeFolderPath: input.location.folderPath,
          beforeUidValidity: input.location.uidValidity,
          beforeProviderUid: input.location.providerUid,
          destinationFolderPath: input.destinationFolderPath,
        })
        .where(
          "operationId = :operationId AND messageId = :messageId AND status = :pending",
          { operationId: input.operationId, messageId: input.messageId, pending: "pending" }
        )
        .execute();
      if ((claimUpdate.affected ?? 0) !== 1) {
        return { status: "item_not_pending" } as ClaimItemResult;
      }

      const item = await itemRepo.findOne({
        where: { operationId: input.operationId, messageId: input.messageId },
      });
      if (!item) {
        // Cannot happen after a successful CAS; fail closed.
        throw new Error(
          `claimItem: item vanished after claim (operation=${input.operationId}, message=${input.messageId})`
        );
      }

      const attemptNumber = (await attemptRepo.count({ where: { itemId: item.id } })) + 1;
      const attemptStripped = parseAndStrip(
        {
          itemId: item.id,
          operationId: input.operationId,
          attemptNumber,
          claimTokenHash: input.claimTokenHash,
          phase: "claimed",
          leaseExpiresAt: input.leaseExpiresAt,
        },
        emailOrganizationAttemptWriteSchema()
      ) as unknown as EmailOrganizationAttemptEntity;
      const attempt = await attemptRepo.save(attemptRepo.create(attemptStripped));

      if (operation.status !== "running") {
        await opRepo.update(
          { operationId: input.operationId },
          { status: "running", startedAt: operation.startedAt ?? new Date() }
        );
      }
      return {
        status: "claimed",
        itemId: item.id,
        attemptId: attempt.id,
        attemptNumber,
      } as ClaimItemResult;
    });
  }

  /**
   * Persist the external outcome for one item and re-derive the aggregate
   * status/counts in the same transaction (design §10.3: terminal local
   * updates + audit commit together).
   */
  async finalizeItem(input: FinalizeItemInput): Promise<void> {
    await runReplyTxn(this.sqliteDb, async (manager) => {
      const itemRepo = manager.getRepository(EmailOrganizationOperationItemEntity);
      const attemptRepo = manager.getRepository(EmailOrganizationAttemptEntity);

      // Fenced finalization: a definitive outcome may upgrade a pending claim
      // or an unknown; an unknown may only fill a claim. Nothing ever
      // overwrites a definitive result (design §10.3).
      const resolvable: EmailOrganizationItemStatus[] =
        input.status === "outcome_unknown"
          ? ["claimed"]
          // Definitive outcomes may fill a pending item too: pending items
          // have no attempt row, so no dispatch evidence can be lost.
          : ["pending", "claimed", "outcome_unknown"];
      const update = await itemRepo
        .createQueryBuilder()
        .update(EmailOrganizationOperationItemEntity)
        .set({
          status: input.status,
          errorCode: input.errorCode ?? null,
          sanitizedError: input.sanitizedError ?? null,
          acceptedRecipientsJson: input.acceptedRecipients
            ? JSON.stringify(input.acceptedRecipients)
            : undefined,
          rejectedRecipientsJson: input.rejectedRecipients
            ? JSON.stringify(input.rejectedRecipients)
            : undefined,
          unknownRecipientsJson: input.unknownRecipients
            ? JSON.stringify(input.unknownRecipients)
            : undefined,
          // R5-02/R5-03: durable per-item evidence (sent-copy status, move
          // destination mapping) lives on the item row too, so projections
          // and restore lineage read it without joining attempts.
          resultJson: input.resultJson ?? undefined,
          completedAt: new Date(),
        })
        .where("id = :itemId AND status IN (:...resolvable)", {
          itemId: input.itemId,
          resolvable,
        })
        .execute();
      if ((update.affected ?? 0) === 0) return;

      if (input.attemptId != null) {
        const attemptUpdate = await attemptRepo
          .createQueryBuilder()
          .update(EmailOrganizationAttemptEntity)
          .set({
            phase: "resolved",
            resolvedAt: new Date(),
            providerMessageId: input.providerMessageId ?? undefined,
            resultJson: input.resultJson ?? undefined,
          })
          .where("id = :attemptId AND phase != :resolved", {
            attemptId: input.attemptId,
            resolved: "resolved",
          })
          .execute();
        if ((attemptUpdate.affected ?? 0) === 0) {
          // Attempt already resolved (late duplicate); the item update above
          // was fenced too, so nothing to repair.
        }
      }

      await this.recomputeAggregate(manager, input.operationId);
    });
  }

  /**
   * Recorded original folders (beforeFolderPath) of the latest succeeded
   * trash item per message — the durable source for restore-selection
   * destinations. Only verified trash provenance qualifies (design §10.2).
   */
  /**
   * R4-03: restore provenance carries the full after-locator (folder, uid,
   * uidValidity, resulting version, originating operation id) so prepare AND
   * execution can bind the exact current lineage — not just a historical
   * folder string.
   */
  async findSucceededTrashDestinations(
    messageIds: readonly number[]
  ): Promise<
    Record<
      number,
      {
        /** The ORIGINAL folder (the restore destination). */
        folder: string;
        /** R5-03: the Trash-side folder the operation moved the message INTO. */
        trashFolder: string | null;
        destinationUid: string | null;
        destinationUidValidity: string | null;
        resultingVersion: number;
        originOperationId: string;
      }
    >
  > {
    if (messageIds.length === 0) return {};
    const rows = await this.itemRepository
      .createQueryBuilder("item")
      .innerJoin(EmailOrganizationOperationEntity, "op", "op.operationId = item.operationId")
      .where("item.messageId IN (:...messageIds)", { messageIds: [...messageIds] })
      .andWhere("op.kind = :kind", { kind: "trash" })
      // R06 consistency: no-ops carry no original provenance (their
      // before-folder is Trash itself) — only genuine moves restore.
      .andWhere("item.status = :status", { status: "succeeded" })
      .andWhere("item.beforeFolderPath IS NOT NULL")
      .orderBy("item.id", "DESC")
      .getMany();
    const destinations: Record<
      number,
      {
        folder: string;
        trashFolder: string | null;
        destinationUid: string | null;
        destinationUidValidity: string | null;
        resultingVersion: number;
        originOperationId: string;
      }
    > = {};
    for (const item of rows) {
      if (destinations[item.messageId] !== undefined || item.beforeFolderPath === null) {
        continue;
      }
      let destinationUid: string | null = null;
      let destinationUidValidity: string | null = null;
      const attempts = await this.attemptRepository
        .find({ where: { itemId: item.id }, order: { attemptNumber: "DESC" } });
      for (const attempt of attempts) {
        if (attempt.resultJson === null) continue;
        try {
          const evidence = JSON.parse(attempt.resultJson) as {
            destinationUid?: string | null;
            destinationUidValidity?: string | null;
          };
          if (destinationUid === null && typeof evidence.destinationUid === "string") {
            destinationUid = evidence.destinationUid;
          }
          if (
            destinationUidValidity === null &&
            typeof evidence.destinationUidValidity === "string"
          ) {
            destinationUidValidity = evidence.destinationUidValidity;
          }
        } catch {
          // malformed evidence → uid stays null
        }
      }
      destinations[item.messageId] = {
        folder: item.beforeFolderPath,
        trashFolder: item.destinationFolderPath,
        destinationUid,
        destinationUidValidity,
        resultingVersion: (item.beforeLocationVersion ?? 0) + 1,
        originOperationId: item.operationId,
      };
    }
    return destinations;
  }

  /** Persist provider result evidence on a non-resolved attempt. */
  async recordAttemptEvidence(attemptId: number, resultJson: string): Promise<void> {
    await this.attemptRepository
      .createQueryBuilder()
      .update(EmailOrganizationAttemptEntity)
      .set({ resultJson })
      .where("id = :attemptId AND phase IN (:...phases)", {
        attemptId,
        phases: ["claimed", "dispatched"],
      })
      .execute();
  }

  /** Mark an attempt as dispatched (before/while network I/O is in flight). */
  async markAttemptDispatched(attemptId: number): Promise<void> {
    await this.attemptRepository
      .createQueryBuilder()
      .update(EmailOrganizationAttemptEntity)
      .set({ phase: "dispatched", dispatchedAt: new Date() })
      .where("id = :attemptId AND phase = :claimed", {
        attemptId,
        claimed: "claimed",
      })
      .execute();
  }

  /**
   * Atomic cancellation request: stamps `cancelRequestedAt` and cancels all
   * still-pending items. Claimed items keep reporting/reconciling (design §11).
   */
  async cancelPending(operationId: string): Promise<boolean> {
    return await runReplyTxn(this.sqliteDb, async (manager) => {
      const opRepo = manager.getRepository(EmailOrganizationOperationEntity);
      const itemRepo = manager.getRepository(EmailOrganizationOperationItemEntity);

      const operation = await opRepo.findOne({ where: { operationId } });
      if (!operation) return false;
      if (this.isTerminal(operation.status)) return false;

      await opRepo
        .createQueryBuilder()
        .update(EmailOrganizationOperationEntity)
        .set({ cancelRequestedAt: operation.cancelRequestedAt ?? new Date() })
        .where("operationId = :operationId", { operationId })
        .execute();

      await itemRepo
        .createQueryBuilder()
        .update(EmailOrganizationOperationItemEntity)
        .set({ status: "cancelled", completedAt: new Date() })
        .where("operationId = :operationId AND status = :pending", {
          operationId,
          pending: "pending",
        })
        .execute();

      await this.recomputeAggregate(manager, operationId);
      return true;
    });
  }

  /** Recompute counts + aggregate status from current item rows. */
  async refreshAggregate(operationId: string): Promise<void> {
    await runReplyTxn(this.sqliteDb, async (manager) => {
      await this.recomputeAggregate(manager, operationId);
    });
  }

  async findNonTerminalOperations(): Promise<EmailOrganizationOperationEntity[]> {
    return await this.operationRepository
      .createQueryBuilder("op")
      .where("op.status IN (:...statuses)", {
        statuses: ["prepared", "awaiting_approval", "authorized", "running", "needs_reconciliation"],
      })
      .getMany();
  }

  /**
   * PRD §11: local aggregate diagnostic counts (no remote telemetry).
   * Derived from the durable operations table; exported only through the
   * existing explicit support workflow.
   */
  async aggregateDiagnostics(): Promise<
    Array<{ kind: string; status: string; count: number }>
  > {
    return await this.operationRepository
      .createQueryBuilder("op")
      .select("op.kind", "kind")
      .addSelect("op.status", "status")
      .addSelect("COUNT(*)", "count")
      .groupBy("op.kind")
      .addGroupBy("op.status")
      .getRawMany<{ kind: string; status: string; count: string }>()
      .then((rows) =>
        rows.map((row) => ({
          kind: row.kind,
          status: row.status,
          count: Number(row.count),
        }))
      );
  }

  /**
   * R4-05: detects that an observed (account, folder, uidValidity, uid)
   * position was MOVED AWAY by a succeeded operation — the exact durable
   * occurrence lineage for stale-source suppression, replacing the
   * Message-ID heuristic.
   */
  async findMovedAwayOccurrence(input: {
    readonly emailServiceId: number;
    readonly folderPath: string;
    readonly uidValidity: string;
    readonly providerUid: string;
  }): Promise<{ messageId: number; operationId: string } | null> {
    const rows = await this.itemRepository
      .createQueryBuilder("item")
      .innerJoin(EmailOrganizationOperationEntity, "op", "op.operationId = item.operationId")
      .where("op.emailServiceId = :emailServiceId", {
        emailServiceId: input.emailServiceId,
      })
      .andWhere("item.beforeFolderPath = :folderPath", { folderPath: input.folderPath })
      .andWhere("item.beforeUidValidity = :uidValidity", { uidValidity: input.uidValidity })
      .andWhere("item.beforeProviderUid = :providerUid", { providerUid: input.providerUid })
      .andWhere("op.kind IN (:...kinds)", { kinds: ["trash", "restore"] })
      .andWhere("item.status IN (:...statuses)", { statuses: ["succeeded", "noop"] })
      .orderBy("item.id", "DESC")
      .take(1)
      .getMany();
    const item = rows[0];
    if (item === undefined) return null;
    return { messageId: item.messageId, operationId: item.operationId };
  }

  /**
   * R4-04: the open (nonterminal) operation covering a message, if any.
   * Duplicate callers resolve to this durable outcome instead of creating a
   * competing operation whose claim refusal would destroy unknown state.
   */
  async findOpenOperationForMessage(
    messageId: number
  ): Promise<EmailOrganizationOperationEntity | null> {
    const rows = await this.operationRepository
      .createQueryBuilder("op")
      .innerJoin(EmailOrganizationOperationItemEntity, "item", "item.operationId = op.operationId")
      .where("item.messageId = :messageId", { messageId })
      .andWhere("op.status IN (:...statuses)", {
        statuses: ["prepared", "awaiting_approval", "authorized", "running", "needs_reconciliation"],
      })
      .orderBy("op.requestedAt", "DESC")
      .take(1)
      .getMany();
    return rows[0] ?? null;
  }

  /**
   * R6-03 (design §10.4): TRUE while a nonterminal operation carries an
   * `outcome_unknown` item whose failure code is REPLY_INVALIDATION_PENDING
   * for this message. The reply gate uses this as the fail-closed fallback
   * when the durable obligation ROW could not be inserted: the item marker
   * is written even when the guard row is missing, so a move whose reply
   * invalidation never landed keeps reply sending refused until a repair
   * resolves it.
   */
  async hasUnresolvedInvalidationPendingItem(messageId: number): Promise<boolean> {
    const count = await this.itemRepository
      .createQueryBuilder("item")
      .innerJoin(EmailOrganizationOperationEntity, "op", "op.operationId = item.operationId")
      .where("item.messageId = :messageId", { messageId })
      .andWhere("item.errorCode = :code", { code: "REPLY_INVALIDATION_PENDING" })
      .andWhere("item.status = :status", { status: "outcome_unknown" })
      .andWhere("op.status IN (:...statuses)", {
        statuses: ["prepared", "awaiting_approval", "authorized", "running", "needs_reconciliation"],
      })
      .getCount();
    return count > 0;
  }

  /**
   * R12: persistent operation history for discovery after navigation or
   * restart. Newest first, optionally filtered by account or message.
   */
  async listRecentOperations(input: {
    readonly emailServiceId?: number | null;
    readonly messageId?: number | null;
    readonly limit?: number;
  }): Promise<EmailOrganizationOperationEntity[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    const qb = this.operationRepository
      .createQueryBuilder("op")
      .orderBy("op.requestedAt", "DESC")
      .take(limit);
    if (input.emailServiceId != null) {
      qb.andWhere("op.emailServiceId = :emailServiceId", {
        emailServiceId: input.emailServiceId,
      });
    }
    if (input.messageId != null) {
      qb.andWhere(
        "EXISTS (SELECT 1 FROM email_organization_operation_item it WHERE it.operationId = op.operationId AND it.messageId = :messageId)",
        { messageId: input.messageId }
      );
    }
    return await qb.getMany();
  }

  /** Attempts whose lease expired while not yet resolved (recovery input). */
  async findExpiredClaims(now: Date): Promise<
    Array<{ attempt: EmailOrganizationAttemptEntity; item: EmailOrganizationOperationItemEntity }>
  > {
    const attempts = await this.attemptRepository
      .createQueryBuilder("att")
      .where("att.phase IN (:...phases)", { phases: ["claimed", "dispatched"] })
      .andWhere("att.leaseExpiresAt < :now", { now })
      .getMany();
    if (attempts.length === 0) return [];
    const itemIds = attempts.map((attempt) => attempt.itemId);
    const items = await this.itemRepository.find({ where: { id: In(itemIds) } });
    const byId = new Map(items.map((item) => [item.id, item]));
    return attempts
      .map((attempt) => {
        const item = byId.get(attempt.itemId);
        return item ? { attempt, item } : null;
      })
      .filter((pair): pair is { attempt: EmailOrganizationAttemptEntity; item: EmailOrganizationOperationItemEntity } => pair !== null);
  }

  async listAttemptsForItem(itemId: number): Promise<EmailOrganizationAttemptEntity[]> {
    return await this.attemptRepository.find({
      where: { itemId },
      order: { attemptNumber: "ASC" },
    });
  }

  /** Aggregate derivation against the operation's live items. */
  private async recomputeAggregate(
    manager: EntityManager,
    operationId: string
  ): Promise<void> {
    const opRepo = manager.getRepository(EmailOrganizationOperationEntity);
    const itemRepo = manager.getRepository(EmailOrganizationOperationItemEntity);
    const operation = await opRepo.findOne({ where: { operationId } });
    if (!operation) return;
    const items = await itemRepo.find({ where: { operationId } });

    const itemStatuses = items.map((item) => item.status);
    const nextStatus = deriveOperationStatus(itemStatuses, operation.cancelRequestedAt !== null);
    const display = countItemsForDisplay(itemStatuses);

    // Surface a representative item error code on the aggregate for failed
    // or unresolved operations (UI reason-code mapping, design §13).
    let aggregateErrorCode: string | null = null;
    if (nextStatus === "failed" || nextStatus === "needs_reconciliation") {
      const firstProblem = items.find(
        (item) => item.errorCode !== null && (item.status === "failed" || item.status === "outcome_unknown")
      );
      aggregateErrorCode = firstProblem?.errorCode ?? (nextStatus === "needs_reconciliation" ? "OUTCOME_UNKNOWN" : null);
    }

    await opRepo
      .createQueryBuilder()
      .update(EmailOrganizationOperationEntity)
      .set({
        status: nextStatus,
        errorCode: aggregateErrorCode,
        completedCount: display.completed,
        failedCount: display.failed,
        unknownCount: display.unresolved,
        pendingCount: display.pending,
        cancelledCount: display.cancelled,
        // R5-04: explicit heartbeat — SQLite does not honor ON UPDATE for
        // this column, and the orphan sweeper relies on freshness.
        updatedAt: new Date(),
        completedAt:
          nextStatus !== "running" && nextStatus !== "prepared" && nextStatus !== "awaiting_approval" && nextStatus !== "authorized"
            ? operation.completedAt ?? new Date()
            : null,
      })
      .where("operationId = :operationId", { operationId })
      .execute();
  }

  private isTerminal(status: EmailOrganizationOperationStatus): boolean {
    return isTerminalOperationStatus(status);
  }

  private isUniqueViolation(error: unknown): boolean {
    return isUniqueConstraintError(error);
  }
}
