import { describe, expect, it, beforeEach, vi } from "vitest";
import { AIUserMemoryRetrievalService } from "@/service/AIUserMemoryRetrievalService";
import type { AIUserMemoryView } from "@/entityTypes/aiUserMemoryTypes";

const mockListActive = vi.fn();
const mockMarkUsed = vi.fn();

vi.mock("@/modules/AIUserMemoryModule", () => ({
  AIUserMemoryModule: vi.fn().mockImplementation(() => ({
    listActiveForRetrieval: mockListActive,
    markMemoriesUsed: mockMarkUsed,
  })),
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({ getValue: vi.fn() })),
}));

function mem(opts: Partial<AIUserMemoryView>): AIUserMemoryView {
  return {
    id: opts.id ?? 1,
    memoryId: opts.memoryId ?? "mem-1",
    type: opts.type ?? "preference",
    title: opts.title ?? "Concise",
    content: opts.content ?? "User prefers concise answers.",
    status: "active",
    confidence: 80,
    sourceConversationId: opts.sourceConversationId,
    sourceKind: opts.sourceKind,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("AIUserMemoryRetrievalService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("excludes archived/contradicted memories (module returns active only)", async () => {
    mockListActive.mockResolvedValue([mem({ memoryId: "m1" })]);
    const svc = new AIUserMemoryRetrievalService();
    const r = await svc.retrieve({
      currentUserMessage: "hi",
      mode: "chat",
    });
    expect(r.memories.length).toBe(1);
    expect(r.memories[0].memoryId).toBe("m1");
    expect(r.contextBlock).toContain("Durable user memory");
  });

  it("respects max memory count", async () => {
    mockListActive.mockResolvedValue([
      mem({ memoryId: "m1", content: "aaa" }),
      mem({ memoryId: "m2", content: "bbb" }),
      mem({ memoryId: "m3", content: "ccc" }),
    ]);
    const svc = new AIUserMemoryRetrievalService();
    const r = await svc.retrieve({
      currentUserMessage: "x",
      mode: "chat",
      maxMemories: 2,
    });
    expect(r.memories.length).toBe(2);
  });

  it("ranks keyword matches higher than non-matches", async () => {
    mockListActive.mockResolvedValue([
      mem({ memoryId: "no-match", type: "fact", title: "zzz", content: "zzz" }),
      mem({
        memoryId: "match",
        type: "preference",
        title: "Email marketing",
        content: "User runs weekly email campaigns",
      }),
    ]);
    const svc = new AIUserMemoryRetrievalService();
    const r = await svc.retrieve({
      currentUserMessage: "how do I run email campaigns",
      mode: "chat",
    });
    expect(r.memories[0].memoryId).toBe("match");
  });

  it("marks injected memories used", async () => {
    mockListActive.mockResolvedValue([mem({ memoryId: "m1" })]);
    const svc = new AIUserMemoryRetrievalService();
    await svc.retrieve({ currentUserMessage: "x", mode: "chat" });
    expect(mockMarkUsed).toHaveBeenCalled();
  });

  it("returns empty context when no active memories exist", async () => {
    mockListActive.mockResolvedValue([]);
    const svc = new AIUserMemoryRetrievalService();
    const r = await svc.retrieve({
      currentUserMessage: "x",
      mode: "chat",
    });
    expect(r.memories).toEqual([]);
    expect(r.contextBlock).toBe("");
  });
});
