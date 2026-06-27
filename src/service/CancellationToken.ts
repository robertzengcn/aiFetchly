/**
 * CancellationToken — a thin wrapper around AbortController that adds:
 *   - a typed {@link AbortReason} for distinguishing timeout vs. user cancel
 *   - optional {@link startTimer}/{@link clearTimer} for scheduling a timeout
 *   - {@link throwIfAborted} for cooperative cancellation checkpoints
 *
 * Intended to replace the leaky Promise.race pattern in AIChatQueryLoop so
 * that the underlying tool work can be cooperatively cancelled rather than
 * silently abandoned.
 */

/** Why the token was aborted. */
export type AbortReason = "timeout" | "cancel" | "user";

export class CancellationToken {
  private controller: AbortController;
  private timer: ReturnType<typeof setTimeout> | undefined;
  readonly timeoutMs: number;
  private _reason: AbortReason | null = null;

  constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
    this.controller = new AbortController();
  }

  /** The underlying AbortSignal. Pass this to fetch(), MCP calls, etc. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Why the token was aborted, or null if it has not been aborted. */
  get reason(): AbortReason | null {
    return this._reason;
  }

  /**
   * Abort the token with the given reason. No-op if already aborted so that
   * the first reason wins (e.g. a 'timeout' scheduled by startTimer is not
   * overwritten by a later 'cancel').
   */
  abort(reason: AbortReason): void {
    if (this.controller.signal.aborted) return;
    this._reason = reason;
    this.controller.abort(reason);
  }

  /**
   * Schedules an automatic abort('timeout') after {@link timeoutMs}.
   * Safe to call once; subsequent calls are no-ops. Always pair with
   * {@link clearTimer} in a finally block.
   */
  startTimer(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.abort("timeout"), this.timeoutMs);
  }

  /**
   * Cancels the scheduled timeout without aborting the token. Use after the
   * guarded work completes successfully so a late timeout does not fire.
   */
  clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Throws if the token has been aborted. Long-running code should call this
   * between steps to fail fast. The error message includes the abort reason.
   */
  throwIfAborted(): void {
    if (this.controller.signal.aborted) {
      throw new Error(`Operation aborted: ${this._reason ?? "unknown"}`);
    }
  }
}
