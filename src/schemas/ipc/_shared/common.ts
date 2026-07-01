import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'

/**
 * 通用「按 id 操作」schema。
 *
 * 项目里大量 handler 接收 `{ id: number }` 形态的入参（DETAIL/DELETE/UPDATE 等）。
 * 统一定义，避免每个 schema 文件重复。
 */
export const byIdInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive('id is required'),
  }),
)

/**
 * 通用空入参 schema（handler 不消费 data 但仍走 wrapper 统一 envelope）。
 */
export const noInputSchema = lazySchema(() => z.unknown())
