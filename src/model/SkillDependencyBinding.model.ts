import { BaseDb } from "@/model/Basedb";
import { SkillDependencyBindingEntity } from "@/entity/SkillDependencyBinding.entity";
import { Repository } from "typeorm";

/**
 * Data access for persistent skill dependency bindings (design §14.1 /
 * audit R9): the record of WHAT was detected for an installation — kind,
 * status, detected/required version, resolved path, provider, probe
 * evidence, and the last verification time. Never owns shared packages.
 */
export class SkillDependencyBindingModel extends BaseDb {
  public repository: Repository<SkillDependencyBindingEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      SkillDependencyBindingEntity
    );
  }

  /** Insert-or-refresh one binding row keyed by (installation, name). */
  async upsert(
    entity: {
      installationId: string;
      dependencyName: string;
      kind: string;
      status: string;
      detectedVersion?: string;
      requiredVersion?: string;
      resolvedPath?: string;
      provider?: string;
      probeEvidence?: string;
      verifiedAt?: Date;
    }
  ): Promise<SkillDependencyBindingEntity> {
    const existing = await this.repository.findOneBy({
      installationId: entity.installationId,
      dependencyName: entity.dependencyName,
    });
    if (existing) {
      await this.repository.update({ id: existing.id }, entity);
      const refreshed = await this.repository.findOneBy({ id: existing.id });
      return refreshed ?? existing;
    }
    return this.repository.save(entity as SkillDependencyBindingEntity);
  }

  async listByInstallation(
    installationId: string
  ): Promise<SkillDependencyBindingEntity[]> {
    return this.repository.find({
      where: { installationId },
      order: { dependencyName: "ASC" },
    });
  }

  async deleteByInstallation(installationId: string): Promise<number> {
    const rows = await this.repository.find({ where: { installationId } });
    let affected = 0;
    for (const row of rows) {
      await this.repository.delete({ id: row.id });
      affected += 1;
    }
    return affected;
  }
}
