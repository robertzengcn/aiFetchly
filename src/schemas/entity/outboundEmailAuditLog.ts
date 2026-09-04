import { z } from "zod/v4";
import { lazySchema } from "@/utils/lazySchema";

/** Write-boundary schema for {@link OutboundEmailAuditLogEntity}. */
export const outboundEmailAuditLogWriteSchema = lazySchema(() =>
  z.object({
    actorType: z.enum(["user", "ai", "system"]),
    eventCode: z.string().min(1).max(100),
    conversationId: z.string().max(100).nullable().optional(),
    sourceUserMessageId: z.string().max(100).nullable().optional(),
    intentDecisionId: z.number().int().nullable().optional(),
    batchId: z.number().int().nullable().optional(),
    draftId: z.number().int().nullable().optional(),
    revisionId: z.number().int().nullable().optional(),
    authorizationId: z.number().int().nullable().optional(),
    sendAttemptId: z.number().int().nullable().optional(),
    versionsJson: z.string().nullable().optional(),
    metadataJson: z.string().nullable().optional(),
  })
);