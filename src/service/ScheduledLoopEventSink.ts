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

  emit(event: AIChatQueryEvent): void {
    if (this.outcome) return; // terminal already recorded
    switch (event.type) {
      case "complete":
        this.outcome = {
          kind: "completed",
          assistantMessageId: event.messageId,
          content: event.fullContent,
          model: event.model,
          totalTokens: event.totalTokens,
        };
        break;
      case "cancelled":
        this.outcome = {
          kind: "cancelled",
          assistantMessageId: event.messageId,
          content: event.fullContent,
        };
        break;
      case "error":
        this.outcome = {
          kind: "failed",
          assistantMessageId: event.messageId,
          errorMessage: event.errorMessage,
        };
        break;
      case "plan_submitted":
        this.outcome = {
          kind: "blocked",
          assistantMessageId: event.messageId,
          reason: "BLOCKED_BY_POLICY",
        };
        break;
      case "ask_user_question":
        this.outcome = {
          kind: "blocked",
          assistantMessageId: event.messageId,
          reason: "BLOCKED_BY_POLICY",
        };
        break;
      case "plan_blocked_tool":
        this.outcome = {
          kind: "blocked",
          assistantMessageId: event.messageId,
          reason: "BLOCKED_BY_POLICY",
        };
        break;
      default:
        // Non-terminal events (token, tool_call, tool_progress, usage_update,
        // recovery_status, plan_state, retry_connect) are ignored — no
        // renderer to stream to in the scheduled path.
        break;
    }
  }

  /** The captured terminal outcome, or null if the turn ended without one. */
  getOutcome(): ScheduledTurnOutcome | null {
    return this.outcome;
  }
}
