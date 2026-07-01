// src/service/AIChatErrorMapper.ts

/**
 * Sentinel returned by {@link userSafeError} when the AI server reports
 * HTTP 402 / "Payment Required" — i.e. the user's subscription token quota
 * is exhausted. The renderer detects this and shows a translated, actionable
 * recharge prompt instead of the raw sentinel.
 */
export const QUOTA_EXHAUSTED_SENTINEL = "QUOTA_EXHAUSTED";

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
    if (
      /finish_reason=error|empty response|no finish reason|transient server|rate limit|timeout|\b502\b/i.test(
        msg
      )
    ) {
      return "The AI service is busy or had a transient issue. Please try again in a moment.";
    }
    console.error("[ai-chat-v2] unmapped error:", msg);
    return "An unexpected error occurred. Please try again.";
  }
  return "Unknown error";
}
