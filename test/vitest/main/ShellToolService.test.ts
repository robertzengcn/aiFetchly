/**
 * Unit tests for ShellToolService — core execution engine.
 *
 * Tests cover:
 * - Success path (echo command → structured result with stdout)
 * - Non-zero exit code propagation
 * - CWD guard rejection (out-of-root cwd rejected, omitted cwd defaults)
 * - Timeout behavior (command killed, timed_out=true, partial output)
 * - Shell interpreter selection (auto/platform detection, explicit override)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { executeShellCommand } from "@/service/ShellToolService";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONVERSATION_ID = "test-conv-001";

// ---------------------------------------------------------------------------
// T008: Success path
// ---------------------------------------------------------------------------

describe("ShellToolService — success path", () => {
  it("returns structured result with stdout for a simple echo command", async () => {
    const result = await executeShellCommand(
      { command: "echo 'hello world'" },
      CONVERSATION_ID
    );

    expect(result.success).toBe(true);
    expect(result.exit_code).toBe(0);
    expect(result.stdout.trim()).toBe("hello world");
    expect(result.stderr).toBe("");
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(result.timed_out).toBe(false);
    expect(result.stdout_truncated).toBe(false);
    expect(result.stderr_truncated).toBe(false);
    expect(result.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T009: Non-zero exit code propagation
// ---------------------------------------------------------------------------

describe("ShellToolService — non-zero exit code", () => {
  it("returns success=false with non-zero exit code", async () => {
    const result = await executeShellCommand(
      { command: "exit 42" },
      CONVERSATION_ID
    );

    expect(result.success).toBe(false);
    expect(result.exit_code).toBe(42);
    expect(result.timed_out).toBe(false);
  });

  it("captures stderr output", async () => {
    const result = await executeShellCommand(
      { command: "echo 'error message' >&2 && exit 1" },
      CONVERSATION_ID
    );

    expect(result.success).toBe(false);
    expect(result.stderr.trim()).toBe("error message");
  });
});

// ---------------------------------------------------------------------------
// T019: CWD guard rejection
// ---------------------------------------------------------------------------

describe("ShellToolService — cwd guard", () => {
  it("rejects commands with cwd outside workspace roots", async () => {
    const result = await executeShellCommand(
      { command: "echo test", cwd: "/etc" },
      CONVERSATION_ID
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("outside allowed workspace roots");
    expect(result.exit_code).toBeNull();
  });

  it("defaults to workspace root when cwd is omitted", async () => {
    // When no cwd is specified, the command should execute successfully
    // in the default workspace root
    const result = await executeShellCommand(
      { command: "pwd" },
      CONVERSATION_ID
    );

    expect(result.success).toBe(true);
    expect(result.exit_code).toBe(0);
    // The output should be some valid directory path
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// T021: Timeout behavior
// ---------------------------------------------------------------------------

describe("ShellToolService — timeout enforcement", () => {
  it("kills command exceeding timeout and returns timed_out result", async () => {
    const result = await executeShellCommand(
      { command: "sleep 120", timeout_ms: 2000 },
      CONVERSATION_ID
    );

    expect(result.success).toBe(false);
    expect(result.timed_out).toBe(true);
    expect(result.exit_code).toBeNull();
    expect(result.error).toContain("timed out");
    // Duration should be close to the 2000ms timeout (allow some overhead)
    expect(result.duration_ms).toBeLessThan(5000);
    expect(result.duration_ms).toBeGreaterThanOrEqual(1800);
  });

  it("captures partial output before timeout", async () => {
    const result = await executeShellCommand(
      {
        command: "echo 'partial output' && sleep 120",
        timeout_ms: 2000,
      },
      CONVERSATION_ID
    );

    expect(result.timed_out).toBe(true);
    expect(result.stdout).toContain("partial output");
  });
});

// ---------------------------------------------------------------------------
// T023: Shell interpreter selection
// ---------------------------------------------------------------------------

describe("ShellToolService — interpreter selection", () => {
  it("uses bash by default on POSIX systems", async () => {
    // On Linux/macOS CI, auto should select bash
    if (process.platform === "win32") {
      return; // skip on Windows
    }

    const result = await executeShellCommand(
      { command: "echo $BASH", shell: "auto" },
      CONVERSATION_ID
    );

    expect(result.success).toBe(true);
    // $BASH is a bash built-in variable
    expect(result.stdout.trim()).toContain("bash");
  });

  it("allows explicit bash override", async () => {
    if (process.platform === "win32") {
      return;
    }

    const result = await executeShellCommand(
      { command: "echo hello", shell: "bash" },
      CONVERSATION_ID
    );

    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("hello");
  });

  it("rejects invalid shell enum values via zod", async () => {
    const result = await executeShellCommand(
      { command: "echo test", shell: "invalid_shell" },
      CONVERSATION_ID
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
