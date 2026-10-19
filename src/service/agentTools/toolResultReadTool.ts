/**
 * Handler for `tool_result_read` (technical design §8.2).
 *
 * Reads ONE bounded page of a preserved output. The active conversation and
 * agent come from trusted `SkillExecutionContext` - a model argument can never
 * select a scope or a filesystem path.
 *
 * This tool never externalizes its own output. That is what prevents the
 * `file_read -> externalize -> file_read` recursion the design calls out: a
 * retrieval result is always small enough to return inline, and if it somehow
 * is not, the envelope reports the limit rather than creating another artifact.
 */
import {
  toolResultReadInputSchema,
} from "@/schemas/toolResult";
import { ToolResultRetrievalService } from "@/service/toolResult/ToolResultRetrievalService";
import { getToolResultContext } from "@/service/agentTools/toolResultContext";
import { TOOL_RESULT_CONFIG } from "@/config/toolResultConfig";
import { countTextTokens } from "@/service/ToolResultTextUtil";
import { fitWrappedRetrievalResult } from "@/service/toolResult/retrievalInlineBound";
import { toolResultMetrics } from "@/service/toolResult/ToolResultMetrics";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import type { StoredToolOutputRef } from "@/entityTypes/toolResultTypes";

export async function handleToolResultRead(
  args: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<{ success: boolean; result: Record<string, unknown> }> {
  const parsed = toolResultReadInputSchema.safeParse(args);
  if (!parsed.success) {
    return { success: false, result: { error: "INVALID_OUTPUT_ARGUMENTS" } };
  }

  const trusted = getToolResultContext(context);
  if (!trusted) {
    return { success: false, result: { error: "OUTPUT_NOT_AVAILABLE" } };
  }

  const target = await trusted.resolveTarget(parsed.data.output_id);
  if (!target.ok) {
    return { success: false, result: { error: target.code } };
  }

  // Charge the SHARED per-turn allowance before doing the work. Read and search
  // draw on the same budget: without this the model could bypass the cap
  // entirely by paging with read instead of searching, looping
  // output_id + next_cursor until the artifact is exhausted.
  const work = await trusted.reserveWork();
  if (!work.ok) {
    toolResultMetrics.record("retrieval.budget_exhausted");
    return {
      success: false,
      result: {
        error: work.code,
        // Be explicit that review is incomplete rather than letting the model
        // infer it read everything.
        analysis_complete: false,
      },
    };
  }

  const service: ToolResultRetrievalService = trusted.retrieval;
  // First-page p95 is an NFR-04 target (≤200 ms); measure the retrieval work
  // (resolution already happened above) so the metric reflects the read cost
  // the model actually pays. `detail: "model"` distinguishes this path from
  // the UI IPC read path that serves the renderer (T17).
  const readStartedAt = performance.now();
  const outcome = await service.read({
    target: target.target,
    cursor: parsed.data.cursor,
    // Always take the model page budget. Omitting max_tokens used to select
    // the 32 KiB UI page, which then got saved as another output.
    maxTokens: parsed.data.max_tokens ?? TOOL_RESULT_CONFIG.readMaxTokens,
  });
  toolResultMetrics.recordLatency(
    "retrieval.latency_ms",
    performance.now() - readStartedAt,
    "model"
  );

  if (!outcome.ok) {
    await trusted.settleWork(0);
    // An exhausted allowance is reported, never silently treated as empty.
    return { success: false, result: { error: outcome.code } };
  }

  const page = outcome.page;
  const fitted = fitWrappedRetrievalResult({
    output_id: page.outputId,
    revision: target.target.revision,
    text: page.text,
    start_byte: page.startByte,
    end_byte: page.endByte,
    total_bytes: page.totalBytes,
    complete: page.complete,
    next_cursor: page.nextCursor,
    source_completeness: target.target.sourceCompleteness,
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
  // Settle the tokens actually returned, so a caller asking for a smaller page
  // spends proportionally less of the turn's allowance.
  await trusted.settleWork(countTextTokens(JSON.stringify(envelope)));
  toolResultMetrics.record("retrieval.read");
  return { success: true, result: envelope };
}

export type { StoredToolOutputRef };
