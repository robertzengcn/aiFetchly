/**
 * Unicode code-point offset helpers. Archive offsets count Unicode code
 * points (U+0000..U+10FFFF), NOT UTF-16 code units or grapheme clusters.
 * This keeps substr/length semantics stable regardless of JS string
 * representation (surrogate pairs, combining marks).
 */

/** Count code points in a string. */
export function codePointLength(text: string): number {
  let count = 0;
  const len = text.length;
  for (let i = 0; i < len; ) {
    const code = text.charCodeAt(i);
    // High surrogate → consume the pair as one code point.
    i += code >= 0xd800 && code <= 0xdbff && i + 1 < len ? 2 : 1;
    count += 1;
  }
  return count;
}

/** Slice a string by code-point offsets [start, end). */
export function sliceByCodePoints(
  text: string,
  start: number,
  end: number
): string {
  if (start < 0) start = 0;
  if (end < 0) end = 0;
  if (start >= end) return "";
  const total = codePointLength(text);
  if (start >= total) return "";
  let count = 0;
  let startUtf16 = -1;
  const len = text.length;
  for (let i = 0; i < len; ) {
    if (count === start) startUtf16 = i;
    const code = text.charCodeAt(i);
    i += code >= 0xd800 && code <= 0xdbff && i + 1 < len ? 2 : 1;
    count += 1;
    if (count >= end) {
      const s = startUtf16 < 0 ? 0 : startUtf16;
      return text.slice(s, i);
    }
  }
  // Reached end before count; return the suffix from startUtf16.
  const s = startUtf16 < 0 ? 0 : startUtf16;
  return text.slice(s);
}

/**
 * Convert a code-point offset to a 1-based start position usable with
 * SQLite `substr(content, :startPlusOne, :length)` plus a code-point length.
 * Returns null if the offset is beyond the string. The caller is expected
 * to slice in-process after a bounded fetch; this helper is kept for callers
 * that prefer SQL-side slicing on engines whose substr counts code points.
 */
export function codePointOffsetToSqlSubstr(
  text: string,
  startCodePoint: number,
  endCodePoint: number
): { startPlusOne: number; lengthCodePoints: number } | null {
  const total = codePointLength(text);
  if (startCodePoint >= total) return null;
  const clampedEnd = Math.min(endCodePoint, total);
  return {
    startPlusOne: startCodePoint + 1,
    lengthCodePoints: clampedEnd - startCodePoint,
  };
}
