import { z } from "zod";
import type {
  EmailMessageClassification,
  EmailReplyStatus,
} from "@/entityTypes/emailReceiveTypes";
import type { EmailReplyPolicyCode } from "@/entityTypes/emailReplyReliabilityTypes";

/**
 * Result envelope for email receive/reply AI tools. Mirrors the
 * {@link EmailMarketingAiToolResult} shape so the chat tool pipeline can treat
 * every tool result uniformly.
 *
 * The failure shape carries an optional stable `code` (FR-033) so the LLM and
 * downstream UI can branch on a machine-readable reason instead of parsing
 * English out of `error`. `existing_draft_id` is set when a draft already
 * exists for the message (reuse path or a refusal that leaves a prior draft in
 * place); `next_action` is a short hint the model can surface to the user
 * ("approve_existing_draft" / "discard_and_retry" / "await_human_review").
 */
export type EmailReceiveAiToolResult<T> =
  | ({ success: true } & T & Record<string, unknown>)
  | {
      success: false;
      error: string;
      validation_errors?: string[];
      /** Stable policy reason code; present on policy refusals, absent on input errors. */
      code?: EmailReplyPolicyCode;
      /** Set when a live draft already exists for the message (reuse or refusal). */
      existing_draft_id?: number;
      /** Short machine-readable hint for the model to suggest a next step. */
      next_action?:
        | "approve_existing_draft"
        | "discard_and_retry"
        | "await_human_review"
        | "no_action";
      /**
       * Per-invocation request correlation id (R19). Propagated from the
       * generation/delivery service when it provided one, so a tool/IPC refusal
       * can be joined to the lifecycle audits written under the same id.
       * Absent on input-validation failures (no service call was made).
       */
      requestCorrelationId?: string;
    };

// ---- Input schemas (zod, parsed inside the service layer) ----

const emailReceiveId = z.coerce.number().int().positive();

export const listEmailInboxesSchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
});

export const fetchUnreadEmailsSchema = z.object({
  email_service_id: emailReceiveId,
  folder: z.string().trim().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  unread_only: z.coerce.boolean().default(true),
  since: z.string().datetime().optional(),
});

export const getEmailMessageSchema = z.object({
  message_id: emailReceiveId,
  include_body: z.coerce.boolean().default(true),
  // Marking read is opt-in: a read tool should not mutate mailbox state as a
  // side effect unless the caller asks for it.
  mark_read: z.coerce.boolean().default(false),
});

export const createEmailReplyDraftSchema = z.object({
  message_id: emailReceiveId,
  tone: z.string().trim().max(100).optional(),
  goal: z.string().trim().max(1000).optional(),
  extra_instructions: z.string().trim().max(2000).optional(),
  use_knowledge_library: z.coerce.boolean().default(true),
});

export const sendEmailReplySchema = z.object({
  draft_id: emailReceiveId,
  email_service_id: emailReceiveId.optional(),
});

export const markEmailProcessedSchema = z.object({
  message_id: emailReceiveId,
  status: z.enum(["skipped", "blocked", "failed", "needs_human_review"]),
  reason: z.string().trim().max(500).optional(),
});

/**
 * FR-032: diagnostic reply-check tool. Returns the three-state detection
 * evidence (replied / not_replied / unknown) for a stored inbound message.
 * Read-only — does not mutate the mailbox and needs no confirmation. Ordinary
 * cache behavior (no forceRefresh) per §7.3.
 */
export const checkEmailRepliedSchema = z.object({
  message_id: emailReceiveId,
});

// ---- Result DTOs (no secrets, no raw credentials) ----

/** Summary of a receive-enabled inbox. No passwords/tokens. */
export interface AiEmailInboxSummary {
  id: number;
  name: string;
  emailAddress: string;
  host: string;
  folder: string;
  status: number;
  receiveEnabled: boolean;
  receiveProtocol: string;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

/**
 * Three-state reply evidence for an inbound message, derived from the
 * persisted evidence columns (FR-030/FR-033). Separate from the coarse
 * {@link AiEmailMessageSummary.replyStatus} projection: after R11, a freshly
 * observed `\Answered` flag is sticky positive EVIDENCE and is no longer
 * projected into `replyStatus` (which stays app-delivery-owned). The AI needs
 * the evidence to explain why a `not_started` row is still blocked.
 *
 * `replied` follows the detection vocabulary (FR-031): `true` = sticky
 * positive observed (mailbox flag or sent-search match); `false` = a complete
 * negative observation is stored; `null` = no evidence yet / inconclusive. An
 * `unknown` is NEVER a false negative — missing/legacy rows surface as `null`.
 *
 * Only safe, low-cardinality fields — never credentials, raw mailbox
 * exceptions, matched body content, or internal detector state (FR-039).
 */
export interface AiEmailReplyEvidence {
  /** `true` / `false` / `null` (null = no stored evidence yet). */
  replied: boolean | null;
  /** ISO of the sticky first-positive detection time; never cleared. */
  replyDetectedAt: string | null;
  /**
   * Which source produced the sticky positive (`mailbox_flag` /
   * `sent_search`), or `null` when no positive evidence exists.
   */
  replyDetectionSource: string | null;
  /**
   * ISO of the last complete negative observation; null when no negative was
   * stored (positive or never-checked).
   */
  replyNegativeCheckAt: string | null;
  /** True when the raw IMAP `\Answered` flag was observed at last flag check. */
  answeredFlagObserved: boolean;
  /** ISO of the last provider flag check; null when never checked. */
  answeredFlagCheckedAt: string | null;
}

/** Summary of a stored received message. No body content. */
export interface AiEmailMessageSummary {
  id: number;
  emailServiceId: number;
  providerUid: string;
  messageId: string | null;
  threadKey: string | null;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  receivedAt: string;
  isUnread: boolean;
  classification: EmailMessageClassification | null;
  replyStatus: EmailReplyStatus;
  /**
   * Three-state persisted reply evidence (G02/FR-033). Lets the AI explain
   * blocking on a `not_started`/`sent` row without a separate detection call.
   */
  replyEvidence: AiEmailReplyEvidence;
}

/** Detailed view of one stored message, with sanitized body. */
export interface AiEmailMessageDetail extends AiEmailMessageSummary {
  replyToAddress: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  snippet: string | null;
  bodyText: string | null;
  bodyHtmlSanitized: string | null;
  isAutomatedSender: boolean;
}

/** A knowledge-library source used to ground a reply. */
export interface EmailReplyKnowledgeSource {
  chunkId: number;
  documentId: number;
  documentName: string;
  documentTitle: string | null;
  content: string;
  score: number;
}

/**
 * Audit record of one knowledge-library chunk used to ground a reply.
 * Stored in {@code EmailReplyDraft.knowledgeSourcesJson} and
 * {@code EmailAutoReplyAuditLog.knowledgeSourcesJson}. No full body content —
 * the snippet is trimmed for audit, the body is never put in the email.
 *
 * F07: `suppliedToPrompt` separates RETRIEVED candidates from SUPPLIED
 * context — true only for chunks actually present in the model prompt after
 * input-context fitting. A dropped chunk keeps its retrieval diagnostics
 * here (query/score/citation) but must never be presented as grounding the
 * draft. Absent (legacy rows) means unknown — consumers must not assume
 * supplied.
 */
export interface EmailReplyKnowledgeSourceAudit {
  readonly toolName: "knowledge_library_search";
  readonly query: string;
  readonly chunkId: number;
  readonly documentId: number;
  readonly documentName: string;
  readonly documentTitle?: string;
  readonly citation?: string;
  readonly score?: number;
  readonly suppliedToPrompt?: boolean;
}

/** Result of {@code create_email_reply_draft}. No source names in the body. */
export interface AiEmailReplyDraftResult {
  draftId: number;
  messageId: number;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  classification: EmailMessageClassification;
  knowledgeSources: EmailReplyKnowledgeSource[];
  confidence: number | null;
  warnings: string[];
  /**
   * R21: true when the model asked for human review before sending
   * (`requiresHumanReview` in the strict generation contract). Persisted on
   * the draft and decoded on reuse, so a flagged draft can never silently
   * become lighter-review output. The approval service refuses approval while
   * review is pending. `false` when the model did not request review (the
   * field is optional in the contract — its absence is not an error).
   * IMMUTABLE model provenance — see `humanReviewPending` for the effective
   * status that guidance and approval actually follow (F09).
   */
  requiresHumanReview: boolean;
  /**
   * F09: effective review status for THIS revision — true unless an explicit
   * human resolution is bound to the draft's current revision. Approval
   * guidance (`next_action`) and the approval gate derive from this, never
   * from the raw model flag alone; an edit invalidates the resolution and
   * restores pending. Always present on fresh results (no resolution can
   * exist yet, so it equals the model flag there).
   */
  humanReviewPending: boolean;
  /** R21: schema-bounded reasons the model gave for the review request. */
  reviewReasons: string[];
  /** R21: schema-bounded unresolved questions the model listed. */
  unresolvedQuestions: string[];
  /**
   * True when an eligible existing draft was reused instead of regenerating
   * (FR-028). The generation service sets this when the message-level guard
   * finds a live `draft`/`approved` draft for the same message; no LLM call
   * is made in that case. False on a fresh generation.
   */
  reused: boolean;
  /**
   * Present only when the call was refused (e.g. `already_replied`) or reused
   * an existing draft. Carries the stable policy code so the tool/IPC envelope
   * can surface a machine-readable reason instead of parsing English. Omitted
   * on a fresh-generation success.
   */
  code?: EmailReplyPolicyCode;
  /**
   * R22: present on the `reused: true` success side (and on refusals via the
   * widened failure union). For a reused draft it is derived via
   * {@link nextActionForReuse} from the persisted review flag:
   * `approve_existing_draft` for a clean eligible draft (approval guidance is
   * authoritative here — the guard cleared the draft for reuse), or
   * `await_human_review` when the model flagged the draft (R21 — the approval
   * service refuses approval while that flag is set, so approval guidance
   * would contradict the gate). Omitted on a fresh-generation success.
   */
  next_action?:
    | "approve_existing_draft"
    | "discard_and_retry"
    | "await_human_review"
    | "no_action";
  /**
   * Per-invocation request correlation id (B11). Allocated fresh at the
   * `createDraft` entry boundary by {@link newRequestCorrelationId}; distinct
   * across two invocations for the same message. All audit events written
   * during this invocation carry this id in their `metadataJson.correlationId`
   * (alongside the deterministic per-message `messageCorrelationId`). The
   * returned result carries it so a caller can correlate a tool/IPC response
   * to the audit trail for the invocation that produced it.
   */
  requestCorrelationId: string;
}
