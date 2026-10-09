import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyDraftRevisionModule } from "@/modules/EmailReplyDraftRevisionModule";
import { EmailReplyApprovalModule } from "@/modules/EmailReplyApprovalModule";
import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { EmailReplyGuardModule } from "@/modules/EmailReplyGuardModule";
import { canonicalReplyKey } from "@/service/emailReceive/EmailReplyIdentity";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { EmailReplyAuditLogModule } from "@/modules/EmailReplyAuditLogModule";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import { ReplyEmailService } from "@/modules/lib/replyEmailService";
import { EmailReplyPolicyOrchestrator } from "@/service/emailReply/EmailReplyPolicyOrchestrator";
import {
  correlationIdForMessage,
  newRequestCorrelationId,
} from "@/service/emailReply/EmailReplyCorrelation";
import { classifySubmissionResult } from "@/service/emailReply/EmailSubmissionClassifier";
import {
  buildSendIdempotencyKey,
  hashApprovalToken,
  hashApprovalEnvelope,
  hashApprovalEnvelopeV2,
} from "@/service/emailReply/EmailReplyRevisionHasher";
import {
  SendBindingError,
  SendPolicyRejection,
  validateSendBinding,
} from "@/service/emailReply/EmailReplySendBinding";
import { buildOutboundHeaders } from "@/service/emailReply/EmailReplyHeaderBuilder";
import {
  EmailReplyDetectionService,
  getSharedEmailReplyDetectionService,
} from "@/service/emailReceive/EmailReplyDetectionService";
import {
  incrementReplyMetric,
  observeReplyDurationMs,
} from "@/service/emailReply/EmailReplyMetrics";
import {
  REPLY_POLICY_VERSION,
  REPLY_VALIDATOR_VERSION,
} from "@/service/emailReply/replyReliabilityVersions";
import type {
  EmailReplyApprovalEnvelope,
  EmailReplyApprovalEnvelopeV2,
  SendApprovedReplyInput,
  SendApprovedReplyOutcome,
  EmailReplyPolicyCode,
} from "@/entityTypes/emailReplyReliabilityTypes";
import type { EmailReplyStatus } from "@/entityTypes/emailReceiveTypes";
import type { EmailSendResult } from "@/entityTypes/emailmarketingType";
import { FRESHNESS_STALE } from "@/model/EmailReplyDraft.model";

/**
 * Sender interface the delivery service uses for the SMTP handoff. The default
 * factory builds a real {@link ReplyEmailService}; tests inject a fake to drive
 * the accepted / rejected / disconnect / post-SMTP-DB-failure scenarios.
 */
export interface ReplySender {
  sendReplyEmail(req: {
    receiver: string;
    subject: string;
    text: string;
    html?: string | null;
    inReplyTo?: string | null;
    references?: string | null;
  }): Promise<EmailSendResult>;
}

export type ReplySenderFactory = (service: {
  id?: number;
  from: string;
  password: string;
  host: string;
  port: string;
  name: string;
  ssl: number;
  /** SMTP login (§13.1). Null/undefined → resolver falls back to `from`. */
  smtpUsername?: string | null;
  /** Configured outgoing Reply-To (§13.2). Null/undefined = no Reply-To. */
  replyTo?: string | null;
}) => ReplySender;

/** Minimal mailbox shape the delivery service consumes (a subset of the entity). */
export interface BoundMailbox {
  id: number;
  from: string;
  status: number;
  password: string;
  host: string;
  port: string;
  name: string;
  ssl: number;
  /** Current effective SMTP username (§18.2). Null/undefined → falls back to `from`. */
  smtpUsername?: string | null;
  /** Current configured Reply-To (§18.2). Null/undefined = no Reply-To. */
  replyTo?: string | null;
}

/**
 * Idempotent approved-send orchestrator (technical design §15, FR-017/018/019,
 * NFR-001). SMTP is outside DB transactions (AD-007): the system commits a
 * `sending` claim + attempt + pre-submit audit BEFORE network submission, then
 * commits the outcome AFTER submission.
 *
 * Mailbox binding is enforced here in code: the outbound service is always the
 * draft's bound mailbox. There is NO `emailServiceId` override (FR-017).
 */
export class EmailReplyDeliveryService {
  private readonly draftModule = new EmailReplyDraftModule();
  private readonly revisionModule = new EmailReplyDraftRevisionModule();
  private readonly approvalModule = new EmailReplyApprovalModule();
  private readonly attemptModule = new EmailReplySendAttemptModule();
  private readonly guardModule = new EmailReplyGuardModule();
  private readonly messageModule = new EmailReceivedMessageModule();
  private readonly serviceModule = new EmailServiceModule();
  /**
   * D7.1: audit module resolved through an injectable factory (test seam).
   * Lazily memoized on first use, never at module top level.
   */
  private auditModule: EmailReplyAuditLogModule | null = null;
  private readonly auditModuleFactory: () => EmailReplyAuditLogModule;
  private readonly policy = new EmailReplyPolicyOrchestrator();
  private readonly senderFactory: ReplySenderFactory;
  private readonly serviceLoader: (id: number) => Promise<BoundMailbox | null>;
  private detectionService: EmailReplyDetectionService | null = null;
  private readonly detectionServiceFactory:
    | (() => EmailReplyDetectionService)
    | null;
  /**
   * D7.2: injectable clock for SMTP/attempt/audit timestamps (test seam).
   * Defaults to `Date.now`.
   */
  private readonly now: () => number;

  constructor(options?: {
    senderFactory?: ReplySenderFactory;
    serviceLoader?: (id: number) => Promise<BoundMailbox | null>;
    /**
     * T04 step 8 (§9.2): forced mailbox detection before the atomic send
     * claim. Production leaves this unset → the real default-ports detection
     * service is constructed lazily on first use. Tests inject a fake to
     * drive the replied/unknown/not_replied matrix.
     */
    readonly detectionServiceFactory?: () => EmailReplyDetectionService;
    /**
     * D7.1: injectable audit-module factory (test seam). Tests substitute an
     * in-memory stub to capture audit payloads or drive write failure without a
     * real DB. Production leaves it undefined → the real module is constructed
     * lazily on first use.
     */
    readonly auditModuleFactory?: () => EmailReplyAuditLogModule;
    /**
     * D7.2: injectable clock (test seam) for the persisted SMTP/attempt/audit
     * timestamps. Defaults to `Date.now`.
     */
    readonly now?: () => number;
  }) {
    this.senderFactory =
      options?.senderFactory ??
      ((svc) => new ReplyEmailService(svc) as unknown as ReplySender);
    this.serviceLoader =
      options?.serviceLoader ??
      ((id) =>
        this.serviceModule.getEmailService(id) as Promise<BoundMailbox | null>);
    this.detectionServiceFactory = options?.detectionServiceFactory ?? null;
    this.auditModuleFactory =
      options?.auditModuleFactory ?? (() => new EmailReplyAuditLogModule());
    this.now = options?.now ?? ((): number => Date.now());
  }

  /**
   * T04/FR-031 §9.2: the reply-detection service for THIS send invocation.
   * Lazily constructed (never at module top level — BaseModule TDZ under
   * vi.mock). Tests inject a custom service via the constructor seam.
   */
  private detectionServiceForNow(): EmailReplyDetectionService {
    if (!this.detectionService) {
      // D6: route the production fallback through the process-wide shared
      // singleton so the in-memory cache/single-flight/mailbox-lock state
      // survives across per-request outer-service instances. Injected test
      // factories keep precedence.
      this.detectionService = this.detectionServiceFactory
        ? this.detectionServiceFactory()
        : getSharedEmailReplyDetectionService();
    }
    return this.detectionService;
  }

  /**
   * D7.1: the audit module for THIS send invocation. Lazily constructed
   * through the injectable factory (never at module top level — BaseModule
   * TDZ under vi.mock). Tests substitute an in-memory stub.
   */
  private auditModuleForNow(): EmailReplyAuditLogModule {
    if (!this.auditModule) {
      this.auditModule = this.auditModuleFactory();
    }
    return this.auditModule;
  }

  /**
   * D7.2: the injectable clock for persisted timestamps (attempt submission,
   * sent-at). Wall-clock telemetry measurements (SMTP elapsed time) stay on
   * `Date.now()` directly — they measure real elapsed wall time, not a
   * logical timestamp a test should control.
   */
  private nowForInvocation(): number {
    return this.now();
  }

  async sendApprovedReply(
    input: SendApprovedReplyInput
  ): Promise<SendApprovedReplyOutcome> {
    // B11: allocate a fresh per-invocation request correlation id at the entry
    // boundary. Distinct across two invocations for the same message; all
    // audit events and the returned outcome for THIS invocation carry it.
    const requestCorrelationId = newRequestCorrelationId();
    // 1. Resolve the opaque one-time approval token to a trusted approval.
    const tokenHash = hashApprovalToken(input.approvalToken);
    const approval = await this.approvalModule.findActiveByTokenHash(tokenHash);
    if (!approval) {
      throw new Error(
        "Send rejected: approval token is invalid, expired, or already used"
      );
    }
    const draft = await this.draftModule.readAggregate(approval.draftId);
    if (!draft) {
      throw new Error("Send rejected: draft no longer exists");
    }
    const revision = await this.revisionModule.read(approval.revisionId);
    if (!revision) {
      throw new Error("Send rejected: approved revision no longer exists");
    }
    const message = await this.messageModule.read(draft.messageId);
    if (!message) {
      throw new Error("Send rejected: original message not found");
    }

    const emailServiceId = draft.emailServiceId ?? message.emailServiceId;
    const service = await this.serviceLoader(emailServiceId);
    if (!service) {
      // Stable code (P1.2) so the UI can distinguish a deleted/unreadable
      // service from other pre-send failures.
      throw new SendBindingError(
        "Send rejected: bound email service not found",
        "service_missing"
      );
    }

    // Recompute the envelope hash from trusted state. Version-aware (§18.1):
    // v2 revisions carry smtpUsername + replyToAddress bound into the hash;
    // v1 uses the legacy shape. The recomputed hash must match the revision's
    // materialized content hash (enforced by validateSendBinding).
    const revisionVersion: 1 | 2 = revision.envelopeVersion ?? 1;
    let recomputedHash: string;
    if (revisionVersion === 2) {
      // The v2 hash requires smtpUsername and replyToAddress from the revision
      // (frozen at materialization time). The service identity is compared
      // separately in validateSendBinding (§18.2 delivery-time check).
      const envelopeV2: EmailReplyApprovalEnvelopeV2 = {
        version: 2,
        draftId: draft.id,
        revisionId: revision.id,
        emailServiceId,
        originalMessageId: message.id,
        smtpUsername: revision.smtpUsername ?? "",
        senderAddress: revision.senderAddress,
        replyToAddress: revision.replyToAddress,
        recipientAddress: revision.recipientAddress,
        subject: revision.subject,
        bodyText: revision.bodyText,
        bodyHtml: revision.bodyHtml,
        policyVersion: REPLY_POLICY_VERSION,
        validationVersion: REPLY_VALIDATOR_VERSION,
      };
      recomputedHash = hashApprovalEnvelopeV2(envelopeV2);
    } else {
      const envelope: EmailReplyApprovalEnvelope = {
        draftId: draft.id,
        revisionId: revision.id,
        emailServiceId,
        originalMessageId: message.id,
        senderAddress: revision.senderAddress,
        recipientAddress: revision.recipientAddress,
        subject: revision.subject,
        bodyText: revision.bodyText,
        bodyHtml: revision.bodyHtml,
        policyVersion: REPLY_POLICY_VERSION,
        validationVersion: REPLY_VALIDATOR_VERSION,
      };
      recomputedHash = hashApprovalEnvelope(envelope);
    }

    // 2. Mailbox + envelope binding (FR-017, P0.2). Pure validation; throws
    //    SendBindingError before the atomic claim so no SMTP submission can
    //    occur on any mismatch (wrong mailbox / sender / recipient / draft).
    //    §18.2/§18.3: identity comparison (v2) or legacy gate (v1) runs here too.
    validateSendBinding({
      requestedDraftId: input.draftId,
      approval: {
        draftId: approval.draftId,
        revisionId: approval.revisionId,
        approvedHash: approval.approvedHash,
      },
      draft: {
        id: draft.id,
        currentRevisionId: draft.currentRevisionId,
        contentHash: draft.contentHash,
        emailServiceId: draft.emailServiceId,
      },
      revision: {
        id: revision.id,
        senderAddress: revision.senderAddress,
        recipientAddress: revision.recipientAddress,
        contentHash: revision.contentHash,
        envelopeVersion: revisionVersion,
        smtpUsername: revision.smtpUsername,
        replyToAddress: revision.replyToAddress,
      },
      message: {
        id: message.id,
        emailServiceId: message.emailServiceId,
        fromAddress: message.fromAddress,
        replyToAddress: message.replyToAddress,
      },
      service: {
        id: service.id,
        from: service.from,
        status: service.status,
        smtpUsername: service.smtpUsername,
        replyTo: service.replyTo,
      },
      recomputedHash,
    });

    // 4. Idempotency replay check (B04): recognize an exact replay of THIS
    //    approved attempt BEFORE the send-time policy guard. Once the first
    //    invocation has claimed an attempt for this (draft, revision, hash,
    //    approval) tuple, a second invocation with the same approval must
    //    return the prior attempt's idempotent `already_processed` outcome —
    //    NOT a generic `reply_in_progress` refusal from the guard (which sees
    //    the in-flight attempt and refuses). This is safe because the
    //    idempotency key is bound to the exact approval+revision+hash; a
    //    DIFFERENT attempt or sibling draft still falls through to the guard
    //    and is refused there.
    const idempotencyKey = buildSendIdempotencyKey(
      draft.id,
      revision.id,
      recomputedHash,
      approval.id
    );
    const existing = await this.attemptModule.findByIdempotencyKey(
      idempotencyKey
    );
    if (existing) {
      return {
        status: "already_processed",
        attemptId: existing.id,
        requestCorrelationId,
      };
    }

    // 5. Send-time policy (reloaded, never cached). FR-006. Runs only when this
    //    exact approval has not already been claimed — so a genuine sibling or
    //    other-attempt send is still refused here before SMTP.
    const decision = await this.policy.evaluate({
      stage: "pre_send",
      messageId: message.id,
      draftId: draft.id,
      revisionId: revision.id,
    });
    incrementReplyMetric("policy_decision", {
      stage: "pre_send",
      code: decision.code,
      allowed: decision.allowed,
    });
    if (!decision.allowed) {
      // FR-034 (Phase-1 slice): exactly ONE reply_skipped audit per actionable
      // pre_send refusal, written here (the outer service) with stage + code +
      // bounded evidence — no bodies, no credentials, no raw model output. The
      // policy layer returns decisions; it never writes audit rows. Audit
      // persistence failure STOPS the work: an unrecorded refusal must never
      // be followed by proceeding to send.
      await this.writeRefusalAudit(
        message,
        draft.id,
        requestCorrelationId,
        decision
      );
      // Surface the stable policy code (FR-033) so the AI tool / IPC envelope
      // can carry a machine-readable reason instead of parsing English. This
      // refusal happens BEFORE the atomic claim, so no SMTP side effect.
      throw new SendPolicyRejection(
        `Send rejected by policy: ${decision.reason}`,
        decision.code
      );
    }

    // 5b. T04 step 8 (FR-031 §9.2): forced mailbox detection with `forceRefresh:
    //     true` so delivery NEVER trusts the 60s negative cache. A positive or
    //     inconclusive reply state refuses the send with the typed detection
    //     code BEFORE the atomic claim — no SMTP side effect. The ONE
    //     `reply_skipped` audit (stage `pre_send`) is written here (one-audit-
    //     owner rule §9.2/§10); the detection service returns decisions only.
    //     `not_replied` proceeds to claim; the fresh observation timestamp
    //     (`replyNegativeCheckAt`) is now ≤seconds old — the 5s forced-freshness
    //     window (T05 step 11) enforces it inside the claim.
    await this.runPreSendDetection(message, draft.id, requestCorrelationId);

    // 6. Atomic claim: draft approved -> sending, insert attempt, write pre-submit
    //    audit. SMTP is never contacted if this returns non-claimed.
    //    T08/FR-036: the claim transaction also runs the canonical-cluster
    //    sibling check and binds the guard row to `phase="sending"` — resolve
    //    the guard row for the draft's replyKey first (null when the guard
    //    table has no row, e.g. legacy data; binding is then skipped and the
    //    claim's conditional draft UPDATE remains the authority).
    //
    //    T05 step 11 (FR-031 §9.3): the claim's first action is the forced-
    //    freshness fence — if the pre-send observation (step 5b) is older than
    //    FORCED_FRESHNESS_WINDOW_MS by the time the transaction opens, it
    //    returns `freshness_stale` with NO write. The delivery service then
    //    reruns detection OUTSIDE the transaction and re-claims ONCE. §9.3:
    //    "Allow one delayed refresh; further delay refuses with no SMTP
    //    submission." A second `freshness_stale` → SendPolicyRejection (no SMTP).
    //    The refresh recognizes only THIS invocation's exact attempt as the
    //    current owner — the internal ownership handle is the approval.id /
    //    idempotencyKey being claimed, never a tool/IPC parameter.
    const guardRow = await this.guardModule.findByReplyKey(
      emailServiceId,
      canonicalReplyKey({
        normalizedMessageId: message.normalizedMessageId,
        rowId: message.id,
      })
    );
    const claimInput = {
      draftId: draft.id,
      revisionId: revision.id,
      approvedHash: recomputedHash,
      idempotencyKey,
      approvalId: approval.id,
      messageId: message.id,
      conversationId: draft.conversationId ?? null,
      emailServiceId,
      senderAddress: revision.senderAddress,
      recipientAddress: revision.recipientAddress,
      policyVersion: REPLY_POLICY_VERSION,
      guardId: guardRow?.id ?? null,
    };
    let claim = await this.draftModule.claimApprovedRevisionForSend(claimInput);

    // §9.3: one delayed refresh. The fence wrote nothing, so re-claiming with
    // the same idempotency key is safe. The rerun is OUTSIDE the transaction
    // (retains nothing) and forceRefresh: true (never the 60s negative cache).
    // D7.3: compare against the exported constant, not the bare literal — a
    // typo in either site would silently break the §9.3 retry path.
    if (
      claim.status === "precondition_failed" &&
      claim.reason === FRESHNESS_STALE
    ) {
      incrementReplyMetric("send_claim", {
        outcome: "freshness_stale_retry",
      });
      // Re-run the forced pre-send detection. runPreSendDetection throws
      // SendPolicyRejection on replied/unknown — which is the correct §9.3
      // behavior: if the refresh finds a reply, the send is refused with the
      // detection code and ONE reply_skipped audit (written by
      // runPreSendDetection). No SMTP, no second claim.
      await this.runPreSendDetection(message, draft.id, requestCorrelationId);
      claim = await this.draftModule.claimApprovedRevisionForSend(claimInput);
      if (
        claim.status === "precondition_failed" &&
        claim.reason === FRESHNESS_STALE
      ) {
        // Second stale → the mailbox is too slow to keep up; refuse with no
        // SMTP. The code is detection-unknown (`probe_timeout` conveys "the
        // probe could not settle within the window"); one reply_skipped audit.
        const code: EmailReplyPolicyCode = "probe_timeout";
        incrementReplyMetric("send_claim", {
          outcome: "freshness_stale_refused",
        });
        incrementReplyMetric("detection_outcome", {
          stage: "pre_send",
          state: "unknown",
          code,
        });
        try {
          await this.writeDetectionRefusalAudit(
            message,
            draft.id,
            requestCorrelationId,
            code,
            "Forced-freshness window exceeded twice; reply state could not be settled (§9.3)"
          );
        } catch (auditError) {
          incrementReplyMetric("audit_failure", { stage: "pre_send" });
          const auditErrMsg =
            auditError instanceof Error ? auditError.message : String(auditError);
          throw new SendPolicyRejection(
            `Send rejected: detection audit persistence failed: ${auditErrMsg}`,
            code
          );
        }
        throw new SendPolicyRejection(
          `Send rejected by reply detection: [${code}] Forced-freshness window exceeded twice (§9.3)`,
          code
        );
      }
    }

    if (claim.status === "already_processed") {
      incrementReplyMetric("send_claim", { outcome: "already_processed" });
      return {
        status: "already_processed",
        attemptId: claim.attempt.id,
        requestCorrelationId,
      };
    }
    if (claim.status === "precondition_failed") {
      incrementReplyMetric("send_claim", { outcome: "precondition_failed" });
      throw new Error(`Send rejected: ${claim.reason}`);
    }
    const attemptId = claim.attemptId;
    incrementReplyMetric("send_claim", { outcome: "claimed" });

    // 7. Mark the attempt `submitted` at the SMTP handoff boundary (P0.6) so a
    //    crash here is recoverable to delivery_unknown rather than left claimed.
    await this.attemptModule.markSubmitted(attemptId, new Date(this.nowForInvocation()));

    // 8. SMTP submission. classifySubmissionResult turns the raw result into a
    //    certainty; unknown outcomes become delivery_unknown (never retried).
    // Forward the full identity so the SMTP session authenticates with the
    // configured SMTP username (not `from`) and the reply carries the
    // configured Reply-To header (§13.1/§13.2). Omitting these would make the
    // resolver fall back to `from` for auth and drop the Reply-To header.
    const sender = this.senderFactory({
      id: service.id,
      from: service.from,
      password: service.password,
      host: service.host,
      port: service.port,
      name: service.name,
      ssl: service.ssl,
      smtpUsername: service.smtpUsername,
      replyTo: service.replyTo,
    });

    let certainty: "accepted" | "definitely_rejected" | "unknown";
    let providerMessageId: string | null = null;
    let sanitizedError: string | null = null;
    try {
      // Thread-correct, validated headers (FR-022): normalized parent id,
      // deduped References chain, single Re: prefix. Malformed values are
      // omitted; a bad recipient blocks the send before SMTP.
      const headers = buildOutboundHeaders({
        subject: revision.subject,
        recipientAddress: revision.recipientAddress,
        parentMessageId: message.messageId,
        parentReferences: message.referencesHeader,
      });
      const raw = await sender.sendReplyEmail({
        receiver: headers.recipientAddress,
        subject: headers.subject,
        text: revision.bodyText,
        html: revision.bodyHtml,
        inReplyTo: headers.thread.inReplyTo,
        references: headers.thread.references.join(" "),
      });
      const classified = classifySubmissionResult(raw);
      certainty = classified.certainty;
      providerMessageId = classified.providerMessageId;
      sanitizedError = classified.sanitizedError;
    } catch (error) {
      // An unexpected throw (not a resolved failure) is ambiguous after
      // submission may have begun → delivery_unknown.
      certainty = "unknown";
      sanitizedError = error instanceof Error ? error.message : String(error);
    }

    const smtpStart = Date.now();
    const outcome = certaintyToOutcome(certainty);
    observeReplyDurationMs("smtp", Date.now() - smtpStart, { outcome });
    incrementReplyMetric("send_outcome", { outcome });
    // Finalize attempt + draft + approval + audit + received-message status in
    // ONE transaction (P0.6). delivery_unknown leaves the message status as-is.
    const messageReplyStatus: EmailReplyStatus | undefined =
      outcome === "sent" ? "sent" : outcome === "failed" ? "failed" : undefined;
    await this.draftModule.finalizeSendOutcome({
      attemptId,
      draftId: draft.id,
      approvalId: approval.id,
      emailServiceId,
      messageId: message.id,
      outcome,
      providerMessageId,
      failureCode: certainty === "accepted" ? null : certainty,
      sanitizedError,
      messageReplyStatus,
      // T08: the guard row resolved before the claim (step 6) — pass its id
      // so finalize transitions the guard in the same transaction as the
      // attempt/draft/approval/audit. Null when no guard row exists (legacy
      // data); finalize then skips the guard transition.
      guardId: guardRow?.id ?? null,
    });

    if (outcome === "sent") {
      return {
        status: "sent",
        attemptId,
        // D7.2: injectable clock for the persisted sentAt timestamp.
        sentAt: new Date(this.nowForInvocation()).toISOString(),
        requestCorrelationId,
      };
    }
    return {
      status: outcome,
      attemptId,
      error: sanitizedError ?? outcome,
      requestCorrelationId,
    };
  }

  /**
   * Write the ONE reply_skipped audit row for a pre_send policy refusal
   * (FR-034, Phase-1 slice). Called by the outer delivery service before the
   * SendPolicyRejection is thrown; the policy orchestrator itself never writes
   * audit rows (AD-006). Evidence is bounded: stage + code + policy version +
   * correlation id — no bodies, no credentials, no raw model output, no raw
   * error text.
   *
   * Intentionally NOT caught: audit persistence failure STOPS the work. An
   * unrecorded send refusal must never be followed by proceeding to send —
   * the caller surfaces the persistence failure instead.
   */
  private async writeRefusalAudit(
    message: { id: number; emailServiceId: number },
    draftId: number,
    requestCorrelationId: string,
    decision: {
      readonly code: EmailReplyPolicyCode;
      readonly reason: string;
      readonly policyVersion: string;
    }
  ): Promise<void> {
    await this.auditModuleForNow().ensureConnection();
    const log = new EmailReplyAuditLogEntity();
    log.emailServiceId = message.emailServiceId;
    log.messageId = message.id;
    log.draftId = draftId;
    log.action = "reply_skipped";
    log.actor = "system";
    log.reason = `[${decision.code}] ${decision.reason}`;
    log.metadataJson = JSON.stringify({
      correlationId: requestCorrelationId,
      messageCorrelationId: correlationIdForMessage(message.id),
      stage: "pre_send",
      code: decision.code,
      policyVersion: decision.policyVersion,
    });
    await this.auditModuleForNow().create(log);
  }

  /**
   * T04 step 8 (FR-031 §9.2): forced mailbox detection before the atomic send
   * claim. `forceRefresh: true` skips the 60s negative cache (§7.3 — delivery
   * never trusts a cached pre-invocation negative; sticky positives are still
   * honored). `replied`/`unknown` → ONE `reply_skipped` audit (stage
   * `pre_send`, code = already_replied or the typed detection unknown code)
   * then throws {@link SendPolicyRejection} carrying the detection code so the
   * B12 IPC envelope surfaces it machine-readably. NO SMTP, NO claim.
   * `not_replied` → returns (proceeds to claim).
   *
   * The detection service owns evidence/cache writes; this outer service owns
   * the refusal audit (one-audit-owner rule §9.2/§10). Audit persistence
   * failure STOPS the work — an unrecorded send refusal must never be followed
   * by proceeding to send.
   *
   * FR-039: telemetry carries only the low-cardinality detection state/code —
   * never bodies, raw provider errors, or credentials.
   */
  private async runPreSendDetection(
    message: { id: number; emailServiceId: number },
    draftId: number,
    requestCorrelationId: string
  ): Promise<void> {
    let result: import("@/service/emailReceive/EmailReplyDetectionTypes").ReplyDetectionResult;
    try {
      result = await this.detectionServiceForNow().detect({
        messageId: message.id,
        forceRefresh: true,
      });
    } catch (error) {
      // Detection threw — treat as an inconclusive probe failure. The stable
      // code `probe_failed` routes to discard_and_retry; the sanitized error
      // text is included for the operator/AI without parsing English.
      const errMsg = error instanceof Error ? error.message : String(error);
      const code: EmailReplyPolicyCode = "probe_failed";
      incrementReplyMetric("detection_outcome", {
        stage: "pre_send",
        state: "unknown",
        code,
      });
      try {
        await this.writeDetectionRefusalAudit(
          message,
          draftId,
          requestCorrelationId,
          code,
          `Detection probe threw: ${errMsg}`
        );
      } catch (auditError) {
        incrementReplyMetric("audit_failure", { stage: "pre_send" });
        const auditErrMsg =
          auditError instanceof Error ? auditError.message : String(auditError);
        throw new SendPolicyRejection(
          `Send rejected: detection audit persistence failed: ${auditErrMsg}`,
          code
        );
      }
      throw new SendPolicyRejection(
        `Send rejected by reply detection: [${code}] Detection probe failed: ${errMsg}`,
        code
      );
    }

    if (result.state === "not_replied") {
      incrementReplyMetric("detection_outcome", {
        stage: "pre_send",
        state: "not_replied",
        code: "no_reply_observed",
      });
      return; // proceed to the atomic claim
    }

    // replied OR unknown → hard refusal. Map the detection outcome to the
    // EmailReplyPolicyCode: replied → already_replied; unknown → the typed
    // unknown code (probe_timeout / probe_failed / etc.).
    const code: EmailReplyPolicyCode =
      result.state === "replied" ? "already_replied" : result.reasonCode;
    incrementReplyMetric("detection_outcome", {
      stage: "pre_send",
      state: result.state,
      code,
    });
    const reason =
      result.state === "replied"
        ? "Reply detection found an existing reply before send"
        : "Reply detection was inconclusive before send";
    try {
      await this.writeDetectionRefusalAudit(
        message,
        draftId,
        requestCorrelationId,
        code,
        reason
      );
    } catch (auditError) {
      incrementReplyMetric("audit_failure", { stage: "pre_send" });
      const auditErrMsg =
        auditError instanceof Error ? auditError.message : String(auditError);
      throw new SendPolicyRejection(
        `Send rejected: detection audit persistence failed: ${auditErrMsg}`,
        code
      );
    }
    throw new SendPolicyRejection(
      `Send rejected by reply detection: [${code}] ${reason}`,
      code
    );
  }

  /**
   * Write the ONE `reply_skipped` audit row for a pre-send detection refusal.
   * Stage `pre_send`, code = the detection outcome code. Bounded evidence —
   * no bodies, no credentials, no raw provider errors.
   *
   * Intentionally NOT caught: audit persistence failure STOPS the work (§9.2 —
   * an unrecorded send refusal must never be followed by proceeding to send).
   */
  private async writeDetectionRefusalAudit(
    message: { id: number; emailServiceId: number },
    draftId: number,
    requestCorrelationId: string,
    code: EmailReplyPolicyCode,
    reason: string
  ): Promise<void> {
    await this.auditModuleForNow().ensureConnection();
    const log = new EmailReplyAuditLogEntity();
    log.emailServiceId = message.emailServiceId;
    log.messageId = message.id;
    log.draftId = draftId;
    log.action = "reply_skipped";
    log.actor = "system";
    log.reason = `[${code}] ${reason}`;
    log.metadataJson = JSON.stringify({
      correlationId: requestCorrelationId,
      messageCorrelationId: correlationIdForMessage(message.id),
      stage: "pre_send",
      code,
      source: "reply_detection",
    });
    await this.auditModuleForNow().create(log);
  }
}

function certaintyToOutcome(
  certainty: "accepted" | "definitely_rejected" | "unknown"
): "sent" | "failed" | "delivery_unknown" {
  if (certainty === "accepted") return "sent";
  if (certainty === "definitely_rejected") return "failed";
  return "delivery_unknown";
}
