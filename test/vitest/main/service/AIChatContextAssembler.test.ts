import { describe, expect, it, beforeEach, vi } from "vitest";
import { AIChatContextAssembler } from "@/service/AIChatContextAssembler";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";
import { ai_custom_context_directive } from "@/config/settinggroupInit";

const mockGetByConversation = vi.fn();
const mockGetActiveSummary = vi.fn();
const mockGetConversationMessages = vi.fn();
const mockGetRecentMessages = vi.fn();
const mockDurableRetrieve = vi.fn();
const mockWorkspaceRetrieve = vi.fn();
const mockListActiveForRuntime = vi.fn();

vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: vi.fn().mockImplementation(function () {
    return {
    getByConversation: mockGetByConversation,
  };
  }),
}));

vi.mock("@/service/AIWorkspaceMemoryRetrievalService", () => ({
  AIWorkspaceMemoryRetrievalService: vi.fn().mockImplementation(function () {
    return {
    retrieve: mockWorkspaceRetrieve,
  };
  }),
}));

vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: vi.fn().mockImplementation(function () {
    return {
    getActiveSummary: mockGetActiveSummary,
  };
  }),
}));

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(function () {
    return {
    getConversationMessages: mockGetConversationMessages,
    getRecentMessages: mockGetRecentMessages,
  };
  }),
}));

vi.mock("@/service/AIUserMemoryRetrievalService", () => ({
  AIUserMemoryRetrievalService: vi.fn().mockImplementation(function () {
    return {
    retrieve: mockDurableRetrieve,
  };
  }),
}));

const mockGetSettingValue = vi.fn();
vi.mock("@/modules/SystemSettingModule", () => ({
  SystemSettingModule: vi.fn().mockImplementation(function () {
    return {
    getSettingValue: mockGetSettingValue,
  };
  }),
}));

vi.mock("@/modules/AgentDefinitionModule", () => ({
  AgentDefinitionModule: vi.fn().mockImplementation(function () {
    return {
    listActiveForRuntime: mockListActiveForRuntime,
  };
  }),
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(function () {
    return { getValue: vi.fn() };
  }),
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
    metadata: opts.metadata,
  } as AIChatMessageEntity;
}

describe("AIChatContextAssembler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    // Memory injection defaults to enabled (system_setting absent → true).
    mockGetSettingValue.mockResolvedValue(null);
    mockListActiveForRuntime.mockResolvedValue([]);
  });

  it("puts system prompt first and current user message last", async () => {
    mockGetByConversation.mockResolvedValue(null);
    mockGetActiveSummary.mockResolvedValue(null);
    mockGetRecentMessages.mockResolvedValue([]);
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
    mockGetRecentMessages.mockResolvedValue([
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
    mockGetRecentMessages.mockResolvedValue([
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

  it("keeps the original user task after a long tool-calling turn fills the row window", async () => {
    mockGetByConversation.mockResolvedValue(null);
    mockGetActiveSummary.mockResolvedValue(null);
    const originalTask =
      "email software distributors from the CSV files in the workspace";
    const history: AIChatMessageEntity[] = [
      row({
        id: 1,
        messageId: "user-task",
        role: "user",
        content: originalTask,
        timestamp: new Date(1),
        messageType: MessageType.MESSAGE,
      }),
    ];
    for (let i = 0; i < 20; i++) {
      const toolCallId = `call-${i}`;
      const email = `user${i}@example.com`;
      history.push(
        row({
          id: 2 + i * 2,
          messageId: `tool-call-${i}`,
          role: "assistant",
          content: "",
          timestamp: new Date(2 + i * 2),
          messageType: MessageType.TOOL_CALL,
          metadata: JSON.stringify({
            source: "chat-v2",
            toolCallId,
            toolName: "start_email_send_task",
            toolArguments: { emails: [email] },
          }),
        })
      );
      history.push(
        row({
          id: 3 + i * 2,
          messageId: `tool-result-${i}`,
          role: "assistant",
          content: JSON.stringify({
            success: true,
            task_id: 100 + i,
            recipient_count: 1,
          }),
          timestamp: new Date(3 + i * 2),
          messageType: MessageType.TOOL_RESULT,
          metadata: JSON.stringify({
            source: "chat-v2",
            toolCallId,
            toolName: "start_email_send_task",
            toolResult: {
              success: true,
              task_id: 100 + i,
              recipient_count: 1,
            },
            toolResultStatus: "success",
            success: true,
          }),
        })
      );
    }
    history.push(
      row({
        id: 50,
        messageId: "assistant-checkpoint",
        role: "assistant",
        content: "Continuing with Liquid Technologies:",
        timestamp: new Date(50),
        messageType: MessageType.MESSAGE,
      })
    );
    history.push(
      row({
        id: 51,
        messageId: "user-continue",
        role: "user",
        content: "please continue",
        timestamp: new Date(51),
        messageType: MessageType.MESSAGE,
      })
    );
    mockGetRecentMessages.mockResolvedValue(history);

    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "v2-x",
      currentUserMessage: "please continue",
      currentUserMessageId: "user-continue",
      baseSystemPrompt: "sysp",
      mode: "chat",
      recentMessageWindow: 5,
    });

    const contents = r.messages.map((m) => m.content);
    expect(contents).toContain(originalTask);
    expect(contents).toContain("Continuing with Liquid Technologies:");
    const index = r.messages.find(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.includes("Prior tool activity")
    );
    expect(index).toBeTruthy();
    expect(String(index!.content)).toContain("start_email_send_task");
    expect(String(index!.content)).toContain("task_id=119");
    const replayedTools = r.messages.filter((m) => m.role === "tool");
    expect(replayedTools.length).toBe(4);
    expect(replayedTools.map((m) => m.tool_call_id)).toEqual([
      "call-16",
      "call-17",
      "call-18",
      "call-19",
    ]);
    expect(r.messages[r.messages.length - 1]).toEqual({
      role: "user",
      content: "please continue",
    });
  });

  it("preserves chronological order of recent history", async () => {
    mockGetByConversation.mockResolvedValue(null);
    mockGetActiveSummary.mockResolvedValue(null);
    mockGetRecentMessages.mockResolvedValue([
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
    // First two messages are system (sysp + env context); the rest are
    // history (user:a, assistant:b) then the current user message last.
    const sysCount = r.messages.filter((m) => m.role === "system").length;
    expect(sysCount).toBeGreaterThanOrEqual(2);
    expect(r.messages[r.messages.length - 3]).toEqual({
      role: "user",
      content: "a",
    });
    expect(r.messages[r.messages.length - 2]).toEqual({
      role: "assistant",
      content: "b",
    });
    expect(r.messages[r.messages.length - 1]).toEqual({
      role: "user",
      content: "c",
    });
  });

  it("does not duplicate the current user message when it was already saved", async () => {
    mockGetByConversation.mockResolvedValue(null);
    mockGetActiveSummary.mockResolvedValue(null);
    mockGetRecentMessages.mockResolvedValue([
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
    // system messages (sysp + env context) followed by the single user message
    const userMsgs = r.messages.filter((m) => m.role === "user");
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0].content).toBe("What is AI?");
    expect(r.messages[r.messages.length - 1]).toEqual(userMsgs[0]);
  });

  it("injects durable memory before compact context", async () => {
    mockGetByConversation.mockResolvedValue({
      summary: "session",
      coveredThroughMessageId: "old",
    });
    mockGetActiveSummary.mockResolvedValue(null);
    mockGetRecentMessages.mockResolvedValue([]);
    mockDurableRetrieve.mockResolvedValue({
      memories: [{ memoryId: "mem-1" }],
      tokenEstimate: 10,
      contextBlock: "Durable user memory:\ntest durable block",
    });
    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "v2-x",
      currentUserMessage: "hi",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    const durableIdx = r.messages.findIndex(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.startsWith("Durable user memory")
    );
    const sessionIdx = r.messages.findIndex(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.includes("Conversation compact")
    );
    expect(durableIdx).toBeGreaterThanOrEqual(0);
    expect(sessionIdx).toBeGreaterThan(durableIdx);
    expect(r.usedDurableMemory).toBe(true);
    expect(r.durableMemoryCount).toBe(1);
  });

  it("does not inject durable memory when retrieval returns empty", async () => {
    mockGetByConversation.mockResolvedValue(null);
    mockGetActiveSummary.mockResolvedValue(null);
    mockGetRecentMessages.mockResolvedValue([]);
    mockDurableRetrieve.mockResolvedValue({
      memories: [],
      tokenEstimate: 0,
      contextBlock: "",
    });
    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "v2-x",
      currentUserMessage: "hi",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    const durable = r.messages.find(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.startsWith("Durable user memory")
    );
    expect(durable).toBeUndefined();
    expect(r.usedDurableMemory).toBe(false);
  });

  it("does not inject durable memory when user has disabled the setting", async () => {
    mockGetByConversation.mockResolvedValue(null);
    mockGetActiveSummary.mockResolvedValue(null);
    mockGetRecentMessages.mockResolvedValue([]);
    mockGetSettingValue.mockResolvedValue("false");
    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "v2-x",
      currentUserMessage: "hi",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    expect(mockDurableRetrieve).not.toHaveBeenCalled();
    expect(r.usedDurableMemory).toBe(false);
  });
});

// Note on the length-based skip assertions below: they assume the background
// state produced by the default mocks (no durable memory block, no compact/session
// memory). If those defaults ever change, the length-2 expectation will need
// updating — that's intentional coupling, not a bug.
describe("AIChatContextAssembler — custom context directive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mockGetByConversation.mockResolvedValue(null);
    mockGetActiveSummary.mockResolvedValue(null);
    mockGetRecentMessages.mockResolvedValue([]);
    // Discriminate by key so memory-injection toggle stays at its default
    // (null → enabled, but retrieve returns empty) while the directive's
    // value is controlled per-test.
    mockGetSettingValue.mockImplementation((key: string) => {
      if (key === ai_custom_context_directive) return Promise.resolve("");
      return Promise.resolve(null);
    });
  });

  it("injects directive as a system message right after the base system prompt", async () => {
    mockGetSettingValue.mockImplementation((key: string) => {
      if (key === ai_custom_context_directive)
        return Promise.resolve("Always answer concisely.");
      return Promise.resolve(null);
    });

    const assembler = new AIChatContextAssembler();
    const result = await assembler.assemble({
      conversationId: "conv-test",
      currentUserMessage: "hello",
      baseSystemPrompt: "you are helpful",
      mode: "chat",
    });

    expect(result.messages[0]).toEqual({
      role: "system",
      content: "you are helpful",
    });
    expect(result.messages[1]).toEqual({
      role: "system",
      content: "Always answer concisely.",
    });
    expect(mockGetSettingValue).toHaveBeenCalledWith(
      ai_custom_context_directive
    );
    expect(result.messages[result.messages.length - 1]).toEqual({
      role: "user",
      content: "hello",
    });
  });

  it("skips injection when the setting value is empty", async () => {
    mockGetSettingValue.mockImplementation((key: string) => {
      if (key === ai_custom_context_directive) return Promise.resolve("");
      return Promise.resolve(null);
    });

    const assembler = new AIChatContextAssembler();
    const result = await assembler.assemble({
      conversationId: "conv-test",
      currentUserMessage: "hello",
      baseSystemPrompt: "you are helpful",
      mode: "chat",
    });

    expect(result.messages[0]).toEqual({
      role: "system",
      content: "you are helpful",
    });
    expect(
      result.messages.some(
        (message) =>
          message.role === "system" &&
          typeof message.content === "string" &&
          message.content.includes("Environment & System Context")
      )
    ).toBe(true);
    expect(result.messages.some((message) => message.content === "")).toBe(
      false
    );
    expect(result.messages[result.messages.length - 1]).toEqual({
      role: "user",
      content: "hello",
    });
  });

  it("skips injection when the setting value is whitespace-only", async () => {
    mockGetSettingValue.mockImplementation((key: string) => {
      if (key === ai_custom_context_directive)
        return Promise.resolve("   \n  ");
      return Promise.resolve(null);
    });

    const assembler = new AIChatContextAssembler();
    const result = await assembler.assemble({
      conversationId: "conv-test",
      currentUserMessage: "hello",
      baseSystemPrompt: "you are helpful",
      mode: "chat",
    });

    expect(result.messages[0]).toEqual({
      role: "system",
      content: "you are helpful",
    });
    expect(
      result.messages.some(
        (message) =>
          message.role === "system" &&
          typeof message.content === "string" &&
          message.content.includes("Environment & System Context")
      )
    ).toBe(true);
    expect(
      result.messages.some((message) => message.content === "   \n  ")
    ).toBe(false);
    expect(result.messages[result.messages.length - 1]).toEqual({
      role: "user",
      content: "hello",
    });
  });

  it("skips injection and does not throw when the setting read fails", async () => {
    mockGetSettingValue.mockImplementation((key: string) => {
      if (key === ai_custom_context_directive)
        return Promise.reject(new Error("sqlite locked"));
      return Promise.resolve(null);
    });

    const assembler = new AIChatContextAssembler();
    const result = await assembler.assemble({
      conversationId: "conv-test",
      currentUserMessage: "hello",
      baseSystemPrompt: "you are helpful",
      mode: "chat",
    });

    // Should not throw. Directive is not injected.
    expect(result.messages[0]).toEqual({
      role: "system",
      content: "you are helpful",
    });
    expect(
      result.messages.some(
        (message) =>
          message.role === "system" &&
          typeof message.content === "string" &&
          message.content.includes("Environment & System Context")
      )
    ).toBe(true);
    expect(
      result.messages.some((message) => message.content === "sqlite locked")
    ).toBe(false);
    expect(result.messages[result.messages.length - 1]).toEqual({
      role: "user",
      content: "hello",
    });
  });
});

describe("AIChatContextAssembler — built-in tool capabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mockGetByConversation.mockResolvedValue(null);
    mockGetActiveSummary.mockResolvedValue(null);
    mockGetRecentMessages.mockResolvedValue([]);
    mockGetSettingValue.mockResolvedValue(null);
    mockListActiveForRuntime.mockResolvedValue([]);
  });

  it("injects the built-in tool capabilities table as a system message", async () => {
    const assembler = new AIChatContextAssembler();
    const result = await assembler.assemble({
      conversationId: "conv-caps",
      currentUserMessage: "show result in html",
      baseSystemPrompt: "you are helpful",
      mode: "chat",
    });

    const guidance = result.messages.find(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.includes("Built-in Tool Capabilities")
    );
    expect(guidance).toBeTruthy();
    // The table covers the HTML artifact capability plus the discovery
    // fallback, and steers the model away from substituting file_read.
    expect(guidance!.content).toContain("create_html_artifact");
    expect(guidance!.content).toContain("file_read");
    expect(guidance!.content).toContain("tool_catalog_search");
  });

  it("injects the capabilities table even for a plain conversational message", async () => {
    const assembler = new AIChatContextAssembler();
    const result = await assembler.assemble({
      conversationId: "conv-caps",
      currentUserMessage: "what is the weather today",
      baseSystemPrompt: "you are helpful",
      mode: "chat",
    });

    const guidance = result.messages.find(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.includes("Built-in Tool Capabilities")
    );
    // Guidance is always injected (cheap, static) so the model knows the
    // intent to reach for the artifact tool before it is promoted.
    expect(guidance).toBeTruthy();
  });

  describe("approved plan execution context injection", () => {
    const approvedPlanState = {
      conversationId: "v2-conv",
      planId: "plan-1",
      status: "approved" as const,
      title: "Campaign plan",
      objective: "Launch a Facebook campaign",
      currentVersion: 1,
      approvedAt: "2026-09-03T12:00:00.000Z",
      latestVersion: {
        planId: "plan-1",
        version: 1,
        planMarkdown: "# Campaign plan\n1. Step one\n2. Step two",
        createdAt: "2026-09-03T11:00:00.000Z",
        createdBy: "assistant" as const,
      },
    };

    beforeEach(() => {
      mockGetByConversation.mockResolvedValue(null);
      mockGetActiveSummary.mockResolvedValue(null);
      mockGetRecentMessages.mockResolvedValue([]);
    });

    it("injects approved plan markdown in chat mode (execution round)", async () => {
      // Regression core: after the user approves the plan, the chat returns to
      // "chat" mode (buildPlanModeSystemPrompt is skipped), but the model must
      // still see the plan steps to execute them.
      const assembler = new AIChatContextAssembler();
      const result = await assembler.assemble({
        conversationId: "v2-conv",
        currentUserMessage:
          "Plan approved. Please begin executing the plan now.",
        baseSystemPrompt: "you are helpful",
        mode: "chat",
        planState: approvedPlanState,
      });

      const planBlock = result.messages.find(
        (m) =>
          m.role === "system" &&
          typeof m.content === "string" &&
          m.content.includes("Approved Plan — Execution Context")
      );
      expect(planBlock).toBeTruthy();
      expect(planBlock!.content).toContain("# Campaign plan");
      expect(planBlock!.content).toContain("Step one");
      expect(planBlock!.content).toContain("Step two");
      expect(planBlock!.content).toContain("Status: approved");
    });

    it("does NOT inject the approved-plan block in plan mode (plan-mode prompt already carries it)", async () => {
      const assembler = new AIChatContextAssembler();
      const result = await assembler.assemble({
        conversationId: "v2-conv",
        currentUserMessage: "continue planning",
        baseSystemPrompt: "you are helpful",
        mode: "plan",
        planState: approvedPlanState,
      });

      const duplicateBlock = result.messages.filter(
        (m) =>
          m.role === "system" &&
          typeof m.content === "string" &&
          m.content.includes("Approved Plan — Execution Context")
      );
      // Plan mode uses buildPlanModeSystemPrompt which already inlines the
      // markdown; the standalone block must not be duplicated.
      expect(duplicateBlock).toHaveLength(0);
    });

    it("does not inject the block when there is no approved plan", async () => {
      const assembler = new AIChatContextAssembler();
      const result = await assembler.assemble({
        conversationId: "v2-conv",
        currentUserMessage: "hello",
        baseSystemPrompt: "you are helpful",
        mode: "chat",
        planState: null,
      });

      const planBlock = result.messages.find(
        (m) =>
          m.role === "system" &&
          typeof m.content === "string" &&
          m.content.includes("Approved Plan — Execution Context")
      );
      expect(planBlock).toBeUndefined();
    });

    it("does not inject the block for a plan that is only awaiting approval", async () => {
      const assembler = new AIChatContextAssembler();
      const result = await assembler.assemble({
        conversationId: "v2-conv",
        currentUserMessage: "looks good",
        baseSystemPrompt: "you are helpful",
        mode: "plan",
        planState: { ...approvedPlanState, status: "awaiting_approval" },
      });

      const planBlock = result.messages.find(
        (m) =>
          m.role === "system" &&
          typeof m.content === "string" &&
          m.content.includes("Approved Plan — Execution Context")
      );
      expect(planBlock).toBeUndefined();
    });
  });
});

describe("AIChatContextAssembler — turn-backed retention (FR-05)", () => {
  const trow = (
    id: number,
    messageId: string,
    role: string,
    content: string,
    ts: number,
    extra: Record<string, unknown> = {}
  ) =>
    ({
      id,
      messageId,
      conversationId: "v2-turns",
      role,
      content,
      timestamp: new Date(ts),
      messageType: "message",
      ...extra,
    }) as never;

  const toolRow = (
    id: number,
    messageId: string,
    kind: "call" | "result",
    toolCallId: string,
    ts: number
  ) =>
    ({
      id,
      messageId,
      conversationId: "v2-turns",
      role: kind === "call" ? "assistant" : "tool",
      content: kind === "call" ? "" : "tool output body",
      timestamp: new Date(ts),
      messageType: kind === "call" ? "tool_call" : "tool_result",
      metadata: JSON.stringify(
        kind === "call"
          ? { toolCallId, toolName: "search_tool", toolArguments: { q: "x" } }
          : { toolCallId, toolName: "search_tool", toolResult: { ok: true } }
      ),
    }) as never;

  function stubArchive(opts: {
    ranges: Array<{
      turnId: string;
      firstTimestampMs: number;
      firstRowId: number;
      lastTimestampMs: number;
      lastRowId: number;
    }>;
    rowsByTurn: Record<string, unknown[]>;
    live: unknown[];
  }) {
    return {
      getRecentTurnRanges: vi.fn().mockResolvedValue(opts.ranges),
      readTurnRows: vi
        .fn()
        .mockImplementation(
          (
            _conv: string,
            firstTs: number,
            firstRow: number,
            lastTs: number,
            lastRow: number
          ) => {
            const key = `${firstTs}:${firstRow}:${lastTs}:${lastRow}`;
            return Promise.resolve(opts.rowsByTurn[key] ?? []);
          }
        ),
      readRowsAfter: vi.fn().mockResolvedValue(opts.live),
    } as never;
  }

  beforeEach(() => {
    vi.clearAllMocks();
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
    mockGetByConversation.mockResolvedValue(null);
    mockGetActiveSummary.mockResolvedValue(null);
    mockGetRecentMessages.mockResolvedValue([]);
    mockGetSettingValue.mockResolvedValue(null);
    mockListActiveForRuntime.mockResolvedValue([]);
  });

  it("retains complete turns with tool exchanges (not a text-message count)", async () => {
    const turnA = [
      trow(1, "a-u", "user", "first task alpha", 1),
      trow(2, "a-a", "assistant", "working on alpha", 2),
    ];
    const turnB = [
      trow(3, "b-u", "user", "second task beta", 3),
      toolRow(4, "b-c", "call", "call-1", 4),
      toolRow(5, "b-r", "result", "call-1", 5),
      trow(6, "b-a", "assistant", "beta done", 6),
    ];
    const live = [trow(7, "live-u", "user", "please continue", 7)];
    const asm = new AIChatContextAssembler({
      archiveModule: stubArchive({
        ranges: [
          {
            turnId: "t-a",
            firstTimestampMs: 1,
            firstRowId: 1,
            lastTimestampMs: 2,
            lastRowId: 2,
          },
          {
            turnId: "t-b",
            firstTimestampMs: 3,
            firstRowId: 3,
            lastTimestampMs: 6,
            lastRowId: 6,
          },
        ],
        rowsByTurn: { "1:1:2:2": turnA, "3:3:6:6": turnB },
        live,
      }),
    });
    const r = await asm.assemble({
      conversationId: "v2-turns",
      currentUserMessage: "next",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    const contents = r.messages.map((m) => m.content);
    // Both complete turns verbatim, including the tool exchange as a unit.
    expect(contents).toContain("first task alpha");
    expect(contents).toContain("second task beta");
    expect(contents).toContain("beta done");
    expect(contents).toContain("please continue");
    const toolMsgs = r.messages.filter((m) => m.role === "tool");
    expect(toolMsgs.length).toBeGreaterThan(0);
    // Current user message exactly once, last.
    expect(r.messages[r.messages.length - 1]).toEqual({
      role: "user",
      content: "next",
    });
  });

  it("replaces an oversized turn with a retrievable receipt (never silent truncation)", async () => {
    const big = [
      trow(1, "big-u", "user", "huge turn body ".repeat(60), 1),
    ];
    const asm = new AIChatContextAssembler({
      archiveModule: stubArchive({
        ranges: [
          {
            turnId: "t-big",
            firstTimestampMs: 1,
            firstRowId: 1,
            lastTimestampMs: 1,
            lastRowId: 1,
          },
        ],
        rowsByTurn: { "1:1:1:1": big },
        live: [],
      }),
    });
    const r = await asm.assemble({
      conversationId: "v2-turns",
      currentUserMessage: "next",
      baseSystemPrompt: "sysp",
      mode: "chat",
      recentTurnTokenBudget: 100,
    });
    const receipt = r.messages.find(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.includes("Retained turn omitted")
    );
    expect(receipt).toBeTruthy();
    // Receipt names the boundary message ids for exact retrieval.
    expect(String(receipt!.content)).toContain("big-u");
    expect(String(receipt!.content)).toContain("conversation_history_read");
    // Raw oversized content is not loaded anywhere.
    expect(
      r.messages.some(
        (m) => typeof m.content === "string" && m.content.includes("huge turn body")
      )
    ).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("prefers the published generation boundary over a legacy summary (AC-19)", async () => {
    // Legacy summary claims coverage through t=100; the generation covers
    // through (t=50, row=5). The legacy timestamp trim must NOT apply: a row
    // at t=75 is kept verbatim (safe direction — never a silent gap), while
    // the legacy summary stays readable as labeled advisory context.
    mockGetActiveSummary.mockResolvedValue({
      summary: "legacy summary text",
      throughTimestamp: new Date(100).toISOString(),
    });
    const asm = new AIChatContextAssembler({
      compactionReader: {
        getActiveGenerationForConversation: vi.fn().mockResolvedValue({
          coveredThroughTimestampMs: 50,
          coveredThroughRowId: 5,
          overviewJson: JSON.stringify({
            synopsis: "gen overview",
            decisions: [],
            constraints: [],
            pending: [],
            toolOutcomes: [],
            topics: [],
          }),
        }),
      },
    });
    // Bypass turn retention (no archiveModule): fallback rows are the history.
    mockGetRecentMessages.mockResolvedValue([
      row({ id: 6, messageId: "m75", role: "user", content: "mid message", timestamp: new Date(75) }),
      row({ id: 9, messageId: "m9", role: "user", content: "new tail", timestamp: new Date(200) }),
    ]);
    const r = await asm.assemble({
      conversationId: "v2-x",
      currentUserMessage: "hi",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    const contents = r.messages.map((m) => m.content);
    // t=75 sits under the legacy timestamp but past the generation boundary:
    // kept verbatim (the legacy trim no longer applies once a generation
    // exists), plus the advisory legacy block.
    expect(contents).toContain("mid message");
    expect(contents).toContain("new tail");
    expect(
      r.messages.some(
        (m) =>
          m.role === "system" &&
          typeof m.content === "string" &&
          m.content.includes("Legacy compact summary (advisory")
      )
    ).toBe(true);
    expect(r.usedFullCompact).toBe(true);
  });
});
