// src/modules/fieldCipher/SecretKeyUnavailableError.ts

/**
 * Thrown when the per-user secret key cannot be obtained from the backend
 * (network failure, not logged in, malformed response).
 *
 * Callers MUST treat this as "I cannot perform crypto safely" —
 * - On WRITE: re-throw or surface to user. Never store plaintext.
 * - On READ:  fail-soft (return null) for the encrypted field and keep rendering.
 */
export class SecretKeyUnavailableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "SecretKeyUnavailableError";
    // Restore prototype chain after ES5 target compilation (tsconfig target)
    Object.setPrototypeOf(this, SecretKeyUnavailableError.prototype);
  }
}
