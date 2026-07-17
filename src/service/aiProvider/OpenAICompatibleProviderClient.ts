import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIChatCompletionChunk,
  OpenAIModelsResponse,
} from "@/api/aiChatApi";
import type { LocalAIProviderConfig } from "@/entityTypes/aiProviderTypes";
import type {
  ChatProviderClient,
  OpenAIChatCompletionStreamOptions,
} from "./ChatProviderClient";
import {
  buildNonStreamingPayload,
  buildStreamingPayload,
} from "./OpenAIRequestPayload";
import {
  normalizeOpenAIModelsResponse,
  buildSyntheticModelList,
} from "./OpenAIModelNormalizer";
import { OpenAIStreamParser } from "./OpenAIStreamParser";
import { toProviderError, toNetworkProviderError } from "./AIProviderError";

type FetchImpl = typeof fetch;

/**
 * ChatProviderClient that talks to a user-configured OpenAI-compatible
 * endpoint (Ollama, LM Studio, OpenAI, OpenRouter, vLLM, LocalAI, custom).
 *
 * Runs in the main process only — the renderer never constructs this and never
 * sees the plaintext API key. `fetchImpl` is injectable so unit tests can
 * supply canned responses without hitting the network.
 *
 * `baseUrl` on the supplied config is already normalized to end in `/v1`.
 */
export class OpenAICompatibleProviderClient implements ChatProviderClient {
  private readonly streamParser: OpenAIStreamParser;

  constructor(
    private readonly config: LocalAIProviderConfig,
    private readonly apiKey: string,
    fetchImpl?: FetchImpl,
    streamParser?: OpenAIStreamParser
  ) {
    // Default to the global fetch; capture it once so tests can inject a stub.
    this.fetchImpl = fetchImpl ?? fetch;
    this.streamParser = streamParser ?? new OpenAIStreamParser();
  }

  private readonly fetchImpl: FetchImpl;

  private url(path: "/models" | "/chat/completions"): string {
    return `${this.config.baseUrl}${path}`;
  }

  private jsonHeaders(
    accept: "application/json" | "text/event-stream"
  ): HeadersInit {
    const headers: Record<string, string> = {
      Accept: accept,
      "Content-Type": "application/json",
    };
    if (this.apiKey.trim().length > 0) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async listModels(): Promise<OpenAIModelsResponse> {
    try {
      const res = await this.fetchImpl(this.url("/models"), {
        method: "GET",
        headers: this.jsonHeaders("application/json"),
      });
      if (!res.ok) {
        throw await toProviderError(res, { endpoint: "/models" });
      }
      const raw = await res.json();
      return normalizeOpenAIModelsResponse(raw, {
        defaultModel: this.config.defaultModel,
        providerName: this.config.name,
        contextSize: this.config.contextSize,
      });
    } catch {
      // Local providers often have weak /models support. Fall back to a
      // synthetic list so chat can still proceed with the manually configured
      // model; the UI surfaces a warning to the user.
      return buildSyntheticModelList({
        model: this.config.defaultModel,
        providerName: this.config.name,
        contextSize: this.config.contextSize,
      });
    }
  }

  async complete(
    request: OpenAIChatCompletionRequest
  ): Promise<OpenAIChatCompletionResponse> {
    const payload = buildNonStreamingPayload({
      ...request,
      model: request.model ?? this.config.defaultModel,
    });
    let res: Response;
    try {
      res = await this.fetchImpl(this.url("/chat/completions"), {
        method: "POST",
        headers: this.jsonHeaders("application/json"),
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw toNetworkProviderError(err);
    }
    if (!res.ok) {
      throw await toProviderError(res, {
        endpoint: "/chat/completions",
        model: payload.model,
      });
    }
    return (await res.json()) as OpenAIChatCompletionResponse;
  }

  async stream(
    request: OpenAIChatCompletionRequest,
    onChunk: (chunk: OpenAIChatCompletionChunk) => void,
    options?: OpenAIChatCompletionStreamOptions
  ): Promise<void> {
    const payload = buildStreamingPayload({
      ...request,
      model: request.model ?? this.config.defaultModel,
    });
    let res: Response;
    try {
      res = await this.fetchImpl(this.url("/chat/completions"), {
        method: "POST",
        headers: this.jsonHeaders("text/event-stream"),
        body: JSON.stringify(payload),
        signal: options?.signal,
      });
    } catch (err) {
      throw toNetworkProviderError(err);
    }
    if (!res.ok) {
      throw await toProviderError(res, {
        endpoint: "/chat/completions",
        model: payload.model,
      });
    }
    await this.streamParser.consume(res, onChunk, options?.signal);
  }
}
