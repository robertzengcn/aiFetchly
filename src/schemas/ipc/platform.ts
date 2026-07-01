import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'
import { noInputSchema } from '@/schemas/ipc/_shared/common'

/** LIST / STATISTICS: 无入参 */
export const platformNoInputSchema = noInputSchema

/**
 * DETAIL / DELETE / TOGGLE: by string id.
 *
 * Platform id 是 string（如 'facebook'），与多数 numeric id handler 不同，
 * 不复用 byIdInputSchema。
 */
export const platformByIdInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.string().min(1, 'Platform ID is required'),
  }),
)

/**
 * CREATE / VALIDATE: PlatformConfig 透传。
 *
 * PlatformConfig 是复杂接口，schema 不强校验内部字段（registry.validatePlatformConfig
 * 内部会做）。只要求传入是对象。
 */
export const platformConfigInputSchema = lazySchema(() =>
  z.object({}).passthrough(),
)

/** UPDATE: id + updates 对象 */
export const platformUpdateInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.string().min(1),
    updates: z.object({}).passthrough(),
  }),
)
