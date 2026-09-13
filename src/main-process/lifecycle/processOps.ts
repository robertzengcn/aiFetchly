import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import { log } from "@/modules/Logger";

/**
 * Platform process operations (technical design §8).
 *
 * Every OS interaction the OwnedProcessRegistry and ProcessTreeTerminator
 * need is expressed as this injectable interface so tests can simulate the
 * process table deterministically (PID reuse, surviving descendants,
 * permission failures) while production uses {@link createDefaultProcessOps}.
 *
 * Common rules enforced by callers of these ops (design §8):
 *  - never kill by executable name or broad image matching
 *  - never signal the application's own inherited process group
 *  - a PID alone is not identity — start-time identity disambiguates reuse
 */

const execFileAsync = promisify(execFile);

export type SignalOutcome = "ok" | "no-process" | "error";

export interface ProcessOps {
  readonly platform: NodeJS.Platform;

  /** Cheap liveness probe (kill -0 semantics). EPERM counts as alive. */
  isAlive(pid: number): boolean;

  /** Send a signal to one process. */
  signal(pid: number, signal: NodeJS.Signals): SignalOutcome;

  /**
   * Signal an ISOLATED process group. Callers must only pass group ids that
   * were created by this application at launch (never the app's own group).
   */
  signalGroup(pgid: number, signal: NodeJS.Signals): SignalOutcome;

  /** Direct children of a pid ([] when unsupported on the platform). */
  listChildren(pid: number): Promise<number[]>;

  /** Parent pid of a process (null when unsupported / already exited). */
  readParentPid(pid: number): Promise<number | null>;

  /**
   * OS start-time identity used to detect PID reuse:
   *   linux   — /proc/<pid>/stat field 22 (starttime in clock ticks)
   *   darwin  — `ps -o lstart= -p <pid>`
   *   win32   — null (documented limitation; spawn timestamp is the only
   *             identity there, see OwnedProcessRegistry)
   */
  readStartTimeIdentity(pid: number): Promise<string | null>;

  /**
   * Windows verified tree termination: `taskkill /PID <pid> /T /F` with an
   * argument array (never a shell string). Awaited by the caller.
   */
  runTaskkillTree(pid: number): Promise<SignalOutcome>;
}

function mapKillError(err: unknown): SignalOutcome {
  const code = (err as { code?: unknown })?.code;
  if (code === "ESRCH") return "no-process";
  return "error";
}

export function createDefaultProcessOps(): ProcessOps {
  return {
    platform: process.platform,

    isAlive(pid: number): boolean {
      try {
        process.kill(pid, 0);
        return true;
      } catch (err) {
        const code = (err as { code?: unknown })?.code;
        // EPERM: process exists but is not ours (e.g. another user's).
        return code === "EPERM";
      }
    },

    signal(pid, signal) {
      try {
        process.kill(pid, signal);
        return "ok";
      } catch (err) {
        return mapKillError(err);
      }
    },

    signalGroup(pgid, signal) {
      try {
        process.kill(-pgid, signal);
        return "ok";
      } catch (err) {
        return mapKillError(err);
      }
    },

    async listChildren(pid) {
      if (process.platform === "win32") {
        // taskkill /T already walks the tree on Windows.
        return [];
      }
      try {
        const { stdout } = await execFileAsync("pgrep", ["-P", String(pid)]);
        return stdout
          .split("\n")
          .map((line) => Number.parseInt(line.trim(), 10))
          .filter((n) => Number.isInteger(n) && n > 0);
      } catch {
        // pgrep exit 1 = no children; anything else treat as none found.
        return [];
      }
    },

    async readParentPid(pid) {
      if (process.platform === "linux") {
        try {
          const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
          // Field 4 is PPid; fields are space-separated but comm (field 2)
          // may contain spaces/parens — parse after the LAST ')'.
          const afterComm = stat.slice(stat.lastIndexOf(")") + 2);
          const fields = afterComm.split(" ");
          const ppid = Number.parseInt(fields[1], 10);
          return Number.isInteger(ppid) && ppid > 0 ? ppid : null;
        } catch {
          return null;
        }
      }
      if (process.platform === "darwin") {
        try {
          const { stdout } = await execFileAsync("ps", [
            "-o",
            "ppid=",
            "-p",
            String(pid),
          ]);
          const ppid = Number.parseInt(stdout.trim(), 10);
          return Number.isInteger(ppid) && ppid > 0 ? ppid : null;
        } catch {
          return null;
        }
      }
      return null;
    },

    async readStartTimeIdentity(pid) {
      if (process.platform === "linux") {
        try {
          const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
          const afterComm = stat.slice(stat.lastIndexOf(")") + 2);
          const fields = afterComm.split(" ");
          // starttime is field 22 overall = fields[19] after comm (3rd+).
          const starttime = fields[19];
          return starttime !== undefined ? `linux:${starttime}` : null;
        } catch {
          return null;
        }
      }
      if (process.platform === "darwin") {
        try {
          const { stdout } = await execFileAsync("ps", [
            "-o",
            "lstart=",
            "-p",
            String(pid),
          ]);
          const trimmed = stdout.trim();
          return trimmed.length > 0 ? `darwin:${trimmed}` : null;
        } catch {
          return null;
        }
      }
      return null;
    },

    async runTaskkillTree(pid) {
      try {
        const { stdout, stderr } = await execFileAsync("taskkill", [
          "/PID",
          String(pid),
          "/T",
          "/F",
        ]);
        void stdout;
        void stderr;
        return "ok" as const;
      } catch (err) {
        const code = (err as { code?: unknown })?.code;
        const stderrText = String((err as { stderr?: unknown })?.stderr ?? "");
        // taskkill exit 128 + "not found" = process already gone.
        if (code === 128 || /not found|no running/i.test(stderrText)) {
          return "no-process" as const;
        }
        log.warn(
          `[terminator] taskkill failed for pid ${pid}: code=${String(code)}`
        );
        return "error" as const;
      }
    },
  };
}
