import { log } from "@/modules/Logger";
import { TaskStatus } from "@/entityTypes/commonType";

/**
 * durableTaskReconciliation — FR-06/AC-09 at-exit mapping for the remaining
 * durable subsystems (2026-09-20 TODO task 4): bulk-email (BuckemailTask) and
 * social task runs.
 *
 * Rules (PRD FR-06):
 *  - completed rows are never touched;
 *  - running/processing rows map to an EXISTING state (Error / Cancel) with
 *    an interruption note — never a new status, never silently "complete";
 *  - nothing is auto-retried: retries stay user-initiated, so uncertain SMTP
 *    / publish outcomes are recorded as interrupted, not queued again.
 *
 * Model access is injected so the mapping is unit-testable without a DB.
 */

/** Minimal model surface the reconciliation needs (BuckemailTask.model). */
export interface BulkEmailReconcileModel {
  listTaskIdsByStatus(status: TaskStatus): Promise<number[]>;
  updateTaskStatus(id: number, status: TaskStatus): Promise<void>;
  /** Writes the task's error-file note (updateTaskErrorFile in production). */
  updateTaskErrorFile(id: number, message: string): Promise<void>;
}

export interface SocialReconcileModel {
  /** Task-run ids currently recorded as running, if the subsystem tracks it. */
  listActiveRunIds(): Promise<number[]>;
  markRunInterrupted(id: number, reason: string): Promise<void>;
}

/** Map in-flight bulk-email rows to the existing Error state. */
export async function reconcileBulkEmailAtExit(
  model: BulkEmailReconcileModel,
  reason: string
): Promise<number[]> {
  let ids: number[] = [];
  try {
    ids = await model.listTaskIdsByStatus(TaskStatus.Processing);
  } catch (err) {
    log.warn(
      "[bulk-email] could not list processing rows for reconciliation:",
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
  for (const id of ids) {
    try {
      // Error (existing status) — completed/un-started rows are untouched and
      // nothing is requeued: retry stays a user action.
      await model.updateTaskStatus(id, TaskStatus.Error);
      await model.updateTaskErrorFile(id, `[interrupted] ${reason}`);
    } catch (err) {
      log.warn(
        `[bulk-email] failed to reconcile task ${id}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  return ids;
}

/** Map running social task runs to the subsystem's interrupted marker. */
export async function reconcileSocialAtExit(
  model: SocialReconcileModel,
  reason: string
): Promise<number[]> {
  let ids: number[] = [];
  try {
    ids = await model.listActiveRunIds();
  } catch (err) {
    log.warn(
      "[social] could not list active runs for reconciliation:",
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
  for (const id of ids) {
    try {
      await model.markRunInterrupted(id, reason);
    } catch (err) {
      log.warn(
        `[social] failed to reconcile run ${id}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  return ids;
}
