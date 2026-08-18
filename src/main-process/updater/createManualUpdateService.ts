import { app, autoUpdater } from "electron";
import {
  ManualUpdateService,
  type ManualUpdateServiceDeps,
  type AutoUpdaterLike,
} from "./ManualUpdateService";

let instance: ManualUpdateService | null = null;

/**
 * Production singleton for ManualUpdateService. Wires real Electron into the
 * injectable deps so the service class itself stays Electron-free and testable.
 *
 * The update FEED is configured separately by `initializeAppUpdates()` in
 * AppUpdateService.ts; this service only observes autoUpdater events and exposes
 * manual check / status / install for the About page.
 *
 * Callers:
 *  - `about-ipc.ts` uses status / checkForUpdatesNow / quitAndInstall / setStatusSink.
 */
export function getManualUpdateService(): ManualUpdateService {
  if (instance) {
    return instance;
  }

  // `process.windowsStore` is set by Electron for Microsoft Store / MSIX builds
  // but is not in Node's process type.
  const isWindowsStore = Boolean(
    (process as unknown as { windowsStore?: unknown }).windowsStore,
  );

  const deps: ManualUpdateServiceDeps = {
    isPackaged: () => app.isPackaged,
    platform: () => process.platform,
    isWindowsStore: () => isWindowsStore,
    getAppVersion: () => app.getVersion(),
    getAutoUpdater: () => autoUpdater as unknown as AutoUpdaterLike,
    now: () => Date.now(),
    watchdogMs: 60_000,
  };

  instance = new ManualUpdateService(deps);
  // Eagerly subscribe to autoUpdater events so periodic checks (driven by the
  // feed in AppUpdateService.initializeAppUpdates) are reflected in status,
  // not only manual clicks from the About page.
  instance.start();
  return instance;
}
