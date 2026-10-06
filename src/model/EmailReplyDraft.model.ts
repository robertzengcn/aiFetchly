import { BaseDb } from "@/model/Basedb";
import { Repository, IsNull, In, type EntityManager } from "typeorm";
import { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { EmailReplyDraftRevisionEntity } from "@/entity/EmailReplyDraftRevision.entity";
import { EmailReplyApprovalEntity } from "@/entity/EmailReplyApproval.entity";
import { EmailReplySendAttemptEntity } from "@/entity/EmailReplySendAttempt.entity";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import { EmailReplyGuardEntity } from "@/entity/EmailReplyGuard.entity";
import { SortBy } from "@/entityTypes/commonType";
import {
  EmailReplyDraftStatus,
  EmailReplyStatus,
} from "@/entityTypes/emailReceiveTypes";
import type {
  EmailReplySendAttemptStatus,
  GuardPhase,
} from "@/entityTypes/emailReplyReliabilityTypes";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { emailReplyDraftWriteSchema } from "@/schemas/entity/emailReplyDraft";
import { emailReplyDraftRevisionWriteSchema } from "@/schemas/entity/emailReplyDraftRevision";
import { rejectDatabaseAccessFromWorker } from "@/model/_workerBoundaryGuard";
import { runReplyTxn } from "@/model/replyTxn";
import {
  readClusterEvidence,
  clusterEvidenceBlocksSend,
  bindGuardToSendPhase,
  evidenceToPhase,
} from "@/model/replyClusterEvidence";
import { correlationIdForMessage } from "@/service/emailReply/EmailReplyCorrelation";
import { hashApprovalEnvelope } from "@/service/emailReply/EmailReplyRevisionHasher";
import { validateReplyOutput } from "@/service/emailReply/EmailReplyOutputValidator";
import { REPLY_PROMPT_VERSION } from "@/service/emailReply/EmailReplyPromptBuilder";
import {
  REPLY_POLICY_VERSION,
  REPLY_VALIDATOR_VERSION,
} from "@/service/emailReply/replyReliabilityVersions";
import type { EmailReplyApprovalEnvelope } from "@/entityTypes/emailReplyReliabilityTypes";

// The shared `replyWriteMutex` lives in `src/model/replyTxn.ts` so that
// `EmailReplyDraftModel` and `EmailReplyGuardModel` (T07) serialize their
// transactions on the same in-process mutex — see replyTxn.ts for the
// rationale and the cross-process/cross-crash fencing disclaimer.

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
    return await runReplyTxn(this.sqliteDb, async (manager) => {
      const draftRepo = manager.getRepository(EmailReplyDraftEntity);
      const created = draftRepo.create(stripped);
      return await draftRepo.save(created);
    });
  }

  /**
   * Transaction-composable helper for {@link create}. Accepts an
   * already-parseAndStrip'd entity (the schema gate runs in the public method
   * so callers keep their existing API). Used by {@link commitGeneratedDraft}
   * to fold the draft insert into the atomic commit transaction (Step 4).
   */
  async createDraftWithManager(
    manager: EntityManager,
    stripped: EmailReplyDraftEntity
  ): Promise<EmailReplyDraftEntity> {
    const draftRepo = manager.getRepository(EmailReplyDraftEntity);
    const created = draftRepo.create(stripped);
    return await draftRepo.save(created);
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
      await this.applyContentHashWithManager(
        manager,
        draftId,
        revisionId,
        contentHash
      );
    });
  }

  /**
   * Transaction-composable helper for {@link applyContentHash}. Used by
   * {@link commitGeneratedDraft} to persist the real content hash inside the
   * atomic commit transaction (Step 4).
   */
  async applyContentHashWithManager(
    manager: EntityManager,
    draftId: number,
    revisionId: number,
    contentHash: string
  ): Promise<void> {
    const draftRepo = manager.getRepository(EmailReplyDraftEntity);
    const revisionRepo = manager.getRepository(EmailReplyDraftRevisionEntity);
    await revisionRepo.update({ id: revisionId }, { contentHash });
    await draftRepo.update({ id: draftId }, { contentHash });
  }

  /**
   * Atomically transition `draft -> approved` for a specific revision + hash.
   * Only succeeds if the draft is currently `draft` and the current revision's
   * hash matches {@link approvedHash}. Returns false if a concurrent edit moved
   * the draft away (FR-015, FR-016). The approval timestamp lives on the
   * EmailReplyApproval row, not the draft, so no `at` parameter is needed.
   */
  async markApproved(
    draftId: number,
    revisionId: number,
    approvedHash: string,
    policyVersion: string
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
      return await this.appendRevisionWithManager(manager, input);
    });
  }

  /**
   * Transaction-composable helper for {@link appendRevision}. The full
   * revision-append body without its own `runReplyTxn` wrapper, so the atomic
   * {@link commitGeneratedDraft} transaction (Step 4) can compose it directly
   * without nesting independent transactions (design §3). Public so the
   * Step-4 throw-inside-commit test can spy on it via
   * `vi.spyOn(EmailReplyDraftModel.prototype, "appendRevisionWithManager")`.
   */
  async appendRevisionWithManager(
    manager: EntityManager,
    input: AppendRevisionInput
  ): Promise<{
    revision: EmailReplyDraftRevisionEntity;
    invalidatedApprovals: number;
  }> {
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
    revisionEntity.envelopeVersion = input.envelopeVersion ?? 1;
    revisionEntity.smtpUsername = input.smtpUsername ?? null;
    revisionEntity.replyToAddress = input.replyToAddress ?? null;
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
  }

  /**
   * THE atomic generation commit (Step 4, design §8.1): ONE `runReplyTxn`
   * that persists the generated draft end-to-end. Replaces the previous
   * separate non-transactional writes (draft create → revision materialize →
   * message update → guard transition → audit), so a crash can no longer
   * leave a partially committed draft with no revision — the "unbound
   * sendable draft" the design forbids. All steps roll back together on any
   * failure:
   *
   *   1. Guard owner/lease re-check (fenced late-result gate, §8.2): an
   *      expired or replaced owner returns `{ status: "fenced" }` — no writes
   *      have happened yet, so the early return is safe.
   *   2. Draft insert (parseAndStrip runs inside the commit path).
   *   3. Revision 1 append (placeholder hash) + deterministic output
   *      validation findings + real canonical content hash via
   *      {@link hashApprovalEnvelope} with the assigned revision id + hash
   *      persistence. Replicates {@link materializeRevision1}'s exact hash
   *      contract (FR-012/P0.4/P0.1) inside the transaction.
   *   4. Draft projection refresh (subject/body/envelope/hash/revision) —
   *      subsumed by the revision append.
   *   5. Message `replyStatus = "draft_created"` + processedAt (P0.6).
   *   6. Guard transition to `draft_ready` binding the committed draft —
   *      fenced by ownerToken; 0 rows THROWS so the transaction rolls back
   *      (a normal return mid-transaction would commit earlier writes).
   *   7. `draft_created` audit row with the request correlation id.
   *
   * Model/network work (LLM calls, email-service reads) stays OUTSIDE this
   * transaction (§8.1) — the caller resolves sender/recipient first and
   * passes them in.
   */
  async commitGeneratedDraft(
    input: CommitGeneratedDraftInput
  ): Promise<CommitGeneratedDraftResult> {
    return await runReplyTxn(this.sqliteDb, async (manager) => {
      // 1. Fenced late-result gate: re-check ownership + lease inside the
      // same transaction that writes. An expired or replaced owner means the
      // late output is stale — discard it (§8.2).
      const guardRepo = manager.getRepository(EmailReplyGuardEntity);
      const guard = await guardRepo.findOne({ where: { id: input.guardId } });
      const now = input.now ?? new Date();
      if (
        !guard ||
        guard.ownerToken !== input.ownerToken ||
        !guard.leaseExpiresAt ||
        guard.leaseExpiresAt.getTime() <= now.getTime()
      ) {
        return { status: "fenced" };
      }

      // 2. Draft insert.
      const strippedDraft = parseAndStrip(
        input.rawDraft,
        emailReplyDraftWriteSchema()
      ) as unknown as EmailReplyDraftEntity;
      const savedDraft = await this.createDraftWithManager(
        manager,
        strippedDraft
      );

      // 3. Revision 1 + validation findings + canonical content hash.
      const validation = validateReplyOutput(input.subject, input.bodyText);
      const appended = await this.appendRevisionWithManager(manager, {
        draftId: savedDraft.id,
        actor: "ai",
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: null,
        senderAddress: input.senderAddress,
        recipientAddress: input.recipientAddress,
        contentHash: "pending-materialize",
        policyVersion: REPLY_POLICY_VERSION,
        validationVersion: REPLY_VALIDATOR_VERSION,
        generationMetadataJson: input.generationMetadataJson,
        validationFindingsJson: JSON.stringify({
          findings: validation.findings,
          sendableAfterApproval: validation.sendableAfterApproval,
          validatorVersion: validation.validatorVersion,
        }),
      });
      const envelope: EmailReplyApprovalEnvelope = {
        draftId: savedDraft.id,
        revisionId: appended.revision.id,
        emailServiceId: input.emailServiceId,
        originalMessageId: input.messageId,
        senderAddress: input.senderAddress,
        recipientAddress: input.recipientAddress,
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: null,
        policyVersion: REPLY_POLICY_VERSION,
        validationVersion: REPLY_VALIDATOR_VERSION,
      };
      const contentHash = hashApprovalEnvelope(envelope);
      await this.applyContentHashWithManager(
        manager,
        savedDraft.id,
        appended.revision.id,
        contentHash
      );

      // 5. Message reply status + processedAt travel in the SAME transaction
      // (P0.6).
      const messageRepo = manager.getRepository(EmailReceivedMessageEntity);
      await messageRepo.update(
        { id: input.messageId },
        { replyStatus: "draft_created", processedAt: now }
      );

      // 6. Guard transition to draft_ready — fenced by ownerToken. Zero rows
      // means the owner changed between step 1 and here; THROW so the
      // transaction rolls back (a normal return would commit).
      const guardUpdate = await guardRepo
        .createQueryBuilder()
        .update(EmailReplyGuardEntity)
        .set({
          phase: "draft_ready" as GuardPhase,
          activeDraftId: savedDraft.id,
          activeAttemptId: null,
        })
        .where("id = :guardId AND ownerToken = :ownerToken", {
          guardId: input.guardId,
          ownerToken: input.ownerToken,
        })
        .execute();
      if ((guardUpdate.affected ?? 0) === 0) {
        throw new Error(
          `Generation reservation ${input.guardId} changed owner before commit; transaction rolled back`
        );
      }

      // 7. draft_created audit row (promoted from the non-transactional
      // writeReplyAudit — same metadata shape the correlation tests assert).
      const auditRepo = manager.getRepository(EmailReplyAuditLogEntity);
      const audit = new EmailReplyAuditLogEntity();
      audit.emailServiceId = input.emailServiceId;
      audit.messageId = input.messageId;
      audit.draftId = savedDraft.id;
      audit.action = "draft_created";
      audit.actor = "ai";
      audit.reason = "AI generated knowledge-grounded reply draft";
      audit.metadataJson = JSON.stringify({
        correlationId: input.requestCorrelationId,
        messageCorrelationId: correlationIdForMessage(input.messageId),
        promptVersion: REPLY_PROMPT_VERSION,
      });
      await auditRepo.save(audit);

      return {
        status: "committed",
        draftId: savedDraft.id,
        revisionId: appended.revision.id,
        revisionNumber: appended.revision.revisionNumber,
        contentHash,
      };
    });
  }

  /**
   * THE atomic send claim (technical design §15.3, §8.2, FR-018, FR-036,
   * NFR-001).
   *
   * Owns a SQLite transaction that:
   *   1. Canonical-cluster sibling check (FR-029/FR-036): reads every draft +
   *      attempt across the message's canonical cluster INSIDE the same
   *      transaction as the claim. Terminal or in-flight evidence on a
   *      sibling (sent/delivery_unknown/claimed/submitted) returns
   *      `precondition_failed` BEFORE any write — the FR-029 precedence
   *      applies before the draft flips to `sending`.
   *   2. Conditionally `UPDATE draft SET status='sending' WHERE id=draftId AND
   *      status='approved' AND currentRevisionId=revisionId AND contentHash=approvedHash`.
   *   3. If zero rows affected, a concurrent caller already claimed (or the
   *      precondition no longer holds) — return the existing attempt or a
   *      precondition_failed reason. SMTP is NEVER contacted in that case.
   *   4. Inserts the send_attempt (`claimed`) with the deterministic
   *      idempotency key (unique index is the final duplicate defense).
   *   5. Binds the guard row to `phase="sending"` + `activeAttemptId` —
   *      fenced by `phase IN ("draft_ready", "idle")`. 0 rows means another
   *      attempt is in flight or terminal evidence exists; THROWS so the
   *      transaction (including the attempt INSERT) rolls back (§8.2).
   *   6. Writes the transactional pre-submit audit row (NFR-001: a send may
   *      not begin if required audit persistence is unavailable).
   *
   * Two concurrent calls for the same approved revision therefore produce at
   * most one `claimed` result and one `already_processed` result. A sibling
   * flipping to sent between an outside read and this claim can no longer
   * slip through — the sibling check and the claim are one transaction.
   */
  async claimApprovedRevisionForSend(
    input: ClaimSendInput
  ): Promise<ClaimSendResult> {
    return await runReplyTxn(this.sqliteDb, async (manager) => {
      const draftRepo = manager.getRepository(EmailReplyDraftEntity);
      const attemptRepo = manager.getRepository(EmailReplySendAttemptEntity);
      const auditRepo = manager.getRepository(EmailReplyAuditLogEntity);

      // 1. Canonical-cluster sibling check (§8.2) — before ANY write. The
      // seed message row is input.messageId; the cluster join is
      // (emailServiceId, normalizedMessageId) per §4.1.
      const evidence = await readClusterEvidence(manager, {
        emailServiceId: input.emailServiceId,
        normalizedMessageId: null, // resolved from the seed row below
        seedMessageId: input.messageId,
      });
      if (clusterEvidenceBlocksSend(evidence, input.draftId)) {
        // §5.2: the guard row's phase must not linger behind the cluster —
        // reconcile it to the evidence phase (stale projection → sent) before
        // refusing. Best-effort inside the same transaction; the refusal
        // itself is the authority.
        if (input.guardId !== null && input.guardId !== undefined) {
          const { phase, activeDraftId, activeAttemptId } =
            evidenceToPhase(evidence);
          await manager.getRepository(EmailReplyGuardEntity).update(
            { id: input.guardId },
            { phase, activeDraftId, activeAttemptId }
          );
        }
        return {
          status: "precondition_failed",
          reason:
            "Message-level state blocks send: a sibling draft or attempt is sent, delivery-unknown, or in flight (FR-029)",
        };
      }

      // 2. Guard-phase precondition (T08/FR-036): a bound guard accepts a new
      // send only from `draft_ready`/`idle`. A `sending`/`sent`/
      // `delivery_unknown` guard is in-flight or terminal evidence — refuse
      // BEFORE any write (§8.2). A missing guard row (deleted between the
      // caller's resolution and this claim) skips binding entirely.
      let bindGuardId: number | null = null;
      if (input.guardId !== null && input.guardId !== undefined) {
        const guardRepo = manager.getRepository(EmailReplyGuardEntity);
        const guardRow = await guardRepo.findOne({
          where: { id: input.guardId },
        });
        if (guardRow) {
          if (
            guardRow.phase !== "draft_ready" &&
            guardRow.phase !== "idle"
          ) {
            return {
              status: "precondition_failed",
              reason: `Message guard is ${guardRow.phase}; a new send requires draft_ready or idle (FR-029)`,
            };
          }
          bindGuardId = input.guardId;
        }
      }

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

      // 5. Guard binding (T08/FR-036) — same transaction as the claim, using
      // the pre-write-verified `bindGuardId`. 0 rows here means the guard
      // phase changed between step 2 and this UPDATE (mutex serialization
      // makes it near-impossible); THROW so the attempt INSERT rolls back
      // (§8.2) rather than committing a claim without its cluster exclusion.
      if (bindGuardId !== null) {
        const bound = await bindGuardToSendPhase(manager, {
          guardId: bindGuardId,
          activeAttemptId: savedAttempt.id,
        });
        if (!bound) {
          throw new Error(
            `Guard ${bindGuardId} changed phase before the send bind; transaction rolled back`
          );
        }
      }

      const audit = new EmailReplyAuditLogEntity();
      audit.emailServiceId = input.emailServiceId;
      audit.messageId = input.messageId;
      audit.draftId = input.draftId;
      audit.action = "send_claimed";
      audit.actor = "system";
      audit.reason = "Atomic approved->sending claim before SMTP";
      audit.metadataJson = JSON.stringify({
        correlationId: correlationIdForMessage(input.messageId),
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
      const messageRepo = manager.getRepository(EmailReceivedMessageEntity);

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

      // Received-message reply status travels in the SAME transaction as the
      // attempt/draft/approval/audit (P0.6). 'delivery_unknown' leaves the
      // message status untouched (no EmailReplyStatus for ambiguous delivery).
      if (input.messageReplyStatus) {
        await messageRepo.update(
          { id: input.messageId },
          { replyStatus: input.messageReplyStatus, processedAt: completedAt }
        );
      }

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
        correlationId: correlationIdForMessage(input.messageId),
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
   * Invalidate every not-yet-sent draft for a mailbox after its knowledge scope
   * or identity profile changed (FR-008/FR-013): approved drafts return to
   * 'draft', active approvals are invalidated, and approvalInvalidatedAt is
   * stamped so the UI visibly clears approval state. Terminal states (sent /
   * discarded / delivery_unknown) are untouched.
   */
  async invalidateUnsentDraftsForMailbox(
    emailServiceId: number,
    reason: string
  ): Promise<number> {
    return await runReplyTxn(this.sqliteDb, async (manager) => {
      const draftRepo = manager.getRepository(EmailReplyDraftEntity);
      const approvalRepo = manager.getRepository(EmailReplyApprovalEntity);
      const now = new Date();

      const approved = await draftRepo.find({
        where: { emailServiceId, status: "approved" as EmailReplyDraftStatus },
      });
      if (approved.length > 0) {
        await draftRepo.update(
          { emailServiceId, status: "approved" as EmailReplyDraftStatus },
          { status: "draft", approvalInvalidatedAt: now }
        );
        for (const d of approved) {
          await approvalRepo.update(
            { draftId: d.id, invalidatedAt: IsNull() as never },
            { invalidatedAt: now, invalidationReason: reason }
          );
        }
      }
      // Plain 'draft' rows get the stamp too so the UI can show a stale marker.
      await draftRepo.update(
        { emailServiceId, status: "draft" as EmailReplyDraftStatus },
        { approvalInvalidatedAt: now }
      );
      return approved.length;
    });
  }

  /**
   * Operator-driven manual reconciliation of an ambiguous delivery (P0.6,
   * FR-019, technical design §16). UNCONDITIONAL transactional update (the
   * operator is the trusted authority here, unlike the conditional auto-finalize):
   *   - confirm_sent: attempt -> 'sent', draft -> 'sent', message -> 'sent'.
   *   - confirm_not_sent: attempt -> 'failed', draft -> 'draft' (re-editable;
   *     the user's next edit creates a fresh revision via materializeRevision1).
   *   - leave_unresolved: no state change (audit only).
   * Always writes a reconciliation audit row with the supplied evidence.
   */
  async reconcileDelivery(input: {
    attemptId: number;
    draftId: number;
    messageId: number;
    emailServiceId: number;
    action: "confirm_sent" | "confirm_not_sent" | "leave_unresolved";
    evidence?: string | null;
    providerMessageId?: string | null;
  }): Promise<void> {
    await runReplyTxn(this.sqliteDb, async (manager) => {
      const attemptRepo = manager.getRepository(EmailReplySendAttemptEntity);
      const draftRepo = manager.getRepository(EmailReplyDraftEntity);
      const messageRepo = manager.getRepository(EmailReceivedMessageEntity);
      const auditRepo = manager.getRepository(EmailReplyAuditLogEntity);
      const now = new Date();

      if (input.action === "confirm_sent") {
        await attemptRepo.update(
          { id: input.attemptId },
          {
            status: "sent",
            completedAt: now,
            providerMessageId: input.providerMessageId ?? null,
            sanitizedError: input.evidence ?? null,
          }
        );
        await draftRepo.update(
          { id: input.draftId },
          { status: "sent", sentAt: now, sendError: null }
        );
        await messageRepo.update(
          { id: input.messageId },
          { replyStatus: "sent", processedAt: now }
        );
      } else if (input.action === "confirm_not_sent") {
        await attemptRepo.update(
          { id: input.attemptId },
          {
            status: "failed",
            completedAt: now,
            sanitizedError: input.evidence ?? "Operator confirmed not sent",
          }
        );
        await draftRepo.update(
          { id: input.draftId },
          { status: "draft", sendError: input.evidence ?? null }
        );
      }
      // leave_unresolved: no state change.

      const audit = new EmailReplyAuditLogEntity();
      audit.emailServiceId = input.emailServiceId;
      audit.messageId = input.messageId;
      audit.draftId = input.draftId;
      audit.action =
        input.action === "confirm_sent" ? "reply_sent" : "send_failed";
      audit.actor = "system";
      audit.reason = `Manual reconciliation: ${input.action}`;
      audit.metadataJson = JSON.stringify({
        correlationId: correlationIdForMessage(input.messageId),
        attemptId: input.attemptId,
        evidence: input.evidence ?? null,
        providerMessageId: input.providerMessageId ?? null,
      });
      await auditRepo.save(audit);
    });
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
  /**
   * Envelope schema version (§18.1). Defaults to 1 (legacy) when omitted so
   * existing callers stay on the v1 hash path. Set to 2 for revisions that
   * bind the resolved service identity.
   */
  envelopeVersion?: 1 | 2;
  /**
   * Effective SMTP login username frozen on this revision (§18.1). Null for v1
   * revisions; populated for v2 revisions by the materializer.
   */
  smtpUsername?: string | null;
  /**
   * Effective Reply-To frozen on this revision (§18.1). Null for v1 revisions
   * and for v2 revisions where the service has no configured Reply-To.
   */
  replyToAddress?: string | null;
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
  /**
   * T08/FR-036: the guard row to bind to `phase="sending"` + the new
   * attempt, resolved by the caller (delivery service) from the draft's
   * `(emailServiceId, replyKey)` BEFORE the claim. Null/undefined (no guard
   * row — e.g. legacy rows predating the guard) skips binding: the claim's
   * conditional draft UPDATE + sibling check remain the authority.
   */
  guardId?: number | null;
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
  /**
   * If provided, the received message's replyStatus is updated in the SAME
   * transaction as the attempt/draft/approval/audit (P0.6). Omit for
   * delivery_unknown (no EmailReplyStatus for ambiguous delivery).
   */
  messageReplyStatus?: EmailReplyStatus;
}

/** Input to the atomic generation commit ({@link commitGeneratedDraft}). */
export interface CommitGeneratedDraftInput {
  /** Guard row this invocation owns (reservation acquired before generation). */
  guardId: number;
  /** Opaque fencing token proving ownership of the guard lease (§8.2). */
  ownerToken: string;
  /** Raw (unsaved) draft entity built by the generation service. */
  rawDraft: EmailReplyDraftEntity;
  emailServiceId: number;
  messageId: number;
  subject: string;
  bodyText: string;
  /**
   * Resolved sender/recipient binding for the revision + approval envelope.
   * Resolved by the caller (generation service) OUTSIDE the transaction
   * (§8.1 — no network/reads of other domains inside the commit txn).
   */
  senderAddress: string;
  recipientAddress: string;
  /** Sanitized generation metadata JSON (prompt/scope/context versions). */
  generationMetadataJson: string | null;
  /** Request-scoped correlation id written on the draft_created audit row. */
  requestCorrelationId: string;
  /** Optional clock for deterministic tests. */
  now?: Date;
}

export type CommitGeneratedDraftResult =
  | {
      readonly status: "committed";
      readonly draftId: number;
      readonly revisionId: number;
      readonly revisionNumber: number;
      readonly contentHash: string;
    }
  | { readonly status: "fenced" };
