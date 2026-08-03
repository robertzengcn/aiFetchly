import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/** Write-boundary schema for {@link EmailAutoReplyAuditLogEntity}. */
export const emailAutoReplyAuditLogWriteSchema = lazySchema(() =>
  z.object({
    emailServiceId: z.number().int(),
    messageId: z.number().int(),
    draftId: z.number().int().nullable().optional(),
    ruleId: z.number().int().nullable().optional(),
    action: z.string().min(1),
    decisionStatus: z.string().min(1),
    classification: z.string().nullable().optional(),
    confidence: z.number().nullable().optional(),
    reason: z.string().nullable().optional(),
    knowledgeQuery: z.string().nullable().optional(),
    knowledgeSourcesJson: z.string().nullable().optional(),
    generatedSubject: z.string().nullable().optional(),
    generatedBodyPreview: z.string().nullable().optional(),
    sentSubject: z.string().nullable().optional(),
    sentBodyPreview: z.string().nullable().optional(),
    requiresUserApproval: z.number().int().optional(),
    approvedByUser: z.number().int().optional(),
    errorMessage: z.string().nullable().optional(),
    metadataJson: z.string().nullable().optional(),
  }),
);
