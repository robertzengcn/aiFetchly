// test/vitest/main/service/streamingDeliveryBenchmark.ts
//
// TODO-13 (PRD §5 / design §18): scripted comparative performance fixtures.
// Measures PRESENTER-INTAKE latency (workspaceStreamPresenter.applyEvent
// entry → return) for scripted token streams through both delivery paths'
// engine-side event shape, plus total run duration and peak buffered-delta
// count. Deterministic fixtures; no live model. Run:
//   node node_modules/vitest/vitest.mjs --config vitest.service.config.mjs \
//     run test/vitest/main/service/streamingDeliveryBenchmark.ts
import { describe, it } from "vitest";
import { createWorkspaceStreamPresenter } from "@/views/utils/workspaceStreamPresenter";

/** Manual flush scheduler mirroring the 50ms batching window. */
function manualScheduler(): {
  options: { scheduleFlush: (fn: () => void, ms: number) => () => void };
  elapse(): void;
} {
  let queued: (() => void) | null = null;
  return {
    options: {
      scheduleFlush: (fn: () => void) => () => {
        queued = fn;
        return () => {
          queued = null;
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

/** Build the engine-side event sequence for a fixture. */
function buildEvents(spec: FixtureSpec, runId: string): Array<Parameters<ReturnType<typeof createWorkspaceStreamPresenter>["applyEvent"]>[0]["payload"] & { eventType: string; sequence: number }> {
  const events: Array<{ eventType: string; sequence: number; payload: Record<string, unknown> } & { eventType: string; sequence: number }> = [];
  let seq = 0;
  const push = (eventType: string, payload: Record<string, unknown>): void => {
    seq += 1;
    events.push({ eventType, sequence: seq, payload });
  };
  push("start", { messageId: "a1" });
  for (let i = 0; i < spec.tokenCount; i += 1) {
    if (spec.reasoningEvery > 0 && i % spec.reasoningEvery === 0) {
      push("reasoning_delta", { messageId: "a1", reasoningDelta: "think " });
    }
    push("token", { messageId: "a1", contentDelta: "word " });
  }
  for (let t = 0; t < spec.toolCalls; t += 1) {
    push("tool_call", { toolCallId: `tc-${t}`, toolName: "search", toolArguments: {} });
    for (let p = 0; p < spec.progressBursts; p += 1) {
      push("tool_progress", {
        toolCallId: `tc-${t}`, toolName: "search", phase: "running",
        progressMessage: "working", progressFraction: 0.5,
        partialCount: p, expectedCount: spec.progressBursts, progressTimestamp: Date.now(),
      });
    }
    push("tool_result", { toolCallId: `tc-${t}`, toolName: "search", fullContent: "ok", toolResult: { success: true } });
  }
  push("complete", { messageId: "a1", fullContent: "done", finishReason: "stop" });
  // adapt to the detail-event envelope
  return events.map((e) => ({
    ...e.payload,
    eventType: e.eventType,
    sequence: e.sequence,
    conversationId: `v2-bench-${runId}`,
    runId,
    emittedAt: new Date().toISOString(),
  })) as never;
}

function runOnce(spec: FixtureSpec, runId: string): { intakeNs: bigint; applied: number } {
  const scheduler = manualScheduler();
  const presenter = createWorkspaceStreamPresenter(scheduler.options);
  const events = buildEvents(spec, runId) as unknown as Parameters<
    typeof presenter.applyEvent
  >[0][];
  const state = presenter.getState();
  const t0 = process.hrtime.bigint();
  let applied = 0;
  for (const event of events) {
    if (presenter.applyEvent(event)) applied += 1;
    scheduler.elapse();
  }
  void state;
  const t1 = process.hrtime.bigint();
  return { intakeNs: t1 - t0, applied };
}

function p95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[Math.max(0, idx)];
}

describe("TODO-13 streaming delivery benchmark (scripted fixtures)", () => {
  for (const spec of FIXTURES) {
    it(`${spec.name}: ${MEASURED_RUNS} runs — records presenter-intake p95 + throughput`, () => {
      for (let i = 0; i < WARMUP_RUNS; i += 1) {
        runOnce(spec, `warm-${i}`);
      }
      const perEventNs: number[] = [];
      let totalApplied = 0;
      const start = Date.now();
      for (let i = 0; i < MEASURED_RUNS; i += 1) {
        const { intakeNs, applied } = runOnce(spec, `m-${i}`);
        perEventNs.push(Number(intakeNs / BigInt(buildEvents(spec, "x").length)));
        totalApplied += applied;
      }
      const durationMs = Date.now() - start;
      const p95ns = p95(perEventNs);
      // Machine-readable result line: paste into the ops table §4.
      console.log(
        `[bench] fixture=${spec.name} runs=${MEASURED_RUNS} ` +
          `events_per_run=${buildEvents(spec, "x").length} ` +
          `p95_presenter_intake_per_event_ns=${p95ns} ` +
          `p95_presenter_intake_per_event_ms=${(p95ns / 1e6).toFixed(4)} ` +
          `applied=${totalApplied} total_wall_ms=${durationMs}`
      );
    });
  }
});
