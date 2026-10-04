import { describe, it, expect } from "vitest";
import {
  parseReplyJson,
  validateLlmRawResult,
  LlmTransportError,
  EmailReplyDraftGenerationService,
  type LlmRawResult,
  type AiChatApiFactory,
} from "@/service/emailReply/EmailReplyDraftGenerationService";
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
} from "@/api/aiChatApi";

/** Build a minimal non-streaming completion response for a content string. */
function completionResponse(
  content: string,
  finish_reason: string | null = "stop"
): OpenAIChatCompletionResponse {
  return {
    id: "test-id",
    object: "chat.completion",
    created: 1,
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason,
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    },
  };
}

/** Factory that returns canned responses in order, capturing the requests. */
function fakeApiFactory(
  responses: OpenAIChatCompletionResponse[]
): { factory: AiChatApiFactory; requests: OpenAIChatCompletionRequest[] } {
  const requests: OpenAIChatCompletionRequest[] = [];
  let i = 0;
  const factory: AiChatApiFactory = () => ({
    openAIChatCompletion: async (req) => {
      requests.push(req);
      const resp = responses[i++];
      if (!resp) {
        throw new Error("fakeApiFactory: no more canned responses");
      }
      return resp;
    },
  });
  return { factory, requests };
}

const validReplyJson = JSON.stringify({
  subject: "Re: Pricing",
  bodyText: "Thanks for asking — happy to help.",
  intentSuggestion: "interested",
  confidence: 0.8,
});

describe("validateLlmRawResult (FR-027)", () => {
  it("accepts a valid JSON reply with finish_reason stop", () => {
    const r = validateLlmRawResult({
      content: validReplyJson,
      finishReason: "stop",
      returnedModel: "test-model",
      usage: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.intentSuggestion).toBe("interested");
      expect(r.value.confidence).toBe(0.8);
    }
  });

  it("fails a length finish_reason as truncated_output even if JSON parses", () => {
    // Truncated mid-JSON: the content happens to parse, but the model hit the
    // token cap, so the output is incomplete and must never be persisted.
    const r = validateLlmRawResult({
      content: validReplyJson,
      finishReason: "length",
      returnedModel: "test-model",
      usage: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codes).toContain("truncated_output");
  });

  it("fails a content_filter finish_reason", () => {
    const r = validateLlmRawResult({
      content: "{}",
      finishReason: "content_filter",
      returnedModel: "test-model",
      usage: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codes).toContain("content_filtered");
  });

  it("fails a tool_calls finish_reason as unexpected_tool_call", () => {
    const r = validateLlmRawResult({
      content: "{}",
      finishReason: "tool_calls",
      returnedModel: "test-model",
      usage: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codes).toContain("unexpected_tool_call");
  });

  it("falls through to strict parse when finish_reason is missing", () => {
    // Some providers omit finish_reason entirely; the strict local parse is
    // authoritative in that case.
    const r = validateLlmRawResult({
      content: validReplyJson,
      finishReason: null,
      returnedModel: null,
      usage: null,
    });
    expect(r.ok).toBe(true);
  });

  it("fails malformed JSON twice via the two-strike path (codes-only)", () => {
    // Two malformed outputs → second validation fails with codes.
    const first = validateLlmRawResult({
      content: "{broken",
      finishReason: "stop",
      returnedModel: null,
      usage: null,
    });
    expect(first.ok).toBe(false);
    const second = validateLlmRawResult({
      content: "{also broken",
      finishReason: "stop",
      returnedModel: null,
      usage: null,
    });
    expect(second.ok).toBe(false);
  });
});

describe("callLlmRaw payload + transport-error classification (FR-027)", () => {
  it("sends max_tokens=1500 and response_format json_object", async () => {
    const { factory, requests } = fakeApiFactory([
      completionResponse(validReplyJson, "stop"),
    ]);
    // Use the service's internal callLlmRaw via a cast to access the private
    // method. The apiFactory seam determines what the call hits.
    const svc = new EmailReplyDraftGenerationService({ apiFactory: factory });
    const callLlmRaw = (svc as unknown as {
      callLlmRaw: (a: unknown, b: unknown) => Promise<LlmRawResult>;
    }).callLlmRaw.bind(svc);
    const result = await callLlmRaw(
      { role: "system", content: "sys" },
      { role: "user", content: "u" }
    );
    expect(result.content).toBe(validReplyJson);
    expect(result.finishReason).toBe("stop");
    expect(result.returnedModel).toBe("test-model");
    expect(result.usage?.total_tokens).toBe(30);
    expect(requests).toHaveLength(1);
    expect(requests[0].max_tokens).toBe(1500);
    expect(requests[0].response_format).toEqual({ type: "json_object" });
  });

  it("wraps a provider throw in LlmTransportError (not a validation strike)", async () => {
    const requests: OpenAIChatCompletionRequest[] = [];
    const factory: AiChatApiFactory = () => ({
      openAIChatCompletion: async (req) => {
        requests.push(req);
        throw new Error("network timeout");
      },
    });
    const svc = new EmailReplyDraftGenerationService({ apiFactory: factory });
    const callLlmRaw = (svc as unknown as {
      callLlmRaw: (a: unknown, b: unknown) => Promise<LlmRawResult>;
    }).callLlmRaw.bind(svc);
    await expect(
      callLlmRaw(
        { role: "system", content: "sys" },
        { role: "user", content: "u" }
      )
    ).rejects.toBeInstanceOf(LlmTransportError);
    // Exactly one provider call attempted — no silent retry, no strike consumed.
    expect(requests).toHaveLength(1);
  });
});

describe("parseReplyJson", () => {
  it("parses a clean JSON reply", () => {
    const r = parseReplyJson(
      JSON.stringify({
        subject: "Re: Pricing",
        bodyText: "Thanks for asking!",
        classification: "interested",
        confidence: 0.9,
      })
    );
    expect(r.subject).toBe("Re: Pricing");
    expect(r.bodyText).toBe("Thanks for asking!");
    expect(r.classification).toBe("interested");
    expect(r.confidence).toBe(0.9);
  });

  it("strips ```json code fences", () => {
    const r = parseReplyJson(
      '```json\n{"subject":"Re: Hi","bodyText":"hello","classification":"interested","confidence":0.8}\n```'
    );
    expect(r.subject).toBe("Re: Hi");
    expect(r.bodyText).toBe("hello");
  });

  it("tolerates stray text around the JSON object", () => {
    const r = parseReplyJson(
      'Here is your reply: {"subject":"Re:x","bodyText":"b","classification":"unknown","confidence":0.1} hope it helps'
    );
    expect(r.subject).toBe("Re:x");
    expect(r.bodyText).toBe("b");
  });

  it("returns empty body when no JSON is present (no raw-text fallback)", () => {
    const r = parseReplyJson("no json at all");
    expect(r.classification).toBe("unknown");
    expect(r.bodyText).toBe("");
    expect(r.confidence).toBe(0);
  });

  it("returns empty body when JSON is malformed", () => {
    const r = parseReplyJson("{not valid json}");
    expect(r.bodyText).toBe("");
    expect(r.classification).toBe("unknown");
  });
});
