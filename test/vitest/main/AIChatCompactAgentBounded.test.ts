/**
 * Bounded-compaction routing tests for AIChatCompactAgentService
 * (PRD FR-07/FR-08; design §15/§18 rollback).
 *
 * Disabling new publication must never restore the unbounded all-history
 * summarization algorithm: without a coordinator, runFullCompact falls back
 * to a budget-checked legacy summary over a bounded recent window (preflighted,
 * output-capped, no generation published) instead of sending the entire
 * archive in one request.
 */
import { describe, it, expect, vi } from "vitest";
import { AIChatCompactAgentService } from "@/service/AIChatCompactAgentService";
import { AIChatV2Module } from "@/modules/AIChatV2Module";

describe("AIChatCompactAgentService bounded routing", () => {
  it("falls back to a bounded legacy summary when no coordinator is wired (M-5)", async () => {
    const completeChat = vi.fn().mockResolvedValue({
      id: "legacy-1",
      object: "chat.completion",
      created: 0,
      model: "test",
      choices: [
        { index: 0, message: { role: "assistant", content: "legacy summary" }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
    vi.spyOn(AIChatV2Module.prototype, "getRecentMessages").mockResolvedValueOnce([
      { role: "user", content: "hi", messageId: "m1" },
      { role: "assistant", content: "hello", messageId: "m2" },
    ] as never);
    const svc = new AIChatCompactAgentService({} as never, {
      completeChat,
      isEnabled: () => true,
    });
    const view = await svc.runFullCompact({ conversationId: "v2-nocoord" });
    expect(view.status).toBe("active");
    expect(completeChat).toHaveBeenCalledTimes(1);
    const req = completeChat.mock.calls[0][0] as {
      max_tokens: number;
      messages: Array<{ content: string }>;
    };
    expect(req.max_tokens).toBeLessThanOrEqual(1_500);
    expect(req.messages).toHaveLength(2);
    expect(JSON.stringify(req.messages).length).toBeLessThanOrEqual(30_000);
  });

  it("delegates to the bounded coordinator when wired", async () => {
    const completeChat = vi.fn();
    const coordinator = {
      requestCompaction: vi.fn().mockResolvedValue({
        state: "completed",
        generationId: "gen-1",
        sectionsPacked: 2,
        runId: "run-1",
      }),
    };
    const svc = new AIChatCompactAgentService({} as never, {
      completeChat,
      isEnabled: () => true,
      compactionCoordinator: coordinator as never,
    });
    const view = await svc.runFullCompact({ conversationId: "v2-deleg" });
    expect(coordinator.requestCompaction).toHaveBeenCalledTimes(1);
    expect(view.status).toBe("active");
    // Bounded path: the agent never constructs an all-history provider call
    // itself — the coordinator owns every summarization request.
    expect(completeChat).not.toHaveBeenCalled();
  });

  it.each([
    ["paused", "paused"],
    ["joined", "joined"],
    ["cancelled", "cancelled"],
  ] as const)(
    "preserves non-terminal coordinator state %s as view status %s (never failed)",
    async (coordinatorState, viewStatus) => {
      const coordinator = {
        requestCompaction: vi.fn().mockResolvedValue({
          state: coordinatorState,
          sectionsPacked: 3,
          runId: "run-9",
        }),
      };
      const onAutoCompacted = vi.fn();
      const svc = new AIChatCompactAgentService({} as never, {
        completeChat: vi.fn(),
        isEnabled: () => true,
        onAutoCompacted,
        compactionCoordinator: coordinator as never,
      });
      const view = await svc.runFullCompact({ conversationId: "v2-paused" });
      // A batch-limit pause (or join/cancel) is resumable, not a failure.
      expect(view.status).toBe(viewStatus);
      expect(onAutoCompacted).not.toHaveBeenCalled();
    }
  );
});
