/**
 * Cross-platform process execution provider contract.
 *
 * Source of truth: natural-language-skill-installation technical design §7,
 * PRD §16. Shell selection and process behavior must live behind platform
 * providers rather than scattered `process.platform` conditions.
 *
 * The observed Windows defect (design §3.2): commands could exit 0 while
 * captured stdout/stderr were empty, making installation verification
 * impossible. Providers therefore:
 *   - collect raw buffers + byte counts BEFORE decoding;
 *   - detect UTF-8 / UTF-16LE BOMs and decode deterministically;
 *   - wait for stream completion before producing a final result;
 *   - report spawn errors, stream errors, exit code, signal, timeout, and
 *     byte counts separately;
 *   - flag `PROCESS_OUTPUT_EMPTY_UNEXPECTED` when a command that was
 *     expected to emit output exits 0 with both byte counts zero.
 */

export type ProcessProviderKind = "windows" | "posix";

export interface ProcessInvocation {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly outputLimitBytes: number;
  /**
   * When true, a zero exit with both stdout and stderr byte counts at zero
   * produces `PROCESS_OUTPUT_EMPTY_UNEXPECTED` instead of a silent success.
   */
  readonly expectOutput?: boolean;
  /** Identifier used by cancellation registries; optional. */
  readonly cancellationId?: string;
}

export interface ProcessExecutionResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly provider: ProcessProviderKind;
  readonly diagnosticCode?: ProcessDiagnosticCode;
}

export type ProcessDiagnosticCode =
  | "PROCESS_SPAWN_FAILED"
  | "PROCESS_STREAM_ERROR"
  | "PROCESS_OUTPUT_EMPTY_UNEXPECTED"
  | "PROCESS_OUTPUT_TRUNCATED"
  | "PROCESS_TIMEOUT";

export interface PlatformProcessProvider {
  readonly kind: ProcessProviderKind;
  execute(invocation: ProcessInvocation): Promise<ProcessExecutionResult>;
}

// ---------------------------------------------------------------------------
// Shared buffer capture + decoding helpers (used by both providers)
// ---------------------------------------------------------------------------

/**
 * Decode captured bytes deterministically (design §7.3):
 *   1. UTF-8 BOM → utf-8 (strip BOM)
 *   2. UTF-16LE BOM → utf16le (strip BOM)
 *   3. Heuristic: a high proportion of NUL bytes → utf16le
 *   4. else utf-8
 */
export function decodeProcessOutput(buffer: Buffer): string {
  if (buffer.length === 0) return "";
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf-8");
  }
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 2) {
    // Heuristic for BOM-less UTF-16LE: every other byte is NUL for ASCII text.
    const sample = buffer.subarray(0, Math.min(buffer.length, 512));
    let nulls = 0;
    for (let i = 1; i < sample.length; i += 2) {
      if (sample[i] === 0) nulls += 1;
    }
    const pairs = Math.floor(sample.length / 2);
    if (pairs > 0 && nulls / pairs > 0.7) {
      return buffer.toString("utf16le");
    }
  }
  return buffer.toString("utf-8");
}

/** Normalize CRLF → LF without erasing other output. */
export function normalizeProcessLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** Build the environment for a child process from the current one, minus secrets. */
export const SENSITIVE_ENV_KEYS: ReadonlySet<string> = new Set([
  "AIFETCHLY_TOKEN",
  "AIFETCHLY_REFRESH_TOKEN",
  "ELEVENLABS_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "NPM_TOKEN",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
]);

/**
 * Environment baseline shared by every provider: start from the application
 * environment and REMOVE known-sensitive keys instead of applying a
 * Unix-centric allowlist (design §7.2 — the allowlist stripped required
 * Windows variables and is a suspected cause of empty Windows output).
 */
export function buildChildEnvironment(
  base: NodeJS.ProcessEnv = process.env,
  overrides?: Readonly<Record<string, string>>
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (SENSITIVE_ENV_KEYS.has(key.toUpperCase())) continue;
    env[key] = value;
  }
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      env[key] = value;
    }
  }
  return env;
}

// ---------------------------------------------------------------------------
// Shared capture core
// ---------------------------------------------------------------------------

import { spawn, type ChildProcess } from "child_process";

export interface ProcessRunnerConfig {
  readonly kind: ProcessProviderKind;
  /** Windows defaults to false unless a verified background design needs it. */
  readonly detached: boolean;
  /** Platform-appropriate process-tree termination. */
  killTree(child: ChildProcess): void;
}

class ByteCapture {
  private chunks: Buffer[] = [];
  private total = 0;
  truncated = false;

  push(chunk: Buffer, limit: number): void {
    if (this.truncated) return;
    this.total += chunk.length;
    this.chunks.push(chunk);
    if (this.total > limit) {
      // Keep only up to the limit.
      let kept = 0;
      const keptChunks: Buffer[] = [];
      for (const c of this.chunks) {
        if (kept + c.length > limit) {
          keptChunks.push(c.subarray(0, limit - kept));
          kept = limit;
          break;
        }
        keptChunks.push(c);
        kept += c.length;
      }
      this.chunks = keptChunks;
      this.total = kept;
      this.truncated = true;
    }
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }

  get bytes(): number {
    return this.total;
  }
}

/**
 * Spawn + capture with byte counts before decoding, separate streams,
 * timeout handling, and complete stream-drain before resolving
 * (design §7.3). Never turns non-empty bytes into an empty result.
 */
export async function runProcessCapture(
  invocation: ProcessInvocation,
  config: ProcessRunnerConfig
): Promise<ProcessExecutionResult> {
  const start = Date.now();
  const stdoutCapture = new ByteCapture();
  const stderrCapture = new ByteCapture();
  let spawnError: Error | null = null;
  let streamError: Error | null = null;
  let timedOut = false;
  let settled = false;

  return new Promise<ProcessExecutionResult>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(invocation.executable, [...invocation.args], {
        cwd: invocation.cwd,
        env: invocation.environment,
        shell: false,
        detached: config.detached,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        stdoutBytes: 0,
        stderrBytes: 0,
        timedOut: false,
        durationMs: Date.now() - start,
        provider: config.kind,
        diagnosticCode: "PROCESS_SPAWN_FAILED",
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      config.killTree(child);
      finish(child.exitCode, child.signalCode as NodeJS.Signals | null);
    }, invocation.timeoutMs);

    const finish = (
      code: number | null,
      signal: NodeJS.Signals | null
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdoutBytes = stdoutCapture.bytes;
      const stderrBytes = stderrCapture.bytes;
      const stdout = normalizeProcessLineEndings(
        decodeProcessOutput(stdoutCapture.toBuffer())
      );
      const stderr = normalizeProcessLineEndings(
        decodeProcessOutput(stderrCapture.toBuffer())
      );

      let diagnosticCode: ProcessDiagnosticCode | undefined;
      if (spawnError) diagnosticCode = "PROCESS_SPAWN_FAILED";
      else if (streamError) diagnosticCode = "PROCESS_STREAM_ERROR";
      else if (timedOut) diagnosticCode = "PROCESS_TIMEOUT";
      else if (stdoutCapture.truncated || stderrCapture.truncated)
        diagnosticCode = "PROCESS_OUTPUT_TRUNCATED";
      else if (
        invocation.expectOutput === true &&
        code === 0 &&
        stdoutBytes === 0 &&
        stderrBytes === 0
      ) {
        // A command that was expected to emit output exited zero with zero
        // bytes on both streams — never treat this as verified success
        // (design §7.3).
        diagnosticCode = "PROCESS_OUTPUT_EMPTY_UNEXPECTED";
      }

      resolve({
        exitCode: code,
        signal,
        stdout,
        stderr: spawnError ? `${stderr}${spawnError.message}`.trim() : stderr,
        stdoutBytes,
        stderrBytes,
        timedOut,
        durationMs: Date.now() - start,
        provider: config.kind,
        diagnosticCode,
      });
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutCapture.push(chunk, invocation.outputLimitBytes);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrCapture.push(chunk, invocation.outputLimitBytes);
    });
    // Stream errors must not silently discard captured bytes.
    child.stdout?.on("error", (err: Error) => {
      streamError = err;
    });
    child.stderr?.on("error", (err: Error) => {
      streamError = err;
    });

    child.on("error", (err: Error) => {
      spawnError = err;
      finish(null, null);
    });

    // Wait for BOTH stream closure and process exit so the final result is
    // produced only after all output has been captured.
    let stdoutClosed = false;
    let stderrClosed = false;
    let exited = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;

    const maybeFinish = (): void => {
      if (stdoutClosed && stderrClosed && exited && !settled) {
        finish(exitCode, exitSignal);
      }
    };
    child.stdout?.on("close", () => {
      stdoutClosed = true;
      maybeFinish();
    });
    child.stderr?.on("close", () => {
      stderrClosed = true;
      maybeFinish();
    });
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      exited = true;
      exitCode = code;
      exitSignal = signal;
      maybeFinish();
    });
  });
}
