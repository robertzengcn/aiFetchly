import type { ChatV2PastedBlockKind } from "@/entityTypes/pastedTextTypes";

const FULL_REF_RE = /\[Pasted text #(\d+)(?: \+(\d+) lines)?\]/g;

const TRUNCATED_REF_RE =
  /\[\.\.\.Truncated text #(\d+)(?: \+(\d+) lines)?\.\.\.\]/g;

export interface PastedTextRefMatch {
  readonly kind: ChatV2PastedBlockKind;
  readonly pasteId: number;
  readonly lineCount: number;
  readonly start: number; // inclusive
  readonly end: number; // exclusive
}

function parseLineCount(group: string | undefined): number {
  if (!group) return 0;
  const n = Number.parseInt(group, 10);
  return Number.isSafeInteger(n) ? n : 0;
}

export function parsePastedTextRefs(input: string): PastedTextRefMatch[] {
  const matches: PastedTextRefMatch[] = [];

  for (const re of [FULL_REF_RE, TRUNCATED_REF_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null = null;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(input)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      const pasteId = Number.parseInt(m[1], 10);
      const lineCount = parseLineCount(m[2]);
      const kind: ChatV2PastedBlockKind =
        re === TRUNCATED_REF_RE ? "truncated" : "full";
      if (Number.isSafeInteger(pasteId) && pasteId >= 1) {
        matches.push({ kind, pasteId, lineCount, start, end });
      }
      // Prevent zero-length infinite loops (defensive).
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }

  matches.sort((a, b) => a.start - b.start || a.end - b.end);
  return matches;
}
