import { z } from "zod";
import type {
  EmailMessageClassification,
  EmailReplyStatus,
} from "@/entityTypes/emailReceiveTypes";

/**
 * Result envelope for email receive/reply AI tools. Mirrors the
 * {@link EmailMarketingAiToolResult} shape so the chat tool pipeline can treat
 * every tool result uniformly.
 */
export type EmailReceiveAiToolResult<T> =
  | ({ success: true } & T & Record<string, unknown>)
  | { success: false; error: string; validation_errors?: string[] };

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
}
