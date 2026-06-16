import { BaseModule } from "@/modules/baseModule";
import {
  AIChatCompactSummaryModel,
  CompactSummarySaveInput,
} from "@/model/AIChatCompactSummary.model";
import type { AIChatCompactSummaryView } from "@/entityTypes/aiChatCompactTypes";

export class AIChatCompactModule extends BaseModule {
  private compactModel: AIChatCompactSummaryModel;

  constructor() {
    super();
    this.compactModel = new AIChatCompactSummaryModel(this.dbpath);
  }

  async getActiveSummary(
    conversationId: string
  ): Promise<AIChatCompactSummaryView | null> {
    const e = await this.compactModel.getActiveSummary(conversationId);
    return e ? this.toView(e) : null;
  }

  async saveFullCompact(
    input: CompactSummarySaveInput
  ): Promise<AIChatCompactSummaryView> {
    const e = await this.compactModel.saveFullCompact(input);
    return this.toView(e);
  }

  async markSuperseded(
    conversationId: string,
    exceptCompactId?: string
  ): Promise<number> {
    return this.compactModel.markSuperseded(conversationId, exceptCompactId);
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    return this.compactModel.deleteByConversation(conversationId);
  }

  async deleteAllV2(): Promise<number> {
    return this.compactModel.deleteAllV2();
  }

  private toView(e: {
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
    status: string;
    updatedAt?: Date;
  }): AIChatCompactSummaryView {
    return {
      compactId: e.compactId,
      conversationId: e.conversationId,
      summary: e.summary,
      fromMessageId: e.fromMessageId,
      throughMessageId: e.throughMessageId,
      throughTimestamp: e.throughTimestamp.toISOString(),
      sourceMessageCount: e.sourceMessageCount,
      inputTokenEstimate: e.inputTokenEstimate,
      outputTokenEstimate: e.outputTokenEstimate,
      model: e.model,
      status: e.status as AIChatCompactSummaryView["status"],
      updatedAt: e.updatedAt?.toISOString(),
    };
  }
}
