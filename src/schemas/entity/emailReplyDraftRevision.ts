import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/** Write-boundary schema for {@link EmailReplyDraftRevisionEntity}. */
export const emailReplyDraftRevisionWriteSchema = lazySchema(() =>
  z.object({
    draftId: z.number().int(),
    revisionNumber: z.number().int(),
    actor: z.enum(["ai", "user"]),
    subject: z.string().min(1),
    bodyText: z.string().min(1),
    bodyHtml: z.string().nullable().optional(),
    senderAddress: z.string().min(1),
    recipientAddress: z.string().min(1),
    contentHash: z.string().min(1),
    generationMetadataJson: z.string().nullable().optional(),
    validationFindingsJson: z.string().nullable().optional(),
  }),
);
