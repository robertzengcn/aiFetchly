import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIChatCompletionChunk,
  OpenAIModelsResponse,
} from "@/api/aiChatApi";
import type { StreamRetryInfo } from "@/api/aiChatApi";

/**
 * Options for a non-streaming chat completion. T04 (NFR-02/04, AC-24):
 * `signal` is the caller's abort handle — a Stop, deadline expiry, or run
 * cancel propagates through `fetchWithResponseTimeout` to abort the in-flight
 * request. Without it, catching an eventual AbortError does not itself abort a
 * hanging fetch.
 */
export interface OpenAIChatCompletionOptions {
  readonly signal?: AbortSignal;
}

/**
 * Options for a streaming chat completion. Mirrors the shape AiChatApi already
 * exposes so callers (the query loop) need no new types.
 */
export interface OpenAIChatCompletionStreamOptions {
  readonly signal?: AbortSignal;
  readonly onRetry?: (info: StreamRetryInfo) => void;
}

/**
 * Abstraction over a chat-completions backend. Both the hosted aiFetchly path
 * (kept inside AiChatApi) and the OpenAI-compatible local provider path
 * implement this contract so the chat loop never branches on provider kind.
 */
export interface ChatProviderClient {
  listModels(): Promise<OpenAIModelsResponse>;
  complete(
    request: OpenAIChatCompletionRequest,
    options?: OpenAIChatCompletionOptions
  ): Promise<OpenAIChatCompletionResponse>;
  stream(
    request: OpenAIChatCompletionRequest,
    onChunk: (chunk: OpenAIChatCompletionChunk) => void,
    options?: OpenAIChatCompletionStreamOptions
  ): Promise<void>;
}
