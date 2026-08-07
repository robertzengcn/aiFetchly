import {
  windowInvoke,
  windowReceive,
  windowRemoveListener,
  windowRemoveAllListeners,
} from "@/views/utils/apirequest";
import {
  GET_APP_INFO,
  APP_OPEN_WEBSITE,
  APP_GET_UPDATE_STATUS,
  APP_CHECK_FOR_UPDATES,
  APP_INSTALL_UPDATE,
  APP_UPDATE_STATUS_EVENT,
} from "@/config/channellist";
import type { AppInfo } from "@/entityTypes/appInfo-type";
import type { UpdateStatusSnapshot } from "@/entityTypes/updateStatus-type";

export async function getAppInfo(): Promise<AppInfo> {
  const result = await windowInvoke(GET_APP_INFO);
  return result;
}

export async function getAppName(): Promise<string> {
  const appInfo = await getAppInfo();
  // Format the app name from kebab-case to Title Case
  return appInfo.name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Open the official website in the system browser (main-process shell.openExternal). */
export async function openWebsite(): Promise<void> {
  await windowInvoke(APP_OPEN_WEBSITE);
}

/** Fetch a snapshot of the current update status (idle / checking / up-to-date / ...). */
export async function getUpdateStatus(): Promise<UpdateStatusSnapshot> {
  return await windowInvoke(APP_GET_UPDATE_STATUS);
}

/** Trigger a manual GitHub update check (cooldown + concurrency guarded in main). */
export async function checkForUpdates(): Promise<UpdateStatusSnapshot> {
  return await windowInvoke(APP_CHECK_FOR_UPDATES);
}

/** Quit and install a downloaded update; no-op on the main side unless ready. */
export async function installUpdate(): Promise<void> {
  await windowInvoke(APP_INSTALL_UPDATE);
}

export type UpdateStatusListener = (snapshot: UpdateStatusSnapshot) => void;

/**
 * Subscribe to pushed update-status transitions. Returns the listener handle
 * that must be passed to `offUpdateStatus` to unsubscribe.
 */
export function onUpdateStatus(cb: UpdateStatusListener): UpdateStatusListener {
  return windowReceive<UpdateStatusSnapshot>(APP_UPDATE_STATUS_EVENT, cb);
}

/** Unsubscribe a listener previously returned by `onUpdateStatus`. */
export function offUpdateStatus(listener: UpdateStatusListener): void {
  // The listener is the exact handle produced by windowReceive; bridge the
  // contravariant param type (snapshot vs unknown) for the remove API.
  windowRemoveListener(
    APP_UPDATE_STATUS_EVENT,
    listener as unknown as (value: unknown) => void
  );
}

/** Remove every update-status listener attached to this channel. */
export function removeAllUpdateStatusListeners(): void {
  windowRemoveAllListeners(APP_UPDATE_STATUS_EVENT);
}
