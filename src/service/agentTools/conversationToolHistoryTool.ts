/**
 * Handler for the conversation_tool_history tool exposed to the AI.
 *
 * Isolated from SkillRegistry so the registry can lazy-load it the same
 * way as check_shell_status.
 */
import { ConversationToolHistoryService } from "@/service/ConversationToolHistoryService";

export async function handleConversationToolHistory(
  args: Record<string, unknown>,
  conversationId: string
): Promise<{ success: boolean; result: Record<string, unknown> }> {
  const service = new ConversationToolHistoryService();
  const result = await service.lookup(conversationId, args);
  return {
    success: result.success,
    result: {
      success: result.success,
      executionTimeMs: result.executionTimeMs,
      total: result.total,
      truncated: result.truncated,
      records: [...result.records],
      ...(result.error !== undefined ? { error: result.error } : {}),
    },
  };
}
