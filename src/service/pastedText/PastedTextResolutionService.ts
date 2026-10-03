import type { ChatV2PastedBlockMetadata } from "@/entityTypes/pastedTextTypes";
import { expandPastedTextRefs } from "./PastedTextExpander";
import { PastedTextPersistenceService } from "./PastedTextPersistenceService";
import { UnresolvedPastedTextError } from "./UnresolvedPastedTextError";

export interface PastedTextResolutionResult {
  readonly displayMessage: string;
  readonly modelMessage: string;
  readonly pastedBlocks: ChatV2PastedBlockMetadata[];
  readonly warnings: string[];
}

export class PastedTextResolutionService {
  constructor(
    private readonly persistence: PastedTextPersistenceService = new PastedTextPersistenceService()
  ) {}

  async resolveMessage(
    displayMessage: string,
    pastedContents: Record<string, string> | undefined
  ): Promise<PastedTextResolutionResult> {
    const expanded = expandPastedTextRefs(displayMessage, pastedContents);

    if (expanded.unknownPasteIds.length > 0) {
      throw new UnresolvedPastedTextError(expanded.unknownPasteIds);
    }

    const warnings: string[] = [];

    const persistedBlocks = await this.persistence.persistPastedBlocks(
      expanded.pastedBlocks,
      pastedContents ?? {}
    );

    return {
      displayMessage,
      modelMessage: expanded.expandedText,
      pastedBlocks: persistedBlocks,
      warnings,
    };
  }
}
