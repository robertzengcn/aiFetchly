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

  const target = await trusted.resolveTarget(parsed.data.output_id);
  if (!target.ok) {
    return { success: false, result: { error: target.code } };
  }

  const outcome = await trusted.retrieval.search({
    target: target.target,
    query: parsed.data.query,
    cursor: parsed.data.cursor,
    maxMatches: parsed.data.max_matches,
  });

  if (!outcome.ok) {
    return { success: false, result: { error: outcome.code } };
  }

  const page = outcome.page;
  const envelope = {
    success: true,
    output_id: page.outputId,
    query: parsed.data.query,
    matches: page.matches.map((m) => ({
      start_byte: m.startByte,
      end_byte: m.endByte,
      excerpt: m.excerpt,
      read_cursor: m.readCursor,
    })),
    scan_complete: page.scanComplete,
    next_cursor: page.nextCursor,
    source_completeness: page.sourceCompleteness,
  };
  await trusted.settleWork(countTextTokens(JSON.stringify(envelope)));
  toolResultMetrics.record("retrieval.search");
  return { success: true, result: envelope };
}
