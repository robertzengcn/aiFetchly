/**
 * Handler for the conversation_history_read tool (technical-design §7.2).
 *
 * Accepts exactly one of: source_id, message_id, or from_source_id +
 * to_source_id; optional neighbors 0–2 and cursor. Delegates to the per-turn
 * AIChatHistoryRetrievalService. Tool output uses snake_case and exposes
 * `excerpt` + `has_more` per the §7.2 response envelope. The active
 * conversation comes from trusted tool context — never a model argument.
 */
import { getRetrievalService } from "@/service/agentTools/historyRetrievalServiceCache";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";

export async function handleConversationHistoryRead(
  args: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<{ success: boolean; result: Record<string, unknown> }> {
  const turnId = context.sourceUserMessageId;
  const service = getRetrievalService(context.conversationId, turnId);
  const result = await service.read({
    conversationId: context.conversationId,
    args,
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
      truncated: result.truncated,
      source_revision: result.sourceRevision,
      stored_content_incomplete: result.storedContentIncomplete,
      ...(result.errorCode !== undefined
        ? { error: result.errorCode }
        : {}),
    },
  };
}
