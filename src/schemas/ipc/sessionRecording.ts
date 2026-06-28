import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'

/** TOGGLE: 单 boolean */
export const sessionRecordingToggleInputSchema = lazySchema(() =>
  z.strictObject({
    enabled: z.boolean(),
  }),
)

/**
 * EXPORT: format + 布尔选项。
 *
 * 注意原代码用 `any`，违反项目 no-any 规则。本 schema 把已知字段类型化，
 * 其他字段（未来扩展）通过 passthrough 透传。
 */
export const sessionRecordingExportInputSchema = lazySchema(() =>
  z
    .object({
      format: z.enum(['json', 'csv', 'openai']).optional(),
      includeStates: z.boolean().optional(),
      includeExpectedOutput: z.boolean().optional(),
    })
    .passthrough(),
)

/** CLEAR: daysOld + maxSessions，都有兜底默认值 */
export const sessionRecordingClearInputSchema = lazySchema(() =>
  z
    .object({
      daysOld: z.number().int().positive().optional(),
      maxSessions: z.number().int().positive().optional(),
    })
    .passthrough(),
)
