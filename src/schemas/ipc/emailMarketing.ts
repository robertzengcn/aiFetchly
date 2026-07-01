import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'
import { itemSearchParamSchema } from '@/schemas/ipc/_shared/pagination'

/** LIST handlers (TPL/FILTER/SERVICE): pagination */
export const emailMarketingListInputSchema = itemSearchParamSchema

/**
 * By-id handlers (REMOVE/DETAIL/DELETE).
 *
 * 原代码 CommonIdrequest<string>，handler 内 Number(qdata.id) 转换。
 * schema 接受 number 或字符串数字，handler 内统一转 number。
 */
export const emailMarketingByIdInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.union([z.number(), z.string().min(1)]),
  }),
)

/**
 * UPDATE handlers — 3 个不同 entity 的 update，统一用 passthrough。
 *
 * - TEMPUPDATE: EmailTemplateRespdata
 * - FILTERUPDATE / SERVICEUPDATE: 各自复杂结构
 * schema 只保证对象非空，透传给 controller 内部消费。
 */
export const emailMarketingUpdateInputSchema = lazySchema(() =>
  z.object({}).passthrough(),
)
