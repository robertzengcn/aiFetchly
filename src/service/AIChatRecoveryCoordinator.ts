// src/service/AIChatRecoveryCoordinator.ts
//
// Cross-layer orchestrator for the seven-layer recovery strategy
// (technical-design §9). Given a classified failure and the current
// per-turn recovery state, returns the next action the loop should
// perform. Pure: the loop executes side effects.
import {
  recordRecoveryAttempt,
  type AIChatRecoveryAttemptState,
  type AIChatRecoveryLayer,
  type AIChatRecoveryReason,
} from "@/service/AIChatRecoveryTypes";

export type RecoveryCoordinatorAction =
  | {
      readonly type: "escalate_output_tokens";
      readonly layer: "output_token_recovery";
      readonly maxTokens: number;
    }
  | {
      readonly type: "continue_output";
      readonly layer: "output_token_recovery";
      readonly continuationMessage: string;
    }
  | {
      readonly type: "drain_context";
      readonly layer: "context_collapse_drain";
    }
  | {
      readonly type: "reactive_compact";
      readonly layer: "reactive_compact";
    }
  | {
      readonly type: "fallback_model";
      readonly layer: "model_fallback";
      readonly fallbackModel: string;
    }
  | {
      readonly type: "persistent_retry";
      readonly layer: "persistent_retry";
      readonly delayMs: number;
    }
  | { readonly type: "fail" };

export interface RecoveryInput {
  readonly reason: AIChatRecoveryReason;
  readonly state: AIChatRecoveryAttemptState;
  readonly maxOutputTokensCap: number;
  readonly fallbackModel?: string;
  readonly modelMaxOutputTokens?: number;
  readonly persistentDelayMs?: number;
}

export interface RecoveryResult {
  readonly action: RecoveryCoordinatorAction;
  readonly updatedState: AIChatRecoveryAttemptState;
}

const OUTPUT_CONTINUATION_PROMPT =
  "Output token limit hit. Continue directly from the exact cutoff. Do not repeat text already produced. If you were calling a tool, restart the tool call from the beginning with all required arguments.";

const MAX_OUTPUT_CONTINUATIONS = 3;

/**
 * Coordinator for the seven-layer recovery strategy. Decides which
 * layer should run next based on the classified reason and per-turn
 * state. Updates the state immutably and records an attempt.
 */
export class AIChatRecoveryCoordinator {
  recover(input: RecoveryInput): RecoveryResult {
    const { reason, state, maxOutputTokensCap, fallbackModel } = input;

    // Layer 3: output token recovery (escalate then continue).
    if (reason === "output_limit") {
      // Stage 1: escalate once.
      if (!state.outputEscalationAttempted) {
        const escalated = Math.min(
          input.modelMaxOutputTokens ?? maxOutputTokensCap,
          maxOutputTokensCap
        );
        const nextState: AIChatRecoveryAttemptState = {
          ...state,
          outputEscalationAttempted: true,
          maxTokensOverride: escalated,
        };
        return {
          action: {
            type: "escalate_output_tokens",
            layer: "output_token_recovery",
            maxTokens: escalated,
          },
          updatedState: this.record(
            nextState,
            "output_token_recovery",
            reason
          ),
        };
      }
      // Stage 2: continuation up to MAX_OUTPUT_CONTINUATIONS times.
      if (state.outputContinuationCount < MAX_OUTPUT_CONTINUATIONS) {
        const nextCount = state.outputContinuationCount + 1;
        const nextState: AIChatRecoveryAttemptState = {
          ...state,
          outputContinuationCount: nextCount,
        };
        return {
          action: {
            type: "continue_output",
            layer: "output_token_recovery",
            continuationMessage: OUTPUT_CONTINUATION_PROMPT,
          },
          updatedState: this.record(
            nextState,
            "output_token_recovery",
            reason
          ),
        };
      }
      // Out of recovery options for output-limit.
      return {
        action: { type: "fail" },
        updatedState: state,
      };
    }

    // Layer 4/5: context overflow → drain then compact.
    if (reason === "context_overflow" || reason === "media_overflow") {
      if (!state.contextDrainAttempted) {
        const nextState: AIChatRecoveryAttemptState = {
          ...state,
          contextDrainAttempted: true,
        };
        return {
          action: {
            type: "drain_context",
            layer: "context_collapse_drain",
          },
          updatedState: this.record(
            nextState,
            "context_collapse_drain",
            reason
          ),
        };
      }
      if (!state.reactiveCompactAttempted) {
        const nextState: AIChatRecoveryAttemptState = {
          ...state,
          reactiveCompactAttempted: true,
        };
        return {
          action: {
            type: "reactive_compact",
            layer: "reactive_compact",
          },
          updatedState: this.record(
            nextState,
            "reactive_compact",
            reason
          ),
        };
      }
      return {
        action: { type: "fail" },
        updatedState: state,
      };
    }

    // Layer 6: model fallback (overload / model_unavailable).
    if (
      (reason === "overload" || reason === "model_unavailable") &&
      fallbackModel &&
      fallbackModel !== state.currentModel
    ) {
      const nextState: AIChatRecoveryAttemptState = {
        ...state,
        currentModel: fallbackModel,
      };
      return {
        action: {
          type: "fallback_model",
          layer: "model_fallback",
          fallbackModel,
        },
        updatedState: this.record(nextState, "model_fallback", reason),
      };
    }

    // Layer 7: persistent retry.
    if (reason === "rate_limit") {
      const delayMs = input.persistentDelayMs ?? 5_000;
      return {
        action: {
          type: "persistent_retry",
          layer: "persistent_retry",
          delayMs,
        },
        updatedState: this.record(state, "persistent_retry", reason),
      };
    }

    // Default: no recovery available.
    return {
      action: { type: "fail" },
      updatedState: state,
    };
  }

  private record(
    state: AIChatRecoveryAttemptState,
    layer: AIChatRecoveryLayer,
    reason: AIChatRecoveryReason
  ): AIChatRecoveryAttemptState {
    return recordRecoveryAttempt(state, {
      layer,
      reason,
      attempt: state.records.filter((r) => r.layer === layer).length + 1,
    });
  }
}
