import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'

/**
 * SearchResultEntity 写入边界 schema。
 *
 * 对齐 src/entity/SearchResult.entity.ts 的 @Column 列。
 * 抓取流水线 / AI 分析结果都可能注入未知字段（如 debugSource、htmlSnippet），
 * 落库前用此 schema 通过 parseAndStrip 过滤。
 *
 * 联系信息字段（contactInfo）由 ContactInfoEntity 独立 schema 守卫，此处不重复。
 */
export const searchResultWriteSchema = lazySchema(() =>
  z.object({
    task_id: z.number().int().nonnegative(),
    keyword_id: z.number().int().nonnegative().optional(),
    title: z.string().nullable().optional(),
    link: z.string().nullable().optional(),
    snippet: z.string().nullable().optional(),
    domain: z.string().nullable().optional(),
    record_time: z.string().nullable().optional(),
    ai_industry: z.string().nullable().optional(),
    ai_match_score: z.number().int().min(0).max(100).nullable().optional(),
    ai_reasoning: z.string().nullable().optional(),
    ai_client_business: z.string().nullable().optional(),
    ai_analysis_time: z.string().nullable().optional(),
    ai_analysis_status: z
      .enum(['pending', 'analyzing', 'completed', 'failed'])
      .nullable()
      .optional(),
  }),
)
