import { BaseDb } from "@/model/Basedb";
import { SkillCredentialBindingEntity } from "@/entity/SkillCredentialBinding.entity";
import { Repository } from "typeorm";

export class SkillCredentialBindingModel extends BaseDb {
  public repository: Repository<SkillCredentialBindingEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      SkillCredentialBindingEntity
    );
  }

  async upsert(
    entity: {
      installationId: string;
      environmentVariable: string;
      bindingRef: string;
      status: string;
      storedAt: Date;
    }
  ): Promise<SkillCredentialBindingEntity> {
    const existing = await this.repository.findOneBy({
      installationId: entity.installationId,
      environmentVariable: entity.environmentVariable,
    });
    if (existing) {
      await this.repository.update(
        { id: existing.id },
        {
          bindingRef: entity.bindingRef,
          status: entity.status,
          storedAt: entity.storedAt,
        }
      );
      const refreshed = await this.repository.findOneBy({ id: existing.id });
      return refreshed ?? existing;
    }
    return this.repository.save(entity as SkillCredentialBindingEntity);
  }

  async listByInstallation(
    installationId: string
  ): Promise<SkillCredentialBindingEntity[]> {
    return this.repository.find({
      where: { installationId },
      order: { storedAt: "ASC" },
    });
  }

  async markDeleted(
    installationId: string,
    environmentVariable?: string
  ): Promise<number> {
    const rows = await this.repository.find({ where: { installationId } });
    let affected = 0;
    for (const row of rows) {
      if (
        environmentVariable !== undefined &&
        row.environmentVariable !== environmentVariable
      ) {
        continue;
      }
      await this.repository.update({ id: row.id }, { status: "deleted" });
      affected += 1;
    }
    return affected;
  }

  async deleteByInstallation(
    installationId: string,
    environmentVariable?: string
  ): Promise<number> {
    const rows = await this.repository.find({ where: { installationId } });
    let affected = 0;
    for (const row of rows) {
      if (
        environmentVariable !== undefined &&
        row.environmentVariable !== environmentVariable
      ) {
        continue;
      }
      await this.repository.delete({ id: row.id });
      affected += 1;
    }
    return affected;
  }
}
