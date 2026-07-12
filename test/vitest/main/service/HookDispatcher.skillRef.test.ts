// Plan 18-02 / Task 1 — D-SkillRefResolve (Phase 18).
//
// Verifies the HookDispatcher `skill:<name>` branch (Phase 17 documented no-op)
// now invokes a registered skill via the injected SkillRefResolver and falls
// back to the preserved `skillRefResult` (skill-registry-not-available) when
// the named skill is NOT registered. Failures/rejections stay non-fatal
// (warn-mode HookSingleResult); the stream is never blocked and never throws.
//
// The resolver is an injectable seam (HookDispatcher.setSkillRefResolverForTests)
// so the dispatcher module never statically imports the DB/Electron-heavy skill
// runtime — preserving the utilitycode test-config boundary. Production wires
// the real SkillRegistry/SkillExecutor-backed resolver; these tests inject a
// controllable mock.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HookDispatcher } from "@/service/hooks/HookDispatcher";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { HookCommandTrustService } from "@/service/hooks/HookCommandTrustService";
import type {
  CommandHookDefinition,
  HookInput,
} from "@/entityTypes/hookTypes";
import {
  setHookAuditLoggerForTests,
  type HookAuditLogger,
} from "@/service/hooks/HookAuditService";
import type {
  CommandHookExecutionResult,
  HookExecutionClient,
} from "@/service/hooks/hookExecutionClient";
import type { ToolExecutionResult } from "@/api/aiChatApi";

const NULL_LOGGER: HookAuditLogger = { log: () => undefined };

function baseInput(): HookInput {
  return {
    eventName: "PreToolUse",
    hookRunId: "run-1",
    source: "ai-chat-v2",
    conversationId: "conv-1",
    timestamp: new Date().toISOString(),
    tool: { id: "t1", name: "shell_execute", source: "skill-registry" },
    input: { command: "ls" },
    permissionState: { allowed: true, needsPrompt: false },
  };
}

function skillRefHook(
  id: string,
  skillCommand: string,
  overrides: Partial<CommandHookDefinition> = {}
): CommandHookDefinition {
  return {
    id,
    eventName: "PreToolUse",
    source: "user",
    enabled: true,
    trusted: true,
    type: "command",
    command: skillCommand,
    failureMode: "warn",
    ...overrides,
  };
}

function makeToolResult(
  overrides: Partial<ToolExecutionResult>
): ToolExecutionResult {
  return {
    tool_call_id: "run-1",
    tool_name: "my-skill",
    success: true,
    result: {},
    execution_time_ms: 4,
    ...overrides,
  };
}

/**
 * Minimal mock SkillRefResolver. `vi.fn` lets each test program the
 * isRegistered/execute behavior and assert call args.
 */
function makeMockResolver() {
  return {
    isRegistered: vi.fn().mockReturnValue(false),
    execute: vi.fn().mockResolvedValue(makeToolResult({ success: true })),
  };
}

describe("HookDispatcher D-SkillRefResolve (Phase 18 Plan 02 Task 1)", () => {
  let workerExecuteSpy: ReturnType<typeof vi.fn>;
  let resolver: ReturnType<typeof makeMockResolver>;

  beforeEach(() => {
    HookRegistry.resetForTests();
    HookCommandTrustService.resetForTests();
    setHookAuditLoggerForTests(NULL_LOGGER);
    // Worker client stays unused for skill-refs (HOK-02 boundary preserved).
    workerExecuteSpy = vi.fn();
    HookDispatcher.setClientForTests({
      execute: workerExecuteSpy,
    } as unknown as HookExecutionClient);
    resolver = makeMockResolver();
    HookDispatcher.setSkillRefResolverForTests(resolver);
  });

  afterEach(() => {
    HookRegistry.resetForTests();
    HookCommandTrustService.resetForTests();
    // Restore the default (not-wired) resolver so other suites are unaffected.
    HookDispatcher.setSkillRefResolverForTests(null);
  });

  it("invokes the resolver for a registered skill-ref and emits NO skill-registry-not-available (SC1)", async () => {
    const hook = skillRefHook("user:hook:skill-ref-1", "skill:my-skill");
    HookRegistry.replaceSource("user", [hook]);
    HookCommandTrustService.setTrusted(hook.id, true);
    resolver.isRegistered.mockReturnValue(true);
    resolver.execute.mockResolvedValue(
      makeToolResult({ success: true, result: { output: "done" } })
    );

    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
    });

    expect(resolver.isRegistered).toHaveBeenCalledWith("my-skill");
    expect(resolver.execute).toHaveBeenCalledTimes(1);
    // Args Pitfall 6: empty {} (HookInput carries no tool-call args).
    const [name, args, ctx] = resolver.execute.mock.calls[0];
    expect(name).toBe("my-skill");
    expect(args).toEqual({});
    // Context comes from the hook input (conversationId + hookRunId).
    expect(ctx.conversationId).toBe("conv-1");
    expect(ctx.toolCallId).toBe("run-1");
    // Success: hook recorded as executed, no error, stream not blocked.
    expect(result.blocked).toBe(false);
    expect(result.executedHookIds).toEqual(["user:hook:skill-ref-1"]);
    expect(
      result.hookErrors.some((e) =>
        e.message.includes("skill-registry-not-available")
      )
    ).toBe(false);
    // HOK-02 boundary preserved: the worker client is NOT used for skill-refs.
    expect(workerExecuteSpy).not.toHaveBeenCalled();
  });

  it("falls back to skill-registry-not-available for an unregistered skill-ref (no execution, non-fatal)", async () => {
    const hook = skillRefHook("user:hook:skill-ref-2", "skill:missing-skill");
    HookRegistry.replaceSource("user", [hook]);
    HookCommandTrustService.setTrusted(hook.id, true);
    resolver.isRegistered.mockReturnValue(false);

    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
    });

    expect(resolver.isRegistered).toHaveBeenCalledWith("missing-skill");
    expect(resolver.execute).not.toHaveBeenCalled();
    expect(result.blocked).toBe(false); // non-fatal (warn-mode)
    expect(
      result.hookErrors.some((e) =>
        e.message.includes("skill-registry-not-available")
      )
    ).toBe(true);
    expect(workerExecuteSpy).not.toHaveBeenCalled();
  });

  it("produces a non-fatal warn-mode error when execute returns success:false (stream not blocked)", async () => {
    const hook = skillRefHook("user:hook:skill-ref-3", "skill:failing-skill");
    HookRegistry.replaceSource("user", [hook]);
    HookCommandTrustService.setTrusted(hook.id, true);
    resolver.isRegistered.mockReturnValue(true);
    resolver.execute.mockResolvedValue(
      makeToolResult({
        success: false,
        result: { error: "boom-from-skill" },
      })
    );

    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
    });

    expect(resolver.execute).toHaveBeenCalledTimes(1);
    expect(result.blocked).toBe(false); // warn-mode, never blocks
    expect(result.hookErrors).toHaveLength(1);
    const err = result.hookErrors[0];
    expect(err.hookId).toBe("user:hook:skill-ref-3");
    expect(err.source).toBe("user");
    expect(err.message).toContain("failing-skill");
    expect(err.message).not.toContain("skill-registry-not-available");
  });

  it("never throws into the stream when resolver.execute rejects (defensive try/catch)", async () => {
    const hook = skillRefHook("user:hook:skill-ref-4", "skill:throwing-skill");
    HookRegistry.replaceSource("user", [hook]);
    HookCommandTrustService.setTrusted(hook.id, true);
    resolver.isRegistered.mockReturnValue(true);
    resolver.execute.mockRejectedValue(new Error("unexpected-throw"));

    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
    });

    expect(result.blocked).toBe(false);
    expect(result.hookErrors).toHaveLength(1);
    expect(result.hookErrors[0].message).toContain("unexpected-throw");
  });

  it("extracts the skill name via prefix slice (robust to names containing extra colons, RESEARCH Pattern 6)", async () => {
    const hook = skillRefHook(
      "user:hook:skill-ref-5",
      "skill:namespace:my-skill"
    );
    HookRegistry.replaceSource("user", [hook]);
    HookCommandTrustService.setTrusted(hook.id, true);
    resolver.isRegistered.mockReturnValue(false);

    await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
    });

    // "skill:namespace:my-skill".slice("skill:".length) === "namespace:my-skill"
    expect(resolver.isRegistered).toHaveBeenCalledWith("namespace:my-skill");
  });

  it("carries hook.id + hook.source on the error for a failed execution (audit trail)", async () => {
    const hook = skillRefHook(
      "plugin:demo:hook:1",
      "skill:demo-skill",
      { source: "plugin" }
    );
    HookRegistry.replaceSource("plugin", [hook]);
    HookCommandTrustService.setTrusted(hook.id, true);
    resolver.isRegistered.mockReturnValue(true);
    resolver.execute.mockResolvedValue(
      makeToolResult({ success: false, result: { error: "denied" } })
    );

    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
    });

    expect(result.hookErrors[0].hookId).toBe("plugin:demo:hook:1");
    expect(result.hookErrors[0].source).toBe("plugin");
  });
});

/**
 * Confirm the default (un-wired) resolver path still emits
 * skill-registry-not-available — mirrors the Phase 17 no-op behavior so the
 * Phase 17 utilitycode regression suite is preserved when no resolver is
 * injected. This guards the "fallback is preserved" acceptance criterion.
 */
describe("HookDispatcher D-SkillRefResolve default (un-wired) fallback", () => {
  beforeEach(() => {
    HookRegistry.resetForTests();
    HookCommandTrustService.resetForTests();
    setHookAuditLoggerForTests(NULL_LOGGER);
    // Explicitly restore the default (no resolver injected).
    HookDispatcher.setSkillRefResolverForTests(null);
  });
  afterEach(() => {
    HookRegistry.resetForTests();
    HookCommandTrustService.resetForTests();
  });

  it("a skill-ref hook with no resolver wired emits skill-registry-not-available (fallback preserved)", async () => {
    const hook = skillRefHook("user:hook:unwired", "skill:anything");
    HookRegistry.replaceSource("user", [hook]);
    HookCommandTrustService.setTrusted(hook.id, true);

    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: baseInput(),
    });

    expect(result.blocked).toBe(false);
    expect(
      result.hookErrors.some((e) =>
        e.message.includes("skill-registry-not-available")
      )
    ).toBe(true);
  });
});
