import type { ChatV2PastedBlockMetadata } from "@/entityTypes/pastedTextTypes";
import { expandPastedTextRefs } from "./PastedTextExpander";
import { parsePastedTextRefs } from "./PastedTextParser";
import { countPastedNewlines } from "./PastedTextCleaner";

/**
 * Build a paste-id → full-text map from persisted (or optimistic) blocks
 * plus any cache bodies loaded by contentHash.
 */
export function buildPastedContentsFromBlocks(
  blocks: readonly ChatV2PastedBlockMetadata[] | undefined,
  cachedByHash?: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!blocks) return out;
  for (const block of blocks) {
    if (typeof block.inlineContent === "string") {
      out[String(block.id)] = block.inlineContent;
      continue;
    }
    if (
      typeof block.contentHash === "string" &&
      cachedByHash &&
      Object.prototype.hasOwnProperty.call(cachedByHash, block.contentHash)
    ) {
      out[String(block.id)] = cachedByHash[block.contentHash];
    }
  }
  return out;
}

/**
 * Replace `[Pasted text #N]` / truncated markers with the full pasted bodies
 * for chat-bubble display. Unknown refs are left literal.
 */
export function expandPastedTextForDisplay(
  displayText: string,
  pastedContents: Record<string, string> | undefined
): string {
  return expandPastedTextRefs(displayText, pastedContents).expandedText;
}

/**
 * Optimistic pastedBlocks for the in-flight user bubble so the renderer can
 * expand placeholders before history reload.
 */
export function pastedBlocksFromSend(
  displayText: string,
  pastedContents: Record<string, string> | undefined
): ChatV2PastedBlockMetadata[] | undefined {
  if (!pastedContents) return undefined;
  const refs = parsePastedTextRefs(displayText);
  if (refs.length === 0) return undefined;
  const blocks: ChatV2PastedBlockMetadata[] = [];
  for (const ref of refs) {
    const fullText = pastedContents[String(ref.pasteId)];
    if (typeof fullText !== "string") continue;
    blocks.push({
      id: ref.pasteId,
      lineCount: countPastedNewlines(fullText),
      charCount: fullText.length,
      kind: ref.kind,
      inlineContent: fullText,
    });
  }
  return blocks.length > 0 ? blocks : undefined;
}
