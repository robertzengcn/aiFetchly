import type { ChildProcess } from "child_process";

const MAX_BACKGROUND_SHELL_OUTPUT_CHARS = 200_000; // ~200KB cap per stream
const COMPLETED_SHELL_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Lifecycle status of a detained background shell.
 *
 * - "running": spawned but the child process has not yet emitted 'close'.
 * - "completed": child exited with code 0.
 * - "failed": child exited with a non-zero code, or emitted an 'error' event.
 * - "killed": terminated explicitly via {@link BackgroundShellRegistry.kill}.
 */
export type BackgroundShellStatus =
  | "running"
  | "completed"
  | "failed"
  | "killed";

/**
 * Snapshot of a single detained background shell. Returned by
 * {@link BackgroundShellRegistry.poll}.
 *
 * Fields marked `readonly` are fixed at construction time. The mutable
 * fields (status, exitCode, stdout, stderr, endedAt) are updated by the
 * registry as the child process emits events.
 */
export interface BackgroundShellState {
  readonly shellId: string;
  readonly command: string;
  status: BackgroundShellStatus;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  readonly startedAt: number;
  endedAt: number | null;
  /**
   * Preserved-output reference, present when the shell was captured to an
   * artifact at detain time (T16). `poll()` surfaces this so the model can
   * `tool_result_read` the full stream rather than the bounded inline copy.
   */
  tool_result_ref?: {
    readonly output_id: string;
    readonly captured_bytes: number;
    readonly preservation: "complete" | "partial";
  };
}

/**
 * Metadata supplied when detaining a child process.
 */
export interface DetainMeta {
  /** The original command line, for audit/display purposes. */
  readonly command: string;
  /**
   * Optional preserved-output capture handle (T16). When supplied, the
   * registry's data handlers append to the SAME artifact sink instead of the
   * in-memory accumulators, so a backgrounded shell's full output still
   * reaches the bounded artifact store. The registry finalizes the artifact
   * when the child closes (or aborts on kill).
   */
  readonly capture?: {
    readonly appendStdout: (chunk: Buffer) => void;
    readonly appendStderr: (chunk: Buffer) => void;
    readonly finalize: () => Promise<unknown>;
    readonly abort: () => Promise<void>;
    readonly getInlineStdout: () => string;
    readonly getInlineStderr: () => string;
    readonly getStdoutTruncated: () => boolean;
    readonly getStderrTruncated: () => boolean;
  };
}

/**
 * Registry for detached child processes (e.g. shells whose timeout elapsed
 * while still producing useful output). The AI can later poll their status
 * via a `check_shell_status` tool (see Task 5.3).
 *
 * Design notes:
 * - The `close` handler only overwrites status when it is still "running",
 *   so {@link kill} setting status to "killed" wins even if the close event
 *   fires later.
 * - An `error` handler is registered defensively so an early spawn error
 *   still transitions the state to a terminal value.
 */
export class BackgroundShellRegistry {
  private readonly shells = new Map<string, BackgroundShellState>();
  private readonly children = new Map<string, ChildProcess>();
  private readonly captures = new Map<string, DetainMeta["capture"]>();

  /**
   * Remove completed/failed/killed shells that have been idle longer than
   * {@link COMPLETED_SHELL_TTL_MS}. Called on every detain() to amortize cost.
   */
  private sweepStale(): void {
    const now = Date.now();
    for (const [id, state] of this.shells) {
      if (
        state.status !== "running" &&
        state.endedAt !== null &&
        now - state.endedAt > COMPLETED_SHELL_TTL_MS
      ) {
        this.shells.delete(id);
      }
    }
  }

  detain(child: ChildProcess, meta: DetainMeta): string {
    this.sweepStale();
    const shellId = `sh_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const state: BackgroundShellState = {
      shellId,
      command: meta.command,
      status: "running",
      exitCode: null,
      stdout: "",
      stderr: "",
      startedAt: Date.now(),
      endedAt: null,
    };
    this.shells.set(shellId, state);
    this.children.set(shellId, child);
    const capture = meta.capture;
    if (capture) {
      this.captures.set(shellId, capture);
    }

    child.stdout?.on("data", (b: Buffer) => {
      if (capture) {
        // Spool to the SAME artifact sink the foreground path opened, so the
        // full backgrounded stream still reaches the bounded artifact store.
        capture.appendStdout(b);
        // Bound the inline preview per chunk (O(1) per chunk) rather than
        // re-reading the full inline buffer on every chunk (O(n²) over the
        // output size — a chatty backgrounded shell could freeze the main
        // process). The authoritative final snapshot is synced from the
        // capture on close below.
        if (state.stdout.length < MAX_BACKGROUND_SHELL_OUTPUT_CHARS) {
          state.stdout += b
            .toString("utf-8")
            .slice(0, MAX_BACKGROUND_SHELL_OUTPUT_CHARS - state.stdout.length);
        }
      } else if (state.stdout.length < MAX_BACKGROUND_SHELL_OUTPUT_CHARS) {
        state.stdout += b
          .toString("utf-8")
          .slice(0, MAX_BACKGROUND_SHELL_OUTPUT_CHARS - state.stdout.length);
      }
    });
    child.stderr?.on("data", (b: Buffer) => {
      if (capture) {
        capture.appendStderr(b);
        // Per-chunk bounded append (see stdout comment): never re-read the
        // full inline buffer per chunk.
        if (state.stderr.length < MAX_BACKGROUND_SHELL_OUTPUT_CHARS) {
          state.stderr += b
            .toString("utf-8")
            .slice(0, MAX_BACKGROUND_SHELL_OUTPUT_CHARS - state.stderr.length);
        }
      } else if (state.stderr.length < MAX_BACKGROUND_SHELL_OUTPUT_CHARS) {
        state.stderr += b
          .toString("utf-8")
          .slice(0, MAX_BACKGROUND_SHELL_OUTPUT_CHARS - state.stderr.length);
      }
    });
    child.on("close", (code: number | null) => {
      // Don't overwrite "killed" status if kill() already set it.
      if (state.status === "running") {
        state.exitCode = code;
        state.status = code === 0 ? "completed" : "failed";
        state.endedAt = Date.now();
      }
      this.children.delete(shellId);
      // T16: finalize the preserved artifact now that the child is done. The
      // ref is surfaced on the state so poll()/check_shell_status can point
      // the model at tool_result_read. Best-effort: a finalize failure still
      // leaves the terminal status above intact.
      const activeCapture = this.captures.get(shellId);
      if (activeCapture) {
        // Sync the inline preview ONCE on close from the authoritative capture
        // buffer, so poll() reflects the capture's final state rather than the
        // per-chunk appends (which cap early and never re-read). This replaces
        // the O(n²) per-chunk re-read the capture branch used to do.
        try {
          state.stdout = activeCapture
            .getInlineStdout()
            .slice(0, MAX_BACKGROUND_SHELL_OUTPUT_CHARS);
          state.stderr = activeCapture
            .getInlineStderr()
            .slice(0, MAX_BACKGROUND_SHELL_OUTPUT_CHARS);
        } catch {
          // Best-effort: the per-chunk preview remains if the sync throws.
        }
        activeCapture
          .finalize()
          .then((ref) => {
            if (ref && typeof ref === "object" && "output_id" in ref) {
              const r = ref as {
                output_id: string;
                captured_bytes: number;
                preservation: "complete" | "partial";
              };
              state.tool_result_ref = {
                output_id: r.output_id,
                captured_bytes: r.captured_bytes,
                preservation: r.preservation,
              };
            }
          })
          .catch(() => undefined)
          .finally(() => this.captures.delete(shellId));
      }
    });
    // Defensive: if the child errors before 'close', still record terminal state.
    child.on("error", () => {
      if (state.status === "running") {
        state.status = "failed";
        state.endedAt = Date.now();
      }
      this.children.delete(shellId);
      const errCapture = this.captures.get(shellId);
      if (errCapture) {
        errCapture.abort().catch(() => undefined).finally(() =>
          this.captures.delete(shellId)
        );
      }
    });

    return shellId;
  }

  /**
   * Return the current snapshot for the given shell_id, or undefined if no
   * such shell is registered.
   */
  poll(shellId: string): BackgroundShellState | undefined {
    return this.shells.get(shellId);
  }

  /**
   * Terminate a running background shell. After this call the shell's status
   * is "killed" regardless of any subsequent 'close' event.
   *
   * @returns true if the shell was found and a signal was sent.
   */
  kill(shellId: string): boolean {
    const child = this.children.get(shellId);
    const state = this.shells.get(shellId);
    if (!child || !state) return false;

    try {
      if (process.platform === "win32") {
        child.kill();
      } else if (child.pid !== undefined) {
        // Prefer killing the entire process group so children of the shell
        // are also terminated.
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    } catch {
      // Best-effort; the child may have already exited.
    }

    // Set killed status explicitly so the 'close' handler doesn't overwrite
    // it with "failed". The handler checks `state.status === "running"`.
    state.status = "killed";
    state.endedAt = Date.now();
    this.children.delete(shellId);
    // T16: abort the preserved-output capture so a killed shell does not leave
    // a half-written staging file or leaked quota. The close handler would
    // otherwise try to finalize a sink for a process we just killed.
    const killCapture = this.captures.get(shellId);
    if (killCapture) {
      killCapture.abort().catch(() => undefined).finally(() =>
        this.captures.delete(shellId)
      );
    }
    return true;
  }
}

let defaultRegistry: BackgroundShellRegistry | undefined;

/**
 * Return the process-wide singleton {@link BackgroundShellRegistry}.
 * Used by ShellToolService when it auto-backgrounds a timed-out command.
 */
export function getDefaultBackgroundShellRegistry(): BackgroundShellRegistry {
  if (!defaultRegistry) defaultRegistry = new BackgroundShellRegistry();
  return defaultRegistry;
}
