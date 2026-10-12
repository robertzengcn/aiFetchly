// test/vitest/main/service/computerUse/ComputerUseSupervisorAuditRegressions.test.ts
//
// Regression tests for the audit's documented repro cases
// (docs/prd/computer-use-aifetchly-audit-todo-2026-10-12.md §"Verification
// performed"). Each test mirrors the audit's isolated reproduction, which
// previously reported:
//   session ID accepted by IPC: false
//   consequential without approval/observation/verification: outcome=succeeded
//   adapter input calls after stop during safety: 1
//   pause during verification: session_state_invalid
//   state after stop then late verification: READY
//   TSV with embedded newline: "Alice\n=1+1"   (ExcelLeadListPlanner suite)
//   extra readback row accepted: true           (ExcelLeadListPlanner suite)
import { describe, it, expect } from "vitest";
import { ComputerUseSupervisor } from "@/service/computerUse/ComputerUseSupervisor";
import {
  ComputerUseError,
  COMPUTER_USE_SESSION_ID_PATTERN,
  isComputerUseSessionId,
  type ComputerUseDesktopAdapter,
  type ComputerUseObservation,
  type ComputerUseSafetyController,
  type ComputerUseStopController,
  type ComputerUseWindowInfo,
} from "@/entityTypes/computerUseTypes";
import { computerUseSessionControlInputSchema } from "@/schemas/ipc/computerUse";

const WINDOW: ComputerUseWindowInfo = {
  windowId: "win-1",
  title: "Book1 - Excel",
  processName: "EXCEL.EXE",
  processId: 4321,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
};

function observation(generation: number): ComputerUseObservation {
  return {
    metadata: {
      observationId: `obs-${generation}`,
      generation,
      capturedAt: Date.now(),
      targetWindowId: "win-1",
      foregroundWindowId: "win-1",
      targetBounds: WINDOW.bounds,
      displayConfigurationKey: "display-1",
      expiresAt: Date.now() + 10_000,
    },
    structuredText: "",
    elements: [],
  };
}

function adapter(): ComputerUseDesktopAdapter & {
  readonly counters: { dispatchCalls: number; verifyCalls: number };
} {
  const counters = { dispatchCalls: 0, verifyCalls: 0 };
  const base: ComputerUseDesktopAdapter = {
    listWindows: async () => [WINDOW],
    observe: async () => observation(1),
    dispatchInput: async () => {
      counters.dispatchCalls += 1;
      return { dispatchedAt: Date.now() };
    },
    verify: async () => {
      counters.verifyCalls += 1;
      return true;
    },
    dispose: async () => undefined,
  };
  return Object.assign(base, { counters });
}

const stop: ComputerUseStopController = {
  register: async () => "Ctrl+Alt+Shift+S",
  unregister: async () => undefined,
  triggerStop: () => undefined,
};

const allowSafety: ComputerUseSafetyController = {
  preStartCheck: async () => ({ allowed: true }),
  preDispatchCheck: async () => ({ allowed: true }),
};

/** Deferred safety controller: the audit's A01 repro primitive. */
function deferredSafety() {
  let resolveVerdict: (v: { allowed: boolean }) => void = () => undefined;
  const pending = new Promise<{ allowed: boolean }>((resolve) => {
    resolveVerdict = resolve;
  });
  const controller: ComputerUseSafetyController = {
    preStartCheck: async () => ({ allowed: true }),
    preDispatchCheck: async () => pending,
  };
  return { controller, resolveVerdict };
}

async function startWith(
  adapterInstance: ComputerUseDesktopAdapter,
  safety: ComputerUseSafetyController = allowSafety
) {
  const supervisor = new ComputerUseSupervisor({
    adapter: adapterInstance,
    stopController: stop,
    safety,
  });
  const session = await supervisor.startSession({
    targetWindowId: "win-1",
    plannerMode: "local_only",
    groundingModelRuntimeId: null,
  });
  const obs = await supervisor.observe(session.sessionId);
  return { supervisor, session, obs };
}

function clickRequest(observationId: string, handle: string) {
  return {
    actionKind: "click" as const,
    targetHandle: handle,
    observationId,
    point: { x: 100, y: 200 },
  };
}

describe("audit regressions: supervisor authority and lifecycle", () => {
  it("A07: the supervisor's session ID round-trips the IPC control schemas", async () => {
    const { supervisor, session } = await startWith(adapter());
    expect(isComputerUseSessionId(session.sessionId)).toBe(true);
    expect(() =>
      computerUseSessionControlInputSchema().parse({
        sessionId: session.sessionId,
      })
    ).not.toThrow();
    expect(
      computerUseSessionControlInputSchema().safeParse({
        sessionId: "not-a-session-id",
      }).success
    ).toBe(false);
    expect(COMPUTER_USE_SESSION_ID_PATTERN.test(session.sessionId)).toBe(true);
    await supervisor.stopSession(session.sessionId);
  });

  it("A01: stop during the awaited safety check sends ZERO adapter input", async () => {
    const a = adapter();
    const { controller, resolveVerdict } = deferredSafety();
    const { supervisor, session, obs } = await startWith(a, controller);
    const target = supervisor.registerAccessibilityTarget(
      session.sessionId,
      obs.metadata.observationId,
      { x: 100, y: 200 },
      { x: 90, y: 190, width: 20, height: 20 }
    );
    const outcomePromise = supervisor.dispatch(
      session.sessionId,
      clickRequest(obs.metadata.observationId, target.handle),
      "within_task"
    );
    // Stop COMPLETES while the safety check is still pending…
    await supervisor.stopSession(session.sessionId);
    // …then the check resolves allowed. The adapter must NOT receive input.
    resolveVerdict({ allowed: true });
    const outcome = await outcomePromise;
    // Whether the dispatch was cancelled mid-flight or rejected at the
    // generation guard, ZERO input may cross the stop boundary.
    expect(["cancelled", "rejected"]).toContain(outcome.outcome);
    expect(a.counters.dispatchCalls).toBe(0);
  });

  it("A02: late verification completion after stop cannot revive the session", async () => {
    const gate: { release: (() => void) | null } = { release: null };
    const a = adapter();
    const hangingAdapter: ComputerUseDesktopAdapter = {
      ...a,
      verify: () =>
        new Promise<boolean>((resolve) => {
          gate.release = () => resolve(true);
        }),
    };
    const { supervisor, session, obs } = await startWith(hangingAdapter);
    const target = supervisor.registerAccessibilityTarget(
      session.sessionId,
      obs.metadata.observationId,
      { x: 100, y: 200 },
      { x: 90, y: 190, width: 20, height: 20 }
    );
    const outcomePromise = supervisor.dispatch(
      session.sessionId,
      clickRequest(obs.metadata.observationId, target.handle),
      "within_task"
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await supervisor.stopSession(session.sessionId);
    gate.release?.();
    const outcome = await outcomePromise;
    // The dispatch was cancelled; the session stays STOPPED, never READY.
    expect(outcome.outcome).toBe("cancelled");
    expect(supervisor.getSummary(session.sessionId).state).toBe("STOPPED");
  });

  it("A02: pause during active verification is accepted", async () => {
    const gate: { release: (() => void) | null } = { release: null };
    const a = adapter();
    const hangingAdapter: ComputerUseDesktopAdapter = {
      ...a,
      verify: () =>
        new Promise<boolean>((resolve) => {
          gate.release = () => resolve(true);
        }),
    };
    const { supervisor, session, obs } = await startWith(hangingAdapter);
    const target = supervisor.registerAccessibilityTarget(
      session.sessionId,
      obs.metadata.observationId,
      { x: 100, y: 200 },
      { x: 90, y: 190, width: 20, height: 20 }
    );
    const outcomePromise = supervisor.dispatch(
      session.sessionId,
      clickRequest(obs.metadata.observationId, target.handle),
      "within_task"
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const paused = await supervisor.pauseSession(session.sessionId, "user_request");
    expect(paused.state).toBe("PAUSED");
    gate.release?.();
    const outcome = await outcomePromise;
    // Dispatch finished but must not resurrect READY over the pause.
    expect(outcome.outcome).toBe("cancelled");
    expect(supervisor.getSummary(session.sessionId).state).toBe("PAUSED");
    await supervisor.stopSession(session.sessionId);
  });

  it("A03: a consequential action without current-task approval is denied", async () => {
    const a = adapter();
    const { supervisor, session, obs } = await startWith(a);
    const target = supervisor.registerAccessibilityTarget(
      session.sessionId,
      obs.metadata.observationId,
      { x: 100, y: 200 },
      { x: 90, y: 190, width: 20, height: 20 }
    );
    const outcome = await supervisor.dispatch(
      session.sessionId,
      clickRequest(obs.metadata.observationId, target.handle),
      "consequential"
    );
    expect(outcome.outcome).toBe("failed");
    expect(outcome.errorCode).toBe("permission_denied");
    expect(a.counters.dispatchCalls).toBe(0);

    // After an explicit current-task approval, the same class dispatches.
    supervisor.approveTask({
      sessionId: session.sessionId,
      actionClasses: ["consequential"],
      generation: session.generation,
    });
    const obs2 = await supervisor.observe(session.sessionId);
    const target2 = supervisor.registerAccessibilityTarget(
      session.sessionId,
      obs2.metadata.observationId,
      { x: 100, y: 200 },
      { x: 90, y: 190, width: 20, height: 20 }
    );
    const approved = await supervisor.dispatch(
      session.sessionId,
      clickRequest(obs2.metadata.observationId, target2.handle),
      "consequential"
    );
    expect(approved.outcome).toBe("succeeded");
    await supervisor.stopSession(session.sessionId);
  });

  it("A04: fabricated observations, foreign points, and handle reuse never dispatch", async () => {
    const a = adapter();
    const { supervisor, session, obs } = await startWith(a);
    // Fabricated observation id: not the session's current observation.
    expect(() =>
      supervisor.registerAccessibilityTarget(
        session.sessionId,
        "obs-fabricated",
        { x: 100, y: 200 },
        { x: 90, y: 190, width: 20, height: 20 }
      )
    ).toThrowError(ComputerUseError);

    const target = supervisor.registerAccessibilityTarget(
      session.sessionId,
      obs.metadata.observationId,
      { x: 100, y: 200 },
      { x: 90, y: 190, width: 20, height: 20 }
    );
    // Point override: a request point far from the host target is rejected.
    const override = await supervisor.dispatch(
      session.sessionId,
      {
        actionKind: "click",
        targetHandle: target.handle,
        observationId: obs.metadata.observationId,
        point: { x: 1500, y: 900 },
      },
      "within_task"
    );
    expect(override.outcome).toBe("failed");
    expect(override.errorCode).toBe("coordinates_invalid");
    expect(a.counters.dispatchCalls).toBe(0);

    // A dispatch that reaches the adapter consumes the observation: the
    // same handle can never serve a second action.
    const obs2 = await supervisor.observe(session.sessionId);
    const target2 = supervisor.registerAccessibilityTarget(
      session.sessionId,
      obs2.metadata.observationId,
      { x: 100, y: 200 },
      { x: 90, y: 190, width: 20, height: 20 }
    );
    const first = await supervisor.dispatch(
      session.sessionId,
      clickRequest(obs2.metadata.observationId, target2.handle),
      "within_task"
    );
    expect(first.outcome).toBe("succeeded");
    expect(a.counters.dispatchCalls).toBe(1);
    const second = await supervisor.dispatch(
      session.sessionId,
      clickRequest(obs2.metadata.observationId, target2.handle),
      "within_task"
    );
    expect(["failed", "rejected"]).toContain(second.outcome);
    expect(second.errorCode).toBe("target_stale");
    expect(a.counters.dispatchCalls).toBe(1); // unchanged: the handle was dead
  });

  it("A05: production construction without safety controls refuses to build", () => {
    expect(
      () =>
        new ComputerUseSupervisor({
          adapter: adapter(),
          // @ts-expect-error deliberately omitting mandatory controls
          stopController: undefined,
        })
    ).toThrowError(ComputerUseError);
  });

  it("A08: input without a verifier is uncertain, never succeeded", async () => {
    const a = adapter();
    const noVerify: ComputerUseDesktopAdapter = { ...a, verify: undefined };
    const { supervisor, session, obs } = await startWith(noVerify);
    const target = supervisor.registerAccessibilityTarget(
      session.sessionId,
      obs.metadata.observationId,
      { x: 100, y: 200 },
      { x: 90, y: 190, width: 20, height: 20 }
    );
    const outcome = await supervisor.dispatch(
      session.sessionId,
      clickRequest(obs.metadata.observationId, target.handle),
      "within_task"
    );
    expect(outcome.outcome).toBe("uncertain");
    expect(outcome.verification).toMatchObject({
      verified: false,
      reason: expect.stringContaining("verifier"),
    });
    // Every attempt lands in the action log, including this uncertain one.
    expect(supervisor.listActions(session.sessionId).length).toBeGreaterThanOrEqual(1);
    await supervisor.stopSession(session.sessionId);
  });

  it("A06: a hung adapter dispose cannot stall stop past its budget", async () => {
    const a = adapter();
    const hung: ComputerUseDesktopAdapter = {
      ...a,
      dispose: () => new Promise<void>(() => undefined),
    };
    const { supervisor, session } = await startWith(hung);
    const startedAt = Date.now();
    const summary = await supervisor.stopSession(session.sessionId);
    expect(summary.state).toBe("STOPPED");
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });
});
