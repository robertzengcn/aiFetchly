/**
 * Unit tests for the shared compaction summarize dispatch helper
 * (technical-design §8.3 / §8.5, audit P1).
 *
 * Every compaction summarize callback (interactive providerSummarize,
 * scheduled factory, compact agent) must:
 * - preflight the exact serialized messages before the provider call
 *   (I + O + M <= C), rejecting oversized input locally;
 * - send max_tokens = the preflighted output reservation (model output cap),
 *   so oversized output is rejected locally, never blindly cut;
 * - forward the requested model when supplied.
 */
import { describe, it, expect, vi } from "vitest";
import {
  dispatchSectionSummarize,
  type SectionSummarizeDispatchInput,
} from "@/service/AIChatSummarizeDispatch";
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
} from "@/api/aiChatApi";

function okResponse(content: string): OpenAIChatCompletionResponse {
  return {
    choices: [{ message: { role: "assistant", content }, index: 0 }],
  } as OpenAIChatCompletionResponse;
}

/** Response whose content was cut mid-generation by the model's output cap. */
function lengthTruncatedResponse(content: string): OpenAIChatCompletionResponse {
  return {
    id: "resp-trunc",
    object: "chat.completion",
    created: 0,
    model: "tiny-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        // Provider signals the output cap stopped generation before a complete
        // token — exactly the failure mode that produces "Unterminated string
        // in JSON at position 2571" in the production log.
        finish_reason: "length",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  } as OpenAIChatCompletionResponse;
}

function baseInput(
  overrides?: Partial<SectionSummarizeDispatchInput>
): SectionSummarizeDispatchInput {
  return {
    systemPrompt: "sys",
    userPrompt: "summarize this",
    model: "tiny-model",
    completeChat: vi.fn(async () => okResponse("{}")),
    modelLimitResolver: () => ({
      contextLimit: 8_192,
      outputLimit: 1_024,
      limitSource: "fallback",
    }),
    ...overrides,
  };
}

describe("AIChatSummarizeDispatch", () => {
  it("dispatches with the exact section output cap and requested model", async () => {
    const requests: OpenAIChatCompletionRequest[] = [];
    const completeChat = vi.fn(async (request: OpenAIChatCompletionRequest) => {
      requests.push(request);
      return okResponse("{}");
    });
    await dispatchSectionSummarize(baseInput({ completeChat }));
    expect(requests).toHaveLength(1);
    const req = requests[0];
    expect(req.max_tokens).toBe(1_024);
    expect(req.model).toBe("tiny-model");
    expect(req.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "summarize this" },
    ]);
  });

  it("rejects an oversized prompt before the provider call (§8.5)", async () => {
    // Fallback window is 8,192 tokens with 10% margin and 1,024 output cap;
    // ~40,000 ASCII chars ≈ 10,000 tokens of input must be rejected locally.
    const completeChat = vi.fn(async () => okResponse("{}"));
    await expect(
      dispatchSectionSummarize(
        baseInput({
          userPrompt: "x".repeat(40_000),
          completeChat,
        })
      )
    ).rejects.toMatchObject({ code: "CONTEXT_REQUIRED_CONTENT_TOO_LARGE" });
    expect(completeChat).not.toHaveBeenCalled();
  });

  it("preflight uses the effective output cap (min(reserve, model output limit))", async () => {
    // Output reserve 1,500 capped by model outputLimit 1,024 → usable
    // capacity U = 8,192 - 1,024 - 820 = 6,348 tokens.
    const completeChat = vi.fn(async () => okResponse("{}"));
    // 7,000 chars ≈ 1,750 tokens — fits.
    await expect(
      dispatchSectionSummarize(
        baseInput({ userPrompt: "y".repeat(7_000), completeChat })
      )
    ).resolves.toBe("{}");
    expect(completeChat).toHaveBeenCalledTimes(1);
  });

  // Regression: a section summary whose JSON was truncated mid-string by the
  // model's output cap produced "Unterminated string in JSON at position 2571"
  // and the coordinator wasted all 4 bounded attempts asking for "valid JSON"
  // (schema repair) instead of recognizing length truncation. The provider
  // signals this case with finish_reason === "length"; the dispatch MUST surface
  // it as a distinct recoverable error so the coordinator can act on the real
  // cause (output cap) rather than a phantom schema problem.
  it("surfaces COMPACTION_OUTPUT_TRUNCATED when the provider signals finish_reason=length", async () => {
    const completeChat = vi.fn(async () =>
      lengthTruncatedResponse('{"version":1,"synopsis":"truncated mid-string...')
    );
    await expect(
      dispatchSectionSummarize(baseInput({ completeChat }))
    ).rejects.toMatchObject({
      code: "COMPACTION_OUTPUT_TRUNCATED",
    });
  });

  it("does not treat a normal stop completion as truncation", async () => {
    // finish_reason === "stop" with valid JSON must resolve normally even
    // though the content is short — truncation detection keys off the
    // provider's finish signal, not the content length.
    const completeChat = vi.fn(async () => okResponse('{"version":1}'));
    await expect(
      dispatchSectionSummarize(baseInput({ completeChat }))
    ).resolves.toBe('{"version":1}');
  });

  it("uses the injected model-limit resolver to cap max_tokens (not the 1024 fallback)", async () => {
    // The production bug: call sites omitted modelLimitResolver, so the budget
    // service used UNKNOWN_MODEL_FALLBACK_LIMITS (outputLimit 1,024) and capped
    // the 1,500-token section reserve to 1,024 — too small for CJK-dense
    // summaries. With a real resolver reporting a 16,384 output limit, the
    // cap is the 1,500-token reserve itself.
    const requests: OpenAIChatCompletionRequest[] = [];
    const completeChat = vi.fn(async (request: OpenAIChatCompletionRequest) => {
      requests.push(request);
      return okResponse("{}");
    });
    await dispatchSectionSummarize(
      baseInput({
        completeChat,
        modelLimitResolver: () => ({
          contextLimit: 128_000,
          outputLimit: 16_384,
          limitSource: "provider",
        }),
      })
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].max_tokens).toBe(1_500);
  });
});
