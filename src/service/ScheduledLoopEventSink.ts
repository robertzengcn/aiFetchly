import { isAiTaskCompletionPolicyV1Enabled } from "@/config/featureFlags";
import type {
  TaskCompletionController,
  DecideContext,
} from "@/service/aiTaskExecution/TaskCompletionController";
import type { TaskRunBudget } from "@/service/aiTaskExecution/TaskRunBudget";
import type {
  TaskCompletionDecision,
  TaskCompletionContract,
  TaskEndCandidate,
  TaskExecutionRoute,
} from "@/entityTypes/aiTaskExecutionTypes";
import type {
  AIChatQueryCompleteEvent,
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
    }
  // Unit 6 (GAP-S2 #8): policy-driven outcomes. `incomplete` carries the
  // controller's reason code + remaining work; `missing_outcome` is the
  // fail-closed result when the consult errored or the stream died without
  // a terminal event (AC-15/17: never fall back to success).
  | {
      readonly kind: "incomplete";
      readonly assistantMessageId?: string;
      readonly content: string;
      readonly reasonCode: string;
      readonly remainingWork: readonly string[];
    }
  | {
      readonly kind: "missing_outcome";
      readonly assistantMessageId?: string;
      readonly reasonCode: string;
    };

/**
 * Constructor-injected policy binding (Unit 6, GAP-S2 #8, D6/D5). Supplied
 * only by main-process code (the runner) — never renderer input. When
 * present AND the completion-policy flag is on, the sink consults the
 * controller on the `complete` event BEFORE the first-wins guard commits a
 * blind `completed` outcome (FR-05: the decision, not the transport event,
 * decides the outcome).
 */
export interface ScheduledLoopPolicyBinding {
  readonly executionId: string;
  readonly controller: TaskCompletionController;
  readonly budget?: TaskRunBudget;
  readonly contract?: TaskCompletionContract | null;
  readonly route: TaskExecutionRoute;
  readonly expectedVersion: number;
}

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
  private readonly policyBinding?: ScheduledLoopPolicyBinding;
  /**
   * Resolves when a terminal outcome is captured (or the run is force-failed
   * via {@link failOutstanding}). Stays pending across a permission pause so
   * the runner can await it instead of treating the pause-resolved
   * `submitMessage` as a silent `NO_TERMINAL_EVENT` failure (which would
   * unregister the engine before the user can grant/deny).
   */
  private readonly outcomePromise: Promise<ScheduledTurnOutcome>;
  private resolveOutcome!: (outcome: ScheduledTurnOutcome) => void;

  constructor(
    forwarder?: (event: AIChatQueryEvent) => void,
    policyBinding?: ScheduledLoopPolicyBinding
  ) {
    this.forwarder = forwarder;
    this.policyBinding = policyBinding;
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
        // Unit 6 (FR-05): when the policy binding is present and the flag is
        // on, the controller's decision — not the transport event — decides
        // the outcome. The consult is fire-and-forget: emit() stays sync,
        // and the commit happens when the decision resolves. Flag-off or no
        // binding keeps the blind mapping byte-identical to Slice 1.
        if (this.policyBinding && isAiTaskCompletionPolicyV1Enabled()) {
          this.consultPolicyOnComplete(event);
          return;
        }
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
   * Consult the completion controller on the `complete` event (FR-05, AC-17).
   * Forms a response_end candidate from the final assistant message and maps
   * the decision onto a ScheduledTurnOutcome:
   *   - verified_complete → kind "completed" (§6.1 mapping)
   *   - incomplete → kind "incomplete" (reasonCode + remainingWork)
   *   - failed / timeout → kind "failed"
   *   - needs_user_input / blocked_by_policy → kind "blocked" (FR-12 pause)
   *   - cancelled → kind "cancelled"
   *   - finish_response → kind "incomplete" RESPONSE_ENDED (the stream ended
   *     without the task's work being verified)
   *   - continue (defensive at response_end — the loop is gone; a
   *     continuation cannot be dispatched from the sink) → kind "incomplete"
   *     NO_PROGRESS
   * On a consult error the sink commits missing_outcome (NEVER success —
   * AC-15/17). Every commit path resolves the outstanding wait exactly once.
   */
  private consultPolicyOnComplete(event: AIChatQueryCompleteEvent): void {
    const binding = this.policyBinding;
    if (!binding) return;
    const assistantMessageId = event.messageId;
    // Fail-closed commit: a broken consult can never become a success
    // (AC-17) and must never throw out of the sync emit() path.
    const commitMissing = (): void => {
      this.commitOutcome({
        kind: "missing_outcome",
        assistantMessageId,
        reasonCode: "MISSING_TASK_OUTCOME",
      });
    };
    try {
      const candidate: TaskEndCandidate = {
        candidateId: `cand:${binding.executionId}:response_end`,
        executionId: binding.executionId,
        content: event.fullContent ?? "",
        finishReason: (event as { finishReason?: string | null }).finishReason ?? null,
        provenance: "provider",
        streamTerminalSeen: true,
        boundary: "response_end",
        pendingPermission: false,
        pendingQuestion: false,
        pendingPlanApproval: false,
        safetyRestriction: false,
      };
      const context: DecideContext = {
        route: binding.route,
        budget: binding.budget,
        contract: binding.contract ?? undefined,
      };
      // Promise.resolve() wraps the decide result so a controller that
      // returns undefined (or throws synchronously) fails closed via the
      // guards below instead of throwing `.then`-on-undefined out of emit().
      void Promise.resolve(binding.controller.decide(candidate, context))
        .then((decision: TaskCompletionDecision) => {
          if (!decision) {
            commitMissing();
            return;
          }
          const outcome = mapDecisionToOutcome(decision, assistantMessageId);
          if (!outcome) {
            commitMissing();
            return;
          }
          this.commitOutcome(outcome);
        })
        .catch(() => commitMissing());
    } catch {
      commitMissing();
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
   *
   * Unit 6 (AC-15/18): when the policy binding is present and the flag is on,
   * a stream that died without a terminal event commits missing_outcome with
   * STREAM_INCOMPLETE — never a verified/success outcome.
   */
  failOutstanding(errorMessage: string): void {
    if (this.policyBinding && isAiTaskCompletionPolicyV1Enabled()) {
      this.commitOutcome({
        kind: "missing_outcome",
        reasonCode: "STREAM_INCOMPLETE",
      });
      return;
    }
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

/**
 * Map a TaskCompletionDecision onto a ScheduledTurnOutcome (Unit 6, FR-05/12,
 * §6.1). Shared by the sink's consult path so the mapping stays in one place.
 */
export function mapDecisionToOutcome(
  decision: TaskCompletionDecision,
  assistantMessageId: string
): ScheduledTurnOutcome {
  switch (decision.type) {
    case "finish":
      switch (decision.outcome) {
        case "verified_complete":
          return {
            kind: "completed",
            assistantMessageId,
            content: decision.summary,
          };
        case "incomplete":
          return {
            kind: "incomplete",
            assistantMessageId,
            content: decision.summary,
            reasonCode: decision.reasonCode,
            remainingWork: decision.remainingWork,
          };
        case "needs_user_input":
        case "blocked_by_policy":
          return {
            kind: "blocked",
            assistantMessageId,
            reason: decision.reasonCode,
          };
        case "cancelled":
          return { kind: "cancelled", assistantMessageId, content: decision.summary };
        case "failed":
        case "timeout":
          return {
            kind: "failed",
            assistantMessageId,
            errorMessage: decision.summary,
          };
      }
      break;
    case "finish_response":
      return {
        kind: "incomplete",
        assistantMessageId,
        content: "",
        reasonCode: "RESPONSE_ENDED",
        remainingWork: [],
      };
    case "continue":
      // Defensive: at response_end the loop is already gone, so a
      // continuation cannot be dispatched from the sink. Honest outcome is
      // incomplete (NO_PROGRESS), never a success.
      return {
        kind: "incomplete",
        assistantMessageId,
        content: "",
        reasonCode: "NO_PROGRESS",
        remainingWork: decision.unmetCriterionIds,
      };
    case "wait":
      return {
        kind: "blocked",
        assistantMessageId,
        reason: decision.reason,
      };
    case "yield_owner":
      return {
        kind: "incomplete",
        assistantMessageId,
        content: "",
        reasonCode: "NO_PROGRESS",
        remainingWork: [],
      };
  }
}
