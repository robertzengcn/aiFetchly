import { z } from "zod/v4";
import { lazySchema } from "@/utils/lazySchema";
import { outboundEmailDraftStatusSchema } from "@/entityTypes/outboundEmailDeliveryTypes";

/** Write-boundary schema for {@link OutboundEmailDraftEntity}. */
export const outboundEmailDraftWriteSchema = lazySchema(() =>
  z.object({
    batchId: z.number().int(),
    recipientAddress: z.string().min(1).max(320),
    recipientDisplayName: z.string().max(320).nullable().optional(),
    recipientSourceRef: z.string().max(200).nullable().optional(),
    status: outboundEmailDraftStatusSchema,
    currentRevisionId: z.number().int().nullable().optional(),
    revisionNumber: z.number().int().nonnegative(),
    contentHash: z.string().length(64).nullable().optional(),
    lastErrorCode: z.string().max(100).nullable().optional(),
  })
);