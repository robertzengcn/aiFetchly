import {
  PLATFORM_LIST,
  PLATFORM_DETAIL,
  PLATFORM_CREATE,
  PLATFORM_UPDATE,
  PLATFORM_DELETE,
  PLATFORM_VALIDATE,
  PLATFORM_STATISTICS,
  PLATFORM_TOGGLE,
} from '@/config/channellist'
import { PlatformRegistry } from '@/modules/PlatformRegistry'
import { PlatformConfig } from '@/modules/interface/IPlatformConfig'
import { registerValidatedHandler } from '@/main-process/communication/_shared/registerValidatedHandler'
import {
  platformNoInputSchema,
  platformByIdInputSchema,
  platformConfigInputSchema,
  platformUpdateInputSchema,
} from '@/schemas/ipc/platform'

/**
 * Platform IPC handlers — all 8 migrated to registerValidatedHandler.
 *
 * Envelope: handlers return data only; wrapper wraps. Returned shapes
 * preserve {records, num} for frontend list-style consumption.
 */
export function registerPlatformIpcHandlers() {
  const platformRegistry = new PlatformRegistry()

  registerValidatedHandler(
    PLATFORM_LIST,
    platformNoInputSchema,
    async () => {
      const platforms = platformRegistry.getAllPlatforms()
      return { records: [platforms], num: 1 }
    },
  )

  registerValidatedHandler(
    PLATFORM_DETAIL,
    platformByIdInputSchema,
    async (input) => {
      const platform = platformRegistry.getPlatformConfig(input.id)
      if (!platform) {
        throw new Error('Platform not found')
      }
      return { records: [platform], num: 1 }
    },
  )

  registerValidatedHandler(
    PLATFORM_CREATE,
    platformConfigInputSchema,
    async (input) => {
      const platformData = input as unknown as PlatformConfig
      await platformRegistry.registerPlatform(platformData)
      return { records: [platformData], num: 1 }
    },
  )

  registerValidatedHandler(
    PLATFORM_UPDATE,
    platformUpdateInputSchema,
    async (input) => {
      await platformRegistry.updatePlatformConfig(input.id, input.updates)
      return { records: [], num: 0 }
    },
  )

  registerValidatedHandler(
    PLATFORM_DELETE,
    platformByIdInputSchema,
    async (input) => {
      await platformRegistry.removePlatform(input.id)
      return { records: [], num: 0 }
    },
  )

  registerValidatedHandler(
    PLATFORM_VALIDATE,
    platformConfigInputSchema,
    async (input) => {
      const validation = platformRegistry.validatePlatformConfig(
        input as unknown as PlatformConfig,
      )
      return { records: [validation], num: 1 }
    },
  )

  registerValidatedHandler(
    PLATFORM_STATISTICS,
    platformNoInputSchema,
    async () => {
      const statistics = platformRegistry.getPlatformStatistics()
      return { records: [statistics], num: 1 }
    },
  )

  registerValidatedHandler(
    PLATFORM_TOGGLE,
    platformByIdInputSchema,
    async (input) => {
      const platform = platformRegistry.getPlatformConfig(input.id)
      if (!platform) {
        throw new Error('Platform not found')
      }
      await platformRegistry.updatePlatformConfig(input.id, {
        is_active: !platform.is_active,
      })
      return {
        records: [],
        num: 0,
        // Carry through the toggle action verb for frontend toast messages.
        action: platform.is_active ? 'deactivated' : 'activated',
      }
    },
  )
}
