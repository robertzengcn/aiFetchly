/**
 * AIFetchlyContextStore — CTX-03 in-memory instruction cache.
 *
 * Per-sourceId Map<sourceId, AIFetchlyInstructionBlock[]> backing the
 * assembler-facing {@link AIFetchlyContextLoader}. The manager populates this
 * cache from {@link AIFetchlyConfigLoader} snapshots (Plan 01); the assembler
 * reads from the cache via the loader, NEVER touching the filesystem per
 * request (T-13-Cache mitigation).
 *
 * Phase-13 source ids:
 *   - "user"               -> global ~/.aifetchly/AGENTS.md (always-on, TRS-01)
 *   - "workspace:<id>"     -> workspace .aifetchly/AGENTS.md (phase 14+)
 *
 * Hard invariants:
 *   - All returns are defensive copies (CLAUDE.md immutability rule). Mutating
 *     a returned array or block has no effect on stored state.
 *   - All mutators store defensive copies of the input. Callers cannot mutate
 *     stored state by holding and editing the input reference.
 *   - Reads NEVER touch the filesystem. Cache miss -> [] (CTX-03).
 */

import type { AIFetchlyInstructionBlock } from "@/entityTypes/aifetchlyConfigTypes";

/** The sourceId namespace prefix for workspace-scoped blocks. */
export const WORKSPACE_SOURCE_PREFIX = "workspace:";

/**
 * In-memory cache of AiFetchly instruction blocks, keyed by sourceId.
 *
 * The store is intentionally minimal — no settings, no commands, no diagnostics.
 * Those live on the snapshot consumed by {@link AIFetchlyRuntimeRegistrySync};
 * only the resolved instruction blocks the assembler actually needs at request
 * time are cached here.
 */
export class AIFetchlyContextStore {
  private readonly bySource = new Map<string, AIFetchlyInstructionBlock[]>();

  /**
   * Atomically replace the cached blocks for a sourceId. Stores defensive
   * copies of every block so subsequent caller-side mutation cannot corrupt
   * the cache.
   */
  replaceInstructions(
    sourceId: string,
    blocks: readonly AIFetchlyInstructionBlock[]
  ): void {
    const copies: AIFetchlyInstructionBlock[] = blocks.map((b) => ({ ...b }));
    this.bySource.set(sourceId, copies);
  }

  /**
   * Remove every cached block belonging to this sourceId. No-op if unknown.
   */
  removeSource(sourceId: string): void {
    this.bySource.delete(sourceId);
  }

  /**
   * Global (~/.aifetchly) blocks — sourceId "user". Returns a defensive copy.
   * Empty list on cache miss (CTX-03: never throws, never blocks chat).
   */
  getGlobalInstructions(): AIFetchlyInstructionBlock[] {
    return this.snapshot("user");
  }

  /**
   * Workspace-scoped blocks for a given workspace id. Returns a defensive
   * copy. Phase 13 always returns [] because no workspace source is ever
   * populated; the method exists so the assembler/loader contract is stable
   * when phase 14 wires the workspace watcher.
   */
  getWorkspaceInstructions(workspaceId: string): AIFetchlyInstructionBlock[] {
    return this.snapshot(WORKSPACE_SOURCE_PREFIX + workspaceId);
  }

  /** Test-only helper for cache introspection (returns count, not copies). */
  hasSource(sourceId: string): boolean {
    return this.bySource.has(sourceId);
  }

  private snapshot(sourceId: string): AIFetchlyInstructionBlock[] {
    const blocks = this.bySource.get(sourceId);
    if (!blocks) return [];
    return blocks.map((b) => ({ ...b }));
  }
}

/**
 * Module-level singleton store shared by the assembler-facing context loader
 * and the config manager. The assembler does `new AIFetchlyContextLoader()`
 * (Plan 13-03a Task 2) without any DI; that loader defaults to this singleton,
 * so it sees the same cache the manager populates. Tests inject a fresh store
 * to isolate state.
 */
const globalContextStore = new AIFetchlyContextStore();

export function getGlobalAIFetchlyContextStore(): AIFetchlyContextStore {
  return globalContextStore;
}
