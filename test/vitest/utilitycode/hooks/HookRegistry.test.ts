import { describe, it, expect, beforeEach } from "vitest";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import {
  CallbackHookDefinition,
  CommandHookDefinition,
} from "@/entityTypes/hookTypes";

function cb(
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

function cmd(
  id: string,
  overrides: Partial<CommandHookDefinition> = {}
): CommandHookDefinition {
  return {
    id,
    eventName: "PreToolUse",
    source: "session",
    enabled: true,
    trusted: true,
    type: "command",
    command: "node -e 'process.stdin.resume()'",
    ...overrides,
  };
}

describe("HookRegistry", () => {
  beforeEach(() => {
    HookRegistry.resetForTests();
  });

  it("registers and returns built-in hooks", () => {
    HookRegistry.registerBuiltinHook(cb("a"));
    const matched = HookRegistry.getMatchingHooks({
      eventName: "PreToolUse",
      matchQuery: "shell_execute",
    });
    expect(matched.map((h) => h.id)).toEqual(["a"]);
  });

  it("matches by glob against matchQuery", () => {
    HookRegistry.registerBuiltinHook(cb("mcp", { matcher: "mcp_*" }));
    HookRegistry.registerBuiltinHook(cb("shell", { matcher: "shell_execute" }));
    const matched = HookRegistry.getMatchingHooks({
      eventName: "PreToolUse",
      matchQuery: "mcp_foo",
    });
    expect(matched.map((h) => h.id)).toEqual(["mcp"]);
  });

  it("matchQuery undefined matches hooks with no matcher only", () => {
    HookRegistry.registerBuiltinHook(cb("all"));
    const matched = HookRegistry.getMatchingHooks({ eventName: "PreToolUse" });
    expect(matched.map((h) => h.id)).toEqual(["all"]);
  });

  it("filters disabled hooks", () => {
    HookRegistry.registerBuiltinHook(cb("off", { enabled: false }));
    HookRegistry.registerBuiltinHook(cb("on"));
    const matched = HookRegistry.getMatchingHooks({ eventName: "PreToolUse" });
    expect(matched.map((h) => h.id)).toEqual(["on"]);
  });

  it("filters untrusted command hooks", () => {
    // Callback hook: trusted flag is not consulted by the registry
    // (trust is a command-hook concern).
    HookRegistry.registerBuiltinHook(cb("safe-cb", { trusted: false }));
    // Untrusted command hook registered via the session API (built-in
    // registration is callback-only by design).
    HookRegistry.registerSessionHook(
      "s1",
      cmd("cmd-untrusted", { source: "session", trusted: false })
    );
    const matched = HookRegistry.getMatchingHooks({
      eventName: "PreToolUse",
      sessionId: "s1",
    });
    expect(matched.map((h) => h.id)).toEqual(["safe-cb"]);
  });

  it("registers session hooks and scopes them by sessionId", () => {
    HookRegistry.registerSessionHook("s1", cb("a", { source: "session" }));
    const other = HookRegistry.getMatchingHooks({
      eventName: "PreToolUse",
      sessionId: "s2",
    });
    expect(other).toEqual([]);

    const own = HookRegistry.getMatchingHooks({
      eventName: "PreToolUse",
      sessionId: "s1",
    });
    expect(own.map((h) => h.id)).toEqual(["a"]);
  });

  it("clears only the requested session's hooks", () => {
    HookRegistry.registerSessionHook("s1", cb("a", { source: "session" }));
    HookRegistry.registerSessionHook("s2", cb("b", { source: "session" }));
    HookRegistry.clearSessionHooks("s1");
    const remainingS1 = HookRegistry.getMatchingHooks({
      eventName: "PreToolUse",
      sessionId: "s1",
    });
    const remainingS2 = HookRegistry.getMatchingHooks({
      eventName: "PreToolUse",
      sessionId: "s2",
    });
    expect(remainingS1).toEqual([]);
    expect(remainingS2.map((h) => h.id)).toEqual(["b"]);
  });

  it("returns source-priority order regardless of registration order", () => {
    HookRegistry.registerSessionHook(
      "s1",
      cb("user", { source: "user" as never })
    );
    HookRegistry.registerBuiltinHook(cb("builtin"));
    HookRegistry.registerSessionHook(
      "s1",
      cb("session", { source: "session" })
    );
    const matched = HookRegistry.getMatchingHooks({
      eventName: "PreToolUse",
      sessionId: "s1",
    });
    expect(matched.map((h) => h.id)).toEqual(["builtin", "session", "user"]);
  });

  it("returns empty list for unknown event", () => {
    const matched = HookRegistry.getMatchingHooks({ eventName: "Stop" });
    expect(matched).toEqual([]);
  });

  it("dedupes by hook id, keeping the first registration", () => {
    HookRegistry.registerBuiltinHook(cb("dup"));
    HookRegistry.registerBuiltinHook(cb("dup"));
    const matched = HookRegistry.getMatchingHooks({ eventName: "PreToolUse" });
    expect(matched.map((h) => h.id)).toEqual(["dup"]);
  });
});
