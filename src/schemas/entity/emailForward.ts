import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * Write-boundary schemas for forward drafts and immutable revisions.
 * Revisions are write-once: models must never update an existing row.
 */

export const emailForwardDraftWriteSchema = lazySchema(() =>
  z.object({
    messageId: z.number().int().positive(),
    emailServiceId: z.number().int().positive(),
    status: z.enum(["draft", "ready", "submitted", "discarded"]).optional(),
    currentRevisionId: z.number().int().nullable().optional(),
    conversationId: z.number().int().nullable().optional(),
    provenance: z.enum(["ai", "user"]).optional(),
    locale: z.string().max(10).optional(),
    submittedAt: z.coerce.date().nullable().optional(),
  })
);

export const emailForwardRevisionWriteSchema = lazySchema(() =>
  z.object({
    draftId: z.number().int().positive(),
    revisionNumber: z.number().int().positive(),
    sourceLocationSnapshotJson: z.string().min(1),
    sourceFullSourceHash: z.string().length(64).nullable().optional(),
    fromName: z.string().max(255).nullable().optional(),
    fromAddress: z.string().min(3).max(320),
    replyToAddress: z.string().max(320).nullable().optional(),
    smtpUsername: z.string().max(255).nullable().optional(),
    sendingAccountId: z.number().int().positive(),
    toRecipientsJson: z.string(),
    ccRecipientsJson: z.string().nullable().optional(),
    bccRecipientsJson: z.string().nullable().optional(),
    envelopeRecipientsJson: z.string(),
    subject: z.string().min(1).max(998),
    note: z.string().nullable().optional(),
    bodyTextArtifactId: z.string().max(64).nullable().optional(),
    bodyHtmlArtifactId: z.string().max(64).nullable().optional(),
    bodyTextHash: z.string().length(64).nullable().optional(),
    bodyHtmlHash: z.string().length(64).nullable().optional(),
    attachmentsJson: z.string(),
    composedMessageId: z.string().min(1).max(998),
    composedHash: z.string().length(64),
    composedByteCount: z.number().int().nullable().optional(),
    validationFindingsJson: z.string().nullable().optional(),
    expiresAt: z.coerce.date().nullable().optional(),
  })
);
