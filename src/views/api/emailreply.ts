import { windowInvoke } from "@/views/utils/apirequest";
import { SearchResult } from "@/views/api/types";
import {
  EMAIL_REPLY_IDENTITY_GET,
  EMAIL_REPLY_IDENTITY_UPDATE,
  EMAIL_REPLY_DRAFT_CREATE,
  EMAIL_REPLY_DRAFT_DETAIL,
  EMAIL_REPLY_DRAFT_UPDATE,
  EMAIL_REPLY_SEND,
  EMAIL_REPLY_DRAFT_APPROVE,
  EMAIL_REPLY_SEND_ATTEMPT_DETAIL,
  EMAIL_REPLY_DELIVERY_RECONCILE,
  EMAIL_REPLY_KNOWLEDGE_SCOPE_GET,
  EMAIL_REPLY_KNOWLEDGE_SCOPE_UPDATE,
  EMAIL_AUTO_REPLY_AUDIT_LIST,
  EMAIL_AUTO_REPLY_AUDIT_DETAIL,
} from "@/config/channellist";
import type {
  ReplyIdentityProfileDto,
  AutoReplyAuditDto,
} from "@/entityTypes/emailReceiveTypes";
import type { AiEmailReplyDraftResult } from "@/entityTypes/emailReceiveAiTypes";

// ---- Identity profile ----

export async function getReplyIdentityProfile(
  emailServiceId: number
): Promise<ReplyIdentityProfileDto> {
  return await windowInvoke(EMAIL_REPLY_IDENTITY_GET, { emailServiceId });
}

export async function updateReplyIdentityProfile(input: {
  emailServiceId: number;
  ownerName: string;
  ownerRole?: string | null;
  companyName?: string | null;
  preferredTone?: string | null;
  signature?: string | null;
  styleNotes?: string | null;
  forbiddenPhrases?: string[];
  discloseAutomation?: number;
}): Promise<ReplyIdentityProfileDto> {
  return await windowInvoke(EMAIL_REPLY_IDENTITY_UPDATE, input);
}

// ---- Draft generation / edit / send ----

export async function createEmailReplyDraft(input: {
  messageId: number;
  tone?: string;
  goal?: string;
  extraInstructions?: string;
  useKnowledgeLibrary?: boolean;
}): Promise<AiEmailReplyDraftResult> {
  return await windowInvoke(EMAIL_REPLY_DRAFT_CREATE, input);
}

export interface ReplyDraftDetail {
  id: number;
  messageId: number;
  emailServiceId: number | null;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  status: string;
  generationSource: string;
  confidence: number | null;
  knowledgeSourcesJson: string | null;
  warningsJson: string | null;
  sentAt: string | null;
  sendError: string | null;
  createdAt: string;
}

export async function getEmailReplyDraft(
  id: number
): Promise<ReplyDraftDetail> {
  return await windowInvoke(EMAIL_REPLY_DRAFT_DETAIL, { id });
}

export async function updateEmailReplyDraft(input: {
  id: number;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
}): Promise<{ id: number }> {
  return await windowInvoke(EMAIL_REPLY_DRAFT_UPDATE, input);
}

export async function sendEmailReply(input: {
  draftId: number;
  emailServiceId?: number;
  approvalToken?: string;
}): Promise<{
  success: boolean;
  draft_id: number;
  message_id: number;
  sent_at: string;
}> {
  return await windowInvoke(EMAIL_REPLY_SEND, input);
}

// ---- Reliability v2: approval + idempotent delivery ----

/** One-time approval token for a draft's current revision. Returned ONCE. */
export async function approveEmailReplyDraft(draftId: number): Promise<{
  approvalId: number;
  token: string;
  revisionId: number;
  contentHash: string;
}> {
  return await windowInvoke(EMAIL_REPLY_DRAFT_APPROVE, { draftId });
}

/** Send attempts for a draft (audit / recovery UI). No secrets. */
export interface ReplySendAttemptDto {
  id: number;
  status: string;
  claimedAt: string | null;
  completedAt: string | null;
  providerMessageId: string | null;
  failureCode: string | null;
  sanitizedError: string | null;
}

export async function listEmailReplySendAttempts(
  draftId: number
): Promise<{ records: ReplySendAttemptDto[] }> {
  return await windowInvoke(EMAIL_REPLY_SEND_ATTEMPT_DETAIL, { draftId });
}

/** Manually sweep stale in-flight attempts to delivery_unknown. */
export async function reconcileEmailReplyDelivery(
  ageMs?: number
): Promise<{ recovered: number; needsAttention: boolean }> {
  return await windowInvoke(EMAIL_REPLY_DELIVERY_RECONCILE, { ageMs });
}

// ---- Knowledge scope settings (FR-008) ----

export interface ReplyKnowledgeScopeDto {
  emailServiceId: number;
  version: number;
  documentIds: number[];
  tags: string[];
  allowAllDocuments: boolean;
  excludeInactiveDocuments: boolean;
}

export async function getReplyKnowledgeScope(
  emailServiceId: number
): Promise<ReplyKnowledgeScopeDto> {
  return await windowInvoke(EMAIL_REPLY_KNOWLEDGE_SCOPE_GET, {
    emailServiceId,
  });
}

/**
 * Update the mailbox knowledge scope. Changing the scope invalidates every
 * not-yet-sent draft for the mailbox (they must be re-reviewed/re-approved).
 */
export async function updateReplyKnowledgeScope(input: {
  emailServiceId: number;
  documentIds: number[];
  tags: string[];
  allowAllDocuments: boolean;
  excludeInactiveDocuments: boolean;
}): Promise<{ version: number; invalidatedDrafts: number }> {
  return await windowInvoke(EMAIL_REPLY_KNOWLEDGE_SCOPE_UPDATE, input);
}

// ---- AI auto-reply audit ----

export interface AutoReplyAuditListInput {
  emailServiceId?: number;
  decisionStatus?: string;
  classification?: string;
  senderSearch?: string;
  dateStart?: string;
  dateEnd?: string;
  search?: string;
  page: number;
  size: number;
  sortby?: { key: string; order: string };
}

export async function listAutoReplyAuditLogs(
  input: AutoReplyAuditListInput
): Promise<SearchResult<AutoReplyAuditDto>> {
  const resp = await windowInvoke(EMAIL_AUTO_REPLY_AUDIT_LIST, input);
  return { data: resp.records, total: resp.num };
}

export async function getAutoReplyAuditLog(
  id: number
): Promise<AutoReplyAuditDto> {
  return await windowInvoke(EMAIL_AUTO_REPLY_AUDIT_DETAIL, { id });
}
