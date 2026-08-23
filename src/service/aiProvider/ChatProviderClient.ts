import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIChatCompletionChunk,
  OpenAIModelsResponse,
} from "@/api/aiChatApi";
import type { StreamRetryInfo } from "@/api/aiChatApi";

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
    signal?: AbortSignal
  ): Promise<OpenAIChatCompletionResponse>;
  stream(
    request: OpenAIChatCompletionRequest,
    onChunk: (chunk: OpenAIChatCompletionChunk) => void,
    options?: OpenAIChatCompletionStreamOptions
  ): Promise<void>;
}
