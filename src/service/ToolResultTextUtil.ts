/**
 * Bounded text and value-shaping helpers for recoverable large tool results.
 *
 * Every helper here exists to make one specific failure impossible:
 *   - never slice a string mid-codepoint (AC-06: CJK / emoji across a page
 *     boundary must not be broken, dropped, or repeated),
 *   - never let an unbounded producer value become a bounded receipt field,
 *   - never use the naive `bytes / 4` token heuristic.
 */

/** 1 KiB in bytes. KiB/MiB in this feature always mean powers of 1024. */
export const KIB = 1024;

/** UTF-8 byte length of a string. */
export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/**
 * Largest prefix of `value` that is at most `maxBytes` UTF-8 bytes AND does not
 * split a surrogate pair.
 *
 * A lone trailing surrogate would encode as U+FFFD on write, which is exactly
 * the "broken character" failure the design forbids.
 */
export function truncateUtf8Safe(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (utf8ByteLength(value) <= maxBytes) return value;
  // Binary-search the code-unit boundary, then step back off a split pair.
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (utf8ByteLength(value.slice(0, mid)) <= maxBytes) low = mid;
    else high = mid - 1;
  }
  let end = low;
  if (end > 0 && end < value.length) {
    const code = value.charCodeAt(end - 1);
    // 0xD800–0xDFFF is the surrogate range; a trailing high surrogate would
    // pair with the next unit and be truncated mid-character.
    if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  }
  return value.slice(0, end);
}

/**
 * Shrink `value` to at most `maxBytes`, preferring to end on a newline so a
 * text preview does not cut a record in half when a line boundary is close.
 */
export function truncateAtLineBoundary(value: string, maxBytes: number): string {
  const truncated = truncateUtf8Safe(value, maxBytes);
  if (truncated.length === 0) return truncated;
  if (truncated.length === value.length) return truncated;
  const lastNewline = truncated.lastIndexOf("\n");
  // Only accept a nearby line boundary (within 25% of the allowance) so a
  // single very long line still yields a full-width preview.
  if (lastNewline >= 0 && lastNewline >= truncated.length - maxBytes / 4) {
    return truncated.slice(0, lastNewline);
  }
  return truncated;
}

/** True when `value` fits in `maxBytes` UTF-8 bytes. */
export function fitsUtf8Bytes(value: string, maxBytes: number): boolean {
  return utf8ByteLength(value) <= maxBytes;
}

/**
 * Conservative token accounting (technical design §7.1).
 *
 * Charges ONE TOKEN PER UTF-8 BYTE of text plus a fixed framing allowance per
 * envelope part. This is intentionally stricter than the common
 * `bytes / 4` heuristic: it never under-counts a language that packs more
 * meaning per token, and it needs no tokenizer dependency. It is a bound, not
 * a claim of exact provider usage.
 */
export function countTextTokens(value: string, framingTokens = 0): number {
  return utf8ByteLength(value) + framingTokens;
}

/** Framing allowance for one message/envelope wrapper. */
export const ENVELOPE_FRAMING_TOKENS = 4;

/** Deterministically bound an arbitrary string for use in a receipt field. */
export function boundString(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1)}…`;
}

/** Maximum depth walked when shaping an untrusted value. */
const MAX_SHAPE_DEPTH = 6;

/**
 * Produce a bounded, JSON-safe copy of an untrusted value.
 *
 * Rules (technical design §4.2 "control is not an unchecked copy"):
 *   - only plain objects / arrays / primitives survive,
 *   - keys, array items, and strings are each length/ count bounded,
 *   - depth is bounded,
 *   - a function, symbol, bigint, or non-plain object becomes a short marker
 *     string rather than being invoked or expanded.
 */
export function boundUntrustedValue(
  value: unknown,
  limits: {
    readonly maxKeys: number;
    readonly maxArrayItems: number;
    readonly maxStringChars: number;
  },
  depth = 0
): unknown {
  if (value === null) return null;
  const type = typeof value;
  if (type === "boolean") return value;
  if (type === "number") {
    return Number.isFinite(value as number) ? value : String(value);
  }
  if (type === "string") {
    return boundString(value as string, limits.maxStringChars);
  }
  if (type !== "object") {
    // bigint, function, symbol, undefined
    return `[${type}]`;
  }
  if (depth >= MAX_SHAPE_DEPTH) return "[max_depth]";
  if (Array.isArray(value)) {
    const items = value
      .slice(0, limits.maxArrayItems)
      .map((item) => boundUntrustedValue(item, limits, depth + 1));
    if (value.length > limits.maxArrayItems) {
      items.push(`[+${value.length - limits.maxArrayItems} more]`);
    }
    return items;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return "[unsupported]";
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const key of Object.keys(source)) {
    if (count >= limits.maxKeys) {
      out.__truncated__ = `[+${Object.keys(source).length - count} more keys]`;
      break;
    }
    // Read through the descriptor, never `source[key]`: a plain property read
    // would invoke a producer getter. Shaping an untrusted value must not run
    // arbitrary code, the same rule the serializer follows.
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    out[boundString(key, 200)] = boundUntrustedValue(
      descriptor && "value" in descriptor ? descriptor.value : undefined,
      limits,
      depth + 1
    );
    count += 1;
  }
  return out;
}
