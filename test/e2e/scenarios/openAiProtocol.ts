/**
 * OpenAI-compatible protocol helpers for the FakeOpenAI E2E server (design §9).
 *
 * These build the exact wire bytes the production `OpenAIStreamParser` accepts,
 * so scenarios can be unit-tested against the real parser before being served to
 * the Electron app (design §9.4).
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
                ...(args.arguments !== undefined ? { arguments: args.arguments } : {}),
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
