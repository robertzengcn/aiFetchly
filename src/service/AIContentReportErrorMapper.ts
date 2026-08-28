import type { AIContentReportErrorCode } from "@/entityTypes/aiContentReportTypes";

/**
 * Maps a thrown error / HTTP status to a safe, localized error code.
 *
 * Mirrors the structure of `src/service/AIChatErrorMapper.ts` but with a
 * report-specific, privacy-safe code set. Never returns raw backend text,
 * stack traces, or parser errors to the caller (PRD FR-5.3, §14.3).
 *
 * The codes correspond 1:1 with `aiContentReport.errors.*` i18n keys so the
 * dialog can render a translated message for every failure mode (PRD FR-5.4).
 */

export interface HttpLikeError {
  /** Numeric HTTP status when available. */
  status?: number;
  /** Whether the failure was a network/transport error (fetch TypeError). */
  isNetwork?: boolean;
  /** Original message — kept for diagnostics only, never shown to the user. */
  message?: string;
}

/**
 * Inspect a thrown value and return a safe error code.
 *
 * Accepts:
 *  - `AIContentReportError` (already coded) — returned as-is.
 *  - An object with `status` (HTTP response) — mapped by status code.
 *  - A fetch `TypeError` ("Failed to fetch" / network) — `network`.
 *  - Anything else — `unknown`.
 */
export function mapReportError(err: unknown): AIContentReportErrorCode {
  // Already-coded error: trust the inner code.
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === "string") {
      return code as AIContentReportErrorCode;
    }
  }

  const http = err as Partial<HttpLikeError>;
  const message =
    typeof (err as { message?: unknown })?.message === "string"
      ? (err as { message: string }).message
      : "";

  // Network / transport failure (fetch throws TypeError on offline/DNS/CORS).
  if (http.isNetwork === true || isNetworkMessage(message)) {
    return "network";
  }

  switch (http.status) {
    case 400:
    case 422:
      return "invalid_evidence";
    case 401:
    case 403:
      return "auth_failed";
    case 413:
      return "payload_too_large";
    case 429:
      return "rate_limited";
    case 503:
      return "service_disabled";
    default:
      if (typeof http.status === "number" && http.status >= 500) {
        return "server_error";
      }
      return "unknown";
  }
}

/** True when the error message indicates a transport-level failure. */
function isNetworkMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("network request failed") ||
    m.includes("econnrefused") ||
    m.includes("enotfound") ||
    m.includes("etimedout") ||
    m.includes("fetch is not defined")
  );
}
