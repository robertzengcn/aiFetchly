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
    this.repository = this.sqliteDb.connection.getRepository(WorkspaceEntity);
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
   * Find the most recent workspace for a conversation. createdAt has
   * second-precision in SQLite, so rows created in the same second may tie —
   * id DESC is the deterministic secondary key.
   */
  async findByConversation(
    conversationId: string
  ): Promise<WorkspaceRecord | null> {
    const entity = await this.repository.findOne({
      where: { conversationId },
      order: { createdAt: "DESC", id: "DESC" },
    });
    return entity ? this.toRecord(entity) : null;
  }

  /**
   * Persisted stable workspace key for a conversation's newest binding
   * (workspace redesign §8.2). Returns null when unbound or not yet
   * backfilled — callers never guess a key from the raw path.
   */
  async findWorkspaceKeyForConversation(
    conversationId: string
  ): Promise<string | null> {
    const entity = await this.repository.findOne({
      where: { conversationId },
      order: { createdAt: "DESC", id: "DESC" },
      select: {
        id: true,
        workspaceKey: true,
      },
    });
    return entity?.workspaceKey ?? null;
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
  async listByConversation(
    conversationId: string
  ): Promise<WorkspaceSummary[]> {
    const entities = await this.repository.find({
      where: { conversationId },
      order: { createdAt: "DESC", id: "DESC" },
    });
    return entities.map((e) => this.toSummary(e));
  }

  /**
   * Revoke every non-terminated (pending/approved) binding of the
   * conversation except `keepId`. FR-WSP-002 supersede semantics: each
   * conversation holds at most ONE approved binding, so approving the newest
   * pick retires the previous ones — a later revoke of the active binding
   * must not silently revive an older binding (and a second-level createdAt
   * tie could otherwise resurrect a stale row).
   */
  async revokeOtherActive(
    conversationId: string,
    keepId: number
  ): Promise<void> {
    const entities = await this.repository.find({
      where: { conversationId },
    });
    for (const entity of entities) {
      if (entity.id === keepId || entity.approvalState === "revoked") {
        continue;
      }
      await this.setApprovalState(entity.id, "revoked");
    }
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
