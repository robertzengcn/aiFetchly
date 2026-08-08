/**
 * Secret redaction for goal/loop evidence.
 *
 * Evidence (command output, tool results, logs) may contain secrets or hostile
 * text. Before any evidence is persisted in excerpt form or sent to an LLM
 * verifier, it must be redacted. Pure and deterministic; heavily unit tested.
 *
 * Source: ai-chat-goal-loop-technical-design.md §7.4.
 */

const REPLACEMENT = "[REDACTED]";

/**
 * Patterns that redact the secret VALUE while keeping the surrounding key/name
 * visible (so the evidence stays readable). Order matters: more specific
 * structural patterns first.
 */
const VALUE_PATTERNS: readonly RegExp[] = [
  // key = "value" / key: value  (secret/password/token/key words)
  /\b((?:secret|password|passwd|api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|bearer)\s*[:=]\s*["']?)[^\s"']{4,}/gi,
];

/** Patterns where the whole match is replaced (no useful key to keep). */
const WHOLE_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9\-._~+/=]+/g,
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, // GitHub tokens
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP |)PRIVATE KEY-----/g,
];

/**
 * Redact common secret shapes from `input`, replacing values with [REDACTED].
 * Returns a new string; never mutates input.
 */
export function redactSecrets(input: string, replacement: string = REPLACEMENT): string {
  let out = input;
  for (const re of VALUE_PATTERNS) {
    out = out.replace(re, (_match, prefix: string) => `${prefix}${replacement}`);
  }
  for (const re of WHOLE_PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}
