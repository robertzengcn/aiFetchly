/**
 * Tests for the check_shell_status tool and the auto-background integration
 * between ShellToolService and BackgroundShellRegistry.
 *
 * Covers:
 * - handleCheckShellStatus returns not_found for unknown shell_id
 * - handleCheckShellStatus returns error when shell_id is absent
 * - handleCheckShellStatus returns current status for a detained shell
 */
import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import { getDefaultBackgroundShellRegistry } from "@/service/BackgroundShellRegistry";
import { handleCheckShellStatus } from "@/service/agentTools/checkShellStatusTool";

describe("check_shell_status", () => {
  // Use the default registry so handleCheckShellStatus can find the shell
  const registry = getDefaultBackgroundShellRegistry();

  it("returns not_found for unknown shell_id", async () => {
    const res = await handleCheckShellStatus({ shell_id: "unknown" });
    expect(res.success).toBe(false);
    expect(res.result.error).toContain("not found");
  });

  it("returns missing-shell_id error when shell_id absent", async () => {
    const res = await handleCheckShellStatus({});
    expect(res.success).toBe(false);
    expect(res.result.error).toContain("shell_id");
  });

  it("returns current status for a detained shell", async () => {
    const child = spawn("sh", ["-c", "echo done"]);
    // Use a unique command so we can identify it
    const id = registry.detain(child, { command: "echo done" });
    // Wait for completion
    await new Promise((r) => setTimeout(r, 200));

    const res = await handleCheckShellStatus({ shell_id: id });
    expect(res.success).toBe(true);
    expect(res.result.status).toBe("completed");
    expect(res.result.stdout).toContain("done");
  });
});
