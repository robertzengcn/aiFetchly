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
  private readonly injectedModule?: ConversationToolStateModule;
  private lazyModule?: ConversationToolStateModule;

  constructor(module?: ConversationToolStateModule) {
    this.injectedModule = module;
  }

  /**
   * Lazily resolve the module so simply constructing this service (e.g. as a
   * field on the engine when the feature is inactive) does not touch the
   * database or resolve USERSDBPATH.
   */
  private getModule(): ConversationToolStateModule {
    if (this.injectedModule) return this.injectedModule;
    if (!this.lazyModule) {
      this.lazyModule = new ConversationToolStateModule();
    }
    return this.lazyModule;
  }

  /**
   * Load persisted discovered state for a conversation as a loop snapshot.
   * Returns undefined when no state exists yet (fresh conversation) or on
   * read failure.
   */
  async loadSnapshot(
    conversationId: string
  ): Promise<ToolCatalogStateSnapshot | undefined> {
    try {
      const view = await this.getModule().loadView(conversationId);
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
      await this.getModule().saveView({
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

/** Cap on the number of newly-deferred tool lines in a delta announcement. */
const DEFAULT_MAX_ANNOUNCEMENT_ADDED_LINES = 20;

/**
 * Build the deferred-tool announcement to inject at the start of a turn
 * (FR-6, design §15.2/§20). Returns "" when there is nothing to announce.
 *
 * - First announcement (no prior announced names, deferred tools exist): a
 *   compact category-level system note.
 * - Later turns: a token-budgeted delta (newly deferred + removed) only when
 *   the deferred set changed.
 */
export function buildDeferredAnnouncement(input: {
  readonly previousAnnounced: readonly string[];
  readonly catalog: ToolCatalog;
  readonly maxAddedLines?: number;
}): string {
  const currentDeferredNames = input.catalog.deferred.map((e) => e.name);
  const isFirstAnnouncement =
    input.previousAnnounced.length === 0 && currentDeferredNames.length > 0;

  if (isFirstAnnouncement) {
    const categories = Array.from(
      new Set(input.catalog.deferred.map((e) => e.source))
    ).sort();
    return (
      "Tool catalog mode is active. Some tools are deferred to reduce context usage. " +
      "Use `tool_catalog_search` when a task may need an integration, MCP server, " +
      "plugin tool, imported skill, browser automation, scraper, email inbox/receive tool, " +
      "specialist workflow, or local image attach/edit tool (`attach_local_images`) that is not currently available." +
      (categories.length > 0
        ? ` Deferred tool categories: ${categories.join(", ")}.`
        : "")
    );
  }

  const delta = buildDeferredAnnouncementDelta({
    previousAnnounced: input.previousAnnounced,
    catalog: input.catalog,
  });
  if (delta.addedLines.length === 0 && delta.removedNames.length === 0) {
    return "";
  }

  const maxAdded = input.maxAddedLines ?? DEFAULT_MAX_ANNOUNCEMENT_ADDED_LINES;
  const addedLines = delta.addedLines.slice(0, maxAdded);
  const overflow = delta.addedLines.length - addedLines.length;
  const parts: string[] = [];
  if (addedLines.length > 0) {
    const lines = addedLines.map((l) => `- ${l}`);
    if (overflow > 0) lines.push(`- ...and ${overflow} more`);
    parts.push(
      "Newly deferred tools (use `tool_catalog_search` to load):\n" +
        lines.join("\n")
    );
  }
  if (delta.removedNames.length > 0) {
    parts.push("Tools no longer available: " + delta.removedNames.join(", "));
  }
  return parts.join("\n\n");
}
