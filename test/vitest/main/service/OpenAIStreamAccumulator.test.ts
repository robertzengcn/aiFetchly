import { describe, expect, it } from "vitest";
import { OpenAIStreamAccumulator } from "@/service/OpenAIStreamAccumulator";
import type { OpenAIChatCompletionChunk } from "@/api/aiChatApi";

function chunk(
  overrides: Partial<OpenAIChatCompletionChunk>
): OpenAIChatCompletionChunk {
  return {
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "" },
        finish_reason: null,
      },
    ],
    ...overrides,
  };
}

describe("OpenAIStreamAccumulator", () => {
  it("appends content deltas to full content", () => {
    const acc = new OpenAIStreamAccumulator();
    acc.ingest(
      chunk({
        choices: [{ index: 0, delta: { content: "Hel" }, finish_reason: null }],
      })
    );
    acc.ingest(
      chunk({
        choices: [{ index: 0, delta: { content: "lo" }, finish_reason: null }],
      })
    );
    expect(acc.state.fullContent).toBe("Hello");
  });

  it("role-only delta does not create text", () => {
    const acc = new OpenAIStreamAccumulator();
    acc.ingest(
      chunk({
        choices: [
          { index: 0, delta: { role: "assistant" }, finish_reason: null },
        ],
      })
    );
    expect(acc.state.fullContent).toBe("");
  });

  it("captures responseId and model from chunks", () => {
    const acc = new OpenAIStreamAccumulator();
    acc.ingest(chunk({ id: "chatcmpl-abc", model: "gpt-test" }));
    expect(acc.state.responseId).toBe("chatcmpl-abc");
    expect(acc.state.model).toBe("gpt-test");
  });

  it("stores finishReason when present", () => {
    const acc = new OpenAIStreamAccumulator();
    acc.ingest(
      chunk({
        choices: [{ index: 0, delta: { content: "x" }, finish_reason: "stop" }],
      })
    );
    expect(acc.state.finishReason).toBe("stop");
  });

  it("returns non-empty content deltas for IPC forwarding", () => {
    const acc = new OpenAIStreamAccumulator();
    const d1 = acc.ingest(
      chunk({
        choices: [{ index: 0, delta: { content: "ab" }, finish_reason: null }],
      })
    );
    const d2 = acc.ingest(
      chunk({
        choices: [{ index: 0, delta: { content: "" }, finish_reason: null }],
      })
    );
    expect(d1).toBe("ab");
    expect(d2).toBe("");
  });

  it("buffers fragmented tool call argument deltas by index", () => {
    const acc = new OpenAIStreamAccumulator();
    acc.ingest(
      chunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "search", arguments: '{"q":"den' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      })
    );
    acc.ingest(
      chunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: 'tists"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      })
    );
    const calls = acc.getBufferedToolCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].id).toBe("call_1");
    expect(calls[0].name).toBe("search");
    expect(calls[0].argumentsJson).toBe('{"q":"dentists"}');
  });

  it("reports malformed tool-call JSON without throwing", () => {
    const acc = new OpenAIStreamAccumulator();
    acc.ingest(
      chunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "c1",
                  function: { name: "t", arguments: "{bad" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      })
    );
    const parsed = acc.tryParseToolCallArguments();
    expect(parsed.length).toBe(1);
    expect(parsed[0].ok).toBe(false);
    expect(parsed[0].rawArgumentsJson).toBe("{bad");
  });

  it("treats empty arguments as valid {}", () => {
    const acc = new OpenAIStreamAccumulator();
    acc.ingest(
      chunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "c2",
                  type: "function",
                  function: { name: "list_items" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      })
    );
    const parsed = acc.tryParseToolCallArguments();
    expect(parsed.length).toBe(1);
    expect(parsed[0].ok).toBe(true);
    expect(parsed[0].arguments).toEqual({});
    expect(parsed[0].rawArgumentsJson).toBe("");
  });

  it("captures usage from the final usage-only chunk", () => {
    const acc = new OpenAIStreamAccumulator();
    // Normal token chunk first
    acc.ingest(
      chunk({
        choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }],
      })
    );
    expect(acc.state.usage).toBeUndefined();
    // Final chunk emitted when stream_options.include_usage=true: empty
    // choices array plus top-level usage.
    acc.ingest({
      id: "chatcmpl-final",
      object: "chat.completion.chunk",
      created: 2,
      model: "gpt-test",
      choices: [],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 5,
        total_tokens: 105,
      },
    });
    expect(acc.state.usage).toEqual({
      prompt_tokens: 100,
      completion_tokens: 5,
      total_tokens: 105,
    });
  });
});
