import {
  windowInvoke,
  windowReceive,
  windowRemoveListener,
} from "@/views/utils/apirequest";
import {
  OUTBOUND_EMAIL_BATCH_GET,
  OUTBOUND_EMAIL_DRAFT_UPDATE,
  OUTBOUND_EMAIL_BATCH_APPROVE,
  OUTBOUND_EMAIL_BATCH_SEND,
  OUTBOUND_EMAIL_BATCH_DISCARD,
  OUTBOUND_EMAIL_BATCH_STATUS,
  OUTBOUND_EMAIL_BATCH_PROGRESS,
} from "@/config/channellist";
import type { AuthorizedEmailWorkerEvent } from "@/entityTypes/outboundEmailDeliveryTypes";

/**
 * Renderer API for the intent-aware outbound-email delivery pipeline
 * (technical design §17). Every invoke returns the unwrapped `data` field
 * (windowInvoke throws on `status:false`), so callers receive strongly-typed
 * payloads and a thrown Error carries the stable error code (§20) in its
 * message.
 *
 * Raw approval tokens and SMTP credentials never reach the renderer —
 * `approveOutboundEmailBatch` returns the one-time review token (§13.2), but
 * send/progress carry only sanitized codes, never credentials (§17.1).
 */

export interface OutboundEmailBatchView {
  id: number;
  status: string;
  batchHash: string | null;
  conversationId: string;
  recipientCount: number;
}

export interface OutboundEmailDraftView {
  id: number;
  recipientAddress: string;
  recipientDisplayName: string | null;
  status: string;
  revisionNumber: number;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  emailServiceId: number | null;
  senderAddress: string | null;
}

export interface OutboundEmailBatchGetResult {
  batch: OutboundEmailBatchView;
  drafts: OutboundEmailDraftView[];
}

export interface OutboundEmailDraftUpdateResult {
  revisionId: number;
  batchHash: string;
  batchStatus: string;
}

export interface OutboundEmailApprovalResult {
  authorizationId: number;
  /** One-time review token; returned once, never persisted. */
  token: string;
  batchHash: string;
}

export interface OutboundEmailSendResult {
  status: "claimed" | "already_processed" | "worker_start_failed";
  attemptId: number;
}

export interface OutboundEmailOutcomeView {
  id: number;
  draftId: number;
  recipientAddress: string;
  status: string;
  errorCode: string | null;
  providerMessageId: string | null;
}

export interface OutboundEmailBatchStatusResult {
  batchStatus: string;
  attempt: { id: number; status: string } | null;
  outcomes: OutboundEmailOutcomeView[];
}

/** Load the batch + drafts + current revisions for the review UI (§17, §18). */
export async function getOutboundEmailBatch(
  batchId: number
): Promise<OutboundEmailBatchGetResult> {
  return await windowInvoke(OUTBOUND_EMAIL_BATCH_GET, { batchId });
}

/**
 * Create a new user revision for one draft (§18). Editing creates a new
 * revision and invalidates any prior approval; the returned batchHash is the
 * new hash the caller must re-approve before sending.
 */
export async function updateOutboundEmailDraft(input: {
  draftId: number;
  emailServiceId: number;
  senderAddress: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
}): Promise<OutboundEmailDraftUpdateResult> {
  return await windowInvoke(OUTBOUND_EMAIL_DRAFT_UPDATE, input);
}

/**
 * Rerun preflight and create a review approval (§13.2). Returns the one-time
 * raw token; only its SHA-256 hash is persisted. The caller supplies the
 * batchHash it reviewed so a changed-since-review race is caught.
 */
export async function approveOutboundEmailBatch(
  batchId: number,
  batchHash: string
): Promise<OutboundEmailApprovalResult> {
  return await windowInvoke(OUTBOUND_EMAIL_BATCH_APPROVE, {
    batchId,
    batchHash,
  });
}

/**
 * Claim + start authorized delivery (§15). Idempotent — a duplicate claim
 * returns `already_processed` with the same attemptId.
 */
export async function sendOutboundEmailBatch(
  batchId: number,
  authorizationId: number,
  batchHash: string
): Promise<OutboundEmailSendResult> {
  return await windowInvoke(OUTBOUND_EMAIL_BATCH_SEND, {
    batchId,
    authorizationId,
    batchHash,
  });
}

/** Discard an unsent batch (§17). */
export async function discardOutboundEmailBatch(
  batchId: number
): Promise<{ discarded: boolean }> {
  return await windowInvoke(OUTBOUND_EMAIL_BATCH_DISCARD, { batchId });
}

/** Refresh the attempt + per-recipient outcomes for a batch (§17). */
export async function getOutboundEmailBatchStatus(
  batchId: number
): Promise<OutboundEmailBatchStatusResult> {
  return await windowInvoke(OUTBOUND_EMAIL_BATCH_STATUS, { batchId });
}

/**
 * Subscribe to live worker progress events (§6.4, §17). Returns the listener
 * handle for cleanup via {@link removeOutboundEmailProgressListener}. Events
 * carry only sanitized codes — never SMTP credentials.
 */
export function subscribeOutboundEmailProgress(
  onEvent: (event: AuthorizedEmailWorkerEvent) => void
): (event: unknown) => void {
  const listener = (event: unknown): void => {
    onEvent(event as AuthorizedEmailWorkerEvent);
  };
  windowReceive(OUTBOUND_EMAIL_BATCH_PROGRESS, listener);
  return listener;
}

/** Detach a progress listener registered by {@link subscribeOutboundEmailProgress}. */
export function removeOutboundEmailProgressListener(
  listener: (event: unknown) => void
): void {
  windowRemoveListener(OUTBOUND_EMAIL_BATCH_PROGRESS, listener);
}
