// src/service/hooks/hookExecutionClient.ts
// HOK-02 (Phase 17 / Plan 03) — main-side IPC client for the dedicated
// hook-execution worker. Forks the worker ONCE on the first command-hook
// dispatch (lazy long-lived singleton — Pitfall 1: one IPC round-trip per
// firing, not a fork) and correlates request/response by hookRunId.
//
// Non-fatal by construction (HOK-02 SC4): a worker timeout, abort, malformed
// hook-result, worker error, or missing response NEVER throws into the AI
// stream — the client synthesizes a warn-mode failure result so
// HookResultAggregator treats it as a hook error and the tool call proceeds
// (or is denied only if a DIFFERENT hook denies).
//
// The worker child is NOT killed on per-request timeout/abort (that would
// destroy the long-lived singleton); the request is abandoned and any late
// hook-result for that hookRunId is dropped (no pending waiter). A worker
// crash/exit abandons ALL pending requests and clears the singleton so the
// next execute() re-forks.
//
// Trust is decided in main BEFORE the execute-hook IPC is sent (HookDispatcher
// gates on HookCommandTrustService.isTrusted); this client never re-gates.

import { fork, type ChildProcess, type ForkOptions } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { resolvePackagedWorkerPath } from "@/utils/packagedWorkerPath";
import type {
  CommandHookDefinition,
  HookExecutionError,
  HookInput,
} from "@/entityTypes/hookTypes";
import { HOOK_LIMITS } from "@/entityTypes/hookTypes";
import type { HookSingleResult } from "@/service/hooks/HookResultAggregator";
import { validateHookOutput } from "@/service/hooks/HookOutputValidator";
import {
  workerEventSchema,
  type HookExecutionCommand,
} from "@/childprocess/hook-execution/workerProtocol";

/** Matches CommandHookExecutor's result shape (fed unchanged to the aggregator). */
export interface CommandHookExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly result: HookSingleResult;
}

export interface HookExecutionClientExecuteInput {
  readonly hook: CommandHookDefinition;
  readonly input: HookInput;
  readonly abortSignal?: AbortSignal;
}

/** fork function signature (matches child_process.fork). */
export type ForkFn = (
  modulePath: string,
  args: readonly string[],
  opts: ForkOptions
) => ChildProcess;

export interface HookExecutionClientOptions {
  /** Defaults to child_process.fork. Tests inject a stub. */
  readonly fork?: ForkFn;
  /** Bundled worker entry path. Defaults to {@link defaultHookWorkerEntry}. */
  readonly workerEntry?: string;
}

const WORKER_TYPE_MARKER = "hook-execution";
/** Grace period over the hook's own timeout before the client abandons. */
const CLIENT_TIMEOUT_GRACE_MS = 1000;

/**
 * Resolve the bundled hook-execution worker entry. Mirrors the watch worker
 * resolution (WorkspaceWatchManager.defaultWorkerEntry). The exact path is
 * verified at integration time; unit tests inject a mock fork so this default
 * is not exercised there.
 */
export function defaultHookWorkerEntry(): string {
  const electronProcess = process as NodeJS.Process & {
    resourcesPath?: string;
  };

  return (
    resolvePackagedWorkerPath(
      {
        dirname: __dirname,
        cwd: process.cwd(),
        resourcesPath: electronProcess.resourcesPath,
        existsSync: fs.existsSync,
      },
      {
        dirnameRelativePaths: [
          "HookExecutionWorker.js",
          path.join(
            "..",
            "..",
            "childprocess",
            "hook-execution",
            "HookExecutionWorker.js"
          ),
        ],
        cwdRelativePaths: [
          path.join(".vite", "build", "HookExecutionWorker.js"),
          path.join("dist", "HookExecutionWorker.js"),
          path.join(
            ".vite",
            "build",
            "childprocess",
            "hook-execution",
            "HookExecutionWorker.js"
          ),
        ],
      }
    ) ?? path.join(__dirname, "HookExecutionWorker.js")
  );
}

interface HookResultEvent {
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly error?: { readonly message: string; readonly timedOut?: boolean };
}

interface PendingRequest {
  readonly hook: CommandHookDefinition;
  readonly resolve: (result: CommandHookExecutionResult) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly onAbort: () => void;
  readonly abortSignal?: AbortSignal;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function failureResult(
  hook: CommandHookDefinition,
  message: string,
  durationMs: number,
  timedOut = false
): HookSingleResult {
  const error: HookExecutionError = {
    hookId: hook.id,
    source: hook.source,
    message,
    ...(timedOut ? { timedOut: true, durationMs } : {}),
  };
  return { hook, error, durationMs };
}

/**
 * Build a {@link CommandHookExecutionResult} from a worker hook-result event.
 * On execution error → failure result. On success → JSON.parse + validate the
 * stdout (the worker only captures raw output; content validation lives here,
 * where the hook object + aggregator live). Never throws.
 */
function buildResult(
  hook: CommandHookDefinition,
  event: HookResultEvent
): CommandHookExecutionResult {
  const { stdout, stderr, durationMs, error } = event;
  if (error) {
    return {
      stdout,
      stderr,
      durationMs,
      result: failureResult(hook, error.message, durationMs, error.timedOut === true),
    };
  }
  let parsed: unknown;
  try {
    parsed = stdout.length === 0 ? {} : JSON.parse(stdout);
  } catch (err) {
    return {
      stdout,
      stderr,
      durationMs,
      result: failureResult(
        hook,
        `Command hook stdout was not valid JSON: ${errorMessage(err)}`,
        durationMs
      ),
    };
  }
  const validation = validateHookOutput(parsed);
  if (!validation.valid) {
    return {
      stdout,
      stderr,
      durationMs,
      result: failureResult(hook, `Command hook output invalid: ${validation.error}`, durationMs),
    };
  }
  return {
    stdout,
    stderr,
    durationMs,
    result: { hook, output: validation.output, durationMs },
  };
}

export class HookExecutionClient {
  private readonly forkFn: ForkFn;
  private readonly workerEntry: string;
  private worker: ChildProcess | null = null;
  /** Number of times the worker was forked — exposed for the lazy-singleton test. */
  forkCount = 0;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(options: HookExecutionClientOptions = {}) {
    this.forkFn = options.fork ?? fork;
    this.workerEntry = options.workerEntry ?? defaultHookWorkerEntry();
  }

  private ensureWorker(): ChildProcess {
    if (this.worker) return this.worker;
    const worker = this.forkFn(this.workerEntry, [], {
      stdio: ["inherit", "inherit", "inherit", "ipc"],
      env: { ...process.env, WORKER_TYPE: WORKER_TYPE_MARKER },
    });
    this.forkCount += 1;
    worker.on("message", (raw: unknown) => this.handleMessage(raw));
    worker.on("error", () => this.failAll("hook-execution worker error"));
    worker.on("exit", () => {
      this.failAll("hook-execution worker exited");
      this.worker = null;
    });
    this.worker = worker;
    return worker;
  }

  private handleMessage(raw: unknown): void {
    const parsed = workerEventSchema.safeParse(raw);
    if (!parsed.success) {
      return; // malformed worker event — drop (non-fatal; waiter times out).
    }
    const event = parsed.data;
    if (event.type !== "hook-result") return;
    const pending = this.pending.get(event.hookRunId);
    if (!pending) return; // late or unknown hookRunId — drop.
    this.pending.delete(event.hookRunId);
    clearTimeout(pending.timer);
    pending.abortSignal?.removeEventListener("abort", pending.onAbort);
    pending.resolve(
      buildResult(pending.hook, {
        stdout: event.stdout,
        stderr: event.stderr,
        durationMs: event.durationMs,
        ...(event.error ? { error: event.error } : {}),
      })
    );
  }

  /**
   * Execute a command hook via the worker round-trip. Never throws — all
   * failure modes (timeout, abort, worker error, malformed result) resolve to
   * a non-fatal failure result.
   */
  async execute(
    input: HookExecutionClientExecuteInput
  ): Promise<CommandHookExecutionResult> {
    const { hook, input: hookInput, abortSignal } = input;
    const hookRunId = hookInput.hookRunId;

    if (abortSignal?.aborted) {
      return {
        stdout: "",
        stderr: "",
        durationMs: 0,
        result: failureResult(hook, "Command hook aborted before execution", 0),
      };
    }

    const worker = this.ensureWorker();

    const command: HookExecutionCommand = {
      type: "execute-hook",
      hookRunId,
      command: hook.command,
      ...(hook.cwd !== undefined ? { cwd: hook.cwd } : {}),
      ...(hook.envAllowlist !== undefined
        ? { envAllowlist: [...hook.envAllowlist] }
        : {}),
      ...(hook.timeoutMs !== undefined ? { timeoutMs: hook.timeoutMs } : {}),
      stdinPayload: JSON.stringify(hookInput),
    };

    const effectiveTimeout =
      (hook.timeoutMs ?? HOOK_LIMITS.defaultCommandTimeoutMs) +
      CLIENT_TIMEOUT_GRACE_MS;

    return new Promise<CommandHookExecutionResult>((resolve) => {
      const onAbort = () => {
        if (!this.pending.has(hookRunId)) return;
        this.pending.delete(hookRunId);
        clearTimeout(timer);
        resolve({
          stdout: "",
          stderr: "",
          durationMs: 0,
          result: failureResult(hook, "Command hook aborted", 0),
        });
      };

      const timer = setTimeout(() => {
        if (!this.pending.has(hookRunId)) return;
        this.pending.delete(hookRunId);
        abortSignal?.removeEventListener("abort", onAbort);
        resolve({
          stdout: "",
          stderr: "",
          durationMs: effectiveTimeout,
          result: failureResult(
            hook,
            `Command hook timed out after ${effectiveTimeout}ms (client)`,
            effectiveTimeout,
            true
          ),
        });
      }, effectiveTimeout);

      abortSignal?.addEventListener("abort", onAbort, { once: true });

      this.pending.set(hookRunId, { hook, resolve, timer, onAbort, abortSignal });

      try {
        worker.send(command);
      } catch (err) {
        if (this.pending.has(hookRunId)) {
          this.pending.delete(hookRunId);
          clearTimeout(timer);
          abortSignal?.removeEventListener("abort", onAbort);
        }
        resolve({
          stdout: "",
          stderr: "",
          durationMs: 0,
          result: failureResult(
            hook,
            `Failed to dispatch to hook worker: ${errorMessage(err)}`,
            0
          ),
        });
      }
    });
  }

  /** Abandon every pending request with a non-fatal failure (worker crash/exit). */
  private failAll(reason: string): void {
    for (const [hookRunId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.abortSignal?.removeEventListener("abort", pending.onAbort);
      this.pending.delete(hookRunId);
      pending.resolve({
        stdout: "",
        stderr: "",
        durationMs: 0,
        result: failureResult(pending.hook, reason, 0),
      });
      void hookRunId;
    }
  }

  /** Send shutdown + force-kill after a short timeout. */
  shutdown(): void {
    const worker = this.worker;
    if (!worker) return;
    try {
      worker.send({ type: "shutdown" } as HookExecutionCommand);
    } catch {
      // ignore — we force-kill below.
    }
    setTimeout(() => {
      try {
        worker.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 500);
    this.worker = null;
  }
}
