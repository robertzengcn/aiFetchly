import type {
  EmailReplyPolicyDecision,
  EmailReplyPolicyCode,
  EmailReplyPolicyStage,
} from "@/entityTypes/emailReplyReliabilityTypes";
import { REPLY_POLICY_VERSION } from "@/service/emailReply/replyReliabilityVersions";
import {
  classificationForConfirmedSend,
  confirmedSendRuleRefusal,
  evaluateAutoReplyPolicy,
} from "@/service/emailReply/EmailAutoReplyPolicyService";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyApprovalModule } from "@/modules/EmailReplyApprovalModule";
import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailAutoReplyRuleModule } from "@/modules/EmailAutoReplyRuleModule";
import type { EmailReplyDraftEntity } from "@/entity/EmailReplyDraft.entity";
import { hasNamespaceConflict } from "@/service/emailReceive/EmailReplyIdentity";
import {
  isAttemptInFlight,
  isLiveDraftStatus,
} from "@/model/replyClusterEvidence";

/**
 * Single authoritative policy gate for the reply pipeline (technical design
 * §10, AD-006). Both the draft path (pre_draft) and the send path (pre_send)
 * MUST go through here; no IPC or AI tool may bypass it.
 *
 * Milestone 1 focuses on the send-time gate (FR-006): mailbox binding, terminal
 * draft states, recipient validity, approval freshness/hash, and the existing
 * deterministic hard blocks from {@link evaluateAutoReplyPolicy}. Model
 * confidence never authorizes anything (AD-008).
 *
 * FR-029 (Phase-1 slice): a message-level duplicate guard runs BEFORE the
 * legacy classification/rule checks in both stages. It refuses drafting or
 * sending when the inbound message already has a reply, an in-flight attempt,
 * an unresolved delivery, or contradictory sibling records. The guard is
 * local-only in Phase 1 (no IMAP `\Answered` probe — that is Phase 2's
 * FR-030/031). It fixes the reported sequential duplicate-reply bug for the
 * in-app path; concurrent double-generate of a clean message is a known
 * Phase-1 limitation closed by Phase-2 atomic reservation (FR-035).
 */
export class EmailReplyPolicyOrchestrator {
  private readonly draftModule: EmailReplyDraftModule;
  private readonly approvalModule: EmailReplyApprovalModule;
  private readonly attemptModule: EmailReplySendAttemptModule;
  private readonly messageModule: EmailReceivedMessageModule;
  private readonly ruleModule: EmailAutoReplyRuleModule;

  /**
   * Production callers omit the options; tests inject stub modules so the
   * guard's precedence logic can be exercised against seeded state without the
   * full DB stack. Mirrors the `senderFactory`/`serviceLoader` seam pattern in
   * {@link EmailReplyDeliveryService}.
   */
  constructor(options?: {
    readonly draftModule?: EmailReplyDraftModule;
    readonly approvalModule?: EmailReplyApprovalModule;
    readonly attemptModule?: EmailReplySendAttemptModule;
    readonly messageModule?: EmailReceivedMessageModule;
    readonly ruleModule?: EmailAutoReplyRuleModule;
  }) {
    this.draftModule =
      options?.draftModule ?? new EmailReplyDraftModule();
    this.approvalModule =
      options?.approvalModule ?? new EmailReplyApprovalModule();
    this.attemptModule =
      options?.attemptModule ?? new EmailReplySendAttemptModule();
    this.messageModule =
      options?.messageModule ?? new EmailReceivedMessageModule();
    this.ruleModule =
      options?.ruleModule ?? new EmailAutoReplyRuleModule();
  }

  async evaluate(input: {
    stage: EmailReplyPolicyStage;
    messageId: number;
    draftId?: number;
    revisionId?: number;
    /**
     * Reviewed flag (docs/superpowers/specs/2026-10-29-email-reply-reviewed-flag-design.md):
     * pass true ONLY for a human-confirmed draft request in conversation
     * (`reviewed` on the AI tool / `humanReviewed` on the UI IPC). It exempts
     * ONLY the classification-family blocks (needs_human_review / unknown) at
     * the pre_draft stage — never machine-safety blocks. Pre-send paths do not
     * use it: their confirmed-send exemption lives in
     * {@link classificationForConfirmedSend}.
     */
    humanConfirmed?: boolean;
  }): Promise<EmailReplyPolicyDecision> {
    try {
      const message = await this.messageModule.read(input.messageId);
      if (!message) {
        return deny("invalid_recipient", "Original message no longer exists");
      }

      // FR-029: message-level duplicate guard runs first in BOTH stages. A
      // refusal here blocks before any LLM/SMTP side effects (no draft
      // generated, no send attempted). When an eligible existing draft is
      // found, the guard allows pre_draft so the generation service can reuse
      // it instead of regenerating.
      const messageLevel = await this.evaluateMessageLevelState(
        message.id,
        message.replyStatus
      );
      if (messageLevel !== null) {
        return messageLevel;
      }

      if (input.stage === "pre_draft") {
        return this.evaluatePreDraft(message, input.humanConfirmed === true);
      }
      return this.evaluatePreSend(message, input.draftId, input.revisionId);
    } catch (error) {
      console.error("Policy orchestrator error:", error);
      return deny(
        "classification_unknown",
        "Policy evaluation failed; denying by default"
      );
    }
  }

  /**
   * Inspect authoritative local records for the message-level reply state
   * (FR-029, Phase-1 local-only slice). Returns `null` when the message is
   * clean (proceed to the legacy checks); otherwise returns a refusal decision.
   *
   * B02: the send-attempt ledger is the authoritative delivery evidence. A
   * `sent`/`delivery_unknown`/`claimed`/`submitted` attempt counts even when
   * the linked draft row is missing/stale and the message `replyStatus`
   * projection still looks unanswered — the attempt row is append-only and
   * survives draft/message projection drift (orphan attempts, stale replyStatus
   * after a mid-flip crash, etc.).
   *
   * T02 (FR-029/FR-038): the guard inspects the FULL canonical cluster — every
   * received-message row in the same configured email service that shares the
   * normalized RFC Message-ID, plus the drafts and send attempts linked to
   * each of those rows — instead of just the single seed message. Subject,
   * sender alone, and the whole conversation are explicitly NOT the duplicate
   * key. A `row:<id>` singleton fallback protects a missing-id row locally
   * but never merges with another missing-id row.
   *
   * Legacy bare-UID rows (pre-namespace IMAP) are flagged as a
   * `reply_state_conflict` until reconciled by a verified header match, never
   * silently adopted as the same message. Multiple live drafts across the
   * cluster are likewise a conflict — the guard blocks rather than picking one.
   *
   * Precedence (PRD §5):
   *  1. `replyStatus === "sent"` or any draft `sent` OR any `sent` attempt →
   *     `already_replied`.
   *  2. Any draft/attempt `delivery_unknown` → `delivery_unknown` (ambiguous
   *     outcome on a prior attempt; never auto-retry).
   *  3. Any draft `sending` or attempt `claimed`/`submitted` →
   *     `reply_in_progress`.
   *  4. Multiple LIVE (non-terminal) drafts across the cluster, contradictory
   *     records, or a legacy bare-UID row whose namespace changed →
   *     `reply_state_conflict`.
   *  5. `replyStatus === "failed"` with no live drafts → `reply_state_unknown`
   *     (a prior generation failed; surface for human triage rather than
   *     silently regenerating).
   *
   * When an eligible existing draft (status `draft` or `approved`) exists,
   * the guard returns `null` so the caller can REUSE it (Step 6 wires the
   * generation service to do so). This is the dedup-by-reuse path.
   */
  private async evaluateMessageLevelState(
    messageId: number,
    replyStatus: string | null
  ): Promise<EmailReplyPolicyDecision | null> {
    const seed = await this.messageModule.read(messageId);
    if (!seed) {
      // The public evaluate() already refused a missing message as
      // invalid_recipient; this is a defensive second check.
      return deny("reply_state_unknown", "Original message no longer exists");
    }

    // T02: resolve the canonical cluster — every equivalent row in the same
    // configured email service — and inspect their drafts/attempts together.
    const clusterRows = await this.messageModule.findCanonicalEquivalents(seed);
    const clusterRowIds = clusterRows.map((r) => r.id);

    // One batched query per table for the whole cluster (not one per row).
    const [drafts, attempts] = await Promise.all([
      this.draftModule.listByMessageIds(clusterRowIds),
      this.attemptModule.listByMessageIds(clusterRowIds),
    ]);
    const liveDrafts = drafts.filter((d) => isLiveDraftStatus(d.status));
    const sentDrafts = drafts.filter((d) => d.status === "sent");
    const sendingDrafts = drafts.filter((d) => d.status === "sending");
    const unknownDrafts = drafts.filter((d) => d.status === "delivery_unknown");

    // B02: authoritative delivery ledger (batched above — includes orphan rows
    // whose linked draft was deleted, and stale rows left behind by a
    // mid-flip crash). The attempt status is append-only and overrides stale
    // draft/message projections.
    const sentAttempts = attempts.filter((a) => a.status === "sent");
    const unknownAttempts = attempts.filter(
      (a) => a.status === "delivery_unknown"
    );
    const inFlightAttempts = attempts.filter((a) =>
      isAttemptInFlight(a.status)
    );

    // T02/FR-038: a legacy bare-UID row whose (folder, UIDVALIDITY) namespace
    // changed cannot be safely adopted as the same message. Flag the cluster
    // for reconciliation rather than silently merging. This applies only when
    // the cluster spans more than one row (a single legacy row is fine until a
    // namespace change is actually observed).
    if (clusterRows.length > 1 && hasNamespaceConflict(clusterRows)) {
      return deny(
        "reply_state_conflict",
        "Canonical cluster spans rows with conflicting provider-UID namespaces; requires reconciliation"
      );
    }

    // R03: aggregate row-level positive evidence across EVERY cluster row. A
    // sibling row may carry `replyDetectedAt` (sticky mailbox flag / verified
    // Sent search) or `replyStatus=sent` (historical app delivery) that the
    // seed's own columns do not reflect. Without this, local policy returns
    // eligible for the same inbound identity that already has authoritative
    // reply history on a sibling (R03 Trigger B).
    const clusterHasRowPositive =
      clusterRows.some((r) => r.replyDetectedAt != null) ||
      clusterRows.some((r) => r.replyStatus === "sent");

    // 1. Already replied: explicit message state OR a cluster row positive OR
    //    a sent draft OR a sent attempt (the ledger is authoritative even if
    //    the draft row is gone).
    if (
      replyStatus === "sent" ||
      clusterHasRowPositive ||
      sentDrafts.length > 0 ||
      sentAttempts.length > 0
    ) {
      return deny(
        "already_replied",
        "Message already has a sent reply; refusing duplicate"
      );
    }
    // 2. Ambiguous delivery on a prior attempt (draft OR attempt ledger).
    if (unknownDrafts.length > 0 || unknownAttempts.length > 0) {
      return deny(
        "delivery_unknown",
        "A prior send attempt for this message has an ambiguous delivery outcome; requires human triage"
      );
    }
    // 3. In-flight send (draft sending OR attempt claimed/submitted).
    if (sendingDrafts.length > 0 || inFlightAttempts.length > 0) {
      return deny(
        "reply_in_progress",
        "A send for this message is already in flight"
      );
    }
    // 4. Contradictory records: multiple live drafts across the cluster, or
    //    replyStatus says replied but no sent draft was found, etc.
    if (liveDrafts.length > 1) {
      return deny(
        "reply_state_conflict",
        `Multiple live drafts (${liveDrafts.length}) exist across equivalent rows; requires reconciliation`
      );
    }
    if (
      replyStatus === "blocked" ||
      replyStatus === "skipped"
    ) {
      // The message was deliberately skipped/blocked by policy previously.
      // Allow the legacy evaluator to re-decide (it may have been un-blocked).
      return null;
    }
    // 5. Prior generation failed with no live draft. A definitely-`failed`
    //    draft (B08) is REUSABLE — a definite SMTP rejection means no email was
    //    delivered, so the user may re-approve and retry the same draft without
    //    regenerating. Only when there is no reusable draft at all (truly
    //    stranded state, e.g. replyStatus=failed but the failed draft row was
    //    deleted) do we surface reply_state_unknown for human triage.
    //    `delivery_unknown` drafts are NOT reusable (precedence-2 already
    //    blocked them): an ambiguous outcome might have delivered, and reuse
    //    would risk a duplicate send.
    if (replyStatus === "failed" && liveDrafts.length === 0) {
      const failedDrafts = drafts.filter((d) => d.status === "failed");
      if (pickReusableDraft(failedDrafts) === null) {
        return deny(
          "reply_state_unknown",
          "A prior reply attempt failed; requires human triage before regenerating"
        );
      }
      // A reusable definitely-failed draft exists — fall through so the
      // generation service reuses it by its existing ID (no AI work).
    }
    // Clean (or has exactly one eligible live/failed draft for reuse). Fall
    // through.
    return null;
  }

  private async evaluatePreDraft(
    message: {
      emailServiceId: number;
      fromAddress: string;
      bodyText: string | null;
      classification: string | null;
      classificationConfidence: number | null;
    },
    humanConfirmed = false
  ): Promise<EmailReplyPolicyDecision> {
    const rule = await this.ruleModule
      .getEffectiveRule(message.emailServiceId)
      .catch(() => null);
    // FR-007 §10.1: a stored deterministic-'unknown' at pre_draft is a stage-2
    // REFINEMENT TRIGGER, not a final verdict. Sync persists
    // classifyDeterministic's inconclusive result for ordinary human emails;
    // the generation service refines it via the constrained model classifier
    // right after the guard/reuse checks (B01 ordering) and re-runs this gate
    // on the refined value. Feeding the stage-agnostic evaluator `null`
    // (pending refinement) here is what makes that refinement reachable — a
    // hard block would deadlock drafting before the classifier could run.
    // Pre-send uses the same exemption for a stored `unknown`: by then a
    // human has confirmed the draft, and an inconclusive classification is
    // not a bounce, unsubscribe, or automated-sender block.
    const refinementPending = message.classification === "unknown";
    const decision = evaluateAutoReplyPolicy({
      message: message as never,
      classification: (refinementPending
        ? null
        : message.classification) as never,
      confidence: refinementPending
        ? null
        : message.classificationConfidence,
      rule,
      sendCounts: { todayForService: 0, threadCount: 0 },
      // Reviewed flag: a human-confirmed request exempts the "unsure or
      // sensitive" classification blocks (needs_human_review / unknown) —
      // machine-safety checks stay enforced by the evaluator itself.
      humanConfirmed,
    });
    return mapLegacyDecision(
      decision.status,
      decision.reason,
      rule?.id ?? null
    );
  }

  private async evaluatePreSend(
    message: {
      id: number;
      emailServiceId: number;
      fromAddress: string;
      replyToAddress: string | null;
      bodyText: string | null;
      classification: string | null;
      classificationConfidence: number | null;
    },
    draftId: number | undefined,
    revisionId: number | undefined
  ): Promise<EmailReplyPolicyDecision> {
    if (!draftId) {
      return deny(
        "draft_not_approved",
        "Draft id is required for pre-send policy"
      );
    }

    // 1. Draft existence + mailbox consistency.
    const draft = await this.draftModule.readAggregate(draftId);
    if (!draft) {
      return deny("draft_terminal", "Draft no longer exists");
    }
    const boundServiceId = draft.emailServiceId ?? message.emailServiceId;
    if (
      draft.emailServiceId != null &&
      draft.emailServiceId !== message.emailServiceId
    ) {
      return deny(
        "mailbox_mismatch",
        "Draft mailbox differs from the original message mailbox"
      );
    }

    // 2. Terminal draft state machine (FR-016).
    if (
      draft.status === "sent" ||
      draft.status === "discarded" ||
      draft.status === "delivery_unknown"
    ) {
      return deny(
        "draft_terminal",
        `Draft is in terminal state '${draft.status}'`
      );
    }
    if (draft.status === "sending") {
      return deny(
        "draft_terminal",
        "A send for this draft is already in flight"
      );
    }
    if (draft.status !== "approved" && draft.status !== "failed") {
      return deny(
        "draft_not_approved",
        `Draft must be approved before sending (current state '${draft.status}')`
      );
    }

    // 3. Active approval bound to the current revision (FR-015).
    const resolvedRevisionId =
      revisionId ?? draft.currentRevisionId ?? undefined;
    if (!resolvedRevisionId) {
      return deny("draft_not_approved", "Draft has no current revision");
    }
    const approval = await this.approvalModule.findActiveByDraft(
      draftId,
      resolvedRevisionId
    );
    if (!approval) {
      return deny(
        "approval_stale",
        "No active approval for the draft's current revision"
      );
    }
    if (approval.revisionId !== resolvedRevisionId) {
      return deny(
        "approval_stale",
        "Approval is bound to a different revision"
      );
    }

    // 4. Recipient validity (FR-017).
    if (
      !draft.recipientAddress ||
      !isValidReplyAddress(draft.recipientAddress)
    ) {
      return deny(
        "invalid_recipient",
        "Reply recipient address is missing or invalid"
      );
    }

    // 5. Deterministic hard blocks + sensitive review (reused evaluator).
    const rule = await this.ruleModule
      .getEffectiveRule(boundServiceId)
      .catch(() => null);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayForService = await this.attemptModule.countSentByServiceSince(
      boundServiceId,
      startOfDay
    );
    const threadCount = await this.attemptModule.countAttemptsForMessage(
      message.id
    );
    // Human-confirmed send: `unknown` is inconclusive, not a hard block.
    // Bounce, unsubscribe, auto_reply, and needs_human_review still refuse.
    const confirmedClassification = classificationForConfirmedSend(
      message.classification
    );
    // Confirmed-send rule guardrails: an owner-typed allowlist still applies
    // to a stripped-unknown classification (the evaluator bypasses it for
    // null because the pre-draft refinement path also feeds null).
    const ruleRefusal = confirmedSendRuleRefusal(rule, message.classification);
    if (ruleRefusal != null) {
      return mapLegacyDecision("skipped", ruleRefusal, rule?.id ?? null);
    }
    const legacy = evaluateAutoReplyPolicy({
      message: message as never,
      classification: confirmedClassification as never,
      confidence:
        confirmedClassification == null
          ? null
          : message.classificationConfidence,
      rule,
      sendCounts: { todayForService, threadCount },
    });

    // Hard-block categories forbid sending outright.
    if (legacy.status === "blocked" || legacy.status === "skipped") {
      return mapLegacyDecision(legacy.status, legacy.reason, rule?.id ?? null);
    }
    // Sensitive / low-confidence content may still be sent AFTER explicit human
    // approval in this assisted release; flag it for the audit trail.
    const requiresHumanReview =
      legacy.status === "needs_human_review" ||
      legacy.status === "approval_required";

    return {
      allowed: true,
      requiresHumanReview,
      code: requiresHumanReview ? "sensitive_topic" : "allowed",
      reason: requiresHumanReview
        ? legacy.reason
        : "Approved revision passed send-time policy",
      policyVersion: REPLY_POLICY_VERSION,
      ruleId: rule?.id ?? null,
    };
  }
}

function deny(
  code: EmailReplyPolicyCode,
  reason: string
): EmailReplyPolicyDecision {
  return {
    allowed: false,
    requiresHumanReview: false,
    code,
    reason,
    policyVersion: REPLY_POLICY_VERSION,
    ruleId: null,
  };
}

/** Map the legacy evaluator's status onto the v2 policy code vocabulary. */
export function mapLegacyDecision(
  status: string,
  reason: string,
  ruleId: number | null
): EmailReplyPolicyDecision {
  switch (status) {
    case "blocked":
      return {
        allowed: false,
        requiresHumanReview: false,
        code: classifyBlock(reason),
        reason,
        policyVersion: REPLY_POLICY_VERSION,
        ruleId,
      };
    case "skipped":
      return {
        allowed: false,
        requiresHumanReview: false,
        code: /daily/i.test(reason)
          ? "daily_limit"
          : /thread/i.test(reason)
          ? "thread_limit"
          : "blocked_sender",
        reason,
        policyVersion: REPLY_POLICY_VERSION,
        ruleId,
      };
    case "needs_human_review":
      return {
        allowed: true,
        requiresHumanReview: true,
        code: "sensitive_topic",
        reason,
        policyVersion: REPLY_POLICY_VERSION,
        ruleId,
      };
    case "approval_required":
      return {
        allowed: true,
        requiresHumanReview: true,
        code: "approval_required",
        reason,
        policyVersion: REPLY_POLICY_VERSION,
        ruleId,
      };
    case "draft_created":
    default:
      return {
        allowed: true,
        requiresHumanReview: false,
        code: "allowed",
        reason,
        policyVersion: REPLY_POLICY_VERSION,
        ruleId,
      };
  }
}

/** Refine a generic 'blocked' reason into a specific hard-block code. */
function classifyBlock(reason: string): EmailReplyPolicyCode {
  const r = reason.toLowerCase();
  if (r.includes("bounce")) return "bounce";
  if (r.includes("unsubscribe")) return "unsubscribe";
  if (r.includes("auto_reply") || r.includes("automated") || r.includes("no-reply"))
    return "automated_sender";
  if (r.includes("domain")) return "blocked_domain";
  // Classification hard-block reasons carry the classification literal:
  // 'needs_human_review' is a sensitive topic, 'unknown' is an undecided
  // classification (pre-send / non-tool producers). Both were previously
  // falling through to the misleading generic blocked_sender.
  if (r.includes("needs_human_review") || r.includes("sensitive"))
    return "sensitive_topic";
  if (r.includes("unknown")) return "classification_unknown";
  if (r.includes("sender") || r.includes("pattern")) return "blocked_sender";
  return "blocked_sender";
}

/** Minimal RFC-822-ish address validity check for the reply recipient. */
export function isValidReplyAddress(address: string): boolean {
  const trimmed = address.trim();
  if (!trimmed || trimmed.length > 320) return false;
  // One local part token, one @, a domain with at least one dot. Conservative.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/**
 * Find an eligible existing draft for a message that the generation service
 * can REUSE instead of regenerating (FR-028, B08). Returns the most recent
 * draft with status `draft` (editable), `approved` (ready to send), or `failed`
 * (definitely-rejected; safe to re-approve and retry — no email was
 * delivered), or `null` when none exists.
 *
 * `draft`/`approved` are preferred over `failed`: when a live editable draft
 * and a failed sibling both exist, the newer live work wins (a `failed`
 * sibling is a dead end the user already abandoned or the system retried
 * from). `listByMessage` orders by `id DESC`, so iterating in order and
 * picking the first eligible yields the newest eligible draft of the
 * highest-precedence status class.
 *
 * `delivery_unknown` is NEVER reusable (B08): an ambiguous outcome might have
 * delivered, and reuse would risk a duplicate send. The message-level guard
 * blocks `delivery_unknown` at precedence-2 before this function is reached,
 * but the exclusion here is defense-in-depth.
 *
 * The message-level guard must have already cleared the message
 * (no `sent`/in-flight/`delivery_unknown`/conflict state) for reuse to be safe.
 */
export function pickReusableDraft(
  drafts: readonly EmailReplyDraftEntity[]
): EmailReplyDraftEntity | null {
  // listByMessage orders by id DESC, so the first eligible is the newest.
  // First pass: prefer a live editable/approved draft.
  for (const d of drafts) {
    if (d.status === "draft" || d.status === "approved") {
      return d;
    }
  }
  // Second pass: a definitely-failed draft is reusable (B08). No email was
  // delivered on a definite SMTP rejection, so the user may re-approve and
  // retry the same draft without regenerating.
  for (const d of drafts) {
    if (d.status === "failed") {
      return d;
    }
  }
  return null;
}
