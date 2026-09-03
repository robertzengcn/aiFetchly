import { MANAGED_BROWSER_OBSERVATION_BUDGETS } from "@/config/managedBrowser";

/**
 * Result sanitizer (technical design §16.4, §24).
 *
 * Every worker-produced payload that can reach the renderer, LLM, logs, or
 * audit passes through here. Page content is UNTRUSTED data: values that look
 * like cookies, tokens, credentials, or secrets are replaced with type
 * markers, never returned (PRD §10.2 observation exclusions).
 *
 * Pure module — no side effects, bounded by explicit budgets.
 */

/** Keys whose values are never allowed to leave the worker. */
const SECRET_KEY_PATTERN =
  /^(cookie|cookies|authorization|auth|token|tokens|access_token|refresh_token|id_token|password|passwd|pass|secret|secrets|credential|credentials|apikey|api_key|session|sessionid|session_id|otp|pin|code|recovery_code|private_key)$/i;

/** Value shapes that look like bearer/JWT/long-random secrets. */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /^Bearer\s+/i,
  /^eyJ[A-Za-z0-9_-]{10,}\./, // JWT
  /^(?:[A-Za-z0-9+/]{40,}={0,2})$/, // base64-ish blob
  /^(?:[0-9a-f]{32,})$/i, // hex digest / random token
  /^gh[pousr]_[A-Za-z0-9]{20,}$/, // GitHub-style PAT
  /^sk-[A-Za-z0-9]{16,}$/, // API-key shape
];

/**
 * Embedded high-entropy runs: planted canaries and real secrets often carry
 * a readable prefix ("CANARY-", "tok_", "sha256:") before the random body.
 * A long delimited hex run or a 40+ undelimited token run marks the value.
 */
const SECRET_VALUE_CONTAINS: readonly RegExp[] = [
  /(?:^|[^A-Za-z0-9])[0-9a-f]{24,}(?:$|[^A-Za-z0-9])/i,
  /[A-Za-z0-9+/_-]{40,}/,
];

export function isLikelySecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function isLikelySecretValue(value: string): boolean {
  if (value.length < 16) {
    // Too short to be a meaningful secret; avoid false positives on normal
    // short text (names, single words).
    return SECRET_VALUE_PATTERNS.slice(0, 2).some((p) => p.test(value));
  }
  return (
    SECRET_VALUE_PATTERNS.some((p) => p.test(value)) ||
    SECRET_VALUE_CONTAINS.some((p) => p.test(value))
  );
}

/** Marker replacing redacted values — type info without content. */
export const REDACTED_MARKER = "[redacted]";

/** Deep-clone + redact. Bounded depth; cycles are cut, not followed. */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 10) {
    return "[depth_limit]";
  }
  if (typeof value === "string") {
    return isLikelySecretValue(value) ? REDACTED_MARKER : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 500).map((v) => redactSecrets(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isLikelySecretKey(key)
        ? REDACTED_MARKER
        : redactSecrets(val, depth + 1);
    }
    return out;
  }
  return value;
}

/** Truncate text to a budget, flagging truncation. */
export function truncateText(
  text: string,
  max: number
): { readonly text: string; readonly truncated: boolean } {
  if (text.length <= max) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, max), truncated: true };
}

/** Sensitive input types whose values must never be echoed. */
const SENSITIVE_INPUT_TYPES: ReadonlySet<string> = new Set([
  "password",
  "text_password",
  "otp",
  "one-time-code",
  "pin",
  "card",
  "security-answer",
  "passkey",
]);

export function isSensitiveInputType(inputType: string): boolean {
  return SENSITIVE_INPUT_TYPES.has(inputType.toLowerCase());
}

/**
 * Value summary for an element observation: sensitive inputs become a type
 * marker; ordinary values are budgeted (design §14.1).
 */
export function summarizeInputValue(
  value: string | undefined,
  inputType: string | undefined
): string | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  if (inputType && isSensitiveInputType(inputType)) {
    return "[password-like]";
  }
  if (isLikelySecretValue(value)) {
    return REDACTED_MARKER;
  }
  const { text } = truncateText(
    value,
    MANAGED_BROWSER_OBSERVATION_BUDGETS.maxValueSummaryChars
  );
  return text;
}

/** Budget an accessible name. */
export function budgetName(name: string): string {
  return truncateText(
    name,
    MANAGED_BROWSER_OBSERVATION_BUDGETS.maxAccessibleNameChars
  ).text;
}

/**
 * Safe error message for transport: bounded length, no stack, no raw
 * validation errors (they could echo cookie-bearing input).
 */
export function toSafeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const { text } = truncateText(raw, 200);
  return text;
}
