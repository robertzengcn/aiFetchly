/**
 * Handler for `tool_result_search` (technical design §8.3).
 *
 * Searches a preserved output for a LITERAL substring. The envelope reports
 * `scan_complete` honestly: `true` means every byte of the captured
 * representation was examined, and `false` with a `next_cursor` means the scan
 * stopped early. "No matches" is only a real answer when `scan_complete` is
 * true, and even then it is only an answer about the CAPTURED bytes - a
 * producer that truncated upstream leaves `source_completeness: "partial"`,
 * which is reported separately so absence is never overclaimed.
 */
import { toolResultSearchInputSchema } from "@/schemas/toolResult";
import { getToolResultContext } from "@/service/agentTools/toolResultContext";
import { countTextTokens } from "@/service/ToolResultTextUtil";
import { fitWrappedRetrievalResult } from "@/service/toolResult/retrievalInlineBound";
import { toolResultMetrics } from "@/service/toolResult/ToolResultMetrics";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";

export async function handleToolResultSearch(
  args: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<{ success: boolean; result: Record<string, unknown> }> {
  const parsed = toolResultSearchInputSchema.safeParse(args);
  if (!parsed.success) {
    return { success: false, result: { error: "INVALID_OUTPUT_ARGUMENTS" } };
  }

  const trusted = getToolResultContext(context);
  if (!trusted) {
    return { success: false, result: { error: "OUTPUT_NOT_AVAILABLE" } };
  }

  // Resolve and authorize BEFORE charging the allowance.
  //
  // Order matters: a call for an unknown or unauthorized `output_id` performs no
  // retrieval work, so it must not consume any of the turn's allowance. This
  // matches `tool_result_read`, which also resolves first. Charging first (as
  // this handler used to) meant a model naming a bad id repeatedly burned calls
  // it never used.
  const target = await trusted.resolveTarget(parsed.data.output_id);
  if (!target.ok) {
    return { success: false, result: { error: target.code } };
  }

  // Charge the shared per-turn allowance BEFORE doing the work, so concurrent
  // or repeated retrievals cannot each slip past the cap.
  const work = await trusted.reserveWork();
  if (!work.ok) {
    toolResultMetrics.record("retrieval.budget_exhausted");
    return {
      success: false,
      result: {
        error: work.code,
        // Be explicit that review is incomplete rather than letting the model
        // assume it examined everything.
        analysis_complete: false,
      },
    };
  }

  // Search p95 is an NFR target; measure the scan itself (resolution already
  // happened above). `detail: "model"` distinguishes this from the UI IPC
  // search path that serves the renderer (T17).
  const searchStartedAt = performance.now();
  const outcome = await trusted.retrieval.search({
    target: target.target,
    query: parsed.data.query,
    cursor: parsed.data.cursor,
    maxMatches: parsed.data.max_matches,
  });
  toolResultMetrics.recordLatency(
    "retrieval.latency_ms",
    performance.now() - searchStartedAt,
    "model"
  );

  if (!outcome.ok) {
    // Release the reservation before returning. With settlement now RELEASING
    // `reservedCalls`, an unsettled reservation permanently consumes one of the
    // turn's 32 calls.
    await trusted.settleWork(0);
    return { success: false, result: { error: outcome.code } };
  }

  const page = outcome.page;
  const fitted = fitWrappedRetrievalResult({
    success: true,
    output_id: page.outputId,
    revision: target.target.revision,
    query: parsed.data.query,
    matches: page.matches.map((m) => ({
      start_byte: m.startByte,
      end_byte: m.endByte,
      excerpt: m.excerpt,
      read_cursor: m.readCursor,
      match_count_in_window: m.matchCountInWindow,
    })),
    scan_complete: page.scanComplete,
    next_cursor: page.nextCursor,
    source_completeness: page.sourceCompleteness,
  });
  const envelope =
    fitted !== null && typeof fitted === "object"
      ? (fitted as Record<string, unknown>)
      : {
          success: false,
          error: "RETRIEVAL_PAGE_TOO_LARGE",
          analysis_complete: false,
          output_id: page.outputId,
        };
  await trusted.settleWork(countTextTokens(JSON.stringify(envelope)));
  toolResultMetrics.record("retrieval.search");
  return { success: true, result: envelope };
}
