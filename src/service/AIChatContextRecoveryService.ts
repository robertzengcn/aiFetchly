// src/service/AIChatContextRecoveryService.ts
//
// Layer 4 (reactive compact) + Layer 5 (context collapse drain) for the
// seven-layer recovery strategy. Operates on logical transcript groups
// so a tool_call and its matching tool result are never split apart
// when trimming.
import type { OpenAIChatMessage } from "@/api/aiChatApi";
import { AIChatTokenEstimator } from "@/service/AIChatTokenEstimator";
import type {
  AIChatRecoveryAttemptState,
  AIChatRecoveryReason,
} from "@/service/AIChatRecoveryTypes";

/** Policy for context-budget decisions. */
export interface AIChatContextBudgetPolicy {
  readonly contextWindowTokens: number;
  /** Soft threshold ratio (default 0.9). Collapse tool groups beyond this. */
  readonly softThresholdRatio: number;
  /** Hard threshold ratio (default 0.95). Force collapse + warn. */
  readonly hardThresholdRatio: number;
  /** Reserved output tokens when computing budget. */
  readonly reserveOutputTokens: number;
}

export const DEFAULT_CONTEXT_BUDGET_POLICY: AIChatContextBudgetPolicy = {
  contextWindowTokens: 128_000,
  softThresholdRatio: 0.9,
  hardThresholdRatio: 0.95,
  reserveOutputTokens: 4_096,
};

export type ContextRecoveryAction =
  | { readonly type: "drain"; readonly trimmedMessages: OpenAIChatMessage[] }
  | { readonly type: "compact"; readonly conversationId: string }
  | { readonly type: "fail"; readonly reason: AIChatRecoveryReason };

/**
 * A logical group of messages that must be kept together: an assistant
 * tool_call followed by its matching role=tool result rows.
 */
interface MessageGroup {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly tokens: number;
  readonly isToolGroup: boolean;
}

export interface RecoverOverflowInput {
  readonly conversationId: string;
  readonly messages: readonly OpenAIChatMessage[];
  readonly state: AIChatRecoveryAttemptState;
  readonly policy: AIChatContextBudgetPolicy;
  /** Current token estimate for the whole transcript. */
  readonly currentTokens: number;
  /** Target token budget after recovery (typically soft threshold). */
  readonly targetTokens?: number;
}

export interface RecoverOverflowResult {
  readonly action: ContextRecoveryAction;
  readonly updatedState: AIChatRecoveryAttemptState;
}

/**
 * Service for context-window recovery. Stateless aside from a token
 * estimator; safe to call concurrently.
 */
export class AIChatContextRecoveryService {
  private readonly estimator = new AIChatTokenEstimator();

  /**
   * Decide the next recovery action for a transcript that overflowed.
   *  1. If we haven't drained yet, try to drop old tool groups to reach
   *     the soft threshold.
   *  2. Else if we haven't reactively compacted, hand off to compact.
   *  3. Else fail with context_overflow.
   */
  recoverOverflow(input: RecoverOverflowInput): RecoverOverflowResult {
    const { state, policy, currentTokens, conversationId } = input;
    const target =
      input.targetTokens ??
      Math.floor(
        policy.contextWindowTokens * policy.softThresholdRatio
      ) - policy.reserveOutputTokens;

    if (!state.contextDrainAttempted && currentTokens > target) {
      const trimmed = this.drainTo(input.messages, target, policy);
      if (trimmed.length < input.messages.length) {
        return {
          action: { type: "drain", trimmedMessages: trimmed },
          updatedState: {
            ...state,
            contextDrainAttempted: true,
          },
        };
      }
      // Could not trim further; fall through to compact.
    }

    if (!state.reactiveCompactAttempted) {
      return {
        action: { type: "compact", conversationId },
        updatedState: {
          ...state,
          reactiveCompactAttempted: true,
        },
      };
    }

    return {
      action: { type: "fail", reason: "context_overflow" },
      updatedState: state,
    };
  }

  /**
   * Drop oldest tool-call groups until the transcript fits within
   * `targetTokens`, preserving the most recent window and never
   * splitting a tool group. Non-tool messages are preserved.
   */
  drainTo(
    messages: readonly OpenAIChatMessage[],
    targetTokens: number,
    policy: AIChatContextBudgetPolicy
  ): OpenAIChatMessage[] {
    const groups = this.buildGroups(messages);
    const hardBudget = Math.floor(
      policy.contextWindowTokens * policy.hardThresholdRatio
    );

    // Walk from the oldest groups forward; drop tool groups while we are
    // over budget. Never drop the last group (the live user turn).
    let dropped = 0;
    let working = messages.slice();
    for (let i = 0; i < groups.length - 1; i += 1) {
      const group = groups[i];
      if (!group.isToolGroup) continue;
      const remaining = working.slice(group.endIndex + 1 - dropped);
      const estimate = this.estimator.estimateMessages(remaining);
      if (estimate <= targetTokens || estimate <= hardBudget) {
        // Re-check: if we've hit the target, commit and return.
        if (this.estimator.estimateMessages(remaining) <= targetTokens) {
          return remaining;
        }
        // Otherwise keep going only if we're still over the soft target.
      }
      working = remaining;
      dropped += group.endIndex - group.startIndex + 1;
      if (this.estimator.estimateMessages(working) <= targetTokens) {
        return working;
      }
    }
    return working;
  }

  /**
   * Compute the soft-threshold token count for a policy.
   */
  softThreshold(policy: AIChatContextBudgetPolicy): number {
    return Math.floor(
      policy.contextWindowTokens * policy.softThresholdRatio
    );
  }

  /**
   * Compute the hard-threshold token count for a policy.
   */
  hardThreshold(policy: AIChatContextBudgetPolicy): number {
    return Math.floor(
      policy.contextWindowTokens * policy.hardThresholdRatio
    );
  }

  /**
   * Group consecutive messages into atomic units. A tool group is an
   * assistant message with tool_calls followed by role=tool messages
   * referencing those calls. Non-tool messages form singleton groups.
   */
  private buildGroups(messages: readonly OpenAIChatMessage[]): MessageGroup[] {
    const groups: MessageGroup[] = [];
    let i = 0;
    while (i < messages.length) {
      const msg = messages[i];
      const isAssistantToolCall =
        msg?.role === "assistant" &&
        Array.isArray(msg?.tool_calls) &&
        (msg?.tool_calls?.length ?? 0) > 0;
      if (isAssistantToolCall) {
        // Capture matching tool messages.
        const callIds = new Set(
          (msg?.tool_calls ?? []).map((c) => c.id)
        );
        let j = i + 1;
        while (
          j < messages.length &&
          messages[j]?.role === "tool" &&
          callIds.has(messages[j]?.tool_call_id ?? "")
        ) {
          j += 1;
        }
        const slice = messages.slice(i, j);
        groups.push({
          startIndex: i,
          endIndex: j - 1,
          tokens: this.estimator.estimateMessages(slice),
          isToolGroup: true,
        });
        i = j;
      } else {
        groups.push({
          startIndex: i,
          endIndex: i,
          tokens: this.estimator.estimateMessages([messages[i]!]),
          isToolGroup: false,
        });
        i += 1;
      }
    }
    return groups;
  }
}
