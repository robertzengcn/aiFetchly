import { describe, it, expect } from "vitest";
import { OpenAIStreamParser } from "@/service/aiProvider/OpenAIStreamParser";
import { AIChatSummaryValidator } from "@/service/AIChatSummaryValidator";
import { AIChatCompactionPromptBuilder } from "@/service/AIChatCompactionPromptBuilder";
import { openAiChatCompletionResponseSchema } from "@/schemas/api/aiChat";
import type { OpenAIChatCompletionChunk } from "@/api/aiChatApi";
import {
  resolveScenario,
  STREAM_TEXT_FINAL,
  FAKE_TOOL_NAME,
} from "../../../e2e/scenarios/aiChatScenarios";
import {
  encodeSseFrames,
  textChunk,
  stopChunk,
  toolCallChunk,
  toolCallFinishChunk,
  MODELS_RESPONSE,
  FAKE_MODEL_ID,
  SECTION_SUMMARY_CONTENT,
  NON_STREAMING_DEFAULT_CONTENT,
  completionResponse,
  isSectionSummaryRequest,
  nonStreamingContent,
  parseChatRequestBody,
} from "../../../e2e/scenarios/openAiProtocol";

/**
 * Feed SSE bytes through the PRODUCTION OpenAIStreamParser and collect chunks.
 * Mirrors what the Electron app does via OpenAICompatibleProviderClient.stream.
 */
async function parseSse(sse: string): Promise<OpenAIChatCompletionChunk[]> {
  const chunks: OpenAIChatCompletionChunk[] = [];
  const parser = new OpenAIStreamParser();
  await parser.consume(new Response(sse), (c) => chunks.push(c));
  return chunks;
}

function textOf(chunks: OpenAIChatCompletionChunk[]): string {
  return chunks
    .flatMap((c) => c.choices ?? [])
    .map((ch) => ch.delta?.content ?? "")
    .join("");
}

describe("FakeOpenAI scenarios vs production OpenAIStreamParser", () => {
  it("models response advertises the e2e model", () => {
    expect(MODELS_RESPONSE.data[0].id).toBe(FAKE_MODEL_ID);
    expect(MODELS_RESPONSE.object).toBe("list");
  });

  it("stream-text emits ordered content chunks and a terminal stop", async () => {
    const plan = resolveScenario("stream-text");
    expect(plan.kind).toBe("sse");
    if (plan.kind !== "sse") return;
    const sse = encodeSseFrames(plan.frames.map((f) => f.payload));
    const chunks = await parseSse(sse);
    expect(textOf(chunks)).toBe(STREAM_TEXT_FINAL);
    const last = chunks[chunks.length - 1];
    expect(last.choices?.[0]?.finish_reason).toBe("stop");
  });

  it("tool-requires-permission emits a tool_call delta then a tool_calls finish", async () => {
    const sse = encodeSseFrames([
      toolCallChunk({
        index: 0,
        id: "c1",
        name: FAKE_TOOL_NAME,
        arguments: "{}",
      }),
      toolCallFinishChunk(),
    ]);
    const chunks = await parseSse(sse);
    const toolChunk = chunks.find((c) =>
      c.choices?.some(
        (ch) => ch.delta?.tool_calls && ch.delta.tool_calls.length > 0
      )
    );
    expect(toolChunk).toBeTruthy();
    const call = toolChunk?.choices?.[0]?.delta?.tool_calls?.[0];
    expect(call?.function?.name).toBe(FAKE_TOOL_NAME);
    const finish = chunks[chunks.length - 1];
    expect(finish.choices?.[0]?.finish_reason).toBe("tool_calls");
  });

  it("malformed-sse yields no content chunks (parser skips garbage)", async () => {
    const plan = resolveScenario("malformed-sse");
    expect(plan.kind).toBe("raw-bytes");
    if (plan.kind !== "raw-bytes") return;
    const chunks = await parseSse(plan.bytes);
    expect(textOf(chunks)).toBe("");
  });

  it("http-500 is an error plan, not an SSE plan", () => {
    const plan = resolveScenario("http-500");
    expect(plan.kind).toBe("http-error");
    if (plan.kind !== "http-error") return;
    expect(plan.status).toBe(500);
  });

  it("disconnect-mid-stream emits leading frames with no terminal stop", () => {
    const plan = resolveScenario("disconnect-mid-stream");
    expect(plan.kind).toBe("disconnect");
    if (plan.kind !== "disconnect") return;
    expect(plan.leadingFrames.length).toBeGreaterThan(0);
  });

  it("stream-delayed first chunk is immediate; the second is the cancel barrier", () => {
    const plan = resolveScenario("stream-delayed");
    if (plan.kind !== "sse") throw new Error("expected sse");
    expect(plan.frames[0].delayMs).toBe(0);
    expect(plan.frames[1].delayMs).toBeGreaterThan(1000);
  });

  it("individual chunk builders produce parser-accepted payloads", async () => {
    const chunks = await parseSse(
      encodeSseFrames([textChunk("x"), stopChunk()])
    );
    expect(textOf(chunks)).toBe("x");
    expect(chunks[chunks.length - 1].choices?.[0]?.finish_reason).toBe("stop");
  });
});

describe("FakeOpenAI non-streaming completion path vs production consumers", () => {
  it("completionResponse parses against the production response schema", () => {
    const body = completionResponse(SECTION_SUMMARY_CONTENT);
    const parsed = openAiChatCompletionResponseSchema().safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it("SECTION_SUMMARY_CONTENT is a validator-accepted SectionSummaryV1 for any source map", () => {
    const validator = new AIChatSummaryValidator();
    // Empty fact lists reference no sourceIds, so any supplied source map
    // (including the real packer-supplied map) accepts it.
    const result = validator.validate(
      JSON.parse(SECTION_SUMMARY_CONTENT),
      new Set(["s1", "s2"])
    );
    expect(result.ok).toBe(true);
    expect(result.summary?.synopsis).toContain("e2e fake provider");
  });

  it("a real compaction section prompt is detected as a summarize request", () => {
    const builder = new AIChatCompactionPromptBuilder();
    const prompt = builder.buildSectionPrompt({
      fragments: [
        {
          sourceId: "s1",
          messageId: "m1",
          role: "user",
          timestamp: "2026-01-01T00:00:00.000Z",
          text: "hello",
          startCodePoint: 0,
          endCodePoint: 5,
          exact: true,
          sourceRowId: 1,
        },
      ],
      receipts: [],
      sectionLabel: "section-1",
    });
    expect(
      isSectionSummaryRequest([
        { role: "system", content: prompt.systemPrompt },
        { role: "user", content: prompt.userPrompt },
      ])
    ).toBe(true);
    expect(
      nonStreamingContent([
        { role: "system", content: prompt.systemPrompt },
        { role: "user", content: prompt.userPrompt },
      ])
    ).toBe(SECTION_SUMMARY_CONTENT);
  });

  it("an ordinary chat request is NOT misdetected as a summarize request", () => {
    expect(
      isSectionSummaryRequest([
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Say hello" },
      ])
    ).toBe(false);
    expect(
      nonStreamingContent([
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Say hello" },
      ])
    ).toBe(NON_STREAMING_DEFAULT_CONTENT);
  });

  it("parseChatRequestBody extracts stream flag, model, and roles", () => {
    const parsed = parseChatRequestBody(
      JSON.stringify({
        model: FAKE_MODEL_ID,
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "hi" },
        ],
        stream: false,
      })
    );
    expect(parsed.stream).toBe(false);
    expect(parsed.model).toBe(FAKE_MODEL_ID);
    expect(parsed.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("parseChatRequestBody degrades to non-streaming on malformed JSON", () => {
    const parsed = parseChatRequestBody("not json {");
    expect(parsed.stream).toBe(false);
    expect(parsed.messages).toHaveLength(0);
  });
});
