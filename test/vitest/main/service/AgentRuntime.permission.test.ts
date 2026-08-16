/**
 * Permission-pause regression tests for AgentRuntime with the REAL
 * AIChatQueryLoop.
 *
 * Background: headless agent tasks cannot show SkillExecutor's interactive
 * permission prompt. Before the fix, a needsPermissionPrompt tool result
 * flowed through untouched, AIChatQueryLoop returned paused_for_permission,
 * and the whole sub-agent task failed with
 * "Agent task paused for permission (not supported in v1 runtime)"
 * (reported live: agent-batch-worker -> file_read with no stored grant).
 *
 * AgentRuntime now rewrites permission prompts into explicit denied tool
 * results inside its policyCheckedExecute wrapper, so the loop feeds the
 * failure back to the agent model and the task keeps running.
 *
 * Unlike AgentRuntime.test.ts (which mocks the loop), these tests drive the
 * REAL AIChatQueryLoop with a scripted stream, proving end-to-end that:
 *   - the loop never enters its paused_for_permission branch,
 *   - the denial reaches the model as a tool-role message it can adapt to,
 *   - both tool dispatch paths are covered (foreground + async job).
 *
 * Mock strategy mirrors AIChatQueryLoopAsyncPermission.test.ts /
 * AIChatQueryLoopAsyncPoll.test.ts: heavy modules (Token, SkillExecutor,
 * AiChatApi) are stubbed so the real loop module loads cleanly under vitest.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// --- Controllable timeout classes -----------------------------------------
// The same tool must be routable through the foreground path (test A/C) and
// the async job path (test B). vi.hoisted keeps the shared state accessible
// inside the hoisted vi.mock factory.
const timeoutState = vi.hoisted(() => ({
  inferClassOverride: undefined as string | undefined,
}));

vi.mock("@/service/ToolTimeoutPolicy", () => ({
  inferTimeoutClassByName: vi.fn(
    () => timeoutState.inferClassOverride ?? "fast"
  ),
  resolveTimeoutMs: vi.fn(
    (cls: string): number | null => (cls === "async" ? null : 30_000)
  ),
  TOOL_TIMEOUT_POLICY: { fast: 30_000, network: 90_000, browser: 240_000 },
}));

// The loop's async dispatch gate: new Token().getValue(USER_AI_ENABLED).
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return "true";
    }
  },
}));

// AgentRuntime imports SkillExecutor for its default executeTool; tests
// always inject deps.executeTool, so the real one is never invoked.
vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: {
    execute: vi.fn(),
  },
}));

vi.mock("@/api/aiChatApi", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/api/aiChatApi")>();
  return {
    ...original,
    AiChatApi: class {
      openAIChatCompletionStream() {
        return Promise.resolve();
      }
    },
  };
});

const definition = {
  id: "agent-test",
  name: "Test Agent",
  description: "Test",
  version: 1,
  systemPrompt: "You are a test agent.",
  allowedTools: ["file_read"],
  mode: "specialist" as const,
  maxToolCalls: 10,
  maxRuntimeMs: 60_000,
  maxContinueCalls: 4,
  outputSchema: {
    type: "object",
    required: ["businessSummary", "sourceUrls", "confidence"],
    properties: {
      businessSummary: { type: "string" },
      sourceUrls: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
    },
  },
  status: "active" as const,
  source: "built-in" as const,
  health: "healthy" as const,
  manifest: {},
};

// Spies on the persisted task transcript so tests can assert how the
// runtime recorded the denial (status "blocked", actionable message).
const saveToolCallSpy = vi.fn();
const incrementToolCallsSpy = vi.fn();

vi.mock("@/modules/AgentDefinitionModule", () => ({
  AgentDefinitionModule: class {
    async getActiveById() {
      return definition;
    }
  },
}));

vi.mock("@/modules/AgentTaskModule", () => ({
  AgentTaskModule: class {
    async createTask() {
      return undefined;
    }
    async appendMessage() {
      return undefined;
    }
    async setStatus() {
      return undefined;
    }
    async saveResult() {
      return undefined;
    }
    async saveToolCall(...args: unknown[]) {
      saveToolCallSpy(...args);
      return undefined;
    }
    async incrementToolCalls() {
      incrementToolCallsSpy();
      return undefined;
    }
    async getSnapshot() {
      return { toolCallsCount: 0 };
    }
  },
}));

vi.mock("@/config/skillsRegistry", () => ({
  SkillRegistry: {
    getAllToolFunctions: vi.fn(async () => [
      {
        type: "function",
        name: "file_read",
        description: "Read file",
        parameters: { type: "object" },
      },
    ]),
    getSkill: vi.fn(() => ({
      name: "file_read",
      description: "Read file",
      parameters: { type: "object" },
      permissionCategory: "filesystem",
    })),
  },
}));

import { AgentRuntime } from "@/service/AgentRuntime";
import {
  ToolJobRegistry,
  setDefaultToolJobRegistry,
} from "@/service/ToolJobRegistry";
import type { OpenAIChatCompletionChunk } from "@/api/aiChatApi";
import type { AIChatQueryEvent } from "@/service/AIChatQueryEvents";

// --- Scripted stream helpers (mirror AIChatQueryLoopAsyncPoll.test.ts) -----

function makeToolCallChunk(
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

function makeStopChunk(content: string): OpenAIChatCompletionChunk {
  return {
    id: "resp-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, delta: { content }, finish_reason: "stop" }],
  };
}

const FINAL_JSON = JSON.stringify({
  businessSummary: "answered without file access",
  sourceUrls: [],
  confidence: 0.4,
});

interface CapturedStreamRequest {
  messages: Array<{
    role: string;
    content?: unknown;
    tool_call_id?: string;
  }>;
}

/**
 * Fake streamChatCompletion. Round 0 emits a file_read tool call; every
 * later round emits the final JSON answer, so the loop terminates once the
 * (denied) tool result has been fed back to the model. Captures each round's
 * request so tests can assert the model actually saw the denial.
 */
function makeStreamRoundTrips(): {
  streamFn: (
    req: unknown,
    onChunk: (c: OpenAIChatCompletionChunk) => void
  ) => Promise<void>;
  requests: CapturedStreamRequest[];
} {
  const requests: CapturedStreamRequest[] = [];
  let round = 0;
  const streamFn = async (
    req: unknown,
    onChunk: (c: OpenAIChatCompletionChunk) => void
  ): Promise<void> => {
    requests.push(req as CapturedStreamRequest);
    if (round === 0) {
      onChunk(makeToolCallChunk("call-1", "file_read", '{"path":"a.csv"}'));
    } else {
      onChunk(makeStopChunk(FINAL_JSON));
    }
    round += 1;
  };
  return { streamFn, requests };
}

/** The exact ToolExecutionResult shape SkillExecutor returns for a pending
 * permission prompt (SkillExecutor.ts "Permission required" branch). */
function permissionPromptResult(ctx: { toolCallId: string }, name: string) {
  return {
    tool_call_id: ctx.toolCallId,
    tool_name: name,
    success: false,
    result: {
      error: "Permission required",
      needsPermissionPrompt: true,
      permissionCategory: "filesystem",
    },
    execution_time_ms: 1,
  };
}

function makeDeps(streamFn: unknown) {
  const events: AIChatQueryEvent[] = [];
  const executeTool = vi.fn(
    async (name: string, _args: unknown, ctx: { toolCallId: string }) =>
      permissionPromptResult(ctx, name)
  );
  return {
    events,
    executeTool,
    deps: {
      streamFn,
      executeTool,
      eventSink: {
        emit: (e: AIChatQueryEvent) => {
          events.push(e);
        },
      },
    },
  };
}

function toolResultEvents(events: AIChatQueryEvent[]): Array<Record<string, unknown>> {
  return events
    .filter((e) => e.type === "tool_result")
    .map((e) => (e as { toolResult: Record<string, unknown> }).toolResult);
}

describe("AgentRuntime permission handling (real AIChatQueryLoop)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    timeoutState.inferClassOverride = undefined;
  });

  afterEach(() => {
    // Reset the async job registry so later suites get a clean default.
    setDefaultToolJobRegistry(new ToolJobRegistry());
  });

  it("does not pause the task when a foreground tool needs permission: the denial is fed back to the model and the task completes", async () => {
    const { streamFn, requests } = makeStreamRoundTrips();
    const { events, deps } = makeDeps(streamFn);

    const runtime = new AgentRuntime();
    const result = await runtime.runSync(
      {
        agentId: "agent-test",
        prompt: "read a.csv and summarize",
        executionMode: "foreground",
        taskPacket: {
          files: ["a.csv"],
          instruction: "summarize",
        },
      },
      {
        streamChatCompletion: streamFn as never,
        executeTool: deps.executeTool as never,
        eventSink: deps.eventSink,
      }
    );

    // THE regression: before the fix the loop returned paused_for_permission
    // and the task failed with "not supported in v1 runtime".
    expect(result.status).toBe("completed");
    expect(result.errorMessage).toBeUndefined();
    expect(result.output?.businessSummary).toBe(
      "answered without file access"
    );

    // The loop must have surfaced the rewrite as a plain denied tool result
    // (no pause event, no needsPermissionPrompt leakage to the renderer).
    const toolResults = toolResultEvents(events);
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].agentPermissionDenied).toBe(true);
    expect(toolResults[0].needsPermissionPrompt).toBeUndefined();
    expect(String(toolResults[0].error)).toMatch(/has not been granted/);

    // The model saw the denial as a tool-role message in round 1 — this is
    // what lets it adapt instead of stalling.
    expect(requests).toHaveLength(2);
    const toolMessages = (requests[1]?.messages ?? []).filter(
      (m) => m.role === "tool"
    );
    expect(toolMessages).toHaveLength(1);
    expect(String(toolMessages[0].content)).toMatch(/has not been granted/);

    // The transcript records the call as blocked with the actionable reason.
    expect(saveToolCallSpy).toHaveBeenCalledTimes(1);
    const record = saveToolCallSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(record.status).toBe("blocked");
    expect(String(record.errorMessage)).toMatch(/has not been granted/);
  });

  it("does not pause when the permission prompt arrives through the async job path (async tools like scrape_urls_from_search_engine)", async () => {
    // Route file_read through the ToolJobRegistry path, which is how every
    // async-class tool (run_subagent, scrape_urls_from_search_engine, ...)
    // executes. pollAsyncJobToCompletion unwraps ToolExecutionResult-shaped
    // job results, so this guards the interplay between that unwrap and the
    // runtime's rewrite.
    timeoutState.inferClassOverride = "async";
    setDefaultToolJobRegistry(
      new ToolJobRegistry({
        maxConcurrent: 4,
        staleAfterMs: 60_000,
        pollMinIntervalMs: 1,
      })
    );

    const { streamFn } = makeStreamRoundTrips();
    const { events, deps } = makeDeps(streamFn);

    const runtime = new AgentRuntime();
    const result = await runtime.runSync(
      {
        agentId: "agent-test",
        prompt: "read a.csv and summarize",
        executionMode: "foreground",
        taskPacket: {
          files: ["a.csv"],
          instruction: "summarize",
        },
      },
      {
        streamChatCompletion: streamFn as never,
        executeTool: deps.executeTool as never,
        eventSink: deps.eventSink,
      }
    );

    expect(result.status).toBe("completed");
    expect(result.errorMessage).toBeUndefined();

    const toolResults = toolResultEvents(events);
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].agentPermissionDenied).toBe(true);
    expect(toolResults[0].needsPermissionPrompt).toBeUndefined();
  }, 30_000);

  it("keeps the task alive when the model retries the denied tool: every retry gets the same explicit denial", async () => {
    // Model calls file_read, gets denied, stubbornly calls it again, then
    // gives up and answers. Each retry must receive the explicit denial
    // (never a pause), and the transcript must record both as blocked.
    const requests: CapturedStreamRequest[] = [];
    let round = 0;
    const streamFn = async (
      req: unknown,
      onChunk: (c: OpenAIChatCompletionChunk) => void
    ): Promise<void> => {
      requests.push(req as CapturedStreamRequest);
      if (round <= 1) {
        onChunk(
          makeToolCallChunk(`call-${round}`, "file_read", '{"path":"a.csv"}')
        );
      } else {
        onChunk(makeStopChunk(FINAL_JSON));
      }
      round += 1;
    };

    const { events, deps } = makeDeps(streamFn);
    const runtime = new AgentRuntime();
    const result = await runtime.runSync(
      {
        agentId: "agent-test",
        prompt: "read a.csv and summarize",
        executionMode: "foreground",
        taskPacket: {
          files: ["a.csv"],
          instruction: "summarize",
        },
      },
      {
        streamChatCompletion: streamFn as never,
        executeTool: deps.executeTool as never,
        eventSink: deps.eventSink,
      }
    );

    expect(result.status).toBe("completed");
    expect(deps.executeTool).toHaveBeenCalledTimes(2);

    const toolResults = toolResultEvents(events);
    expect(toolResults).toHaveLength(2);
    for (const tr of toolResults) {
      expect(tr.agentPermissionDenied).toBe(true);
      expect(tr.needsPermissionPrompt).toBeUndefined();
    }

    // Both retries recorded as blocked in the transcript.
    expect(saveToolCallSpy).toHaveBeenCalledTimes(2);
    for (const call of saveToolCallSpy.mock.calls) {
      const record = call[0] as Record<string, unknown>;
      expect(record.status).toBe("blocked");
    }

    // The final model round received both tool-role denials.
    const finalRoundToolMessages = (requests[2]?.messages ?? []).filter(
      (m) => m.role === "tool"
    );
    expect(finalRoundToolMessages).toHaveLength(2);
  });
});
