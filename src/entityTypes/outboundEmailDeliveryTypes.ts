import { z } from "zod/v4";
import type { EmailServiceEntitydata } from "@/entityTypes/emailmarketingType";

/**
 * Domain types and Zod boundary schemas for intent-aware outbound email
 * delivery (technical design §6). The delivery decision (send_now /
 * review_first / draft_only) is derived from trusted user-authored
 * conversation state; the model may never supply it.
 *
 * IMPORTANT: no `any`. Every cross-process or persisted boundary is validated
 * with a Zod schema. Types are derived from schemas where they describe
 * untrusted data.
 */

// ---------------------------------------------------------------------------
// §6 Enums
// ---------------------------------------------------------------------------

export const outboundEmailDeliveryModeSchema = z.enum([
  "send_now",
  "review_first",
  "draft_only",
]);
export type OutboundEmailDeliveryMode = z.infer<
  typeof outboundEmailDeliveryModeSchema
>;

export const outboundEmailIntentReasonCodeSchema = z.enum([
  "explicit_send_instruction",
  "explicit_review_instruction",
  "explicit_do_not_send",
  "conflicting_instruction",
  "ambiguous_instruction",
  "contextual_affirmation",
  "resolver_failure",
]);
export type OutboundEmailIntentReasonCode = z.infer<
  typeof outboundEmailIntentReasonCodeSchema
>;

export const outboundEmailBatchStatusSchema = z.enum([
  "drafting",
  "draft_ready",
  "preflight_failed",
  "awaiting_review",
  "direct_authorized",
  "review_authorized",
  "queued",
  "sending",
  "partially_sent",
  "sent",
  "delivery_unknown",
  "failed",
  "discarded",
]);
export type OutboundEmailBatchStatus = z.infer<
  typeof outboundEmailBatchStatusSchema
>;

export const outboundEmailDraftStatusSchema = z.enum([
  "draft",
  "invalid",
  "authorized",
  "queued",
  "submitted",
  "sent",
  "delivery_unknown",
  "failed",
  "discarded",
]);
export type OutboundEmailDraftStatus = z.infer<
  typeof outboundEmailDraftStatusSchema
>;

export const outboundEmailAuthorizationTypeSchema = z.enum([
  "explicit_user_instruction",
  "exact_draft_approval",
]);
export type OutboundEmailAuthorizationType = z.infer<
  typeof outboundEmailAuthorizationTypeSchema
>;

export const outboundEmailAuthorizationStatusSchema = z.enum([
  "active",
  "consumed",
  "invalidated",
  "expired",
]);
export type OutboundEmailAuthorizationStatus = z.infer<
  typeof outboundEmailAuthorizationStatusSchema
>;

export const outboundEmailSendAttemptStatusSchema = z.enum([
  "claimed",
  "worker_starting",
  "sending",
  "completed",
  "partially_completed",
  "delivery_unknown",
  "failed",
]);
export type OutboundEmailSendAttemptStatus = z.infer<
  typeof outboundEmailSendAttemptStatusSchema
>;

export const outboundEmailRecipientOutcomeStatusSchema = z.enum([
  "pending",
  "submitted",
  "sent",
  "suppressed",
  "failed",
  "delivery_unknown",
]);
export type OutboundEmailRecipientOutcomeStatus = z.infer<
  typeof outboundEmailRecipientOutcomeStatusSchema
>;

// ---------------------------------------------------------------------------
// §6.1 Intent decision
// ---------------------------------------------------------------------------

export const outboundEmailIntentEvidenceSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    normalizedPhrase: z.string(),
    category: z.enum(["send", "review", "negation", "affirmation"]),
  })
  .refine((e) => e.end >= e.start, {
    message: "evidence end offset must be >= start offset",
  });
export type OutboundEmailIntentEvidence = z.infer<
  typeof outboundEmailIntentEvidenceSchema
>;

export interface OutboundEmailIntentDecision {
  id: number;
  conversationId: string;
  sourceUserMessageId: string;
  mode: OutboundEmailDeliveryMode;
  reasonCode: OutboundEmailIntentReasonCode;
  confidence: number;
  evidence: OutboundEmailIntentEvidence[];
  resolverVersion: string;
  sourceTextHash: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// §6.2 Canonical envelope (the immutable per-recipient delivery unit)
// ---------------------------------------------------------------------------

export const authorizedOutboundEnvelopeSchema = z.object({
  draftId: z.number().int(),
  revisionId: z.number().int(),
  revisionNumber: z.number().int(),
  recipientAddress: z.string().max(320),
  emailServiceId: z.number().int(),
  senderAddress: z.string().max(320),
  subject: z.string().max(500),
  bodyText: z.string(),
  bodyHtml: z.string().nullable(),
  envelopeHash: z.string().length(64),
});
export type AuthorizedOutboundEnvelope = z.infer<
  typeof authorizedOutboundEnvelopeSchema
>;

// ---------------------------------------------------------------------------
// §6.3 Versioned worker payload (discriminated; legacy campaign format stays)
// ---------------------------------------------------------------------------

// emailServices are narrowed to the strong EmailServiceEntitydata type at the
// worker boundary. The schema validates the envelope-shape-only fields that
// cross process boundaries; credential-carrying service rows are trusted main-
// process state loaded after authorization.
export const authorizedEmailWorkerPayloadV2Schema = z.object({
  version: z.literal(2),
  mode: z.literal("authorized_envelopes"),
  batchId: z.number().int(),
  sendAttemptId: z.number().int(),
  batchHash: z.string().length(64),
  envelopes: z.array(authorizedOutboundEnvelopeSchema),
  emailServices: z.array(z.unknown()),
});
export type AuthorizedEmailWorkerPayloadV2 = Omit<
  z.infer<typeof authorizedEmailWorkerPayloadV2Schema>,
  "emailServices"
> & { emailServices: EmailServiceEntitydata[] };

// ---------------------------------------------------------------------------
// §6.4 Typed worker events (correlated by batch+attempt+draft+revision+hash)
// ---------------------------------------------------------------------------

export interface AuthorizedEmailWorkerEventSubmitted {
  type: "authorized-email-submitted";
  batchId: number;
  sendAttemptId: number;
  draftId: number;
  revisionId: number;
  envelopeHash: string;
  providerMessageId: string | null;
}

export interface AuthorizedEmailWorkerEventFailed {
  type: "authorized-email-failed";
  batchId: number;
  sendAttemptId: number;
  draftId: number;
  revisionId: number;
  envelopeHash: string;
  errorCode: string;
  retrySafety: "safe" | "unknown";
}

export interface AuthorizedEmailWorkerEventComplete {
  type: "authorized-email-worker-complete";
  batchId: number;
  sendAttemptId: number;
}

export type AuthorizedEmailWorkerEvent =
  | AuthorizedEmailWorkerEventSubmitted
  | AuthorizedEmailWorkerEventFailed
  | AuthorizedEmailWorkerEventComplete;

// ---------------------------------------------------------------------------
// §14.2 Tool gate result
// ---------------------------------------------------------------------------

export type OutboundEmailToolGateResult =
  | { allowed: true; batchId: number; authorizationId: number }
  | {
      allowed: false;
      code:
        | "draft_required"
        | "review_required"
        | "authorization_missing"
        | "authorization_expired"
        | "authorization_invalidated"
        | "batch_hash_mismatch"
        | "permission_denied";
      batchId: number | null;
    };

// ---------------------------------------------------------------------------
// §12 Preflight result
// ---------------------------------------------------------------------------

export interface OutboundEmailPreflightFinding {
  readonly recipientAddress: string | null;
  readonly code: string;
  readonly message: string;
  readonly severity: "block" | "warning";
}

export interface OutboundEmailPreflightResult {
  passed: boolean;
  batchHash: string | null;
  policyVersion: string;
  validationVersion: string;
  findings: OutboundEmailPreflightFinding[];
}

// ---------------------------------------------------------------------------
// §9.1 Resolver input
// ---------------------------------------------------------------------------

export interface ResolveOutboundEmailIntentInput {
  conversationId: string;
  sourceUserMessageId: string;
  userAuthoredText: string;
  previousAssistantMessageId: string | null;
  previousAssistantText: string | null;
}

// ---------------------------------------------------------------------------
// §13 Authorization / review approval inputs
// ---------------------------------------------------------------------------

export interface DirectSendAuthorizationInput {
  readonly conversationId: string;
  readonly sourceUserMessageId: string;
  readonly intentDecisionId: number;
  readonly batchId: number;
}

export interface ReviewApprovalResult {
  readonly authorizationId: number;
  /** Returned once; only the SHA-256 hash is persisted. */
  readonly token: string;
  readonly batchHash: string;
}
