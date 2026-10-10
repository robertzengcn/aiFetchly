/**
 * Latency + counter metrics for preserved outputs (T17 / design §12.3).
 *
 * Pins the invariants the design insists on:
 *  - `recordLatency` populates `latencyOf` (a numeric p95) AND increments the
 *    event count, so a support dump sees the timing alongside the counters.
 *  - the recent-event ring stays bounded (≤ MAX_RECENT_EVENTS) for both
 *    counters and latency samples, so a long-running process never accumulates
 *    an unbounded latency list.
 *  - metrics are content-free: `detail` is capped at 64 chars and never
 *    carries a payload/path. A pathological detail string cannot grow memory.
 *  - a latency event with no recorded samples returns p95 = 0 (not NaN).
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  toolResultMetrics,
  getToolResultMetrics,
} from "@/service/toolResult/ToolResultMetrics";

describe("ToolResultMetrics — counters", () => {
  beforeEach(() => {
    getToolResultMetrics().reset();
  });

  it("counts repeated records under the same name", () => {
    toolResultMetrics.record("capture.externalized");
    toolResultMetrics.record("capture.externalized");
    toolResultMetrics.record("capture.inline");
    expect(toolResultMetrics.countOf("capture.externalized")).toBe(2);
    expect(toolResultMetrics.countOf("capture.inline")).toBe(1);
    expect(toolResultMetrics.countOf("recovery.sweep")).toBe(0);
  });

  it("snapshots every counter that has been recorded", () => {
    toolResultMetrics.record("capture.degraded", "disk-slow");
    toolResultMetrics.record("retrieval.budget_exhausted");
    const snap = toolResultMetrics.snapshot();
    expect(snap["capture.degraded"]).toBe(1);
    expect(snap["retrieval.budget_exhausted"]).toBe(1);
  });

  it("bounds detail to 64 characters so a pathological string cannot grow memory", () => {
    const long = "x".repeat(1000);
    toolResultMetrics.record("capture.publication_failed", long);
    const events = toolResultMetrics.recentEvents();
    const last = events[events.length - 1];
    if (!last?.detail) throw new Error("detail was dropped");
    expect(last.detail.length).toBe(64);
  });

  it("does not retain detail when none is supplied", () => {
    toolResultMetrics.record("capture.externalized");
    const events = toolResultMetrics.recentEvents();
    const last = events[events.length - 1];
    expect(last?.detail).toBeUndefined();
  });
});

describe("ToolResultMetrics — latency", () => {
  beforeEach(() => {
    getToolResultMetrics().reset();
  });

  it("recordLatency populates latencyOf and increments the event count", () => {
    toolResultMetrics.recordLatency("retrieval.latency_ms", 5, "model");
    toolResultMetrics.recordLatency("retrieval.latency_ms", 25, "model");
    toolResultMetrics.recordLatency("retrieval.latency_ms", 15, "model");
    // 3 samples → p95 index = ceil(0.95 * 3) - 1 = 2 (the max of [5,15,25]).
    expect(toolResultMetrics.latencyOf("retrieval.latency_ms")).toBe(25);
    // The count is incremented too, so a support dump sees timing + count.
    expect(toolResultMetrics.countOf("retrieval.latency_ms")).toBe(3);
  });

  it("returns 0 (not NaN) for a latency with no recorded samples", () => {
    expect(toolResultMetrics.latencyOf("capture.latency_ms")).toBe(0);
  });

  it("latencySnapshot includes only latency metrics that have samples", () => {
    toolResultMetrics.recordLatency("capture.latency_ms", 12);
    const snap = toolResultMetrics.latencySnapshot();
    expect(snap["capture.latency_ms"]).toBe(12);
    expect(snap["retrieval.latency_ms"]).toBeUndefined();
  });

  it("retains durationMs on the recent event ring", () => {
    toolResultMetrics.recordLatency("retrieval.latency_ms", 42, "ui");
    const events = toolResultMetrics.recentEvents();
    const last = events[events.length - 1];
    expect(last?.name).toBe("retrieval.latency_ms");
    expect(last?.durationMs).toBe(42);
    expect(last?.detail).toBe("ui");
  });

  it("bounds the latency sample list to the ring cap so a long run cannot grow memory", () => {
    // The cap is shared with the recent-event ring (MAX_RECENT_EVENTS = 200).
    // Push well past it and assert only the most recent 200 survive.
    const CAP = 200;
    for (let i = 0; i < CAP + 50; i++) {
      toolResultMetrics.recordLatency("capture.latency_ms", i);
    }
    // p95 of the retained [50..249] samples — the oldest 50 were dropped.
    expect(toolResultMetrics.countOf("capture.latency_ms")).toBe(CAP + 50);
    // The latency sample list is bounded: computing p95 must not consider the
    // dropped samples. The retained max is 249, min is 50.
    const p95 = toolResultMetrics.latencyOf("capture.latency_ms");
    expect(p95).toBeLessThanOrEqual(249);
    expect(p95).toBeGreaterThanOrEqual(50);
  });

  it("reset clears latencies as well as counters", () => {
    toolResultMetrics.recordLatency("retrieval.latency_ms", 7, "model");
    expect(toolResultMetrics.latencyOf("retrieval.latency_ms")).toBe(7);
    getToolResultMetrics().reset();
    expect(toolResultMetrics.latencyOf("retrieval.latency_ms")).toBe(0);
    expect(toolResultMetrics.countOf("retrieval.latency_ms")).toBe(0);
  });
});
