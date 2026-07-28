import { windowInvoke } from "@/views/utils/apirequest";
import { AI_CHAT_V2_AT_MENTION_SUGGEST } from "@/config/channellist";
import type {
  ChatV2AtMentionSuggestionRequest,
  ChatV2AtMentionSuggestionResponse,
} from "@/entityTypes/aiChatAtMentionTypes";

/**
 * Renderer API for @-mention autocomplete.
 *
 * `windowInvoke` returns the unwrapped `result.data` from the IPC handler,
 * so the return type matches the inner payload directly.
 *
 * This file is renderer-side: it must not import `fs`, `path`, `os`,
 * `fast-glob`, `WorkspaceResolver`, or `FilePathGuard`. Boundary tests
 * enforce this.
 */
export async function listAtMentionSuggestions(
  request: ChatV2AtMentionSuggestionRequest
): Promise<ChatV2AtMentionSuggestionResponse | null> {
  const resp = await windowInvoke(AI_CHAT_V2_AT_MENTION_SUGGEST, request);
  return (resp as ChatV2AtMentionSuggestionResponse | null) ?? null;
}
