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
const CONTROL_OR_BIDI = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/;

/**
 * B14: deterministic artifact/claim detectors for model output. A title is
 * a short plain noun phrase — any of these shapes is rejected rather than
 * stored. Aligned with the input sanitizer vocabulary.
 */
const CREDENTIAL_ASSIGNMENT =
  /(?:api[-_]?key|apikey|api key|secret|token|password|passwd|pwd|authorization|auth|mot de passe|passwort|contrase(?:ñ|n)a|contraseña|パスワード|密码|口令|密钥)["']?\s*(?:[:=：＝]|\b(?:is|es|est|ist)\b|是|：|は)\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/i;
const BEARER_OUTPUT = /\bbearer\s+[^\s,;]+/i;
// r3 G07: shared path grammar — any POSIX first-segment root behind ordinary
// syntax boundaries, Windows drive (both slashes), and UNC server/share.
const ABSOLUTE_PATH =
  /(?:^|[\s("'[<{`,:;(])\/(?:[A-Za-z0-9._@-]+\/)+|\b[A-Za-z]:[\\/]|\\\\[A-Za-z0-9._-]+\\/;
const URL_OR_DOMAIN = /\b(?:https?:\/\/|www\.)\S+/i;
const MARKDOWN_DECORATION = /\*\*|__|^\s*#{1,6}\s|`/;
const EXPLANATION_PREFIX = /^(?:title|name|topic|chat title|标题|タイトル|titre|título|titel)\s*[:：]/i;
/**
 * Deterministic unsupported-completion claims (design §9 fixture set).
 * F10: every English verb carries a LEADING word boundary (no more
 * "Consent"/"Unsent" suffix hits) and bare "generated" is excluded —
 * "AI-Generated Image Editing" describes an artifact, not a completed
 * request; only the explicit adverbial form claims work.
 */
const COMPLETION_CLAIM =
  /(?:\b(?:successfully|already)\s+)?\b(?:collected|sent|delivered|completed)\b|\b(?:successfully|already)\s+generated\b|已(?:收集|发送|送达|完成)|\b(?:enviado?s?|enviada?s?|recogido?s?|recogida?s?|recopilado?s?|recopilada?s?|completado?s?|completada?s?)\b|\benvoyé(?:e|es|s)?\b|\bcollecté(?:e|es|s)?\b|\bgesendet\b|\bgesammelt\b|\babgeschlossen\b|送信済み|収集済み|完了済み/i;

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
  // A multi-line response is never a title — check BEFORE normalization
  // collapses the newlines that prove it.
  if (raw.includes("\n")) return { ok: false, reason: "invalid" };
  // #13: collapse internal whitespace (tabs/double spaces are rendering
  // artifacts, not title content).
  let text = normalizeText(raw);
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
  // B14: deterministic artifact/claim rejection (design §9).
  if (CREDENTIAL_ASSIGNMENT.test(text)) return { ok: false, reason: "invalid" };
  if (BEARER_OUTPUT.test(text)) return { ok: false, reason: "invalid" };
  if (ABSOLUTE_PATH.test(text)) return { ok: false, reason: "invalid" };
  if (URL_OR_DOMAIN.test(text)) return { ok: false, reason: "invalid" };
  if (MARKDOWN_DECORATION.test(text)) return { ok: false, reason: "invalid" };
  if (EXPLANATION_PREFIX.test(text)) return { ok: false, reason: "invalid" };
  if (COMPLETION_CLAIM.test(text)) return { ok: false, reason: "invalid" };
  // Post-sanitize leak guards: reject obvious contact artifacts rather than
  // storing them (design §9).
  if (/[}@{"]|\bsk-/.test(text)) {
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
