import { BaseDb } from "@/model/Basedb";
import { Repository, EntityManager } from "typeorm";
import { OutboundEmailAuthorizationEntity } from "@/entity/OutboundEmailAuthorization.entity";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { outboundEmailAuthorizationWriteSchema } from "@/schemas/entity/outboundEmailAuthorization";
import { rejectDatabaseAccessFromWorker } from "@/model/_workerBoundaryGuard";

/**
 * Data-access model for outbound-email authorizations (technical design §7.5).
 * One authorization produces at most one send attempt (AD-009); only one
 * active authorization may exist per batch (§7.5). Raw review tokens are never
 * stored — only the SHA-256 hash.
 */
export class OutboundEmailAuthorizationModel extends BaseDb {
  private readonly repository: Repository<OutboundEmailAuthorizationEntity>;

  constructor(filepath: string) {
    super(filepath);
    rejectDatabaseAccessFromWorker("OutboundEmailAuthorizationModel");
    this.repository = this.sqliteDb.connection.getRepository(
      OutboundEmailAuthorizationEntity
    );
  }

  async create(
    entity: OutboundEmailAuthorizationEntity,
    manager?: EntityManager
  ): Promise<OutboundEmailAuthorizationEntity> {
    const stripped = parseAndStrip(
      entity,
      outboundEmailAuthorizationWriteSchema()
    ) as unknown as OutboundEmailAuthorizationEntity;
    const repo =
      manager?.getRepository(OutboundEmailAuthorizationEntity) ??
      this.repository;
    return await repo.save(repo.create(stripped));
  }

  async read(id: number): Promise<OutboundEmailAuthorizationEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * The single active authorization for a batch (§7.5). "Active" = status
   * `active`, not invalidated, not expired. Returns null when none exists.
   */
  async findActiveByBatch(
    batchId: number,
    manager?: EntityManager
  ): Promise<OutboundEmailAuthorizationEntity | null> {
    const repo =
      manager?.getRepository(OutboundEmailAuthorizationEntity) ??
      this.repository;
    const authorization = await repo.findOne({
      where: { batchId, status: "active" },
      order: { id: "DESC" },
    });
    if (!authorization) return null;
    if (authorization.invalidatedAt) return null;
    if (authorization.expiresAt.getTime() < Date.now()) return null;
    return authorization;
  }

  /** Mark an authorization consumed (atomic claim). */
  async consume(id: number, at: Date, manager?: EntityManager): Promise<void> {
    const repo =
      manager?.getRepository(OutboundEmailAuthorizationEntity) ??
      this.repository;
    await repo.update(id, { status: "consumed", consumedAt: at });
  }

  /** Mark an authorization invalidated (edit/policy change). */
  async invalidate(
    id: number,
    reason: string,
    at: Date,
    manager?: EntityManager
  ): Promise<void> {
    const repo =
      manager?.getRepository(OutboundEmailAuthorizationEntity) ??
      this.repository;
    await repo.update(id, {
      status: "invalidated",
      invalidatedAt: at,
      invalidationReason: reason,
    });
  }

  /** Mark an authorization expired (TTL elapsed). */
  async expire(id: number, manager?: EntityManager): Promise<void> {
    const repo =
      manager?.getRepository(OutboundEmailAuthorizationEntity) ??
      this.repository;
    await repo.update(id, { status: "expired" });
  }
}
