import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/** Write-boundary schema for {@link EmailReplyKnowledgeScopeEntity}. */
export const emailReplyKnowledgeScopeWriteSchema = lazySchema(() =>
  z.object({
    emailServiceId: z.number().int(),
    version: z.number().int().optional(),
    documentIdsJson: z.string(),
    tagsJson: z.string(),
    allowAllDocuments: z.number().int().min(0).max(1).optional(),
    excludeInactiveDocuments: z.number().int().min(0).max(1).optional(),
  }),
);
