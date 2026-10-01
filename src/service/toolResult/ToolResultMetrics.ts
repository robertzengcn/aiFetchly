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
  | "retrieval.read"
  | "retrieval.search"
  | "retrieval.budget_exhausted"
  | "retrieval.invalid_cursor"
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
}

/** Recent events retained before the oldest is dropped. */
const MAX_RECENT_EVENTS = 200;

class ToolResultMetrics {
  private readonly counts = new Map<ToolResultMetricName, number>();
  private readonly recent: ToolResultMetricEvent[] = [];

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

  /** Count for one event, or 0 when never recorded. */
  countOf(name: ToolResultMetricName): number {
    return this.counts.get(name) ?? 0;
  }

  /** Every counter, for a support dump. */
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts.entries());
  }

  /** The retained ring, oldest first. */
  recentEvents(): readonly ToolResultMetricEvent[] {
    return [...this.recent];
  }

  /** Reset for tests. */
  reset(): void {
    this.counts.clear();
    this.recent.length = 0;
  }
}

/** Process-wide metrics singleton. */
export const toolResultMetrics = new ToolResultMetrics();

/** Test seam so a suite can inject an isolated instance. */
export function getToolResultMetrics(): ToolResultMetrics {
  return toolResultMetrics;
}