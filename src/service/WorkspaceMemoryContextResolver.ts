import { WorkspaceResolver } from "@/service/WorkspaceResolver";
import { WorkspaceMemoryScopeResolver } from "@/service/WorkspaceMemoryScopeResolver";
import type { ResolvedWorkspaceWithKey } from "@/service/WorkspaceResolver";

/**
 * Trust boundary between renderer workspace-memory requests and the memory
 * scope. Renderer requests carry only a `conversationId`; this resolver turns
 * that into an authenticated `WorkspaceMemoryContext` (or null) by going through
 * `WorkspaceResolver.resolveWithKey`, which checks approval state and derives
 * the `workspaceKey` in the main process, then maps the key onto the internal
 * memory scope (portable-memory Phase A) via WorkspaceMemoryScopeResolver.
 */
export interface WorkspaceMemoryContext {
  readonly conversationId: string;
  readonly workspaceId: number;
  readonly workspaceKey: string;
  readonly workspaceRoot: string;
  readonly displayName: string;
  /** Internal memory scope id — the durable retrieval boundary. */
  readonly scopeId?: string;
}

export class WorkspaceMemoryContextResolver {
  private readonly resolver: WorkspaceResolver;
  private readonly scopeResolver: WorkspaceMemoryScopeResolver;

  constructor(
    resolver: WorkspaceResolver = new WorkspaceResolver(),
    scopeResolver: WorkspaceMemoryScopeResolver = new WorkspaceMemoryScopeResolver(
      resolver
    )
  ) {
    this.resolver = resolver;
    this.scopeResolver = scopeResolver;
  }

  async resolveForConversation(
    conversationId: string
  ): Promise<WorkspaceMemoryContext | null> {
    if (!conversationId) return null;
    const resolved = await this.resolver.resolveWithKey(conversationId);
    if (!resolved) return null;
    return this.toContext(conversationId, resolved);
  }

  private async toContext(
    conversationId: string,
    resolved: ResolvedWorkspaceWithKey
  ): Promise<WorkspaceMemoryContext> {
    // Scope resolution is best-effort here: when the scope tables are not
    // reachable (fresh DB race, test env) the legacy workspaceKey scoping
    // still applies — the memory module treats a missing scopeId as legacy.
    let scopeId: string | undefined;
    try {
      const scope = await this.scopeResolver.resolveForWorkspace(resolved);
      scopeId = scope?.scopeId;
    } catch {
      scopeId = undefined;
    }
    return {
      conversationId,
      workspaceId: resolved.workspaceId,
      workspaceKey: resolved.workspaceKey,
      workspaceRoot: resolved.canonicalRootPath,
      displayName: resolved.displayName,
      scopeId,
    };
  }
}
