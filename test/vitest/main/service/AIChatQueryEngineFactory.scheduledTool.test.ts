import { describe, expect, it, vi } from "vitest";

// Stub SkillRegistry so the factory resolves a controlled built-in skill for
// the gated high-impact tool (file_write), the permanently-blocked tool
// (shell_execute), and the read-only auto-approve tool (file_read).
// permissionCategory/source must match the real registry so
// canAutoApproveScheduledTool routes through the correct tier.
vi.mock("@/config/skillsRegistry", () => ({
  SkillRegistry: {
    getSkill: vi.fn((name: string) => {
      if (name === "file_write") {
        return {
          name,
          description: "write a file",
          parameters: { type: "object", properties: {} },
          tier: "main",
          requiresConfirmation: true,
          permissionCategory: "filesystem",
          source: "built-in",
          execute: async () => ({ success: true, result: {} }),
        };
      }
      if (name === "file_read") {
        return {
          name,
          description: "read a file",
          parameters: { type: "object", properties: {} },
          tier: "main",
          requiresConfirmation: false,
          permissionCategory: "filesystem",
          source: "built-in",
          execute: async () => ({ success: true, result: {} }),
        };
      }
      if (name === "shell_execute") {
        return {
          name,
          description: "run a shell command",
          parameters: { type: "object", properties: {} },
          tier: "main",
          requiresConfirmation: true,
          permissionCategory: "shell",
          source: "built-in",
          execute: async () => ({ success: true, result: {} }),
        };
      }
      return undefined;
    }),
  },
}));

// Stub SkillExecutor so a misrouted allowed call never performs real work.
vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: {
    execute: vi.fn(async () => ({
      tool_call_id: "stub",
      tool_name: "stub",
      success: true,
      result: {},
      execution_time_ms: 0,
    })),
  },
}));

import { AIChatQueryEngineFactory } from "@/service/AIChatQueryEngineFactory";
import { SkillExecutor } from "@/service/SkillExecutor";
import type { AiMessageTaskToolPolicy } from "@/entityTypes/aiMessageTaskTypes";
import type { SkillExecutionContext } from "@/entityTypes/skillTypes";
import type { ToolExecutionResult } from "@/api/aiChatApi";

const basePolicy: AiMessageTaskToolPolicy = {
  allowedTools: [],
  autoApproveTools: true,
  allowSkills: false,
  allowMcp: false,
  allowSubagents: false,
  maxToolCalls: 10,
  maxRuntimeMs: 300_000,
  maxContinueCalls: 10,
};

/** Minimal SkillExecutionContext satisfying executeScheduledTool's needs. */
function ctx(toolCallId: string): SkillExecutionContext {
  return {
    conversationId: "conv-test",
    toolCallId,
  } as SkillExecutionContext;
}

type ExecuteScheduledTool = (
  name: string,
  args: Record<string, unknown>,
  context: SkillExecutionContext,
  policy: AiMessageTaskToolPolicy
) => Promise<ToolExecutionResult>;

function scheduledExecutor(
  factory: AIChatQueryEngineFactory
): ExecuteScheduledTool {
  // Bind `this` so the private method retains its class binding when called
  // through the cast (extracting a method reference detaches it otherwise).
  return (
    factory as unknown as { executeScheduledTool: ExecuteScheduledTool }
  ).executeScheduledTool.bind(factory);
}

describe("AIChatQueryEngineFactory scheduled tool executor", () => {
  it("gated high-impact tool returns needsPermissionPrompt (not blocked error)", async () => {
    const factory = new AIChatQueryEngineFactory();
    const executor = scheduledExecutor(factory);
    const result = await executor(
      "file_write",
      { path: "/tmp/x", content: "hi" },
      ctx("call_1"),
      basePolicy
    );
    expect(result.success).toBe(false);
    expect(result.result.needsPermissionPrompt).toBe(true);
    expect(result.result.blocked_by_scheduled_policy).toBeFalsy();
    expect(result.result.permissionCategory).toBe("filesystem");
  });

  it("permanently-blocked tool returns blocked_by_scheduled_policy", async () => {
    const factory = new AIChatQueryEngineFactory();
    const executor = scheduledExecutor(factory);
    const result = await executor(
      "shell_execute",
      { command: "rm -rf /" },
      ctx("call_2"),
      { ...basePolicy, allowedTools: ["shell_execute"] }
    );
    expect(result.success).toBe(false);
    expect(result.result.blocked_by_scheduled_policy).toBe(true);
    expect(result.result.needsPermissionPrompt).toBeFalsy();
  });

  it("allowed read-only tool delegates to SkillExecutor with skipPermissionCheck", async () => {
    const factory = new AIChatQueryEngineFactory();
    const executor = scheduledExecutor(factory);
    const executeSpy = vi.mocked(SkillExecutor.execute);
    executeSpy.mockClear();
    await executor("file_read", { path: "/tmp/x" }, ctx("call_3"), basePolicy);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith(
      "file_read",
      { path: "/tmp/x" },
      expect.objectContaining({ skipPermissionCheck: true })
    );
  });
});
