import { BaseDb } from "@/model/Basedb";
import { AIWorkspaceMemoryEntity } from "@/entity/AIWorkspaceMemory.entity";
import { Repository } from "typeorm";

export interface AIWorkspaceMemoryCreateFields {
  memoryId: string;
  workspaceKey: string;
  workspaceRoot: string;
  type: string;
  title: string;
  content: string;
  status: string;
  confidence: number;
  sourceKind?: string | null;
  sourceConversationId?: string | null;
  sourceAgentTaskId?: string | null;
  sourceMessageIds?: string[] | null;
  lastUsedAt?: Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface AIWorkspaceMemoryListInput {
  readonly workspaceKey: string;
  readonly query?: string;
  readonly type?: string;
  readonly status?: string;
  readonly sourceKind?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Workspace-scoped durable memory data access.
 *
 * EVERY mutating / lookup method takes `workspaceKey` as its first argument and
 * includes it in the WHERE clause. This is the cross-scope safety net: even if
 * a caller bug passes the wrong conversation id, a memory can never be operated
 * on from outside its own workspace.
 */
export class AIWorkspaceMemoryModel extends BaseDb {
  public repository: Repository<AIWorkspaceMemoryEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    // Worker processes have no Electron APIs and must not touch the DB.
    // They communicate results to the main process via IPC instead.
    if (process.env.WORKER_TYPE) {
      throw new Error(
        "Direct database access from worker process is not allowed. " +
          "Worker should send data to main process via IPC."
      );
    }
    this.repository =
      this.sqliteDb.connection.getRepository(AIWorkspaceMemoryEntity);
  }

  async create(
    input: AIWorkspaceMemoryCreateFields
  ): Promise<AIWorkspaceMemoryEntity> {
    const e = new AIWorkspaceMemoryEntity();
    e.memoryId = input.memoryId;
    e.workspaceKey = input.workspaceKey;
    e.workspaceRoot = input.workspaceRoot;
    e.type = input.type;
    e.title = input.title;
    e.content = input.content;
    e.status = input.status;
    e.confidence = input.confidence;
    if (input.sourceKind !== undefined) e.sourceKind = input.sourceKind;
    if (input.sourceConversationId !== undefined)
      e.sourceConversationId = input.sourceConversationId;
    if (input.sourceAgentTaskId !== undefined)
      e.sourceAgentTaskId = input.sourceAgentTaskId;
    if (input.sourceMessageIds !== undefined)
      e.sourceMessageIds = input.sourceMessageIds;
    if (input.lastUsedAt !== undefined) e.lastUsedAt = input.lastUsedAt;
    if (input.metadata !== undefined) e.metadata = input.metadata;
    return this.repository.save(e);
  }

  async getByWorkspaceAndMemoryId(
    workspaceKey: string,
    memoryId: string
  ): Promise<AIWorkspaceMemoryEntity | null> {
    return this.repository.findOne({ where: { workspaceKey, memoryId } });
  }

  async list(input: AIWorkspaceMemoryListInput): Promise<AIWorkspaceMemoryEntity[]> {
    const qb = this.repository
      .createQueryBuilder("m")
      .where("m.workspaceKey = :wk", { wk: input.workspaceKey });
    if (input.status)
      qb.andWhere("m.status = :status", { status: input.status });
    if (input.type) qb.andWhere("m.type = :type", { type: input.type });
    if (input.sourceKind)
      qb.andWhere("m.sourceKind = :sk", { sk: input.sourceKind });
    if (input.query) {
      const like = `%${escapeLike(input.query)}%`;
      qb.andWhere(
        "(m.title LIKE :q ESCAPE '\\' OR m.content LIKE :q ESCAPE '\\')",
        { q: like }
      );
    }
    const limit = clampLimit(input.limit, 50, 200);
    const offset = Math.max(0, input.offset ?? 0);
    qb.orderBy("m.updatedAt", "DESC").take(limit).skip(offset);
    return qb.getMany();
  }

  async listActiveForRetrieval(
    workspaceKey: string,
    limit: number
  ): Promise<AIWorkspaceMemoryEntity[]> {
    return this.repository.find({
      where: { workspaceKey, status: "active" },
      order: { updatedAt: "DESC" },
      take: Math.max(1, Math.min(limit, 200)),
    });
  }

  async updateByWorkspaceAndMemoryId(
    workspaceKey: string,
    memoryId: string,
    updates: Partial<AIWorkspaceMemoryEntity>
  ): Promise<AIWorkspaceMemoryEntity> {
    // Cast through unknown to avoid TypeORM QueryDeepPartialEntity's
    // well-known friction with simple-json metadata columns.
    await this.repository.update(
      { workspaceKey, memoryId },
      updates as unknown as never
    );
    const next = await this.getByWorkspaceAndMemoryId(workspaceKey, memoryId);
    if (!next) throw new Error(`Workspace memory not found: ${memoryId}`);
    return next;
  }

  async archive(workspaceKey: string, memoryId: string): Promise<void> {
    await this.repository.update(
      { workspaceKey, memoryId },
      { status: "archived" }
    );
  }

  async deleteByWorkspaceAndMemoryId(
    workspaceKey: string,
    memoryId: string
  ): Promise<number> {
    const r = await this.repository.delete({ workspaceKey, memoryId });
    return r.affected ?? 0;
  }

  async markUsed(
    workspaceKey: string,
    memoryIds: readonly string[],
    usedAt: Date
  ): Promise<void> {
    if (memoryIds.length === 0) return;
    await this.repository
      .createQueryBuilder()
      .update()
      .set({ lastUsedAt: usedAt })
      .where("workspaceKey = :wk", { wk: workspaceKey })
      .andWhere("memoryId IN (:...ids)", { ids: memoryIds })
      .execute();
  }
}

function escapeLike(s: string): string {
  return s.replace(/[%_]/g, (ch) => "\\" + ch);
}

function clampLimit(v: number | undefined, def: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return def;
  return Math.min(Math.floor(v), max);
}
