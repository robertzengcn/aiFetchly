import { BaseDb } from "@/model/Basedb";
import { AIChatGoalRunEntity } from "@/entity/AIChatGoalRun.entity";
import { Repository } from "typeorm";
import type { AIChatGoalStatus } from "@/entityTypes/aiChatGoalTypes";

const ACTIVE_RUN_STATUSES: AIChatGoalStatus[] = ["running", "needs_user_input"];

/** Data-access layer for ai_chat_goal_runs. Repository operations only. */
export class AIChatGoalRunModel extends BaseDb {
  public repository: Repository<AIChatGoalRunEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatGoalRunEntity
    );
  }

  async createRun(input: {
    runId: string;
    goalId: string;
    conversationId: string;
    status: AIChatGoalStatus;
    maxIterations: number;
    maxRuntimeMs: number;
    repeatedFailureThreshold: number;
  }): Promise<AIChatGoalRunEntity> {
    const entity = new AIChatGoalRunEntity();
    entity.runId = input.runId;
    entity.goalId = input.goalId;
    entity.conversationId = input.conversationId;
    entity.status = input.status;
    entity.maxIterations = input.maxIterations;
    entity.maxRuntimeMs = input.maxRuntimeMs;
    entity.repeatedFailureThreshold = input.repeatedFailureThreshold;
    entity.iterationCount = 0;
    entity.cancelled = false;
    entity.startedAt = new Date();
    return await this.repository.save(entity);
  }

  async getByRunId(runId: string): Promise<AIChatGoalRunEntity | null> {
    return await this.repository.findOne({ where: { runId } });
  }

  /** The currently active (running or paused) run for a goal, if any. */
  async getActiveByGoal(
    goalId: string
  ): Promise<AIChatGoalRunEntity | null> {
    const runs = await this.repository.find({
      where: { goalId },
      order: { startedAt: "DESC" },
    });
    return runs.find((r) => ACTIVE_RUN_STATUSES.includes(r.status)) ?? null;
  }

  async save(entity: AIChatGoalRunEntity): Promise<AIChatGoalRunEntity> {
    return await this.repository.save(entity);
  }

  async endRun(
    runId: string,
    status: AIChatGoalStatus,
    patch?: Partial<
      Pick<AIChatGoalRunEntity, "iterationCount" | "cancelled" | "terminalReason">
    >
  ): Promise<void> {
    await this.repository.update(
      { runId },
      { status, endedAt: new Date(), ...patch }
    );
  }
}
