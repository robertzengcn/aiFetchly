import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/** Write-boundary schema for {@link EmailReplyDraftEntity}. */
export const emailReplyDraftWriteSchema = lazySchema(() =>
  z.object({
    messageId: z.number().int(),
    emailServiceId: z.number().int().nullable().optional(),
    subject: z.string().min(1),
    bodyText: z.string().min(1),
    bodyHtml: z.string().nullable().optional(),
    status: z.string().optional(),
    generationSource: z.string().optional(),
    modelName: z.string().nullable().optional(),
    promptVersion: z.string().nullable().optional(),
    confidence: z.number().nullable().optional(),
    knowledgeSourcesJson: z.string().nullable().optional(),
    ownerStyleProfileJson: z.string().nullable().optional(),
    warningsJson: z.string().nullable().optional(),
    sentAt: z.coerce.date().nullable().optional(),
    sendError: z.string().nullable().optional(),
    // ---- Reliability extension aggregate projection (Milestone 1) ----
    conversationId: z.number().int().nullable().optional(),
    currentRevisionId: z.number().int().nullable().optional(),
    revisionNumber: z.number().int().optional(),
    senderAddress: z.string().nullable().optional(),
    recipientAddress: z.string().nullable().optional(),
    contentHash: z.string().nullable().optional(),
    policyVersion: z.string().nullable().optional(),
    validationVersion: z.string().nullable().optional(),
    contextVersion: z.number().int().optional(),
    knowledgeScopeVersion: z.number().int().nullable().optional(),
    approvalInvalidatedAt: z.coerce.date().nullable().optional(),
  })
);
