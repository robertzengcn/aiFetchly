/**
 * AI Tool schemas — lazySchema 包装 + LLM function calling 入口。
 *
 * 现有 AI tool schema（ShellExecutionRequestSchema、bulkEmailTaskInputSchema）
 * 直接 export 出 z.object 实例，每次 import 都是新引用 → zodToJsonSchema 的
 * WeakMap 永远 miss。
 *
 * 本文件提供：
 *  1. lazySchema 包装版本（引用恒等 → WeakMap 缓存生效）
 *  2. getXXXToolForLLM() helper 输出 OpenAI function-calling 兼容的 envelope
 *
 * 命名约定：tool name 与 LLM function name 对齐（snake_case）。
 */

import { lazySchema } from '@/utils/lazySchema'
import { zodToJsonSchema } from '@/utils/zodToJsonSchema'
import { ShellExecutionRequestSchema } from '@/entityTypes/shellTypes'
import { bulkEmailTaskInputSchema as bulkEmailTaskInputSchemaRaw } from '@/entityTypes/emailMarketingAiTypes'

// ─── shell_execute ────────────────────────────────────────────────────────

export const shellExecuteInputSchema = lazySchema(() => ShellExecutionRequestSchema)

/**
 * OpenAI function-calling envelope for shell_execute tool.
 * Cache 命中是关键收益：每次 AI 调用会转换 60-250 次，缓存后稳定 1 次。
 */
export function getShellToolForLLM() {
  return {
    type: 'function' as const,
    function: {
      name: 'shell_execute',
      description: 'Execute a shell command locally and return stdout/stderr',
      parameters: zodToJsonSchema(shellExecuteInputSchema()),
    },
  }
}

// ─── bulk_email_task ──────────────────────────────────────────────────────

export const bulkEmailInputSchema = lazySchema(() => bulkEmailTaskInputSchemaRaw)

export function getBulkEmailToolForLLM() {
  return {
    type: 'function' as const,
    function: {
      name: 'bulk_email_task',
      description: 'Send bulk emails to extracted addresses via configured SMTP services',
      parameters: zodToJsonSchema(bulkEmailInputSchema()),
    },
  }
}
