import { WorkspaceResolver } from "@/service/WorkspaceResolver";
import { WorkspaceMemoryScopeModule } from "@/modules/WorkspaceMemoryScopeModule";
import type { WorkspaceMemoryScopeContext } from "@/entityTypes/portableWorkspaceMemoryTypes";
import type { ResolvedWorkspaceWithKey } from "@/service/WorkspaceResolver";

/**
 * Trust boundary + scope composition for the portable-memory stack
 * (design §19.1).
 *
 * Extends the original WorkspaceMemoryContextResolver contract: a renderer
 * `conversationId` is resolved through WorkspaceResolver (approved workspaces
 * only), the trusted path key is mapped to the internal memory scope, and —
 * when the watcher has validated a `.aifetchly/workspace.json` — the portable
 * identity is bound so clones share one scope. The returned context is the
 * ONLY trusted scope handed to Modules and file services.
 */
export class WorkspaceMemoryScopeResolver {
  private readonly workspaceResolver: WorkspaceResolver;
  private readonly scopeModule: WorkspaceMemoryScopeModule;

  constructor(
    workspaceResolver: WorkspaceResolver = new WorkspaceResolver(),
    scopeModule: WorkspaceMemoryScopeModule = new WorkspaceMemoryScopeModule()
  ) {
    this.workspaceResolver = workspaceResolver;
    this.scopeModule = scopeModule;
  }

  async resolveForConversation(
    conversationId: string
  ): Promise<WorkspaceMemoryScopeContext | null> {
    if (!conversationId) return null;
    const resolved = await this.workspaceResolver.resolveWithKey(
      conversationId
    );
    if (!resolved) return null;
    return this.resolveForWorkspace(resolved);
  }

  /**
   * Compose the scope context from an already-trusted resolved workspace.
   * Shared by conversation-driven paths and watcher snapshot paths (the
   * watcher's workspace root is trusted main-process state, not renderer
   * input).
   */
  async resolveForWorkspace(
    resolved: Pick<
      ResolvedWorkspaceWithKey,
      "workspaceKey" | "canonicalRootPath" | "displayName"
    >
  ): Promise<WorkspaceMemoryScopeContext> {
    const ctx = await this.scopeModule.resolveLegacyScope({
      workspaceKey: resolved.workspaceKey,
      workspaceRoot: resolved.canonicalRootPath,
      displayName: resolved.displayName,
    });
    return ctx;
  }

  /**
   * Resolve the scope from a trusted workspace ROOT PATH only (used by the
   * sync coordinator for watcher snapshots). The key is derived through
   * WorkspaceKeyService (realpath + git root detection), matching the key
   * produced by WorkspaceResolver.resolveWithKey — so the coordinator and the
   * service share the same scope. The previous approach (raw sha256 of the
   * root path) produced a different key than WorkspaceKeyService when realpath
   * or git-root canonicalization applied.
   */
  async resolveFromRoot(
    workspaceRoot: string,
    displayName?: string
  ): Promise<WorkspaceMemoryScopeContext> {
    const keyResolution = await this.workspaceResolver.resolveKeyPublic(
      workspaceRoot
    );
    return this.resolveForWorkspace({
      workspaceKey: keyResolution.workspaceKey,
      canonicalRootPath: keyResolution.canonicalRootPath,
      displayName: displayName ?? keyResolution.displayName,
    });
  }

  /** Re-read scope policy after an enable/disable/policy update. */
  async refreshContext(
    ctx: Pick<
      WorkspaceMemoryScopeContext,
      "workspaceKey" | "workspaceRoot" | "displayName"
    >
  ): Promise<WorkspaceMemoryScopeContext | null> {
    return this.resolveForWorkspace({
      workspaceKey: ctx.workspaceKey,
      canonicalRootPath: ctx.workspaceRoot,
      displayName: ctx.displayName,
    });
  }
}
