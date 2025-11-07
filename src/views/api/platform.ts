import { windowInvoke } from '@/views/utils/apirequest'
import { PlatformConfig } from '@/modules/interface/IPlatformConfig'
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
import { CommonResponse } from '@/entityTypes/commonType'

export async function getPlatformList(): Promise<PlatformConfig[]> {
  const resp = await windowInvoke(PLATFORM_LIST, {})
  
  if (!resp || !resp.status) {
    throw new Error(resp?.msg || 'Failed to get platform list')
  }

  return resp.data as PlatformConfig[]
}

export async function getPlatformDetail(id: string): Promise<PlatformConfig> {
  const resp = await windowInvoke(PLATFORM_DETAIL, { id })
  
  if (!resp || !resp.status) {
    throw new Error(resp?.msg || 'Failed to get platform detail')
  }

  return resp.data as PlatformConfig
}

export async function createPlatform(platformData: PlatformConfig): Promise<PlatformConfig> {
  const resp = await windowInvoke(PLATFORM_CREATE, platformData)
  
  if (!resp || !resp.status) {
    throw new Error(resp?.msg || 'Failed to create platform')
  }

  return resp.data as PlatformConfig
}

export async function updatePlatform(id: string, updates: Partial<PlatformConfig>): Promise<void> {
  const resp = await windowInvoke(PLATFORM_UPDATE, { id, updates })
  
  if (!resp || !resp.status) {
    throw new Error(resp?.msg || 'Failed to update platform')
  }
}

export async function deletePlatform(id: string): Promise<void> {
  const resp = await windowInvoke(PLATFORM_DELETE, { id })
  
  if (!resp || !resp.status) {
    throw new Error(resp?.msg || 'Failed to delete platform')
  }
}

export async function validatePlatform(platformData: PlatformConfig): Promise<any> {
  const resp = await windowInvoke(PLATFORM_VALIDATE, platformData)
  
  if (!resp || !resp.status) {
    throw new Error(resp?.msg || 'Failed to validate platform')
  }

  return resp.data
}

export async function getPlatformStatistics(): Promise<any> {
  const resp = await windowInvoke(PLATFORM_STATISTICS, {})
  
  if (!resp || !resp.status) {
    throw new Error(resp?.msg || 'Failed to get platform statistics')
  }

  return resp.data
}

export async function togglePlatform(id: string): Promise<void> {
  const resp = await windowInvoke(PLATFORM_TOGGLE, { id })
  
  if (!resp || !resp.status) {
    throw new Error(resp?.msg || 'Failed to toggle platform')
  }
}

