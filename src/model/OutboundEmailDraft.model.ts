import { BaseDb } from "@/model/Basedb";
import { Repository, EntityManager } from "typeorm";
import { OutboundEmailDraftBatchEntity } from "@/entity/OutboundEmailDraftBatch.entity";
import { OutboundEmailDraftEntity } from "@/entity/OutboundEmailDraft.entity";
import { OutboundEmailDraftRevisionEntity } from "@/entity/OutboundEmailDraftRevision.entity";
import { parseAndStrip } from "@/utils/parseAndStrip";
import { outboundEmailDraftBatchWriteSchema } from "@/schemas/entity/outboundEmailDraftBatch";
import { outboundEmailDraftWriteSchema } from "@/schemas/entity/outboundEmailDraft";
import { outboundEmailDraftRevisionWriteSchema } from "@/schemas/entity/outboundEmailDraftRevision";
import { rejectDatabaseAccessFromWorker } from "@/model/_workerBoundaryGuard";

/**
 * Input shape for appending a new revision to a draft. The caller supplies the
 * frozen envelope fields; the model assigns `revisionNumber` and advances the
 * draft pointer atomically.
 */
export interface AppendRevisionInput {
  readonly draftId: number;
  readonly actor: "ai" | "user";
  readonly emailServiceId: number;
  readonly senderAddress: string;
  readonly recipientAddress: string;
  readonly subject: string;
  readonly bodyText: string;
  readonly bodyHtml: string | null;
  readonly contentHash: string;
  readonly personalizationEvidenceJson?: string | null;
  readonly knowledgeSourcesJson?: string | null;
  readonly generationMetadataJson?: string | null;
  readonly validationFindingsJson?: string | null;
}

/**
 * Data-access model for the outbound-email draft pipeline (technical design
 * §7.2–§7.4). Revisions are append-only: edits insert a new revision and bump
 * the draft's `currentRevisionId`/`revisionNumber`/`contentHash` in one
 * transaction, so an envelope-affecting edit is observable and authorization
 * can be invalidated on revision change (AD-005).
 */
export class OutboundEmailDraftModel extends BaseDb {
  private readonly batchRepo: Repository<OutboundEmailDraftBatchEntity>;
  private readonly draftRepo: Repository<OutboundEmailDraftEntity>;
  private readonly revisionRepo: Repository<OutboundEmailDraftRevisionEntity>;

  constructor(filepath: string) {
    super(filepath);
    rejectDatabaseAccessFromWorker("OutboundEmailDraftModel");
    const conn = this.sqliteDb.connection;
    this.batchRepo = conn.getRepository(OutboundEmailDraftBatchEntity);
    this.draftRepo = conn.getRepository(OutboundEmailDraftEntity);
    this.revisionRepo = conn.getRepository(
      OutboundEmailDraftRevisionEntity
    );
  }

  // -- Batch -------------------------------------------------------------

  async createBatch(
    entity: OutboundEmailDraftBatchEntity
  ): Promise<OutboundEmailDraftBatchEntity> {
    const stripped = parseAndStrip(
      entity,
      outboundEmailDraftBatchWriteSchema()
    ) as unknown as OutboundEmailDraftBatchEntity;
    return await this.batchRepo.save(this.batchRepo.create(stripped));
  }

  async readBatch(id: number): Promise<OutboundEmailDraftBatchEntity | null> {
    return await this.batchRepo.findOne({ where: { id } });
  }

  /** Advance the batch's envelope-set hash pointer (post-preflight). */
  async updateBatchHash(
    id: number,
    batchHash: string
  ): Promise<void> {
    await this.batchRepo.update(id, { batchHash });
  }

  async updateBatchStatus(
    id: number,
    status: OutboundEmailDraftBatchEntity["status"],
    patch: Partial<OutboundEmailDraftBatchEntity> = {}
  ): Promise<void> {
    await this.batchRepo.update(id, { status, ...patch });
  }

  // -- Draft -------------------------------------------------------------

  async createDraft(
    entity: OutboundEmailDraftEntity
  ): Promise<OutboundEmailDraftEntity> {
    const stripped = parseAndStrip(
      entity,
      outboundEmailDraftWriteSchema()
    ) as unknown as OutboundEmailDraftEntity;
    return await this.draftRepo.save(this.draftRepo.create(stripped));
  }

  async readDraft(id: number): Promise<OutboundEmailDraftEntity | null> {
    return await this.draftRepo.findOne({ where: { id } });
  }

  /** All drafts in a batch, ordered for stable per-recipient hashing. */
  async listDraftsByBatch(
    batchId: number
  ): Promise<OutboundEmailDraftEntity[]> {
    return await this.draftRepo.find({
      where: { batchId },
      order: { recipientAddress: "ASC", id: "ASC" },
    });
  }

  // -- Revision (append-only) -------------------------------------------

  async createRevision(
    entity: OutboundEmailDraftRevisionEntity
  ): Promise<OutboundEmailDraftRevisionEntity> {
    const stripped = parseAndStrip(
      entity,
      outboundEmailDraftRevisionWriteSchema()
    ) as unknown as OutboundEmailDraftRevisionEntity;
    return await this.revisionRepo.save(this.revisionRepo.create(stripped));
  }

  async readRevision(
    id: number
  ): Promise<OutboundEmailDraftRevisionEntity | null> {
    return await this.revisionRepo.findOne({ where: { id } });
  }

  /** The current (highest revision number) revision for a draft. */
  async readCurrentRevision(
    draftId: number
  ): Promise<OutboundEmailDraftRevisionEntity | null> {
    return await this.revisionRepo.findOne({
      where: { draftId },
      order: { revisionNumber: "DESC" },
    });
  }

  /**
   * Append a new revision to a draft and advance the draft's pointer
   * atomically (technical design §7.4 / §10.4). Revisions are immutable; an
   * edit is always a new row. The `(draftId, revisionNumber)` unique index
   * serializes concurrent appends to the same draft.
   */
  async appendRevision(
    input: AppendRevisionInput,
    manager?: EntityManager
  ): Promise<OutboundEmailDraftRevisionEntity> {
    const run = async (m: EntityManager): Promise<OutboundEmailDraftRevisionEntity> => {
      const draftRepo = m.getRepository(OutboundEmailDraftEntity);
      const revisionRepo = m.getRepository(OutboundEmailDraftRevisionEntity);

      const draft = await draftRepo.findOne({
        where: { id: input.draftId },
      });
      if (!draft) {
        throw new Error(
          `OutboundEmailDraftModel.appendRevision: draft ${input.draftId} not found`
        );
      }

      const nextRevisionNumber = draft.revisionNumber + 1;
      const revision = revisionRepo.create({
        draftId: input.draftId,
        revisionNumber: nextRevisionNumber,
        actor: input.actor,
        emailServiceId: input.emailServiceId,
        senderAddress: input.senderAddress,
        recipientAddress: input.recipientAddress,
        subject: input.subject,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml,
        contentHash: input.contentHash,
        personalizationEvidenceJson: input.personalizationEvidenceJson ?? null,
        knowledgeSourcesJson: input.knowledgeSourcesJson ?? null,
        generationMetadataJson: input.generationMetadataJson ?? null,
        validationFindingsJson: input.validationFindingsJson ?? null,
      });
      const saved = await revisionRepo.save(revision);

      // Advance the draft pointer in the same transaction.
      draft.currentRevisionId = saved.id;
      draft.revisionNumber = nextRevisionNumber;
      draft.contentHash = input.contentHash;
      await draftRepo.save(draft);

      return saved;
    };

    if (manager) {
      return run(manager);
    }
    return await this.sqliteDb.connection.transaction(run);
  }
}