import { ipcMain } from "electron";
import { AI_CHAT_V2_AT_MENTION_SUGGEST } from "@/config/channellist";
import { AtMentionSuggestionService } from "@/service/aiChatAtMentions/AtMentionSuggestionService";
import { AT_MENTION_MAX_QUERY_CHARS } from "@/service/aiChatAtMentions/AtMentionLimits";
import { userSafeError } from "@/service/AIChatErrorMapper";
import type { CommonMessage } from "@/entityTypes/commonType";
import type {
  ChatV2AtMentionSuggestionRequest,
  ChatV2AtMentionSuggestionResponse,
} from "@/entityTypes/aiChatAtMentionTypes";

// Reuses the same CommonMessage envelope shape as the other Chat V2 handlers.
function ok<T>(data: T): CommonMessage<T> {
  return { status: true, msg: "", data };
}
function denied<T>(msg: string): CommonMessage<T> {
  return { status: false, msg, data: undefined };
}

/**
 * Validate and coerce the raw IPC payload into a suggestion request.
 *
 * Accepts either a JSON string or a plain object (matching local convention).
 * `conversationId` is optional; `query` is required and length-capped.
 */
function parseSuggestionRequest(
  data: unknown
): ChatV2AtMentionSuggestionRequest | string {
  let raw: unknown = data;
  if (typeof raw === "string" && raw.length > 0) {
    try {
      raw = JSON.parse(raw);
    } catch {
      return "Invalid request payload";
    }
  }

  if (!raw || typeof raw !== "object") {
    return "Invalid request payload";
  }
  const obj = raw as {
    conversationId?: unknown;
    query?: unknown;
    limit?: unknown;
  };

  let conversationId: string | undefined;
  if (obj.conversationId !== undefined && obj.conversationId !== null) {
    if (typeof obj.conversationId !== "string") {
      return "conversationId must be a string";
    }
    conversationId = obj.conversationId;
  }

  if (typeof obj.query !== "string") {
    return "query must be a string";
  }
  const query = obj.query.slice(0, AT_MENTION_MAX_QUERY_CHARS);

  let limit: number | undefined;
  if (obj.limit !== undefined && obj.limit !== null) {
    if (typeof obj.limit !== "number" || !Number.isFinite(obj.limit)) {
      return "limit must be a number";
    }
    limit = obj.limit;
  }

  return { conversationId, query, limit };
}

async function handleSuggest(
  data: unknown
): Promise<CommonMessage<ChatV2AtMentionSuggestionResponse | null>> {
  const parsed = parseSuggestionRequest(data);
  if (typeof parsed === "string") {
    return denied(parsed);
  }
  try {
    const service = new AtMentionSuggestionService();
    const result = await service.suggest(parsed);
    return ok(result);
  } catch (err) {
    // Never expose stack traces or absolute paths to the renderer.
    console.error("[ai-chat-v2] at-mention suggest failed:", err);
    return denied(userSafeError(err));
  }
}

/**
 * Register @-mention IPC handlers.
 *
 * The suggestion handler does NOT call a model and therefore does not require
 * the hosted-AI availability gate that AI_CHAT_V2_STREAM enforces. It still
 * fails closed: without an approved workspace it returns workspaceRequired
 * and performs no filesystem search.
 */
export function registerAiChatAtMentionIpcHandlers(): void {
  ipcMain.handle(AI_CHAT_V2_AT_MENTION_SUGGEST, async (_e, data: unknown) =>
    handleSuggest(data)
  );
}
