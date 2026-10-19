/**
 * Correlation IDs connecting one draft workflow's events across context,
 * classification, policy, retrieval, generation, validation, edit, approval,
 * claim, SMTP outcome, and reconciliation (FR-024, NFR-004).
 *
 * Two distinct identifiers (B11):
 *  - {@link correlationIdForMessage}: a DETERMINISTIC per-MESSAGE workflow id.
 *    Stable across stages that only share the message id (generation,
 *    approval, delivery) without passing state around. Used as the
 *    `messageCorrelationId` audit field so all events for one inbound
 *    message — across many invocations — can be grouped.
 *  - {@link newRequestCorrelationId}: a fresh per-INVOCATION (per-request)
 *    id allocated at the entry boundary of `createDraft` / `sendReply`. Two
 *    independent invocations for the same message get DISTINCT request ids,
 *    so one invocation's classification, fallback, correction, denial, and
 *    audit events can be told apart from another's. Used as the
 *    `correlationId` audit field and surfaced in the returned result.
 *
 * Both ids are non-cryptographic (correlation only — not secrets).
 */
export const CORRELATION_ID_PREFIX = "erx";
export const REQUEST_CORRELATION_ID_PREFIX = "erx-req";

/** Stable per-message workflow correlation id (deterministic, no clock). */
export function correlationIdForMessage(messageId: number): string {
  // Simple, stable, non-cryptographic mixing (correlation only — not a secret).
  let h = 0x811c9dc5 ^ messageId;
  h = Math.imul(h, 0x01000193) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491) >>> 0;
  h ^= h >>> 13;
  return `${CORRELATION_ID_PREFIX}-${messageId.toString(36)}-${h.toString(36)}`;
}

/**
 * Monotonic counter for request correlation ids. Combined with randomness so
 * two near-simultaneous invocations do not collide even if the random
 * component ties. The counter is process-local; cross-process uniqueness is
 * not required (the prefix + randomness is enough for log/audit grouping).
 */
let requestCounter = 0;

/**
 * Allocate a fresh per-invocation request correlation id (B11). Each call
 * returns a distinct id; all audit events and the returned result for ONE
 * invocation carry the same id. Non-cryptographic.
 */
export function newRequestCorrelationId(): string {
  requestCounter = (requestCounter + 1) >>> 0;
  // Math.random is fine here — this is application source, not a deterministic
  // workflow script (those forbid Math.random because it breaks resume).
  const rand = Math.random().toString(36).slice(2, 10);
  return `${REQUEST_CORRELATION_ID_PREFIX}-${requestCounter.toString(36)}-${rand}`;
}

