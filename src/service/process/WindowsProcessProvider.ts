/**
 * Windows process provider (natural-language-skill-installation design §7.2).
 *
 * Corrects the observed Windows output failures by:
 *   - defaulting to `detached: false` (a detached child without proper
 *     hand-off is a suspected cause of lost pipe output);
 *   - preserving the application environment minus secrets instead of a
 *     Unix-centric allowlist (SystemRoot/ComSpec/PATHEXT/TEMP … stay set);
 *   - decoding via BOM/UTF-16LE detection with byte counts captured before
 *     decoding, plus forcing PowerShell sessions to EMIT UTF-8 (5.1 otherwise
 *     writes `?` bytes for non-Windows-1252 characters when redirected);
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

// ---------------------------------------------------------------------------
// Unicode output encoding (PRD §16.2): Windows PowerShell 5.1 encodes its
// REDIRECTED stdout with the console's OEM/ANSI code page, in which CJK,
// emoji, and other non-Windows-1252 characters become literal `?` bytes —
// unrecoverable by any downstream decoder. Setting the console output
// encoding to BOM-less UTF-8 before the user command makes the session emit
// UTF-8, which decodeProcessOutput then decodes deterministically.
// PowerShell 7 already defaults to UTF-8; the preamble is a harmless no-op
// there. Wrapped in try/catch because [Console]::OutputEncoding can throw on
// console-less hosts (then the session keeps its default encoding).
// ---------------------------------------------------------------------------

const UTF8_OUTPUT_PREAMBLE =
  "try{[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)}catch{};";

const POWERSHELL_EXECUTABLE_RE = /(?:^|[\\/])(pwsh|powershell)(?:\.exe)?$/i;

/**
 * Prepend the UTF-8 output-encoding preamble to a PowerShell `-Command`
 * invocation. Non-PowerShell executables and other argument styles
 * (`-File`, `-EncodedCommand`, …) pass through untouched, and the input
 * invocation is never mutated.
 */
export function withUtf8OutputEncoding(
  invocation: ProcessInvocation
): ProcessInvocation {
  if (!POWERSHELL_EXECUTABLE_RE.test(invocation.executable)) {
    return invocation;
  }
  const commandIndex = invocation.args.indexOf("-Command");
  if (commandIndex === -1 || commandIndex + 1 >= invocation.args.length) {
    return invocation;
  }
  const args = [...invocation.args];
  args[commandIndex + 1] = `${UTF8_OUTPUT_PREAMBLE}${args[commandIndex + 1]}`;
  return { ...invocation, args };
}

export class WindowsProcessProvider implements PlatformProcessProvider {
  readonly kind = "windows" as const;

  private readonly config: ProcessRunnerConfig = {
    kind: "windows",
    detached: false,
    killTree: killWindowsTree,
  };

  execute(invocation: ProcessInvocation): Promise<ProcessExecutionResult> {
    const prepared = withUtf8OutputEncoding(invocation);
    return runProcessCapture(prepared, this.config).then((result) => {
      if (
        result.diagnosticCode === "PROCESS_SPAWN_FAILED" &&
        /pwsh/i.test(prepared.executable)
      ) {
        // Deliberate one-shot fallback to Windows PowerShell.
        return runProcessCapture(
          { ...prepared, executable: "powershell.exe" },
          this.config
        );
      }
      return result;
    });
  }
}
