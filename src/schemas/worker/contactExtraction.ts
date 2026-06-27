import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'

/**
 * Contact Extraction Worker 消息契约。
 *
 * 替代 src/main-process/communication/contactExtraction-ipc.ts 中
 * 原有的 `interface WorkerMessage { [key: string]: unknown }` 弱类型签名。
 *
 * 用 z.discriminatedUnion 让 TS 在 switch(msg.type) 各分支自动窄化字段类型，
 * 消除 `as any` / `as unknown` 强转。
 *
 * 此文件只产出 schema —— ipc 文件的实际改造在 Phase 3。
 */

// ─── Worker → Main (outbound) ────────────────────────────────────────────────

const contactExtractionUrlResultSchema = z.object({
  url: z.string(),
  success: z.boolean(),
  data: z
    .object({
      emails: z.array(z.string()).optional(),
      phones: z.array(z.string()).optional(),
      address: z.string().nullable().optional(),
      socialLinks: z.array(z.string()).nullable().optional(),
    })
    .optional(),
  error: z.string().optional(),
})

export const contactExtractionWorkerOutboundSchema = lazySchema(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('worker-ready'),
    }),
    z.object({
      type: z.literal('worker-log'),
      level: z.enum(['info', 'warn', 'error', 'debug']).default('info'),
      args: z.array(z.unknown()).default([]),
    }),
    z.object({
      type: z.literal('extraction-progress'),
      resultId: z.number().int().positive(),
      status: z.enum(['running', 'completed', 'failed']),
      progress: z.number().min(0).max(100).optional(),
      data: z.unknown().optional(),
    }),
    z.object({
      type: z.literal('extract-contact-url-result'),
      requestId: z.string(),
      results: z.array(contactExtractionUrlResultSchema),
    }),
  ]),
)

export type ContactExtractionWorkerOutbound = z.infer<
  ReturnType<typeof contactExtractionWorkerOutboundSchema>
>

// ─── Main → Worker (inbound) ────────────────────────────────────────────────

export const contactExtractionWorkerInboundSchema = lazySchema(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('extract-contact'),
      batchId: z.string(),
      resultIds: z.array(z.number().int().positive()),
    }),
    z.object({
      type: z.literal('extract-contact-from-urls'),
      requestId: z.string(),
      urls: z.array(z.string()),
    }),
    z.object({
      type: z.literal('shutdown'),
    }),
  ]),
)

export type ContactExtractionWorkerInbound = z.infer<
  ReturnType<typeof contactExtractionWorkerInboundSchema>
>
