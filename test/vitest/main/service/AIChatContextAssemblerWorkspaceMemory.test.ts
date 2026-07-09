import { describe, expect, it, beforeEach, vi } from "vitest";
import { AIChatContextAssembler } from "@/service/AIChatContextAssembler";
import {
  ai_workspace_memory_injection_enabled,
  ai_memory_injection_enabled,
} from "@/config/settinggroupInit";

const mockGetByConversation = vi.fn();
const mockGetActiveSummary = vi.fn();
const mockGetConversationMessages = vi.fn();
const mockDurableRetrieve = vi.fn();
const mockWorkspaceRetrieve = vi.fn();
const mockResolve = vi.fn();

vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: vi.fn().mockImplementation(() => ({
    getByConversation: mockGetByConversation,
  })),
}));
vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: vi.fn().mockImplementation(() => ({
    getActiveSummary: mockGetActiveSummary,
  })),
}));
vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    getConversationMessages: mockGetConversationMessages,
  })),
}));
vi.mock("@/service/AIUserMemoryRetrievalService", () => ({
  AIUserMemoryRetrievalService: vi.fn().mockImplementation(() => ({
    retrieve: mockDurableRetrieve,
  })),
}));
vi.mock("@/service/AIWorkspaceMemoryRetrievalService", () => ({
  AIWorkspaceMemoryRetrievalService: vi.fn().mockImplementation(() => ({
    retrieve: mockWorkspaceRetrieve,
  })),
}));
vi.mock("@/service/WorkspaceResolver", () => ({
  WorkspaceResolver: vi.fn().mockImplementation(() => ({
    resolve: mockResolve,
  })),
}));
const mockGetSettingValue = vi.fn();
vi.mock("@/modules/SystemSettingModule", () => ({
  SystemSettingModule: vi.fn().mockImplementation(() => ({
    getSettingValue: mockGetSettingValue,
  })),
}));
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({ getValue: vi.fn() })),
}));

describe("AIChatContextAssembler — workspace memory injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetByConversation.mockResolvedValue(null);
    mockGetActiveSummary.mockResolvedValue(null);
    mockGetConversationMessages.mockResolvedValue([]);
    mockDurableRetrieve.mockResolvedValue({
      memories: [],
      tokenEstimate: 0,
      contextBlock: "",
    });
    mockWorkspaceRetrieve.mockResolvedValue({
      memories: [],
      tokenEstimate: 0,
      contextBlock: "",
    });
    mockResolve.mockResolvedValue({
      workspaceId: 1,
      rootPath: "/projects/alpha",
    });
    // Default: both injection toggles enabled (absent → enabled).
    mockGetSettingValue.mockResolvedValue(null);
  });

  it("injects workspace memory AFTER active workspace and BEFORE durable user memory", async () => {
    mockWorkspaceRetrieve.mockResolvedValue({
      memories: [{ memoryId: "wmem-1" }],
      tokenEstimate: 10,
      contextBlock: "Workspace memory:\nalpha decision",
    });
    mockDurableRetrieve.mockResolvedValue({
      memories: [{ memoryId: "mem-1" }],
      tokenEstimate: 10,
      contextBlock: "Durable user memory:\nglobal fact",
    });
    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "conv-1",
      currentUserMessage: "hi",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    const wsIdx = r.messages.findIndex(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.startsWith("Workspace memory")
    );
    const durableIdx = r.messages.findIndex(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.startsWith("Durable user memory")
    );
    const activeIdx = r.messages.findIndex(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.startsWith("Active workspace")
    );
    expect(activeIdx).toBeGreaterThanOrEqual(0);
    expect(wsIdx).toBeGreaterThan(activeIdx);
    expect(durableIdx).toBeGreaterThan(wsIdx);
    expect(r.usedWorkspaceMemory).toBe(true);
    expect(r.workspaceMemoryCount).toBe(1);
  });

  it("does not inject workspace memory when retrieval returns empty", async () => {
    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "conv-1",
      currentUserMessage: "hi",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    const ws = r.messages.find(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.startsWith("Workspace memory")
    );
    expect(ws).toBeUndefined();
    expect(r.usedWorkspaceMemory).toBe(false);
    expect(r.workspaceMemoryCount).toBe(0);
  });

  it("does not inject workspace memory when the toggle is disabled", async () => {
    mockGetSettingValue.mockImplementation((key: string) => {
      if (key === ai_workspace_memory_injection_enabled)
        return Promise.resolve("false");
      return Promise.resolve(null);
    });
    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "conv-1",
      currentUserMessage: "hi",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    expect(mockWorkspaceRetrieve).not.toHaveBeenCalled();
    expect(r.usedWorkspaceMemory).toBe(false);
    // Durable path is independent and still runs.
    expect(mockGetSettingValue).toHaveBeenCalledWith(ai_memory_injection_enabled);
  });

  it("degrades gracefully (no block, no throw) when workspace retrieval fails", async () => {
    mockWorkspaceRetrieve.mockRejectedValue(new Error("sqlite locked"));
    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "conv-1",
      currentUserMessage: "hi",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    expect(r.usedWorkspaceMemory).toBe(false);
    // Assembly still completes with a valid message list.
    expect(r.messages.length).toBeGreaterThan(0);
    expect(r.messages[r.messages.length - 1]).toEqual({
      role: "user",
      content: "hi",
    });
  });
});
