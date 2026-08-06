import { shell } from "electron";

/**
 * Open an AI-created file on Windows (and WSL→Windows) with the default
 * associated application, passing the file path through correctly.
 *
 * History / why this module exists:
 * 1. `OpenAs_RunnableDLL` is not exported by shell32.dll → "missing entry" alert.
 * 2. `rundll32 shell32.dll,OpenAs_RunDLL` often shows a chooser but never
 *    launches the selected app from Electron.
 * 3. PowerShell `Start-Process -Verb OpenAs` can launch the chosen app
 *    without handing off the file, so the user has to pick the file again
 *    inside the app.
 *
 * Correct approach: Electron `shell.openPath`, which uses the OS default
 * file association and opens the file in that app.
 *
 * Keep this logic centralized so guard tests can ban the broken OpenAs /
 * rundll32 patterns across `src/`.
 */

export type OpenWindowsFileFn = (windowsPath: string) => Promise<string>;

/**
 * Open a Windows-native or UNC path with the default associated app.
 * Returns an empty string on success, or an error message on failure
 * (Electron `shell.openPath` contract).
 */
export async function openWindowsFile(
  windowsPath: string,
  openPathFn: OpenWindowsFileFn = (p) => shell.openPath(p)
): Promise<string> {
  return openPathFn(windowsPath);
}

/**
 * @deprecated Prefer {@link openWindowsFile}. Kept as a stable alias for
 * existing call sites / tests that still use the older name.
 */
export async function openWindowsOpenWithDialog(
  windowsPath: string,
  openPathFn?: OpenWindowsFileFn
): Promise<string> {
  return openWindowsFile(windowsPath, openPathFn);
}
