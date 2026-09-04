import { BaseDb } from "@/model/Basedb";
import { Repository, EntityManager } from "typeorm";
import { OutboundEmailAuditLogEntity } from "@/entity/OutboundEmailAuditLog.entity";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { outboundEmailAuditLogWriteSchema } from "@/schemas/entity/outboundEmailAuditLog";
import { rejectDatabaseAccessFromWorker } from "@/model/_workerBoundaryGuard";

/**
 * Append-only audit log for the outbound-email pipeline (technical design
 * §7.8). Records actor type, stable event code, entity identifiers, policy
 * versions, and sanitized metadata. Never stores SMTP passwords, access
 * tokens, complete prompts, or unredacted customer data beyond addresses
 * already necessary for email operation.
 */
export class OutboundEmailAuditLogModel extends BaseDb {
  private readonly repository: Repository<OutboundEmailAuditLogEntity>;

  constructor(filepath: string) {
    super(filepath);
    rejectDatabaseAccessFromWorker("OutboundEmailAuditLogModel");
    this.repository = this.sqliteDb.connection.getRepository(
      OutboundEmailAuditLogEntity
    );
  }

  async create(
    entity: OutboundEmailAuditLogEntity,
    manager?: EntityManager
  ): Promise<OutboundEmailAuditLogEntity> {
    const stripped = parseAndStrip(
      entity,
      outboundEmailAuditLogWriteSchema()
    ) as unknown as OutboundEmailAuditLogEntity;
    const repo =
      manager?.getRepository(OutboundEmailAuditLogEntity) ?? this.repository;
    return await repo.save(repo.create(stripped));
  }

  async listByBatch(
    batchId: number,
    limit = 200
  ): Promise<OutboundEmailAuditLogEntity[]> {
    return await this.repository.find({
      where: { batchId },
      order: { id: "DESC" },
      take: limit,
    });
  }
}