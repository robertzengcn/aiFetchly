// src/service/aiTaskExecution/TaskExecutionRestartRecovery.ts
//
// T24 (PRD NFR-05, AC-13) — restart interruption recovery.
//
// After an app restart, `ai_task_execution` rows left unfinalized by a
// crash/kill represent work that ran to an unknown point. NFR-05 says the
// restart marks unfinished executions interrupted, preserving checkpoints,
// receipts, and limits; PRD §3.3 says it never auto-replays actions; §6.1
// says a terminal state is immutable. So the sweep finalizes each row
// honestly as `incomplete` / `RESTART_INTERRUPTED` via the coordinator's
// CAS path (which preserves the T20 checkpoint merge and releases the
// ledger owner in the same transaction) and nothing else.
//
// - Both origins recover through `finalizeManual` (the CAS-only path).
//   Scheduled run rows are already marked `interrupted` by
//   `BackgroundScheduler.recoverIntervalRuns`; finalizeScheduledExecution's
//   schedule accounting would double-apply, so recovery never calls it.
// - Idempotent: the sweep only reads unfinalized rows; a concurrent
//   finalizer winning between read and finalize surfaces as
//   ALREADY_FINALIZED → counted as skipped (the row is terminal).
// - Bounded: caps at RECOVERY_SWEEP_MAX_ROWS per run and reports overflow
//   (a corrupted table must not hang startup).
// - Isolated: one broken row logs and continues.
// - Flag-gated: when `isAiTaskCompletionPolicyV1Enabled()` is off the
//   sweep is a pure no-op (§17 rollback — never converts unfinished
//   enrolled work to success; a null task_outcome stays visible as
//   unfinished to every legacy reader).
// - Startup never fatal: the sweep never throws.

import { TaskExecutionCoordinator } from "@/service/aiTaskExecution/TaskExecutionCoordinator";
import { AiTaskExecutionModule } from "@/modules/AiTaskExecutionModule";
import { isAiTaskCompletionPolicyV1Enabled } from "@/config/featureFlags";

/**
 * Reason code stamped on every restart-recovered finalization. The audit
 * TODO names this constant; the string lives here (not in the entity
 * types) because it is a policy-layer reason code, not a schema value.
 */
export const RESTART_INTERRUPTED_REASON = "RESTART_INTERRUPTED";

/**
 * Stable terminal-event dedup identity (design §6.3 step 4). Written by
 * finalization in the same transaction as the outcome; a notification
 * retry reuses this identity instead of minting a second one, so at-most-
 * once delivery is observable from the row itself.
 */
export function buildFinalEventIdentity(executionId: string): string {
  return `execution-result:${executionId}`;
}

/** Cap on rows finalized per sweep (bounded startup work). */
export const RECOVERY_SWEEP_MAX_ROWS = 200;

/** Why a single row failed recovery. */
export interface RestartRecoveryFailure {
  readonly executionId: string;
  readonly reasonCode: string;
}

/** Per-run sweep outcome (returned + logged). */
export interface RestartRecoverySummary {
  /** Rows found by the sweep (pre-cap). */
  readonly scanned: number;
  /** Rows finalized as incomplete/RESTART_INTERRUPTED this run. */
  readonly recovered: number;
  /** Rows skipped: ALREADY_FINALIZED race (terminal, untouched). */
  readonly skipped: number;
  /** Rows that failed recovery (logged, not fatal). */
  readonly failed: number;
  /** Rows beyond the cap (left for the next sweep). */
  readonly overflow: number;
  /** The unfinalized-list read itself failed (nothing was touched). */
  readonly listError: boolean;
  /** Stranded ledger leases released (active owner finalized/missing). */
  readonly ledgersReleased: number;
  readonly failures?: readonly RestartRecoveryFailure[];
}

export class TaskExecutionRestartRecovery {
  private readonly module: AiTaskExecutionModule;
  private readonly coordinator: TaskExecutionCoordinator;

  constructor(
    module?: AiTaskExecutionModule,
    coordinator?: TaskExecutionCoordinator
  ) {
    // Constructor-injected for tests; lazy `new` at call sites avoids the
    // BaseModule top-level TDZ crash (Token.getValue during module eval).
    this.module = module ?? new AiTaskExecutionModule();
    this.coordinator = coordinator ?? new TaskExecutionCoordinator(this.module);
  }

  /**
   * Sweep unfinalized executions and finalize them as interrupted, then
   * reconcile ledger leases the crash stranded. Fire-and-forget safe:
   * never throws. Returns a typed summary.
   */
  async recoverInterruptedExecutions(): Promise<RestartRecoverySummary> {
    const noOp: RestartRecoverySummary = {
      scanned: 0,
      recovered: 0,
      skipped: 0,
      failed: 0,
      overflow: 0,
      listError: false,
      ledgersReleased: 0,
    };
    // §17 rollback: flag off → byte-identical legacy behavior (no reads,
    // no writes, unfinalized rows stay visible as unfinished).
    if (!isAiTaskCompletionPolicyV1Enabled()) {
      return noOp;
    }

    let rows: Awaited<
      ReturnType<AiTaskExecutionModule["getUnfinalizedExecutions"]>
    >;
    try {
      rows = await this.module.getUnfinalizedExecutions();
    } catch (error) {
      console.error(
        "[TaskExecutionRestartRecovery] unfinalized list read failed:",
        error instanceof Error ? error.message : error
      );
      return { ...noOp, listError: true };
    }

    const scanned = rows.length;
    const bounded = rows.slice(0, RECOVERY_SWEEP_MAX_ROWS);
    const overflow = scanned - bounded.length;

    let recovered = 0;
    let skipped = 0;
    const failures: RestartRecoveryFailure[] = [];

    for (const row of bounded) {
      try {
        const result = await this.coordinator.finalizeManual({
          executionId: row.execution_id,
          outcome: "incomplete",
          reasonCode: RESTART_INTERRUPTED_REASON,
          summary: "Execution interrupted by application restart",
          evidenceIds: [],
          remainingWork: [],
        });
        if (result.ok) {
          recovered += 1;
        } else if (result.alreadyFinalized) {
          skipped += 1;
        } else {
          failures.push({
            executionId: row.execution_id,
            reasonCode: result.reasonCode ?? "RECOVERY_ERROR",
          });
        }
      } catch (error) {
        // One broken row must not abort the sweep (log-and-continue).
        console.error(
          `[TaskExecutionRestartRecovery] recovery failed for ${row.execution_id}:`,
          error instanceof Error ? error.message : error
        );
        failures.push({
          executionId: row.execution_id,
          reasonCode: "RECOVERY_ERROR",
        });
      }
    }

    // T24: stranded ledger leases. Run AFTER finalizations so owners this
    // sweep just finalized are counted; a failure here is logged and does
    // not fail the sweep (next startup retries — idempotent).
    let ledgersReleased = 0;
    try {
      ledgersReleased = await this.module.releaseStrandedLedgerOwners();
    } catch (error) {
      console.error(
        "[TaskExecutionRestartRecovery] stranded-ledger reconcile failed:",
        error instanceof Error ? error.message : error
      );
    }

    if (
      recovered > 0 ||
      skipped > 0 ||
      failures.length > 0 ||
      overflow > 0 ||
      ledgersReleased > 0
    ) {
      console.log(
        `[TaskExecutionRestartRecovery] sweep: scanned=${scanned} recovered=${recovered} skipped=${skipped} failed=${failures.length} overflow=${overflow} ledgersReleased=${ledgersReleased}`
      );
    }
    return {
      scanned,
      recovered,
      skipped,
      failed: failures.length,
      overflow,
      listError: false,
      ledgersReleased,
      failures,
    };
  }
}
