/**
 * In-memory registry of active scheduled-loop occurrence executions, keyed by
 * task-run id. Used by `AIChatScheduledLoopModule.stopCurrentRun()` to abort the
 * live query engine of the occurrence currently executing in
 * `ScheduledAiMessageRunner`.
 *
 * This is an execution aid only — never recovery state. It lives in memory and
 * disappears at process restart; durable run state is recovered from the
 * database (technical-design §15.4, §17.4).
 */
export class ScheduledLoopRunRegistry {
  private static instance: ScheduledLoopRunRegistry | null = null;
  private readonly controllers = new Map<number, AbortController>();

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  static getInstance(): ScheduledLoopRunRegistry {
    if (!ScheduledLoopRunRegistry.instance) {
      ScheduledLoopRunRegistry.instance = new ScheduledLoopRunRegistry();
    }
    return ScheduledLoopRunRegistry.instance;
  }

  /** Register the abort controller for an active occurrence run. */
  register(runId: number, controller: AbortController): void {
    this.controllers.set(runId, controller);
  }

  /** Unregister a run when its execution terminates. Idempotent. */
  unregister(runId: number): void {
    this.controllers.delete(runId);
  }

  /** Abort the active occurrence run if one is registered. Returns whether a
   * live controller was found and aborted. */
  abort(runId: number): boolean {
    const controller = this.controllers.get(runId);
    if (!controller) return false;
    if (!controller.signal.aborted) {
      controller.abort();
    }
    return true;
  }

  /** Whether a live (non-aborted) controller is registered for the run. */
  has(runId: number): boolean {
    const controller = this.controllers.get(runId);
    return !!controller && !controller.signal.aborted;
  }
}
