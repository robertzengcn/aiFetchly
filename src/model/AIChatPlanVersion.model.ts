import { BaseDb } from "@/model/Basedb";
import { AIChatPlanVersionEntity } from "@/entity/AIChatPlanVersion.entity";
import { Repository } from "typeorm";
import type { AIChatPlanVersionAuthor } from "@/entityTypes/aiChatPlanTypes";

export class AIChatPlanVersionModel extends BaseDb {
  public repository: Repository<AIChatPlanVersionEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatPlanVersionEntity
    );
  }

  async createVersion(input: {
    planId: string;
    version: number;
    planMarkdown: string;
    planJson?: Record<string, unknown>;
    changeReason?: string;
    createdBy: AIChatPlanVersionAuthor;
  }): Promise<AIChatPlanVersionEntity> {
    const entity = new AIChatPlanVersionEntity();
    entity.planId = input.planId;
    entity.version = input.version;
    entity.planMarkdown = input.planMarkdown;
    entity.planJson = input.planJson
      ? JSON.stringify(input.planJson)
      : undefined;
    entity.changeReason = input.changeReason ?? undefined;
    entity.createdBy = input.createdBy;
    return await this.repository.save(entity);
  }

  async getLatest(planId: string): Promise<AIChatPlanVersionEntity | null> {
    return await this.repository.findOne({
      where: { planId },
      order: { version: "DESC" },
    });
  }

  async getByPlanAndVersion(
    planId: string,
    version: number
  ): Promise<AIChatPlanVersionEntity | null> {
    return await this.repository.findOne({ where: { planId, version } });
  }

  async listByPlanId(planId: string): Promise<AIChatPlanVersionEntity[]> {
    return await this.repository.find({
      where: { planId },
      order: { version: "DESC" },
    });
  }

  async deleteByPlanId(planId: string): Promise<number> {
    const result = await this.repository.delete({ planId });
    return result.affected ?? 0;
  }
}
