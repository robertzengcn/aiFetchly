/**
 * RolloutConflictMetrics — structured, secret-free emission of §17's
 * "finalization conflicts" monitor (technical-design §17).
 *
 * Unlike every other §17 monitor field, a finalization conflict
 * (STATE_CONFLICT / ALREADY_FINALIZED on the finalize CAS, or a guard
 * CAS loss at dispatch) is a RETURN VALUE, not a durable row — the losing
 * finalizer writes nothing. There is therefore nothing for the rollout
 * snapshot (AiTaskRolloutMetricsModule) to aggregate; the honest coverage
 * is a structured log line at each conflict surface, greppable by
 * operators during rollout (`event=task_finalization_conflict`).
 *
 * Precedent: ToolCatalogMetricsService's `logToolCatalogFilter` — the
 * established `[tag] event=key=value` line shape. Payload carries counters,
 * enums, and opaque IDs only — never prompts, arguments, recipients,
 * conversation text, or reasoning (§17 "safe logs only").
 */

import type { TaskExecutionRoute } from "@/entityTypes/aiTaskExecutionTypes";

/** Which policy surface observed the conflict. */
export type RolloutConflictSurface =
  /** Manual-seam finalize CAS loss (engine complete/cancel/failed gates). */
  | "manual_finalize"
  /** Scheduled-seam finalize CAS loss (runner finalizeChatRun). */
  | "scheduled_finalize"
  /** TaskOperationGuard dispatch CAS loss (send-tool dispatch site). */
  | "operation_dispatch";

export interface FinalizationConflictInput {
  readonly surface: RolloutConflictSurface;
  /** Opaque execution ID — safe (random UUID, never user content). */
  readonly executionId: string;
  /** "manual" | "scheduled" — the §17 segmentation key. */
  readonly origin: "manual" | "scheduled";
  readonly route: TaskExecutionRoute;
  /** CAS-loss reason code: STATE_CONFLICT / ALREADY_FINALIZED / … */
  readonly reasonCode: string;
  /** Which retry observed the conflict: 0 = first attempt, 1 = the retry. */
  readonly attempt: number;
}

/**
 * Emit one `task_finalization_conflict` line. Fire-and-forget by contract —
 * the function never throws and returns void, so a logging failure can
 * never change finalization behavior.
 */
export function logFinalizationConflict(input: FinalizationConflictInput): void {
  console.log(
    `[task-completion] event=task_finalization_conflict surface=${input.surface} executionId=${input.executionId} origin=${input.origin} route=${input.route} reason=${input.reasonCode} attempt=${input.attempt}`
  );
}
