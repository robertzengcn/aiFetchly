import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'

/**
 * 后端 AI chat API 响应 schema。
 *
 * Phase 5 先覆盖最关键的一个：BatchKeywordGenerationResponse。
 * 该响应被 ai-chat-ipc 的 AI_KEYWORDS_GENERATE 直接消费，数据进入前端
 * 关键词选择 UI；如果后端字段漂移，前端会拿到 undefined 数组。
 *
 * 设计：用 `z.object`（非 strict）让 parseAndStrip 能剥离后端未来加的字段，
 * 同时保留对核心字段的类型校验。
 */
export const keywordItemSchema = lazySchema(() =>
  z.object({
    category: z.string(),
    keyword: z.string(),
  }),
)

export const batchKeywordGenerationResponseSchema = lazySchema(() =>
  z.object({
    keywords: z.array(keywordItemSchema()),
    seed_keywords: z.array(z.string()),
    total_keywords: z.number().int().nonnegative(),
  }),
)

/**
 * OpenAI / chat completion 响应 schema（用于流式恢复解析）。
 *
 * OpenAI 标准结构：choices[].message.{role, content, tool_calls?}
 */
export const openAiChatCompletionResponseSchema = lazySchema(() =>
  z.object({
    id: z.string(),
    model: z.string().optional(),
    choices: z.array(
      z.object({
        index: z.number().int().nonnegative(),
        message: z.object({
          role: z.string(),
          content: z.string().nullable(),
        }),
        finish_reason: z.string().optional(),
      }),
    ),
  }),
)
