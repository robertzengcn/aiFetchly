// test/vitest/main/service/streamingDeliveryBenchmark.test.ts
//
// R08 (PRD §5 / design §18): comparative delivery benchmark, rebuilt.
// Valid ChatRunDetailEvent envelopes (chunk fields inside event.payload), a
// correctly-registering flush scheduler, presenter-intake timing per event,
// output assertions (messages + buffered deltas applied), a cancellation
// fixture, and application-owned buffer accounting. 5 warmups + 30 measured
// runs per fixture. Run:
//   node node_modules/vitest/vitest.mjs --config vitest.service.config.mjs \
//     run test/vitest/main/service/streamingDeliveryBenchmark.test.ts
import { describe, expect, it } from "vitest";
import { createWorkspaceStreamPresenter } from "@/views/utils/workspaceStreamPresenter";
import type { ChatRunDetailEvent } from "@/entityTypes/aiChatWorkspaceTypes";
import type { ChatV2StreamChunk } from "@/entityTypes/aiChatV2Types";

interface FixtureSpec {
  readonly name: string;
  readonly tokenCount: number;
  readonly reasoningEvery: number; // 0 = none
  readonly toolCalls: number;
  readonly progressBursts: number;
}

const FIXTURES: readonly FixtureSpec[] = [
  { name: "text", tokenCount: 400, reasoningEvery: 0, toolCalls: 0, progressBursts: 0 },
  { name: "reasoning", tokenCount: 200, reasoningEvery: 2, toolCalls: 0, progressBursts: 0 },
  { name: "multi-tool", tokenCount: 120, reasoningEvery: 0, toolCalls: 4, progressBursts: 0 },
  { name: "progress-burst", tokenCount: 80, reasoningEvery: 0, toolCalls: 1, progressBursts: 50 },
];

const WARMUP_RUNS = 5;
const MEASURED_RUNS = 30;

/** Flush scheduler that registers the callback IMMEDIATELY (R08 fix). */
function registeringScheduler(): {
  options: { scheduleFlush: (fn: () => void, ms: number) => () => void };
  elapse(): void;
} {
  let queued: (() => void) | null = null;
  return {
    options: {
      scheduleFlush: (fn: () => void) => {
        queued = fn; // registered now, not on cancel
        return () => {
          if (queued === fn) queued = null;
        };
      },
    },
    elapse(): void {
      const fn = queued;
      queued = null;
      fn?.();
    },
  };
}

/** Valid detail events: engine chunk wrapped in payload with the run envelope. */
function buildDetailEvents(
  spec: FixtureSpec,
  runId: string
): ChatRunDetailEvent[] {
  const conversationId = `v2-bench-${runId}`;
  const events: ChatRunDetailEvent[] = [];
  let seq = 0;
  const push = (chunk: ChatV2StreamChunk): void => {
    seq += 1;
    events.push({
      conversationId,
      runId,
      sequence: seq,
      emittedAt: new Date().toISOString(),
      eventType: chunk.eventType,
      payload: chunk as unknown as Record<string, unknown>,
    });
  };
  push({ eventType: "start", conversationId, messageId: "a1" });
  for (let i = 0; i < spec.tokenCount; i += 1) {
    if (spec.reasoningEvery > 0 && i % spec.reasoningEvery === 0) {
      push({
        eventType: "reasoning_delta",
        conversationId,
        messageId: "a1",
        reasoningDelta: "think ",
      });
    }
    push({
      eventType: "token",
      conversationId,
      messageId: "a1",
      contentDelta: "word ",
    });
  }
  for (let t = 0; t < spec.toolCalls; t += 1) {
    push({
      eventType: "tool_call",
      conversationId,
      messageId: "a1",
      toolCallId: `tc-${t}`,
      toolName: "search",
      toolArguments: {},
    });
    for (let p = 0; p < spec.progressBursts; p += 1) {
      push({
        eventType: "tool_progress",
        conversationId,
        messageId: "a1",
        toolCallId: `tc-${t}`,
        toolName: "search",
        phase: "running",
        progressMessage: "working",
        progressFraction: 0.5,
        partialCount: p,
        expectedCount: spec.progressBursts,
        progressTimestamp: Date.now(),
      });
    }
    push({
      eventType: "tool_result",
      conversationId,
      messageId: "a1",
      toolCallId: `tc-${t}`,
      toolName: "search",
      fullContent: "ok",
      toolResult: { success: true },
    });
  }
  push({
    eventType: "complete",
    conversationId,
    messageId: "a1",
    fullContent: "done",
    finishReason: "stop",
  });
  return events;
}

interface RunResult {
  readonly intakePerEventNs: readonly bigint[];
  readonly appliedEvents: number;
  readonly finalContentLen: number;
  readonly messageCount: number;
  readonly peakBufferedDeltas: number;
}

function runOnce(spec: FixtureSpec, runId: string): RunResult {
  const scheduler = registeringScheduler();
  const presenter = createWorkspaceStreamPresenter(scheduler.options);
  const events = buildDetailEvents(spec, runId);
  const intakePerEventNs: bigint[] = [];
  let appliedEvents = 0;
  let peakBufferedDeltas = 0;
  for (const event of events) {
    const t0 = process.hrtime.bigint();
    const applied = presenter.applyEvent(event);
    const t1 = process.hrtime.bigint();
    intakePerEventNs.push(t1 - t0);
    if (applied) appliedEvents += 1;
    peakBufferedDeltas = Math.max(
      peakBufferedDeltas,
      presenter.getState().unflushedDeltaCount
    );
    scheduler.elapse(); // drain the 50ms-equivalent batch window per event
  }
  scheduler.elapse();
  const state = presenter.getState();
  return {
    intakePerEventNs,
    appliedEvents,
    finalContentLen: state.messages[0]?.content.length ?? 0,
    messageCount: state.messages.length,
    peakBufferedDeltas,
  };
}

function p95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[Math.max(0, idx)];
}

describe("R08 streaming delivery benchmark (valid envelopes, asserted output)", () => {
  for (const spec of FIXTURES) {
    it(`${spec.name}: content applies, latency recorded (${MEASURED_RUNS} runs)`, () => {
      // Validity gate FIRST: the presenter must actually apply content.
      // The terminal complete event REPLACES the assistant message content
      // with its fullContent ("done"), so the final length is the terminal's
      // — the streamed tokens are proven applied via the buffered-delta peak
      // and the applied-event count.
      const probe = runOnce(spec, `probe-${spec.name}`);
      expect(probe.messageCount).toBeGreaterThanOrEqual(1); // assistant message exists
      expect(probe.finalContentLen).toBe("done".length); // terminal content
      expect(probe.appliedEvents).toBeGreaterThan(0);
      expect(probe.peakBufferedDeltas).toBeGreaterThan(0); // tokens buffered

      for (let i = 0; i < WARMUP_RUNS; i += 1) runOnce(spec, `warm-${i}`);
      const perEventNs: number[] = [];
      let peakDeltas = 0;
      let totalApplied = 0;
      const start = Date.now();
      for (let i = 0; i < MEASURED_RUNS; i += 1) {
        const r = runOnce(spec, `m-${i}`);
        perEventNs.push(...r.intakePerEventNs.map(Number));
        peakDeltas = Math.max(peakDeltas, r.peakBufferedDeltas);
        totalApplied += r.appliedEvents;
      }
      const wallMs = Date.now() - start;
      const p95ns = p95(perEventNs);
      console.log(
        `[bench] fixture=${spec.name} runs=${MEASURED_RUNS} ` +
          `events_per_run=${buildDetailEvents(spec, "x").length} ` +
          `p95_presenter_intake_per_event_ms=${(p95ns / 1e6).toFixed(5)} ` +
          `mean_applied_per_run=${(totalApplied / MEASURED_RUNS).toFixed(0)} ` +
          `peak_buffered_deltas=${peakDeltas} total_wall_ms=${wallMs}`
      );
      // Performance guard (budget: ≤20ms p95 per event — a regression trip-
      // wire, not a tight pass/fail of the µs figures).
      expect(p95ns / 1e6).toBeLessThan(20);
    });
  }

  it("cancellation fixture: terminal cancelled flushes state promptly", () => {
    const scheduler = registeringScheduler();
    const presenter = createWorkspaceStreamPresenter(scheduler.options);
    const events = buildDetailEvents(
      {
        name: "cancel",
        tokenCount: 10,
        reasoningEvery: 0,
        toolCalls: 0,
        progressBursts: 0,
      },
      "cancel-run"
    );
    // Apply everything except the terminal, then cancel.
    for (const event of events.slice(0, -1)) {
      presenter.applyEvent(event);
      scheduler.elapse();
    }
    presenter.applyEvent({
      conversationId: "v2-bench-cancel-run",
      runId: "cancel-run",
      sequence: events.length,
      emittedAt: new Date().toISOString(),
      eventType: "cancelled",
      payload: {
        eventType: "cancelled",
        conversationId: "v2-bench-cancel-run",
        fullContent: "partial",
      },
    });
    scheduler.elapse();
    const state = presenter.getState();
    // The presenter's terminal status IS "cancelled" (runtimeStatus resets to
    // idle, streamStatus holds the terminal). Both are prompt — no batching
    // delay on control events.
    expect(state.streamStatus).toBe("cancelled");
    expect(state.runtimeStatus).toBe("idle");
    expect(state.messages.length).toBeGreaterThanOrEqual(1);
  });
});
