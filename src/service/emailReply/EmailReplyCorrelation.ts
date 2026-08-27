/**
 * Correlation ID connecting one draft workflow's events across context,
 * classification, policy, retrieval, generation, validation, edit, approval,
 * claim, SMTP outcome, and reconciliation (FR-024, NFR-004).
 *
 * The id is derived deterministically from the source message so independent
 * stages (generation, approval, delivery) that only share the message id still
 * produce the SAME correlation id without passing state around.
 */
export const CORRELATION_ID_PREFIX = "erx";

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
