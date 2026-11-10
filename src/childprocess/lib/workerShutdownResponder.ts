/**
 * workerShutdownResponder — the worker-side half of the §7 graceful shutdown
 * protocol (design §7), shared by every worker entry point.
 *
 * The parent sends `{type:"shutdown", requestId, reason?, remainingMs?}` over
 * the worker's EXISTING transport (process.send for ipc-stdio children,
 * parentPort.postMessage for utility processes). The responder:
 *   1. sets a closing flag so the worker's dispatch rejects new jobs,
 *   2. runs the owner's best-effort `closeOwnedResources` (browsers,
 *      subprocesses) bounded by the parent's remainingMs,
 *   3. acks `{type:"shutdown-ack", requestId}` BEFORE the graceful wait,
 *   4. exits within the allowance (bounded watchdog, default 3s cap).
 *
 * The parent NEVER trusts the ack as exit proof — it observes process death
 * and force-verifies via the registry. Workers without browsers pass no
 * `closeOwnedResources`; a prompt clean exit is still graceful (libuv flush,
 * log writes) versus the force kill.
 *
 * Pure TypeScript + injectable transports/exit so it unit-tests without a
 * real worker process.
 */

export interface WorkerShutdownResponderOptions {
  /** Send a message to the parent (process.send / parentPort.postMessage). */
  readonly send: (message: unknown) => void;
  /** Best-effort close of owned browsers/subprocesses (design §7 step 3). */
  readonly closeOwnedResources?: () => Promise<void>;
  /** Local cap on graceful close when the parent sends no budget (ms). */
  readonly defaultBudgetMs?: number;
  /** Injectable for tests. */
  readonly setTimeoutFn?: typeof setTimeout;
  readonly exit?: (code: number) => void;
  /** Lower bound on the watchdog so a 0ms budget still yields an ack race. */
  readonly minBudgetMs?: number;
}

const DEFAULT_BUDGET_MS = 3_000;
const MIN_BUDGET_MS = 250;

/** Parse + validate the raw shutdown message; null when not a shutdown. */
export function parseShutdownRequest(
  raw: unknown
): { requestId: string; remainingMs?: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw as Record<string, unknown>;
  if (msg.type !== "shutdown") return null;
  if (typeof msg.requestId !== "string" || msg.requestId.length === 0) {
    return null;
  }
  if (
    msg.remainingMs !== undefined &&
    (typeof msg.remainingMs !== "number" ||
      !Number.isInteger(msg.remainingMs) ||
      msg.remainingMs < 0)
  ) {
    return null;
  }
  return {
    requestId: msg.requestId,
    remainingMs: msg.remainingMs as number | undefined,
  };
}

/** Install the §7 responder on a worker. Returns the closing-flag probe. */
export function installWorkerShutdownResponder(
  options: WorkerShutdownResponderOptions
): { isShuttingDown(): boolean; handle(raw: unknown): boolean } {
  const {
    send,
    closeOwnedResources,
    defaultBudgetMs = DEFAULT_BUDGET_MS,
    setTimeoutFn = setTimeout,
    exit = (code: number) => process.exit(code),
    minBudgetMs = MIN_BUDGET_MS,
  } = options;

  let shuttingDown = false;
  let watchdog: ReturnType<typeof setTimeoutFn> | null = null;

  const armWatchdog = (ms: number): void => {
    if (watchdog !== null) clearTimeout(watchdog);
    watchdog = setTimeoutFn(() => exit(0), ms);
    if (typeof (watchdog as { unref?: () => void }).unref === "function") {
      (watchdog as { unref: () => void }).unref();
    }
  };

  const handle = (raw: unknown): boolean => {
    const request = parseShutdownRequest(raw);
    if (!request) return false;
    shuttingDown = true;

    const budget =
      typeof request.remainingMs === "number"
        ? Math.max(minBudgetMs, Math.min(request.remainingMs, defaultBudgetMs))
        : defaultBudgetMs;
    armWatchdog(budget);

    // Ack FIRST (the parent logs correlation), then close owned resources.
    send({ type: "shutdown-ack", requestId: request.requestId });

    void (closeOwnedResources
      ? closeOwnedResources()
          .catch(() => undefined)
          .finally(() => exit(0))
      : Promise.resolve().then(() => exit(0)));
    return true;
  };

  return {
    isShuttingDown: () => shuttingDown,
    handle,
  };
}
