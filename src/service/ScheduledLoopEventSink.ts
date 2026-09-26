import type {
  AIChatQueryEvent,
  AIChatQueryEventSink,
} from "@/service/AIChatQueryEvents";

/** Terminal outcome the runner derives from the engine event stream. */
export type ScheduledTurnOutcome =
  | {
      readonly kind: "completed";
      readonly assistantMessageId: string;
      readonly content: string;
      readonly model?: string;
      readonly totalTokens?: number;
    }
  | {
      readonly kind: "cancelled";
      readonly assistantMessageId?: string;
      readonly content: string;
    }
  | {
      readonly kind: "failed";
      readonly assistantMessageId?: string;
      readonly errorMessage: string;
    }
  | {
      readonly kind: "blocked";
      readonly assistantMessageId?: string;
      readonly reason: string;
    };

/**
 * Event sink for scheduled-loop turns. Captures the terminal result data the
 * runner needs to finalize the run row, and intentionally does NOT forward
 * stream chunks to any renderer (design §13.2). Pause conditions
 * (plan_submitted / ask_user_question / plan_blocked_tool) are recorded so the
 * runner can pause the schedule with a clear reason (FR-16).
 */
export class ScheduledLoopEventSink implements AIChatQueryEventSink {
  private outcome: ScheduledTurnOutcome | null = null;
  private readonly forwarder?: (event: AIChatQueryEvent) => void;
  /**
   * Resolves when a terminal outcome is captured (or the run is force-failed
   * via {@link failOutstanding}). Stays pending across a permission pause so
   * the runner can await it instead of treating the pause-resolved
   * `submitMessage` as a silent `NO_TERMINAL_EVENT` failure (which would
   * unregister the engine before the user can grant/deny).
   */
  private readonly outcomePromise: Promise<ScheduledTurnOutcome>;
  private resolveOutcome!: (outcome: ScheduledTurnOutcome) => void;

  constructor(forwarder?: (event: AIChatQueryEvent) => void) {
    this.forwarder = forwarder;
    this.outcomePromise = new Promise<ScheduledTurnOutcome>((resolve) => {
      this.resolveOutcome = resolve;
    });
  }

  emit(event: AIChatQueryEvent): void {
    // Forward raw events (tokens, tool calls) for optional live streaming
    // BEFORE terminal capture so the last token is not lost.
    if (this.forwarder) {
      try {
        this.forwarder(event);
      } catch {
        /* forwarding failures must never affect the run */
      }
    }
    if (this.outcome) return; // terminal already recorded
    switch (event.type) {
      case "complete":
        this.commitOutcome({
          kind: "completed",
          assistantMessageId: event.messageId,
          content: event.fullContent,
          model: event.model,
          totalTokens: event.totalTokens,
        });
        break;
      case "cancelled":
        this.commitOutcome({
          kind: "cancelled",
          assistantMessageId: event.messageId,
          content: event.fullContent,
        });
        break;
      case "error":
        this.commitOutcome({
          kind: "failed",
          assistantMessageId: event.messageId,
          errorMessage: event.errorMessage,
        });
        break;
      case "plan_submitted":
        this.commitOutcome({
          kind: "blocked",
          assistantMessageId: event.messageId,
          reason: "BLOCKED_BY_POLICY",
        });
        break;
      case "ask_user_question":
        this.commitOutcome({
          kind: "blocked",
          assistantMessageId: event.messageId,
          reason: "BLOCKED_BY_POLICY",
        });
        break;
      case "plan_blocked_tool":
        this.commitOutcome({
          kind: "blocked",
          assistantMessageId: event.messageId,
          reason: "BLOCKED_BY_POLICY",
        });
        break;
      default:
        // Non-terminal events (token, tool_call, tool_progress, usage_update,
        // recovery_status, plan_state, retry_connect) are ignored — no
        // renderer to stream to in the scheduled path.
        break;
    }
  }

  /**
   * Record a terminal outcome and resolve the outstanding wait. Idempotent —
   * the first caller wins, subsequent calls are no-ops (mirrors the
   * `this.outcome` guard in {@link emit}).
   */
  private commitOutcome(outcome: ScheduledTurnOutcome): void {
    if (this.outcome) return;
    this.outcome = outcome;
    this.resolveOutcome(outcome);
  }

  /**
   * Force-resolve the terminal wait with a failure outcome (e.g. when the
   * permission backstop auto-deny could not resume the loop). The runner uses
   * this to unblock {@link waitForTerminalOutcome} without a real terminal
   * event. No-op when a terminal outcome was already captured.
   */
  failOutstanding(errorMessage: string): void {
    this.commitOutcome({ kind: "failed", errorMessage });
  }

  /** The captured terminal outcome, or null if the turn ended without one. */
  getOutcome(): ScheduledTurnOutcome | null {
    return this.outcome;
  }

  /**
   * Resolve when the sink captures a terminal outcome (or
   * {@link failOutstanding} is called). The runner awaits this when
   * `submitMessage` resolved without a terminal outcome because the turn
   * paused for permission — the resumed loop (grant/deny/backstop) later
   * emits the terminal event that resolves this promise.
   */
  waitForTerminalOutcome(): Promise<ScheduledTurnOutcome> {
    return this.outcomePromise;
  }
}
