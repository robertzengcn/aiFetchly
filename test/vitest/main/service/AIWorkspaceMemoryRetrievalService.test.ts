import { describe, expect, it, beforeEach, vi } from "vitest";
import { AIWorkspaceMemoryRetrievalService } from "@/service/AIWorkspaceMemoryRetrievalService";
import type { AIWorkspaceMemoryView } from "@/entityTypes/aiWorkspaceMemoryTypes";

// Inject mocks through the constructor (no module mocking needed).
function makeMocks() {
  const listActiveForRetrieval = vi.fn();
  const markMemoriesUsed = vi.fn().mockResolvedValue(undefined);
  const resolveForConversation = vi.fn();
  const estimateText = vi.fn().mockImplementation((s: string) => s.length);
  const memory = {
    listActiveForRetrieval,
    markMemoriesUsed,
  } as unknown as ConstructorParameters<
    typeof AIWorkspaceMemoryRetrievalService
  >[0];
  const resolver = {
    resolveForConversation,
  } as unknown as ConstructorParameters<
    typeof AIWorkspaceMemoryRetrievalService
  >[1];
  const estimator = { estimateText } as unknown as ConstructorParameters<
    typeof AIWorkspaceMemoryRetrievalService
  >[2];
  return {
    listActiveForRetrieval,
    markMemoriesUsed,
    resolveForConversation,
    estimateText,
    memory,
    resolver,
    estimator,
  };
}

const SCOPE_CTX = {
  conversationId: "conv-1",
  workspaceId: 1,
  workspaceKey: "ws_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  workspaceRoot: "/projects/alpha",
  displayName: "alpha",
};

function mem(opts: Partial<AIWorkspaceMemoryView>): AIWorkspaceMemoryView {
  return {
    id: opts.id ?? 1,
    memoryId: opts.memoryId ?? "wmem-1",
    workspaceKey: SCOPE_CTX.workspaceKey,
    workspaceRoot: SCOPE_CTX.workspaceRoot,
    type: opts.type ?? "project",
    title: opts.title ?? "Concise",
    content: opts.content ?? "Project prefers concise answers.",
    status: "active",
    confidence: opts.confidence ?? 80,
    sourceConversationId: opts.sourceConversationId,
    sourceKind: opts.sourceKind,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: opts.updatedAt ?? "2026-01-01T00:00:00.000Z",
  };
}

describe("AIWorkspaceMemoryRetrievalService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty when no approved workspace is resolved", async () => {
    const m = makeMocks();
    m.resolveForConversation.mockResolvedValue(null);
    const svc = new AIWorkspaceMemoryRetrievalService(
      m.memory,
      m.resolver,
      m.estimator
    );
    const r = await svc.retrieve({
      currentUserMessage: "anything",
      conversationId: "conv-1",
      mode: "chat",
    });
    expect(r.memories).toEqual([]);
    expect(r.contextBlock).toBe("");
    expect(m.listActiveForRetrieval).not.toHaveBeenCalled();
  });

  it("retrieves active memories and formats the workspace memory block", async () => {
    const m = makeMocks();
    m.resolveForConversation.mockResolvedValue(SCOPE_CTX);
    m.listActiveForRetrieval.mockResolvedValue([mem({ memoryId: "wmem-1" })]);
    const svc = new AIWorkspaceMemoryRetrievalService(
      m.memory,
      m.resolver,
      m.estimator
    );
    const r = await svc.retrieve({
      currentUserMessage: "hi",
      conversationId: "conv-1",
      mode: "chat",
    });
    expect(m.listActiveForRetrieval).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceKey: SCOPE_CTX.workspaceKey }),
      200
    );
    expect(r.memories.length).toBe(1);
    expect(r.contextBlock).toContain("Workspace memory:");
  });

  it("respects maxMemories cap", async () => {
    const m = makeMocks();
    m.resolveForConversation.mockResolvedValue(SCOPE_CTX);
    m.listActiveForRetrieval.mockResolvedValue([
      mem({ memoryId: "m1", content: "aaa" }),
      mem({ memoryId: "m2", content: "bbb" }),
      mem({ memoryId: "m3", content: "ccc" }),
    ]);
    const svc = new AIWorkspaceMemoryRetrievalService(
      m.memory,
      m.resolver,
      m.estimator
    );
    const r = await svc.retrieve({
      currentUserMessage: "x",
      conversationId: "conv-1",
      mode: "chat",
      maxMemories: 2,
    });
    expect(r.memories.length).toBe(2);
  });

  it("respects maxTokens cap (stops before exceeding budget)", async () => {
    const m = makeMocks();
    m.resolveForConversation.mockResolvedValue(SCOPE_CTX);
    m.listActiveForRetrieval.mockResolvedValue([
      mem({ memoryId: "m1", content: "a".repeat(50) }),
      mem({ memoryId: "m2", content: "b".repeat(50) }),
      mem({ memoryId: "m3", content: "c".repeat(50) }),
    ]);
    const svc = new AIWorkspaceMemoryRetrievalService(
      m.memory,
      m.resolver,
      m.estimator
    );
    const r = await svc.retrieve({
      currentUserMessage: "x",
      conversationId: "conv-1",
      mode: "chat",
      maxMemories: 10,
      maxTokens: 220, // header(~280) already near cap; only the first line fits
    });
    expect(r.memories.length).toBeLessThanOrEqual(1);
  });

  it("ranks a warning above a project with comparable keyword overlap", async () => {
    const m = makeMocks();
    m.resolveForConversation.mockResolvedValue(SCOPE_CTX);
    m.listActiveForRetrieval.mockResolvedValue([
      mem({
        memoryId: "proj",
        type: "project",
        title: "deploy",
        content: "deploy the app",
        confidence: 80,
      }),
      mem({
        memoryId: "warn",
        type: "warning",
        title: "deploy",
        content: "deploy the app",
        confidence: 80,
      }),
    ]);
    const svc = new AIWorkspaceMemoryRetrievalService(
      m.memory,
      m.resolver,
      m.estimator
    );
    const r = await svc.retrieve({
      currentUserMessage: "how do I deploy the app",
      conversationId: "conv-1",
      mode: "chat",
    });
    expect(r.memories[0].memoryId).toBe("warn");
  });

  it("marks injected memories used with the workspace scope", async () => {
    const m = makeMocks();
    m.resolveForConversation.mockResolvedValue(SCOPE_CTX);
    m.listActiveForRetrieval.mockResolvedValue([mem({ memoryId: "wmem-1" })]);
    const svc = new AIWorkspaceMemoryRetrievalService(
      m.memory,
      m.resolver,
      m.estimator
    );
    await svc.retrieve({
      currentUserMessage: "x",
      conversationId: "conv-1",
      mode: "chat",
    });
    expect(m.markMemoriesUsed).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceKey: SCOPE_CTX.workspaceKey }),
      ["wmem-1"],
      expect.any(Date)
    );
  });

  it("returns empty context when the workspace has no active memories", async () => {
    const m = makeMocks();
    m.resolveForConversation.mockResolvedValue(SCOPE_CTX);
    m.listActiveForRetrieval.mockResolvedValue([]);
    const svc = new AIWorkspaceMemoryRetrievalService(
      m.memory,
      m.resolver,
      m.estimator
    );
    const r = await svc.retrieve({
      currentUserMessage: "x",
      conversationId: "conv-1",
      mode: "chat",
    });
    expect(r.memories).toEqual([]);
    expect(r.contextBlock).toBe("");
  });
});
