import { describe, expect, it, beforeEach } from "vitest";
import {
  aiChatQueueCounters,
  type AIChatQueueCounterKey,
} from "@/service/AIChatQueueCounters";

/**
 * Observability counters for the pending-message queue and steering
 * (technical design §19.2/§19.3): totals, labeled rejections/recoveries,
 * and min/mean/max timing aggregates — never message content.
 */

const PLAIN_KEYS: readonly AIChatQueueCounterKey[] = [
  "ai_chat_pending_created_total",
  "ai_chat_pending_dispatched_total",
  "ai_chat_pending_paused_total",
  "ai_chat_pending_failed_total",
  "ai_chat_steering_requested_total",
  "ai_chat_steering_applied_total",
  "ai_chat_steering_skipped_tools_total",
];

beforeEach(() => {
  aiChatQueueCounters.reset();
});

describe("aiChatQueueCounters", () => {
  it("increments each §19.2 counter and snapshots all keys at zero-default", () => {
    const snapshot = aiChatQueueCounters.snapshot();
    for (const key of PLAIN_KEYS) {
      expect(snapshot[key]).toBe(0);
    }
    for (const key of PLAIN_KEYS) {
      aiChatQueueCounters.increment(key);
    }
    const next = aiChatQueueCounters.snapshot();
    for (const key of PLAIN_KEYS) {
      expect(next[key]).toBe(1);
    }
  });

  it("increments by amounts (skipped tool batches)", () => {
    aiChatQueueCounters.increment("ai_chat_steering_skipped_tools_total", 3);
    expect(aiChatQueueCounters.get("ai_chat_steering_skipped_tools_total")).toBe(
      3
    );
  });

  it("tracks labeled rejection reasons and recovery states separately", () => {
    aiChatQueueCounters.incrementLabeled(
      "ai_chat_steering_rejected_total",
      "turn_not_running"
    );
    aiChatQueueCounters.incrementLabeled(
      "ai_chat_steering_rejected_total",
      "turn_not_running"
    );
    aiChatQueueCounters.incrementLabeled(
      "ai_chat_steering_rejected_total",
      "turn_finished_first"
    );
    aiChatQueueCounters.incrementLabeled(
      "ai_chat_queue_recovered_total",
      "queued"
    );

    const snapshot = aiChatQueueCounters.snapshot();
    expect(
      snapshot['ai_chat_steering_rejected_total{reason="turn_not_running"}']
    ).toBe(2);
    expect(
      snapshot['ai_chat_steering_rejected_total{reason="turn_finished_first"}']
    ).toBe(1);
    expect(snapshot['ai_chat_queue_recovered_total{reason="queued"}']).toBe(1);
  });

  it("aggregates timings into count/mean/min/max and ignores bad samples", () => {
    aiChatQueueCounters.observeTiming("enqueue_to_dispatch_ms", 100);
    aiChatQueueCounters.observeTiming("enqueue_to_dispatch_ms", 300);
    aiChatQueueCounters.observeTiming("enqueue_to_dispatch_ms", -5); // ignored
    aiChatQueueCounters.observeTiming("enqueue_to_dispatch_ms", NaN); // ignored

    const timings = aiChatQueueCounters.timingSnapshot();
    expect(timings.enqueue_to_dispatch_ms).toEqual({
      count: 2,
      meanMs: 200,
      minMs: 100,
      maxMs: 300,
    });
    expect(timings.steer_click_to_boundary_ms).toBeUndefined();
  });

  it("reset clears counters and timings", () => {
    aiChatQueueCounters.increment("ai_chat_pending_created_total");
    aiChatQueueCounters.observeTiming("drain_duration_ms", 50);
    aiChatQueueCounters.reset();
    expect(aiChatQueueCounters.get("ai_chat_pending_created_total")).toBe(0);
    expect(aiChatQueueCounters.timingSnapshot().drain_duration_ms).toBeUndefined();
  });
});
