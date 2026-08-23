/**
 * Typed error thrown by {@link HttpClient._fetchJSON} for non-success HTTP
 * responses that are not authentication (401/403) failures.
 *
 * Before this class, non-success responses threw `new Error(res.statusText)`,
 * which discarded the status code, response body, headers, and any server
 * error code. A centralized fallback policy (e.g. small-model routing) cannot
 * safely distinguish authentication, missing small-model configuration,
 * overload, context overflow, or a malformed request without typed failure
 * data at this boundary.
 *
 * The response body is bounded (≤ {@link MAX_RESPONSE_BODY_BYTES}) and is
 * never logged — provider messages can contain request fragments or sensitive
 * data. Only the parsed `error.code` (when valid JSON) is surfaced via
 * {@link serverCode}.
 */
export class HttpResponseError extends Error {
  /**
   * @param message     - Human-safe summary (typically the status text).
   * @param status      - HTTP status code (e.g. 404, 429, 500).
   * @param responseBody - The bounded response body text. Never logged by the
   *                       throw site; callers must also avoid logging it.
   * @param retryAfterMs - Parsed `Retry-After` header in milliseconds, when
   *                       present and within the upper bound.
   * @param serverCode   - Machine-readable `error.code` from a JSON body, when
   *                       the body parsed as valid JSON with that field.
   */
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: string,
    public readonly retryAfterMs?: number,
    public readonly serverCode?: string
  ) {
    super(message);
    this.name = "HttpResponseError";
  }
}

/**
 * Maximum bytes of a non-success response body that `_fetchJSON` will read and
 * retain on the thrown {@link HttpResponseError}. Bounds memory and keeps
 * potentially sensitive provider payloads out of long-lived objects.
 */
export const MAX_RESPONSE_BODY_BYTES = 16 * 1024; // 16 KiB

/**
 * Maximum `Retry-After` value (in milliseconds) honored by `_fetchJSON`. A
 * server returning an absurd delay must not pin a caller indefinitely; the
 * policy layer decides whether to honor the (capped) value.
 */
export const MAX_RETRY_AFTER_MS = 60_000; // 60 s
