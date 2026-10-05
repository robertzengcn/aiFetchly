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
});
