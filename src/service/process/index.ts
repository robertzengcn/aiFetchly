/**
 * Provider registry — platform-appropriate process execution
 * (design §7.1). Import `getPlatformProcessProvider()` instead of
 * scattering `process.platform` conditions.
 */

import type { PlatformProcessProvider } from "@/service/process/PlatformProcessProvider";
import { PosixProcessProvider } from "@/service/process/PosixProcessProvider";
import { WindowsProcessProvider } from "@/service/process/WindowsProcessProvider";

export {
  buildChildEnvironment,
  decodeProcessOutput,
  normalizeProcessLineEndings,
  SENSITIVE_ENV_KEYS,
  runProcessCapture,
  type PlatformProcessProvider,
  type ProcessDiagnosticCode,
  type ProcessExecutionResult,
  type ProcessInvocation,
  type ProcessProviderKind,
} from "@/service/process/PlatformProcessProvider";
export { resolveShellInterpreter } from "@/service/process/ShellInterpreterResolver";
export type { ResolvedInterpreter } from "@/service/process/ShellInterpreterResolver";
export { PosixProcessProvider } from "@/service/process/PosixProcessProvider";
export { WindowsProcessProvider } from "@/service/process/WindowsProcessProvider";

let cached: PlatformProcessProvider | null = null;

export function getPlatformProcessProvider(): PlatformProcessProvider {
  if (!cached) {
    cached =
      process.platform === "win32"
        ? new WindowsProcessProvider()
        : new PosixProcessProvider();
  }
  return cached;
}
