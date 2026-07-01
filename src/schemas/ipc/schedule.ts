import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'
import { noInputSchema } from '@/schemas/ipc/_shared/common'
import { TaskType } from '@/entity/ScheduleTask.entity'

/**
 * Schedule 系列 IPC 入参 schema。
 *
 * 27 个 handler 分 8 组，按入参形态收敛到尽量少的 schema。
 */

/** 7 个 by-id handler 共享：DELETE/DETAIL/ENABLE/DISABLE/PAUSE/RESUME/RUN_NOW */
export const scheduleByIdInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive('id is required'),
  }),
)

/** SCHEDULE_CREATE / SCHEDULE_UPDATE — 复杂 ScheduleCreateRequest/UpdateRequest，passthrough */
export const scheduleWriteInputSchema = lazySchema(() =>
  z.object({}).passthrough(),
)

/** SCHEDULE_LIST: page/size/sort/filters */
export const scheduleListInputSchema = lazySchema(() =>
  z.object({
    page: z.number().int().nonnegative().optional(),
    size: z.number().int().positive().optional(),
    // sort 类型在 entityTypes 里是 any；保持透传
    sort: z.unknown().optional(),
    filters: z.unknown().optional(),
  }).passthrough(),
)

/** SCHEDULE_SEARCH: ScheduleSearchRequest (passthrough) */
export const scheduleSearchInputSchema = lazySchema(() =>
  z.object({}).passthrough(),
)

/** SCHEDULE_BY_TASK_TYPE: { taskType } */
export const scheduleByTaskTypeInputSchema = lazySchema(() =>
  z.strictObject({
    taskType: z.nativeEnum(TaskType),
  }),
)

/** EXECUTION_HISTORY: { scheduleId, page?, size? } */
export const scheduleExecutionHistoryInputSchema = lazySchema(() =>
  z.strictObject({
    scheduleId: z.number().int().positive('scheduleId is required'),
    page: z.number().int().nonnegative().optional(),
    size: z.number().int().positive().optional(),
  }),
)

/** EXECUTION_STATISTICS / DEPENDENCY_GRAPH / DEPENDENCY_VALIDATE: { scheduleId } */
export const scheduleByScheduleIdInputSchema = lazySchema(() =>
  z.strictObject({
    scheduleId: z.number().int().positive('scheduleId is required'),
  }),
)

/** EXECUTION_RECENT: { limit? } */
export const scheduleExecutionRecentInputSchema = lazySchema(() =>
  z.strictObject({
    limit: z.number().int().positive().optional(),
  }),
)

/** DEPENDENCY_ADD: { parentId, childId, ...dependencyData } */
export const scheduleDependencyAddInputSchema = lazySchema(() =>
  z
    .object({
      parentId: z.number().int().positive('parentId is required'),
      childId: z.number().int().positive('childId is required'),
    })
    .passthrough(),
)

/** DEPENDENCY_REMOVE: { parentId, childId } */
export const scheduleDependencyRemoveInputSchema = lazySchema(() =>
  z.strictObject({
    parentId: z.number().int().positive('parentId is required'),
    childId: z.number().int().positive('childId is required'),
  }),
)

/** SCHEDULER_STATUS / START / STOP / RELOAD + SCHEDULE_EXPORT: 无入参 */
export const scheduleNoInputSchema = noInputSchema

/** CRON_VALIDATE / CRON_NEXT_RUN_TIME: { expression } */
export const scheduleCronExpressionInputSchema = lazySchema(() =>
  z.strictObject({
    expression: z.string().min(1, 'cron expression is required'),
  }),
)

/** SCHEDULE_IMPORT: ScheduleImportRequest (passthrough) */
export const scheduleImportInputSchema = lazySchema(() =>
  z.object({}).passthrough(),
)
