import { shell } from "electron";
import { spawn, type ChildProcess, type SpawnOptions } from "child_process";

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
 * Correct approach on native Windows: Electron `shell.openPath`, which uses
 * the OS default file association and opens the file in that app. Under WSL,
 * launch the Windows FileProtocolHandler because Linux shell.openPath can
 * remain pending indefinitely.
 *
 * Keep this logic centralized so guard tests can ban the broken OpenAs /
 * rundll32 patterns across `src/`.
 */

export type OpenWindowsFileFn = (windowsPath: string) => Promise<string>;

export type DetachedSpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

/**
 * Start a detached process, but wait until Node confirms that it spawned.
 * This keeps asynchronous spawn errors inside the caller's promise instead of
 * letting an unhandled ChildProcess `error` event reach the main process.
 */
export function launchDetachedProcess(
  command: string,
  args: readonly string[],
  options: SpawnOptions = {},
  spawnFn: DetachedSpawnFn = (spawnCommand, spawnArgs, spawnOptions) =>
    spawn(spawnCommand, [...spawnArgs], spawnOptions)
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawnFn(command, args, {
      ...options,
      detached: true,
      stdio: "ignore",
    });

    proc.on("error", reject);
    proc.once("spawn", () => {
      proc.unref();
      resolve();
    });
  });
}

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
 * Open a Windows-native or UNC path through the Windows host from WSL.
 *
 * Electron is still a Linux process under WSL, so shell.openPath delegates to
 * xdg-open and can block indefinitely. FileProtocolHandler asks the Windows
 * shell to use the default file association without blocking Electron's IPC
 * response.
 */
export async function openWindowsFileFromWsl(
  windowsPath: string,
  spawnFn?: DetachedSpawnFn
): Promise<void> {
  await launchDetachedProcess(
    "rundll32.exe",
    ["url.dll,FileProtocolHandler", windowsPath],
    { windowsHide: true },
    spawnFn
  );
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
