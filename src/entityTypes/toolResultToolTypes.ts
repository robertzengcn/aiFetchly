/**
 * Public tool names for recoverable large tool results (technical design §8.1).
 *
 * These are the only way the model reaches a preserved output, and they are
 * read-only, local, and scoped: the active conversation, agent, and epoch come
 * from trusted tool context and are never model arguments. An `output_id` is a
 * reference, not an authorization credential - `ToolResultModule` re-checks
 * owner, grant, and epoch on every call.
 */
export const TOOL_RESULT_READ_TOOL_NAME = "tool_result_read";
export const TOOL_RESULT_SEARCH_TOOL_NAME = "tool_result_search";

/** Both retrieval tools share one per-turn work allowance. */
export const TOOL_RESULT_RETRIEVAL_TOOL_NAMES: ReadonlySet<string> = new Set([
  TOOL_RESULT_READ_TOOL_NAME,
  TOOL_RESULT_SEARCH_TOOL_NAME,
]);
