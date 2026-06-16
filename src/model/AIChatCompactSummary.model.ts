import { BaseDb } from "@/model/Basedb";
import { AIChatCompactSummaryEntity } from "@/entity/AIChatCompactSummary.entity";
import { Repository } from "typeorm";
import type { AIChatCompactSummaryStatus } from "@/entityTypes/aiChatCompactTypes";

export interface CompactSummarySaveInput {
  compactId: string;
  conversationId: string;
  summary: string;
  fromMessageId?: string;
  throughMessageId: string;
  throughTimestamp: Date;
  sourceMessageCount: number;
  inputTokenEstimate?: number;
  outputTokenEstimate?: number;
  model?: string;
  status: AIChatCompactSummaryStatus;
}

export class AIChatCompactSummaryModel extends BaseDb {
  public repository: Repository<AIChatCompactSummaryEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository =
      this.sqliteDb.connection.getRepository(AIChatCompactSummaryEntity);
  }

  async getActiveSummary(
    conversationId: string
  ): Promise<AIChatCompactSummaryEntity | null> {
    return this.repository.findOne({
      where: { conversationId, status: "active" },
      order: { throughTimestamp: "DESC" },
    });
  }

  async listByConversation(
    conversationId: string
  ): Promise<AIChatCompactSummaryEntity[]> {
    return this.repository.find({
      where: { conversationId },
      order: { throughTimestamp: "ASC" },
    });
  }

  async saveFullCompact(
    input: CompactSummarySaveInput
  ): Promise<AIChatCompactSummaryEntity> {
    if (input.status === "active") {
      await this.markSuperseded(input.conversationId);
    }
    const entity = new AIChatCompactSummaryEntity();
    entity.compactId = input.compactId;
    entity.conversationId = input.conversationId;
    entity.summary = input.summary;
    entity.throughMessageId = input.throughMessageId;
    entity.throughTimestamp = input.throughTimestamp;
    entity.sourceMessageCount = input.sourceMessageCount;
    entity.status = input.status;
    if (input.fromMessageId !== undefined)
      entity.fromMessageId = input.fromMessageId;
    if (input.inputTokenEstimate !== undefined)
      entity.inputTokenEstimate = input.inputTokenEstimate;
    if (input.outputTokenEstimate !== undefined)
      entity.outputTokenEstimate = input.outputTokenEstimate;
    if (input.model !== undefined) entity.model = input.model;
    return this.repository.save(entity);
  }

  async markSuperseded(
    conversationId: string,
    exceptCompactId?: string
  ): Promise<number> {
    const actives = await this.repository.find({
      where: { conversationId, status: "active" },
    });
    let affected = 0;
    for (const a of actives) {
      if (exceptCompactId && a.compactId === exceptCompactId) continue;
      await this.repository.update({ id: a.id }, { status: "superseded" });
      affected += 1;
    }
    return affected;
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    const r = await this.repository.delete({ conversationId });
    return r.affected ?? 0;
  }

  async deleteAllV2(): Promise<number> {
    const r = await this.repository.delete({});
    return r.affected ?? 0;
  }
}
