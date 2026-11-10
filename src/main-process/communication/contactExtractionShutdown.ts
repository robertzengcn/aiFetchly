import { log } from "@/modules/Logger";
import type { OwnedProcessRegistry } from "@/main-process/lifecycle/OwnedProcessRegistry";
import type { OwnedProcessRecordView } from "@/main-process/lifecycle/OwnedProcessRegistry";
import type { FailDeps } from "./contactExtractionRecovery";
import { failInFlightExtractions } from "./contactExtractionRecovery";

/**
 * contactExtractionShutdown — the §7 parent-side shutdown decision, extracted
 * from contactExtraction-ipc.ts so it is unit-testable with injected deps
 * (the ipc module holds Electron-heavy imports that are impractical to mock).
 *
 * Flow (design §7): send the shutdown-request FIRST (requestId + parent's
 * remaining budget), wait for OBSERVED natural exit within the budget (an ack
 * is not exit proof), then fall back to signal-kill and verify again. The
 * force phase still backstops anything left.
 */

/** Structural worker handle the protocol needs (ChildProcess satisfies this). */
export interface ProtocolWorkerLike {
  pid?: number | null;
  send(message: unknown): boolean;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface WorkerShutdownDeps {
  readonly registry: OwnedProcessRegistry;
  /** Generate the correlatable requestId (uuid in production). */
  readonly newRequestId: () => string;
  /** Log sink (Logger in production). */
  readonly warn: (message: string, err?: unknown) => void;
  readonly info: (message: string) => void;
}

/** How long the kill-fallback verification waits (bounded slice of budget). */
const KILL_VERIFY_SLICE_MS = 1_000;

export async function shutdownContactWorker(
  worker: ProtocolWorkerLike,
  record: OwnedProcessRecordView | undefined,
  budgetMs: number,
  deps: WorkerShutdownDeps
): Promise<boolean> {
  // 1) §7 protocol first: requestId + remaining parent budget.
  const requestId = deps.newRequestId();
  try {
    worker.send({
      type: "shutdown",
      requestId,
      reason: "app-shutdown",
      remainingMs: budgetMs,
    });
  } catch (err) {
    deps.warn(
      "contact-extraction shutdown-request send failed:",
      err
    );
  }

  // 2) Wait for OBSERVED natural exit within the budget.
  if (budgetMs > 0 && record) {
    const exitedNaturally = await deps.registry.observeExit(
      record.id,
      budgetMs
    );
    if (exitedNaturally) return true;
  }

  // 3) Signal-kill fallback + bounded re-verify (an ack is not exit proof).
  try {
    worker.kill();
  } catch (err) {
    deps.warn("contact-extraction worker kill failed:", err);
  }
  if (budgetMs > 0 && record) {
    const exited = await deps.registry.observeExit(
      record.id,
      Math.min(budgetMs, KILL_VERIFY_SLICE_MS)
    );
    if (!exited) {
      deps.warn(
        `[contact-extraction] worker pid=${worker.pid ?? "?"} did not exit within ${budgetMs}ms; force-phase will verify`
      );
    }
    return exited;
  }
  return true;
}

/**
 * FR-06/AC-09 reconciliation: map in-flight rows to the existing failed state
 * with an interruption reason. Never throws — a reconciliation failure is
 * logged and returns [] (the worker shutdown proceeds regardless).
 */
export async function reconcileInterruptedWork(
  deps: FailDeps,
  reason: string,
  warn: (message: string, err?: unknown) => void
): Promise<number[]> {
  try {
    return await failInFlightExtractions(deps, reason);
  } catch (err) {
    warn(
      "[contact-extraction] interrupted-task reconciliation failed:",
      err
    );
    return [];
  }
}

/** Silence unused-import lint when types are re-exported indirectly. */
export type { FailDeps };
void log;
