import { BaseDb } from "@/model/Basedb";
import { AIChatSessionMemoryEntity } from "@/entity/AIChatSessionMemory.entity";
import { Repository } from "typeorm";
import type { AIChatSessionMemoryStatus } from "@/entityTypes/aiChatCompactTypes";

export interface SessionMemoryUpsertInput {
  conversationId: string;
  summary: string;
  coveredThroughMessageId?: string;
  coveredThroughTimestamp?: Date;
  sourceMessageCount: number;
  tokenEstimate?: number;
  model?: string;
  status: AIChatSessionMemoryStatus;
}

export class AIChatSessionMemoryModel extends BaseDb {
  public repository: Repository<AIChatSessionMemoryEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository =
      this.sqliteDb.connection.getRepository(AIChatSessionMemoryEntity);
  }

  async getByConversation(
    conversationId: string
  ): Promise<AIChatSessionMemoryEntity | null> {
    return this.repository.findOne({ where: { conversationId } });
  }

  async upsertMemory(
    input: SessionMemoryUpsertInput
  ): Promise<AIChatSessionMemoryEntity> {
    const existing = await this.getByConversation(input.conversationId);
    if (existing) {
      const patch: Partial<AIChatSessionMemoryEntity> = {
        summary: input.summary,
        sourceMessageCount: input.sourceMessageCount,
        status: input.status,
      };
      if (input.coveredThroughMessageId !== undefined)
        patch.coveredThroughMessageId = input.coveredThroughMessageId;
      if (input.coveredThroughTimestamp !== undefined)
        patch.coveredThroughTimestamp = input.coveredThroughTimestamp;
      if (input.tokenEstimate !== undefined)
        patch.tokenEstimate = input.tokenEstimate;
      if (input.model !== undefined) patch.model = input.model;
      await this.repository.update({ id: existing.id }, patch);
      return (await this.repository.findOne({ where: { id: existing.id } }))!;
    }
    const entity = new AIChatSessionMemoryEntity();
    entity.conversationId = input.conversationId;
    entity.summary = input.summary;
    entity.sourceMessageCount = input.sourceMessageCount;
    entity.status = input.status;
    if (input.coveredThroughMessageId !== undefined)
      entity.coveredThroughMessageId = input.coveredThroughMessageId;
    if (input.coveredThroughTimestamp !== undefined)
      entity.coveredThroughTimestamp = input.coveredThroughTimestamp;
    if (input.tokenEstimate !== undefined)
      entity.tokenEstimate = input.tokenEstimate;
    if (input.model !== undefined) entity.model = input.model;
    return this.repository.save(entity);
  }

  async setStatus(
    conversationId: string,
    status: AIChatSessionMemoryStatus
  ): Promise<void> {
    await this.repository.update({ conversationId }, { status });
  }

  async recordFailure(
    conversationId: string,
    errorMessage: string
  ): Promise<AIChatSessionMemoryEntity | null> {
    const existing = await this.getByConversation(conversationId);
    if (!existing) return null;
    const next = existing.failureCount + 1;
    await this.repository.update(
      { id: existing.id },
      { failureCount: next, lastError: errorMessage }
    );
    return this.repository.findOne({ where: { id: existing.id } });
  }

  async resetFailures(conversationId: string): Promise<void> {
    await this.repository.update(
      { conversationId },
      { failureCount: 0, lastError: undefined as unknown as string }
    );
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    const r = await this.repository.delete({ conversationId });
    return r.affected ?? 0;
  }

  async deleteAllV2(): Promise<number> {
    const r = await this.repository.delete({});
    return r.affected ?? 0;
  }

  /** Test-only helper — never call from production code. */
  async listAll(): Promise<AIChatSessionMemoryEntity[]> {
    return this.repository.find();
  }
}
