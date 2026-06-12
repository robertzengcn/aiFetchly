import type {
  OpenAIChatCompletionChunk,
  OpenAIStreamToolCallDelta,
} from "@/api/aiChatApi";

export interface OpenAIStreamTextState {
  responseId?: string;
  model?: string;
  fullContent: string;
  finishReason?: string | null;
}

export interface BufferedOpenAIToolCall {
  index: number;
  id?: string;
  type?: "function";
  name?: string;
  argumentsJson: string;
}

export interface ParsedToolCallResult {
  index: number;
  id?: string;
  name?: string;
  ok: boolean;
  arguments?: Record<string, unknown>;
}

/**
 * Reduces a stream of OpenAI-compatible chunks into a stable app-level state.
 * Pure with respect to external IO; only mutates its own accumulator state.
 */
export class OpenAIStreamAccumulator {
  private _state: OpenAIStreamTextState = { fullContent: "" };
  private _toolCalls: Map<number, BufferedOpenAIToolCall> = new Map();

  get state(): OpenAIStreamTextState {
    return this._state;
  }

  getBufferedToolCalls(): BufferedOpenAIToolCall[] {
    return Array.from(this._toolCalls.values()).sort((a, b) => a.index - b.index);
  }

  /**
   * Ingest a single raw chunk. Returns the non-empty content delta (or "").
   */
  ingest(chunk: OpenAIChatCompletionChunk): string {
    if (chunk.id) {
      this._state.responseId = chunk.id;
    }
    if (chunk.model) {
      this._state.model = chunk.model;
    }

    let contentDelta = "";
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta;
      if (delta?.content) {
        this._state.fullContent += delta.content;
        contentDelta += delta.content;
      }
      if (choice.finish_reason) {
        this._state.finishReason = choice.finish_reason;
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          this._bufferToolCall(tc);
        }
      }
    }
    return contentDelta;
  }

  private _bufferToolCall(tc: OpenAIStreamToolCallDelta): void {
    const existing = this._toolCalls.get(tc.index);
    const next: BufferedOpenAIToolCall = existing
      ? existing
      : { index: tc.index, argumentsJson: "" };

    if (tc.id && !next.id) {
      next.id = tc.id;
    }
    if (tc.type === "function") {
      next.type = "function";
    }
    if (tc.function?.name && !next.name) {
      next.name = tc.function.name;
    }
    if (tc.function?.arguments) {
      next.argumentsJson += tc.function.arguments;
    }
    this._toolCalls.set(tc.index, next);
  }

  /**
   * Attempt to parse buffered tool-call arguments. Returns ok=false for any
   * malformed JSON so callers can treat arguments as untrusted model output.
   */
  tryParseToolCallArguments(): ParsedToolCallResult[] {
    return this.getBufferedToolCalls().map((call) => {
      const result: ParsedToolCallResult = {
        index: call.index,
        id: call.id,
        name: call.name,
        ok: false,
      };
      if (call.argumentsJson) {
        try {
          const parsed = JSON.parse(call.argumentsJson);
          if (parsed && typeof parsed === "object") {
            result.ok = true;
            result.arguments = parsed as Record<string, unknown>;
          }
        } catch {
          result.ok = false;
        }
      }
      return result;
    });
  }
}
