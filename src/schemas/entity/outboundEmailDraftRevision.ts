import { z } from "zod/v4";
import { lazySchema } from "@/utils/lazySchema";

/** Write-boundary schema for {@link OutboundEmailDraftRevisionEntity}. */
export const outboundEmailDraftRevisionWriteSchema = lazySchema(() =>
  z.object({
    draftId: z.number().int(),
    revisionNumber: z.number().int().positive(),
    actor: z.enum(["ai", "user"]),
    emailServiceId: z.number().int(),
    envelopeVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    smtpUsername: z.string().max(255).nullable().optional(),
    replyToAddress: z.string().max(320).nullable().optional(),
    senderAddress: z.string().min(1).max(320),
    recipientAddress: z.string().min(1).max(320),
    subject: z.string().max(500),
    bodyText: z.string(),
    bodyHtml: z.string().nullable().optional(),
    contentHash: z.string().length(64),
    personalizationEvidenceJson: z.string().nullable().optional(),
    knowledgeSourcesJson: z.string().nullable().optional(),
    generationMetadataJson: z.string().nullable().optional(),
    validationFindingsJson: z.string().nullable().optional(),
  })
);
