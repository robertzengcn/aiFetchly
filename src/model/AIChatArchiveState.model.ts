import { BaseDb } from "@/model/Basedb";
import { AIChatArchiveStateEntity } from "@/entity/AIChatArchiveState.entity";
import type { Repository } from "typeorm";

/**
 * Data access for the per-conversation archive state row: epoch (invalidated
 * on tombstone/restore), source revision counter, high-water mark, active
 * generation/run pointers, and the lease/fence used by the coordinator.
 *
 * Extends BaseDb; the repository is recreated on connection rebind because
 * repositories are bound to the DataSource captured at construction time
 * (override onSqliteDbRebound — see BaseDb).
 */
export class AIChatArchiveStateModel extends BaseDb {
  public repository: Repository<AIChatArchiveStateEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatArchiveStateEntity
    );
  }

  protected onSqliteDbRebound(): void {
    this.repository = this.sqliteDb.connection.getRepository(
      AIChatArchiveStateEntity
    );
  }

  async getState(
    conversationId: string
  ): Promise<AIChatArchiveStateEntity | null> {
    return this.repository.findOne({ where: { conversationId } });
  }

  /**
   * Create archive state for a conversation with a fresh random epoch, or
   * return existing non-deleted state. A tombstoned conversation is NOT
   * resurrected — a new row with a new epoch is created so prior references
   * (cursors, source IDs, generations) remain invalid.
   */
  async ensureState(conversationId: string): Promise<AIChatArchiveStateEntity> {
    return this.sqliteDb.connection.transaction(async (manager) => {
      const repo = manager.getRepository(AIChatArchiveStateEntity);
      const existing = await repo.findOne({ where: { conversationId } });
      if (existing && !existing.deletedAt) return existing;
      const entity = new AIChatArchiveStateEntity();
      entity.conversationId = conversationId;
      entity.epoch = crypto.randomUUID();
      entity.sourceRevision = 0;
      entity.highWaterTimestampMs = 0;
      entity.highWaterRowId = 0;
      entity.indexState = "absent";
      entity.schemaVersion = 1;
      return repo.save(entity);
    });
  }

  /**
   * Tombstone a conversation: set deletedAt and bump the fence + revision so
   * any in-flight claim is invalidated. The conversation can be re-archived
   * later via ensureState (which mints a fresh epoch), but prior references
   * remain invalid.
   */
  async tombstone(conversationId: string): Promise<void> {
    const state = await this.repository.findOne({
      where: { conversationId },
    });
    if (!state) return;
    state.deletedAt = new Date();
    state.sourceRevision = state.sourceRevision + 1;
    state.fence = state.fence + 1;
    state.activeRunId = undefined as unknown as string;
    state.leaseOwner = undefined as unknown as string;
    state.leaseUntilMs = undefined as unknown as number;
    await this.repository.save(state);
  }

  async updateHighWater(
    conversationId: string,
    timestampMs: number,
    rowId: number
  ): Promise<void> {
    await this.repository.update(
      { conversationId },
      { highWaterTimestampMs: timestampMs, highWaterRowId: rowId }
    );
  }

  async incrementRevision(conversationId: string): Promise<void> {
    const state = await this.repository.findOne({
      where: { conversationId },
    });
    if (!state) return;
    state.sourceRevision = state.sourceRevision + 1;
    await this.repository.save(state);
  }

  /**
   * Update the index state for a conversation (absent → indexing → complete,
   * or → stale when the source changes under a still-valid index). Used by
   * the indexing job to signal readiness/staleness so the retrieval service
   * can report `index_complete` accurately.
   */
  async setIndexState(
    conversationId: string,
    indexState: "absent" | "indexing" | "complete" | "stale"
  ): Promise<void> {
    const state = await this.repository.findOne({
      where: { conversationId },
    });
    if (!state) return;
    state.indexState = indexState;
    await this.repository.save(state);
  }

  /**
   * Atomically persist index progress: the resumable cursor, the high-water
   * compaction boundary (end of the last complete turn), and the index state.
   * Called by the indexer after each bounded batch so a crash mid-backfill
   * resumes from the last fully-processed row (§15: "resumable batches").
   *
   * The high-water doubles as the compaction snapshot end / retained-suffix
   * start (§11.2): the coordinator reads it to know where the compactable
   * prefix ends. Only advance it to the end of a *complete* turn — the live
   * turn must remain in the retained suffix.
   */
  async updateIndexProgress(
    conversationId: string,
    progress: {
      indexCursorJson: string;
      highWaterTimestampMs: number;
      highWaterRowId: number;
      indexState: "indexing" | "complete" | "stale";
    }
  ): Promise<void> {
    const state = await this.repository.findOne({
      where: { conversationId },
    });
    if (!state) return;
    state.indexCursorJson = progress.indexCursorJson;
    state.highWaterTimestampMs = progress.highWaterTimestampMs;
    state.highWaterRowId = progress.highWaterRowId;
    state.indexState = progress.indexState;
    await this.repository.save(state);
  }

  /**
   * List archive states whose index is not yet complete (absent/indexing/
   * stale). Used by the startup bootstrap to find conversations that still
   * need backfill. Bounded by `limit` so a huge legacy archive does not load
   * every row at once.
   */
  async listIncomplete(
    limit: number = 100
  ): Promise<AIChatArchiveStateEntity[]> {
    return this.repository
      .createQueryBuilder("s")
      .where("s.indexState != :complete", { complete: "complete" })
      .andWhere("s.deletedAt IS NULL")
      .orderBy("s.updatedAt", "DESC")
      .take(Math.min(Math.max(limit, 1), 500))
      .getMany();
  }
}
