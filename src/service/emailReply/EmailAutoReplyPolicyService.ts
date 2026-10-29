import type { EmailReceivedMessageEntity } from "@/entity/EmailReceivedMessage.entity";
import type { EmailAutoReplyRuleEntity } from "@/entity/EmailAutoReplyRule.entity";
import type {
  EmailMessageClassification,
  EmailAutoReplyDecisionStatus,
} from "@/entityTypes/emailReceiveTypes";
import {
  isAutomatedSender,
  replyRecipientAddress,
} from "@/service/emailReceive/EmailMessageParser";

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
  /**
   * True when a human explicitly asked for this reply in conversation
   * (`reviewed` on the AI tool / `humanReviewed` on the UI IPC). Exempts ONLY
   * the classification-family blocks that mean "unsure or sensitive"
   * (`needs_human_review`, defensively `unknown`) — never the machine-safety
   * blocks (bounce, auto_reply, unsubscribe), recipient automation checks,
   * blocked patterns, or limits.
   */
  readonly humanConfirmed?: boolean;
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

/**
 * Classifications that must never receive an unattended auto reply.
 *
 * `unknown` stays in this set so a direct evaluator call cannot treat an
 * inconclusive verdict as permission to auto-send. A human-confirmed send
 * strips it first via {@link classificationForConfirmedSend}: the user
 * already reviewed the draft, and `unknown` only means the deterministic
 * rules were inconclusive. A stored `needs_human_review` follows the same
 * human-reviewed path (stripped by the same helper for confirmed sends, and
 * exempt in {@link evaluateAutoReplyPolicy} when `humanConfirmed` is set):
 * the classification asks FOR human review, and the confirmed send is that
 * review happening. Bounce, auto_reply, and unsubscribe stay in this set in
 * every path — machine-safety blocks are never overridable by a gesture.
 */
const BLOCKED_CLASSIFICATIONS: ReadonlySet<EmailMessageClassification> = new Set([
  "bounce",
  "auto_reply",
  "unsubscribe",
  "needs_human_review",
  "unknown",
]);

/**
 * Classification passed into {@link evaluateAutoReplyPolicy} for a
 * human-confirmed send (draft approval or pre-send).
 *
 * A stored `unknown` is not evidence of a bounce, list, or unsubscribe.
 * A stored `needs_human_review` means the topic/sender needed human review —
 * and a confirmed send (explicit human approval or request-scoped tool
 * confirmation) IS that human review completing, the same intent the
 * pre-send sensitive-keyword path already encodes ("may still be sent AFTER
 * explicit human approval in this assisted release"). Returning null for
 * both lets the confirmed send proceed, flagged via `requiresHumanReview`.
 * Bounce, auto-reply, and unsubscribe are returned unchanged and still block:
 * machine-safety rules are not overridable by a human gesture.
 */
export function classificationForConfirmedSend(
  classification: string | null | undefined
): string | null {
  if (
    classification == null ||
    classification === "unknown" ||
    classification === "needs_human_review"
  ) {
    return null;
  }
  return classification;
}

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
 * Rule guardrails a CONFIRMED send (draft approval / pre-send) must still
 * honor after {@link classificationForConfirmedSend} strips a stored
 * `unknown` to null.
 *
 * The evaluator itself bypasses the allowlist for null classification
 * because the PRE-DRAFT gate also feeds null while classification
 * refinement is pending — enforcing it there would deadlock refinement.
 * This helper closes the confirmed-send side only: an owner-typed
 * allowlist is an explicit restriction, so an unclassified message must be
 * LISTED (allow "unknown" explicitly) to pass.
 *
 * The rule's confidence threshold is deliberately NOT enforced here: it
 * defaults to 0.7 on every row, so enforcing it for stripped-unknown would
 * refuse every unclassified confirmed send on rule-bearing mailboxes and
 * recreate the send deadlock the unknown exemption fixed.
 *
 * Returns a refusal reason, or null when the rule permits the send.
 */
export function confirmedSendRuleRefusal(
  rule: EmailAutoReplyRuleEntity | null | undefined,
  storedClassification: string | null | undefined
): string | null {
  if (!rule || rule.enabled !== 1) return null;
  const allowed = parseStringArray(rule.allowedClassificationsJson);
  if (allowed.length === 0) return null;
  const effective =
    storedClassification == null || storedClassification === "unknown"
      ? "unknown"
      : storedClassification;
  if (!allowed.includes(effective)) {
    return `Classification '${effective}' is not allowed by rule '${rule.name}'`;
  }
  return null;
}

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
  const { message, classification, confidence, rule, sendCounts, humanConfirmed } = input;

  // 1. Loop prevention: never reply to an automated mailbox. The address
  // that would receive the reply is Reply-To when present, otherwise From.
  // This is the inbound message, not the mailbox's configured send address.
  const recipient = replyRecipientAddress(
    message.fromAddress,
    message.replyToAddress
  );
  if (isAutomatedSender({ fromAddress: recipient })) {
    return blocked(
      `Reply recipient "${recipient}" is an automated/no-reply address. ` +
        "This check uses the inbound message From or Reply-To, not the mailbox's configured send address."
    );
  }

  // 2. Classification hard block.
  //
  // `humanConfirmed` (reviewed flag): a human explicitly asked for this reply
  // in conversation, which resolves the "unsure / needs review" family.
  // Machine-safety classifications (bounce, auto_reply, unsubscribe) stay
  // hard-blocked — they are not human-review-able topics.
  const humanReviewClassExempt =
    humanConfirmed === true &&
    (classification === "needs_human_review" || classification === "unknown");
  if (
    classification &&
    BLOCKED_CLASSIFICATIONS.has(classification) &&
    !humanReviewClassExempt
  ) {
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
  // NOTE: a null classification legitimately bypasses the allowlist and the
  // confidence threshold here — the pre-draft gate feeds null while
  // classification refinement is pending (a hard block would deadlock the
  // refinement flow), and confirmed-send callers enforce their own rule
  // guardrails via confirmedSendRuleRefusal instead.
  if (rule && rule.enabled === 1) {
    const allowed = parseStringArray(rule.allowedClassificationsJson);
    if (classification && allowed.length > 0 && !allowed.includes(classification)) {
      return skipped(`Classification '${classification}' is not allowed by rule '${rule.name}'`);
    }

    // Blocked patterns test BOTH the From address and the address the reply
    // would actually go to (Reply-To when present) — a blocked sender can
    // otherwise redirect replies past the blocklist via Reply-To.
    const blockedSenders = parseStringArray(rule.blockedSenderPatternsJson);
    const fromAddress = message.fromAddress ?? "";
    if (
      blockedSenders.some(
        (p) => matchesPattern(fromAddress, p) || matchesPattern(recipient, p)
      )
    ) {
      return blocked(
        `Sender or reply recipient matches a blocked pattern in rule '${rule.name}'`
      );
    }

    const blockedDomains = parseStringArray(rule.blockedDomainPatternsJson);
    if (blockedDomains.length > 0) {
      const domains = [fromAddress, recipient]
        .map((addr) => (addr.split("@")[1] ?? "").toLowerCase())
        .filter((d) => d.length > 0);
      const hit = domains.find((d) =>
        blockedDomains.some((p) => matchesPattern(d, p))
      );
      if (hit) {
        return blocked(
          `Domain '${hit}' is blocked by rule '${rule.name}'`
        );
      }
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
