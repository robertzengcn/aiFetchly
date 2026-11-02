import { Repository, IsNull, LessThan } from "typeorm";
import { BaseDb } from "@/model/Basedb";
import { EmailOrganizationAuthorizationEntity } from "@/entity/EmailOrganizationAuthorization.entity";
import { emailOrganizationAuthorizationWriteSchema } from "@/schemas/entity/emailOrganization";
import { parseAndStrip } from "@/utils/parseAndStrip";

/**
 * Data access for request-scoped action authorizations (technical design
 * §6.2/§8.1). An authorization is issued against a frozen payload hash,
 * consumed exactly once, and expires on a fixed TTL. Only persisted state
 * proves spendability — nothing in-memory.
 */

export interface IssueAuthorizationInput {
  readonly operationId?: string | null;
  readonly draftId?: number | null;
  readonly revisionId?: number | null;
  readonly payloadHash: string;
  readonly origin: EmailOrganizationAuthorizationEntity["origin"];
  readonly userTurnId?: string | null;
  readonly expiresAt: Date;
}

export class EmailOrganizationAuthorizationModel extends BaseDb {
  constructor(filepath: string) {
    super(filepath);
  }

  private get repository(): Repository<EmailOrganizationAuthorizationEntity> {
    return this.sqliteDb.connection.getRepository(EmailOrganizationAuthorizationEntity);
  }

  async issue(input: IssueAuthorizationInput): Promise<EmailOrganizationAuthorizationEntity> {
    const stripped = parseAndStrip(
      {
        operationId: input.operationId ?? null,
        draftId: input.draftId ?? null,
        revisionId: input.revisionId ?? null,
        payloadHash: input.payloadHash,
        origin: input.origin,
        userTurnId: input.userTurnId ?? null,
        expiresAt: input.expiresAt,
      },
      emailOrganizationAuthorizationWriteSchema()
    ) as unknown as EmailOrganizationAuthorizationEntity;
    return await this.repository.save(this.repository.create(stripped));
  }

  /** Loads the row without spendability checks (existence evidence only). */
  async read(id: number): Promise<EmailOrganizationAuthorizationEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * True when the row exists, is not consumed, not revoked, and not expired.
   */
  isSpendable(
    authorization: EmailOrganizationAuthorizationEntity,
    now: Date
  ): boolean {
    return (
      authorization.consumedAt === null &&
      authorization.revokedAt === null &&
      authorization.expiresAt.getTime() > now.getTime()
    );
  }

  /**
   * Consume exactly once. Returns false when another caller consumed or
   * revoked it first, or when it expired.
   */
  async consume(id: number, now: Date): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(EmailOrganizationAuthorizationEntity)
      .set({ consumedAt: now })
      .where(
        "id = :id AND consumedAt IS NULL AND revokedAt IS NULL AND expiresAt > :now",
        { id, now }
      )
      .execute();
    return (result.affected ?? 0) === 1;
  }

  async revoke(id: number, reason: string, now: Date): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(EmailOrganizationAuthorizationEntity)
      .set({ revokedAt: now, invalidReason: reason })
      .where("id = :id AND revokedAt IS NULL AND consumedAt IS NULL", { id })
      .execute();
    return (result.affected ?? 0) === 1;
  }

  /** Revoke every unconsumed authorization bound to a draft (edit invalidation). */
  async revokeAllForDraft(draftId: number, reason: string, now: Date): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .update(EmailOrganizationAuthorizationEntity)
      .set({ revokedAt: now, invalidReason: reason })
      .where(
        "draftId = :draftId AND revokedAt IS NULL AND consumedAt IS NULL",
        { draftId }
      )
      .execute();
    return result.affected ?? 0;
  }

  async findActiveForRevision(
    draftId: number,
    revisionId: number
  ): Promise<EmailOrganizationAuthorizationEntity[]> {
    return await this.repository.find({
      where: {
        draftId,
        revisionId,
        consumedAt: IsNull(),
        revokedAt: IsNull(),
      },
    });
  }

  /** Expired, never-consumed authorizations (retention cleanup input). */
  async findExpired(now: Date): Promise<EmailOrganizationAuthorizationEntity[]> {
    return await this.repository.find({
      where: { expiresAt: LessThan(now), consumedAt: IsNull() },
    });
  }
}
