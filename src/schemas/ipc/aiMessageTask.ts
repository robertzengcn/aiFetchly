import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'
import { byIdInputSchema, noInputSchema } from '@/schemas/ipc/_shared/common'

/** CREATE / UPDATE: 复杂请求类型，passthrough */
export const aiMessageTaskWriteInputSchema = lazySchema(() =>
  z.object({}).passthrough(),
)

/** DELETE / DETAIL / RUN_DETAIL: by id */
export const aiMessageTaskByIdInputSchema = byIdInputSchema

/** LIST: page + limit (1-based) */
export const aiMessageTaskListInputSchema = lazySchema(() =>
  z.strictObject({
    page: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
  }),
)

/** RUN_LIST: taskId + pagination */
export const aiMessageTaskRunListInputSchema = lazySchema(() =>
  z.strictObject({
    taskId: z.number().int().positive('taskId is required'),
    page: z.number().int().positive().optional(),
    limit: z.number().int().positive().optional(),
  }),
)

/** LIST_AVAILABLE_TOOLS: 无入参 */
export const aiMessageTaskListToolsInputSchema = noInputSchema
