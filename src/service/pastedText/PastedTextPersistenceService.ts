import type {
  ChatV2PastedBlockMetadata,
  ChatV2PastedBlockKind,
} from "@/entityTypes/pastedTextTypes";
import { PASTED_TEXT_INLINE_MAX_CHARS } from "./PastedTextLimits";
import { PasteStoreService } from "./PasteStoreService";

export interface PastedBlockToPersist {
  readonly id: number;
  readonly kind: ChatV2PastedBlockKind;
  readonly lineCount: number;
  readonly charCount: number;
}

export class PastedTextPersistenceService {
  constructor(
    private readonly store: PasteStoreService = new PasteStoreService()
  ) {}

  async persistPastedBlocks(
    blocks: readonly PastedBlockToPersist[],
    pastedContents: Record<string, string>
  ): Promise<ChatV2PastedBlockMetadata[]> {
    const out: ChatV2PastedBlockMetadata[] = [];

    for (const b of blocks) {
      const fullText = pastedContents[String(b.id)];
      if (typeof fullText !== "string") continue;

      const charCount = fullText.length;
      if (charCount <= PASTED_TEXT_INLINE_MAX_CHARS) {
        out.push({
          id: b.id,
          kind: b.kind,
          lineCount: b.lineCount,
          charCount,
          inlineContent: fullText,
        });
        continue;
      }

      const contentHash = await this.store.write(fullText);
      out.push({
        id: b.id,
        kind: b.kind,
        lineCount: b.lineCount,
        charCount,
        contentHash,
      });
    }

    return out;
  }
}
