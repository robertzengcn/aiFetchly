/**
 * SupervisedStdioTransport — a custom MCP SDK `Transport` over the host's own
 * spawn (computer-use design §4.1).
 *
 * Kept in host code rather than the SDK's stock stdio transport:
 *  - owned-process registration (`spawnOwned`) for whole-tree supervision;
 *  - the shared MCP env allow/deny policy (mcpSpawnPolicy);
 *  - shell-free argv validation and caller-controlled cwd;
 *  - bounded message size on both directions;
 *  - bounded, redacted stderr.
 *
 * Stdout is decoded from byte buffers on newline boundaries so multi-byte
 * UTF-8 (CJK) split across chunk boundaries is never corrupted — the exact
 * bug the legacy client had.
 */
import { spawn, type ChildProcess } from "child_process";
import { TextDecoder } from "util";
import { log } from "@/modules/Logger";
import { spawnOwned } from "@/main-process/lifecycle/ownedSpawn";
import { redactString } from "@/modules/diagnostics/DiagnosticRedactor";
import {
  assertShellFreeArgv,
  buildSanitizedChildEnv,
} from "@/modules/mcp/mcpSpawnPolicy";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/** Launch parameters for a supervised stdio server. */
export interface SupervisedStdioTransportOptions {
  command: string;
  args?: readonly string[];
  env?: Record<string, string>;
  cwd?: string;
  /** Owned-process family id used by the shutdown reaper. */
  ownerId?: string;
  /** Maximum inbound JSON-RPC line length (bytes). */
  maxMessageBytes?: number;
  /** Maximum retained stderr bytes per session. */
  maxStderrBytes?: number;
  /** Grace period after stdin end before SIGTERM (ms). */
  gracefulCloseMs?: number;
  /** Hard-kill grace period after SIGTERM before SIGKILL (ms). */
  terminateCloseMs?: number;
}

const DEFAULTS = {
  maxMessageBytes: 8 * 1024 * 1024,
  maxStderrBytes: 64 * 1024,
  gracefulCloseMs: 1_500,
  terminateCloseMs: 3_000,
} as const;

/**
 * A JSON-RPC line that exceeds the inbound cap. Distinct class so callers can
 * classify protocol abuse vs transport death.
 */
export class McpMessageTooLargeError extends Error {
  constructor(readonly sizeBytes: number, readonly capBytes: number) {
    super(
      `MCP message of ${sizeBytes} bytes exceeds the ${capBytes}-byte transport cap.`
    );
    this.name = "McpMessageTooLargeError";
  }
}

export class SupervisedStdioTransport implements Transport {
  // --- Transport callbacks (installed by the SDK Client before start()) ---
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  sessionId?: string;

  private readonly options: Required<
    Omit<SupervisedStdioTransportOptions, "cwd" | "env" | "ownerId">
  > &
    Pick<SupervisedStdioTransportOptions, "cwd" | "env" | "ownerId">;

  private child: ChildProcess | null = null;
  /** Byte buffer of the partially-received line. */
  private stdoutBuffer: Buffer = Buffer.alloc(0);
  private stderrBytes = 0;
  private started = false;
  private closed = false;
  private closePromise: Promise<void> | null = null;
  /** Resolve hook for the exit wait inside close(). */
  private exitWaiters: Array<() => void> = [];

  constructor(options: SupervisedStdioTransportOptions) {
    this.options = {
      command: options.command,
      args: options.args ? [...options.args] : [],
      env: options.env,
      cwd: options.cwd,
      ownerId: options.ownerId ?? "mcp-server",
      maxMessageBytes: options.maxMessageBytes ?? DEFAULTS.maxMessageBytes,
      maxStderrBytes: options.maxStderrBytes ?? DEFAULTS.maxStderrBytes,
      gracefulCloseMs: options.gracefulCloseMs ?? DEFAULTS.gracefulCloseMs,
      terminateCloseMs:
        options.terminateCloseMs ?? DEFAULTS.terminateCloseMs,
    };
  }

  /** Spawn the server and begin processing stdout. */
  async start(): Promise<void> {
    if (this.closed) {
      throw new Error("Transport is closed and cannot be restarted.");
    }
    if (this.started) {
      throw new Error("Transport already started.");
    }
    assertShellFreeArgv(this.options.command, this.options.args);

    const child = spawnOwned(this.options.ownerId ?? "mcp-server", () =>
      spawn(this.options.command, this.options.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: buildSanitizedChildEnv(this.options.env),
        cwd: this.options.cwd,
        shell: false,
        windowsHide: true,
      })
    );
    this.child = child;
    this.started = true;

    // T04 (R9): the child's stdio streams can emit 'error' (e.g. EPIPE when
    // the peer exits mid-write) — an un-listened stream error becomes an
    // uncaught exception in the host process even when the write callback
    // is handled. Route them through the transport's error surface instead.
    child.stdin?.on("error", (error: Error) => {
      this.emitError(error);
    });
    child.stdout?.on("error", (error: Error) => {
      this.emitError(error);
    });
    child.stderr?.on("error", () => undefined);

    child.stdout?.on("data", (chunk: Buffer) => this.handleStdoutChunk(chunk));

    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrBytes += chunk.length;
      if (this.stderrBytes <= this.options.maxStderrBytes) {
        log.warn(
          `[mcp:${this.options.ownerId}] stderr: ${redactString(
            chunk.toString("utf8")
          )}`
        );
      } else if (this.stderrBytes - chunk.length < this.options.maxStderrBytes) {
        log.warn(
          `[mcp:${this.options.ownerId}] stderr cap reached; further output dropped.`
        );
      }
    });

    child.once("error", (error: Error) => {
      this.emitError(error);
      // A spawn failure (e.g. ENOENT) may never fire "exit"; close the
      // transport so the SDK rejects pending requests instead of hanging.
      this.finishClose();
    });

    child.once("exit", () => {
      this.finishClose();
    });

    if (!child.stdin || !child.stdout) {
      const error = new Error(
        "MCP stdio child did not expose piped stdio streams."
      );
      this.killChild();
      throw error;
    }
  }

  /**
   * Send a JSON-RPC message as one newline-terminated line. Rejects when the
   * serialized size exceeds the cap or the transport is already closed.
   */
  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.started || this.closed) {
      throw new Error("Transport is not open.");
    }
    const serialized = JSON.stringify(message) + "\n";
    const byteLength = Buffer.byteLength(serialized, "utf8");
    if (byteLength > this.options.maxMessageBytes) {
      throw new McpMessageTooLargeError(
        byteLength,
        this.options.maxMessageBytes
      );
    }
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) {
      throw new Error("MCP stdio child stdin is not writable.");
    }
    await new Promise<void>((resolve, reject) => {
      stdin.write(serialized, "utf8", (err) =>
        err ? reject(err) : resolve()
      );
    });
  }

  /**
   * Force close for stop-budget contexts (audit A19): SIGKILL the child
   * immediately and finish the close. The supervisor's forced-stop path
   * (≤1 s) uses this instead of waiting out the graceful escalation.
   */
  forceClose(): void {
    this.killChild();
    this.finishClose();
  }

  /**
   * Close the transport: drain stdin, wait briefly for a graceful exit, then
   * escalate to SIGTERM and SIGKILL. Idempotent; safe to call from the SDK's
   * close paths and from process supervision.
   */
  async close(): Promise<void> {
    if (this.closed) {
      await this.closePromise;
      return;
    }
    this.closed = true;
    this.closePromise = this.doClose();
    await this.closePromise;
  }

  private async doClose(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.finishClose();
      return;
    }

    // Graceful: end stdin and give the server a moment to exit by itself.
    try {
      child.stdin?.end();
    } catch {
      /* stream may already be destroyed */
    }

    const exited = await this.waitForExit(this.options.gracefulCloseMs);
    if (exited) return;

    try {
      child.kill("SIGTERM");
    } catch {
      /* already dead */
    }
    const terminated = await this.waitForExit(this.options.terminateCloseMs);
    if (terminated) return;

    this.killChild();
    await this.waitForExit(1_000);
    this.finishClose();
  }

  /** True when the child exited within `timeoutMs`. */
  private waitForExit(timeoutMs: number): Promise<boolean> {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        const index = this.exitWaiters.indexOf(done);
        if (index >= 0) this.exitWaiters.splice(index, 1);
        resolve(false);
      }, timeoutMs);
      const done = () => {
        clearTimeout(timer);
        resolve(true);
      };
      this.exitWaiters.push(done);
    });
  }

  /** Hard kill: SIGKILL the direct child; tree reaping is owned by the registry. */
  private killChild(): void {
    try {
      this.child?.kill("SIGKILL");
    } catch {
      /* already dead */
    }
  }

  /** Fire onclose exactly once and clear buffer state. */
  private finishClose(): void {
    if (this.closePromise) {
      // close() path: flush waiters, then notify.
    }
    for (const waiter of this.exitWaiters.splice(0)) {
      waiter();
    }
    this.stdoutBuffer = Buffer.alloc(0);
    const notify = this.onclose;
    this.onclose = undefined;
    this.onerror = undefined;
    this.onmessage = undefined;
    notify?.();
  }

  private emitError(error: Error): void {
    this.onerror?.(error);
  }

  /**
   * Buffer stdout bytes; decode complete lines only, with a streaming
   * TextDecoder so a UTF-8 sequence split across chunks is decoded once.
   */
  private handleStdoutChunk(chunk: Buffer): void {
    if (this.closed) return;
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);

    let newlineIndex = this.stdoutBuffer.indexOf(0x0a);
    while (newlineIndex >= 0) {
      const lineBytes = this.stdoutBuffer.subarray(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.subarray(newlineIndex + 1);
      this.handleLine(lineBytes);
      newlineIndex = this.stdoutBuffer.indexOf(0x0a);
    }

    if (this.stdoutBuffer.length > this.options.maxMessageBytes) {
      const error = new McpMessageTooLargeError(
        this.stdoutBuffer.length,
        this.options.maxMessageBytes
      );
      this.emitError(error);
      void this.close();
    }
  }

  private readonly utf8Decoder = new TextDecoder("utf-8");

  private handleLine(lineBytes: Buffer): void {
    if (lineBytes.length === 0) return;
    if (lineBytes.length > this.options.maxMessageBytes) {
      this.emitError(
        new McpMessageTooLargeError(
          lineBytes.length,
          this.options.maxMessageBytes
        )
      );
      return;
    }
    // Strip a trailing \r (CRLF servers) before JSON parsing.
    const trimmed =
      lineBytes[lineBytes.length - 1] === 0x0d
        ? lineBytes.subarray(0, -1)
        : lineBytes;
    const text = this.utf8Decoder.decode(trimmed, { stream: false });
    let message: JSONRPCMessage;
    try {
      message = JSON.parse(text) as JSONRPCMessage;
    } catch (error) {
      log.warn(
        `[mcp:${this.options.ownerId}] dropping unparseable line: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }
    try {
      this.onmessage?.(message);
    } catch (error) {
      // A throwing client handler must not kill the stream; surface it as a
      // transport error instead.
      this.emitError(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
}
