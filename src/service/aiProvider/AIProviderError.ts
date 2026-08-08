/**
 * Categorized error raised by the OpenAI-compatible provider client. The
 * `code` lets the chat layer map failures to user-friendly messages without
 * parsing free text. The raw response body is bounded so diagnostics never
 * leak large payloads (and never the API key, which is only ever in headers).
 */
export type AIProviderErrorCode =
  | "network"
  | "auth"
  | "not_found"
  | "rate_limit"
  | "server_error"
  | "invalid_config"
  | "model_unavailable"
  | "unsupported"
  | "unknown";

/** Hard cap on response body retained for diagnostics. */
const MAX_ERROR_BODY_BYTES = 8 * 1024;

export class AIProviderError extends Error {
  readonly status?: number;
  readonly code: AIProviderErrorCode;

  constructor(
    message: string,
    code: AIProviderErrorCode,
    options: { status?: number; cause?: unknown } = {}
  ) {
    super(message);
    this.name = "AIProviderError";
    this.code = code;
    if (typeof options.status === "number") {
      this.status = options.status;
    }
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** Bound a response body to MAX_ERROR_BODY_BYTES for safe diagnostics. */
export function boundBody(body: string): string {
  if (body.length <= MAX_ERROR_BODY_BYTES) {
    return body;
  }
  return `${body.slice(0, MAX_ERROR_BODY_BYTES)}…<truncated>`;
}

/**
 * Map a non-OK HTTP response (and optional parsed body hint) to an
 * `AIProviderError` with an appropriate code and user-safe message.
 */
export async function toProviderError(
  res: Response,
  context: { endpoint?: string; model?: string } = {}
): Promise<AIProviderError> {
  const rawBody = await res.text().catch(() => "");
  const body = boundBody(rawBody);
  const lower = body.toLowerCase();

  // Model-not-found signals from various providers.
  if (
    (res.status === 404 || res.status === 400) &&
    /model.*(not found|not available|does not exist)/i.test(body)
  ) {
    return new AIProviderError(
      "The selected model is not available from this provider. Choose another model or update the provider configuration.",
      "model_unavailable",
      { status: res.status }
    );
  }

  // Tool-unsupported rejections (e.g. provider rejects tool_choice).
  if (res.status === 400 && /\b(tools?|functions?)\b/i.test(body)) {
    return new AIProviderError(
      "The selected provider does not support this request (e.g. tool calling).",
      "unsupported",
      { status: res.status }
    );
  }

  switch (res.status) {
    case 401:
    case 403:
      return new AIProviderError(
        "AI provider authentication failed. Check your API key.",
        "auth",
        { status: res.status }
      );
    case 404:
      return new AIProviderError(
        `AI provider endpoint was not found${
          context.endpoint ? ` (${context.endpoint})` : ""
        }. Check the base URL.`,
        "not_found",
        { status: res.status }
      );
    case 429:
      return new AIProviderError(
        "AI provider rate limit reached. Try again shortly.",
        "rate_limit",
        { status: res.status }
      );
    default:
      if (res.status >= 500 && res.status < 600) {
        return new AIProviderError(
          "AI provider returned a server error. Try again later.",
          "server_error",
          { status: res.status }
        );
      }
      return new AIProviderError(
        `AI provider returned ${res.status}${
          body ? `: ${lower.slice(0, 200)}` : ""
        }.`,
        "unknown",
        { status: res.status }
      );
  }
}

/** Map a network/transport error (no response) to a provider error. */
export function toNetworkProviderError(err: unknown): AIProviderError {
  // Already-categorized provider errors (e.g. a response timeout we raised
  // intentionally) pass through unchanged so their message survives.
  if (err instanceof AIProviderError) {
    return err;
  }
  if (err instanceof Error && err.name === "AbortError") {
    // Preserve abort semantics; rethrow rather than recategorize upstream.
    throw err;
  }
  return new AIProviderError(
    "Could not connect to the AI provider. Check that the provider is running and the base URL is correct.",
    "network",
    { cause: err }
  );
}
