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
import { registerAiChatRendererMetricsIpcHandlers } from "@/main-process/communication/aiChatRendererMetricsIpc";
import { AI_CHAT_RENDERER_METRICS_PUSH } from "@/config/channellist";

type PushResult = { status: boolean; msg?: string };

async function push(payload: unknown): Promise<PushResult> {
  const handler = handlers.get(AI_CHAT_RENDERER_METRICS_PUSH);
  if (!handler) throw new Error("push handler not registered");
  return (await handler(null, payload)) as PushResult;
}

beforeEach(() => {
  aiChatQueueCounters.reset();
  registerAiChatRendererMetricsIpcHandlers();
});

/**
 * Audit R2 G01 (diagnostics export): the renderer projection aggregates join
 * the main-process structured telemetry through this strictly validated,
 * fail-closed push channel — counts and durations only, never content.
 */
describe("aiChatRendererMetrics push handler (G01)", () => {
  it("merges a valid renderer snapshot into the main counters", async () => {
    const result = await push({
      timings: {
        renderer_event_to_projection_ms: {
          count: 4,
          meanMs: 12,
          minMs: 5,
          maxMs: 30,
        },
      },
      counts: { stream_chunk_projected: 9, selection_switched: 3 },
    });
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

  it("aggregates across multiple pushes", async () => {
    await push({
      timings: {
        renderer_event_to_projection_ms: {
          count: 2,
          meanMs: 6,
          minMs: 4,
          maxMs: 8,
        },
      },
      counts: {},
    });
    await push({
      timings: {
        renderer_event_to_projection_ms: {
          count: 1,
          meanMs: 22,
          minMs: 22,
          maxMs: 22,
        },
      },
      counts: {},
    });
    const timings = aiChatQueueCounters.timingSnapshot();
    expect(timings.renderer_event_to_projection_ms?.count).toBe(3);
    expect(timings.renderer_event_to_projection_ms?.minMs).toBe(4);
    expect(timings.renderer_event_to_projection_ms?.maxMs).toBe(22);
  });

  it("denies unknown keys, non-numeric values and oversized labels", async () => {
    const invalidPayloads: unknown[] = [
      // unknown top-level key
      { timings: {}, counts: {}, content: "leak" },
      // mistyped timings
      { timings: [], counts: {} },
      // overflowing duration
      {
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
      { timings: {}, counts: { "BAD LABEL!": 1 } },
      // non-integer count
      { timings: {}, counts: { valid_label: 1.5 } },
    ];
    for (const payload of invalidPayloads) {
      const result = await push(payload);
      expect(result.status).toBe(false);
    }
  });

  it("does not mint new main-side timing keys from the renderer", async () => {
    const result = await push({
      timings: {
        renderer_invented_key_ms: { count: 1, meanMs: 5, minMs: 5, maxMs: 5 },
      },
      counts: {},
    });
    expect(result.status).toBe(true);
    const timings = aiChatQueueCounters.timingSnapshot();
    expect(Object.values(timings).filter(Boolean)).toHaveLength(0);
  });
});
