import { describe, expect, it } from "vitest";
import { MessageType } from "@/entityTypes/commonType";
import type { ChatV2MessageView } from "@/entityTypes/aiChatV2Types";
import { createWorkspaceStreamPresenter } from "@/views/utils/workspaceStreamPresenter";
import { AIChatExecutionScheduler } from "@/service/AIChatExecutionScheduler";
import { buildToolExecutionGroups } from "@/views/components/aiChatWorkspace/toolExecutionProjection";

/**
 * Runnable performance guards for the workspace redesign (PRD §34.5 /
 * design §23.2). Budgets are generous ceilings that catch order-of-magnitude
 * regressions (accidental O(n²), per-token flushes) — not micro-benchmarks;
 * full app-level p95 targets are validated in the packaged-app E2E phase.
 */

function now(): number {
  return performance.now();
}

function detailEvent(
  sequence: number,
  payload: Record<string, unknown>,
  eventType = payload.eventType as string
): import("@/entityTypes/aiChatWorkspaceTypes").ChatRunDetailEvent {
  return {
    conversationId: "v2-perf",
    runId: "run-perf",
    sequence,
    emittedAt: "2026-08-21T00:00:00.000Z",
    eventType: eventType as import("@/entityTypes/aiChatWorkspaceTypes").ChatRunDetailEvent["eventType"],
    payload,
  };
}

describe("workspace performance guards (PRD §34.5)", () => {
  it("batches 10k token deltas into a bounded number of flushes", () => {
    let flushes = 0;
    const pending: Array<() => void> = [];
    const presenter = createWorkspaceStreamPresenter({
      batchMs: 50,
      scheduleFlush: (fn) => {
        flushes += 1;
        pending.push(fn);
        return () => {
          const index = pending.indexOf(fn);
          if (index >= 0) pending.splice(index, 1);
        };
      },
    });

    presenter.applyEvent(detailEvent(1, { eventType: "start", messageId: "a1" }));
    const TOKENS = 10_000;
    const start = now();
    for (let i = 0; i < TOKENS; i += 1) {
      presenter.applyEvent(
        detailEvent(i + 2, {
          eventType: "token",
          messageId: "a1",
          contentDelta: "x",
        })
      );
    }
    const applyMs = now() - start;
    for (const flush of pending.splice(0)) flush();
    const state = presenter.getState();

    // 10k tokens coalesce per window — the 8k-char early bound flushed the
    // buffer mid-stream and the tail flushed with the manual drain, so the
    // full content is applied and nothing stays buffered. Flush scheduling
    // stayed bounded (one per window/early-bound), never per token.
    expect(state.unflushedDeltaCount).toBe(0);
    expect(state.messages[0].content).toBe("x".repeat(TOKENS));
    expect(flushes).toBeGreaterThan(0);
    expect(flushes).toBeLessThan(50);
    // Generous ceiling: applying 10k events must stay well under a second.
    expect(applyMs).toBeLessThan(1000);
  });

  it("groups a 5,000-tool-pair history within budget", () => {
    const messages: ChatV2MessageView[] = [];
    for (let i = 0; i < 5_000; i += 1) {
      messages.push(
        {
          id: `call-${i}`,
          conversationId: "v2-perf",
          role: "assistant",
          content: "",
          timestamp: new Date(0).toISOString(),
          messageType: MessageType.TOOL_CALL,
          metadata: {
            source: "chat-v2",
            toolCallId: `tc-${i}`,
            toolName: "web_search",
          },
        },
        {
          id: `result-${i}`,
          conversationId: "v2-perf",
          role: "assistant",
          content: "",
          timestamp: new Date(0).toISOString(),
          messageType: MessageType.TOOL_RESULT,
          metadata: {
            source: "chat-v2",
            toolCallId: `tc-${i}`,
            toolName: "web_search",
            toolResult: { success: true },
            toolResultSummary: "ok",
          },
        }
      );
    }
    const start = now();
    const groups = buildToolExecutionGroups(messages);
    const elapsed = now() - start;

    // All pairs collapse to ONE row each (no duplicate generic cards).
    const rows = groups.reduce((acc, g) => acc + g.executions.length, 0);
    expect(rows).toBe(5_000);
    // O(n) grouping on 5k pairs must complete quickly (catches O(n²) drift).
    expect(elapsed).toBeLessThan(2000);
  });

  it("sustains 1,000-run scheduler churn within budget", () => {
    const scheduler = new AIChatExecutionScheduler();
    let completions = 0;
    const start = now();
    for (let round = 0; round < 100; round += 1) {
      for (let i = 0; i < 10; i += 1) {
        scheduler.submit({
          runId: `r-${round}-${i}`,
          conversationId: `c-${round}-${i}`,
          owner: "interactive",
        });
      }
      const dispatchedThisRound: string[] = [];
      scheduler.pump((d) => dispatchedThisRound.push(d.runId));
      for (const runId of dispatchedThisRound) {
        scheduler.complete(runId);
        completions += 1;
      }
    }
    const elapsed = now() - start;

    expect(completions).toBe(300);
    // Remaining 700 stay queued without pathological re-scan cost.
    expect(scheduler.queueDepth()).toBe(700);
    expect(elapsed).toBeLessThan(1000);
  });

  it("holds the anti-starvation aging bound at queue scale", () => {
    let clock = 1_000_000;
    const scheduler = new AIChatExecutionScheduler({
      agingStepMs: 10_000,
      now: () => clock,
    });
    // A scheduled run ages while fresh interactive work keeps arriving.
    scheduler.submit({
      runId: "old-scheduled",
      conversationId: "c-s",
      owner: "scheduled",
    });
    clock += 10_000 * 50; // long wait
    for (let i = 0; i < 500; i += 1) {
      scheduler.submit({
        runId: `fresh-${i}`,
        conversationId: `c-${i}`,
        owner: "interactive",
      });
    }
    const dispatched: string[] = [];
    scheduler.pump((d) => dispatched.push(d.runId));

    // The aged scheduled run must be chosen FIRST despite 500 fresh runs.
    expect(dispatched[0]).toBe("old-scheduled");
  });
});
