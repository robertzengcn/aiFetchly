import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/** Write-boundary schema for {@link EmailReplyApprovalEntity}. */
export const emailReplyApprovalWriteSchema = lazySchema(() =>
  z.object({
    draftId: z.number().int(),
    revisionId: z.number().int(),
    approvedByType: z.enum(["user", "tool_confirmation"]),
    approvedById: z.string().nullable().optional(),
    approvedHash: z.string().min(1),
    approvalTokenHash: z.string().min(1),
    approvedAt: z.coerce.date(),
    expiresAt: z.coerce.date().nullable().optional(),
    invalidatedAt: z.coerce.date().nullable().optional(),
    invalidationReason: z.string().nullable().optional(),
  }),
);
