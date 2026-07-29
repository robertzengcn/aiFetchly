import { createHash } from "crypto";
import type { AIChatGoalView } from "@/entityTypes/aiChatGoalTypes";
import type { GoalRevisionProvider } from "./AIChatGoalLoopService";

/**
 * Goal-relevant source-revision fingerprint (design §7.1).
 *
 * For a workspace under Git: `<HEAD sha>-<short hash of the working-tree
 * status>`. A clean tree yields `<sha>-clean`; dirty trees change the suffix so
 * a post-edit test can't be confused with a pre-edit one. If Git is unavailable
 * or the workspace is not a repo, returns undefined (freshness gating then
 * relies on timestamps/correlation keys instead).
 *
 * The git invocation is injectable so the logic is unit-tested without git.
 */

export interface GitRunner {
  exec(
    args: readonly string[],
    cwd: string
  ): Promise<{ ok: boolean; stdout: string }>;
}

export class GitGoalRevisionProvider implements GoalRevisionProvider {
  constructor(private readonly git: GitRunner) {}

  async current(
    _goal: AIChatGoalView,
    _conversationId: string,
    workspaceRoot: string
  ): Promise<string | undefined> {
    const head = await this.git.exec(["rev-parse", "HEAD"], workspaceRoot);
    if (!head.ok) return undefined;
    const sha = head.stdout.trim();
    if (!sha) return undefined;

    const status = await this.git.exec(
      ["status", "--porcelain"],
      workspaceRoot
    );
    if (!status.ok) return `${sha}-nogit`;
    const dirty =
      status.stdout.trim().length === 0
        ? "clean"
        : createHash("sha256")
            .update(status.stdout)
            .digest("hex")
            .slice(0, 12);
    return `${sha}-${dirty}`;
  }
}
