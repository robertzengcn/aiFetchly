import { BaseDb } from "@/model/Basedb";
import { AIChatPlanApprovalEntity } from "@/entity/AIChatPlanApproval.entity";
import { Repository } from "typeorm";
import type { AIChatPlanApprovalDecision } from "@/entityTypes/aiChatPlanTypes";

export class AIChatPlanApprovalModel extends BaseDb {
  public repository: Repository<AIChatPlanApprovalEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatPlanApprovalEntity
    );
  }

  async createDecision(input: {
    planId: string;
    version: number;
    decision: AIChatPlanApprovalDecision;
    feedback?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AIChatPlanApprovalEntity> {
    const entity = new AIChatPlanApprovalEntity();
    entity.planId = input.planId;
    entity.version = input.version;
    entity.decision = input.decision;
    entity.feedback = input.feedback ?? undefined;
    entity.metadata = input.metadata
      ? JSON.stringify(input.metadata)
      : undefined;
    return await this.repository.save(entity);
  }

  async listByPlan(planId: string): Promise<AIChatPlanApprovalEntity[]> {
    return await this.repository.find({
      where: { planId },
      order: { createdAt: "DESC" },
    });
  }

  async deleteByPlan(planId: string): Promise<number> {
    const result = await this.repository.delete({ planId });
    return result.affected ?? 0;
  }
}
