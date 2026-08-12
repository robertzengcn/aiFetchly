/**
 * Domain types for the Thread-Aware AI Email Reply Reliability feature
 * (Milestone 1: Send Safety Foundation).
 *
 * Implements docs/prd/ai-email-thread-aware-reply-reliability-prd.md and the
 * matching technical design §5. These unions/interfaces are reused by entities,
 * models, services, IPC schemas, and audit so that reply/delivery state stays
 * consistent across every layer.
 *
 * Design notes:
 *  - All types here are renderer-safe (no secrets). Envelope types are used to
 *    derive a canonical SHA-256 hash and never carry credentials or raw prompts.
 *  - Model confidence never authorizes a send (AD-008); deterministic rules,
 *    approval state, revision hash, mailbox binding, and the state machine are
 *    authoritative.
 */

/** Lifecycle of a send attempt (EmailReplySendAttemptEntity.status). */
export type EmailReplySendAttemptStatus =
  | "claimed"
  | "submitted"
  | "sent"
  | "failed"
  | "delivery_unknown";

/** Policy evaluation stage. `pre_draft` gates drafting; `pre_send` gates SMTP. */
export type EmailReplyPolicyStage = "pre_draft" | "pre_send";

/**
 * Machine-readable policy reason codes. UI maps each code to a translated
 * string; backend free-form English is never shown as primary copy (FR-023).
 */
export type EmailReplyPolicyCode =
  | "allowed"
  | "approval_required"
  | "automated_sender"
  | "bounce"
  | "unsubscribe"
  | "blocked_sender"
  | "blocked_domain"
  | "sensitive_topic"
  | "invalid_recipient"
  | "mailbox_mismatch"
  | "daily_limit"
  | "thread_limit"
  | "classification_unknown"
  | "context_ambiguous"
  | "draft_not_approved"
  | "approval_stale"
  | "draft_terminal";

/** Authoritative decision returned by the policy orchestrator. */
export interface EmailReplyPolicyDecision {
  readonly allowed: boolean;
  readonly requiresHumanReview: boolean;
  readonly code: EmailReplyPolicyCode;
  readonly reason: string;
  readonly policyVersion: string;
  readonly ruleId: number | null;
}

/**
 * Canonical envelope hashed to bind approval to exact content + delivery target.
 *
 * Hashing rules (technical design §14.1):
 *  - fixed property order through explicit object construction
 *  - CRLF normalized to LF for text hashing
 *  - only the validated email address *domain part* is lowercased; local parts
 *    are preserved verbatim
 *  - UTF-8 bytes
 *
 * Do NOT hash `JSON.stringify()` over arbitrary entity objects: key order and
 * extra fields are unstable.
 */
export interface EmailReplyApprovalEnvelope {
  readonly draftId: number;
  readonly revisionId: number;
  readonly emailServiceId: number;
  readonly originalMessageId: number;
  readonly senderAddress: string;
  readonly recipientAddress: string;
  readonly subject: string;
  readonly bodyText: string;
  readonly bodyHtml: string | null;
  readonly policyVersion: string;
  readonly validationVersion: string;
}

/** Input to {@link EmailReplyPolicyOrchestrator.evaluate}. */
export interface EvaluateReplyPolicyInput {
  readonly stage: EmailReplyPolicyStage;
  readonly messageId: number;
  readonly draftId?: number;
  readonly revisionId?: number;
  readonly approvalId?: number;
}

/** Who/what created an approval record. */
export type EmailReplyApprovedByType = "user" | "tool_confirmation";

/** Input to the idempotent approved-send entry point. */
export interface SendApprovedReplyInput {
  readonly draftId: number;
  /**
   * Opaque one-time approval token issued by {@link EmailReplyApprovalService}.
   * The main process may instead hold an approval handle; both reach delivery
   * through this field. The raw token is never logged or returned to the LLM.
   */
  readonly approvalToken: string;
}

/**
 * Outcome of an approved send. SMTP is outside DB transactions (AD-007), so an
 * uncertain outcome after possible provider acceptance is `delivery_unknown`,
 * never automatically retried (FR-019).
 */
export type SendApprovedReplyOutcome =
  | { readonly status: "sent"; readonly attemptId: number; readonly sentAt: string }
  | { readonly status: "failed"; readonly attemptId: number; readonly error: string }
  | {
      readonly status: "delivery_unknown";
      readonly attemptId: number;
      readonly error: string;
    }
  | { readonly status: "already_processed"; readonly attemptId: number };

/**
 * How certain we are about an SMTP submission outcome (technical design §15.4).
 *
 * Nodemailer errors are NOT assumed to be definite rejections: only known
 * pre-acceptance validation/connection/provider-rejection cases map to
 * `definitely_rejected`. `unknown` is the safe default once submission begins.
 */
export type EmailSubmissionCertainty =
  | "accepted"
  | "definitely_rejected"
  | "unknown";

/** Result of classifying a raw SMTP send result into a certainty level. */
export interface ClassifiedSubmissionResult {
  readonly accepted: boolean;
  readonly certainty: EmailSubmissionCertainty;
  readonly providerMessageId: string | null;
  readonly sanitizedError: string | null;
}
