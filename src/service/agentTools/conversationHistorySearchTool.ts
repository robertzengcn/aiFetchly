/**
 * Handler for the conversation_history_search tool (technical-design §7.1).
 *
 * Isolated from SkillRegistry so the registry can lazy-load it the same way
 * as check_shell_status / conversation_tool_history. Delegates to the per-turn
 * AIChatHistoryRetrievalService (§7.4 retrieval budget is shared across calls
 * within one assistant turn).
 *
 * Tool output uses snake_case and exposes `excerpt` + `has_more` per the §7.1
 * response envelope. The active conversation comes from trusted tool context
 * — never a model argument.
 */
import { getRetrievalService } from "@/service/agentTools/historyRetrievalServiceCache";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";

export async function handleConversationHistorySearch(
  args: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<{ success: boolean; result: Record<string, unknown> }> {
  const turnId = context.sourceUserMessageId;
  const service = getRetrievalService(context.conversationId, turnId);
  const result = await service.search({
    conversationId: context.conversationId,
    query: String(args.query ?? ""),
    cursor: typeof args.cursor === "string" ? args.cursor : undefined,
    limit: typeof args.limit === "number" ? args.limit : undefined,
    turnId,
  });

  const records = result.records.map((r) => ({
    source_id: r.sourceId,
    message_id: r.messageId,
    timestamp: r.timestamp,
    role: r.role,
    excerpt: r.text,
    exact: r.exact,
    has_more: r.hasMore,
  }));

  return {
    success: result.errorCode === undefined,
    result: {
      records,
      next_cursor: result.nextCursor,
      truncated: false,
      scan_complete: result.scanComplete,
      index_complete: result.indexComplete,
      ...(result.errorCode !== undefined
        ? { error: result.errorCode }
        : {}),
    },
  };
}
