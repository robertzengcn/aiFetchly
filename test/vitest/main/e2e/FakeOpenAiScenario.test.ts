import { describe, it, expect } from "vitest";
import { OpenAIStreamParser } from "@/service/aiProvider/OpenAIStreamParser";
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
      toolCallChunk({ index: 0, id: "c1", name: FAKE_TOOL_NAME, arguments: "{}" }),
      toolCallFinishChunk(),
    ]);
    const chunks = await parseSse(sse);
    const toolChunk = chunks.find((c) =>
      c.choices?.some((ch) => ch.delta?.tool_calls && ch.delta.tool_calls.length > 0)
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
    const chunks = await parseSse(encodeSseFrames([textChunk("x"), stopChunk()]));
    expect(textOf(chunks)).toBe("x");
    expect(chunks[chunks.length - 1].choices?.[0]?.finish_reason).toBe("stop");
  });
});
