// src/service/slashCommands/CommandRegistry.ts
// In-memory registry for slash commands. Pure logic — NO IPC, NO Electron,
// NO Module imports. Plan 03 composes this with the dispatcher + IPC layer.
//
// Lookup order is enforced on every mutation via rebuildNameIndex()
// (CMD-01): built-in > workspace > user > plugin. Built-ins therefore
// cannot be shadowed. Source replacement via replaceSource() atomically
// reconciles add/change/delete/rename (design §7.3, §10.1).
//
// TRS-06 / phase-15 boundary: the registry stores definitions and NEVER
// executes them. Prompt commands become text-expansion only (phase 15).
//
// See docs/prd/aifetchly-local-extensibility-technical-design.md §7.1, §7.3,
// §11.2.

import type {
  CommandRegistryScope,
  SlashCommandDefinition,
  SlashCommandSource,
  SlashCommandView,
} from "@/entityTypes/slashCommandTypes";
import { BUILTIN_SOURCE, USER_SOURCE } from "@/entityTypes/slashCommandTypes";

/**
 * Lookup-order ranks. Lower rank wins. Enforces CMD-01:
 *   built-in (0) > workspace (1) > user (2) > plugin (3).
 */
const SOURCE_RANK: Readonly<Record<SlashCommandSource, number>> = Object.freeze(
  {
    "built-in": 0,
    workspace: 1,
    user: 2,
    plugin: 3,
  }
);

/**
 * Safe default scope used when no conversation scope is resolved: built-in +
 * user + plugin, NEVER any workspace source. This is the fail-closed fallback
 * for the dispatcher (an omitted context can never leak a workspace command)
 * and the base for the resolver's no-workspace branch.
 */
export const DEFAULT_NON_WORKSPACE_SCOPE: CommandRegistryScope = Object.freeze({
  allowedExactSourceIds: new Set<string>([BUILTIN_SOURCE, USER_SOURCE]),
  allowPluginSources: true,
});

/**
 * In-memory registry for {@link SlashCommandDefinition}s.
 *
 * Three indexes are maintained:
 *   - byId:        id -> definition (defensive copy)
 *   - byName:      name -> winning definition (lookup-order applied)
 *   - sourceIndex: sourceId -> set of command ids (for replaceSource)
 *
 * All public mutators call {@link CommandRegistry.rebuildNameIndex} so the
 * name index is always consistent with the lookup order. All public
 * accessors return defensive copies (CLAUDE.md immutability rule).
 */
export class CommandRegistry {
  private readonly byId = new Map<string, SlashCommandDefinition>();
  private readonly byName = new Map<string, SlashCommandDefinition>();
  private readonly sourceIndex = new Map<string, Set<string>>();

  /**
   * Register (or replace by id) a single command.
   * Stores a defensive copy; rebuilding the name index applies the
   * lookup order so built-ins always win ties.
   */
  register(cmd: SlashCommandDefinition): void {
    const copy: SlashCommandDefinition = { ...cmd };
    this.byId.set(copy.id, copy);
    this.addToSourceIndex(copy.sourceId, copy.id);
    this.rebuildNameIndex();
  }

  /**
   * Remove a command by id. No-op if the id is unknown.
   * Also removes the id from its source index entry.
   */
  unregister(id: string): void {
    const existing = this.byId.get(id);
    if (!existing) return;
    this.byId.delete(id);
    const set = this.sourceIndex.get(existing.sourceId);
    if (set) set.delete(id);
    this.rebuildNameIndex();
  }

  /**
   * Atomically reconcile an entire source. Removes every command previously
   * registered under this sourceId, then inserts the new list, then
   * rebuilds the name index. Handles delete/rename/missed-events correctly
   * (design §7.3, §10.1 — never patch individual commands on file events).
   *
   * Stores defensive copies of every input command.
   */
  replaceSource(
    sourceId: string,
    commands: readonly SlashCommandDefinition[]
  ): void {
    // 1. Remove all old entries belonging to this sourceId.
    const existing = this.sourceIndex.get(sourceId);
    if (existing) {
      for (const id of existing) this.byId.delete(id);
    }
    // 2. Insert fresh copies of the new commands.
    const next = new Set<string>();
    for (const c of commands) {
      const copy: SlashCommandDefinition = { ...c };
      // Defensive: stamp the sourceId on stored entries so unregister()
      // can find them even if a caller passed an inconsistent sourceId
      // in the command itself. (We trust the explicit argument.)
      this.byId.set(copy.id, copy);
      next.add(copy.id);
    }
    this.sourceIndex.set(sourceId, next);
    // 3. Rebuild the name index so winners reflect the new state.
    this.rebuildNameIndex();
  }

  /** Resolve a command by primary name (lookup order applied). Returns null if unknown. */
  getByName(name: string): SlashCommandDefinition | null {
    const found = this.byName.get(name);
    return found ? { ...found } : null;
  }

  /** Resolve a command by id. Returns null if unknown. */
  getById(id: string): SlashCommandDefinition | null {
    const found = this.byId.get(id);
    return found ? { ...found } : null;
  }

  /** All commands (defensive copies). Order is by-id insertion order. */
  list(): SlashCommandDefinition[] {
    return [...this.byId.values()].map((c) => ({ ...c }));
  }

  /**
   * Renderer-safe projection. Strips `body` and arbitrary `metadata`
   * (design §5.5, §14.2 — TRS-07 / T-13-Leak mitigation).
   */
  listViews(): SlashCommandView[] {
    return this.list().map(toView);
  }

  // --- Scoped accessors (plugin/workspace slash commands, FR-1..FR-3) ---------

  /**
   * Whether `cmd` is visible under `scope`. A command is allowed when its
   * sourceId is in the allowed set, or it is a plugin command and plugin
   * sources are permitted (design §5.2). Pure predicate, no mutation.
   */
  private isAllowed(
    cmd: SlashCommandDefinition,
    scope: CommandRegistryScope
  ): boolean {
    if (scope.allowedExactSourceIds.has(cmd.sourceId)) return true;
    if (scope.allowPluginSources && cmd.source === "plugin") return true;
    return false;
  }

  /**
   * Scoped list — every allowed command, as defensive copies, in by-id
   * insertion order. Used by {@link listScopedViews} and scoped `/help`.
   */
  listScoped(scope: CommandRegistryScope): SlashCommandDefinition[] {
    const out: SlashCommandDefinition[] = [];
    for (const cmd of this.byId.values()) {
      if (this.isAllowed(cmd, scope)) out.push({ ...cmd });
    }
    return out;
  }

  /**
   * Scoped renderer-safe views — {@link listScoped} projected through the
   * same {@link toView} used by {@link listViews} (so body/metadata stay
   * stripped — T-13-Leak). Workspace commands outside the conversation's
   * scope never appear (FR-1, AC-1).
   */
  listScopedViews(scope: CommandRegistryScope): SlashCommandView[] {
    return this.listScoped(scope).map(toView);
  }

  /**
   * Scoped, alias-aware lookup. Among all ENABLED, ALLOWED commands whose
   * primary name OR an alias equals `lookupName`, returns the winner.
   *
   * Ranking (FR-2 / design §5.3, §17.1):
   *   1. Lowest {@link SOURCE_RANK} wins (built-in > workspace > user > plugin).
   *   2. Same rank: a primary-name match (matchRank 0) beats an alias match
   *      (matchRank 1). Alias resolution therefore never changes source
   *      precedence.
   *   3. Exact tie: first registration order wins (Map insertion order).
   *
   * Returns a defensive copy, or null when nothing matches. A workspace
   * command hidden by scope is also unreachable here (AC-2 — it cannot be
   * dispatched by manually typing its name from the wrong conversation).
   */
  getByLookupNameScoped(
    lookupName: string,
    scope: CommandRegistryScope
  ): SlashCommandDefinition | null {
    let winner: { cmd: SlashCommandDefinition; matchRank: number } | null =
      null;
    for (const cmd of this.byId.values()) {
      if (!cmd.enabled) continue;
      if (!this.isAllowed(cmd, scope)) continue;

      const primaryMatch = cmd.name === lookupName;
      const aliasMatch = cmd.aliases.includes(lookupName);
      if (!primaryMatch && !aliasMatch) continue;

      const matchRank = primaryMatch ? 0 : 1;
      if (winner === null) {
        winner = { cmd, matchRank };
        continue;
      }
      const sourceDelta =
        SOURCE_RANK[cmd.source] - SOURCE_RANK[winner.cmd.source];
      if (sourceDelta < 0) {
        winner = { cmd, matchRank };
        continue;
      }
      if (sourceDelta === 0 && matchRank < winner.matchRank) {
        winner = { cmd, matchRank };
      }
    }
    return winner ? { ...winner.cmd } : null;
  }

  /**
   * Rebuild the name index from `byId`, applying the lookup order.
   * For each name, the winner is the candidate with the lowest
   * {@link SOURCE_RANK}; ties are broken by first-registered (Map
   * iteration preserves insertion order, and we only replace on a
   * strictly-lower rank).
   */
  private rebuildNameIndex(): void {
    this.byName.clear();
    // Iterate in insertion order (Map guarantee).
    for (const cmd of this.byId.values()) {
      const current = this.byName.get(cmd.name);
      if (!current || SOURCE_RANK[cmd.source] < SOURCE_RANK[current.source]) {
        this.byName.set(cmd.name, cmd);
      }
    }
  }

  private addToSourceIndex(sourceId: string, id: string): void {
    const set = this.sourceIndex.get(sourceId);
    if (set) set.add(id);
    else this.sourceIndex.set(sourceId, new Set<string>([id]));
  }
}

/**
 * Strip `body` and `metadata` from a definition, producing a
 * renderer-safe {@link SlashCommandView}.
 */
function toView(def: SlashCommandDefinition): SlashCommandView {
  const {
    id,
    name,
    description,
    aliases,
    source,
    sourceLabel,
    argumentHint,
    enabled,
  } = def;
  const view: SlashCommandView = {
    id,
    name,
    description,
    aliases: [...aliases],
    source,
    sourceLabel,
    argumentHint,
    enabled,
  };
  return view;
}

// --- CMD-07 suggestion ranking ----------------------------------------------

/**
 * Ranking score buckets. Higher = better match.
 * Exact name > exact alias > prefix name > prefix alias > substring desc.
 */
const SCORE_EXACT_NAME = 100;
const SCORE_EXACT_ALIAS = 80;
const SCORE_PREFIX_NAME = 60;
const SCORE_PREFIX_ALIAS = 40;
const SCORE_SUBSTRING_DESC = 20;

/**
 * Compute the suggestion-rank score for a command against a query.
 * Pure function; exported for unit testing.
 */
function scoreCommand(view: SlashCommandView, qLower: string): number {
  const name = view.name.toLowerCase();
  if (name === qLower) return SCORE_EXACT_NAME;
  if (view.aliases.some((a) => a.toLowerCase() === qLower))
    return SCORE_EXACT_ALIAS;
  if (name.startsWith(qLower)) return SCORE_PREFIX_NAME;
  if (view.aliases.some((a) => a.toLowerCase().startsWith(qLower)))
    return SCORE_PREFIX_ALIAS;
  if (view.description.toLowerCase().includes(qLower))
    return SCORE_SUBSTRING_DESC;
  return 0;
}

/**
 * Rank a list of {@link SlashCommandView}s against a query (CMD-07).
 *
 * Order: exact name > exact alias > prefix name > prefix alias > substring
 * in description. Non-matches are kept at the end. The sort is stable —
 * commands with equal scores preserve their input order.
 *
 * Pure function — does not consult the registry. Callers typically pass
 * `registry.listViews()` (which has already stripped prompt bodies).
 */
export function rankSuggestions(
  query: string,
  commands: readonly SlashCommandView[]
): SlashCommandView[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...commands];
  const scored = commands.map((cmd, idx) => ({
    cmd,
    score: scoreCommand(cmd, q),
    idx,
  }));
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score; // higher score first
    return a.idx - b.idx; // stable: preserve input order on ties
  });
  return scored.map((s) => s.cmd);
}
