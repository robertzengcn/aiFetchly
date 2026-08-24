/**
 * Windows process provider (natural-language-skill-installation design §7.2).
 *
 * Corrects the observed Windows output failures by:
 *   - defaulting to `detached: false` (a detached child without proper
 *     hand-off is a suspected cause of lost pipe output);
 *   - preserving the application environment minus secrets instead of a
 *     Unix-centric allowlist (SystemRoot/ComSpec/PATHEXT/TEMP … stay set);
 *   - decoding via BOM/UTF-16LE detection with byte counts captured before
 *     decoding;
 *   - terminating the process TREE with taskkill /T /F on timeout;
 *   - flagging PROCESS_OUTPUT_EMPTY_UNEXPECTED for expect-output commands
 *     that exit 0 with zero bytes.
 *
 * pwsh → powershell fallback: interpreter resolution prefers `pwsh.exe`;
 * when spawning it fails with ENOENT the provider retries once with
 * `powershell.exe` (deliberate, not silent).
 */

import { spawn, type ChildProcess } from "child_process";
import {
  runProcessCapture,
  type PlatformProcessProvider,
  type ProcessExecutionResult,
  type ProcessInvocation,
  type ProcessRunnerConfig,
} from "@/service/process/PlatformProcessProvider";

function killWindowsTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    /* already exited */
  }
}

export class WindowsProcessProvider implements PlatformProcessProvider {
  readonly kind = "windows" as const;

  private readonly config: ProcessRunnerConfig = {
    kind: "windows",
    detached: false,
    killTree: killWindowsTree,
  };

  execute(invocation: ProcessInvocation): Promise<ProcessExecutionResult> {
    return runProcessCapture(invocation, this.config).then((result) => {
      if (
        result.diagnosticCode === "PROCESS_SPAWN_FAILED" &&
        /pwsh/i.test(invocation.executable)
      ) {
        // Deliberate one-shot fallback to Windows PowerShell.
        return runProcessCapture(
          { ...invocation, executable: "powershell.exe" },
          this.config
        );
      }
      return result;
    });
  }
}
