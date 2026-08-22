import { BaseDb } from "@/model/Basedb";
import {
  AIWorkspaceMemoryPortableStateEntity,
} from "@/entity/AIWorkspaceMemoryPortableState.entity";
import { Repository, In } from "typeorm";

export interface PortableStateUpsertFields {
  readonly scopeId: string;
  readonly memoryId: string;
  readonly relativePath: string;
  readonly visibility: string;
  readonly createdBy: string;
  readonly portableCreatedAt: Date;
  readonly portableUpdatedAt: Date;
  readonly supersedes?: string[] | null;
  readonly tags?: string[] | null;
  readonly reviewedAt?: Date | null;
  readonly reviewedBy?: string | null;
  readonly lastValidHash?: string | null;
  readonly observedHash?: string | null;
  readonly syncState: string;
  readonly diagnosticCode?: string | null;
  readonly diagnosticMessage?: string | null;
  readonly lastImportedAt?: Date | null;
  readonly lastScanId?: string | null;
}

/**
 * Data access for per-record portable storage state (design §8.4).
 *
 * Every lookup/mutation includes `scopeId` in the WHERE clause — the same
 * cross-scope safety net as the memory model.
 */
export class AIWorkspaceMemoryPortableStateModel extends BaseDb {
  public repository: Repository<AIWorkspaceMemoryPortableStateEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    if (process.env.WORKER_TYPE) {
      throw new Error(
        "Direct database access from worker process is not allowed. " +
          "Worker should send data to main process via IPC."
      );
    }
    this.repository =
      this.sqliteDb.connection.getRepository(
        AIWorkspaceMemoryPortableStateEntity
      );
  }

  async getByScopeAndMemoryId(
    scopeId: string,
    memoryId: string
  ): Promise<AIWorkspaceMemoryPortableStateEntity | null> {
    return this.repository.findOne({ where: { scopeId, memoryId } });
  }

  async getByScopeAndRelativePath(
    scopeId: string,
    relativePath: string
  ): Promise<AIWorkspaceMemoryPortableStateEntity | null> {
    return this.repository.findOne({ where: { scopeId, relativePath } });
  }

  async listByScope(
    scopeId: string,
    syncState?: string
  ): Promise<AIWorkspaceMemoryPortableStateEntity[]> {
    const where: Record<string, string> = { scopeId };
    if (syncState) where.syncState = syncState;
    return this.repository.find({ where });
  }

  async listByScopeAndMemoryIds(
    scopeId: string,
    memoryIds: readonly string[]
  ): Promise<AIWorkspaceMemoryPortableStateEntity[]> {
    if (memoryIds.length === 0) return [];
    return this.repository.find({
      where: { scopeId, memoryId: In([...memoryIds]) },
    });
  }

  async upsert(
    input: PortableStateUpsertFields
  ): Promise<AIWorkspaceMemoryPortableStateEntity> {
    const existing = await this.getByScopeAndMemoryId(
      input.scopeId,
      input.memoryId
    );
    if (existing) {
      await this.repository.update({ id: existing.id }, input);
      const next = await this.getByScopeAndMemoryId(
        input.scopeId,
        input.memoryId
      );
      if (!next) throw new Error("Portable state upsert failed");
      return next;
    }
    const e = new AIWorkspaceMemoryPortableStateEntity();
    Object.assign(e, input);
    return this.repository.save(e);
  }

  async updateByScopeAndMemoryId(
    scopeId: string,
    memoryId: string,
    updates: Partial<AIWorkspaceMemoryPortableStateEntity>
  ): Promise<AIWorkspaceMemoryPortableStateEntity> {
    await this.repository.update({ scopeId, memoryId }, updates);
    const next = await this.getByScopeAndMemoryId(scopeId, memoryId);
    if (!next)
      throw new Error(`Portable state not found: ${scopeId}/${memoryId}`);
    return next;
  }

  async deleteByScopeAndMemoryId(
    scopeId: string,
    memoryId: string
  ): Promise<number> {
    const r = await this.repository.delete({ scopeId, memoryId });
    return r.affected ?? 0;
  }

  async deleteByScope(scopeId: string): Promise<number> {
    const r = await this.repository.delete({ scopeId });
    return r.affected ?? 0;
  }

  /** Move every portable state row from one scope to another (scope merge). */
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
