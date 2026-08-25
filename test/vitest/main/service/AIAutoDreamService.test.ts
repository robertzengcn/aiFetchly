import { describe, expect, it, beforeEach, vi } from "vitest";
import { AIAutoDreamService } from "@/service/AIAutoDreamService";
import type { AIChatLightweightCompletionResult } from "@/service/AIChatLightweightTypes";
import type { AIAutoDreamServiceDeps } from "@/service/AIAutoDreamService";

const mockCompleteChat = vi.fn();
// The lightweight dep returns a result wrapping the completion response.
// Typed as a vi.fn spy so call assertions work, matching the dep signature.
const mockCompleteLightweight = vi.fn<
  AIAutoDreamServiceDeps["completeLightweight"]
>((input) =>
  Promise.resolve(mockCompleteChat(input)).then(
    (response) =>
      ({
        response,
        route: "provider_normal",
        resolvedModel: (response as { model?: string })?.model ?? "m",
        providerKind: "hosted",
        attemptCount: 1,
        repairAttempted: false,
        fallbackAttempted: false,
      } as AIChatLightweightCompletionResult)
  )
);
const mockCollect = vi.fn();
const mockStartRun = vi.fn();
const mockCompleteRun = vi.fn();
const mockFailRun = vi.fn();
const mockGetByRunId = vi.fn();
const mockGetLatest = vi.fn();
const mockGetRunning = vi.fn();
const mockRecoverStale = vi.fn();
const mockCreateMemory = vi.fn();
const mockUpdateMemory = vi.fn();
const mockArchiveMemory = vi.fn();
const mockListMemories = vi.fn();
const mockApplyPlanAndCompleteRun = vi.fn();

vi.mock("@/modules/AIUserMemoryModule", () => ({
  AIUserMemoryModule: vi.fn().mockImplementation(() => ({
    createMemory: mockCreateMemory,
    updateMemory: mockUpdateMemory,
    archiveMemory: mockArchiveMemory,
    listMemories: mockListMemories,
    applyPlanAndCompleteRun: mockApplyPlanAndCompleteRun,
  })),
}));

vi.mock("@/modules/AIMemoryConsolidationRunModule", () => ({
  AIMemoryConsolidationRunModule: vi.fn().mockImplementation(() => ({
    startRun: mockStartRun,
    completeRun: mockCompleteRun,
    failRun: mockFailRun,
    getByRunId: mockGetByRunId,
    getLatestSuccessfulRun: mockGetLatest,
    getRunningRun: mockGetRunning,
    recoverStaleRunningRuns: mockRecoverStale,
  })),
}));

vi.mock("@/service/AIAutoDreamSourceCollector", () => ({
  AIAutoDreamSourceCollector: vi.fn().mockImplementation(() => ({
    collect: mockCollect,
  })),
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({ getValue: vi.fn() })),
}));

function makeService(opts: {
  aiEnabled: boolean;
  autoDreamEnabled: boolean;
}): AIAutoDreamService {
  return new AIAutoDreamService({
    completeLightweight: mockCompleteLightweight,
    isAIEnabled: () => opts.aiEnabled,
    isAutoDreamEnabled: async () => opts.autoDreamEnabled,
  });
}

const runView = {
  runId: "run-1",
  status: "running",
  startedAt: new Date().toISOString(),
  chatConversationsReviewed: 0,
  agentTasksReviewed: 0,
  memoriesCreated: 0,
  memoriesUpdated: 0,
  memoriesArchived: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("AIAutoDreamService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRunning.mockResolvedValue(null);
    mockGetLatest.mockResolvedValue(null);
    mockRecoverStale.mockResolvedValue(0);
    mockCollect.mockResolvedValue({
      // Default: one small packet so the model is called and batches have
      // something to pack. Tests that need no packets override this.
      packets: [
        {
          sourceKind: "chat_v2",
          sourceId: "v2-default",
          updatedAt: new Date().toISOString(),
          title: "default",
          messages: [{ id: "m1", role: "user", content: "hi" }],
        },
      ],
      chatConversationCount: 1,
      agentTaskCount: 0,
      reviewedThrough: new Date(),
    });
    mockListMemories.mockResolvedValue([]);
    mockStartRun.mockResolvedValue(runView);
    mockGetByRunId.mockResolvedValue(null);
    mockApplyPlanAndCompleteRun.mockResolvedValue(undefined);
  });

  it("skips when AI is disabled (evaluateAfterChatTurn)", async () => {
    const svc = makeService({ aiEnabled: false, autoDreamEnabled: true });
    await svc.evaluateAfterChatTurn({
      conversationId: "v2-1",
      reason: "assistant_turn_completed",
    });
    expect(mockStartRun).not.toHaveBeenCalled();
  });

  it("skips when auto-dream is disabled", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: false });
    await svc.evaluateAfterChatTurn({
      conversationId: "v2-1",
      reason: "assistant_turn_completed",
    });
    expect(mockStartRun).not.toHaveBeenCalled();
  });

  it("force run bypasses time and source gates", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: false });
    mockCompleteChat.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ create: [], update: [], archive: [] }),
          },
        },
      ],
      model: "test-model",
    });
    const completed = { ...runView, status: "completed" };
    mockGetByRunId.mockResolvedValue(completed);
    const r = await svc.runNow({ force: true });
    expect(r.status).toBe("completed");
    expect(mockStartRun).toHaveBeenCalled();
  });

  it("serializes concurrent runs (in-process lock)", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: true });
    mockCompleteChat.mockImplementation(async () => {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({ create: [], update: [], archive: [] }),
            },
          },
        ],
        model: "test-model",
      };
    });
    const completed = { ...runView, status: "completed" };
    mockGetByRunId.mockResolvedValue(completed);
    const [a, b] = await Promise.all([
      svc.runNow({ force: true }),
      svc.runNow({ force: true }).catch(() => null),
    ]);
    expect(mockStartRun.mock.calls.length).toBe(1);
    expect(a.status).toBe("completed");
    expect(b).toBeNull();
  });

  it("does not write the candidate reviewedThrough at startRun (SMBW-008)", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: true });
    mockCompleteChat.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ create: [], update: [], archive: [] }),
          },
        },
      ],
      model: "test-model",
    });
    mockGetByRunId.mockResolvedValue({ ...runView, status: "completed" });
    await svc.runNow({ force: true });
    // startRun must NOT receive the candidate reviewedThrough — the watermark
    // commits only with the successful transaction.
    const startArg = mockStartRun.mock.calls[0]![0] as {
      reviewedThrough?: Date | null;
    };
    expect(startArg.reviewedThrough).toBeNull();
    // The successful apply DOES carry the source-derived cursor.
    const applyArg = mockApplyPlanAndCompleteRun.mock.calls[0]![0] as {
      reviewedThrough: Date;
    };
    expect(applyArg.reviewedThrough).toBeInstanceOf(Date);
  });

  it("creates, updates, and archives memories from validated output", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: true });
    mockListMemories.mockResolvedValue([
      {
        memoryId: "mem-old",
        type: "preference",
        title: "old",
        content: "x",
        status: "active",
      },
    ]);
    mockCollect.mockResolvedValue({
      packets: [
        {
          sourceKind: "chat_v2",
          sourceId: "v2-1",
          updatedAt: new Date().toISOString(),
          title: "t",
          messages: [{ id: "m1", role: "user", content: "prefer concise" }],
        },
      ],
      chatConversationCount: 1,
      agentTaskCount: 0,
      reviewedThrough: new Date(),
    });
    mockCompleteChat.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              create: [
                {
                  type: "preference",
                  title: "Concise",
                  content: "User prefers concise answers.",
                  confidence: 90,
                  sourceKind: "chat_v2",
                  sourceId: "v2-1",
                },
              ],
              update: [{ memoryId: "mem-old", content: "updated content" }],
              archive: [],
            }),
          },
        },
      ],
      model: "test-model",
    });
    const completed = { ...runView, status: "completed" };
    mockGetByRunId.mockResolvedValue(completed);
    const r = await svc.runNow({ force: true });
    expect(r.status).toBe("completed");
    // The parsed plan is applied AND the run completed atomically via
    // applyPlanAndCompleteRun (tech-design §14.4).
    expect(mockApplyPlanAndCompleteRun).toHaveBeenCalledTimes(1);
    expect(mockApplyPlanAndCompleteRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: runView.runId,
        model: "test-model",
      })
    );
    const callArg = mockApplyPlanAndCompleteRun.mock.calls[0]![0] as {
      plan: { create: unknown[]; update: unknown[]; archive: unknown[] };
    };
    expect(callArg.plan.create).toHaveLength(1);
    expect(callArg.plan.update).toHaveLength(1);
  });

  it("records failed run on model error", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: true });
    mockCompleteChat.mockRejectedValue(new Error("network down"));
    const failedView = { ...runView, status: "failed", errorMessage: "x" };
    mockGetByRunId.mockResolvedValue(failedView);
    const r = await svc.runNow({ force: true });
    expect(r.status).toBe("failed");
    expect(mockFailRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("network down")
    );
  });

  it("does not throw from evaluateAfterChatTurn on error", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: true });
    mockCompleteChat.mockRejectedValue(new Error("boom"));
    await expect(
      svc.evaluateAfterChatTurn({
        conversationId: "v2-1",
        reason: "assistant_turn_completed",
      })
    ).resolves.toBeUndefined();
  });

  it("does not throw from evaluateAfterAgentTask on error", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: true });
    mockCompleteChat.mockRejectedValue(new Error("boom"));
    await expect(
      svc.evaluateAfterAgentTask({
        agentTaskId: "agt-1",
        reason: "agent_task_completed",
      })
    ).resolves.toBeUndefined();
  });

  it("passes the user_auto_dream workload to the lightweight dep", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: true });
    mockCompleteChat.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ create: [], update: [], archive: [] }),
          },
        },
      ],
      model: "small-resolved",
    });
    mockGetByRunId.mockResolvedValue({ ...runView, status: "completed" });
    await svc.runNow({ force: true });
    expect(mockCompleteLightweight).toHaveBeenCalledWith(
      expect.objectContaining({ workload: "user_auto_dream" })
    );
  });

  it("repair succeeds when the first response is invalid JSON", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: true });
    // First call: invalid JSON. Repair call: valid JSON.
    mockCompleteChat
      .mockResolvedValueOnce({
        choices: [{ message: { content: "not valid json {" } }],
        model: "small-resolved",
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({ create: [], update: [], archive: [] }),
            },
          },
        ],
        model: "small-resolved",
      });
    mockGetByRunId.mockResolvedValue({ ...runView, status: "completed" });
    const r = await svc.runNow({ force: true });
    expect(r.status).toBe("completed");
    // Two lightweight calls: initial + one repair.
    expect(mockCompleteLightweight).toHaveBeenCalledTimes(2);
    // SMBW-009: the first completion suppresses the same-route retry so the
    // logical run (first + repair) stays at two requests.
    const firstInput = mockCompleteLightweight.mock.calls[0]![0] as {
      allowSameRouteRetry?: boolean;
    };
    expect(firstInput.allowSameRouteRetry).toBe(false);
    // The repair request is marked repairAttempted.
    const repairInput = mockCompleteLightweight.mock.calls[1]![0] as {
      repairAttempted?: boolean;
    };
    expect(repairInput.repairAttempted).toBe(true);
    // The plan was applied (no failRun).
    expect(mockApplyPlanAndCompleteRun).toHaveBeenCalled();
    expect(mockFailRun).not.toHaveBeenCalled();
  });

  it("repair failure does not apply any memory mutations", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: true });
    // Both calls return invalid JSON; repair fails too.
    mockCompleteChat.mockResolvedValue({
      choices: [{ message: { content: "still not json {" } }],
      model: "small-resolved",
    });
    mockGetByRunId.mockResolvedValue({ ...runView, status: "failed" });
    const r = await svc.runNow({ force: true });
    expect(r.status).toBe("failed");
    expect(mockFailRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/parse_error/)
    );
    // No memory plan applied on parse failure.
    expect(mockApplyPlanAndCompleteRun).not.toHaveBeenCalled();
  });

  it("database failure after valid model output does not call the model again", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: true });
    mockCompleteChat.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ create: [], update: [], archive: [] }),
          },
        },
      ],
      model: "small-resolved",
    });
    // The transactional apply throws (simulated DB failure).
    mockApplyPlanAndCompleteRun.mockRejectedValueOnce(
      new Error("db write failed")
    );
    mockGetByRunId.mockResolvedValue({ ...runView, status: "failed" });
    const r = await svc.runNow({ force: true });
    expect(r.status).toBe("failed");
    // Exactly one lightweight call — no second model request after a
    // persistence failure (tech-design §9.2, §11 invariant 5).
    expect(mockCompleteLightweight).toHaveBeenCalledTimes(1);
    expect(mockFailRun).toHaveBeenCalled();
  });

  it("cancellation aborts the run without recording a failure or advancing the cursor (SMBW-011)", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: true });
    // Multiple packets force batching; the controller aborts after the first
    // batch completes.
    mockCollect.mockResolvedValue({
      packets: [
        {
          sourceKind: "chat_v2",
          sourceId: "v2-a",
          updatedAt: new Date().toISOString(),
          title: "a",
          messages: Array.from({ length: 5 }, (_, i) => ({
            id: `m${i}`,
            role: i % 2 === 0 ? "user" : "assistant",
            content: "x".repeat(2000),
          })),
        },
        {
          sourceKind: "chat_v2",
          sourceId: "v2-b",
          updatedAt: new Date().toISOString(),
          title: "b",
          messages: Array.from({ length: 5 }, (_, i) => ({
            id: `m${i}`,
            role: i % 2 === 0 ? "user" : "assistant",
            content: "x".repeat(2000),
          })),
        },
      ],
      chatConversationCount: 2,
      agentTaskCount: 0,
      reviewedThrough: new Date(),
    });
    const controller = new AbortController();
    mockCompleteChat.mockImplementation(async () => {
      // Abort after the first batch's model call completes.
      controller.abort();
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({ create: [], update: [], archive: [] }),
            },
          },
        ],
        model: "small-resolved",
      };
    });
    mockGetByRunId.mockResolvedValue({ ...runView, status: "running" });

    const r = await svc.runNow({ force: true, signal: controller.signal });
    // Cancellation is not a failure — no failRun, no apply (cursor unchanged).
    expect(mockFailRun).not.toHaveBeenCalled();
    expect(mockApplyPlanAndCompleteRun).not.toHaveBeenCalled();
    void r;
  });

  describe("total-budgeted batching (SMBW-007)", () => {
    function okResponse(content = '{"create":[],"update":[],"archive":[]}') {
      return {
        choices: [{ message: { content } }],
        model: "small-resolved",
      };
    }

    it("packs many packets into multiple bounded batches and merges plans", async () => {
      const svc = makeService({ aiEnabled: true, autoDreamEnabled: true });
      // 20 large packets force multiple batches under a 32k budget (the
      // conservative fallback, since no capability resolver is wired).
      mockCollect.mockResolvedValue({
        packets: Array.from({ length: 20 }, (_, i) => ({
          sourceKind: "chat_v2",
          sourceId: `v2-${i}`,
          updatedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
          title: `title-${i}`,
          messages: Array.from({ length: 5 }, (_, j) => ({
            id: `m${i}-${j}`,
            role: j % 2 === 0 ? "user" : "assistant",
            content: "x".repeat(2000),
          })),
        })),
        chatConversationCount: 20,
        agentTaskCount: 0,
        reviewedThrough: new Date(),
      });
      mockCompleteChat.mockResolvedValue(okResponse());
      mockGetByRunId.mockResolvedValue({ ...runView, status: "completed" });

      const r = await svc.runNow({ force: true });
      expect(r.status).toBe("completed");
      // More than one lightweight call => batching produced >1 batch.
      expect(mockCompleteLightweight.mock.calls.length).toBeGreaterThan(1);
      // Exactly one atomic apply with the merged plan + full cursor.
      expect(mockApplyPlanAndCompleteRun).toHaveBeenCalledTimes(1);
      const arg = mockApplyPlanAndCompleteRun.mock.calls[0]![0] as {
        reviewedThrough: Date;
        chatConversationsReviewed: number;
      };
      expect(arg.chatConversationsReviewed).toBe(20);
      expect(arg.reviewedThrough).toBeInstanceOf(Date);
    });

    it("an unprocessable oversized packet fails the run without a model call", async () => {
      // Use a tiny capability window so the packet's identity + clamped newest
      // message still cannot fit (the minimum-useful form is unprocessable).
      const svc = new AIAutoDreamService({
        completeLightweight: mockCompleteLightweight,
        isAIEnabled: () => true,
        isAutoDreamEnabled: async () => true,
        getSmallModelCapability: async () => ({
          available: true,
          context_size: 100, // too small for any useful packet
        }),
      });
      mockCollect.mockResolvedValue({
        packets: [
          {
            sourceKind: "chat_v2",
            sourceId: "v2-huge",
            updatedAt: new Date().toISOString(),
            title: "huge",
            messages: [{ id: "m0", role: "user", content: "x".repeat(10_000) }],
          },
        ],
        chatConversationCount: 1,
        agentTaskCount: 0,
        reviewedThrough: new Date(),
      });
      mockGetByRunId.mockResolvedValue({ ...runView, status: "failed" });

      const r = await svc.runNow({ force: true });
      expect(r.status).toBe("failed");
      // No model call — the run failed locally on the oversized packet.
      expect(mockCompleteLightweight).not.toHaveBeenCalled();
      expect(mockFailRun).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("oversized_packet")
      );
      // No persistence — the cursor did not advance.
      expect(mockApplyPlanAndCompleteRun).not.toHaveBeenCalled();
    });

    it("uses discovered capability context_size when provided", async () => {
      const svc = new AIAutoDreamService({
        completeLightweight: mockCompleteLightweight,
        isAIEnabled: () => true,
        isAutoDreamEnabled: async () => true,
        getSmallModelCapability: async () => ({
          available: true,
          resolved_model: "haiku",
          context_size: 8_000, // tiny window forces batching
          max_tokens: 1000,
        }),
      });
      mockCollect.mockResolvedValue({
        packets: Array.from({ length: 10 }, (_, i) => ({
          sourceKind: "chat_v2",
          sourceId: `v2-${i}`,
          updatedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
          title: `t-${i}`,
          messages: [{ id: "m0", role: "user", content: "x".repeat(4000) }],
        })),
        chatConversationCount: 10,
        agentTaskCount: 0,
        reviewedThrough: new Date(),
      });
      mockCompleteChat.mockResolvedValue(okResponse());
      mockGetByRunId.mockResolvedValue({ ...runView, status: "completed" });

      await svc.runNow({ force: true });
      // The 8k capability window forces many batches; each request's
      // max_tokens is bounded by the discovered 1000.
      for (const call of mockCompleteLightweight.mock.calls) {
        // No direct assertion on request shape here (the mock wraps it), but
        // the call count proves batching happened.
        void call;
      }
      expect(mockCompleteLightweight.mock.calls.length).toBeGreaterThan(1);
    });
  });
});
