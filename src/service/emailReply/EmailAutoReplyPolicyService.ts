import type { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import type { EmailAutoReplyRuleEntity } from "@/entity/EmailAutoReplyRule.entity";
import type {
  EmailMessageClassification,
  EmailAutoReplyDecisionStatus,
} from "@/entityTypes/emailReceiveTypes";
import { isAutomatedSender } from "@/service/emailReceive/EmailMessageParser";

/** Inputs to the policy evaluator. */
export interface EmailAutoReplyPolicyInput {
  readonly message: EmailReceivedMessageEntity;
  readonly classification: EmailMessageClassification | null;
  readonly confidence: number | null;
  readonly rule: EmailAutoReplyRuleEntity | null;
  readonly sendCounts: {
    readonly todayForService: number;
    readonly threadCount: number;
  };
}

/** The evaluator's decision. */
export interface EmailAutoReplyPolicyDecision {
  readonly status: EmailAutoReplyDecisionStatus;
  readonly reason: string;
  /**
   * MVP: ALWAYS false. Auto-send is disabled; sending requires explicit user
   * confirmation. The flag exists so a future phase can flip it per-rule.
   */
  readonly canSendAutomatically: boolean;
}

/** Classifications that must never receive a normal sales/auto reply. */
const BLOCKED_CLASSIFICATIONS: ReadonlySet<EmailMessageClassification> = new Set([
  "bounce",
  "auto_reply",
  "unsubscribe",
  "needs_human_review",
  "unknown",
]);

/** Body keywords that signal a sensitive request requiring human review. */
const SENSITIVE_KEYWORDS: readonly string[] = [
  "refund",
  "cancel my account",
  "delete my account",
  "legal action",
  "lawsuit",
  "attorney",
  "gdpr",
  "credit card",
  "social security",
  "password reset",
];

/**
 * Evaluates whether an inbound message may be auto-replied to. Pure function —
 * no DB writes; the caller writes the {@link EmailAutoReplyAuditLog} row.
 *
 * Phase 1 policy: never auto-send. Every evaluation returns
 * `canSendAutomatically === false`; the {@link status} + {@link reason} tell
 * the audit UI whether the message needs approval, was blocked, or was skipped.
 */
export function evaluateAutoReplyPolicy(
  input: EmailAutoReplyPolicyInput
): EmailAutoReplyPolicyDecision {
  const { message, classification, confidence, rule, sendCounts } = input;

  // 1. Loop prevention: never reply to automated senders.
  if (isAutomatedSender({ fromAddress: message.fromAddress })) {
    return blocked("Sender is an automated/no-reply address");
  }

  // 2. Classification hard block.
  if (classification && BLOCKED_CLASSIFICATIONS.has(classification)) {
    return blocked(`Classification '${classification}' must not be auto-replied`);
  }

  // 3. Sensitive content → human review.
  const bodyText = (message.bodyText ?? "").toLowerCase();
  if (SENSITIVE_KEYWORDS.some((kw) => bodyText.includes(kw))) {
    return {
      status: "needs_human_review",
      reason: "Message mentions a sensitive topic (refund, legal, credentials, etc.)",
      canSendAutomatically: false,
    };
  }

  // 4. Rule-driven checks (only when a rule exists).
  if (rule && rule.enabled === 1) {
    const allowed = parseStringArray(rule.allowedClassificationsJson);
    if (classification && allowed.length > 0 && !allowed.includes(classification)) {
      return skipped(`Classification '${classification}' is not allowed by rule '${rule.name}'`);
    }

    const blockedSenders = parseStringArray(rule.blockedSenderPatternsJson);
    if (blockedSenders.some((p) => matchesPattern(message.fromAddress, p))) {
      return blocked(`Sender matches a blocked pattern in rule '${rule.name}'`);
    }

    const blockedDomains = parseStringArray(rule.blockedDomainPatternsJson);
    const domain = (message.fromAddress.split("@")[1] ?? "").toLowerCase();
    if (domain && blockedDomains.some((p) => matchesPattern(domain, p))) {
      return blocked(`Domain '${domain}' is blocked by rule '${rule.name}'`);
    }

    // 5. Limits.
    if (sendCounts.todayForService >= rule.dailySendLimit) {
      return skipped("Daily send limit reached for this inbox");
    }
    if (sendCounts.threadCount >= rule.perThreadReplyLimit) {
      return skipped("Per-thread reply limit reached");
    }

    // 6. Confidence threshold.
    const threshold = rule.confidenceThreshold;
    if (confidence != null && confidence < threshold) {
      return {
        status: "approval_required",
        reason: `Confidence ${confidence.toFixed(2)} is below threshold ${threshold}`,
        canSendAutomatically: false,
      };
    }
  }

  // 7. Default: a draft may be created, but a human must approve before send.
  return {
    status: "draft_created",
    reason: "Draft created; user approval required before sending (Phase 1)",
    canSendAutomatically: false,
  };
}

function blocked(reason: string): EmailAutoReplyPolicyDecision {
  return { status: "blocked", reason, canSendAutomatically: false };
}
function skipped(reason: string): EmailAutoReplyPolicyDecision {
  return { status: "skipped", reason, canSendAutomatically: false };
}

function parseStringArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map((s) => String(s)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Case-insensitive substring match (simple, predictable for MVP patterns). */
function matchesPattern(value: string, pattern: string): boolean {
  if (!pattern) return false;
  return value.toLowerCase().includes(pattern.toLowerCase());
}
