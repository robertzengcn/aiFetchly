/**
 * PIP package management utilities — extracted from lib/function.ts (R5.6).
 *
 * Uses execFile (not exec) to prevent command injection — packageName/version
 * are passed as array args, never interpolated into shell syntax.
 */
import { execSync, execFile } from "child_process";
import { log } from "@/modules/Logger";

export function checkPipPackage(): string {
  try {
    return execSync("pip list", { encoding: "utf8" });
  } catch (error) {
    if (error instanceof Error) {
      log.error(`Error executing command: ${error.message}`);
    }
    return "";
  }
}

export function installPipPackage(
  packageName: string,
  version: string,
  errorcall?: (error: Error) => void,
  stdoutCall?: (stdout: string) => void,
  stderrCall?: (stderr: string) => void
): void {
  execFile(
    "pip",
    ["install", `${packageName}==${version}`],
    (error: Error | null, stdout: string, stderr: string) => {
      if (error) {
        if (errorcall) {
          errorcall(error);
        }
      }
      if (stdoutCall) {
        stdoutCall(stdout);
      }
      if (stderrCall) {
        stderrCall(stderr);
      }
    }
  );
}

export function uninstallPipPackage(
  packageName: string,
  errorcall?: (error: Error) => void,
  stdoutCall?: (stdout: string) => void,
  stderrCall?: (stderr: string) => void
): void {
  execFile(
    "pip",
    ["uninstall", packageName, "-y"],
    (error: Error | null, stdout: string, stderr: string) => {
      if (error) {
        log.error(`exec error: ${error}`);
        if (errorcall) {
          errorcall(error);
        }
        return;
      }
      log.info(`stdout: ${stdout}`);
      log.error(`stderr: ${stderr}`);
      if (stdoutCall) {
        stdoutCall(stdout);
      }
      if (stderrCall) {
        stderrCall(stderr);
      }
    }
  );
}
