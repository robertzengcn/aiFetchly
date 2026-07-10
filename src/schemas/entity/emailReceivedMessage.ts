import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * Write-boundary schema for {@link EmailReceivedMessageEntity}.
 * Used by `parseAndStrip` to drop unknown fields before persistence.
 */
export const emailReceivedMessageWriteSchema = lazySchema(() =>
  z.object({
    emailServiceId: z.number().int(),
    providerUid: z.string().min(1),
    messageId: z.string().nullable().optional(),
    threadKey: z.string().nullable().optional(),
    inReplyTo: z.string().nullable().optional(),
    referencesHeader: z.string().nullable().optional(),
    fromAddress: z.string().min(1),
    fromName: z.string().nullable().optional(),
    replyToAddress: z.string().nullable().optional(),
    toAddressesJson: z.string(),
    ccAddressesJson: z.string().nullable().optional(),
    subject: z.string(),
    bodyText: z.string().nullable().optional(),
    bodyHtmlSanitized: z.string().nullable().optional(),
    snippet: z.string().nullable().optional(),
    receivedAt: z.coerce.date(),
    isUnread: z.number().int().optional(),
    classification: z.string().nullable().optional(),
    classificationConfidence: z.number().nullable().optional(),
    replyStatus: z.string().optional(),
    processedAt: z.coerce.date().nullable().optional(),
  }),
);
