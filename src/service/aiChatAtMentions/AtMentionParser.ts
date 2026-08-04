import type {
  AtMentionParserOptions,
  ChatV2AtMentionParsed,
  ChatV2AtMentionParseResult,
} from "@/entityTypes/aiChatAtMentionTypes";

const DEFAULT_MAX_MENTIONS = 10;

/** Trailing prose terminators stripped from an unquoted mention token. */
const TRAILING_TERMINATORS = new Set([
  ",",
  ".",
  ")",
  "]",
  ";",
  "!",
  "?",
]);

const WHITESPACE_CHARS = new Set([" ", "\t", "\n", "\r", "\f", "\v"]);

/** Matches a trailing `#L<start>` or `#L<start>-<end>` line fragment. */
const LINE_FRAGMENT_RE = /#L(\d+)(?:-(\d+))?$/;

function isWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && WHITESPACE_CHARS.has(ch);
}

interface SplitResult {
  readonly pathText: string;
  readonly lineStart?: number;
  readonly lineEnd?: number;
  readonly parseError?: "invalid_line_range";
}

/** Split a scanned token into path text + optional validated line fragment. */
function splitLineFragment(token: string): SplitResult {
  const match = LINE_FRAGMENT_RE.exec(token);
  if (!match) {
    return { pathText: token };
  }
  const pathText = token.slice(0, match.index);
  const start = Number.parseInt(match[1], 10);
  const end =
    match[2] !== undefined ? Number.parseInt(match[2], 10) : undefined;

  if (!Number.isSafeInteger(start) || start < 1) {
    return { pathText, lineStart: start, parseError: "invalid_line_range" };
  }
  if (end !== undefined) {
    if (!Number.isSafeInteger(end) || end < start) {
      return {
        pathText,
        lineStart: start,
        lineEnd: end,
        parseError: "invalid_line_range",
      };
    }
  }
  return { pathText, lineStart: start, lineEnd: end };
}

/**
 * Extract @-mentions from raw message text.
 *
 * Pure: performs no filesystem access, no path resolution, and no workspace
 * inspection. Deterministic and heavily unit tested.
 *
 * Detection rules (PRD §9.1, §10.3):
 *  - The `@` must sit at start-of-input or after whitespace (skips emails).
 *  - `@@` and a lone trailing `@` are ignored.
 *  - Quoted mentions `@"path with spaces"` scan to the closing quote.
 *  - Unquoted mentions scan to the next whitespace, then trailing prose
 *    punctuation (`,`, `.`, `)`, `]`, ...) is stripped.
 *  - A trailing `#L<n>` or `#L<n>-<m>` fragment is parsed into line bounds;
 *    `start < 1` or `end < start` is flagged `invalid_line_range`.
 */
export class AtMentionParser {
  extract(
    content: string,
    options?: AtMentionParserOptions
  ): ChatV2AtMentionParseResult {
    const max = options?.maxMentions ?? DEFAULT_MAX_MENTIONS;
    const mentions: ChatV2AtMentionParsed[] = [];
    let truncated = false;

    const len = content.length;
    for (let i = 0; i < len; i++) {
      if (content[i] !== "@") continue;
      // Boundary: start-of-input or preceding whitespace (rejects emails).
      if (i > 0 && !isWhitespace(content[i - 1])) continue;
      // Ignore double-at markers.
      if (content[i + 1] === "@") continue;
      // Ignore a lone `@` followed by whitespace or end-of-string.
      if (isWhitespace(content[i + 1]) || content[i + 1] === undefined) continue;

      const parsed = this.parseAt(content, i);
      if (!parsed) continue;

      // Advance past the mention body so interior `@`/quotes are not re-scanned.
      i = parsed.endIndex - 1;

      // Deduplicate by (pathText, lineStart, lineEnd); keep first occurrence.
      const isDuplicate = mentions.some(
        (m) =>
          m.pathText === parsed.pathText &&
          m.lineStart === parsed.lineStart &&
          m.lineEnd === parsed.lineEnd
      );
      if (isDuplicate) continue;

      if (mentions.length >= max) {
        truncated = true;
        break;
      }
      mentions.push(parsed);
    }

    return { mentions, truncated };
  }

  private parseAt(
    content: string,
    atIdx: number
  ): ChatV2AtMentionParsed | null {
    const next = content[atIdx + 1];
    if (next === '"') {
      return this.parseQuoted(content, atIdx);
    }
    return this.parseUnquoted(content, atIdx);
  }

  private parseQuoted(
    content: string,
    atIdx: number
  ): ChatV2AtMentionParsed | null {
    const openQuote = atIdx + 1; // index of the opening `"`
    let j = openQuote + 1;
    while (j < content.length && content[j] !== '"') {
      j++;
    }
    // Unterminated quoted mention — treat as plain text.
    if (content[j] !== '"') return null;
    const inner = content.slice(openQuote + 1, j);
    if (inner.length === 0) return null;

    const { pathText, lineStart, lineEnd, parseError } =
      splitLineFragment(inner);
    if (pathText.length === 0) return null;

    const endIdx = j + 1; // exclusive — includes the closing quote
    return {
      rawText: content.slice(atIdx, endIdx),
      pathText,
      quoted: true,
      startIndex: atIdx,
      endIndex: endIdx,
      lineStart,
      lineEnd,
      parseError,
    };
  }

  private parseUnquoted(
    content: string,
    atIdx: number
  ): ChatV2AtMentionParsed | null {
    // Scan the token until the next whitespace.
    let end = atIdx + 1;
    while (end < content.length && !isWhitespace(content[end])) {
      end++;
    }
    // Strip trailing prose terminators (e.g. end-of-sentence period/comma).
    while (end - 1 > atIdx && TRAILING_TERMINATORS.has(content[end - 1])) {
      end--;
    }
    const tokenEnd = end; // exclusive
    const token = content.slice(atIdx + 1, tokenEnd);
    if (token.length === 0) return null;

    const { pathText, lineStart, lineEnd, parseError } =
      splitLineFragment(token);
    if (pathText.length === 0) return null;

    return {
      rawText: content.slice(atIdx, tokenEnd),
      pathText,
      quoted: false,
      startIndex: atIdx,
      endIndex: tokenEnd,
      lineStart,
      lineEnd,
      parseError,
    };
  }
}
