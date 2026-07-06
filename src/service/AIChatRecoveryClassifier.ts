// src/service/AIChatRecoveryClassifier.ts
//
// Maps raw status codes, response bodies, thrown network errors, and
// stream finish reasons into AIChatRecoverableError. Pure: no service
// calls, no settings reads (technical-design §20.2). It MUST NOT decide
// whether to retry — that belongs to AIChatRetryPolicy.
import {
  AIChatRecoverableError,
  type AIChatRecoveryReason,
} from "@/service/AIChatRecoveryTypes";

/** Input for HTTP-status-based classification. */
export interface ClassifyHttpFailureInput {
  readonly status: number;
  readonly statusText?: string;
  readonly responseBody?: string;
  /** Lowercased header map; use parseRetryAfter/parseRateLimitReset separately. */
  readonly headers?: Headers;
}

/** Input for stream-completion classification. */
export interface ClassifyStreamFinishInput {
  readonly finishReason?: string | null;
  readonly fullContent: string;
  readonly sawToolCallDelta: boolean;
  readonly rawToolArguments?: readonly string[];
}

/** Generic header-map shape used by the parsing helpers. */
export type HeaderLookup = {
  get(name: string): string | null | undefined;
};

/**
 * Convert a Headers object (or any get(name)-style lookup) into a plain
 * lowercased-key record. Used to snapshot headers onto AIChatRecoverableError
 * without retaining the live Headers object.
 */
export function snapshotHeaders(
  headers?: HeaderLookup | null
): Readonly<Record<string, string>> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  if (typeof (headers as Headers).forEach === "function") {
    (headers as Headers).forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
  } else {
    // Fallback: best-effort enumeration for non-Header lookups.
    const h = headers as unknown as Record<string, string>;
    for (const k of Object.keys(h)) {
      out[k.toLowerCase()] = h[k];
    }
  }
  return out;
}

/**
 * Parse a Retry-After header value into milliseconds.
 * Accepts either:
 *  - a non-negative integer number of seconds, or
 *  - an HTTP-date (RFC 7231 §7.1.3).
 * Returns undefined when the value is missing or unparseable.
 */
export function parseRetryAfter(value?: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  // Integer seconds form.
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0 && /^\d+$/.test(trimmed)) {
    return Math.min(Math.round(seconds * 1000), MAX_RETRY_AFTER_MS);
  }
  // HTTP-date form.
  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) {
    const delta = date - Date.now();
    if (delta > 0) return Math.min(Math.round(delta), MAX_RETRY_AFTER_MS);
    return 0;
  }
  return undefined;
}

/**
 * Parse a provider rate-limit reset header into milliseconds. Designed to
 * be generic — accepts the anthropic-ratelimit-unified-reset form when
 * present but works for any header whose value is a number of seconds.
 */
export function parseRateLimitReset(value?: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  // Anthropic form: "80" or "80s" meaning seconds. Be permissive.
  const match = /^(\d+(?:\.\d+)?)(s|ms)?$/i.exec(trimmed);
  if (match) {
    const n = Number(match[1]);
    if (!Number.isFinite(n) || n < 0) return undefined;
    const unit = (match[2] || "s").toLowerCase();
    const ms = unit === "ms" ? n : n * 1000;
    return Math.min(Math.round(ms), MAX_RETRY_AFTER_MS);
  }
  // HTTP-date fallback.
  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) {
    const delta = date - Date.now();
    if (delta > 0) return Math.min(Math.round(delta), MAX_RETRY_AFTER_MS);
    return 0;
  }
  return undefined;
}

/** Hard cap so a misbehaving server cannot stall the client indefinitely. */
const MAX_RETRY_AFTER_MS = 5 * 60_000;

/** Patterns that distinguish media overflow from generic prompt overflow. */
const MEDIA_OVERFLOW_PATTERNS: readonly RegExp[] = [
  /image\s+(is\s+)?too\s+large/i,
  /pdf\s+(is\s+)?too\s+large/i,
  /attachment\s+(is\s+)?too\s+large/i,
  /media\s+(payload\s+)?too\s+large/i,
  /file\s+too\s+large/i,
];

/** Body-text patterns that override a generic status classification. */
interface BodyPatternRule {
  readonly pattern: RegExp;
  readonly reason: AIChatRecoveryReason;
}

const BODY_PATTERNS: readonly BodyPatternRule[] = [
  { pattern: /overloaded_error/i, reason: "overload" },
  { pattern: /overloaded/i, reason: "overload" },
  { pattern: /prompt\s+too\s+long/i, reason: "context_overflow" },
  {
    pattern: /input length.*context limit/i,
    reason: "context_overflow",
  },
  {
    pattern: /context\s+limit/i,
    reason: "context_overflow",
  },
  {
    pattern: /max_tokens.*exceed\s+context\s+limit/i,
    reason: "context_overflow",
  },
  { pattern: /max_output_tokens/i, reason: "output_limit" },
];

/**
 * Classifier implementing technical-design §5.3–5.4.
 * Stateless; safe to call concurrently.
 */
export class AIChatRecoveryClassifier {
  /**
   * Classify a thrown value (catch-block input). AbortError → cancelled;
   * common network errno strings → network; timeout strings → timeout;
   * anything carrying a classified reason is passed through; everything
   * else becomes non_recoverable.
   */
  classifyThrown(error: unknown): AIChatRecoverableError {
    if (error instanceof AIChatRecoverableError) {
      return error;
    }
    if (error instanceof Error) {
      const name = error.name;
      if (name === "AbortError") {
        return new AIChatRecoverableError({
          reason: "cancelled",
          message: error.message || "Request aborted",
          originalError: error,
        });
      }
      const text = `${error.name} ${error.message}`.toLowerCase();
      const fromName = this.classifyNameLike(name.toLowerCase());
      if (fromName) {
        return new AIChatRecoverableError({
          reason: fromName,
          message: error.message || name,
          originalError: error,
        });
      }
      const fromText = this.classifyNetworkText(text);
      if (fromText) {
        return new AIChatRecoverableError({
          reason: fromText,
          message: error.message || text,
          originalError: error,
        });
      }
      return new AIChatRecoverableError({
        reason: "non_recoverable",
        message: error.message || "Unknown error",
        originalError: error,
      });
    }
    if (typeof error === "string") {
      const fromText = this.classifyNetworkText(error.toLowerCase());
      if (fromText) {
        return new AIChatRecoverableError({
          reason: fromText,
          message: error,
        });
      }
      return new AIChatRecoverableError({
        reason: "non_recoverable",
        message: error,
      });
    }
    return new AIChatRecoverableError({
      reason: "non_recoverable",
      message: "Unknown non-error thrown value",
      originalError: error,
    });
  }

  /**
   * Classify a non-OK HTTP response. Body text is consulted for finer
   * distinctions (media vs context overflow, overload markers, etc.).
   * Retry-After and rate-limit headers are parsed and attached.
   */
  classifyHttpFailure(input: ClassifyHttpFailureInput): AIChatRecoverableError {
    const { status, statusText, responseBody, headers } = input;
    const body = responseBody ?? "";
    const reason = this.classifyHttpStatus(status, body);
    const retryAfterMs = headers
      ? parseRetryAfter(headers.get("retry-after") ?? undefined)
      : undefined;
    const rateLimitResetMs = headers
      ? parseRateLimitReset(
          headers.get("anthropic-ratelimit-unified-reset") ?? undefined
        ) ?? parseRateLimitReset(headers.get("x-ratelimit-reset") ?? undefined)
      : undefined;
    const headerSnapshot = snapshotHeaders(headers);
    const message = this.composeHttpMessage(status, statusText, body, reason);
    return new AIChatRecoverableError({
      reason,
      status,
      message,
      retryAfterMs,
      rateLimitResetMs,
      responseBody: body,
      headers: headerSnapshot,
    });
  }

  /**
   * Classify the result of a stream that returned chunks but did not
   * yield a usable assistant response. Returns null when the stream
   * finished normally with content.
   */
  classifyStreamFinish(
    input: ClassifyStreamFinishInput
  ): AIChatRecoverableError | null {
    const { finishReason, fullContent, sawToolCallDelta, rawToolArguments } =
      input;
    const fr = (finishReason ?? "").toLowerCase();
    if (fr === "length" || fr === "max_tokens") {
      return new AIChatRecoverableError({
        reason: "output_limit",
        message: "Assistant response was truncated by the output token limit.",
      });
    }
    // Truncated tool-call JSON: model started emitting tool_call deltas
    // but the resulting arguments are not parseable JSON.
    if (sawToolCallDelta && rawToolArguments && rawToolArguments.length > 0) {
      const anyTruncated = rawToolArguments.some((a) => looksTruncatedJson(a));
      if (anyTruncated) {
        return new AIChatRecoverableError({
          reason: "output_limit",
          message:
            "Tool call arguments were truncated by the output token limit.",
        });
      }
    }
    if (fr === "error" && fullContent.trim().length === 0) {
      return new AIChatRecoverableError({
        reason: "server_error",
        message: "AI server returned finish_reason=error with no content.",
      });
    }
    if (fullContent.trim().length === 0 && !finishReason) {
      return new AIChatRecoverableError({
        reason: "server_error",
        message: "AI server returned an empty response with no finish reason.",
      });
    }
    return null;
  }

  // -- internals ----------------------------------------------------------

  private classifyHttpStatus(
    status: number,
    body: string
  ): AIChatRecoveryReason {
    // Body patterns take precedence for finer-grained classification.
    const bodyReason = this.matchBodyPattern(body);
    switch (status) {
      case 401:
      case 403:
        return "auth";
      case 402:
        return "quota";
      case 408:
      case 409:
        return "timeout";
      case 413:
        // Media-specific body patterns take precedence over generic
        // context_overflow; otherwise default to context_overflow.
        return this.matchesAny(body, MEDIA_OVERFLOW_PATTERNS)
          ? "media_overflow"
          : "context_overflow";
      case 429:
        return "rate_limit";
      case 404:
      case 410:
        return "model_unavailable";
      case 529:
        return "overload";
      default:
        if (status >= 500 && status < 600) {
          return bodyReason ?? "server_error";
        }
        // Allow body patterns to override truly unknown statuses too.
        return bodyReason ?? "non_recoverable";
    }
  }

  private matchBodyPattern(body: string): AIChatRecoveryReason | undefined {
    if (!body) return undefined;
    for (const rule of BODY_PATTERNS) {
      if (rule.pattern.test(body)) return rule.reason;
    }
    return undefined;
  }

  private matchesAny(text: string, patterns: readonly RegExp[]): boolean {
    return patterns.some((p) => p.test(text));
  }

  private classifyNameLike(name: string): AIChatRecoveryReason | undefined {
    if (name === "aborterror") return "cancelled";
    if (name === "timeouterror") return "timeout";
    return undefined;
  }

  private classifyNetworkText(text: string): AIChatRecoveryReason | undefined {
    if (/(^|\W)econnreset(\W|$)/.test(text)) return "network";
    if (/(^|\W)epipe(\W|$)/.test(text)) return "network";
    if (/(^|\W)econnrefused(\W|$)/.test(text)) return "network";
    if (/fetch\s+failed/.test(text)) return "network";
    if (/failed\s+to\s+fetch/.test(text)) return "network";
    if (/network\s+(error|request\s+failed)/.test(text)) return "network";
    if (/(^|\W)etimedout(\W|$)/.test(text)) return "timeout";
    if (/timeout\b/.test(text)) return "timeout";
    if (/socket\s+hang\s+up/.test(text)) return "network";
    return undefined;
  }

  private composeHttpMessage(
    status: number,
    statusText: string | undefined,
    body: string,
    reason: AIChatRecoveryReason
  ): string {
    const parts: string[] = [`HTTP ${status}`];
    if (statusText) parts.push(statusText);
    parts.push(`(${reason})`);
    if (body) {
      const trimmed = body.trim();
      if (trimmed.length > 0) {
        parts.push(trimmed.slice(0, 240));
      }
    }
    return parts.join(" ");
  }
}

/**
 * Detect JSON tool arguments that look like they were cut off mid-stream.
 * Used by the classifier and the loop's output-token recovery layer.
 * Conservative: only flags strings whose braces/brackets are unbalanced.
 */
export function looksTruncatedJson(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  const startsObj = trimmed.startsWith("{");
  const startsArr = trimmed.startsWith("[");
  if (!startsObj && !startsArr) return false;
  const endsObj = trimmed.endsWith("}");
  const endsArr = trimmed.endsWith("]");
  if (startsObj && endsObj) return false;
  if (startsArr && endsArr) return false;
  // Looks like JSON that opened but didn't close → truncated.
  return true;
}
