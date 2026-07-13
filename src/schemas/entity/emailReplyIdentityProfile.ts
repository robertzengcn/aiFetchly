import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/** Write-boundary schema for {@link EmailReplyIdentityProfileEntity}. */
export const emailReplyIdentityProfileWriteSchema = lazySchema(() =>
  z.object({
    emailServiceId: z.number().int(),
    ownerName: z.string().min(1),
    ownerRole: z.string().nullable().optional(),
    companyName: z.string().nullable().optional(),
    preferredTone: z.string().nullable().optional(),
    signature: z.string().nullable().optional(),
    styleNotes: z.string().nullable().optional(),
    forbiddenPhrasesJson: z.string().nullable().optional(),
    discloseAutomation: z.number().int().optional(),
  }),
);
