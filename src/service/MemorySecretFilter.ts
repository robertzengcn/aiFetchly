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
  /\bsk-[A-Za-z0-9_-]{10,}\b/,
  /api[\s_-]?key/i,
  /access[\s_-]?token/i,
  /refresh[\s_-]?token/i,
  /authorization\s*:\s*bearer\s+\S+/i,
  /\bbearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}\b/i,
  /password/i,
  /cookie/i,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /[A-Za-z0-9+/]{40,}={0,2}/,
];

export function looksSecretlike(s: string | null | undefined): boolean {
  if (!s) return false;
  return SECRET_PATTERNS.some((re) => re.test(s));
}
