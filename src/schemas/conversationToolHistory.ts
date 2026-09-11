/**
 * Zod schema for the `conversation_tool_history` built-in tool.
 * Validates tool-call arguments inside execute(); the LLM-facing
 * SkillDefinition parameters remain a hand-authored JSON Schema.
 */
import { z } from "zod/v4";

export const conversationToolHistoryInputSchema = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  tool_call_id: z.string().trim().min(1).max(120).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  include_content: z.boolean().optional(),
});

export type ConversationToolHistoryInput = z.infer<
  typeof conversationToolHistoryInputSchema
>;
