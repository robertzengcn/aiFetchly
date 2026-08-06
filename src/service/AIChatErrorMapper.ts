// src/service/AIChatErrorMapper.ts

import { User } from "@/modules/user";
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
 * When the hosted AI session has expired, clear local auth and navigate the
 * renderer to the login page (same path as manual sign-out). Fire-and-forget
 * friendly: callers should not block error reporting on this.
 */
export async function redirectToLoginOnAuthExpired(
  err: unknown
): Promise<void> {
  if (!isAuthExpiredError(err)) {
    return;
  }
  try {
    await new User().Signout();
  } catch (signoutError) {
    console.error(
      "[ai-chat] failed to sign out after auth expiry:",
      signoutError
    );
  }
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
    if (
      /finish_reason=error|empty response|no finish reason|transient server|rate limit|timeout|\b502\b|AI server error code=5\d\d|database connection is not open/i.test(
        msg
      )
    ) {
      return "The AI service is busy or had a transient issue. Please try again in a moment.";
    }
    console.error(
      `[ai-chat-v2] unmapped error: ${msg} — ${describeErrorDetail(err)}`
    );
    return "An unexpected error occurred. Please try again.";
  }
  if (typeof err === "string" && isAuthExpiredError(err)) {
    return AUTH_EXPIRED_SENTINEL;
  }
  return "Unknown error";
}
