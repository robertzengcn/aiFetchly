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
  async ensureState(
    conversationId: string
  ): Promise<AIChatArchiveStateEntity> {
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
}
