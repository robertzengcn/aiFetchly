import { WorkspaceModule } from "@/modules/WorkspaceModule";

export interface ResolvedWorkspace {
  readonly workspaceId: number;
  readonly rootPath: string;
}

/**
 * Main-process singleton that answers "what is the active workspace
 * for this conversation?". Returns null when no workspace has been
 * approved, which tells callers they must NOT run file tools.
 */
export class WorkspaceResolver {
  async resolve(conversationId: string): Promise<ResolvedWorkspace | null> {
    if (!conversationId) return null;

    const module = new WorkspaceModule();
    const record = await module.getActiveWorkspace(conversationId);

    if (!record) return null;
    if (record.approvalState !== "approved") return null;

    return { workspaceId: record.id, rootPath: record.rootPath };
  }
}
