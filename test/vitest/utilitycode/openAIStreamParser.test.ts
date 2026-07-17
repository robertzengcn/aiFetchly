import { describe, it, expect } from "vitest";
import { OpenAIStreamParser } from "@/service/aiProvider/OpenAIStreamParser";
import type { OpenAIChatCompletionChunk } from "@/api/aiChatApi";

/** Build a fetch Response whose body streams the given UTF-8 text. */
function makeResponse(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream);
}

function chunk(content?: string, opts: Partial<OpenAIChatCompletionChunk> = {}): string {
  const payload = {
    id: "chatcmpl-x",
    object: "chat.completion.chunk",
    created: 1,
    model: "llama3.1",
    choices: [
      {
        index: 0,
        delta: content !== undefined ? { content } : {},
        finish_reason: null,
      },
    ],
    ...opts,
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

describe("OpenAIStreamParser", () => {
  it("emits content deltas and stops at [DONE]", async () => {
    const body = chunk("Hello") + chunk(" world") + "data: [DONE]\n\n";
    const received: string[] = [];
    await new OpenAIStreamParser().consume(makeResponse(body), (c) => {
      const delta = c.choices[0]?.delta?.content;
      if (delta) received.push(delta);
    });
    expect(received.join("")).toBe("Hello world");
  });

  it("emits a usage-only final chunk (empty choices + usage)", async () => {
    const usageChunk =
      "data: " +
      JSON.stringify({
        id: "x",
        object: "chat.completion.chunk",
        created: 1,
        model: "llama3.1",
        choices: [],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      }) +
      "\n\n";
    let usage: OpenAIChatCompletionChunk["usage"] | undefined;
    await new OpenAIStreamParser().consume(makeResponse(usageChunk), (c) => {
      usage = c.usage;
    });
    expect(usage).toEqual({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
  });

  it("emits tool-call deltas", async () => {
    const toolChunk =
      "data: " +
      JSON.stringify({
        id: "x",
        object: "chat.completion.chunk",
        created: 1,
        model: "llama3.1",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", type: "function", function: { name: "ping", arguments: "{" } },
              ],
            },
            finish_reason: null,
          },
        ],
      }) +
      "\n\n";
    let toolCall: unknown;
    await new OpenAIStreamParser().consume(makeResponse(toolChunk), (c) => {
      toolCall = c.choices[0]?.delta?.tool_calls;
    });
    expect(toolCall).toHaveLength(1);
  });

  it("ignores keepalive comments and blank/event lines", async () => {
    const body =
      ": OPENROUTER PROCESSING\n\n" +
      "event: message\n" +
      chunk("hi") +
      "data: [DONE]\n\n";
    const received: string[] = [];
    await new OpenAIStreamParser().consume(makeResponse(body), (c) => {
      const d = c.choices[0]?.delta?.content;
      if (d) received.push(d);
    });
    expect(received.join("")).toBe("hi");
  });

  it("tolerates a payload split across reads", async () => {
    const full = chunk("split") + "data: [DONE]\n\n";
    const encoder = new TextEncoder();
    const mid = Math.floor(full.length / 2);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(full.slice(0, mid)));
        controller.enqueue(encoder.encode(full.slice(mid)));
        controller.close();
      },
    });
    const received: string[] = [];
    await new OpenAIStreamParser().consume(new Response(stream), (c) => {
      const d = c.choices[0]?.delta?.content;
      if (d) received.push(d);
    });
    expect(received.join("")).toBe("split");
  });

  it("throws when the response body is null", async () => {
    await expect(
      new OpenAIStreamParser().consume(new Response(null), () => undefined)
    ).rejects.toThrow(/body is null/i);
  });
});
