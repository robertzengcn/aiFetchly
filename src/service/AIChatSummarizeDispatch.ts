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
 * Returns the raw provider content string.
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
  return openAIContentToString(resp.choices?.[0]?.message?.content);
}
