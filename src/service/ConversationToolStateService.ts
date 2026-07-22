/**
 * ConversationToolStateService — orchestrates persisted deferred-tool-catalog
 * state between the in-memory loop state and the ConversationToolStateModule
 * (design §19.4).
 *
 * Persistence is best-effort and non-fatal: a save/load failure logs a warning
 * and never breaks the chat turn. The loop continues to track discovery state
 * in memory regardless.
 */

import { TOOL_CATALOG_DEFAULTS } from "@/config/toolCatalogConfig";
import { ConversationToolStateModule } from "@/modules/ConversationToolStateModule";
import type {
  ConversationToolStateView,
  ToolCatalog,
  ToolCatalogStateSnapshot,
} from "@/entityTypes/toolCatalogTypes";

export interface DeferredAnnouncementDelta {
  readonly addedNames: readonly string[];
  readonly addedLines: readonly string[];
  readonly removedNames: readonly string[];
}

export class ConversationToolStateService {
  constructor(
    private readonly module: ConversationToolStateModule = new ConversationToolStateModule()
  ) {}

  /**
   * Load persisted discovered state for a conversation as a loop snapshot.
   * Returns undefined when no state exists yet (fresh conversation) or on
   * read failure.
   */
  async loadSnapshot(
    conversationId: string
  ): Promise<ToolCatalogStateSnapshot | undefined> {
    try {
      const view = await this.module.loadView(conversationId);
      if (!view) return undefined;
      return {
        discoveredToolNames: [...view.discoveredToolNames],
        announcedDeferredNames: [...view.announcedDeferredToolNames],
      };
    } catch (err) {
      console.warn(
        `[tool-catalog] failed to load state for ${conversationId}:`,
        err
      );
      return undefined;
    }
  }

  /**
   * Persist the current loop snapshot. Names are normalized (deduped/sorted,
   * stale names dropped against `knownToolNames`) by the module.
   */
  async saveSnapshot(input: {
    readonly conversationId: string;
    readonly snapshot: ToolCatalogStateSnapshot;
    readonly knownToolNames?: ReadonlySet<string>;
    readonly catalogHash?: string;
  }): Promise<void> {
    try {
      await this.module.saveView({
        conversationId: input.conversationId,
        discoveredToolNames: input.snapshot.discoveredToolNames,
        announcedDeferredToolNames: input.snapshot.announcedDeferredNames,
        knownToolNames: input.knownToolNames,
        catalogHash: input.catalogHash,
      });
    } catch (err) {
      console.warn(
        `[tool-catalog] failed to persist state for ${input.conversationId}:`,
        err
      );
    }
  }

  /** Convert a loop snapshot to the persisted view shape (pure helper). */
  snapshotToView(
    conversationId: string,
    snapshot: ToolCatalogStateSnapshot
  ): ConversationToolStateView {
    return {
      conversationId,
      discoveredToolNames: [...snapshot.discoveredToolNames],
      announcedDeferredToolNames: [...snapshot.announcedDeferredNames],
    };
  }
}

/**
 * Compute a compact delta of deferred tools to announce (FR-6, design §20.2).
 * Pure function — unit-tested without a database.
 *
 * - added: currently-deferred tools not previously announced.
 * - removed: previously-announced names no longer deferred (e.g. tool disabled).
 */
export function buildDeferredAnnouncementDelta(input: {
  readonly previousAnnounced: readonly string[];
  readonly catalog: ToolCatalog;
  readonly shortDescriptionChars?: number;
}): DeferredAnnouncementDelta {
  const prev = new Set(input.previousAnnounced);
  const currentDeferred = input.catalog.deferred;
  const currentNames = new Set(currentDeferred.map((e) => e.name));

  const added = currentDeferred.filter((e) => !prev.has(e.name));
  const removedNames = input.previousAnnounced.filter(
    (n) => !currentNames.has(n)
  );

  const maxChars =
    input.shortDescriptionChars ?? TOOL_CATALOG_DEFAULTS.shortDescriptionChars;
  const addedLines = added.map((e) => {
    const tag = e.category ? `${e.source}/${e.category}` : e.source;
    const desc = e.shortDescription.slice(0, maxChars);
    return `${e.name} [${tag}] - ${desc}`;
  });

  return {
    addedNames: added.map((e) => e.name),
    addedLines,
    removedNames,
  };
}
