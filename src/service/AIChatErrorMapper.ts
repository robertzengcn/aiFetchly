// src/service/AIChatErrorMapper.ts

/**
 * Sentinel returned by {@link userSafeError} when the AI server reports
 * HTTP 402 / "Payment Required" — i.e. the user's subscription token quota
 * is exhausted. The renderer detects this and shows a translated, actionable
 * recharge prompt instead of the raw sentinel.
 */
export const QUOTA_EXHAUSTED_SENTINEL = "QUOTA_EXHAUSTED";

/**
 * Pattern for transient, retryable server-side failures: empty responses,
 * finish_reason=error, rate limits, timeouts, and 502s. These recover on a
 * fresh attempt after a short backoff, so the query loop auto-retries them
 * and the user-facing mapper translates them into an actionable message
 * instead of the generic "unexpected error" fallback.
 */
const TRANSIENT_ERROR_PATTERN =
  /finish_reason=error|empty response|no finish reason|transient server|rate limit|timeout|\b502\b/i;

/**
 * Returns true when the error represents a transient, retryable AI-server
 * failure (overload, rate limit, timeout, empty/error response). Aborts and
 * non-Error values are never retryable. Used by {@link userSafeError} to pick
 * the user-facing message.
 */
export function isTransientRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return false;
  return TRANSIENT_ERROR_PATTERN.test(err.message || "");
}

/**
 * Narrower pattern for transient failures that originate from the STREAM
 * CONTENT (the HTTP request itself succeeded with 200 OK, but the model's
 * response was empty or signalled finish_reason=error). These are NOT seen
 * by the HTTP transport's own retry layer, so the query loop is the only
 * layer that can recover them.
 *
 * Deliberately excludes rate-limit / timeout / 502 signals: those are
 * transport-layer conditions already retried by the streaming HTTP client
 * (see aiChatApi.isRetryableStreamStatus). Having the query loop retry them
 * too would stack the two layers (up to ~16 requests for one user message).
 */
const STREAM_CONTENT_TRANSIENT_PATTERN =
  /finish_reason=error|empty response|no finish reason/i;

/**
 * Returns true when the error is a transient failure of the model's streamed
 * content (empty response, finish_reason=error) — i.e. a content-level
 * transient that the HTTP transport did NOT already retry. Used by
 * {@link AIChatQueryLoop} to decide whether to auto-retry a failed round
 * without stacking on top of the transport-layer retries.
 */
export function isContentLevelTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return false;
  return STREAM_CONTENT_TRANSIENT_PATTERN.test(err.message || "");
}

/**
 * Map unknown errors to user-safe messages.
 * Raw server bodies, stack traces, and sensitive request details
 * are logged but never surfaced to the renderer.
 */
export function userSafeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError") {
      return "Generation stopped.";
    }
    const msg = err.message || "Unknown error";
    if (
      /402|Payment Required|insufficient_quota|quota_exceeded|insufficient balance/i.test(
        msg
      )
    ) {
      return QUOTA_EXHAUSTED_SENTINEL;
    }
    if (/401|403/.test(msg)) {
      return "Please sign in again.";
    }
    if (/404/.test(msg)) {
      return "Selected model is not available.";
    }
    if (/503/.test(msg)) {
      return "No chat model is configured on the AI server.";
    }
    if (/Failed to fetch|NetworkError|ECONNREFUSED|fetch failed/i.test(msg)) {
      return "Could not connect to the AI server.";
    }
    // Transient server-side issues: empty responses, finish_reason=error,
    // rate limits, timeouts, and 502s. These are recoverable by retrying
    // after a short wait, so surface a clear, actionable message instead of
    // the generic "unexpected error" fallback.
    if (isTransientRetryableError(err)) {
      return "The AI service is busy or had a transient issue. Please try again in a moment.";
    }
    console.error("[ai-chat-v2] unmapped error:", msg);
    return "An unexpected error occurred. Please try again.";
  }
  return "Unknown error";
}
