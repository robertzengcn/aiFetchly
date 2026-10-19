/**
 * Shared recovery guidance surfaced alongside every preserved-tool-output
 * denial (`OUTPUT_NOT_AVAILABLE` / `OUTPUT_INTEGRITY_FAILED` / etc.).
 *
 * Why this exists: the retrieval tools (`tool_result_read`,
 * `tool_result_search`) deliberately collapse missing, unauthorized, and
 * expired outputs into one opaque code (AC-11 anti-oracle: existence must
 * never leak). But a BARE `{ error }` stub gives the model zero recovery
 * guidance, which invites retry and id fabrication — observed in the wild
 * when a model that had just received a receipt for `out_a76191c1...`
 * called `tool_result_search` with a different, never-issued
 * `out_5cb02128...`. This mirrors the `check_tool_job_status`
 * hallucination class (fix 6a25f7b56): pair every negative lookup result
 * with a recovery instruction.
 *
 * The text is a CONSTANT, never derived from user input or the denied id, so
 * it cannot leak which branch of the denial was taken. It tells the model
 * exactly one thing: re-use an existing receipt's `output_id` verbatim, and
 * do not invent one.
 */
export const TOOL_RESULT_DENIAL_RECOVERY =
  "The output_id was not found or is not available in this conversation. " +
  "Do not retry with an invented or transcribed id. Re-issue the producer " +
  "tool call (e.g. knowledge_library_search) to obtain a fresh receipt, or " +
  "copy the output_id exactly as printed in a prior saved-result receipt " +
  "(out_...) and call tool_result_read with it.";

/**
 * Shown with `INVALID_OUTPUT_CURSOR`. A bare code makes the model retry the
 * same damaged cursor. The text tells it to drop that cursor and continue
 * from a verbatim next_cursor or from the start.
 */
export const TOOL_RESULT_CURSOR_RECOVERY =
  "INVALID_OUTPUT_CURSOR means this cursor was changed, truncated, or does not " +
  "match this output_id, mode, and query. Do not retry the same cursor. " +
  "Copy next_cursor from the latest successful page exactly, including the " +
  "signature after the final dot, or omit cursor and pass only output_id to " +
  "start over. Never reconstruct a cursor. A search continuation must reuse " +
  "the same query string.";

/**
 * Shown when `tool_result_search` arguments fail schema validation. A bare
 * code makes the model change the query and retry the same illegal
 * `max_matches`.
 */
export const TOOL_RESULT_SEARCH_ARGUMENT_RECOVERY =
  "INVALID_OUTPUT_ARGUMENTS means a search field was invalid. " +
  "output_id must be copied verbatim from a receipt (out_...). " +
  "query must be literal text of 1 to 200 characters, never a regex. " +
  "max_matches must be an integer from 1 to 20; omit it to use 10. " +
  "Do not pass 30, 50, or any value above 20. " +
  "cursor, when present, must be the previous search next_cursor copied verbatim.";

/** Attach cursor recovery only for the invalid-cursor failure. */
export function toolResultReadFailure(
  code: string
): Record<string, unknown> {
  if (code === "INVALID_OUTPUT_CURSOR") {
    return { error: code, recovery: TOOL_RESULT_CURSOR_RECOVERY };
  }
  return { error: code };
}
