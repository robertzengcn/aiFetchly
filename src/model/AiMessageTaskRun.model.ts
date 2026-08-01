import { BaseDb } from "@/model/Basedb";
import { LessThan, Repository } from "typeorm";
import { AiMessageTaskRunEntity } from "@/entity/AiMessageTaskRun.entity";
import type { AiMessageTaskRunStatus } from "@/entityTypes/aiMessageTaskTypes";
import { assertNotWorker } from "@/model/workerDbGuard";
import type { CreateOccurrenceRecord } from "@/entityTypes/aiChatScheduledLoopTypes";

export class AiMessageTaskRunModel extends BaseDb {
  private repository: Repository<AiMessageTaskRunEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository = this.sqliteDb.connection.getRepository(
      AiMessageTaskRunEntity
    );
  }

  async create(entity: Partial<AiMessageTaskRunEntity>): Promise<number> {
    const saved = await this.repository.save(entity);
    return saved.id;
  }

  async updateStatus(
    id: number,
    status: AiMessageTaskRunStatus,
    data?: Partial<AiMessageTaskRunEntity>
  ): Promise<void> {
    await this.repository.update(id, { status, ...data });
  }

  async getById(id: number): Promise<AiMessageTaskRunEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  async listByTask(
    taskId: number,
    page = 1,
    limit = 20
  ): Promise<{ items: AiMessageTaskRunEntity[]; total: number }> {
    const [items, total] = await this.repository.findAndCount({
      where: { task_id: taskId },
      order: { id: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total };
  }

  async listBySchedule(
    scheduleId: number,
    page = 1,
    limit = 20
  ): Promise<{ items: AiMessageTaskRunEntity[]; total: number }> {
    const [items, total] = await this.repository.findAndCount({
      where: { schedule_id: scheduleId },
      order: { id: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total };
  }

  async getLatestByTask(
    taskId: number
  ): Promise<AiMessageTaskRunEntity | null> {
    return this.repository.findOne({
      where: { task_id: taskId },
      order: { id: "DESC" },
    });
  }

  // ----- Scheduled-loop occurrence operations (technical-design §10.3) -----

  /**
   * Create a scheduled-loop occurrence run row with idempotent retry behavior.
   * If the unique idempotency key already exists (restart/retry race), return
   * the existing run's id instead of throwing or creating a duplicate.
   */
  async createOccurrence(input: CreateOccurrenceRecord): Promise<number> {
    assertNotWorker("createOccurrence");
    const entity = new AiMessageTaskRunEntity();
    entity.task_id = input.taskId;
    entity.schedule_id = input.scheduleId;
    entity.conversation_id = input.conversationId;
    entity.status = "pending";
    entity.occurrence = input.occurrence;
    entity.attempt = 1;
    entity.scheduled_for = input.scheduledFor;
    entity.catch_up = input.catchUp;
    entity.idempotency_key = input.idempotencyKey;
    entity.tool_calls_count = 0;
    entity.delivery_state = null;
    entity.error_code = null;

    try {
      const saved = await this.repository.save(entity);
      return saved.id;
    } catch {
      // Unique constraint on idempotency_key or (schedule_id, occurrence):
      // resolve to the existing run instead of duplicating it.
      const existing = await this.getByIdempotencyKey(input.idempotencyKey);
      if (existing) return existing.id;
      // Fall back to (schedule_id, occurrence) lookup.
      const fallback = await this.repository.findOne({
        where: { schedule_id: input.scheduleId, occurrence: input.occurrence },
      });
      if (fallback) return fallback.id;
      throw new Error("createOccurrence failed and no existing run was found");
    }
  }

  /** Find an occurrence run by its idempotency key. */
  async getByIdempotencyKey(
    key: string
  ): Promise<AiMessageTaskRunEntity | null> {
    assertNotWorker("getByIdempotencyKey");
    return this.repository.findOne({ where: { idempotency_key: key } });
  }

  /** Most recent occurrence run for a schedule (renderer view + control). */
  async getLatestBySchedule(
    scheduleId: number
  ): Promise<AiMessageTaskRunEntity | null> {
    assertNotWorker("getLatestBySchedule");
    return this.repository.findOne({
      where: { schedule_id: scheduleId },
      order: { id: "DESC" },
    });
  }

  /** Count runs for a schedule, optionally filtered by status. */
  async countBySchedule(
    scheduleId: number,
    status?: AiMessageTaskRunStatus
  ): Promise<number> {
    assertNotWorker("countBySchedule");
    const where = status
      ? { schedule_id: scheduleId, status }
      : { schedule_id: scheduleId };
    return this.repository.count({ where });
  }

  /** Link the persisted scheduled user-message row to the run. */
  async linkUserMessage(runId: number, messageId: string): Promise<void> {
    assertNotWorker("linkUserMessage");
    await this.repository.update(runId, { user_message_id: messageId });
  }

  /** Link the persisted assistant-message row to the run. */
  async linkAssistantMessage(runId: number, messageId: string): Promise<void> {
    assertNotWorker("linkAssistantMessage");
    await this.repository.update(runId, { assistant_message_id: messageId });
  }

  /**
   * Mark running/waiting occurrence rows older than the cutoff as interrupted.
   * Used during startup recovery to clear stale in-memory leases after a crash
   * or restart. Returns the number of rows affected.
   */
  async markInterruptedRuns(cutoff: Date): Promise<number> {
    assertNotWorker("markInterruptedRuns");
    const result = await this.repository.update(
      {
        status: "running" as AiMessageTaskRunStatus,
        started_at: LessThan(cutoff),
      },
      {
        status: "interrupted",
        error_code: "RUN_INTERRUPTED",
        finished_at: new Date(),
      }
    );
    return result.affected ?? 0;
  }
}
