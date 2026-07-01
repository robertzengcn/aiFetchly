import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'

/**
 * Agent Runtime 系列 IPC 入参 schema。
 *
 * - DETAIL / TRANSCRIPT 共享 agentTaskIdSchema
 * - LIST 无入参（handler 内不消费 data）
 * - RESUME_TOOL_AFTER_PERMISSION 原代码忽略 data，但 wrapper 要求 schema，
 *   用 z.unknown() 接受任意值并立即丢弃
 */
export const agentTaskIdInputSchema = lazySchema(() =>
  z.strictObject({
    agentTaskId: z.string().min(1, 'agentTaskId is required'),
  }),
)

export const agentResumeToolInputSchema = lazySchema(() =>
  // 原代码完全忽略 data；保持宽松接受
  z.unknown(),
)
