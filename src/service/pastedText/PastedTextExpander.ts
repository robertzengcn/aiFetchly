import type { ChatV2PastedBlockMetadata } from "@/entityTypes/pastedTextTypes";
import type { PastedTextRefMatch } from "./PastedTextParser";
import { parsePastedTextRefs } from "./PastedTextParser";
import {
  PASTED_TEXT_TRUNCATE_HEAD_CHARS,
  PASTED_TEXT_TRUNCATE_TAIL_CHARS,
} from "./PastedTextLimits";

export interface ExpandPastedTextRefsResult {
  readonly expandedText: string;
  readonly replacedPasteIds: number[];
  readonly unknownPasteIds: number[];
  readonly pastedBlocks: ChatV2PastedBlockMetadata[];
}

function computeExpectedHeadTail(fullText: string): {
  head: string;
  tail: string;
} {
  const head = fullText.slice(0, PASTED_TEXT_TRUNCATE_HEAD_CHARS);
  const tail =
    fullText.length <= PASTED_TEXT_TRUNCATE_TAIL_CHARS
      ? fullText
      : fullText.slice(-PASTED_TEXT_TRUNCATE_TAIL_CHARS);
  return { head, tail };
}

function countNewlines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") count++;
  return count;
}

function expandOneRef(
  expandedSoFar: string,
  ref: PastedTextRefMatch,
  pastedContents: Record<string, string>
): { next: string; block: ChatV2PastedBlockMetadata } {
  const fullText = pastedContents[String(ref.pasteId)];
  if (ref.kind === "full") {
    const next =
      expandedSoFar.slice(0, ref.start) +
      fullText +
      expandedSoFar.slice(ref.end);
    const lineCount = countNewlines(fullText);
    return {
      next,
      block: {
        id: ref.pasteId,
        charCount: fullText.length,
        lineCount,
        kind: "full",
      },
    };
  }

  // Truncated tier:
  // Display includes: headPreview + truncatedMarker + tailPreview.
  // We attempt to replace the full visible window first (verify head/tail
  // match), then fall back to replacing the marker only.
  const { head, tail } = computeExpectedHeadTail(fullText);
  const markerStart = ref.start;
  const markerEnd = ref.end;
  const expectedWindowStart = markerStart - head.length;
  const expectedWindowEnd = markerEnd + tail.length;

  const canTakeFullWindow =
    expectedWindowStart >= 0 &&
    expectedWindowEnd <= expandedSoFar.length &&
    expandedSoFar.slice(expectedWindowStart, markerStart) === head &&
    expandedSoFar.slice(markerEnd, expectedWindowEnd) === tail;

  const actualStart = canTakeFullWindow ? expectedWindowStart : markerStart;
  const actualEnd = canTakeFullWindow ? expectedWindowEnd : markerEnd;

  const next =
    expandedSoFar.slice(0, actualStart) +
    fullText +
    expandedSoFar.slice(actualEnd);

  const lineCount = countNewlines(fullText);
  return {
    next,
    block: {
      id: ref.pasteId,
      charCount: fullText.length,
      lineCount,
      kind: "truncated",
    },
  };
}

export function expandPastedTextRefs(
  displayText: string,
  pastedContents: Record<string, string> | undefined
): ExpandPastedTextRefsResult {
  if (!pastedContents || Object.keys(pastedContents).length === 0) {
    return {
      expandedText: displayText,
      replacedPasteIds: [],
      unknownPasteIds: [],
      pastedBlocks: [],
    };
  }

  const refs = parsePastedTextRefs(displayText);

  if (refs.length === 0) {
    return {
      expandedText: displayText,
      replacedPasteIds: [],
      unknownPasteIds: [],
      pastedBlocks: [],
    };
  }

  const replacedPasteIds: number[] = [];
  const unknownPasteIds: number[] = [];
  const pastedBlocks: ChatV2PastedBlockMetadata[] = [];

  let expanded = displayText;
  // Reverse-order replacement so earlier indices remain stable.
  const refsToProcess = [...refs].sort((a, b) => b.start - a.start);
  for (const ref of refsToProcess) {
    const key = String(ref.pasteId);
    const hasFullText = Object.prototype.hasOwnProperty.call(
      pastedContents,
      key
    );
    if (!hasFullText) {
      unknownPasteIds.push(ref.pasteId);
      continue;
    }

    const { next, block } = expandOneRef(expanded, ref, pastedContents);
    expanded = next;
    replacedPasteIds.push(ref.pasteId);
    pastedBlocks.push(block);
  }

  return {
    expandedText: expanded,
    replacedPasteIds,
    unknownPasteIds,
    pastedBlocks,
  };
}
