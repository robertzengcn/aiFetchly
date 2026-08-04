// Integration test: @-mention resolution wired into AIChatQueryEngine.submitMessage.
// Proves the display/model split: the persisted user message keeps the original
// text + atMentions metadata, while the model receives an enriched message.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type { AIChatContextAssembler } from "@/service/AIChatContextAssembler";
import type {
  AIChatQueryEventSink,
  AIChatQueryLoopResult,
} from "@/service/AIChatQueryEvents";

// Mutable holder so the hoisted WorkspaceResolver mock can read the tmp path.
const ws = vi.hoisted(() => ({ rootPath: "" }));

const mockSaveUserMessage = vi.fn().mockResolvedValue({ messageId: "user-1" });

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    saveUserMessage: mockSaveUserMessage,
    getConversationMessages: vi.fn().mockResolvedValue([]),
    saveAssistantMessage: vi.fn().mockResolvedValue({}),
    saveToolCallMessage: vi.fn().mockResolvedValue({}),
    saveToolResultMessage: vi.fn().mockResolvedValue({}),
    createConversationIfNeeded: vi.fn().mockReturnValue("v2-test-conv"),
    getDefaultSystemPrompt: vi.fn().mockReturnValue("You are helpful."),
  })),
}));

vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: vi.fn().mockImplementation(() => ({
    getPlanState: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock("@/service/WorkspaceResolver", () => ({
  WorkspaceResolver: vi.fn().mockImplementation(() => ({
    resolve: vi
      .fn()
      .mockResolvedValue({ workspaceId: 1, rootPath: ws.rootPath }),
  })),
}));

vi.mock("@/config/skillsRegistry", () => ({
  SkillRegistry: {
    getAllToolFunctions: vi.fn().mockResolvedValue([]),
    getSkill: vi.fn().mockReturnValue(undefined),
  },
}));

vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: { execute: vi.fn() },
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn().mockReturnValue("true"),
  })),
}));

vi.mock("@/api/aiChatApi", () => ({ AiChatApi: vi.fn() }));

import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";

describe("AIChatQueryEngine @-mention integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eng-atm-"));
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "src", "main.ts"), "alpha\nbeta\ngamma");
    ws.rootPath = tmpDir;
    vi.clearAllMocks();
    mockSaveUserMessage.mockResolvedValue({ messageId: "user-1" });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("persists the original display text with atMentions metadata and sends the model an enriched message", async () => {
    const assembledMessages: { content: string }[] = [];
    const contextAssembler = {
      assemble: vi
        .fn()
        .mockImplementation(async (input: { currentUserMessage: string }) => {
          assembledMessages.push({ content: input.currentUserMessage });
          return { messages: [] };
        }),
    } as unknown as AIChatContextAssembler;

    const completed: AIChatQueryLoopResult = {
      type: "completed",
      conversationId: "v2-test-conv",
      assistantMessageId: "assistant-1",
      fullContent: "",
      model: undefined,
      finishReason: "stop",
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
    };
    const loop = {
      run: vi.fn().mockResolvedValue(completed),
    } as unknown as AIChatQueryLoop;

    const engine = new AIChatQueryEngine(loop, { contextAssembler });
    const eventSink: AIChatQueryEventSink = { emit: vi.fn() };

    await engine.submitMessage({
      eventSink,
      request: { message: "explain @src/main.ts#L1-2 please" },
    });

    // 1. Persisted user message keeps the ORIGINAL display text.
    expect(mockSaveUserMessage).toHaveBeenCalledTimes(1);
    const saved = mockSaveUserMessage.mock.calls[0]?.[0] as {
      content: string;
      metadata?: { atMentions?: unknown[] };
    };
    expect(saved.content).toBe("explain @src/main.ts#L1-2 please");

    // 2. atMentions metadata is persisted.
    expect(saved.metadata?.atMentions).toBeDefined();
    expect(saved.metadata?.atMentions?.length).toBe(1);

    // 3. The model receives the enriched message (context block appended).
    expect(contextAssembler.assemble).toHaveBeenCalledTimes(1);
    const modelMessage = assembledMessages[0]?.content ?? "";
    expect(modelMessage).toContain("explain @src/main.ts#L1-2 please");
    expect(modelMessage).toContain("<mentioned_workspace_context>");
    expect(modelMessage).toContain("1: alpha");
    expect(modelMessage).toContain("2: beta");
  });

  it("sends the original message unchanged when there are no mentions", async () => {
    const assembleMock = vi.fn().mockResolvedValue({ messages: [] });
    const contextAssembler = {
      assemble: assembleMock,
    } as unknown as AIChatContextAssembler;
    const completed: AIChatQueryLoopResult = {
      type: "completed",
      conversationId: "v2-test-conv",
      assistantMessageId: "assistant-1",
      fullContent: "",
      model: undefined,
      finishReason: "stop",
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
    };
    const loop = {
      run: vi.fn().mockResolvedValue(completed),
    } as unknown as AIChatQueryLoop;
    const engine = new AIChatQueryEngine(loop, { contextAssembler });
    const eventSink: AIChatQueryEventSink = { emit: vi.fn() };

    await engine.submitMessage({
      eventSink,
      request: { message: "just a normal question" },
    });

    const saved = mockSaveUserMessage.mock.calls[0]?.[0] as {
      content: string;
      metadata?: { atMentions?: unknown[] };
    };
    expect(saved.content).toBe("just a normal question");
    expect(saved.metadata?.atMentions).toBeUndefined();
    expect(assembleMock.mock.calls[0]?.[0]?.currentUserMessage).toBe(
      "just a normal question"
    );
  });
});
