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
import { log } from "@/modules/Logger";
import { getDefaultWorkspaceRoots } from "@/config/fileToolConfig";
import {
  SHELL_MAX_TIMEOUT_MS,
  SHELL_MIN_TIMEOUT_MS,
  SHELL_STDOUT_MAX_CHARS,
  SHELL_STDERR_MAX_CHARS,
  SHELL_ENV_ALLOWLIST,
  SHELL_AUTO_BACKGROUND_DEFAULT,
} from "@/config/shellToolConfig";
import { getDefaultBackgroundShellRegistry } from "@/service/BackgroundShellRegistry";
import { WorkspaceResolver } from "@/service/WorkspaceResolver";
import { ShellExecutionRequestSchema } from "@/entityTypes/shellTypes";
import type {
  ShellExecutionResult,
  ShellInterpreter,
} from "@/entityTypes/shellTypes";
import { checkShellPermission } from "@/service/shellSecurity/bashPermissions";
import {
  attachShellCapture,
  ShellCapture,
} from "@/service/ShellCaptureService";

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
  conversationId: string,
  toolCallId?: string
): Promise<ShellExecutionResult> {
  const startTime = Date.now();

  // 1. Validate input via zod
  const parsed = ShellExecutionRequestSchema.safeParse(rawArgs);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("; ");
    return makeErrorResult(message, startTime);
  }
  const request = parsed.data;

  // 2. Resolve the effective workspace roots for this conversation. When the
  //    conversation has an approved workspace, the shell is jailed to that
  //    workspace root (strict workspace mode, mirroring FileToolService);
  //    otherwise fall back to the legacy default roots (home + userData).
  const roots = await resolveWorkspaceRoots(conversationId);

  // 3. Resolve and validate cwd FIRST — the permission layer needs the guard
  const cwdResult = resolveCwd(request.cwd, roots);
  if (!cwdResult.valid) {
    return makeErrorResult(
      cwdResult.error ?? "Invalid working directory",
      startTime
    );
  }

  // 4. Layered permission check (parse → hazards → split → paths → rules).
  //    This subsumes the legacy regex denylist — the same SHELL_DENYLIST_PATTERNS
  //    are now applied inside checkShellPermission via tieredRegexRules, so
  //    running them again here would be pure duplication.
  const guard = new FilePathGuard(roots, []);
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

  // 5. Resolve timeout (clamp to allowed range)
  const timeoutMs = clampTimeout(request.timeout_ms);

  // 5b. Resolve auto-background flag (caller can explicitly disable)
  const autoBackground =
    request.autoBackground ?? SHELL_AUTO_BACKGROUND_DEFAULT;

  // 6. Select shell interpreter
  const interpreter = resolveInterpreter(request.shell);

  // 7. Build scrubbed environment
  const env = scrubEnvironment();

  // 8. Execute with timeout and output caps
  const result = await runShell(
    interpreter,
    request.command,
    cwdResult.path,
    env,
    timeoutMs,
    startTime,
    autoBackground,
    conversationId,
    toolCallId
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
// Workspace root resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the effective workspace roots for a conversation.
 *
 * When the conversation has an approved workspace, the shell is confined to
 * that workspace root (strict workspace mode, mirroring FileToolService), so
 * paths like `E:\ai_test\canada_trade` that live outside the user's home
 * directory are still accepted. When no workspace is approved (resolver
 * returns null), fall back to the legacy default roots (home + userData) so
 * non-chat callers keep working.
 *
 * Fail-closed contract (Finding 7): a thrown lookup (e.g. DB unavailable)
 * must NOT silently widen the jail to default roots — that would let a
 * chat conversation whose workspace is approved run anywhere under $HOME
 * the moment the lookup errors. Distinguish the two failure modes:
 *   - resolver returns null → no workspace approved → safe default roots
 *   - resolver throws        → lookup genuinely failed → fail closed with
 *                              an empty root set (all paths rejected) and
 *                              log the error so operators see it.
 */
async function resolveWorkspaceRoots(
  conversationId: string
): Promise<readonly string[]> {
  if (conversationId) {
    try {
      const resolver = new WorkspaceResolver();
      const workspace = await resolver.resolve(conversationId);
      if (workspace && workspace.rootPath) {
        return [workspace.rootPath];
      }
      // No approved workspace for this conversation — fall back to default
      // roots so non-chat callers (empty conversationId handled below too)
      // keep working.
      return getDefaultWorkspaceRoots();
    } catch (err) {
      // Lookup failed mid-flight. Widening to default roots here would
      // jail-break a conversation that should be confined to its approved
      // workspace. Fail closed instead and surface the error.
      log.error(
        `[shell-tool] workspace lookup threw for conversation ${conversationId}; ` +
          `failing closed (no roots allowed). ` +
          `Cause: ${err instanceof Error ? err.message : String(err)}`
      );
      return [];
    }
  }
  return getDefaultWorkspaceRoots();
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
  roots: readonly string[]
): CwdResult {
  // Fail-closed: when no roots are available (e.g. workspace lookup threw
  // and the jail cannot be established), reject before consulting the guard.
  // The guard's own "no roots ⇒ allow all" behavior would otherwise turn a
  // broken lookup into a silent jail-break.
  if (roots.length === 0) {
    return {
      valid: false,
      path: cwd ?? "",
      error:
        "No allowed workspace roots available (workspace lookup failed); refusing to execute",
    };
  }

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
  startTime: number,
  autoBackground: boolean,
  conversationId: string,
  toolCallId?: string
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

    // T16: when capture is enabled, spool stdout/stderr into a preserved
    // artifact. `attachShellCapture` is SYNCHRONOUS: it registers the data
    // listeners before any chunks can arrive (claim runs in the background and
    // chunks buffer until the stream is ready), so no early output is lost.
    // The legacy inline accumulators below still run for the bounded preview
    // fields when capture is absent; when capture is present, its own inline
    // getters are authoritative at finalize time.
    const capture = toolCallId
      ? attachShellCapture(child, {
          conversationId,
          toolCallId,
          toolName: "shell_execute",
          executionId: `${conversationId}:exec:${toolCallId}`,
        })
      : null;

    const timer = setTimeout(() => {
      timedOut = true;
      if (autoBackground) {
        // Mark as detained BEFORE handing off so the foreground data handlers
        // below no-op from this point forward. Detach the capture's own
        // listeners too, so the registry's listeners are the ONLY writers to
        // the artifact sink — otherwise both would append (double-write).
        detained = true;
        if (capture) {
          capture.detach(child);
        }
        const shellId = getDefaultBackgroundShellRegistry().detain(child, {
          command,
          ...(capture ? { capture } : {}),
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
        killProcessTree(child.pid);
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
      // Abort the capture on a spawn failure so quota is not leaked.
      if (capture) {
        capture.abort().catch(() => undefined);
      }
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

    child.on("close", async (code: number | null) => {
      if (detained) return; // backgrounded — registry takes over
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      // Normalize line endings on Windows
      if (process.platform === "win32") {
        stdout = stdout.replace(/\r\n/g, "\n");
        stderr = stderr.replace(/\r\n/g, "\n");
      }

      // T16: finalize the preserved artifact. `finalize` awaits the
      // background claim internally, so no captureReady polling is needed —
      // it resolves once the stream is open (or never, if begin failed, in
      // which case it returns null and the inline preview is the result).
      let toolResultRef: ShellExecutionResult["tool_result_ref"];
      if (capture) {
        try {
          const ref = await capture.finalize();
          toolResultRef = ref ?? undefined;
        } catch {
          toolResultRef = undefined;
        }
      }

      // Prefer the capture's honest truncation/preview fields when present.
      const finalStdout = capture ? capture.getInlineStdout() : stdout;
      const finalStderr = capture ? capture.getInlineStderr() : stderr;
      const finalStdoutTruncated = capture
        ? capture.getStdoutTruncated()
        : stdoutTruncated;
      const finalStderrTruncated = capture
        ? capture.getStderrTruncated()
        : stderrTruncated;

      resolve({
        success: !timedOut && code === 0,
        exit_code: timedOut ? null : code,
        stdout: finalStdout,
        stderr: finalStderr,
        duration_ms: durationMs,
        stdout_truncated: finalStdoutTruncated,
        stderr_truncated: finalStderrTruncated,
        timed_out: timedOut,
        ...(timedOut
          ? { error: `Command timed out after ${timeoutMs}ms` }
          : {}),
        ...(toolResultRef ? { tool_result_ref: toolResultRef } : {}),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Process-tree kill
// ---------------------------------------------------------------------------

function killProcessTree(pid: number | undefined): void {
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
