import { BaseModule } from "@/modules/baseModule";
import { WorkspaceModel } from "@/model/Workspace.model";
import { WorkspaceKeyService } from "@/service/WorkspaceKeyService";
import {
  WorkspaceRecord,
  WorkspaceSummary,
} from "@/entityTypes/workspaceTypes";

export interface SetWorkspaceInput {
  conversationId: string;
  rootPath: string;
  label?: string | null;
}

export class WorkspaceModule extends BaseModule {
  private model(): WorkspaceModel {
    return new WorkspaceModel(this.dbpath);
  }

  async setWorkspace(input: SetWorkspaceInput): Promise<WorkspaceRecord> {
    await this.ensureConnection();
    const model = this.model();

    // Check for existing non-revoked workspace for this conversation
    const existing = await model.findByConversation(input.conversationId);
    void existing;

    // Resolve the stable grouping key at BIND time (bugfix 2026-11-02):
    // the workspace-key backfill only runs once per process at the first
    // bootstrap, so bindings created afterwards (the new-chat workspace
    // pick, a scheduled task's workspace_path) previously stayed null and
    // the sidebar never grouped them in the same session. A path that
    // cannot be resolved keeps the row null-keyed — the conversation stays
    // visible under Unassigned (design §26.3 semantics, never guessed).
    let workspaceKey: string | null = null;
    let canonicalRootPath: string | null = null;
    try {
      const resolution = await new WorkspaceKeyService().resolve(input.rootPath);
      workspaceKey = resolution.workspaceKey;
      canonicalRootPath = resolution.canonicalRootPath;
    } catch (err) {
      console.warn(
        "[WorkspaceModule] workspace key resolution failed at bind time:",
        err
      );
    }

    // Always call upsert to create a new row (model does not support update-in-place)
    // The model returns the newest workspace by createdAt DESC in findByConversation
    return model.upsert({
      conversationId: input.conversationId,
      rootPath: input.rootPath,
      label: input.label ?? null,
      approvalState: "pending",
      workspaceKey,
      canonicalRootPath,
    });
  }

  async getActiveWorkspace(
    conversationId: string
  ): Promise<WorkspaceRecord | null> {
    await this.ensureConnection();
    const record = await this.model().findByConversation(conversationId);
    if (!record) return null;
    if (record.approvalState !== "approved") return null;
    return record;
  }

  async approveWorkspace(id: number): Promise<WorkspaceRecord | null> {
    await this.ensureConnection();
    const record = await this.model().setApprovalState(id, "approved");
    if (!record) return null;
    // FR-WSP-002 supersede: the approved binding is exclusive per
    // conversation. Retire every other non-terminated row so a later revoke
    // of the active binding cannot silently revive a stale binding.
    await this.model().revokeOtherActive(record.conversationId, id);
    return record;
  }

  async revokeWorkspace(id: number): Promise<WorkspaceRecord | null> {
    await this.ensureConnection();
    return this.model().setApprovalState(id, "revoked");
  }

  async listWorkspaces(conversationId: string): Promise<WorkspaceSummary[]> {
    await this.ensureConnection();
    return this.model().listByConversation(conversationId);
  }
}
