import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/** Write-boundary schema for {@link EmailReplyAuditLogEntity}. */
export const emailReplyAuditLogWriteSchema = lazySchema(() =>
  z.object({
    emailServiceId: z.number().int(),
    messageId: z.number().int().nullable().optional(),
    draftId: z.number().int().nullable().optional(),
    action: z.string().min(1),
    actor: z.string().optional(),
    reason: z.string().nullable().optional(),
    metadataJson: z.string().nullable().optional(),
  }),
);
