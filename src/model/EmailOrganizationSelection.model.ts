import { Repository } from "typeorm";
import { BaseDb } from "@/model/Basedb";
import { EmailOrganizationSelectionEntity } from "@/entity/EmailOrganizationSelection.entity";
import { log } from "@/modules/Logger";

/**
 * Data access for frozen bulk selections (design §11). Rows are write-once:
 * expiry or consumption never mutates the frozen set, it only gates reuse.
 */
export class EmailOrganizationSelectionModel extends BaseDb {
  constructor(filepath: string) {
    super(filepath);
  }

  private get repository(): Repository<EmailOrganizationSelectionEntity> {
    return this.sqliteDb.connection.getRepository(EmailOrganizationSelectionEntity);
  }

  async create(
    entity: {
      [K in keyof Omit<
        EmailOrganizationSelectionEntity,
        "id" | "createdAt" | "updatedAt"
      > as EmailOrganizationSelectionEntity[K] extends (...args: never[]) => unknown
        ? never
        : K]: EmailOrganizationSelectionEntity[K];
    }
  ): Promise<EmailOrganizationSelectionEntity> {
    return await this.repository.save(this.repository.create(entity));
  }

  async read(selectionId: string): Promise<EmailOrganizationSelectionEntity | null> {
    return await this.repository.findOne({ where: { selectionId } });
  }

  /** Retention: deletes selections whose expiry has passed. */
  async purgeExpiredSelections(now: Date): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .where("expiresAt < :now", { now })
      .execute();
    return result.affected ?? 0;
  }
}

