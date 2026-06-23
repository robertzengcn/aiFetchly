import { describe, it, expect, beforeEach } from "vitest";
import { HookDispatcher } from "@/service/hooks/HookDispatcher";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import {
  CallbackHookDefinition,
  HookInput,
} from "@/entityTypes/hookTypes";
import {
  setHookAuditLoggerForTests,
  HookAuditLogger,
} from "@/service/hooks/HookAuditService";

function baseInput(): HookInput {
  return {
    eventName: "PreToolUse",
    hookRunId: "run-1",
    source: "ai-chat-v2",
    timestamp: new Date().toISOString(),
    tool: { id: "t1", name: "shell_execute", source: "skill-registry" },
    input: { command: "ls" },
    permissionState: { allowed: true, needsPrompt: false },
  };
}

function cb(
  id: string,
  impl: (input: HookInput) => unknown,
  overrides: Partial<CallbackHookDefinition> = {}
): CallbackHookDefinition {
  return {
    id,
    eventName: "PreToolUse",
    source: "builtin",
    enabled: true,
    trusted: true,
    type: "callback",
    callback: impl as never,
    ...overrides,
  };
}

const NULL_LOGGER: HookAuditLogger = { log: () => undefined };

describe("HookDispatcher", () => {
  beforeEach(() => {
    HookRegistry.resetForTests();
    setHookAuditLoggerForTests(NULL_LOGGER);
  });

  it("returns EMPTY_AGGREGATE on the no-hooks fast path", async () => {
    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
      matchQuery: "shell_execute",
    });
    expect(result.blocked).toBe(false);
    expect(result.executedHookIds).toEqual([]);
    expect(result.additionalContexts).toEqual([]);
  });

  it("returns empty aggregate when abort signal is already aborted", async () => {
    HookRegistry.registerBuiltinHook(cb("h1", () => ({ continue: true })));
    const ac = new AbortController();
    ac.abort();
    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
      matchQuery: "shell_execute",
      abortSignal: ac.signal,
    });
    expect(result.executedHookIds).toEqual([]);
  });

  it("runs a matching callback hook and aggregates its output", async () => {
    HookRegistry.registerBuiltinHook(
      cb("h1", () => ({ additionalContext: "remember compliance" }))
    );
    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
      matchQuery: "shell_execute",
    });
    expect(result.executedHookIds).toEqual(["h1"]);
    expect(result.additionalContexts).toEqual(["remember compliance"]);
  });

  it("records a thrown callback as an error without crashing", async () => {
    HookRegistry.registerBuiltinHook(
      cb("h1", () => {
        throw new Error("boom");
      })
    );
    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
      matchQuery: "shell_execute",
    });
    expect(result.hookErrors).toHaveLength(1);
    expect(result.hookErrors[0].message).toBe("boom");
    expect(result.blocked).toBe(false); // default failureMode warn
  });

  it("records invalid callback output as an error", async () => {
    HookRegistry.registerBuiltinHook(
      cb("h1", () => ({ permissionDecision: "nope" }))
    );
    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
      matchQuery: "shell_execute",
    });
    expect(result.hookErrors).toHaveLength(1);
  });

  it("aggregates multiple callbacks in registration order", async () => {
    HookRegistry.registerBuiltinHook(
      cb("first", () => ({ updatedInput: { a: 1 } }))
    );
    HookRegistry.registerBuiltinHook(
      cb("second", () => ({ updatedInput: { a: 2, b: 3 } }))
    );
    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
      matchQuery: "shell_execute",
    });
    expect(result.executedHookIds).toEqual(["first", "second"]);
    expect(result.updatedInput).toEqual({ a: 2, b: 3 });
  });

  it("blocks the aggregate when a callback returns continue:false", async () => {
    HookRegistry.registerBuiltinHook(
      cb("h1", () => ({ continue: false, reason: "nope" }))
    );
    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
      matchQuery: "shell_execute",
    });
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe("nope");
  });

  it("emits audit start and success entries to the logger", async () => {
    const entries: string[] = [];
    setHookAuditLoggerForTests({
      log: (e) => entries.push(`${e.status}:${e.hookId}`),
    });
    HookRegistry.registerBuiltinHook(cb("h1", () => ({})));
    await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
      matchQuery: "shell_execute",
    });
    expect(entries).toEqual(["started:h1", "success:h1"]);
  });

  it("does not match hooks whose matcher does not cover the query", async () => {
    HookRegistry.registerBuiltinHook(
      cb("mcp-only", () => ({ continue: false }), { matcher: "mcp_*" })
    );
    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
      matchQuery: "shell_execute",
    });
    expect(result.executedHookIds).toEqual([]);
  });
});
