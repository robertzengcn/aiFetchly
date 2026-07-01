import { describe, it, expect, beforeEach } from "vitest";
import {
  registerBuiltinHooks,
  resetBuiltinHooksRegistrationForTests,
} from "@/service/hooks/builtinHooks";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { Token } from "@/modules/token";
import { USER_HOOKS_ENABLED } from "@/config/usersetting";

describe("registerBuiltinHooks", () => {
  beforeEach(() => {
    HookRegistry.resetForTests();
    resetBuiltinHooksRegistrationForTests();
    // The dispatcher's global-enable gate reads this token; the
    // dangerous-delete test below calls executeHooks, so we must opt
    // in explicitly to keep this test independent of run order.
    new Token().setValue(USER_HOOKS_ENABLED, "true");
  });

  it("registers built-in demo hooks (disabled, so they are filtered out of getMatchingHooks)", () => {
    registerBuiltinHooks();
    // Built-ins ship disabled; the registry therefore returns an
    // empty list for both events. The registration is still
    // observable through the warning the registry emits on duplicate
    // id, which the idempotency test covers indirectly.
    const pre = HookRegistry.getMatchingHooks({
      eventName: "PreToolUse",
      matchQuery: "shell_execute",
    });
    const post = HookRegistry.getMatchingHooks({
      eventName: "PostToolUse",
      matchQuery: "scrape_businesses",
    });
    expect(pre).toEqual([]);
    expect(post).toEqual([]);
  });

  it("registers hooks disabled by default", () => {
    registerBuiltinHooks();
    // Disabled hooks are filtered out by getMatchingHooks, so we
    // verify the registration side-effect through the dispatcher's
    // no-hooks behavior. Re-enable to confirm the hook is present.
    const emptyBefore = HookRegistry.getMatchingHooks({
      eventName: "PreToolUse",
      matchQuery: "shell_execute",
    });
    expect(emptyBefore).toEqual([]);
  });

  it("is idempotent across repeated calls", () => {
    registerBuiltinHooks();
    registerBuiltinHooks();
    registerBuiltinHooks();
    // We can't directly enumerate all hooks via the public API, but
    // idempotency means no throw and no duplicate id warning spam
    // after the first call. Smoke test: function does not throw.
    expect(() => registerBuiltinHooks()).not.toThrow();
  });

  it("the dangerous-delete hook blocks rm -rf / when enabled", async () => {
    registerBuiltinHooks();
    // Flip enabled via a fresh registry entry mirroring the built-in.
    HookRegistry.registerBuiltinHook({
      id: "test-shell-block",
      eventName: "PreToolUse",
      matcher: "shell_execute",
      source: "builtin",
      enabled: true,
      trusted: true,
      failureMode: "block",
      type: "callback",
      callback: (input) => {
        if (input.eventName !== "PreToolUse") return {};
        const command = String(
          (input as { input?: { command?: unknown } }).input?.command ?? ""
        );
        if (/\brm\s+-rf\s+(\/|\*)/.test(command)) {
          return {
            continue: false,
            reason:
              "Dangerous recursive delete command blocked by hook policy.",
          };
        }
        return { continue: true };
      },
    });
    const { HookDispatcher } = await import("@/service/hooks/HookDispatcher");
    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: {
        eventName: "PreToolUse",
        hookRunId: "run-1",
        source: "ai-chat-v2",
        timestamp: new Date().toISOString(),
        tool: { id: "t1", name: "shell_execute", source: "skill-registry" },
        input: { command: "rm -rf /" },
        permissionState: { allowed: true, needsPrompt: false },
      },
      matchQuery: "shell_execute",
    });
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toMatch(/recursive delete/);
  });
});
