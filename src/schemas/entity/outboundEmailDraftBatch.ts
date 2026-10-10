import { z } from "zod/v4";
import { lazySchema } from "@/utils/lazySchema";
import { outboundEmailBatchStatusSchema } from "@/entityTypes/outboundEmailDeliveryTypes";

/** Write-boundary schema for {@link OutboundEmailDraftBatchEntity}. */
export const outboundEmailDraftBatchWriteSchema = lazySchema(() =>
  z.object({
    conversationId: z.string().min(1).max(100),
    sourceUserMessageId: z.string().min(1).max(100),
    intentDecisionId: z.number().int(),
    status: outboundEmailBatchStatusSchema,
    recipientSourceType: z.string().min(1).max(40),
    recipientSourceId: z.number().int().nullable().optional(),
    recipientCount: z.number().int().nonnegative(),
    validRecipientCount: z.number().int().nonnegative(),
    emailServiceIdsJson: z.string(),
    batchHash: z.string().length(64).nullable().optional(),
    policyVersion: z.string().max(50).nullable().optional(),
    validationVersion: z.string().max(50).nullable().optional(),
    authorizationId: z.number().int().nullable().optional(),
    legacyTaskId: z.number().int().nullable().optional(),
    sendAttemptId: z.number().int().nullable().optional(),
    lastErrorCode: z.string().max(100).nullable().optional(),
    authorizedAt: z.date().nullable().optional(),
    queuedAt: z.date().nullable().optional(),
    completedAt: z.date().nullable().optional(),
  })
);