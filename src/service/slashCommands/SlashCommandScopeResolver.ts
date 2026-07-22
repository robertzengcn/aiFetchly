// src/service/slashCommands/SlashCommandScopeResolver.ts
// Plugin/Workspace slash commands — maps a conversation to the set of command
// sources it is allowed to see (FR-1..FR-3, design §6).
//
// Main-process only. The resolver derives the allowed-source set from the
// active APPROVED workspace for the conversation via the WorkspaceModule
// (Module-owned DB read — never trusts a renderer-supplied workspace path/id).
//
// Boundary: this service touches WorkspaceModule (a Module) but performs NO
// direct TypeORM access and mutates no registry. It only returns a scope shape
// consumed by SlashCommandModule + the registry's scoped accessors.

import { WorkspaceModule } from "@/modules/WorkspaceModule";
import type { WorkspaceRecord } from "@/entityTypes/workspaceTypes";
import type { CommandRegistryScope } from "@/entityTypes/slashCommandTypes";
import { BUILTIN_SOURCE, USER_SOURCE } from "@/entityTypes/slashCommandTypes";
import { DEFAULT_NON_WORKSPACE_SCOPE } from "@/service/slashCommands/CommandRegistry";

/**
 * Result of resolving a conversation's command scope. `commandScope` is the
 * filter handed to {@link CommandRegistry}'s scoped accessors; the workspace
 * metadata is exposed for future `/status` polish (not required for FR-1..3).
 */
export interface SlashCommandScopeResolution {
  readonly commandScope: CommandRegistryScope;
  readonly activeWorkspaceId?: string;
  readonly activeWorkspaceRoot?: string;
}

/**
 * Contract every scope resolver satisfies. The SlashCommandModule accepts this
 * interface (defaulting to a DB-free non-workspace resolver) so tests can pass
 * a stub without touching the database.
 */
export interface SlashCommandScopeResolver {
  resolve(conversationId?: string): Promise<SlashCommandScopeResolution>;
}

/**
 * Resolution returned when there is no conversation, no approved workspace, or
 * the conversation id is unknown. Built-in + user + plugin only — never a
 * workspace source (design §6.2). Reuses the registry's canonical default so
 * the predicate semantics stay in one place.
 */
export const NON_WORKSPACE_RESOLUTION: SlashCommandScopeResolution = Object.freeze({
  commandScope: DEFAULT_NON_WORKSPACE_SCOPE,
});

/**
 * Workspace-active lookup. Defaults to the real {@link WorkspaceModule} (which
 * resolves the DB path via the Token service and only returns approved rows).
 * Injectable so the resolver is unit-testable without a database.
 */
export type ActiveWorkspaceResolver = (
  conversationId: string
) => Promise<WorkspaceRecord | null>;

/**
 * Production scope resolver. Maps `conversationId -> approved workspace ->
 * allowed source ids` (built-in + user + exactly one `workspace:<id>`).
 *
 * Per design §6.3, Phase 1 reads the workspace row on each resolve; command
 * lists are small and this is a local SQLite read. A cache is deliberately NOT
 * added until profiling shows pressure (it would add invalidation risk).
 */
export class WorkspaceSlashCommandScopeResolver
  implements SlashCommandScopeResolver
{
  private readonly resolveActiveWorkspace: ActiveWorkspaceResolver;

  constructor(
    resolveActiveWorkspace: ActiveWorkspaceResolver = (id) =>
      new WorkspaceModule().getActiveWorkspace(id)
  ) {
    this.resolveActiveWorkspace = resolveActiveWorkspace;
  }

  async resolve(
    conversationId?: string
  ): Promise<SlashCommandScopeResolution> {
    if (!conversationId || conversationId.length === 0) {
      return NON_WORKSPACE_RESOLUTION;
    }
    let workspace: WorkspaceRecord | null;
    try {
      workspace = await this.resolveActiveWorkspace(conversationId);
    } catch {
      // Fail closed: a workspace lookup error must never expose workspace
      // commands to the wrong conversation. Treat as "no approved workspace".
      return NON_WORKSPACE_RESOLUTION;
    }
    if (!workspace) return NON_WORKSPACE_RESOLUTION;

    const workspaceSourceId = `workspace:${workspace.id}`;
    const allowedExactSourceIds = new Set<string>([
      BUILTIN_SOURCE,
      USER_SOURCE,
      workspaceSourceId,
    ]);
    return {
      commandScope: {
        allowedExactSourceIds,
        allowPluginSources: true,
      },
      activeWorkspaceId: String(workspace.id),
      activeWorkspaceRoot: workspace.rootPath,
    };
  }
}

/**
 * DB-free scope resolver used as the SlashCommandModule default. Always returns
 * the non-workspace scope, so constructing a module without an explicit
 * resolver (e.g. in unit tests) never triggers a database read.
 */
export const nonWorkspaceSlashCommandScopeResolver: SlashCommandScopeResolver =
  {
    resolve: async () => NON_WORKSPACE_RESOLUTION,
  };
