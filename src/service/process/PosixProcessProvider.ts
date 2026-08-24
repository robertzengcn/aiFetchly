/**
 * POSIX process provider — detached process group + group-kill termination
 * (natural-language-skill-installation design §7).
 */

import type { ChildProcess } from "child_process";
import {
  runProcessCapture,
  type PlatformProcessProvider,
  type ProcessExecutionResult,
  type ProcessInvocation,
  type ProcessRunnerConfig,
} from "@/service/process/PlatformProcessProvider";

function killPosixTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    // Detached on POSIX → own process group; negative pid kills the group.
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      /* already exited */
    }
  }
}

export class PosixProcessProvider implements PlatformProcessProvider {
  readonly kind = "posix" as const;

  private readonly config: ProcessRunnerConfig = {
    kind: "posix",
    detached: true,
    killTree: killPosixTree,
  };

  execute(invocation: ProcessInvocation): Promise<ProcessExecutionResult> {
    return runProcessCapture(invocation, this.config);
  }
}
