/**
 * Agent task control (PRD §6.12; technical design §18).
 *
 * Owns the AGENT task state layer, separate from the browser control layer
 * (which stays in ManagedBrowserModule as `handoff`/`user_login_in_progress`):
 *
 *   running | waiting_for_user | paused | cancelling
 *   | completed | failed | cancelled | interrupted
 *
 * Every user takeover sets BOTH layers: the browser moves to user control
 * (AI commands rejected) and the agent loop stops at a safe point via its
 * control gate. Only the user's dialog action ends a takeover — no model can
 * resume itself (C-FR-03/04). Time spent waiting for the user never counts
 * against active-time budgets (C-FR-09/D-21).
 */

export type AgentTaskControlState =
  | "running"
  | "waiting_for_user"
  | "paused"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface UserIntervention {
  readonly reason: string;
  readonly startedAtEpochMs: number;
  readonly durationMs: number | null;
}

export interface AgentTaskControlGate {
  readonly state: AgentTaskControlState;
  /**
   * Resolves when the gate reopens (resume); rejects when the task is
   * stopped/cancelled while paused. Checked at every safe point.
   */
  waitUntilOpen(signal: AbortSignal): Promise<void>;
}

export interface TaskControlRecord {
  readonly taskId: string;
  readonly conversationId: string;
  state: AgentTaskControlState;
  reason: string | null;
  /** Accumulated active (non-waiting) time in ms. */
  activeTimeMs: number;
  /** Non-null while the clock is running (not waiting for the user). */
  runningSinceEpochMs: number | null;
  interventions: UserIntervention[];
  openIntervention: { reason: string; startedAtEpochMs: number } | null;
}

const TERMINAL_STATES: ReadonlySet<AgentTaskControlState> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export class AgentTaskControlService {
  private readonly tasks = new Map<string, TaskControlRecord>();
  private readonly waiters = new Map<
    string,
    Set<{ resolve: () => void; reject: (error: Error) => void }>
  >();
  /** R04: per-task resume generation (incremented on resume). */
  private readonly resumeGenerations = new Map<string, number>();
  /** B13/C-FR-07: instructions typed by the user on resume (consume-once). */
  private readonly resumeInstructions = new Map<string, string>();
  private readonly now: () => number;
  /** F06: lazy sweep enforcing the 60-minute pause/wait cap. */
  private pauseCapSweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  public register(
    taskId: string,
    conversationId: string
  ): TaskControlRecord {
    const existing = this.tasks.get(taskId);
    if (existing) {
      return existing;
    }
    const record: TaskControlRecord = {
      taskId,
      conversationId,
      state: "running",
      reason: null,
      activeTimeMs: 0,
      runningSinceEpochMs: this.now(),
      interventions: [],
      openIntervention: null,
    };
    this.tasks.set(taskId, record);
    return record;
  }

  public get(taskId: string): TaskControlRecord | null {
    return this.tasks.get(taskId) ?? null;
  }

  public getState(taskId: string): AgentTaskControlState | null {
    return this.tasks.get(taskId)?.state ?? null;
  }

  public setState(
    taskId: string,
    state: AgentTaskControlState,
    reason?: string
  ): void {
    const record = this.tasks.get(taskId);
    if (!record) {
      return;
    }
    // F07: failed/completed are FINAL — no failed→completed overwrites.
    // A cancelled record may still be REFINED by the collector: Return-
    // now pre-cancels a batch, and the real per-task outcome (failed /
    // completed with usable output) replaces the pre-cancellation mark.
    if (TERMINAL_STATES.has(record.state)) {
      const refinementAllowed =
        record.state === "cancelled" &&
        (state === "failed" || state === "completed");
      if (refinementAllowed) {
        record.state = state;
        record.reason = reason ?? record.reason;
      } else if (state === record.state) {
        record.reason = reason ?? record.reason;
      }
      return;
    }
    if (record.state !== state) {
      // Active-time accounting (C-FR-09/D-21): the clock accumulates only
      // while running; waits freeze it and never count against budgets.
      const willWait = isWaitingState(state);
      const becomesTerminal = TERMINAL_STATES.has(state);
      if (record.runningSinceEpochMs !== null && (willWait || becomesTerminal)) {
        record.activeTimeMs += this.now() - record.runningSinceEpochMs;
        record.runningSinceEpochMs = null;
      } else if (
        record.runningSinceEpochMs === null &&
        !willWait &&
        !becomesTerminal
      ) {
        record.runningSinceEpochMs = this.now();
      }
      record.state = state;
    }
    record.reason = reason ?? record.reason;
    if (TERMINAL_STATES.has(state)) {
      this.resolveAllWaiters(taskId);
      // F07: bounded retirement — a terminal task can never be waited on
      // or resumed again, so its transient state is released.
      this.waiters.delete(taskId);
      this.resumeGenerations.delete(taskId);
    }
  }

  /** Begin a user intervention (waiting_for_user reason, C-FR-12). */
  public beginIntervention(taskId: string, reason: string): void {
    const record = this.tasks.get(taskId);
    if (!record) {
      return;
    }
    // X4: a terminal record never opens interventions (the sweep timer
    // would leak), and an explicit PAUSE keeps its own state — an
    // intervention on a paused task must not downgrade it to
    // waiting_for_user (the UI never shows "Paused by you" then).
    if (TERMINAL_STATES.has(record.state)) {
      return;
    }
    record.openIntervention = { reason, startedAtEpochMs: this.now() };
    if (record.state !== "paused") {
      this.setState(taskId, "waiting_for_user", reason);
    }
    this.ensurePauseCapSweep();
  }

  /**
   * F06: the pause cap is SCHEDULED — a lazy sweep runs while any task
   * is paused/waiting and stops itself when none remain.
   */
  private ensurePauseCapSweep(): void {
    if (this.pauseCapSweepTimer) {
      return;
    }
    const timer = setInterval(() => {
      let pausable = 0;
      for (const [taskId, record] of this.tasks) {
        if (record.state === "paused" || record.state === "waiting_for_user") {
          pausable++;
          this.enforcePauseCap(taskId);
        }
      }
      if (pausable === 0 && this.pauseCapSweepTimer) {
        clearInterval(this.pauseCapSweepTimer);
        this.pauseCapSweepTimer = null;
      }
    }, 30_000);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    this.pauseCapSweepTimer = timer;
  }

  /** End the open intervention (user acted or the window lapsed). */
  public endIntervention(taskId: string): void {
    const record = this.tasks.get(taskId);
    if (!record?.openIntervention) {
      return;
    }
    record.interventions.push({
      reason: record.openIntervention.reason,
      startedAtEpochMs: record.openIntervention.startedAtEpochMs,
      durationMs: this.now() - record.openIntervention.startedAtEpochMs,
    });
    record.openIntervention = null;
  }

  /**
   * The per-task control gate (C-FR-05): closed while paused. Agent loops
   * and the runner check it at safe points (before each model call, before
   * each tool call, between actions of a running program).
   */
  public getGate(taskId: string): AgentTaskControlGate {
    // P0-fix (lint): no-this-alias — arrow closures capture the class
    // instance lexically instead of aliasing `this`.
    const readRecord = (): TaskControlRecord | undefined =>
      this.tasks.get(taskId);
    return {
      get state(): AgentTaskControlState {
        return readRecord()?.state ?? "cancelled";
      },
      waitUntilOpen: async (signal: AbortSignal): Promise<void> => {
        const record = this.tasks.get(taskId);
        if (!record) {
          throw new Error("task_not_found");
        }
        if (TERMINAL_STATES.has(record.state)) {
          throw new Error(`task_${record.state}`);
        }
        if (!isWaitingState(record.state)) {
          return;
        }
        await new Promise<void>((resolve, reject) => {
          const onAbort = (): void => {
            reject(new Error("task_cancelled"));
          };
          signal.addEventListener("abort", onAbort, { once: true });
          let set = this.waiters.get(taskId);
          if (!set) {
            set = new Set();
            this.waiters.set(taskId, set);
          }
          set.add({
            resolve: () => {
              signal.removeEventListener("abort", onAbort);
              resolve();
            },
            reject: (error: Error) => {
              signal.removeEventListener("abort", onAbort);
              reject(error);
            },
          });
        });
      },
    };
  }

  /** Resume from pause/waiting: reopens the gate (user-initiated only). */
  public resume(taskId: string): boolean {
    const record = this.tasks.get(taskId);
    if (!record || TERMINAL_STATES.has(record.state)) {
      return false;
    }
    this.setState(taskId, "running");
    // R04/C-FR-06: increment the generation so runners discard proposals
    // that were pending across the pause/resume boundary.
    this.resumeGenerations.set(taskId, (this.resumeGenerations.get(taskId) ?? 0) + 1);
    this.resolveAllWaiters(taskId);
    return true;
  }

  /** R04: the resume generation for a task (0 if never paused). */
  public getResumeGeneration(taskId: string): number {
    return this.resumeGenerations.get(taskId) ?? 0;
  }

  /**
   * B13/C-FR-07: the instructions the user typed when resuming. The
   * consuming loop (runner/sub-agent) folds them into its next decision
   * input; they are consumed exactly once.
   */
  public recordResumeInstructions(taskId: string, instructions: string): void {
    const trimmed = instructions.trim();
    if (trimmed.length === 0) {
      return;
    }
    this.resumeInstructions.set(taskId, trimmed.slice(0, 2000));
  }

  public consumeResumeInstructions(taskId: string): string | null {
    const stored = this.resumeInstructions.get(taskId) ?? null;
    if (stored !== null) {
      this.resumeInstructions.delete(taskId);
    }
    return stored;
  }

  /** Stop: cancels every waiter (the loop fails fast, C-FR-04). */
  public cancel(taskId: string, reason = "user_stop"): void {
    this.setState(taskId, "cancelled", reason);
    this.resolveAllWaiters(taskId);
  }

  /**
   * C-FR-14/D-FR-10: the startup sweep — every non-terminal control
   * record is marked interrupted (partial results; no automatic resume).
   * In-memory records cannot survive a restart, but the invariant is
   * enforced at IPC-registration time so a future persistence layer (or
   * a stale in-process record) can never leave a task running across a
   * startup.
   */
  public sweepNonTerminalToInterrupted(reason = "startup_sweep"): number {
    let swept = 0;
    for (const [taskId, record] of [...this.tasks.entries()]) {
      if (!TERMINAL_STATES.has(record.state)) {
        this.setState(taskId, "interrupted", reason);
        this.resolveAllWaiters(taskId);
        swept++;
      }
    }
    return swept;
  }

  /**
   * T24/C-FR-09: the 60-minute pause cap. A paused task past the cap is
   * marked interrupted (partial results; no automatic resume).
   */
  public enforcePauseCap(taskId: string, capMs = 60 * 60_000): boolean {
    const record = this.tasks.get(taskId);
    if (
      !record ||
      // The cap covers both user-wait layers (C-FR-09): a user pause AND
      // an agent-requested handoff/waiting state share the same ceiling.
      (record.state !== "paused" && record.state !== "waiting_for_user") ||
      record.openIntervention === null
    ) {
      return false;
    }
    // Uses the service's (injectable) clock so tests and real timers agree.
    const pausedFor = this.now() - record.openIntervention.startedAtEpochMs;
    if (pausedFor >= capMs) {
      this.setState(taskId, "interrupted", "pause_cap_expired");
      this.endIntervention(taskId);
      this.resolveAllWaiters(taskId);
      return true;
    }
    return false;
  }

  /** C-FR-11: return results now — cancel all tasks of a batch. */
  public cancelBatch(batchId: string, reason = "batch_return_now"): number {
    let cancelled = 0;
    for (const taskId of [...this.tasks.keys()]) {
      if (taskId.startsWith(`${batchId}:`)) {
        this.cancel(taskId, reason);
        cancelled++;
      }
    }
    return cancelled;
  }

  /** Active elapsed ms excluding user waits (D-21). */
  public activeTimeMs(taskId: string): number {
    const record = this.tasks.get(taskId);
    if (!record) {
      return 0;
    }
    return (
      record.activeTimeMs +
      (record.runningSinceEpochMs !== null
        ? this.now() - record.runningSinceEpochMs
        : 0)
    );
  }

  private resolveAllWaiters(taskId: string): void {
    const set = this.waiters.get(taskId);
    if (!set) {
      return;
    }
    const record = this.tasks.get(taskId);
    for (const waiter of set) {
      if (record && TERMINAL_STATES.has(record.state)) {
        waiter.reject(new Error(`task_${record.state}`));
      } else {
        waiter.resolve();
      }
    }
    set.clear();
    this.waiters.delete(taskId);
  }
}

function isWaitingState(state: AgentTaskControlState): boolean {
  return state === "waiting_for_user" || state === "paused" || state === "cancelling";
}

let defaultService: AgentTaskControlService | null = null;

export function getDefaultAgentTaskControlService(): AgentTaskControlService {
  if (!defaultService) {
    defaultService = new AgentTaskControlService();
  }
  return defaultService;
}

/** Test seam. */
export function setDefaultAgentTaskControlServiceForTest(
  service: AgentTaskControlService | null
): void {
  defaultService = service;
}
