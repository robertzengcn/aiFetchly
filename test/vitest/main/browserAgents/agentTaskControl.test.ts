import { describe, expect, it, vi } from "vitest";
import { AgentTaskControlService } from "@/service/browserAgents/AgentTaskControlService";

/** PRD §6.12 / C-FR-01..09: two-layer control, gate, and time accounting. */

describe("AgentTaskControlService pause cap (T24/C-FR-09)", () => {
  it("marks a task interrupted after the 60-minute pause cap", () => {
    let now = 0;
    const service = new AgentTaskControlService(() => now);
    service.register("task-cap", "conv-1");
    // The real pause flow opens an intervention (C-FR-05), which the cap
    // measures.
    service.beginIntervention("task-cap", "user_paused");
    now = 59 * 60_000;
    expect(service.enforcePauseCap("task-cap")).toBe(false);
    // beginIntervention sets waiting_for_user (the user-wait layer); the
    // cap measures from the intervention start either way.
    expect(["paused", "waiting_for_user"]).toContain(
      service.getState("task-cap")
    );
    now = 61 * 60_000;
    expect(service.enforcePauseCap("task-cap")).toBe(true);
    expect(service.getState("task-cap")).toBe("interrupted");
    // Idempotent afterwards.
    expect(service.enforcePauseCap("task-cap")).toBe(false);
  });
});

describe("AgentTaskControlService", () => {
  it("runs the control gate: closed while paused, reopened only on resume", async () => {
    let now = 0;
    const service = new AgentTaskControlService(() => now);
    service.register("task-1", "conv-1");
    const gate = service.getGate("task-1");
    await expect(gate.waitUntilOpen(new AbortController().signal)).resolves.toBeUndefined();

    service.setState("task-1", "paused", "user_paused");
    const signal = new AbortController().signal;
    const blocked = gate.waitUntilOpen(signal);
    let settled = false;
    blocked.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(settled).toBe(false);

    expect(service.resume("task-1")).toBe(true);
    await expect(blocked).resolves.toBeUndefined();
  });

  it("rejects the gate when the task is cancelled while paused (C-FR-04)", async () => {
    const service = new AgentTaskControlService();
    service.register("task-2", "conv-1");
    const gate = service.getGate("task-2");
    service.setState("task-2", "paused");
    const blocked = gate.waitUntilOpen(new AbortController().signal);
    service.cancel("task-2");
    await expect(blocked).rejects.toThrow("task_cancelled");
  });

  it("excludes waiting time from active time (C-FR-09/D-21)", () => {
    let now = 0;
    const service = new AgentTaskControlService(() => now);
    service.register("task-3", "conv-1");

    now = 1_000;
    service.beginIntervention("task-3", "handoff");
    now = 61_000; // 60 s of user wait.
    expect(service.activeTimeMs("task-3")).toBe(1_000); // frozen while waiting.
    service.endIntervention("task-3");
    service.setState("task-3", "running");
    now = 62_000; // 1 s of active work after resume.
    expect(service.activeTimeMs("task-3")).toBe(2_000);
  });

  it("records user interventions with durations (C-FR-12)", () => {
    let now = 0;
    const service = new AgentTaskControlService(() => now);
    service.register("task-4", "conv-1");
    service.beginIntervention("task-4", "challenge_captcha");
    now = 5_000;
    service.endIntervention("task-4");
    const record = service.get("task-4")!;
    expect(record.interventions).toEqual([
      { reason: "challenge_captcha", startedAtEpochMs: 0, durationMs: 5_000 },
    ]);
    expect(record.openIntervention).toBeNull();
  });

  it("keeps waiting_for_user distinct from paused (C-FR-01)", () => {
    const service = new AgentTaskControlService();
    service.register("task-5", "conv-1");
    service.setState("task-5", "waiting_for_user", "challenge_captcha");
    expect(service.getState("task-5")).toBe("waiting_for_user");
    service.setState("task-5", "paused", "user_paused");
    expect(service.getState("task-5")).toBe("paused");
  });
});
