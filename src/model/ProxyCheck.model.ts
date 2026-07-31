import { BaseDb } from "@/model/Basedb";
import { In, Repository } from "typeorm";
import { ProxyCheckEntity } from "@/entity/ProxyCheck.entity";
//import { proxyCheckStatus } from "./proxyCheckdb";

export enum proxyCheckStatus {
  Success = 1,
  Failure = 2,
}

export enum googlePassStatus {
  Pass = 1,
  Fail = 2,
}

export class ProxyCheckModel extends BaseDb {
  private repository: Repository<ProxyCheckEntity> | null = null;

  constructor(filepath: string) {
    super(filepath);
  }

  private async getRepository(): Promise<Repository<ProxyCheckEntity>> {
    if (!this.repository) {
      await this.ensureConnection();
      this.repository =
        this.sqliteDb.connection.getRepository(ProxyCheckEntity);
    }
    return this.repository;
  }

  async updateProxyCheck(
    proxyId: number,
    status: proxyCheckStatus
  ): Promise<void> {
    const repository = await this.getRepository();
    const recordtime = new Date().toISOString();

    // Check if proxy exists
    const existingProxy = await this.getProxyCheck(proxyId);

    if (!existingProxy) {
      // Create new record
      const newProxy = new ProxyCheckEntity();
      newProxy.proxy_id = proxyId;
      newProxy.status = status;
      newProxy.check_time = recordtime;
      await repository.save(newProxy);
    } else {
      // Update existing record
      existingProxy.status = status;
      existingProxy.check_time = recordtime;
      await repository.save(existingProxy);
    }
  }

  async getProxyCheck(proxyId: number): Promise<ProxyCheckEntity | null> {
    const repository = await this.getRepository();
    return repository.findOne({ where: { proxy_id: proxyId } });
  }

  /**
   * Batch-load check records for many proxy ids in one query, keyed by
   * proxy_id. Replaces N per-record `getProxyCheck` round-trips when
   * enriching a page of proxy records.
   */
  async getProxyChecksByIds(
    proxyIds: readonly number[]
  ): Promise<Map<number, ProxyCheckEntity>> {
    if (proxyIds.length === 0) {
      return new Map();
    }
    const repository = await this.getRepository();
    const rows = await repository.find({
      where: { proxy_id: In(proxyIds) },
    });
    const map = new Map<number, ProxyCheckEntity>();
    for (const row of rows) {
      map.set(row.proxy_id, row);
    }
    return map;
  }

  async getProxyByStatus(
    status: proxyCheckStatus
  ): Promise<Array<{ proxy_id: number }>> {
    const repository = await this.getRepository();
    const proxies = await repository.find({
      where: { status: status },
      select: ["proxy_id"],
    });
    return proxies;
  }

  async getProxyByGooglePassStatus(
    status: googlePassStatus
  ): Promise<Array<{ proxy_id: number }>> {
    const repository = await this.getRepository();
    const proxies = await repository.find({
      where: { google_pass: status },
      select: ["proxy_id"],
    });
    return proxies;
  }

  async deleteProxyCheck(proxyId: number): Promise<number> {
    const repository = await this.getRepository();
    const result = await repository.delete({ proxy_id: proxyId });
    return result.affected || 0;
  }

  async updateGooglePassStatus(
    proxyId: number,
    status: googlePassStatus | null
  ): Promise<void> {
    const repository = await this.getRepository();
    // Check if proxy exists
    const existingProxy = await this.getProxyCheck(proxyId);

    if (!existingProxy) {
      // Create new record
      const newProxy = new ProxyCheckEntity();
      newProxy.proxy_id = proxyId;
      newProxy.google_pass = status;
      newProxy.check_time = new Date().toISOString();
      await repository.save(newProxy);
    } else {
      // Update existing record
      existingProxy.google_pass = status;
      await repository.save(existingProxy);
    }
  }
}
