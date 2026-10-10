import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIChatCompletionChunk,
  OpenAIModelsResponse,
} from "@/api/aiChatApi";
import type { LocalAIProviderConfig } from "@/entityTypes/aiProviderTypes";
import type {
  ChatProviderClient,
  ChatProviderIterationOptions,
  ChatProviderStreamEvent,
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
import { isSmallModelAlias } from "./SmallModelAlias";

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

  /**
   * Resolve the model id to send to the provider. The virtual "small"/"haiku"
   * aliases belong to the hosted aiFetchly server and are unknown to
   * third-party providers, so they are served with the configured default
   * model instead of being sent literally (which would 404).
   */
  private resolveModel(requestModel?: string): string {
    if (isSmallModelAlias(requestModel)) {
      return this.config.defaultModel;
    }
    return requestModel ?? this.config.defaultModel;
  }

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
      const response = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });
      // TODO-03 (FR-008/015): the header-timeout lifetime ENDS when headers
      // arrive, but the caller-abort link must survive for the whole body
      // read — otherwise Stop during a streaming read leaves the request
      // alive with no way to cancel it. Attach a body-close cleanup that
      // aborts the transport when the caller aborts mid-body or the response
      // is finalized, and keeps the listener installed until then.
      this.linkCallerAbortToBody(response, controller, callerSignal);
      return response;
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
    }
  }

  /**
   * TODO-03: keep the caller's abort connected through body consumption.
   * `fetch()` resolves when headers arrive; removing the listener then (the
   * old behavior) disconnected Stop from the streaming read. Instead:
   * - a caller abort mid-body aborts the transport controller (which cancels
   *   the in-flight read with an AbortError);
   * - the listener is removed only when the body is closed/cancelled or the
   *   response errors — never before.
   */
  private linkCallerAbortToBody(
    response: Response,
    controller: AbortController,
    callerSignal: AbortSignal | undefined
  ): void {
    if (!callerSignal) return;
    const abortTransport = (): void => {
      if (!controller.signal.aborted) controller.abort();
    };
    if (callerSignal.aborted) {
      abortTransport();
      return;
    }
    callerSignal.addEventListener("abort", abortTransport, { once: true });
    const detach = (): void => {
      callerSignal.removeEventListener("abort", abortTransport);
    };
    // Review F7: an N-round tool loop accumulates one listener per request
    // on the TURN signal (Node warns past 10) and retains each round's
    // controller/body closure until turn end. Detach as soon as the body
    // reaches a terminal state: cancel, error, or full drain.
    const body = response.body;
    if (body) {
      const originalCancel = body.cancel.bind(body);
      body.cancel = (reason?: unknown): Promise<void> => {
        detach();
        abortTransport();
        return originalCancel(reason);
      };
      // NOTE: no drain-watcher here — a second reader would steal the body
      // lock from the parser (a ReadableStream allows one reader). The
      // parser's finally cancels the body on EVERY terminal path (post-DONE
      // included, TODO-04), which fires the cancel wrapper above and detaches.
      // A consumer that neither drains nor cancels leaves the listener —
      // bounded by the turn signal's lifetime as before.
      void detach;
    } else {
      detach();
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
      model: this.resolveModel(request.model),
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

  /**
   * Stage B §5.1 (FR-001): native provider iteration for OpenAI-compatible
   * endpoints. Chunks stream through the shared parser generator; the local
   * path performs no transport retry, so every event is a chunk. Cancelling
   * iteration aborts/cancels the underlying request via the parser's
   * finally-cleanup.
   */
  async *streamEvents(
    request: OpenAIChatCompletionRequest,
    options?: ChatProviderIterationOptions
  ): AsyncGenerator<ChatProviderStreamEvent, void, void> {
    const payload = buildStreamingPayload({
      ...request,
      model: this.resolveModel(request.model),
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
    for await (const chunk of this.streamParser.parseBodyStream(
      res,
      options?.signal
    )) {
      yield { type: "chunk", chunk };
    }
  }

  /** @deprecated Callback facade — consumes streamEvents() (one impl). */
  async stream(
    request: OpenAIChatCompletionRequest,
    onChunk: (chunk: OpenAIChatCompletionChunk) => void,
    options?: OpenAIChatCompletionStreamOptions
  ): Promise<void> {
    for await (const event of this.streamEvents(request, {
      signal: options?.signal,
    })) {
      if (event.type === "chunk") {
        onChunk(event.chunk);
      }
    }
  }
}
