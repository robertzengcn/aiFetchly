import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { InstalledPluginEntity } from "@/entity/InstalledPlugin.entity";

/**
 * Data access for installed plugins. Mirrors the InstalledSkillModel pattern.
 * Source of truth: Design §6.1.
 */
export class InstalledPluginModel extends BaseDb {
  private repository: Repository<InstalledPluginEntity> | null = null;

  constructor(filepath: string) {
    super(filepath);
  }

  private async getRepository(): Promise<Repository<InstalledPluginEntity>> {
    if (!this.repository) {
      await this.ensureConnection();
      this.repository =
        this.sqliteDb.connection.getRepository(InstalledPluginEntity);
    }
    return this.repository;
  }

  async findAll(): Promise<InstalledPluginEntity[]> {
    const repo = await this.getRepository();
    return await repo.find({
      order: { createdAt: "DESC" },
    });
  }

  async findEnabled(): Promise<InstalledPluginEntity[]> {
    const repo = await this.getRepository();
    return await repo.find({
      where: { enabled: 1 },
    });
  }

  async findByName(name: string): Promise<InstalledPluginEntity | null> {
    const repo = await this.getRepository();
    return await repo.findOne({ where: { name } });
  }

  async create(
    plugin: Partial<InstalledPluginEntity>
  ): Promise<number> {
    const repo = await this.getRepository();
    const entity = repo.create(plugin);
    const saved = await repo.save(entity);
    return saved.id;
  }

  async updateByName(
    name: string,
    data: Partial<InstalledPluginEntity>
  ): Promise<boolean> {
    const repo = await this.getRepository();
    const result = await repo.update({ name }, data);
    return (result.affected ?? 0) > 0;
  }

  async toggle(name: string, enabled: boolean): Promise<boolean> {
    const repo = await this.getRepository();
    const result = await repo.update(
      { name },
      { enabled: enabled ? 1 : 0 }
    );
    return (result.affected ?? 0) > 0;
  }

  async remove(name: string): Promise<boolean> {
    const repo = await this.getRepository();
    const result = await repo.delete({ name });
    return (result.affected ?? 0) > 0;
  }

  /** Find all plugin-owned skill/MCP names is the caller's responsibility
   * (those live in their own tables keyed by pluginName). */
}
