import type {
  EmailReplyPolicyDecision,
  EmailReplyPolicyCode,
  EmailReplyPolicyStage,
} from "@/entityTypes/emailReplyReliabilityTypes";
import { REPLY_POLICY_VERSION } from "@/service/emailReply/replyReliabilityVersions";
import { evaluateAutoReplyPolicy } from "@/service/emailReply/EmailAutoReplyPolicyService";
import { EmailReplyDraftModule } from "@/modules/EmailReplyDraftModule";
import { EmailReplyApprovalModule } from "@/modules/EmailReplyApprovalModule";
import { EmailReplySendAttemptModule } from "@/modules/EmailReplySendAttemptModule";
import { EmailReceivedMessageModule } from "@/modules/EmailReceivedMessageModule";
import { EmailAutoReplyRuleModule } from "@/modules/EmailAutoReplyRuleModule";

/**
 * Single authoritative policy gate for the reply pipeline (technical design
 * §10, AD-006). Both the draft path (pre_draft) and the send path (pre_send)
 * MUST go through here; no IPC or AI tool may bypass it.
 *
 * Milestone 1 focuses on the send-time gate (FR-006): mailbox binding, terminal
 * draft states, recipient validity, approval freshness/hash, and the existing
 * deterministic hard blocks from {@link evaluateAutoReplyPolicy}. Model
 * confidence never authorizes anything (AD-008).
 */
export class EmailReplyPolicyOrchestrator {
  private readonly draftModule = new EmailReplyDraftModule();
  private readonly approvalModule = new EmailReplyApprovalModule();
  private readonly attemptModule = new EmailReplySendAttemptModule();
  private readonly messageModule = new EmailReceivedMessageModule();
  private readonly ruleModule = new EmailAutoReplyRuleModule();

  async evaluate(input: {
    stage: EmailReplyPolicyStage;
    messageId: number;
    draftId?: number;
    revisionId?: number;
  }): Promise<EmailReplyPolicyDecision> {
    try {
      const message = await this.messageModule.read(input.messageId);
      if (!message) {
        return deny("invalid_recipient", "Original message no longer exists");
      }

      if (input.stage === "pre_draft") {
        return this.evaluatePreDraft(message);
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

  private async evaluatePreDraft(message: {
    emailServiceId: number;
    fromAddress: string;
    bodyText: string | null;
    classification: string | null;
    classificationConfidence: number | null;
  }): Promise<EmailReplyPolicyDecision> {
    const rule = await this.ruleModule
      .getEffectiveRule(message.emailServiceId)
      .catch(() => null);
    const decision = evaluateAutoReplyPolicy({
      message: message as never,
      classification: message.classification as never,
      confidence: message.classificationConfidence,
      rule,
      sendCounts: { todayForService: 0, threadCount: 0 },
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
    const legacy = evaluateAutoReplyPolicy({
      message: message as never,
      classification: message.classification as never,
      confidence: message.classificationConfidence,
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
  if (r.includes("automated") || r.includes("no-reply"))
    return "automated_sender";
  if (r.includes("domain")) return "blocked_domain";
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
