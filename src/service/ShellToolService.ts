/**
 * ShellToolService — hardened shell command execution for AI chat.
 *
 * Provides safe, controlled execution of local shell commands with:
 *   - Input validation via zod schemas
 *   - Layered permission analysis (parse → hazards → split → paths → rules)
 *   - Destructive command denylist pre-check (defense-in-depth backstop)
 *   - Workspace-restricted working directory (FilePathGuard + capability gate)
 *   - Cross-platform execution via the platform process providers
 *     (pwsh → powershell fallback, denylist env scrub, BOM/UTF-16LE decode,
 *     byte counts, PROCESS_OUTPUT_EMPTY_UNEXPECTED, process-tree kill)
 *   - Timeout enforcement with optional auto-background
 *   - Output size caps with truncation flags
 *   - Structured error responses (never raw crashes)
 *
 * NFR-02 / PRD §16: the CONVERSATION shell path runs on the same tested
 * providers as the skill installer — no legacy spawn implementation.
 */

import { FilePathGuard } from "@/service/FilePathGuard";
import {
  assertFilesystemPathAllowed,
  getDefaultFilesystemContextService,
} from "@/service/ConversationFilesystemContextService";
import {
  SHELL_MAX_TIMEOUT_MS,
  SHELL_MIN_TIMEOUT_MS,
  SHELL_STDOUT_MAX_CHARS,
  SHELL_STDERR_MAX_CHARS,
  SHELL_AUTO_BACKGROUND_DEFAULT,
} from "@/config/shellToolConfig";
import {
  buildChildEnvironment,
  getPlatformProcessProvider,
  resolveShellInterpreter,
} from "@/service/process";
import { getDefaultBackgroundShellRegistry } from "@/service/BackgroundShellRegistry";
import {
  attachShellCapture,
  type ShellCapture,
} from "@/service/ShellCaptureService";
import { ShellExecutionRequestSchema } from "@/entityTypes/shellTypes";
import type {
  ShellExecutionResult,
  ShellInterpreter,
} from "@/entityTypes/shellTypes";
import { checkShellPermission } from "@/service/shellSecurity/bashPermissions";
import { getDefaultWorkspaceRoots } from "@/config/fileToolConfig";

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
  /** Owning conversation (capability-policy context). */
  readonly conversationId: string;
  /** Canonical workspace root — the default cwd. */
  readonly defaultCwd: string;
  /** Roots an explicit `cwd` argument may target. */
  readonly allowedRoots: readonly string[];
}

/**
 * Resolve the shell execution scope for a conversation through the shared
 * ConversationFilesystemContextService (design §6.2: shell and file tools
 * observe the SAME canonical workspace).
 *
 * dev-merge 2026-10-09 — two-mode contract (dev Finding 7), reconciled with
 * our PRD §15.2 fail-closed rule:
 *   - resolver returns null (NO approved workspace) → the CHAT shell keeps
 *     dev's legacy default roots (home + userData) so non-chat callers and
 *     workspace-less conversations keep working — the skill installer's
 *     own tools still fail closed via their own scope checks;
 *   - resolver THROWS (lookup genuinely failed) → fail closed with NO
 *     roots (never widen the jail on error).
 */
export async function resolveShellExecutionScope(
  conversationId: string
): Promise<ShellExecutionScope | { readonly error: string }> {
  const resolution = await getDefaultFilesystemContextService().resolve(
    conversationId
  );
  if (resolution.ok) {
    const ctx = resolution.context;
    return {
      conversationId: ctx.conversationId,
      defaultCwd: ctx.defaultCwd,
      allowedRoots: ctx.roots.map((r) => r.canonicalPath),
    };
  }
  if (resolution.code === "WORKSPACE_NOT_APPROVED") {
    // Dev's fallback: no approved workspace → legacy default roots.
    const defaults = getDefaultWorkspaceRoots();
    return {
      conversationId,
      defaultCwd: defaults[0] ?? process.cwd(),
      allowedRoots: defaults,
    };
  }
  // INVALID_CONVERSATION / WORKSPACE_RESOLUTION_FAILED → fail closed.
  return { error: resolution.message };
}

/**
 * Execute a local shell command with full safety controls.
 *
 * Returns a structured result for every execution path (success, failure,
 * timeout, pre-check rejection). Never throws raw errors.
 */
export async function executeShellCommand(
  rawArgs: Record<string, unknown>,
  conversationId: string,
  /** dev-merge 2026-10-09: enables output spooling (ShellCaptureService). */
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

  // 5-7. Execute through the platform process provider: shared interpreter
  // resolution (pwsh → powershell fallback, typed args, shell:false),
  // denylist env scrub, byte-counted BOM-aware capture, tree-kill timeout,
  // and the auto-background hand-off.
  const result = await runShell(
    request.shell,
    request.command,
    cwdResult.path,
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

  // Capability-aware second gate (design §6.3, review D3 wiring): the shell
  // runs commands from this directory, so the root must grant 'execute'.
  const capability = assertFilesystemPathAllowed({
    path: validation.resolvedPath,
    operation: "execute",
    context: {
      conversationId: scope.conversationId,
      workspaceId: -1,
      defaultCwd: scope.defaultCwd,
      workspaceRoot: scope.defaultCwd,
      canonicalWorkspaceRoot: scope.defaultCwd,
      roots: scope.allowedRoots.map((root, i) => ({
        id: `root:${i}`,
        kind: "workspace" as const,
        canonicalPath: root,
        capabilities: new Set(["read", "write", "execute", "watch"] as const),
      })),
      revision: "shell",
    },
  });
  if (!capability.allowed) {
    return {
      valid: false,
      path: cwd,
      error: `Working directory rejected: ${capability.message}`,
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
// Shell execution — platform provider path (NFR-02 / PRD §16)
// ---------------------------------------------------------------------------

/**
 * Char-level cap applied AFTER the provider's byte-level capture, matching
 * the historical ShellExecutionResult truncation flags.
 */
function capChars(text: string, maxChars: number): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

async function runShell(
  shell: ShellInterpreter,
  command: string,
  cwd: string,
  timeoutMs: number,
  startTime: number,
  autoBackground: boolean,
  conversationId?: string,
  toolCallId?: string
): Promise<ShellExecutionResult> {
  const interpreter = resolveShellInterpreter(shell);
  // dev-merge 2026-10-09 (T16 output capture): with a toolCallId, spool
  // stdout/stderr into a preserved artifact via the provider's SYNCHRONOUS
  // onSpawn hook — fired before any stream listener attaches, so no early
  // output is lost. Best-effort: disabled capture skips the spool.
  const captureRef: { current: ShellCapture | null } = { current: null };
  const result = await getPlatformProcessProvider().execute({
    executable: interpreter.executable,
    args: [...interpreter.args, command],
    cwd,
    // Denylist scrub (preserves Windows vars + drops secret-shaped keys) —
    // the Unix ALLOWLIST is gone from the conversation path by design §7.2.
    environment: buildChildEnvironment(),
    timeoutMs,
    // Generous byte ceiling; the exact char caps are applied below.
    outputLimitBytes: Math.max(
      SHELL_STDOUT_MAX_CHARS,
      SHELL_STDERR_MAX_CHARS
    ) * 4,
    ...(toolCallId && conversationId
      ? {
          onSpawn: (child) => {
            captureRef.current = attachShellCapture(child, {
              conversationId,
              toolCallId,
              toolName: "shell_execute",
              executionId: `${conversationId}:exec:${toolCallId}`,
            });
          },
        }
      : {}),
    ...(autoBackground
      ? {
          onTimeoutDetain: (child) => {
            // T16: the registry continues the SAME artifact — detach the
            // foreground listeners and hand the registry the capture handle.
            captureRef.current?.detach(child);
            const capture = captureRef.current;
            return getDefaultBackgroundShellRegistry().detain(child, {
              command,
              ...(capture ? { capture } : {}),
            });
          },
        }
      : {}),
  });
  // Foreground completion finalizes the spool (a spawn-failure diagnostic
  // resolves before onSpawn fired — captureRef stays null, nothing to do).
  // finalize() returns the artifact ref and the AUTHORITATIVE inline
  // previews/truncation flags (T16): when capture is present its getters
  // win over the provider's byte-window capture.
  let toolResultRef: ShellExecutionResult["tool_result_ref"];
  if (captureRef.current && !result.backgrounded) {
    // FOREGROUND completion only — a backgrounded child's artifact is
    // finalized by the registry on close (finalizing here would consume
    // it and poll() would never surface the ref).
    try {
      toolResultRef = (await captureRef.current.finalize()) ?? undefined;
    } catch {
      /* capture finalization is best-effort; inline fields stand */
    }
  }

  // Auto-background: not a timeout failure — the registry owns the child.
  // With a capture attached (T16), its BOUNDED inline getters are the
  // honest foreground preview; the artifact continues in the registry.
  if (result.backgrounded) {
    const bgCapture = captureRef.current;
    return {
      success: true,
      exit_code: null,
      stdout: bgCapture ? bgCapture.getInlineStdout() : result.stdout,
      stderr: bgCapture ? bgCapture.getInlineStderr() : result.stderr,
      duration_ms: Date.now() - startTime,
      stdout_truncated: bgCapture
        ? bgCapture.getStdoutTruncated()
        : false,
      stderr_truncated: bgCapture
        ? bgCapture.getStderrTruncated()
        : false,
      timed_out: false,
      backgrounded: true,
      shell_id: result.backgroundId as string,
      background_message:
        "Command exceeded the timeout and was moved to the background. " +
        "Poll with check_shell_status(shell_id) to retrieve full output.",
    };
  }

  // Spawn failures keep the historical message shape.
  if (result.diagnosticCode === "PROCESS_SPAWN_FAILED") {
    return {
      success: false,
      exit_code: null,
      stdout: "",
      stderr: result.stderr,
      duration_ms: Date.now() - startTime,
      stdout_truncated: false,
      stderr_truncated: false,
      timed_out: false,
      error: `Failed to spawn process: ${result.stderr}`,
    };
  }

  // Capture-present (T16): the spool's inline getters are AUTHORITATIVE —
  // the provider window still feeds the capture-less fallback below.
  if (captureRef.current) {
    const c = captureRef.current;
    return {
      success: !result.timedOut && result.exitCode === 0,
      exit_code: result.timedOut ? null : result.exitCode,
      stdout: c.getInlineStdout(),
      stderr: c.getInlineStderr(),
      duration_ms: Date.now() - startTime,
      stdout_truncated: c.getStdoutTruncated(),
      stderr_truncated: c.getStderrTruncated(),
      timed_out: result.timedOut,
      ...(toolResultRef ? { tool_result_ref: toolResultRef } : {}),
      ...(result.timedOut
        ? { error: `Command timed out after ${timeoutMs}ms` }
        : {}),
    };
  }
  const stdout = capChars(result.stdout, SHELL_STDOUT_MAX_CHARS);
  const stderr = capChars(result.stderr, SHELL_STDERR_MAX_CHARS);
  return {
    success: !result.timedOut && result.exitCode === 0,
    exit_code: result.timedOut ? null : result.exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    duration_ms: Date.now() - startTime,
    stdout_truncated: stdout.truncated,
    stderr_truncated: stderr.truncated,
    timed_out: result.timedOut,
    ...(result.timedOut
      ? { error: `Command timed out after ${timeoutMs}ms` }
      : {}),
  };
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
