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
import { spawn, execFile, type ChildProcess } from "child_process";
import { promisify } from "util";
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
  /**
   * Trusted host-managed Node launch (plugin PRD §19.6). When present, the
   * transport spawns `executable` (process.execPath) with the entry file as
   * argv[0] and injects ELECTRON_RUN_AS_NODE=1 AFTER environment
   * sanitization — plugin-supplied values for that variable stay rejected
   * (mcpSpawnPolicy MCP_ENV_DENY_NAMES), and the injection cannot be
   * overridden because it is spread last. `command` is ignored in this mode;
   * it remains required by the interface for legacy callers.
   */
  trustedNodeLaunch?: TrustedNodeLaunch;
}

export interface TrustedNodeLaunch {
  /** Host executable (process.execPath) — never taken from plugin data. */
  readonly executable: string;
  /** Absolute, host-validated entry file inside the plugin install root. */
  readonly entryFile: string;
}

const DEFAULTS = {
  maxMessageBytes: 8 * 1024 * 1024,
  maxStderrBytes: 64 * 1024,
  gracefulCloseMs: 1_500,
  terminateCloseMs: 3_000,
} as const;

const execFileAsync = promisify(execFile);

/**
 * H5 (win32): kill a whole process tree via taskkill /T /F. Return value is
 * log-only — callers treat this as best-effort (the direct child SIGKILL
 * already went out).
 */
async function killWindowsTree(pid: number): Promise<void> {
  try {
    await execFileAsync("taskkill", ["/pid", String(pid), "/T", "/F"]);
  } catch (err) {
    // Exit 128 + "not found" = the tree is already gone; anything else is
    // still log-only here (the forced terminator owns verified tree death).
    log.warn(
      `[mcp tree-kill] taskkill /T /F for ${pid} failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

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
    Omit<
      SupervisedStdioTransportOptions,
      "cwd" | "env" | "ownerId" | "trustedNodeLaunch"
    >
  > &
    Pick<
      SupervisedStdioTransportOptions,
      "cwd" | "env" | "ownerId" | "trustedNodeLaunch"
    >;

  private child: ChildProcess | null = null;
  /**
   * H5: process-group id of the spawned child (detached: true → pgid ===
   * pid on POSIX). Non-null only when THIS transport created the group —
   * group signals are otherwise forbidden (registry §8 guard).
   */
  private processGroupId: number | null = null;
  /** Byte buffer of the partially-received line. */
  private stdoutBuffer: Buffer = Buffer.alloc(0);
  private stderrBytes = 0;
  private started = false;
  private closed = false;
  private closePromise: Promise<void> | null = null;
  /**
   * B07: exit confirmation for the LAST close attempt (null = close never
   * ran). True only when the close escalation OBSERVED the child exit;
   * a close that escalated all the way to SIGKILL without observing death
   * reports false so callers cannot claim cleanup success.
   */
  private exitConfirmed: boolean | null = null;
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
      trustedNodeLaunch: options.trustedNodeLaunch,
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

    // Environment assembly order (plugin PRD §19.6):
    //   1. sanitized allowlisted env + declaration extras (ELECTRON_* and
    //      friends from the DECLARATION are rejected inside the sanitizer);
    //   2. ELECTRON_RUN_AS_NODE=1 injected by trusted host code AFTER
    //      sanitization — only in the host-runtime branch, spread last so a
    //      plugin-supplied value can never win.
    const trusted = this.options.trustedNodeLaunch;
    const command = trusted ? trusted.executable : this.options.command;
    const argv = trusted
      ? [trusted.entryFile, ...this.options.args]
      : this.options.args;
    assertShellFreeArgv(command, argv);

    const sanitizedEnv = buildSanitizedChildEnv(this.options.env);
    const childEnv: NodeJS.ProcessEnv = trusted
      ? { ...sanitizedEnv, ELECTRON_RUN_AS_NODE: "1" }
      : sanitizedEnv;

    // H5: detached spawn puts the child in its own process group; the group
    // id is captured during launch() and read back by the registration
    // getter BELOW (spawnOwned registers after launch() returns).
    const groupRegistration: { isolatedProcessGroupId?: number } = {};
    const child = spawnOwned(
      this.options.ownerId ?? "mcp-server",
      () => {
        const c = spawn(command, argv, {
          stdio: ["pipe", "pipe", "pipe"],
          env: childEnv,
          cwd: this.options.cwd,
          shell: false,
          windowsHide: true,
          // H5 (PRD §11.8): the child leads its OWN process group
          // (pgid === pid on POSIX), so the escalation below can signal the
          // whole tree — the plugin's Playwright browser descendants are in
          // this group. On Windows the tree walk is taskkill /T (killChild).
          detached: true,
        });
        groupRegistration.isolatedProcessGroupId = c.pid ?? undefined;
        return c;
      },
      {
        get isolatedProcessGroupId() {
          return groupRegistration.isolatedProcessGroupId;
        },
      } as unknown as Parameters<typeof spawnOwned>[2]
    );
    this.processGroupId = child.pid ?? null;
    this.child = child;
    this.started = true;

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
      this.exitConfirmed = true;
      this.finishClose();
      return;
    }

    // Graceful: end stdin and give the server a moment to exit by itself.
    try {
      child.stdin?.end();
    } catch {
      /* stream may already be destroyed */
    }

    this.exitConfirmed = true;
    const exited = await this.waitForExit(this.options.gracefulCloseMs);
    if (exited) return;

    try {
      child.kill("SIGTERM");
    } catch {
      /* already dead */
    }
    const terminated = await this.waitForExit(this.options.terminateCloseMs);
    if (terminated) return;

    // B07: the hard-kill path is only "confirmed" when the final bounded
    // wait actually observes the exit; otherwise the caller must report
    // cleanup as pending instead of asserting the work stopped.
    this.killChild();
    this.exitConfirmed = await this.waitForExit(1_000);
    this.finishClose();
  }

  /** B07: did the last close OBSERVE the child exit? null before close. */
  exitConfirmation(): boolean | null {
    return this.exitConfirmed;
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

  /**
   * Hard kill (H5, PRD §11.8): the ENTIRE tree — the plugin child AND its
   * browser descendants — not only the MCP parent.
   *  - POSIX: the child is a detached process-group leader (pgid === pid),
   *    so a single group SIGKILL reaches every browser descendant.
   *  - Windows: `taskkill /PID <pid> /T /F` walks the tree; the group call
   *    is skipped there (pid alone is NOT a valid pgid on Windows).
   * The direct-child signals run too — group membership is best-effort and
   * the direct SIGKILL remains the authoritative kill for the leader.
   */
  private killChild(): void {
    try {
      this.child?.kill("SIGKILL");
    } catch {
      /* already dead */
    }
    const pgid = this.processGroupId;
    if (process.platform !== "win32" && pgid !== null) {
      try {
        // Group of which this transport is the sole creator (isolated at
        // spawn) — never signals a foreign group.
        process.kill(-pgid, "SIGKILL");
      } catch {
        /* group already reaped */
      }
    } else {
      const pid = this.child?.pid;
      if (process.platform === "win32" && typeof pid === "number") {
        // Fire-and-forget tree walk; results are log-only.
        void killWindowsTree(pid);
      }
    }
    this.processGroupId = null;
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
