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
// Mock WorkspaceResolver so tests control the per-conversation workspace
// without touching the database. Default: no approved workspace (legacy
// default-roots behavior).
// ---------------------------------------------------------------------------

const resolveWorkspaceMock = vi.hoisted(() =>
  vi.fn<
    (id: string) => Promise<{ workspaceId: number; rootPath: string } | null>
  >()
);

vi.mock("@/service/WorkspaceResolver", () => ({
  WorkspaceResolver: class {
    readonly resolve = resolveWorkspaceMock;
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONVERSATION_ID = "test-conv-001";

beforeEach(() => {
  resolveWorkspaceMock.mockReset();
  resolveWorkspaceMock.mockResolvedValue(null);
});

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
    // Explicitly disable auto-background so this test exercises the
    // kill-on-timeout path. (Default is now auto-background = true.)
    const result = await executeShellCommand(
      { command: "sleep 120", timeout_ms: 2000, autoBackground: false },
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
    // Explicitly disable auto-background so this test exercises the
    // kill-on-timeout path.
    const result = await executeShellCommand(
      {
        command: "echo 'partial output' && sleep 120",
        timeout_ms: 2000,
        autoBackground: false,
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

// ---------------------------------------------------------------------------
// Conversation-scoped workspace roots (regression: shell_execute rejected a
// cwd inside the user's AI-chat workspace because it only consulted the
// default roots of home + userData)
// ---------------------------------------------------------------------------

describe("ShellToolService — conversation workspace roots", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "shell-ws-"))
    );
    resolveWorkspaceMock.mockResolvedValue({
      workspaceId: 1,
      rootPath: workspaceRoot,
    });
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("accepts cwd inside the conversation's approved workspace even when outside default roots", async () => {
    const result = await executeShellCommand(
      { command: "pwd", cwd: workspaceRoot },
      CONVERSATION_ID
    );

    expect(resolveWorkspaceMock).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(fs.realpathSync(result.stdout.trim())).toBe(workspaceRoot);
  });

  it("defaults cwd to the approved workspace root when omitted", async () => {
    const result = await executeShellCommand(
      { command: "pwd" },
      CONVERSATION_ID
    );

    expect(result.success).toBe(true);
    expect(fs.realpathSync(result.stdout.trim())).toBe(workspaceRoot);
  });

  it("rejects cwd outside the approved workspace root (strict workspace mode)", async () => {
    const outside = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "shell-outside-"))
    );
    try {
      const result = await executeShellCommand(
        { command: "echo test", cwd: outside },
        CONVERSATION_ID
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("outside allowed workspace roots");
      expect(result.exit_code).toBeNull();
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("falls back to default roots when no workspace is approved", async () => {
    resolveWorkspaceMock.mockResolvedValue(null);

    const result = await executeShellCommand(
      { command: "pwd" },
      CONVERSATION_ID
    );

    expect(result.success).toBe(true);
    expect(result.exit_code).toBe(0);
  });

  // Finding 7: a thrown workspace lookup must NOT widen the jail to the
  // default roots. A conversation whose workspace is approved should stay
  // confined to it; silently falling back to home+userData on a DB error
  // would let the shell run anywhere under $HOME. Fail closed instead —
  // every path-bearing command is rejected until the lookup recovers.
  it("fails closed (no roots allowed) when workspace lookup throws (Finding 7)", async () => {
    resolveWorkspaceMock.mockRejectedValue(new Error("db unavailable"));

    const result = await executeShellCommand(
      { command: "pwd" },
      CONVERSATION_ID
    );

    expect(result.success).toBe(false);
    // Fail-closed: no roots means no cwd is acceptable.
    expect(result.error).toContain("No allowed workspace roots available");
    expect(result.exit_code).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Regression suite for the exact reported failure: the LLM called
// shell_execute with { command: "wc -l canada_trade_companies.csv",
// cwd: "<chat workspace>" } and was rejected because the workspace lived
// outside the default roots (home + userData). These tests pin the
// conversation-scoped root resolution so the bug cannot silently return.
// ---------------------------------------------------------------------------

describe("ShellToolService — reported-scenario regressions", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "shell-repro-ws-"))
    );
    resolveWorkspaceMock.mockResolvedValue({
      workspaceId: 7,
      rootPath: workspaceRoot,
    });
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("runs `wc -l <file>` with cwd set to the chat workspace (exact reported call)", async () => {
    // Recreate the user's scenario: a CSV inside the chat workspace, which
    // itself lives outside the default roots (tmpdir is not under $HOME).
    fs.writeFileSync(
      path.join(workspaceRoot, "canada_trade_companies.csv"),
      "name,country\nAcme,CA\nGlobex,CA\n"
    );

    const result = await executeShellCommand(
      { command: "wc -l canada_trade_companies.csv", cwd: workspaceRoot },
      CONVERSATION_ID
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.stdout).toContain("3");
    expect(result.stdout).toContain("canada_trade_companies.csv");
  });

  it("accepts an absolute path argument inside the chat workspace", async () => {
    const csvPath = path.join(workspaceRoot, "data.csv");
    fs.writeFileSync(csvPath, "a\nb\n");

    const result = await executeShellCommand(
      { command: `wc -l ${JSON.stringify(csvPath)}`, cwd: workspaceRoot },
      CONVERSATION_ID
    );

    expect(result.success).toBe(true);
    expect(result.stdout).toContain("2");
  });

  it("accepts a cwd that is a subdirectory of the chat workspace", async () => {
    const subDir = path.join(workspaceRoot, "nested", "deeper");
    fs.mkdirSync(subDir, { recursive: true });

    const result = await executeShellCommand(
      { command: "pwd", cwd: subDir },
      CONVERSATION_ID
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(fs.realpathSync(result.stdout.trim())).toBe(fs.realpathSync(subDir));
    expect(result.validatedCwd).toBe(fs.realpathSync(subDir));
  });

  it("blocks path arguments outside the chat workspace at the permission layer", async () => {
    // With an approved workspace, reads outside the workspace must not
    // auto-execute — the permission layer escalates them to `ask`.
    const result = await executeShellCommand(
      { command: "wc -l /etc/hosts", cwd: workspaceRoot },
      CONVERSATION_ID
    );

    expect(result.success).toBe(false);
    expect(result.permission_verdict).toBe("ask");
    expect(result.error).toContain("requires approval");
  });

  it("re-resolves workspace roots on every execution (no stale root caching)", async () => {
    const workspaceB = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "shell-repro-ws-b-"))
    );
    try {
      resolveWorkspaceMock.mockReset();
      resolveWorkspaceMock
        .mockResolvedValueOnce({ workspaceId: 1, rootPath: workspaceRoot })
        .mockResolvedValueOnce({ workspaceId: 2, rootPath: workspaceB });

      // First execution: roots = workspaceRoot, so cwd in workspaceB fails.
      const first = await executeShellCommand(
        { command: "pwd", cwd: workspaceB },
        CONVERSATION_ID
      );
      expect(first.success).toBe(false);
      expect(first.error).toContain("outside allowed workspace roots");

      // Second execution (e.g. user switched workspace): roots = workspaceB.
      const second = await executeShellCommand(
        { command: "pwd", cwd: workspaceB },
        CONVERSATION_ID
      );
      expect(second.success).toBe(true);
      expect(fs.realpathSync(second.stdout.trim())).toBe(workspaceB);

      // The resolver must be consulted for EVERY execution — a module-level
      // cached guard would make the second call fail.
      expect(resolveWorkspaceMock).toHaveBeenCalledTimes(2);
    } finally {
      fs.rmSync(workspaceB, { recursive: true, force: true });
    }
  });

  it("never consults the workspace resolver for an empty conversationId", async () => {
    resolveWorkspaceMock.mockClear();

    const result = await executeShellCommand({ command: "pwd" }, "");

    expect(resolveWorkspaceMock).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.exit_code).toBe(0);
  });

  it("reports the workspace root in validatedCwd when cwd is omitted", async () => {
    const result = await executeShellCommand(
      { command: "pwd" },
      CONVERSATION_ID
    );

    expect(result.success).toBe(true);
    // Audit fields must reflect the effective (workspace) root so logs show
    // where the command actually ran.
    expect(fs.realpathSync(result.validatedCwd ?? "")).toBe(workspaceRoot);
  });
});
