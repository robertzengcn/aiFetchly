import { app, autoUpdater } from 'electron';
import { updateElectronApp } from 'update-electron-app';
import {
  AppUpdateService,
  type AppUpdateServiceDeps,
  type AutoUpdaterLike,
  type UpdateElectronAppLike,
} from './AppUpdateService';

let instance: AppUpdateService | null = null;

/**
 * Production singleton for AppUpdateService. Wires real Electron + update-electron-app
 * into the injectable deps so the service class itself stays Electron-free and testable.
 *
 * Callers:
 *  - `background.ts` calls `getAppUpdateService().initializeAppUpdates()` once on startup.
 *  - `about-ipc.ts` uses status / checkForUpdatesNow / quitAndInstall.
 */
export function getAppUpdateService(): AppUpdateService {
  if (instance) {
    return instance;
  }

  // `process.windowsStore` is set by Electron for Microsoft Store / MSIX builds
  // but is not in Node's process type.
  const isWindowsStore = Boolean(
    (process as unknown as { windowsStore?: unknown }).windowsStore,
  );

  const deps: AppUpdateServiceDeps = {
    isPackaged: () => app.isPackaged,
    platform: () => process.platform,
    isWindowsStore: () => isWindowsStore,
    getAppVersion: () => app.getVersion(),
    getAutoUpdater: () => autoUpdater as unknown as AutoUpdaterLike,
    getUpdateElectronApp: () =>
      updateElectronApp as unknown as UpdateElectronAppLike,
    now: () => Date.now(),
  };

  instance = new AppUpdateService(deps);
  return instance;
}
