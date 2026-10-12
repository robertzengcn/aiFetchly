import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setupElectronMocks,
  resetElectronMocks,
  mockIpcMain,
} from "../../../utils/electron-mocks";
import type { CommonMessage } from "@/entityTypes/commonType";
import type { RolloutMetricsSnapshot } from "@/entityTypes/aiTaskRolloutMetricsTypes";

// Controllable module + gate mocks so the IPC test stays off the database.
const mockGetRolloutSnapshot = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => ({ enabled: true }));

vi.mock("electron", () => ({ ipcMain: mockIpcMain }));
vi.mock("@/service/AiFeatureGate", () => ({
  ensureHostedAiEnabled: vi.fn(() => Promise.resolve(gate.enabled)),
}));
vi.mock("@/modules/AiTaskRolloutMetricsModule", () => ({
  AiTaskRolloutMetricsModule: class {
    constructor() {
      return {
        getRolloutSnapshot: mockGetRolloutSnapshot,
      };
    }
  },
}));

import { registerAiTaskRolloutMetricsIpcHandlers } from "@/main-process/communication/aiTaskRolloutMetrics-ipc";
import { AI_TASK_ROLLOUT_METRICS_GET } from "@/config/channellist";
import { makeEmptyRolloutOriginCohort } from "@/entityTypes/aiTaskRolloutMetricsTypes";

const SINCE = "2026-10-12T00:00:00.000Z";

function makeSnapshot(overrides?: {
  manualExecutions?: number;
  generatedAt?: string;
}): RolloutMetricsSnapshot {
  const snapshot = {
    schemaVersion: 1 as const,
    generatedAt: overrides?.generatedAt ?? "2026-10-12T01:00:00.000Z",
    since: SINCE,
    manual: makeEmptyRolloutOriginCohort("manual"),
    scheduled: makeEmptyRolloutOriginCohort("scheduled"),
    operations: {
      total: 0,
      pending: 0,
      claimed: 0,
      dispatched: 0,
      accepted: 0,
      completed: 0,
      failed: 0,
      unknown: 0,
    },
  };
  if (overrides?.manualExecutions !== undefined) {
    snapshot.manual = {
      ...snapshot.manual,
      consumption: {
        ...snapshot.manual.consumption,
        executions: overrides.manualExecutions,
      },
    };
  }
  return snapshot;
}

describe("AI task rollout-metrics IPC", () => {
  beforeEach(() => {
    setupElectronMocks();
    vi.clearAllMocks();
    gate.enabled = true;
    registerAiTaskRolloutMetricsIpcHandlers();
  });
  afterEach(() => resetElectronMocks());

  const call = async (
    payload: unknown
  ): Promise<CommonMessage<unknown>> =>
    (await mockIpcMain.callHandler(
      AI_TASK_ROLLOUT_METRICS_GET,
      {},
      payload
    )) as CommonMessage<unknown>;

  it("denies the read when AI is disabled, before module construction", async () => {
    gate.enabled = false;
    const res = await call({ since: SINCE });
    expect(res.status).toBe(false);
    expect(res.msg).toContain("subscribers");
    expect(mockGetRolloutSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a missing since without touching the module", async () => {
    const res = await call({});
    expect(res.status).toBe(false);
    expect(mockGetRolloutSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a non-ISO since without touching the module", async () => {
    const res = await call({ since: "not-a-timestamp" });
    expect(res.status).toBe(false);
    expect(mockGetRolloutSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a naive (offset-less) ISO since — the query schema requires an offset", async () => {
    const res = await call({ since: "2026-10-12T00:00:00.000" });
    expect(res.status).toBe(false);
    expect(mockGetRolloutSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a malformed JSON-string payload without touching the module", async () => {
    const res = await call("{not-json");
    expect(res.status).toBe(false);
    expect(mockGetRolloutSnapshot).not.toHaveBeenCalled();
  });

  it("accepts the JSON-stringified payload sent by Electron preload", async () => {
    const snapshot = makeSnapshot({ manualExecutions: 4 });
    mockGetRolloutSnapshot.mockResolvedValue(snapshot);
    const res = await call(JSON.stringify({ since: SINCE }));
    expect(res.status).toBe(true);
    expect(mockGetRolloutSnapshot).toHaveBeenCalledWith({ since: SINCE });
    expect(
      (res.data as RolloutMetricsSnapshot).manual.consumption.executions
    ).toBe(4);
  });

  it("returns the module-backed snapshot on the happy path", async () => {
    const snapshot = makeSnapshot({
      manualExecutions: 2,
      generatedAt: "2026-10-12T02:00:00.000Z",
    });
    mockGetRolloutSnapshot.mockResolvedValue(snapshot);
    const res = await call({ since: SINCE });
    expect(res.status).toBe(true);
    expect(res.msg).toBe("");
    expect(res.data).toEqual(snapshot);
    expect(mockGetRolloutSnapshot).toHaveBeenCalledTimes(1);
  });

  it("resolves to a status:false envelope (never a rejection) when the module throws", async () => {
    mockGetRolloutSnapshot.mockRejectedValue(new Error("db exploded"));
    const res = await call({ since: SINCE });
    expect(res.status).toBe(false);
    expect(res.msg).toBe("db exploded");
    expect(res.data).toBeUndefined();
  });

  it("resolves to a status:false envelope on a non-Error module throw", async () => {
    mockGetRolloutSnapshot.mockRejectedValue("string failure");
    const res = await call({ since: SINCE });
    expect(res.status).toBe(false);
    expect(res.msg).toBe("Rollout metrics read failed.");
  });
});
