import { ipcMain } from 'electron'
import { 
  PLATFORM_LIST, 
  PLATFORM_DETAIL, 
  PLATFORM_CREATE, 
  PLATFORM_UPDATE, 
  PLATFORM_DELETE, 
  PLATFORM_VALIDATE, 
  PLATFORM_STATISTICS, 
  PLATFORM_TOGGLE 
} from '@/config/channellist'
import { PlatformRegistry } from '@/modules/PlatformRegistry'
import { PlatformConfig } from '@/modules/interface/IPlatformConfig'
import { CommonResponse } from '@/entityTypes/commonType'

export function registerPlatformIpcHandlers() {
  const platformRegistry = new PlatformRegistry()

  // Get all platforms
  ipcMain.handle(PLATFORM_LIST, async (event, data) => {
    try {
      const platforms = platformRegistry.getAllPlatforms()
      const response: CommonResponse<PlatformConfig[]> = {
        status: true,
        msg: 'Platforms retrieved successfully',
        data: {
          records: [platforms],
          num: 1
        }
      }
      return response
    } catch (error) {
      console.error('Failed to get platforms:', error)
      const response: CommonResponse<PlatformConfig[]> = {
        status: false,
        msg: error instanceof Error ? error.message : 'Failed to get platforms',
        data: {
          records: [],
          num: 0
        }
      }
      return response
    }
  })

  // Get platform detail
  ipcMain.handle(PLATFORM_DETAIL, async (event, data) => {
    try {
      const qdata = JSON.parse(data)
      if (!('id' in qdata)) {
        return {
          status: false,
          msg: 'Platform ID is required',
          data: {
            records: [],
            num: 0
          }
        }
      }

      const platform = platformRegistry.getPlatformConfig(qdata.id)
      if (!platform) {
        return {
          status: false,
          msg: 'Platform not found',
          data: {
            records: [],
            num: 0
          }
        }
      }

      const response: CommonResponse<PlatformConfig> = {
        status: true,
        msg: 'Platform retrieved successfully',
        data: {
          records: [platform],
          num: 1
        }
      }
      return response
    } catch (error) {
      console.error('Failed to get platform detail:', error)
      const response: CommonResponse<PlatformConfig> = {
        status: false,
        msg: error instanceof Error ? error.message : 'Failed to get platform detail',
        data: {
          records: [],
          num: 0
        }
      }
      return response
    }
  })

  // Create new platform
  ipcMain.handle(PLATFORM_CREATE, async (event, data) => {
    try {
      const platformData: PlatformConfig = JSON.parse(data)
      await platformRegistry.registerPlatform(platformData)
      
      const response: CommonResponse<PlatformConfig> = {
        status: true,
        msg: 'Platform created successfully',
        data: {
          records: [platformData],
          num: 1
        }
      }
      return response
    } catch (error) {
      console.error('Failed to create platform:', error)
      const response: CommonResponse<PlatformConfig> = {
        status: false,
        msg: error instanceof Error ? error.message : 'Failed to create platform',
        data: {
          records: [],
          num: 0
        }
      }
      return response
    }
  })

  // Update platform
  ipcMain.handle(PLATFORM_UPDATE, async (event, data) => {
    try {
      const qdata = JSON.parse(data)
      if (!('id' in qdata) || !('updates' in qdata)) {
        return {
          status: false,
          msg: 'Platform ID and updates are required',
          data: {
            records: [],
            num: 0
          }
        }
      }

      await platformRegistry.updatePlatformConfig(qdata.id, qdata.updates)
      
      const response: CommonResponse<PlatformConfig> = {
        status: true,
        msg: 'Platform updated successfully',
        data: {
          records: [],
          num: 0
        }
      }
      return response
    } catch (error) {
      console.error('Failed to update platform:', error)
      const response: CommonResponse<PlatformConfig> = {
        status: false,
        msg: error instanceof Error ? error.message : 'Failed to update platform',
        data: {
          records: [],
          num: 0
        }
      }
      return response
    }
  })

  // Delete platform
  ipcMain.handle(PLATFORM_DELETE, async (event, data) => {
    try {
      const qdata = JSON.parse(data)
      if (!('id' in qdata)) {
        return {
          status: false,
          msg: 'Platform ID is required',
          data: null
        }
      }

      await platformRegistry.removePlatform(qdata.id)
      
      const response: CommonResponse<null> = {
        status: true,
        msg: 'Platform deleted successfully',
        data: {
          records: [],
          num: 0
        }
      }
      return response
    } catch (error) {
      console.error('Failed to delete platform:', error)
      const response: CommonResponse<null> = {
        status: false,
        msg: error instanceof Error ? error.message : 'Failed to delete platform',
        data: {
          records: [],
          num: 0
        }
      }
      return response
    }
  })

  // Validate platform configuration
  ipcMain.handle(PLATFORM_VALIDATE, async (event, data) => {
    try {
      const platformData: PlatformConfig = JSON.parse(data)
      const validation = platformRegistry.validatePlatformConfig(platformData)
      
      const response: CommonResponse<any> = {
        status: true,
        msg: 'Platform validation completed',
        data: {
          records: [validation],
          num: 1
        }
      }
      return response
    } catch (error) {
      console.error('Failed to validate platform:', error)
      const response: CommonResponse<any> = {
        status: false,
        msg: error instanceof Error ? error.message : 'Failed to validate platform',
        data: {
          records: [],
          num: 0
        }
      }
      return response
    }
  })

  // Get platform statistics
  ipcMain.handle(PLATFORM_STATISTICS, async (event, data) => {
    try {
      const statistics = platformRegistry.getPlatformStatistics()
      
      const response: CommonResponse<any> = {
        status: true,
        msg: 'Platform statistics retrieved successfully',
        data: {
          records: [statistics],
          num: 1
        }
      }
      return response
    } catch (error) {
      console.error('Failed to get platform statistics:', error)
      const response: CommonResponse<any> = {
        status: false,
        msg: error instanceof Error ? error.message : 'Failed to get platform statistics',
        data: {
          records: [],
          num: 0
        }
      }
      return response
    }
  })

  // Toggle platform active status
  ipcMain.handle(PLATFORM_TOGGLE, async (event, data) => {
    try {
      const qdata = JSON.parse(data)
      if (!('id' in qdata)) {
        return {
          status: false,
          msg: 'Platform ID is required',
          data: {
            records: [],
            num: 0
          }
        }
      }

      const platform = platformRegistry.getPlatformConfig(qdata.id)
      if (!platform) {
        return {
          status: false,
          msg: 'Platform not found',
          data: {
            records: [],
            num: 0
          }
        }
      }

      await platformRegistry.updatePlatformConfig(qdata.id, {
        is_active: !platform.is_active
      })
      
      const response: CommonResponse<PlatformConfig> = {
        status: true,
        msg: `Platform ${platform.is_active ? 'deactivated' : 'activated'} successfully`,
        data: {
          records: [],
          num: 0
        }
      }
      return response
    } catch (error) {
      console.error('Failed to toggle platform:', error)
      const response: CommonResponse<PlatformConfig> = {
        status: false,
        msg: error instanceof Error ? error.message : 'Failed to toggle platform',
        data: {
          records: [],
          num: 0
        }
      }
      return response
    }
  })
}

