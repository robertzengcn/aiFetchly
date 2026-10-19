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
