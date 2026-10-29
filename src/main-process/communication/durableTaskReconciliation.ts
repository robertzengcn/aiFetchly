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
  /** Stores the error-file PATH (the entity field is a path, T08). */
  updateTaskErrorFile(id: number, errorLogPath: string): Promise<void>;
  /** Reads a task's existing error-file path (preserved on reconciliation). */
  getTaskErrorFilePath(id: number): Promise<string | undefined>;
}

/**
 * T08: write the interruption note into a REAL log file next to the task's
 * existing logs and return its path — mirrors the module's own sender
 * (WriteLog + updateTaskErrorFile(path)). Injectable for tests.
 */
export type InterruptionLogFileWriter = (
  taskId: number,
  note: string
) => Promise<string>;

export interface SocialReconcileModel {
  /** Task-run ids currently recorded as running, if the subsystem tracks it. */
  listActiveRunIds(): Promise<number[]>;
  markRunInterrupted(id: number, reason: string): Promise<void>;
}

/**
 * Map in-flight bulk-email rows to the existing Error state (T08 semantics):
 *  - the interruption note goes to a REAL log file whose PATH is stored in
 *    the entity's path field — never message text overwriting a path;
 *  - the status write is conditional on the row still being Processing, so
 *    a row that completed concurrently is never flipped to Error;
 *  - the returned id list contains ONLY rows whose writes succeeded — the
 *    coordinator can report task finalization failures honestly.
 */
export async function reconcileBulkEmailAtExit(
  model: BulkEmailReconcileModel,
  reason: string,
  writeInterruptionLog: InterruptionLogFileWriter
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
  const reconciled: number[] = [];
  for (const id of ids) {
    try {
      // Conditional update: only flip rows that are STILL Processing.
      const still = await model.listTaskIdsByStatus(TaskStatus.Processing);
      if (!still.includes(id)) {
        log.info(
          `[bulk-email] task ${id} left Processing before reconciliation; untouched`
        );
        continue;
      }
      const notePath = await writeInterruptionLog(
        id,
        `[interrupted] ${reason}`
      );
      await model.updateTaskStatus(id, TaskStatus.Error);
      await model.updateTaskErrorFile(id, notePath);
      reconciled.push(id);
    } catch (err) {
      log.warn(
        `[bulk-email] failed to reconcile task ${id}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  return reconciled;
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
