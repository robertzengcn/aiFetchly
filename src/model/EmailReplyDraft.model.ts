import { BaseDb } from "@/model/Basedb";
import { Repository, IsNull, EntityManager, In } from "typeorm";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplyDraftRevisionEntity } from "@/entity/EmailReplyDraftRevision.entity";
import { EmailReplyApprovalEntity } from "@/entity/EmailReplyApproval.entity";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import { SortBy } from "@/entityTypes/commonType";
import { EmailReplyDraftStatus } from "@/entityTypes/emailReceiveTypes";
import type { EmailReplySendAttemptStatus } from "@/entityTypes/emailReplyReliabilityTypes";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { emailReplyDraftWriteSchema } from "@/schemas/entity/emailReplyDraft";
import { emailReplyDraftRevisionWriteSchema } from "@/schemas/entity/emailReplyDraftRevision";
import { rejectDatabaseAccessFromWorker } from "@/model/_workerBoundaryGuard";
import { AsyncMutex } from "@/utils/asyncMutex";

/**
 * Process-wide serializer for reply-reliability write transactions. See
 * {@link AsyncMutex} for why overlapping TypeORM/better-sqlite3 transactions
 * must not run concurrently on the shared connection.
 */
const replyWriteMutex = new AsyncMutex();

/** Run a transaction body under the shared reliability write mutex. */
function runReplyTxn<T>(
  sqliteDb: {
    connection: {
      transaction: <R>(fn: (m: EntityManager) => Promise<R>) => Promise<R>;
    };
  },
  fn: (manager: EntityManager) => Promise<T>
): Promise<T> {
  return replyWriteMutex.run(() => sqliteDb.connection.transaction(fn));
}

export interface ReplyDraftListInput {
  emailServiceId?: number;
  messageId?: number;
  page: number;
  size: number;
  where?: string;
  sortby?: SortBy;
}

export class EmailReplyDraftModel extends BaseDb {
  private repository: Repository<EmailReplyDraftEntity>;

  constructor(filepath: string) {
    super(filepath);
    rejectDatabaseAccessFromWorker("EmailReplyDraftModel");
    this.repository = this.sqliteDb.connection.getRepository(
      EmailReplyDraftEntity
    );
  }

  async create(entity: EmailReplyDraftEntity): Promise<EmailReplyDraftEntity> {
    const stripped = parseAndStrip(
      entity,
      emailReplyDraftWriteSchema()
    ) as unknown as EmailReplyDraftEntity;
    const created = this.repository.create(stripped);
    return await this.repository.save(created);
  }

  async read(id: number): Promise<EmailReplyDraftEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  async updateStatus(
    id: number,
    status: EmailReplyDraftStatus,
    error: string | null = null
  ): Promise<void> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return;
    entity.status = status;
    entity.sendError = error;
    await this.repository.save(entity);
  }

  async updateBody(
    id: number,
    bodyText: string,
    bodyHtml: string | null
  ): Promise<void> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return;
    entity.bodyText = bodyText;
    entity.bodyHtml = bodyHtml;
    await this.repository.save(entity);
  }

  async markSent(id: number, sentAt: Date): Promise<void> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return;
    entity.status = "sent";
    entity.sentAt = sentAt;
    entity.sendError = null;
    await this.repository.save(entity);
  }

  async listByMessage(messageId: number): Promise<EmailReplyDraftEntity[]> {
    return await this.repository.find({
      where: { messageId },
      order: { id: "DESC" },
    });
  }

  async list(input: ReplyDraftListInput): Promise<EmailReplyDraftEntity[]> {
    let qb = this.repository.createQueryBuilder("draft");
    if (input.emailServiceId) {
      qb = qb.where("draft.emailServiceId = :emailServiceId", {
        emailServiceId: input.emailServiceId,
      });
    }
    if (input.messageId) {
      qb = qb.andWhere("draft.messageId = :messageId", {
        messageId: input.messageId,
      });
    }
    if (input.where) {
      qb = qb.andWhere("(draft.subject LIKE :search)", {
        search: `%${input.where}%`,
      });
    }
    qb = qb.orderBy("draft.id", "DESC").skip(input.page).take(input.size);
    return await qb.getMany();
  }

  async count(input: ReplyDraftListInput): Promise<number> {
    let qb = this.repository.createQueryBuilder("draft");
    if (input.emailServiceId) {
      qb = qb.where("draft.emailServiceId = :emailServiceId", {
        emailServiceId: input.emailServiceId,
      });
    }
    if (input.messageId) {
      qb = qb.andWhere("draft.messageId = :messageId", {
        messageId: input.messageId,
      });
    }
    if (input.where) {
      qb = qb.andWhere("(draft.subject LIKE :search)", {
        search: `%${input.where}%`,
      });
    }
    return await qb.getCount();
  }

  // ---- Reliability extension (Milestone 1) ----

  /** Read the draft aggregate row. */
  async readAggregate(id: number): Promise<EmailReplyDraftEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * Persist the canonical content hash onto a revision and its draft
   * projection in one transaction. The hash binds approval to exact content +
   * envelope and includes the revision id assigned at insert, so it can only be
   * computed AFTER {@link appendRevision} has run. The generation/approval
   * services therefore append with a placeholder hash, read back the assigned
   * revision id, recompute, and call this to persist the real value.
   */
  async applyContentHash(
    draftId: number,
    revisionId: number,
    contentHash: string
  ): Promise<void> {
    await runReplyTxn(this.sqliteDb, async (manager) => {
      const draftRepo = manager.getRepository(EmailReplyDraftEntity);
      const revisionRepo = manager.getRepository(EmailReplyDraftRevisionEntity);
      await revisionRepo.update({ id: revisionId }, { contentHash });
      await draftRepo.update({ id: draftId }, { contentHash });
    });
  }

  /**
   * Atomically transition `draft -> approved` for a specific revision + hash.
   * Only succeeds if the draft is currently `draft` and the current revision's
   * hash matches {@link approvedHash}. Returns false if a concurrent edit moved
   * the draft away (FR-015, FR-016).
   */
  async markApproved(
    draftId: number,
    revisionId: number,
    approvedHash: string,
    policyVersion: string,
    at: Date
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(EmailReplyDraftEntity)
      .set({ status: "approved", policyVersion })
      .where(
        "id = :draftId AND status = :status AND currentRevisionId = :revisionId AND contentHash = :hash",
        {
          draftId,
          status: "draft" as EmailReplyDraftStatus,
          revisionId,
          hash: approvedHash,
        }
      )
      .execute();
    return (result.affected ?? 0) === 1;
  }

  /**
   * Append an immutable revision and update the draft projection in ONE
   * transaction. Any active approval is invalidated and the draft returns to
   * `draft` (FR-014: editing an approved draft invalidates approval).
   *
   * Revision number is derived as max(existing)+1 (1 for the first revision).
   */
  async appendRevision(input: AppendRevisionInput): Promise<{
    revision: EmailReplyDraftRevisionEntity;
    invalidatedApprovals: number;
  }> {
    return await runReplyTxn(this.sqliteDb, async (manager) => {
      const draftRepo = manager.getRepository(EmailReplyDraftEntity);
      const revisionRepo = manager.getRepository(EmailReplyDraftRevisionEntity);
      const approvalRepo = manager.getRepository(EmailReplyApprovalEntity);

      const draft = await draftRepo.findOne({ where: { id: input.draftId } });
      if (!draft) {
        throw new Error(`Draft ${input.draftId} not found for revision append`);
      }

      const latest = await revisionRepo.findOne({
        where: { draftId: input.draftId },
        order: { revisionNumber: "DESC" },
      });
      const nextNumber = (latest?.revisionNumber ?? 0) + 1;

      const revisionEntity = new EmailReplyDraftRevisionEntity();
      revisionEntity.draftId = input.draftId;
      revisionEntity.revisionNumber = nextNumber;
      revisionEntity.actor = input.actor;
      revisionEntity.subject = input.subject;
      revisionEntity.bodyText = input.bodyText;
      revisionEntity.bodyHtml = input.bodyHtml;
      revisionEntity.senderAddress = input.senderAddress;
      revisionEntity.recipientAddress = input.recipientAddress;
      revisionEntity.contentHash = input.contentHash;
      revisionEntity.generationMetadataJson =
        input.generationMetadataJson ?? null;
      revisionEntity.validationFindingsJson =
        input.validationFindingsJson ?? null;
      const stripped = parseAndStrip(
        revisionEntity,
        emailReplyDraftRevisionWriteSchema()
      ) as unknown as EmailReplyDraftRevisionEntity;
      const savedRevision = await revisionRepo.save(
        revisionRepo.create(stripped)
      );

      // Invalidate every active approval for this draft.
      const now = input.at ?? new Date();
      const invalidation = await approvalRepo.update(
        { draftId: input.draftId, invalidatedAt: IsNull() },
        {
          invalidatedAt: now,
          invalidationReason: `Invalidated by new revision ${nextNumber}`,
        }
      );

      // Refresh the projection + reset to unapproved.
      draft.subject = input.subject;
      draft.bodyText = input.bodyText;
      draft.bodyHtml = input.bodyHtml;
      draft.senderAddress = input.senderAddress;
      draft.recipientAddress = input.recipientAddress;
      draft.contentHash = input.contentHash;
      draft.currentRevisionId = savedRevision.id;
      draft.revisionNumber = nextNumber;
      draft.status = "draft";
      draft.approvalInvalidatedAt = now;
      if (input.policyVersion !== undefined)
        draft.policyVersion = input.policyVersion;
      if (input.validationVersion !== undefined)
        draft.validationVersion = input.validationVersion;
      await draftRepo.save(draft);

      return {
        revision: savedRevision,
        invalidatedApprovals: invalidation.affected ?? 0,
      };
    });
  }

  /**
   * THE atomic send claim (technical design §15.3, FR-018, NFR-001).
   *
   * Owns a SQLite transaction that:
   *   1. Conditionally `UPDATE draft SET status='sending' WHERE id=draftId AND
   *      status='approved' AND currentRevisionId=revisionId AND contentHash=approvedHash`.
   *   2. If zero rows affected, a concurrent caller already claimed (or the
   *      precondition no longer holds) — return the existing attempt or a
   *      precondition_failed reason. SMTP is NEVER contacted in that case.
   *   3. Inserts the send_attempt (`claimed`) with the deterministic
   *      idempotency key (unique index is the final duplicate defense).
   *   4. Writes the transactional pre-submit audit row (NFR-001: a send may
   *      not begin if required audit persistence is unavailable).
   *
   * Two concurrent calls for the same approved revision therefore produce at
   * most one `claimed` result and one `already_processed` result.
   */
  async claimApprovedRevisionForSend(
    input: ClaimSendInput
  ): Promise<ClaimSendResult> {
    return await runReplyTxn(this.sqliteDb, async (manager) => {
      const draftRepo = manager.getRepository(EmailReplyDraftEntity);
      const attemptRepo = manager.getRepository(EmailReplySendAttemptEntity);
      const auditRepo = manager.getRepository(EmailReplyAuditLogEntity);

      const updateResult = await draftRepo
        .createQueryBuilder()
        .update(EmailReplyDraftEntity)
        .set({ status: "sending" })
        .where(
          "id = :draftId AND status = :approved AND currentRevisionId = :revisionId AND contentHash = :hash",
          {
            draftId: input.draftId,
            approved: "approved" as EmailReplyDraftStatus,
            revisionId: input.revisionId,
            hash: input.approvedHash,
          }
        )
        .execute();

      if ((updateResult.affected ?? 0) === 0) {
        // Another caller may have already claimed this exact revision.
        const existing = await attemptRepo.findOne({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (existing) {
          return { status: "already_processed", attempt: existing };
        }
        return {
          status: "precondition_failed",
          reason:
            "Draft is not approved, or its current revision/hash no longer matches the approved envelope",
        };
      }

      const claimedAt = new Date();
      const attemptEntity = new EmailReplySendAttemptEntity();
      attemptEntity.idempotencyKey = input.idempotencyKey;
      attemptEntity.draftId = input.draftId;
      attemptEntity.revisionId = input.revisionId;
      attemptEntity.approvalId = input.approvalId;
      attemptEntity.messageId = input.messageId;
      attemptEntity.conversationId = input.conversationId;
      attemptEntity.emailServiceId = input.emailServiceId;
      attemptEntity.senderAddress = input.senderAddress;
      attemptEntity.recipientAddress = input.recipientAddress;
      attemptEntity.status = "claimed";
      attemptEntity.claimedAt = claimedAt;
      attemptEntity.submittedAt = null;
      attemptEntity.completedAt = null;
      attemptEntity.providerMessageId = null;
      attemptEntity.failureCode = null;
      attemptEntity.sanitizedError = null;
      const savedAttempt = await attemptRepo.save(attemptEntity);

      const audit = new EmailReplyAuditLogEntity();
      audit.emailServiceId = input.emailServiceId;
      audit.messageId = input.messageId;
      audit.draftId = input.draftId;
      audit.action = "send_claimed";
      audit.actor = "system";
      audit.reason = "Atomic approved->sending claim before SMTP";
      audit.metadataJson = JSON.stringify({
        attemptId: savedAttempt.id,
        revisionId: input.revisionId,
        policyVersion: input.policyVersion,
      });
      await auditRepo.save(audit);

      return { status: "claimed", attemptId: savedAttempt.id };
    });
  }

  /**
   * Finalize a claimed attempt in ONE transaction: update attempt status,
   * advance the draft state machine, consume the one-time approval, and write
   * the outcome audit (technical design §15.5, FR-016/018/019).
   *
   * `delivery_unknown` is terminal: the approval is consumed and the draft
   * cannot be auto-retried — a fresh explicit approval on a (possibly new)
   * revision is required.
   */
  async finalizeSendOutcome(input: FinalizeOutcomeInput): Promise<void> {
    await runReplyTxn(this.sqliteDb, async (manager) => {
      const attemptRepo = manager.getRepository(EmailReplySendAttemptEntity);
      const draftRepo = manager.getRepository(EmailReplyDraftEntity);
      const approvalRepo = manager.getRepository(EmailReplyApprovalEntity);
      const auditRepo = manager.getRepository(EmailReplyAuditLogEntity);

      const completedAt = new Date();
      const attemptStatus: EmailReplySendAttemptStatus = input.outcome;
      // CONDITIONAL finalize: only advance an attempt that is still in-flight.
      // A recovery sweep can select a stale 'claimed' attempt and then race with
      // a late delivery finalize; without this guard, recovery would clobber a
      // successful 'sent' -> 'delivery_unknown'. If 0 rows match, another caller
      // already finalized — leave the attempt, draft, and approval untouched.
      const attemptUpdate = await attemptRepo.update(
        { id: input.attemptId, status: In(["claimed", "submitted"]) },
        {
          status: attemptStatus,
          completedAt,
          providerMessageId: input.providerMessageId ?? null,
          failureCode: input.failureCode ?? null,
          sanitizedError: input.sanitizedError ?? null,
        }
      );
      if ((attemptUpdate.affected ?? 0) === 0) {
        return;
      }

      const draftPatch: Partial<EmailReplyDraftEntity> = {
        status: input.outcome,
      };
      if (input.outcome === "sent") {
        draftPatch.sentAt = completedAt;
        draftPatch.sendError = null;
      } else {
        draftPatch.sendError = input.sanitizedError ?? null;
      }
      await draftRepo.update({ id: input.draftId }, draftPatch);

      // Consume the one-time approval (idempotent: only if still active).
      await approvalRepo.update(
        { id: input.approvalId, invalidatedAt: IsNull() },
        {
          invalidatedAt: completedAt,
          invalidationReason: `Consumed by ${input.outcome} attempt ${input.attemptId}`,
        }
      );

      const audit = new EmailReplyAuditLogEntity();
      audit.emailServiceId = input.emailServiceId;
      audit.messageId = input.messageId;
      audit.draftId = input.draftId;
      audit.action =
        input.outcome === "sent"
          ? "reply_sent"
          : input.outcome === "failed"
          ? "send_failed"
          : "delivery_unknown";
      audit.actor = "system";
      audit.reason =
        input.outcome === "sent"
          ? "SMTP accepted reply"
          : input.sanitizedError ?? input.outcome;
      audit.metadataJson = JSON.stringify({
        attemptId: input.attemptId,
        providerMessageId: input.providerMessageId ?? null,
        failureCode: input.failureCode ?? null,
      });
      await auditRepo.save(audit);
    });
  }

  /** Count attempts currently in a non-terminal state for a draft. */
  async countActiveSendAttempts(draftId: number): Promise<number> {
    const qb = this.repository.manager
      .getRepository(EmailReplySendAttemptEntity)
      .createQueryBuilder("attempt")
      .where("attempt.draftId = :draftId", { draftId })
      .andWhere("attempt.status IN (:...statuses)", {
        statuses: ["claimed", "submitted"] as EmailReplySendAttemptStatus[],
      });
    return await qb.getCount();
  }

  /** Legacy drafts created before Milestone 1 have no revision row. */
  async listLegacyDrafts(): Promise<EmailReplyDraftEntity[]> {
    return await this.repository
      .createQueryBuilder("draft")
      .where("draft.currentRevisionId IS NULL")
      .orderBy("draft.id", "ASC")
      .getMany();
  }

  /**
   * One-shot migration for a legacy draft (technical design §22.3): create
   * revision 1 from the current subject/body/envelope and materialize the
   * content hash + projection. Unlike {@link appendRevision}, this does NOT
   * invalidate approvals (there are none) and does NOT force the status to
   * `draft` — terminal states (`sent`/`discarded`) stay terminal, and a legacy
   * `approved` row is demoted to `draft` because the PRD requires existing
   * drafts to default to unapproved. Never synthesizes an approval record.
   *
   * Idempotent: if the draft already has a currentRevisionId it is a no-op.
   */
  async materializeRevision1ForLegacyDraft(input: {
    draftId: number;
    actor: "ai" | "user";
    subject: string;
    bodyText: string;
    bodyHtml: string | null;
    senderAddress: string;
    recipientAddress: string;
    contentHash: string;
    emailServiceId: number | null;
  }): Promise<{ revisionId: number; status: EmailReplyDraftStatus } | null> {
    return await runReplyTxn(this.sqliteDb, async (manager) => {
      const draftRepo = manager.getRepository(EmailReplyDraftEntity);
      const revisionRepo = manager.getRepository(EmailReplyDraftRevisionEntity);
      const draft = await draftRepo.findOne({ where: { id: input.draftId } });
      if (!draft) return null;
      if (draft.currentRevisionId) {
        return { revisionId: draft.currentRevisionId, status: draft.status };
      }

      const revisionEntity = new EmailReplyDraftRevisionEntity();
      revisionEntity.draftId = input.draftId;
      revisionEntity.revisionNumber = 1;
      revisionEntity.actor = input.actor;
      revisionEntity.subject = input.subject;
      revisionEntity.bodyText = input.bodyText;
      revisionEntity.bodyHtml = input.bodyHtml;
      revisionEntity.senderAddress = input.senderAddress;
      revisionEntity.recipientAddress = input.recipientAddress;
      revisionEntity.contentHash = input.contentHash;
      revisionEntity.generationMetadataJson = null;
      revisionEntity.validationFindingsJson = null;
      const stripped = parseAndStrip(
        revisionEntity,
        emailReplyDraftRevisionWriteSchema()
      ) as unknown as EmailReplyDraftRevisionEntity;
      const saved = await revisionRepo.save(revisionRepo.create(stripped));

      // PRD §19: existing drafts default to unapproved. Legacy 'approved'
      // (which pre-dates the binding rules) is demoted; terminal states stay.
      const nextStatus: EmailReplyDraftStatus =
        draft.status === "approved" ? "draft" : draft.status;

      await draftRepo.update(
        { id: input.draftId },
        {
          currentRevisionId: saved.id,
          revisionNumber: 1,
          contentHash: input.contentHash,
          senderAddress: input.senderAddress,
          recipientAddress: input.recipientAddress,
          emailServiceId: input.emailServiceId ?? draft.emailServiceId,
          status: nextStatus,
        }
      );
      return { revisionId: saved.id, status: nextStatus };
    });
  }
}

/** Inputs and results for the reliability transaction methods above. */

export interface AppendRevisionInput {
  draftId: number;
  actor: "ai" | "user";
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  senderAddress: string;
  recipientAddress: string;
  contentHash: string;
  generationMetadataJson?: string | null;
  validationFindingsJson?: string | null;
  policyVersion?: string | null;
  validationVersion?: string | null;
  /** Optional clock for deterministic tests. */
  at?: Date;
}

export interface ClaimSendInput {
  draftId: number;
  revisionId: number;
  approvedHash: string;
  idempotencyKey: string;
  approvalId: number;
  messageId: number;
  conversationId: number | null;
  emailServiceId: number;
  senderAddress: string;
  recipientAddress: string;
  policyVersion: string | null;
}

export type ClaimSendResult =
  | { readonly status: "claimed"; readonly attemptId: number }
  | {
      readonly status: "already_processed";
      readonly attempt: EmailReplySendAttemptEntity;
    }
  | { readonly status: "precondition_failed"; readonly reason: string };

export interface FinalizeOutcomeInput {
  attemptId: number;
  draftId: number;
  approvalId: number;
  emailServiceId: number;
  messageId: number;
  outcome: "sent" | "failed" | "delivery_unknown";
  providerMessageId?: string | null;
  failureCode?: string | null;
  sanitizedError?: string | null;
}
