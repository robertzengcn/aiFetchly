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

  async create(entity: EmailServiceEntity): Promise<number> {
    const savedEntity = await this.repository.save(entity);
    return savedEntity.id;
  }

  async read(id: number): Promise<EmailServiceEntity | undefined> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) return undefined;

    return entity;
  }

  /**
   * Envelope From address for a service. TypeORM maps `from`; the legacy SQL
   * schema used `from_email`. Prefer the entity field, then COALESCE both
   * columns so older rows still resolve a sender for outbound drafts.
   */
  async readSenderAddress(id: number): Promise<string | null> {
    const entity = await this.read(id);
    const fromEntity = (entity?.from ?? "").trim();
    if (fromEntity.length > 0) {
      return fromEntity;
    }
    try {
      const rows = (await this.sqliteDb.connection.query(
        'SELECT "from" AS fromCol, from_email AS fromEmail FROM email_service WHERE id = ? LIMIT 1',
        [id]
      )) as Array<{ fromCol?: string | null; fromEmail?: string | null }>;
      const fallback = (rows[0]?.fromCol ?? rows[0]?.fromEmail ?? "").trim();
      return fallback.length > 0 ? fallback : null;
    } catch {
      // from_email may not exist on TypeORM-synchronized schemas.
      return null;
    }
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
    sort?: SortBy
  ): Promise<EmailServiceEntity[]> {
    let queryBuilder = this.repository.createQueryBuilder("service");
    if (search) {
      queryBuilder = queryBuilder.where("service.name LIKE :search", {
        search: `%${search}%`,
      });
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

  async countEmailServices(): Promise<number> {
    return await this.repository.count();
  }

  async findByName(name: string): Promise<EmailServiceEntity | undefined> {
    const entity = await this.repository.findOne({ where: { name } });
    if (!entity) return undefined;

    return entity;
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
