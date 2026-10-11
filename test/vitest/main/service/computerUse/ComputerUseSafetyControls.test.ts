// test/vitest/main/service/computerUse/ComputerUseSafetyControls.test.ts
//
// Safety controls (design §10.5, §14.2): hotkey lifecycle + fail-closed +
// chord refusal, own-window rejection at multiple scales, keyboard focus
// refusal, elevation fail-closed (unknown integrity), target-picker
// filtering, strip masking geometry, and the stop-gate measurement harness.
import { describe, it, expect } from "vitest";
import {
  ComputerUseStopHotkeyService,
  isValidStopHotkeyAccelerator,
  actionMatchesHotkeyChord,
  parseAccelerator,
  type AcceleratorRegistry,
} from "@/service/computerUse/ComputerUseStopHotkeyService";
import {
  ComputerUseElevationService,
  isAboveHostOrUnknown,
} from "@/service/computerUse/ComputerUseElevationService";
import {
  ComputerUseSafetyService,
  pointInRect,
} from "@/service/computerUse/ComputerUseSafetyService";
import { ComputerUseMeasurementService } from "@/service/computerUse/ComputerUseMeasurementService";
import { ComputerUseError } from "@/entityTypes/computerUseTypes";

/* ----------------------------------- hotkey ----------------------------------- */

function recordingRegistry() {
  const state = {
    registered: [] as string[],
    unregistered: [] as string[],
    failNext: false,
  };
  const registry: AcceleratorRegistry = {
    register: (acc) => {
      if (state.failNext) {
        state.failNext = false;
        return false;
      }
      state.registered.push(acc);
      return true;
    },
    unregister: (acc) => {
      state.unregistered.push(acc);
    },
    unregisterAll: () => undefined,
  };
  return { state, registry };
}

describe("ComputerUseStopHotkeyService", () => {
  it("validates accelerators with at least two modifiers", () => {
    expect(isValidStopHotkeyAccelerator("Ctrl+Alt+Shift+S")).toBe(true);
    expect(isValidStopHotkeyAccelerator("Ctrl+S")).toBe(false);
    expect(isValidStopHotkeyAccelerator("Ctrl+Alt+Shift+")).toBe(false);
    expect(isValidStopHotkeyAccelerator("")).toBe(false);
  });

  it("registers only during a session and unregisters on exit", async () => {
    const { state, registry } = recordingRegistry();
    const stops: string[] = [];
    const service = new ComputerUseStopHotkeyService({
      registry,
      onStop: (sessionId) => stops.push(sessionId),
    });
    const accelerator = await service.register("s1");
    expect(accelerator).toBe("Ctrl+Alt+Shift+S");
    expect(state.registered).toEqual(["Ctrl+Alt+Shift+S"]);

    service.triggerStop("s1");
    expect(stops).toEqual(["s1"]);

    await service.unregister("s1");
    expect(state.unregistered).toEqual(["Ctrl+Alt+Shift+S"]);
    expect(service.activeAccelerator).toBeNull();
  });

  it("register returns null (blocking the session) when registration fails", async () => {
    const { state, registry } = recordingRegistry();
    state.failNext = true;
    const service = new ComputerUseStopHotkeyService({
      registry,
      onStop: () => undefined,
    });
    expect(await service.register("s1")).toBeNull();
    expect(service.activeAccelerator).toBeNull();
  });

  it("refuses a second concurrent registration", async () => {
    const { registry } = recordingRegistry();
    const service = new ComputerUseStopHotkeyService({
      registry,
      onStop: () => undefined,
    });
    await service.register("s1");
    expect(await service.register("s2")).toBeNull();
  });

  it("detects action chords that would re-trigger the hotkey", () => {
    expect(
      actionMatchesHotkeyChord(
        { actionKind: "hotkey", key: "s", modifiers: ["Control", "Alt", "Shift"] },
        "Ctrl+Alt+Shift+S"
      )
    ).toBe(true);
    expect(
      actionMatchesHotkeyChord(
        { actionKind: "hotkey", key: "s", modifiers: ["Control", "Alt"] },
        "Ctrl+Alt+Shift+S"
      )
    ).toBe(false);
    expect(
      actionMatchesHotkeyChord(
        { actionKind: "hotkey", key: "k", modifiers: ["Control", "Alt", "Shift"] },
        "Ctrl+Alt+Shift+S"
      )
    ).toBe(false);
    expect(
      actionMatchesHotkeyChord(
        { actionKind: "type_text", text: "Ctrl+Alt+Shift+S" },
        "Ctrl+Alt+Shift+S"
      )
    ).toBe(false); // multi-character text cannot hold a chord
    // Alias modifiers normalize (CmdOrCtrl ≡ Ctrl for comparison purposes).
    expect(
      actionMatchesHotkeyChord(
        { actionKind: "hotkey", key: "S", modifiers: ["CmdOrCtrl", "Alt", "Shift"] },
        "Ctrl+Alt+Shift+S"
      )
    ).toBe(true);
  });

  it("parseAccelerator normalizes modifiers", () => {
    const parsed = parseAccelerator("CommandOrControl+Shift+X");
    expect(parsed?.key).toBe("X");
    expect([...(parsed?.modifiers ?? [])].sort()).toEqual(["CMD", "CTRL", "SHIFT"]);
  });
});

/* --------------------------------- elevation --------------------------------- */

describe("ComputerUseElevationService", () => {
  it("orders integrity levels and fails closed on unknown", () => {
    expect(isAboveHostOrUnknown("medium", "medium")).toBe(false);
    expect(isAboveHostOrUnknown("high", "medium")).toBe(true);
    expect(isAboveHostOrUnknown("system", "high")).toBe(true);
    expect(isAboveHostOrUnknown("unknown", "medium")).toBe(true);
    expect(isAboveHostOrUnknown("medium", "unknown")).toBe(true);
  });

  it("refuses sessions when the host is elevated", async () => {
    const service = new ComputerUseElevationService({
      hostIntegrity: async () => "high",
      processIntegrity: async () => "medium",
    });
    await expect(service.assertHostNotElevated()).rejects.toThrowError(
      ComputerUseError
    );
  });

  it("treats an unqueryable host as unknown and refuses", async () => {
    const service = new ComputerUseElevationService({
      hostIntegrity: async () => {
        throw new Error("query failed");
      },
      processIntegrity: async () => "medium",
    });
    await expect(service.assertHostNotElevated()).rejects.toThrowError(
      ComputerUseError
    );
  });

  it("rejects elevated and unknown targets before dispatch", async () => {
    const service = new ComputerUseElevationService({
      hostIntegrity: async () => "medium",
      processIntegrity: async (pid) => (pid === 1 ? "high" : pid === 2 ? "medium" : "unknown"),
    });
    await expect(service.assertTargetNotElevated(1)).rejects.toThrowError(
      ComputerUseError
    );
    await expect(service.assertTargetNotElevated(2)).resolves.toBeUndefined();
    await expect(service.assertTargetNotElevated(3)).rejects.toThrowError(
      ComputerUseError
    );
  });

  it("caches per process id and clears on re-observation", async () => {
    let queries = 0;
    const service = new ComputerUseElevationService({
      hostIntegrity: async () => "medium",
      processIntegrity: async () => {
        queries++;
        return "medium";
      },
    });
    await service.assertTargetNotElevated(42);
    await service.assertTargetNotElevated(42);
    expect(queries).toBe(1);
    service.clearProcessCache();
    await service.assertTargetNotElevated(42);
    expect(queries).toBe(2);
  });
});

/* ---------------------------------- safety ---------------------------------- */

const IDENTITY = {
  adapterId: "test",
  adapterVersion: "1",
  modelArchitecture: "test",
  runtimeId: "test",
  runtimeVersion: "1",
  preprocessingRevision: "p",
  decodingRevision: "d",
  calibrationRevision: "c",
  executionProvider: "cpu",
};

function makeSafety(overrides: Partial<Parameters<typeof makeSafetyProviders>[0]> = {}) {
  const providers = makeSafetyProviders(overrides);
  return {
    providers,
    service: new ComputerUseSafetyService(providers),
  };
}

function makeSafetyProviders(
  overrides: Record<string, unknown> = {}
): import("@/service/computerUse/ComputerUseSafetyService").ComputerUseSafetyProviders {
  return {
    ownWindowScreenRects: () => [
      { x: 2000, y: 0, width: 400, height: 300 }, // main window (screen px)
    ],
    ownWindowFocused: () => false,
    targetProcessId: () => 77,
    elevation: new ComputerUseElevationService({
      hostIntegrity: async () => "medium",
      processIntegrity: async () => "medium",
    }),
    captureToExecutorFor: () => ({
      scaleX: 1,
      scaleY: 1,
      originX: 0,
      originY: 0,
    }),
    ...overrides,
  } as import("@/service/computerUse/ComputerUseSafetyService").ComputerUseSafetyProviders;
}

const TARGET = {
  handle: "cut_1",
  generation: 1,
  observationId: "obs-1",
  capturePoint: { x: 100, y: 100 },
  region: { x: 90, y: 90, width: 20, height: 20 },
  source: "accessibility" as const,
  createdAt: Date.now(),
  expiresAt: Date.now() + 10_000,
};

describe("ComputerUseSafetyService", () => {
  it("rejects pointer actions landing on any AiFetchly window", async () => {
    const { service } = makeSafety();
    const verdict = await service.preDispatchCheck({
      sessionId: "s1",
      generation: 1,
      request: { actionKind: "click", targetHandle: "cut_1", observationId: "obs-1", point: { x: 2200, y: 150 } },
      target: TARGET,
    });
    expect(verdict).toMatchObject({ allowed: false, errorCode: "own_window" });
  });

  it("allows pointer actions outside every own-window rect", async () => {
    const { service } = makeSafety();
    const verdict = await service.preDispatchCheck({
      sessionId: "s1",
      generation: 1,
      request: { actionKind: "click", targetHandle: "cut_1", observationId: "obs-1", point: { x: 500, y: 500 } },
      target: TARGET,
    });
    expect(verdict.allowed).toBe(true);
  });

  it("applies 150% DPI scaling through the capture→executor transform", async () => {
    // Capture pixels are 2/3 of screen px at 150%: capture (600, 200) →
    // screen (900, 300), still outside the 2000..2400 window; capture
    // (1200, 100) → screen (1800, 150)... construct an inside case instead:
    // screen rect x∈[2000,2400] ← capture x∈[1333.34, 1600].
    const { service } = makeSafety({
      captureToExecutorFor: () => ({ scaleX: 1.5, scaleY: 1.5, originX: 0, originY: 0 }),
    });
    const inside = await service.preDispatchCheck({
      sessionId: "s1",
      generation: 1,
      request: { actionKind: "click", targetHandle: "cut_1", observationId: "obs-1", point: { x: 1400, y: 100 } },
      target: TARGET,
    });
    expect(inside).toMatchObject({ allowed: false, errorCode: "own_window" });
    const outside = await service.preDispatchCheck({
      sessionId: "s1",
      generation: 1,
      request: { actionKind: "click", targetHandle: "cut_1", observationId: "obs-1", point: { x: 1000, y: 100 } },
      target: TARGET,
    });
    expect(outside.allowed).toBe(true);
  });

  it("refuses keyboard actions while an AiFetchly window has focus", async () => {
    const { service } = makeSafety({ ownWindowFocused: () => true });
    const verdict = await service.preDispatchCheck({
      sessionId: "s1",
      generation: 1,
      request: { actionKind: "type_text", targetHandle: "cut_1", observationId: "obs-1", text: "hi" },
      target: TARGET,
    });
    expect(verdict).toMatchObject({ allowed: false, errorCode: "own_window" });
  });

  it("allows keyboard actions when the target app has focus", async () => {
    const { service } = makeSafety();
    const verdict = await service.preDispatchCheck({
      sessionId: "s1",
      generation: 1,
      request: { actionKind: "type_text", targetHandle: "cut_1", observationId: "obs-1", text: "hi" },
      target: TARGET,
    });
    expect(verdict.allowed).toBe(true);
  });

  it("fails closed without a capture→executor transform", async () => {
    const { service } = makeSafety({
      captureToExecutorFor: () => null,
    });
    const verdict = await service.preDispatchCheck({
      sessionId: "s1",
      generation: 1,
      request: { actionKind: "click", targetHandle: "cut_1", observationId: "obs-1", point: { x: 10, y: 10 } },
      target: TARGET,
    });
    expect(verdict).toMatchObject({ allowed: false, errorCode: "coordinates_invalid" });
  });

  it("rejects elevated targets before dispatch", async () => {
    const { service } = makeSafety({
      elevation: new ComputerUseElevationService({
        hostIntegrity: async () => "medium",
        processIntegrity: async () => "high",
      }),
    });
    const verdict = await service.preDispatchCheck({
      sessionId: "s1",
      generation: 1,
      request: { actionKind: "click", targetHandle: "cut_1", observationId: "obs-1", point: { x: 10, y: 10 } },
      target: TARGET,
    });
    expect(verdict).toMatchObject({ allowed: false, errorCode: "elevated_window" });
  });

  it("refuses actions whose chord matches the active stop hotkey", async () => {
    const { state, registry } = recordingRegistry();
    const hotkey = new ComputerUseStopHotkeyService({
      registry,
      onStop: () => undefined,
    });
    await hotkey.register("s1");
    const { service } = makeSafety({ stopHotkey: hotkey });
    const verdict = await service.preDispatchCheck({
      sessionId: "s1",
      generation: 1,
      request: {
        actionKind: "hotkey",
        targetHandle: "cut_1",
        observationId: "obs-1",
        key: "S",
        modifiers: ["Ctrl", "Alt", "Shift"],
      },
      target: TARGET,
    });
    expect(verdict).toMatchObject({ allowed: false, errorCode: "permission_denied" });
  });

  it("filters AiFetchly-owned windows out of the target picker", () => {
    const { service } = makeSafety({
      ownProcessIds: new Set([100, 101]),
    });
    const selectable = service.filterSelectableWindows([
      { windowId: "a", processId: 100 },
      { windowId: "b", processId: 200 },
      { windowId: "c", processId: 101 },
    ]);
    expect(selectable.map((w) => w.windowId)).toEqual(["b"]);
  });

  it("computes the strip mask rect in capture pixels", () => {
    // Screen origin (100,50), 2× capture scale: strip at screen
    // [300,150]..[500,250] maps to capture [100,50]..[200,100].
    const rect = ComputerUseSafetyService.stripMaskRect(
      { width: 1920, height: 1080 },
      { scaleX: 2, scaleY: 2, originX: 100, originY: 50 },
      { x: 300, y: 150, width: 200, height: 100 }
    );
    expect(rect).toEqual({ x: 100, y: 50, width: 100, height: 50 });
    // A strip entirely outside the capture produces no mask.
    expect(
      ComputerUseSafetyService.stripMaskRect(
        { width: 100, height: 100 },
        { scaleX: 1, scaleY: 1, originX: 0, originY: 0 },
        { x: 500, y: 500, width: 10, height: 10 }
      )
    ).toBeNull();
  });

  it("pointInRect is inclusive on edges", () => {
    const rect = { x: 10, y: 10, width: 10, height: 10 };
    expect(pointInRect(10, 10, rect)).toBe(true);
    expect(pointInRect(20, 20, rect)).toBe(true);
    expect(pointInRect(21, 15, rect)).toBe(false);
  });
});

/* ------------------------------- measurements ------------------------------- */

describe("ComputerUseMeasurementService", () => {
  it("computes p50/p95/max percentiles over samples", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(ComputerUseMeasurementService.percentile(values, 50)).toBe(50);
    expect(ComputerUseMeasurementService.percentile(values, 95)).toBe(95);
    expect(ComputerUseMeasurementService.percentile([], 50)).toBeNull();
  });

  it("records spans and aggregates by metric", () => {
    const service = new ComputerUseMeasurementService();
    service.recordSpan("stop_acknowledgment_ms", "s1", 0, 120);
    service.recordSpan("stop_acknowledgment_ms", "s1", 0, 260);
    const snap = service.snapshot();
    expect(snap.stop_acknowledgment_ms).toMatchObject({
      count: 2,
      p50: 120,
      max: 260,
    });
  });

  it("flags stop-gate violations when input lands after acknowledgment", () => {
    const service = new ComputerUseMeasurementService();
    service.markDispatch("s1", 1_000);
    service.markStopAcknowledged("s1", 2_000);
    expect(service.stopGateViolations("s1")).toEqual([]);

    service.markDispatch("s1", 2_250);
    expect(service.stopGateViolations("s1")).toEqual([
      { dispatchedAfterMs: 250 },
    ]);
  });

  it("begin/end handles are single-shot", () => {
    let t = 0;
    const service = new ComputerUseMeasurementService(() => t);
    const handle = service.begin("grounding_latency_warm_ms", "s1");
    t = 42;
    expect(handle.end()).toBe(42);
    expect(handle.end()).toBe(-1);
  });
});
