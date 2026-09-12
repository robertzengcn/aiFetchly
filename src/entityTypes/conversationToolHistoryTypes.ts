/**
 * Types for conversation tool-history index, lookup, and last-N replay.
 * Used so a later turn can see prior tool outcomes without inlining every
 * tool_call/tool_result payload into the prompt.
 */

export const CONVERSATION_TOOL_HISTORY_TOOL_NAME =
  "conversation_tool_history";

/** Max receipts in the always-injected system index. */
export const TOOL_HISTORY_INDEX_LIMIT = 30;

/** Max native OpenAI tool pairs replayed into the next-turn transcript. */
export const TOOL_HISTORY_REPLAY_PAIR_LIMIT = 4;

/** Max characters of a replayed tool result body. */
export const TOOL_HISTORY_REPLAY_RESULT_CHARS = 800;

/** Max characters of a lookup-tool result body. */
export const TOOL_HISTORY_LOOKUP_CONTENT_CHARS = 4000;

/** Max characters of one index line. */
export const TOOL_HISTORY_INDEX_LINE_CHARS = 240;

export type ConversationToolPairStatus = "success" | "error" | "pending";

export interface ConversationToolPair {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
  readonly status: ConversationToolPairStatus;
  readonly summary: string;
  readonly resultContent: string;
  readonly callId: number;
  readonly callTimestampMs: number;
}

export interface ConversationToolHistoryRecord {
  readonly tool_call_id: string;
  readonly tool_name: string;
  readonly status: ConversationToolPairStatus;
  readonly summary: string;
  readonly arguments?: Record<string, unknown>;
  readonly content?: string;
  readonly content_truncated?: boolean;
}

export interface ConversationToolHistoryLookupResult {
  readonly success: boolean;
  readonly executionTimeMs: number;
  readonly total: number;
  readonly truncated: boolean;
  readonly records: readonly ConversationToolHistoryRecord[];
  readonly error?: string;
}

export interface ConversationToolHistoryLookupInput {
  readonly query?: string;
  readonly tool_call_id?: string;
  readonly limit?: number;
  readonly include_content?: boolean;
}
