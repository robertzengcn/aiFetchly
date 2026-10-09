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
  /**
   * D8 (security): whether TLS certificate validation is enforced on SSL
   * connections. Defaults to true (cert validation ON). Only set to false to
   * allow self-signed certs on a user-acknowledged insecure mailbox — never
   * the default, never silently applied. POP3 previously hardcoded
   * `rejectUnauthorized: false`, disabling cert validation for every SSL
   * connection (MITM risk).
   */
  readonly tlsRejectUnauthorized?: boolean;
}

/** Bounded fetch options for a receive sync. */
export interface EmailReceiveFetchOptions {
  readonly limit: number;
  readonly unreadOnly: boolean;
  readonly since?: Date;
}

// ---- Renderer-safe DTOs (no secrets, no raw credentials) ----

/** List-row DTO for received messages. No body content. */
export interface ReceivedMessageListDto {
  id: number;
  emailServiceId: number;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  snippet: string | null;
  receivedAt: string;
  isUnread: boolean;
  classification: EmailMessageClassification | null;
  classificationConfidence: number | null;
  replyStatus: EmailReplyStatus;
  processedAt: string | null;
  // ---- Mailbox reply evidence (FR-030): renderer-safe observation fields ----
  /** Raw provider `\Answered` flag at last check. */
  isAnswered: boolean;
  /** When the provider answered-flag was last observed. */
  answeredFlagCheckedAt: string | null;
  /** Sticky first positive detection time (never cleared). */
  replyDetectedAt: string | null;
}

/** Detail DTO for one received message, including sanitized body. */
export interface ReceivedMessageDetailDto extends ReceivedMessageListDto {
  messageId: string | null;
  threadKey: string | null;
  replyToAddress: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  bodyText: string | null;
  bodyHtmlSanitized: string | null;
  // ---- Full evidence set (diagnostic view, FR-030/FR-032) ----
  /** Which source produced the sticky positive: `mailbox_flag` or `sent_search`. */
  replyDetectionSource: string | null;
  /** The Sent-folder message that matched (RFC Message-ID), diagnostics only. */
  replyMatchedMessageId: string | null;
  /** When the last complete negative observation was stored (cache freshness). */
  replyNegativeCheckAt: string | null;
  /** IMAP folder this message was synced from (UID provenance). */
  providerFolder: string | null;
  /** IMAP UIDVALIDITY of the source folder (lossless string). */
  providerUidValidity: string | null;
}

/** Reply identity profile DTO (no secrets). */
export interface ReplyIdentityProfileDto {
  id: number;
  emailServiceId: number;
  ownerName: string;
  ownerRole: string | null;
  companyName: string | null;
  preferredTone: string | null;
  signature: string | null;
  styleNotes: string | null;
  forbiddenPhrases: string[];
  discloseAutomation: boolean;
}

/** AI auto-reply audit row DTO. Previews are truncated; no full bodies. */
export interface AutoReplyAuditDto {
  id: number;
  emailServiceId: number;
  messageId: number;
  draftId: number | null;
  ruleId: number | null;
  action: string;
  decisionStatus: string;
  classification: EmailMessageClassification | null;
  confidence: number | null;
  reason: string | null;
  knowledgeQuery: string | null;
  knowledgeSourceCount: number;
  generatedSubject: string | null;
  generatedBodyPreview: string | null;
  sentSubject: string | null;
  sentBodyPreview: string | null;
  requiresUserApproval: boolean;
  approvedByUser: boolean;
  errorMessage: string | null;
  /**
   * T10 (FR-033): the typed stage/code extracted from the row's structured
   * `metadataJson` (written by the services as proper JSON fields — this is
   * structured-data extraction at the IPC boundary, NOT English-text parsing).
   * Null when the row carries no typed metadata (legacy rows, non-refusal
   * events).
   */
  metadataStage: string | null;
  metadataCode: string | null;
  createdAt: string;
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

/**
 * Status of a reply draft through its lifecycle.
 *
 * Reliability extension (Milestone 1): `sending` is the atomic-claim in-flight
 * state; `delivery_unknown` is a terminal ambiguous outcome that is never
 * automatically retried. Enforced state machine:
 *
 *   draft -> approved -> sending -> sent
 *     |          |          |
 *     |          |          +-> failed
 *     |          |          +-> delivery_unknown
 *     |          +-> draft (approval invalidated by an edit)
 *     +-> discarded
 */
export type EmailReplyDraftStatus =
  | "draft"
  | "approved"
  | "sending"
  | "sent"
  | "discarded"
  | "failed"
  | "delivery_unknown";

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
  | "send_failed"
  | "send_claimed"
  | "delivery_unknown";

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
