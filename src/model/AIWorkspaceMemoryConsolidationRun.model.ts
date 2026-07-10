import { BaseDb } from "@/model/Basedb";
import { AIWorkspaceMemoryConsolidationRunEntity } from "@/entity/AIWorkspaceMemoryConsolidationRun.entity";
import { Repository, LessThan } from "typeorm";

export interface WorkspaceStartRunFields {
  runId: string;
  workspaceKey: string;
  startedAt: Date;
  reviewedSince?: Date | null;
  reviewedThrough?: Date | null;
}

export interface WorkspaceCompleteRunFields {
  runId: string;
  finishedAt: Date;
  chatConversationsReviewed: number;
  agentTasksReviewed: number;
  memoriesCreated: number;
  memoriesUpdated: number;
  memoriesArchived: number;
  model?: string;
}

export class AIWorkspaceMemoryConsolidationRunModel extends BaseDb {
  public repository: Repository<AIWorkspaceMemoryConsolidationRunEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    if (process.env.WORKER_TYPE) {
      throw new Error(
        "Direct database access from worker process is not allowed. " +
          "Worker should send data to main process via IPC."
      );
    }
    this.repository = this.sqliteDb.connection.getRepository(
      AIWorkspaceMemoryConsolidationRunEntity
    );
  }

  async createRunning(
    input: WorkspaceStartRunFields
  ): Promise<AIWorkspaceMemoryConsolidationRunEntity> {
    const e = new AIWorkspaceMemoryConsolidationRunEntity();
    e.runId = input.runId;
    e.status = "running";
    e.workspaceKey = input.workspaceKey;
    e.startedAt = input.startedAt;
    e.chatConversationsReviewed = 0;
    e.agentTasksReviewed = 0;
    e.memoriesCreated = 0;
    e.memoriesUpdated = 0;
    e.memoriesArchived = 0;
    if (input.reviewedSince !== undefined) e.reviewedSince = input.reviewedSince;
    if (input.reviewedThrough !== undefined)
      e.reviewedThrough = input.reviewedThrough;
    return this.repository.save(e);
  }

  async completeRun(input: WorkspaceCompleteRunFields): Promise<void> {
    await this.repository.update(
      { runId: input.runId },
      {
        status: "completed",
        finishedAt: input.finishedAt,
        chatConversationsReviewed: input.chatConversationsReviewed,
        agentTasksReviewed: input.agentTasksReviewed,
        memoriesCreated: input.memoriesCreated,
        memoriesUpdated: input.memoriesUpdated,
        memoriesArchived: input.memoriesArchived,
        model: input.model ?? null,
        errorMessage: null,
      }
    );
  }

  async failRun(
    runId: string,
    errorMessage: string,
    finishedAt: Date
  ): Promise<void> {
    await this.repository.update(
      { runId },
      { status: "failed", finishedAt, errorMessage }
    );
  }

  async getByRunId(
    runId: string
  ): Promise<AIWorkspaceMemoryConsolidationRunEntity | null> {
    return this.repository.findOne({ where: { runId } });
  }

  async getLatestSuccessfulRun(
    workspaceKey?: string
  ): Promise<AIWorkspaceMemoryConsolidationRunEntity | null> {
    return this.repository.findOne({
      where: workspaceKey
        ? { status: "completed", workspaceKey }
        : { status: "completed" },
      order: { finishedAt: "DESC" },
    });
  }

  async getRunningRun(
    workspaceKey?: string
  ): Promise<AIWorkspaceMemoryConsolidationRunEntity | null> {
    return this.repository.findOne({
      where: workspaceKey
        ? { status: "running", workspaceKey }
        : { status: "running" },
    });
  }

  async markStaleRunningFailed(before: Date): Promise<number> {
    const r = await this.repository.update(
      { status: "running", startedAt: LessThan(before) },
      {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: "stale_recovery",
      }
    );
    return r.affected ?? 0;
  }
}
