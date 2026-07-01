import { describe, it, expect } from 'vitest'
import {
  getScheduleToolsForLLM,
  listSchedulesInputSchema,
  createScheduleInputSchema,
} from '@/schemas/aiTools/schedule'
import type { JsonSchema7Type } from '@/utils/zodToJsonSchema'

describe('Schedule AI tools → LLM function calling', () => {
  describe('getScheduleToolsForLLM', () => {
    it('returns 9 tool envelopes', () => {
      const tools = getScheduleToolsForLLM()
      expect(tools).toHaveLength(9)
      for (const t of tools) {
        expect(t.type).toBe('function')
        expect(typeof t.function.name).toBe('string')
        expect(typeof t.function.description).toBe('string')
        expect(t.function.parameters).toBeDefined()
      }
    })

    it('exposes expected tool names', () => {
      const names = getScheduleToolsForLLM().map((t) => t.function.name)
      expect(names).toContain('schedule_list')
      expect(names).toContain('schedule_create')
      expect(names).toContain('schedule_update')
      expect(names).toContain('schedule_delete')
      expect(names).toContain('schedule_pause')
      expect(names).toContain('schedule_resume')
      expect(names).toContain('schedule_run_now')
      expect(names).toContain('schedule_get_details')
      expect(names).toContain('schedule_list_executions')
    })

    it('emits JSON Schema with required fields for schedule_create', () => {
      const create = getScheduleToolsForLLM().find(
        (t) => t.function.name === 'schedule_create',
      )!
      const params = create.function.parameters as JsonSchema7Type
      expect(params.type).toBe('object')
      expect(params.properties).toHaveProperty('name')
      expect(params.properties).toHaveProperty('task_type')
      expect(params.properties).toHaveProperty('cron_expression')
    })

    it('caches JSON Schema via WeakMap (referential equality)', () => {
      // Two calls should return the same parameters object per tool because
      // lazySchema + zodToJsonSchema cache by WeakMap.
      const first = getScheduleToolsForLLM()
      const second = getScheduleToolsForLLM()
      first.forEach((t1, i) => {
        expect(t1.function.parameters).toBe(second[i].function.parameters)
      })
    })
  })

  describe('lazySchema wrappers', () => {
    it('listSchedulesInputSchema returns same reference on repeat call', () => {
      expect(listSchedulesInputSchema()).toBe(listSchedulesInputSchema())
    })

    it('createScheduleInputSchema returns same reference on repeat call', () => {
      expect(createScheduleInputSchema()).toBe(createScheduleInputSchema())
    })
  })
})
