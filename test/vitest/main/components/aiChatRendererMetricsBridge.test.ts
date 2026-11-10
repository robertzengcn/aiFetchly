import { beforeEach, describe, expect, it, vi } from "vitest";

// Bridge vitest harness: intercept the windowInvoke IPC and assertions on
// the push payload shape (realm identity + cumulative aggregates).
const { windowInvoke } = vi.hoisted(() => ({
  windowInvoke: vi.fn<(channel: string, payload: unknown) => Promise<unknown>>(async () => undefined),
}));
vi.mock("@/views/utils/apirequest", () => ({
  windowInvoke,
}));

import { flushRendererMetricsOnce, resetRendererMetricsBridgeForTest } from "@/views/api/aiChatRendererMetricsBridge";
import {
  incrementRendererMetric,
  observeRendererProjectionTiming,
  resetRendererMetricsForTest,
} from "@/views/store/aiChatRendererMetrics";

describe("aiChatRendererMetricsBridge (audit R06 realm protocol)", () => {
  beforeEach(() => {
    windowInvoke.mockClear();
    resetRendererMetricsBridgeForTest();
    resetRendererMetricsForTest();
  });

  it("AUDIT3 wraps the snapshot in a monotonic realm identity", async () => {
    observeRendererProjectionTiming(4);
    observeRendererProjectionTiming(9);
    incrementRendererMetric("stream_chunk_projected", 5);

    await flushRendererMetricsOnce();
    await flushRendererMetricsOnce();

    expect(windowInvoke).toHaveBeenCalledTimes(2);
    const first = windowInvoke.mock.calls[0] as [string, unknown];
    const second = windowInvoke.mock.calls[1] as [string, unknown];
    expect(first[0]).toBeDefined();
    const realmA = (first[1] as { realm: { realmId: string; seq: number } }).realm;
    const realmB = (second[1] as { realm: { realmId: string; seq: number } }).realm;
    expect(realmA.realmId).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(realmB.realmId).toBe(realmA.realmId);
    expect(realmA.seq).toBe(1);
    expect(realmB.seq).toBe(2);
    expect(
      (first[1] as { timings: { renderer_event_to_projection_ms: { count: number; totalMs: number } } })
        .timings.renderer_event_to_projection_ms
    ).toEqual({ count: 2, meanMs: 7, totalMs: 13, minMs: 4, maxMs: 9 });
    expect((first[1] as { counts: Record<string, number> }).counts.stream_chunk_projected).toBe(5);
  });

  it("AUDIT3 flush failures never surface (telemetry is fail-soft)", async () => {
    windowInvoke.mockRejectedValueOnce(new Error("ipc down"));
    await expect(flushRendererMetricsOnce()).resolves.toBeUndefined();
  });
});
