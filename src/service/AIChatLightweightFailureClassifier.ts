// src/service/AIChatLightweightFailureClassifier.ts
//
// Central, deterministic failure classification for the lightweight route.
// Converts typed HTTP/provider/parser failures into
// {@link AIChatLightweightFailureReason}. Workload call sites must never use
// message substring matching.
//
// Classification matrix (tech-design §10):
//   server code small_model_unavailable / HTTP 404   -> small_model_unavailable
//   HTTP 401/403 after refresh                        -> authentication
//   HTTP 402 or known quota code                       -> quota
//   HTTP 429                                           -> rate_limit (retry-safe once)
//   HTTP 500/502/503/504                               -> server_error (retry once)
//   small-route context error                         -> context_overflow
//   HTTP 400/422 other                                 -> invalid_request
//   empty/invalid summary                              -> invalid_output (domain policy)
//   AbortError with caller signal aborted              -> cancelled
//   client timeout after fetch began                    -> timeout_ambiguous
//   connection reset/unknown fetch rejection           -> network_ambiguous
//   DB transaction failure                              -> persistence_failure
import type { AIChatLightweightFailureReason } from "@/service/AIChatLightweightTypes";
import { HttpResponseError } from "@/modules/lib/httpResponseError";
import { AIProviderError } from "@/service/aiProvider/AIProviderError";

export interface ClassifiedLightweightFailure {
  readonly reason: AIChatLightweightFailureReason;
  readonly definitive: boolean;
  readonly status?: number;
  readonly serverCode?: string;
  readonly retryAfterMs?: number;
  readonly message: string;
}

/**
 * Known server error codes that identify the small route as unavailable.
 * Matched case-insensitively against `HttpResponseError.serverCode`.
 */
const SMALL_MODEL_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "small_model_unavailable",
  "small_model_not_configured",
]);

/**
 * Heuristic: status codes whose response text indicates a context-length
 * rejection. The server is authoritative, but a typed code is preferred; this
 * only applies when no stable server code is present.
 */
const CONTEXT_OVERFLOW_STATUS_CODES: ReadonlySet<number> = new Set([]);

/**
 * Classify a thrown value from the lightweight completion path into a typed
 * reason. Never throws — unknown shapes collapse to `unknown` / `network_ambiguous`.
 *
 * The caller is responsible for deciding whether an `AbortError` corresponds to
 * caller cancellation (pass `callerSignal` so the classifier can confirm the
 * caller's signal aborted, not an internal timeout).
 */
export function classifyLightweightFailure(
  error: unknown,
  callerSignal?: AbortSignal
): ClassifiedLightweightFailure {
  // Caller cancellation is checked first and definitively.
  if (callerSignal?.aborted) {
    return {
      reason: "cancelled",
      definitive: true,
      message: "Lightweight completion cancelled by caller.",
    };
  }

  // Typed hosted HTTP error (HttpClient._fetchJSON boundary).
  if (error instanceof HttpResponseError) {
    return classifyHttpResponseError(error);
  }

  // Local/custom provider error.
  if (error instanceof AIProviderError) {
    return classifyProviderError(error);
  }

  // Fetch-level abort: distinguish caller cancellation from a timeout. A DOMException
  // named "AbortError" that was NOT the caller's signal is treated as an ambiguous
  // timeout (the request may have completed upstream).
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      reason: "timeout_ambiguous",
      definitive: false,
      message: "Lightweight completion aborted (possible timeout).",
    };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return {
      reason: "timeout_ambiguous",
      definitive: false,
      message: "Lightweight completion aborted (possible timeout).",
    };
  }

  // Network/connection failures are ambiguous: the server may have completed the
  // request even though the client never received the response.
  const message =
    error instanceof Error ? error.message : String(error ?? "unknown error");
  const lower = message.toLowerCase();
  if (
    lower.includes("fetch failed") ||
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("socket hang up") ||
    lower.includes("network request failed") ||
    lower.includes("enotfound")
  ) {
    return {
      reason: "network_ambiguous",
      definitive: false,
      message,
    };
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return {
      reason: "timeout_ambiguous",
      definitive: false,
      message,
    };
  }

  return {
    reason: "unknown",
    definitive: false,
    message,
  };
}

function classifyHttpResponseError(
  error: HttpResponseError
): ClassifiedLightweightFailure {
  const { status, serverCode, retryAfterMs } = error;

  // Stable server code takes precedence.
  if (
    typeof serverCode === "string" &&
    SMALL_MODEL_UNAVAILABLE_CODES.has(serverCode.toLowerCase())
  ) {
    return {
      reason: "small_model_unavailable",
      definitive: true,
      status,
      serverCode,
      message: error.message,
    };
  }

  // 404 with no code: the alias is not configured on this server.
  if (status === 404) {
    return {
      reason: "small_model_unavailable",
      definitive: true,
      status,
      serverCode,
      message: error.message,
    };
  }

  if (status === 401 || status === 403) {
    return {
      reason: "authentication",
      definitive: true,
      status,
      serverCode,
      message: error.message,
    };
  }
  if (status === 402) {
    return {
      reason: "quota",
      definitive: true,
      status,
      serverCode,
      message: error.message,
    };
  }
  if (status === 429) {
    return {
      reason: "rate_limit",
      definitive: true,
      status,
      serverCode,
      retryAfterMs,
      message: error.message,
    };
  }
  if (status >= 500 && status < 600) {
    return {
      reason: "server_error",
      definitive: true,
      status,
      serverCode,
      message: error.message,
    };
  }
  if (CONTEXT_OVERFLOW_STATUS_CODES.has(status)) {
    return {
      reason: "context_overflow",
      definitive: true,
      status,
      serverCode,
      message: error.message,
    };
  }
  // 400 / 422 / other 4xx: developer-visible invalid request.
  if (status >= 400 && status < 500) {
    return {
      reason: "invalid_request",
      definitive: true,
      status,
      serverCode,
      message: error.message,
    };
  }
  return {
    reason: "unknown",
    definitive: false,
    status,
    serverCode,
    message: error.message,
  };
}

function classifyProviderError(
  error: AIProviderError
): ClassifiedLightweightFailure {
  const { code, status } = error;
  if (code === "auth") {
    return {
      reason: "authentication",
      definitive: true,
      status,
      message: error.message,
    };
  }
  if (code === "not_found" || code === "model_unavailable") {
    // For a local provider this is a real model-not-found, NOT a small-model
    // route problem (the alias is never sent to local providers). Classify as
    // invalid_request so the caller surfaces a clear error without fallback.
    return {
      reason: "invalid_request",
      definitive: true,
      status,
      message: error.message,
    };
  }
  if (code === "rate_limit") {
    return {
      reason: "rate_limit",
      definitive: true,
      status,
      message: error.message,
    };
  }
  if (code === "server_error") {
    return {
      reason: "server_error",
      definitive: true,
      status,
      message: error.message,
    };
  }
  if (code === "network") {
    return {
      reason: "network_ambiguous",
      definitive: false,
      status,
      message: error.message,
    };
  }
  return {
    reason: "unknown",
    definitive: false,
    status,
    message: error.message,
  };
}

/** True when a reason is safe to retry once on the same small route. */
export function isSameRouteRetryable(
  reason: AIChatLightweightFailureReason
): boolean {
  return reason === "rate_limit" || reason === "server_error";
}

/** True when a reason permits the one allowed normal-model fallback (compact only). */
export function allowsNormalFallback(
  reason: AIChatLightweightFailureReason
): boolean {
  return (
    reason === "small_model_unavailable" ||
    reason === "context_overflow" ||
    reason === "invalid_output" ||
    reason === "model_specific_overload"
  );
}
