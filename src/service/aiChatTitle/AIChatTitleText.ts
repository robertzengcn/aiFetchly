/**
 * Pure text utilities for the automatic-titles feature (PRD §8 privacy,
 * design §7.2). Node/browser-free so any layer can import them.
 *
 * These rules reduce accidental disclosure; they do NOT guarantee detection
 * of every secret in arbitrary user text (PRD §8: defense in depth).
 */

/** Visible AI title preference: short phrase, hard cap 80 code points. */
export const GENERATED_TITLE_MAX_CODEPOINTS = 80;

/** Storage ceiling shared by manual and generated titles (UTF-16 units). */
export const MANUAL_TITLE_MAX_UTF16 = 200;

/** Byte bound for the serialized title request when no tokenizer is known. */
export const TITLE_INPUT_BYTE_BUDGET = 4096;

/** Adapter-supported completion allocation (design §7.3). */
export const TITLE_MAX_OUTPUT_TOKENS = 64;

/** Request deadline including response body consumption (design §8.5). */
export const TITLE_REQUEST_BUDGET_MS = 10000;

/** Collapse all whitespace (incl. newlines) to single spaces and trim. */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * r3 G07: one bounded credential grammar. The value side accepts QUOTED
 * multiword values ("hunter two", JSON string values) so the whole secret is
 * redacted; keys tolerate a trailing quote/label separator ("api key":).
 */
const CREDENTIAL_KEYS =
  "api[-_]?key|apikey|api key|secret|token|password|passwd|pwd|authorization|auth|mot de passe|passwort|contrase(?:ñ|n)a|contraseña|パスワード|密码|口令|密钥";
const CREDENTIAL_ASSIGNMENT = new RegExp(
  `(?:${CREDENTIAL_KEYS})["']?\\s*(?:[:=：＝]|\\b(?:is|es|est|ist)\\b|是|：|は)\\s*(?:"[^"]*"|'[^']*'|[^\\s,;]+)`,
  "gi"
);
const BEARER_CREDENTIAL =
  /\bbearer\s+(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const SK_STYLE_KEY = /\bsk-[A-Za-z0-9_-]{8,}\b/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const URL = /\b(?:https?:\/\/|www\.)\S+/gi;
// F09/G07: absolute paths behind ordinary file-analysis syntax — start of
// string, whitespace, quotes, brackets, parentheses, backticks, commas,
// colons, semicolons, and open parens. ANY first-path-segment root counts
// (not a fixed list), and quoted filenames with spaces are consumed to the
// closing quote.
const UNIX_ABSOLUTE_PATH =
  /(["'`(])\/(?:[A-Za-z0-9._@ -]+\/)*[A-Za-z0-9._@ -]*[^"'`\s]*(?=\1)|(?:^|[\s("'[<{`,:;(])\/(?:[A-Za-z0-9._@-]+\/)+[^\s"'\]>)}`;,)]*|(?:^|[\s("'[<{`,:;(])\/[A-Za-z0-9._@-]*\.(?:csv|xlsx?|docx?|pdf|txt|json|tsv|md|log|sql|db|env|pem|key|png|jpe?g|zip|tar|gz)\S*/g;
const WINDOWS_ABSOLUTE_PATH =
  /\b[A-Za-z]:[\\/][^\s"<>|?*]+|\\\\[A-Za-z0-9._-]+\\[^\s"<>|?*]+/g;

/**
 * Replace incidental contact/credential/path artifacts with generic markers
 * (design §7.2). Topic-bearing industry/location words are kept.
 */
export function sanitizeText(text: string): string {
  // Bearer first so an "Authorization: Bearer <token>" assignment cannot
  // swallow the scheme word and leak the token value.
  return text
    .replace(BEARER_CREDENTIAL, "[redacted]")
    .replace(CREDENTIAL_ASSIGNMENT, "[redacted]")
    .replace(SK_STYLE_KEY, "[redacted]")
    .replace(URL, "[link]")
    .replace(EMAIL, "[email]")
    // Windows forms FIRST: a drive slash (C:/x) would otherwise be caught
    // mid-path by the POSIX branch (its boundary set includes ':').
    .replace(WINDOWS_ABSOLUTE_PATH, (match) => {
      const lead = match[0];
      const keepsLead = /[\s"'[<{(`,;(/]/.test(lead);
      return keepsLead ? `${lead}[path]` : "[path]";
    })
    .replace(UNIX_ABSOLUTE_PATH, (match) => {
      const lead = match[0];
      const keepsLead = /[\s("'[<{`,:;]/.test(lead);
      return keepsLead ? `${lead}[path]` : "[path]";
    });
}

/**
 * Clip to at most `maxCodepoints` Unicode code points without splitting
 * surrogate pairs (design §9: 80-codepoint cap for generated titles).
 */
export function clipCodepoints(text: string, maxCodepoints: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxCodepoints) return text;
  return chars.slice(0, maxCodepoints).join("");
}

/** Count Unicode code points (surrogate pairs count as one). */
export function countCodepoints(text: string): number {
  return Array.from(text).length;
}

/** UTF-8 byte length without allocating the encoding when avoidable. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * Truncate so the UTF-8 encoding is at most `maxBytes`, never splitting a
 * code point (design §7.3 byte fallback bound).
 */
export function clipToUtf8Bytes(text: string, maxBytes: number): string {
  if (utf8ByteLength(text) <= maxBytes) return text;
  const chars = Array.from(text);
  let out = "";
  let used = 0;
  for (const ch of chars) {
    const size = utf8ByteLength(ch);
    if (used + size > maxBytes) break;
    out += ch;
    used += size;
  }
  return out;
}

/**
 * Normalize, sanitize, and bound a provisional excerpt (FR-01: same bounded
 * sanitization used for title input).
 */
export function sanitizeExcerpt(
  text: string,
  maxCodepoints: number
): string {
  return clipCodepoints(sanitizeText(normalizeText(text)), maxCodepoints);
}
