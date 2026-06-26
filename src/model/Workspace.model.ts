import { BaseDb } from "@/model/Basedb";
import { WorkspaceEntity } from "@/entity/Workspace.entity";
import { Repository } from "typeorm";
import {
  WorkspaceRecord,
  WorkspaceApprovalState,
  WorkspaceSummary,
} from "@/entityTypes/workspaceTypes";

export class WorkspaceModel extends BaseDb {
  public repository: Repository<WorkspaceEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository =
      this.sqliteDb.connection.getRepository(WorkspaceEntity);
  }

  /**
   * Create a new workspace record.
   * Does NOT accept an id field — the database auto-assigns it on insert.
   */
  async upsert(input: {
    conversationId: string;
    rootPath: string;
    label: string | null;
    approvalState: WorkspaceApprovalState;
  }): Promise<WorkspaceRecord> {
    const entity = this.repository.create({
      conversationId: input.conversationId,
      rootPath: input.rootPath,
      label: input.label,
      approvalState: input.approvalState,
    });
    const saved = await this.repository.save(entity);
    return this.toRecord(saved);
  }

  /**
   * Find the most recent workspace for a conversation.
   */
  async findByConversation(conversationId: string): Promise<WorkspaceRecord | null> {
    const entity = await this.repository.findOne({
      where: { conversationId },
      order: { createdAt: "DESC" },
    });
    return entity ? this.toRecord(entity) : null;
  }

  /**
   * Find a workspace by its database ID.
   */
  async findById(id: number): Promise<WorkspaceRecord | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toRecord(entity) : null;
  }

  /**
   * Update the approval state for a workspace and set the corresponding timestamp.
   */
  async setApprovalState(
    id: number,
    state: WorkspaceApprovalState
  ): Promise<WorkspaceRecord | null> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return null;
    entity.approvalState = state;
    if (state === "approved") entity.approvedAt = new Date();
    if (state === "revoked") entity.revokedAt = new Date();
    const saved = await this.repository.save(entity);
    return this.toRecord(saved);
  }

  /**
   * List all workspaces for a conversation, most recent first.
   */
  async listByConversation(conversationId: string): Promise<WorkspaceSummary[]> {
    const entities = await this.repository.find({
      where: { conversationId },
      order: { createdAt: "DESC" },
    });
    return entities.map((e) => this.toSummary(e));
  }

  private toRecord(e: WorkspaceEntity): WorkspaceRecord {
    return {
      id: e.id,
      conversationId: e.conversationId,
      rootPath: e.rootPath,
      label: e.label,
      approvalState: e.approvalState,
      createdAt: e.createdAt ? e.createdAt.toISOString() : "",
      approvedAt: e.approvedAt ? e.approvedAt.toISOString() : null,
      revokedAt: e.revokedAt ? e.revokedAt.toISOString() : null,
    };
  }

  private toSummary(e: WorkspaceEntity): WorkspaceSummary {
    return {
      id: e.id,
      conversationId: e.conversationId,
      rootPath: e.rootPath,
      label: e.label,
      approvalState: e.approvalState,
    };
  }
}
