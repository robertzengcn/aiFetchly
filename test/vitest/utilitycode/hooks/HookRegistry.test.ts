import { describe, it, expect, beforeEach } from "vitest";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import {
  CallbackHookDefinition,
  CommandHookDefinition,
  HookSource,
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

  describe("replaceSource / unregisterSource (HOK-01)", () => {
    // Config-sourced hooks keyed by the full sourceId string ("user",
    // "workspace:<id>"). Workspace-sourced hooks carry source "project"
    // (A3 resolved: there is no "workspace" enum value; SOURCE_PRIORITY
    // project:3 < user:5 ranks workspace above user).
    function srcHook(
      id: string,
      source: HookSource,
      overrides: Partial<CallbackHookDefinition> = {}
    ): CallbackHookDefinition {
      return {
        id,
        eventName: "PreToolUse",
        source,
        enabled: true,
        trusted: true,
        type: "callback",
        callback: () => ({}),
        ...overrides,
      };
    }

    it("atomically adds hooks for a source", () => {
      HookRegistry.replaceSource("user", [srcHook("h1", "user")]);
      const matched = HookRegistry.getMatchingHooks({
        eventName: "PreToolUse",
      });
      expect(matched.map((h) => h.id)).toEqual(["h1"]);
    });

    it("atomically changes a hook (same id, new body; old body gone)", () => {
      HookRegistry.replaceSource("user", [
        srcHook("h1", "user", { matcher: "shell_execute" }),
      ]);
      HookRegistry.replaceSource("user", [
        srcHook("h1", "user", { matcher: "mcp_*" }),
      ]);
      const oldBody = HookRegistry.getMatchingHooks({
        eventName: "PreToolUse",
        matchQuery: "shell_execute",
      });
      expect(oldBody.map((h) => h.id)).toEqual([]);
      const newBody = HookRegistry.getMatchingHooks({
        eventName: "PreToolUse",
        matchQuery: "mcp_foo",
      });
      expect(newBody.map((h) => h.id)).toEqual(["h1"]);
    });

    it("atomically renames (different id removes the old id entirely)", () => {
      HookRegistry.replaceSource("user", [srcHook("h1", "user")]);
      HookRegistry.replaceSource("user", [srcHook("h2", "user")]);
      const matched = HookRegistry.getMatchingHooks({
        eventName: "PreToolUse",
      });
      expect(matched.map((h) => h.id)).toEqual(["h2"]);
    });

    it("atomically deletes via an empty array", () => {
      HookRegistry.replaceSource("user", [srcHook("h1", "user")]);
      HookRegistry.replaceSource("user", []);
      const matched = HookRegistry.getMatchingHooks({
        eventName: "PreToolUse",
      });
      expect(matched).toEqual([]);
    });

    it("unregisterSource is equivalent to replaceSource(id, [])", () => {
      HookRegistry.replaceSource("user", [srcHook("h1", "user")]);
      HookRegistry.unregisterSource("user");
      const matched = HookRegistry.getMatchingHooks({
        eventName: "PreToolUse",
      });
      expect(matched).toEqual([]);
    });

    it("isolates sources (unregistering one leaves the other intact)", () => {
      HookRegistry.replaceSource("user", [srcHook("u1", "user")]);
      HookRegistry.replaceSource("workspace:42", [srcHook("w1", "project")]);
      // project (3) before user (5).
      expect(
        HookRegistry.getMatchingHooks({ eventName: "PreToolUse" }).map(
          (h) => h.id
        )
      ).toEqual(["w1", "u1"]);

      HookRegistry.unregisterSource("workspace:42");
      expect(
        HookRegistry.getMatchingHooks({ eventName: "PreToolUse" }).map(
          (h) => h.id
        )
      ).toEqual(["u1"]);
    });

    it("orders project (workspace) before user by SOURCE_PRIORITY", () => {
      // Register user first, then workspace — order must still be workspace first.
      HookRegistry.replaceSource("user", [srcHook("u1", "user")]);
      HookRegistry.replaceSource("workspace:42", [srcHook("w1", "project")]);
      const matched = HookRegistry.getMatchingHooks({
        eventName: "PreToolUse",
      });
      expect(matched.map((h) => h.id)).toEqual(["w1", "u1"]);
    });

    it("holds a defensive copy (caller mutation does not leak)", () => {
      const original = srcHook("h1", "user", { matcher: "shell_execute" });
      HookRegistry.replaceSource("user", [original]);
      // Mutate the caller's object after registration.
      (original as { matcher?: string }).matcher = "mcp_*";
      expect(
        HookRegistry.getMatchingHooks({
          eventName: "PreToolUse",
          matchQuery: "shell_execute",
        }).map((h) => h.id)
      ).toEqual(["h1"]);
      expect(
        HookRegistry.getMatchingHooks({
          eventName: "PreToolUse",
          matchQuery: "mcp_foo",
        })
      ).toEqual([]);
    });

    it("resetForTests clears sourceIndex (no stale-id leak across tests)", () => {
      HookRegistry.replaceSource("user", [srcHook("h1", "user")]);
      HookRegistry.resetForTests();
      HookRegistry.replaceSource("user", [srcHook("h2", "user")]);
      const matched = HookRegistry.getMatchingHooks({
        eventName: "PreToolUse",
      });
      expect(matched.map((h) => h.id)).toEqual(["h2"]);
    });
  });
});
