import { ipcMain, shell, BrowserWindow } from "electron";
import { log } from "@/modules/Logger";
import {
  APP_OPEN_WEBSITE,
  APP_GET_UPDATE_STATUS,
  APP_CHECK_FOR_UPDATES,
  APP_INSTALL_UPDATE,
  APP_UPDATE_STATUS_EVENT,
} from "@/config/channellist";
import { AIFETCHLY_WEBSITE_URL } from "@/config/appInfo";
import { CommonMessage } from "@/entityTypes/commonType";
import type { UpdateStatusSnapshot } from "@/main-process/updater/UpdateStatus";
import { getAppUpdateService } from "@/main-process/updater/createAppUpdateService";

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Build the status sink that pushes update transitions to the renderer.
 *
 * `getWin` resolves the CURRENT main window on each push. The window can be
 * destroyed and recreated during the process lifetime (macOS close → activate),
 * while handler registration runs exactly once, so the sink must NOT close over
 * a single BrowserWindow reference — it re-resolves every call and skips a
 * destroyed window. Exported so the lazy-resolution + isDestroyed guard can be
 * unit-tested without the AppUpdateService singleton.
 */
export function createWindowStatusSink(
  getWin: () => BrowserWindow | null
): (snapshot: UpdateStatusSnapshot) => void {
  return (snapshot) => {
    try {
      const win = getWin();
      if (win && !win.isDestroyed()) {
        win.webContents.send(APP_UPDATE_STATUS_EVENT, snapshot);
      }
    } catch (err) {
      log.error(
        `[auto-update] failed to push status event: ${describeError(err)}`
      );
    }
  };
}

/**
 * Register About-page IPC handlers and wire update-status push events.
 *
 * All four channels are no-input invoke handlers: the renderer cannot supply an
 * arbitrary URL or feed, so website-open is limited to the fixed allowlisted
 * constant (FR-3.3) and the feed repo is a main-process constant (FR-7.3).
 */
export function registerAboutIpcHandlers(
  getWin: () => BrowserWindow | null
): void {
  const service = getAppUpdateService();

  // Push every status transition to the renderer (FR-4.8: events, not polling).
  service.setStatusSink(createWindowStatusSink(getWin));

  ipcMain.handle(APP_OPEN_WEBSITE, async (): Promise<CommonMessage<null>> => {
    try {
      await shell.openExternal(AIFETCHLY_WEBSITE_URL);
      log.info(`[about] opened website: ${AIFETCHLY_WEBSITE_URL}`);
      return { status: true, msg: "ok", data: null };
    } catch (err) {
      log.error(`[about] failed to open website: ${describeError(err)}`);
      return { status: false, msg: "OPEN_WEBSITE_FAILED", data: null };
    }
  });

  ipcMain.handle(
    APP_GET_UPDATE_STATUS,
    (): CommonMessage<UpdateStatusSnapshot> => {
      return { status: true, msg: "ok", data: service.getStatus() };
    }
  );

  ipcMain.handle(
    APP_CHECK_FOR_UPDATES,
    async (): Promise<CommonMessage<UpdateStatusSnapshot>> => {
      const snapshot = await service.checkForUpdatesNow();
      return { status: true, msg: "ok", data: snapshot };
    }
  );

  ipcMain.handle(APP_INSTALL_UPDATE, (): CommonMessage<null> => {
    if (service.getStatus().state !== "ready-to-restart") {
      return { status: false, msg: "NO_UPDATE_READY", data: null };
    }
    service.quitAndInstall();
    return { status: true, msg: "ok", data: null };
  });

  log.info("[about] About/update IPC handlers registered");
}
