// test/vitest/main/service/AIChatQueryEngine.goalPlanQueue.test.ts
//
// Regression tests for the queued /goal Plan Mode dispatch (bug: SubmitPlanForApproval
// returned "Unknown tool"). The renderer sends the /goal plan prompt with
// request.mode === "plan" and the message persists as a pending row, so the turn is
// dispatched through engine.submitPersistedUserMessage — the queue path. That path
// only READ plan state; it never created the missing draft plan the way the direct
// path (runTurn) does. With planState === null, runPersistedTurn advertised
// AskUserQuestion/SubmitPlanForApproval to the model but built no planContext, so
// the loop never intercepted the calls and they fell through to ToolExecutor,
// which has no such case → "Unknown tool: SubmitPlanForApproval".
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type {
  AIChatQueryEvent,
  AIChatQueryEventSink,
  AIChatQueryLoopInput,
  AIChatQueryLoopResult,
} from "@/service/AIChatQueryEvents";
import type { ChatV2StreamRequest } from "@/entityTypes/aiChatV2Types";
import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";

/**
 * Mock handles are created inside vi.hoisted so the hoisted vi.mock factories
 * can reference them and the test body can assert on them.
 */
const { tokenStore, planGetPlanState, planEnsurePlanForConversation } =
  vi.hoisted(() => ({
    tokenStore: {} as Record<string, string>,
    planGetPlanState: vi.fn(),
    planEnsurePlanForConversation: vi.fn(),
  }));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(function () {
    return {
      getValue: (key: string) => tokenStore[key] ?? "",
      setValue: (key: string, value: string) => {
        tokenStore[key] = value;
      },
    };
  }),
}));

// --- Mock AIChatV2Module ------------------------------------------------
vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(function () {
    return {
      saveUserMessage: vi.fn().mockResolvedValue({ messageId: "user-1" }),
      getConversationMessages: vi.fn().mockResolvedValue([]),
      getRecentMessages: vi.fn().mockResolvedValue([]),
      saveAssistantMessage: vi.fn().mockResolvedValue({}),
      saveToolCallMessage: vi.fn().mockResolvedValue({}),
      saveToolResultMessage: vi.fn().mockResolvedValue({}),
      createConversationIfNeeded: vi.fn().mockReturnValue("v2-plan-queue"),
      getDefaultSystemPrompt: vi.fn().mockReturnValue("You are helpful."),
      mergeMessageMetadata: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

// --- Mock AIChatPlanModule ---------------------------------------------
vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: vi.fn().mockImplementation(function () {
    return {
      getPlanState: planGetPlanState,
      ensurePlanForConversation: planEnsurePlanForConversation,
      cancelDraft: vi.fn(),
      saveQuestion: vi.fn(),
      submitPlanForApproval: vi.fn(),
      getPlanStateByPlanId: vi.fn(),
      answerQuestion: vi.fn(),
    };
  }),
}));

// --- Mock outbound-email intent (queued turns bind intent at dispatch) --
vi.mock("@/modules/OutboundEmailIntentModule", () => ({
  OutboundEmailIntentModule: vi.fn().mockImplementation(function () {
    return {
      findBySource: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 1 }),
      updateDecision: vi.fn(),
    };
  }),
}));

// --- Mock compact modules (used by default AIChatContextAssembler) -----
vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: vi.fn().mockImplementation(function () {
    return {
      getByConversation: vi.fn().mockResolvedValue(null),
    };
  }),
}));
vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: vi.fn().mockImplementation(function () {
    return {
      getActiveSummary: vi.fn().mockResolvedValue(null),
    };
  }),
}));

vi.mock("@/modules/AgentDefinitionModule", () => ({
  AgentDefinitionModule: vi.fn().mockImplementation(function () {
    return {
      listActiveForRuntime: vi.fn().mockResolvedValue([]),
    };
  }),
}));

// --- Mock AiChatApi ----------------------------------------------------
vi.mock("@/api/aiChatApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/aiChatApi")>();
  return {
    ...actual,
    AiChatApi: vi.fn().mockImplementation(function () {
      return {};
    }),
  };
});

vi.mock("@/service/DesktopNotifyService", () => ({
  DesktopNotifyService: {
    getInstance: () => ({
      show: vi.fn().mockResolvedValue(false),
    }),
  },
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

function makeDraftPlanState(): AIChatPlanStateView {
  return {
    planId: "plan-queued-1",
    conversationId: "v2-plan-queue",
    status: "draft",
    title: "New plan",
    objective: "find 100 software distributor in USA",
    currentVersion: 0,
  };
}

describe("AIChatQueryEngine queued /goal plan-mode dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tokenStore["user_ai_enabled"] = "true";
    delete tokenStore["user_ai_auto_plan"];
    planGetPlanState.mockResolvedValue(null);
    planEnsurePlanForConversation.mockResolvedValue(makeDraftPlanState());
  });

  it("creates the draft plan for a queued mode-plan turn so plan tools are intercepted", async () => {
    const { loop, lastInput } = makeFakeLoop();
    const engine = new AIChatQueryEngine(loop);

    const events: AIChatQueryEvent[] = [];
    const sink: AIChatQueryEventSink = { emit: (e) => events.push(e) };

    const request: ChatV2StreamRequest = {
      conversationId: "v2-plan-queue",
      message: "Plan how to accomplish this goal: find 100 software distributor in USA",
      mode: "plan",
    };
    const savedUser = {
      messageId: "user-pending-pending-1",
      conversationId: "v2-plan-queue",
    } as unknown as AIChatMessageEntity;

    await engine.submitPersistedUserMessage({
      eventSink: sink,
      request,
      savedUser,
      modelContent: request.message,
    });

    // The queue path must create the missing draft plan (direct-path parity).
    expect(planEnsurePlanForConversation).toHaveBeenCalledTimes(1);
    expect(planEnsurePlanForConversation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "v2-plan-queue" })
    );

    const input = lastInput();
    expect(input).toBeDefined();

    // planContext must exist so the loop intercepts AskUserQuestion /
    // SubmitPlanForApproval instead of letting them fall through to
    // ToolExecutor ("Unknown tool").
    expect(input!.planContext).toBeDefined();
    expect(input!.planContext!.planState.planId).toBe("plan-queued-1");
    expect(input!.planContext!.planState.status).toBe("draft");

    // The plan tools that get advertised must actually be handled: plan
    // mode advertises them, so planContext has to be present.
    const toolNames = input!.openAITools.map((t) => t.function.name);
    expect(toolNames).toContain("AskUserQuestion");
    expect(toolNames).toContain("SubmitPlanForApproval");
    expect(input!.planContext!.planModule.submitPlanForApproval).toBeDefined();
  });

  it("does not create a second plan when one already exists", async () => {
    planGetPlanState.mockResolvedValue(makeDraftPlanState());
    const { loop, lastInput } = makeFakeLoop();
    const engine = new AIChatQueryEngine(loop);

    const sink: AIChatQueryEventSink = { emit: vi.fn() };
    const request: ChatV2StreamRequest = {
      conversationId: "v2-plan-queue",
      message: "continue planning",
      mode: "plan",
    };
    const savedUser = {
      messageId: "user-pending-pending-2",
      conversationId: "v2-plan-queue",
    } as unknown as AIChatMessageEntity;

    await engine.submitPersistedUserMessage({
      eventSink: sink,
      request,
      savedUser,
      modelContent: request.message,
    });

    expect(planEnsurePlanForConversation).not.toHaveBeenCalled();
    const input = lastInput();
    expect(input).toBeDefined();
    expect(input!.planContext).toBeDefined();
    expect(input!.planContext!.planState.planId).toBe("plan-queued-1");
  });

  it("does not create a plan for an ordinary queued chat turn", async () => {
    const { loop, lastInput } = makeFakeLoop();
    const engine = new AIChatQueryEngine(loop);

    const sink: AIChatQueryEventSink = { emit: vi.fn() };
    const request: ChatV2StreamRequest = {
      conversationId: "v2-plan-queue",
      message: "hello",
      mode: "chat",
    };
    const savedUser = {
      messageId: "user-pending-pending-3",
      conversationId: "v2-plan-queue",
    } as unknown as AIChatMessageEntity;

    await engine.submitPersistedUserMessage({
      eventSink: sink,
      request,
      savedUser,
      modelContent: request.message,
    });

    expect(planEnsurePlanForConversation).not.toHaveBeenCalled();
    const input = lastInput();
    expect(input).toBeDefined();
    expect(input!.planContext).toBeUndefined();
  });
});
