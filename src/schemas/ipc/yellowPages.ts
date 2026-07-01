import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'
import { noInputSchema } from '@/schemas/ipc/_shared/common'

/**
 * Yellow Pages 系列 IPC 入参 schema。
 *
 * 8 个 by-id task ops 共享 taskByIdInputSchema：
 * DELETE/START/STOP/PAUSE/RESUME/DETAIL/PROGRESS
 */

/** Task by id (DELETE/START/STOP/PAUSE/RESUME/DETAIL/PROGRESS) */
export const yellowPagesTaskByIdInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive('id is required'),
  }),
)

/** CREATE: YellowPagesTaskData (passthrough) */
export const yellowPagesTaskCreateInputSchema = lazySchema(() =>
  z.object({}).passthrough(),
)

/** UPDATE: { id, ...Partial<YellowPagesTask> } */
export const yellowPagesTaskUpdateInputSchema = lazySchema(() =>
  z.object({
    id: z.number().int().positive('id is required'),
  }).passthrough(),
)

/** KILL_PROCESS / get_process_status: { pid } */
export const yellowPagesByPidInputSchema = lazySchema(() =>
  z.strictObject({
    pid: z.number().int().positive('pid is required'),
  }),
)

/** LIST: TaskFilters (optional, passthrough) */
export const yellowPagesListInputSchema = lazySchema(() =>
  z.object({}).passthrough(),
)

/** RESULTS: { id, page?, size? } */
export const yellowPagesResultsInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive('id is required'),
    page: z.number().int().nonnegative().optional(),
    size: z.number().int().positive().optional(),
  }),
)

/** EXPORT: { id, format? } */
export const yellowPagesExportInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive('id is required'),
    format: z.enum(['json', 'csv']).optional(),
  }),
)

/** BULK: { operation, taskIds } */
export const yellowPagesBulkInputSchema = lazySchema(() =>
  z.strictObject({
    operation: z.enum(['start', 'stop', 'pause', 'delete']),
    taskIds: z.array(z.number().int().positive()),
  }),
)

/** HEALTH / PLATFORMS / STATISTICS / CHECK_ORPHANED / previous_session: no input */
export const yellowPagesNoInputSchema = noInputSchema
