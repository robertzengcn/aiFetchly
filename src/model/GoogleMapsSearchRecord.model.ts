import { BaseDb } from "@/model/Basedb";
import { GoogleMapsSearchRecordEntity } from "@/entity/GoogleMapsSearchRecord.entity";
import type { Repository } from "typeorm";

export class GoogleMapsSearchRecordModel extends BaseDb {
  private getRepository(): Repository<GoogleMapsSearchRecordEntity> {
    return this.sqliteDb.connection.getRepository(
      GoogleMapsSearchRecordEntity
    );
  }

  async create(
    record: Partial<GoogleMapsSearchRecordEntity>
  ): Promise<GoogleMapsSearchRecordEntity> {
    await this.ensureConnection();
    const repo = this.getRepository();
    const entity = repo.create(record);
    return await repo.save(entity);
  }

  async findById(
    id: number
  ): Promise<GoogleMapsSearchRecordEntity | null> {
    await this.ensureConnection();
    const repo = this.getRepository();
    return await repo.findOne({ where: { id } });
  }

  async findAll(
    limit = 50,
    offset = 0
  ): Promise<[GoogleMapsSearchRecordEntity[], number]> {
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
