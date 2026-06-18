import { describe, it, expect, vi } from "vitest";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import { ENTER_PLAN_MODE_TOOL } from "@/service/EnterPlanModeTool";
import { PlanModeToolRegistry } from "@/service/PlanModeToolRegistry";
import type {
  AIChatAutoPlanLoopConfig,
  AIChatQueryEventSink,
  AIChatQueryLoopInput,
} from "@/service/AIChatQueryEvents";
import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";

/**
 * Fake streamChatCompletion that emits a scripted assistant response per round.
 * Each response is a single chunk with optional content and tool_calls.
 */
function makeScriptedStream(
  responses: Array<{
    content?: string;
    toolCalls?: Array<{
      index: number;
      id: string;
      function: { name: string; arguments: string };
    }>;
  }>
) {
  let call = 0;
  return vi.fn(async (_req: any, onChunk: (c: any) => void) => {
    const r = responses[Math.min(call, responses.length - 1)];
    call += 1;
    onChunk({
      choices: [
        {
          delta: {
            content: r.content ?? "",
            tool_calls: r.toolCalls,
            role: "assistant",
          },
          finish_reason: r.toolCalls ? "tool_calls" : "stop",
        },
      ],
    });
  });
}

describe("AIChatQueryLoop auto-plan transition", () => {
  it("transitions into plan mode when the model calls EnterPlanMode", async () => {
    const planState: AIChatPlanStateView = {
      planId: "plan-test-1",
      conversationId: "v2-conv-1",
      status: "draft",
      title: "Test",
      objective: "test objective",
      currentVersion: 0,
    } as AIChatPlanStateView;

    const ensurePlan = vi.fn().mockResolvedValue(planState);
    const planTools = PlanModeToolRegistry.toOpenAITools();
    const autoPlan: AIChatAutoPlanLoopConfig = {
      planModule: {
        ensurePlanForConversation: ensurePlan,
        cancelDraft: vi.fn(),
        saveQuestion: vi.fn(),
        submitPlanForApproval: vi.fn(),
        getPlanStateByPlanId: vi.fn(),
        answerQuestion: vi.fn(),
      },
      planTools,
    };

    const events: any[] = [];
    const eventSink: AIChatQueryEventSink = { emit: (e) => events.push(e) };

    const stream = makeScriptedStream([
      {
        toolCalls: [
          {
            index: 0,
            id: "call_enter",
            function: {
              name: "EnterPlanMode",
              arguments: '{"rationale":"complex campaign"}',
            },
          },
        ],
      },
      { content: "I will now plan." },
    ]);

    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream as any,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    });

    const messages: any[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "build me a campaign" },
    ];

    const input: AIChatQueryLoopInput = {
      conversationId: "v2-conv-1",
      assistantMessageId: "asst-1",
      messages,
      request: { message: "build me a campaign" } as any,
      openAITools: [ENTER_PLAN_MODE_TOOL],
      abortController: new AbortController(),
      eventSink,
      startRound: 0,
      autoPlan,
      isActiveTurn: () => true,
    };

    const result = await loop.run(input);

    expect(result.type).toBe("completed");
    expect(ensurePlan).toHaveBeenCalledWith({
      conversationId: "v2-conv-1",
      title: "build me a campaign".slice(0, 80),
      objective: expect.any(String),
    });
    const planStateEvent = events.find((e) => e.type === "plan_state");
    expect(planStateEvent).toBeDefined();
    expect(planStateEvent.planState.planId).toBe("plan-test-1");
    expect(planStateEvent.autoEntered).toBe(true);
    const systemReminder = messages.find(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.includes("Plan mode is now active")
    );
    expect(systemReminder).toBeDefined();
  });

  it("returns error tool result when autoPlan config is absent", async () => {
    const events: any[] = [];
    const eventSink: AIChatQueryEventSink = { emit: (e) => events.push(e) };

    const stream = makeScriptedStream([
      {
        toolCalls: [
          {
            index: 0,
            id: "call_enter",
            function: { name: "EnterPlanMode", arguments: '{"rationale":"x"}' },
          },
        ],
      },
      { content: "ok" },
    ]);

    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream as any,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    });

    const messages: any[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
    ];

    const input: AIChatQueryLoopInput = {
      conversationId: "v2-conv-1",
      assistantMessageId: "asst-1",
      messages,
      request: { message: "go" } as any,
      openAITools: [ENTER_PLAN_MODE_TOOL],
      abortController: new AbortController(),
      eventSink,
      startRound: 0,
      // autoPlan intentionally omitted
      isActiveTurn: () => true,
    };

    const result = await loop.run(input);

    expect(result.type).toBe("completed");
    const toolResult = messages.find(
      (m) =>
        m.role === "tool" &&
        typeof m.content === "string" &&
        m.content.includes("not available")
    );
    expect(toolResult).toBeDefined();
    const planStateEvent = events.find((e) => e.type === "plan_state");
    expect(planStateEvent).toBeUndefined();
  });

  it("rejects EnterPlanMode when an approved plan already exists", async () => {
    const approvedPlanState: AIChatPlanStateView = {
      planId: "plan-approved",
      conversationId: "v2-conv-1",
      status: "approved",
      title: "T",
      objective: "O",
      currentVersion: 1,
    } as AIChatPlanStateView;

    const ensurePlan = vi.fn().mockResolvedValue(approvedPlanState);
    const autoPlan: AIChatAutoPlanLoopConfig = {
      planModule: {
        ensurePlanForConversation: ensurePlan,
        cancelDraft: vi.fn(),
        saveQuestion: vi.fn(),
        submitPlanForApproval: vi.fn(),
        getPlanStateByPlanId: vi.fn(),
        answerQuestion: vi.fn(),
      },
      planTools: PlanModeToolRegistry.toOpenAITools(),
    };

    const events: any[] = [];
    const eventSink: AIChatQueryEventSink = { emit: (e) => events.push(e) };
    const stream = makeScriptedStream([
      {
        toolCalls: [
          {
            index: 0,
            id: "call_enter",
            function: { name: "EnterPlanMode", arguments: '{"rationale":"x"}' },
          },
        ],
      },
      { content: "ok" },
    ]);

    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream as any,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    });

    const messages: any[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
    ];

    const input: AIChatQueryLoopInput = {
      conversationId: "v2-conv-1",
      assistantMessageId: "asst-1",
      messages,
      request: { message: "go" } as any,
      openAITools: [ENTER_PLAN_MODE_TOOL],
      abortController: new AbortController(),
      eventSink,
      startRound: 0,
      autoPlan,
      isActiveTurn: () => true,
    };

    const result = await loop.run(input);
    expect(result.type).toBe("completed");
    const toolResult = messages.find(
      (m) =>
        m.role === "tool" &&
        typeof m.content === "string" &&
        m.content.includes("already approved")
    );
    expect(toolResult).toBeDefined();
    const planStateEvent = events.find((e) => e.type === "plan_state");
    expect(planStateEvent).toBeUndefined();
  });
});

describe("AIChatQueryLoop orphan draft cleanup", () => {
  it("cancels the auto-created draft when the turn completes without plan-tool usage", async () => {
    const draftPlan: AIChatPlanStateView = {
      planId: "plan-draft",
      conversationId: "v2-conv-cleanup",
      status: "draft",
      title: "T",
      objective: "O",
      currentVersion: 0,
    } as AIChatPlanStateView;

    const ensurePlan = vi.fn().mockResolvedValue(draftPlan);
    const cancelDraft = vi.fn().mockResolvedValue(undefined);
    const autoPlan: AIChatAutoPlanLoopConfig = {
      planModule: {
        ensurePlanForConversation: ensurePlan,
        cancelDraft,
        saveQuestion: vi.fn(),
        submitPlanForApproval: vi.fn(),
        getPlanStateByPlanId: vi.fn(),
        answerQuestion: vi.fn(),
      },
      planTools: PlanModeToolRegistry.toOpenAITools(),
    };

    const events: any[] = [];
    const eventSink: AIChatQueryEventSink = { emit: (e) => events.push(e) };

    const stream = makeScriptedStream([
      {
        toolCalls: [
          {
            index: 0,
            id: "call_enter",
            function: { name: "EnterPlanMode", arguments: '{"rationale":"x"}' },
          },
        ],
      },
      // Second round: model just produces text, no plan tools, then stops.
      { content: "Actually, I can just answer directly without a plan." },
    ]);

    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream as any,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    });

    const messages: any[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
    ];

    await loop.run({
      conversationId: "v2-conv-cleanup",
      assistantMessageId: "asst-1",
      messages,
      request: { message: "go" } as any,
      openAITools: [ENTER_PLAN_MODE_TOOL],
      abortController: new AbortController(),
      eventSink,
      startRound: 0,
      autoPlan,
      isActiveTurn: () => true,
    });

    expect(cancelDraft).toHaveBeenCalledWith({ planId: "plan-draft" });
  });

  it("does NOT cancel when AskUserQuestion was called during the turn", async () => {
    // EnterPlanMode round 0, AskUserQuestion round 1 (which pauses).
    // The cancelDraft should NOT be called because the turn pauses for
    // plan question — the orphan-cancel logic at the completed branch
    // is never reached.
    const draftPlan: AIChatPlanStateView = {
      planId: "plan-q",
      conversationId: "v2-conv-q",
      status: "draft",
      title: "T",
      objective: "O",
      currentVersion: 0,
    } as AIChatPlanStateView;

    const ensurePlan = vi.fn().mockResolvedValue(draftPlan);
    const cancelDraft = vi.fn().mockResolvedValue(undefined);
    const questionView = {
      questionId: "q1",
      planId: "plan-q",
      conversationId: "v2-conv-q",
      status: "pending",
      questionsJson: "[]",
      createdAt: new Date().toISOString(),
    };
    const saveQuestion = vi.fn().mockResolvedValue(questionView);
    const autoPlan: AIChatAutoPlanLoopConfig = {
      planModule: {
        ensurePlanForConversation: ensurePlan,
        cancelDraft,
        saveQuestion,
        submitPlanForApproval: vi.fn(),
        getPlanStateByPlanId: vi.fn(),
        answerQuestion: vi.fn(),
      },
      planTools: PlanModeToolRegistry.toOpenAITools(),
    };

    const events: any[] = [];
    const eventSink: AIChatQueryEventSink = { emit: (e) => events.push(e) };

    const stream = makeScriptedStream([
      {
        toolCalls: [
          {
            index: 0,
            id: "call_enter",
            function: { name: "EnterPlanMode", arguments: '{"rationale":"x"}' },
          },
        ],
      },
      {
        toolCalls: [
          {
            index: 0,
            id: "call_ask",
            function: {
              name: "AskUserQuestion",
              arguments:
                '{"questions":[{"header":"H","question":"Q?","options":[{"label":"A","description":"d"},{"label":"B","description":"d"}]}]}',
            },
          },
        ],
      },
    ]);

    const loop = new AIChatQueryLoop({
      streamChatCompletion: stream as any,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    });

    const result = await loop.run({
      conversationId: "v2-conv-q",
      assistantMessageId: "asst-1",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "go" },
      ],
      request: { message: "go" } as any,
      openAITools: [ENTER_PLAN_MODE_TOOL],
      abortController: new AbortController(),
      eventSink,
      startRound: 0,
      autoPlan,
      isActiveTurn: () => true,
    });

    expect(result.type).toBe("paused_for_plan_question");
    expect(cancelDraft).not.toHaveBeenCalled();
  });
});
