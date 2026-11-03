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
  private readonly now: () => number;

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
    if (record.state !== state) {
      // Active-time accounting (C-FR-09/D-21): the clock accumulates only
      // while running; waits freeze it and never count against budgets.
      const wasWaiting = isWaitingState(record.state);
      const willWait = isWaitingState(state);
      if (!wasWaiting && willWait) {
        if (record.runningSinceEpochMs !== null) {
          record.activeTimeMs += this.now() - record.runningSinceEpochMs;
          record.runningSinceEpochMs = null;
        }
      } else if (wasWaiting && !willWait) {
        record.runningSinceEpochMs = this.now();
      }
      record.state = state;
    }
    record.reason = reason ?? record.reason;
    if (TERMINAL_STATES.has(state)) {
      this.resolveAllWaiters(taskId);
    }
  }

  /** Begin a user intervention (waiting_for_user reason, C-FR-12). */
  public beginIntervention(taskId: string, reason: string): void {
    const record = this.tasks.get(taskId);
    if (!record) {
      return;
    }
    record.openIntervention = { reason, startedAtEpochMs: this.now() };
    this.setState(taskId, "waiting_for_user", reason);
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
    const service = this;
    return {
      get state(): AgentTaskControlState {
        return service.tasks.get(taskId)?.state ?? "cancelled";
      },
      async waitUntilOpen(signal: AbortSignal): Promise<void> {
        const record = service.tasks.get(taskId);
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
          let set = service.waiters.get(taskId);
          if (!set) {
            set = new Set();
            service.waiters.set(taskId, set);
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
    this.resolveAllWaiters(taskId);
    return true;
  }

  /** Stop: cancels every waiter (the loop fails fast, C-FR-04). */
  public cancel(taskId: string, reason = "user_stop"): void {
    this.setState(taskId, "cancelled", reason);
    this.resolveAllWaiters(taskId);
  }

  /**
   * T24/C-FR-09: the 60-minute pause cap. A paused task past the cap is
   * marked interrupted (partial results; no automatic resume).
   */
  public enforcePauseCap(taskId: string, capMs = 60 * 60_000): boolean {
    const record = this.tasks.get(taskId);
    if (!record || record.state !== "paused" || record.openIntervention === null) {
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
