// Integration test: pasted-text placeholders wired into AIChatQueryEngine.submitMessage.
// Proves the display/model split: persisted user message keeps placeholders, while
// the model receives expanded pasted content before @-mention resolution.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type { AIChatContextAssembler } from "@/service/AIChatContextAssembler";
import type {
  AIChatQueryEventSink,
  AIChatQueryLoopResult,
} from "@/service/AIChatQueryEvents";

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

let lastAtMentionMessageToSave: string | null = null;
vi.mock("@/service/aiChatAtMentions/AtMentionResolutionService", () => ({
  AtMentionResolutionService: vi.fn().mockImplementation(() => ({
    resolveMessage: vi
      .fn()
      .mockImplementation(
        async (_conversationId: string, messageToSave: string) => {
          lastAtMentionMessageToSave = messageToSave;
          return { modelMessage: messageToSave, metadata: [] };
        }
      ),
  })),
}));

import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";

describe("AIChatQueryEngine pasted text integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastAtMentionMessageToSave = null;
    ws.rootPath = "/tmp/aifetchly";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("expands pasted placeholders into the model message before @-mention resolution and persists placeholders + pastedBlocks metadata", async () => {
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

    const pastedBody = "alpha\nbeta\ngamma @src/main.ts#L1-2";
    const displayMessage = "before [Pasted text #1 +2 lines] after";

    await engine.submitMessage({
      eventSink,
      request: {
        message: displayMessage,
        pastedContents: { "1": pastedBody },
      },
    });

    // 1) Persisted user message keeps display placeholders.
    expect(mockSaveUserMessage).toHaveBeenCalledTimes(1);
    const saved = mockSaveUserMessage.mock.calls[0]?.[0] as {
      content: string;
      metadata?: { pastedBlocks?: unknown[] };
    };
    expect(saved.content).toBe(displayMessage);
    expect(saved.metadata?.pastedBlocks).toBeDefined();
    expect(saved.metadata?.pastedBlocks).toHaveLength(1);

    const block = saved.metadata?.pastedBlocks?.[0] as {
      kind?: string;
      inlineContent?: string;
      lineCount?: number;
      charCount?: number;
    };
    expect(block.kind).toBe("full");
    expect(block.lineCount).toBe(2);
    expect(block.inlineContent).toBe(pastedBody);
    expect(block.charCount).toBe(pastedBody.length);

    // 2) The model sees expanded pasted content (no placeholder remains).
    expect(contextAssembler.assemble).toHaveBeenCalledTimes(1);
    const modelMessage = assembledMessages[0]?.content ?? "";
    expect(modelMessage).toBe(`before ${pastedBody} after`);
    expect(modelMessage).not.toContain("[Pasted text #1");

    // 3) @-mention resolution runs after paste expansion.
    expect(lastAtMentionMessageToSave).toBe(`before ${pastedBody} after`);
  });
});
