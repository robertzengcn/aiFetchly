/**
 * AIFetchlyRuntimeRegistrySync — wires snapshots into registries + cache.
 *
 * The sync layer sits between the loader (which produces a fresh full
 * snapshot of ~/.aifetchly on every scan) and the runtime consumers
 * ({@link CommandRegistry} + {@link AIFetchlyContextStore}). It exists so the
 * reconciliation logic — "given a full snapshot, atomically replace every
 * runtime view for this source" — has one owner instead of being scattered
 * across the manager.
 *
 * Phase-13 behavior:
 *   - Global snapshots only (source="user", sourceId="user"). Workspace
 *     snapshots arrive via the phase-14 watcher worker.
 *   - commands/agents/hooks/skills are always empty (Plan 01 loader only
 *     reads AGENTS.md + settings.json). Only instructions are non-empty.
 *
 * Design references: §8.1 (RuntimeRegistrySync responsibilities), §8.2
 * (trust filtering — phase 13 is global-only, trust is always true).
 */

import type {
  AIFetchlyConfigDiagnostic,
  AIFetchlyConfigSnapshot,
  AIFetchlySourceTrust,
} from "@/entityTypes/aifetchlyConfigTypes";
import type { SlashCommandDefinition } from "@/entityTypes/slashCommandTypes";
import type { CommandRegistry } from "@/service/slashCommands/CommandRegistry";
import type { AIFetchlyContextStore } from "./AIFetchlyContextStore";

/** Outcome of applying a snapshot — surfaced to callers and getStatus(). */
export interface AIFetchlySnapshotApplyResult {
  /** True if any commands were added/changed/removed for this source. */
  readonly commandsChanged: boolean;
  /** True if any instructions were added/changed/removed for this source. */
  readonly instructionsChanged: boolean;
  /** Diagnostic count carried by this snapshot (for /status display). */
  readonly diagnosticCount: number;
}

/**
 * Snapshot-to-runtime reconciler.
 *
 * Constructed with the registries it mutates (dependency injection —
 * testable without touching the singleton wiring). Each call to
 * {@link applySnapshot} is an atomic replace for the snapshot's sourceId:
 * the previous entries for that sourceId are dropped and the new ones take
 * their place.
 */
export class AIFetchlyRuntimeRegistrySync {
  constructor(
    private readonly commandRegistry: CommandRegistry,
    private readonly contextStore: AIFetchlyContextStore
  ) {}

  /**
   * Apply a full snapshot: replace the source's command set in the registry
   * and the source's instruction blocks in the context cache. Returns an
   * {@link AIFetchlySnapshotApplyResult} summarising what changed.
   */
  applySnapshot(
    snapshot: AIFetchlyConfigSnapshot
  ): AIFetchlySnapshotApplyResult {
    // Phase-13 boundary: snapshot.commands is typed `readonly unknown[]`
    // (forward-compat for Plan 02's typed SlashCommandDefinition[]). Phase 13
    // snapshots always have empty commands, so the cast is safe; phase 15+
    // will tighten the snapshot type and remove this boundary cast.
    const commands = snapshot.commands as readonly SlashCommandDefinition[];
    this.commandRegistry.replaceSource(snapshot.sourceId, commands);

    this.contextStore.replaceInstructions(
      snapshot.sourceId,
      snapshot.instructions
    );

    return {
      commandsChanged: commands.length > 0,
      instructionsChanged: snapshot.instructions.length > 0,
      diagnosticCount: countDiagnostics(snapshot.diagnostics),
    };
  }

  /**
   * Apply a workspace snapshot through the TRS-01 trust filter.
   *
   * Untrusted instructions + commands are dropped BEFORE the existing
   * {@link applySnapshot} mutates the registry or the instruction cache.
   * The remaining capability arrays (agents/hooks/skills) are forced empty
   * in Phase 14 (the per-capability trust entity lands in Phase 17), so a
   * workspace snapshot never carries them regardless of the trust flags.
   *
   * Design references: §8.2 (trust filtering before registry mutation),
   * §13.1 (Phase 14 binary gate vs Phase 17 per-capability). Research
   * §Pitfall 8: the existing {@link applySnapshot} applies BLINDLY (no
   * trust param). Callers MUST route every workspace snapshot through
   * this method — NEVER call {@link applySnapshot} directly with a raw
   * workspace snapshot. The global ~/.aifetchly path (user-owned, always
   * trusted) still calls {@link applySnapshot} directly.
   *
   * Returns the same {@link AIFetchlySnapshotApplyResult} shape as
   * {@link applySnapshot}; `commandsChanged`/`instructionsChanged` reflect
   * the filtered arrays that actually reached the registry/cache.
   */
  applyWorkspaceSnapshot(
    snapshot: AIFetchlyConfigSnapshot,
    trust: AIFetchlySourceTrust
  ): AIFetchlySnapshotApplyResult {
    const filtered: AIFetchlyConfigSnapshot = {
      ...snapshot,
      // Drop untrusted capabilities at the boundary. The spread carries the
      // rest of the snapshot (files, diagnostics, sourceId, workspaceId)
      // through unchanged.
      instructions: trust.instructions ? snapshot.instructions : [],
      commands: trust.commands ? snapshot.commands : [],
    };
    return this.applySnapshot(filtered);
  }

  /**
   * Drop every command and instruction block belonging to this sourceId.
   * Used by the manager on a source going away (phase 14: workspace removal).
   */
  removeSource(sourceId: string): void {
    this.commandRegistry.replaceSource(sourceId, []);
    this.contextStore.removeSource(sourceId);
  }
}

function countDiagnostics(
  diagnostics: readonly AIFetchlyConfigDiagnostic[]
): number {
  return diagnostics.length;
}
