import { BaseModule } from "@/modules/baseModule";
import {
  AIMemoryConsolidationRunModel,
  CompleteRunFields,
} from "@/model/AIMemoryConsolidationRun.model";
import { randomUUID } from "node:crypto";
import type { AIMemoryConsolidationRunView } from "@/entityTypes/aiUserMemoryTypes";

export type CompleteMemoryRunInput = Omit<CompleteRunFields, "finishedAt">

export class AIMemoryConsolidationRunModule extends BaseModule {
  private runModel: AIMemoryConsolidationRunModel;

  constructor() {
    super();
    this.runModel = new AIMemoryConsolidationRunModel(this.dbpath);
  }

  async startRun(input: {
    reviewedSince?: Date | null;
    reviewedThrough?: Date | null;
  }): Promise<AIMemoryConsolidationRunView> {
    const e = await this.runModel.createRunning({
      runId: `run-${randomUUID()}`,
      startedAt: new Date(),
      reviewedSince: input.reviewedSince ?? null,
      reviewedThrough: input.reviewedThrough ?? null,
    });
    return this.toView(e);
  }

  async completeRun(input: CompleteMemoryRunInput): Promise<void> {
    await this.runModel.completeRun({
      ...input,
      finishedAt: new Date(),
    });
  }

  async failRun(runId: string, errorMessage: string): Promise<void> {
    await this.runModel.failRun(runId, errorMessage, new Date());
  }

  async getByRunId(
    runId: string
  ): Promise<AIMemoryConsolidationRunView | null> {
    const e = await this.runModel.getByRunId(runId);
    return e ? this.toView(e) : null;
  }

  async getLatestSuccessfulRun(): Promise<AIMemoryConsolidationRunView | null> {
    const e = await this.runModel.getLatestSuccessfulRun();
    return e ? this.toView(e) : null;
  }

  async getRunningRun(): Promise<AIMemoryConsolidationRunView | null> {
    const e = await this.runModel.getRunningRun();
    return e ? this.toView(e) : null;
  }

  async recoverStaleRunningRuns(staleBefore: Date): Promise<number> {
    return this.runModel.markStaleRunningFailed(staleBefore);
  }

  private toView(e: {
    id: number;
    runId: string;
    status: string;
    startedAt: Date;
    finishedAt?: Date | null;
    reviewedSince?: Date | null;
    reviewedThrough?: Date | null;
    chatConversationsReviewed: number;
    agentTasksReviewed: number;
    memoriesCreated: number;
    memoriesUpdated: number;
    memoriesArchived: number;
    model?: string | null;
    errorMessage?: string | null;
    createdAt?: Date | null;
    updatedAt?: Date | null;
  }): AIMemoryConsolidationRunView {
    return {
      id: e.id,
      runId: e.runId,
      status: e.status as AIMemoryConsolidationRunView["status"],
      startedAt: e.startedAt.toISOString(),
      finishedAt: e.finishedAt?.toISOString(),
      reviewedSince: e.reviewedSince?.toISOString(),
      reviewedThrough: e.reviewedThrough?.toISOString(),
      chatConversationsReviewed: e.chatConversationsReviewed,
      agentTasksReviewed: e.agentTasksReviewed,
      memoriesCreated: e.memoriesCreated,
      memoriesUpdated: e.memoriesUpdated,
      memoriesArchived: e.memoriesArchived,
      model: e.model ?? undefined,
      errorMessage: e.errorMessage ?? undefined,
      createdAt: e.createdAt?.toISOString() ?? new Date(0).toISOString(),
      updatedAt: e.updatedAt?.toISOString() ?? new Date(0).toISOString(),
    };
  }
}
