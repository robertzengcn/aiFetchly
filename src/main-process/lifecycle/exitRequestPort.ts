import type { ApplicationExitReason } from "@/entityTypes/applicationLifecycleTypes";

/**
 * exitRequestPort — the composition seam between feature code (updater,
 * menu, tray) and background.ts's coordinated exit (technical design §12).
 *
 * background.ts binds the real implementation at module load, BEFORE any
 * window/menu/updater exists. Feature modules call {@link requestAppExit}
 * and get the coordinated path (cleanup -> terminal action). When nothing
 * is bound (unit tests, very early startup), callers keep their own
 * fallback behavior via {@link isExitRequestorBound}.
 *
 * The update-restart terminal action (§12 "invoke the selected terminal
 * callback exactly once") is registered alongside: ordinary quit must never
 * discard a pending accepted update install, and the action is consumed
 * exactly once.
 */

type ExitRequestor = (reason: ApplicationExitReason) => Promise<void>;

let exitRequestor: ExitRequestor | null = null;
let updateRestartAction: (() => void) | null = null;

/** background.ts binds this once at module load (idempotent). */
export function bindExitRequestor(requestor: ExitRequestor): void {
  exitRequestor = requestor;
}

/** True once the coordinated exit path is available. */
export function isExitRequestorBound(): boolean {
  return exitRequestor !== null;
}

/** Request the coordinated exit; no-op (never throws) when unbound. */
export async function requestAppExit(
  reason: ApplicationExitReason
): Promise<void> {
  if (!exitRequestor) return;
  try {
    await exitRequestor(reason);
  } catch {
    // The coordinator itself never throws; guard anyway — exit requests
    // must not leak rejections into feature callers.
  }
}

/**
 * Register the updater's terminal callback. Invoked exactly once after
 * cleanup completes for a shutdown whose terminal intent is
 * `update-restart`; consumed on read.
 */
export function setUpdateRestartAction(action: (() => void) | null): void {
  updateRestartAction = action;
}

export function takeUpdateRestartAction(): (() => void) | null {
  const action = updateRestartAction;
  updateRestartAction = null;
  return action;
}
