import { Repository } from "typeorm";
import { BaseDb } from "@/model/Basedb";
import { EmailFilterDetailEntity } from "@/entity/EmailFilterDetail.entity";

export class EmailFilterDetailModel extends BaseDb {
  private readonly repository: Repository<EmailFilterDetailEntity>;

  constructor(filepath: string) {
    // BaseDb resolves an empty filepath to a temp dir (test/dev envs where
    // USERSDBPATH is not set) and sets this.sqliteDb. Previously this model
    // called SqliteDb.getInstance(filepath) directly and threw "Cannot create
    // SqliteDb instance with empty filepath" when constructed before the DB
    // path was established (e.g. in emailMarketingController.test.ts).
    super(filepath);
    this.repository = this.sqliteDb.connection.getRepository(
      EmailFilterDetailEntity
    );
  }

  async create(detail: EmailFilterDetailEntity): Promise<number> {
    const result = await this.repository.save(detail);
    return result.id;
  }

  async read(id: number): Promise<EmailFilterDetailEntity | undefined> {
    const result = await this.repository.findOne({ where: { id } });
    return result || undefined;
  }

  async update(id: number, detail: EmailFilterDetailEntity): Promise<void> {
    await this.repository.update(id, detail);
  }

  async delete(id: number): Promise<void> {
    await this.repository.delete(id);
  }

  async getEmailFilterDetailsByFilterId(
    filterId: number
  ): Promise<EmailFilterDetailEntity[]> {
    return await this.repository.find({
      where: { filter_id: filterId },
      order: { id: "ASC" },
    });
  }

  async updateEmailFilterDetailsByFilterId(
    filterId: number,
    details: EmailFilterDetailEntity[]
  ): Promise<void> {
    // First delete existing details for this filter
    await this.deleteEmailFilterDetailsByFilterId(filterId);

    // Then insert new details
    for (const detail of details) {
      detail.filter_id = filterId;
      await this.repository.save(detail);
    }
  }

  async deleteEmailFilterDetailsByFilterId(filterId: number): Promise<void> {
    await this.repository.delete({ filter_id: filterId });
  }

  async listEmailFilterDetails(
    page: number,
    size: number
  ): Promise<EmailFilterDetailEntity[]> {
    return await this.repository.find({
      skip: page,
      take: size,
      order: { id: "ASC" },
    });
  }

  async countEmailFilterDetails(): Promise<number> {
    return await this.repository.count();
  }

  async countEmailFilterDetailsByFilterId(filterId: number): Promise<number> {
    return await this.repository.count({ where: { filter_id: filterId } });
  }

  async getEmailFilterDetailsByFilterIds(
    filterIds: number[]
  ): Promise<EmailFilterDetailEntity[]> {
    if (filterIds.length === 0) {
      return [];
    }
    return await this.repository
      .createQueryBuilder("detail")
      .where("detail.filter_id IN (:...filterIds)", { filterIds })
      .orderBy("detail.id", "ASC")
      .getMany();
  }
}
