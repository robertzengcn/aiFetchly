/**
 * Pasted-text cleaner utilities.
 *
 * The goal is deterministic normalization so placeholder refs stay stable
 * across machines and so the model sees a cleaned representation.
 */

// ESC (0x1b) cannot appear in a regex literal under no-control-regex.
const ANSI_ESCAPE_RE = new RegExp(
  `${String.fromCharCode(0x1b)}\\[[0-9;]*m`,
  "g"
);

export function cleanPastedText(raw: string): string {
  // Strip basic ANSI color escape sequences (common in terminal logs).
  const withoutAnsi = raw.replace(ANSI_ESCAPE_RE, "");

  // Normalize newlines to "\n".
  const normalizedNewlines = withoutAnsi.replace(/\r\n?/g, "\n");

  // Expand tabs so line counts remain stable.
  return normalizedNewlines.replace(/\t/g, "    ");
}

export function countPastedNewlines(text: string): number {
  // Claude-Code style placeholders represent "+N lines" as newline count.
  // E.g. "a\nb\nc" => 2.
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") count++;
  }
  return count;
}
