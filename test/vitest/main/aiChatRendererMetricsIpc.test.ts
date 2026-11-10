import { beforeEach, describe, expect, it, vi } from "vitest";

// Drive the push handler without Electron.
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  },
}));

import { aiChatQueueCounters } from "@/service/AIChatQueueCounters";
import {
  registerAiChatRendererMetricsIpcHandlers,
  unregisterAiChatRendererMetricsForTest,
} from "@/main-process/communication/aiChatRendererMetricsIpc";
import { AI_CHAT_RENDERER_METRICS_PUSH } from "@/config/channellist";

type Realm = { realmId: string; seq: number };
type PushResult = { status: boolean; msg?: string };

async function push(
  payload: unknown,
  realm?: Realm
): Promise<PushResult> {
  const handler = handlers.get(AI_CHAT_RENDERER_METRICS_PUSH);
  if (!handler) throw new Error("push handler not registered");
  const body =
    realm !== undefined
      ? { ...(payload as Record<string, unknown>), realm }
      : payload;
  return (await handler(null, body)) as PushResult;
}

beforeEach(() => {
  unregisterAiChatRendererMetricsForTest();
  aiChatQueueCounters.reset();
  registerAiChatRendererMetricsIpcHandlers();
});

/**
 * Audit R2 G01 (diagnostics export): the renderer projection aggregates join
 * the main-process structured telemetry through this strictly validated,
 * fail-closed push channel — counts and durations only, never content.
 *
 * Audit R06: payloads carry a per-renderer-process `realm` (stable id +
 * monotonic seq) and CUMULATIVE raw aggregates; main converts each push into
 * per-realm deltas against the previous raw state so a replayed/periodic
 * cumulative snapshot cannot multiply samples.
 */
describe("aiChatRendererMetrics push handler (G01)", () => {
  it("merges a valid renderer snapshot into the main counters", async () => {
    const result = await push(
      {
        timings: {
          renderer_event_to_projection_ms: {
            count: 4,
            meanMs: 12,
            totalMs: 48,
            minMs: 5,
            maxMs: 30,
          },
        },
        counts: { stream_chunk_projected: 9, selection_switched: 3 },
      },
      { realmId: "realm-a", seq: 1 }
    );
    expect(result.status).toBe(true);
    const timings = aiChatQueueCounters.timingSnapshot();
    expect(timings.renderer_event_to_projection_ms).toEqual({
      count: 4,
      meanMs: 12,
      minMs: 5,
      maxMs: 30,
    });
    const snapshot = aiChatQueueCounters.snapshot();
    expect(snapshot["renderer_stream_chunk_projected"]).toBe(9);
    expect(snapshot["renderer_selection_switched"]).toBe(3);
  });

  it("aggregates cumulative snapshots from one realm without double counting", async () => {
    // Push 1: two samples (4ms, 8ms).
    await push(
      {
        timings: {
          renderer_event_to_projection_ms: {
            count: 2,
            meanMs: 6,
            totalMs: 12,
            minMs: 4,
            maxMs: 8,
          },
        },
        counts: { stream_chunk_projected: 5 },
      },
      { realmId: "realm-c", seq: 1 }
    );
    // Push 2: the CUMULATIVE renderer state after one more sample (22ms).
    await push(
      {
        timings: {
          renderer_event_to_projection_ms: {
            count: 3,
            meanMs: 11,
            totalMs: 34,
            minMs: 4,
            maxMs: 22,
          },
        },
        counts: { stream_chunk_projected: 6 },
      },
      { realmId: "realm-c", seq: 2 }
    );
    const timings = aiChatQueueCounters.timingSnapshot();
    expect(timings.renderer_event_to_projection_ms).toEqual({
      count: 3,
      meanMs: 11,
      minMs: 4,
      maxMs: 22,
    });
    expect(aiChatQueueCounters.snapshot()["renderer_stream_chunk_projected"]).toBe(6);
  });

  it("denies unknown keys, non-numeric values, malformed realm and oversized labels", async () => {
    const invalidPayloads: unknown[] = [
      // unknown top-level key
      { realm: { realmId: "r", seq: 1 }, timings: {}, counts: {}, content: "leak" },
      // missing realm
      { timings: {}, counts: {} },
      // malformed realm identity
      { realm: { realmId: "bad realm!", seq: 1 }, timings: {}, counts: {} },
      // non-monotonic realm sequence handled separately; malformed seq here
      { realm: { realmId: "r", seq: 1.5 }, timings: {}, counts: {} },
      // mistyped timings
      { realm: { realmId: "r", seq: 1 }, timings: [], counts: {} },
      // overflowing duration
      {
        realm: { realmId: "r", seq: 1 },
        timings: {
          renderer_event_to_projection_ms: {
            count: 1,
            meanMs: 1_000_000,
            minMs: 0,
            maxMs: 0,
          },
        },
        counts: {},
      },
      // malformed label
      { realm: { realmId: "r", seq: 1 }, timings: {}, counts: { "BAD LABEL!": 1 } },
      // non-integer count
      { realm: { realmId: "r", seq: 1 }, timings: {}, counts: { valid_label: 1.5 } },
    ];
    for (const payload of invalidPayloads) {
      const result = await push(payload);
      expect(result.status).toBe(false);
    }
  });

  it("does not mint new main-side timing keys from the renderer", async () => {
    const result = await push(
      {
        timings: {
          renderer_invented_key_ms: { count: 1, meanMs: 5, minMs: 5, maxMs: 5 },
        },
        counts: {},
      },
      { realmId: "realm-d", seq: 1 }
    );
    expect(result.status).toBe(true);
    const timings = aiChatQueueCounters.timingSnapshot();
    expect(Object.values(timings).filter(Boolean)).toHaveLength(0);
  });

  it("AUDIT3 repeated cumulative snapshots do not multiply samples", async () => {
    const snapshot = {
      timings: {
        renderer_event_to_projection_ms: {
          count: 4,
          meanMs: 12,
          totalMs: 48,
          minMs: 5,
          maxMs: 30,
        },
      },
      counts: { stream_chunk_projected: 9 },
    };
    await push(snapshot, { realmId: "realm-audit", seq: 1 });
    await push(snapshot, { realmId: "realm-audit", seq: 2 });
    expect(
      aiChatQueueCounters.timingSnapshot().renderer_event_to_projection_ms?.count
    ).toBe(4);
    expect(aiChatQueueCounters.snapshot().renderer_stream_chunk_projected).toBe(9);
  });

  it("AUDIT3 stale and replayed realm sequence numbers are rejected", async () => {
    const payload = {
      timings: {},
      counts: { stream_chunk_projected: 2 },
    };
    expect((await push(payload, { realmId: "realm-s", seq: 3 })).status).toBe(true);
    expect((await push(payload, { realmId: "realm-s", seq: 3 })).status).toBe(false);
    expect((await push(payload, { realmId: "realm-s", seq: 2 })).status).toBe(false);
    expect(aiChatQueueCounters.snapshot()["renderer_stream_chunk_projected"]).toBe(2);
  });

  it("AUDIT3 a restarted renderer realm starts a fresh baseline", async () => {
    const payload = {
      timings: {
        renderer_event_to_projection_ms: {
          count: 4,
          meanMs: 12,
          totalMs: 48,
          minMs: 5,
          maxMs: 30,
        },
      },
      counts: { stream_chunk_projected: 9 },
    };
    await push(payload, { realmId: "realm-old", seq: 7 });
    // Renderer restart: same cumulative shape, brand-new realm identity.
    await push(payload, { realmId: "realm-new", seq: 1 });
    const timings = aiChatQueueCounters.timingSnapshot();
    // The new realm's baseline replaces nothing — but no double counting
    // either: main's total equals the union of observations (8 samples).
    expect(timings.renderer_event_to_projection_ms?.count).toBe(8);
  });
});
