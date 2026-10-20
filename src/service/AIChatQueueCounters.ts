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
  | "ai_chat_pending_deferred_total"
  | "ai_chat_steering_requested_total"
  | "ai_chat_steering_applied_total"
  | "ai_chat_steering_skipped_tools_total";

const ALL_KEYS: readonly AIChatQueueCounterKey[] = [
  "ai_chat_pending_created_total",
  "ai_chat_pending_dispatched_total",
  "ai_chat_pending_paused_total",
  "ai_chat_pending_failed_total",
  "ai_chat_pending_deferred_total",
  "ai_chat_steering_requested_total",
  "ai_chat_steering_applied_total",
  "ai_chat_steering_skipped_tools_total",
];

/** Labeled counters (e.g. rejection reason, recovery state). */
export type AIChatQueueLabelKey =
  | "ai_chat_steering_rejected_total"
  | "ai_chat_queue_recovered_total"
  | "ai_chat_workspace_submission_accepted_total"
  | "ai_chat_workspace_submission_rejected_total"
  | "ai_chat_run_terminal_total"
  | "ai_chat_workspace_projection_fallback_total";

/**
 * G03 (design §18.1): multi-label counters. Labels are bounded enum-like
 * values (dispositions, statuses, capabilities, resource classes) — never
 * prompts, file content/paths, tokens, report payloads, or image bytes.
 */
export type AIChatWorkspaceMultiLabelKey =
  | "ai_chat_run_created_total"
  | "ai_chat_workspace_action_total";

/** Plain cross-conversation rejection counter (§18.1). */
export const AI_CHAT_CROSS_CONVERSATION_REJECTED_TOTAL =
  "ai_chat_workspace_cross_conversation_event_rejected_total";

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
  | "pending_db_transaction_ms"
  | "accept_to_claim_ms"
  | "claim_to_admit_ms"
  | "admit_to_provider_ms"
  // Audit 2026-10-20 G01 (design §18.2): the remaining stage timings across
  // the capability lifecycle. The first four are main-process seams; the
  // renderer projection timing lives in the renderer's own counters
  // instance (per-process in-memory by design — design §18.3), structured
  // through the same logSnapshot channel.
  | "submit_to_acceptance_ms"
  | "permission_decision_to_resume_ms"
  | "plan_decision_to_continuation_ms"
  | "selection_request_to_transcript_ms"
  | "renderer_event_to_projection_ms";

const TIMING_KEYS: readonly AIChatQueueTimingKey[] = [
  "enqueue_to_dispatch_ms",
  "steer_click_to_boundary_ms",
  "drain_duration_ms",
  "pending_db_transaction_ms",
  "accept_to_claim_ms",
  "claim_to_admit_ms",
  "admit_to_provider_ms",
  "submit_to_acceptance_ms",
  "permission_decision_to_resume_ms",
  "plan_decision_to_continuation_ms",
  "selection_request_to_transcript_ms",
  "renderer_event_to_projection_ms",
];

/**
 * Audit 2026-10-20 G01 (design §18.1): bounded capability vocabulary for
 * `ai_chat_workspace_action_total{capability,action,outcome}`. Values are
 * stable enum-like strings — PRD §20 allows counts only, never prompts,
 * tool arguments, filenames, paths, payloads, or credentials.
 */
export type AIChatWorkspaceActionCapability =
  | "workspace"
  | "permission"
  | "plan"
  | "voice"
  | "image"
  | "report"
  | "outbound";

/**
 * SOAK / DIAGNOSTIC CONSUMPTION (audit 2026-10-20 G01): observability tests
 * (test/vitest/main/aiChatWorkspaceObservability.test.ts) assert the labels
 * and timing bounds; soak/burn-in runs consume the same data through
 * {@link logSnapshot}, which emits one structured log line with every
 * counter and timing aggregate (telemetry-only, never message content).
 */
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

  /**
   * G03 (§18.1): increment a multi-label counter, e.g.
   * `ai_chat_run_created_total{owner="interactive",resource_class="general"}`.
   * Label names/values must be bounded enums — never content. Names are
   * sorted for a deterministic composite key.
   */
  incrementWorkspace(
    key: AIChatWorkspaceMultiLabelKey,
    labels: Record<string, string>,
    amount = 1
  ): void {
    const rendered = Object.keys(labels)
      .sort()
      .map((name) => `${name}="${labels[name]}"`)
      .join(",");
    const composite = `${key}{${rendered}}`;
    this.counts.set(composite, (this.counts.get(composite) ?? 0) + amount);
  }

  /**
   * Audit 2026-10-20 G01 (§18.1): bounded capability action counter.
   * Capability values come from the {@link AIChatWorkspaceActionCapability}
   * enum; action/outcome labels must be stable short enum-like strings
   * ("ok" | "error" | "retry" | ...). Never pass prompts, tool arguments,
   * file names, paths, tokens, or payloads into any label.
   */
  recordWorkspaceAction(
    capability: AIChatWorkspaceActionCapability,
    action: string,
    outcome: string
  ): void {
    this.incrementWorkspace("ai_chat_workspace_action_total", {
      capability,
      action,
      outcome,
    });
  }

  /** G03 (§18.1): cross-conversation/stale event rejection (no labels). */
  incrementCrossConversationRejected(amount = 1): void {
    this.counts.set(
      AI_CHAT_CROSS_CONVERSATION_REJECTED_TOTAL,
      (this.counts.get(AI_CHAT_CROSS_CONVERSATION_REJECTED_TOTAL) ?? 0) +
        amount
    );
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
    for (const key of TIMING_KEYS) {
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
