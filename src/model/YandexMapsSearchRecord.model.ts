import { BaseDb } from "@/model/Basedb";
import { YandexMapsSearchRecordEntity } from "@/entity/YandexMapsSearchRecord.entity";
import type { Repository } from "typeorm";

export class YandexMapsSearchRecordModel extends BaseDb {
  private getRepository(): Repository<YandexMapsSearchRecordEntity> {
    return this.sqliteDb.connection.getRepository(
      YandexMapsSearchRecordEntity
    );
  }

  async create(
    record: Partial<YandexMapsSearchRecordEntity>
  ): Promise<YandexMapsSearchRecordEntity> {
    await this.ensureConnection();
    const repo = this.getRepository();
    const entity = repo.create(record);
    return await repo.save(entity);
  }

  async findById(
    id: number
  ): Promise<YandexMapsSearchRecordEntity | null> {
    await this.ensureConnection();
    const repo = this.getRepository();
    return await repo.findOne({ where: { id } });
  }

  async findAll(
    limit = 50,
    offset = 0
  ): Promise<[YandexMapsSearchRecordEntity[], number]> {
    await this.ensureConnection();
    const repo = this.getRepository();
    return await repo.findAndCount({
      order: { createdAt: "DESC" as const },
      take: limit,
      skip: offset,
    });
  }

  async deleteById(id: number): Promise<boolean> {
    await this.ensureConnection();
    const repo = this.getRepository();
    const result = await repo.delete(id);
    return (result.affected ?? 0) > 0;
  }
}
