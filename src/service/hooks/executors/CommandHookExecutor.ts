import { spawn } from "node:child_process";
import {
  CommandHookDefinition,
  DEFAULT_HOOK_ENV_KEYS,
  HookExecutionError,
  HookInput,
  HOOK_LIMITS,
} from "@/entityTypes/hookTypes";
import { validateHookOutput } from "../HookOutputValidator";
import { HookSingleResult } from "../HookResultAggregator";
import { HookCommandTrustService } from "../HookCommandTrustService";

/**
 * Runs a trusted local command as a hook. The command receives the
 * hook input as JSON on stdin and emits a hook output JSON on stdout.
 *
 * Safety:
 *  - Reject untrusted hooks. (`HookDefinition.trusted` AND the
 *    dynamic `HookCommandTrustService` must both be true.)
 *  - Never `shell: true`. The command is split with a minimal parser.
 *  - Environment is built from a small allowlist only. `process.env`
 *    is never spread; secrets from `Token` are never injected.
 *  - stdout/stderr are capped to HOOK_LIMITS sizes.
 *  - Timeout kills the child and records a timedOut error.
 *  - stdout that is not valid JSON is a hook error (never an allow).
 */

export interface CommandHookExecutionInput {
  readonly hook: CommandHookDefinition;
  readonly input: HookInput;
  readonly abortSignal?: AbortSignal;
}

export interface CommandHookExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly result: HookSingleResult;
}

const MAX_TIMEOUT = HOOK_LIMITS.maxCommandTimeoutMs;
const DEFAULT_TIMEOUT = HOOK_LIMITS.defaultCommandTimeoutMs;
const MAX_STDOUT = HOOK_LIMITS.maxCommandStdoutBytes;
const MAX_STDERR = HOOK_LIMITS.maxCommandStderrBytes;

function resolveTimeoutMs(hook: CommandHookDefinition): number {
  const raw = hook.timeoutMs ?? DEFAULT_TIMEOUT;
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TIMEOUT;
  if (raw > MAX_TIMEOUT) return MAX_TIMEOUT;
  return Math.floor(raw);
}

function buildEnv(allowlist?: readonly string[]): NodeJS.ProcessEnv {
  const keys = allowlist && allowlist.length > 0 ? allowlist : DEFAULT_HOOK_ENV_KEYS;
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

function parseCommand(command: string): string[] {
  // Minimal whitespace splitter. We do not invoke a shell; users who
  // need shell syntax must opt into a future explicit shell hook
  // type. This parser rejects empty commands.
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("Command hook has empty command");
  }
  return trimmed.split(/\s+/);
}

export async function executeCommand(
  args: CommandHookExecutionInput
): Promise<CommandHookExecutionResult> {
  const { hook, input, abortSignal } = args;
  const start = Date.now();

  // Trust gate.
  if (!hook.trusted || !HookCommandTrustService.isTrusted(hook.id)) {
    return {
      stdout: "",
      stderr: "",
      durationMs: Date.now() - start,
      result: untrustedResult(hook, start),
    };
  }

  // Reject if already aborted.
  if (abortSignal?.aborted) {
    return {
      stdout: "",
      stderr: "",
      durationMs: 0,
      result: abortedResult(hook),
    };
  }

  let argv: string[];
  try {
    argv = parseCommand(hook.command);
  } catch (err) {
    return {
      stdout: "",
      stderr: "",
      durationMs: Date.now() - start,
      result: failureResult(hook, errorMessage(err), start),
    };
  }

  const timeoutMs = resolveTimeoutMs(hook);
  const env = buildEnv(hook.envAllowlist);
  const stdinPayload = JSON.stringify(input);

  return await new Promise<CommandHookExecutionResult>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd: hook.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });
    } catch (err) {
      resolve({
        stdout: "",
        stderr: "",
        durationMs: Date.now() - start,
        result: failureResult(hook, `Failed to spawn: ${errorMessage(err)}`, start),
      });
      return;
    }

    let stdoutBuf = "";
    let stderrBuf = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, timeoutMs);

    const onAbort = () => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBytes >= MAX_STDOUT) return;
      const slice = chunk.subarray(0, MAX_STDOUT - stdoutBytes);
      stdoutBuf += slice.toString("utf8");
      stdoutBytes += slice.length;
      if (stdoutBytes >= MAX_STDOUT) {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes >= MAX_STDERR) return;
      const slice = chunk.subarray(0, MAX_STDERR - stderrBytes);
      stderrBuf += slice.toString("utf8");
      stderrBytes += slice.length;
    });

    const finalize = (resultHook: CommandHookDefinition): CommandHookExecutionResult => {
      const durationMs = Date.now() - start;
      const result: HookSingleResult = (() => {
        if (timedOut) {
          return {
            hook: resultHook,
            durationMs,
            error: {
              hookId: resultHook.id,
              source: resultHook.source,
              message: `Command hook timed out after ${timeoutMs}ms`,
              timedOut: true,
              durationMs,
            },
          };
        }
        if (abortSignal?.aborted) {
          return abortedResult(resultHook, durationMs);
        }
        if (stdoutBytes >= MAX_STDOUT) {
          return failureResult(
            resultHook,
            `Command hook exceeded stdout cap of ${MAX_STDOUT} bytes`,
            start
          );
        }
        // Parse stdout as JSON.
        let parsed: unknown;
        try {
          parsed = stdoutBuf.length === 0 ? {} : JSON.parse(stdoutBuf);
        } catch (err) {
          return failureResult(
            resultHook,
            `Command hook stdout was not valid JSON: ${errorMessage(err)}`,
            start
          );
        }
        const validation = validateHookOutput(parsed);
        if (!validation.valid) {
          return failureResult(
            resultHook,
            `Command hook output invalid: ${validation.error}`,
            start
          );
        }
        return {
          hook: resultHook,
          output: validation.output,
          durationMs,
        };
      })();

      return { stdout: stdoutBuf, stderr: stderrBuf, durationMs, result };
    };

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
      // Spawn-time error (e.g. ENOENT) — synthesize a failure result.
      const result: HookSingleResult = {
        hook,
        durationMs: Date.now() - start,
        error: {
          hookId: hook.id,
          source: hook.source,
          message: `Failed to execute command: ${errorMessage(err)}`,
        },
      };
      resolve({ stdout: "", stderr: stderrBuf, durationMs: Date.now() - start, result });
    });

    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
      resolve(finalize(hook));
    });

    // Send input JSON on stdin, then close stdin so the child sees EOF.
    try {
      child.stdin?.end(stdinPayload, "utf8");
    } catch {
      // If stdin write fails, fall through to close handler.
    }
  });
}

function untrustedResult(hook: CommandHookDefinition, start: number): HookSingleResult {
  return failureResult(hook, "Command hook is not trusted", start);
}

function abortedResult(hook: CommandHookDefinition, durationMs = 0): HookSingleResult {
  return {
    hook,
    durationMs,
    error: {
      hookId: hook.id,
      source: hook.source,
      message: "Command hook aborted before execution",
    },
  };
}

function failureResult(
  hook: CommandHookDefinition,
  message: string,
  start: number
): HookSingleResult {
  const err: HookExecutionError = {
    hookId: hook.id,
    source: hook.source,
    message,
  };
  return { hook, error: err, durationMs: Date.now() - start };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
