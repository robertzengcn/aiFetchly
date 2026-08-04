import { z } from 'zod'
import { lazySchema } from '@/utils/lazySchema'
import { noInputSchema } from '@/schemas/ipc/_shared/common'

export interface SkillToggleInput {
  skillName: string
  enabled: boolean
}

/** 5 个 permission 类 handler 共享：CHECK/GRANT/DENY/REVOKE/GET_STATUS */
export const skillByNameInputSchema = lazySchema(() =>
  z.strictObject({
    skillName: z.string().min(1, 'skillName is required').max(256),
  }),
)

/** GRANT_PERMISSION: skillName + persistent */
export const skillGrantPermissionInputSchema = lazySchema(() =>
  z.strictObject({
    skillName: z.string().min(1, 'skillName is required').max(256),
    persistent: z.boolean(),
  }),
)

/**
 * TOGGLE: skillName + enabled.
 * Accept legacy `enable` from older renderer builds.
 */
export const skillToggleInputSchema = lazySchema(
  (): z.ZodType<SkillToggleInput, z.ZodTypeDef, unknown> =>
    z.preprocess((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value
      }

      const input = value as Record<string, unknown>
      const normalized: Record<string, unknown> = {}
      for (const [key, fieldValue] of Object.entries(input)) {
        if (key !== 'enable') normalized[key] = fieldValue
      }
      if (!('enabled' in normalized) && 'enable' in input) {
        normalized.enabled = input.enable
      }
      return normalized
    }, z.strictObject({
      skillName: z.string().min(1, 'skillName is required').max(256),
      enabled: z.boolean(),
    })),
)

/** IMPORT: zipPath（允许较长路径） */
export const skillImportInputSchema = lazySchema(() =>
  z.strictObject({
    zipPath: z.string().min(1, 'zipPath is required').max(4096),
  }),
)

/** LIST_INSTALLED: 无入参 */
export const skillListInstalledInputSchema = noInputSchema
