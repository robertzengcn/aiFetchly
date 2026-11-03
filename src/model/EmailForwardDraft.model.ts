import { Repository } from "typeorm";
import { BaseDb } from "@/model/Basedb";
import { runReplyTxn } from "@/model/replyTxn";
import { EmailForwardDraftEntity } from "@/entity/EmailForwardDraft.entity";
import { EmailForwardRevisionEntity } from "@/entity/EmailForwardRevision.entity";
import {
  emailForwardDraftWriteSchema,
  emailForwardRevisionWriteSchema,
} from "@/schemas/entity/emailForward";
import { parseAndStrip } from "@/utils/parseAndStrip";

/**
 * Data access for forward drafts and their immutable revisions
 * (technical design §6.1). Revision rows are write-once; editing appends a
 * new revision and the service layer invalidates prior authorizations.
 */
export class EmailForwardDraftModel extends BaseDb {
  constructor(filepath: string) {
    super(filepath);
  }

  private get draftRepository(): Repository<EmailForwardDraftEntity> {
    return this.sqliteDb.connection.getRepository(EmailForwardDraftEntity);
  }

  private get revisionRepository(): Repository<EmailForwardRevisionEntity> {
    return this.sqliteDb.connection.getRepository(EmailForwardRevisionEntity);
  }

  /** Creates the draft plus its first revision in one transaction. */
  async createDraftWithRevision(
    draft: {
      messageId: number;
      emailServiceId: number;
      status: EmailForwardDraftEntity["status"];
      currentRevisionId: number | null;
      conversationId: number | null;
      provenance: string;
      submittedAt: Date | null;
    },
    revision: Record<string, unknown>,
    expectedRevisionNumber: number
  ): Promise<{ draft: EmailForwardDraftEntity; revision: EmailForwardRevisionEntity }> {
    return await runReplyTxn(this.sqliteDb, async (manager) => {
      const draftRepo = manager.getRepository(EmailForwardDraftEntity);
      const revisionRepo = manager.getRepository(EmailForwardRevisionEntity);

      const draftStripped = parseAndStrip(
        draft,
        emailForwardDraftWriteSchema()
      ) as unknown as EmailForwardDraftEntity;
      const savedDraft = await draftRepo.save(draftRepo.create(draftStripped));

      const revisionStripped = parseAndStrip(
        { ...revision, draftId: savedDraft.id, revisionNumber: expectedRevisionNumber },
        emailForwardRevisionWriteSchema()
      ) as unknown as EmailForwardRevisionEntity;
      const savedRevision = await revisionRepo.save(revisionRepo.create(revisionStripped));

      await draftRepo.update(
        { id: savedDraft.id },
        { currentRevisionId: savedRevision.id, status: "ready" }
      );
      savedDraft.currentRevisionId = savedRevision.id;
      savedDraft.status = "ready";
      return { draft: savedDraft, revision: savedRevision };
    });
  }

  /**
   * Appends the next revision to an existing draft, guarded by the expected
   * current revision id (stale editors lose). Sets status back to `ready`.
   */
  async appendRevision(
    draftId: number,
    expectedCurrentRevisionId: number | null,
    revision: Record<string, unknown>
  ): Promise<{ ok: true; revision: EmailForwardRevisionEntity } | { ok: false }> {
    return await runReplyTxn(this.sqliteDb, async (manager) => {
      const draftRepo = manager.getRepository(EmailForwardDraftEntity);
      const revisionRepo = manager.getRepository(EmailForwardRevisionEntity);

      const draft = await draftRepo.findOne({ where: { id: draftId } });
      if (!draft) return { ok: false } as const;
      if (draft.currentRevisionId !== expectedCurrentRevisionId) {
        return { ok: false } as const;
      }
      if (draft.status !== "draft" && draft.status !== "ready") {
        return { ok: false } as const;
      }

      const nextNumber =
        (await revisionRepo.count({ where: { draftId } })) + 1;
      const revisionStripped = parseAndStrip(
        { ...revision, draftId, revisionNumber: nextNumber },
        emailForwardRevisionWriteSchema()
      ) as unknown as EmailForwardRevisionEntity;
      const savedRevision = await revisionRepo.save(revisionRepo.create(revisionStripped));

      await draftRepo.update(
        { id: draftId },
        { currentRevisionId: savedRevision.id, status: "ready" }
      );
      return { ok: true, revision: savedRevision } as const;
    });
  }

  async readDraft(id: number): Promise<EmailForwardDraftEntity | null> {
    return await this.draftRepository.findOne({ where: { id } });
  }

  async readRevision(id: number): Promise<EmailForwardRevisionEntity | null> {
    return await this.revisionRepository.findOne({ where: { id } });
  }

  /** Conditional submit marker; fails when the revision changed meanwhile. */
  async markSubmitted(draftId: number, revisionId: number): Promise<boolean> {
    const result = await this.draftRepository
      .createQueryBuilder()
      .update(EmailForwardDraftEntity)
      .set({ status: "submitted", submittedAt: new Date() })
      .where(
        "id = :draftId AND currentRevisionId = :revisionId AND status IN (:...allowed)",
        { draftId, revisionId, allowed: ["ready", "draft"] }
      )
      .execute();
    return (result.affected ?? 0) === 1;
  }

  async markDiscarded(draftId: number): Promise<boolean> {
    const result = await this.draftRepository
      .createQueryBuilder()
      .update(EmailForwardDraftEntity)
      .set({ status: "discarded" })
      .where("id = :draftId AND status IN (:...allowed)", {
        draftId,
        allowed: ["draft", "ready"],
      })
      .execute();
    return (result.affected ?? 0) === 1;
  }
}
