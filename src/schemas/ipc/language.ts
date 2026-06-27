import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'

/**
 * 项目支持的 6 种语言。与 src/views/lang/ 目录一一对应。
 * 新增语言时同步更新此数组。
 */
export const SUPPORTED_LANGUAGES = ['en', 'zh', 'es', 'fr', 'de', 'ja'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

/**
 * IPC 入参 schema: language:preference:update
 *
 * 前端原本传 `JSON.stringify({ language: 'en' })`，由 handler 内部 JSON.parse。
 * wrapper 改造后，前端可直接传对象，也可继续传 JSON 字符串（preload 层兼容）。
 * 此 schema 只描述反序列化后的对象结构。
 */
export const updateLanguageInputSchema = lazySchema(() =>
  z.strictObject({
    language: z.enum(SUPPORTED_LANGUAGES),
  }),
)

export type UpdateLanguageInput = z.infer<ReturnType<typeof updateLanguageInputSchema>>
