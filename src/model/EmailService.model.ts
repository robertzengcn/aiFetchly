import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { EmailServiceEntity } from "@/entity/EmailService.entity";
import { SortBy } from "@/entityTypes/commonType";

export class EmailServiceModel extends BaseDb {
  private repository: Repository<EmailServiceEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository =
      this.sqliteDb.connection.getRepository(EmailServiceEntity);
  }

  protected override onSqliteDbRebound(): void {
    this.repository = this.sqliteDb.connection.getRepository(EmailServiceEntity);
  }

  async create(entity: EmailServiceEntity): Promise<number> {
    const savedEntity = await this.repository.save(entity);
    return savedEntity.id;
  }

  async read(id: number): Promise<EmailServiceEntity | undefined> {
    const entity = await this.repository
      .createQueryBuilder("service")
      .leftJoinAndSelect("service.tag", "tag")
      .where("service.id = :id", { id })
      .getOne();
    return entity ?? undefined;
  }

  /**
   * Read the complete effective identity for a service (§22.2). Returns null
   * when the service does not exist. Does not decrypt passwords.
   */
  async readIdentity(id: number): Promise<{
    smtpUsername: string | null;
    from: string;
    replyTo: string | null;
    receiveUsername: string | null;
  } | null> {
    const entity = await this.read(id);
    if (!entity) return null;
    return {
      smtpUsername: entity.smtpUsername ?? null,
      from: entity.from,
      replyTo: entity.replyTo ?? null,
      receiveUsername: entity.receiveUsername ?? null,
    };
  }

  async update(id: number, service: EmailServiceEntity): Promise<void> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return;

    Object.assign(entity, service);
    entity.id = id;

    await this.repository.save(entity);
  }

  async delete(id: number): Promise<void> {
    await this.repository.delete(id);
  }

  async updateServiceStatus(id: number, status: number): Promise<void> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return;

    entity.status = status;
    await this.repository.save(entity);
  }

  async listEmailServices(
    page: number,
    size: number,
    search?: string,
    tagId?: number,
    untagged?: boolean,
    sort?: SortBy
  ): Promise<EmailServiceEntity[]> {
    let queryBuilder = this.repository
      .createQueryBuilder("service")
      .leftJoinAndSelect("service.tag", "tag");
    if (search) {
      queryBuilder = queryBuilder.where("(service.name LIKE :search OR service.from LIKE :search)", {
        search: `%${search}%`,
      });
    }
    if (tagId !== undefined) {
      queryBuilder = queryBuilder.andWhere("service.tagId = :tagId", {
        tagId,
      });
    }
    if (untagged === true) {
      queryBuilder = queryBuilder.andWhere("service.tagId IS NULL");
    }
    if (sort?.key && sort?.order) {
      const lowsersortkey = sort.key.toLowerCase();
      const lowsersortorder = sort.order.toLowerCase();
      const allowsortkey = ["id", "name", "host", "status", "createdAt"];
      const allowsortorder = ["asc", "desc"];

      if (!allowsortkey.includes(lowsersortkey)) {
        throw new Error("not allow sort key");
      }
      if (!allowsortorder.includes(lowsersortorder)) {
        throw new Error("not allow sort order");
      }

      queryBuilder = queryBuilder.orderBy(
        `service.${lowsersortkey}`,
        lowsersortorder.toUpperCase() as "ASC" | "DESC"
      );
    } else {
      queryBuilder = queryBuilder.orderBy("service.id", "DESC");
    }

    queryBuilder = queryBuilder.skip(page).take(size);
    const entities = await queryBuilder.getMany();

    return entities;
  }

  async countEmailServices(tagId?: number, untagged?: boolean, search?: string): Promise<number> {
    const queryBuilder = this.repository.createQueryBuilder("service");
    if (search) {
      queryBuilder.andWhere("(service.name LIKE :search OR service.from LIKE :search)", { search: `%${search}%` });
    }
    if (tagId !== undefined) {
      queryBuilder.andWhere("service.tagId = :tagId", { tagId });
    }
    if (untagged === true) {
      queryBuilder.andWhere("service.tagId IS NULL");
    }
    return await queryBuilder.getCount();
  }

  async findByName(name: string): Promise<EmailServiceEntity | undefined> {
    const entity = await this.repository.findOne({ where: { name } });
    if (!entity) return undefined;

    return entity;
  }

  async findAllByTagId(tagId: number): Promise<EmailServiceEntity[]> {
    return await this.repository
      .createQueryBuilder("service")
      .leftJoinAndSelect("service.tag", "tag")
      .where("service.tagId = :tagId", { tagId })
      .orderBy("service.id", "DESC")
      .getMany();
  }

  async findByHost(host: string): Promise<EmailServiceEntity[]> {
    const entities = await this.repository.find({
      where: { host },
      order: { id: "DESC" },
    });

    return entities;
  }

  /** Services with inbound receive enabled. */
  async listReceiveEnabled(): Promise<EmailServiceEntity[]> {
    return await this.repository.find({
      where: { receiveEnabled: 1 },
      order: { id: "DESC" },
    });
  }

  /** Update receive sync tracking fields without touching SMTP/send config. */
  async updateReceiveSyncState(
    id: number,
    lastReceiveSyncAt: Date | null,
    lastReceiveSyncError: string | null
  ): Promise<void> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return;
    entity.lastReceiveSyncAt = lastReceiveSyncAt;
    entity.lastReceiveSyncError = lastReceiveSyncError;
    await this.repository.save(entity);
  }
}
