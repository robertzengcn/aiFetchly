import { WorkspaceModule } from "@/modules/WorkspaceModule";
import {
  WorkspaceKeyService,
  type WorkspaceKeyResolution,
} from "@/service/WorkspaceKeyService";

export interface ResolvedWorkspace {
  readonly workspaceId: number;
  readonly rootPath: string;
}

export interface ResolvedWorkspaceWithKey {
  readonly workspaceId: number;
  readonly conversationId: string;
  readonly rootPath: string;
  readonly canonicalRootPath: string;
  readonly workspaceKey: string;
  readonly displayName: string;
}

/**
 * Main-process singleton that answers "what is the active workspace
 * for this conversation?". Returns null when no workspace has been
 * approved, which tells callers they must NOT run file tools.
 */
export class WorkspaceResolver {
  /**
   * Per-rootPath cache of key resolutions for the lifetime of this resolver
   * instance. The auto-dream source collector holds one resolver and loops over
   * conversations, so conversations sharing a workspace root resolve git only
   * once. Keyed by the workspace record's rootPath (stable per workspace).
   */
  private readonly keyCache = new Map<string, WorkspaceKeyResolution>();
  private readonly keyService = new WorkspaceKeyService();

  async resolve(conversationId: string): Promise<ResolvedWorkspace | null> {
    if (!conversationId) return null;

    const module = new WorkspaceModule();
    const record = await module.getActiveWorkspace(conversationId);

    if (!record) return null;
    if (record.approvalState !== "approved") return null;

    return { workspaceId: record.id, rootPath: record.rootPath };
  }

  /**
   * Resolves the durable workspace identity (`workspaceKey`) for a conversation.
   * Returns null when there is no conversation, no workspace record, or the
   * workspace is not approved. This is the ONLY path that should derive a
   * `workspaceKey` for memory access — renderer-supplied keys are display hints.
   */
  async resolveWithKey(
    conversationId: string
  ): Promise<ResolvedWorkspaceWithKey | null> {
    if (!conversationId) return null;

    const module = new WorkspaceModule();
    const record = await module.getActiveWorkspace(conversationId);
    if (!record) return null;
    if (record.approvalState !== "approved") return null;

    const resolved = await this.resolveKey(record.rootPath);
    return {
      workspaceId: record.id,
      conversationId: record.conversationId,
      rootPath: record.rootPath,
      canonicalRootPath: resolved.canonicalRootPath,
      workspaceKey: resolved.workspaceKey,
      displayName: record.label ?? resolved.displayName,
    };
  }

  private async resolveKey(rootPath: string): Promise<WorkspaceKeyResolution> {
    const cached = this.keyCache.get(rootPath);
    if (cached) return cached;
    const resolved = await this.keyService.resolve(rootPath);
    this.keyCache.set(rootPath, resolved);
    return resolved;
  }
}
