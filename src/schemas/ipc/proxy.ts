import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'
import { itemSearchParamSchema } from '@/schemas/ipc/_shared/pagination'

/** LIST: 复用 pagination */
export const proxyListInputSchema = itemSearchParamSchema

/** DETAIL / DELETE: by id */
export const proxyByIdInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive('id is required'),
  }),
)

/** SAVE: ProxyParseItem 透传，强制 host/port 必填 */
export const proxySaveInputSchema = lazySchema(() =>
  z
    .object({
      host: z.string().min(1, 'host is required'),
      port: z.string().min(1, 'port is required'),
      user: z.string().optional(),
      pass: z.string().optional(),
      protocol: z.string().optional(),
      status: z.number().optional(),
      timeout: z.number().optional(),
    })
    .passthrough(),
)

/** CHECK: 单个 ProxyParseItem + timeout 透传 */
export const proxyCheckInputSchema = proxySaveInputSchema

/** IMPORT: ProxyParseItem 数组 */
export const proxyImportInputSchema = lazySchema(() =>
  z.array(
    z
      .object({
        host: z.string().min(1),
        port: z.string().min(1),
      })
      .passthrough(),
  ),
)
