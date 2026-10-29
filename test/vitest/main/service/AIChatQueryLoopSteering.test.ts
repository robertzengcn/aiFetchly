import { describe, expect, it, vi, beforeEach } from "vitest";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import { AIChatTurnControl } from "@/service/AIChatTurnControl";
import { AIChatSteeringRoundLimitError } from "@/service/AIChatQueryLoop";
import type { AIChatQueryLoopInput } from "@/service/AIChatQueryEvents";
import type {
  AIChatQueryEvent,
} from "@/service/AIChatQueryEvents";
import type { OpenAIChatCompletionChunk } from "@/api/aiChatApi";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { setHookAuditLoggerForTests } from "@/service/hooks/HookAuditService";

function textChunk(delta: string, finishReason?: string) {
  return {
    id: "resp-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [
      { index: 0, delta: { content: delta }, finish_reason: finishReason ?? null },
    ],
  } as unknown as OpenAIChatCompletionChunk;
}

function toolCallsChunk(
  calls: Array<{ id: string; name: string; argsJson: string }>
) {
  return {
    id: "resp-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: calls.map((call, index) => ({
            index,
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.argsJson },
          })),
        },
        finish_reason: "tool_calls",
      },
    ],
  } as unknown as OpenAIChatCompletionChunk;
}

function makeInstruction(id: string, text: string) {
  return {
    pendingMessageId: id,
    clientRequestId: `cr-${id}`,
    displayContent: text,
    modelContent: text,
    createdAt: new Date().toISOString(),
    targetAssistantMessageId: "assistant-steer",
  };
}

function buildInput(
  events: AIChatQueryEvent[],
  control?: AIChatTurnControl
): AIChatQueryLoopInput {
  return {
    conversationId: "conv-steer",
    assistantMessageId: "assistant-steer",
    messages: [{ role: "user", content: "original request" }],
    request: {
      message: "original request",
      conversationId: "conv-steer",
      model: "test-model",
      mode: "chat",
    } as never,
    openAITools: [],
    abortController: new AbortController(),
    eventSink: {
      emit: (e: AIChatQueryEvent) => {
        events.push(e);
      },
    },
    startRound: 0,
    isActiveTurn: () => true,
    ...(control ? { steeringControl: control } : {}),
  } as never;
}

/** Collects each model request's transcript for assertions. */
class RoundScript {
  readonly requests: Array<{ messages: { role: string; content: unknown }[] }> =
    [];
  private round = 0;
  constructor(
    readonly scripts: Array<(emit: (c: OpenAIChatCompletionChunk) => void) => void>
  ) {}

  readonly streamChatCompletion = vi.fn(
    async (
      request: { messages: unknown[] },
      onChunk: (c: OpenAIChatCompletionChunk) => void
    ): Promise<void> => {
      this.requests.push(request as never);
      const script = this.scripts[this.round] ?? (() => onChunk(textChunk("done", "stop")));
      this.round += 1;
      script(onChunk);
    }
  );
}

beforeEach(() => {
  HookRegistry.resetForTests();
  setHookAuditLoggerForTests({ log: () => undefined });
});

describe("AIChatQueryLoop steering boundaries", () => {
  it("before_model: steering committed before the run joins the first request", async () => {
    const events: AIChatQueryEvent[] = [];
    const persist = vi.fn().mockResolvedValue(undefined);
    const control = new AIChatTurnControl(persist, "assistant-steer");
    const script = new RoundScript([
      (emit) => emit(textChunk("final answer", "stop")),
    ]);

    const loop = new AIChatQueryLoop({
      streamChatCompletion: script.streamChatCompletion as never,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    } as never);

    // Commit steering BEFORE the loop starts.
    const r = control.reserve("pm-1");
    expect(control.commit(r!, makeInstruction("pm-1", "focus on Europe"))).toBe(
      true
    );

    const result = await loop.run(buildInput(events, control));
    expect(result.type).toBe("completed");

    const firstRequest = script.requests[0];
    const userMessages = firstRequest.messages.filter(
      (m) => m.role === "user"
    );
    const steeringMsg = userMessages.find((m) =>
      String(m.content).includes("focus on Europe")
    );
    expect(steeringMsg).toBeDefined();
    expect(String(steeringMsg!.content)).toContain(
      "[User steering update received while this response was running]"
    );
    expect(
      events.some(
        (e) =>
          e.type === "direction_updated" &&
          e.boundary === "before_model" &&
          e.contentOffset === 0
      )
    ).toBe(true);
    if (result.type === "completed") {
      expect(result.directionTransitions?.length).toBe(1);
    }
  });

  it("after_model: none of the superseded tool calls execute; each gets one synthetic result", async () => {
    const events: AIChatQueryEvent[] = [];
    const persist = vi.fn().mockResolvedValue(undefined);
    const control = new AIChatTurnControl(persist, "assistant-steer");
    const executed: string[] = [];
    const script = new RoundScript([
      (emit) =>
        emit(
          toolCallsChunk([
            { id: "call-a", name: "tool_a", argsJson: "{}" },
            { id: "call-b", name: "tool_b", argsJson: "{}" },
          ])
        ),
      (emit) => emit(textChunk("revised answer", "stop")),
    ]);

    const loop = new AIChatQueryLoop({
      streamChatCompletion: script.streamChatCompletion as never,
      executeTool: vi.fn(async (name: string) => {
        executed.push(name);
        return {
          success: true,
          result: {},
          execution_time_ms: 1,
        } as never;
      }),
      getSkillDefinition: () => undefined,
    } as never);

    // Commit steering DURING the round-0 stream: before_model already
    // passed, so the batch is consumed at after_model — before any tool runs.
    const script0 = script.scripts[0];
    script.scripts[0] = (emit) => {
      script0(emit);
      const r = control.reserve("pm-am");
      control.commit(r!, makeInstruction("pm-am", "stop searching"));
    };

    const result = await loop.run(buildInput(events, control));
    expect(result.type).toBe("completed");
    expect(executed).toEqual([]); // neither tool started

    const toolResults = events.filter(
      (e) => e.type === "tool_result"
    ) as Array<{ toolCallId: string; toolResult: Record<string, unknown> }>;
    expect(toolResults.map((t) => t.toolCallId).sort()).toEqual([
      "call-a",
      "call-b",
    ]);
    for (const t of toolResults) {
      expect(t.toolResult).toMatchObject({
        skipped: true,
        reason: "superseded_by_user_steering",
      });
    }

    // The second model request contains BOTH synthetic results + steering.
    const second = script.requests[1];
    const toolMessages = second.messages.filter((m) => m.role === "tool");
    expect(toolMessages.length).toBe(2);
    const steeringInSecond = second.messages.some(
      (m) => m.role === "user" && String(m.content).includes("stop searching")
    );
    expect(steeringInSecond).toBe(true);
  });

  it("after_tool: tool A completes, tool B is skipped when steering arrives mid-loop", async () => {
    const events: AIChatQueryEvent[] = [];
    const persist = vi.fn().mockResolvedValue(undefined);
    const control = new AIChatTurnControl(persist, "assistant-steer");
    const executed: string[] = [];
    const script = new RoundScript([
      (emit) =>
        emit(
          toolCallsChunk([
            { id: "call-a", name: "tool_a", argsJson: "{}" },
            { id: "call-b", name: "tool_b", argsJson: "{}" },
          ])
        ),
      (emit) => emit(textChunk("done with A only", "stop")),
    ]);

    const loop = new AIChatQueryLoop({
      streamChatCompletion: script.streamChatCompletion as never,
      executeTool: vi.fn(async (name: string) => {
        executed.push(name);
        if (name === "tool_a") {
          // User clicks Steer while tool A is running.
          const r = control.reserve("pm-mid");
          control.commit(r!, makeInstruction("pm-mid", "skip the rest"));
        }
        return { success: true, result: { ok: true }, execution_time_ms: 1 } as never;
      }),
      getSkillDefinition: () => undefined,
    } as never);

    const result = await loop.run(buildInput(events, control));
    expect(result.type).toBe("completed");
    // A ran; B never started.
    expect(executed).toEqual(["tool_a"]);

    const toolResults = events.filter(
      (e) => e.type === "tool_result"
    ) as Array<{ toolCallId: string; toolResult: Record<string, unknown> }>;
    const bResult = toolResults.find((t) => t.toolCallId === "call-b");
    expect(bResult?.toolResult).toMatchObject({ skipped: true });
    const aResult = toolResults.find((t) => t.toolCallId === "call-a");
    expect(aResult?.toolResult).toMatchObject({ success: true });

    // Next request keeps A's real result, B's synthetic result, steering.
    const second = script.requests[1];
    const toolMessages = second.messages.filter(
      (m) => m.role === "tool"
    ) as Array<{ tool_call_id?: string; content: string }>;
    expect(toolMessages.length).toBe(2);
    const aContent = toolMessages.find((m) => m.tool_call_id === "call-a");
    expect(aContent?.content).toContain("ok");
    const bContent = toolMessages.find((m) => m.tool_call_id === "call-b");
    expect(bContent?.content).toContain("superseded_by_user_steering");
    expect(
      second.messages.some(
        (m) => m.role === "user" && String(m.content).includes("skip the rest")
      )
    ).toBe(true);
  });

  it("multiple steering instructions preserve chronological order", async () => {
    const events: AIChatQueryEvent[] = [];
    const persist = vi.fn().mockResolvedValue(undefined);
    const control = new AIChatTurnControl(persist, "assistant-steer");
    const script = new RoundScript([
      (emit) => emit(textChunk("final", "stop")),
    ]);

    const loop = new AIChatQueryLoop({
      streamChatCompletion: script.streamChatCompletion as never,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    } as never);

    for (const [id, text] of [
      ["pm-1", "first steer"],
      ["pm-2", "second steer"],
    ] as const) {
      const r = control.reserve(id);
      control.commit(r!, makeInstruction(id, text));
    }

    await loop.run(buildInput(events, control));
    const dirEvent = events.find((e) => e.type === "direction_updated") as
      | { pendingMessageIds: string[] }
      | undefined;
    expect(dirEvent?.pendingMessageIds).toEqual(["pm-1", "pm-2"]);
  });

  it("before_complete: steering during a plain text stream forces another round", async () => {
    const events: AIChatQueryEvent[] = [];
    const persist = vi.fn().mockResolvedValue(undefined);
    const control = new AIChatTurnControl(persist, "assistant-steer");
    const script = new RoundScript([
      (emit) => {
        emit(textChunk("answer part 1", "stop"));
        // Steering arrives after tokens streamed (FR-27): applied at the
        // next safe boundary — before_complete.
        const r = control.reserve("pm-bc");
        control.commit(r!, makeInstruction("pm-bc", "actually do X"));
      },
      (emit) => emit(textChunk(" ok doing X", "stop")),
    ]);

    const loop = new AIChatQueryLoop({
      streamChatCompletion: script.streamChatCompletion as never,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    } as never);

    const result = await loop.run(buildInput(events, control));
    expect(result.type).toBe("completed");
    expect(script.requests.length).toBe(2);
    if (result.type === "completed") {
      // Visible content preserves streamed order (FR-30).
      expect(result.fullContent).toBe("answer part 1 ok doing X");
      expect(result.directionTransitions?.[0]?.contentOffset).toBe(
        "answer part 1".length
      );
    }
    expect(
      events.some(
        (e) => e.type === "direction_updated" && e.boundary === "before_complete"
      )
    ).toBe(true);
  });

  it("exhausted round budget fails cleanly with STEERING_ROUND_LIMIT", async () => {
    const events: AIChatQueryEvent[] = [];
    const persist = vi.fn().mockResolvedValue(undefined);
    const control = new AIChatTurnControl(persist, "assistant-steer");
    // startRound at the last usable round: applying steering would need a
    // round beyond the budget.
    const script = new RoundScript([
      (emit) => emit(textChunk("x", "stop")),
    ]);

    const loop = new AIChatQueryLoop({
      streamChatCompletion: script.streamChatCompletion as never,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    } as never);

    // Commit steering during the LAST usable round's stream so the
    // before_complete boundary hits the exhausted round budget.
    const script0 = script.scripts[0];
    script.scripts[0] = (emit) => {
      script0(emit);
      const r = control.reserve("pm-limit");
      control.commit(r!, makeInstruction("pm-limit", "one too many"));
    };

    const input = buildInput(events, control);
    (input as { startRound: number }).startRound = 29;

    const result = await loop.run(input);
    expect(result.type).toBe("failed");
    if (result.type === "failed") {
      expect(result.error).toBeInstanceOf(AIChatSteeringRoundLimitError);
    }
  });

  it("no steering control: behavior is identical (no direction events)", async () => {
    const events: AIChatQueryEvent[] = [];
    const script = new RoundScript([
      (emit) => emit(textChunk("plain", "stop")),
    ]);
    const loop = new AIChatQueryLoop({
      streamChatCompletion: script.streamChatCompletion as never,
      executeTool: vi.fn(),
      getSkillDefinition: () => undefined,
    } as never);
    const result = await loop.run(buildInput(events));
    expect(result.type).toBe("completed");
    expect(events.some((e) => e.type === "direction_updated")).toBe(false);
    if (result.type === "completed") {
      expect(result.directionTransitions).toBeUndefined();
      expect(result.fullContent).toBe("plain");
    }
  });
});
