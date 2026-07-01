import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'

/**
 * IPC 入参 schema: SYSTEM_SETTING_UPDATE
 *
 * 替代原 handler 的 `JSON.parse(arg as string) as SetttingUpdate`。
 * id 必为正整数，value 允许 string 或 null（与 SetttingUpdate 类型一致）。
 */
export const systemSettingUpdateInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive(),
    value: z.string().nullable(),
  }),
)

export type SystemSettingUpdateInput = z.infer<
  ReturnType<typeof systemSettingUpdateInputSchema>
>
