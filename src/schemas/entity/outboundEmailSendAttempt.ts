import { z } from "zod/v4";
import { lazySchema } from "@/utils/lazySchema";
import { outboundEmailSendAttemptStatusSchema } from "@/entityTypes/outboundEmailDeliveryTypes";

/** Write-boundary schema for {@link OutboundEmailSendAttemptEntity}. */
export const outboundEmailSendAttemptWriteSchema = lazySchema(() =>
  z.object({
    batchId: z.number().int(),
    authorizationId: z.number().int(),
    batchHash: z.string().length(64),
    idempotencyKey: z.string().min(1).max(128),
    status: outboundEmailSendAttemptStatusSchema,
    legacyTaskId: z.number().int().nullable().optional(),
    workerPid: z.number().int().nullable().optional(),
    claimedAt: z.date(),
    workerStartedAt: z.date().nullable().optional(),
    completedAt: z.date().nullable().optional(),
    lastErrorCode: z.string().max(100).nullable().optional(),
  })
);