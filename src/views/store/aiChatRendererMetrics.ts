/**
 * Renderer-realm observability for the workspace chat projection
 * (audit 2026-10-20 G01; design §18.2 "renderer event receipt to projected
 * UI state" and §18.3 logging rules). The main-process counters singleton
 * lives in the main bundle, so the renderer keeps its own per-process
 * in-memory aggregates with the same bounded-label rules: counts, reason
 * codes, and durations only — never prompt text, tool content, file names,
 * paths, or credentials.
 *
 * Soak consumption: tests/soak renderers read `aiChatRendererMetricsSnapshot()`
 * and the bounded aggregates join the same structured telemetry line as the
 * main-process `AIChatQueueCounters.logSnapshot()` output.
 */

const timingAggregates = new Map<
  "renderer_event_to_projection_ms",
  { count: number; totalMs: number; minMs: number; maxMs: number }
>();

const counts = new Map<string, number>();

interface RendererTimingSnapshot {
  count: number;
  meanMs: number;
  minMs: number;
  maxMs: number;
}

/** Record one event-application duration in the renderer (bounded key). */
export function observeRendererProjectionTiming(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  const current = timingAggregates.get("renderer_event_to_projection_ms") ?? {
    count: 0,
    totalMs: 0,
    minMs: durationMs,
    maxMs: durationMs,
  };
  timingAggregates.set("renderer_event_to_projection_ms", {
    count: current.count + 1,
    totalMs: current.totalMs + durationMs,
    minMs: Math.min(current.minMs, durationMs),
    maxMs: Math.max(current.maxMs, durationMs),
  });
}

/**
 * Audit R2 G01 (projection completion boundary): buffered delta events do
 * not complete their projection when the presenter schedules the flush —
 * the projection lands when the batched flush runs (or aborts with the
 * buffer discarded). The window API brackets that boundary:
 * `begin` opens one pending window at event receipt, `end` closes it after
 * the flush and records the full receipt → projected-UI duration, and
 * `cancel` drops it without a sample (unconsumed event / selection switch
 * discarding the buffer).
 */
let projectionWindowStartMs: number | null = null;

export function beginRendererProjectionWindow(): void {
  if (projectionWindowStartMs !== null) return;
  projectionWindowStartMs = performance.now();
}

export function endRendererProjectionWindow(): void {
  if (projectionWindowStartMs === null) return;
  const startedAt = projectionWindowStartMs;
  projectionWindowStartMs = null;
  observeRendererProjectionTiming(performance.now() - startedAt);
}

export function cancelRendererProjectionWindow(): void {
  projectionWindowStartMs = null;
}

/** Increment a bounded label counter (never report content). */
export function incrementRendererMetric(label: string, amount = 1): void {
  if (!/^[a-z0-9_:.-]{1,80}$/.test(label)) {
    incrementRendererMetric("label_invalid");
    return;
  }
  counts.set(label, (counts.get(label) ?? 0) + amount);
}

/** Bounded snapshot for soak/test consumption. */
export function aiChatRendererMetricsSnapshot(): {
  timings: Record<string, RendererTimingSnapshot | undefined>;
  counts: Record<string, number>;
} {
  return {
    timings: {
      renderer_event_to_projection_ms: (() => {
        const aggregate = timingAggregates.get(
          "renderer_event_to_projection_ms"
        );
        return aggregate
          ? {
              count: aggregate.count,
              meanMs: Math.round(aggregate.totalMs / aggregate.count),
              minMs: aggregate.minMs,
              maxMs: aggregate.maxMs,
            }
          : undefined;
      })(),
    },
    counts: Object.fromEntries(counts),
  };
}

/** Test isolation. */
export function resetRendererMetricsForTest(): void {
  timingAggregates.clear();
  counts.clear();
  projectionWindowStartMs = null;
}
