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
import { AIProviderError } from "./AIProviderError";

type FetchImpl = typeof fetch;

/**
 * Time-to-response-headers budget for local provider chat calls. Local models
 * can take a while on cold start, so this is generous; once headers arrive the
 * timer is cleared so an active stream is never killed. Prevents a hung
 * provider from stalling chat indefinitely (PRD §17.1).
 */
const LOCAL_PROVIDER_RESPONSE_TIMEOUT_MS = 60_000;

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
  private readonly responseTimeoutMs: number;

  constructor(
    private readonly config: LocalAIProviderConfig,
    private readonly apiKey: string,
    fetchImpl?: FetchImpl,
    streamParser?: OpenAIStreamParser,
    responseTimeoutMs: number = LOCAL_PROVIDER_RESPONSE_TIMEOUT_MS
  ) {
    // Default to the global fetch; capture it once so tests can inject a stub.
    this.fetchImpl = fetchImpl ?? fetch;
    this.streamParser = streamParser ?? new OpenAIStreamParser();
    this.responseTimeoutMs = responseTimeoutMs;
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

  /**
   * fetch with a time-to-response-headers timeout. The timer is cleared once
   * the Response arrives, so the body of a streaming call can flow without
   * being killed; only a provider that never sends headers stalls into the
   * timeout. A caller-initiated abort is preserved as an AbortError; a timeout
   * surfaces as a categorized network error.
   */
  private async fetchWithResponseTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    callerSignal?: AbortSignal
  ): Promise<Response> {
    const controller = new AbortController();
    const onCallerAbort = (): void => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      }
    }
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (err) {
      // Distinguish a timeout (timer fired) from a user-initiated abort.
      const timedOut =
        controller.signal.aborted && (!callerSignal || !callerSignal.aborted);
      if (timedOut) {
        throw new AIProviderError(
          "The AI provider took too long to respond. Check that it is running and not overloaded.",
          "network"
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (callerSignal) {
        callerSignal.removeEventListener("abort", onCallerAbort);
      }
    }
  }

  async listModels(): Promise<OpenAIModelsResponse> {
    return (await this.listModelsWithFallbackStatus()).models;
  }

  async listModelsWithFallbackStatus(): Promise<{
    readonly models: OpenAIModelsResponse;
    readonly usedFallback: boolean;
  }> {
    try {
      const res = await this.fetchImpl(this.url("/models"), {
        method: "GET",
        headers: this.jsonHeaders("application/json"),
      });
      if (!res.ok) {
        throw await toProviderError(res, { endpoint: "/models" });
      }
      const raw = await res.json();
      return {
        models: normalizeOpenAIModelsResponse(raw, {
          defaultModel: this.config.defaultModel,
          providerName: this.config.name,
          contextSize: this.config.contextSize,
        }),
        usedFallback: false,
      };
    } catch {
      // Local providers often have weak /models support. Fall back to a
      // synthetic list so chat can still proceed with the manually configured
      // model; the UI surfaces a warning to the user.
      return {
        models: buildSyntheticModelList({
          model: this.config.defaultModel,
          providerName: this.config.name,
          contextSize: this.config.contextSize,
        }),
        usedFallback: true,
      };
    }
  }

  async complete(
    request: OpenAIChatCompletionRequest,
    signal?: AbortSignal
  ): Promise<OpenAIChatCompletionResponse> {
    const payload = buildNonStreamingPayload({
      ...request,
      model: request.model ?? this.config.defaultModel,
    });
    let res: Response;
    try {
      res = await this.fetchWithResponseTimeout(
        this.url("/chat/completions"),
        {
          method: "POST",
          headers: this.jsonHeaders("application/json"),
          body: JSON.stringify(payload),
        },
        this.responseTimeoutMs,
        signal
      );
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
      res = await this.fetchWithResponseTimeout(
        this.url("/chat/completions"),
        {
          method: "POST",
          headers: this.jsonHeaders("text/event-stream"),
          body: JSON.stringify(payload),
        },
        this.responseTimeoutMs,
        options?.signal
      );
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
