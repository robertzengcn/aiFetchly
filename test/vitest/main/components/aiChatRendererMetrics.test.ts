import { describe, expect, it, beforeEach } from "vitest";
import {
  beginRendererProjectionWindow,
  cancelRendererProjectionWindow,
  endRendererProjectionWindow,
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

  // Audit R2 G01: the projection completion boundary — a buffered delta's
  // projection lands when the deferred flush runs, so its sample closes at
  // that boundary, not at schedule time.
  it("projection window end observes the full receipt-to-projection span", () => {
    beginRendererProjectionWindow();
    observeRendererProjectionTiming(1); // unrelated sync sample
    endRendererProjectionWindow();
    const snapshot = aiChatRendererMetricsSnapshot();
    const aggregate = snapshot.timings.renderer_event_to_projection_ms;
    expect(aggregate).toBeDefined();
    // sync sample (1ms) + window sample (>=0) — the window must have added
    // exactly one extra observation.
    expect(aggregate?.count).toBe(2);
  });

  it("projection window cancel drops the sample without recording", () => {
    beginRendererProjectionWindow();
    cancelRendererProjectionWindow();
    endRendererProjectionWindow(); // no open window — no-op
    const snapshot = aiChatRendererMetricsSnapshot();
    expect(snapshot.timings.renderer_event_to_projection_ms).toBeUndefined();
  });

  it("a second begin during an open window does not overwrite the start", () => {
    beginRendererProjectionWindow();
    beginRendererProjectionWindow(); // ignored — first start wins
    endRendererProjectionWindow();
    const snapshot = aiChatRendererMetricsSnapshot();
    expect(snapshot.timings.renderer_event_to_projection_ms?.count).toBe(1);
  });
});
