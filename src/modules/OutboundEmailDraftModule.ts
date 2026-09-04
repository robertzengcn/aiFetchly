import { BaseModule } from "@/modules/baseModule";
import { OutboundEmailDraftModel, type AppendRevisionInput } from "@/model/OutboundEmailDraft.model";
import { OutboundEmailAuditLogModel } from "@/model/OutboundEmailAuditLog.model";
import { OutboundEmailDraftBatchEntity } from "@/entity/OutboundEmailDraftBatch.entity";
import { OutboundEmailDraftEntity } from "@/entity/OutboundEmailDraft.entity";
import { OutboundEmailDraftRevisionEntity } from "@/entity/OutboundEmailDraftRevision.entity";
import { OutboundEmailAuditLogEntity } from "@/entity/OutboundEmailAuditLog.entity";

/**
 * Business-logic facade over the outbound-email draft pipeline (technical
 * design §7.2–§7.4, §7.8). Delegates data access to
 * {@link OutboundEmailDraftModel} and {@link OutboundEmailAuditLogModel}.
 */
export class OutboundEmailDraftModule extends BaseModule {
  private draftModel: OutboundEmailDraftModel;
  private auditModel: OutboundEmailAuditLogModel;

  constructor() {
    super();
    this.draftModel = new OutboundEmailDraftModel(this.dbpath);
    this.auditModel = new OutboundEmailAuditLogModel(this.dbpath);
  }

  // -- Batch -------------------------------------------------------------

  async createBatch(
    entity: OutboundEmailDraftBatchEntity
  ): Promise<OutboundEmailDraftBatchEntity> {
    await this.ensureConnection();
    const created = await this.draftModel.createBatch(entity);
    await this.auditModel.create(
      Object.assign(new OutboundEmailAuditLogEntity(), {
        actorType: "ai",
        eventCode: "batch_created",
        conversationId: entity.conversationId,
        sourceUserMessageId: entity.sourceUserMessageId,
        batchId: created.id,
        intentDecisionId: entity.intentDecisionId,
      })
    );
    return created;
  }

  async readBatch(id: number): Promise<OutboundEmailDraftBatchEntity | null> {
    await this.ensureConnection();
    return await this.draftModel.readBatch(id);
  }

  async updateBatchHash(id: number, batchHash: string): Promise<void> {
    await this.ensureConnection();
    await this.draftModel.updateBatchHash(id, batchHash);
  }

  // -- Draft -------------------------------------------------------------

  async createDraft(
    entity: OutboundEmailDraftEntity
  ): Promise<OutboundEmailDraftEntity> {
    await this.ensureConnection();
    const created = await this.draftModel.createDraft(entity);
    await this.auditModel.create(
      Object.assign(new OutboundEmailAuditLogEntity(), {
        actorType: "ai",
        eventCode: "draft_generated",
        batchId: entity.batchId,
        draftId: created.id,
      })
    );
    return created;
  }

  async readDraft(id: number): Promise<OutboundEmailDraftEntity | null> {
    await this.ensureConnection();
    return await this.draftModel.readDraft(id);
  }

  async listDraftsByBatch(
    batchId: number
  ): Promise<OutboundEmailDraftEntity[]> {
    await this.ensureConnection();
    return await this.draftModel.listDraftsByBatch(batchId);
  }

  // -- Revision (append-only) -------------------------------------------

  async createRevision(
    entity: OutboundEmailDraftRevisionEntity
  ): Promise<OutboundEmailDraftRevisionEntity> {
    await this.ensureConnection();
    const created = await this.draftModel.createRevision(entity);
    await this.auditModel.create(
      Object.assign(new OutboundEmailAuditLogEntity(), {
        actorType: entity.actor,
        eventCode: "revision_created",
        draftId: entity.draftId,
        revisionId: created.id,
      })
    );
    return created;
  }

  async readRevision(
    id: number
  ): Promise<OutboundEmailDraftRevisionEntity | null> {
    await this.ensureConnection();
    return await this.draftModel.readRevision(id);
  }

  async appendRevision(
    input: AppendRevisionInput
  ): Promise<OutboundEmailDraftRevisionEntity> {
    await this.ensureConnection();
    const saved = await this.draftModel.appendRevision(input);
    await this.auditModel.create(
      Object.assign(new OutboundEmailAuditLogEntity(), {
        actorType: input.actor,
        eventCode: "draft_edited",
        draftId: input.draftId,
        revisionId: saved.id,
      })
    );
    return saved;
  }

  // -- Audit log ---------------------------------------------------------

  async listAuditLog(
    batchId: number,
    limit?: number
  ): Promise<OutboundEmailAuditLogEntity[]> {
    await this.ensureConnection();
    return await this.auditModel.listByBatch(batchId, limit);
  }
}