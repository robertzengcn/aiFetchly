import { describe, expect, it, beforeEach, vi } from "vitest";
import { AIAutoDreamService } from "@/service/AIAutoDreamService";

const mockCompleteChat = vi.fn();
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

vi.mock("@/modules/AIUserMemoryModule", () => ({
  AIUserMemoryModule: vi.fn().mockImplementation(() => ({
    createMemory: mockCreateMemory,
    updateMemory: mockUpdateMemory,
    archiveMemory: mockArchiveMemory,
    listMemories: mockListMemories,
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
    completeChat: mockCompleteChat,
    isAIEnabled: () => opts.aiEnabled,
    isAutoDreamEnabled: () => opts.autoDreamEnabled,
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
      packets: [],
      chatConversationCount: 0,
      agentTaskCount: 0,
      reviewedThrough: new Date(),
    });
    mockListMemories.mockResolvedValue([]);
    mockStartRun.mockResolvedValue(runView);
    mockGetByRunId.mockResolvedValue(null);
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
    mockCreateMemory.mockImplementation(async (i: { title: string }) => ({
      memoryId: "mem-new",
      type: "preference",
      title: i.title,
      content: "x",
      status: "active",
      confidence: 90,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const completed = { ...runView, status: "completed" };
    mockGetByRunId.mockResolvedValue(completed);
    const r = await svc.runNow({ force: true });
    expect(r.status).toBe("completed");
    expect(mockCreateMemory).toHaveBeenCalled();
    expect(mockUpdateMemory).toHaveBeenCalledWith(
      expect.objectContaining({ memoryId: "mem-old" })
    );
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
});
