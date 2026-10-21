import { describe, it, expect } from "vitest";
import type { OpenAIChatCompletionRequest } from "@/api/aiChatApi";
import {
  buildNonStreamingPayload,
  buildStreamingPayload,
} from "@/service/aiProvider/OpenAIRequestPayload";

/**
 * FR-026: the OpenAI-compatible request type must accept `response_format`
 * and both payload builders (non-streaming + streaming) must forward it so
 * the strict-reply generation path can ask the provider for JSON-only output.
 *
 * The hosted AiChatApi client forwards `response_format` too; that path is
 * covered by the regression suite's request-shape snapshot tests. Here we
 * assert the pure-data layer that both hosted and local clients share.
 */
describe("response_format plumbing (FR-026)", () => {
  it("OpenAIChatCompletionRequest accepts response_format json_object", () => {
    const request: OpenAIChatCompletionRequest = {
      messages: [{ role: "user", content: "reply in JSON" }],
      response_format: { type: "json_object" },
    };
    expect(request.response_format?.type).toBe("json_object");
  });

  it("OpenAIChatCompletionRequest accepts response_format text", () => {
    const request: OpenAIChatCompletionRequest = {
      messages: [{ role: "user", content: "plain reply" }],
      response_format: { type: "text" },
    };
    expect(request.response_format?.type).toBe("text");
  });

  it("buildNonStreamingPayload forwards response_format when present", () => {
    const payload = buildNonStreamingPayload({
      messages: [{ role: "user", content: "x" }],
      response_format: { type: "json_object" },
    });
    expect(payload.response_format).toEqual({ type: "json_object" });
  });

  it("buildStreamingPayload forwards response_format when present", () => {
    const payload = buildStreamingPayload({
      messages: [{ role: "user", content: "x" }],
      response_format: { type: "json_object" },
    });
    expect(payload.response_format).toEqual({ type: "json_object" });
    // Streaming still includes usage in the final chunk.
    expect(payload.stream_options).toEqual({ include_usage: true });
  });

  it("payload builders omit response_format when not set (no undefined on wire)", () => {
    const payload = buildNonStreamingPayload({
      messages: [{ role: "user", content: "x" }],
    });
    expect(payload.response_format).toBeUndefined();
  });
});
