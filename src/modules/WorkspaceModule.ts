import { BaseModule } from "@/modules/baseModule";
import { WorkspaceModel } from "@/model/Workspace.model";
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

    // Always call upsert to create a new row (model does not support update-in-place)
    // The model returns the newest workspace by createdAt DESC in findByConversation
    return model.upsert({
      conversationId: input.conversationId,
      rootPath: input.rootPath,
      label: input.label ?? null,
      approvalState: "pending",
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
    return this.model().setApprovalState(id, "approved");
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
