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
  classifyClusterEligibility,
  type ClusterEligibilityReason,
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

/**
 * Forced-send freshness window (FR-031 §9.3): the most recent reply-detection
 * observation on the seed message must be ≤ this many milliseconds old at the
 * moment the claim transaction opens. The fence inspects the persisted
 * observation timestamp ONLY — it does NOT await the mailbox inside the
 * transaction (§9.3). A stale observation returns `freshness_stale` with NO
 * write, so the delivery service can rerun detection OUTSIDE the transaction
 * and re-claim once.
 */
export const FORCED_FRESHNESS_WINDOW_MS = 5_000;

/**
 * The `precondition_failed` reason returned by the §9.3 forced-freshness
 * fence. Exported so the delivery service's retry path compares against a
 * single source of truth instead of a bare string literal that could be
 * typo'd silently (D7.3). Any code that switches on this reason MUST import
 * the constant rather than re-literalizing it.
 */
export const FRESHNESS_STALE = "freshness_stale";

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

  /** Batched {@link listByMessage} for a cluster of message ids (one query). */
  async listByMessageIds(
    messageIds: number[]
  ): Promise<EmailReplyDraftEntity[]> {
    if (messageIds.length === 0) return [];
    return await this.repository.find({
      where: { messageId: In(messageIds) },
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

      // R01: cluster-evidence reconciliation BEFORE the draft insert. The
      // owner/lease fence above proves THIS invocation owns the generation
      // lease, but it does NOT prove the canonical identity is still eligible
      // for a new draft. Between the reservation acquire (outside this txn)
      // and the commit, reply evidence may have appeared on the seed or a
      // sibling row: a `\Answered` flag landed (sticky positive), a sent/
      // unknown attempt landed on another draft, or a parallel generation
      // committed a conflicting draft. The previous code went straight from
      // the owner/lease check to the draft insert, persisting a new draft on
      // top of authoritative reply history.
      //
      // Resolve the canonical cluster (R03: always includes the seed,
      // aggregates sibling positives + sent projections) and classify
      // eligibility. A non-`eligible` reason is a typed refusal with NO
      // write — no draft insert, no revision, no message-status update, no
      // guard transition, no audit. The caller releases the reservation and
      // surfaces the policy code (`already_replied`/`delivery_unknown`/
      // `reply_in_progress`/`reply_state_conflict`). The acting-draft id is
      // null (no existing draft yet at commit time).
      //
      // The guard-phase precondition (expected `generating`) is checked
      // here too: a guard that already moved to `draft_ready`/`sending`/sent
      // means a prior commit already bound a draft for this lease — the
      // late output is stale and must not write a second draft. This is the
      // "expected generating phase and binding" part of the R01 acceptance.
      if (
        guard.phase !== "generating"
      ) {
        return { status: "fenced" };
      }
      const evidence = await readClusterEvidence(manager, {
        emailServiceId: input.emailServiceId,
        normalizedMessageId: null, // resolved from the seed row inside the resolver
        seedMessageId: input.messageId,
      });
      const eligibility = classifyClusterEligibility(evidence, null);
      if (eligibility.reason !== "eligible") {
        return { status: "refused", reason: eligibility.reason };
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
      // Review D9.1: single injected clock source for the §9.3 freshness
      // fence below. Production passes no `now` → wall clock; tests pin it so
      // the age comparison is deterministic and a slow CI clock cannot let a
      // stale negative through the 5s window.
      const now = input.now ?? new Date();

      // 0. Forced-freshness fence (FR-031 §9.3) — BEFORE the sibling check.
      // The pre-send detection (step 8) wrote a fresh observation just before
      // this claim; if that observation is older than FORCED_FRESHNESS_WINDOW_MS
      // by the time the transaction opens, the negative may be stale (a reply
      // could have arrived in the gap). The fence inspects the persisted
      // observation timestamp ONLY — it does NOT await the mailbox inside the
      // transaction (§9.3). A sticky positive (replyDetectedAt) is always
      // fresh enough (a known positive short-circuits; the send is refused
      // upstream by runPreSendDetection). Returns freshness_stale with NO
      // write so the delivery service can rerun detection OUTSIDE the
      // transaction and re-claim once.
      //
      // FAIL-CLOSED (D1a, adversarial finding #1): a null observation is NOT a
      // green light. The delivery path runs detection (step 5b) before the
      // claim, so by the time the transaction opens the timestamp MUST be
      // populated. A null replyNegativeCheckAt/replyDetectedAt means either the
      // detection never ran or its persistence failed silently (D1b) — in both
      // cases the send must NOT proceed on a missing observation. Treat null as
      // stale → freshness_stale → the delivery service reruns detection outside
      // the transaction and re-claims once (§9.3). This closes the fail-open
      // hole where a swallowed persist error produced a decisive not_replied
      // with zero persisted evidence, skipped the fence, and sent anyway.
      const messageRepo = manager.getRepository(EmailReceivedMessageEntity);
      const seedMessage = await messageRepo.findOne({
        where: { id: input.messageId },
      });
      if (!seedMessage) {
        // No seed row — a sibling check below would also find nothing to bind
        // the cluster on; refuse rather than claim against a missing seed.
        return {
          status: "precondition_failed",
          reason: FRESHNESS_STALE,
        };
      }
      // R02: a positive is NEVER permission to send. The freshness fence
      // requires a complete, context-matching fresh NEGATIVE — only
      // `replyNegativeCheckAt` satisfies it. A sticky positive
      // (`replyDetectedAt`) means the canonical identity has a known reply;
      // the sibling check below refuses with `already_replied` (it now
      // aggregates cluster-level positives). The previous
      // `replyNegativeCheckAt ?? replyDetectedAt` accepted a fresh positive as
      // "fresh enough" and let the claim proceed to SMTP despite known reply
      // evidence.
      const observedAt = seedMessage.replyNegativeCheckAt;
      if (observedAt === null) {
        // Fail-closed: missing negative observation → force the delayed
        // refresh. A null `replyNegativeCheckAt` means either detection never
        // ran, its persistence failed silently (D1b), or a positive was
        // recorded without a prior negative — in all cases the send must NOT
        // proceed on a missing negative. Treat null as stale → freshness_stale
        // → the delivery service reruns detection outside the transaction and
        // re-claims once (§9.3).
        return {
          status: "precondition_failed",
          reason: FRESHNESS_STALE,
        };
      }
      const ageMs = now.getTime() - observedAt.getTime();
      if (ageMs > FORCED_FRESHNESS_WINDOW_MS) {
        return {
          status: "precondition_failed",
          reason: FRESHNESS_STALE,
        };
      }

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
   * advance the draft state machine, consume the one-time approval, transition
   * the guard, and write the outcome audit (technical design §15.5, §8.2,
   * FR-016/018/019/036).
   *
   * Conditional fence (§9 final paragraph):
   *   - `outcome = "sent"`: matches `status IN (claimed, submitted,
   *     delivery_unknown)` — a late successful SMTP finalization UPGRADES an
   *     earlier `delivery_unknown` (recovery timed out, then SMTP succeeded).
   *   - `outcome = "failed" | "delivery_unknown"`: strict
   *     `status IN (claimed, submitted)` — cannot downgrade a `sent`.
   * 0 rows = another caller already finalized → leave everything untouched
   * (fenced late-result rejection at the attempt level).
   *
   * Guard transition (T08): fenced by `phase="sending"` so a guard recovery
   * already moved (to `sent`/`delivery_unknown`/`idle`) is left alone. The
   * `delivery_unknown → sent` upgrade is allowed (late success); `sent → *`
   * is forbidden (the fence refuses — guard stays `sent`).
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
      // CONDITIONAL finalize (§9). A late `sent` upgrades an earlier
      // `delivery_unknown`; a downgrade cannot match a `sent` attempt.
      const matchStatuses: EmailReplySendAttemptStatus[] =
        input.outcome === "sent"
          ? ["claimed", "submitted", "delivery_unknown"]
          : ["claimed", "submitted"];
      const attemptUpdate = await attemptRepo.update(
        { id: input.attemptId, status: In(matchStatuses) },
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

      // T08 guard transition (§8.2). The fence mirrors the attempt fence:
      //   - `outcome = "sent"` matches `phase IN (sending, delivery_unknown)` —
      //     a late success upgrades an earlier unknown (recovery moved the
      //     guard to `delivery_unknown`, then SMTP succeeded).
      //   - `outcome = "failed" | "delivery_unknown"` matches only
      //     `phase = "sending"` — never downgrade a `sent`, never release the
      //     `delivery_unknown` protection (a timeout alone never opens the
      //     message). A guard recovery already finalized (any other phase) is
      //     left alone.
      if (input.guardId !== null && input.guardId !== undefined) {
        const guardRepo = manager.getRepository(EmailReplyGuardEntity);
        const guardPatch: Partial<EmailReplyGuardEntity> = {
          phase:
            input.outcome === "sent"
              ? ("sent" as GuardPhase)
              : input.outcome === "delivery_unknown"
              ? ("delivery_unknown" as GuardPhase)
              : ("draft_ready" as GuardPhase),
          activeAttemptId: null,
        };
        const guardMatchPhases: GuardPhase[] =
          input.outcome === "sent"
            ? ["sending", "delivery_unknown"]
            : ["sending"];
        await guardRepo.update(
          { id: input.guardId, phase: In(guardMatchPhases) },
          guardPatch
        );
      }

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
      const guardRepo = manager.getRepository(EmailReplyGuardEntity);
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
          // T08/FR-036: release any guard bound to this now-invalidated draft.
          // Fenced by `phase="draft_ready" AND activeDraftId = :draftId` so a
          // guard that already moved to `sending` (an in-flight send on this
          // draft) is NOT released — that send can still complete and must not
          // lose its message-level exclusion (§9). 0 rows = no guard bound to
          // this draft, or the guard already transitioned → leave untouched.
          await guardRepo.update(
            { activeDraftId: d.id, phase: "draft_ready" as GuardPhase },
            {
              phase: "idle" as GuardPhase,
              ownerToken: null,
              leaseExpiresAt: null,
              activeDraftId: null,
              activeAttemptId: null,
            }
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
    /**
     * T08/FR-036: guard row bound to this attempt. When non-null, the guard
     * transitions alongside the reconciliation. `confirm_not_sent` is REFUSED
     * while a `sending` attempt is in flight on a different attempt id (§9:
     * "While an original submitter could still be running, reconciliation
     * cannot authorize retry").
     */
    guardId?: number | null;
  }): Promise<void> {
    await runReplyTxn(this.sqliteDb, async (manager) => {
      const attemptRepo = manager.getRepository(EmailReplySendAttemptEntity);
      const draftRepo = manager.getRepository(EmailReplyDraftEntity);
      const messageRepo = manager.getRepository(EmailReceivedMessageEntity);
      const auditRepo = manager.getRepository(EmailReplyAuditLogEntity);
      const guardRepo = manager.getRepository(EmailReplyGuardEntity);
      const now = new Date();

      // T08/§9: refuse `confirm_not_sent` while a `sending` guard is bound to a
      // DIFFERENT in-flight attempt. The original submitter could still be
      // running and may yet succeed; reconciliation must not authorize a
      // retry that races it. `confirm_sent` and `leave_unresolved` are always
      // safe (terminal / no-op).
      if (input.action === "confirm_not_sent" && input.guardId !== null && input.guardId !== undefined) {
        const guardRow = await guardRepo.findOne({ where: { id: input.guardId } });
        if (
          guardRow &&
          guardRow.phase === "sending" &&
          guardRow.activeAttemptId !== null &&
          guardRow.activeAttemptId !== input.attemptId
        ) {
          throw new Error(
            `Reconciliation refused: a different send attempt (${guardRow.activeAttemptId}) is in flight on this message (§9)`
          );
        }
      }

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
        // Guard → `sent` (terminal protection). Fenced by
        // `phase IN (sending, delivery_unknown)`: the operator resolves the
        // ambiguous state the guard is parked in; a guard already at `sent`
        // (recovery or a sibling) is left alone.
        if (input.guardId !== null && input.guardId !== undefined) {
          await guardRepo.update(
            {
              id: input.guardId,
              phase: In(["sending", "delivery_unknown"] as GuardPhase[]),
            },
            { phase: "sent" as GuardPhase, activeAttemptId: null }
          );
        }
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
        // Guard → `draft_ready` (reopens the draft for a fresh approval +
        // send). Same fence — `sending` is only reachable here after the
        // in-flight refusal above confirmed no DIFFERENT attempt is running.
        if (input.guardId !== null && input.guardId !== undefined) {
          await guardRepo.update(
            {
              id: input.guardId,
              phase: In(["sending", "delivery_unknown"] as GuardPhase[]),
            },
            { phase: "draft_ready" as GuardPhase, activeAttemptId: null }
          );
        }
      }
      // leave_unresolved: no state change, no guard change.

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
  /**
   * Injected clock source for the §9.3 forced-freshness fence (review D9.1).
   * Production callers leave this undefined → `new Date()` at the top of the
   * claim; tests pin it so the fence's age comparison is deterministic. Use
   * this instead of `Date.now()` so a slow CI clock or real skew cannot let a
   * stale negative through the 5s window.
   */
  now?: Date;
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
  /**
   * T08/FR-036: guard row bound to this attempt's send claim. When non-null,
   * {@link finalizeSendOutcome} transitions the guard in the SAME transaction
   * (fenced by `phase="sending"`). Null = no guard (legacy data / pre-guard
   * claim) → the attempt/draft conditional UPDATEs remain the authority.
   */
  guardId?: number | null;
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
  | { readonly status: "fenced" }
  | {
      /**
       * R01: the canonical cluster carries reply evidence that makes this
       * generation ineligible to commit — a sibling (or the seed itself) is
       * already replied, delivery-unknown, in-flight on another draft, or in
       * a contradictory multi-draft state. Returned BEFORE any draft insert,
       * revision, message-status update, guard transition, or audit write —
       * the transaction performs NO write and the caller must release the
       * reservation and surface a typed refusal. Distinct from `fenced`
       * (owner/lease failure) so the caller can map to the right policy code
       * (`already_replied`/`delivery_unknown`/`reply_in_progress`/
       * `reply_state_conflict`) instead of a generic transport-error.
       */
      readonly status: "refused";
      readonly reason: ClusterEligibilityReason;
    };
