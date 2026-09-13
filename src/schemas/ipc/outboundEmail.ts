import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * IPC input schemas for the intent-aware outbound-email delivery pipeline
 * (technical design §17). Every handler validates its input with one of these
 * schemas before any business logic runs (§17.1).
 *
 * AI-gated channels (draft generation) are routed through
 * `registerAiValidatedHandler`, which checks USER_AI_ENABLED first. The
 * review/approve/send/discard/status channels are plain — they operate on
 * already-authorized state and must stay usable for inspection even when AI
 * is disabled.
 */

// §17 OUTBOUND_EMAIL_BATCH_GET — load batch + drafts + findings + status.
export const outboundEmailBatchGetInputSchema = lazySchema(() =>
  z.strictObject({
    batchId: z.number().int().positive("Batch id is required"),
  })
);

// §17 OUTBOUND_EMAIL_DRAFT_UPDATE — create a new user revision for one draft.
// Editing creates a new revision and invalidates any prior approval (§18).
export const outboundEmailDraftUpdateInputSchema = lazySchema(() =>
  z.strictObject({
    draftId: z.number().int().positive("Draft id is required"),
    emailServiceId: z.number().int().positive("Email service id is required"),
    senderAddress: z.string().min(1, "Sender address is required").max(320),
    subject: z.string().min(1, "Subject is required").max(500),
    bodyText: z.string().min(1, "Body text is required"),
    bodyHtml: z.string().nullable(),
  })
);

// §17 OUTBOUND_EMAIL_BATCH_APPROVE — rerun preflight and approve the exact
// batch (review_first intent). The caller supplies the batchHash it reviewed
// so the server can detect a changed-since-review race.
export const outboundEmailBatchApproveInputSchema = lazySchema(() =>
  z.strictObject({
    batchId: z.number().int().positive("Batch id is required"),
    batchHash: z.string().length(64, "Batch hash must be a 64-char hex digest"),
  })
);

// §17 OUTBOUND_EMAIL_BATCH_SEND — claim + start authorized delivery. The
// caller supplies the batchHash it authorized; the claim transaction
// recomputes and verifies it (§15.1).
export const outboundEmailBatchSendInputSchema = lazySchema(() =>
  z.strictObject({
    batchId: z.number().int().positive("Batch id is required"),
    authorizationId: z.number().int().positive("Authorization id is required"),
    batchHash: z.string().length(64, "Batch hash must be a 64-char hex digest"),
  })
);

// §17 OUTBOUND_EMAIL_BATCH_DISCARD — discard an unsent batch.
export const outboundEmailBatchDiscardInputSchema = lazySchema(() =>
  z.strictObject({
    batchId: z.number().int().positive("Batch id is required"),
  })
);

// §17 OUTBOUND_EMAIL_BATCH_STATUS — refresh attempt + outcomes for a batch.
export const outboundEmailBatchStatusInputSchema = lazySchema(() =>
  z.strictObject({
    batchId: z.number().int().positive("Batch id is required"),
  })
);
