import { ZodError } from "zod";

import { ScheduleTaskModule } from "@/modules/ScheduleTaskModule";
import { ScheduleManager } from "@/modules/ScheduleManager";
import { ScheduleExecutionLogModule } from "@/modules/ScheduleExecutionLogModule";
import { ScheduleTaskEntity, TaskType } from "@/entity/ScheduleTask.entity";
import { SearchTaskModule } from "@/modules/SearchTaskModule";
import { EmailSearchTaskModule } from "@/modules/EmailSearchTaskModule";
import { BuckEmailTaskModule } from "@/modules/buckEmailTaskModule";
import { YellowPagesTaskModule } from "@/modules/YellowPagesTaskModule";
import { GoogleMapsModule } from "@/modules/GoogleMapsModule";
import { YandexMapsModule } from "@/modules/YandexMapsModule";
import {
  ScheduleToolErrorCode,
  ScheduleToolFailure,
  SafeSchedulePayload,
  SafeExecutionPayload,
} from "@/entityTypes/scheduleAiToolTypes";

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
      throw new Error(
        `Unsupported task type: ${taskType}`
      );
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
