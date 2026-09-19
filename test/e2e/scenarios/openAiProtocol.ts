/**
 * OpenAI-compatible protocol helpers for the FakeOpenAI E2E server (design §9).
 *
 * These build the exact wire bytes the production `OpenAIStreamParser` accepts,
 * so scenarios can be unit-tested against the real parser before being served to
 * the Electron app (design §9.4). Non-streaming completion bodies are built to
 * the `OpenAIChatCompletionResponse` shape that
 * `OpenAICompatibleProviderClient.complete` (and the compaction coordinator's
 * summarize callback) consume.
 */

/** Model id advertised by the fake server. */
export const FAKE_MODEL_ID = "aifetchly-e2e-model";

/** One SSE payload emitted to the client. */
export interface SseFrame {
  /** Bounded delay before this frame is written (ms). 0 = immediate. */
  readonly delayMs: number;
  /** The `data:` line payload (without the `data: ` prefix or trailing newline). */
  readonly payload: string;
}

export type FakeAiScenarioName =
  | "stream-text"
  | "stream-delayed"
  | "tool-requires-permission"
  | "tool-success-followup"
  | "http-500"
  | "malformed-sse"
  | "disconnect-mid-stream";

/** Build a standard text-content chunk payload string. */
export function textChunk(
  content: string,
  model = FAKE_MODEL_ID,
  finishReason: string | null = null
): string {
  return JSON.stringify({
    id: "chatcmpl-e2e",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices: [{ index: 0, delta: { content }, finish_reason: finishReason }],
  });
}

/** Build a terminal chunk (no content, finish_reason=stop) + optional usage. */
export function stopChunk(model = FAKE_MODEL_ID): string {
  return JSON.stringify({
    id: "chatcmpl-e2e",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  });
}

/** Build a tool-call delta chunk (streaming tool_calls, OpenAI shape). */
export function toolCallChunk(args: {
  index: number;
  id?: string;
  name?: string;
  arguments?: string;
  model?: string;
}): string {
  return JSON.stringify({
    id: "chatcmpl-e2e",
    object: "chat.completion.chunk",
    created: 0,
    model: args.model ?? FAKE_MODEL_ID,
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: args.index,
              ...(args.id !== undefined ? { id: args.id } : {}),
              type: "function",
              function: {
                ...(args.name !== undefined ? { name: args.name } : {}),
                ...(args.arguments !== undefined
                  ? { arguments: args.arguments }
                  : {}),
              },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  });
}

/** Build a terminal tool-call chunk (finish_reason=tool_calls). */
export function toolCallFinishChunk(model = FAKE_MODEL_ID): string {
  return JSON.stringify({
    id: "chatcmpl-e2e",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
  });
}

/** The `[DONE]` sentinel frame. */
export const DONE_FRAME = "[DONE]";

/** Encode a sequence of payloads + the [DONE] sentinel into SSE wire bytes. */
export function encodeSseFrames(frames: readonly string[]): string {
  return frames.map((f) => `data: ${f}\n`).join("") + "data: [DONE]\n\n";
}

/** GET /v1/models response body (OpenAI-compatible). */
export const MODELS_RESPONSE = {
  object: "list",
  data: [
    {
      id: FAKE_MODEL_ID,
      object: "model",
      created: 0,
      owned_by: "aifetchly-e2e",
    },
  ],
};

/** A /chat/completions request body parsed into the fields the server needs. */
export interface ParsedChatRequestBody {
  readonly model: string | undefined;
  readonly messages: ReadonlyArray<{ role?: string; content?: unknown }>;
  readonly stream: boolean;
  readonly toolNames: readonly string[];
}

/**
 * Parse a raw /chat/completions request body. Malformed JSON degrades to an
 * empty non-streaming request (the server then answers generically) — same
 * fail-soft posture as the existing redaction path.
 */
export function parseChatRequestBody(rawBody: string): ParsedChatRequestBody {
  try {
    const parsed = JSON.parse(rawBody) as {
      model?: unknown;
      messages?: unknown;
      stream?: unknown;
      tools?: unknown;
    };
    const messages = Array.isArray(parsed.messages)
      ? (parsed.messages as Array<{ role?: string; content?: unknown }>)
      : [];
    const toolNames = (Array.isArray(parsed.tools) ? parsed.tools : [])
      .map((t) => (t as { function?: { name?: string } })?.function?.name)
      .filter((n): n is string => typeof n === "string");
    return {
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      messages,
      stream: parsed.stream === true,
      toolNames,
    };
  } catch {
    return { model: undefined, messages: [], stream: false, toolNames: [] };
  }
}

/**
 * A minimal SectionSummaryV1 the fake server returns as the content of a
 * non-streaming completion for compaction summarize requests. Every fact list
 * is empty and every sourceIds array is empty, so the production
 * AIChatSummaryValidator accepts it for any supplied source map (only
 * references OUTSIDE the map are rejected).
 */
export const SECTION_SUMMARY_CONTENT = JSON.stringify({
  version: 1,
  synopsis: "Section summary produced by the e2e fake provider.",
  decisions: [],
  constraints: [],
  pending: [],
  toolOutcomes: [],
  topics: ["e2e"],
});

/** Generic content for non-streaming calls that are not compaction summarize. */
export const NON_STREAMING_DEFAULT_CONTENT = "Non-streaming e2e completion.";

/**
 * A non-streaming chat completion body, mirroring the production
 * `OpenAIChatCompletionResponse` shape that `OpenAICompatibleProviderClient.complete`
 * (and the compaction coordinator's summarize callback via
 * `openAIContentToString`) consume. Declared locally — the E2E layer is
 * deliberately decoupled from `src/` (design §9.3: relative imports only).
 */
export interface FakeCompletionResponse {
  readonly id: string;
  readonly object: string;
  readonly created: number;
  readonly model: string;
  readonly choices: ReadonlyArray<{
    readonly index: number;
    readonly message: { role: string; content: string };
    readonly finish_reason: string;
  }>;
  readonly usage: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly total_tokens: number;
  };
}

/** Build a non-streaming chat completion body (OpenAIChatCompletionResponse). */
export function completionResponse(
  content: string,
  model: string | undefined = FAKE_MODEL_ID
): FakeCompletionResponse {
  return {
    id: "chatcmpl-e2e-nostream",
    object: "chat.completion",
    created: 0,
    model: model ?? FAKE_MODEL_ID,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/**
 * True when the request carries the compaction section-summary prompt: the
 * coordinator's summarize callback is the only caller whose system prompt
 * embeds the SectionSummaryV1 schema name (AIChatCompactionPromptBuilder
 * always includes "Output schema (SectionSummaryV1, version 1)"), making it a
 * deterministic marker for content-based discrimination — the same posture as
 * the deferral-retry body sniff.
 */
export function isSectionSummaryRequest(
  messages: ReadonlyArray<{ role?: string; content?: unknown }>
): boolean {
  return messages.some(
    (m) =>
      m.role === "system" &&
      typeof m.content === "string" &&
      m.content.includes("SectionSummaryV1")
  );
}

/** Choose the content for a non-streaming completion response. */
export function nonStreamingContent(
  messages: ReadonlyArray<{ role?: string; content?: unknown }>
): string {
  return isSectionSummaryRequest(messages)
    ? SECTION_SUMMARY_CONTENT
    : NON_STREAMING_DEFAULT_CONTENT;
}
