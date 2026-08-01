import { BaseDb } from "@/model/Basedb";
import { AIChatGoalEntity } from "@/entity/AIChatGoal.entity";
import { Repository } from "typeorm";
import type { AIChatGoalStatus } from "@/entityTypes/aiChatGoalTypes";

const TERMINAL_STATUSES: AIChatGoalStatus[] = [
  "complete",
  "blocked",
  "failed",
  "cancelled",
];

/** Data-access layer for ai_chat_goals. Repository operations only. */
export class AIChatGoalModel extends BaseDb {
  public repository: Repository<AIChatGoalEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(AIChatGoalEntity);
  }

  async createGoal(input: {
    goalId: string;
    conversationId: string;
    objective: string;
    criteria: string;
    planId?: string;
    status: AIChatGoalStatus;
    loopLimits?: string;
  }): Promise<AIChatGoalEntity> {
    const entity = new AIChatGoalEntity();
    entity.goalId = input.goalId;
    entity.conversationId = input.conversationId;
    entity.objective = input.objective;
    entity.criteria = input.criteria;
    entity.planId = input.planId;
    entity.status = input.status;
    entity.loopLimits = input.loopLimits;
    entity.iterationCount = 0;
    return await this.repository.save(entity);
  }

  async getByGoalId(goalId: string): Promise<AIChatGoalEntity | null> {
    return await this.repository.findOne({ where: { goalId } });
  }

  /** Newest non-terminal goal for a conversation. */
  async getActiveByConversation(
    conversationId: string
  ): Promise<AIChatGoalEntity | null> {
    const goals = await this.repository.find({
      where: { conversationId },
      order: { createdAt: "DESC" },
    });
    return goals.find((g) => !TERMINAL_STATUSES.includes(g.status)) ?? null;
  }

  async save(entity: AIChatGoalEntity): Promise<AIChatGoalEntity> {
    return await this.repository.save(entity);
  }

  async setStatus(
    goalId: string,
    status: AIChatGoalStatus,
    patch?: Partial<
      Pick<
        AIChatGoalEntity,
        | "iterationCount"
        | "latestVerdict"
        | "terminalReason"
        | "sourceRevisionFingerprint"
        | "planId"
        | "criteria"
        | "loopLimits"
      >
    >
  ): Promise<void> {
    await this.repository.update(
      { goalId },
      { status, ...patch }
    );
  }
}
