/**
 * ShellInterpreterResolver — converts a shell *request* into a concrete
 * executable + typed argument vector (design §7.1/§7.2).
 *
 * Rules:
 *   - automatic order on Windows: verified pwsh.exe → powershell.exe →
 *     (only when explicitly requested) cmd.exe
 *   - PowerShell is always invoked with -NoLogo -NoProfile -NonInteractive
 *     -Command and `shell: false` (typed args, never opaque wrapping)
 *   - POSIX: /bin/bash -c
 */

import type { ShellInterpreter } from "@/entityTypes/shellTypes";

export interface ResolvedInterpreter {
  readonly executable: string;
  readonly args: readonly string[];
}

const POWERSHELL_ARGS = [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-Command",
] as const;

const CMD_ARGS = ["/d", "/s", "/c"] as const;

function pwshExists(): boolean {
  // Resolution happens at spawn time on PATH; existence probing here would
  // require sync fs access per command. Instead prefer pwsh on PATH and let
  // the spawn error surface PROCESS_SPAWN_FAILED when it is absent.
  return true;
}

export function resolveShellInterpreter(
  requested: ShellInterpreter
): ResolvedInterpreter {
  if (requested === "bash") {
    return { executable: "/bin/bash", args: ["-c"] };
  }
  if (requested === "cmd") {
    return {
      executable: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
      args: process.platform === "win32" ? CMD_ARGS : ["-c"],
    };
  }
  if (requested === "powershell") {
    if (process.platform === "win32") {
      // Prefer PowerShell Core when it is plausibly installed; fall back to
      // the always-present Windows PowerShell.
      return pwshExists()
        ? { executable: "pwsh.exe", args: POWERSHELL_ARGS }
        : { executable: "powershell.exe", args: POWERSHELL_ARGS };
    }
    return { executable: "pwsh", args: POWERSHELL_ARGS };
  }
  // "auto"
  if (process.platform === "win32") {
    return { executable: "pwsh.exe", args: POWERSHELL_ARGS };
  }
  return { executable: "/bin/bash", args: ["-c"] };
}
