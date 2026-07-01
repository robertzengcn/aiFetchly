import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'
import { itemSearchParamSchema } from '@/schemas/ipc/_shared/pagination'

/** LIST: 分页查询，复用 itemSearchParamSchema */
export const emailTemplateListInputSchema = itemSearchParamSchema

/** DETAIL / DELETE: 按 id */
export const emailTemplateByIdInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive('Template ID is required'),
  }),
)

/** BY_TASK: 按 buckemailTaskId 查询关联模板 */
export const emailTemplateByTaskInputSchema = lazySchema(() =>
  z.strictObject({
    buckemailTaskId: z.number().int().positive('Buckemail task ID is required'),
  }),
)

/**
 * CREATE: 新建模板。
 *
 * 注意：原 handler 只校验 title/content 非空，其他字段透传给 module.create。
 * 用 z.object().passthrough() 允许其他字段（如 category、variables 等），
 * 避免在 schema 里重复 EmailTemplateEntity 的所有字段。
 */
export const emailTemplateCreateInputSchema = lazySchema(() =>
  z
    .object({
      title: z.string().min(1, 'title is required'),
      content: z.string().min(1, 'content is required'),
    })
    .passthrough(),
)

/**
 * UPDATE: id + 可变字段。
 *
 * 同样用 passthrough 让 EmailTemplateEntity 的其他字段透传给 module.update。
 */
export const emailTemplateUpdateInputSchema = lazySchema(() =>
  z
    .object({
      id: z.number().int().positive('Template ID is required'),
      title: z.string().min(1, 'title is required'),
      content: z.string().min(1, 'content is required'),
    })
    .passthrough(),
)
