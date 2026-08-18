import { log } from "@/modules/Logger";
// src/service/AIChatErrorMapper.ts

import { AIProviderError } from "./aiProvider/AIProviderError";
import { isAIChatRecoverableError } from "./AIChatRecoveryTypes";

/**
 * Sentinel returned by {@link userSafeError} when the AI server reports
 * HTTP 402 / "Payment Required" — i.e. the user's subscription token quota
 * is exhausted. The renderer detects this and shows a translated, actionable
 * recharge prompt instead of the raw sentinel.
 */
export const QUOTA_EXHAUSTED_SENTINEL = "QUOTA_EXHAUSTED";

/**
 * Broad pattern for transient, retryable server-side failures: empty
 * responses, finish_reason=error, rate limits, timeouts, 502s, AI-server 5xx
 * codes, and the SQLite "database connection is not open" hiccup. These
 * recover on a fresh attempt after a short backoff. Drives the user-facing
 * message only — the query loop's auto-retry decision uses the narrower
 * {@link isContentLevelTransientError} to avoid stacking on top of the
 * streaming HTTP client's own retry layer.
 */
const TRANSIENT_ERROR_PATTERN =
  /finish_reason=error|empty response|no finish reason|transient server|rate limit|timeout|\b502\b|AI server error code=5\d\d|database connection is not open/i;

/**
 * Returns true when the error represents a transient, retryable AI-server
 * failure (overload, rate limit, timeout, empty/error response, 5xx). Aborts
 * and non-Error values are never retryable. Used by {@link userSafeError} to
 * pick the user-facing message. NOTE: do NOT use this to decide the query
 * loop's auto-retry — use {@link isContentLevelTransientError} instead, so
 * transport-layer conditions (502/429/timeout) are not retried at two layers.
 */
export function isTransientRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return false;
  if (isAIChatRecoverableError(err)) {
    return (
      err.reason === "server_error" ||
      err.reason === "overload" ||
      err.reason === "rate_limit" ||
      err.reason === "timeout"
    );
  }
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
 * Sentinel returned by {@link userSafeError} when the hosted AI server reports
 * HTTP 401/403 (session/access token expired or rejected). The main process
 * signs the user out and navigates to login; the renderer maps this sentinel
 * to a short translated message if the UI is still visible briefly.
 */
export const AUTH_EXPIRED_SENTINEL = "AUTH_EXPIRED";

const AUTH_EXPIRED_MESSAGE_PATTERN =
  /401|403|Authentication failed|Please login again|RefreshTokenInvalidError|refresh token rejected|invalid or expired refresh token|refresh token not found|refresh token has expired|refresh token is invalid|Forbidden/i;

/**
 * True when the failure means the hosted app session is no longer valid
 * (AI server 401/403, refresh-token rejection, or classified auth recovery
 * error). Local provider API-key failures ({@link AIProviderError}) are
 * excluded — those should not force an app re-login.
 */
export function isAuthExpiredError(err: unknown): boolean {
  if (err instanceof AIProviderError) {
    return false;
  }
  if (isAIChatRecoverableError(err) && err.reason === "auth") {
    return true;
  }
  if (err instanceof Error) {
    if (err.name === "RefreshTokenInvalidError") {
      return true;
    }
    return AUTH_EXPIRED_MESSAGE_PATTERN.test(err.message || "");
  }
  if (typeof err === "string") {
    return AUTH_EXPIRED_MESSAGE_PATTERN.test(err);
  }
  return false;
}

/**
 * Build a single-line diagnostic for an unknown error: the top-level error's
 * name, message, code, and stack, plus its `cause` chain. Errors that slip
 * through user-safe mapping (e.g. undici's bare "terminated") are logged with
 * this detail so the origin is traceable in the app logs.
 */
export function describeErrorDetail(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  let depth = 0;
  while (current !== undefined && current !== null && depth < 6) {
    const label = depth === 0 ? "error" : `cause[${depth - 1}]`;
    if (current instanceof Error) {
      parts.push(
        `${label}: name=${current.name} message=${JSON.stringify(
          current.message
        )}`
      );
      const code = (current as { code?: unknown }).code;
      if (code !== undefined) {
        parts.push(`${label}.code=${JSON.stringify(code)}`);
      }
      if (depth === 0 && current.stack) {
        parts.push(`${label}.stack=${current.stack}`);
      }
    } else {
      parts.push(`${label}: ${String(current)}`);
    }
    current = (current as { cause?: unknown }).cause;
    depth += 1;
  }
  return parts.join(" | ");
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
    if (isAuthExpiredError(err)) {
      return AUTH_EXPIRED_SENTINEL;
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
    if (isTransientRetryableError(err)) {
      return "The AI service is busy or had a transient issue. Please try again in a moment.";
    }
    log.error(
      `[ai-chat-v2] unmapped error: ${msg} — ${describeErrorDetail(err)}`
    );
    return "An unexpected error occurred. Please try again.";
  }
  if (typeof err === "string" && isAuthExpiredError(err)) {
    return AUTH_EXPIRED_SENTINEL;
  }
  return "Unknown error";
}
