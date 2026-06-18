// test/vitest/main/service/AIChatQueryEngine.auto-plan.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type {
  AIChatQueryEvent,
  AIChatQueryEventSink,
  AIChatQueryLoopInput,
  AIChatQueryLoopResult,
} from "@/service/AIChatQueryEvents";

/**
 * The engine reads Token settings at submitMessage time. Since Token is
 * backed by electron-store and isolated across instances in pure Node, we
 * cannot reliably mutate the setting from a test. Instead, we mock the
 * Token module so the engine observes controlled values.
 *
 * `vi.hoisted` runs the factory before any import, so the same store object
 * is shared between the hoisted mock and the test body below.
 */
const { tokenStore } = vi.hoisted(() => ({
  tokenStore: {} as Record<string, string>,
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: (key: string) => tokenStore[key] ?? "",
    setValue: (key: string, value: string) => {
      tokenStore[key] = value;
    },
  })),
}));

// --- Mock AIChatV2Module ------------------------------------------------
const mockSaveUserMessage = vi.fn().mockResolvedValue({ messageId: "user-1" });
const mockGetConversationMessages = vi.fn().mockResolvedValue([]);
const mockSaveAssistantMessage = vi.fn().mockResolvedValue({});
const mockSaveToolCallMessage = vi.fn().mockResolvedValue({});
const mockSaveToolResultMessage = vi.fn().mockResolvedValue({});
const mockCreateConversationIfNeeded = vi.fn().mockReturnValue("v2-test-auto");
const mockGetDefaultSystemPrompt = vi.fn().mockReturnValue("You are helpful.");

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    saveUserMessage: mockSaveUserMessage,
    getConversationMessages: mockGetConversationMessages,
    saveAssistantMessage: mockSaveAssistantMessage,
    saveToolCallMessage: mockSaveToolCallMessage,
    saveToolResultMessage: mockSaveToolResultMessage,
    createConversationIfNeeded: mockCreateConversationIfNeeded,
    getDefaultSystemPrompt: mockGetDefaultSystemPrompt,
  })),
}));

// --- Mock AIChatPlanModule ---------------------------------------------
vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: vi.fn().mockImplementation(() => ({
    getPlanState: vi.fn().mockResolvedValue(null),
    ensurePlanForConversation: vi.fn().mockResolvedValue(null),
    cancelDraft: vi.fn(),
    saveQuestion: vi.fn(),
    submitPlanForApproval: vi.fn(),
    getPlanStateByPlanId: vi.fn(),
    answerQuestion: vi.fn(),
  })),
}));

// --- Mock compact modules (used by default AIChatContextAssembler) -----
vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: vi.fn().mockImplementation(() => ({
    getByConversation: vi.fn().mockResolvedValue(null),
  })),
}));
vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: vi.fn().mockImplementation(() => ({
    getActiveSummary: vi.fn().mockResolvedValue(null),
  })),
}));

// --- Mock AiChatApi ----------------------------------------------------
vi.mock("@/api/aiChatApi", () => ({
  AiChatApi: vi.fn().mockImplementation(() => ({})),
}));

// --- Mock SkillRegistry ------------------------------------------------
vi.mock("@/config/skillsRegistry", () => ({
  SkillRegistry: {
    getAllToolFunctions: vi.fn().mockResolvedValue([]),
    getSkill: vi.fn().mockReturnValue(undefined),
  },
}));

// --- Mock SkillExecutor ------------------------------------------------
vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: { execute: vi.fn() },
}));

// --- Mock usersetting (preserve constants for non-Token paths) --------
vi.mock("@/config/usersetting", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/usersetting")>();
  return { ...actual };
});

function makeFakeLoop(): {
  loop: AIChatQueryLoop;
  lastInput: () => AIChatQueryLoopInput | undefined;
} {
  let lastInput: AIChatQueryLoopInput | undefined;
  const loop = {
    run: vi.fn(
      async (input: AIChatQueryLoopInput): Promise<AIChatQueryLoopResult> => {
        lastInput = input;
        return {
          type: "completed",
          conversationId: input.conversationId,
          assistantMessageId: input.assistantMessageId,
          fullContent: "",
          finishReason: "stop",
        };
      }
    ),
  };
  return {
    loop: loop as unknown as AIChatQueryLoop,
    lastInput: () => lastInput,
  };
}

describe("AIChatQueryEngine auto-plan wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // AI is enabled in all tests unless explicitly overridden; only
    // USER_AI_AUTO_PLAN varies.
    tokenStore["user_ai_enabled"] = "true";
    // Reset auto-plan between tests:
    delete tokenStore["user_ai_auto_plan"];
  });

  it("registers EnterPlanMode and passes autoPlan when USER_AI_AUTO_PLAN is enabled (default-on)", async () => {
    // default-on: do not set the key (empty string !== "false")
    const { loop, lastInput } = makeFakeLoop();
    const engine = new AIChatQueryEngine(loop);

    const events: AIChatQueryEvent[] = [];
    const sink: AIChatQueryEventSink = { emit: (e) => events.push(e) };

    await engine.submitMessage({
      eventSink: sink,
      request: {
        conversationId: "v2-test-auto",
        message: "build me a campaign",
      } as any,
    });

    const input = lastInput();
    expect(input).toBeDefined();
    expect(input!.openAITools.map((t) => t.function.name)).toContain(
      "EnterPlanMode"
    );
    expect(input!.autoPlan).toBeDefined();
    expect(input!.autoPlan!.planTools.map((t) => t.function.name)).toContain(
      "AskUserQuestion"
    );
    expect(input!.autoPlan!.planTools.map((t) => t.function.name)).toContain(
      "SubmitPlanForApproval"
    );
  });

  it("does NOT register EnterPlanMode when USER_AI_AUTO_PLAN === 'false'", async () => {
    tokenStore["user_ai_auto_plan"] = "false";
    const { loop, lastInput } = makeFakeLoop();
    const engine = new AIChatQueryEngine(loop);

    const sink: AIChatQueryEventSink = { emit: vi.fn() };
    await engine.submitMessage({
      eventSink: sink,
      request: {
        conversationId: "v2-test-off",
        message: "hello",
      } as any,
    });

    const input = lastInput();
    expect(input).toBeDefined();
    expect(input!.openAITools.map((t) => t.function.name)).not.toContain(
      "EnterPlanMode"
    );
    expect(input!.autoPlan).toBeUndefined();
  });

  it("does NOT register EnterPlanMode when AI is disabled, regardless of auto-plan setting", async () => {
    tokenStore["user_ai_enabled"] = "false";
    // auto-plan defaults on, but AI is off
    const { loop, lastInput } = makeFakeLoop();
    const engine = new AIChatQueryEngine(loop);

    const sink: AIChatQueryEventSink = { emit: vi.fn() };
    await engine.submitMessage({
      eventSink: sink,
      request: {
        conversationId: "v2-test-ai-off",
        message: "hello",
      } as any,
    });

    const input = lastInput();
    expect(input).toBeDefined();
    expect(input!.openAITools.map((t) => t.function.name)).not.toContain(
      "EnterPlanMode"
    );
    expect(input!.autoPlan).toBeUndefined();
  });
});
