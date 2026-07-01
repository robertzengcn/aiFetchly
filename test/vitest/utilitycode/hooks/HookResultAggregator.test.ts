import { describe, it, expect } from "vitest";
import { aggregateResults, HookSingleResult } from "@/service/hooks/HookResultAggregator";
import {
  CallbackHookDefinition,
  HookDefinition,
} from "@/entityTypes/hookTypes";

function cbHook(
  id: string,
  overrides: Partial<CallbackHookDefinition> = {}
): CallbackHookDefinition {
  return {
    id,
    eventName: "PreToolUse",
    source: "builtin",
    enabled: true,
    trusted: true,
    type: "callback",
    callback: () => ({}),
    ...overrides,
  };
}

function ok(hook: HookDefinition, output: Record<string, unknown>, durationMs = 1): HookSingleResult {
  return { hook, output, durationMs };
}

function err(hook: HookDefinition, message: string, timedOut = false): HookSingleResult {
  return {
    hook,
    error: { hookId: hook.id, source: hook.source, message, timedOut },
    durationMs: 1,
  };
}

describe("aggregateResults", () => {
  it("returns an empty aggregate for no results", () => {
    const a = aggregateResults([]);
    expect(a.blocked).toBe(false);
    expect(a.additionalContexts).toEqual([]);
    expect(a.systemMessages).toEqual([]);
    expect(a.hookErrors).toEqual([]);
    expect(a.executedHookIds).toEqual([]);
  });

  it("treats continue:false as blocked and records first reason", () => {
    const h1 = cbHook("h1");
    const h2 = cbHook("h2");
    const a = aggregateResults([
      ok(h1, { continue: false, reason: "first" }),
      ok(h2, { continue: false, reason: "second" }),
    ]);
    expect(a.blocked).toBe(true);
    expect(a.blockReason).toBe("first");
  });

  it("uses default block reason when none provided", () => {
    const a = aggregateResults([ok(cbHook("h1"), { continue: false })]);
    expect(a.blocked).toBe(true);
    expect(a.blockReason).toBe("Tool blocked by hook policy");
  });

  it("deny beats ask beats allow", () => {
    const a1 = aggregateResults([
      ok(cbHook("a"), { permissionDecision: "allow" }),
      ok(cbHook("b"), { permissionDecision: "ask" }),
    ]);
    expect(a1.permissionDecision).toBe("ask");

    const a2 = aggregateResults([
      ok(cbHook("a"), { permissionDecision: "ask" }),
      ok(cbHook("b"), { permissionDecision: "deny" }),
    ]);
    expect(a2.permissionDecision).toBe("deny");
  });

  it("permissionDecision ordering is independent of result order", () => {
    const a = aggregateResults([
      ok(cbHook("b"), { permissionDecision: "deny" }),
      ok(cbHook("a"), { permissionDecision: "allow" }),
    ]);
    expect(a.permissionDecision).toBe("deny");
  });

  it("allow alone remains advisory (does not block)", () => {
    const a = aggregateResults([ok(cbHook("a"), { permissionDecision: "allow" })]);
    expect(a.permissionDecision).toBe("allow");
    expect(a.blocked).toBe(false);
  });

  it("shallow-merges updatedInput in execution order", () => {
    const a = aggregateResults([
      ok(cbHook("h1"), { updatedInput: { command: "ls", page: 1 } }),
      ok(cbHook("h2"), { updatedInput: { page: 2 } }),
    ]);
    expect(a.updatedInput).toEqual({ command: "ls", page: 2 });
  });

  it("shallow-merges updatedToolOutput in execution order", () => {
    const a = aggregateResults([
      ok(cbHook("h1"), { updatedToolOutput: { rows: [1], meta: "a" } }),
      ok(cbHook("h2"), { updatedToolOutput: { meta: "b" } }),
    ]);
    expect(a.updatedToolOutput).toEqual({ rows: [1], meta: "b" });
  });

  it("appends additionalContext and systemMessage in order", () => {
    const a = aggregateResults([
      ok(cbHook("h1"), { additionalContext: "ctx-1", systemMessage: "msg-1" }),
      ok(cbHook("h2"), { additionalContext: "ctx-2", systemMessage: "msg-2" }),
    ]);
    expect(a.additionalContexts).toEqual(["ctx-1", "ctx-2"]);
    expect(a.systemMessages).toEqual(["msg-1", "msg-2"]);
  });

  it("blocking failure converts to block", () => {
    const hook = cbHook("policy", { failureMode: "block" });
    const a = aggregateResults([err(hook, "command crashed")]);
    expect(a.blocked).toBe(true);
    expect(a.blockReason).toMatch(/Hook policy failed/);
    expect(a.hookErrors).toHaveLength(1);
  });

  it("warning failure records error but does not block", () => {
    const hook = cbHook("obs", { failureMode: "warn" });
    const a = aggregateResults([err(hook, "command crashed")]);
    expect(a.blocked).toBe(false);
    expect(a.hookErrors).toHaveLength(1);
  });

  it("default failureMode is warn", () => {
    const a = aggregateResults([err(cbHook("no-mode"), "oops")]);
    expect(a.blocked).toBe(false);
  });

  it("records executed hook ids in order", () => {
    const a = aggregateResults([
      ok(cbHook("h1"), {}),
      ok(cbHook("h2"), {}),
    ]);
    expect(a.executedHookIds).toEqual(["h1", "h2"]);
  });
});
