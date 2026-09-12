// CLAUDE.md mandates importing from "zod/v4" (not bare "zod") to opt into the
// v4 API. The schemas below use only v3/v4-compatible primitives
// (.int/.enum/.min/.nullable/.optional/.literal/.union), so the v4 runtime is
// behaviorally identical here while satisfying the project rule.
import { z } from "zod/v4";
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
    envelopeVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    smtpUsername: z.string().nullable().optional(),
    replyToAddress: z.string().nullable().optional(),
    generationMetadataJson: z.string().nullable().optional(),
    validationFindingsJson: z.string().nullable().optional(),
  })
);
