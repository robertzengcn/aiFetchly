import { BaseDb } from "@/model/Basedb";
import { AIUserMemoryEntity } from "@/entity/AIUserMemory.entity";
import { Repository } from "typeorm";
import type { AIUserMemorySearchInput } from "@/entityTypes/aiUserMemoryTypes";

export interface AIUserMemoryCreateFields {
  memoryId: string;
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

export class AIUserMemoryModel extends BaseDb {
  public repository: Repository<AIUserMemoryEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository =
      this.sqliteDb.connection.getRepository(AIUserMemoryEntity);
  }

  async create(input: AIUserMemoryCreateFields): Promise<AIUserMemoryEntity> {
    const e = new AIUserMemoryEntity();
    e.memoryId = input.memoryId;
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

  async getByMemoryId(memoryId: string): Promise<AIUserMemoryEntity | null> {
    return this.repository.findOne({ where: { memoryId } });
  }

  async list(input: AIUserMemorySearchInput): Promise<AIUserMemoryEntity[]> {
    const qb = this.repository.createQueryBuilder("m");
    if (input.status)
      qb.andWhere("m.status = :status", { status: input.status });
    if (input.type) qb.andWhere("m.type = :type", { type: input.type });
    if (input.sourceKind)
      qb.andWhere("m.sourceKind = :sk", { sk: input.sourceKind });
    if (input.query) {
      const like = `%${escapeLike(input.query)}%`;
      qb.andWhere("(m.title LIKE :q OR m.content LIKE :q)", { q: like });
    }
    const limit = clampLimit(input.limit, 50, 200);
    const offset = Math.max(0, input.offset ?? 0);
    qb.orderBy("m.updatedAt", "DESC").take(limit).skip(offset);
    return qb.getMany();
  }

  async listActiveForRetrieval(limit: number): Promise<AIUserMemoryEntity[]> {
    return this.repository.find({
      where: { status: "active" },
      order: { updatedAt: "DESC" },
      take: Math.max(1, Math.min(limit, 200)),
    });
  }

  async updateByMemoryId(
    memoryId: string,
    updates: Partial<AIUserMemoryEntity>
  ): Promise<AIUserMemoryEntity> {
    // Cast through unknown to avoid TypeORM QueryDeepPartialEntity's
    // well-known friction with simple-json metadata columns.
    await this.repository.update({ memoryId }, updates as unknown as never);
    const next = await this.getByMemoryId(memoryId);
    if (!next) throw new Error(`Memory not found: ${memoryId}`);
    return next;
  }

  async archive(memoryId: string): Promise<void> {
    await this.repository.update({ memoryId }, { status: "archived" });
  }

  async deleteByMemoryId(memoryId: string): Promise<number> {
    const r = await this.repository.delete({ memoryId });
    return r.affected ?? 0;
  }

  async markUsed(memoryIds: string[], usedAt: Date): Promise<void> {
    if (memoryIds.length === 0) return;
    await this.repository
      .createQueryBuilder()
      .update()
      .set({ lastUsedAt: usedAt })
      .where("memoryId IN (:...ids)", { ids: memoryIds })
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
