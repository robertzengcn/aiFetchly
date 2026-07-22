import type { OpenAIChatCompletionChunk } from "@/api/aiChatApi";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/**
 * Parses a standard OpenAI-compatible SSE stream (`data: {json}` lines,
 * terminated by `data: [DONE]`) into `OpenAIChatCompletionChunk` callbacks.
 *
 * Tolerant of:
 *  - multiple SSE messages in one read
 *  - blank-line event separation and `event:` lines
 *  - chunks with `choices[].delta.content` and `choices[].delta.tool_calls`
 *  - a final usage-only chunk (empty choices + top-level `usage`)
 *
 * Abort: if `signal` is already aborted the parser rejects immediately; if
 * `reader.read()` rejects with an AbortError it is rethrown so the caller's
 * cancellation semantics are preserved.
 */
export class OpenAIStreamParser {
  /**
   * Consume a fetch `Response` body as an OpenAI SSE stream.
   * Resolves when the stream ends (or `[DONE]`); rejects on abort.
   */
  async consume(
    response: Response,
    onChunk: (chunk: OpenAIChatCompletionChunk) => void,
    signal?: AbortSignal
  ): Promise<void> {
    if (!response.body) {
      throw new Error("Provider response body is null.");
    }
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      let streamActive = true;
      while (streamActive) {
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } catch (readError: unknown) {
          if (
            readError instanceof Error &&
            (readError.name === "AbortError" ||
              (readError instanceof DOMException &&
                readError.name === "AbortError"))
          ) {
            throw readError;
          }
          throw readError;
        }
        const { done, value } = result;
        if (done) {
          streamActive = false;
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        // Keep the final partial line in the buffer.
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === "") {
            // Blank line separates SSE events; nothing else to do.
            continue;
          }
          if (trimmed.startsWith(":")) {
            // SSE comment / keepalive (e.g. ": OPENROUTER PROCESSING").
            continue;
          }
          if (trimmed.startsWith("event:")) {
            // We don't require event names for OpenAI chunks.
            continue;
          }
          if (!trimmed.startsWith("data:")) {
            continue;
          }
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") {
            streamActive = false;
            break;
          }
          if (payload.length === 0) {
            continue;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(payload);
          } catch {
            // Ignore unparseable keepalive/heartbeat lines.
            continue;
          }
          const chunk = this.toChunk(parsed);
          if (chunk) {
            onChunk(chunk);
          }
        }
      }

      // Flush any trailing data line left in the buffer.
      const trailing = buffer.trim();
      if (trailing.startsWith("data:")) {
        const payload = trailing.slice(5).trim();
        if (payload && payload !== "[DONE]") {
          try {
            const parsed: unknown = JSON.parse(payload);
            const chunk = this.toChunk(parsed);
            if (chunk) {
              onChunk(chunk);
            }
          } catch {
            // ignore trailing parse error
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Coerce a parsed SSE payload into an `OpenAIChatCompletionChunk`, or return
   * null when the payload is not a recognizable chunk (e.g. a keepalive object).
   * Accepts both standard OpenAI chunks and usage-only final chunks.
   */
  private toChunk(payload: unknown): OpenAIChatCompletionChunk | null {
    if (!isRecord(payload)) {
      return null;
    }
    const hasChoices = Array.isArray(payload.choices);
    const hasUsage = isRecord(payload.usage);
    if (!hasChoices && !hasUsage) {
      return null;
    }
    const id =
      typeof payload.id === "string" ? payload.id : `local-chunk-${Date.now()}`;
    const created =
      typeof payload.created === "number" ? payload.created : Math.floor(Date.now() / 1000);
    const model = typeof payload.model === "string" ? payload.model : "";
    const chunk: OpenAIChatCompletionChunk = {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: hasChoices ? (payload.choices as OpenAIChatCompletionChunk["choices"]) : [],
    };
    if (hasUsage) {
      chunk.usage = payload.usage as OpenAIChatCompletionChunk["usage"];
    }
    return chunk;
  }
}
