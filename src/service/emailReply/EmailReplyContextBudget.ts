/**
 * G01/F06 input-context budgeting (FR-027, technical design §8.1).
 *
 * The output clamp narrows output allowance only. A large original /
 * conversation / retrieved input can still exceed a small model's context
 * window, so the input side is budgeted against the SELECTED model's context
 * window minus the reserved output allowance minus a safety margin:
 *
 *   inputBudget = contextWindow - reservedOutputTokens - SAFETY_MARGIN
 *
 * What is measured is the EXACT RENDERED prompt (system + user messages as
 * built by EmailReplyPromptBuilder), never pre-render estimates — so the
 * builder's own caps (2000-char body, 800-char snippets) and framing labels
 * are accounted for automatically, and no label is ever silently dropped to
 * make a budget fit. Truncation order drops only expendable context:
 * retrieved sources (least-relevant last) then conversation history (oldest
 * first). System/safety instructions, the original message, and the
 * caller's goal/tone/instructions are NEVER truncated; when even those
 * exceed the budget the caller refuses with a typed correlated audit
 * instead of sending a context-stripped prompt.
 *
 * Token estimation is a deliberately CONSERVATIVE heuristic, not a model
 * tokenizer: ASCII-heavy text ≈ 4 chars/token, non-ASCII (CJK, emoji)
 * ≈ 1.5 chars/token — the direction that over-admits nothing. Non-ASCII
 * counted per code point (surrogate pairs count once).
 */

export const CONTEXT_SAFETY_MARGIN_TOKENS = 512;

/**
 * F06: conservative unknown-model context window. Known models use their
 * provider-reported window (via the catalog resolver); models the provider
 * does not report get this bound — large enough for genuine reply work
 * (rendered prompts are typically 2–6k tokens), small enough that an
 * unknown small model cannot be overflowed silently. Documented here
 * rather than hidden: unknown ≠ unlimited.
 */
export const FALLBACK_CONTEXT_WINDOW_TOKENS = 32_768;

const ASCII_CHARS_PER_TOKEN = 4;
const NON_ASCII_CHARS_PER_TOKEN = 1.5;

/** Conservative token estimate for already-rendered text. */
export function estimateTokensConservative(
  text: string | null | undefined
): number {
  if (!text) return 0;
  let ascii = 0;
  let nonAscii = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 127) {
      ascii += 1;
    } else {
      nonAscii += 1;
    }
  }
  return Math.ceil(ascii / ASCII_CHARS_PER_TOKEN + nonAscii / NON_ASCII_CHARS_PER_TOKEN);
}

/** Estimated tokens across rendered message contents. */
export function renderedPromptTokens(contents: readonly (string | null | undefined)[]): number {
  let total = 0;
  for (const content of contents) {
    total += estimateTokensConservative(content);
  }
  return total;
}

/**
 * Input-token budget for the rendered prompt: the model's context window
 * minus the reserved output allowance minus the safety margin (correction
 * additions + estimator headroom). Never negative.
 */
export function inputTokenBudget(
  contextWindowTokens: number,
  reservedOutputTokens: number
): number {
  return Math.max(
    0,
    Math.floor(contextWindowTokens) -
      Math.floor(reservedOutputTokens) -
      CONTEXT_SAFETY_MARGIN_TOKENS
  );
}

export interface FittableSourceRef {
  readonly key: string;
  readonly name: string;
}

export interface FitRenderedPromptInput<T> {
  /** Exact rendered system/safety content (never truncated). */
  readonly systemContent: string;
  /** Retrieved sources, most-relevant first; dropped least-relevant-last. */
  readonly sources: readonly T[];
  readonly sourceKey: (source: T) => string;
  readonly sourceName: (source: T) => string;
  /** Rendered conversation section, or null when absent. */
  readonly conversationSection: string | null;
  /** Token budget for system + rendered user content. */
  readonly budgetTokens: number;
  /**
   * Render the user message for the given fitted inputs and return its
   * exact text (the production closure calls buildReplyUserMessage; tests
   * pass a synthetic renderer). Called once per fit round; pure and cheap.
   */
  readonly renderUserMessage: (
    sources: readonly T[],
    conversationSection: string | null
  ) => string;
}

export interface FitRenderedPromptResult<T> {
  readonly fittedSources: readonly T[];
  readonly fittedConversation: string | null;
  /** Dropped source keys (documentId:chunkId), in drop order. */
  readonly droppedSourceKeys: readonly string[];
  /** Bounded display names for warnings (first few dropped). */
  readonly droppedSourceNames: readonly string[];
  readonly conversationShortened: boolean;
  readonly promptTokens: number;
  readonly truncated: boolean;
}

/**
 * F06/F07: fit retrieved sources + conversation so the EXACT rendered
 * prompt fits the model budget. Drops whole sources least-relevant-last,
 * then shortens conversation oldest-first; system/original/extra content
 * (baked into every render) is never touched. Terminates: every round
 * strictly shrinks fitted content (bounded rounds as a backstop).
 * Returns fitted inputs + dropped identities for provenance; the caller
 * rebuilds the final message object from the fitted inputs and refuses
 * with a typed audit when even the fixed content exceeds the budget.
 */
export function fitRenderedPrompt<T>(
  input: FitRenderedPromptInput<T>
): FitRenderedPromptResult<T> {
  const systemTokens = estimateTokensConservative(input.systemContent);
  let fittedSources: readonly T[] = [...input.sources];
  let fittedConversation: string | null = input.conversationSection;
  const measure = () =>
    systemTokens +
    estimateTokensConservative(
      input.renderUserMessage(fittedSources, fittedConversation)
    );
  let promptTokens = measure();
  const droppedSourceKeys: string[] = [];
  const droppedSourceNames: string[] = [];
  let conversationShortened = false;
  let fitRounds = 0;
  while (
    promptTokens > input.budgetTokens &&
    fittedSources.length > 0 &&
    fitRounds < 500
  ) {
    const dropped = fittedSources[fittedSources.length - 1];
    if (dropped === undefined) break;
    fittedSources = fittedSources.slice(0, -1);
    droppedSourceKeys.push(input.sourceKey(dropped));
    if (droppedSourceNames.length < 5) {
      droppedSourceNames.push(input.sourceName(dropped));
    }
    promptTokens = measure();
    fitRounds += 1;
  }
  while (
    promptTokens > input.budgetTokens &&
    fittedConversation !== null &&
    fittedConversation.length > 0 &&
    fitRounds < 600
  ) {
    if (fittedConversation.length < 500) {
      fittedConversation = null;
    } else {
      fittedConversation = fittedConversation.slice(
        Math.floor(fittedConversation.length * 0.2)
      );
      conversationShortened = true;
    }
    promptTokens = measure();
    fitRounds += 1;
  }
  // Nulling a short conversation is still removed context — compare
  // against the original rather than only the explicit-shorten flag.
  const conversationTruncated =
    conversationShortened || fittedConversation !== input.conversationSection;
  return {
    fittedSources,
    fittedConversation,
    droppedSourceKeys,
    droppedSourceNames,
    conversationShortened: conversationTruncated,
    promptTokens,
    truncated: droppedSourceKeys.length > 0 || conversationTruncated,
  };
}
