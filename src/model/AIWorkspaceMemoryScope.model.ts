import { BaseDb } from "@/model/Basedb";
import { AIWorkspaceMemoryScopeEntity } from "@/entity/AIWorkspaceMemoryScope.entity";
import { Repository } from "typeorm";

/**
 * Data access for internal memory scopes (design §10.1).
 *
 * Worker processes must never instantiate this model — the constructor guard
 * mirrors the repository-wide policy.
 */
export class AIWorkspaceMemoryScopeModel extends BaseDb {
  public repository: Repository<AIWorkspaceMemoryScopeEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    if (process.env.WORKER_TYPE) {
      throw new Error(
        "Direct database access from worker process is not allowed. " +
          "Worker should send data to main process via IPC."
      );
    }
    this.repository =
      this.sqliteDb.connection.getRepository(AIWorkspaceMemoryScopeEntity);
  }

  async findByScopeId(scopeId: string): Promise<AIWorkspaceMemoryScopeEntity | null> {
    return this.repository.findOne({ where: { scopeId } });
  }

  async findByPortableWorkspaceId(
    portableWorkspaceId: string
  ): Promise<AIWorkspaceMemoryScopeEntity | null> {
    return this.repository.findOne({ where: { portableWorkspaceId } });
  }

  async create(
    input: Partial<AIWorkspaceMemoryScopeEntity>
  ): Promise<AIWorkspaceMemoryScopeEntity> {
    const e = new AIWorkspaceMemoryScopeEntity();
    Object.assign(e, input);
    return this.repository.save(e);
  }

  async updateByScopeId(
    scopeId: string,
    updates: Partial<AIWorkspaceMemoryScopeEntity>
  ): Promise<AIWorkspaceMemoryScopeEntity> {
    await this.repository.update({ scopeId }, updates);
    const next = await this.findByScopeId(scopeId);
    if (!next) throw new Error(`Memory scope not found: ${scopeId}`);
    return next;
  }

  async deleteByScopeId(scopeId: string): Promise<number> {
    const r = await this.repository.delete({ scopeId });
    return r.affected ?? 0;
  }
}
