import { describe, it, expect } from "vitest";
import { OpenAIStreamAccumulator } from "@/service/OpenAIStreamAccumulator";
import type { OpenAIChatCompletionChunk } from "@/api/aiChatApi";

function chunk(
  delta: Record<string, unknown>,
  finish?: string
): OpenAIChatCompletionChunk {
  return {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 1,
    model: "reasoning-model",
    choices: [
      { index: 0, delta: delta as never, finish_reason: finish ?? null },
    ],
  };
}

describe("OpenAIStreamAccumulator — reasoning", () => {
  it("accumulates reasoning_content into reasoningDelta and state.reasoningContent", () => {
    const acc = new OpenAIStreamAccumulator();
    const r1 = acc.ingest(chunk({ reasoning_content: "Hello " }));
    const r2 = acc.ingest(chunk({ reasoning_content: "world." }));
    expect(r1.reasoningDelta).toBe("Hello ");
    expect(r2.reasoningDelta).toBe("world.");
    expect(r1.contentDelta).toBe("");
    expect(acc.state.reasoningContent).toBe("Hello world.");
  });

  it("keeps contentDelta and reasoningDelta separate within one chunk", () => {
    const acc = new OpenAIStreamAccumulator();
    const r = acc.ingest(chunk({ reasoning_content: "think", content: "say" }));
    expect(r.reasoningDelta).toBe("think");
    expect(r.contentDelta).toBe("say");
    expect(acc.state.fullContent).toBe("say");
    expect(acc.state.reasoningContent).toBe("think");
  });

  it("prioritizes reasoning_delta > reasoning_content > reasoning_summary", () => {
    const acc = new OpenAIStreamAccumulator();
    // All three present → only reasoning_delta used (no duplicate aliases).
    const r = acc.ingest(
      chunk({
        reasoning_delta: "D",
        reasoning_content: "C",
        reasoning_summary: "S",
      })
    );
    expect(r.reasoningDelta).toBe("D");
    expect(acc.state.reasoningContent).toBe("D");

    // Without reasoning_delta, reasoning_content wins.
    const acc2 = new OpenAIStreamAccumulator();
    const r2 = acc2.ingest(
      chunk({ reasoning_content: "C", reasoning_summary: "S" })
    );
    expect(r2.reasoningDelta).toBe("C");
  });

  it("returns empty deltas on usage-only chunks but still captures usage", () => {
    const acc = new OpenAIStreamAccumulator();
    const r = acc.ingest({
      id: "x",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    });
    expect(r.contentDelta).toBe("");
    expect(r.reasoningDelta).toBe("");
    expect(acc.state.usage?.total_tokens).toBe(5);
  });

  it("still buffers tool calls when reasoning fields are present", () => {
    const acc = new OpenAIStreamAccumulator();
    acc.ingest({
      id: "x",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [
        {
          index: 0,
          delta: {
            reasoning_content: "planning",
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "file_read", arguments: '{"path":"/a"}' },
              },
            ],
          } as never,
          finish_reason: "tool_calls",
        },
      ],
    });
    const calls = acc.tryParseToolCallArguments();
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("file_read");
    expect(calls[0].ok).toBe(true);
  });

  it("ignores malformed non-string reasoning fields", () => {
    const acc = new OpenAIStreamAccumulator();
    const r = acc.ingest(chunk({ reasoning_content: { bad: true } } as never));
    expect(r.reasoningDelta).toBe("");
    expect(acc.state.reasoningContent).toBe("");
  });
});
