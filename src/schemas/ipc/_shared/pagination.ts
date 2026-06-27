import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'
import { semanticNumber } from '@/utils/semanticNumber'

/**
 * 共享分页查询 schema。
 *
 * 项目里多处 handler 接收 ItemSearchparam 形式的入参（page/size/sortby/where/search），
 * 并在原代码里用 `Object.prototype.hasOwnProperty.call(qdata, 'page')` 兜底默认值。
 * 这里用 zod 的 .default() 替代那种样板。
 *
 * 兼容点：
 *  - page/size 使用 semanticNumber：兼容前端传字符串数字
 *  - sortby 是自由形式（key/order 都是 string），不做枚举限制以避免破坏现有调用
 */
export const sortBySchema = lazySchema(() =>
  z.strictObject({
    key: z.string(),
    order: z.string(),
  }),
)

export const itemSearchParamSchema = lazySchema(() =>
  z.strictObject({
    page: semanticNumber(z.number().int().nonnegative()).default(0),
    size: semanticNumber(z.number().int().positive()).default(100),
    where: z.string().optional(),
    search: z.string().optional(),
    sortby: sortBySchema().optional(),
  }),
)
