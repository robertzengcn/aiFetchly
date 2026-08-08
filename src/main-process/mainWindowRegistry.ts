import type { BrowserWindow } from "electron";

let mainWindow: BrowserWindow | null = null;

/**
 * Register the app's primary BrowserWindow so main-process services
 * (e.g. DesktopNotifyService) can focus it or send renderer IPC.
 */
export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
