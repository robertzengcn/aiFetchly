import { WorkspaceResolver } from "@/service/WorkspaceResolver";

/**
 * Trust boundary between renderer workspace-memory requests and the memory
 * scope. Renderer requests carry only a `conversationId`; this resolver turns
 * that into an authenticated `WorkspaceMemoryContext` (or null) by going through
 * `WorkspaceResolver.resolveWithKey`, which checks approval state and derives
 * the `workspaceKey` in the main process.
 */
export interface WorkspaceMemoryContext {
  readonly conversationId: string;
  readonly workspaceId: number;
  readonly workspaceKey: string;
  readonly workspaceRoot: string;
  readonly displayName: string;
}

export class WorkspaceMemoryContextResolver {
  private readonly resolver: WorkspaceResolver;

  constructor(resolver: WorkspaceResolver = new WorkspaceResolver()) {
    this.resolver = resolver;
  }

  async resolveForConversation(
    conversationId: string
  ): Promise<WorkspaceMemoryContext | null> {
    if (!conversationId) return null;
    const resolved = await this.resolver.resolveWithKey(conversationId);
    if (!resolved) return null;
    return {
      conversationId,
      workspaceId: resolved.workspaceId,
      workspaceKey: resolved.workspaceKey,
      workspaceRoot: resolved.canonicalRootPath,
      displayName: resolved.displayName,
    };
  }
}
