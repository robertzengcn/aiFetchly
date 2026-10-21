/**
 * AIChatSummarizeDispatch — the single budget-checked provider dispatch for
 * every compaction summarize callback (technical-design §8.3 / §8.5; audit P1).
 *
 * Builds the two-message summarize request, preflights the exact serialized
 * input against the model window (I + O + M <= C), and only then calls the
 * provider with max_tokens = sectionOutputCapTokens. Oversized input is
 * rejected locally as CONTEXT_REQUIRED_CONTENT_TOO_LARGE (recoverable) — the
 * coordinator's bounded retry loop treats it as a context rejection and
 * reduces capacity; the provider is never sent a request that cannot fit.
 *
 * Length truncation (provider signals `finish_reason === "length"`) is surfaced
 * as COMPACTION_OUTPUT_TRUNCATED rather than returned as a silently cut string.
 * Before this, a CJK-dense section summary truncated mid-string at the
 * provider output cap produced "Unterminated string in JSON at position 2571"
 * and the coordinator wasted all 4 bounded attempts on schema repair — the
 * repair prompt cannot fix truncation. The distinct code lets the coordinator
 * reduce input capacity (denser source → shorter summary → fits the cap)
 * instead of asking the model for "valid JSON".
 */

import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
} from "@/api/aiChatApi";
import { openAIContentToString } from "@/api/aiChatApi";
import { AIChatRequestBudgetService } from "@/service/AIChatRequestBudgetService";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";
import {
  RecoverableHistoryError,
} from "@/entityTypes/aiChatArchiveTypes";
import type { ModelLimitResolver } from "@/service/AIChatRequestBudgetService";

/** Input to the shared summarize dispatch. */
export interface SectionSummarizeDispatchInput {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  /** Requested model, forwarded to the provider when supplied. */
  readonly model?: string;
  /** The provider chat-completion call (injected for testability). */
  readonly completeChat: (
    request: OpenAIChatCompletionRequest
  ) => Promise<OpenAIChatCompletionResponse>;
  /** Optional deterministic limit resolver (tests); live catalog otherwise. */
  readonly modelLimitResolver?: ModelLimitResolver;
}

/**
 * Preflight + dispatch one compaction summarize request (§8.5): rejects
 * oversized input before the provider call and pins the explicit output cap.
 * Returns the raw provider content string. Throws COMPACTION_OUTPUT_TRUNCATED
 * when the provider signals the response was cut mid-generation by the output
 * cap (`finish_reason === "length"`).
 */
export async function dispatchSectionSummarize(
  input: SectionSummarizeDispatchInput
): Promise<string> {
  const messages = [
    { role: "system" as const, content: input.systemPrompt },
    { role: "user" as const, content: input.userPrompt },
  ];
  const budget = new AIChatRequestBudgetService();
  const preflight = budget.preflight({
    messages,
    model: input.model,
    outputReserve: AI_CHAT_RECOVERABLE_DEFAULTS.sectionOutputCapTokens,
    ...(input.modelLimitResolver
      ? { modelLimitResolver: input.modelLimitResolver }
      : {}),
  });
  if (!preflight.ok) {
    throw new RecoverableHistoryError(
      preflight.errorCode ?? "CONTEXT_REQUIRED_CONTENT_TOO_LARGE",
      preflight.reason ?? "compaction summarize request exceeds model context"
    );
  }
  const resp = await input.completeChat({
    // Send exactly the preflighted output reservation (capped by the model's
    // output limit, §8.1); oversized output is still rejected locally by the
    // coordinator, never blindly cut.
    max_tokens: preflight.outputReserve,
    messages,
    ...(input.model ? { model: input.model } : {}),
  });
  const choice = resp.choices?.[0];
  const finishReason = choice?.finish_reason;
  const content = openAIContentToString(choice?.message?.content);
  // Truncation is a distinct, recoverable failure: the provider stopped before
  // emitting a complete response. Surfacing it as a parse error (the prior
  // behavior) sent the coordinator's repair ladder down a schema-repair path
  // that can never fix truncation. Cover the three ways providers signal this:
  //  - "length": hit the max_tokens output cap mid-token (the common case).
  //  - "content_filter": content blocked mid-generation; the partial payload
  //    parses as invalid JSON and is unrecoverable by schema repair.
  //  - A present choice with null/undefined finish_reason and EMPTY content:
  //    some providers emit no finish_reason and no content on forced
  //    truncation. Treat the empty-content case as truncation (rather than a
  //    parse error) so it routes to the reduction path. This requires a
  //    present choice — a missing choices array is a different error class
  //    (malformed response), not truncation. Short-but-non-empty content
  //    (e.g. "{}") is a valid response and must NOT be flagged.
  const isTruncationSignal =
    finishReason === "length" ||
    finishReason === "content_filter" ||
    (!!choice && !finishReason && content.length === 0);
  if (isTruncationSignal) {
    throw new RecoverableHistoryError(
      "COMPACTION_OUTPUT_TRUNCATED",
      `summary truncated at provider output cap (max_tokens=${preflight.outputReserve}, finish_reason=${finishReason ?? "null"}); reduce input capacity so the summary fits`
    );
  }
  return content;
}
