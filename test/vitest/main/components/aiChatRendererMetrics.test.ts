import { describe, expect, it, beforeEach } from "vitest";
import {
  observeRendererProjectionTiming,
  incrementRendererMetric,
  aiChatRendererMetricsSnapshot,
  resetRendererMetricsForTest,
} from "@/views/store/aiChatRendererMetrics";

/**
 * Audit 2026-10-20 G01 (design §18.2 renderer projection timing): the
 * renderer realm keeps bounded, content-free aggregates for soak runs.
 */
describe("aiChatRendererMetrics", () => {
  beforeEach(() => {
    resetRendererMetricsForTest();
  });

  it("aggregates projection timings into count/mean/min/max", () => {
    observeRendererProjectionTiming(4);
    observeRendererProjectionTiming(8);
    observeRendererProjectionTiming(2);
    const snapshot = aiChatRendererMetricsSnapshot();
    expect(snapshot.timings.renderer_event_to_projection_ms).toEqual({
      count: 3,
      meanMs: 5,
      minMs: 2,
      maxMs: 8,
    });
  });

  it("bounds labels and rejects non-positive durations", () => {
    observeRendererProjectionTiming(-1);
    observeRendererProjectionTiming(Number.NaN);
    incrementRendererMetric("stream_chunk_projected");
    incrementRendererMetric("bad label with spaces");
    const snapshot = aiChatRendererMetricsSnapshot();
    expect(snapshot.timings.renderer_event_to_projection_ms).toBeUndefined();
    expect(snapshot.counts.stream_chunk_projected).toBe(1);
    expect(snapshot.counts.label_invalid).toBe(1);
  });
});
