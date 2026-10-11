// test/vitest/main/service/computerUse/ComputerUseSupervisorCore.test.ts
//
// Supervisor core (design §10.1–10.3, §14.2): lease exclusivity, hotkey
// fail-closed session start, generation invalidation on stop/resume, stale
// handle rejection, serialized dispatch, safety rejection, late-revocation
// cancellation, and grant tampering. Also covers the target store, lease
// service, and action authorization units.
import { describe, it, expect, vi } from "vitest";
import { ComputerUseSupervisor } from "@/service/computerUse/ComputerUseSupervisor";
import { ComputerUseTargetStore } from "@/service/computerUse/ComputerUseTargetStore";
import { ComputerUseLeaseService } from "@/service/computerUse/ComputerUseLeaseService";
import {
  ComputerUseActionAuthorization,
  hashActionRequest,
} from "@/service/computerUse/ComputerUseActionAuthorization";
import {
  ComputerUseError,
  type ComputerUseDesktopAdapter,
  type ComputerUseObservation,
  type ComputerUseSafetyController,
  type ComputerUseStopController,
  type ComputerUseWindowInfo,
} from "@/entityTypes/computerUseTypes";

const WINDOW: ComputerUseWindowInfo = {
  windowId: "win-1",
  title: "Book1 - Excel",
  processName: "EXCEL.EXE",
  processId: 4321,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
};

function fakeObservation(generation: number): ComputerUseObservation {
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
    structuredText: "sheet: Sheet1; used range A1:C10",
    elements: [],
  };
}

function fakeAdapter(
  overrides: Partial<ComputerUseDesktopAdapter> = {}
): ComputerUseDesktopAdapter & {
  dispatchCalls: Array<{ action: unknown; generation: number }>;
} {
  const dispatchCalls: Array<{ action: unknown; generation: number }> = [];
  const adapter: ComputerUseDesktopAdapter & {
    dispatchCalls: Array<{ action: unknown; generation: number }>;
  } = {
    dispatchCalls,
    listWindows: async () => [WINDOW],
    observe: async () => fakeObservation(1),
    dispatchInput: async (action, context) => {
      dispatchCalls.push({ action, generation: context.generation });
      return { dispatchedAt: Date.now() };
    },
    verify: async () => true,
    dispose: async () => undefined,
    ...overrides,
  };
  return adapter;
}

function stopController(
  registerResult: string | null = "Ctrl+Alt+Shift+S"
): ComputerUseStopController & { stoppedWith: string[] } {
  const stoppedWith: string[] = [];
  return {
    stoppedWith,
    register: async () => registerResult,
    unregister: async () => undefined,
    triggerStop: () => undefined,
  };
}

const safetyAllow: ComputerUseSafetyController = {
  preDispatchCheck: async () => ({ allowed: true }),
};

describe("ComputerUseLeaseService", () => {
  it("grants exclusivity and reports desktop_busy", () => {
    const lease = new ComputerUseLeaseService();
    lease.acquire("session-a");
    expect(() => lease.acquire("session-b")).toThrowError(ComputerUseError);
    const error = (() => {
      try {
        lease.acquire("session-b");
      } catch (e) {
        return e as ComputerUseError;
      }
      return null;
    })();
    expect(error?.code).toBe("desktop_busy");
    expect(lease.release("session-a")).toBe(true);
    lease.acquire("session-b");
    expect(lease.ownerSessionId).toBe("session-b");
  });
});

describe("ComputerUseTargetStore", () => {
  it("rejects handles from older generations and expired targets", () => {
    const store = new ComputerUseTargetStore();
    const now = Date.now();
    const handle = store.create({
      generation: 1,
      observationId: "obs-1",
      capturePoint: { x: 10, y: 10 },
      region: { x: 0, y: 0, width: 20, height: 20 },
      source: "accessibility",
      expiresAt: now + 1_000,
    });
    expect(store.resolve(handle, 1, now).capturePoint).toEqual({ x: 10, y: 10 });
    expect(() => store.resolve(handle, 2, now)).toThrowError(ComputerUseError);
    expect(() => store.resolve(handle, 1, now + 2_000)).toThrowError(
      ComputerUseError
    );
  });

  it("invalidateGeneration drops only matching targets", () => {
    const store = new ComputerUseTargetStore();
    store.create({
      generation: 1,
      observationId: "obs-1",
      capturePoint: { x: 1, y: 1 },
      region: { x: 0, y: 0, width: 5, height: 5 },
      source: "accessibility",
      expiresAt: Date.now() + 10_000,
    });
    store.create({
      generation: 2,
      observationId: "obs-2",
      capturePoint: { x: 2, y: 2 },
      region: { x: 0, y: 0, width: 5, height: 5 },
      source: "accessibility",
      expiresAt: Date.now() + 10_000,
    });
    expect(store.invalidateGeneration(1)).toBe(1);
    expect(store.size).toBe(1);
  });
});

describe("ComputerUseActionAuthorization", () => {
  const request = {
    actionKind: "click" as const,
    targetHandle: "cut_x",
    observationId: "obs-1",
    point: { x: 5, y: 5 },
  };

  it("validates a matching grant and rejects a mutated action", () => {
    const auth = new ComputerUseActionAuthorization();
    const grant = auth.mint({
      sessionId: "s1",
      generation: 1,
      request,
      actionClass: "within_task",
      observationId: "obs-1",
    });
    expect(
      auth.validate(grant.actionId, { sessionId: "s1", generation: 1, request })
    ).toMatchObject({ actionId: grant.actionId });

    const mutated = { ...request, point: { x: 999, y: 999 } };
    expect(() =>
      auth.validate(grant.actionId, { sessionId: "s1", generation: 1, request: mutated })
    ).toThrowError(ComputerUseError);
  });

  it("rejects grants from revoked generations and expiry", () => {
    const auth = new ComputerUseActionAuthorization();
    const grant = auth.mint({
      sessionId: "s1",
      generation: 1,
      request,
      actionClass: "read_only",
      observationId: "obs-1",
      now: 1_000,
    });
    expect(() =>
      auth.validate(grant.actionId, { sessionId: "s1", generation: 2, request })
    ).toThrowError(ComputerUseError);
    expect(() =>
      auth.validate(
        grant.actionId,
        { sessionId: "s1", generation: 1, request },
        1_000 + 31_000
      )
    ).toThrowError(ComputerUseError);
  });

  it("hashes canonical requests deterministically regardless of modifier order", () => {
    const a = hashActionRequest({
      actionKind: "hotkey",
      targetHandle: "t",
      observationId: "o",
      modifiers: ["Ctrl", "Shift"],
      key: "S",
    });
    const b = hashActionRequest({
      actionKind: "hotkey",
      targetHandle: "t",
      observationId: "o",
      modifiers: ["Shift", "Ctrl"],
      key: "S",
    });
    expect(a).toBe(b);
  });
});

describe("ComputerUseSupervisor", () => {
  it("starts READY, acquires the lease, and registers the hotkey", async () => {
    const adapter = fakeAdapter();
    const stop = stopController();
    const supervisor = new ComputerUseSupervisor({
      adapter,
      stopController: stop,
      safety: safetyAllow,
    });
    const summary = await supervisor.startSession({
      targetWindowId: "win-1",
      plannerMode: "local_only",
      groundingModelRuntimeId: null,
    });
    expect(summary.state).toBe("READY");
    expect(summary.stopHotkey).toBe("Ctrl+Alt+Shift+S");
    expect(summary.targetWindow?.windowId).toBe("win-1");
    await supervisor.stopSession(summary.sessionId);
  });

  it("refuses a second concurrent session with desktop_busy", async () => {
    const supervisor = new ComputerUseSupervisor({
      adapter: fakeAdapter(),
      stopController: stopController(),
      safety: safetyAllow,
    });
    const first = await supervisor.startSession({
      targetWindowId: "win-1",
      plannerMode: "local_only",
      groundingModelRuntimeId: null,
    });
    await expect(
      supervisor.startSession({
        targetWindowId: "win-1",
        plannerMode: "local_only",
        groundingModelRuntimeId: null,
      })
    ).rejects.toThrowError(ComputerUseError);
    await supervisor.stopSession(first.sessionId);
  });

  it("does not start a session when the hotkey cannot be registered", async () => {
    // Register fails only on the first attempt, so the retry below can prove
    // the lease was released by the failed start.
    let registerAttempts = 0;
    const flakyStop: ComputerUseStopController = {
      register: async () => (registerAttempts++ === 0 ? null : "Ctrl+Alt+Shift+S"),
      unregister: async () => undefined,
      triggerStop: () => undefined,
    };
    const supervisor = new ComputerUseSupervisor({
      adapter: fakeAdapter(),
      stopController: flakyStop,
      safety: safetyAllow,
    });
    await expect(
      supervisor.startSession({
        targetWindowId: "win-1",
        plannerMode: "local_only",
        groundingModelRuntimeId: null,
      })
    ).rejects.toThrowError(ComputerUseError);
    // The lease must have been released by the failed start.
    const second = await supervisor.startSession({
      targetWindowId: "win-1",
      plannerMode: "local_only",
      groundingModelRuntimeId: null,
    });
    await supervisor.stopSession(second.sessionId);
  });

  it("stop revokes the generation and invalidates targets and grants", async () => {
    const adapter = fakeAdapter();
    const supervisor = new ComputerUseSupervisor({
      adapter,
      stopController: stopController(),
      safety: safetyAllow,
    });
    const session = await supervisor.startSession({
      targetWindowId: "win-1",
      plannerMode: "local_only",
      groundingModelRuntimeId: null,
    });
    const generationBefore = session.generation;
    await supervisor.stopSession(session.sessionId);
    const after = supervisor.getSummary(session.sessionId);
    expect(after.state).toBe("STOPPED");
    expect(after.generation).toBe(generationBefore + 1);
    expect(after.stopHotkey).toBeNull();
    expect(
      supervisor.isGenerationCurrent(session.sessionId, generationBefore)
    ).toBe(false);
    expect(adapter.dispatchCalls).toHaveLength(0);
  });

  it("dispatch rejects stale target handles after resume", async () => {
    const adapter = fakeAdapter();
    const supervisor = new ComputerUseSupervisor({
      adapter,
      stopController: stopController(),
      safety: safetyAllow,
    });
    const session = await supervisor.startSession({
      targetWindowId: "win-1",
      plannerMode: "local_only",
      groundingModelRuntimeId: null,
    });
    const observation = await supervisor.observe(session.sessionId);
    const target = supervisor.registerAccessibilityTarget(
      session.sessionId,
      observation.metadata.observationId,
      { x: 100, y: 200 },
      { x: 90, y: 190, width: 20, height: 20 }
    );
    await supervisor.pauseSession(session.sessionId, "handoff");
    await supervisor.resumeSession(session.sessionId);
    const outcome = await supervisor.dispatch(
      session.sessionId,
      {
        actionKind: "click",
        targetHandle: target.handle,
        observationId: observation.metadata.observationId,
        point: { x: 100, y: 200 },
      },
      "within_task"
    );
    expect(outcome.outcome).toBe("failed");
    expect(outcome.errorCode).toBe("target_stale");
    expect(adapter.dispatchCalls).toHaveLength(0);
    await supervisor.stopSession(session.sessionId);
  });

  it("dispatch runs the full authorized pipeline and verifies", async () => {
    const adapter = fakeAdapter();
    const supervisor = new ComputerUseSupervisor({
      adapter,
      stopController: stopController(),
      safety: safetyAllow,
    });
    const session = await supervisor.startSession({
      targetWindowId: "win-1",
      plannerMode: "local_only",
      groundingModelRuntimeId: null,
    });
    const observation = await supervisor.observe(session.sessionId);
    const target = supervisor.registerAccessibilityTarget(
      session.sessionId,
      observation.metadata.observationId,
      { x: 100, y: 200 },
      { x: 90, y: 190, width: 20, height: 20 }
    );
    const outcome = await supervisor.dispatch(
      session.sessionId,
      {
        actionKind: "click",
        targetHandle: target.handle,
        observationId: observation.metadata.observationId,
        point: { x: 100, y: 200 },
      },
      "within_task"
    );
    expect(outcome.outcome).toBe("succeeded");
    expect(outcome.verification).toEqual({ verified: true });
    expect(adapter.dispatchCalls).toHaveLength(1);
    expect(supervisor.getSummary(session.sessionId).state).toBe("READY");
    await supervisor.stopSession(session.sessionId);
  });

  it("safety rejection blocks the adapter call", async () => {
    const adapter = fakeAdapter();
    const supervisor = new ComputerUseSupervisor({
      adapter,
      stopController: stopController(),
      safety: {
        preDispatchCheck: async () => ({
          allowed: false,
          errorCode: "own_window",
        }),
      },
    });
    const session = await supervisor.startSession({
      targetWindowId: "win-1",
      plannerMode: "local_only",
      groundingModelRuntimeId: null,
    });
    const observation = await supervisor.observe(session.sessionId);
    const target = supervisor.registerAccessibilityTarget(
      session.sessionId,
      observation.metadata.observationId,
      { x: 100, y: 200 },
      { x: 90, y: 190, width: 20, height: 20 }
    );
    const outcome = await supervisor.dispatch(
      session.sessionId,
      {
        actionKind: "click",
        targetHandle: target.handle,
        observationId: observation.metadata.observationId,
        point: { x: 100, y: 200 },
      },
      "within_task"
    );
    expect(outcome.outcome).toBe("rejected");
    expect(outcome.errorCode).toBe("own_window");
    expect(adapter.dispatchCalls).toHaveLength(0);
    await supervisor.stopSession(session.sessionId);
  });

  it("reports uncertain when post-action verification fails", async () => {
    const adapter = fakeAdapter({ verify: async () => false });
    const supervisor = new ComputerUseSupervisor({
      adapter,
      stopController: stopController(),
      safety: safetyAllow,
    });
    const session = await supervisor.startSession({
      targetWindowId: "win-1",
      plannerMode: "local_only",
      groundingModelRuntimeId: null,
    });
    const observation = await supervisor.observe(session.sessionId);
    const target = supervisor.registerAccessibilityTarget(
      session.sessionId,
      observation.metadata.observationId,
      { x: 100, y: 200 },
      { x: 90, y: 190, width: 20, height: 20 }
    );
    const outcome = await supervisor.dispatch(
      session.sessionId,
      {
        actionKind: "click",
        targetHandle: target.handle,
        observationId: observation.metadata.observationId,
        point: { x: 100, y: 200 },
      },
      "within_task"
    );
    expect(outcome.outcome).toBe("uncertain");
    expect(outcome.verification).toMatchObject({ verified: false });
    await supervisor.stopSession(session.sessionId);
  });

  it("cancels an in-flight action when stop revokes the generation", async () => {
    const gate: { release: (() => void) | null } = { release: null };
    const adapter = fakeAdapter({
      dispatchInput: async () => {
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
        return { dispatchedAt: Date.now() };
      },
    });
    const supervisor = new ComputerUseSupervisor({
      adapter,
      stopController: stopController(),
      safety: safetyAllow,
    });
    const session = await supervisor.startSession({
      targetWindowId: "win-1",
      plannerMode: "local_only",
      groundingModelRuntimeId: null,
    });
    const observation = await supervisor.observe(session.sessionId);
    const target = supervisor.registerAccessibilityTarget(
      session.sessionId,
      observation.metadata.observationId,
      { x: 100, y: 200 },
      { x: 90, y: 190, width: 20, height: 20 }
    );
    const dispatchPromise = supervisor.dispatch(
      session.sessionId,
      {
        actionKind: "click",
        targetHandle: target.handle,
        observationId: observation.metadata.observationId,
        point: { x: 100, y: 200 },
      },
      "within_task"
    );
    await vi.waitFor(() => expect(gate.release).not.toBeNull());
    await supervisor.stopSession(session.sessionId);
    gate.release?.();
    const outcome = await dispatchPromise;
    expect(outcome.outcome).toBe("cancelled");
  });

  it("pauses on human input and focus change reasons", async () => {
    const supervisor = new ComputerUseSupervisor({
      adapter: fakeAdapter(),
      stopController: stopController(),
      safety: safetyAllow,
    });
    const session = await supervisor.startSession({
      targetWindowId: "win-1",
      plannerMode: "local_only",
      groundingModelRuntimeId: null,
    });
    expect((await supervisor.pauseSession(session.sessionId, "human_input")).state).toBe(
      "PAUSED"
    );
    expect((await supervisor.pauseSession(session.sessionId, "handoff")).state).toBe(
      "HANDOFF"
    );
    expect((await supervisor.resumeSession(session.sessionId)).state).toBe("READY");
    await supervisor.stopSession(session.sessionId);
  });

  it("registerGroundingTarget rejects ambiguous and absent outcomes", async () => {
    const supervisor = new ComputerUseSupervisor({
      adapter: fakeAdapter(),
      stopController: stopController(),
      safety: safetyAllow,
    });
    const session = await supervisor.startSession({
      targetWindowId: "win-1",
      plannerMode: "local_only",
      groundingModelRuntimeId: null,
    });
    const observation = await supervisor.observe(session.sessionId);
    const identity = {
      adapterId: "gui-actor-onnx",
      adapterVersion: "1.0.0",
      modelArchitecture: "gui-actor-2b",
      runtimeId: "grounding-model-gui-actor-2b-int4",
      runtimeVersion: "1.0.0",
      preprocessingRevision: "p1",
      decodingRevision: "d1",
      calibrationRevision: "c1",
      executionProvider: "cpu",
    };
    const transform = {
      modelWidth: 1876,
      modelHeight: 1036,
      cropX: 0,
      cropY: 0,
      scaleX: 1876 / 1920,
      scaleY: 1036 / 1080,
      padX: 0,
      padY: 0,
    };
    const base = {
      requestKey: "rk",
      generation: session.generation,
      observationId: observation.metadata.observationId,
      transform,
      identity,
      timings: { preprocessMs: 1, inferenceMs: 1, postprocessMs: 1 },
    };
    expect(() =>
      supervisor.registerGroundingTarget(session.sessionId, {
        ...base,
        outcome: "target_ambiguous",
        candidates: [],
      })
    ).toThrowError(ComputerUseError);
    expect(() =>
      supervisor.registerGroundingTarget(session.sessionId, {
        ...base,
        outcome: "target_not_found",
        candidates: [],
      })
    ).toThrowError(ComputerUseError);
    const resolved = supervisor.registerGroundingTarget(session.sessionId, {
      ...base,
      outcome: "resolved",
      candidates: [{ nx: 0.5, ny: 0.5, score: 0.9 }],
    });
    expect(resolved.source).toBe("grounding");
    expect(resolved.capturePoint.x).toBeCloseTo(960, 6);
    await supervisor.stopSession(session.sessionId);
  });
});
