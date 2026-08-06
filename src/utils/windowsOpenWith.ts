import { spawn, type ChildProcess, type SpawnOptions } from "child_process";

/**
 * Windows "Open With…" launcher for AI-created files.
 *
 * History / why this module exists:
 * 1. `OpenAs_RunnableDLL` is not exported by shell32.dll → "missing entry" alert.
 * 2. `rundll32 shell32.dll,OpenAs_RunDLL` often shows the dialog but does not
 *    launch the selected app when spawned from Electron (non-shell context).
 *
 * Correct approach: PowerShell `Start-Process -LiteralPath … -Verb OpenAs`,
 * which uses ShellExecute and both shows the chooser and launches the app.
 *
 * Keep this logic centralized so PackagedWorker-style guard tests can ban
 * the broken rundll32 patterns across `src/`.
 */

export type WindowsOpenWithSpawnInvocation = {
  command: string;
  args: string[];
  options: SpawnOptions;
};

/** Escape a path for PowerShell single-quoted -LiteralPath usage. */
export function escapePowerShellSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Build the spawn invocation for Windows Open With (does not execute).
 * `windowsPath` must already be a Windows-native or UNC path.
 */
export function buildWindowsOpenWithSpawn(
  windowsPath: string
): WindowsOpenWithSpawnInvocation {
  return {
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      `Start-Process -LiteralPath ${escapePowerShellSingleQuoted(
        windowsPath
      )} -Verb OpenAs`,
    ],
    options: { detached: true, stdio: "ignore", windowsHide: true },
  };
}

export type SpawnLike = (
  command: string,
  args: ReadonlyArray<string>,
  options: SpawnOptions
) => ChildProcess;

/**
 * Show Windows "Open With" and launch the chosen app via ShellExecute.
 * Path must already be a Windows-native or UNC path.
 */
export function openWindowsOpenWithDialog(
  windowsPath: string,
  spawnFn: SpawnLike = spawn
): void {
  const invocation = buildWindowsOpenWithSpawn(windowsPath);
  const proc = spawnFn(invocation.command, invocation.args, invocation.options);
  proc.unref();
}
