import { Repository } from "typeorm";
import { EmailServiceTagEntity } from "@/entity/EmailServiceTag.entity";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { BaseDb } from "@/model/Basedb";

export class EmailServiceTagModel extends BaseDb {
  private repository: Repository<EmailServiceTagEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository = this.sqliteDb.connection.getRepository(
      EmailServiceTagEntity
    );
  }

  protected override onSqliteDbRebound(): void {
    this.repository = this.sqliteDb.connection.getRepository(
      EmailServiceTagEntity
    );
  }

  async create(entity: EmailServiceTagEntity): Promise<number> {
    const savedEntity = await this.repository.save(entity);
    return savedEntity.id;
  }

  async read(id: number): Promise<EmailServiceTagEntity | undefined> {
    return (await this.repository.findOne({ where: { id } })) ?? undefined;
  }

  async update(id: number, name: string, normalizedName: string): Promise<void> {
    await this.repository.update(id, { name, normalizedName });
  }

  async delete(id: number): Promise<void> {
    await this.repository.delete(id);
  }

  async list(search?: string): Promise<EmailServiceTagEntity[]> {
    const queryBuilder = this.repository
      .createQueryBuilder("tag")
      .orderBy("LOWER(tag.name)", "ASC")
      .addOrderBy("tag.id", "ASC");

    if (search && search.trim().length > 0) {
      queryBuilder.where("tag.name LIKE :search", {
        search: `%${search.trim()}%`,
      });
    }

    return await queryBuilder.getMany();
  }

  async findByNormalizedName(
    normalizedName: string
  ): Promise<EmailServiceTagEntity | undefined> {
    return (
      (await this.repository.findOne({ where: { normalizedName } })) ??
      undefined
    );
  }

  async countServices(id: number): Promise<number> {
    return await this.sqliteDb.connection
      .getRepository(EmailServiceEntity)
      .createQueryBuilder("service")
      .where("service.tagId = :tagId", { tagId: id })
      .getCount();
  }
}
