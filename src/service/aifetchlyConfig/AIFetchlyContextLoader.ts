/**
 * AIFetchlyContextLoader — CTX-01 / CTX-03 assembler-facing façade.
 *
 * Reads from the in-memory {@link AIFetchlyContextStore} (no per-request
 * filesystem reads — T-13-Cache mitigation). All read paths are wrapped in
 * try/catch and return [] on failure (CTX-03: never throws, never blocks the
 * AI chat).
 *
 * Two public surfaces:
 *   - getInstructionBlocks(input): the runtime read path consumed by
 *     {@link AIChatContextAssembler.assemble()}.
 *   - formatInstructionBlock(block): static label builder. The label wording
 *     is the anti-prompt-injection mitigation (design §12.2 last paragraph)
 *     — it MUST NOT claim priority over the app system prompt.
 */

import type { AIFetchlyInstructionBlock } from "@/entityTypes/aifetchlyConfigTypes";
import {
  AIFetchlyContextStore,
  getGlobalAIFetchlyContextStore,
} from "./AIFetchlyContextStore";

/** Input contract for {@link AIFetchlyContextLoader.getInstructionBlocks}. */
export interface AIFetchlyContextInput {
  readonly conversationId: string;
  /** Phase 14 uses the mode to gate plan-mode workspace injection. */
  readonly mode: "chat" | "plan";
}

/**
 * Assembler-facing façade over {@link AIFetchlyContextStore}.
 *
 * Default constructor binds to the module-level singleton store so an
 * unadorned `new AIFetchlyContextLoader()` (as used by the assembler) sees the
 * same cache the config manager populates. Tests inject a fresh store for
 * isolation.
 */
export class AIFetchlyContextLoader {
  private readonly store: AIFetchlyContextStore;

  constructor(store?: AIFetchlyContextStore) {
    this.store = store ?? getGlobalAIFetchlyContextStore();
  }

  /**
   * Resolve the instruction blocks to inject for this request. Concatenates
   * global + workspace blocks (workspace is always empty in phase 13).
   *
   * CTX-03: NEVER throws. Any error in the underlying store degrades to []
   * so the AI chat is never broken by a config-cache failure.
   */
  async getInstructionBlocks(
    input: AIFetchlyContextInput
  ): Promise<AIFetchlyInstructionBlock[]> {
    try {
      const globalBlocks = this.store.getGlobalInstructions();
      // Phase 13: workspace resolution is not wired — always returns [].
      // Phase 14 will resolve the workspaceId from input.conversationId via
      // WorkspaceResolver and pass it to getWorkspaceInstructions().
      void input; // input is the phase-14 contract; consumed when ws lands
      const workspaceBlocks: AIFetchlyInstructionBlock[] = [];
      return [...globalBlocks, ...workspaceBlocks];
    } catch (err) {
      console.error(
        "[aifetchly-context] getInstructionBlocks failed; degrading to no-injection:",
        err
      );
      return [];
    }
  }

  /**
   * Build the labeled system-message content for an injected block (CTX-01).
   *
   * CRITICAL anti-prompt-injection rule (design §12.2 last paragraph): the
   * label MUST NOT tell the model these instructions are higher-priority than
   * the app's own system prompt. The wording is "User global AiFetchly
   * instructions from <path>:" — descriptive, not authoritative.
   */
  static formatInstructionBlock(block: AIFetchlyInstructionBlock): string {
    if (block.source === "user") {
      return (
        "User global AiFetchly instructions from ~/.aifetchly/AGENTS.md:\n\n" +
        block.content
      );
    }
    // Workspace branch (phase 14): "Trusted workspace AiFetchly instructions
    // for <path> from .aifetchly/AGENTS.md:\n\n<content>". Phase 13 never
    // produces workspace blocks, so this branch is unreachable in v2.0 phase
    // 13; implemented defensively so the contract is stable when phase 14
    // populates workspace blocks via the watcher worker.
    const workspaceLabel = block.sourceId.startsWith("workspace:")
      ? block.sourceId
      : "workspace";
    return (
      `Trusted workspace AiFetchly instructions for ${workspaceLabel} from .aifetchly/AGENTS.md:\n\n` +
      block.content
    );
  }
}
