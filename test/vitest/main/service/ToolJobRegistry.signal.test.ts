import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock heavy dependencies to prevent import cascade (AgentRuntime → skillsRegistry → DB)
vi.mock("@/service/AgentRuntimeRegistry", () => ({
  AgentRuntimeRegistry: { getRuntime: vi.fn() },
  getDefaultAgentRuntimeDeps: vi.fn(() => ({ marker: "default-deps" })),
}));

vi.mock("@/entityTypes/agentTypes", () => ({}));

// Mock the Token service so executeAsyncTool's defense-in-depth AI-enabled
// gate passes (same pattern as AIChatQueryLoopAsyncPoll.test.ts).
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn().mockReturnValue("true"),
  })),
}));

import {
  ToolJobRegistry,
  setDefaultToolJobRegistry,
} from "@/service/ToolJobRegistry";
import { AIChatQueryLoop } from "@/service/AIChatQueryLoop";
import type {
  AIChatQueryEventSink,
  AIChatQueryEvent,
} from "@/service/AIChatQueryEvents";
import { RUN_SUBAGENT_TOOL } from "@/service/agentTools/runSubagentTool";
import { AgentRuntimeRegistry } from "@/service/AgentRuntimeRegistry";
import type { OpenAIChatCompletionChunk } from "@/api/aiChatApi";

/**
 * Phase 0 — truthful cancellation (PRD FR-36..38, technical design §17).
 *
 * A registry job labelled `cancelled` must actually request cancellation of
 * the underlying work: the registry owns an AbortController per job and
 * exposes its signal on the spawn handle; the query loop forwards that signal
 * into `deps.executeTool`; run_subagent forwards its context signal into
 * `AgentRuntime.runSync`.
 */

/** Job body that parks until its signal aborts. */
function parkUntilAborted(handle: { signal: AbortSignal }): Promise<void> {
  return new Promise((resolve) => {
    if (handle.signal.aborted) {
      resolve();
      return;
    }
    handle.signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

describe("ToolJobRegistry abort signal", () => {
  it("exposes a non-aborted per-job signal on the spawn handle", async () => {
    const registry = new ToolJobRegistry();
    let seenSignal: AbortSignal | undefined;
    const { jobId } = registry.start(
      "some_tool",
      {},
      { conversationId: "c1", toolCallId: "t1" },
      async (handle) => {
        seenSignal = handle.signal;
        await parkUntilAborted(handle);
      }
    );
    expect(jobId).toBeTruthy();
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal?.aborted).toBe(false);
    registry.shutdown();
  });

  it("cancel() aborts the running job's signal", async () => {
    const registry = new ToolJobRegistry();
    let signal: AbortSignal | undefined;
    const { jobId } = registry.start(
      "some_tool",
      {},
      { conversationId: "c1", toolCallId: "t1" },
      async (handle) => {
        signal = handle.signal;
        await parkUntilAborted(handle);
      }
    );
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);

    const result = registry.cancel(jobId);
    expect(result.cancelled).toBe(true);
    expect(signal!.aborted).toBe(true);

    // Unknown jobs report not-cancelled without throwing.
    expect(registry.cancel("does-not-exist").cancelled).toBe(false);
  });

  it("shutdown() aborts running jobs' signals", async () => {
    const registry = new ToolJobRegistry();
    const signals: AbortSignal[] = [];
    for (const toolCallId of ["t1", "t2"]) {
      registry.start(
        "tool",
        {},
        { conversationId: "c1", toolCallId },
        async (handle) => {
          signals.push(handle.signal);
          await parkUntilAborted(handle);
        }
      );
    }
    registry.shutdown();
    expect(signals.length).toBe(2);
    for (const s of signals) {
      expect(s.aborted).toBe(true);
    }
  });

  it("cancelled queued job is removed without spawning", async () => {
    const registry = new ToolJobRegistry({ maxConcurrent: 1 });
    const spawnSpy = vi.fn();
    // Occupy the single concurrency slot with a never-ending job.
    registry.start(
      "occupier",
      {},
      { conversationId: "c1", toolCallId: "t0" },
      async (handle) => {
        await parkUntilAborted(handle);
      }
    );
    // This one queues behind it.
    const queued = registry.start(
      "queued_tool",
      {},
      { conversationId: "c1", toolCallId: "t1" },
      async () => {
        spawnSpy();
      }
    );
    expect(queued.queued).toBe(true);
    const result = registry.cancel(queued.jobId);
    expect(result.cancelled).toBe(true);
    // Release the occupier so the queue would drain — the cancelled job must
    // NOT spawn.
    registry.shutdown();
    await Promise.resolve();
    expect(spawnSpy).not.toHaveBeenCalled();
  });
});

describe("executeAsyncTool signal propagation", () => {
  const ASYNC_POLL_INTERVAL_MS_PLUS = 15_000 + 50;

  function makeAsyncToolCallChunk(
    toolCallId: string,
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
                function: { name: "run_subagent", arguments: argsJson },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    } as unknown as OpenAIChatCompletionChunk;
  }

  function makeStopChunk(): OpenAIChatCompletionChunk {
    return {
      id: "resp-2",
      object: "chat.completion.chunk",
      created: 2,
      model: "test-model",
      choices: [
        { index: 0, delta: { content: "done" }, finish_reason: "stop" },
      ],
    } as unknown as OpenAIChatCompletionChunk;
  }

  beforeEach(() => {
    const registry = new ToolJobRegistry();
    setDefaultToolJobRegistry(registry);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards the registry job signal into deps.executeTool context", async () => {
    vi.useFakeTimers();
    try {
      const events: AIChatQueryEvent[] = [];
      const abort = new AbortController();
      let round = 0;
      let capturedSignal: AbortSignal | undefined;

      const deps = {
        streamChatCompletion: vi.fn(
          async (
            _req: unknown,
            onChunk: (c: OpenAIChatCompletionChunk) => void
          ): Promise<void> => {
            if (round === 0) {
              onChunk(
                makeAsyncToolCallChunk(
                  "call-sig",
                  JSON.stringify({
                    agentId: "a",
                    prompt: "p",
                    taskPacket: {},
                  })
                )
              );
            } else {
              onChunk(makeStopChunk());
            }
            round += 1;
          }
        ),
        executeTool: vi.fn(
          async (
            _name: string,
            _args: Record<string, unknown>,
            context: { signal?: AbortSignal }
          ) => {
            capturedSignal = context.signal;
            return {
              success: true,
              result: { ok: true },
              execution_time_ms: 1,
            };
          }
        ),
        getSkillDefinition: () => undefined,
      };

      const loop = new AIChatQueryLoop(deps as never);
      const input = {
        conversationId: "conv-sig",
        assistantMessageId: "msg-sig",
        messages: [],
        request: {
          message: "test",
          conversationId: "conv-sig",
          model: "m",
          mode: "chat",
        } as never,
        openAITools: [],
        abortController: abort,
        eventSink: {
          emit: (e: AIChatQueryEvent) => {
            events.push(e);
          },
        } as AIChatQueryEventSink,
        startRound: 0,
        isActiveTurn: () => true,
        skillRegistry: {
          getSkill: (name: string) =>
            name === "run_subagent"
              ? ({ timeoutClass: "async" } as never)
              : null,
        },
      };

      const promise = loop.run(input as never);
      await vi.advanceTimersByTimeAsync(ASYNC_POLL_INTERVAL_MS_PLUS);
      const result = await promise;

      expect(result.type).toBe("completed");
      expect(capturedSignal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("run_subagent signal propagation", () => {
  it("passes the execution-context signal into AgentRuntime.runSync deps", async () => {
    const runSync = vi.fn(
      async (
        request: unknown,
        deps: unknown
      ): Promise<{
        status: string;
        agentTaskId: number;
        agentId: string;
        output: Record<string, unknown>;
      }> => {
        // Reference both params so eslint counts them as used; the call
        // arguments are asserted below via mock.calls.
        if (request === undefined && deps === undefined) {
          throw new Error("runSync requires request and deps");
        }
        return {
          status: "completed",
          agentTaskId: 1,
          agentId: "a",
          output: {},
        };
      }
    );
    vi.mocked(AgentRuntimeRegistry.getRuntime).mockReturnValue({
      runSync,
    } as never);

    const contextSignal = new AbortController().signal;
    await RUN_SUBAGENT_TOOL.execute(
      { agentId: "a", prompt: "p", taskPacket: { userGoal: "g" } },
      {
        conversationId: "conv-1",
        toolCallId: "t1",
        args: {},
        signal: contextSignal,
      } as never
    );

    expect(runSync).toHaveBeenCalledTimes(1);
    const deps = runSync.mock.calls[0][1] as
      | { signal?: AbortSignal }
      | undefined;
    expect(deps?.signal).toBe(contextSignal);
  });
});
