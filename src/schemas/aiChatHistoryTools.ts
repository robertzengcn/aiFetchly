import { z } from "zod/v4";

/**
 * Zod schemas for the recoverable-history agent tools (technical-design §7).
 * These are the runtime validation boundary for model-supplied tool arguments:
 * the active conversation comes from trusted tool context and is NOT a model
 * argument, and query text is parsed as literal user text (never raw FTS/SQL).
 *
 * The skillsRegistry entry mirrors these as a raw JSON-Schema `parameters`
 * object for the model; the handler runs `.safeParse()` before any work.
 */

export const conversationHistorySearchInputSchema = z.object({
  query: z
    .string()
    .min(1, "query must be non-empty")
    .max(200, "query must be at most 200 characters"),
  before: z.iso.datetime().optional(),
  after: z.iso.datetime().optional(),
  types: z
    .array(z.enum(["user", "assistant", "system", "tool"]))
    .max(4)
    .optional(),
  cursor: z.string().max(1024).optional(),
  limit: z.number().int().min(1).max(20).default(10),
});

export const conversationHistoryReadInputSchema = z
  .object({
    source_id: z.string().max(2048).optional(),
    message_id: z.string().max(100).optional(),
    from_source_id: z.string().max(2048).optional(),
    to_source_id: z.string().max(2048).optional(),
    neighbors: z.number().int().min(0).max(2).optional(),
    cursor: z.string().max(1024).optional(),
  })
  .refine(
    (v) => {
      const hasSingle = !!v.source_id || !!v.message_id;
      const hasRange = !!v.from_source_id && !!v.to_source_id;
      // Exactly one of the two modes (single-point vs range).
      return hasSingle !== hasRange;
    },
    {
      message:
        "Provide exactly one of source_id/message_id or from_source_id+to_source_id",
    }
  );

export type ConversationHistorySearchInput = z.infer<
  typeof conversationHistorySearchInputSchema
>;
export type ConversationHistoryReadInput = z.infer<
  typeof conversationHistoryReadInputSchema
>;
