import { describe, expect, it, beforeEach, vi } from "vitest";
import type { AIChatLightweightCompletionResult } from "@/service/AIChatLightweightTypes";
import type { AIWorkspaceAutoDreamServiceDeps } from "@/service/AIWorkspaceAutoDreamService";

// Module-level mocks for the auto-dream service's collaborators.
const completeChat = vi.fn();
// The lightweight dep wraps the completion response in a result object.
// Typed as a vi.fn spy so call assertions work, matching the dep signature.
const completeLightweight = vi.fn<
  AIWorkspaceAutoDreamServiceDeps["completeLightweight"]
>((input) =>
  Promise.resolve(completeChat(input)).then(
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
const startRun = vi.fn();
const completeRun = vi.fn();
const failRun = vi.fn();
const getByRunId = vi.fn();
const getLatest = vi.fn();
const getRunning = vi.fn();
const recoverStale = vi.fn();
const collect = vi.fn();
const createMemory = vi.fn();
const updateMemory = vi.fn();
const archiveMemory = vi.fn();
const listActive = vi.fn();
const applyPlanAndCompleteRun = vi.fn();

vi.mock("@/modules/AIWorkspaceMemoryModule", () => ({
  AIWorkspaceMemoryModule: vi.fn().mockImplementation(() => ({
    createMemory,
    updateMemory,
    archiveMemory,
    listActiveForRetrieval: listActive,
    applyPlanAndCompleteRun,
  })),
}));

vi.mock("@/modules/AIWorkspaceMemoryConsolidationRunModule", () => ({
  AIWorkspaceMemoryConsolidationRunModule: vi.fn().mockImplementation(() => ({
    startRun,
    completeRun,
    failRun,
    getByRunId,
    getLatestSuccessfulRun: getLatest,
    getRunningRun: getRunning,
    recoverStaleRunningRuns: recoverStale,
  })),
}));

// Mock the collector: `collect` is the method; `groupByWorkspace` is the pure
// helper the service imports. Replicate the real grouping so packets with no
// workspace are excluded (the workspace-isolation first line of defense).
vi.mock("@/service/AIAutoDreamSourceCollector", () => ({
  AIAutoDreamSourceCollector: vi.fn().mockImplementation(() => ({ collect })),
  groupByWorkspace: (
    packets: ReadonlyArray<{ workspace?: { workspaceKey: string } }>
  ) => {
    const m = new Map<string, unknown[]>();
    for (const p of packets) {
      const k = p.workspace?.workspaceKey;
      if (!k) continue;
      const arr = (m.get(k) as unknown[]) ?? [];
      arr.push(p);
      m.set(k, arr);
    }
    return m;
  },
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({ getValue: vi.fn() })),
}));

import { AIWorkspaceAutoDreamService } from "@/service/AIWorkspaceAutoDreamService";

const WS = "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const now = () => new Date();
const iso = (d: Date) => d.toISOString();

function pkt(ws: string, id: string, messageCount = 1) {
  return {
    sourceKind: "chat_v2" as const,
    sourceId: id,
    updatedAt: iso(now()),
    title: "t",
    messages: Array.from({ length: messageCount }, (_unused, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: "x",
    })),
    workspace: {
      workspaceId: 1,
      workspaceKey: ws,
      workspaceRoot: "/p/a",
      displayName: "a",
    },
  };
}

const runView = {
  runId: "wrun-1",
  status: "running",
  startedAt: iso(now()),
  chatConversationsReviewed: 0,
  agentTasksReviewed: 0,
  memoriesCreated: 0,
  memoriesUpdated: 0,
  memoriesArchived: 0,
  createdAt: iso(now()),
  updatedAt: iso(now()),
};

const svc = (ai = true, ad = true) =>
  new AIWorkspaceAutoDreamService({
    completeLightweight,
    isAIEnabled: () => ai,
    isAutoDreamEnabled: async () => ad,
  });

describe("AIWorkspaceAutoDreamService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.clearAllMocks();
    startRun.mockResolvedValue(runView);
    getByRunId.mockResolvedValue({ ...runView, status: "completed" });
    getLatest.mockResolvedValue(null);
    getRunning.mockResolvedValue(null);
    recoverStale.mockResolvedValue(0);
    listActive.mockResolvedValue([]);
    applyPlanAndCompleteRun.mockResolvedValue(undefined);
    collect.mockResolvedValue({
      packets: [],
      chatConversationCount: 0,
      agentTaskCount: 0,
      reviewedThrough: now(),
    });
    completeChat.mockResolvedValue({
      choices: [{ message: { content: "{}" } }],
      model: "m",
    });
  });

  it("skips (runNow throws) when AI is disabled", async () => {
    await expect(svc(false).runNow()).rejects.toThrow(/skipped/i);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("skips when the toggle is disabled and not forced", async () => {
    collect.mockResolvedValue({
      packets: [pkt(WS, "c1")],
      chatConversationCount: 1,
      agentTaskCount: 0,
      reviewedThrough: now(),
    });
    await expect(svc(true, false).runNow()).rejects.toThrow(/skipped/i);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("force bypasses the disabled toggle and the min-sources gate", async () => {
    collect.mockResolvedValue({
      packets: [pkt(WS, "c1")],
      chatConversationCount: 1,
      agentTaskCount: 0,
      reviewedThrough: now(),
    });
    const r = await svc(true, false).runNow({ force: true });
    expect(startRun).toHaveBeenCalledTimes(1);
    expect(applyPlanAndCompleteRun).toHaveBeenCalled();
    expect(r.length).toBe(1);
  });

  it("skips packets whose conversation has no resolved workspace", async () => {
    collect.mockResolvedValue({
      packets: [
        {
          sourceKind: "chat_v2",
          sourceId: "c",
          updatedAt: iso(now()),
          title: "t",
          messages: [],
        },
      ],
      chatConversationCount: 1,
      agentTaskCount: 0,
      reviewedThrough: now(),
    });
    await expect(svc().runNow()).rejects.toThrow(/skipped/i);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("per-workspace cooldown: a run finished 1h ago is skipped (returns empty)", async () => {
    collect.mockResolvedValue({
      packets: [pkt(WS, "c1"), pkt(WS, "c2"), pkt(WS, "c3")],
      chatConversationCount: 3,
      agentTaskCount: 0,
      reviewedThrough: now(),
    });
    getLatest.mockResolvedValue({
      finishedAt: iso(new Date(Date.now() - 1 * 3600_000)),
    });
    const r = await svc().runNow();
    expect(r).toEqual([]);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("skips one short workspace conversation below the automatic message threshold", async () => {
    collect.mockResolvedValue({
      packets: [pkt(WS, "c1", 2)],
      chatConversationCount: 1,
      agentTaskCount: 0,
      reviewedThrough: now(),
    });

    await svc().evaluateAfterChatTurn({
      conversationId: "c1",
      reason: "assistant_turn_completed",
    });

    expect(startRun).not.toHaveBeenCalled();
  });

  it("runs automatically for one active workspace conversation with enough messages", async () => {
    collect.mockResolvedValue({
      packets: [pkt(WS, "c1", 6)],
      chatConversationCount: 1,
      agentTaskCount: 0,
      reviewedThrough: now(),
    });

    await svc().evaluateAfterChatTurn({
      conversationId: "c1",
      reason: "assistant_turn_completed",
    });

    expect(startRun).toHaveBeenCalledTimes(1);
    expect(applyPlanAndCompleteRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "wrun-1",
        chatConversationsReviewed: 1,
      })
    );
  });

  it("per-workspace cooldown: a run finished 25h ago proceeds", async () => {
    collect.mockResolvedValue({
      packets: [pkt(WS, "c1"), pkt(WS, "c2"), pkt(WS, "c3")],
      chatConversationCount: 3,
      agentTaskCount: 0,
      reviewedThrough: now(),
    });
    getLatest.mockResolvedValue({
      finishedAt: iso(new Date(Date.now() - 25 * 3600_000)),
    });
    const r = await svc().runNow();
    expect(r.length).toBe(1);
    expect(applyPlanAndCompleteRun).toHaveBeenCalled();
  });

  it("marks the run failed on a parse error, never throws past runNow", async () => {
    collect.mockResolvedValue({
      packets: [pkt(WS, "c1"), pkt(WS, "c2"), pkt(WS, "c3")],
      chatConversationCount: 3,
      agentTaskCount: 0,
      reviewedThrough: now(),
    });
    completeChat.mockResolvedValue({
      choices: [{ message: { content: "not json {" } }],
      model: "m",
    });
    getByRunId.mockResolvedValue({
      ...runView,
      status: "failed",
      errorMessage: "parse_error: invalid_json",
    });
    const r = await svc().runNow({ force: true });
    expect(failRun).toHaveBeenCalledWith(
      "wrun-1",
      expect.stringMatching(/parse_error/)
    );
    expect(applyPlanAndCompleteRun).not.toHaveBeenCalled();
    expect(r[0].status).toBe("failed");
  });

  it("a thrown model call marks the run failed; evaluateAfterChatTurn swallows it", async () => {
    collect.mockResolvedValue({
      packets: [pkt(WS, "c1"), pkt(WS, "c2"), pkt(WS, "c3")],
      chatConversationCount: 3,
      agentTaskCount: 0,
      reviewedThrough: now(),
    });
    completeChat.mockRejectedValue(new Error("boom"));
    getByRunId.mockResolvedValue({
      ...runView,
      status: "failed",
      errorMessage: "boom",
    });
    await expect(
      svc().evaluateAfterChatTurn({
        conversationId: "c",
        reason: "assistant_turn_completed",
      })
    ).resolves.toBeUndefined();
    expect(failRun).toHaveBeenCalledWith("wrun-1", "boom");
  });

  it("applies archive before update before create on the happy path", async () => {
    collect.mockResolvedValue({
      packets: [pkt(WS, "c1"), pkt(WS, "c2"), pkt(WS, "c3")],
      chatConversationCount: 3,
      agentTaskCount: 0,
      reviewedThrough: now(),
    });
    listActive.mockResolvedValue([
      {
        id: 1,
        memoryId: "wmem-1",
        workspaceKey: WS,
        workspaceRoot: "/p/a",
        type: "decision",
        title: "t",
        content: "c",
        status: "active",
        confidence: 80,
        createdAt: iso(now()),
        updatedAt: iso(now()),
      },
    ]);
    createMemory.mockResolvedValue({});
    updateMemory.mockResolvedValue({});
    archiveMemory.mockResolvedValue(undefined);
    completeChat.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              archive: [{ memoryId: "wmem-1", reason: "r" }],
              update: [{ memoryId: "wmem-1", content: "u", reason: "r" }],
              create: [
                {
                  workspaceKey: WS,
                  type: "workflow",
                  title: "n",
                  content: "nn",
                  confidence: 80,
                  sourceKind: "chat_v2",
                  sourceId: "c1",
                  reason: "r",
                },
              ],
            }),
          },
        },
      ],
      model: "m",
    });
    await svc().runNow({ force: true });
    // The parsed plan is applied AND the run completed atomically via
    // applyPlanAndCompleteRun (tech-design §14.4). The archive/update/create
    // ordering invariant now lives inside that transactional method.
    expect(applyPlanAndCompleteRun).toHaveBeenCalledTimes(1);
    const arg = applyPlanAndCompleteRun.mock.calls[0]![0] as {
      runId: string;
      plan: {
        archive: unknown[];
        update: unknown[];
        create: Array<{ workspaceKey: string; type: string }>;
      };
      memoriesCreated?: number;
    };
    expect(arg.runId).toBe("wrun-1");
    expect(arg.plan.archive).toHaveLength(1);
    expect(arg.plan.update).toHaveLength(1);
    expect(arg.plan.create).toHaveLength(1);
    // Create is scoped to the resolved workspaceKey, never a model-supplied other key.
    expect(arg.plan.create[0]!.workspaceKey).toBe(WS);
    expect(arg.plan.create[0]!.type).toBe("workflow");
  });

  it("packs workspace packets into multiple bounded batches (SMBW-007)", async () => {
    // A tiny capability window forces the four packets into multiple batches.
    const tinySvc = new AIWorkspaceAutoDreamService({
      completeLightweight,
      isAIEnabled: () => true,
      isAutoDreamEnabled: async () => true,
      getSmallModelCapability: async () => ({
        available: true,
        context_size: 8000,
      }),
    });
    const big = (id: string) => ({
      sourceKind: "chat_v2" as const,
      sourceId: id,
      updatedAt: iso(now()),
      title: id,
      messages: Array.from({ length: 5 }, (_unused, i) => ({
        id: `m${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: "x".repeat(2000),
      })),
      workspace: {
        workspaceId: 1,
        workspaceKey: WS,
        workspaceRoot: "/p/a",
        displayName: "a",
      },
    });
    collect.mockResolvedValue({
      packets: [big("c1"), big("c2"), big("c3"), big("c4")],
      chatConversationCount: 4,
      agentTaskCount: 0,
      reviewedThrough: now(),
    });
    completeChat.mockResolvedValue({
      choices: [{ message: { content: "{}" } }],
      model: "small-resolved",
    });

    await tinySvc.runNow({ force: true });
    // Multiple batches ⇒ multiple lightweight calls.
    expect(completeLightweight.mock.calls.length).toBeGreaterThan(1);
    // Exactly one atomic apply with the merged plan.
    expect(applyPlanAndCompleteRun).toHaveBeenCalledTimes(1);
  });

  it("an unprocessable workspace packet fails the run without a model call (SMBW-007)", async () => {
    const tinySvc = new AIWorkspaceAutoDreamService({
      completeLightweight,
      isAIEnabled: () => true,
      isAutoDreamEnabled: async () => true,
      getSmallModelCapability: async () => ({
        available: true,
        context_size: 100, // too small for any useful packet
      }),
    });
    collect.mockResolvedValue({
      packets: [
        {
          sourceKind: "chat_v2" as const,
          sourceId: "c-huge",
          updatedAt: iso(now()),
          title: "huge",
          messages: [{ id: "m0", role: "user", content: "x".repeat(10_000) }],
          workspace: {
            workspaceId: 1,
            workspaceKey: WS,
            workspaceRoot: "/p/a",
            displayName: "a",
          },
        },
      ],
      chatConversationCount: 1,
      agentTaskCount: 0,
      reviewedThrough: now(),
    });
    getByRunId.mockResolvedValue({ ...runView, status: "failed" });

    const r = await tinySvc.runNow({ force: true });
    expect(r[0]!.status).toBe("failed");
    expect(completeLightweight).not.toHaveBeenCalled();
    expect(failRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("oversized_packet")
    );
    expect(applyPlanAndCompleteRun).not.toHaveBeenCalled();
  });
});
