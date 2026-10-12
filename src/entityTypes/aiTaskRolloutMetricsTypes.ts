/**
 * Zod v4 schemas + inferred types for the AI task completion rollout
 * metrics snapshot (technical-design §17 monitor gate; PRD §12 measure list).
 *
 * The snapshot is a READ-ONLY aggregation over durable `ai_task_execution` +
 * `ai_task_execution_ledger` + `ai_task_operation` rows. It never mutates
 * anything and never leaves the main process except through the validated
 * IPC envelope (T26b). Untrusted input at the IPC boundary is decoded
 * through `rolloutMetricsQuerySchema`; the emitted snapshot itself is
 * validated by `rolloutMetricsSnapshotSchema` before handoff so a malformed
 * aggregation cannot leak a partial/NaN-poisoned object to the renderer.
 *
 * Secret policy (§17 "safe logs only"): the snapshot carries counters,
 * enums, and durations only — never prompts, arguments, recipients,
 * conversation text, or reasoning.
 */
import { z } from "zod/v4";

// ----- §17 segmentation keys -----

/** Rollout cohort segmentation required by PRD §12 / design §17. */
export const rolloutOriginSchema = z.enum(["manual", "scheduled"]);
export type RolloutOrigin = z.infer<typeof rolloutOriginSchema>;

/**
 * Aggregation window: rows with `createdAt >= since` are in-window. ISO
 * string so the renderer can mint one without importing Date-shape
 * assumptions; bounded to a sane length.
 */
export const rolloutMetricsQuerySchema = z.object({
  since: z.string().datetime({ offset: true }).max(60),
});
export type RolloutMetricsQuery = z.infer<typeof rolloutMetricsQuerySchema>;

// ----- §17 monitor fields (all per-origin, as required) -----

/**
 * Outcome counts keyed by `TaskOutcome`. All seven outcomes appear so a
 * consumer can chart trends without key-presence checks.
 */
export const rolloutOutcomeCountsSchema = z.object({
  verified_complete: z.number().int().min(0),
  incomplete: z.number().int().min(0),
  needs_user_input: z.number().int().min(0),
  blocked_by_policy: z.number().int().min(0),
  failed: z.number().int().min(0),
  cancelled: z.number().int().min(0),
  timeout: z.number().int().min(0),
});
export type RolloutOutcomeCounts = z.infer<typeof rolloutOutcomeCountsSchema>;

/**
 * Ledger-derived consumption for one origin cohort: the "extra
 * resolver/maker/checker calls" and usage monitors of §17. `tokens` carries
 * the actual/estimated label split (reconciled = actual; unreconciled
 * reservations = estimated) so §17's "usage with actual/estimated labels"
 * is a property of the data, not a downstream guess.
 */
export const rolloutConsumptionSchema = z.object({
  executions: z.number().int().min(0),
  continuations: z.number().int().min(0),
  providerAttempts: z.number().int().min(0),
  toolExecutions: z.number().int().min(0),
  checkerAttempts: z.number().int().min(0),
  /** Reconciled (actual) token total for the cohort. */
  actualTokens: z.number().int().min(0),
  /** Outstanding reservations never reconciled to actuals (estimated). */
  estimatedTokens: z.number().int().min(0),
  /** Sum of consumed_active_ms across the cohort's lineages. */
  activeRuntimeMs: z.number().int().min(0),
  /** Sum of consumed_wait_ms across the cohort's lineages. */
  waitMs: z.number().int().min(0),
});
export type RolloutConsumption = z.infer<typeof rolloutConsumptionSchema>;

/** Latency monitor: createdAt → finalized_at, in milliseconds. */
export const rolloutLatencySchema = z.object({
  finalizedCount: z.number().int().min(0),
  /** Sum of (finalized_at - createdAt) across finalized rows, ms. */
  totalLatencyMs: z.number().int().min(0),
  /** finalized_at - createdAt of the slowest finalized row, ms. */
  maxLatencyMs: z.number().int().min(0),
});
export type RolloutLatency = z.infer<typeof rolloutLatencySchema>;

/** One origin cohort of the §17 monitor list. */
export const rolloutOriginCohortSchema = z.object({
  origin: rolloutOriginSchema,
  /** Row counts per route (response_only / task_verified / task_best_effort / preparation). */
  routes: z.record(z.string(), z.number().int().min(0)),
  outcomes: rolloutOutcomeCountsSchema,
  /** Histogram of `outcome_reason_code` for non-verified terminal rows. */
  incompleteReasons: z.record(z.string(), z.number().int().min(0)),
  consumption: rolloutConsumptionSchema,
  latency: rolloutLatencySchema,
});
export type RolloutOriginCohort = z.infer<typeof rolloutOriginCohortSchema>;

/**
 * Operation-protection monitors (§17 "operation reconciliation"). Segmenting
 * these by origin is a property of joining `ai_task_operation.execution_id`
 * back to its execution row's `origin_type`.
 */
export const rolloutOperationStatsSchema = z.object({
  total: z.number().int().min(0),
  pending: z.number().int().min(0),
  /** Non-terminal in-flight states — the "are guards holding" monitor. */
  claimed: z.number().int().min(0),
  dispatched: z.number().int().min(0),
  accepted: z.number().int().min(0),
  completed: z.number().int().min(0),
  failed: z.number().int().min(0),
  /**
   * Uncertain outcome rows awaiting reconciliation (§10.2). §17: investigate
   * any duplicate effect — unknowns are the audit trail for that.
   */
  unknown: z.number().int().min(0),
});
export type RolloutOperationStats = z.infer<typeof rolloutOperationStatsSchema>;

/**
 * The complete §17 monitor snapshot. Every field is derivable from durable
 * rows — nothing here requires live in-memory state, so the snapshot is
 * reproducible after a restart (and comparable against the shadow baseline
 * captured in `execution_state_json.shadowDecision`).
 */
export const rolloutMetricsSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  /** ISO timestamp of the aggregation read (reproducibility label). */
  generatedAt: z.string().min(1).max(60),
  /** Lower bound of the aggregation window (from the validated query). */
  since: z.string().min(1).max(60),
  manual: rolloutOriginCohortSchema,
  scheduled: rolloutOriginCohortSchema,
  operations: rolloutOperationStatsSchema,
});
export type RolloutMetricsSnapshot = z.infer<typeof rolloutMetricsSnapshotSchema>;

/** Empty (all-zero) cohort — the fail-closed shape for a null aggregation. */
export function makeEmptyRolloutOriginCohort(
  origin: RolloutOrigin
): RolloutOriginCohort {
  return {
    origin,
    routes: {},
    outcomes: {
      verified_complete: 0,
      incomplete: 0,
      needs_user_input: 0,
      blocked_by_policy: 0,
      failed: 0,
      cancelled: 0,
      timeout: 0,
    },
    incompleteReasons: {},
    consumption: {
      executions: 0,
      continuations: 0,
      providerAttempts: 0,
      toolExecutions: 0,
      checkerAttempts: 0,
      actualTokens: 0,
      estimatedTokens: 0,
      activeRuntimeMs: 0,
      waitMs: 0,
    },
    latency: { finalizedCount: 0, totalLatencyMs: 0, maxLatencyMs: 0 },
  };
}
