// src/childprocess/hook-execution/HookExecutionWorker.ts
// HOK-02 (Phase 17 / Plan 03) — fork entry for the dedicated hook-execution
// worker. Receives an `execute-hook` command, runs the command in a
// shell-disabled child via a worker-local spawn-core helper (adapted from the
// main-side command executor's spawn logic — NOT a whole import, and WITHOUT
// the main-process trust gate), and emits a `hook-result` event.
//
// WAT-02 (worker isolation): this module imports ONLY node stdlib
// (child_process) + the zod protocol + HOOK_LIMITS / DEFAULT_HOOK_ENV_KEYS
// constants. It imports NO database / ORM / Electron / main-process registry /
// model / main-side trust-service code (verified by the WAT-02 grep gate). The
// worker NEVER decides trust — main already gated the hook through the
// main-side trust service before dispatching the execute-hook IPC; the worker
// only executes what main already trusted. (A worker-side trust gate would be
// a separate instance whose trust flag is never set, so every hook would
// return untrusted — a dead path. See RESEARCH Execution-Boundary Decision.)
//
// Safety (inherited from the main-side command executor):
//   - shell:false always (no shell metachar expansion).
//   - env built from DEFAULT_HOOK_ENV_KEYS allowlist only; process.env is
//     never spread (Token secrets never injected).
//   - stdout/stderr capped at HOOK_LIMITS sizes; timeout SIGKILLs the child.
//   - Non-fatal: any error/timeout surfaces as a hook-result.error; the worker
//     itself never crashes the stream (HOK-02 SC4).

import { spawn } from "node:child_process";
import { DEFAULT_HOOK_ENV_KEYS, HOOK_LIMITS } from "@/entityTypes/hookTypes";
import {
  workerCommandSchema,
  type HookExecutionCommand,
} from "./workerProtocol";

const MAX_TIMEOUT = HOOK_LIMITS.maxCommandTimeoutMs;
const DEFAULT_TIMEOUT = HOOK_LIMITS.defaultCommandTimeoutMs;
const MAX_STDOUT = HOOK_LIMITS.maxCommandStdoutBytes;
const MAX_STDERR = HOOK_LIMITS.maxCommandStderrBytes;

// ---------------------------------------------------------------------------
// Worker-local spawn-core helper (adapted from the main-side command executor).
// Consumes the execute-hook IPC payload — NOT the {hook, input, abortSignal}
// shape the main-side executor consumes. Reuses spawn/timeout/caps
// verbatim-in-spirit; omits the trust gate (decided in main) and the
// single-result/output-validation (built main-side where the hook object +
// aggregator live).
// ---------------------------------------------------------------------------

export interface SpawnCoreInput {
  readonly command: string;
  readonly cwd?: string;
  readonly envAllowlist?: readonly string[];
  readonly timeoutMs?: number;
  readonly stdinPayload: string;
}

export interface SpawnCoreResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly error?: { readonly message: string; readonly timedOut?: boolean };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function buildEnv(allowlist?: readonly string[]): NodeJS.ProcessEnv {
  const keys =
    allowlist && allowlist.length > 0 ? allowlist : DEFAULT_HOOK_ENV_KEYS;
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
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("Command hook has empty command");
  }
  return trimmed.split(/\s+/);
}

function resolveTimeoutMs(raw?: number): number {
  const value = raw ?? DEFAULT_TIMEOUT;
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_TIMEOUT;
  if (value > MAX_TIMEOUT) return MAX_TIMEOUT;
  return Math.floor(value);
}

/**
 * Run a command string in a shell-disabled child, capturing stdout/stderr with
 * byte caps + timeout. Returns the raw execution result (no JSON validation —
 * the main-side client parses + validates stdout where the hook object lives).
 * Never throws — all failure modes surface as `error`.
 */
export function runCommandCore(
  input: SpawnCoreInput
): Promise<SpawnCoreResult> {
  const start = Date.now();

  let argv: string[];
  try {
    argv = parseCommand(input.command);
  } catch (err) {
    return Promise.resolve({
      stdout: "",
      stderr: "",
      durationMs: 0,
      error: { message: `invalid command: ${errorMessage(err)}` },
    });
  }

  const timeoutMs = resolveTimeoutMs(input.timeoutMs);
  const env = buildEnv(input.envAllowlist);

  return new Promise<SpawnCoreResult>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd: input.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });
    } catch (err) {
      resolve({
        stdout: "",
        stderr: "",
        durationMs: Date.now() - start,
        error: { message: `failed to spawn: ${errorMessage(err)}` },
      });
      return;
    }

    let stdoutBuf = "";
    let stderrBuf = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let capped = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBytes >= MAX_STDOUT) return;
      const slice = chunk.subarray(0, MAX_STDOUT - stdoutBytes);
      stdoutBuf += slice.toString("utf8");
      stdoutBytes += slice.length;
      if (stdoutBytes >= MAX_STDOUT) {
        capped = true;
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

    const finalize = (): SpawnCoreResult => {
      const durationMs = Date.now() - start;
      let error: SpawnCoreResult["error"];
      if (timedOut) {
        error = {
          message: `Command hook timed out after ${timeoutMs}ms`,
          timedOut: true,
        };
      } else if (capped) {
        error = {
          message: `Command hook exceeded stdout cap of ${MAX_STDOUT} bytes`,
        };
      }
      return { stdout: stdoutBuf, stderr: stderrBuf, durationMs, error };
    };

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Spawn-time error (e.g. ENOENT) — synthesize a failure.
      resolve({
        stdout: "",
        stderr: stderrBuf,
        durationMs: Date.now() - start,
        error: { message: `Failed to execute command: ${errorMessage(err)}` },
      });
    });

    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(finalize());
    });

    // Send the input JSON on stdin, then close stdin so the child sees EOF.
    try {
      child.stdin?.end(input.stdinPayload, "utf8");
    } catch {
      // If stdin write fails, fall through to the close handler.
    }
  });
}

// ---------------------------------------------------------------------------
// Fork entry lifecycle (mirrors WorkspaceConfigWatchWorker).
// ---------------------------------------------------------------------------

function emit(event: unknown): void {
  if (typeof process.send === "function") {
    process.send(event);
  }
}

function handleCommand(cmd: HookExecutionCommand): void {
  switch (cmd.type) {
    case "execute-hook": {
      runCommandCore({
        command: cmd.command,
        cwd: cmd.cwd,
        envAllowlist: cmd.envAllowlist,
        timeoutMs: cmd.timeoutMs,
        stdinPayload: cmd.stdinPayload,
      })
        .then((result) => {
          emit({
            type: "hook-result",
            hookRunId: cmd.hookRunId,
            stdout: result.stdout,
            stderr: result.stderr,
            durationMs: result.durationMs,
            ...(result.error ? { error: result.error } : {}),
          });
        })
        .catch((err) => {
          // runCommandCore never throws, but defense in depth: synthesize a
          // non-fatal hook-result error so the main-side waiter always resolves.
          emit({
            type: "hook-result",
            hookRunId: cmd.hookRunId,
            stdout: "",
            stderr: "",
            durationMs: 0,
            error: {
              message: `worker error: ${errorMessage(err)}`,
            },
          });
        });
      return;
    }
    case "shutdown": {
      // Graceful shutdown — the worker process exits.
      process.exit(0);
    }
  }
}

export function initializeWorker(): void {
  process.on("message", (raw: unknown) => {
    const parsed = workerCommandSchema.safeParse(raw);
    if (!parsed.success) {
      // Malformed inbound — drop with a warning; never crash the worker.
      // eslint-disable-next-line no-console
      console.warn(
        `[hook-execution-worker] dropped malformed command: ${parsed.error.message}`
      );
      return;
    }
    try {
      handleCommand(parsed.data);
    } catch (err) {
      // Defense in depth — handleCommand should not throw, but if it does,
      // keep the worker alive (the main-side waiter will time out + synthesize).
      // eslint-disable-next-line no-console
      console.warn(
        `[hook-execution-worker] handleCommand error: ${errorMessage(err)}`
      );
    }
  });

  process.on("uncaughtException", (error) => {
    const message = error.message || "uncaughtException";
    emit({
      type: "hook-result",
      hookRunId: "__unknown__",
      stdout: "",
      stderr: "",
      durationMs: 0,
      error: { message: `uncaughtException: ${message}` },
    });
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    emit({
      type: "hook-result",
      hookRunId: "__unknown__",
      stdout: "",
      stderr: "",
      durationMs: 0,
      error: { message: `unhandledRejection: ${message}` },
    });
    process.exit(1);
  });
}

// Worker bootstrap — mirrors the WorkspaceConfigWatchWorker pattern. The
// WORKER_TYPE env marker is set by the main process when forking.
if (require.main === module || process.env.WORKER_TYPE === "hook-execution") {
  initializeWorker();
}
