// test/vitest/main/service/AIChatStreamImplementationConfig.test.ts
//
// Stage B3 (generator-streaming PRD FR-018, AC-14): the delivery-mode
// provider — env validation, per-run pinning across resume, generator-mode
// event handling with awaited persistence ordering (design §8), and
// consumer/persistence failure semantics.
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  EnvAIChatStreamImplementationConfig,
  createMutableStreamImplementationConfig,
} from "@/service/aiChat/AIChatStreamImplementationConfig";
import { AIChatQueryEngine } from "@/service/AIChatQueryEngine";
import type { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type {
  AIChatLoopEvent,
  AIChatQueryEvent,
  AIChatQueryLoopResult,
} from "@/service/AIChatQueryEvents";
import { SkillExecutor } from "@/service/SkillExecutor";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";

// --- Shared module mocks (same pattern as AIChatQueryEngine.runTurn.test.ts)
const mockGetConversationMessages = vi.fn().mockResolvedValue([]);
const mockSaveUserMessage = vi.fn().mockResolvedValue({ messageId: "user-1" });
const mockSaveAssistantMessage = vi.fn().mockResolvedValue({});
const mockSaveToolCallMessage = vi.fn().mockResolvedValue({});
const mockSaveToolResultMessage = vi.fn().mockResolvedValue({});
const mockCreateConversationIfNeeded = vi
  .fn()
  .mockImplementation((id: string) => id);
const mockGetDefaultSystemPrompt = vi.fn().mockReturnValue("You are helpful.");

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    getConversationMessages: mockGetConversationMessages,
    saveUserMessage: mockSaveUserMessage,
    saveAssistantMessage: mockSaveAssistantMessage,
    saveToolCallMessage: mockSaveToolCallMessage,
    saveToolResultMessage: mockSaveToolResultMessage,
    createConversationIfNeeded: mockCreateConversationIfNeeded,
    getDefaultSystemPrompt: mockGetDefaultSystemPrompt,
  })),
}));
vi.mock("@/modules/AIChatAttachmentModule", () => ({
  AIChatAttachmentModule: vi.fn().mockImplementation(() => ({
    saveUploadedFiles: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("@/modules/AIChatPlanModule", () => ({
  AIChatPlanModule: vi.fn().mockImplementation(() => ({
    getPlanState: vi.fn().mockResolvedValue(null),
    getPlanStateByPlanId: vi.fn().mockResolvedValue(null),
    saveQuestion: vi.fn().mockResolvedValue(undefined),
    submitPlanForApproval: vi.fn().mockResolvedValue(undefined),
    answerQuestion: vi.fn().mockResolvedValue({
      question: { questionId: "q-1" },
      planState: null,
    }),
    ensurePlanForConversation: vi.fn().mockResolvedValue(null),
    cancelDraft: vi.fn().mockResolvedValue(undefined),
  })),
}));
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
vi.mock("@/modules/AgentDefinitionModule", () => ({
  AgentDefinitionModule: vi.fn().mockImplementation(() => ({
    listActiveForRuntime: vi.fn().mockResolvedValue([]),
  })),
}));
vi.mock("@/api/aiChatApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/aiChatApi")>();
  return { ...actual, AiChatApi: vi.fn().mockImplementation(() => ({})) };
});
vi.mock("@/service/DesktopNotifyService", () => ({
  DesktopNotifyService: {
    getInstance: () => ({ show: vi.fn().mockResolvedValue(false) }),
  },
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
  Token: vi.fn().mockImplementation(() => ({ getValue: vi.fn() })),
}));

function makeEventCollector(): {
  sink: { emit: (e: AIChatQueryEvent) => void };
  events: AIChatQueryEvent[];
} {
  const events: AIChatQueryEvent[] = [];
  return { sink: { emit: (e) => events.push(e) }, events };
}

describe("AIChatStreamImplementationConfig (FR-018)", () => {
  it("absent env defaults to callback", () => {
    expect(new EnvAIChatStreamImplementationConfig({}).mode).toBe("callback");
  });

  it("valid values are honored", () => {
    expect(
      new EnvAIChatStreamImplementationConfig({
        AI_CHAT_STREAM_IMPLEMENTATION: "generator",
      }).mode
    ).toBe("generator");
    expect(
      new EnvAIChatStreamImplementationConfig({
        AI_CHAT_STREAM_IMPLEMENTATION: "callback",
      }).mode
    ).toBe("callback");
  });

  it("invalid env values fall back to callback with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(
      new EnvAIChatStreamImplementationConfig({
        AI_CHAT_STREAM_IMPLEMENTATION: "async-iterators!!",
      }).mode
    ).toBe("callback");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("mutable provider changes mode for new runs (AC-14 harness)", () => {
    const provider = createMutableStreamImplementationConfig("callback");
    expect(provider.mode).toBe("callback");
    provider.setMode("generator");
    expect(provider.mode).toBe("generator");
  });
});



/** Shared probe state for the dual-seam fake loop. */
interface FakeLoopState {
  toolStarted: boolean;
  runCalls: number;
  iterateCalls: number;
}

/**
 * Fake loop exposing BOTH seams: run() records callback usage; iterate()
 * yields a tool_call, then records toolStarted only when the consumer
 * advanced past the yield — i.e. after the awaited required save resolved
 * (design §8: the tool never starts before its call row is durable).
 */
function makeDualSeamLoop(state: FakeLoopState): AIChatQueryLoop {
  const loop = {
    run: vi.fn(async (): Promise<AIChatQueryLoopResult> => {
      state.runCalls += 1;
      return {
        type: "failed",
        conversationId: "v2-G",
        assistantMessageId: "a",
        error: new Error("callback path must not run in generator mode"),
        partialContent: "",
      };
    }),
    async *iterate(input: {
      conversationId: string;
      assistantMessageId: string;
    }): AsyncGenerator<AIChatLoopEvent, AIChatQueryLoopResult, void> {
      state.iterateCalls += 1;
      yield {
        type: "tool_call",
        conversationId: input.conversationId,
        messageId: input.assistantMessageId,
        toolCallId: "tc-gen-1",
        toolName: "send_email",
        toolArguments: {},
      };
      state.toolStarted = true;
      return {
        type: "completed",
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        fullContent: "done",
        finishReason: "stop",
      };
    },
  };
  return loop as unknown as AIChatQueryLoop;
}

describe("AIChatQueryEngine generator-mode consumption (FR-018/001, design §8)", () => {
  beforeEach(() => {
    mockSaveToolCallMessage.mockReset();
    mockSaveToolCallMessage.mockResolvedValue({});
    mockSaveToolResultMessage.mockReset();
    mockSaveToolResultMessage.mockResolvedValue({});
  });

  it("module graph warm-up (first engine call resolves its registries)", async () => {
    const { SkillRegistry } = await import("@/config/skillsRegistry");
    await expect(SkillRegistry.getAllToolFunctions()).resolves.toEqual([]);
  });

  it("generator mode drains iterate(), awaits the tool-call save before the tool starts, and returns the outcome", async () => {
    const state: FakeLoopState = {
      toolStarted: false,
      runCalls: 0,
      iterateCalls: 0,
    };
    let resolveSave!: (value: unknown) => void;
    mockSaveToolCallMessage.mockImplementation(
      () =>
        new Promise<unknown>((resolve) => {
          resolveSave = resolve;
        })
    );
    const engine = new AIChatQueryEngine(makeDualSeamLoop(state), {
      streamImplementation: createMutableStreamImplementationConfig("generator"),
    });

    const collector = makeEventCollector();
    const outcomePromise = engine.submitPersistedUserMessage({
      eventSink: collector.sink,
      request: { message: "hi", conversationId: "v2-G" },
      savedUser: makeSavedUser(),
      modelContent: "hi",
      assistantMessageId: "assistant-gen-1",
    });

    // Pre-loop engine work (plan/intent/context assembly) can take >100ms on
    // a cold module graph — wait for the generator to actually start.
    await vi.waitFor(() => expect(state.iterateCalls).toBe(1));
    expect(state.runCalls).toBe(0);
    // The generator is suspended at the tool_call yield with the consumer's
    // awaited save still pending: the tool must NOT have started (§8).
    expect(state.toolStarted).toBe(false);
    expect(collector.events.some((e) => e.type === "tool_call")).toBe(true);

    resolveSave({});
    const outcome = await outcomePromise;
    expect(state.toolStarted).toBe(true);
    expect(outcome).toMatchObject({ type: "completed" });
    expect(collector.events.some((e) => e.type === "complete")).toBe(true);
  });

  it("callback mode keeps using run() — the flag switches only the consumer", async () => {
    const state: FakeLoopState = {
      toolStarted: true,
      runCalls: 0,
      iterateCalls: 0,
    };
    const loop = makeDualSeamLoop(state);
    // mockResolvedValue would REPLACE the counting implementation — keep it.
    (loop as unknown as { run: ReturnType<typeof vi.fn> }).run.mockImplementation(
      async (): Promise<AIChatQueryLoopResult> => {
        state.runCalls += 1;
        return {
          type: "completed",
          conversationId: "v2-G",
          assistantMessageId: "assistant-gen-2",
          fullContent: "ok",
          finishReason: "stop",
        };
      }
    );
    const engine = new AIChatQueryEngine(loop, {
      streamImplementation: createMutableStreamImplementationConfig("callback"),
    });

    const outcome = await engine.submitPersistedUserMessage({
      eventSink: makeEventCollector().sink,
      request: { message: "hi", conversationId: "v2-G" },
      savedUser: makeSavedUser(),
      modelContent: "hi",
      assistantMessageId: "assistant-gen-2",
    });
    expect(outcome).toMatchObject({ type: "completed" });
    expect(state.runCalls).toBe(1);
    expect(state.iterateCalls).toBe(0);
  });

  it("a required-persistence failure in generator mode fails the segment with the classified code", async () => {
    const state: FakeLoopState = {
      toolStarted: true,
      runCalls: 0,
      iterateCalls: 0,
    };
    mockSaveToolCallMessage.mockRejectedValue(new Error("db gone"));
    const engine = new AIChatQueryEngine(makeDualSeamLoop(state), {
      streamImplementation: createMutableStreamImplementationConfig("generator"),
    });

    const collector = makeEventCollector();
    const outcome = await engine.submitPersistedUserMessage({
      eventSink: collector.sink,
      request: { message: "hi", conversationId: "v2-G" },
      savedUser: makeSavedUser(),
      modelContent: "hi",
      assistantMessageId: "assistant-gen-3",
    });

    expect(outcome.type).toBe("failed");
    const errorEvent = collector.events.find(
      (e) => e.type === "error"
    ) as { errorCode?: string; toolCallId?: string } | undefined;
    expect(errorEvent?.errorCode).toBe("tool_call_persist_failed");
    expect(errorEvent?.toolCallId).toBe("tc-gen-1");
    // The failed (not completed) outcome proves the generator never returned
    // its completed result — dependent execution was blocked at the barrier.
    void SkillExecutor;
  });
});

function makeSavedUser(): AIChatMessageEntity {
  return {
    messageId: "user-gen-1",
    conversationId: "v2-G",
    content: "hi",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as AIChatMessageEntity;
}

describe("AIChatQueryLoop.run facade cleanup on persistence failure (review fix)", () => {
  it("callback mode: rejecting tool-call save fails the turn, never starts the tool, and closes the generator", async () => {
    const { AIChatQueryLoop } = await import("@/service/AIChatQueryLoop");
    let toolStarted = false;
    const events: AIChatQueryEvent[] = [];
    const sink = {
      emit: (e: AIChatQueryEvent): void => {
        events.push(e);
      },
      flush: vi.fn().mockRejectedValue(
        Object.assign(new Error("Required persistence failed"), {
          name: "AIChatRequiredPersistenceError",
        })
      ),
    };
    // A tool-call chunk that, when processed, drives the loop to the
    // tool-execution yield; a second next() would start the tool.
    const toolCallChunk = {
      id: "resp-f",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call-f",
                type: "function",
                function: { name: "send_email", arguments: "{}" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };
    const loop = new AIChatQueryLoop({
      streamChatCompletion: async (
        _req: unknown,
        onChunk: (c: typeof toolCallChunk) => void
      ): Promise<void> => {
        onChunk(toolCallChunk);
      },
      executeTool: async (): Promise<never> => {
        toolStarted = true;
        throw new Error("must not run");
      },
      getSkillDefinition: () => undefined,
    } as never);
    // Track generator closure: wrap the iterate() result so a forced
    // .return() (the facade's cleanup contract, design §6) is observable.
    const originalIterate = loop.iterate.bind(loop);
    let generatorReturnCalled = false;
    loop.iterate = ((input: unknown) => {
      const gen = originalIterate(input as never);
      return {
        next: (value?: unknown) => gen.next(value as never),
        return: (value?: unknown) => {
          generatorReturnCalled = true;
          return gen.return(value as never);
        },
        throw: (reason?: unknown) => gen.throw(reason),
        [Symbol.asyncIterator]() {
          return this;
        },
      } as unknown as ReturnType<typeof originalIterate>;
    }) as typeof loop.iterate;

    // The flush rejection propagates OUT of run() (the engine's catch maps
    // it to a failed outcome) AND the facade closes the generator first.
    await expect(
      loop.run({
        conversationId: "v2-F",
        assistantMessageId: "assistant-f",
        messages: [],
        request: { message: "hi", conversationId: "v2-F" },
        openAITools: [
          {
            type: "function",
            function: {
              name: "send_email",
              description: "s",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        abortController: new AbortController(),
        eventSink: sink,
        startRound: 0,
        isActiveTurn: () => true,
      } as never)
    ).rejects.toThrow(/Required persistence failed/);

    expect(toolStarted).toBe(false);
    expect(generatorReturnCalled).toBe(true);
    expect(events.some((e) => e.type === "tool_call")).toBe(true);
  });
});
