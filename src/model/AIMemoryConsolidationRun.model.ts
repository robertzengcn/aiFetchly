import { BaseDb } from "@/model/Basedb";
import { AIMemoryConsolidationRunEntity } from "@/entity/AIMemoryConsolidationRun.entity";
import { Repository, LessThan } from "typeorm";

export interface StartRunFields {
  runId: string;
  startedAt: Date;
  reviewedSince?: Date | null;
  reviewedThrough?: Date | null;
}

export interface CompleteRunFields {
  runId: string;
  finishedAt: Date;
  chatConversationsReviewed: number;
  agentTasksReviewed: number;
  memoriesCreated: number;
  memoriesUpdated: number;
  memoriesArchived: number;
  model?: string;
}

export class AIMemoryConsolidationRunModel extends BaseDb {
  public repository: Repository<AIMemoryConsolidationRunEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIMemoryConsolidationRunEntity
    );
  }

  async createRunning(
    input: StartRunFields
  ): Promise<AIMemoryConsolidationRunEntity> {
    const e = new AIMemoryConsolidationRunEntity();
    e.runId = input.runId;
    e.status = "running";
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

  async completeRun(input: CompleteRunFields): Promise<void> {
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
  ): Promise<AIMemoryConsolidationRunEntity | null> {
    return this.repository.findOne({ where: { runId } });
  }

  async getLatestSuccessfulRun(): Promise<AIMemoryConsolidationRunEntity | null> {
    return this.repository.findOne({
      where: { status: "completed" },
      order: { finishedAt: "DESC" },
    });
  }

  async getRunningRun(): Promise<AIMemoryConsolidationRunEntity | null> {
    return this.repository.findOne({ where: { status: "running" } });
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
