import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'

/**
 * socialaccount LIST 入参。
 *
 * 原代码 page 默认 10（应该是 0 的笔误，但保留原行为）、size 默认 10、search 默认 ""。
 * where 字段是平台名（前端传字符串），原代码 convertPlatform 转换为 platformId。
 */
export const socialAccountListInputSchema = lazySchema(() =>
  z.strictObject({
    page: z.number().int().nonnegative().optional(),
    size: z.number().int().positive().optional(),
    search: z.string().optional(),
    where: z.string().optional(),
  }),
)

/** DETAIL / DELETE: by id */
export const socialAccountByIdInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive('id is required'),
  }),
)

/** PLATFORM_LIST: pagination */
export const socialPlatformListInputSchema = lazySchema(() =>
  z.strictObject({
    page: z.number().int().nonnegative().optional(),
    size: z.number().int().positive().optional(),
  }),
)

/**
 * SAVE: SocialAccountDetailData（复杂类型，passthrough）。
 *
 * user 字段必填（原代码 implicitly 依赖），其他字段透传给 controller。
 */
export const socialAccountSaveInputSchema = lazySchema(() =>
  z
    .object({
      user: z.string().min(1, 'user is required'),
    })
    .passthrough(),
)
