import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'

/**
 * IPC 入参 schema: ANALYZE_WEBSITE (batch website analysis)
 *
 * 替代 src/main-process/communication/search-result-ipc.ts 中
 * 原有的手写 `items && Array.isArray && length > 0` 等校验。
 *
 * 注意：原 handler 接受 string（JSON）或 object 两种形态。
 * 前端 src/views/api/* 现在直接传 object，schema 只描述反序列化后的结构。
 */
export const analyzeWebsiteBatchInputSchema = lazySchema(() =>
  z.strictObject({
    items: z
      .array(
        z.strictObject({
          resultId: z.number().int().positive(),
          url: z.string(),
        }),
      )
      .min(1, 'items array must not be empty'),
    clientBusiness: z.string().trim().min(1, 'clientBusiness is required'),
    temperature: z.number().optional(),
  }),
)

export type AnalyzeWebsiteBatchInput = z.infer<
  ReturnType<typeof analyzeWebsiteBatchInputSchema>
>
