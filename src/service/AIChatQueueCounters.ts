import { log } from "@/modules/Logger";

/**
 * AIChatQueueCounters — process-wide, in-memory cumulative metrics for the
 * pending-message queue and steering (message-queue technical design §19.2).
 *
 * Counters carry no message content, attachment bytes, or tool arguments —
 * only totals, reason codes, and durations (PRD §15). They start as
 * in-memory counters plus structured logs and can later move into
 * application diagnostics.
 *
 * Singleton: import `aiChatQueueCounters`.
 */

export type AIChatQueueCounterKey =
  | "ai_chat_pending_created_total"
  | "ai_chat_pending_dispatched_total"
  | "ai_chat_pending_paused_total"
  | "ai_chat_pending_failed_total"
  | "ai_chat_steering_requested_total"
  | "ai_chat_steering_applied_total"
  | "ai_chat_steering_skipped_tools_total";

const ALL_KEYS: readonly AIChatQueueCounterKey[] = [
  "ai_chat_pending_created_total",
  "ai_chat_pending_dispatched_total",
  "ai_chat_pending_paused_total",
  "ai_chat_pending_failed_total",
  "ai_chat_steering_requested_total",
  "ai_chat_steering_applied_total",
  "ai_chat_steering_skipped_tools_total",
];

/** Labeled counters (e.g. rejection reason, recovery state). */
export type AIChatQueueLabelKey =
  | "ai_chat_steering_rejected_total"
  | "ai_chat_queue_recovered_total";

export type AIChatQueueCounterSnapshot = Record<AIChatQueueCounterKey, number> &
  Partial<Record<string, number>>;

/** Observed timing sample (ms), aggregated into min/mean/max. */
interface TimingAggregate {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
}

export type AIChatQueueTimingKey =
  | "enqueue_to_dispatch_ms"
  | "steer_click_to_boundary_ms"
  | "drain_duration_ms"
  | "pending_db_transaction_ms";

class AIChatQueueCountersImpl {
  private readonly counts = new Map<string, number>();
  private readonly timings = new Map<AIChatQueueTimingKey, TimingAggregate>();

  increment(key: AIChatQueueCounterKey, amount = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + amount);
  }

  /** Increment a labeled counter, e.g. rejection reason or recovery state. */
  incrementLabeled(
    key: AIChatQueueLabelKey,
    label: string,
    amount = 1
  ): void {
    const composite = `${key}{reason="${label}"}`;
    this.counts.set(composite, (this.counts.get(composite) ?? 0) + amount);
  }

  get(key: AIChatQueueCounterKey | string): number {
    return this.counts.get(key) ?? 0;
  }

  /** Record one duration sample (design §19.3 timings). */
  observeTiming(key: AIChatQueueTimingKey, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    const current = this.timings.get(key) ?? {
      count: 0,
      totalMs: 0,
      minMs: durationMs,
      maxMs: durationMs,
    };
    this.timings.set(key, {
      count: current.count + 1,
      totalMs: current.totalMs + durationMs,
      minMs: Math.min(current.minMs, durationMs),
      maxMs: Math.max(current.maxMs, durationMs),
    });
  }

  snapshot(): AIChatQueueCounterSnapshot {
    const out = {} as AIChatQueueCounterSnapshot;
    for (const key of ALL_KEYS) {
      out[key] = this.counts.get(key) ?? 0;
    }
    for (const [key, value] of this.counts) {
      if (!ALL_KEYS.includes(key as AIChatQueueCounterKey)) {
        out[key] = value;
      }
    }
    return out;
  }

  timingSnapshot(): Record<
    AIChatQueueTimingKey,
    { count: number; meanMs: number; minMs: number; maxMs: number } | undefined
  > {
    const out = {} as Record<
      AIChatQueueTimingKey,
      { count: number; meanMs: number; minMs: number; maxMs: number }
      | undefined
    >;
    for (const key of [
      "enqueue_to_dispatch_ms",
      "steer_click_to_boundary_ms",
      "drain_duration_ms",
      "pending_db_transaction_ms",
    ] as const) {
      const aggregate = this.timings.get(key);
      out[key] = aggregate
        ? {
            count: aggregate.count,
            meanMs: Math.round(aggregate.totalMs / aggregate.count),
            minMs: aggregate.minMs,
            maxMs: aggregate.maxMs,
          }
        : undefined;
    }
    return out;
  }

  reset(): void {
    this.counts.clear();
    this.timings.clear();
  }

  /** Emit one structured log line with current totals (no message content). */
  logSnapshot(): void {
    const counters = this.snapshot();
    const timings = this.timingSnapshot();
    log.info(
      `[ai-chat-queue] metrics counters=${JSON.stringify(counters)} timings=${JSON.stringify(timings)}`
    );
  }
}

export const aiChatQueueCounters = new AIChatQueueCountersImpl();
