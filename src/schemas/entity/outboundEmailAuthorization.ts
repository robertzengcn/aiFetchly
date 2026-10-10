import { z } from "zod/v4";
import { lazySchema } from "@/utils/lazySchema";
import {
  outboundEmailAuthorizationTypeSchema,
  outboundEmailAuthorizationStatusSchema,
} from "@/entityTypes/outboundEmailDeliveryTypes";

/** Write-boundary schema for {@link OutboundEmailAuthorizationEntity}. */
export const outboundEmailAuthorizationWriteSchema = lazySchema(() =>
  z.object({
    batchId: z.number().int(),
    type: outboundEmailAuthorizationTypeSchema,
    sourceUserMessageId: z.string().min(1).max(100),
    intentDecisionId: z.number().int().nullable().optional(),
    batchHash: z.string().length(64),
    tokenHash: z.string().length(64).nullable().optional(),
    status: outboundEmailAuthorizationStatusSchema,
    expiresAt: z.date(),
    consumedAt: z.date().nullable().optional(),
    invalidatedAt: z.date().nullable().optional(),
    invalidationReason: z.string().max(100).nullable().optional(),
  })
);