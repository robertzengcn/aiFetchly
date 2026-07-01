import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'
import { noInputSchema } from '@/schemas/ipc/_shared/common'

/** AI_CHAT_RESUME_TOOL_AFTER_PERMISSION */
export const aiChatResumeToolInputSchema = lazySchema(() =>
  z.strictObject({
    toolId: z.string().min(1, 'toolId is required'),
    conversationId: z.string().optional(),
  }),
)

/**
 * AI_CHAT_MESSAGE — 主聊天接口。
 *
 * attachments/uploadedFiles 字段类型复杂，schema 不强校验，只要求 message 非空。
 */
export const aiChatMessageInputSchema = lazySchema(() =>
  z
    .strictObject({
      message: z.string().min(1, 'message is required'),
      conversationId: z.string().optional(),
      model: z.string().optional(),
      useRAG: z.boolean().optional(),
      ragLimit: z.number().int().positive().optional(),
    })
    .passthrough(), // 允许 uploadedFiles / attachments 等字段透传
)

/** AI_CHAT_HISTORY */
export const aiChatHistoryInputSchema = lazySchema(() =>
  z.strictObject({
    conversationId: z.string().min(1, 'Conversation ID is required'),
  }),
)

/** AI_CHAT_CLEAR — conversationId 可以是具体 ID 或 "all" */
export const aiChatClearInputSchema = lazySchema(() =>
  z.strictObject({
    conversationId: z.string().min(1, 'conversationId is required'),
  }),
)

/** AI_CHAT_CONVERSATIONS — 无入参 */
export const aiChatConversationsInputSchema = noInputSchema

/** AI_KEYWORDS_GENERATE */
export const aiChatKeywordsGenerateInputSchema = lazySchema(() =>
  z.strictObject({
    keywords: z.array(z.string()).min(1, 'Seed keywords are required'),
    num_keywords: z.number().int().positive().optional(),
    keyword_type: z.string().optional(),
  }),
)

/** SYSTEM_DEPENDENCY_PROMPT_RESPONSE */
export const aiChatSystemDependencyPromptInputSchema = lazySchema(() =>
  z.strictObject({
    toolId: z.string().min(1, 'toolId is required'),
    approved: z.boolean(),
  }),
)

/**
 * AI_FILE_OPEN — 文件路径。
 *
 * 安全约束（绝对路径 + 无 .. 路径穿越）在 handler 内额外校验，
 * 因为这些约束依赖运行平台规范，不适合放在 zod schema。
 */
export const aiChatFileOpenInputSchema = lazySchema(() =>
  z.strictObject({
    filePath: z.string().min(1, 'filePath is required'),
  }),
)
