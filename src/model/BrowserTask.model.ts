import { BaseDb } from "./Basedb";
import { Repository, In } from "typeorm";
import { BrowserTaskEntity } from "@/entity/BrowserTask.entity";

/**
 * Durable browser-task cursor data access (T19; technical design §6.2).
 * Metadata + bounded accounting only; persistence failure BEFORE a mutation
 * intent is written prevents the mutation; a pending intent without a
 * confirmed outcome means interrupted-with-unknown-effect on recovery.
 */
export class BrowserTaskModel extends BaseDb {
  private repository: Repository<BrowserTaskEntity> | null = null;

  constructor(filepath: string) {
    super(filepath);
  }

  private async getRepository(): Promise<Repository<BrowserTaskEntity>> {
    if (!this.repository) {
      await this.ensureConnection();
      this.repository = this.sqliteDb.connection.getRepository(BrowserTaskEntity);
    }
    return this.repository;
  }

  async upsertByTaskId(task: BrowserTaskEntity): Promise<BrowserTaskEntity> {
    const repository = await this.getRepository();
    const existing = await repository.findOne({
      where: { taskId: task.taskId },
    });
    if (existing) {
      task.id = existing.id;
    }
    return await repository.save(task);
  }

  async findByTaskId(taskId: string): Promise<BrowserTaskEntity | null> {
    const repository = await this.getRepository();
    return await repository.findOne({ where: { taskId } });
  }

  /** Non-terminal tasks (for startup interrupted-marking). */
  async findNonTerminal(): Promise<BrowserTaskEntity[]> {
    const repository = await this.getRepository();
    const terminal = [
      "completed",
      "failed",
      "cancelled",
      "interrupted",
    ];
    return await repository
      .createQueryBuilder("task")
      .where("task.phase NOT IN (:...terminal)", { terminal })
      .getMany();
  }

  async markInterrupted(ids: readonly number[], reason: string): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const repository = await this.getRepository();
    const result = await repository.update(
      { id: In([...ids]) },
      { phase: "interrupted", terminalReason: reason.slice(0, 128) }
    );
    return result.affected ?? 0;
  }
}
