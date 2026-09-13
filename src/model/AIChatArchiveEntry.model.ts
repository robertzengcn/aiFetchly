import { BaseDb } from "@/model/Basedb";
import { AIChatArchiveEntryEntity } from "@/entity/AIChatArchiveEntry.entity";
import type { Repository } from "typeorm";
import { Brackets } from "typeorm";
import type { ArchiveEntryUpsertInput } from "@/entityTypes/aiChatArchiveTypes";

/**
 * Data access for archive entry projections: the lightweight index of source
 * message rows within an epoch. Entries do NOT store source text (that lives
 * only in ai_chat_messages); they store ordering, turn association, the message
 * type + optional toolCallId + paired tool row, and the code-point length of
 * the source content (so the packer can budget without re-reading full text).
 *
 * Technical-design §5.2: do not load and parse all tool metadata to answer one
 * tool-call lookup — the (conversationId, epoch, toolCallId, messageType) index
 * supports getToolPair. Entries are backfilled in resumable batches (§15).
 */
export class AIChatArchiveEntryModel extends BaseDb {
  public repository: Repository<AIChatArchiveEntryEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatArchiveEntryEntity
    );
  }

  protected onSqliteDbRebound(): void {
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatArchiveEntryEntity
    );
  }

  /**
   * Idempotent upsert of an entry projection. Called by the indexer during
   * backfill/append. `(conversationId, epoch, sourceRowId)` is unique, so
   * re-projection of the same row is a safe no-op overwrite.
   */
  async upsertEntry(
    input: ArchiveEntryUpsertInput
  ): Promise<AIChatArchiveEntryEntity> {
    const existing = await this.repository.findOne({
      where: {
        conversationId: input.conversationId,
        epoch: input.epoch,
        sourceRowId: input.sourceRowId,
      },
    });
    if (existing) {
      // Refresh mutable fields only; the identity columns are stable.
      existing.timestampMs = input.timestampMs;
      existing.sourceRevision = input.sourceRevision;
      existing.turnId = input.turnId;
      existing.messageType = input.messageType;
      existing.toolCallId = input.toolCallId;
      existing.pairedSourceRowId = input.pairedSourceRowId;
      existing.contentCodePointLength = input.contentCodePointLength;
      existing.messageId = input.messageId;
      return this.repository.save(existing);
    }
    const entity = new AIChatArchiveEntryEntity();
    Object.assign(entity, input);
    return this.repository.save(entity);
  }

  /**
   * Bounded keyset read of entries for a turn, in (timestampMs, sourceRowId)
   * ASC order. Used by the packer to enumerate a turn's source rows.
   */
  async readTurnEntries(
    conversationId: string,
    epoch: string,
    turnId: string,
    afterTimestampMs?: number,
    afterRowId?: number,
    limit: number = 64
  ): Promise<AIChatArchiveEntryEntity[]> {
    const qb = this.repository
      .createQueryBuilder("e")
      .where("e.conversationId = :conversationId", { conversationId })
      .andWhere("e.epoch = :epoch", { epoch })
      .andWhere("e.turnId = :turnId", { turnId });
    if (afterTimestampMs !== undefined && afterRowId !== undefined) {
      qb.andWhere(
        new Brackets((b) => {
          b.where("e.timestampMs > :ts", { ts: afterTimestampMs }).orWhere(
            "e.timestampMs = :ts2 AND e.sourceRowId > :rid",
            { ts2: afterTimestampMs, rid: afterRowId }
          );
        })
      );
    }
    return qb
      .orderBy("e.timestampMs", "ASC")
      .addOrderBy("e.sourceRowId", "ASC")
      .take(Math.min(limit, 64))
      .getMany();
  }

  /**
   * Look up the paired tool-call/tool-result entries by toolCallId. Supports
   * getToolPair (§5.2) without loading all tool metadata. Returns the call and
   * result rows (either may be absent for legacy/interrupted exchanges).
   */
  async findByToolCallId(
    conversationId: string,
    epoch: string,
    toolCallId: string
  ): Promise<{
    callEntry: AIChatArchiveEntryEntity | null;
    resultEntry: AIChatArchiveEntryEntity | null;
  }> {
    const rows = await this.repository.find({
      where: { conversationId, epoch, toolCallId },
      take: 8,
    });
    const callEntry = rows.find((r) => r.messageType === "tool_call") ?? null;
    const resultEntry =
      rows.find((r) => r.messageType === "tool_result") ?? null;
    return { callEntry, resultEntry };
  }

  /**
   * Fetch a single entry by source row id within (conversationId, epoch).
   * Used by resolveSelections to validate a source reference against the
   * current revision before serving exact content.
   */
  async findByRowId(
    conversationId: string,
    epoch: string,
    sourceRowId: number
  ): Promise<AIChatArchiveEntryEntity | null> {
    return this.repository.findOne({
      where: { conversationId, epoch, sourceRowId },
    });
  }

  /**
   * Count all entries for a conversation (any epoch) — used to verify that the
   * indexer projected a row for every source message in tests/diagnostics.
   */
  async countByConversation(conversationId: string): Promise<number> {
    return this.repository.count({ where: { conversationId } });
  }

  /**
   * Set the paired tool row id on an entry after its counterpart is projected.
   * The forward indexer walk projects a tool_call before its tool_result
   * exists, so the call's pair can only be resolved when the result arrives.
   * This targeted update establishes the backward link without re-upserting.
   */
  async setPairedSourceRowId(
    conversationId: string,
    epoch: string,
    sourceRowId: number,
    pairedSourceRowId: number
  ): Promise<void> {
    await this.repository.update(
      { conversationId, epoch, sourceRowId },
      { pairedSourceRowId }
    );
  }

  /**
   * Count entries through a (timestampMs, sourceRowId) high-water mark — used
   * by the indexer to resume backfill above the captured watermark.
   */
  async countAbove(
    conversationId: string,
    epoch: string,
    highWaterTimestampMs: number,
    highWaterRowId: number
  ): Promise<number> {
    return this.repository
      .createQueryBuilder("e")
      .where("e.conversationId = :conversationId", { conversationId })
      .andWhere("e.epoch = :epoch", { epoch })
      .andWhere(
        new Brackets((b) => {
          b.where("e.timestampMs > :ts", { ts: highWaterTimestampMs }).orWhere(
            "e.timestampMs = :ts2 AND e.sourceRowId > :rid",
            { ts2: highWaterTimestampMs, rid: highWaterRowId }
          );
        })
      )
      .getCount();
  }
}
