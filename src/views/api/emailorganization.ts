import { windowInvoke } from "@/views/utils/apirequest";
import {
  EMAIL_ORG_CAPABILITIES,
  EMAIL_ORG_FOLDERS,
  EMAIL_FORWARD_DRAFT_CREATE,
  EMAIL_FORWARD_DRAFT_UPDATE,
  EMAIL_FORWARD_DRAFT_DETAIL,
  EMAIL_FORWARD_DRAFT_DISCARD,
  EMAIL_ORG_AUTHORIZE,
  EMAIL_ORG_SEND,
  EMAIL_ORG_TRASH,
  EMAIL_ORG_RESTORE,
  EMAIL_ORG_OPERATION_GET,
  EMAIL_ORG_OPERATION_CANCEL,
  EMAIL_ORG_OPERATION_RECONCILE,
  EMAIL_ORG_SEARCH,
  EMAIL_ORG_SELECTION_PREPARE,
  EMAIL_ORG_OPERATION_LIST,
  EMAIL_ORG_TRASH_SELECTION_START,
  EMAIL_ORG_DIAGNOSTICS,
} from "@/config/channellist";
import type {
  EmailOrganizationCapabilityDto,
  EmailOrganizationFolderDto,
  EmailOrganizationOperationDto,
  EmailForwardAttachmentSelection,
} from "@/entityTypes/emailOrganizationTypes";

/**
 * Renderer API for the email organization feature (forward / trash /
 * restore). All calls go through the validated IPC surface; the renderer
 * never sees credentials, authorization internals or filesystem paths.
 */

export interface ForwardDraftPreviewDto {
  draftId: number;
  revisionId: number;
  revisionNumber: number;
  messageId: number;
  sourceEmailServiceId: number;
  sendingAccountId: number;
  fromName: string | null;
  fromAddress: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  note: string | null;
  attachmentManifest: Array<{
    partId: string;
    displayName: string;
    contentType: string | null;
    decodedSize: number;
    contentHash: string;
    disposition: "attachment" | "inline";
    contentId: string | null;
    selected: boolean;
  }>;
  selectedAttachmentCount: number;
  selectedAttachmentBytes: number;
  bodyPreviewText: string;
  validationFindings: string[];
  composedHash: string;
  composedMessageId: string;
  expiresAt: string;
  expired: boolean;
}

export interface MailboxActionResultDto {
  success: boolean;
  operationId: string;
  status: string;
  completed: number;
  failed: number;
  unresolved: number;
  pending: number;
  cancelled: number;
  errorCode: string | null;
  retryable: boolean;
  priorOperationId?: string;
}

export interface SendForwardResultDto {
  status: "submitted" | "failed" | "outcome_unknown" | "already_processed";
  outcome?: "succeeded" | "partially_succeeded";
  priorOutcome?: string;
  operationId: string | null;
  accepted?: string[];
  rejected?: string[];
  unknown?: string[];
  code?: string;
  error?: string;
}

export interface CreateForwardDraftInput {
  messageId: number;
  /** Optional while drafting; delivery refuses an empty envelope at send. */
  to?: string[];
  cc?: string[];
  bcc?: string[];
  note?: string | null;
  subject?: string | null;
  senderServiceId?: number | null;
  attachments?: EmailForwardAttachmentSelection;
}

export async function getEmailOrganizationCapabilities(
  emailServiceId: number
): Promise<EmailOrganizationCapabilityDto> {
  return await windowInvoke(EMAIL_ORG_CAPABILITIES, { emailServiceId });
}

export async function listEmailOrganizationFolders(
  emailServiceId: number
): Promise<{ folders: EmailOrganizationFolderDto[] }> {
  return await windowInvoke(EMAIL_ORG_FOLDERS, { emailServiceId });
}

export async function createForwardDraft(
  input: CreateForwardDraftInput
): Promise<ForwardDraftPreviewDto> {
  return await windowInvoke(EMAIL_FORWARD_DRAFT_CREATE, input);
}

export async function updateForwardDraft(input: {
  draftId: number;
  expectedRevisionId: number;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  note?: string | null;
  subject?: string | null;
  attachments?: EmailForwardAttachmentSelection;
}): Promise<ForwardDraftPreviewDto> {
  return await windowInvoke(EMAIL_FORWARD_DRAFT_UPDATE, input);
}

export async function getForwardDraftDetail(draftId: number): Promise<ForwardDraftPreviewDto> {
  return await windowInvoke(EMAIL_FORWARD_DRAFT_DETAIL, { draftId });
}

export async function discardForwardDraft(draftId: number): Promise<{ discarded: boolean }> {
  return await windowInvoke(EMAIL_FORWARD_DRAFT_DISCARD, { draftId });
}

/** Authorizes the exact displayed revision (one-time, 15-minute, hash-bound). */
export async function authorizeForwardRevision(input: {
  draftId: number;
  revisionId: number;
}): Promise<{ authorizationId: number; expiresInSeconds: number }> {
  return await windowInvoke(EMAIL_ORG_AUTHORIZE, input);
}

export async function sendApprovedForward(input: {
  draftId: number;
  revisionId: number;
  authorizationId: number;
}): Promise<SendForwardResultDto> {
  return await windowInvoke(EMAIL_ORG_SEND, input);
}

export async function moveMessageToTrash(
  messageId: number,
  actionId?: string
): Promise<MailboxActionResultDto> {
  return await windowInvoke(EMAIL_ORG_TRASH, { messageId, actionId: actionId ?? null });
}

/** Executes a frozen bulk selection (review: closes the prepare/execute gap). */
export async function trashSelection(
  selectionId: string,
  actionId?: string
): Promise<MailboxActionResultDto> {
  return await windowInvoke(EMAIL_ORG_TRASH, { selectionId, actionId: actionId ?? null });
}

export async function restoreFromOperation(
  operationId: string,
  destinationFolderPath?: string
): Promise<MailboxActionResultDto> {
  return await windowInvoke(EMAIL_ORG_RESTORE, {
    operationId,
    destinationFolderPath: destinationFolderPath ?? null,
  });
}

export async function getEmailOrganizationOperation(
  operationId: string
): Promise<{ operation: EmailOrganizationOperationDto | null }> {
  return await windowInvoke(EMAIL_ORG_OPERATION_GET, { operationId });
}

export async function cancelEmailOrganizationOperation(
  operationId: string
): Promise<{ cancelled: boolean; operation: EmailOrganizationOperationDto | null }> {
  return await windowInvoke(EMAIL_ORG_OPERATION_CANCEL, { operationId });
}

export async function reconcileEmailOrganizationOperation(
  operationId: string
): Promise<MailboxActionResultDto> {
  return await windowInvoke(EMAIL_ORG_OPERATION_RECONCILE, { operationId });
}

export interface OrganizationSearchResultDto {
  source: "local" | "server";
  emailServiceId: number;
  searchedFolders: string[];
  rows: Array<{
    messageId: number | null;
    providerUid: string | null;
    folderPath: string | null;
    fromAddress: string;
    subject: string;
    receivedAt: string;
    isUnread: boolean;
    /** null = unknown (server rows cannot report attachment presence). */
    hasAttachments: boolean | null;
  }>;
  totalMatched: number;
  complete: boolean;
  truncated: boolean;
  nextCursor: string | null;
  lastSyncAt: string | null;
  limitation: string | null;
}

export async function searchEmailsOrganization(input: {
  emailServiceId: number;
  source: "local" | "server";
  folderPaths?: string[];
  fromAddress?: string;
  subject?: string;
  receivedFrom?: string;
  receivedTo?: string;
  unreadOnly?: boolean;
  hasAttachments?: boolean;
  pageSize?: number;
}): Promise<OrganizationSearchResultDto> {
  return await windowInvoke(EMAIL_ORG_SEARCH, input);
}

export interface SelectionPreviewDto {
  selectionId: string;
  kind: "trash" | "restore";
  emailServiceId: number;
  count: number;
  payloadHash: string;
  expiresAt: string;
  filtersSummary: Record<string, unknown> | null;
}

export async function prepareEmailSelection(input: {
  emailServiceId: number;
  kind: "trash" | "restore";
  messageIds: number[];
  filtersSummary?: Record<string, unknown>;
}): Promise<SelectionPreviewDto> {
  return await windowInvoke(EMAIL_ORG_SELECTION_PREPARE, input);
}

export async function listEmailOrganizationOperations(input: {
  emailServiceId?: number;
  messageId?: number;
  limit?: number;
}): Promise<{ operations: EmailOrganizationOperationDto[] }> {
  return await windowInvoke(EMAIL_ORG_OPERATION_LIST, input);
}

/** R12: prompt-start bulk trash — returns the operation id immediately. */
export async function startTrashSelection(
  selectionId: string,
  actionId?: string
): Promise<{ operationId: string } | MailboxActionResultDto> {
  return await windowInvoke(EMAIL_ORG_TRASH_SELECTION_START, {
    selectionId,
    actionId: actionId ?? null,
  });
}

export interface OrganizationDiagnosticsDto {
  aggregates: Array<{ kind: string; status: string; count: number }>;
}

/** PRD §11: local aggregate counts, exported only via the support workflow. */
export async function getOrganizationDiagnostics(): Promise<OrganizationDiagnosticsDto> {
  return await windowInvoke(EMAIL_ORG_DIAGNOSTICS, undefined);
}
