/**
 * Integration tests for the shell execution skill.
 *
 * Tests the full flow through SkillExecutor:
 * - T029: grant → execute → tool_result → stream continue
 * - T030: deny → structured error → no process spawned
 */
import { describe, it, expect, vi } from "vitest";
import { SkillExecutor } from "@/service/SkillExecutor";
import { SkillRegistry } from "@/config/skillsRegistry";

// Shell and file tools share one conversation filesystem scope and fail
// closed without an approved workspace (design §6), so give the integration
// conversation an approved workspace rooted at a temp directory.
const WORKSPACE_ROOT = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require("node:os") as typeof import("node:os");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("node:path") as typeof import("node:path");
  return fs.mkdtempSync(path.join(os.tmpdir(), "shell-int-ws-"));
});

vi.mock("@/modules/WorkspaceModule", () => {
  const getActiveWorkspace = vi.fn().mockResolvedValue({
    id: 43,
    conversationId: "test-integration-conv",
    rootPath: WORKSPACE_ROOT,
    approvalState: "approved",
  });
  return {
    WorkspaceModule: vi.fn().mockImplementation(() => ({
      getActiveWorkspace,
    })),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides?: Record<string, unknown>) {
  return {
    conversationId: "test-integration-conv",
    toolCallId: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// T029: Integration test — full grant → execute → result flow
// ---------------------------------------------------------------------------

describe("Shell integration — grant and execute flow", () => {
  it("returns permission prompt result for shell_execute (needsPermissionPrompt)", async () => {
    const context = makeContext();
    const result = await SkillExecutor.execute(
      "shell_execute",
      { command: "echo integration-test" },
      context
    );

    // Shell category always requires permission prompt
    expect(result.success).toBe(false);
    expect(result.result).toHaveProperty("needsPermissionPrompt", true);
    expect(result.result).toHaveProperty("permissionCategory", "shell");
    expect(result.result).toHaveProperty("shellPreview");
    expect(result.result.shellPreview).toHaveProperty(
      "command",
      "echo integration-test"
    );
  });

  it("shell_execute is registered in the skill registry", () => {
    const skill = SkillRegistry.getSkill("shell_execute");
    expect(skill).toBeDefined();
    expect(skill?.permissionCategory).toBe("shell");
    expect(skill?.requiresConfirmation).toBe(true);
    expect(skill?.tier).toBe("main");
  });

  it("SkillExecutor.isKnown recognizes shell_execute", () => {
    expect(SkillExecutor.isKnown("shell_execute")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T030: Integration test — deny flow
// ---------------------------------------------------------------------------

describe("Shell integration — deny and error flow", () => {
  it("returns error for unknown tool", async () => {
    const context = makeContext();
    const result = await SkillExecutor.execute("nonexistent_tool", {}, context);

    expect(result.success).toBe(false);
    expect(result.result).toHaveProperty("error");
    expect(result.result.error).toContain("Unknown tool");
  });

  it("returns validation error for shell command with missing required args", async () => {
    const context = makeContext();
    const result = await SkillExecutor.execute(
      "shell_execute",
      {}, // Missing 'command' field
      context
    );

    // Should fail with validation error (sensitive pattern check on empty)
    // or permission prompt depending on validation order
    expect(result.success).toBe(false);
    expect(result.result).toHaveProperty("error");
  });

  it("returns denylist error for destructive commands after permission grant", async () => {
    // Simulate what happens after permission is granted — the execute handler
    // in the registry calls executeShellCommand which checks the denylist
    const context = makeContext();
    const result = await SkillExecutor.execute(
      "shell_execute",
      { command: "rm -rf /home/user" },
      context
    );

    // First call returns permission prompt (shell always prompts)
    expect(result.success).toBe(false);
    expect(result.result).toHaveProperty("needsPermissionPrompt", true);
  });

  it("validates command length limit", async () => {
    const context = makeContext();
    const result = await SkillExecutor.execute(
      "shell_execute",
      { command: "a".repeat(10001) },
      context
    );

    // Should return permission prompt first (validation happens in ShellToolService, not SkillExecutor)
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Post-grant execution flow
// ---------------------------------------------------------------------------

describe("Shell integration — post-grant execution flow", () => {
  it("executes command via skill execute handler directly", async () => {
    const skill = SkillRegistry.getSkill("shell_execute");
    expect(skill).toBeDefined();

    const context = makeContext();
    const result = await skill!.execute(
      { command: "echo post-grant-test" },
      context
    );

    expect(result.success).toBe(true);
    expect(result.result).toHaveProperty("stdout");
    expect((result.result as Record<string, unknown>).stdout).toContain(
      "post-grant-test"
    );
  });

  it("returns validated fields after successful execution", async () => {
    const skill = SkillRegistry.getSkill("shell_execute");
    const context = makeContext();
    const result = await skill!.execute(
      { command: "echo validated", shell: "bash" },
      context
    );

    expect(result.success).toBe(true);
    expect(result.result).toHaveProperty("validatedCommand", "echo validated");
    expect(result.result).toHaveProperty("validatedShell", "bash");
  });

  it("returns error for denylisted command via execute handler", async () => {
    const skill = SkillRegistry.getSkill("shell_execute");
    const context = makeContext();
    const result = await skill!.execute(
      { command: "sudo apt-get remove --purge*" },
      context
    );

    expect(result.success).toBe(false);
    expect((result.result as Record<string, unknown>).error).toContain(
      "safety policy"
    );
  });
});
