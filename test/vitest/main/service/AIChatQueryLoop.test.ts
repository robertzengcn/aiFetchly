import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AIChatQueryLoop,
  resolveToolChoiceForRound,
  type AIChatQueryLoopDeps,
} from "@/service/AIChatQueryLoop";
import type { AIChatQueryLoopInput } from "@/service/AIChatQueryEvents";
import type {
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionRequest,
  OpenAIChatMessage,
  OpenAITool,
} from "@/api/aiChatApi";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { setHookAuditLoggerForTests } from "@/service/hooks/HookAuditService";

function makeChunk(
  delta: string,
  finishReason?: string
): OpenAIChatCompletionChunk {
  return {
    id: "resp-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [
      {
        index: 0,
        delta: { content: delta },
        finish_reason: finishReason ?? null,
      },
    ],
  };
}

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

function tool(name: string): OpenAITool {
  return {
    type: "function",
    function: {
      name,
      description: "test tool",
      parameters: { type: "object", properties: {} },
    },
  };
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 1000
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("AIChatQueryLoop", () => {
  beforeEach(() => {
    HookRegistry.resetForTests();
    setHookAuditLoggerForTests({ log: () => undefined });
  });

  describe("tool choice", () => {
    it("forces SubmitPlanForApproval on explicit submit-now plan requests", () => {
      expect(
        resolveToolChoiceForRound({
          message:
            "Do not ask more questions; submit the plan for approval now.",
          hasTools: true,
          isPlanMode: true,
          round: 0,
          startRound: 0,
        })
      ).toEqual({
        type: "function",
        function: { name: "SubmitPlanForApproval" },
      });
    });

    it("forces shell_execute for direct file removal requests when exposed", () => {
      expect(
        resolveToolChoiceForRound({
          message: "rm the file manual-delete-test.txt",
          hasTools: true,
          isPlanMode: false,
          round: 0,
          startRound: 0,
          exposedToolNames: ["file_read", "shell_execute"],
        })
      ).toEqual({
        type: "function",
        function: { name: "shell_execute" },
      });

      expect(
        resolveToolChoiceForRound({
          message: "delete the file manual-delete-test.txt",
          hasTools: true,
          isPlanMode: false,
          round: 0,
          startRound: 0,
          exposedToolNames: ["file_read", "shell_execute"],
        })
      ).toEqual({
        type: "function",
        function: { name: "shell_execute" },
      });
    });

    it("does not force shell_execute when the shell tool is not exposed", () => {
      expect(
        resolveToolChoiceForRound({
          message: "rm the file manual-delete-test.txt",
          hasTools: true,
          isPlanMode: false,
          round: 0,
          startRound: 0,
          exposedToolNames: ["file_read"],
        })
      ).toBe("auto");
    });
  });

  describe("normal streaming", () => {
    it("returns completed with full content when model finishes without tool calls", async () => {
      const emitted: string[] = [];
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          onChunk(makeChunk("Hello, "));
          onChunk(makeChunk("world!", "stop"));
        }
      );
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: vi.fn(),
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "assistant-1",
        messages: [],
        request: { message: "hi" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: {
          emit: (e) => {
            if (e.type === "token") emitted.push(e.contentDelta);
          },
        },
        startRound: 0,
        isActiveTurn: () => true,
      };
      const result = await loop.run(input);
      expect(result.type).toBe("completed");
      if (result.type === "completed") {
        expect(result.fullContent).toBe("Hello, world!");
        expect(result.finishReason).toBe("stop");
        expect(result.model).toBe("test-model");
      }
      expect(emitted.join("")).toBe("Hello, world!");
    });
  });

  describe("tool calls", () => {
    it("submits an immediate approval plan when explicit submit-now plan mode gets an empty model response", async () => {
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          onChunk(makeChunk("", "stop"));
        }
      );
      const events: unknown[] = [];
      const submittedPlan = {
        planId: "plan-immediate",
        conversationId: "v2-test",
        status: "awaiting_approval",
        title: "Immediate approval plan",
        objective: "Submit a plan now",
        currentVersion: 1,
      };
      const submitPlanForApproval = vi.fn().mockResolvedValue(submittedPlan);
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: vi.fn(),
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });

      const result = await loop.run({
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: {
          message:
            "Create an approval plan. Do not ask questions. Submit the plan for approval now.",
          mode: "plan",
        },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: (event) => events.push(event) },
        planContext: {
          planModule: {
            saveQuestion: vi.fn(),
            submitPlanForApproval,
            getPlanStateByPlanId: vi.fn(),
            answerQuestion: vi.fn(),
          },
          planState: {
            planId: "plan-immediate",
            conversationId: "v2-test",
            status: "draft",
            title: "Immediate approval plan",
            objective: "Submit a plan now",
            currentVersion: 0,
          } as never,
        },
        startRound: 0,
        isActiveTurn: () => true,
      });

      expect(result.type).toBe("completed");
      expect(submitPlanForApproval).toHaveBeenCalled();
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "plan_submitted",
          planState: submittedPlan,
        })
      );
      if (result.type === "completed") {
        expect(result.fullContent).toContain("submitted for approval");
      }
    });

    it("executes tool and continues to next round when finish_reason is tool_calls", async () => {
      const toolCallChunk = makeToolCallChunk(
        "call-1",
        "search",
        '{"q":"test"}'
      );
      const finalChunk = makeChunk("Done", "stop");
      let callCount = 0;
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          if (callCount === 0) {
            onChunk(toolCallChunk);
            callCount++;
          } else {
            onChunk(finalChunk);
          }
        }
      );
      const fakeExecute = vi.fn().mockResolvedValue({
        tool_call_id: "call-1",
        tool_name: "search",
        success: true,
        result: { answer: "found" },
        execution_time_ms: 10,
      });
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: fakeExecute,
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: { message: "hi" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: vi.fn() },
        startRound: 0,
        isActiveTurn: () => true,
      };
      const result = await loop.run(input);
      expect(result.type).toBe("completed");
      expect(fakeExecute).toHaveBeenCalledWith(
        "search",
        { q: "test" },
        expect.objectContaining({ toolCallId: "call-1" })
      );
    });

    it("retries when provider emits a tool-call marker as plain text", async () => {
      const events: Array<{ type: string; message?: string }> = [];
      let callCount = 0;
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          if (callCount === 0) {
            callCount += 1;
            onChunk(makeChunk("user:tool_call::def_tool_call:0", "stop"));
            return;
          }
          if (callCount === 1) {
            callCount += 1;
            onChunk(
              makeToolCallChunk(
                "call-1",
                "file_edit",
                JSON.stringify({
                  path: "manual-tool-test.txt",
                  old_string: "manual test",
                  new_string: "manual test 20260723",
                })
              )
            );
            return;
          }
          onChunk(makeChunk("Done", "stop"));
        }
      );
      const fakeExecute = vi.fn().mockResolvedValue({
        tool_call_id: "call-1",
        tool_name: "file_edit",
        success: true,
        result: { path: "manual-tool-test.txt" },
        execution_time_ms: 10,
      });
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: fakeExecute,
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: {
          message: 'update file content with "manual test 20260723"',
        },
        openAITools: [tool("file_edit")],
        abortController: new AbortController(),
        eventSink: {
          emit: (e) => {
            if (e.type === "recovery_status") {
              events.push({ type: e.type, message: e.message });
            }
          },
        },
        startRound: 0,
        isActiveTurn: () => true,
      };

      const result = await loop.run(input);

      expect(result.type).toBe("completed");
      if (result.type === "completed") {
        expect(result.fullContent).toBe("Done");
      }
      expect(fakeStream).toHaveBeenCalledTimes(3);
      expect(fakeExecute).toHaveBeenCalledWith(
        "file_edit",
        {
          path: "manual-tool-test.txt",
          old_string: "manual test",
          new_string: "manual test 20260723",
        },
        expect.objectContaining({ toolCallId: "call-1" })
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "recovery_status",
          message: "Retrying malformed tool-call marker response",
        })
      );
    });

    it("sends forced shell_execute tool_choice for first-round file deletion", async () => {
      const captured: OpenAIChatCompletionRequest[] = [];
      const fakeStream = vi.fn(
        async (
          req: OpenAIChatCompletionRequest,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          captured.push(req);
          onChunk(makeChunk("Done", "stop"));
        }
      );
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: vi.fn(),
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: { message: "rm the file manual-delete-test.txt" },
        openAITools: [tool("file_read"), tool("shell_execute")],
        abortController: new AbortController(),
        eventSink: { emit: vi.fn() },
        startRound: 0,
        isActiveTurn: () => true,
      };

      await loop.run(input);

      expect(captured[0].tool_choice).toEqual({
        type: "function",
        function: { name: "shell_execute" },
      });
    });

    it("waits for tool-call persistence to flush before executing the tool", async () => {
      const toolCallChunk = makeToolCallChunk(
        "call-1",
        "create_html_artifact",
        '{"title":"Report","html":"<html><body>v2</body></html>"}'
      );
      const finalChunk = makeChunk("Done", "stop");
      let callCount = 0;
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          if (callCount === 0) {
            callCount++;
            onChunk(toolCallChunk);
            return;
          }
          onChunk(finalChunk);
        }
      );
      const fakeExecute = vi.fn().mockResolvedValue({
        tool_call_id: "call-1",
        tool_name: "create_html_artifact",
        success: true,
        result: { artifact: { id: "artifact-1" } },
        execution_time_ms: 10,
      });
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: fakeExecute,
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      let releaseFlush: (() => void) | undefined;
      const flushStarted = vi.fn();
      const flushPromise = new Promise<void>((resolve) => {
        releaseFlush = resolve;
      });

      const runPromise = loop.run({
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: { message: "revise report" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: {
          emit: vi.fn(),
          flush: async () => {
            flushStarted();
            await flushPromise;
          },
        },
        startRound: 0,
        isActiveTurn: () => true,
      });

      await waitForCondition(() => flushStarted.mock.calls.length === 1);
      expect(flushStarted).toHaveBeenCalledOnce();
      expect(fakeExecute).not.toHaveBeenCalled();

      releaseFlush?.();
      const result = await runPromise;

      expect(result.type).toBe("completed");
      expect(fakeExecute).toHaveBeenCalledWith(
        "create_html_artifact",
        { title: "Report", html: "<html><body>v2</body></html>" },
        expect.objectContaining({ toolCallId: "call-1" })
      );
    });

    it("injects PreToolUse command hook context into the next model round", async () => {
      HookRegistry.registerUserHook({
        id: "test-tool-name-context",
        eventName: "PreToolUse",
        source: "user",
        enabled: true,
        type: "command",
        matcher: "shell_execute",
        command: `${process.execPath} -e "let b='';process.stdin.on('data',c=>b+=c);process.stdin.on('end',()=>{const i=JSON.parse(b);process.stdout.write(JSON.stringify({continue:true,additionalContext:'tool.name='+i.tool.name}));})"`,
        timeoutMs: 5000,
      });

      const toolCallChunk = makeToolCallChunk(
        "call-1",
        "shell_execute",
        '{"command":"echo hello"}'
      );
      const finalChunk = makeChunk("Done", "stop");
      let callCount = 0;
      let secondRoundMessages: readonly OpenAIChatMessage[] = [];
      const fakeStream = vi.fn(
        async (
          request: OpenAIChatCompletionRequest,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          if (callCount === 0) {
            callCount++;
            onChunk(toolCallChunk);
            return;
          }
          secondRoundMessages = request.messages;
          onChunk(finalChunk);
        }
      );
      const fakeExecute = vi.fn().mockResolvedValue({
        tool_call_id: "call-1",
        tool_name: "shell_execute",
        success: true,
        result: { stdout: "hello\n" },
        execution_time_ms: 10,
      });
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: fakeExecute,
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: { message: "run shell command echo hello" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: vi.fn() },
        startRound: 0,
        isActiveTurn: () => true,
      };

      const result = await loop.run(input);

      expect(result.type).toBe("completed");
      expect(fakeExecute).toHaveBeenCalledWith(
        "shell_execute",
        { command: "echo hello" },
        expect.objectContaining({ toolCallId: "call-1" })
      );
      expect(JSON.stringify(secondRoundMessages)).toContain(
        "tool.name=shell_execute"
      );
    });

    it("applies PreToolUse updatedInput before executing a tool", async () => {
      HookRegistry.registerUserHook({
        id: "test-shell-rewrite",
        eventName: "PreToolUse",
        source: "user",
        enabled: true,
        type: "command",
        matcher: "shell_execute",
        command: `${process.execPath} -e "process.stdout.write(JSON.stringify({updatedInput:{command:'echo safe'}}))"`,
        timeoutMs: 5000,
      });

      const toolCallChunk = makeToolCallChunk(
        "call-1",
        "shell_execute",
        '{"command":"echo hello"}'
      );
      const finalChunk = makeChunk("Done", "stop");
      let callCount = 0;
      const fakeStream = vi.fn(
        async (
          _request: OpenAIChatCompletionRequest,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          if (callCount === 0) {
            callCount++;
            onChunk(toolCallChunk);
            return;
          }
          onChunk(finalChunk);
        }
      );
      const fakeExecute = vi.fn().mockResolvedValue({
        tool_call_id: "call-1",
        tool_name: "shell_execute",
        success: true,
        result: { stdout: "safe\n" },
        execution_time_ms: 10,
      });
      const eventSink = { emit: vi.fn() };
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: fakeExecute,
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: { message: "run shell command echo hello" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink,
        startRound: 0,
        isActiveTurn: () => true,
      };

      const result = await loop.run(input);

      expect(result.type).toBe("completed");
      expect(fakeExecute).toHaveBeenCalledWith(
        "shell_execute",
        { command: "echo safe" },
        expect.objectContaining({ toolCallId: "call-1" })
      );
      expect(eventSink.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "tool_call",
          toolArguments: { command: "echo safe" },
        })
      );
    });

    it("returns failed for malformed tool arguments", async () => {
      const badChunk = makeToolCallChunk("call-1", "search", "{invalid json");
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          onChunk(badChunk);
        }
      );
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: vi.fn(),
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: { message: "hi" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: vi.fn() },
        startRound: 0,
        isActiveTurn: () => true,
      };
      const result = await loop.run(input);
      expect(result.type).toBe("failed");
    });

    it("returns failed when stream ends after an unusable tool call delta", async () => {
      const incompleteChunk: OpenAIChatCompletionChunk = {
        id: "resp-1",
        object: "chat.completion.chunk",
        created: 1,
        model: "test-model",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      };
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          onChunk(incompleteChunk);
        }
      );
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: vi.fn(),
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: { message: "hi" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: vi.fn() },
        startRound: 0,
        isActiveTurn: () => true,
      };

      const result = await loop.run(input);

      expect(result.type).toBe("failed");
      if (result.type === "failed") {
        expect(result.error).toBeInstanceOf(Error);
        expect((result.error as Error).message).toContain(
          "ended before returning a complete response"
        );
      }
    });

    it("returns paused_for_permission when tool result needs permission", async () => {
      const toolCallChunk = makeToolCallChunk("call-1", "scrape", "{}");
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          onChunk(toolCallChunk);
        }
      );
      const fakeExecute = vi.fn().mockResolvedValue({
        tool_call_id: "call-1",
        tool_name: "scrape",
        success: false,
        result: { needsPermissionPrompt: true },
        execution_time_ms: 1,
      });
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: fakeExecute,
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: { message: "hi" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: vi.fn() },
        startRound: 0,
        isActiveTurn: () => true,
      };
      const result = await loop.run(input);
      expect(result.type).toBe("paused_for_permission");
      if (result.type === "paused_for_permission") {
        expect(result.pending.toolCallId).toBe("call-1");
        expect(result.pending.nextRound).toBe(1);
      }
    });

    it("stores PreToolUse updatedInput in pending permission state", async () => {
      HookRegistry.registerUserHook({
        id: "test-pending-shell-rewrite",
        eventName: "PreToolUse",
        source: "user",
        enabled: true,
        type: "command",
        matcher: "shell_execute",
        command: `${process.execPath} -e "process.stdout.write(JSON.stringify({updatedInput:{command:'echo safe'}}))"`,
        timeoutMs: 5000,
      });

      const toolCallChunk = makeToolCallChunk(
        "call-1",
        "shell_execute",
        '{"command":"echo hello"}'
      );
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          onChunk(toolCallChunk);
        }
      );
      const fakeExecute = vi.fn().mockResolvedValue({
        tool_call_id: "call-1",
        tool_name: "shell_execute",
        success: false,
        result: { needsPermissionPrompt: true },
        execution_time_ms: 1,
      });
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: fakeExecute,
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: { message: "run shell command echo hello" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: vi.fn() },
        startRound: 0,
        isActiveTurn: () => true,
      };

      const result = await loop.run(input);

      expect(result.type).toBe("paused_for_permission");
      if (result.type === "paused_for_permission") {
        expect(result.pending.toolArguments).toEqual({ command: "echo safe" });
      }
    });

    it("executes tool calls even when server sends finish_reason=stop with tool_calls delta", async () => {
      // Some OpenAI-compatible servers emit finish_reason="stop" even when
      // tool-call deltas were streamed. The loop must still execute the
      // parsed tool calls — relying on parsedCalls rather than finish_reason.
      const toolCallChunkWithStop: OpenAIChatCompletionChunk = {
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
                  id: "call-1",
                  type: "function",
                  function: { name: "search", arguments: '{"q":"canada"}' },
                },
              ],
            },
            finish_reason: "stop",
          },
        ],
      };
      const finalChunk = makeChunk("Found customers.", "stop");
      let callCount = 0;
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          if (callCount === 0) {
            onChunk(toolCallChunkWithStop);
            callCount++;
          } else {
            onChunk(finalChunk);
          }
        }
      );
      const fakeExecute = vi.fn().mockResolvedValue({
        tool_call_id: "call-1",
        tool_name: "search",
        success: true,
        result: { answer: "found" },
        execution_time_ms: 10,
      });
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: fakeExecute,
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: { message: "find customers in Canada" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: vi.fn() },
        startRound: 0,
        isActiveTurn: () => true,
      };
      const result = await loop.run(input);
      expect(result.type).toBe("completed");
      expect(fakeExecute).toHaveBeenCalledWith(
        "search",
        { q: "canada" },
        expect.objectContaining({ toolCallId: "call-1" })
      );
    });

    it("emits tool_call and tool_result events through eventSink", async () => {
      const toolCallChunk = makeToolCallChunk("call-1", "get_time", "{}");
      const finalChunk = makeChunk("It is noon.", "stop");
      let callCount = 0;
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          if (callCount === 0) {
            onChunk(toolCallChunk);
            callCount++;
          } else {
            onChunk(finalChunk);
          }
        }
      );
      const fakeExecute = vi.fn().mockResolvedValue({
        tool_call_id: "call-1",
        tool_name: "get_time",
        success: true,
        result: { time: "12:00" },
        execution_time_ms: 5,
      });
      const events: string[] = [];
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: fakeExecute,
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: { message: "hi" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: {
          emit: (e) => {
            events.push(e.type);
          },
        },
        startRound: 0,
        isActiveTurn: () => true,
      };
      await loop.run(input);
      expect(events).toContain("tool_call");
      expect(events).toContain("tool_result");
    });

    it("emits usage_update BEFORE tool_call when the server reports no in-stream usage", async () => {
      // Regression: many providers (ZhipuAI/Google/Anthropic) never emit a
      // usage chunk, so usage_update only fired once at turn end — AFTER the
      // tool_call row was already persisted with tokensUsed=null. The
      // persisting sink attributes tokens to tool_call rows from the most
      // recent usage_update, so usage_update MUST precede tool_call.
      const toolCallChunk = makeToolCallChunk("call-1", "get_time", "{}");
      const finalChunk = makeChunk("It is noon.", "stop");
      let callCount = 0;
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          if (callCount === 0) {
            onChunk(toolCallChunk);
            callCount++;
          } else {
            onChunk(finalChunk);
          }
        }
      );
      const fakeExecute = vi.fn().mockResolvedValue({
        tool_call_id: "call-1",
        tool_name: "get_time",
        success: true,
        result: { time: "12:00" },
        execution_time_ms: 5,
      });
      const events: string[] = [];
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: fakeExecute,
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [{ role: "user", content: "what time is it" }],
        request: { message: "what time is it" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: {
          emit: (e) => {
            events.push(e.type);
          },
        },
        startRound: 0,
        isActiveTurn: () => true,
      };
      await loop.run(input);

      const firstToolCallIndex = events.indexOf("tool_call");
      const firstUsageIndex = events.indexOf("usage_update");
      // A usage_update must be emitted at all...
      expect(firstUsageIndex).toBeGreaterThanOrEqual(0);
      // ...and it must come BEFORE the first tool_call so the persisting
      // sink has latestUsage populated when it saves the tool_call row.
      expect(firstUsageIndex).toBeLessThan(firstToolCallIndex);
    });

    it("returns a clear fallback message when a failed tool is followed by an empty model response", async () => {
      const toolCallChunk = makeToolCallChunk(
        "call-1",
        "run_subagent",
        '{"agentId":"agent-lead-researcher"}'
      );
      let callCount = 0;
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          if (callCount === 0) {
            callCount += 1;
            onChunk(toolCallChunk);
            return;
          }
          onChunk(makeChunk("", "stop"));
        }
      );
      const fakeExecute = vi.fn().mockResolvedValue({
        tool_call_id: "call-1",
        tool_name: "run_subagent",
        success: false,
        result: { error: "Agent task timed out." },
        execution_time_ms: 180000,
      });
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: fakeExecute,
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const result = await loop.run({
        conversationId: "v2-test",
        assistantMessageId: "a-1",
        messages: [],
        request: { message: "run a subagent" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: vi.fn() },
        startRound: 0,
        isActiveTurn: () => true,
      });

      expect(result.type).toBe("completed");
      if (result.type === "completed") {
        expect(result.fullContent).toContain("run_subagent");
        expect(result.fullContent).toContain("Agent task timed out.");
      }
    });
  });

  describe("truncated JSON tool arguments", () => {
    it("emits compact-payload guidance when tool call JSON looks truncated", async () => {
      // Simulates run_subagent with a taskPacket so large the JSON gets
      // truncated mid-object (missing closing brace). The loop should emit
      // a tool_result event with specific guidance about keeping args compact.
      // Built as a raw string because the truncation is in the mock data itself.
      const truncated =
        '{"agentId":"agent-lead-researcher","prompt":"Research Stripe","taskPacket":' +
        '{"lead":{"companyName":"Stripe","contacts":[{"name":"John"';
      const truncChunk = makeToolCallChunk(
        "call-trunc",
        "run_subagent",
        truncated
      );

      const eventSink = { emit: vi.fn() };

      // Return the same truncated chunk on every round
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          onChunk(truncChunk);
        }
      );

      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: vi.fn(),
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });

      const result = await loop.run({
        conversationId: "v2-trunc",
        assistantMessageId: "a-trunc",
        messages: [],
        request: { message: "enrich these leads" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink,
        startRound: 0,
        isActiveTurn: () => true,
      });

      // After 4 consecutive malformed rounds, the loop returns "failed"
      expect(result.type).toBe("failed");

      // Check that at least one tool_result event carried the compact-payload
      // guidance message (emitted before the retry limit was exhausted)
      const toolResultEvents = (
        eventSink.emit as ReturnType<typeof vi.fn>
      ).mock.calls
        .filter(
          (call: unknown[]) =>
            (call[0] as { type?: string }).type === "tool_result"
        )
        .map(
          (call: unknown[]) =>
            (call[0] as { toolResult?: { error?: string } }).toolResult
              ?.error ?? ""
        );

      expect(toolResultEvents.length).toBeGreaterThan(0);
      const hasTruncationGuidance = toolResultEvents.some(
        (msg: string) => msg.includes("cut off") && msg.includes("incomplete")
      );
      expect(hasTruncationGuidance).toBe(true);
    });
  });

  describe("server-side error finish_reason", () => {
    it("surfaces a retryable-tagged error when the stream ends with finish_reason=error and empty content", async () => {
      // Reproduces the real-world failure mode where the AI server returns
      // finish_reason="error" with empty content (typically under load).
      // The SSE recovery path in aiChatApi emits a chunk carrying the
      // error finish_reason; the loop must surface it as a recognizable
      // error so userSafeError can translate it to an actionable message.
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          onChunk(makeChunk("", "error"));
        }
      );
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: vi.fn(),
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-err",
        assistantMessageId: "assistant-err",
        messages: [],
        request: { message: "hi" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: vi.fn() },
        startRound: 0,
        isActiveTurn: () => true,
        // This test exercises the error-TAGGING path in isolation (the loop
        // surfacing a recognizable failed error), not the retry behavior — so
        // disable the transient-failure auto-retry that would otherwise kick
        // in for finish_reason=error. Retry coverage lives in the
        // "transient failure auto-retry" suite below.
        transientRetryConfig: { maxAttempts: 0 },
      };

      const result = await loop.run(input);
      expect(result.type).toBe("failed");
      if (result.type === "failed") {
        expect(result.error).toBeInstanceOf(Error);
        const msg = (result.error as Error).message;
        expect(msg).toMatch(/finish_reason=error/i);
        expect(msg).toMatch(/transient server/i);
      }
    });
  });

  describe("seven-layer recovery", () => {
    it("Layer 3: escalates max_tokens on finish_reason=length then completes", async () => {
      const events: Array<{ type: string; layer?: string }> = [];
      let callCount = 0;
      const fakeStream = vi.fn(
        async (
          req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          callCount += 1;
          if (callCount === 1) {
            // Truncated response.
            onChunk(makeChunk("partial", "length"));
          } else {
            // After escalation, the model finishes cleanly.
            onChunk(makeChunk(" full", "stop"));
          }
          void req;
        }
      );
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: vi.fn(),
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const input: AIChatQueryLoopInput = {
        conversationId: "v2-test",
        assistantMessageId: "a1",
        messages: [],
        request: { message: "hi" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: {
          emit: (e) => {
            events.push({
              type: e.type,
              layer: "layer" in e ? (e as { layer?: string }).layer : undefined,
            });
          },
        },
        startRound: 0,
        isActiveTurn: () => true,
      };
      const result = await loop.run(input);
      expect(result.type).toBe("completed");
      const recoveryEvents = events.filter((e) => e.type === "recovery_status");
      expect(recoveryEvents.length).toBeGreaterThan(0);
      expect(recoveryEvents[0]?.layer).toBe("output_token_recovery");
    });

    it("Layer 3: continuation preserves the truncated prefix in fullContent", async () => {
      // Force escalation first (round 1), then continuation (round 2),
      // then a clean stop (round 3). Verifies the prefix is concatenated
      // rather than lost when the accumulator resets each round.
      let callCount = 0;
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          callCount += 1;
          if (callCount === 1) {
            onChunk(makeChunk("alpha", "length")); // triggers escalation
          } else if (callCount === 2) {
            onChunk(makeChunk("beta", "length")); // triggers continuation
          } else {
            onChunk(makeChunk("gamma", "stop")); // clean completion
          }
        }
      );
      const loop = new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: vi.fn(),
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
      const result = await loop.run({
        conversationId: "v2-test",
        assistantMessageId: "a-prefix",
        messages: [],
        request: { message: "hi" },
        openAITools: [],
        abortController: new AbortController(),
        eventSink: { emit: () => undefined },
        startRound: 0,
        isActiveTurn: () => true,
      });
      expect(result.type).toBe("completed");
      if (result.type === "completed") {
        // alpha was followed by continuation; beta by continuation;
        // gamma was the final clean tail. All three must be present.
        expect(result.fullContent).toContain("alpha");
        expect(result.fullContent).toContain("beta");
        expect(result.fullContent).toContain("gamma");
        expect(result.fullContent).toBe("alphabetagamma");
      }
    });
  });

  describe("transient failure auto-retry", () => {
    function buildLoop(
      fakeStream: AIChatQueryLoopDeps["streamChatCompletion"]
    ): AIChatQueryLoop {
      return new AIChatQueryLoop({
        streamChatCompletion: fakeStream,
        executeTool: vi.fn(),
        getSkillDefinition: vi.fn().mockReturnValue(undefined),
      });
    }

    function buildInput(
      opts: {
        tokens?: string[];
        events?: { type: string; retryAttempt?: number }[];
        transientRetryConfig?: { maxAttempts?: number; baseDelayMs?: number };
        isActiveTurn?: () => boolean;
        abortController?: AbortController;
      } = {}
    ): AIChatQueryLoopInput {
      return {
        conversationId: "v2-test",
        assistantMessageId: "assistant-1",
        messages: [{ role: "user", content: "hi" }],
        request: { message: "hi" },
        openAITools: [],
        abortController: opts.abortController ?? new AbortController(),
        eventSink: {
          emit: (e) => {
            if (e.type === "token" && opts.tokens) {
              opts.tokens.push(e.contentDelta);
            }
            if (opts.events) {
              opts.events.push({
                type: e.type,
                retryAttempt:
                  e.type === "retry_connect" ? e.retryAttempt : undefined,
              });
            }
          },
        },
        startRound: 0,
        isActiveTurn: opts.isActiveTurn ?? (() => true),
        // Instant retries so the suite never waits on real backoff.
        transientRetryConfig: opts.transientRetryConfig ?? {
          maxAttempts: 3,
          baseDelayMs: 0,
        },
      };
    }

    const TRANSIENT_FINISH_ERROR =
      "AI server returned finish_reason=error (transient server-side failure).";

    it("retries a content-level transient failure (finish_reason=error) and succeeds", async () => {
      const events: { type: string; retryAttempt?: number }[] = [];
      let call = 0;
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          call += 1;
          if (call === 1) {
            throw new Error(TRANSIENT_FINISH_ERROR);
          }
          onChunk(makeChunk("Hello!", "stop"));
        }
      );
      const loopInstance = buildLoop(fakeStream);
      const result = await loopInstance.run(buildInput({ events }));
      expect(result.type).toBe("completed");
      if (result.type === "completed") {
        expect(result.fullContent).toBe("Hello!");
      }
      expect(fakeStream).toHaveBeenCalledTimes(2);
      // A retry_connect event must be emitted between the two attempts.
      const retries = events.filter((e) => e.type === "retry_connect");
      expect(retries).toHaveLength(1);
      expect(retries[0].retryAttempt).toBe(1);
    });

    it("retries an empty-response transient failure (no finish reason)", async () => {
      let call = 0;
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          call += 1;
          if (call === 1) {
            throw new Error(
              "AI server returned an empty response with no finish reason."
            );
          }
          onChunk(makeChunk("ok", "stop"));
        }
      );
      const result = await buildLoop(fakeStream).run(buildInput());
      expect(result.type).toBe("completed");
      expect(fakeStream).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry a non-transient error (surfaces immediately)", async () => {
      const fakeStream = vi.fn(async () => {
        throw new Error("Selected model is not available.");
      });
      const result = await buildLoop(fakeStream).run(buildInput());
      expect(result.type).toBe("failed");
      expect(fakeStream).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry transport-layer conditions the HTTP client already retries (anti-stacking)", async () => {
      for (const msg of [
        "upstream returned 502 Bad Gateway",
        "rate limit exceeded",
        "Request timeout",
        "AI server error code=503",
        "transient server error",
      ]) {
        const fakeStream = vi.fn(async () => {
          throw new Error(msg);
        });
        const result = await buildLoop(fakeStream).run(buildInput());
        expect(result.type).toBe("failed");
        expect(fakeStream).toHaveBeenCalledTimes(1);
      }
    });

    it("does NOT retry after content has been delivered to the UI (anti-duplication)", async () => {
      const tokens: string[] = [];
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          // Content is delivered BEFORE the transient failure.
          onChunk(makeChunk("partial-answer"));
          throw new Error(TRANSIENT_FINISH_ERROR);
        }
      );
      const result = await buildLoop(fakeStream).run(buildInput({ tokens }));
      // Because content reached the UI, retrying would duplicate it — so the
      // failure is surfaced instead of retried.
      expect(result.type).toBe("failed");
      expect(fakeStream).toHaveBeenCalledTimes(1);
      expect(tokens).toEqual(["partial-answer"]);
    });

    it("gives up after maxAttempts and returns the failed result", async () => {
      const fakeStream = vi.fn(async () => {
        throw new Error(TRANSIENT_FINISH_ERROR);
      });
      const result = await buildLoop(fakeStream).run(
        buildInput({
          transientRetryConfig: { maxAttempts: 2, baseDelayMs: 0 },
        })
      );
      expect(result.type).toBe("failed");
      // 1 initial attempt + 2 retries.
      expect(fakeStream).toHaveBeenCalledTimes(3);
    });

    it("stops retrying when the turn is no longer active (conversation switch)", async () => {
      let active = true;
      const fakeStream = vi.fn(async () => {
        // After the first attempt the user switches conversation.
        active = false;
        throw new Error(TRANSIENT_FINISH_ERROR);
      });
      const result = await buildLoop(fakeStream).run(
        buildInput({ isActiveTurn: () => active })
      );
      expect(result.type).toBe("failed");
      expect(fakeStream).toHaveBeenCalledTimes(1);
    });

    it("stops retrying when the turn is aborted mid-attempt", async () => {
      const ac = new AbortController();
      const fakeStream = vi.fn(async () => {
        // User hits Stop during the first attempt.
        ac.abort();
        throw new Error(TRANSIENT_FINISH_ERROR);
      });
      const result = await buildLoop(fakeStream).run(
        buildInput({ abortController: ac })
      );
      expect(result.type).toBe("failed");
      expect(fakeStream).toHaveBeenCalledTimes(1);
    });

    it("retries from a pristine transcript snapshot (failed-attempt mutations do not leak)", async () => {
      const seenCounts: number[] = [];
      let call = 0;
      const fakeStream = vi.fn(
        async (
          _req: unknown,
          onChunk: (c: OpenAIChatCompletionChunk) => void
        ) => {
          const req = _req as { messages: OpenAIChatMessage[] };
          seenCounts.push(req.messages.length);
          call += 1;
          if (call === 1) {
            // Simulate an in-progress transcript mutation during the failed
            // attempt (the loop pushes continuation/tool rows mid-round)
            // before the transient failure surfaces.
            req.messages.push({ role: "user", content: "LEAK-SENTINEL" });
            throw new Error(TRANSIENT_FINISH_ERROR);
          }
          onChunk(makeChunk("recovered", "stop"));
        }
      );
      const result = await buildLoop(fakeStream).run(buildInput());
      expect(result.type).toBe("completed");
      // First attempt saw the original 1 message; the retry must start from a
      // fresh snapshot of the original transcript (1 message), NOT the
      // mutated 2-message array the failed attempt left behind.
      expect(seenCounts).toEqual([1, 1]);
    });
  });
});
