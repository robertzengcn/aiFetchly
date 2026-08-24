/**
 * Prompt-skill hidden-context handoff (design §10.5, §17.2).
 *
 * After a successful `use_skill` call, the tool result message the model
 * sees is a SHORT acknowledgement. The verified instruction block travels
 * separately as a model-only role:user message appended immediately after
 * the tool result — visible to the model, never rendered as a user-authored
 * chat bubble, never persisted as conversation text, and clearly marked as
 * untrusted repository content rather than trusted system policy.
 *
 * Shared by AIChatQueryLoop and AIChatQueryEngine so the two streaming
 * implementations cannot diverge (design §17.2: one message-ordering
 * helper).
 */

import type { OpenAIChatMessage } from "@/api/aiChatApi";
import type { PromptSkillContextAttachment } from "@/entityTypes/promptSkillTypes";

export const PROMPT_SKILL_HANDOFF_MARKER =
  "[application:invoked-prompt-skill]";

export function buildPromptSkillHandoffMessage(
  attachment: PromptSkillContextAttachment
): OpenAIChatMessage {
  return {
    role: "user",
    content: `${PROMPT_SKILL_HANDOFF_MARKER}\n${attachment.normalizedInstructions}`,
  };
}
