import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'
import { itemSearchParamSchema } from '@/schemas/ipc/_shared/pagination'
import { byIdInputSchema } from '@/schemas/ipc/_shared/common'

/** LISTSESARCHRESUT: 复用 pagination */
export const searchListInputSchema = itemSearchParamSchema

/** SAVESEARCHERRORLOG / GET_SEARCH_TASK_DETAILS / etc: by id */
export const searchByIdInputSchema = byIdInputSchema

/** TASKSEARCHRESULTLIST: 单任务结果分页 */
export const searchTaskResultListInputSchema = lazySchema(() =>
  z.strictObject({
    taskId: z.number().int().positive('taskId is required'),
    page: z.number().int().nonnegative().optional(),
    itemsPerPage: z.number().int().positive().optional(),
    sortBy: z.string().optional(),
    search: z.string().optional(),
  }),
)

/**
 * UPDATE_SEARCH_TASK: id + updates 对象。
 * updates 类型 SearchTaskUpdateData 较复杂，schema 用 passthrough。
 */
export const searchUpdateTaskInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive('Task ID is required'),
    updates: z.object({}).passthrough(),
  }),
)

/**
 * CREATE_SEARCH_TASK_ONLY: Usersearchdata。
 *
 * searchEnginer / keywords 必填。其他字段（proxys、accounts、cookies、enableAIRecovery）
 * 透传给 controller。原 handler 把字符串数字（concurrency/num_pages）转成数字，
 * 改用 handler 内 fallback。
 */
export const searchCreateTaskOnlyInputSchema = lazySchema(() =>
  z
    .object({
      searchEnginer: z.string().min(1, 'Search engine is required'),
      keywords: z.array(z.string()).min(1, 'Keywords are required'),
      concurrency: z.union([z.number(), z.string()]).optional(),
      num_pages: z.union([z.number(), z.string()]).optional(),
      notShowBrowser: z.boolean().optional(),
      localBrowser: z.string().optional(),
      proxys: z.array(z.unknown()).optional(),
      accounts: z.array(z.number()).optional(),
      proxyIds: z.array(z.number().int().positive()).optional(),
      enableAIRecovery: z.boolean().optional(),
    })
    .passthrough(),
)

/** EXPORT_SEARCH_RESULTS: taskId + format enum */
export const searchExportInputSchema = lazySchema(() =>
  z.strictObject({
    taskId: z.number().int().positive('Task ID is required'),
    format: z.enum(['json', 'csv']).optional(),
  }),
)

/** KILL_SEARCH_PROCESS: pid 或 taskId 至少一个 */
export const searchKillProcessInputSchema = lazySchema(() =>
  z
    .object({
      pid: z.number().int().positive().optional(),
      taskId: z.number().int().positive().optional(),
    })
    .refine((d) => d.pid != null || d.taskId != null, {
      message: 'Either PID or taskId is required',
    }),
)
