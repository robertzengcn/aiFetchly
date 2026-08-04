/**
 * SpeechTextSanitizer — prepare assistant text for TTS.
 *
 * Pure (no imports). Strips content that should not be spoken: fenced code
 * blocks, markdown tables, image syntax; unwraps markdown links and inline
 * code to their labels; strips markdown control characters; collapses
 * whitespace; bounds length. Returns "" for code-only / table-only input so
 * the caller can skip synthesis. Design §7.8 / §12.4.
 */

/** Default char cap for one sanitized TTS chunk. */
export const SPEECH_SANITIZE_MAX_CHARS = 1000;

/**
 * Sanitize text for speech synthesis.
 *
 * @param text raw assistant text (may contain markdown / code)
 * @param maxChars hard cap on the returned length
 * @returns speakable natural-language text, or "" when nothing speakable
 *          remains (e.g. a code-only message)
 */
export function sanitizeForSpeech(
  text: string,
  maxChars: number = SPEECH_SANITIZE_MAX_CHARS
): string {
  if (typeof text !== "string" || text.length === 0) {
    return "";
  }
  let out = text;
  // Remove fenced code blocks (``` ... ```).
  out = out.replace(/```[\s\S]*?```/g, " ");
  // Remove markdown table rows (lines delimited by |).
  out = out.replace(/^[ \t]*\|.*\|[ \t]*$/gm, " ");
  // Remove standalone image syntax ![alt](url) -> alt.
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Convert [label](url) -> label.
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Unwrap inline `code` -> code (keep short content; long code is rare inline).
  out = out.replace(/`([^`]+)`/g, "$1");
  // Strip markdown control characters.
  out = out.replace(/[#*_>~]/g, "");
  // Collapse whitespace.
  out = out.replace(/\s+/g, " ").trim();
  if (out.length === 0) {
    return "";
  }
  if (out.length > maxChars) {
    out = out.slice(0, maxChars).trim();
  }
  return out;
}
