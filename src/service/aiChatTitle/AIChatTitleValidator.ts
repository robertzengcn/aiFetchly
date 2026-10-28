import {
  GENERATED_TITLE_MAX_CODEPOINTS,
  MANUAL_TITLE_MAX_UTF16,
  countCodepoints,
  normalizeText,
} from "./AIChatTitleText";

/**
 * Control characters and bidirectional overrides are never valid titles.
 * The control ranges are the point of this pattern - detecting them.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_OR_BIDI = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/;

export type GeneratedTitleValidation =
  | { ok: true; title: string }
  | { ok: false; reason: "invalid" | "too_long" };

export type ManualTitleValidation =
  | { ok: true; title: string }
  | { ok: false; reason: "empty" | "too_long" | "invalid" };

/**
 * Validate a model-produced title (titles design §9). An empty result is a
 * valid "model declined" outcome — the caller retains the excerpt. A
 * malformed response must never replace the excerpt.
 */
export function validateGeneratedTitle(raw: string): GeneratedTitleValidation {
  let text = raw.trim();
  // Strip at most one matching outer quote pair.
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      text = text.slice(1, -1).trim();
    }
  }
  if (CONTROL_OR_BIDI.test(text)) return { ok: false, reason: "invalid" };
  if (text.includes("\n")) return { ok: false, reason: "invalid" };
  if (text.includes("```")) return { ok: false, reason: "invalid" };
  // Post-sanitize leak guards: reject obvious contact/path artifacts rather
  // than storing them (design §9).
  if (/[}@]|https?:|sk-|\/home\/|[A-Za-z]:\\/.test(text)) {
    return { ok: false, reason: "invalid" };
  }
  if (countCodepoints(text) > GENERATED_TITLE_MAX_CODEPOINTS) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, title: text };
}

/**
 * Validate a manually entered name (titles design §9): preserve user
 * wording, allow ordinary Unicode/punctuation, normalize line breaks, trim,
 * and enforce 1–200 UTF-16 code units. AI topic/word-count rules do NOT
 * apply to user-entered names.
 */
export function validateManualTitle(raw: string): ManualTitleValidation {
  const text = normalizeText(raw);
  if (text.length === 0) return { ok: false, reason: "empty" };
  if (CONTROL_OR_BIDI.test(text)) return { ok: false, reason: "invalid" };
  if (text.length > MANUAL_TITLE_MAX_UTF16) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, title: text };
}
