import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Mock the Token service so executeAsyncTool's defense-in-depth AI-enabled
 * gate passes. The real Token constructor touches ElectronStoreService which
 * is not available in the vitest environment.
 *
 * NOTE: vi.mock is hoisted to the top of the file by vitest, so it runs
 * before the imports below. The factory returns a mock Token whose getValue
 * always returns 'true' for USER_AI_ENABLED.
 */
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn().mockReturnValue("true"),
  })),
}));

import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import {
  ToolJobRegistry,
  setDefaultToolJobRegistry,
  type ToolJobSpawnHandle,
} from "@/service/ToolJobRegistry";
import type {
  AIChatQueryLoopInput,
  AIChatQueryEvent,
} from "@/service/AIChatQueryEvents";
import type { OpenAIChatCompletionChunk } from "@/api/aiChatApi";

/**
 * Poll interval used by AIChatQueryLoop (see ASYNC_POLL_INTERVAL_MS in the
 * source). Tests advance fake timers past this to flush a single poll tick.
 */
const ASYNC_POLL_INTERVAL_MS_PLUS = 20_000;

/**
 * Fake registry that lets each test override the status/result/error of a
 * jobId AFTER it has been started. Extends ToolJobRegistry so the `override`
 * keyword is valid (both getStatus and cancel are public methods on the base
 * class).
 */
class FakeJobRegistry extends ToolJobRegistry {
  statusOverrides = new Map<
    string,
    "running" | "completed" | "failed" | "cancelled"
  >();
  resultOverrides = new Map<string, unknown>();
  errorOverrides = new Map<string, string>();
  cancelSpied = vi.fn();

  override getStatus(jobId: string) {
    const override = this.statusOverrides.get(jobId);
    if (override === undefined) return super.getStatus(jobId);
    const base = super.getStatus(jobId);
    return {
      ...base,
      status: override,
      result: this.resultOverrides.get(jobId) ?? base.result,
      error: this.errorOverrides.get(jobId) ?? base.error,
    };
  }

  override cancel(jobId: string) {
    this.cancelSpied(jobId);
    return super.cancel(jobId);
  }
}

function makeAsyncToolCallChunk(
  toolCallId: string,
  toolName: string,
  argsJson: string
): OpenAIChatCompletionChunk {
  return {
    id: "resp-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: toolCallId,
              type: "function",
              function: { name: toolName, arguments: argsJson },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

function makeStopChunk(): OpenAIChatCompletionChunk {
  return {
    id: "resp-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, delta: { content: "done" }, finish_reason: "stop" }],
  };
}

/**
 * Build a fake streamChatCompletion. The real dep signature is
 * `(request, onChunk, options?) => Promise<void>` — a callback-based stream,
 * NOT an async generator. This mirrors the pattern used in
 * AIChatQueryLoop.test.ts.
 *
 * Round 0 emits the tool-call chunk; round >=1 emits a stop chunk so the loop
 * can terminate after the async job result is injected.
 */
function makeFakeStream(spec: {
  toolCallId: string;
  toolName: string;
  argsJson: string;
}) {
  let round = 0;
  return vi.fn(
    async (
      _req: unknown,
      onChunk: (c: OpenAIChatCompletionChunk) => void
    ): Promise<void> => {
      if (round === 0) {
        onChunk(
          makeAsyncToolCallChunk(spec.toolCallId, spec.toolName, spec.argsJson)
        );
      } else {
        onChunk(makeStopChunk());
      }
      round += 1;
    }
  );
}

function buildInput(
  events: AIChatQueryEvent[],
  abortController: AbortController
): AIChatQueryLoopInput {
  return {
    conversationId: "conv-test",
    assistantMessageId: "msg-test",
    messages: [],
    request: {
      message: "test",
      conversationId: "conv-test",
      mode: "chat",
    } as never,
    openAITools: [],
    abortController,
    eventSink: {
      emit: (e: AIChatQueryEvent) => {
        events.push(e);
      },
    },
    startRound: 0,
    isActiveTurn: () => true,
    /**
     * Provides the "async" timeout class for run_subagent so
     * executeToolWithTimeout routes to executeAsyncTool (the job-registry
     * path) instead of the blocking foreground race.
     */
    skillRegistry: {
      getSkill: (name: string) => {
        if (name === "run_subagent") {
          return { timeoutClass: "async" } as never;
        }
        return null;
      },
    },
  };
}

describe("AIChatQueryLoop async poll", () => {
  let fake: FakeJobRegistry;
  let capturedJobIds: string[] = [];
  let startSpy: ReturnType<typeof vi.spyOn> & {
    mockImplementation: (
      impl: (
        toolName: string,
        args: Record<string, unknown>,
        ctx: { conversationId: string; toolCallId: string },
        spawn: (handle: ToolJobSpawnHandle) => Promise<unknown>
      ) => { jobId: string; queued: boolean }
    ) => typeof startSpy;
  };

  beforeEach(() => {
    fake = new FakeJobRegistry();
    capturedJobIds = [];
    setDefaultToolJobRegistry(fake);
    startSpy = vi.spyOn(fake, "start") as typeof startSpy;
    startSpy.mockImplementation(
      (
        toolName: string,
        args: Record<string, unknown>,
        ctx: { conversationId: string; toolCallId: string },
        spawn: (handle: ToolJobSpawnHandle) => Promise<unknown>
      ) => {
        const result = ToolJobRegistry.prototype.start.call(
          fake,
          toolName,
          args,
          ctx,
          spawn
        );
        capturedJobIds.push(result.jobId);
        return result;
      }
    );
  });

  afterEach(() => {
    startSpy?.mockRestore();
    vi.useRealTimers();
  });

  function lastStartedJobId(): string | undefined {
    return capturedJobIds[capturedJobIds.length - 1];
  }

  it("returns success result when async job completes", async () => {
    vi.useFakeTimers();
    const toolCallId = "call-success";
    const events: AIChatQueryEvent[] = [];
    const abort = new AbortController();
    const fakeStream = makeFakeStream({
      toolCallId,
      toolName: "run_subagent",
      argsJson: JSON.stringify({
        agentId: "agent-lead-researcher",
        prompt: "test",
        taskPacket: { lead: { industry: "fintech" } },
      }),
    });

    const deps = {
      streamChatCompletion: fakeStream,
      executeTool: async () => {
        const jobId = lastStartedJobId();
        if (jobId) {
          fake.statusOverrides.set(jobId, "completed");
          fake.resultOverrides.set(jobId, { agentTaskId: 42, output: "ok" });
        }
        return {
          success: true,
          result: { agentTaskId: 42, output: "ok" },
          execution_time_ms: 1,
        };
      },
      getSkillDefinition: () => undefined,
    };

    const loop = new AIChatQueryLoop(deps as never);
    const input = buildInput(events, abort);

    const promise = loop.run(input);
    await vi.advanceTimersByTimeAsync(ASYNC_POLL_INTERVAL_MS_PLUS);
    const result = await promise;

    expect(result.type).toBe("completed");
    const progressEvents = events.filter((e) => e.type === "tool_progress");
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);
    const resultEvents = events.filter((e) => e.type === "tool_result");
    expect(resultEvents.length).toBe(1);
    const payload = (resultEvents[0] as { toolResult: Record<string, unknown> })
      .toolResult;
    expect(payload).not.toHaveProperty("async");
    expect(payload).toMatchObject({ success: true });
  });

  it("returns failure result when async job fails", async () => {
    vi.useFakeTimers();
    const toolCallId = "call-fail";
    const events: AIChatQueryEvent[] = [];
    const abort = new AbortController();
    const fakeStream = makeFakeStream({
      toolCallId,
      toolName: "run_subagent",
      argsJson: JSON.stringify({
        agentId: "agent-lead-researcher",
        prompt: "test",
        taskPacket: { lead: { industry: "fintech" } },
      }),
    });

    const deps = {
      streamChatCompletion: fakeStream,
      executeTool: async () => {
        const jobId = lastStartedJobId();
        if (jobId) {
          fake.statusOverrides.set(jobId, "failed");
          fake.errorOverrides.set(jobId, "subagent crashed");
        }
        return {
          success: false,
          error: "subagent crashed",
          execution_time_ms: 1,
        };
      },
      getSkillDefinition: () => undefined,
    };

    const loop = new AIChatQueryLoop(deps as never);
    const input = buildInput(events, abort);

    const promise = loop.run(input);
    await vi.advanceTimersByTimeAsync(ASYNC_POLL_INTERVAL_MS_PLUS);
    const result = await promise;

    expect(result.type).toBe("completed");
    const resultEvents = events.filter((e) => e.type === "tool_result");
    expect(resultEvents.length).toBe(1);
    const payload = (resultEvents[0] as { toolResult: Record<string, unknown> })
      .toolResult;
    expect(payload).toMatchObject({ success: false });
    expect(String(payload.error ?? "").toLowerCase()).toContain("crash");
  });

  it("cancels the job when abort signal fires mid-poll", async () => {
    vi.useFakeTimers();
    const toolCallId = "call-abort";
    const events: AIChatQueryEvent[] = [];
    const abort = new AbortController();
    const fakeStream = makeFakeStream({
      toolCallId,
      toolName: "run_subagent",
      argsJson: JSON.stringify({
        agentId: "agent-lead-researcher",
        prompt: "test",
        taskPacket: { lead: { industry: "fintech" } },
      }),
    });

    const deps = {
      streamChatCompletion: fakeStream,
      executeTool: async () => {
        return { success: true, result: {}, execution_time_ms: 1 };
      },
      getSkillDefinition: () => undefined,
    };

    const loop = new AIChatQueryLoop(deps as never);
    const input = buildInput(events, abort);

    const promise = loop.run(input);
    abort.abort();
    await vi.advanceTimersByTimeAsync(ASYNC_POLL_INTERVAL_MS_PLUS);
    const result = await promise;

    expect(result.type).toBe("cancelled");
    expect(fake.cancelSpied).toHaveBeenCalledWith(lastStartedJobId());
  });
});
