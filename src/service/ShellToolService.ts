/**
 * ShellToolService — hardened shell command execution for AI chat.
 *
 * Provides safe, controlled execution of local shell commands with:
 *   - Input validation via zod schemas
 *   - Destructive command denylist pre-check
 *   - Workspace-restricted working directory (FilePathGuard)
 *   - Cross-platform shell interpreter selection
 *   - Timeout enforcement with process-tree kill
 *   - Output size caps with truncation flags
 *   - Environment variable scrubbing (allowlist)
 *   - Structured error responses (never raw crashes)
 */

import { spawn } from "child_process";
import * as path from "path";
import * as os from "os";
import { FilePathGuard } from "@/service/FilePathGuard";
import { getDefaultWorkspaceRoots } from "@/config/fileToolConfig";
import {
  SHELL_DEFAULT_TIMEOUT_MS,
  SHELL_MAX_TIMEOUT_MS,
  SHELL_MIN_TIMEOUT_MS,
  SHELL_STDOUT_MAX_CHARS,
  SHELL_STDERR_MAX_CHARS,
  SHELL_DENYLIST_PATTERNS,
  SHELL_ENV_ALLOWLIST,
} from "@/config/shellToolConfig";
import { ShellExecutionRequestSchema } from "@/entityTypes/shellTypes";
import type {
  ShellExecutionResult,
  ShellInterpreter,
} from "@/entityTypes/shellTypes";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a local shell command with full safety controls.
 *
 * Returns a structured result for every execution path (success, failure,
 * timeout, pre-check rejection). Never throws raw errors.
 */
export async function executeShellCommand(
  rawArgs: Record<string, unknown>,
  conversationId: string
): Promise<ShellExecutionResult> {
  const startTime = Date.now();

  // 1. Validate input via zod
  const parsed = ShellExecutionRequestSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("; ");
    return makeErrorResult(message, startTime);
  }
  const request = parsed.data;

  // 2. Denylist pre-check
  const denyResult = checkDenylist(request.command);
  if (denyResult.blocked) {
    return makeErrorResult(
      `Command blocked by safety policy: ${denyResult.reason}`,
      startTime
    );
  }

  // 3. Resolve and validate cwd
  const cwdResult = resolveCwd(request.cwd);
  if (!cwdResult.valid) {
    return makeErrorResult(
      cwdResult.error ?? "Invalid working directory",
      startTime
    );
  }

  // 4. Resolve timeout (clamp to allowed range)
  const timeoutMs = clampTimeout(request.timeout_ms);

  // 5. Select shell interpreter
  const interpreter = resolveInterpreter(request.shell);

  // 6. Build scrubbed environment
  const env = scrubEnvironment();

  // 7. Execute with timeout and output caps
  return runShell(
    interpreter,
    request.command,
    cwdResult.path,
    env,
    timeoutMs,
    startTime
  );
}

// ---------------------------------------------------------------------------
// Denylist check
// ---------------------------------------------------------------------------

interface DenylistResult {
  readonly blocked: boolean;
  readonly reason?: string;
}

function checkDenylist(command: string): DenylistResult {
  for (const entry of SHELL_DENYLIST_PATTERNS) {
    if (entry.pattern.test(command)) {
      return { blocked: true, reason: entry.description };
    }
  }
  return { blocked: false };
}

// ---------------------------------------------------------------------------
// CWD resolution
// ---------------------------------------------------------------------------

interface CwdResult {
  readonly valid: boolean;
  readonly path: string;
  readonly error?: string;
}

function resolveCwd(cwd?: string): CwdResult {
  const roots = getDefaultWorkspaceRoots();
  const guard = new FilePathGuard(roots, []);

  if (!cwd) {
    // Default to first workspace root
    return { valid: true, path: roots[0] };
  }

  const validation = guard.validate(cwd);
  if (!validation.safe) {
    return {
      valid: false,
      path: cwd,
      error: `Working directory '${cwd}' is outside allowed workspace roots`,
    };
  }

  return { valid: true, path: validation.resolvedPath };
}

// ---------------------------------------------------------------------------
// Timeout clamping
// ---------------------------------------------------------------------------

function clampTimeout(timeoutMs: number): number {
  return Math.min(
    SHELL_MAX_TIMEOUT_MS,
    Math.max(SHELL_MIN_TIMEOUT_MS, timeoutMs)
  );
}

// ---------------------------------------------------------------------------
// Interpreter selection
// ---------------------------------------------------------------------------

interface InterpreterConfig {
  readonly command: string;
  readonly args: string[];
}

function resolveInterpreter(shell: ShellInterpreter): InterpreterConfig {
  if (shell === "bash") {
    return { command: "/bin/bash", args: ["-c"] };
  }
  if (shell === "powershell") {
    return findPowerShell();
  }
  if (shell === "cmd") {
    return { command: "cmd.exe", args: ["/d", "/s", "/c"] };
  }

  // "auto" — detect platform
  if (process.platform === "win32") {
    return findPowerShell();
  }
  return { command: "/bin/bash", args: ["-c"] };
}

function findPowerShell(): InterpreterConfig {
  // Prefer pwsh (PowerShell Core) over Windows PowerShell
  if (process.platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command"],
    };
  }
  return {
    command: "pwsh",
    args: ["-NoProfile", "-NonInteractive", "-Command"],
  };
}

// ---------------------------------------------------------------------------
// Environment scrubbing
// ---------------------------------------------------------------------------

function scrubEnvironment(): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = {};
  for (const key of SHELL_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) {
      scrubbed[key] = process.env[key];
    }
  }
  return scrubbed;
}

// ---------------------------------------------------------------------------
// Shell execution
// ---------------------------------------------------------------------------

async function runShell(
  interpreter: InterpreterConfig,
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  startTime: number
): Promise<ShellExecutionResult> {
  return new Promise<ShellExecutionResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;

    const child = spawn(interpreter.command, [...interpreter.args, command], {
      cwd,
      env,
      shell: false,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid, cwd);
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (!stdoutTruncated) {
        const appended = stdout + chunk.toString("utf-8");
        if (appended.length > SHELL_STDOUT_MAX_CHARS) {
          stdout = appended.slice(0, SHELL_STDOUT_MAX_CHARS);
          stdoutTruncated = true;
        } else {
          stdout = appended;
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (!stderrTruncated) {
        const appended = stderr + chunk.toString("utf-8");
        if (appended.length > SHELL_STDERR_MAX_CHARS) {
          stderr = appended.slice(0, SHELL_STDERR_MAX_CHARS);
          stderrTruncated = true;
        } else {
          stderr = appended;
        }
      }
    });

    child.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve({
        success: false,
        exit_code: null,
        stdout: "",
        stderr: err.message,
        duration_ms: Date.now() - startTime,
        stdout_truncated: false,
        stderr_truncated: false,
        timed_out: false,
        error: `Failed to spawn process: ${err.message}`,
      });
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      // Normalize line endings on Windows
      if (process.platform === "win32") {
        stdout = stdout.replace(/\r\n/g, "\n");
        stderr = stderr.replace(/\r\n/g, "\n");
      }

      resolve({
        success: !timedOut && code === 0,
        exit_code: timedOut ? null : code,
        stdout,
        stderr,
        duration_ms: durationMs,
        stdout_truncated: stdoutTruncated,
        stderr_truncated: stderrTruncated,
        timed_out: timedOut,
        ...(timedOut
          ? { error: `Command timed out after ${timeoutMs}ms` }
          : {}),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Process-tree kill
// ---------------------------------------------------------------------------

function killProcessTree(pid: number | undefined, _cwd: string): void {
  if (pid === undefined) {
    return;
  }

  try {
    if (process.platform === "win32") {
      // Windows: use taskkill for process tree termination
      spawn("taskkill", ["/T", "/F", "/PID", String(pid)], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      // POSIX: kill the process group
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Fallback: kill just the process if group kill fails
        process.kill(pid, "SIGKILL");
      }
    }
  } catch {
    // Process may have already exited — ignore kill errors
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeErrorResult(
  error: string,
  startTime: number
): ShellExecutionResult {
  return {
    success: false,
    exit_code: null,
    stdout: "",
    stderr: "",
    duration_ms: Date.now() - startTime,
    stdout_truncated: false,
    stderr_truncated: false,
    timed_out: false,
    error,
  };
}
