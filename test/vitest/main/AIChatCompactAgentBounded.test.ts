/**
 * Bounded-compaction routing tests for AIChatCompactAgentService
 * (PRD FR-07/FR-08; design §18 rollback).
 *
 * Disabling new publication must never restore the unbounded all-history
 * summarization algorithm: without a coordinator, runFullCompact fails with a
 * budget-checked limitation instead of sending the entire archive in one
 * request.
 */
import { describe, it, expect, vi } from "vitest";
import { AIChatCompactAgentService } from "@/service/AIChatCompactAgentService";

describe("AIChatCompactAgentService bounded routing", () => {
  it("refuses all-history summarization when no coordinator is wired", async () => {
    const completeChat = vi.fn();
    const svc = new AIChatCompactAgentService({} as never, {
      completeChat,
      isEnabled: () => true,
    });
    await expect(
      svc.runFullCompact({ conversationId: "v2-nocoord" })
    ).rejects.toThrow(/bounded|coordinator|unavailable/i);
    // The legacy unbounded path must never run: no provider call happens.
    expect(completeChat).not.toHaveBeenCalled();
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
