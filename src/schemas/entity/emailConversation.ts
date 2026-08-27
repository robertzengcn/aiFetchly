import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/** Write-boundary schema for {@link EmailConversationEntity}. */
export const emailConversationWriteSchema = lazySchema(() =>
  z.object({
    emailServiceId: z.number().int(),
    rootMessageKey: z.string().min(1),
    displaySubject: z.string().nullable().optional(),
    contextConfidence: z.enum(["exact", "partial", "ambiguous"]).optional(),
    ambiguityReason: z.string().nullable().optional(),
    lastMessageAt: z.coerce.date(),
    contextVersion: z.number().int().optional(),
  }),
);
