import { BaseDb } from "@/model/Basedb";
import { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { AIChatArchiveStateModel } from "@/model/AIChatArchiveState.model";
import { AIChatArchiveStateEntity } from "@/entity/AIChatArchiveState.entity";
import { encodeCursor, decodeCursor } from "@/service/AIChatArchiveCursorCodec";
import { sliceByCodePoints } from "@/service/AIChatArchiveTextUtil";
import { AI_CHAT_RECOVERABLE_DEFAULTS } from "@/service/AIChatRecoverableDefaults";
import { RecoverableHistoryError } from "@/entityTypes/aiChatArchiveTypes";
import type { Repository } from "typeorm";
import { Brackets } from "typeorm";

export interface ArchiveReadPageInternal {
  records: AIChatMessageEntity[];
  nextCursor: string | null;
  truncated: boolean;
}

export interface ReadPageForwardInput {
  conversationId: string;
  cursor?: string;
  maxRows: number;
  maxCodePoints: number;
  /** Optional snapshot upper bound (inclusive): compaction reads an
   * immutable prefix. Messages after (snapshotTimestampMs, snapshotRowId)
   * are excluded. */
  snapshotTimestampMs?: number;
  snapshotRowId?: number;
}

/**
 * Bounded reads over the authoritative source message table
 * (ai_chat_messages). Originals are never rewritten by compaction; this
 * model only reads them in bounded pages + bounded substrings.
 *
 * The `dbPath` field is captured at construction so the archive-state sub-
 * model can be constructed on demand (BaseDb does not expose the filepath).
 */
export class AIChatMessageArchiveModel extends BaseDb {
  public repository: Repository<AIChatMessageEntity>;
  private readonly dbPath: string;

  constructor(dbpath: string) {
    super(dbpath);
    this.dbPath = dbpath;
    this.repository =
      this.sqliteDb.connection.getRepository(AIChatMessageEntity);
  }

  protected onSqliteDbRebound(): void {
    this.repository =
      this.sqliteDb.connection.getRepository(AIChatMessageEntity);
  }

  /**
   * Bounded keyset read in (timestamp, id) ASC order. Honors an optional
   * snapshot upper bound so compaction reads an immutable prefix. Uses a
   * metadata-page row cap plus a decoded-text byte allowance.
   */
  async readPageForward(
    input: ReadPageForwardInput
  ): Promise<ArchiveReadPageInternal> {
    const stateModel = new AIChatArchiveStateModel(this.dbPath);
    const state = await stateModel.getState(input.conversationId);
    const epoch = state?.epoch ?? "";
    const pageLimit = Math.min(
      input.maxRows,
      AI_CHAT_RECOVERABLE_DEFAULTS.metadataPageRows
    );

    let lastTimestampMs = 0;
    let lastRowId = 0;
    if (input.cursor) {
      const decoded = decodeCursor(input.cursor, input.conversationId, epoch);
      if (!decoded) {
        throw new RecoverableHistoryError(
          "HISTORY_SCOPE_INVALID",
          "cursor failed scope validation (conversation/epoch mismatch or malformed payload)"
        );
      }
      lastTimestampMs = decoded.lastTimestampMs;
      lastRowId = decoded.lastRowId;
    }

    const qb = this.repository
      .createQueryBuilder("m")
      .where("m.conversationId = :conversationId", {
        conversationId: input.conversationId,
      })
      .andWhere(
        new Brackets((qb) => {
          qb.where("m.timestamp > :lastTs", {
            lastTs: new Date(lastTimestampMs),
          }).orWhere("m.timestamp = :lastTs2 AND m.id > :lastId", {
            lastTs2: new Date(lastTimestampMs),
            lastId: lastRowId,
          });
        })
      );

    if (input.snapshotTimestampMs !== undefined) {
      const snapDate = new Date(input.snapshotTimestampMs);
      const snapRow = input.snapshotRowId ?? Number.MAX_SAFE_INTEGER;
      qb.andWhere(
        new Brackets((qb) => {
          qb.where("m.timestamp < :snapTs", { snapTs: snapDate }).orWhere(
            "m.timestamp = :snapTs2 AND m.id <= :snapId",
            { snapTs2: snapDate, snapId: snapRow }
          );
        })
      );
    }

    qb.orderBy("m.timestamp", "ASC").addOrderBy("m.id", "ASC").take(pageLimit);

    const rows = await qb.getMany();

    // Enforce decoded-text byte allowance (maxCodePoints * 4 bytes worst case).
    // A page may be truncated by EITHER the row cap OR the byte budget; in both
    // cases there is more data, so a continuation cursor must be emitted.
    const byteBudget = input.maxCodePoints * 4;
    let bytes = 0;
    const kept: AIChatMessageEntity[] = [];
    let brokeOnBudget = false;
    for (const row of rows) {
      const rowBytes = Buffer.byteLength(row.content ?? "", "utf8");
      if (bytes + rowBytes > byteBudget) {
        brokeOnBudget = true;
        break;
      }
      kept.push(row);
      bytes += rowBytes;
    }

    // Force-include the first row when even a single message exceeds the budget,
    // so pagination always advances past it (the retrieval layer surfaces
    // CONTEXT_REQUIRED_CONTENT_TOO_LARGE for genuinely oversized messages).
    if (kept.length === 0 && rows.length > 0) {
      kept.push(rows[0]);
    }

    const truncated = brokeOnBudget || rows.length === pageLimit;
    // There is more data when we hit the row cap (rows beyond this fetch) OR
    // the byte budget cut the page short (at least the broken-on row remains).
    const hasMore =
      kept.length > 0 && (rows.length === pageLimit || brokeOnBudget);
    let nextCursor: string | null = null;
    if (hasMore) {
      const last = kept[kept.length - 1];
      nextCursor = encodeCursor({
        v: 1,
        conversationId: input.conversationId,
        epoch,
        revision: state?.sourceRevision ?? 0,
        lastTimestampMs: last.timestamp.getTime(),
        lastRowId: last.id,
        direction: "forward",
      });
    }

    return { records: kept, nextCursor, truncated };
  }

  /**
   * Bounded recent-history read in DESC order (for the retained suffix),
   * returned in chronological (ASC) order.
   */
  async readRecent(
    conversationId: string,
    maxRows: number,
    maxCodePoints: number
  ): Promise<AIChatMessageEntity[]> {
    const pageLimit = Math.min(
      maxRows,
      AI_CHAT_RECOVERABLE_DEFAULTS.metadataPageRows
    );
    const rows = await this.repository.find({
      where: { conversationId },
      order: { timestamp: "DESC", id: "DESC" },
      take: pageLimit,
    });
    // Reverse to chronological for the caller.
    const chronological = rows.reverse();
    // Enforce the byte allowance.
    const byteBudget = maxCodePoints * 4;
    let bytes = 0;
    const kept: AIChatMessageEntity[] = [];
    for (const row of chronological) {
      const rowBytes = Buffer.byteLength(row.content ?? "", "utf8");
      if (bytes + rowBytes > byteBudget) break;
      kept.push(row);
      bytes += rowBytes;
    }
    return kept;
  }

  /**
   * Bounded substring read of a single message's content by code-point
   * offsets. Slices in-process after a bounded fetch so semantics are stable
   * regardless of SQLite's substr code-point handling.
   */
  async readSourceSlice(
    rowId: number,
    startCodePoint: number,
    endCodePoint: number
  ): Promise<string | null> {
    const raw = await this.repository
      .createQueryBuilder("m")
      .select(["m.content"])
      .where("m.id = :rowId", { rowId })
      .getRawOne<{ m_content: string } | undefined>();
    if (!raw) return null;
    return sliceByCodePoints(raw.m_content, startCodePoint, endCodePoint);
  }

  /**
   * Fetch the raw (full) content of a single message by row id. Used by the
   * retrieval service to render a bounded passage; callers are responsible
   * for clamping output size.
   */
  async readMessageByRowId(rowId: number): Promise<AIChatMessageEntity | null> {
    return this.repository.findOne({ where: { id: rowId } });
  }

  /**
   * Look up messages by public messageId within a conversation. §7.2: an
   * ambiguous public messageId returns candidate source references instead of
   * selecting an arbitrary row — the caller decides when more than one row
   * shares the messageId.
   */
  async findByMessageId(
    conversationId: string,
    messageId: string
  ): Promise<AIChatMessageEntity[]> {
    return this.repository.find({
      where: { conversationId, messageId },
      order: { timestamp: "ASC", id: "ASC" },
      take: 20,
    });
  }

  /**
   * Bounded neighbor read around a (timestamp, rowId) anchor: up to `before`
   * rows strictly before the anchor and `after` rows strictly after it,
   * returned in chronological (ASC) order. Excludes the anchor itself —
   * callers already hold it. Both counts are clamped by the metadata page cap.
   */
  async readNeighbors(
    conversationId: string,
    anchorTimestampMs: number,
    anchorRowId: number,
    before: number,
    after: number
  ): Promise<AIChatMessageEntity[]> {
    const anchorDate = new Date(anchorTimestampMs);
    const pageCap = AI_CHAT_RECOVERABLE_DEFAULTS.metadataPageRows;
    const beforeCount = Math.min(Math.max(before, 0), pageCap);
    const afterCount = Math.min(Math.max(after, 0), pageCap);

    const beforeRows =
      beforeCount > 0
        ? await this.repository
            .createQueryBuilder("m")
            .where("m.conversationId = :conversationId", { conversationId })
            .andWhere(
              new Brackets((qb) => {
                qb.where("m.timestamp < :ts", { ts: anchorDate }).orWhere(
                  "m.timestamp = :ts2 AND m.id < :id",
                  { ts2: anchorDate, id: anchorRowId }
                );
              })
            )
            .orderBy("m.timestamp", "DESC")
            .addOrderBy("m.id", "DESC")
            .take(beforeCount)
            .getMany()
        : [];

    const afterRows =
      afterCount > 0
        ? await this.repository
            .createQueryBuilder("m")
            .where("m.conversationId = :conversationId", { conversationId })
            .andWhere(
              new Brackets((qb) => {
                qb.where("m.timestamp > :ts", { ts: anchorDate }).orWhere(
                  "m.timestamp = :ts2 AND m.id > :id",
                  { ts2: anchorDate, id: anchorRowId }
                );
              })
            )
            .orderBy("m.timestamp", "ASC")
            .addOrderBy("m.id", "ASC")
            .take(afterCount)
            .getMany()
        : [];

    return [...beforeRows.reverse(), ...afterRows];
  }

  /** Expose the archive state for the cursor epoch lookup. */
  async getArchiveState(
    conversationId: string
  ): Promise<AIChatArchiveStateEntity | null> {
    const stateModel = new AIChatArchiveStateModel(this.dbPath);
    return stateModel.getState(conversationId);
  }
}
