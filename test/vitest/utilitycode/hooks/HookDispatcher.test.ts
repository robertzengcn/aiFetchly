import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HookDispatcher } from "@/service/hooks/HookDispatcher";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { HookCommandTrustService } from "@/service/hooks/HookCommandTrustService";
import {
  CallbackHookDefinition,
  CommandHookDefinition,
  HookInput,
} from "@/entityTypes/hookTypes";
import {
  setHookAuditLoggerForTests,
  HookAuditLogger,
} from "@/service/hooks/HookAuditService";
import type {
  CommandHookExecutionResult,
  HookExecutionClient,
} from "@/service/hooks/hookExecutionClient";

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

// ---------------------------------------------------------------------------
// HOK-02 (Phase 17 / Plan 03 Task 2) — command-hook worker routing.
// ---------------------------------------------------------------------------

function cmdHook(
  id: string,
  overrides: Partial<CommandHookDefinition> = {}
): CommandHookDefinition {
  return {
    id,
    eventName: "PreToolUse",
    source: "user",
    enabled: true,
    trusted: true,
    type: "command",
    command: "echo hi",
    failureMode: "warn",
    ...overrides,
  };
}

function okResult(
  hook: CommandHookDefinition,
  output: Record<string, unknown>
): CommandHookExecutionResult {
  return {
    stdout: JSON.stringify(output),
    stderr: "",
    durationMs: 3,
    result: { hook, output: output as never, durationMs: 3 },
  };
}

describe("HookDispatcher HOK-02 (command-hook worker routing)", () => {
  let executeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    HookRegistry.resetForTests();
    HookCommandTrustService.resetForTests();
    setHookAuditLoggerForTests(NULL_LOGGER);
    executeSpy = vi.fn();
    HookDispatcher.setClientForTests({
      execute: executeSpy,
    } as unknown as HookExecutionClient);
  });

  afterEach(() => {
    HookRegistry.resetForTests();
    HookCommandTrustService.resetForTests();
  });

  it("routes a command hook through the worker client (SC2: no in-process child exec)", async () => {
    const hook = cmdHook("user:hook:0");
    HookRegistry.replaceSource("user", [hook]);
    HookCommandTrustService.setTrusted(hook.id, true);
    executeSpy.mockResolvedValue(okResult(hook, { continue: true }));

    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
    });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy.mock.calls[0][0].hook.id).toBe("user:hook:0");
    expect(result.blocked).toBe(false);
  });

  it("treats a skill-ref hook as a no-op with skill-registry-not-available (no execution, no throw)", async () => {
    const hook = cmdHook("user:hook:1", { command: "skill:my-skill" });
    HookRegistry.replaceSource("user", [hook]);
    HookCommandTrustService.setTrusted(hook.id, true);

    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.blocked).toBe(false);
    expect(
      result.hookErrors.some((e) =>
        e.message.includes("skill-registry-not-available")
      )
    ).toBe(true);
  });

  it("skips an untrusted command hook at the main-side gate (client NOT called)", async () => {
    const hook = cmdHook("user:hook:2");
    HookRegistry.replaceSource("user", [hook]);
    // HookCommandTrustService intentionally NOT set trusted.

    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.hookErrors.some((e) => /not trusted/i.test(e.message))).toBe(
      true
    );
  });

  it("treats a worker timeout as a non-fatal warn-mode error (stream not blocked)", async () => {
    const hook = cmdHook("user:hook:3");
    HookRegistry.replaceSource("user", [hook]);
    HookCommandTrustService.setTrusted(hook.id, true);
    executeSpy.mockResolvedValue({
      stdout: "",
      stderr: "",
      durationMs: 100,
      result: {
        hook,
        durationMs: 100,
        error: {
          hookId: hook.id,
          source: hook.source,
          message: "timed out",
          timedOut: true,
          durationMs: 100,
        },
      },
    });

    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
    });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(result.blocked).toBe(false);
    expect(result.hookErrors.length).toBeGreaterThan(0);
  });

  it("produces a PreToolUse block when the worker round-trip denies (continue:false)", async () => {
    const hook = cmdHook("user:hook:4");
    HookRegistry.replaceSource("user", [hook]);
    HookCommandTrustService.setTrusted(hook.id, true);
    executeSpy.mockResolvedValue(
      okResult(hook, { continue: false, reason: "deny via worker" })
    );

    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
    });

    expect(result.blocked).toBe(true);
    expect(result.blockReason).toMatch(/deny via worker/);
  });

  it("returns EMPTY_AGGREGATE on the no-hooks fast path without contacting the client (Pitfall 1)", async () => {
    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(result.blocked).toBe(false);
    expect(result.executedHookIds).toEqual([]);
    expect(result.hookErrors).toEqual([]);
  });
});
