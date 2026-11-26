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
    const now = 0;
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

describe("AgentTaskControlService F07 terminal correctness", () => {
  it("a terminal record never transitions again", () => {
    const service = new AgentTaskControlService();
    service.register("f07-term", "conv-1");
    service.setState("f07-term", "failed", "boom");
    // A later completed overwrite (e.g. a stray finally) is refused.
    service.setState("f07-term", "completed");
    expect(service.getState("f07-term")).toBe("failed");
    service.setState("f07-term", "running");
    expect(service.getState("f07-term")).toBe("failed");
  });

  it("activeTimeMs freezes once the task reaches a terminal state", () => {
    let now = 0;
    const service = new AgentTaskControlService(() => now);
    service.register("f07-clock", "conv-1");
    now = 5_000;
    service.setState("f07-clock", "failed", "boom");
    const frozen = service.activeTimeMs("f07-clock");
    expect(frozen).toBe(5_000);
    now = 900_000;
    // The clock no longer grows after completion (reproduced leak).
    expect(service.activeTimeMs("f07-clock")).toBe(frozen);
  });
});

describe("AgentTaskControlService F07 return-now refinement", () => {
  it("a cancelled record may be refined by the collector; failed is final", () => {
    const service = new AgentTaskControlService();
    service.register("f07-refine", "conv-1");
    // Return-now pre-cancels the batch...
    service.setState("f07-refine", "cancelled", "batch_return_now");
    // ...and the collector refines the real outcome.
    service.setState("f07-refine", "failed", "aborted mid-flight");
    expect(service.getState("f07-refine")).toBe("failed");
    // But a failed record is final — no completed overwrite afterwards.
    service.setState("f07-refine", "completed");
    expect(service.getState("f07-refine")).toBe("failed");
  });
});

// W02/D-FR-09: partial and interrupted are THEIR OWN terminal states —
// never rewritten failed by a stray overwrite or the terminal writer.
describe("AgentTaskControlService W02 partial terminal state", () => {
  it("a partial record persists as partial and is final", () => {
    const service = new AgentTaskControlService();
    service.register("w02-partial", "conv-1");
    service.setState("w02-partial", "partial", "verification_failed_budget_exhausted");
    expect(service.getState("w02-partial")).toBe("partial");
    // A later failed overwrite (e.g. a stray catch) is refused.
    service.setState("w02-partial", "failed");
    expect(service.getState("w02-partial")).toBe("partial");
    service.setState("w02-partial", "running");
    expect(service.getState("w02-partial")).toBe("partial");
  });

  it("an interrupted record persists as interrupted and is final", () => {
    const service = new AgentTaskControlService();
    service.register("w02-interrupted", "conv-1");
    service.setState("w02-interrupted", "interrupted", "pause_expired");
    expect(service.getState("w02-interrupted")).toBe("interrupted");
    service.setState("w02-interrupted", "failed");
    expect(service.getState("w02-interrupted")).toBe("interrupted");
  });

  it("a cancelled record may be refined to the real partial outcome", () => {
    const service = new AgentTaskControlService();
    service.register("w02-refine-partial", "conv-1");
    service.setState("w02-refine-partial", "cancelled", "batch_return_now");
    service.setState("w02-refine-partial", "partial", "return_now_partial");
    expect(service.getState("w02-refine-partial")).toBe("partial");
  });

  it("activeTimeMs freezes when a task ends partial", () => {
    let now = 0;
    const service = new AgentTaskControlService(() => now);
    service.register("w02-clock", "conv-1");
    now = 4_000;
    service.setState("w02-clock", "partial", "no_progress");
    expect(service.activeTimeMs("w02-clock")).toBe(4_000);
    now = 900_000;
    expect(service.activeTimeMs("w02-clock")).toBe(4_000);
  });
});

// B02/D-FR-10a/C-FR-06: a NORMAL wait release (approval/credential/picker
// reply) reopens the gate WITHOUT the resume-generation bump — only an
// actual user takeover (resume) invalidates pre-wait proposals.
describe("AgentTaskControlService explicit wait release (B02)", () => {
  it("releaseWaitForUser returns a waiting record to running without a generation bump", () => {
    const service = new AgentTaskControlService();
    service.register("b02-release", "conv-1");
    service.beginIntervention("b02-release", "approval_required");
    expect(service.getState("b02-release")).toBe("waiting_for_user");
    const before = service.getResumeGeneration("b02-release");
    expect(service.releaseWaitForUser("b02-release")).toBe(true);
    expect(service.getState("b02-release")).toBe("running");
    expect(service.getResumeGeneration("b02-release")).toBe(before);
    // Idempotent: a running record does not release again.
    expect(service.releaseWaitForUser("b02-release")).toBe(false);
  });

  it("a credential/picker reply ends the span AND releases the wait (endCardUserWait flow, no bump)", () => {
    const service = new AgentTaskControlService();
    service.register("b02-cred", "conv-1");
    service.beginIntervention("b02-cred", "credential_card");
    expect(service.getState("b02-cred")).toBe("waiting_for_user");
    // endCardUserWait: endIntervention (span) + releaseWaitForUser (gate).
    service.endIntervention("b02-cred");
    expect(service.get("b02-cred")?.openIntervention).toBeNull();
    expect(service.get("b02-cred")?.interventions).toHaveLength(1);
    // The span alone does NOT reopen the gate — the caller releases.
    expect(service.getState("b02-cred")).toBe("waiting_for_user");
    expect(service.releaseWaitForUser("b02-cred")).toBe(true);
    expect(service.getState("b02-cred")).toBe("running");
    expect(service.getResumeGeneration("b02-cred")).toBe(0);
  });

  it("an explicit user pause survives endIntervention and needs resume", () => {
    const service = new AgentTaskControlService();
    service.register("b02-paused", "conv-1");
    service.setState("b02-paused", "paused", "user_paused");
    service.beginIntervention("b02-paused", "credential_card");
    // X4: the intervention must not downgrade the explicit pause.
    expect(service.getState("b02-paused")).toBe("paused");
    service.endIntervention("b02-paused");
    // The card resolved, but the USER pause stands until resume().
    expect(service.getState("b02-paused")).toBe("paused");
    expect(service.resume("b02-paused")).toBe(true);
    expect(service.getState("b02-paused")).toBe("running");
    expect(service.getResumeGeneration("b02-paused")).toBe(1);
  });

  it("a terminal record never releases and never reopens its gate", () => {
    const service = new AgentTaskControlService();
    service.register("b02-terminal", "conv-1");
    service.beginIntervention("b02-terminal", "approval_required");
    service.cancel("b02-terminal", "user_stop");
    expect(service.releaseWaitForUser("b02-terminal")).toBe(false);
    expect(service.getState("b02-terminal")).toBe("cancelled");
  });

  it("releaseWaitForUser resolves blocked gate waiters", async () => {
    const service = new AgentTaskControlService();
    service.register("b02-gate", "conv-1");
    service.beginIntervention("b02-gate", "credential_card");
    const gate = service.getGate("b02-gate");
    const waited = gate.waitUntilOpen(new AbortController().signal);
    // endCardUserWait flow: span + explicit release.
    service.endIntervention("b02-gate");
    service.releaseWaitForUser("b02-gate");
    await expect(waited).resolves.toBeUndefined();
  });
});
