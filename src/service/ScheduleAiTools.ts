import { ZodError } from "zod";

import { ScheduleTaskModule } from "@/modules/ScheduleTaskModule";
import { ScheduleManager } from "@/modules/ScheduleManager";
import { ScheduleExecutionLogModule } from "@/modules/ScheduleExecutionLogModule";
import {
  ScheduleTaskEntity,
  TaskType,
  TriggerType,
} from "@/entity/ScheduleTask.entity";
import { SearchTaskModule } from "@/modules/SearchTaskModule";
import { EmailSearchTaskModule } from "@/modules/EmailSearchTaskModule";
import { BuckEmailTaskModule } from "@/modules/buckEmailTaskModule";
import { YellowPagesTaskModule } from "@/modules/YellowPagesTaskModule";
import { GoogleMapsModule } from "@/modules/GoogleMapsModule";
import { YandexMapsModule } from "@/modules/YandexMapsModule";
import {
  ScheduleToolErrorCode,
  ScheduleToolFailure,
  ScheduleToolResult,
  SafeSchedulePayload,
  SafeExecutionPayload,
  listSchedulesSchema,
  getScheduleDetailsSchema,
  listScheduleExecutionsSchema,
  createScheduleSchema,
  updateScheduleSchema,
  deleteScheduleSchema,
  pauseScheduleSchema,
  resumeScheduleSchema,
  runScheduleNowSchema,
} from "@/entityTypes/scheduleAiToolTypes";
import {
  ScheduleCreateRequest,
  ScheduleUpdateRequest,
} from "@/entityTypes/schedule-type";
import { ListData } from "@/entityTypes/commonType";
import {
  ExecutionStatus,
  TriggerType as LogTriggerType,
} from "@/entity/ScheduleExecutionLog.entity";

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/**
 * Create a structured error result for schedule tool operations.
 */
export function toolFailure(
  code: ScheduleToolErrorCode,
  message: string
): ScheduleToolFailure {
  return {
    success: false,
    error: message,
    code,
  };
}

/**
 * Extract human-readable validation messages from a ZodError and return a
 * VALIDATION_FAILED failure payload.
 */
export function validationFailure(error: ZodError): ScheduleToolFailure {
  const messages = error.errors.map((issue) => {
    const field = issue.path.join(".");
    return `${field}: ${issue.message}`;
  });

  return toolFailure(
    ScheduleToolErrorCode.VALIDATION_FAILED,
    `Validation failed: ${messages.join("; ")}`
  );
}

// ---------------------------------------------------------------------------
// Payload mappers
// ---------------------------------------------------------------------------

/**
 * Map a ScheduleTaskEntity to a SafeSchedulePayload suitable for returning
 * to AI tool callers. Date fields are converted to ISO strings (or null).
 */
export function toSafeSchedulePayload(
  schedule: ScheduleTaskEntity
): SafeSchedulePayload {
  return {
    id: schedule.id,
    name: schedule.name,
    description: schedule.description ?? null,
    task_type: schedule.task_type,
    task_id: schedule.task_id,
    cron_expression: schedule.cron_expression,
    is_active: schedule.is_active,
    status: schedule.status,
    trigger_type: schedule.trigger_type,
    parent_schedule_id: schedule.parent_schedule_id ?? null,
    dependency_condition: schedule.dependency_condition ?? null,
    delay_minutes: schedule.delay_minutes,
    last_run_time: schedule.last_run_time
      ? new Date(schedule.last_run_time).toISOString()
      : null,
    next_run_time: schedule.next_run_time
      ? new Date(schedule.next_run_time).toISOString()
      : null,
    execution_count: schedule.execution_count,
    failure_count: schedule.failure_count,
    last_error_message: schedule.last_error_message ?? null,
  };
}

/**
 * Map an execution log record (plain object from TypeORM query) to a
 * SafeExecutionPayload. Date fields are converted to ISO strings (or null).
 */
export function toSafeExecutionPayload(
  execution: Record<string, unknown>
): SafeExecutionPayload {
  const createdAt = execution["createdAt"];
  const updatedAt = execution["updatedAt"];

  return {
    id: execution["id"] as number,
    schedule_id: execution["schedule_id"] as number,
    status: execution["status"] as string,
    result_message: (execution["result_message"] as string | null) ?? null,
    execution_duration:
      (execution["execution_duration"] as number | null) ?? null,
    parent_execution_id:
      (execution["parent_execution_id"] as number | null) ?? null,
    triggered_by: execution["triggered_by"] as string,
    task_output_id: (execution["task_output_id"] as number | null) ?? null,
    createdAt: createdAt ? new Date(createdAt as Date).toISOString() : null,
    updatedAt: updatedAt ? new Date(updatedAt as Date).toISOString() : null,
  };
}

// ---------------------------------------------------------------------------
// Task reference validation
// ---------------------------------------------------------------------------

/**
 * Validate that the task referenced by (taskType, taskId) actually exists in
 * the corresponding task table. Throws an Error with a descriptive message if
 * the task is not found or the task type is unsupported.
 */
export async function validateTaskReference(
  taskType: TaskType,
  taskId: number
): Promise<void> {
  switch (taskType) {
    case TaskType.SEARCH: {
      const module = new SearchTaskModule();
      const task = await module.read(taskId);
      if (task === null) {
        throw new Error(`Search task ${taskId} not found`);
      }
      break;
    }

    case TaskType.EMAIL_EXTRACT: {
      const module = new EmailSearchTaskModule();
      const task = await module.getTaskDetail(taskId);
      if (task === undefined || task === null) {
        throw new Error(`Email extract task ${taskId} not found`);
      }
      break;
    }

    case TaskType.BUCK_EMAIL: {
      const module = new BuckEmailTaskModule();
      const task = await module.read(taskId);
      if (task === undefined || task === null) {
        throw new Error(`Buck email task ${taskId} not found`);
      }
      break;
    }

    case TaskType.YELLOW_PAGES: {
      const module = new YellowPagesTaskModule();
      const task = await module.getTaskById(taskId);
      if (task === undefined || task === null) {
        throw new Error(`Yellow pages task ${taskId} not found`);
      }
      break;
    }

    case TaskType.GOOGLE_MAPS: {
      const module = new GoogleMapsModule();
      const record = await module.getSearchRecord(taskId);
      if (record === null) {
        throw new Error(`Google maps task ${taskId} not found`);
      }
      break;
    }

    case TaskType.YANDEX_MAPS: {
      const module = new YandexMapsModule();
      const record = await module.getSearchRecord(taskId);
      if (record === null) {
        throw new Error(`Yandex maps task ${taskId} not found`);
      }
      break;
    }

    default:
      throw new Error(`Unsupported task type: ${taskType}`);
  }
}

// ---------------------------------------------------------------------------
// Module factory helpers
// ---------------------------------------------------------------------------

/** Return a fresh ScheduleTaskModule instance. */
export function getScheduleModule(): ScheduleTaskModule {
  return new ScheduleTaskModule();
}

/** Return the singleton ScheduleManager instance. */
export function getScheduleManager(): ScheduleManager {
  return ScheduleManager.getInstance();
}

/** Return a fresh ScheduleExecutionLogModule instance. */
export function getExecutionLogModule(): ScheduleExecutionLogModule {
  return new ScheduleExecutionLogModule();
}

// ---------------------------------------------------------------------------
// Read-only tool functions
// ---------------------------------------------------------------------------

/**
 * List all schedules with pagination. Returns safe payloads suitable for AI
 * tool consumers.
 */
export async function listSchedulesForAi(args: unknown): Promise<
  ScheduleToolResult<{
    schedules: SafeSchedulePayload[];
    total: number;
    page: number;
    size: number;
  }>
> {
  try {
    const parsed = listSchedulesSchema.safeParse(args);
    if (!parsed.success) {
      return validationFailure(parsed.error);
    }

    const { page, size } = parsed.data;
    const module = getScheduleModule();
    const result: ListData<ScheduleTaskEntity> = await module.listSchedules(
      page,
      size
    );

    const schedules = result.records.map(toSafeSchedulePayload);

    return {
      success: true,
      data: {
        schedules,
        total: result.num,
        page,
        size,
      },
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to list schedules";
    return toolFailure(ScheduleToolErrorCode.VALIDATION_FAILED, message);
  }
}

/**
 * Get detailed information about a single schedule by ID.
 */
export async function getScheduleDetailsForAi(
  args: unknown
): Promise<ScheduleToolResult<{ schedule: SafeSchedulePayload }>> {
  try {
    const parsed = getScheduleDetailsSchema.safeParse(args);
    if (!parsed.success) {
      return validationFailure(parsed.error);
    }

    const { schedule_id } = parsed.data;
    const module = getScheduleModule();
    const schedule: ScheduleTaskEntity | null = await module.getScheduleById(
      schedule_id
    );

    if (schedule === null) {
      return toolFailure(
        ScheduleToolErrorCode.SCHEDULE_NOT_FOUND,
        `Schedule ${schedule_id} not found`
      );
    }

    return {
      success: true,
      data: { schedule: toSafeSchedulePayload(schedule) },
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to get schedule details";
    return toolFailure(ScheduleToolErrorCode.VALIDATION_FAILED, message);
  }
}

/**
 * List execution logs with optional filters for schedule_id, status, and
 * triggered_by. Returns safe execution payloads suitable for AI consumers.
 */
export async function listScheduleExecutionsForAi(args: unknown): Promise<
  ScheduleToolResult<{
    executions: SafeExecutionPayload[];
    total: number;
    page: number;
    size: number;
  }>
> {
  try {
    const parsed = listScheduleExecutionsSchema.safeParse(args);
    if (!parsed.success) {
      return validationFailure(parsed.error);
    }

    const { page, size, schedule_id, status, triggered_by } = parsed.data;
    const module = getExecutionLogModule();
    const result = await module.listExecutions(
      page,
      size,
      schedule_id,
      status as ExecutionStatus | undefined,
      triggered_by as LogTriggerType | undefined
    );

    const executions = result.records.map((record) =>
      toSafeExecutionPayload(record as unknown as Record<string, unknown>)
    );

    return {
      success: true,
      data: {
        executions,
        total: result.num,
        page,
        size,
      },
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to list schedule executions";
    return toolFailure(ScheduleToolErrorCode.VALIDATION_FAILED, message);
  }
}

// ---------------------------------------------------------------------------
// Create schedule tool
// ---------------------------------------------------------------------------

/**
 * Create a new schedule. Validates the cron expression, task reference, and
 * optional parent schedule before persisting. If the schedule is active and
 * cron-based, it is also registered with the in-memory scheduler.
 */
export async function createScheduleForAi(
  args: unknown
): Promise<ScheduleToolResult<{ schedule: SafeSchedulePayload }>> {
  // 1. Parse and validate input
  const parsed = createScheduleSchema.safeParse(args);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const input = parsed.data;

  // 2. Validate cron expression for CRON trigger type
  if (input.trigger_type === TriggerType.CRON) {
    const isValid = getScheduleManager().validateCronExpression(
      input.cron_expression
    );
    if (!isValid) {
      return toolFailure(
        ScheduleToolErrorCode.INVALID_CRON,
        `Invalid cron expression: "${input.cron_expression}"`
      );
    }
  }

  // 3. Validate that the referenced task exists
  try {
    await validateTaskReference(input.task_type, input.task_id);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Task validation failed";
    return toolFailure(ScheduleToolErrorCode.TASK_NOT_FOUND, message);
  }

  // 4. Validate parent schedule if provided
  if (input.parent_schedule_id !== undefined) {
    const parent = await getScheduleModule().getScheduleById(
      input.parent_schedule_id
    );
    if (parent === null) {
      return toolFailure(
        ScheduleToolErrorCode.DEPENDENCY_CONFLICT,
        `Parent schedule ${input.parent_schedule_id} not found`
      );
    }
  }

  // 5. Build the create request
  const createRequest: ScheduleCreateRequest = {
    name: input.name,
    description: input.description,
    task_type: input.task_type as TaskType,
    task_id: input.task_id,
    cron_expression: input.cron_expression,
    is_active: input.is_active,
    trigger_type: input.trigger_type as TriggerType,
    parent_schedule_id: input.parent_schedule_id,
    dependency_condition: input.dependency_condition,
    delay_minutes: input.delay_minutes,
  };

  // 6. Persist the schedule
  const scheduleId: number = await getScheduleModule().createSchedule(
    createRequest
  );

  // 7. Reload the saved schedule
  const savedSchedule = await getScheduleModule().getScheduleById(scheduleId);
  if (savedSchedule === null) {
    return toolFailure(
      ScheduleToolErrorCode.SCHEDULE_NOT_FOUND,
      "Schedule was created but could not be reloaded"
    );
  }

  // 8. Sync with in-memory scheduler if active and cron-based
  if (
    savedSchedule.is_active &&
    savedSchedule.trigger_type === TriggerType.CRON
  ) {
    try {
      await getScheduleManager().addSchedule(savedSchedule);
    } catch (syncError: unknown) {
      const syncMessage =
        syncError instanceof Error
          ? syncError.message
          : "Unknown scheduler sync error";
      return {
        success: true,
        data: { schedule: toSafeSchedulePayload(savedSchedule) },
        warning: `Schedule created but scheduler sync failed: ${syncMessage}`,
      };
    }
  }

  // 9. Return success
  return {
    success: true,
    data: { schedule: toSafeSchedulePayload(savedSchedule) },
  };
}

// ---------------------------------------------------------------------------
// Update schedule tool
// ---------------------------------------------------------------------------

/**
 * Update an existing schedule. Only the fields explicitly provided in args
 * will be changed. Validates cron expression and task reference when they are
 * being modified. Syncs the in-memory scheduler after the DB update.
 */
export async function updateScheduleForAi(
  args: unknown
): Promise<ScheduleToolResult<{ schedule: SafeSchedulePayload }>> {
  // 1. Parse and validate input
  const parsed = updateScheduleSchema.safeParse(args);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const { schedule_id, ...updateFields } = parsed.data;

  // 2. Load existing schedule
  const module = getScheduleModule();
  const existing = await module.getScheduleById(schedule_id);
  if (existing === null) {
    return toolFailure(
      ScheduleToolErrorCode.SCHEDULE_NOT_FOUND,
      `Schedule ${schedule_id} not found`
    );
  }

  // 3. Determine final task_type and task_id — validate if either changed
  const finalTaskType =
    updateFields.task_type ?? (existing.task_type as TaskType);
  const finalTaskId = updateFields.task_id ?? existing.task_id;
  const taskTypeChanged = updateFields.task_type !== undefined;
  const taskIdChanged = updateFields.task_id !== undefined;

  if (taskTypeChanged || taskIdChanged) {
    try {
      await validateTaskReference(finalTaskType, finalTaskId);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Task validation failed";
      return toolFailure(ScheduleToolErrorCode.TASK_NOT_FOUND, message);
    }
  }

  // 4. Validate cron expression when trigger_type is CRON and a new
  //    cron_expression is provided
  const effectiveTriggerType =
    updateFields.trigger_type ?? existing.trigger_type;
  if (
    effectiveTriggerType === TriggerType.CRON &&
    updateFields.cron_expression !== undefined
  ) {
    const isValid = getScheduleManager().validateCronExpression(
      updateFields.cron_expression
    );
    if (!isValid) {
      return toolFailure(
        ScheduleToolErrorCode.INVALID_CRON,
        `Invalid cron expression: "${updateFields.cron_expression}"`
      );
    }
  }

  // 5. Build ScheduleUpdateRequest with only the provided fields
  const updateRequest: ScheduleUpdateRequest = {};
  if (updateFields.name !== undefined) {
    updateRequest.name = updateFields.name;
  }
  if (updateFields.description !== undefined) {
    updateRequest.description = updateFields.description;
  }
  if (updateFields.task_type !== undefined) {
    updateRequest.task_type = updateFields.task_type as TaskType;
  }
  if (updateFields.task_id !== undefined) {
    updateRequest.task_id = updateFields.task_id;
  }
  if (updateFields.cron_expression !== undefined) {
    updateRequest.cron_expression = updateFields.cron_expression;
  }
  if (updateFields.is_active !== undefined) {
    updateRequest.is_active = updateFields.is_active;
  }
  if (updateFields.trigger_type !== undefined) {
    updateRequest.trigger_type = updateFields.trigger_type as TriggerType;
  }
  if (updateFields.parent_schedule_id !== undefined) {
    updateRequest.parent_schedule_id =
      updateFields.parent_schedule_id ?? undefined;
  }
  if (updateFields.dependency_condition !== undefined) {
    updateRequest.dependency_condition = updateFields.dependency_condition;
  }
  if (updateFields.delay_minutes !== undefined) {
    updateRequest.delay_minutes = updateFields.delay_minutes;
  }
  if (updateFields.status !== undefined) {
    updateRequest.status = updateFields.status;
  }

  // 6. Persist the update
  await module.updateSchedule(schedule_id, updateRequest);

  // 7. Reload the updated schedule
  const updatedSchedule = await module.getScheduleById(schedule_id);
  if (updatedSchedule === null) {
    return toolFailure(
      ScheduleToolErrorCode.SCHEDULE_NOT_FOUND,
      `Schedule ${schedule_id} was updated but could not be reloaded`
    );
  }

  // 8. Sync with in-memory scheduler
  try {
    await getScheduleManager().updateSchedule(updatedSchedule);
  } catch (syncError: unknown) {
    const syncMessage =
      syncError instanceof Error
        ? syncError.message
        : "Unknown scheduler sync error";
    return {
      success: true,
      data: { schedule: toSafeSchedulePayload(updatedSchedule) },
      warning: `Schedule updated but scheduler sync failed: ${syncMessage}`,
    };
  }

  // 9. Return success
  return {
    success: true,
    data: { schedule: toSafeSchedulePayload(updatedSchedule) },
  };
}

// ---------------------------------------------------------------------------
// Delete schedule tool
// ---------------------------------------------------------------------------

/**
 * Delete a schedule by ID. Removes it from the in-memory scheduler first,
 * then deletes from the database. Handles child-schedule dependency conflicts
 * gracefully.
 */
export async function deleteScheduleForAi(
  args: unknown
): Promise<ScheduleToolResult<{ deleted: boolean; schedule_id: number }>> {
  // 1. Parse and validate input
  const parsed = deleteScheduleSchema.safeParse(args);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const { schedule_id } = parsed.data;

  // 2. Load existing schedule
  const module = getScheduleModule();
  const schedule = await module.getScheduleById(schedule_id);
  if (schedule === null) {
    return toolFailure(
      ScheduleToolErrorCode.SCHEDULE_NOT_FOUND,
      `Schedule ${schedule_id} not found`
    );
  }

  // 3. Remove from runtime scheduler (best-effort)
  try {
    await getScheduleManager().removeSchedule(schedule_id);
  } catch (removeError: unknown) {
    const message =
      removeError instanceof Error ? removeError.message : String(removeError);
    console.error(
      `Failed to remove schedule ${schedule_id} from runtime: ${message}`
    );
  }

  // 4. Delete from database
  try {
    await module.deleteSchedule(schedule_id);
  } catch (dbError: unknown) {
    const errorMsg =
      dbError instanceof Error ? dbError.message : String(dbError);

    if (errorMsg.includes("child schedules")) {
      // Re-add to runtime if it was an active cron schedule
      if (schedule.is_active && schedule.trigger_type === TriggerType.CRON) {
        try {
          await getScheduleManager().addSchedule(schedule);
        } catch (reAddError: unknown) {
          console.error(
            `Failed to re-add schedule ${schedule_id} to runtime after failed delete:`,
            reAddError
          );
        }
      }
      return toolFailure(
        ScheduleToolErrorCode.DEPENDENCY_CONFLICT,
        "Cannot delete schedule with child schedules. Delete child schedules first."
      );
    }

    // Re-throw unexpected errors — but we must return a tool failure instead
    return toolFailure(
      ScheduleToolErrorCode.VALIDATION_FAILED,
      `Failed to delete schedule ${schedule_id}: ${errorMsg}`
    );
  }

  // 5. Return success
  return {
    success: true,
    data: { deleted: true, schedule_id },
  };
}

// ---------------------------------------------------------------------------
// Pause schedule tool
// ---------------------------------------------------------------------------

/**
 * Pause a schedule. The ScheduleManager updates the DB status to PAUSED and
 * removes the associated cron job from the in-memory scheduler.
 */
export async function pauseScheduleForAi(
  args: unknown
): Promise<ScheduleToolResult<{ schedule: SafeSchedulePayload }>> {
  // 1. Parse and validate input
  const parsed = pauseScheduleSchema.safeParse(args);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const { schedule_id } = parsed.data;

  // 2. Load existing schedule
  const module = getScheduleModule();
  const schedule = await module.getScheduleById(schedule_id);
  if (schedule === null) {
    return toolFailure(
      ScheduleToolErrorCode.SCHEDULE_NOT_FOUND,
      `Schedule ${schedule_id} not found`
    );
  }

  // 3. Pause via ScheduleManager (updates DB + removes cron)
  try {
    await getScheduleManager().pauseSchedule(schedule_id);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to pause schedule";
    return toolFailure(ScheduleToolErrorCode.EXECUTION_FAILED, message);
  }

  // 4. Reload and return safe payload
  const pausedSchedule = await module.getScheduleById(schedule_id);
  if (pausedSchedule === null) {
    return toolFailure(
      ScheduleToolErrorCode.SCHEDULE_NOT_FOUND,
      `Schedule ${schedule_id} was paused but could not be reloaded`
    );
  }

  return {
    success: true,
    data: { schedule: toSafeSchedulePayload(pausedSchedule) },
  };
}

// ---------------------------------------------------------------------------
// Resume schedule tool
// ---------------------------------------------------------------------------

/**
 * Resume a paused schedule. The ScheduleManager updates the DB status back to
 * ACTIVE and re-adds the cron job if the schedule is active.
 */
export async function resumeScheduleForAi(
  args: unknown
): Promise<ScheduleToolResult<{ schedule: SafeSchedulePayload }>> {
  // 1. Parse and validate input
  const parsed = resumeScheduleSchema.safeParse(args);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const { schedule_id } = parsed.data;

  // 2. Load existing schedule
  const module = getScheduleModule();
  const schedule = await module.getScheduleById(schedule_id);
  if (schedule === null) {
    return toolFailure(
      ScheduleToolErrorCode.SCHEDULE_NOT_FOUND,
      `Schedule ${schedule_id} not found`
    );
  }

  // 3. Resume via ScheduleManager (updates DB + re-adds cron if active)
  try {
    await getScheduleManager().resumeSchedule(schedule_id);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to resume schedule";
    return toolFailure(ScheduleToolErrorCode.EXECUTION_FAILED, message);
  }

  // 4. Reload and return safe payload
  const resumedSchedule = await module.getScheduleById(schedule_id);
  if (resumedSchedule === null) {
    return toolFailure(
      ScheduleToolErrorCode.SCHEDULE_NOT_FOUND,
      `Schedule ${schedule_id} was resumed but could not be reloaded`
    );
  }

  return {
    success: true,
    data: { schedule: toSafeSchedulePayload(resumedSchedule) },
  };
}

// ---------------------------------------------------------------------------
// Run schedule now tool
// ---------------------------------------------------------------------------

/**
 * Trigger an immediate execution of a schedule. The schedule must be active;
 * otherwise the execution is rejected with a clear message.
 */
export async function runScheduleNowForAi(args: unknown): Promise<
  ScheduleToolResult<{
    executed: boolean;
    schedule_id: number;
    schedule_name: string;
  }>
> {
  // 1. Parse and validate input
  const parsed = runScheduleNowSchema.safeParse(args);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const { schedule_id } = parsed.data;

  // 2. Load existing schedule
  const module = getScheduleModule();
  const schedule = await module.getScheduleById(schedule_id);
  if (schedule === null) {
    return toolFailure(
      ScheduleToolErrorCode.SCHEDULE_NOT_FOUND,
      `Schedule ${schedule_id} not found`
    );
  }

  // 3. Check that schedule is active
  if (!schedule.is_active) {
    return toolFailure(
      ScheduleToolErrorCode.EXECUTION_FAILED,
      "Schedule is not active. Resume it before running."
    );
  }

  // 4. Execute immediately via ScheduleManager
  try {
    await getScheduleManager().executeSchedule(schedule_id);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to execute schedule";
    return toolFailure(ScheduleToolErrorCode.EXECUTION_FAILED, message);
  }

  // 5. Return success
  return {
    success: true,
    data: {
      executed: true,
      schedule_id,
      schedule_name: schedule.name,
    },
  };
}
