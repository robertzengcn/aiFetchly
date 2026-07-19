// src/service/AIChatErrorMapper.ts

import { AIProviderError } from "./aiProvider/AIProviderError";

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
    // AIProviderError messages are crafted to be user-safe (auth, network,
    // model-unavailable, etc.). Surface them directly instead of letting the
    // status-number regexes below — which my provider messages don't contain —
    // clobber them with a generic "unexpected error".
    if (err instanceof AIProviderError) {
      return err.message || "AI provider error.";
    }
    const msg = err.message || "Unknown error";
    if (
      /402|Payment Required|insufficient_quota|quota_exceeded|insufficient balance/i.test(
        msg
      )
    ) {
      return QUOTA_EXHAUSTED_SENTINEL;
    }
    if (
      /401|403|Authentication failed: Token expired|Please login again|RefreshTokenInvalidError|refresh token rejected|invalid or expired refresh token|refresh token not found|refresh token has expired|refresh token is invalid/i.test(
        msg
      )
    ) {
      return "Please sign in again.";
    }
    if (/404/.test(msg)) {
      return "Selected model is not available.";
    }
    if (/503/.test(msg)) {
      return "No chat model is configured on the AI server.";
    }
    // HTTP 413: the request body exceeded the AI server's max size. Images
    // are downscaled client-side before upload, so this is now rare — but
    // surface a clear, actionable message instead of "unexpected error"
    // if a tight server limit or a large non-image payload still trips it.
    if (/413|Request Entity Too Large|Payload Too Large/i.test(msg)) {
      return "The attachment is too large for the AI server. Please try a smaller image or file.";
    }
    if (/Failed to fetch|NetworkError|ECONNREFUSED|fetch failed/i.test(msg)) {
      return "Could not connect to the AI server.";
    }
    // Transient server-side issues: empty responses, finish_reason=error,
    // rate limits, timeouts, and 502s. These are recoverable by retrying
    // after a short wait, so surface a clear, actionable message instead of
    // the generic "unexpected error" fallback.
    if (
      /finish_reason=error|empty response|no finish reason|transient server|rate limit|timeout|\b502\b|AI server error code=5\d\d|database connection is not open/i.test(
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
