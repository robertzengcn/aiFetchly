/**
 * Embedding-related error types for the RAG pipeline.
 *
 * The remote embedding API can refuse a request for account-level reasons
 * (billing/quota exhausted, plan limits, etc.) that the user cannot debug
 * from the raw server message. These helpers detect that class of failure
 * at the boundary and surface a stable, actionable signal that the UI can
 * translate and present clearly.
 */

/**
 * Substrings (case-insensitive) returned by the remote backend that indicate
 * the embedding call was rejected for billing / quota reasons rather than
 * technical failures. Keep this list focused on account/entitlement denials
 * so genuine model or network errors still surface verbatim.
 */
const BILLING_DENIED_SIGNATURES: readonly string[] = [
  "billing reserve failed",
  "billing reserve",
  "insufficient quota",
  "quota exceeded",
  "plan limit reached",
  "payment required",
  "credit balance",
];

/**
 * Marker error thrown when the remote embedding API refuses the request for
 * billing/quota reasons. Carries `isBillingDenied = true` so callers (UI,
 * IPC, tests) can branch on the flag instead of parsing English text.
 */
export class EmbeddingBillingError extends Error {
  public readonly isBillingDenied = true;
  public readonly originalMessage: string;

  constructor(originalMessage: string, friendlyMessage: string) {
    super(friendlyMessage);
    this.name = "EmbeddingBillingError";
    this.originalMessage = originalMessage;
  }
}

/**
 * Type guard: did an unknown error originate as a billing-denial?
 */
export function isEmbeddingBillingError(error: unknown): error is EmbeddingBillingError {
  return (
    error instanceof EmbeddingBillingError ||
    (error !== null &&
      typeof error === "object" &&
      (error as { isBillingDenied?: unknown }).isBillingDenied === true)
  );
}

/**
 * Detect whether a remote embedding API message indicates a billing/quota
 * denial. Case-insensitive substring match against known backend phrases.
 */
export function isBillingDeniedMessage(message: string | undefined | null): boolean {
  if (!message) {
    return false;
  }
  const lower = message.toLowerCase();
  return BILLING_DENIED_SIGNATURES.some((sig) => lower.includes(sig));
}
