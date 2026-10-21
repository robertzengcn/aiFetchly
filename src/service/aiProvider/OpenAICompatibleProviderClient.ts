import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIChatCompletionChunk,
  OpenAIModelsResponse,
} from "@/api/aiChatApi";
import type { LocalAIProviderConfig } from "@/entityTypes/aiProviderTypes";
import type {
  ChatProviderClient,
  OpenAIChatCompletionOptions,
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
 * Time-to-response-body budget for non-streaming completions (B13). Once
 * headers arrive the headers timer is cleared, but a provider that sends
 * headers then stalls mid-body would otherwise hang `res.json()` forever.
 * This second-phase timer bounds the body read. Streaming is exempt — the
 * caller owns the abort signal for a stream and a short body timeout would
 * kill legitimate long completions.
 */
const LOCAL_PROVIDER_BODY_TIMEOUT_MS = 60_000;

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
  private readonly bodyTimeoutMs: number;

  constructor(
    private readonly config: LocalAIProviderConfig,
    private readonly apiKey: string,
    fetchImpl?: FetchImpl,
    streamParser?: OpenAIStreamParser,
    responseTimeoutMs: number = LOCAL_PROVIDER_RESPONSE_TIMEOUT_MS,
    bodyTimeoutMs: number = LOCAL_PROVIDER_BODY_TIMEOUT_MS
  ) {
    // Default to the global fetch; capture it once so tests can inject a stub.
    this.fetchImpl = fetchImpl ?? fetch;
    this.streamParser = streamParser ?? new OpenAIStreamParser();
    this.responseTimeoutMs = responseTimeoutMs;
    this.bodyTimeoutMs = bodyTimeoutMs;
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
    options?: OpenAIChatCompletionOptions
  ): Promise<OpenAIChatCompletionResponse> {
    const payload = buildNonStreamingPayload({
      ...request,
      model: this.resolveModel(request.model),
    });
    // B13: ONE AbortController spans both the response-headers phase and the
    // response-body phase. Its signal is the one passed to `fetch` AND the one
    // a real fetch uses to abort an in-flight `res.json()` body read — so a
    // provider that sends headers then stalls mid-body still aborts within the
    // configured body timeout (or the smaller remaining aggregate budget when
    // `callBudgetMs` is set). Each phase arms a fresh timer on the SAME
    // controller; the headers timer is cleared once headers arrive so a
    // legitimate slow body is not killed by the headers budget, and the body
    // timer is cleared once `res.json()` resolves. (Inlined rather than reusing
    // fetchWithResponseTimeout because that helper allocates its own internal
    // controller and clears its timer once headers arrive — leaving no live
    // signal for the body phase.)
    const deadline =
      request.callBudgetMs === undefined
        ? Number.POSITIVE_INFINITY
        : Date.now() + request.callBudgetMs;
    const controller = new AbortController();
    const headersTimeout = Math.max(
      0,
      Math.min(deadline - Date.now(), this.responseTimeoutMs)
    );
    let headersTimer: ReturnType<typeof setTimeout> | undefined;
    if (Number.isFinite(headersTimeout)) {
      if (headersTimeout === 0) {
        controller.abort();
      } else {
        headersTimer = setTimeout(() => controller.abort(), headersTimeout);
      }
    }
    // T04 (merged from test): an external caller-provided AbortSignal must be
    // able to abort an in-flight completion. The B13 inline controller is the
    // single fetch signal, so the caller signal is linked in: an abort on the
    // caller's signal aborts the inline controller (and is therefore
    // indistinguishable from a local deadline abort for fetch), while local
    // deadline aborts never propagate back to the caller's signal. The
    // listener is removed in the body-phase finally block below so a
    // long-lived caller signal is not retained after this call returns.
    const callerSignal = options?.signal;
    const abortFromCaller = (): void => controller.abort();
    if (callerSignal !== undefined) {
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        callerSignal.addEventListener("abort", abortFromCaller, {
          once: true,
        });
      }
    }
    let res: Response;
    try {
      res = await this.fetchImpl(this.url("/chat/completions"), {
        method: "POST",
        headers: this.jsonHeaders("application/json"),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      // Headers-phase abort: the timer fired (budget elapsed) or a genuine
      // network/transport failure. A timeout surfaces as a categorized network
      // error so the generation service wraps it as a transport failure (not a
      // validation strike); any other error is normalized.
      if (controller.signal.aborted && headersTimer !== undefined) {
        throw new AIProviderError(
          "The AI provider took too long to respond. Check that it is running and not overloaded.",
          "network"
        );
      }
      throw toNetworkProviderError(err);
    } finally {
      if (headersTimer !== undefined) {
        clearTimeout(headersTimer);
      }
    }
    // R17: the body-phase timer covers BOTH the error-body read (non-2xx →
    // toProviderError → res.text()) and the success-body read (res.json()).
    // Previously the !res.ok branch ran BEFORE the body timer was armed, so a
    // provider that sent non-2xx headers then stalled the error body hung
    // toProviderError's res.text() beyond the call/invocation budget. Now the
    // SAME controller's timer is live through successful AND error
    // response-body consumption; an abort during either read surfaces as a
    // network timeout (classified independently of compatibility — never a
    // no-hint retry).
    const remaining = deadline - Date.now();
    const bodyTimeout = Number.isFinite(remaining)
      ? Math.min(remaining, this.bodyTimeoutMs)
      : this.bodyTimeoutMs;
    let bodyTimer: ReturnType<typeof setTimeout> | undefined;
    if (bodyTimeout <= 0) {
      controller.abort();
    } else {
      bodyTimer = setTimeout(() => controller.abort(), bodyTimeout);
    }
    try {
      if (!res.ok) {
        // toProviderError reads res.text(), which rejects on abort but is
        // swallowed by its .catch(() => "") — so a stalled non-2xx body that
        // the timer aborts resolves here as a status-classified error with an
        // empty body. If the controller aborted during the read, reclassify as
        // a network timeout so the generation service treats it as a transport
        // failure (independent of compatibility), never a no-hint retry.
        const providerErr = await toProviderError(res, {
          endpoint: "/chat/completions",
          model: payload.model,
        });
        if (controller.signal.aborted && bodyTimer !== undefined) {
          throw new AIProviderError(
            "The AI provider sent response headers but stalled before finishing the body. Check that it is not overloaded.",
            "network"
          );
        }
        throw providerErr;
      }
      return (await res.json()) as OpenAIChatCompletionResponse;
    } catch (err) {
      // An abort here is a body-phase timeout (the headers phase already
      // succeeded). Surface it as a network error so the generation service
      // wraps it as a transport failure (not a validation strike).
      if (controller.signal.aborted && bodyTimer !== undefined) {
        throw new AIProviderError(
          "The AI provider sent response headers but stalled before finishing the body. Check that it is not overloaded.",
          "network"
        );
      }
      throw toNetworkProviderError(err);
    } finally {
      if (bodyTimer !== undefined) {
        clearTimeout(bodyTimer);
      }
      // T04: detach the caller-signal listener once the call settles so a
      // long-lived caller signal (e.g. one shared by a whole query loop) does
      // not accumulate listeners across completions.
      if (callerSignal !== undefined) {
        callerSignal.removeEventListener("abort", abortFromCaller);
      }
    }
  }

  async stream(
    request: OpenAIChatCompletionRequest,
    onChunk: (chunk: OpenAIChatCompletionChunk) => void,
    options?: OpenAIChatCompletionStreamOptions
  ): Promise<void> {
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
      // R17: a stalled non-2xx error body on the streaming path would hang
      // toProviderError's res.text() — fetchWithResponseTimeout cleared its
      // headers timer once the Response arrived, and stream() armed no body
      // timer at all. Bound the error-body read by RACING it against a deadline
      // rejection for the configured body timeout (the streaming path carries
      // no callBudgetMs, so the per-phase body timeout is the only budget). The
      // timer is independent of the fetch signal (which the already-returned
      // internal controller owns), so the race — not a signal abort — enforces
      // the deadline. The timeout surfaces as a network error, classified
      // independently of compatibility (never a no-hint retry).
      let errorTimer: ReturnType<typeof setTimeout> | undefined;
      const deadlineRejection = new Promise<never>((_resolve, reject) => {
        errorTimer = setTimeout(() => {
          reject(
            new AIProviderError(
              "The AI provider sent response headers but stalled before finishing the body. Check that it is not overloaded.",
              "network"
            )
          );
        }, this.bodyTimeoutMs);
      });
      try {
        // A settled (fast) error body wins the race and its status-classified
        // error propagates; a stalled body loses to the deadline rejection.
        throw await Promise.race([
          toProviderError(res, {
            endpoint: "/chat/completions",
            model: payload.model,
          }),
          deadlineRejection,
        ]);
      } finally {
        if (errorTimer !== undefined) {
          clearTimeout(errorTimer);
        }
      }
    }
    await this.streamParser.consume(res, onChunk, options?.signal);
  }
}
