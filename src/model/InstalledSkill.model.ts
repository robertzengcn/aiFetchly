import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { InstalledSkillEntity } from "@/entity/InstalledSkill.entity";

export class InstalledSkillModel extends BaseDb {
  private repository: Repository<InstalledSkillEntity> | null = null;

  constructor(filepath: string) {
    super(filepath);
  }

  private async getRepository(): Promise<Repository<InstalledSkillEntity>> {
    if (!this.repository) {
      await this.ensureConnection();
      this.repository =
        this.sqliteDb.connection.getRepository(InstalledSkillEntity);
    }
    return this.repository;
  }

  async findAll(): Promise<InstalledSkillEntity[]> {
    const repo = await this.getRepository();
    return await repo.find({
      order: { createdAt: "DESC" },
    });
  }

  async findEnabled(): Promise<InstalledSkillEntity[]> {
    const repo = await this.getRepository();
    return await repo.find({
      where: { enabled: 1 },
    });
  }

  async findByName(name: string): Promise<InstalledSkillEntity | null> {
    const repo = await this.getRepository();
    return await repo.findOne({ where: { name } });
  }

  async create(skill: Partial<InstalledSkillEntity>): Promise<number> {
    const repo = await this.getRepository();
    const entity = repo.create(skill);
    const saved = await repo.save(entity);
    return saved.id;
  }

  async updateByName(
    name: string,
    data: Partial<InstalledSkillEntity>
  ): Promise<boolean> {
    const repo = await this.getRepository();
    const result = await repo.update({ name }, data);
    return (result.affected ?? 0) > 0;
  }

  async remove(name: string): Promise<boolean> {
    const repo = await this.getRepository();
    const result = await repo.delete({ name });
    return (result.affected ?? 0) > 0;
  }

  async toggle(name: string, enabled: boolean): Promise<boolean> {
    const repo = await this.getRepository();
    const result = await repo.update({ name }, { enabled: enabled ? 1 : 0 });
    return (result.affected ?? 0) > 0;
  }

  /** Find all skills owned by a given plugin. (Design §5.2) */
  async findByPluginName(pluginName: string): Promise<InstalledSkillEntity[]> {
    const repo = await this.getRepository();
    return await repo.find({ where: { pluginName } });
  }

  /** Delete all skills owned by a given plugin. Used during plugin uninstall. */
  async deleteByPluginName(pluginName: string): Promise<number> {
    const repo = await this.getRepository();
    const result = await repo.delete({ pluginName });
    return result.affected ?? 0;
  }
}
