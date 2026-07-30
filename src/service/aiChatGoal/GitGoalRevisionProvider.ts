import { createHash } from "crypto";
import * as fs from "fs";
import { FilePathGuard } from "@/service/FilePathGuard";
import type { AIChatGoalView } from "@/entityTypes/aiChatGoalTypes";
import type { GoalRevisionProvider } from "./AIChatGoalLoopService";

/**
 * Goal-relevant source-revision fingerprint (design §7.1).
 *
 * Primary: for a workspace under Git, `<HEAD sha>-<clean|short hash of the
 * working-tree status>`.
 * Fallback: when Git is unavailable, a content hash of the files referenced by
 * the goal's file-kind criteria (workspace-jailed). This keeps the freshness
 * gate meaningful in non-Git workspaces so a pre-change result can't satisfy a
 * post-change criterion.
 *
 * Returns undefined only when neither signal is available (no Git AND no
 * file-kind criteria AND no workspace) — in that case freshness cannot be
 * established. The git invocation is injectable so the logic is unit-tested
 * without git.
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
    goal: AIChatGoalView,
    _conversationId: string,
    workspaceRoot: string
  ): Promise<string | undefined> {
    const head = await this.git.exec(["rev-parse", "HEAD"], workspaceRoot);
    if (head.ok && head.stdout.trim()) {
      const sha = head.stdout.trim();
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
    return this.fileContentFingerprint(goal, workspaceRoot);
  }

  /** Deterministic content hash of the goal's file-kind criteria (no git). */
  private async fileContentFingerprint(
    goal: AIChatGoalView,
    workspaceRoot: string
  ): Promise<string | undefined> {
    if (!workspaceRoot) return undefined;
    const guard = new FilePathGuard([workspaceRoot]);
    const files = goal.criteria
      .filter(
        (c) => c.verification.kind === "file" && !!c.verification.filePath
      )
      .map((c) => c.verification.filePath as string)
      .sort();
    if (files.length === 0) return undefined;

    const hash = createHash("sha256");
    let included = false;
    for (const rel of files) {
      const validation = guard.validate(rel);
      if (!validation.safe) {
        hash.update(`reject:${rel}\n`);
        included = true;
        continue;
      }
      try {
        const content = await fs.promises.readFile(validation.resolvedPath);
        hash.update(`file:${rel}\n`).update(content);
        included = true;
      } catch {
        hash.update(`missing:${rel}\n`);
        included = true;
      }
    }
    if (!included) return undefined;
    return `files-${hash.digest("hex").slice(0, 16)}`;
  }
}
