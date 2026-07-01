import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

/**
 * 后端 AI chat API 响应 schema。
 *
 * 覆盖最关键的几个：
 *  - BatchKeywordGenerationResponse: 关键词生成（已被 ai-chat-ipc 消费）
 *  - ChatApiResponse: 主聊天非流式响应
 *
 * 设计：用 `z.object`（非 strict）让 parseAndStrip 能剥离后端未来加的字段，
 * 同时保留对核心字段的类型校验。
 */
export const keywordItemSchema = lazySchema(() =>
  z.object({
    category: z.string(),
    keyword: z.string(),
  })
);

export const batchKeywordGenerationResponseSchema = lazySchema(() =>
  z.object({
    keywords: z.array(keywordItemSchema()),
    seed_keywords: z.array(z.string()),
    total_keywords: z.number().int().nonnegative(),
  })
);

/**
 * 主聊天响应（非流式）。对齐 src/entityTypes/commonType.ts 的 ChatApiResponse。
 *
 * 后端字段漂移会让前端拿到 undefined messageId/model 等核心字段。
 */
export const chatApiResponseSchema = lazySchema(() =>
  z.object({
    message: z.string(),
    conversationId: z.string(),
    messageId: z.string(),
    model: z.string(),
    tokensUsed: z.number().int().nonnegative().optional(),
  })
);

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
      })
    ),
  })
);
