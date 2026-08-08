import type { OpenAIChatCompletionRequest } from "@/api/aiChatApi";

/**
 * Build a clean, non-streaming chat-completion payload, copying only known
 * request fields and dropping `undefined` values. Used by both hosted and
 * local clients so field-copy logic lives in one place.
 */
export function buildNonStreamingPayload(
  request: OpenAIChatCompletionRequest
): OpenAIChatCompletionRequest {
  return buildOpenAIPayload(request, false);
}

/**
 * Build a clean streaming chat-completion payload. Asks the provider to include
 * token usage in the final chunk (servers that ignore stream_options simply
 * disregard it), matching AiChatApi's existing behavior.
 */
export function buildStreamingPayload(
  request: OpenAIChatCompletionRequest
): OpenAIChatCompletionRequest {
  return {
    ...buildOpenAIPayload(request, true),
    stream_options: { include_usage: true },
  };
}

function buildOpenAIPayload(
  request: OpenAIChatCompletionRequest,
  stream: boolean
): OpenAIChatCompletionRequest {
  const payload: OpenAIChatCompletionRequest = {
    messages: request.messages,
    stream,
  };
  if (typeof request.model === "string" && request.model.length > 0) {
    payload.model = request.model;
  }
  if (request.temperature !== undefined) {
    payload.temperature = request.temperature;
  }
  if (request.max_tokens !== undefined) {
    payload.max_tokens = request.max_tokens;
  }
  if (request.tools && request.tools.length > 0) {
    payload.tools = request.tools;
  }
  if (request.tool_choice !== undefined) {
    payload.tool_choice = request.tool_choice;
  }
  if (request.stop !== undefined) {
    payload.stop = request.stop;
  }
  if (request.user !== undefined) {
    payload.user = request.user;
  }
  return payload;
}
