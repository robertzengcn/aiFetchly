import { BaseDb } from "@/model/Basedb";
import { AIChatArchiveTurnEntity } from "@/entity/AIChatArchiveTurn.entity";
import type { Repository } from "typeorm";
import { Brackets } from "typeorm";
import type { ArchiveTurnStatus } from "@/entityTypes/aiChatArchiveTypes";

/**
 * Data access for archive turns: the [first..last] (timestamp, rowId) range of
 * the messages that compose a turn, plus a terminal status. Turns are the unit
 * of section packing (complete turns only) and the unit of the retained recent
 * suffix. `confidence` distinguishes native turn metadata from inferred
 * boundaries.
 *
 * Technical-design §4.3: the current live turn is always excluded from the
 * compactable prefix. §12: target at least two completed turns when they fit.
 */
export class AIChatArchiveTurnModel extends BaseDb {
  public repository: Repository<AIChatArchiveTurnEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatArchiveTurnEntity
    );
  }

  protected onSqliteDbRebound(): void {
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatArchiveTurnEntity
    );
  }

  /**
   * Idempotent upsert of a turn projection. `(conversationId, epoch, turnId)`
   * is unique, so re-projection is a safe overwrite of mutable fields.
   */
  async upsertTurn(
    input: Omit<AIChatArchiveTurnEntity, "id" | "createdAt" | "updatedAt"> & {
      id?: number;
    }
  ): Promise<AIChatArchiveTurnEntity> {
    const existing = await this.repository.findOne({
      where: {
        conversationId: input.conversationId,
        epoch: input.epoch,
        turnId: input.turnId,
      },
    });
    if (existing) {
      existing.firstTimestampMs = input.firstTimestampMs;
      existing.firstRowId = input.firstRowId;
      existing.lastTimestampMs = input.lastTimestampMs;
      existing.lastRowId = input.lastRowId;
      existing.status = input.status;
      existing.completedAt = input.completedAt;
      existing.confidence = input.confidence;
      return this.repository.save(existing);
    }
    const entity = new AIChatArchiveTurnEntity();
    Object.assign(entity, input);
    return this.repository.save(entity);
  }

  /**
   * Fetch recent completed turns in DESC order, returned in chronological
   * (ASC) order. Excludes the live turn (status "open"). `minCount` is a floor;
   * `maxCount` bounds the retained suffix. Used to assemble the recent
   * suffix preserved verbatim in every dispatched context.
   */
  async readRecentCompleteTurns(
    conversationId: string,
    epoch: string,
    minCount: number,
    maxCount: number
  ): Promise<AIChatArchiveTurnEntity[]> {
    const rows = await this.repository.find({
      where: {
        conversationId,
        epoch,
        status: "completed" as ArchiveTurnStatus,
      },
      order: { lastTimestampMs: "DESC", lastRowId: "DESC" },
      take: Math.max(minCount, maxCount),
    });
    // Reverse to chronological order for the caller.
    return rows.reverse().slice(0, maxCount);
  }

  /**
   * Mark a turn with a terminal status (completed/cancelled/failed/
   * interrupted). Sets completedAt. Idempotent for the same status.
   */
  async setStatus(
    conversationId: string,
    epoch: string,
    turnId: string,
    status: ArchiveTurnStatus
  ): Promise<void> {
    const turn = await this.repository.findOne({
      where: { conversationId, epoch, turnId },
    });
    if (!turn) return;
    if (turn.status === status) return;
    turn.status = status;
    if (status !== "open") {
      turn.completedAt = new Date();
    }
    await this.repository.save(turn);
  }

  /**
   * The last turn by (lastTimestampMs, lastRowId) — typically the live turn.
   * Used to exclude it from the compactable prefix.
   */
  async getLastTurn(
    conversationId: string,
    epoch: string
  ): Promise<AIChatArchiveTurnEntity | null> {
    const rows = await this.repository.find({
      where: { conversationId, epoch },
      order: { lastTimestampMs: "DESC", lastRowId: "DESC" },
      take: 1,
    });
    return rows[0] ?? null;
  }

  /**
   * Turns whose last (timestamp, rowId) is at or below a high-water mark — the
   * compactable prefix, excluding the live turn. Returned in ASC order so the
   * packer can walk sections forward.
   */
  async readCompactablePrefix(
    conversationId: string,
    epoch: string,
    throughTimestampMs: number,
    throughRowId: number,
    excludeTurnId?: string
  ): Promise<AIChatArchiveTurnEntity[]> {
    const qb = this.repository
      .createQueryBuilder("t")
      .where("t.conversationId = :conversationId", { conversationId })
      .andWhere("t.epoch = :epoch", { epoch })
      .andWhere("t.status = :status", { status: "completed" })
      .andWhere(
        new Brackets((b) => {
          b.where("t.lastTimestampMs < :ts", {
            ts: throughTimestampMs,
          }).orWhere("t.lastTimestampMs = :ts2 AND t.lastRowId <= :rid", {
            ts2: throughTimestampMs,
            rid: throughRowId,
          });
        })
      );
    if (excludeTurnId) {
      qb.andWhere("t.turnId != :excludeTurnId", { excludeTurnId });
    }
    return qb
      .orderBy("t.lastTimestampMs", "ASC")
      .addOrderBy("t.lastRowId", "ASC")
      .getMany();
  }

  /**
   * Delete all turns for a conversation+epoch (used on tombstone cleanup or
   * epoch invalidation).
   */
  async deleteByConversationEpoch(
    conversationId: string,
    epoch: string
  ): Promise<number> {
    const result = await this.repository.delete({ conversationId, epoch });
    return result.affected ?? 0;
  }

  // Helper retained for index coverage checks.
  async countByStatus(
    conversationId: string,
    epoch: string,
    status: ArchiveTurnStatus
  ): Promise<number> {
    return this.repository.count({
      where: { conversationId, epoch, status: status as string },
    });
  }
}
