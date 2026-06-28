import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'

/**
 * 共享分页查询 schema。
 *
 * 项目里多处 handler 接收 ItemSearchparam 形式的入参（page/size/sortby/where/search）。
 *
 * 设计选择：page/size 用 .optional()，由 handler 内 fallback 提供默认值。
 *  - 不用 .default()：zod v3 在 strictObject 内把 .default() 的 OUTPUT 推成
 *    `number | undefined`，破坏 registerValidatedHandler 的 TInput 推导
 *  - 不用 semanticNumber：JSON.parse 后类型已经是 number；wrapper 类型推导也更干净
 *  - 保留原 "缺失字段 → handler 补默认" 的行为，前端零改动
 *
 * handler 模板：
 *   const page = input.page ?? 0;
 *   const size = input.size ?? 100;
 */
export const sortBySchema = lazySchema(() =>
  z.strictObject({
    key: z.string(),
    order: z.string(),
  }),
)

export const itemSearchParamSchema = lazySchema(() =>
  z.strictObject({
    page: z.number().int().nonnegative().optional(),
    size: z.number().int().positive().optional(),
    where: z.string().optional(),
    search: z.string().optional(),
    sortby: sortBySchema().optional(),
  }),
)
