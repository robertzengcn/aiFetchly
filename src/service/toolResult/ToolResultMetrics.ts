/**
 * Bounded, in-process counters for preserved outputs (technical design §12.3).
 *
 * The design's requirement is that operators can ANSWER questions like "how
 * often does capture degrade?", "is the per-turn allowance actually being hit?",
 * and "do users hit the artifact ceiling?". Those are all counting questions,
 * and the answers were previously spread across `console.log` calls that
 * cannot be aggregated.
 *
 * Deliberately simple and allocation-free on the hot path: fixed-capacity
 * buckets, integer counters, no per-event objects retained. A bounded ring of
 * recent events is kept so a support session can show what just happened
 * without persisting anything.
 *
 * This is deliberately NOT a crash reporter and sends nothing off-device.
 */

/** One recorded event category. */
export type ToolResultMetricName =
  | "capture.inline"
  | "capture.externalized"
  | "capture.degraded"
  | "capture.quota_refused"
  | "capture.disk_full"
  | "capture.publication_failed"
  | "capture.integrity_failed"
  | "capture.latency_ms"
  | "retrieval.read"
  | "retrieval.search"
  | "retrieval.budget_exhausted"
  | "retrieval.invalid_cursor"
  | "retrieval.latency_ms"
  | "recovery.sweep"
  | "budget.reduced"
  | "budget.body_rejected";

/** A recent event, retained in a bounded ring for support inspection. */
export interface ToolResultMetricEvent {
  readonly name: ToolResultMetricName;
  /** Monotonic milliseconds; never a wall-clock date the user could read. */
  readonly at: number;
  /** Optional bounded context, e.g. the storage backend or failure code. */
  readonly detail?: string;
  /**
   * Observed duration in milliseconds for a latency event (`*.latency_ms`);
   * absent for pure counters. Kept separate from `detail` so it is never
   * truncated as a string and can feed a numeric p95.
   */
  readonly durationMs?: number;
}

/** Recent events retained before the oldest is dropped. */
const MAX_RECENT_EVENTS = 200;

class ToolResultMetrics {
  private readonly counts = new Map<ToolResultMetricName, number>();
  private readonly recent: ToolResultMetricEvent[] = [];
  /**
   * Observed durations per latency name, kept in arrival order. The same ring
   * bound as `recent` applies — a long-running process never accumulates an
   * unbounded latency sample list. p95 is computed on demand from this list.
   */
  private readonly latencies = new Map<ToolResultMetricName, number[]>();

  /** Record one event. Never throws; metrics must not break a turn. */
  record(name: ToolResultMetricName, detail?: string): void {
    try {
      this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
      this.recent.push({
        name,
        at: Date.now(),
        // Bounded so a pathological detail string cannot grow memory.
        ...(detail ? { detail: detail.slice(0, 64) } : {}),
      });
      if (this.recent.length > MAX_RECENT_EVENTS) {
        this.recent.splice(0, this.recent.length - MAX_RECENT_EVENTS);
      }
    } catch {
      // A metrics failure must never propagate into execution.
    }
  }

  /**
   * Record one observed duration for a latency metric (`*.latency_ms`). The
   * duration also increments the event count and pushes a ring entry so a
   * support session sees the timing alongside the other recent events. Never
   * throws; metrics must not break a turn. `detail` is bounded to 64 chars
   * and is the only place user content could appear — it must stay
   * content-free (e.g. `"model"` vs `"ui"`, never a path or payload).
   */
  recordLatency(
    name: Extract<ToolResultMetricName, `${string}.latency_ms`>,
    durationMs: number,
    detail?: string
  ): void {
    try {
      this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
      const samples = this.latencies.get(name) ?? [];
      samples.push(durationMs);
      if (samples.length > MAX_RECENT_EVENTS) {
        samples.splice(0, samples.length - MAX_RECENT_EVENTS);
      }
      this.latencies.set(name, samples);
      this.recent.push({
        name,
        at: Date.now(),
        durationMs,
        ...(detail ? { detail: detail.slice(0, 64) } : {}),
      });
      if (this.recent.length > MAX_RECENT_EVENTS) {
        this.recent.splice(0, this.recent.length - MAX_RECENT_EVENTS);
      }
    } catch {
      // A metrics failure must never propagate into execution.
    }
  }

  /** Count for one event, or 0 when never recorded. */
  countOf(name: ToolResultMetricName): number {
    return this.counts.get(name) ?? 0;
  }

  /**
   * p95 latency in ms for a latency metric, or 0 when none recorded. Computed
   * on demand from the retained samples so a support dump can answer "how
   * slow is the slow tail?" (NFR-04 first-page p95 ≤ 200 ms) without the
   * metrics object storing a running histogram.
   */
  latencyOf(name: ToolResultMetricName): number {
    const samples = this.latencies.get(name);
    if (!samples || samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
  }

  /** Every counter, for a support dump. */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts.entries());
  }

  /**
   * Latency p95 per latency metric, for a support dump. Keys are the latency
   * metric names; absent when no latency has been recorded for a name.
   */
  latencySnapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name] of this.latencies) {
      out[name] = this.latencyOf(name);
    }
    return out;
  }

  /** The retained ring, oldest first. */
  recentEvents(): readonly ToolResultMetricEvent[] {
    return [...this.recent];
  }

  /** Reset for tests. */
  reset(): void {
    this.counts.clear();
    this.recent.length = 0;
    this.latencies.clear();
  }
}

/** Process-wide metrics singleton. */
export const toolResultMetrics = new ToolResultMetrics();

/** Test seam so a suite can inject an isolated instance. */
export function getToolResultMetrics(): ToolResultMetrics {
  return toolResultMetrics;
}