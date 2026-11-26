import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import type {
  AIChatQueryEvent,
  AIChatQueryLoopInput,
  PendingPermissionTurn,
  PendingPlanQuestionTurn,
} from "@/service/AIChatQueryEvents";
import type { OpenAIChatMessage } from "@/api/aiChatApi";
import { SkillExecutor } from "@/service/SkillExecutor";

const {
  mockSaveAssistantMessage,
  mockSaveToolResultMessage,
  mockAnswerQuestion,
  mockGetQuestionById,
  mockGetPlanStateByPlanId,
} = vi.hoisted(() => ({
  mockSaveAssistantMessage: vi.fn().mockResolvedValue({}),
  mockSaveToolResultMessage: vi.fn().mockResolvedValue({}),
  mockAnswerQuestion: vi.fn().mockResolvedValue(undefined),
  mockGetQuestionById: vi.fn().mockResolvedValue({ answers: [] }),
  mockGetPlanStateByPlanId: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/config/featureFlags", async () => {
  const actual = await vi.importActual<
    typeof import("@/config/featureFlags")
  >("@/config/featureFlags");
  return {
    ...actual,
    isToolOutputCaptureEnabled: (): boolean => false,
    isToolOutputModelRefsEnabled: (): boolean => false,
  };
});

vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: { execute: vi.fn() },
}));

vi.mock("@/config/skillsRegistry", () => ({
  SkillRegistry: {
    getAllToolFunctions: vi.fn().mockResolvedValue([]),
    isPlanSafe: vi.fn().mockReturnValue(true),
  },
}));

vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: vi.fn().mockImplementation(function () {
    return {
      answerQuestion: mockAnswerQuestion,
      getQuestionById: mockGetQuestionById,
      getPlanStateByPlanId: mockGetPlanStateByPlanId,
      saveQuestion: vi.fn(),
      submitPlanForApproval: vi.fn(),
    };
  }),
}));

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(function () {
    return {
      saveAssistantMessage: mockSaveAssistantMessage,
      saveToolResultMessage: mockSaveToolResultMessage,
      createConversationIfNeeded: vi.fn().mockReturnValue("conv-turn-id"),
      getConversationMessages: vi.fn().mockResolvedValue([]),
      getRecentMessages: vi.fn().mockResolvedValue([]),
      saveUserMessage: vi.fn(),
      saveToolCallMessage: vi.fn(),
      getDefaultSystemPrompt: vi.fn().mockReturnValue("You are helpful."),
    };
  }),
}));

function makeStubLoop(conversationId: string, assistantMessageId: string): {
  run: ReturnType<typeof vi.fn>;
} {
  return {
    run: vi.fn().mockResolvedValue({
      type: "completed",
      content: "Resumed answer",
      fullContent: "Resumed answer",
      conversationId,
      assistantMessageId,
      model: "gpt-4o",
      totalTokens: 15,
      responseId: "resp-1",
      finishReason: "stop",
      messages: [],
    }),
  };
}

function makeEngine(stubLoop: { run: ReturnType<typeof vi.fn> }): AIChatQueryEngine {
  return new AIChatQueryEngine(stubLoop as never, {
    streamChatCompletion: vi.fn(),
    executeTool: vi.fn(),
    getSkillDefinition: () => undefined,
  } as never);
}

describe("AIChatQueryEngine resume turnId preservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (SkillExecutor.execute as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      tool_call_id: "call_perm_1",
      tool_name: "send_email",
      success: true,
      result: { sent: true },
      execution_time_ms: 5,
    });
  });

  it("preserves turnId on saved assistant message after permission resume", async () => {
    const events: AIChatQueryEvent[] = [];
    const stubLoop = makeStubLoop("conv-perm", "asst-perm-1");
    const engine = makeEngine(stubLoop);
    const messages: OpenAIChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "send outreach email" },
    ];

    const pendingPerm: PendingPermissionTurn = {
      conversationId: "conv-perm",
      assistantMessageId: "asst-perm-1",
      conversationMessages: messages,
      abortController: new AbortController(),
      request: {
        message: "send outreach email",
        model: "gpt-4o",
        conversationId: "conv-perm",
      },
      openAITools: [],
      nextRound: 1,
      toolCallId: "call_perm_1",
      toolName: "send_email",
      toolArguments: { to: "a@example.com" },
      turnId: "turn-perm-1",
    };

    const internal = engine as unknown as {
      pendingPermissions: Map<string, PendingPermissionTurn>;
      pendingSinks: Map<string, { emit: (e: AIChatQueryEvent) => void }>;
    };
    internal.pendingPermissions.set("conv-perm", pendingPerm);
    internal.pendingSinks.set("conv-perm", {
      emit: (e: AIChatQueryEvent) => events.push(e),
    });

    const result = await engine.resumeToolAfterPermission({
      toolId: "call_perm_1",
      conversationId: "conv-perm",
      approved: true,
    } as never);
    expect(result.ok).toBe(true);

    await vi.waitFor(() => {
      expect(events.some((e) => e.type === "complete")).toBe(true);
    });

    expect(stubLoop.run).toHaveBeenCalledTimes(1);
    const loopInput = stubLoop.run.mock.calls[0][0] as AIChatQueryLoopInput;
    expect(loopInput.turnId).toBe("turn-perm-1");

    expect(mockSaveAssistantMessage).toHaveBeenCalledTimes(1);
    const saved = mockSaveAssistantMessage.mock.calls[0][0] as {
      metadata?: { turnId?: string };
    };
    expect(saved.metadata?.turnId).toBe("turn-perm-1");
  });

  it("preserves turnId on loopInput and saved assistant message after AskUserQuestion resume", async () => {
    const events: AIChatQueryEvent[] = [];
    const stubLoop = makeStubLoop("conv-plan", "asst-plan-1");
    const engine = makeEngine(stubLoop);
    const messages: OpenAIChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "build a marketing campaign" },
    ];

    const pendingQuestion: PendingPlanQuestionTurn = {
      conversationId: "conv-plan",
      assistantMessageId: "asst-plan-1",
      conversationMessages: messages,
      abortController: new AbortController(),
      request: {
        message: "build a marketing campaign",
        model: "gpt-4o",
        conversationId: "conv-plan",
      },
      openAITools: [],
      nextRound: 1,
      toolCallId: "call_q_1",
      questionId: "q-1",
      planId: "plan-1",
      turnId: "turn-plan-1",
    };

    const internal = engine as unknown as {
      pendingPlanQuestions: Map<string, PendingPlanQuestionTurn>;
      pendingSinks: Map<string, { emit: (e: AIChatQueryEvent) => void }>;
    };
    internal.pendingPlanQuestions.set("conv-plan", pendingQuestion);
    internal.pendingSinks.set("conv-plan", {
      emit: (e: AIChatQueryEvent) => events.push(e),
    });

    const result = await engine.answerPlanQuestion({
      conversationId: "conv-plan",
      questionId: "q-1",
      answers: [],
    });
    expect(result.ok).toBe(true);

    await vi.waitFor(() => {
      expect(events.some((e) => e.type === "complete")).toBe(true);
    });

    expect(stubLoop.run).toHaveBeenCalledTimes(1);
    const loopInput = stubLoop.run.mock.calls[0][0] as AIChatQueryLoopInput;
    expect(loopInput.turnId).toBe("turn-plan-1");

    expect(mockSaveAssistantMessage).toHaveBeenCalledTimes(1);
    const saved = mockSaveAssistantMessage.mock.calls[0][0] as {
      metadata?: { turnId?: string };
    };
    expect(saved.metadata?.turnId).toBe("turn-plan-1");
  });
});
