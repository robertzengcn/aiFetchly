/**
 * ShellToolService — hardened shell command execution for AI chat.
 *
 * Provides safe, controlled execution of local shell commands with:
 *   - Input validation via zod schemas
 *   - Layered permission analysis (parse → hazards → split → paths → rules)
 *   - Destructive command denylist pre-check (defense-in-depth backstop)
 *   - Workspace-restricted working directory (FilePathGuard)
 *   - Cross-platform shell interpreter selection
 *   - Timeout enforcement with process-tree kill
 *   - Output size caps with truncation flags
 *   - Environment variable scrubbing (allowlist)
 *   - Structured error responses (never raw crashes)
 */

import { spawn } from "child_process";
import { FilePathGuard } from "@/service/FilePathGuard";
import { getDefaultFilesystemContextService } from "@/service/ConversationFilesystemContextService";
import {
  SHELL_MAX_TIMEOUT_MS,
  SHELL_MIN_TIMEOUT_MS,
  SHELL_STDOUT_MAX_CHARS,
  SHELL_STDERR_MAX_CHARS,
  SHELL_ENV_ALLOWLIST,
  SHELL_AUTO_BACKGROUND_DEFAULT,
} from "@/config/shellToolConfig";
import { getDefaultBackgroundShellRegistry } from "@/service/BackgroundShellRegistry";
import { ShellExecutionRequestSchema } from "@/entityTypes/shellTypes";
import type {
  ShellExecutionResult,
  ShellInterpreter,
} from "@/entityTypes/shellTypes";
import { checkShellPermission } from "@/service/shellSecurity/bashPermissions";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The conversation filesystem scope a shell command runs under. Resolved
 * once through ConversationFilesystemContextService so shell and file tools
 * observe the SAME canonical workspace (natural-language-skill-installation
 * design §6.2 — `ShellToolService` stops resolving roots independently).
 */
export interface ShellExecutionScope {
  /** Canonical workspace root — the default cwd. */
  readonly defaultCwd: string;
  /** Roots an explicit `cwd` argument may target. */
  readonly allowedRoots: readonly string[];
}

/**
 * Resolve the shell execution scope for a conversation. Fail closed with a
 * structured message when no workspace is approved — the home directory is
 * never a silent substitute (PRD §15.2, FR-12).
 */
export async function resolveShellExecutionScope(
  conversationId: string
): Promise<ShellExecutionScope | { readonly error: string }> {
  const resolution = await getDefaultFilesystemContextService().resolve(
    conversationId
  );
  if (!resolution.ok) {
    return { error: resolution.message };
  }
  const ctx = resolution.context;
  return {
    defaultCwd: ctx.defaultCwd,
    allowedRoots: ctx.roots.map((r) => r.canonicalPath),
  };
}

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

  // 2. Resolve the shared conversation scope (fail closed without one) and
  //    validate cwd against it — the permission layer needs the same guard.
  const scope = await resolveShellExecutionScope(conversationId);
  if ("error" in scope) {
    return makeErrorResult(scope.error, startTime);
  }
  const cwdResult = resolveCwd(request.cwd, scope);
  if (!cwdResult.valid) {
    return makeErrorResult(
      cwdResult.error ?? "Invalid working directory",
      startTime
    );
  }

  // 3. Layered permission check (parse → hazards → split → paths → rules).
  //    This subsumes the legacy regex denylist — the same SHELL_DENYLIST_PATTERNS
  //    are now applied inside checkShellPermission via tieredRegexRules, so
  //    running them again here would be pure duplication.
  const guard = new FilePathGuard(scope.allowedRoots, []);
  const verdict = checkShellPermission(request.command, guard);
  if (verdict.tier !== "allow") {
    return {
      ...makeErrorResult(
        verdict.tier === "deny"
          ? `Command blocked by safety policy: ${verdict.reason}`
          : `Command requires approval: ${verdict.reason}`,
        startTime
      ),
      permission_verdict: verdict.tier,
      permission_code: verdict.code,
    };
  }

  // 4. Resolve timeout (clamp to allowed range)
  const timeoutMs = clampTimeout(request.timeout_ms);

  // 4b. Resolve auto-background flag (caller can explicitly disable)
  const autoBackground =
    request.autoBackground ?? SHELL_AUTO_BACKGROUND_DEFAULT;

  // 5. Select shell interpreter
  const interpreter = resolveInterpreter(request.shell);

  // 6. Build scrubbed environment
  const env = scrubEnvironment();

  // 7. Execute with timeout and output caps
  const result = await runShell(
    interpreter,
    request.command,
    cwdResult.path,
    env,
    timeoutMs,
    startTime,
    autoBackground
  );

  // Attach validated fields for audit logging
  return {
    ...result,
    validatedCommand: request.command,
    validatedCwd: cwdResult.path,
    validatedShell: request.shell,
    permission_verdict: "allow" as const,
    permission_code: "OK",
  };
}

// ---------------------------------------------------------------------------
// CWD resolution
// ---------------------------------------------------------------------------

interface CwdResult {
  readonly valid: boolean;
  readonly path: string;
  readonly error?: string;
}

function resolveCwd(
  cwd: string | undefined,
  scope: ShellExecutionScope
): CwdResult {
  if (!cwd) {
    // Default to the canonical conversation workspace (shared with file tools)
    return { valid: true, path: scope.defaultCwd };
  }

  const guard = new FilePathGuard(scope.allowedRoots, []);
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
  startTime: number,
  autoBackground: boolean
): Promise<ShellExecutionResult> {
  return new Promise<ShellExecutionResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    // Once the child is handed to the registry, local stdout/stderr
    // collection must stop to avoid double-buffering.
    let detained = false;

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
      if (autoBackground) {
        // Mark as detained BEFORE calling registry.detain so the data
        // handlers below no-op from this point forward. The registry
        // attaches its own listeners to take over collection.
        detained = true;
        const shellId = getDefaultBackgroundShellRegistry().detain(child, {
          command,
        });
        resolve({
          success: true,
          exit_code: null,
          stdout,
          stderr,
          duration_ms: Date.now() - startTime,
          stdout_truncated: stdoutTruncated,
          stderr_truncated: stderrTruncated,
          timed_out: false, // not a timeout failure — moved to background
          backgrounded: true,
          shell_id: shellId,
          background_message:
            "Command exceeded the timeout and was moved to the background. " +
            "Poll with check_shell_status(shell_id) to retrieve full output.",
        });
      } else {
        killProcessTree(child.pid, cwd);
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (detained || stdoutTruncated) return;
      const appended = stdout + chunk.toString("utf-8");
      if (appended.length > SHELL_STDOUT_MAX_CHARS) {
        stdout = appended.slice(0, SHELL_STDOUT_MAX_CHARS);
        stdoutTruncated = true;
      } else {
        stdout = appended;
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (detained || stderrTruncated) return;
      const appended = stderr + chunk.toString("utf-8");
      if (appended.length > SHELL_STDERR_MAX_CHARS) {
        stderr = appended.slice(0, SHELL_STDERR_MAX_CHARS);
        stderrTruncated = true;
      } else {
        stderr = appended;
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
      if (detained) return; // backgrounded — registry takes over; skip dead-code path
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
