/**
 * Shared type definitions for the AI Email Receive And Auto-Reply feature.
 *
 * These unions are reused by entities, models, modules, IPC schemas, and the
 * AI tool result DTOs so that classification / reply-status / decision values
 * stay consistent across every layer.
 */

/** Inbound mailbox receive protocol. MVP is IMAP-first; POP3 is supported for compatibility. */
export type EmailReceiveProtocol = "imap" | "pop3";

/**
 * Connection configuration handed to an {@link EmailReceiveClient}.
 * Main-process only — carries the receive password and must NEVER be returned
 * to the renderer or surfaced in an AI tool result.
 */
export interface EmailReceiveConnectionConfig {
  readonly emailServiceId: number;
  readonly protocol: EmailReceiveProtocol;
  readonly host: string;
  readonly port: number;
  readonly ssl: boolean;
  readonly username: string;
  readonly password: string;
  readonly folder: string;
}

/** Bounded fetch options for a receive sync. */
export interface EmailReceiveFetchOptions {
  readonly limit: number;
  readonly unreadOnly: boolean;
  readonly since?: Date;
}

/** AI classification of a received message intent. */
export type EmailMessageClassification =
  | "interested"
  | "not_interested"
  | "unsubscribe"
  | "bounce"
  | "auto_reply"
  | "support_request"
  | "needs_human_review"
  | "unknown";

/** Lifecycle of replying to a received message. */
export type EmailReplyStatus =
  | "not_started"
  | "draft_created"
  | "sent"
  | "skipped"
  | "blocked"
  | "failed";

/** Status of a reply draft through its lifecycle. */
export type EmailReplyDraftStatus =
  | "draft"
  | "approved"
  | "sent"
  | "discarded"
  | "failed";

/** Whether a draft was AI-generated or manually written. */
export type EmailReplyGenerationSource = "ai" | "manual";

/** Actions recorded in the generic {@link EmailReplyAuditLog}. */
export type EmailReplyAuditAction =
  | "message_fetched"
  | "message_read_by_ai"
  | "knowledge_retrieved"
  | "classified"
  | "draft_created"
  | "draft_edited"
  | "reply_sent"
  | "reply_skipped"
  | "auto_reply_blocked"
  | "send_failed";

/** Who triggered an audit action. */
export type EmailReplyAuditActor = "user" | "ai" | "system";

/** Decision status surfaced in the AI auto-reply audit UI. */
export type EmailAutoReplyDecisionStatus =
  | "draft_created"
  | "approval_required"
  | "auto_sent"
  | "blocked"
  | "skipped"
  | "failed"
  | "needs_human_review";

/** Actions recorded in the {@link EmailAutoReplyAuditLog}. */
export type EmailAutoReplyAuditAction =
  | "auto_reply_evaluated"
  | "knowledge_library_searched"
  | "draft_created"
  | "approval_required"
  | "auto_reply_sent"
  | "auto_reply_blocked"
  | "auto_reply_skipped"
  | "auto_reply_failed";
