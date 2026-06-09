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
} from "@/entityTypes/scheduleAiToolTypes";
import { ScheduleCreateRequest } from "@/entityTypes/schedule-type";
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
