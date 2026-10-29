import { execFile } from "node:child_process";
import { log } from "@/modules/Logger";

/**
 * OS process killing without a shell.
 *
 * Security: the previous implementation used `exec(\`kill -9 ${pid}\`)`, which
 * interpolates the pid into a shell string. Although `pid` is typed `number`
 * upstream, argv form (`execFile`) is defense-in-depth against argument
 * injection and avoids spawning a shell at all.
 */

/**
 * Build the OS kill command + argv for a PID.
 *
 * Pure and exported so the no-interpolation invariant is unit-testable without
 * touching the filesystem or spawning processes.
 *
 * @throws if `pid` is not a positive integer (fail fast — never reach the OS
 *   with a malformed identifier).
 */
export function buildKillCommand(
  pid: number,
  platform: string = process.platform
): { cmd: string; args: string[] } {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`Invalid pid (must be a positive integer): ${pid}`);
  }
  const isWindows = platform === "win32";
  return isWindows
    ? { cmd: "taskkill", args: ["/PID", String(pid), "/F"] }
    : { cmd: "kill", args: ["-9", String(pid)] };
}

/**
 * Kill a PID via the OS using an argv array (no shell, no interpolation).
 *
 * Fire-and-forget with error logging; `pid` is validated as a positive integer
 * via {@link buildKillCommand}.
 */
export function killPidViaOs(pid: number, platform?: string): void {
  const { cmd, args } = buildKillCommand(pid, platform);
  execFile(cmd, args, (error: unknown) => {
    if (error) {
      log.error(`Failed to kill process ${pid} via ${cmd}:`, error);
    }
  });
}
