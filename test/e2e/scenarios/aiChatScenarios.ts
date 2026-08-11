/**
 * Deterministic AI scenarios served by the FakeOpenAI E2E server (design §9.2).
 *
 * Each scenario is a typed plan the server applies to a `/chat/completions`
 * request. Scenario payloads are validated against the production
 * OpenAIStreamParser in Vitest (design §9.4) before being used in Electron tests.
 */

import {
  stopChunk,
  textChunk,
  toolCallChunk,
  toolCallFinishChunk,
  type FakeAiScenarioName,
  type SseFrame,
} from "./openAiProtocol";

export type ScenarioPlan =
  | { readonly kind: "sse"; readonly frames: readonly SseFrame[] }
  | {
      readonly kind: "http-error";
      readonly status: number;
      readonly body: string;
    }
  | { readonly kind: "raw-bytes"; readonly bytes: string }
  | {
      readonly kind: "disconnect";
      readonly leadingFrames: readonly SseFrame[];
    };

function frame(delayMs: number, payload: string): SseFrame {
  return { delayMs, payload };
}

/** The visible text a stream-text response renders, split into ordered chunks. */
export const STREAM_TEXT_CHUNKS = ["Hello", " ", "world", "!"] as const;
export const STREAM_TEXT_FINAL = STREAM_TEXT_CHUNKS.join("");

/** A tool the fake server asks the app to approve (workspace-contained). */
export const FAKE_TOOL_NAME = "list_workspace_files";

/**
 * Resolve a scenario name into the plan the fake server executes. Delays are
 * explicit and bounded (design §9.5) — never exceed a test timeout.
 */
export function resolveScenario(name: FakeAiScenarioName): ScenarioPlan {
  switch (name) {
    case "stream-text":
      return {
        kind: "sse",
        frames: [
          ...STREAM_TEXT_CHUNKS.map((c) => frame(0, textChunk(c))),
          frame(0, stopChunk()),
        ],
      };
    case "stream-delayed": {
      // Used by cancellation tests: emit one chunk fast, then hold a bounded
      // delay before the next so the test can press Stop mid-stream. The barrier
      // is generous (10s) so a slow CI runner has margin to render the first
      // chunk + click Stop before the cancelled suffix would write.
      return {
        kind: "sse",
        frames: [
          frame(0, textChunk("Streaming")),
          frame(10_000, textChunk("-should-be-cancelled")),
          frame(0, stopChunk()),
        ],
      };
    }
    case "tool-requires-permission":
      return {
        kind: "sse",
        frames: [
          frame(
            0,
            toolCallChunk({
              index: 0,
              id: "call_e2e_1",
              name: FAKE_TOOL_NAME,
              arguments: '{"path":"."}',
            })
          ),
          frame(0, toolCallFinishChunk()),
        ],
      };
    case "tool-success-followup":
      // After a tool result is fed back, the server completes with a short text.
      return {
        kind: "sse",
        frames: [frame(0, textChunk("Done.")), frame(0, stopChunk())],
      };
    case "http-500":
      return {
        kind: "http-error",
        status: 500,
        body: JSON.stringify({ error: { message: "simulated server error" } }),
      };
    case "malformed-sse":
      // Not valid SSE data lines — the parser skips them and the stream ends
      // with no chunks, surfacing a recoverable empty/finish state.
      return {
        kind: "raw-bytes",
        bytes: "this is not valid sse\n>>> garbage <<<\n",
      };
    case "disconnect-mid-stream":
      // Emit one chunk then sever the connection (no [DONE], no finish chunk).
      return {
        kind: "disconnect",
        leadingFrames: [frame(0, textChunk("partial"))],
      };
    default: {
      // Exhaustiveness guard.
      const _exhaustive: never = name;
      return _exhaustive;
    }
  }
}
