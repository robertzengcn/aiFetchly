import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { AiMessageTaskEntity } from "@/entity/AiMessageTask.entity";

export class AiMessageTaskModel extends BaseDb {
  private repository: Repository<AiMessageTaskEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository =
      this.sqliteDb.connection.getRepository(AiMessageTaskEntity);
  }

  async create(entity: Partial<AiMessageTaskEntity>): Promise<number> {
    const saved = await this.repository.save(entity);
    return saved.id;
  }

  async update(id: number, data: Partial<AiMessageTaskEntity>): Promise<void> {
    await this.repository.update(id, data);
  }

  async getById(id: number): Promise<AiMessageTaskEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  async list(
    page = 1,
    limit = 50
  ): Promise<{ items: AiMessageTaskEntity[]; total: number }> {
    const [items, total] = await this.repository.findAndCount({
      where: { status: "active" },
      order: { id: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total };
  }

  async deleteById(id: number): Promise<void> {
    await this.repository.update(id, { status: "deleted" });
  }

  async updateLastRun(
    id: number,
    resultSummary: string | null,
    errorMessage: string | null
  ): Promise<void> {
    await this.repository.update(id, {
      last_run_time: new Date(),
      last_result_summary: resultSummary ?? undefined,
      last_error_message: errorMessage ?? undefined,
    });
  }
}
