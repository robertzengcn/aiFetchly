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
import type { AgentDefinitionView } from "@/entityTypes/agentTypes";
import type { CommandHookDefinition } from "@/entityTypes/hookTypes";
import type { SlashCommandDefinition } from "@/entityTypes/slashCommandTypes";
import type { CommandRegistry } from "@/service/slashCommands/CommandRegistry";
import { AgentDefinitionRegistryImpl } from "@/service/AgentDefinitionRegistry";
import {
  HookRegistry,
  type HookRegistryApi,
} from "@/service/hooks/HookRegistry";
import type { WorkspaceAgentDraft } from "@/service/workspaceWatch/WorkspaceConfigScanner";
import type { WorkspaceHookDraft } from "@/service/workspaceWatch/WorkspaceConfigScanner";
import { buildWorkspaceAgentDefinitions } from "@/service/workspaceWatch/buildWorkspaceAgentDefinitions";
import { buildWorkspaceHookDefinitions } from "@/service/workspaceWatch/buildWorkspaceHookDefinitions";
import { buildWorkspaceSkillDefinitions } from "@/service/workspaceWatch/buildWorkspaceSkillDefinitions";
import type { LocalSkillDraft } from "@/service/aifetchlyConfig/buildLocalSkillDraft";
import type { WorkspaceSkillDraft } from "@/entityTypes/aifetchlyConfigTypes";
import { LocalSkillSourceAdapter } from "@/service/LocalSkillSourceAdapter";
import type { AIFetchlyContextStore } from "./AIFetchlyContextStore";

/** Outcome of applying a snapshot — surfaced to callers and getStatus(). */
export interface AIFetchlySnapshotApplyResult {
  /** True if any commands were added/changed/removed for this source. */
  readonly commandsChanged: boolean;
  /** True if any agents were added/changed/removed for this source. */
  readonly agentsChanged: boolean;
  /** True if any instructions were added/changed/removed for this source. */
  readonly instructionsChanged: boolean;
  /** True if any skills were added/changed/removed for this source (Phase 18). */
  readonly skillsChanged: boolean;
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
  /**
   * Tool names currently registered with the runtime, used by the workspace
   * agent conversion path to emit non-fatal agent-tool-invalid (DX-01)
   * warnings. Defaults to an empty set in Plan 02 (all workspace agent tools
   * flagged) — Plan 03 wires the live SkillRegistry set through the manager.
   */
  private registeredToolNames: ReadonlySet<string> = new Set();

  constructor(
    private readonly commandRegistry: CommandRegistry,
    private readonly contextStore: AIFetchlyContextStore,
    private readonly agentRegistry: AgentDefinitionRegistryImpl = new AgentDefinitionRegistryImpl(),
    private readonly hookRegistry: HookRegistryApi = HookRegistry,
    // Phase 18 (SKL-01): the adapter MUST be the SAME instance across
    // applySnapshot calls so the sourceId -> names index persists across
    // rescans. Constructed once by default; injectable for testing.
    private readonly skillAdapter: LocalSkillSourceAdapter = new LocalSkillSourceAdapter()
  ) {}

  /**
   * Plan 03 wires the live SkillRegistry tool set here so workspace agent
   * unknown-tool warnings reflect the runtime. Plan 02 leaves the default
   * empty set in place.
   */
  setRegisteredToolNames(names: ReadonlySet<string>): void {
    this.registeredToolNames = names;
  }

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

    // Phase 16 (Plan 02): agents. The global path (source "user") fills
    // snapshot.agents with already-validated AgentDefinitionView[] (Task 1
    // loader). The workspace path (source "workspace") fills it with RAW
    // WorkspaceAgentDraft[] (Task 2 scanner); convert them here in the MAIN
    // process via buildWorkspaceAgentDefinitions before registry mutation.
    let agents: readonly AgentDefinitionView[];
    if (snapshot.source === "workspace") {
      const drafts =
        snapshot.agents as readonly unknown[] as readonly WorkspaceAgentDraft[];
      const workspaceId =
        snapshot.workspaceId ?? snapshot.sourceId.replace(/^workspace:/, "");
      const converted = buildWorkspaceAgentDefinitions(
        drafts,
        workspaceId,
        this.registeredToolNames
      );
      agents = converted.definitions;
    } else {
      agents =
        snapshot.agents as readonly unknown[] as readonly AgentDefinitionView[];
    }
    this.agentRegistry.replaceSource(snapshot.sourceId, agents);

    // Phase 17 (Plan 02): hooks. The global path (source "user") fills
    // snapshot.hooks with already-validated CommandHookDefinition[] (Task 1
    // loader). The workspace path (source "workspace") fills it with RAW
    // WorkspaceHookDraft[] (Task 1 scanner); convert them here in the MAIN
    // process via buildWorkspaceHookDefinitions before registry mutation.
    let hooks: readonly CommandHookDefinition[];
    if (snapshot.source === "workspace") {
      const hookDrafts =
        snapshot.hooks as readonly unknown[] as readonly WorkspaceHookDraft[];
      const workspaceId =
        snapshot.workspaceId ?? snapshot.sourceId.replace(/^workspace:/, "");
      const converted = buildWorkspaceHookDefinitions(hookDrafts, workspaceId);
      hooks = converted.definitions;
    } else {
      hooks =
        snapshot.hooks as readonly unknown[] as readonly CommandHookDefinition[];
    }
    this.hookRegistry.replaceSource(snapshot.sourceId, hooks);

    // Phase 18 (SKL-01 / Plan 01 Task 3): skills. The global path (source
    // "user") fills snapshot.skills with already-validated LocalSkillDraft[]
    // (Task 2 loader). The workspace path (source "workspace") fills it with
    // RAW WorkspaceSkillDraft[] (Task 2 scanner); convert them here in the
    // MAIN process via buildWorkspaceSkillDefinitions before registry
    // mutation. Then reconcile via the LocalSkillSourceAdapter (SkillRegistry
    // has NO replaceSource — the adapter tracks sourceId -> names and
    // performs unregister-then-register).
    let skills: readonly LocalSkillDraft[];
    if (snapshot.source === "workspace") {
      const skillDrafts =
        snapshot.skills as readonly unknown[] as readonly WorkspaceSkillDraft[];
      const workspaceId =
        snapshot.workspaceId ?? snapshot.sourceId.replace(/^workspace:/, "");
      const converted = buildWorkspaceSkillDefinitions(
        skillDrafts,
        workspaceId
      );
      skills = converted.definitions;
    } else {
      skills =
        snapshot.skills as readonly unknown[] as readonly LocalSkillDraft[];
    }
    this.skillAdapter.replaceSource(snapshot.sourceId, skills);

    this.contextStore.replaceInstructions(
      snapshot.sourceId,
      snapshot.instructions
    );

    return {
      commandsChanged: commands.length > 0,
      agentsChanged: agents.length > 0,
      instructionsChanged: snapshot.instructions.length > 0,
      skillsChanged: skills.length > 0,
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
      // TRS-01 (Phase 16 / Plan 02): drop untrusted workspace agents BEFORE
      // applySnapshot mutates the agent registry. Trusted workspace agent
      // drafts pass through and are converted main-side in applySnapshot.
      agents: trust.agents ? snapshot.agents : [],
      // HOK-01 (Phase 17 / Plan 02): drop untrusted workspace hooks BEFORE
      // applySnapshot mutates the hook registry. Trusted workspace hook drafts
      // pass through and are converted main-side in applySnapshot.
      hooks: trust.hooks ? snapshot.hooks : [],
      // SKL-01 / TRS-01 (Phase 18 / Plan 01): drop untrusted workspace skills
      // BEFORE applySnapshot mutates the SkillRegistry via the adapter. Trusted
      // workspace skill drafts pass through and are converted main-side in
      // applySnapshot (T-untrusted-workspace / T-18-04).
      skills: trust.skills ? snapshot.skills : [],
    };
    return this.applySnapshot(filtered);
  }

  /**
   * Drop every command, agent, and instruction block belonging to this
   * sourceId. Used by the manager on a source going away (phase 14: workspace
   * removal).
   */
  removeSource(sourceId: string): void {
    this.commandRegistry.replaceSource(sourceId, []);
    this.agentRegistry.replaceSource(sourceId, []);
    this.hookRegistry.replaceSource(sourceId, []);
    // Phase 18 (SKL-01): clear the source's skills via the adapter (reconcile
    // to an empty set — unregister every tracked name for this sourceId).
    this.skillAdapter.replaceSource(sourceId, []);
    this.contextStore.removeSource(sourceId);
  }
}

function countDiagnostics(
  diagnostics: readonly AIFetchlyConfigDiagnostic[]
): number {
  return diagnostics.length;
}
