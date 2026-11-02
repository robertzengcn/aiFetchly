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

export type HandoffResolution = "resolved" | "expired" | "cancelled";

export interface AwaitUserResolutionInput {
  readonly sessionId: string;
  readonly reason: string;
  readonly taskId: string;
  readonly signal?: AbortSignal;
  /** Poll cadence for the (existing) handoff window state. */
  readonly pollIntervalMs?: number;
}

export async function awaitUserResolution(
  input: AwaitUserResolutionInput
): Promise<HandoffResolution> {
  const browserModule = getDefaultManagedBrowserModule();
  const control = getDefaultAgentTaskControlService();
  const pollIntervalMs = input.pollIntervalMs ?? 1_000;

  // Begin the handoff window using the EXISTING module policy (10-minute
  // default, extendable to 60) and mark the task waiting_for_user.
  await browserModule.requestHandoff(input.sessionId, input.reason as never).catch(
    () => undefined
  );
  control.beginIntervention(input.taskId, input.reason);

  const onAbort = (): void => {
    /* handled by the poll loop */
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      if (input.signal?.aborted) {
        return "cancelled";
      }
      const status = browserModule.getStatus(input.sessionId);
      if (!status) {
        // Handoff expiry stops the session (existing scheduleHandoffExpiry).
        return "expired";
      }
      if (status.state !== "handoff" && status.state !== "user_login_in_progress") {
        // The user verified/resumed through the dialog.
        return "resolved";
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
    control.endIntervention(input.taskId);
  }
}
