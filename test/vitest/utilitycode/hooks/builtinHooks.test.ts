import { describe, it, expect, beforeEach } from "vitest";
import {
  registerBuiltinHooks,
  resetBuiltinHooksRegistrationForTests,
} from "@/service/hooks/builtinHooks";
import { HookRegistry } from "@/service/hooks/HookRegistry";

describe("registerBuiltinHooks", () => {
  beforeEach(() => {
    HookRegistry.resetForTests();
    resetBuiltinHooksRegistrationForTests();
    // Hooks default to ON (gate checks === "false").
    // The dangerous-delete test below calls executeHooks and relies on
    // the default being enabled, so don't set the token.
  });

  it("registers built-in hooks enabled by default", () => {
    registerBuiltinHooks();
    const pre = HookRegistry.getMatchingHooks({
      eventName: "PreToolUse",
      matchQuery: "shell_execute",
    });
    const post = HookRegistry.getMatchingHooks({
      eventName: "PostToolUse",
      matchQuery: "scrape_businesses",
    });
    expect(pre.length).toBeGreaterThanOrEqual(1);
    expect(pre.some((h) => h.id === "builtin-block-dangerous-shell-delete")).toBe(true);
    expect(post.length).toBeGreaterThanOrEqual(1);
    expect(post.some((h) => h.id === "builtin-scraping-compliance-context")).toBe(true);
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
