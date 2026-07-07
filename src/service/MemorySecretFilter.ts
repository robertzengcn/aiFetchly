/**
 * Shared secret-like content detection for AI memory features.
 *
 * Used by both the user-memory and workspace-memory stacks to reject memories
 * that look like credentials, tokens, cookies, or other secrets — both for
 * automatic extraction (auto-dream) and for manual creation.
 *
 * NOTE: the final pattern `/[A-Za-z0-9+/]{40,}={0,2}/` is intentionally
 * aggressive and will also match long base64 blobs, SHA hashes, and long URLs.
 * This is an acceptable trade-off for v1 secret blocking — when in doubt we
 * refuse to store. Callers that legitimately need to store long opaque strings
 * (e.g. a commit SHA as a reference) should instruct the user to phrase it as
 * prose rather than a raw blob.
 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{10,}/,
  /api[_-]?key/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /password/i,
  /cookie/i,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
  /[A-Za-z0-9+/]{40,}={0,2}/,
];

export function looksSecretlike(s: string | null | undefined): boolean {
  if (!s) return false;
  return SECRET_PATTERNS.some((re) => re.test(s));
}

const REDACTED = "[REDACTED]";

/** Replace anything matching a secret pattern with `[REDACTED]`. */
export function redactSecrets(s: string | null | undefined): string {
  if (!s) return "";
  let out = s;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, REDACTED);
  }
  return out;
}
