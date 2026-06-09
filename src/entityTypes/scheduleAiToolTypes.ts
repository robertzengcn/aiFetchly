import { z } from "zod";
import {
  TaskType,
  ScheduleStatus,
  TriggerType,
  DependencyCondition,
} from "@/entity/ScheduleTask.entity";
import { ExecutionStatus } from "@/entity/ScheduleExecutionLog.entity";

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export enum ScheduleToolErrorCode {
  VALIDATION_FAILED = "VALIDATION_FAILED",
  SCHEDULE_NOT_FOUND = "SCHEDULE_NOT_FOUND",
  TASK_NOT_FOUND = "TASK_NOT_FOUND",
  INVALID_CRON = "INVALID_CRON",
  DEPENDENCY_CONFLICT = "DEPENDENCY_CONFLICT",
  SCHEDULER_SYNC_FAILED = "SCHEDULER_SYNC_FAILED",
  EXECUTION_FAILED = "EXECUTION_FAILED",
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ScheduleToolSuccess<T> = {
  success: true;
  data: T;
  warning?: string;
};
export type ScheduleToolFailure = {
  success: false;
  error: string;
  code: ScheduleToolErrorCode;
  details?: Record<string, unknown>;
};
export type ScheduleToolResult<T> =
  | ScheduleToolSuccess<T>
  | ScheduleToolFailure;

// ---------------------------------------------------------------------------
// Safe payload interfaces
// ---------------------------------------------------------------------------

export interface SafeSchedulePayload {
  id: number;
  name: string;
  description: string | null;
  task_type: string;
  task_id: number;
  cron_expression: string;
  is_active: boolean;
  status: string;
  trigger_type: string;
  parent_schedule_id: number | null;
  dependency_condition: string | null;
  delay_minutes: number;
  last_run_time: string | null;
  next_run_time: string | null;
  execution_count: number;
  failure_count: number;
  last_error_message: string | null;
}

export interface SafeExecutionPayload {
  id: number;
  schedule_id: number;
  status: string;
  result_message: string | null;
  execution_duration: number | null;
  parent_execution_id: number | null;
  triggered_by: string;
  task_output_id: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// ---------------------------------------------------------------------------
// Re-usable Zod primitives
// ---------------------------------------------------------------------------

const scheduleIdSchema = z.coerce.number().int().positive();

const taskTypeEnumSchema = z.nativeEnum(TaskType);

const triggerTypeEnumSchema = z.nativeEnum(TriggerType);

const executionStatusEnumSchema = z.nativeEnum(ExecutionStatus);

const dependencyConditionEnumSchema = z.nativeEnum(DependencyCondition);

// ---------------------------------------------------------------------------
// Tool input schemas
// ---------------------------------------------------------------------------

export const listSchedulesSchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(100).default(20),
  sort_key: z.string().trim().min(1).optional(),
  sort_order: z.enum(["asc", "desc"]).optional(),
});

export const getScheduleDetailsSchema = z.object({
  schedule_id: scheduleIdSchema,
});

export const listScheduleExecutionsSchema = z.object({
  schedule_id: scheduleIdSchema.optional(),
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(100).default(20),
  status: executionStatusEnumSchema.optional(),
  triggered_by: triggerTypeEnumSchema.optional(),
});

export const createScheduleSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(1000).optional(),
  task_type: taskTypeEnumSchema,
  task_id: scheduleIdSchema,
  cron_expression: z.string().trim().min(1).max(100),
  is_active: z.boolean().default(false),
  trigger_type: triggerTypeEnumSchema.default(TriggerType.CRON),
  parent_schedule_id: scheduleIdSchema.optional(),
  dependency_condition: dependencyConditionEnumSchema.optional(),
  delay_minutes: z.number().int().min(0).max(1440).default(0),
});

export const updateScheduleSchema = z.object({
  schedule_id: scheduleIdSchema,
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(1000).optional(),
  task_type: taskTypeEnumSchema.optional(),
  task_id: scheduleIdSchema.optional(),
  cron_expression: z.string().trim().min(1).max(100).optional(),
  is_active: z.boolean().optional(),
  status: z.nativeEnum(ScheduleStatus).optional(),
  trigger_type: triggerTypeEnumSchema.optional(),
  parent_schedule_id: scheduleIdSchema.nullable().optional(),
  dependency_condition: dependencyConditionEnumSchema.optional(),
  delay_minutes: z.number().int().min(0).max(1440).optional(),
});

export const deleteScheduleSchema = z.object({
  schedule_id: scheduleIdSchema,
});

export const pauseScheduleSchema = z.object({
  schedule_id: scheduleIdSchema,
});

export const resumeScheduleSchema = z.object({
  schedule_id: scheduleIdSchema,
});

export const runScheduleNowSchema = z.object({
  schedule_id: scheduleIdSchema,
});

// ---------------------------------------------------------------------------
// Inferred types from schemas
// ---------------------------------------------------------------------------

export type ListSchedulesInput = z.infer<typeof listSchedulesSchema>;
export type GetScheduleDetailsInput = z.infer<typeof getScheduleDetailsSchema>;
export type ListScheduleExecutionsInput = z.infer<
  typeof listScheduleExecutionsSchema
>;
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
export type DeleteScheduleInput = z.infer<typeof deleteScheduleSchema>;
export type PauseScheduleInput = z.infer<typeof pauseScheduleSchema>;
export type ResumeScheduleInput = z.infer<typeof resumeScheduleSchema>;
export type RunScheduleNowInput = z.infer<typeof runScheduleNowSchema>;
