import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIChatCompletionChunk,
  OpenAIModelsResponse,
} from "@/api/aiChatApi";
import type { StreamRetryInfo, StreamRecoveryInfo } from "@/api/aiChatApi";
import type { AIChatRecoveryProfile } from "@/service/AIChatRetryPolicy";

/**
 * Options for a streaming chat completion. Mirrors the shape AiChatApi already
 * exposes so callers (the query loop) need no new types.
 */
export interface OpenAIChatCompletionStreamOptions {
  readonly signal?: AbortSignal;
  readonly onRetry?: (info: StreamRetryInfo) => void;
}

/**
 * Stage B §5.1 (generator-streaming PRD FR-001): one incremental provider
 * event union carrying every chunk AND retry/recovery notification in their
 * original causal order — the provider transport for generator delivery.
 */
export type ChatProviderStreamEvent =
  | { readonly type: "chunk"; readonly chunk: OpenAIChatCompletionChunk }
  | { readonly type: "retry"; readonly info: StreamRetryInfo }
  | { readonly type: "recovery"; readonly info: StreamRecoveryInfo };

/** Options for provider iteration (Stage B §5.1). */
export interface ChatProviderIterationOptions {
  readonly signal?: AbortSignal;
  readonly retryProfile?: AIChatRecoveryProfile;
}

/**
 * Abstraction over a chat-completions backend. Both the hosted aiFetchly path
 * (kept inside AiChatApi) and the OpenAI-compatible local provider path
 * implement this contract so the chat loop never branches on provider kind.
 *
 * Stage B: `streamEvents` is the PRIMARY streaming surface — an async
 * iterable of incremental provider events. The callback `stream()` remains
 * as a compatibility facade that consumes `streamEvents()` (never a second
 * provider implementation).
 */
export interface ChatProviderClient {
  listModels(): Promise<OpenAIModelsResponse>;
  complete(
    request: OpenAIChatCompletionRequest,
    signal?: AbortSignal
  ): Promise<OpenAIChatCompletionResponse>;
  /**
   * Incremental provider events in causal order: chunks, retry decisions,
   * and recovery-status notifications from the retry layers. Cancelling
   * iteration aborts the underlying request and releases the body reader.
   */
  streamEvents(
    request: OpenAIChatCompletionRequest,
    options?: ChatProviderIterationOptions
  ): AsyncIterable<ChatProviderStreamEvent>;
  /** @deprecated Callback facade — consumes streamEvents(). */
  stream(
    request: OpenAIChatCompletionRequest,
    onChunk: (chunk: OpenAIChatCompletionChunk) => void,
    options?: OpenAIChatCompletionStreamOptions
  ): Promise<void>;
}
