/**
 * Results-based no-progress (stall) detection — FR-09 / technical-design
 * §7.2 step 7 + step 9, AC-05 (GAP-S2 #2, Slice 2).
 *
 * The budget already owns the streak COUNTERS (`recordNoProgress` /
 * `resetNoProgressStreak` / `maxNoProgressStreak`); this module is the
 * DETECTOR that feeds them. `TaskRunBudget` is a pure counter object and
 * cannot decide what "progress" means — the tracker computes a per-round
 * progress fingerprint and mutates the streak accordingly:
 *
 * - Same normalized tool request + unchanged result → `recordNoProgress()`
 *   (a repeat of the exact same operation with the exact same outcome is
 *   the §7.2 "first eligible unfinished response without relevant
 *   progress" boundary).
 * - Changed result (including a CHANGED ERROR — FR-09: "A changed error
 *   can justify another allowed action") → `resetNoProgressStreak()`.
 *   A changed error resets the STREAK but never replenishes the total
 *   continuation allowance — the tracker never calls any reserve* method,
 *   so that invariant holds structurally.
 *
 * Fingerprint exclusions (FR-09: "excluding timestamps alone, random IDs,
 * repeated text, and discovery traffic"): `executionTimeMs` and well-known
 * timestamp/ID key names are stripped from the result before hashing;
 * `tool_catalog_search` rounds are discovery traffic and never seed or
 * compare a fingerprint (§7.2: "Discovery calls ... do not reset it");
 * key order is normalized (stable stringify) so a reordered JSON payload
 * from the same producer is not a false "change".
 *
 * Slice-2 wiring (all flag-gated upstream, byte-identical flag-off):
 * - Manual runs: the engine's enrollment seam adds a
 *   `recordToolRoundProgress` closure to `LoopTaskExecutionBinding` closing
 *   over one tracker instance built from `created.budget`.
 * - The loop calls it once per COMMITTED tool round (after the
 *   permission-prompt early return, at the role:"tool" message push).
 * - The controller's §7.2 step 10 continue branch gates on
 *   `!budget.isNoProgressStreakExhausted()`, so a stalled candidate falls
 *   through to finish(incomplete) — with NO_PROGRESS (via
 *   `incompleteReasonCode`, which the streak gate must precede in
 *   precedence) rather than burning the whole continuation allowance and
 *   ending CONTINUATION_LIMIT.
 */
import { createHash } from "crypto";
import type { TaskRunBudget } from "@/service/aiTaskExecution/TaskRunBudget";
import { TOOL_CATALOG_SEARCH_TOOL_NAME } from "@/config/toolCatalogConfig";

/**
 * Result-payload keys that are generated per call and must never count as
 * progress signal: timing, wall-clock timestamps, and correlation IDs.
 * Nested keys with these names are stripped too (recursive walk).
 */
const RESULT_NOISE_KEYS: ReadonlySet<string> = new Set([
  "executionTimeMs",
  "execution_time_ms",
  "timestamp",
  "timestampMs",
  "generatedAt",
  "generated_at",
  "createdAt",
  "created_at",
  "updatedAt",
  "updated_at",
  "occurredAt",
  "occurred_at",
  "requestId",
  "request_id",
  "correlationId",
  "correlation_id",
  "traceId",
  "trace_id",
  "spanId",
  "span_id",
  "jobId",
  "job_id",
  "runId",
  "run_id",
]);

/**
 * Discovery traffic (FR-09 exclusion): tool-catalog discovery calls carry
 * no task progress. They neither seed a fingerprint (so they cannot be
 * compared against work rounds) nor count as progress when changed.
 */
export function isDiscoveryToolCall(toolName: string): boolean {
  return toolName === TOOL_CATALOG_SEARCH_TOOL_NAME;
}

/**
 * Strip generated noise (timestamps, random IDs, timing) from a value,
 * recursively. Returns a new structure — never mutates the input.
 * Non-JSON-safe values (undefined, functions) are normalized to null so
 * key deletion vs undefined-valued keys produce the same fingerprint.
 */
function stripGeneratedNoise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stripGeneratedNoise(entry));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (RESULT_NOISE_KEYS.has(key)) continue;
      cleaned[key] = stripGeneratedNoise(record[key]);
    }
    return cleaned;
  }
  return value ?? null;
}

/**
 * Stable JSON stringify: object keys sorted at every depth so producer key
 * order never differentiates fingerprints of the same logical payload.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(stripGeneratedNoise(value));
}

/**
 * Compute the FR-09 progress fingerprint for one tool round: the normalized
 * (noise-stripped, order-normalized) tool name + arguments + result. Pure
 * function — exported for unit tests and for the loop to fingerprint a
 * round without a tracker instance.
 */
export function buildToolRoundFingerprint(params: {
  toolName: string;
  arguments: Record<string, unknown>;
  resultPayload: Record<string, unknown>;
}): string {
  const canonical = stableStringify({
    toolName: params.toolName,
    arguments: params.arguments,
    result: params.resultPayload,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * One committed tool round as observed by the loop. `arguments` is the
 * EFFECTIVE arguments (post hook-rewrite), `resultPayload` is the
 * normalized tool result payload (`normalizeToolResult(toolResult)`).
 */
export interface ToolRoundObservation {
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
  readonly resultPayload: Record<string, unknown>;
}

export interface TaskProgressTrackerDeps {
  /**
   * The budget whose no-progress streak this tracker maintains. Optional
   * so a flag-off or shadow caller can construct a no-op tracker; when
   * undefined, `recordToolRound` records nothing (byte-identical legacy
   * behavior — the loop's call site guards on the binding's presence
   * anyway, and the tracker stays defensive for direct construction).
   */
  readonly budget?: TaskRunBudget;
}

/**
 * Maintains the last committed work-round fingerprint and drives the
 * budget's no-progress streak. One instance per execution (the engine's
 * enrollment seam builds it from the coordinator's budget); carried
 * through loopInput and the resume paths alongside the binding.
 */
export class TaskProgressTracker {
  private readonly budget?: TaskRunBudget;
  private lastWorkFingerprint: string | null = null;

  constructor(deps: TaskProgressTrackerDeps) {
    this.budget = deps.budget;
  }

  /**
   * Observe one committed tool round. Discovery traffic is skipped
   * entirely (no seed, no compare — FR-09). A work round identical to the
   * previous work round increments the streak; any change resets it.
   */
  recordToolRound(observation: ToolRoundObservation): void {
    if (!this.budget) return;
    if (isDiscoveryToolCall(observation.toolName)) return;
    const fingerprint = buildToolRoundFingerprint({
      toolName: observation.toolName,
      arguments: observation.arguments,
      resultPayload: observation.resultPayload,
    });
    if (
      this.lastWorkFingerprint !== null &&
      this.lastWorkFingerprint === fingerprint
    ) {
      this.budget.recordNoProgress();
      return;
    }
    this.lastWorkFingerprint = fingerprint;
    this.budget.resetNoProgressStreak();
  }
}
