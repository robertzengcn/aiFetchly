import { BaseDb } from "@/model/Basedb";
import { AIChatPlanEntity } from "@/entity/AIChatPlan.entity";
import { Repository, In } from "typeorm";
import type { AIChatPlanStatus } from "@/entityTypes/aiChatPlanTypes";

const TERMINAL_STATUSES: AIChatPlanStatus[] = [
  "completed",
  "cancelled",
  "rejected",
];

export class AIChatPlanModel extends BaseDb {
  public repository: Repository<AIChatPlanEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(AIChatPlanEntity);
  }

  async createPlan(input: {
    planId: string;
    conversationId: string;
    title: string;
    objective: string;
    status: AIChatPlanStatus;
    metadata?: Record<string, unknown>;
  }): Promise<AIChatPlanEntity> {
    const entity = new AIChatPlanEntity();
    entity.planId = input.planId;
    entity.conversationId = input.conversationId;
    entity.title = input.title;
    entity.objective = input.objective;
    entity.status = input.status;
    entity.currentVersion = 0;
    entity.metadata = input.metadata ? JSON.stringify(input.metadata) : null;
    return await this.repository.save(entity);
  }

  async getByPlanId(planId: string): Promise<AIChatPlanEntity | null> {
    return await this.repository.findOne({ where: { planId } });
  }

  /** Returns the newest non-terminal plan for a conversation. */
  async getActiveByConversation(
    conversationId: string
  ): Promise<AIChatPlanEntity | null> {
    const plans = await this.repository.find({
      where: { conversationId },
      order: { createdAt: "DESC" },
    });
    return plans.find((p) => !TERMINAL_STATUSES.includes(p.status)) ?? null;
  }

  /** Fetch active plans for many conversations (avoids N+1 in history lists). */
  async getActiveByConversationIds(
    conversationIds: string[]
  ): Promise<Map<string, AIChatPlanEntity>> {
    const result = new Map<string, AIChatPlanEntity>();
    if (conversationIds.length === 0) return result;
    const plans = await this.repository.find({
      where: { conversationId: In(conversationIds) },
      order: { createdAt: "DESC" },
    });
    for (const plan of plans) {
      if (TERMINAL_STATUSES.includes(plan.status)) continue;
      if (!result.has(plan.conversationId)) {
        result.set(plan.conversationId, plan);
      }
    }
    return result;
  }

  async updateStatus(input: {
    planId: string;
    status: AIChatPlanStatus;
    approvedAt?: Date;
    rejectedAt?: Date;
  }): Promise<void> {
    await this.repository.update(
      { planId: input.planId },
      {
        status: input.status,
        ...(input.approvedAt !== undefined
          ? { approvedAt: input.approvedAt }
          : {}),
        ...(input.rejectedAt !== undefined
          ? { rejectedAt: input.rejectedAt }
          : {}),
      }
    );
  }

  async updateTitle(
    planId: string,
    title: string,
    objective: string
  ): Promise<void> {
    await this.repository.update({ planId }, { title, objective });
  }

  async updateCurrentVersion(planId: string, version: number): Promise<void> {
    await this.repository.update({ planId }, { currentVersion: version });
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    const result = await this.repository.delete({ conversationId });
    return result.affected ?? 0;
  }
}
