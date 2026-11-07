import { describe, expect, it, vi, beforeEach } from "vitest";
import { awaitUserResolution } from "@/service/browserAgents/HandoffCoordinator";
import { AgentTaskControlService } from "@/service/browserAgents/AgentTaskControlService";
import { handoffReasonSchema } from "@/schemas/worker/managedBrowser";
import { getDefaultToolJobRegistry } from "@/service/ToolJobRegistry";

/**
 * F06: one handoff/wait lifecycle — schema-valid reasons, honest request
 * failure, truthful resolution, gate reopen, ToolJobRegistry user-wait.
 */

const requestHandoff = vi.fn();
const statuses = new Map<
  string,
  { state: string; handoffReason: string | null }
>();

vi.mock("@/modules/ManagedBrowserModule", () => ({
  getDefaultManagedBrowserModule: () => ({
    requestHandoff,
    getStatus: (sessionId: string) => statuses.get(sessionId) ?? null,
  }),
}));

// The coordinator resolves the DEFAULT control service singleton; isolate
// each test with a fresh module registry would require DI — instead the
// tests use unique task ids per case.
import { getDefaultAgentTaskControlService } from "@/service/browserAgents/AgentTaskControlService";

describe("awaitUserResolution (F06)", () => {
  beforeEach(() => {
    requestHandoff.mockReset();
    statuses.clear();
  });

  it("returns expired — never a hanging wait — when the handoff request fails", async () => {
    requestHandoff.mockRejectedValue(new Error("user_has_control"));
    const control = getDefaultAgentTaskControlService();
    control.register("f06-fail", "conv-1");
    const resolution = await awaitUserResolution({
      sessionId: "mb_x1",
      reason: "challenge_unresolved",
      taskId: "f06-fail",
      pollIntervalMs: 1,
    });
    expect(resolution).toBe("expired");
    expect(requestHandoff).toHaveBeenCalledWith(
      "mb_x1",
      "challenge_unresolved"
    );
    // The intervention was never left open.
    expect(control.get("f06-fail")?.openIntervention).toBeNull();
  });

  it("resolves when the session leaves the handoff window and reopens the gate", async () => {
    requestHandoff.mockResolvedValue({});
    statuses.set("mb_x2", { state: "handoff", handoffReason: "mfa_prompt" });
    const control = getDefaultAgentTaskControlService();
    control.register("f06-res", "conv-1");
    const promise = awaitUserResolution({
      sessionId: "mb_x2",
      reason: "mfa_prompt",
      taskId: "f06-res",
      pollIntervalMs: 1,
    });
    // The task is waiting while the window is open — poll (bounded) so
    // CI load cannot flake the state transition.
    for (
      let waited = 0;
      control.getState("f06-res") !== "waiting_for_user" && waited < 5_000;
      waited += 25
    ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(control.getState("f06-res")).toBe("waiting_for_user");
    // The user resolves through the dialog: the session becomes operable.
    statuses.set("mb_x2", { state: "running", handoffReason: null });
    const resolution = await promise;
    expect(resolution).toBe("resolved");
    // The gate was reopened even without an explicit BROWSER_TASK_RESUME.
    expect(control.getState("f06-res")).toBe("running");
  });

  it("reports expired when the session stops inside the window", async () => {
    requestHandoff.mockResolvedValue({});
    statuses.set("mb_x3", { state: "handoff", handoffReason: "mfa_prompt" });
    const control = getDefaultAgentTaskControlService();
    control.register("f06-dead", "conv-1");
    const promise = awaitUserResolution({
      sessionId: "mb_x3",
      reason: "mfa_prompt",
      taskId: "f06-dead",
      pollIntervalMs: 1,
    });
    statuses.set("mb_x3", { state: "stopped", handoffReason: null });
    const resolution = await promise;
    expect(resolution).toBe("expired");
    // No hung gate: the waiting record was reopened on the way out.
    expect(control.getState("f06-dead")).toBe("running");
  });

  it("resolves immediately when the session is already operable", async () => {
    requestHandoff.mockResolvedValue({});
    statuses.set("mb_x4", { state: "ready", handoffReason: null });
    const resolution = await awaitUserResolution({
      sessionId: "mb_x4",
      reason: "user_requested",
      taskId: "f06-ready",
      pollIntervalMs: 1,
    });
    expect(resolution).toBe("resolved");
  });
});

describe("F06 reason schema validity", () => {
  it("accepts the reasons the runner/coordinator actually use", () => {
    expect(handoffReasonSchema.safeParse("challenge_unresolved").success).toBe(
      true
    );
    expect(handoffReasonSchema.safeParse("login_required").success).toBe(true);
    expect(handoffReasonSchema.safeParse("user_paused").success).toBe(true);
    // The old fabricated reason is NOT in the schema.
    expect(handoffReasonSchema.safeParse("challenge_handoff").success).toBe(
      false
    );
  });
});

describe("ToolJobRegistry user-wait probe (F06)", () => {
  it("reports whether ANY live job is waiting for the user", async () => {
    const registry = getDefaultToolJobRegistry();
    const before = registry.isAnyWaitingForUser();
    const { jobId } = registry.start(
      "f06_probe_tool",
      {},
      { conversationId: "conv-f06", toolCallId: "tc-f06" },
      async () => ({})
    );
    registry.setUserWait(jobId, true, "credential_card");
    expect(registry.isAnyWaitingForUser()).toBe(true);
    registry.setUserWait(jobId, false);
    expect(registry.isAnyWaitingForUser()).toBe(before);
  });
});

describe("F06 pause cap covers explicit pauses (intervention record)", () => {
  it("an explicit pause with an open intervention is capped", () => {
    let now = 0;
    const service = new AgentTaskControlService(() => now);
    service.register("f06-pause", "conv-1");
    // The IPC pause handler now mirrors this pair.
    service.setState("f06-pause", "paused", "user_paused");
    service.beginIntervention("f06-pause", "user_paused");
    expect(service.get("f06-pause")?.openIntervention).not.toBeNull();
    now = 61 * 60_000;
    expect(service.enforcePauseCap("f06-pause")).toBe(true);
    expect(service.getState("f06-pause")).toBe("interrupted");
  });
});
