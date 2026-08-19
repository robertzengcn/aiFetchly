import { BaseDb } from "@/model/Basedb";
import { log } from "@/modules/Logger";
import { In, Repository } from "typeorm";
import {
  ScheduleTaskEntity,
  TaskType,
  ScheduleStatus,
  TriggerType,
  DependencyCondition,
} from "@/entity/ScheduleTask.entity";
import {
  ScheduleCreateRequest,
  ScheduleUpdateRequest,
} from "@/entityTypes/schedule-type";
import { SortBy } from "@/entityTypes/commonType";
import { CronJob } from "cron";
import { AiMessageTaskRunEntity } from "@/entity/AiMessageTaskRun.entity";
import {
  nextFutureOccurrence,
  occurrenceOfSlot,
} from "@/config/aiChatScheduledLoopConfig";
import type {
  ClaimOccurrenceInput,
  ClaimOccurrenceResult,
  CreateIntervalScheduleRecord,
  IntervalResultUpdate,
} from "@/entityTypes/aiChatScheduledLoopTypes";
import { assertNotWorker } from "@/model/workerDbGuard";

export class ScheduleTaskModel extends BaseDb {
  private repository: Repository<ScheduleTaskEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository =
      this.sqliteDb.connection.getRepository(ScheduleTaskEntity);
  }

  /**
   * Calculate next run time from cron expression
   * @param cronExpression The cron expression
   * @returns The next run time or null if calculation fails
   */
  private calculateNextRunTime(cronExpression: string): Date | null {
    if (!cronExpression || cronExpression.trim() === "") {
      return null;
    }

    try {
      const cronJob = new CronJob(cronExpression, () => undefined, null, false);
      const nextDate = cronJob.nextDate();
      return nextDate.toJSDate();
    } catch (error) {
      log.error("Failed to calculate next run time:", error);
      return null;
    }
  }

  /**
   * Create a new schedule
   * @param scheduleData The schedule creation data
   * @returns The ID of the created schedule
   */
  async createSchedule(scheduleData: ScheduleCreateRequest): Promise<number> {
    const scheduleEntity = new ScheduleTaskEntity();
    scheduleEntity.name = scheduleData.name;
    scheduleEntity.description = scheduleData.description || "";
    scheduleEntity.task_type = scheduleData.task_type;
    scheduleEntity.task_id = scheduleData.task_id;
    scheduleEntity.cron_expression = scheduleData.cron_expression;
    scheduleEntity.is_active =
      scheduleData.is_active !== undefined ? scheduleData.is_active : true;
    scheduleEntity.trigger_type = scheduleData.trigger_type || TriggerType.CRON;
    scheduleEntity.parent_schedule_id = scheduleData.parent_schedule_id || null;
    scheduleEntity.dependency_condition = scheduleData.dependency_condition
      ? scheduleData.dependency_condition.toString()
      : null;
    scheduleEntity.delay_minutes = scheduleData.delay_minutes || 0;
    scheduleEntity.status = ScheduleStatus.ACTIVE;
    scheduleEntity.execution_count = 0;
    scheduleEntity.failure_count = 0;
    scheduleEntity.last_modified = new Date();

    // Calculate next_run_time if trigger_type is CRON and cron_expression is not empty
    if (
      scheduleEntity.trigger_type === TriggerType.CRON &&
      scheduleEntity.cron_expression &&
      scheduleEntity.cron_expression.trim() !== ""
    ) {
      const nextRunTime = this.calculateNextRunTime(
        scheduleEntity.cron_expression
      );
      if (nextRunTime) {
        scheduleEntity.next_run_time = nextRunTime;
      }
    }

    const savedSchedule = await this.repository.save(scheduleEntity);
    return savedSchedule.id;
  }

  /**
   * Update an existing schedule
   * @param id The schedule ID
   * @param scheduleData The update data
   */
  async updateSchedule(
    id: number,
    scheduleData: ScheduleUpdateRequest
  ): Promise<void> {
    const updateData: any = {};

    if (scheduleData.name !== undefined) updateData.name = scheduleData.name;
    if (scheduleData.description !== undefined)
      updateData.description = scheduleData.description;
    if (scheduleData.task_type !== undefined)
      updateData.task_type = scheduleData.task_type;
    if (scheduleData.task_id !== undefined)
      updateData.task_id = scheduleData.task_id;
    if (scheduleData.cron_expression !== undefined)
      updateData.cron_expression = scheduleData.cron_expression;
    if (scheduleData.is_active !== undefined)
      updateData.is_active = scheduleData.is_active;
    if (scheduleData.trigger_type !== undefined)
      updateData.trigger_type = scheduleData.trigger_type;
    if (scheduleData.parent_schedule_id !== undefined)
      updateData.parent_schedule_id = scheduleData.parent_schedule_id;
    if (scheduleData.dependency_condition !== undefined)
      updateData.dependency_condition = scheduleData.dependency_condition;
    if (scheduleData.delay_minutes !== undefined)
      updateData.delay_minutes = scheduleData.delay_minutes;
    if (scheduleData.status !== undefined)
      updateData.status = scheduleData.status;

    updateData.last_modified = new Date();

    // Calculate next_run_time if trigger_type is CRON and cron_expression is not empty
    // Recalculate if trigger_type or cron_expression is being updated
    const triggerTypeChanged = scheduleData.trigger_type !== undefined;
    const cronExpressionChanged = scheduleData.cron_expression !== undefined;

    if (triggerTypeChanged || cronExpressionChanged) {
      // Get the current schedule to check the final trigger_type and cron_expression
      const currentSchedule = await this.getScheduleById(id);
      if (currentSchedule) {
        const finalTriggerType =
          scheduleData.trigger_type !== undefined
            ? scheduleData.trigger_type
            : currentSchedule.trigger_type;
        const finalCronExpression =
          scheduleData.cron_expression !== undefined
            ? scheduleData.cron_expression
            : currentSchedule.cron_expression;

        if (
          finalTriggerType === TriggerType.CRON &&
          finalCronExpression &&
          finalCronExpression.trim() !== ""
        ) {
          const nextRunTime = this.calculateNextRunTime(finalCronExpression);
          if (nextRunTime) {
            updateData.next_run_time = nextRunTime;
          } else {
            // If calculation fails, set to null
            updateData.next_run_time = null;
          }
        } else {
          // If trigger type is not CRON or cron_expression is empty, set next_run_time to null
          updateData.next_run_time = null;
        }
      }
    }

    await this.repository.update({ id }, updateData);
  }

  /**
   * Delete a schedule
   * @param id The schedule ID
   */
  async deleteSchedule(id: number): Promise<void> {
    await this.repository.delete({ id });
  }

  /**
   * Get schedule by ID
   * @param id The schedule ID
   * @returns The schedule entity or null
   */
  async getScheduleById(id: number): Promise<ScheduleTaskEntity | null> {
    return await this.repository.findOne({
      where: { id },
    });
  }

  /**
   * List schedules with pagination and sorting
   * @param page Page number (offset)
   * @param size Page size (limit)
   * @param sort Sort parameters
   * @returns Array of schedule entities
   */
  async listSchedules(
    page: number,
    size: number,
    sort?: SortBy
  ): Promise<ScheduleTaskEntity[]> {
    const allowedSortKeys = [
      "id",
      "name",
      "task_type",
      "status",
      "last_run_time",
      "next_run_time",
      "createdAt",
    ];
    const allowedSortOrders = ["ASC", "DESC"];

    let orderOptions: any = { id: "DESC" };

    if (sort && sort.key && sort.order) {
      const sortKey = sort.key.toLowerCase();
      const sortOrder = sort.order.toUpperCase();

      if (!allowedSortKeys.includes(sortKey)) {
        throw new Error("Not allowed sort key");
      }

      if (!allowedSortOrders.includes(sortOrder)) {
        throw new Error("Not allowed sort order");
      }

      orderOptions = { [sortKey]: sortOrder };
    }

    return await this.repository.find({
      order: orderOptions,
      take: size,
      skip: page * size,
    });
  }

  /**
   * Get total number of schedules
   * @returns Total count of schedules
   */
  async getScheduleTotal(): Promise<number> {
    return await this.repository.count();
  }

  /**
   * Get active schedules
   * @returns Array of active schedule entities
   */
  async getActiveSchedules(): Promise<ScheduleTaskEntity[]> {
    return await this.repository.find({
      where: { is_active: true },
      order: { next_run_time: "ASC" },
    });
  }

  /**
   * Get schedules ready to execute (next_run_time <= now)
   * @returns Array of schedules ready to execute
   */
  async getSchedulesReadyToExecute(): Promise<ScheduleTaskEntity[]> {
    const now = new Date();
    return await this.repository
      .createQueryBuilder("schedule")
      .where("schedule.is_active = :isActive", { isActive: true })
      .andWhere("schedule.next_run_time <= :now", { now })
      .andWhere("schedule.trigger_type = :triggerType", {
        triggerType: TriggerType.CRON,
      })
      .orderBy("schedule.next_run_time", "ASC")
      .getMany();
  }

  /**
   * Update next run time for a schedule
   * @param id The schedule ID
   * @param nextRunTime The new next run time
   */
  async updateNextRunTime(id: number, nextRunTime: Date): Promise<void> {
    await this.repository.update(
      { id },
      {
        next_run_time: nextRunTime,
        last_modified: new Date(),
      }
    );
  }

  /**
   * Update last run time for a schedule
   * @param id The schedule ID
   * @param lastRunTime The new last run time
   */
  async updateLastRunTime(id: number, lastRunTime: Date): Promise<void> {
    await this.repository.update(
      { id },
      {
        last_run_time: lastRunTime,
        last_modified: new Date(),
      }
    );
  }

  /**
   * Increment execution count for a schedule
   * @param id The schedule ID
   * @param success Whether the execution was successful
   */
  async incrementExecutionCount(id: number, success: boolean): Promise<void> {
    const updateData: any = {
      last_modified: new Date(),
    };

    if (success) {
      updateData.execution_count = () => "execution_count + 1";
    } else {
      updateData.failure_count = () => "failure_count + 1";
    }

    await this.repository.update({ id }, updateData);
  }

  /**
   * Update last error message for a schedule
   * @param id The schedule ID
   * @param errorMessage The error message
   */
  async updateLastErrorMessage(
    id: number,
    errorMessage: string
  ): Promise<void> {
    await this.repository.update(
      { id },
      {
        last_error_message: errorMessage,
        last_modified: new Date(),
      }
    );
  }

  /**
   * Get child schedules for a parent schedule
   * @param parentId The parent schedule ID
   * @returns Array of child schedule entities
   */
  async getChildSchedules(parentId: number): Promise<ScheduleTaskEntity[]> {
    return await this.repository.find({
      where: { parent_schedule_id: parentId },
      order: { delay_minutes: "ASC" },
    });
  }

  /**
   * Get parent schedule for a child schedule
   * @param childId The child schedule ID
   * @returns The parent schedule entity or null
   */
  async getParentSchedule(childId: number): Promise<ScheduleTaskEntity | null> {
    const child = await this.repository.findOne({
      where: { id: childId },
    });

    if (!child || !child.parent_schedule_id) {
      return null;
    }

    return await this.repository.findOne({
      where: { id: child.parent_schedule_id },
    });
  }

  /**
   * Get dependency chain for a schedule
   * @param scheduleId The schedule ID
   * @returns Array of schedule entities in the dependency chain
   */
  async getDependencyChain(scheduleId: number): Promise<ScheduleTaskEntity[]> {
    const chain: ScheduleTaskEntity[] = [];
    let currentId = scheduleId;

    while (currentId) {
      const schedule = await this.repository.findOne({
        where: { id: currentId },
      });

      if (!schedule) break;

      chain.unshift(schedule);
      currentId = schedule.parent_schedule_id || 0;
    }

    return chain;
  }

  /**
   * Check for circular dependencies
   * @param scheduleId The schedule ID to check
   * @returns True if circular dependency is detected
   */
  async checkCircularDependencies(scheduleId: number): Promise<boolean> {
    const visited = new Set<number>();
    const recursionStack = new Set<number>();

    const hasCycle = async (id: number): Promise<boolean> => {
      if (recursionStack.has(id)) {
        return true; // Circular dependency detected
      }

      if (visited.has(id)) {
        return false; // Already processed
      }

      visited.add(id);
      recursionStack.add(id);

      const schedule = await this.repository.findOne({
        where: { id },
      });

      if (schedule && schedule.parent_schedule_id) {
        const hasCircular = await hasCycle(schedule.parent_schedule_id);
        if (hasCircular) return true;
      }

      recursionStack.delete(id);
      return false;
    };

    return await hasCycle(scheduleId);
  }

  /**
   * Get schedules by task type
   * @param taskType The task type to filter by
   * @returns Array of schedule entities
   */
  async getSchedulesByTaskType(
    taskType: TaskType
  ): Promise<ScheduleTaskEntity[]> {
    return await this.repository.find({
      where: { task_type: taskType },
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Get schedules by trigger type
   * @param triggerType The trigger type to filter by
   * @returns Array of schedule entities
   */
  async getSchedulesByTriggerType(
    triggerType: TriggerType
  ): Promise<ScheduleTaskEntity[]> {
    return await this.repository.find({
      where: { trigger_type: triggerType },
      order: { createdAt: "DESC" },
    });
  }

  /**
   * Enable a schedule
   * @param id The schedule ID
   */
  async enableSchedule(id: number): Promise<void> {
    await this.repository.update(
      { id },
      {
        is_active: true,
        status: ScheduleStatus.ACTIVE,
        last_modified: new Date(),
      }
    );
  }

  /**
   * Disable a schedule
   * @param id The schedule ID
   */
  async disableSchedule(id: number): Promise<void> {
    await this.repository.update(
      { id },
      {
        is_active: false,
        status: ScheduleStatus.INACTIVE,
        last_modified: new Date(),
      }
    );
  }

  /**
   * Pause a schedule
   * @param id The schedule ID
   */
  async pauseSchedule(id: number): Promise<void> {
    await this.repository.update(
      { id },
      {
        status: ScheduleStatus.PAUSED,
        last_modified: new Date(),
      }
    );
  }

  /**
   * Resume a schedule
   * @param id The schedule ID
   */
  async resumeSchedule(id: number): Promise<void> {
    await this.repository.update(
      { id },
      {
        status: ScheduleStatus.ACTIVE,
        last_modified: new Date(),
      }
    );
  }

  // ----- AI Chat V2 scheduled-loop interval operations (technical-design §10.1, §16) -----

  /**
   * Persistently create an interval schedule for a chat-bound scheduled loop.
   * The schedule is created active with its first run due at nextRunAt.
   */
  async createIntervalSchedule(
    input: CreateIntervalScheduleRecord
  ): Promise<number> {
    assertNotWorker("createIntervalSchedule");
    const entity = new ScheduleTaskEntity();
    entity.name = input.name;
    entity.description = "";
    entity.task_type = TaskType.AI_MESSAGE;
    entity.task_id = input.taskId;
    entity.cron_expression = "";
    entity.is_active = true;
    entity.status = ScheduleStatus.ACTIVE;
    entity.trigger_type = TriggerType.INTERVAL;
    entity.next_run_time = input.nextRunAt;
    entity.last_modified = new Date();
    entity.execution_count = 0;
    entity.failure_count = 0;
    entity.delay_minutes = 0;
    entity.parent_schedule_id = null;
    entity.dependency_condition = null;
    entity.interval_ms = input.intervalMs;
    entity.interval_anchor_at = input.anchorAt;
    entity.max_execution_count = input.maxExecutionCount;
    entity.expires_at = input.expiresAt;
    entity.misfire_policy = input.misfirePolicy;
    entity.overlap_policy = input.overlapPolicy;
    entity.source_conversation_id = input.conversationId;
    entity.claimed_execution_count = 0;
    entity.consecutive_failure_count = 0;
    entity.last_claimed_occurrence = 0;
    entity.coalesced_occurrence_count = 0;
    entity.terminal_reason = null;

    const saved = await this.repository.save(entity);
    return saved.id;
  }

  /**
   * Find the one active chat-created scheduled loop for a conversation.
   * Returns null when none exists. Terminal schedules are excluded so the
   * "one active loop per conversation" rule can be enforced.
   */
  async findChatScheduledLoop(
    conversationId: string
  ): Promise<ScheduleTaskEntity | null> {
    assertNotWorker("findChatScheduledLoop");
    return await this.repository.findOne({
      where: {
        source_conversation_id: conversationId,
        trigger_type: TriggerType.INTERVAL,
        is_active: true,
      },
      order: { id: "DESC" },
    });
  }

  /**
   * Find the latest chat-created scheduled loop for a conversation regardless
   * of active state. Used by control operations (resume must find paused
   * schedules) and status display.
   */
  async findLatestChatScheduledLoop(
    conversationId: string
  ): Promise<ScheduleTaskEntity | null> {
    assertNotWorker("findLatestChatScheduledLoop");
    return await this.repository.findOne({
      where: {
        source_conversation_id: conversationId,
        trigger_type: TriggerType.INTERVAL,
      },
      order: { id: "DESC" },
    });
  }

  /**
   * Return interval schedules whose next_run_time is due, in due order.
   * Used by the scheduler poll. Caller atomically claims each via
   * claimIntervalOccurrence to close the double-poll race.
   */
  async findDueIntervalSchedules(
    now: Date,
    limit: number
  ): Promise<ScheduleTaskEntity[]> {
    assertNotWorker("findDueIntervalSchedules");
    return await this.repository
      .createQueryBuilder("schedule")
      .where("schedule.is_active = :isActive", { isActive: true })
      .andWhere("schedule.trigger_type = :triggerType", {
        triggerType: TriggerType.INTERVAL,
      })
      .andWhere("schedule.next_run_time <= :now", { now })
      .orderBy("schedule.next_run_time", "ASC")
      .take(limit)
      .getMany();
  }

  /**
   * Atomically claim one due occurrence of an interval schedule.
   *
   * Runs in a transaction and conditions the claim on the row still being
   * active, due, not expired, and under its max-execution bound. If a pending
   * or running occurrence already exists for the schedule, the due slot is
   * coalesced (advanced past) instead of producing a second run. Advances
   * next_run_time to the first future cadence slot so the next scheduler poll
   * cannot re-claim the same slot while the run executes.
   */
  async claimIntervalOccurrence(
    input: ClaimOccurrenceInput
  ): Promise<ClaimOccurrenceResult> {
    assertNotWorker("claimIntervalOccurrence");
    const { scheduleId, now } = input;

    return await this.sqliteDb.connection.transaction(async (manager) => {
      const scheduleRepo = manager.getRepository(ScheduleTaskEntity);
      const runRepo = manager.getRepository(AiMessageTaskRunEntity);

      const schedule = await scheduleRepo.findOne({
        where: { id: scheduleId },
      });
      if (!schedule) {
        return { kind: "not_claimable", reason: "schedule_not_found" } as const;
      }
      if (
        !schedule.is_active ||
        schedule.status !== ScheduleStatus.ACTIVE ||
        schedule.trigger_type !== TriggerType.INTERVAL
      ) {
        return {
          kind: "not_claimable",
          reason: "schedule_inactive",
        } as const;
      }
      if (
        schedule.interval_ms == null ||
        schedule.interval_anchor_at == null ||
        schedule.next_run_time == null ||
        schedule.source_conversation_id == null
      ) {
        return {
          kind: "not_claimable",
          reason: "schedule_misconfigured",
        } as const;
      }
      // Fields are validated non-null above; capture as numbers for cadence math.
      const anchorMs = schedule.interval_anchor_at.getTime();
      const intervalMs = schedule.interval_ms;
      const slotMs = schedule.next_run_time.getTime();
      const lastClaimedOccurrence = schedule.last_claimed_occurrence;
      if (schedule.next_run_time.getTime() > now.getTime()) {
        return { kind: "not_due" } as const;
      }
      // Expire schedules whose lifetime elapsed.
      if (
        schedule.expires_at &&
        now.getTime() >= schedule.expires_at.getTime()
      ) {
        await scheduleRepo.update(
          { id: scheduleId },
          {
            is_active: false,
            status: ScheduleStatus.EXPIRED,
            terminal_reason: "SCHEDULE_EXPIRED",
            last_modified: now,
          }
        );
        return { kind: "expired", reason: "SCHEDULE_EXPIRED" } as const;
      }
      // Expire schedules that reached their execution bound.
      if (
        schedule.max_execution_count != null &&
        schedule.claimed_execution_count >= schedule.max_execution_count
      ) {
        await scheduleRepo.update(
          { id: scheduleId },
          {
            is_active: false,
            status: ScheduleStatus.EXPIRED,
            terminal_reason: "MAX_RUNS_REACHED",
            last_modified: now,
          }
        );
        return { kind: "expired", reason: "MAX_RUNS_REACHED" } as const;
      }

      // Coalesce if a run for this schedule is already pending/running/waiting.
      const activeRun = await runRepo.findOne({
        where: {
          schedule_id: scheduleId,
          status: In(["pending", "running", "waiting_for_conversation"]),
        },
      });
      if (activeRun) {
        const { nextRunTime, skipped } = this.advancePastClaimedSlot(
          anchorMs,
          intervalMs,
          slotMs,
          lastClaimedOccurrence,
          now
        );
        await scheduleRepo.update(
          { id: scheduleId },
          {
            next_run_time: nextRunTime,
            coalesced_occurrence_count:
              schedule.coalesced_occurrence_count + skipped + 1,
            last_modified: now,
          }
        );
        return { kind: "coalesced", coalescedCount: skipped + 1 } as const;
      }

      // Determine the occurrence number of the due slot from the cadence grid.
      const occurrence = occurrenceOfSlot(anchorMs, intervalMs, slotMs);
      if (occurrence === null) {
        await scheduleRepo.update(
          { id: scheduleId },
          {
            is_active: false,
            status: ScheduleStatus.FAILED,
            terminal_reason: "INVALID_LOOP_SYNTAX",
            last_modified: now,
          }
        );
        return { kind: "not_claimable", reason: "invalid_cadence" } as const;
      }

      // Retry idempotency: if a row for this occurrence already exists, treat
      // as coalesced rather than creating a duplicate run row.
      const existingForOccurrence = await runRepo.findOne({
        where: { schedule_id: scheduleId, occurrence },
      });
      if (existingForOccurrence) {
        const { nextRunTime, skipped } = this.advancePastClaimedSlot(
          anchorMs,
          intervalMs,
          slotMs,
          lastClaimedOccurrence,
          now
        );
        await scheduleRepo.update(
          { id: scheduleId },
          {
            next_run_time: nextRunTime,
            coalesced_occurrence_count:
              schedule.coalesced_occurrence_count + skipped,
            last_modified: now,
          }
        );
        return { kind: "coalesced", coalescedCount: skipped } as const;
      }

      const idempotencyKey = `scheduled-loop:${scheduleId}:${occurrence}`;
      const catchUp =
        now.getTime() - slotMs >= intervalMs ||
        occurrence > schedule.last_claimed_occurrence + 1;

      const run = new AiMessageTaskRunEntity();
      run.task_id = schedule.task_id;
      run.schedule_id = scheduleId;
      run.conversation_id = schedule.source_conversation_id;
      run.status = "pending";
      run.occurrence = occurrence;
      run.attempt = 1;
      run.scheduled_for = schedule.next_run_time;
      run.catch_up = catchUp;
      run.idempotency_key = idempotencyKey;
      run.tool_calls_count = 0;
      run.delivery_state = null;
      run.error_code = null;
      const savedRun = await runRepo.save(run);

      const { nextRunTime, skipped } = this.advancePastClaimedSlot(
        anchorMs,
        intervalMs,
        slotMs,
        lastClaimedOccurrence,
        now
      );
      await scheduleRepo.update(
        { id: scheduleId },
        {
          claimed_execution_count: schedule.claimed_execution_count + 1,
          last_claimed_occurrence: occurrence,
          next_run_time: nextRunTime,
          coalesced_occurrence_count:
            schedule.coalesced_occurrence_count + skipped,
          last_run_time: now,
          last_modified: now,
        }
      );

      return {
        kind: "claimed",
        runId: savedRun.id,
        occurrence,
        catchUp,
        idempotencyKey,
        scheduledFor: schedule.next_run_time,
        coalescedCount: skipped,
      } as const;
    });
  }

  /**
   * Compute the first future cadence slot after `now` and how many elapsed
   * slots were skipped relative to the currently-due slot. Callers must pass
   * values already validated non-null for the schedule.
   */
  private advancePastClaimedSlot(
    anchorMs: number,
    intervalMs: number,
    slotMs: number,
    lastClaimedOccurrence: number,
    now: Date
  ): { nextRunTime: Date; skipped: number } {
    const dueOccurrence =
      occurrenceOfSlot(anchorMs, intervalMs, slotMs) ?? lastClaimedOccurrence;
    const next = nextFutureOccurrence(anchorMs, intervalMs, now.getTime());
    const skipped = Math.max(0, next.occurrence - dueOccurrence - 1);
    return { nextRunTime: new Date(next.timeMs), skipped };
  }

  /**
   * Update schedule counters and optional terminal state after a run result.
   * Resets the consecutive-failure counter on success; increments on failure.
   */
  async updateIntervalAfterResult(input: IntervalResultUpdate): Promise<void> {
    assertNotWorker("updateIntervalAfterResult");
    const update: Partial<ScheduleTaskEntity> = {
      next_run_time: input.nextRunAt,
      last_modified: new Date(),
    };
    if (input.success) {
      update.consecutive_failure_count = 0;
    } else {
      update.consecutive_failure_count = (() =>
        "consecutive_failure_count + 1") as unknown as number;
    }
    if (input.terminalStatus === "expired") {
      update.is_active = false;
      update.status = ScheduleStatus.EXPIRED;
      update.terminal_reason = input.terminalReason ?? "SCHEDULE_EXPIRED";
    } else if (input.terminalStatus === "failed") {
      update.is_active = false;
      update.status = ScheduleStatus.FAILED;
      update.terminal_reason = input.terminalReason ?? "REPEATED_RUN_FAILURE";
    } else if (input.terminalStatus === "stopped") {
      update.is_active = false;
      update.status = ScheduleStatus.STOPPED;
      update.terminal_reason = input.terminalReason ?? "STOPPED";
    }
    await this.repository.update({ id: input.scheduleId }, update as never);
  }

  /** Mark a schedule paused with a stable terminal reason (history kept). */
  async pauseWithReason(id: number, reason: string): Promise<void> {
    assertNotWorker("pauseWithReason");
    await this.repository.update(
      { id },
      {
        is_active: false,
        status: ScheduleStatus.PAUSED,
        terminal_reason: reason,
        last_modified: new Date(),
      }
    );
  }

  /**
   * Resume an interval schedule: set active, recompute a future next run time,
   * and clear recoverable terminal state. Does not replay missed occurrences.
   */
  async resumeIntervalSchedule(id: number, nextRunAt: Date): Promise<void> {
    assertNotWorker("resumeIntervalSchedule");
    await this.repository.update(
      { id },
      {
        is_active: true,
        status: ScheduleStatus.ACTIVE,
        next_run_time: nextRunAt,
        terminal_reason: null,
        consecutive_failure_count: 0,
        last_modified: new Date(),
      }
    );
  }

  /** Mark a schedule stopped with a stable terminal reason (history kept). */
  async stopWithReason(id: number, reason: string): Promise<void> {
    assertNotWorker("stopWithReason");
    await this.repository.update(
      { id },
      {
        is_active: false,
        status: ScheduleStatus.STOPPED,
        terminal_reason: reason,
        last_modified: new Date(),
      }
    );
  }

  /** Mark a schedule expired with a stable terminal reason. */
  async expireWithReason(id: number, reason: string): Promise<void> {
    assertNotWorker("expireWithReason");
    await this.repository.update(
      { id },
      {
        is_active: false,
        status: ScheduleStatus.EXPIRED,
        terminal_reason: reason,
        last_modified: new Date(),
      }
    );
  }

  /**
   * Truncate the database table
   */
  async truncatedb(): Promise<void> {
    await this.repository.clear();
  }
}
