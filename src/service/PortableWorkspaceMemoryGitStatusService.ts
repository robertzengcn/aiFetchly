/**
 * PortableWorkspaceMemoryGitStatusService — READ-ONLY Git tracking-state
 * detection for the memory directory (design §18).
 *
 * Runs `git` through execFile with argument arrays — never a shell string.
 * Exposes only a bounded tracking state; never remote URLs, branch names,
 * commit hashes, or unrelated status entries.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PortableMemoryGitTrackingState } from "@/entityTypes/portableWorkspaceMemoryTypes";

const execFileAsync = promisify(execFile);

const MEMORY_PATH = ".aifetchly/memory";
const IDENTITY_PATH = ".aifetchly/workspace.json";

/** Injectable runner for tests. */
export type GitRunner = (
  args: readonly string[],
  cwd: string
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

async function defaultRunner(
  args: readonly string[],
  cwd: string
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return execFileAsync("git", [...args], {
    cwd,
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });
}

export class PortableWorkspaceMemoryGitStatusService {
  private readonly run: GitRunner;

  constructor(runner: GitRunner = defaultRunner) {
    this.run = runner;
  }

  /**
   * Classify the memory directory's Git state. Git unavailability or a
   * non-repository degrades to explicit states — memory still works.
   */
  async getTrackingState(
    canonicalRoot: string
  ): Promise<PortableMemoryGitTrackingState> {
    try {
      const inside = await this.run(
        ["rev-parse", "--is-inside-work-tree"],
        canonicalRoot
      );
      if (inside.stdout.trim() !== "true") {
        return "not-a-repository";
      }
    } catch {
      return "not-a-repository";
    }

    // Ignored? (check-ignore exits 0 when ignored, 1 when not)
    let ignored = false;
    try {
      await this.run(["check-ignore", "-q", `${MEMORY_PATH}/`], canonicalRoot);
      ignored = true;
    } catch {
      ignored = false;
    }
    if (ignored) return "ignored";

    // Tracked file probe: README (created at enablement) then any record.
    let trackedCount = 0;
    let untrackedCount = 0;
    try {
      const status = await this.run(
        [
          "status",
          "--porcelain=v1",
          "--",
          MEMORY_PATH,
          IDENTITY_PATH,
        ],
        canonicalRoot
      );
      for (const line of status.stdout.split("\n")) {
        if (!line.trim()) continue;
        const code = line.slice(0, 2);
        if (code.includes("?")) untrackedCount += 1;
        else trackedCount += 1;
      }
    } catch {
      return "unknown";
    }

    // Committed files do not appear in status — probe the index directly.
    let inIndex = false;
    try {
      await this.run(
        ["ls-files", "--error-unmatch", `${MEMORY_PATH}/README.md`],
        canonicalRoot
      );
      inIndex = true;
    } catch {
      inIndex = false;
    }

    if (inIndex && untrackedCount === 0) return "tracked";
    if (inIndex && untrackedCount > 0) return "partially-tracked";
    if (trackedCount > 0 && untrackedCount > 0) return "partially-tracked";
    if (untrackedCount > 0) return "untracked";
    if (inIndex) return "tracked";
    return "untracked";
  }
}
