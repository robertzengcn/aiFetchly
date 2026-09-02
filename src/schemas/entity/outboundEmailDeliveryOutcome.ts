import { z } from "zod/v4";
import { lazySchema } from "@/utils/lazySchema";
import { outboundEmailRecipientOutcomeStatusSchema } from "@/entityTypes/outboundEmailDeliveryTypes";

/** Write-boundary schema for {@link OutboundEmailDeliveryOutcomeEntity}. */
export const outboundEmailDeliveryOutcomeWriteSchema = lazySchema(() =>
  z.object({
    sendAttemptId: z.number().int(),
    batchId: z.number().int(),
    draftId: z.number().int(),
    revisionId: z.number().int(),
    envelopeHash: z.string().length(64),
    recipientAddress: z.string().min(1).max(320),
    status: outboundEmailRecipientOutcomeStatusSchema,
    providerMessageId: z.string().max(500).nullable().optional(),
    errorCode: z.string().max(100).nullable().optional(),
    submittedAt: z.date().nullable().optional(),
    completedAt: z.date().nullable().optional(),
  })
);