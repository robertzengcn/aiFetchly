/**
 * G01/FR-027: input-context budgeting (technical design §8.1).
 *
 * The output clamp (`effectiveReplyMaxTokens`) narrows output allowance only.
 * A large original/conversation/retrieved input can still exceed a small
 * model's context window. This helper estimates prompt tokens (chars/4, a
 * conservative upper bound for English prose) and truncates the LEAST
 * critical input first — retrieved knowledge sources (oldest/last first),
 * then conversation history — while NEVER truncating the system/safety
 * instructions or the original message (safety instructions are silently
 * dropped if truncated, which the PRD forbids).
 *
 * Conservative default budget: 6000 input tokens (≈24k chars). Providers with
 * larger windows simply use less than their max; small models stay safe.
 * Callers record a `context_truncated` warning when truncation occurs so the
 * draft's provenance shows the model did not see the full retrieval set.
 */

export const MAX_INPUT_TOKENS = 6000;
export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface ContextBudgetInput {
  systemText: string;
  originalText: string;
  conversationText: string | null;
  knowledgeTexts: string[];
  extraText: string | null;
}

/** Truncate knowledge + conversation to fit the budget. System/original/extra never truncated. */
export function fitInputToBudget(input: ContextBudgetInput): {
  conversationText: string | null;
  knowledgeTexts: string[];
  truncated: boolean;
  estimatedTokens: number;
} {
  let knowledgeTexts = [...input.knowledgeTexts];
  let conversationText = input.conversationText;
  const fixedTokens =
    estimateTokens(input.systemText) +
    estimateTokens(input.originalText) +
    estimateTokens(input.extraText);

  const totalOf = (conv: string | null, kn: string[]): number =>
    fixedTokens + estimateTokens(conv) + kn.reduce((s, t) => s + estimateTokens(t), 0);

  let truncated = false;
  // Drop retrieved sources from the END (least relevant last) until fit.
  while (knowledgeTexts.length > 0 && totalOf(conversationText, knowledgeTexts) > MAX_INPUT_TOKENS) {
    knowledgeTexts = knowledgeTexts.slice(0, -1);
    truncated = true;
  }
  // Then truncate conversation history from the FRONT (oldest first), keeping
  // the most recent 50% at minimum before giving up (fail-closed: caller
  // refuses rather than sending a context-stripped prompt silently — the
  // warning forces human review).
  while (
    conversationText &&
    conversationText.length > 0 &&
    totalOf(conversationText, knowledgeTexts) > MAX_INPUT_TOKENS
  ) {
    const cut = Math.floor(conversationText.length * 0.2);
    if (cut <= 0) break;
    conversationText = conversationText.slice(cut);
    truncated = true;
    if (conversationText.length < 500) {
      conversationText = null;
      break;
    }
  }
  return {
    conversationText,
    knowledgeTexts,
    truncated,
    estimatedTokens: totalOf(conversationText, knowledgeTexts),
  };
}

/** True when even the fixed (system + original + extra) prompt exceeds budget — caller must refuse. */
export function fixedPromptExceedsBudget(input: ContextBudgetInput): boolean {
  const fixedTokens =
    estimateTokens(input.systemText) +
    estimateTokens(input.originalText) +
    estimateTokens(input.extraText);
  return fixedTokens > MAX_INPUT_TOKENS;
}
