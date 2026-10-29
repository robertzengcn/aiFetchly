import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyDraftRevisionModule } from "@/modules/EmailReplyDraftRevisionModule";
import { EmailReplyApprovalModule } from "@/modules/EmailReplyApprovalModule";
import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { EmailReplyGuardModule } from "@/modules/EmailReplyGuardModule";
import {
  canonicalReplyKey,
  isNegativeObservationUsable,
} from "@/service/emailReceive/EmailReplyIdentity";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailServiceModule } from "@/modules/emailServiceModule";
import { EmailReplyAuditLogModule } from "@/modules/EmailReplyAuditLogModule";
import { EmailReplyAuditLogEntity } from "@/entity/EmailReplyAuditLog.entity";
import { EmailAutoReplyAuditLogModule } from "@/modules/EmailAutoReplyAuditLogModule";
import { buildAutoReplyAuditMirrorRow } from "@/service/emailReply/EmailReplyAuditMirror";
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
  sanitizeDetectionError,
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
import type { ReplyDetectionUnknownCode } from "@/service/emailReceive/EmailReplyDetectionTypes";
import type { EmailSendResult } from "@/entityTypes/emailmarketingType";
import {
  FRESHNESS_STALE,
  FORCED_FRESHNESS_WINDOW_MS,
} from "@/model/EmailReplyDraft.model";
import {
  markSubmitterRunning,
  markSubmitterSettled,
} from "@/service/emailReply/EmailReplySubmitterTracker";

/**
 * N04/C01: input shape for the pure final-admission verdict. Structurally
 * the snapshot rows (entities satisfy it); tests construct torn snapshots
 * literally to pin verdict logic without a database.
 */
export interface FinalSendAdmissionSnapshot {
  readonly attempt: {
    readonly status: string;
  } | null;
  readonly seedMessage: {
    readonly id: number;
    readonly replyDetectedAt: Date | null;
    readonly replyStatus: string | null;
    readonly replyNegativeCheckAt: Date | null;
    readonly replyNegativeContextHash: string | null;
    readonly replyNegativeOwnerExpiresAt: Date | null;
  } | null;
  readonly clusterRows: ReadonlyArray<{
    readonly id: number;
    readonly replyDetectedAt: Date | null;
    readonly replyStatus: string | null;
  }> | null;
}

export type FinalSendAdmissionVerdict =
  | { readonly kind: "admit" }
  | {
      readonly kind: "refuse";
      readonly code: EmailReplyPolicyCode;
      readonly reason: string;
    }
  | { readonly kind: "stale" };

/**
 * N04/C01: PURE coherent admission verdict over one snapshot (no DB, no
 * I/O — unit-testable). Refuses on ANY positive evidence anywhere in the
 * snapshot, including a newer positive copy of the seed row itself: the
 * old code skipped `row.id === seed.id` cluster rows, so a positive that
 * landed between the snapshot's own statements (torn snapshot) was
 * ignored and the stale seed admitted SMTP. The shared reply mutex now
 * serializes evidence writers with snapshot readers, but the evaluator
 * does not trust snapshot coherence for positives — every row is
 * inspected. Freshness/age is enforced synchronously by the caller after
 * this returns (pass `nowMs`, default wall clock).
 */
export function evaluateFinalSendAdmission(
  snapshot: FinalSendAdmissionSnapshot,
  stage: "gate" | "fence",
  nowMs: number = Date.now()
): FinalSendAdmissionVerdict {
  const where = stage === "gate" ? "Post-claim gate" : "Handoff fence";
  const attempt = snapshot.attempt;
  if (
    !attempt ||
    (attempt.status !== "claimed" && attempt.status !== "submitted")
  ) {
    const code: EmailReplyPolicyCode =
      attempt?.status === "sent"
        ? "already_replied"
        : attempt?.status === "delivery_unknown"
          ? "delivery_unknown"
          : attempt?.status === "failed"
            ? "reply_state_conflict"
            : "reply_state_unknown";
    const reason =
      attempt == null
        ? `Send claim lost before SMTP (${where}): attempt no longer exists`
        : `Send claim lost before SMTP (${where}): attempt is ${attempt.status} (recovered/reconciled while this operation was paused)`;
    return { kind: "refuse", code, reason };
  }
  const seed = snapshot.seedMessage;
  if (!seed) {
    return {
      kind: "refuse",
      code: "probe_failed",
      reason: `${where}: original message not found before SMTP`,
    };
  }
  if (seed.replyDetectedAt != null || seed.replyStatus === "sent") {
    return {
      kind: "refuse",
      code: "already_replied",
      reason: `${where} found positive reply evidence on the message before SMTP`,
    };
  }
  const clusterRows = snapshot.clusterRows;
  if (clusterRows !== null) {
    for (const row of clusterRows) {
      if (row.replyDetectedAt == null && row.replyStatus !== "sent") continue;
      // C01: NO seed-id skip. The cluster copy of the seed may be NEWER
      // than the seed snapshot (a positive committed between the
      // snapshot's own statements); discarding it admits SMTP on known
      // positive evidence. Same-id positives report as the message (they
      // ARE the seed message); others report as equivalents.
      const onSeed = row.id === seed.id;
      return {
        kind: "refuse",
        code: "already_replied",
        reason: onSeed
          ? `${where} found positive reply evidence on the message before SMTP`
          : `${where} found positive reply evidence on an equivalent message before SMTP`,
      };
    }
  }
  if (
    clusterRows !== null &&
    seed.replyNegativeCheckAt != null &&
    isNegativeObservationUsable({
      replyNegativeCheckAt: seed.replyNegativeCheckAt,
      replyNegativeContextHash: seed.replyNegativeContextHash,
      replyNegativeOwnerExpiresAt: seed.replyNegativeOwnerExpiresAt,
    }) &&
    nowMs - seed.replyNegativeCheckAt.getTime() <= FORCED_FRESHNESS_WINDOW_MS
  ) {
    return { kind: "admit" };
  }
  return { kind: "stale" };
}

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
 * R14: TTL expiry for a token-resolved approval record. Mirrors the expiry
 * rule in `EmailReplyApprovalModel.findActiveByTokenHash`; kept local because
 * the delivery path now resolves the record consumed-inclusively and gates
 * new work itself.
 */
function isApprovalExpired(approval: { expiresAt: Date | null }): boolean {
  return (
    approval.expiresAt !== null && approval.expiresAt.getTime() < Date.now()
  );
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
/**
 * Probe-execution unknown codes that MAY proceed as an ASSISTED send (spec
 * 2026-10-29-email-send-inconclusive-detection-assisted-design.md): these
 * codes mean "the mailbox evidence could not be obtained", not "a reply
 * exists" or "evidence is ambiguous". By the time the pre-send gate runs,
 * both local duplicate-protection layers have already asserted a clean
 * ledger (the pre-send policy guard evaluates the canonical cluster, and
 * detection's own local-first step re-verifies it), so alongside an explicit
 * human send confirmation the local-ledger negative is sufficient. Positive
 * (`replied`) and assertion-bearing unknowns (ambiguous_match,
 * identity_conflict, reply_in_progress, delivery_unknown) and config-gate
 * unknowns (unsupported_protocol, receive_unavailable, missing_message_id)
 * are NEVER on this list.
 */
const ASSISTED_INCONCLUSIVE_CODES: ReadonlySet<ReplyDetectionUnknownCode> =
  new Set([
    "probe_failed",
    "probe_timeout",
    "probe_limit_exceeded",
    "sent_folder_unavailable",
  ]);

/**
 * Assisted-inconclusive marker threaded through the send machinery (claim +
 * gate + fence). Null = the probe completed a full negative (normal path).
 */
export interface AssistedInconclusiveProbe {
  readonly reasonCode: ReplyDetectionUnknownCode;
  readonly checkedAt: string;
}

/** Assisted-inconclusive marker threaded through the send machinery (claim + gate + fence). */
export interface AssistedInconclusiveProbe {
  readonly reasonCode: ReplyDetectionUnknownCode;
  readonly checkedAt: string;
}

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
  /**
   * G03-1c: mirror-side audit module (the auto-reply audit table the UI
   * reads). Same lazy injectable-factory pattern as `auditModule` above.
   */
  private autoAuditModule: EmailAutoReplyAuditLogModule | null = null;
  private readonly autoAuditModuleFactory: () => EmailAutoReplyAuditLogModule;
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
     * G03-1c: injectable factory for the mirror-side (auto-reply audit) module.
     * Tests substitute an in-memory stub to capture mirror rows or drive write
     * failure. Production leaves it undefined → the real module is constructed
     * lazily on first use.
     */
    readonly autoAuditModuleFactory?: () => EmailAutoReplyAuditLogModule;
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
    this.autoAuditModuleFactory =
      options?.autoAuditModuleFactory ?? (() => new EmailAutoReplyAuditLogModule());
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
   * G03-1c: the mirror-side audit module for THIS send invocation. Lazily
   * constructed through the injectable factory (never at module top level —
   * BaseModule TDZ under vi.mock). Tests substitute an in-memory stub.
   */
  private autoAuditModuleForNow(): EmailAutoReplyAuditLogModule {
    if (!this.autoAuditModule) {
      this.autoAuditModule = this.autoAuditModuleFactory();
    }
    return this.autoAuditModule;
  }

  /**
   * G03-1c: mirror a decision-relevant reply-audit row into the auto-reply
   * audit table the UI reads. Same fail-stop contract as the primary write:
   * persistence failure surfaces to the caller rather than being swallowed.
   */
  private async mirrorToAutoReplyAudit(log: EmailReplyAuditLogEntity): Promise<void> {
    const mirrorRow = buildAutoReplyAuditMirrorRow({
      emailServiceId: log.emailServiceId,
      messageId: log.messageId,
      draftId: log.draftId,
      action: log.action,
      reason: log.reason,
      metadataJson: log.metadataJson,
    });
    if (mirrorRow === null) {
      return;
    }
    await this.autoAuditModuleForNow().create(mirrorRow);
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
    // N08: shared readiness/disable check at the authoritative new-send
    // boundary — BEFORE any approval/draft/message work. While validation is
    // pending/failed or the kill switch is on, refuse new sends. Audit reads
    // and delivery reconciliation never enter here and stay available.
    {
      const { checkNewGuardedWorkReady } = await import(
        "@/service/emailReply/EmailReplyReadiness"
      );
      const readiness = checkNewGuardedWorkReady();
      if (!readiness.ready) {
        throw new SendPolicyRejection(
          `Send rejected: ${readiness.reason}`,
          "probe_failed",
          requestCorrelationId
        );
      }
    }
    // 1. Resolve the opaque one-time approval token to a trusted approval
    //    record — consumed-inclusive (R14). `finalizeSendOutcome` consumes the
    //    approval (sets invalidatedAt) for EVERY terminal outcome, so a replay
    //    of a finalized sent/delivery_unknown attempt must still resolve the
    //    record to reach the B04 idempotency lookup below; the active-only
    //    filter would refuse before it. A record that resolves proves the
    //    token existed — it does NOT authorize new work: the active/expiry
    //    gate runs AFTER the idempotency replay check (consumed token + exact
    //    existing attempt → already_processed; consumed/expired token without
    //    an exact attempt → the same unauthorized refusal as before).
    const tokenHash = hashApprovalToken(input.approvalToken);
    const approval = await this.approvalModule.findByTokenHash(tokenHash);
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
        "service_missing",
        requestCorrelationId
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
    //    §18.2: a v2 revision also compares its frozen SMTP username and Reply-To.
    //    R20: validateSendBinding is pure (no invocation context), so a thrown
    //    SendBindingError carries no correlation id. Re-throw with the id
    //    attached (new object — immutable) so the tool/IPC envelope can join
    //    the binding failure to the lifecycle audits under this invocation.
    try {
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
    } catch (bindingError) {
      if (bindingError instanceof SendBindingError) {
        throw new SendBindingError(
          bindingError.message,
          bindingError.code,
          requestCorrelationId
        );
      }
      throw bindingError;
    }

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

    // R14 active/expiry gate — AFTER the idempotency replay check. The token
    // record resolved at step 1 may be consumed (finalize) or invalidated (an
    // edit) or expired; that is only acceptable when the lookup above already
    // recognized the exact existing attempt. Reaching here with a non-active
    // token means NEW work was requested under a spent/expired/invalidated
    // token: refuse exactly as before. (An invalidated-but-unconsumed token
    // also fails the binding checks above when the draft moved on — this gate
    // keeps the standalone unauthorized error for the no-attempt case.)
    if (approval.invalidatedAt || isApprovalExpired(approval)) {
      throw new Error(
        "Send rejected: approval token is invalid, expired, or already used"
      );
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
        decision.code,
        requestCorrelationId
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
    // §9.2 forced mailbox detection. Null = complete negative. An ASSISTED
    // inconclusive marker (probe-execution unknowns on a human-confirmed
    // send) proceeds and threads through the claim + gate + fence below.
    const assistedProbe = await this.runPreSendDetection(
      message,
      draft.id,
      requestCorrelationId
    );

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
      // Assisted inconclusive send: the claim's §9.3 freshness precondition
      // is replaced by the local-ledger negative + this marker (the
      // transactional sibling check and positive refusals are unchanged).
      assistedProbe,
      // R20: thread this invocation's id so the send_claimed audit joins the
      // claim to the returned result / refusal under the same correlation.
      requestCorrelationId,
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
      // Re-run the forced pre-send detection. runPreSendDetection returns the
      // assisted marker on inconclusive probe-execution outcomes and throws
      // SendPolicyRejection on replied/ambiguous otherwise — which is the
      // correct §9.3 behavior: if the refresh finds a reply, the send is
      // refused with the detection code and ONE reply_skipped audit (written
      // by runPreSendDetection). No SMTP, no second claim. Thread the marker
      // into the re-claim so an inconclusive rerun proceeds the same way.
      const assistedProbeRetry =
        await this.runPreSendDetection(message, draft.id, requestCorrelationId);
      claim = await this.draftModule.claimApprovedRevisionForSend({
        ...claimInput,
        assistedProbe: assistedProbeRetry,
      });
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
          const auditErrMsg = sanitizeDetectionError(auditError);
          throw new SendPolicyRejection(
            `Send rejected: detection audit persistence failed: ${auditErrMsg}`,
            code,
            requestCorrelationId
          );
        }
        throw new SendPolicyRejection(
          `Send rejected by reply detection: [${code}] Forced-freshness window exceeded twice (§9.3)`,
          code,
          requestCorrelationId
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
      // N07: typed transaction refusal — use the stable `code` directly
      // (never infer from English `reason`), compose ONE correlated
      // service-owned refusal audit, and throw a typed IPC/tool envelope.
      // Exact-attempt idempotent replay (`already_processed`) stays separate
      // above and never lands here.
      incrementReplyMetric("send_claim", { outcome: "precondition_failed" });
      const typedCode = claim.code;
      try {
        await this.writeDetectionRefusalAudit(
          message,
          draft.id,
          requestCorrelationId,
          typedCode,
          `Send claim refused in transaction: ${claim.reason}`
        );
      } catch (auditError) {
        incrementReplyMetric("audit_failure", { stage: "pre_send" });
        const auditErrMsg = sanitizeDetectionError(auditError);
        throw new SendPolicyRejection(
          `Send rejected: claim refusal audit persistence failed: ${auditErrMsg}`,
          typedCode,
          requestCorrelationId
        );
      }
      throw new SendPolicyRejection(
        `Send rejected by send claim: [${typedCode}] ${claim.reason}`,
        typedCode,
        requestCorrelationId
      );
    }
    const attemptId = claim.attemptId;
    incrementReplyMetric("send_claim", { outcome: "claimed" });

    // F02/N02: track the ENTIRE successful-claim-to-finalization operation,
    // not just the SMTP promise. A pause anywhere after the claim
    // (markSubmitted, the post-claim gate, the handoff fence) is still this
    // operation alive: recovery must see it running, and negative
    // reconciliation must refuse until the encompassing finally below settles
    // it. A crash clears the in-memory mark (restart = quiescence).
    markSubmitterRunning(attemptId);
    try {
      return await this.runClaimedSendToFinalization({
        message,
        draft,
        revision,
        approval,
        emailServiceId,
        service,
        guardRow,
        attemptId,
        requestCorrelationId,
        assistedProbe,
      });
    } finally {
      // EncompassingSettlement (F02): gate refusals (which finalize + throw),
      // fence refusals, SMTP outcomes and unexpected throws all settle here —
      // a live mark must never outlive its operation and block a later
      // legitimate reconciliation forever.
      markSubmitterSettled(attemptId);
    }
  }

  /**
   * Steps 7–8 of the claimed send: markSubmitted, the post-claim freshness
   * gate, the final ownership fence (F02), SMTP submission and outcome
   * finalization. Runs under the caller's submitter-liveness mark (set at
   * claim time, settled in the caller's encompassing finally).
   */
  private async runClaimedSendToFinalization(input: {
    message: { id: number; emailServiceId: number; messageId: string | null; referencesHeader: string | null };
    draft: { id: number };
    revision: {
      subject: string;
      recipientAddress: string;
      bodyText: string;
      bodyHtml: string | null;
    };
    approval: { id: number };
    emailServiceId: number;
    service: BoundMailbox;
    guardRow: { id: number } | null | undefined;
    attemptId: number;
    requestCorrelationId: string;
    /** Assisted inconclusive marker: threads into the gate + fence inputs. */
    assistedProbe: AssistedInconclusiveProbe | null;
  }): Promise<SendApprovedReplyOutcome> {
    const {
      message,
      draft,
      revision,
      approval,
      emailServiceId,
      service,
      guardRow,
      attemptId,
      requestCorrelationId,
      assistedProbe,
    } = input;
    // 7. Mark the attempt `submitted` at the SMTP handoff boundary (P0.6) so a
    //    crash here is recoverable to delivery_unknown rather than left claimed.
    await this.attemptModule.markSubmitted(attemptId, new Date(this.nowForInvocation()));

    // 7b. R12 (§9.4 item 4) — recheck freshness immediately before SMTP. The
    //     freshness fence at claim time (claimApprovedRevisionForSend) reads
    //     `replyNegativeCheckAt`; after the claim succeeds + markSubmitted runs,
    //     there is NO further age check before SMTP. A DB/queue delay after
    //     claim exceeding FORCED_FRESHNESS_WINDOW_MS would let SMTP submit
    //     using a stale observation. §9.4: "Submit SMTP immediately after the
    //     successful claim... If execution is delayed past the five-second
    //     observation window before SMTP starts, rerun detection outside the
    //     transaction while retaining the send claim. A refusal before SMTP
    //     finalizes that unsent claim safely; it must not manufacture an
    //     accepted/unknown send. Recognize only this operation's exact attempt
    //     as the current owner during that refresh; every other pending/sent/
    //     unknown record still blocks. Allow one delayed refresh; further delay
    //     refuses with no SMTP submission."
    //
    //     The line-238 message read is stale by gate time — re-read the seed's
    //     current replyNegativeCheckAt. If the observation is still fresh
    //     (≤ FORCED_FRESHNESS_WINDOW_MS) proceed to SMTP with NO extra detect
    //     call (§9.4: "Submit SMTP immediately after the successful claim").
    //     If stale, ONE excluded forceRefresh detect retaining the claim;
    //     not_replied proceeds / replied-unknown refuses → safe finalize the
    //     unsent claim as delivery_unknown + ONE reply_skipped audit +
    //     SendPolicyRejection with the typed code. A safe finalize is mandatory
    //     here (unlike the pre-claim refusal): the claim EXISTS, so every gate
    //     refusal must finalize the unsent claim — it must not manufacture an
    //     accepted/unknown send. This mirrors the recovery precedent
    //     (EmailReplySendRecoveryService.recoverStaleAttempts finalizes
    //     in-flight attempts as delivery_unknown).
    // R01: the gate reports whether it consumed the single delayed-refresh
    // allowance; the handoff fence below spends it at most once more.
    const { refreshed: gateRefreshed } = await this.runPostClaimFreshnessGate({
      message,
      draftId: draft.id,
      approvalId: approval.id,
      attemptId,
      emailServiceId,
      guardId: guardRow?.id ?? null,
      requestCorrelationId,
      assistedProbe,
    });

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

    // 7c. F02/R01 final handoff fence — conditional ownership AND freshness
    // immediately before SMTP. Recovery or reconciliation may have finalized
    // this attempt while this operation was paused in the gate
    // (unknown/failed/sent), a fresh retry may own the message now, a
    // positive may have arrived, or the observation may have aged out during
    // the fence's own awaits. A lost/stale claim refuses with ONE skip audit
    // via refusePostClaimGate — whose finalize is a safe row-level no-op on
    // the already-terminal attempt (conditional match on claimed|submitted
    // yields 0 rows) — and throws, so no second submission is possible under
    // the old claim alongside a fresh retry.
    await this.checkClaimOwnershipBeforeSmtp({
      gateRefreshed,
      message,
      draftId: draft.id,
      approvalId: approval.id,
      attemptId,
      emailServiceId,
      guardId: guardRow?.id ?? null,
      requestCorrelationId,
      assistedProbe,
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
    // Finalize attempt + draft + approval + audit in ONE transaction. The
    // caller's encompassing finally settles submitter liveness AFTER this
    // completes, so a concurrent reconcile cannot slip between transport
    // settle and outcome persistence.
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
      // R20: thread this invocation's id so the outcome audit joins the SMTP
      // result to the claim/refusal under the same correlation.
      requestCorrelationId,
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
    await this.mirrorToAutoReplyAudit(log);
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
    requestCorrelationId: string,
    /**
     * R12 §9.4 item 4 — when set, the detection refresh ignores the claiming
     * operation's own draft/attempt so a post-claim refresh can re-probe the
     * mailbox instead of short-circuiting on its own `sending` draft /
     * `submitted` attempt. Only the excluded records are ignored; every other
     * pending/sent/unknown record still blocks. Internal ownership handle —
     * never a tool/IPC bypass parameter.
     */
    exclude?: { excludeDraftId?: number; excludeAttemptId?: number }
  ): Promise<AssistedInconclusiveProbe | null> {
    let result: import("@/service/emailReceive/EmailReplyDetectionTypes").ReplyDetectionResult;
    try {
      result = await this.detectionServiceForNow().detect({
        messageId: message.id,
        forceRefresh: true,
        excludeDraftId: exclude?.excludeDraftId,
        excludeAttemptId: exclude?.excludeAttemptId,
      });
    } catch (error) {
      // Detection threw — treat as an inconclusive probe failure. The stable
      // code `probe_failed` routes to discard_and_retry; the error text is
      // bounded via sanitizeDetectionError (240-char cap, the same helper the
      // detection service uses at its own checkReply catch boundary) so no
      // raw provider error text, stack trace, or unbounded buffer content
      // flows into the audit reason column or the SendPolicyRejection message
      // that surfaces over IPC to the renderer/AI tool.
      const errMsg = sanitizeDetectionError(error);
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
        const auditErrMsg = sanitizeDetectionError(auditError);
        throw new SendPolicyRejection(
          `Send rejected: detection audit persistence failed: ${auditErrMsg}`,
          code,
          requestCorrelationId
        );
      }
      throw new SendPolicyRejection(
        `Send rejected by reply detection: [${code}] Detection probe failed: ${errMsg}`,
        code,
        requestCorrelationId
      );
    }

    if (result.state === "not_replied") {
      incrementReplyMetric("detection_outcome", {
        stage: "pre_send",
        state: "not_replied",
        code: "no_reply_observed",
      });
      return null; // complete negative — normal path to the atomic claim
    }

    const code: EmailReplyPolicyCode =
      result.state === "replied" ? "already_replied" : result.reasonCode;

    // Assisted send (spec 2026-10-29-email-send-inconclusive-detection-
    // assisted-design.md): a probe-execution unknown on a HUMAN-CONFIRMED
    // send proceeds on the local-ledger negative (asserted twice upstream:
    // the pre-send policy guard's canonical-cluster evaluation and
    // detection's own local-first step) — an explicit human confirmation
    // covers the uncheckable manual-reply residue. Never persisted as a
    // negative; flagged here with ONE lifecycle audit row + the metric.
    if (result.state === "unknown" && ASSISTED_INCONCLUSIVE_CODES.has(result.reasonCode)) {
      const assistedCode: ReplyDetectionUnknownCode = result.reasonCode;
      incrementReplyMetric("detection_outcome", {
        stage: "pre_send",
        state: "unknown",
        code,
      });
      try {
        await this.writeAssistedInconclusiveAudit(
          message,
          draftId,
          requestCorrelationId,
          assistedCode
        );
      } catch (auditError) {
        incrementReplyMetric("audit_failure", { stage: "pre_send" });
        const auditErrMsg = sanitizeDetectionError(auditError);
        // A send whose assisted-evidence write failed cannot proceed aided:
        // refuse (never silently assisted) with the stable probe_failed code.
        throw new SendPolicyRejection(
          `Send rejected: assisted-detection audit persistence failed: ${auditErrMsg}`,
          "probe_failed",
          requestCorrelationId
        );
      }
      return {
        reasonCode: assistedCode,
        checkedAt: result.checkedAt ?? new Date().toISOString(),
      };
    }

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
      const auditErrMsg = sanitizeDetectionError(auditError);
      throw new SendPolicyRejection(
        `Send rejected: detection audit persistence failed: ${auditErrMsg}`,
        code,
        requestCorrelationId
      );
    }
    throw new SendPolicyRejection(
      `Send rejected by reply detection: [${code}] ${reason}`,
      code,
      requestCorrelationId
    );
  }

  /**
   * ONE lifecycle audit row for an ASSISTED inconclusive probe (one-audit-
   * owner rule §9.2/§10): action detection_inconclusive_proceeded, same
   * metadata shape as the refusal writer plus `assisted: true`. Deliberately
   * NOT mirrored into the auto-reply decision table (the claim/send audits
   * carry the decision-visible evidence).
   */
  private async writeAssistedInconclusiveAudit(
    message: { id: number; emailServiceId: number },
    draftId: number,
    requestCorrelationId: string,
    reasonCode: ReplyDetectionUnknownCode
  ): Promise<void> {
    await this.auditModuleForNow().ensureConnection();
    const log = new EmailReplyAuditLogEntity();
    log.emailServiceId = message.emailServiceId;
    log.messageId = message.id;
    log.draftId = draftId;
    log.action = "detection_inconclusive_proceeded";
    log.actor = "system";
    log.reason =
      `[${reasonCode}] Reply detection inconclusive; proceeding on the ` +
      "local-ledger negative and the human-confirmed approval";
    log.metadataJson = JSON.stringify({
      correlationId: requestCorrelationId,
      messageCorrelationId: correlationIdForMessage(message.id),
      stage: "pre_send",
      code: reasonCode,
      source: "reply_detection",
      assisted: true,
    });
    await this.auditModuleForNow().create(log);
  }

  /**
   * F02 — final ownership fence immediately before the SMTP handoff. The
   * post-claim gate may have paused (message reads, detection) while recovery
   * finalized this attempt (unknown) and reconciliation moved it further
   * (failed) or a late success landed (sent). Submitting now would send under
   * a dead claim, potentially alongside a freshly approved retry authorized
   * after the reconcile reopened the guard. Proceed ONLY while the attempt
   * row is still `claimed`/`submitted` (this operation's own live states).
   *
   * On a lost claim the owned-claim refusal path runs: refusePostClaimGate's
   * finalize is a safe row-level no-op on the already-terminal attempt (the
   * conditional `IN (claimed, submitted)` matches 0 rows, so no state is
   * overwritten and no duplicate outcome audit is written), exactly ONE
   * `reply_skipped` audit is written, and SendPolicyRejection is thrown — no
   * SMTP under the old claim, ever. The mapped code names the observed
   * terminal state so operators can tell a recovered attempt from an
   * accepted one without parsing English.
   */
  /**
   * F02/R01 — final ownership + freshness fence immediately before the SMTP
   * handoff. The post-claim gate may have paused (message reads, detection)
   * while recovery finalized this attempt (unknown) and reconciliation moved
   * it further (failed) or a late success landed (sent) — and even with the
   * claim intact, a seed/sibling positive may have arrived or the five-second
   * observation may have aged out during the fence's own awaits.
   *
   * Order is load-bearing: the attempt read runs first, then the cluster
   * read, then the message read LAST, so the freshness permission is computed
   * from the newest possible observation with no awaits between it and the
   * transport (header building is synchronous). Returns normally only when
   * the claim is still owned AND no positive exists AND a usable negative is
   * fresh; otherwise refuses with one skip audit via refusePostClaimGate
   * (whose finalize is a safe row-level no-op on an already-terminal
   * attempt) and throws — no SMTP under a dead or stale claim, ever.
   *
   * Single-refresh allowance is shared with the gate: when the gate already
   * consumed the one delayed refresh (`gateRefreshed`), a stale observation
   * here refuses immediately (no second delay); otherwise this fence spends
   * the allowance itself with an excluded forceRefresh probe.
   */
  /**
   * N04: coherent admission verdict over ONE snapshot. Delegates to the
   * pure {@link evaluateFinalSendAdmission} (unit-testable without DB).
   */
  private evaluateFinalAdmission(
    snapshot: Awaited<
      ReturnType<EmailReplyDraftModule["readFinalSendAdmission"]>
    >,
    stage: "gate" | "fence"
  ): FinalSendAdmissionVerdict {
    return evaluateFinalSendAdmission(snapshot, stage);
  }

  private async checkClaimOwnershipBeforeSmtp(input: {
    message: { id: number; emailServiceId: number };
    draftId: number;
    approvalId: number;
    attemptId: number;
    emailServiceId: number;
    guardId: number | null;
    requestCorrelationId: string;
    gateRefreshed: boolean;
    /** Assisted inconclusive send (2026-10-29 design doc): fences skip the
     * freshness dance; owned-claim + positive-evidence checks stay. */
    assistedProbe?: AssistedInconclusiveProbe | null;
  }): Promise<void> {
    // N04: ONE coherent snapshot (attempt + seed + cluster in a single
    // Model transaction) instead of three separately awaited reads. The old
    // sequence let the attempt flip (e.g. to delivery_unknown) or a sibling
    // turn positive between the attempt/cluster reads and the final seed
    // read, then admitted SMTP on the mixed snapshots.
    let snapshot = await this.draftModule.readFinalSendAdmission({
      attemptId: input.attemptId,
      messageId: input.message.id,
    });
    let verdict = this.evaluateFinalAdmission(snapshot, "fence");
    if (verdict.kind === "admit" ||
        (verdict.kind === "stale" && input.assistedProbe != null)) {
      // Owned claim, no positives — proceed. In ASSISTED mode a `stale`
      // verdict (no fresh complete negative) is expected by design: the
      // freshness precondition is replaced by the local-ledger negative +
      // the human-confirmed approval; the evaluator's positive/ownership
      // refusals already ran. Stamp the mode so the next reader knows why.
      if (verdict.kind === "stale") {
        incrementReplyMetric("send_claim", {
          outcome: "handoff_assisted_stale",
        });
      }
      // Owned claim, no positives, complete cluster, fresh usable negative
      // as of the coherent snapshot — proceed to SMTP immediately.
      incrementReplyMetric("send_claim", {
        outcome: "handoff_fresh",
      });
      return;
    }
    if (verdict.kind === "refuse") {
      // Preserve the historical metric: every attempt-ownership loss emits
      // ownership_fence_refused (whatever its mapped code); seed/sibling
      // positive refusals carry no send_claim metric.
      const attempt = snapshot.attempt;
      if (
        !attempt ||
        (attempt.status !== "claimed" && attempt.status !== "submitted")
      ) {
        incrementReplyMetric("send_claim", {
          outcome: "ownership_fence_refused",
        });
      }
      await this.refusePostClaimGate(input, verdict.code, verdict.reason);
      return;
    }
    // Stale, missing, unusable, or incomplete evidence at the handoff.
    if (snapshot.clusterRows === null) {
      // F01 principle: incomplete cluster evidence can never grant
      // permission — fall through to the refresh/refuse logic below.
      incrementReplyMetric("send_claim", {
        outcome: "handoff_cluster_unreadable",
      });
    }
    // Stale, missing, unusable, or incomplete evidence at the handoff.
    if (input.gateRefreshed) {
      // The single delayed-refresh allowance is exhausted — refuse with no
      // second delay and no SMTP submission.
      await this.refusePostClaimGate(
        input,
        "probe_failed",
        "Handoff observation is stale and the single delayed refresh was already consumed; refusing second delay"
      );
      return;
    }
    // Spend the single allowance here: one excluded forceRefresh probe
    // retaining the claim, then re-evaluate once against its result.
    let result: import("@/service/emailReceive/EmailReplyDetectionTypes").ReplyDetectionResult;
    try {
      result = await this.runExcludedRefresh(input);
    } catch (error) {
      const errMsg = sanitizeDetectionError(error);
      await this.refusePostClaimGate(
        input,
        "probe_failed",
        `Handoff detection probe threw: ${errMsg}`
      );
      return;
    }
    if (result.state !== "not_replied") {
      const code: EmailReplyPolicyCode =
        result.state === "replied" ? "already_replied" : result.reasonCode;
      const reason =
        result.state === "replied"
          ? "Handoff freshness refresh found an existing reply before SMTP"
          : "Handoff freshness refresh was inconclusive before SMTP";
      await this.refusePostClaimGate(input, code, reason);
      return;
    }
    // N04: repeat the COMPLETE admission validation after any refresh —
    // attempt ownership, cluster eligibility, and negative evidence
    // together in a fresh snapshot, not just the seed re-read. A recovery
    // flip or sibling positive landing during the refresh still refuses.
    snapshot = await this.draftModule.readFinalSendAdmission({
      attemptId: input.attemptId,
      messageId: input.message.id,
    });
    verdict = this.evaluateFinalAdmission(snapshot, "fence");
    if (verdict.kind === "admit") {
      incrementReplyMetric("detection_outcome", {
        stage: "pre_send",
        state: "not_replied",
        code: "no_reply_observed",
      });
      return;
    }
    if (verdict.kind === "refuse") {
      await this.refusePostClaimGate(input, verdict.code, verdict.reason);
      return;
    }
    await this.refusePostClaimGate(
      input,
      "probe_failed",
      "Handoff refresh completed without a fresh usable negative observation before SMTP"
    );
  }

  /**
   * The single permitted delayed refresh: an excluded forceRefresh probe
   * retaining this operation's claim (only its own sending draft + submitted
   * attempt are ignored so the refresh re-probes the mailbox instead of
   * short-circuiting). Shared by the gate and the handoff fence; each call
   * site owns the allowance accounting and the result mapping.
   */
  private async runExcludedRefresh(input: {
    message: { id: number; emailServiceId: number };
    draftId: number;
    attemptId: number;
  }): Promise<
    import("@/service/emailReceive/EmailReplyDetectionTypes").ReplyDetectionResult
  > {
    incrementReplyMetric("send_claim", {
      outcome: "post_claim_stale_refresh",
    });
    return await this.detectionServiceForNow().detect({
      messageId: input.message.id,
      forceRefresh: true,
      excludeDraftId: input.draftId,
      excludeAttemptId: input.attemptId,
    });
  }

  /**
   * R12 (§9.4 item 4) — post-claim freshness gate. After the claim succeeds
   * and markSubmitted runs, re-read the seed message's current
   * `replyNegativeCheckAt` (the line-238 read is stale by gate time). If the
   * observation is still fresh (≤ FORCED_FRESHNESS_WINDOW_MS), proceed to
   * SMTP with NO extra detect call (§9.4: "Submit SMTP immediately after the
   * successful claim"). If stale, run ONE excluded `forceRefresh` detection
   * retaining the claim — the refresh recognizes ONLY this operation's exact
   * attempt as the current owner (every other pending/sent/unknown record still
   * blocks).
   *
   * - `not_replied` → proceed to the handoff fence (the stale-but-still-
   *   eligible case), reporting whether the single refresh was consumed.
   * - `replied` / `unknown` → the unsent claim is finalized safely as
   *   `delivery_unknown` (NOT left claimed, NOT manufactured as sent), ONE
   *   `reply_skipped` audit (stage pre_send) is written, and a
   *   `SendPolicyRejection` with the typed detection code is thrown. The safe
   *   finalize reuses the same `finalizeSendOutcome` path the recovery service
   *   uses (delivery_unknown matches an attempt at `submitted`, keeps the guard
   *   protected via the phase `IN ("sending")` fence → `delivery_unknown` +
   *   `activeAttemptId: null`, consumes the one-time approval, writes the
   *   delivery_unknown audit, and leaves the message `replyStatus` untouched).
   *
   * Exactly one delayed refresh across gate + handoff fence — §9.4: "Allow
   * one delayed refresh; further delay refuses with no SMTP submission."
   * The gate returns whether it consumed the allowance so the fence spends
   * it at most once more (never twice total).
   */
  private async runPostClaimFreshnessGate(input: {
    message: { id: number; emailServiceId: number };
    draftId: number;
    approvalId: number;
    attemptId: number;
    emailServiceId: number;
    guardId: number | null;
    requestCorrelationId: string;
    /** Assisted inconclusive send (2026-10-29 design doc): the excluded-refresh
     * dance is skipped (deterministically-inconclusive probe = guaranteed
     * waste); owned-claim + positive checks stay, `stale` proceeds. */
    assistedProbe?: AssistedInconclusiveProbe | null;
  }): Promise<{ refreshed: boolean }> {
    // N04: ONE coherent snapshot (attempt + seed + cluster in a single
    // Model transaction). The message read at the top of sendApprovedReply
    // is stale by gate time (awaited claim + markSubmitted I/O elapsed);
    // re-establishing it with two more separately awaited reads (cluster,
    // then message again) admits the same torn-snapshot mixes as the old
    // fence. F01 principle preserved: incomplete cluster evidence can never
    // grant permission — it routes to the verified refresh below.
    let snapshot = await this.draftModule.readFinalSendAdmission({
      attemptId: input.attemptId,
      messageId: input.message.id,
    });
    let verdict = this.evaluateFinalAdmission(snapshot, "gate");
    // ASSISTED mode: `stale` (no fresh complete negative) proceeds without
    // the excluded-refresh dance — a second probe on a deterministically-
    // inconclusive mailbox discovers nothing new. The evaluator's
    // ownership/positive refusals (verdict refuse) are unchanged.
    if (verdict.kind === "admit" ||
        (verdict.kind === "stale" && input.assistedProbe != null)) {
      if (verdict.kind === "stale") {
        incrementReplyMetric("send_claim", {
          outcome: "post_claim_assisted_stale",
        });
      } else {
        // Fresh — proceed to the handoff fence (§9.4) with NO extra detect
        // call. The positive check inside the evaluator already ran, so a
        // fresh usable negative here means no known positive on seed or
        // siblings at gate time. The handoff fence re-establishes all of this
        // after its own awaits — this return is permission to continue, not
        // to submit.
        incrementReplyMetric("send_claim", {
          outcome: "post_claim_fresh",
        });
      }
      return { refreshed: false };
    }
    if (verdict.kind === 'refuse') {
      // The message vanished between claim and SMTP but the claim still
      // exists: refusePostClaimGate safely finalizes it rather than leaving
      // a phantom in-flight attempt (delivery_unknown is the safe terminal
      // only where the evaluator maps it; missing rows map to probe_failed).
      return this.refusePostClaimGate(input, verdict.code, verdict.reason);
    }
    if (snapshot.clusterRows === null) {
      incrementReplyMetric("send_claim", {
        outcome: "post_claim_cluster_unreadable",
      });
    }
    // Stale (or null/unusable) → ONE excluded forceRefresh detection
    // retaining the claim. The exclude params make the refresh ignore THIS
    // operation's own sending draft + submitted attempt (the current owner)
    // so it re-probes the mailbox instead of short-circuiting at
    // reply_in_progress.
    // The refresh threw — treat as an inconclusive probe failure and safely
    // finalize the unsent claim. Bounded error text (FR-039). The refusal
    // never returns, so a throw here cannot fall through to the result
    // handling below with an unassigned outcome.
    const result = await this.runExcludedRefresh(input).catch(
      async (
        error: unknown
      ): Promise<
        import("@/service/emailReceive/EmailReplyDetectionTypes").ReplyDetectionResult
      > => {
        const errMsg = sanitizeDetectionError(error);
        return this.refusePostClaimGate(
          input,
          "probe_failed",
          `Post-claim detection probe threw: ${errMsg}`
        );
      }
    );
    if (result.state === "not_replied") {
      // N04: repeat the COMPLETE admission validation after the refresh —
      // attempt ownership, cluster eligibility, and negative evidence
      // together in a fresh snapshot. The refresh itself took wall time;
      // a recovery flip or sibling positive landing during it still
      // refuses. A stale/unusable observation after exactly one refresh
      // refuses with no SMTP (no second refresh loop).
      snapshot = await this.draftModule.readFinalSendAdmission({
        attemptId: input.attemptId,
        messageId: input.message.id,
      });
      verdict = this.evaluateFinalAdmission(snapshot, "gate");
      if (verdict.kind === "admit") {
        // Stale-but-still-eligible with a NOW-fresh usable observation:
        // proceed to the handoff fence, reporting the consumed allowance.
        incrementReplyMetric("detection_outcome", {
          stage: "pre_send",
          state: "not_replied",
          code: "no_reply_observed",
        });
        return { refreshed: true };
      }
      if (verdict.kind === "refuse") {
        return this.refusePostClaimGate(input, verdict.code, verdict.reason);
      }
      return this.refusePostClaimGate(
        input,
        "probe_failed",
        "Post-claim refresh completed without a fresh usable negative observation before SMTP; refusing second delay"
      );
    }
    // replied OR unknown → safely finalize the unsent claim + ONE reply_skipped
    // audit + SendPolicyRejection with the typed code.
    const code: EmailReplyPolicyCode =
      result.state === "replied" ? "already_replied" : result.reasonCode;
    const reason =
      result.state === "replied"
        ? "Post-claim freshness refresh found an existing reply before SMTP"
        : "Post-claim freshness refresh was inconclusive before SMTP";
    return this.refusePostClaimGate(input, code, reason);
  }

  /**
   * R12 §9.4 item 4 — the safe-finalize + refusal path for a post-claim gate
   * refusal. The claim EXISTS (unlike the pre-claim refusal in
   * {@link runPreSendDetection}), so the unsent claim MUST be safely finalized
   * — it must not be left `claimed`/`submitted` (a phantom in-flight attempt
   * blocks every future recheck) and must not be manufactured as `sent`.
   * N06: this gate runs BEFORE SMTP (`sendReplyEmail` has not been called),
   * so the operation is known never to have contacted SMTP. Finalize as
   * `failed` (definitely not submitted under the owned claim), NOT
   * `delivery_unknown` (ambiguous possible acceptance). The failed outcome
   * consumes the one-time approval (a permitted retry needs fresh explicit
   * approval) without manufacturing possible-SMTP-acceptance history, and
   * leaves sibling/positive protection intact (cluster evidence still blocks).
   * Then ONE `reply_skipped` audit (stage pre_send) is written and a
   * `SendPolicyRejection` with the typed detection code is thrown. Audit
   * persistence failure still stops the work (§9.2) but the safe finalize has
   * already run, so the claim is not left dangling.
   */
  /**
   * R01: typed as `Promise<never>` — every path finalizes (or no-ops on an
   * already-terminal attempt) and then throws SendPolicyRejection. Callers
   * never continue past this call, so no unreachable shims are needed.
   */
  private async refusePostClaimGate(
    input: {
      message: { id: number; emailServiceId: number };
      draftId: number;
      approvalId: number;
      attemptId: number;
      emailServiceId: number;
      guardId: number | null;
      requestCorrelationId: string;
    },
    code: EmailReplyPolicyCode,
    reason: string
  ): Promise<never> {
    incrementReplyMetric("detection_outcome", {
      stage: "pre_send",
      state: code === "already_replied" ? "replied" : "unknown",
      code,
    });
    incrementReplyMetric("send_claim", {
      outcome: "post_claim_gate_refused",
    });
    // N06: safely finalize the KNOWN-UNSENT claim as failed. This matches the
    // attempt's `submitted` status (finalizeSendOutcome matches
    // claimed|submitted for failed), reopens the guard to draft_ready for a
    // fresh explicit approval (phase "sending" → "draft_ready"), consumes the
    // one-time approval, writes the send_failed audit, and leaves the message
    // replyStatus untouched. It never claims possible SMTP acceptance.
    await this.draftModule.finalizeSendOutcome({
      attemptId: input.attemptId,
      draftId: input.draftId,
      approvalId: input.approvalId,
      emailServiceId: input.emailServiceId,
      messageId: input.message.id,
      outcome: "failed",
      providerMessageId: null,
      failureCode: code,
      sanitizedError: `Unsent (SMTP never called): ${reason}`,
      guardId: input.guardId,
      // R20: thread this invocation's id so the failed outcome audit joins
      // the unsent claim's refusal under the same correlation.
      requestCorrelationId: input.requestCorrelationId,
    });
    // ONE reply_skipped audit (stage pre_send, source reply_detection) for
    // the refusal. Then throw SendPolicyRejection with the typed code so the
    // B12 IPC envelope surfaces it machine-readably.
    try {
      await this.writeDetectionRefusalAudit(
        input.message,
        input.draftId,
        input.requestCorrelationId,
        code,
        reason
      );
    } catch (auditError) {
      incrementReplyMetric("audit_failure", { stage: "pre_send" });
      const auditErrMsg = sanitizeDetectionError(auditError);
      throw new SendPolicyRejection(
        `Send rejected: detection audit persistence failed: ${auditErrMsg}`,
        code,
        input.requestCorrelationId
      );
    }
    throw new SendPolicyRejection(
      `Send rejected by reply detection: [${code}] ${reason}`,
      code,
      input.requestCorrelationId
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
    await this.mirrorToAutoReplyAudit(log);
  }
}

function certaintyToOutcome(
  certainty: "accepted" | "definitely_rejected" | "unknown"
): "sent" | "failed" | "delivery_unknown" {
  if (certainty === "accepted") return "sent";
  if (certainty === "definitely_rejected") return "failed";
  return "delivery_unknown";
}
