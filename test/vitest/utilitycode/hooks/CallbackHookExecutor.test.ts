import { describe, it, expect, beforeEach } from "vitest";
import { executeCallback } from "@/service/hooks/executors/CallbackHookExecutor";
import {
  CallbackHookDefinition,
  HookInput,
} from "@/entityTypes/hookTypes";

function makeInput(): HookInput {
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
  callback: (input: HookInput) => unknown,
  overrides: Partial<CallbackHookDefinition> = {}
): CallbackHookDefinition {
  return {
    id: "test-cb",
    eventName: "PreToolUse",
    source: "builtin",
    enabled: true,
    trusted: true,
    type: "callback",
    callback: callback as never,
    ...overrides,
  };
}

describe("executeCallback", () => {
  beforeEach(() => {
    // No global state; tests construct fresh hooks.
  });

  it("returns validated output on success", async () => {
    const r = await executeCallback(
      cb(() => ({ continue: true })),
      makeInput()
    );
    expect(r.error).toBeUndefined();
    expect(r.output?.continue).toBe(true);
    expect(typeof r.durationMs).toBe("number");
  });

  it("normalizes undefined return into empty output", async () => {
    const r = await executeCallback(
      cb(() => undefined),
      makeInput()
    );
    expect(r.error).toBeUndefined();
    expect(r.output).toEqual({});
  });

  it("converts a thrown error into HookExecutionError", async () => {
    const r = await executeCallback(
      cb(() => {
        throw new Error("boom");
      }),
      makeInput()
    );
    expect(r.output).toBeUndefined();
    expect(r.error?.message).toBe("boom");
    expect(r.error?.hookId).toBe("test-cb");
  });

  it("converts a rejection into HookExecutionError", async () => {
    const r = await executeCallback(
      cb(async () => {
        await Promise.reject(new Error("async boom"));
      }),
      makeInput()
    );
    expect(r.error?.message).toBe("async boom");
  });

  it("rejects invalid output shape as a hook error", async () => {
    const r = await executeCallback(
      cb(() => ({ permissionDecision: "yes" })),
      makeInput()
    );
    expect(r.error).toBeDefined();
    expect(r.error?.message).toMatch(/permissionDecision|Invalid/);
  });

  it("rejects primitive return as a hook error", async () => {
    const r = await executeCallback(
      cb(() => 42),
      makeInput()
    );
    expect(r.error).toBeDefined();
  });

  it("respects abort signal before callback starts", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await executeCallback(
      cb(() => ({ continue: true })),
      makeInput(),
      ac.signal
    );
    expect(r.error?.message).toMatch(/aborted/);
    expect(r.durationMs).toBe(0);
  });

  it("awaits async callbacks", async () => {
    const r = await executeCallback(
      cb(async () => {
        await new Promise((res) => setTimeout(res, 5));
        return { additionalContext: "late" };
      }),
      makeInput()
    );
    expect(r.output?.additionalContext).toBe("late");
    expect(r.durationMs).toBeGreaterThanOrEqual(4);
  });
});
