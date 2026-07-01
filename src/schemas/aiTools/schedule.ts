/**
 * Schedule AI Tools — lazySchema 包装 + LLM function calling 入口。
 *
 * scheduleAiToolTypes.ts 里的 9 个 schema 都是裸 `z.object`，每次 import 都产生
 * 新引用 → zodToJsonSchema 的 WeakMap 永远 miss。
 *
 * 本文件提供：
 *  1. lazySchema 包装版本（引用恒等 → WeakMap 缓存生效）
 *  2. getScheduleToolsForLLM() 输出 9 个 tool 的 OpenAI function-calling envelope
 *
 * 不修改 scheduleAiToolTypes.ts，保留所有现有调用点。
 */

import { lazySchema } from '@/utils/lazySchema'
import { zodToJsonSchema } from '@/utils/zodToJsonSchema'
import {
  listSchedulesSchema,
  getScheduleDetailsSchema,
  listScheduleExecutionsSchema,
  createScheduleSchema,
  updateScheduleSchema,
  deleteScheduleSchema,
  pauseScheduleSchema,
  resumeScheduleSchema,
  runScheduleNowSchema,
} from '@/entityTypes/scheduleAiToolTypes'

// ─── lazySchema wrappers (reference-stable for WeakMap caching) ────────────

export const listSchedulesInputSchema = lazySchema(() => listSchedulesSchema)
export const getScheduleDetailsInputSchema = lazySchema(() => getScheduleDetailsSchema)
export const listScheduleExecutionsInputSchema = lazySchema(() => listScheduleExecutionsSchema)
export const createScheduleInputSchema = lazySchema(() => createScheduleSchema)
export const updateScheduleInputSchema = lazySchema(() => updateScheduleSchema)
export const deleteScheduleInputSchema = lazySchema(() => deleteScheduleSchema)
export const pauseScheduleInputSchema = lazySchema(() => pauseScheduleSchema)
export const resumeScheduleInputSchema = lazySchema(() => resumeScheduleSchema)
export const runScheduleNowInputSchema = lazySchema(() => runScheduleNowSchema)

type LLMTool = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: ReturnType<typeof zodToJsonSchema>
  }
}

/**
 * 9 个 schedule tool 的 OpenAI function-calling envelope 数组。
 *
 * 缓存命中是关键收益：每次 AI 调用会转换数十到数百次，缓存后稳定为 9 次
 * 转换 + N 次 WeakMap 查询。
 */
export function getScheduleToolsForLLM(): LLMTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'schedule_list',
        description: 'List scheduled tasks with pagination and optional sort',
        parameters: zodToJsonSchema(listSchedulesInputSchema()),
      },
    },
    {
      type: 'function',
      function: {
        name: 'schedule_get_details',
        description: 'Get detailed information about a specific schedule by ID',
        parameters: zodToJsonSchema(getScheduleDetailsInputSchema()),
      },
    },
    {
      type: 'function',
      function: {
        name: 'schedule_list_executions',
        description: 'List execution history for a specific schedule',
        parameters: zodToJsonSchema(listScheduleExecutionsInputSchema()),
      },
    },
    {
      type: 'function',
      function: {
        name: 'schedule_create',
        description: 'Create a new scheduled task with cron expression',
        parameters: zodToJsonSchema(createScheduleInputSchema()),
      },
    },
    {
      type: 'function',
      function: {
        name: 'schedule_update',
        description: 'Update an existing scheduled task',
        parameters: zodToJsonSchema(updateScheduleInputSchema()),
      },
    },
    {
      type: 'function',
      function: {
        name: 'schedule_delete',
        description: 'Delete a scheduled task by ID',
        parameters: zodToJsonSchema(deleteScheduleInputSchema()),
      },
    },
    {
      type: 'function',
      function: {
        name: 'schedule_pause',
        description: 'Pause an active scheduled task',
        parameters: zodToJsonSchema(pauseScheduleInputSchema()),
      },
    },
    {
      type: 'function',
      function: {
        name: 'schedule_resume',
        description: 'Resume a paused scheduled task',
        parameters: zodToJsonSchema(resumeScheduleInputSchema()),
      },
    },
    {
      type: 'function',
      function: {
        name: 'schedule_run_now',
        description: 'Trigger an immediate execution of a scheduled task',
        parameters: zodToJsonSchema(runScheduleNowInputSchema()),
      },
    },
  ]
}
