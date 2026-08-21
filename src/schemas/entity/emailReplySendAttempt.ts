import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/** Write-boundary schema for {@link EmailReplySendAttemptEntity}. */
export const emailReplySendAttemptWriteSchema = lazySchema(() =>
  z.object({
    idempotencyKey: z.string().min(1),
    draftId: z.number().int(),
    revisionId: z.number().int(),
    approvalId: z.number().int(),
    messageId: z.number().int(),
    conversationId: z.number().int().nullable().optional(),
    emailServiceId: z.number().int(),
    senderAddress: z.string().min(1),
    recipientAddress: z.string().min(1),
    status: z.enum([
      "claimed",
      "submitted",
      "sent",
      "failed",
      "delivery_unknown",
    ]),
    claimedAt: z.coerce.date(),
    submittedAt: z.coerce.date().nullable().optional(),
    completedAt: z.coerce.date().nullable().optional(),
    providerMessageId: z.string().nullable().optional(),
    failureCode: z.string().nullable().optional(),
    sanitizedError: z.string().nullable().optional(),
  }),
);
