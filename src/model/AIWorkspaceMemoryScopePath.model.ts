import { BaseDb } from "@/model/Basedb";
import { AIWorkspaceMemoryScopePathEntity } from "@/entity/AIWorkspaceMemoryScopePath.entity";
import { Repository } from "typeorm";

/**
 * Data access for legacy workspace-key → scope mappings (design §10.1).
 */
export class AIWorkspaceMemoryScopePathModel extends BaseDb {
  public repository: Repository<AIWorkspaceMemoryScopePathEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    if (process.env.WORKER_TYPE) {
      throw new Error(
        "Direct database access from worker process is not allowed. " +
          "Worker should send data to main process via IPC."
      );
    }
    this.repository =
      this.sqliteDb.connection.getRepository(AIWorkspaceMemoryScopePathEntity);
  }

  async findByWorkspaceKey(
    workspaceKey: string
  ): Promise<AIWorkspaceMemoryScopePathEntity | null> {
    return this.repository.findOne({ where: { workspaceKey } });
  }

  async listByScopeId(
    scopeId: string
  ): Promise<AIWorkspaceMemoryScopePathEntity[]> {
    return this.repository.find({ where: { scopeId } });
  }

  async upsert(input: {
    readonly scopeId: string;
    readonly workspaceKey: string;
    readonly workspaceRoot: string;
    readonly lastSeenAt?: Date;
  }): Promise<AIWorkspaceMemoryScopePathEntity> {
    const existing = await this.findByWorkspaceKey(input.workspaceKey);
    if (existing) {
      const patch: Partial<AIWorkspaceMemoryScopePathEntity> = {
        scopeId: input.scopeId,
        workspaceRoot: input.workspaceRoot,
        lastSeenAt: input.lastSeenAt ?? existing.lastSeenAt ?? new Date(),
      };
      await this.repository.update({ id: existing.id }, patch);
      const next = await this.findByWorkspaceKey(input.workspaceKey);
      if (!next) throw new Error("Scope path upsert failed");
      return next;
    }
    const e = new AIWorkspaceMemoryScopePathEntity();
    e.scopeId = input.scopeId;
    e.workspaceKey = input.workspaceKey;
    e.workspaceRoot = input.workspaceRoot;
    e.lastSeenAt = input.lastSeenAt ?? new Date();
    return this.repository.save(e);
  }

  /** Move every path mapping from one scope to another (scope merge step 1). */
  async reassignScope(
    fromScopeId: string,
    toScopeId: string
  ): Promise<number> {
    const r = await this.repository.update(
      { scopeId: fromScopeId },
      { scopeId: toScopeId }
    );
    return r.affected ?? 0;
  }
}
