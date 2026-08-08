import { BaseDb } from "./Basedb";
import { Brackets, In, Repository } from "typeorm";
import { ProxyEntity } from "@/entity/Proxy.entity";
import { ProxyListEntity } from "@/entityTypes/proxyType";

export class ProxyModel extends BaseDb {
  private repository: Repository<ProxyEntity> | null = null;

  constructor(filepath: string) {
    super(filepath);
  }

  private async getRepository(): Promise<Repository<ProxyEntity>> {
    if (!this.repository) {
      await this.ensureConnection();
      this.repository = this.sqliteDb.connection.getRepository(ProxyEntity);
    }
    return this.repository;
  }

  /**
   * Get proxy list with pagination and search
   */
  async getProxyList(
    page: number,
    size: number,
    search: string
  ): Promise<{ total: number; records: ProxyListEntity[] }> {
    const repository = await this.getRepository();
    const queryBuilder = repository.createQueryBuilder("proxy");

    if (search && search.trim().length > 0) {
      queryBuilder.where(
        "proxy.host LIKE :search OR proxy.port LIKE :search OR proxy.user LIKE :search OR proxy.protocol LIKE :search",
        { search: `%${search}%` }
      );
    }

    const total = await queryBuilder.getCount();

    const records = await queryBuilder
      .skip((page - 1) * size)
      .take(size)
      .orderBy("proxy.createdAt", "DESC")
      .getMany();

    // Convert to ProxyListEntity format
    const proxyListEntities: ProxyListEntity[] = records.map((proxy) => ({
      id: proxy.id,
      host: proxy.host,
      port: proxy.port,
      username: proxy.user,
      password: proxy.pass,
      protocol: proxy.protocol,
      country_code: proxy.country_code,
      addtime: proxy.addtime || "",
      checktime: proxy.updatedAt?.toISOString(),
      status: 1, // Default status
      statusName: "Active",
    }));

    return {
      total,
      records: proxyListEntities,
    };
  }

  /**
   * Get proxy by ID
   */
  async getProxyById(id: number): Promise<ProxyEntity | null> {
    const repository = await this.getRepository();
    return await repository.findOne({ where: { id } });
  }

  /**
   * Batch-load full proxy entities for many ids in one query. Replaces N
   * per-id `getProxyById`/`getProxyDetail` round-trips when building
   * redacted summaries for a set of proxies.
   */
  async findByIds(ids: readonly number[]): Promise<ProxyEntity[]> {
    if (ids.length === 0) {
      return [];
    }
    const repository = await this.getRepository();
    return repository.find({ where: { id: In(ids) } });
  }

  /**
   * Save or update proxy
   */
  async saveProxy(proxyData: Partial<ProxyEntity>): Promise<ProxyEntity> {
    const repository = await this.getRepository();
    if (proxyData.id) {
      // Update existing proxy
      await repository.update(proxyData.id, proxyData);
      return (await this.getProxyById(proxyData.id)) as ProxyEntity;
    } else {
      // Create new proxy
      const proxy = repository.create(proxyData);
      return await repository.save(proxy);
    }
  }

  /**
   * Delete proxy by ID
   */
  async deleteProxy(id: number): Promise<boolean> {
    const repository = await this.getRepository();
    const result = await repository.delete(id);
    return result.affected ? result.affected > 0 : false;
  }

  /**
   * Get total count of proxies
   */
  async getProxyCount(): Promise<number> {
    const repository = await this.getRepository();
    return await repository.count();
  }

  /**
   * Import multiple proxies
   */
  async importProxies(
    proxies: Array<{
      host: string;
      port: string;
      user?: string;
      pass?: string;
      protocol?: string;
    }>
  ): Promise<number> {
    const repository = await this.getRepository();
    const proxyEntities = proxies.map((proxy) =>
      repository.create({
        host: proxy.host,
        port: proxy.port,
        user: proxy.user,
        pass: proxy.pass,
        protocol: proxy.protocol,
      })
    );

    const result = await repository.save(proxyEntities);
    return result.length;
  }

  /**
   * Check if proxy exists by host and port
   */
  async proxyExists(host: string, port: string): Promise<boolean> {
    const repository = await this.getRepository();
    const count = await repository.count({
      where: { host, port },
    });
    return count > 0;
  }

  /**
   * Filter out proxies that already exist in the database
   */
  async filterUniqueProxies(
    proxies: Array<{
      host: string;
      port: string;
      user?: string;
      pass?: string;
      protocol?: string;
    }>
  ): Promise<
    Array<{
      host: string;
      port: string;
      user?: string;
      pass?: string;
      protocol?: string;
    }>
  > {
    const repository = await this.getRepository();
    const uniqueProxies: Array<{
      host: string;
      port: string;
      user?: string;
      pass?: string;
      protocol?: string;
    }> = [];

    // Get all existing host:port combinations in one query
    const existingProxies = await repository.find({
      select: ["host", "port"],
    });
    const existingSet = new Set(
      existingProxies.map((p) => `${p.host}:${p.port}`)
    );

    // Filter out duplicates
    for (const proxy of proxies) {
      const key = `${proxy.host}:${proxy.port}`;
      if (!existingSet.has(key)) {
        uniqueProxies.push(proxy);
      }
    }

    return uniqueProxies;
  }

  /**
   * Return full proxy entities matching any of the provided (host, port)
   * pairs. Used by the AI import tool for duplicate detection and for
   * reloading redacted summaries after import.
   */
  async findByHostPortPairs(
    pairs: ReadonlyArray<{ host: string; port: string }>
  ): Promise<ProxyEntity[]> {
    if (pairs.length === 0) {
      return [];
    }

    const repository = await this.getRepository();
    const qb = repository.createQueryBuilder("proxy");
    qb.where(
      new Brackets((subQuery) => {
        pairs.forEach((pair, index) => {
          const hostKey = `host${index}`;
          const portKey = `port${index}`;
          const condition = `proxy.host = :${hostKey} AND proxy.port = :${portKey}`;
          const params: Record<string, string> = {
            [hostKey]: pair.host,
            [portKey]: pair.port,
          };
          if (index === 0) {
            subQuery.where(condition, params);
          } else {
            subQuery.orWhere(condition, params);
          }
        });
      })
    );
    return qb.getMany();
  }
}
