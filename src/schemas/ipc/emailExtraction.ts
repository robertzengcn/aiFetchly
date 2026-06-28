import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'
import { itemSearchParamSchema } from '@/schemas/ipc/_shared/pagination'
import { byIdInputSchema } from '@/schemas/ipc/_shared/common'

/** LISTEMAILSEARCHTASK: pagination */
export const emailExtractionListInputSchema = itemSearchParamSchema

/** EMAILSEARCHTASKRESULT: { taskId, page, itemsPerPage, ... } */
export const emailExtractionTaskResultInputSchema = lazySchema(() =>
  z.strictObject({
    taskId: z.number().int().positive('taskId is required'),
    page: z.number().int().nonnegative().optional(),
    size: z.number().int().positive().optional(),
    sortBy: z.string().optional(),
    search: z.string().optional(),
  }),
)

/** ERROR_LOG_DOWNLOAD / GET / KILL / START: by id */
export const emailExtractionByIdInputSchema = byIdInputSchema

/**
 * UPDATEEMAILSEARCHTASK: id + EmailscFormdata (复杂类型，passthrough)。
 *
 * URL 校验保留在 handler 里（依赖 isValidUrl 工具）。
 */
export const emailExtractionUpdateInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive('Task ID is required'),
    data: z.object({}).passthrough(),
  }),
)

/** EMAILEXTRACTION_RESULT_EXPORT: taskId + format */
export const emailExtractionExportInputSchema = lazySchema(() =>
  z.strictObject({
    taskId: z.number().int().positive('Task ID is required'),
    format: z.enum(['json', 'csv']).optional(),
  }),
)
