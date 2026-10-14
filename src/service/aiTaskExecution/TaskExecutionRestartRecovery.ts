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
// - Bounded: caps at RECOVERY_SWEEP_MAX_ROWS per sweep and
//   MAX_RECOVERY_SWEEPS sweeps per run, re-reading between sweeps so a
//   shrinking store drains fully in one startup (G02 — 201+ rows need no
//   repeated restarts); a non-shrinking table terminates with overflow
//   reported instead of hanging startup.
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

/**
 * G02: cap on re-read sweeps per recoverInterruptedExecutions() call. The
 * drain loop re-reads after each capped batch so 201+ interrupted rows
 * recover in one startup without repeated restarts; the sweep cap bounds a
 * corrupted non-shrinking table (10 × 200 rows max, then overflow stays
 * reported for operator intervention).
 */
export const MAX_RECOVERY_SWEEPS = 10;

/**
 * G02: bound on the startup recovery barrier (background.ts awaits the
 * sweep before scheduler/effect startup through {@link awaitRecoveryBarrier}).
 * The sweep itself is bounded (capped sweeps above), so the barrier normally
 * resolves well inside this timeout; on expiry the gate logs and startup
 * proceeds (never fatal, never hangs boot).
 */
export const RECOVERY_BARRIER_TIMEOUT_MS = 30_000;

/**
 * G02: await a bounded startup barrier. Resolves `{ completed: true,
 * result }` when the work finishes in time, `{ completed: false }` on
 * timeout (the work continues in the background; the caller logs and
 * proceeds — startup is never held hostage). Never throws.
 */
export async function awaitRecoveryBarrier<T>(
  work: Promise<T>,
  timeoutMs: number = RECOVERY_BARRIER_TIMEOUT_MS
): Promise<{ readonly completed: true; readonly result: T } | { readonly completed: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<{ readonly completed: false }>((resolve) => {
      timer = setTimeout(() => resolve({ completed: false }), timeoutMs);
    });
    // Promise.race subscribes to both inputs, so a late-settling loser is
    // always handled — never an unhandled rejection.
    return await Promise.race([
      work.then(
        (result): { readonly completed: true; readonly result: T } => ({
          completed: true,
          result,
        })
      ),
      timeout,
    ]);
  } catch (error) {
    console.error("[TaskExecutionRestartRecovery] barrier work threw:", error);
    return { completed: false };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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

    // G02: drain loop. Each sweep finalizes at most RECOVERY_SWEEP_MAX_ROWS
    // rows, then re-reads: finalized rows leave the unfinalized set, so a
    // shrinking store drains fully in one startup call (no repeated app
    // restarts for 201+ interrupted rows). A non-shrinking (corrupt) store
    // terminates after MAX_RECOVERY_SWEEPS bounded sweeps with overflow
    // still reported — startup work stays bounded either way.
    let scanned = 0;
    let recovered = 0;
    let skipped = 0;
    const failures: RestartRecoveryFailure[] = [];
    let overflow = 0;
    // Unique rows observed across re-reads (a re-read overlaps the prior
    // batch's unprocessed tail — count each execution once).
    const seen = new Set<string>();
    for (let sweep = 0; sweep < MAX_RECOVERY_SWEEPS; sweep++) {
      let batch: typeof rows;
      if (sweep === 0) {
        batch = rows;
      } else {
        try {
          batch = await this.module.getUnfinalizedExecutions();
        } catch (error) {
          console.error(
            "[TaskExecutionRestartRecovery] unfinalized re-read failed:",
            error instanceof Error ? error.message : error
          );
          break;
        }
      }
      for (const row of batch) {
        if (!seen.has(row.execution_id)) {
          seen.add(row.execution_id);
          scanned += 1;
        }
      }
      const bounded = batch.slice(0, RECOVERY_SWEEP_MAX_ROWS);
      overflow = batch.length - bounded.length;
      if (bounded.length === 0) {
        overflow = 0;
        break;
      }

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

      if (overflow === 0) break;
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
