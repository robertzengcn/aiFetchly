import type { ChatV2PastedBlockMetadata } from "@/entityTypes/pastedTextTypes";
import { expandPastedTextRefs } from "./PastedTextExpander";
import { PastedTextPersistenceService } from "./PastedTextPersistenceService";

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

    const warnings: string[] = [];
    if (expanded.unknownPasteIds.length > 0) {
      warnings.push(
        `Unknown pasted text refs: ${expanded.unknownPasteIds.join(", ")}`
      );
    }

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
