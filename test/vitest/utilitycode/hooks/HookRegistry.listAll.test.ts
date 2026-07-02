import { describe, it, expect, beforeEach } from "vitest";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import {
  CallbackHookDefinition,
  CommandHookDefinition,
} from "@/entityTypes/hookTypes";

function cb(id: string): CallbackHookDefinition {
  return {
    id,
    eventName: "PreToolUse",
    source: "builtin",
    enabled: true,
    trusted: true,
    type: "callback",
    callback: () => ({}),
  };
}
function cmd(
  id: string,
  source: "user" | "session" = "user"
): CommandHookDefinition {
  return {
    id,
    eventName: "PreToolUse",
    source,
    enabled: true,
    trusted: true,
    type: "command",
    command: "node -e 'process.stdin.resume()'",
  };
}

describe("HookRegistry.listAll / registerUserHook / replaceUserHooks", () => {
  beforeEach(() => {
    HookRegistry.resetForTests();
  });

  it("listAll returns empty when nothing registered", () => {
    expect(HookRegistry.listAll()).toEqual([]);
  });

  it("listAll returns builtin hooks", () => {
    HookRegistry.registerBuiltinHook(cb("b1"));
    const all = HookRegistry.listAll();
    expect(all.map((h) => h.id)).toEqual(["b1"]);
  });

  it("registerUserHook adds a user hook visible to listAll", () => {
    HookRegistry.registerBuiltinHook(cb("b1"));
    HookRegistry.registerUserHook(cmd("u1"));
    const all = HookRegistry.listAll();
    expect(all.map((h) => h.id)).toEqual(["b1", "u1"]);
  });

  it("replaceUserHooks atomically swaps user entries", () => {
    HookRegistry.registerBuiltinHook(cb("b1"));
    HookRegistry.registerUserHook(cmd("u1"));
    HookRegistry.replaceUserHooks([cmd("u2"), cmd("u3")]);
    const all = HookRegistry.listAll();
    expect(all.map((h) => h.id)).toEqual(["b1", "u2", "u3"]);
  });

  it("replaceUserHooks preserves builtin and session entries", () => {
    HookRegistry.registerBuiltinHook(cb("b1"));
    HookRegistry.registerSessionHook("s1", cmd("sess1", "session"));
    HookRegistry.registerUserHook(cmd("u1"));
    HookRegistry.replaceUserHooks([cmd("u_new")]);
    const all = HookRegistry.listAll({ includeSession: true });
    expect(all.map((h) => h.id).sort()).toEqual(["b1", "sess1", "u_new"]);
  });

  it("listAll filters by source", () => {
    HookRegistry.registerBuiltinHook(cb("b1"));
    HookRegistry.registerUserHook(cmd("u1"));
    expect(HookRegistry.listAll({ source: "user" }).map((h) => h.id)).toEqual([
      "u1",
    ]);
    expect(
      HookRegistry.listAll({ source: "builtin" }).map((h) => h.id)
    ).toEqual(["b1"]);
  });

  it("listAll hides session entries unless includeSession is true", () => {
    HookRegistry.registerSessionHook("s1", cmd("sess1", "session"));
    expect(HookRegistry.listAll()).toEqual([]);
    expect(
      HookRegistry.listAll({ includeSession: true }).map((h) => h.id)
    ).toEqual(["sess1"]);
  });

  it("listAll filters by eventName", () => {
    const stopHook = { ...cb("b1"), eventName: "Stop" as const };
    HookRegistry.registerBuiltinHook(stopHook);
    HookRegistry.registerBuiltinHook(cb("b2"));
    expect(
      HookRegistry.listAll({ eventName: "Stop" }).map((h) => h.id)
    ).toEqual(["b1"]);
  });

  it("setBuiltinEnabled flips the enabled flag on a registered builtin", () => {
    HookRegistry.registerBuiltinHook({ ...cb("b1"), enabled: true });
    const result = HookRegistry.setBuiltinEnabled("b1", false);
    expect(result).toBe(true);
    const all = HookRegistry.listAll();
    expect(all[0].enabled).toBe(false);
  });

  it("setBuiltinEnabled returns false for unknown id", () => {
    const result = HookRegistry.setBuiltinEnabled("nonexistent", true);
    expect(result).toBe(false);
  });

  it("setBuiltinEnabled preserves source (does not affect user/session hooks)", () => {
    HookRegistry.registerBuiltinHook(cb("b1"));
    HookRegistry.registerUserHook(cmd("u1"));
    // Try to use setBuiltinEnabled on a user hook — should return false
    const result = HookRegistry.setBuiltinEnabled("u1", false);
    expect(result).toBe(false);
    // The user hook should still be enabled
    const all = HookRegistry.listAll();
    const u1 = all.find((h) => h.id === "u1");
    expect(u1?.enabled).toBe(true);
  });
});
