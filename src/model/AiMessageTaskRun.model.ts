import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { AiMessageTaskRunEntity } from "@/entity/AiMessageTaskRun.entity";
import type { AiMessageTaskRunStatus } from "@/entityTypes/aiMessageTaskTypes";

export class AiMessageTaskRunModel extends BaseDb {
  private repository: Repository<AiMessageTaskRunEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository =
      this.sqliteDb.connection.getRepository(AiMessageTaskRunEntity);
  }

  async create(entity: Partial<AiMessageTaskRunEntity>): Promise<number> {
    const saved = await this.repository.save(entity);
    return saved.id;
  }

  async updateStatus(
    id: number,
    status: AiMessageTaskRunStatus,
    data?: Partial<AiMessageTaskRunEntity>
  ): Promise<void> {
    await this.repository.update(id, { status, ...data });
  }

  async getById(id: number): Promise<AiMessageTaskRunEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  async listByTask(
    taskId: number,
    page = 1,
    limit = 20
  ): Promise<{ items: AiMessageTaskRunEntity[]; total: number }> {
    const [items, total] = await this.repository.findAndCount({
      where: { task_id: taskId },
      order: { id: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total };
  }

  async listBySchedule(
    scheduleId: number,
    page = 1,
    limit = 20
  ): Promise<{ items: AiMessageTaskRunEntity[]; total: number }> {
    const [items, total] = await this.repository.findAndCount({
      where: { schedule_id: scheduleId },
      order: { id: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total };
  }

  async getLatestByTask(
    taskId: number
  ): Promise<AiMessageTaskRunEntity | null> {
    return this.repository.findOne({
      where: { task_id: taskId },
      order: { id: "DESC" },
    });
  }
}
