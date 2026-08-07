import {
  formatPastedTextRef,
  formatTruncatedPastedTextRef,
} from "./PastedTextFormatter";
import {
  PASTED_TEXT_TRUNCATE_HEAD_CHARS,
  PASTED_TEXT_TRUNCATE_MAX_CHARS,
  PASTED_TEXT_TRUNCATE_TAIL_CHARS,
} from "./PastedTextLimits";
import { countPastedNewlines } from "./PastedTextCleaner";

export interface TruncatedTierDisplay {
  readonly pasteId: number;
  readonly lineCount: number;
  readonly charCount: number;
  readonly displayText: string;
}

export function shouldUseTruncatedTier(fullText: string): boolean {
  return fullText.length > PASTED_TEXT_TRUNCATE_MAX_CHARS;
}

export function formatTruncatedTierDisplay(
  pasteId: number,
  fullText: string
): TruncatedTierDisplay {
  const lineCount = countPastedNewlines(fullText);
  const charCount = fullText.length;

  // When the paste is small enough that head/tail would overlap, fall back
  // to a normal collapsed placeholder.
  if (
    fullText.length <=
    PASTED_TEXT_TRUNCATE_HEAD_CHARS + PASTED_TEXT_TRUNCATE_TAIL_CHARS
  ) {
    const displayText = formatPastedTextRef(pasteId, lineCount);
    return { pasteId, lineCount, charCount, displayText };
  }

  const head = fullText.slice(0, PASTED_TEXT_TRUNCATE_HEAD_CHARS);
  const tail = fullText.slice(-PASTED_TEXT_TRUNCATE_TAIL_CHARS);
  const marker = formatTruncatedPastedTextRef(pasteId, lineCount);
  return {
    pasteId,
    lineCount,
    charCount,
    displayText: `${head}${marker}${tail}`,
  };
}
