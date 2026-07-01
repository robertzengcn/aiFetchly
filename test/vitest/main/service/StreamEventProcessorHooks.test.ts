"use strict";
import { describe, test, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — declared via vi.hoisted so the factories can reference them
// safely (vi.mock factories are hoisted above top-level consts).
// ---------------------------------------------------------------------------

const {
  skillRegistryState,
  skillExecutorMock,
  toolExecutorMock,
  permissionStateHolder,
} = vi.hoisted(() => ({
  skillRegistryState: {
    registered: new Set<string>(),
    skills: new Map<string, { permissionCategory?: string }>(),
  },
  skillExecutorMock: vi.fn(),
  toolExecutorMock: vi.fn(),
  permissionStateHolder: { status: "granted" },
}));

vi.mock("@/config/skillsRegistry", () => ({
  SkillRegistry: {
    isRegistered: (name: string) => skillRegistryState.registered.has(name),
    getSkill: (name: string) => skillRegistryState.skills.get(name) ?? null,
    getAllToolFunctions: async () => [],
    getMergedToolFunctions: () => [],
  },
}));

vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: {
    execute: skillExecutorMock,
    isKnown: (name: string) => skillRegistryState.registered.has(name),
    validateArgs: vi.fn(() => null),
    rateLimiter: {
      check: () => ({ allowed: true }),
      acquire: () => undefined,
      release: () => undefined,
      reset: () => undefined,
    },
  },
}));

vi.mock("@/service/ToolExecutor", () => ({
  ToolExecutor: {
    execute: toolExecutorMock,
  },
}));

vi.mock("@/service/ToolExecutionService", () => ({
  ToolExecutionService: {
    saveToolCall: vi.fn().mockResolvedValue(undefined),
    saveToolResult: vi.fn().mockResolvedValue(undefined),
    prepareToolMetadata: vi.fn(() => ({
      toolName: "stub",
      toolId: "stub",
      executionTimeMs: 0,
      success: true,
    })),
    formatToolResultForLLM: vi.fn((_name, result) => result),
  },
}));

vi.mock("@/service/SkillDiagnosticsService", () => ({
  SkillDiagnosticsService: {
    diagnoseStderr: () => ({ cause: "unknown", dependency_id: null }),
  },
}));

vi.mock("@/service/SystemDependencyRetryService", () => ({
  SystemDependencyRetryService: {
    resolveOnly: () => ({
      isDependencyError: false,
      resolution: null,
      message: "",
    }),
  },
}));

// SkillPermissionService: defaults to "granted" so the hook pre-permission
// snapshot sees an allowed state. Per-test overrides via permissionStateHolder.status.
vi.mock("@/service/SkillPermissionService", () => ({
  SkillPermissionService: {
    getPermissionStatus: () => permissionStateHolder.status,
    checkPermission: () => ({
      allowed: permissionStateHolder.status === "granted",
      needsPrompt: permissionStateHolder.status === "unknown",
    }),
  },
}));

// ---------------------------------------------------------------------------
// Import everything else (after mocks).
// ---------------------------------------------------------------------------
import {
  StreamEventProcessor,
  StreamState,
} from "@/service/StreamEventProcessor";
import { StreamEventType, type StreamEvent } from "@/api/aiChatApi";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { setHookAuditLoggerForTests } from "@/service/hooks/HookAuditService";

type IpcMainEvent = {
  sender: {
    send: (channel: string, ...args: unknown[]) => void;
  };
};

function createMockState(overrides?: Partial<StreamState>): StreamState {
  return {
    assistantMessageId: "test-message-id",
    fullContent: "",
    streamConversationId: "test-conversation-id",
    hasStartedConversation: false,
    pendingToolCalls: new Set(),
    deferredCompletionChunk: null,
    messageSaved: false,
    chatModule: {} as never,
    aiChatApi: {
      streamContinueWithToolResults: vi.fn().mockResolvedValue(undefined),
    } as never,
    currentPlan: null,
    ...overrides,
  };
}

function createMockEvent(): IpcMainEvent {
  return {
    sender: { send: vi.fn() },
  } as unknown as IpcMainEvent;
}

/** Invoke private executeTool via the public processEvent path. */
async function runToolCall(
  proc: StreamEventProcessor,
  toolId: string,
  toolName: string,
  toolParams: Record<string, unknown>
): Promise<void> {
  const streamEvent: StreamEvent = {
    event: StreamEventType.TOOL_CALL,
    data: {
      data: { id: toolId, name: toolName, arguments: toolParams },
      content: `Executing tool: ${toolName}`,
      timestamp: new Date().toISOString(),
    },
  };
  proc.processEvent(streamEvent);
  // processEvent fires executeTool asynchronously; await a microtask
  // flush so assertions can observe the executor call.
  await new Promise((res) => setTimeout(res, 50));
}

describe("StreamEventProcessor + hooks integration", () => {
  let proc: StreamEventProcessor;
  let event: IpcMainEvent;

  beforeEach(() => {
    event = createMockEvent();
    proc = new StreamEventProcessor(event, createMockState());
    skillRegistryState.registered.clear();
    skillRegistryState.skills.clear();
    skillExecutorMock.mockReset();
    toolExecutorMock.mockReset();
    skillExecutorMock.mockResolvedValue({
      success: true,
      result: { rows: [1, 2] },
      execution_time_ms: 0,
      tool_call_id: "t1",
      tool_name: "stub",
    });
    permissionStateHolder.status = "granted";
    HookRegistry.resetForTests();
    setHookAuditLoggerForTests({ log: () => undefined });
  });

  test("no hooks registered → executor sees original params, behavior unchanged", async () => {
    skillRegistryState.registered.add("stub_skill");
    await runToolCall(proc, "t1", "stub_skill", { x: 1 });
    expect(skillExecutorMock).toHaveBeenCalledTimes(1);
    const args = skillExecutorMock.mock.calls[0];
    expect(args[0]).toBe("stub_skill");
    expect(args[1]).toEqual({ x: 1 });
  });

  test("PreToolUse block → executor never called, structured blocked result sent", async () => {
    skillRegistryState.registered.add("stub_skill");
    HookRegistry.registerBuiltinHook({
      id: "blocker",
      eventName: "PreToolUse",
      source: "builtin",
      enabled: true,
      trusted: true,
      type: "callback",
      matcher: "stub_skill",
      callback: () => ({ continue: false, reason: "policy says no" }),
    });
    await runToolCall(proc, "t1", "stub_skill", { x: 1 });
    expect(skillExecutorMock).not.toHaveBeenCalled();
    // UI chunk should carry the blockedByHook marker.
    const send = (
      event.sender.send as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    const toolResultChunk = send
      .map((c) => String(c[1] ?? ""))
      .find((s) => s.includes("blockedByHook"));
    expect(toolResultChunk).toBeDefined();
    expect(toolResultChunk).toContain("policy says no");
  });

  test("PreToolUse updatedInput → executor receives updated params", async () => {
    skillRegistryState.registered.add("stub_skill");
    HookRegistry.registerBuiltinHook({
      id: "rewriter",
      eventName: "PreToolUse",
      source: "builtin",
      enabled: true,
      trusted: true,
      type: "callback",
      matcher: "stub_skill",
      callback: () => ({ updatedInput: { x: 999, added: true } }),
    });
    await runToolCall(proc, "t1", "stub_skill", { x: 1 });
    expect(skillExecutorMock).toHaveBeenCalledTimes(1);
    expect(skillExecutorMock.mock.calls[0][1]).toEqual({ x: 999, added: true });
  });

  test("hook permissionDecision allow still runs SkillExecutor (no bypass)", async () => {
    skillRegistryState.registered.add("stub_skill");
    permissionStateHolder.status = "unknown"; // would normally prompt
    HookRegistry.registerBuiltinHook({
      id: "allower",
      eventName: "PreToolUse",
      source: "builtin",
      enabled: true,
      trusted: true,
      type: "callback",
      matcher: "stub_skill",
      callback: () => ({ permissionDecision: "allow" }),
    });
    await runToolCall(proc, "t1", "stub_skill", { x: 1 });
    // Hook allow must NOT skip the executor; SkillExecutor still runs.
    expect(skillExecutorMock).toHaveBeenCalledTimes(1);
  });

  test("hook permissionDecision deny blocks even without continue:false (PRD §Stream Integration)", async () => {
    skillRegistryState.registered.add("stub_skill");
    permissionStateHolder.status = "granted"; // would normally auto-run
    HookRegistry.registerBuiltinHook({
      id: "denier",
      eventName: "PreToolUse",
      source: "builtin",
      enabled: true,
      trusted: true,
      type: "callback",
      matcher: "stub_skill",
      // Deny only — no continue:false. Must still block.
      callback: () => ({ permissionDecision: "deny" }),
    });
    await runToolCall(proc, "t1", "stub_skill", { x: 1 });
    expect(skillExecutorMock).not.toHaveBeenCalled();
    const send = (
      event.sender.send as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    const toolResultChunk = send
      .map((c) => String(c[1] ?? ""))
      .find((s) => s.includes("blockedByHook"));
    expect(toolResultChunk).toBeDefined();
    expect(toolResultChunk).toContain("denied by hook policy");
  });

  test("PostToolUse additionalContext is attached to the result", async () => {
    skillRegistryState.registered.add("stub_skill");
    HookRegistry.registerBuiltinHook({
      id: "annotator",
      eventName: "PostToolUse",
      source: "builtin",
      enabled: true,
      trusted: true,
      type: "callback",
      matcher: "stub_skill",
      callback: () => ({ additionalContext: "compliance-reminder" }),
    });
    await runToolCall(proc, "t1", "stub_skill", { x: 1 });
    const send = (
      event.sender.send as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    const toolResultChunk = send
      .map((c) => String(c[1] ?? ""))
      .find((s) => s.includes("hookContexts"));
    expect(toolResultChunk).toBeDefined();
    expect(toolResultChunk).toContain("compliance-reminder");
  });

  test("PostToolUseFailure adds a message without flipping failure to success", async () => {
    skillRegistryState.registered.add("stub_skill");
    skillExecutorMock.mockResolvedValue({
      success: false,
      result: { error: "skill exploded" },
      execution_time_ms: 0,
      tool_call_id: "t1",
      tool_name: "stub_skill",
    });
    HookRegistry.registerBuiltinHook({
      id: "classifier",
      eventName: "PostToolUseFailure",
      source: "builtin",
      enabled: true,
      trusted: true,
      type: "callback",
      matcher: "stub_skill",
      callback: () => ({ systemMessage: "install python to fix this" }),
    });
    await runToolCall(proc, "t1", "stub_skill", { x: 1 });
    const send = (
      event.sender.send as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    const toolResultChunk = send
      .map((c) => String(c[1] ?? ""))
      .find((s) => s.includes("hookMessages"));
    expect(toolResultChunk).toBeDefined();
    expect(toolResultChunk).toContain("install python to fix this");
    // The failure marker must still be present (no success flip).
    expect(toolResultChunk).toContain('"success":false');
  });

  test("legacy tool (no skill registry) still invokes ToolExecutor through hooks", async () => {
    toolExecutorMock.mockResolvedValue({ success: true, rows: [] });
    await runToolCall(proc, "t1", "mcp_legacy_tool", { x: 1 });
    expect(toolExecutorMock).toHaveBeenCalledTimes(1);
  });
});
