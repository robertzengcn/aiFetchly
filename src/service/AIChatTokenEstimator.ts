import type { OpenAIChatMessage } from "@/api/aiChatApi";

/** Conservative per-message overhead added to account for role tagging. */
const MESSAGE_OVERHEAD_TOKENS = 4;

/** Safety buffer added to final prompt totals. */
const PROMPT_SAFETY_BUFFER_TOKENS = 256;

export class AIChatTokenEstimator {
  estimateText(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  estimateMessage(message: OpenAIChatMessage): number {
    const role = typeof message.role === "string" ? message.role : "";
    const content = typeof message.content === "string" ? message.content : "";
    let total = this.estimateText(role) + this.estimateText(content);
    if (message.tool_call_id) {
      total += this.estimateText(message.tool_call_id);
    }
    if (Array.isArray(message.tool_calls)) {
      total += this.estimateText(JSON.stringify(message.tool_calls));
    }
    return total + MESSAGE_OVERHEAD_TOKENS;
  }

  estimateMessages(messages: readonly OpenAIChatMessage[]): number {
    let sum = 0;
    for (const m of messages) {
      sum += this.estimateMessage(m);
    }
    return sum + PROMPT_SAFETY_BUFFER_TOKENS;
  }
}
