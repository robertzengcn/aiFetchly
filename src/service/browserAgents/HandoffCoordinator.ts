/**
 * Blocking handoff coordinator for sub-agents and the runner (PRD C-FR-02;
 * technical design §18.2).
 *
 * Inside a sub-agent or runner, `browser_request_handoff` and detected
 * challenges BLOCK in the tool call instead of returning an error: the task
 * enters `waiting_for_user`, the existing handoff dialog appears in the
 * parent conversation, and the promise resolves when the user acts (or the
 * window lapses / the caller aborts). Waiting time never counts against
 * active budgets (C-FR-09) — the caller's active-time clock is excluded via
 * the task control service.
 */
import { getDefaultManagedBrowserModule } from "@/modules/ManagedBrowserModule";
import { getDefaultAgentTaskControlService } from "@/service/browserAgents/AgentTaskControlService";
import type { ManagedBrowserHandoffReason } from "@/entityTypes/managedBrowserTypes";
import type { ManagedBrowserSessionState } from "@/entityTypes/managedBrowserTypes";

export type HandoffResolution = "resolved" | "expired" | "cancelled";

export interface AwaitUserResolutionInput {
  readonly sessionId: string;
  /** F06: a schema-valid ManagedBrowserHandoffReason — no casts. */
  readonly reason: ManagedBrowserHandoffReason;
  readonly taskId: string;
  readonly signal?: AbortSignal;
  /**
   * F06: the enclosing tool job id — the parent poll's user-wait
   * exclusion only works when the blocking producer publishes waiting.
   */
  readonly jobId?: string | null;
  /** Poll cadence for the (existing) handoff window state. */
  readonly pollIntervalMs?: number;
}

/** F06: session states that mean the user is STILL in the window. */
const HANDOFF_WAITING_STATES: ReadonlySet<ManagedBrowserSessionState> = new Set(
  [
    // X4: login_required is NOT a resolution — the user dialog opened
    // but the session still needs the credential flow to complete.
    "handoff",
    "user_login_in_progress",
    "verifying_manual_login",
    "login_required",
  ]
);
/** F06: session states that mean the window can never resolve. */
const HANDOFF_DEAD_STATES: ReadonlySet<ManagedBrowserSessionState> = new Set(
  ["stopping", "stopped", "failed"]
);

export async function awaitUserResolution(
  input: AwaitUserResolutionInput
): Promise<HandoffResolution> {
  const browserModule = getDefaultManagedBrowserModule();
  const control = getDefaultAgentTaskControlService();
  const pollIntervalMs = input.pollIntervalMs ?? 1_000;

  const setUserWait = (waiting: boolean): void => {
    if (!input.jobId) {
      return;
    }
    void import("@/service/ToolJobRegistry").then(
      ({ getDefaultToolJobRegistry }) => {
        getDefaultToolJobRegistry().setUserWait(
          input.jobId as string,
          waiting,
          waiting ? input.reason : null
        );
      }
    );
  };

  // Begin the handoff window using the EXISTING module policy (10-minute
  // default, extendable to 60) and mark the task waiting_for_user.
  let handoffOpened = false;
  try {
    await browserModule.requestHandoff(input.sessionId, input.reason);
    handoffOpened = true;
  } catch {
    // F06: a FAILED handoff request must not become a hanging wait or a
    // false success — the dialog never opened; report the wait as expired.
    control.endIntervention(input.taskId);
    return "expired";
  }
  control.beginIntervention(input.taskId, input.reason);
  setUserWait(true);
  void handoffOpened;

  const onAbort = (): void => {
    /* handled by the poll loop */
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    for (;;) {
      if (input.signal?.aborted) {
        return "cancelled";
      }
      const status = browserModule.getStatus(input.sessionId);
      if (!status) {
        // Handoff expiry stops the session (existing scheduleHandoffExpiry).
        return "expired";
      }
      if (HANDOFF_DEAD_STATES.has(status.state)) {
        // F06: a stopping/stopped/failed session can never resolve — the
        // caller must not treat it as a user success.
        return "expired";
      }
      if (!HANDOFF_WAITING_STATES.has(status.state)) {
        // The user verified/resumed through the dialog and the session is
        // operable again (ready/running/login_required/challenge states).
        return "resolved";
      }
      control.enforcePauseCap(input.taskId);
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
    control.endIntervention(input.taskId);
    setUserWait(false);
    // F06: if the resolution path did NOT already resume the task (e.g.
    // expiry or a dialog path without BROWSER_TASK_RESUME), reopen its
    // control gate here — a waiting runner must never hang at
    // waitUntilOpen. resume() bumps the generation, so any proposal held
    // across the wait is discarded (C-FR-06).
    const record = control.get(input.taskId);
    if (record?.state === "waiting_for_user") {
      control.resume(input.taskId);
    }
  }
}
