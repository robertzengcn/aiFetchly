import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { PluginMarketplaceEntity } from "@/entity/PluginMarketplace.entity";

/**
 * Data access for plugin marketplaces. Mirrors InstalledPluginModel.
 * Source of truth: PRD §9.2, tech design §10.1.
 */
export class PluginMarketplaceModel extends BaseDb {
  private repository: Repository<PluginMarketplaceEntity> | null = null;

  constructor(filepath: string) {
    super(filepath);
  }

  private async getRepository(): Promise<Repository<PluginMarketplaceEntity>> {
    if (!this.repository) {
      await this.ensureConnection();
      this.repository =
        this.sqliteDb.connection.getRepository(PluginMarketplaceEntity);
    }
    return this.repository;
  }

  async findAll(): Promise<PluginMarketplaceEntity[]> {
    const repo = await this.getRepository();
    return await repo.find({ order: { createdAt: "DESC" } });
  }

  async findEnabled(): Promise<PluginMarketplaceEntity[]> {
    const repo = await this.getRepository();
    return await repo.find({ where: { enabled: 1 } });
  }

  async findByName(name: string): Promise<PluginMarketplaceEntity | null> {
    const repo = await this.getRepository();
    return await repo.findOne({ where: { name } });
  }

  async create(
    marketplace: Partial<PluginMarketplaceEntity>
  ): Promise<number> {
    const repo = await this.getRepository();
    const entity = repo.create(marketplace);
    const saved = await repo.save(entity);
    return saved.id;
  }

  async updateByName(
    name: string,
    data: Partial<PluginMarketplaceEntity>
  ): Promise<boolean> {
    const repo = await this.getRepository();
    const result = await repo.update({ name }, data);
    return (result.affected ?? 0) > 0;
  }

  async toggle(name: string, enabled: boolean): Promise<boolean> {
    const repo = await this.getRepository();
    const result = await repo.update({ name }, { enabled: enabled ? 1 : 0 });
    return (result.affected ?? 0) > 0;
  }

  async remove(name: string): Promise<boolean> {
    const repo = await this.getRepository();
    const result = await repo.delete({ name });
    return (result.affected ?? 0) > 0;
  }
}
