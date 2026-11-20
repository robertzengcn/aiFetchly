import { BaseDb } from "./Basedb";
import { Brackets, In, Repository } from "typeorm";
import { ProxyEntity } from "@/entity/Proxy.entity";
import { ProxyListEntity } from "@/entityTypes/proxyType";
import { ProxyCredentialCodec } from "@/modules/browserProxy/ProxyCredentialCodec";

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

    // Convert to ProxyListEntity format. Passwords decrypt in the main
    // process only (P-FR-08); legacy plaintext rows migrate lazily.
    const proxyListEntities: ProxyListEntity[] = [];
    for (const proxy of records) {
      const decrypted = await ProxyCredentialCodec.decryptForUse(proxy.pass);
      if (decrypted.needsMigration && decrypted.password) {
        await this.migratePlaintextPass(
          proxy.id,
          decrypted.password,
          proxy.pass
        );
      }
      proxyListEntities.push({
        id: proxy.id,
        host: proxy.host,
        port: proxy.port,
        username: proxy.user,
        // B10/P-FR-07: the renderer list NEVER receives the password —
        // only whether one is stored (decryption above still drives the
        // legacy-plaintext migration).
        hasPassword: Boolean(decrypted.password),
        protocol: proxy.protocol,
        country_code: proxy.country_code,
        addtime: proxy.addtime || "",
        // R09/P-FR: the row's updatedAt is an EDIT timestamp, not check
        // evidence — presenting it as checktime let an unchecked row look
        // checked (the AI projection requires a checktime for "pass").
        // The controller enriches rows that have REAL check records.
        checktime: undefined,
        // R09/P-FR: an unchecked row inherits NO passing result from the
        // defaults — statusName stays "Unchecked" until the controller
        // enrichment confirms a real check record (the AI projection's
        // mapBasicStatus already requires a checktime for "pass").
        status: 0,
        statusName: "Unchecked",
        browser_usable:
          proxy.protocol === null || proxy.protocol === undefined
            ? true
            : ["http", "https"].includes(proxy.protocol.toLowerCase()),
      });
    }

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
   * E07/P-FR-01: ALL stored proxy entities (raw, encrypted-at-rest) for
   * the main-process auto selector. Bounded to 1000 rows.
   */
  async listAllRaw(): Promise<ProxyEntity[]> {
    const repository = await this.getRepository();
    return await repository.find({ take: 1000 });
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
    // P-FR-08: proxy passwords are encrypted at rest with FieldCipher.
    const toPersist: Partial<ProxyEntity> = { ...proxyData };
    if (proxyData.pass !== undefined) {
      // T11: metadata-only updates (no pass field) must NOT overwrite the
      // stored credential; an explicit pass (or empty string) is set.
      if (proxyData.pass === "") {
        toPersist.pass = null as unknown as string;
      } else {
        toPersist.pass =
          (await ProxyCredentialCodec.encryptForStorage(proxyData.pass)) ??
          undefined;
      }
    }
    if (proxyData.id) {
      // Update existing proxy
      await repository.update(proxyData.id, toPersist);
      return (await this.getProxyById(proxyData.id)) as ProxyEntity;
    } else {
      // Create new proxy
      const proxy = repository.create(toPersist);
      return await repository.save(proxy);
    }
  }

  /** One-time lazy migration of a legacy plaintext pass (P-FR-08). */
  /** N04: migrate a legacy plaintext row to encrypted at rest. */
  public async migratePlaintextPass(
    id: number,
    plaintext: string,
    /** R09: the stored value the plaintext was decrypted FROM. */
    storedPass?: string
  ): Promise<void> {
    try {
      const encrypted = await ProxyCredentialCodec.encryptForStorage(plaintext);
      if (encrypted) {
        const repository = await this.getRepository();
        // R09: atomic compare-and-set — the migration lands ONLY when
        // the stored value is still the one we decrypted from; a
        // concurrent password edit is never overwritten by the stale
        // plaintext.
        const criteria =
          typeof storedPass === "string" ? { id, pass: storedPass } : { id };
        await repository.update(criteria, { pass: encrypted });
      }
    } catch (error) {
      // Migration is best-effort; the plaintext row is retried on next read.
      console.warn(
        `[ProxyModel] plaintext pass migration failed for id=${id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
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
    const proxyEntities = [];
    for (const proxy of proxies) {
      proxyEntities.push(
        repository.create({
          host: proxy.host,
          port: proxy.port,
          user: proxy.user,
          // P-FR-08: encrypt imported passwords at rest.
          pass:
            (await ProxyCredentialCodec.encryptForStorage(proxy.pass ?? null)) ??
            undefined,
          protocol: proxy.protocol,
        })
      );
    }

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
