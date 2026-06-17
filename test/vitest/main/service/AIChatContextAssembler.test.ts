import { describe, expect, it, beforeEach, vi } from "vitest";
import { AIChatContextAssembler } from "@/service/AIChatContextAssembler";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";

const mockGetByConversation = vi.fn();
const mockGetActiveSummary = vi.fn();
const mockGetConversationMessages = vi.fn();

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

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({ getValue: vi.fn() })),
}));

function row(opts: Partial<AIChatMessageEntity>): AIChatMessageEntity {
  return {
    id: opts.id ?? 0,
    messageId: opts.messageId ?? "m",
    conversationId: opts.conversationId ?? "v2-x",
    role: opts.role ?? "user",
    content: opts.content ?? "",
    timestamp: opts.timestamp ?? new Date(0),
    messageType: opts.messageType ?? MessageType.MESSAGE,
  } as AIChatMessageEntity;
}

describe("AIChatContextAssembler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("puts system prompt first and current user message last", async () => {
    mockGetByConversation.mockResolvedValue(null);
    mockGetActiveSummary.mockResolvedValue(null);
    mockGetConversationMessages.mockResolvedValue([]);
    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "v2-x",
      currentUserMessage: "hi",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    expect(r.messages[0]).toEqual({ role: "system", content: "sysp" });
    expect(r.messages[r.messages.length - 1]).toEqual({
      role: "user",
      content: "hi",
    });
    expect(r.usedSessionMemory).toBe(false);
    expect(r.usedFullCompact).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it("includes session memory as a system block when available", async () => {
    mockGetByConversation.mockResolvedValue({
      conversationId: "v2-x",
      summary: "# Session Memory\n## Current Goal\nship",
      coveredThroughMessageId: "old-msg",
    });
    mockGetActiveSummary.mockResolvedValue(null);
    mockGetConversationMessages.mockResolvedValue([
      row({ messageId: "old-msg", role: "user", content: "old" }),
      row({ messageId: "new-msg", role: "assistant", content: "new" }),
    ]);
    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "v2-x",
      currentUserMessage: "next",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    expect(r.usedSessionMemory).toBe(true);
    const sysBlock = r.messages.find(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.includes("Conversation compact")
    );
    expect(sysBlock).toBeTruthy();
    expect(sysBlock!.content).toContain("ship");
    // The current user message should appear exactly once and be last.
    const nextMsgs = r.messages.filter((m) => m.content === "next");
    expect(nextMsgs.length).toBe(1);
    expect(r.messages[r.messages.length - 1]).toEqual({
      role: "user",
      content: "next",
    });
  });

  it("includes full compact summary and skips session memory when both exist", async () => {
    mockGetByConversation.mockResolvedValue({
      conversationId: "v2-x",
      summary: "session",
      coveredThroughMessageId: "old-msg",
    });
    mockGetActiveSummary.mockResolvedValue({
      conversationId: "v2-x",
      summary: "# Compact Summary\n## Primary Request\nX",
      throughMessageId: "old-msg",
      throughTimestamp: new Date(0).toISOString(),
    });
    mockGetConversationMessages.mockResolvedValue([
      row({ messageId: "new-msg", role: "assistant", content: "new" }),
    ]);
    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "v2-x",
      currentUserMessage: "next",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    expect(r.usedFullCompact).toBe(true);
    const summaryBlock = r.messages.find(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.includes("Primary Request")
    );
    expect(summaryBlock).toBeTruthy();
    // Session memory should NOT be included in addition when the full compact boundary covers it.
    const sessionBlock = r.messages.find(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.includes("# Session Memory")
    );
    expect(sessionBlock).toBeUndefined();
  });

  it("preserves chronological order of recent history", async () => {
    mockGetByConversation.mockResolvedValue(null);
    mockGetActiveSummary.mockResolvedValue(null);
    mockGetConversationMessages.mockResolvedValue([
      row({
        messageId: "a",
        role: "user",
        content: "a",
        timestamp: new Date(1),
      }),
      row({
        messageId: "b",
        role: "assistant",
        content: "b",
        timestamp: new Date(2),
      }),
    ]);
    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "v2-x",
      currentUserMessage: "c",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    const roles = r.messages.map((m) => m.role + ":" + m.content).join("|");
    expect(roles).toBe("system:sysp|user:a|assistant:b|user:c");
  });

  it("does not duplicate the current user message when it was already saved", async () => {
    mockGetByConversation.mockResolvedValue(null);
    mockGetActiveSummary.mockResolvedValue(null);
    mockGetConversationMessages.mockResolvedValue([
      row({
        messageId: "saved-current",
        role: "user",
        content: "What is AI?",
        timestamp: new Date(1),
      }),
    ]);
    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "v2-x",
      currentUserMessage: "What is AI?",
      currentUserMessageId: "saved-current",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    const userMessages = r.messages.filter(
      (m) => m.role === "user" && m.content === "What is AI?"
    );
    expect(userMessages.length).toBe(1);
    expect(r.messages.map((m) => `${m.role}:${m.content}`).join("|")).toBe(
      "system:sysp|user:What is AI?"
    );
  });
});
