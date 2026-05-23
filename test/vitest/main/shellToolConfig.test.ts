/**
 * Unit tests for shell tool configuration and input validation.
 *
 * Tests cover:
 * - Zod schema validation (missing command, invalid shell, out-of-range timeout)
 * - Denylist block behavior (destructive commands rejected)
 */
import { describe, it, expect } from "vitest";
import { ShellExecutionRequestSchema } from "@/entityTypes/shellTypes";
import { SHELL_DENYLIST_PATTERNS } from "@/config/shellToolConfig";

// ---------------------------------------------------------------------------
// T010: Input validation via zod schema
// ---------------------------------------------------------------------------

describe("ShellExecutionRequestSchema — input validation", () => {
  it("rejects missing command", () => {
    const result = ShellExecutionRequestSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("command"))).toBe(
        true
      );
    }
  });

  it("rejects empty command", () => {
    const result = ShellExecutionRequestSchema.safeParse({ command: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes("Command must not be empty")
        )
      ).toBe(true);
    }
  });

  it("rejects invalid shell enum", () => {
    const result = ShellExecutionRequestSchema.safeParse({
      command: "echo test",
      shell: "zsh",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const enumIssue = result.error.issues.find((i) =>
        i.path.includes("shell")
      );
      expect(enumIssue).toBeDefined();
    }
  });

  it("rejects timeout below minimum (1000ms)", () => {
    const result = ShellExecutionRequestSchema.safeParse({
      command: "echo test",
      timeout_ms: 500,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message.includes("at least 1000ms"))
      ).toBe(true);
    }
  });

  it("rejects timeout above maximum (600000ms)", () => {
    const result = ShellExecutionRequestSchema.safeParse({
      command: "echo test",
      timeout_ms: 999999,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message.includes("600000ms"))
      ).toBe(true);
    }
  });

  it("accepts valid minimal request with defaults", () => {
    const result = ShellExecutionRequestSchema.safeParse({
      command: "echo hello",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.command).toBe("echo hello");
      expect(result.data.shell).toBe("auto");
      expect(result.data.timeout_ms).toBe(60000);
      expect(result.data.cwd).toBeUndefined();
    }
  });

  it("accepts explicit shell and timeout values", () => {
    const result = ShellExecutionRequestSchema.safeParse({
      command: "echo test",
      shell: "bash",
      timeout_ms: 5000,
      cwd: "/tmp",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.shell).toBe("bash");
      expect(result.data.timeout_ms).toBe(5000);
      expect(result.data.cwd).toBe("/tmp");
    }
  });
});

// ---------------------------------------------------------------------------
// T016: Denylist block behavior
// ---------------------------------------------------------------------------

describe("Shell denylist patterns — destructive command blocking", () => {
  const destructiveCommands = [
    { cmd: "rm -rf /home/user", desc: "recursive force delete home" },
    { cmd: "rm -rf /etc/passwd", desc: "recursive force delete etc" },
    { cmd: "rm -rf --no-preserve-root /etc", desc: "no-preserve-root delete" },
    { cmd: "mkfs.ext4 /dev/sda1", desc: "filesystem format" },
    { cmd: "dd if=/dev/zero of=/dev/sda", desc: "raw device write" },
    { cmd: "shutdown -h now", desc: "system shutdown" },
    { cmd: "reboot", desc: "system reboot" },
    { cmd: "fdisk /dev/sda", desc: "partition management" },
    { cmd: "format C:", desc: "Windows format drive" },
  ];

  for (const { cmd, desc } of destructiveCommands) {
    it(`blocks destructive command: ${desc}`, () => {
      const matched = SHELL_DENYLIST_PATTERNS.some((entry) =>
        entry.pattern.test(cmd)
      );
      expect(matched).toBe(true);
    });
  }

  it("does not block safe commands", () => {
    const safeCommands = [
      "echo hello",
      "ls -la",
      "cat README.md",
      "npm install",
      "git status",
      "pwd",
      "which node",
      "python --version",
    ];

    for (const cmd of safeCommands) {
      const matched = SHELL_DENYLIST_PATTERNS.some((entry) =>
        entry.pattern.test(cmd)
      );
      expect(matched).toBe(false);
    }
  });
});
