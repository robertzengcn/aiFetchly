import { windowInvoke } from '@/views/utils/apirequest'
import { GET_APP_INFO } from "@/config/channellist"
import { AppInfo } from '@/modules/AppInfoModule'


export async function getAppInfo(): Promise<AppInfo> {
  const result = await windowInvoke(GET_APP_INFO)
  return result
}

export async function getAppName(): Promise<string> {
  const appInfo = await getAppInfo()
  // Format the app name from kebab-case to Title Case
  return appInfo.name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
} 