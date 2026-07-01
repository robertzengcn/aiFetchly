import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'

/**
 * 共享 schema：maps 系列抓取工具的 IPC 入参。
 *
 * googleMaps 和 yandexMaps 的 5 个 handler 入参结构完全对称，统一在此定义。
 *
 * 注意：
 *  - SEARCH_START 的 max_results 由 handler 内 cap 到平台 hard cap
 *    （googleMaps 没硬上限，yandexMaps 有 YANDEX_MAPS_HARD_CAP）
 *  - HISTORY_LIST 的 limit/offset 仍由 handler 内 Math.min/Math.max 兜底
 *    （保持原行为；schema 只保证类型正确）
 *  - 所有 id/requestId 必填且为正数/非空字符串，schema 在边界拒绝
 */

export const mapsSearchStartInputSchema = lazySchema(() =>
  z.strictObject({
    query: z.string().min(1, 'query is required'),
    location: z.string().min(1, 'location is required'),
    max_results: z.number().int().positive().optional(),
    include_website: z.boolean().optional(),
    include_reviews: z.boolean().optional(),
    show_browser: z.boolean().optional(),
    // yandex-only fields:
    language: z.string().optional(),
    region: z.string().optional(),
    // 可选附加：
    account_id: z.number().int().positive().optional(),
    proxy_ids: z.array(z.number().int().positive()).optional(),
  }),
)

export const mapsSearchCancelInputSchema = lazySchema(() =>
  z.strictObject({
    requestId: z.string().min(1, 'requestId is required'),
  }),
)

export const mapsHistoryListInputSchema = lazySchema(() =>
  z.strictObject({
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
  }),
)

export const mapsHistoryByIdInputSchema = lazySchema(() =>
  z.strictObject({
    id: z.number().int().positive('id is required'),
  }),
)
