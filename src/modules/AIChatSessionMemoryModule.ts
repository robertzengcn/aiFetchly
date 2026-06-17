import { BaseModule } from "@/modules/baseModule";
import {
  AIChatSessionMemoryModel,
  SessionMemoryUpsertInput,
} from "@/model/AIChatSessionMemory.model";
import type {
  AIChatSessionMemoryStatus,
  AIChatSessionMemoryView,
} from "@/entityTypes/aiChatCompactTypes";

export class AIChatSessionMemoryModule extends BaseModule {
  private memoryModel: AIChatSessionMemoryModel;

  constructor() {
    super();
    this.memoryModel = new AIChatSessionMemoryModel(this.dbpath);
  }

  async getByConversation(
    conversationId: string
  ): Promise<AIChatSessionMemoryView | null> {
    const e = await this.memoryModel.getByConversation(conversationId);
    return e ? this.toView(e) : null;
  }

  async upsertMemory(
    input: SessionMemoryUpsertInput
  ): Promise<AIChatSessionMemoryView> {
    const e = await this.memoryModel.upsertMemory(input);
    return this.toView(e);
  }

  async setStatus(
    conversationId: string,
    status: AIChatSessionMemoryStatus
  ): Promise<void> {
    await this.memoryModel.setStatus(conversationId, status);
  }

  async markUpdating(conversationId: string): Promise<void> {
    await this.memoryModel.setStatus(conversationId, "updating");
  }

  async recordFailure(
    conversationId: string,
    errorMessage: string
  ): Promise<AIChatSessionMemoryView | null> {
    const e = await this.memoryModel.recordFailure(
      conversationId,
      errorMessage
    );
    return e ? this.toView(e) : null;
  }

  async resetFailures(conversationId: string): Promise<void> {
    await this.memoryModel.resetFailures(conversationId);
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    return this.memoryModel.deleteByConversation(conversationId);
  }

  async deleteAllV2(): Promise<number> {
    return this.memoryModel.deleteAllV2();
  }

  private toView(e: {
    conversationId: string;
    summary: string;
    coveredThroughMessageId?: string;
    coveredThroughTimestamp?: Date;
    sourceMessageCount: number;
    tokenEstimate?: number;
    model?: string;
    failureCount: number;
    lastError?: string | null;
    status: string;
    updatedAt?: Date;
  }): AIChatSessionMemoryView {
    return {
      conversationId: e.conversationId,
      summary: e.summary,
      coveredThroughMessageId: e.coveredThroughMessageId,
      coveredThroughTimestamp: e.coveredThroughTimestamp?.toISOString(),
      sourceMessageCount: e.sourceMessageCount,
      tokenEstimate: e.tokenEstimate,
      model: e.model,
      failureCount: e.failureCount,
      lastError: e.lastError,
      status: e.status as AIChatSessionMemoryStatus,
      updatedAt: e.updatedAt?.toISOString(),
    };
  }
}
