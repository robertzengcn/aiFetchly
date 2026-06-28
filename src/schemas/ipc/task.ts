import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'
import { byIdInputSchema, noInputSchema } from '@/schemas/ipc/_shared/common'

/** task:create / task:update — 复杂 TaskCreateRequest/TaskUpdateRequest，passthrough */
export const taskWriteInputSchema = lazySchema(() =>
  z.object({}).passthrough(),
)

/** task:delete / task:detail / task:run / task:cancel — by id */
export const taskByIdInputSchema = byIdInputSchema

/** task:list — pagination with optional search */
export const taskListInputSchema = lazySchema(() =>
  z.strictObject({
    page: z.number().int().nonnegative(),
    size: z.number().int().positive(),
    search: z.string().optional(),
  }),
)

/** task:results — id + pagination */
export const taskResultsInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive('id is required'),
    page: z.number().int().nonnegative(),
    size: z.number().int().positive(),
  }),
)

/** platform:list — no input */
export const taskPlatformListInputSchema = noInputSchema
