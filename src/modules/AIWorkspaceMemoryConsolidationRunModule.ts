import { BaseModule } from "@/modules/baseModule";
import {
  AIWorkspaceMemoryConsolidationRunModel,
  WorkspaceCompleteRunFields,
} from "@/model/AIWorkspaceMemoryConsolidationRun.model";
import { randomUUID } from "node:crypto";
import type { AIWorkspaceMemoryConsolidationRunView } from "@/entityTypes/aiWorkspaceMemoryTypes";

export type CompleteWorkspaceMemoryRunInput = Omit<
  WorkspaceCompleteRunFields,
  "finishedAt"
>;

export class AIWorkspaceMemoryConsolidationRunModule extends BaseModule {
  private runModel: AIWorkspaceMemoryConsolidationRunModel;

  constructor() {
    super();
    this.runModel = new AIWorkspaceMemoryConsolidationRunModel(this.dbpath);
  }

  async startRun(input: {
    workspaceKey: string;
    reviewedSince?: Date | null;
    reviewedThrough?: Date | null;
  }): Promise<AIWorkspaceMemoryConsolidationRunView> {
    // SMBW-008: do NOT persist the candidate reviewedThrough at start. The
    // watermark must commit only with the successful transaction
    // (applyPlanAndCompleteRun / completeRun) so a failed or cancelled run
    // never advances the cursor past unprocessed material.
    const e = await this.runModel.createRunning({
      runId: `wrun-${randomUUID()}`,
      workspaceKey: input.workspaceKey,
      startedAt: new Date(),
      reviewedSince: input.reviewedSince ?? null,
      reviewedThrough: null,
    });
    return this.toView(e);
  }

  async completeRun(input: CompleteWorkspaceMemoryRunInput): Promise<void> {
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
  ): Promise<AIWorkspaceMemoryConsolidationRunView | null> {
    const e = await this.runModel.getByRunId(runId);
    return e ? this.toView(e) : null;
  }

  async getLatestSuccessfulRun(
    workspaceKey?: string
  ): Promise<AIWorkspaceMemoryConsolidationRunView | null> {
    const e = await this.runModel.getLatestSuccessfulRun(workspaceKey);
    return e ? this.toView(e) : null;
  }

  async getRunningRun(
    workspaceKey?: string
  ): Promise<AIWorkspaceMemoryConsolidationRunView | null> {
    const e = await this.runModel.getRunningRun(workspaceKey);
    return e ? this.toView(e) : null;
  }

  async recoverStaleRunningRuns(staleBefore: Date): Promise<number> {
    return this.runModel.markStaleRunningFailed(staleBefore);
  }

  private toView(e: {
    id: number;
    runId: string;
    status: string;
    workspaceKey?: string | null;
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
  }): AIWorkspaceMemoryConsolidationRunView {
    return {
      id: e.id,
      runId: e.runId,
      status: e.status as AIWorkspaceMemoryConsolidationRunView["status"],
      workspaceKey: e.workspaceKey ?? undefined,
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
