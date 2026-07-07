import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

export interface WorkspaceKeyResolution {
  readonly inputRootPath: string;
  readonly canonicalRootPath: string;
  readonly workspaceKey: string;
  readonly displayName: string;
  readonly gitRootDetected: boolean;
}

/** Resolves a git repository top-level for a real path, or null when unavailable. */
export type GitRootFinder = (realPath: string) => string | null;

/** Canonicalizes a path (defaults to fs.realpath). Injectable for tests. */
export type RealpathFn = (inputPath: string) => Promise<string>;

/**
 * Optional injected dependencies for {@link WorkspaceKeyService}. Both default
 * to the real main-process implementations; tests pass fakes to avoid touching
 * the filesystem or requiring git.
 */
export interface WorkspaceKeyServiceDeps {
  readonly findGitRoot?: GitRootFinder;
  readonly realpath?: RealpathFn;
}

/**
 * Derives a stable, durable `workspaceKey` for an approved workspace root.
 *
 * Resolution:
 *   1. Canonicalize the input via `fs.realpath`.
 *   2. Prefer the enclosing Git repository root when one exists.
 *   3. Otherwise use the real path itself.
 *   4. Hash the canonical root (sha256, first 32 hex chars) → `ws_<hash>`.
 *
 * The key is the durable workspace identity shared across every conversation
 * that resolves to the same canonical root. Worktrees are keyed by their own
 * real worktree root in v1 (deterministic; common-directory sharing is a later
 * option). `findGitRoot` and `realpath` are injectable so tests need neither
 * git nor a real filesystem.
 */
export class WorkspaceKeyService {
  private readonly findGitRoot: GitRootFinder;
  private readonly realpath: RealpathFn;

  constructor(deps: WorkspaceKeyServiceDeps = {}) {
    this.findGitRoot = deps.findGitRoot ?? defaultGitRootFinder;
    this.realpath = deps.realpath ?? ((p) => fs.realpath(p));
  }

  async resolve(rootPath: string): Promise<WorkspaceKeyResolution> {
    const realInput = await this.realpath(rootPath);
    const gitRoot = this.findGitRoot(realInput);
    const canonicalRootPath = gitRoot ?? realInput;
    const workspaceKey = this.hashWorkspacePath(canonicalRootPath);

    return {
      inputRootPath: realInput,
      canonicalRootPath,
      workspaceKey,
      displayName: path.basename(canonicalRootPath) || canonicalRootPath,
      gitRootDetected: gitRoot !== null,
    };
  }

  hashWorkspacePath(canonicalRootPath: string): string {
    const digest = crypto
      .createHash("sha256")
      .update(canonicalRootPath)
      .digest("hex")
      .slice(0, 32);
    return `ws_${digest}`;
  }
}

/**
 * Default git-root finder. Runs `git -C <path> rev-parse --show-toplevel`
 * synchronously (main process only). Treats any failure as "no git".
 *
 * Security: never executes a shell string — arguments are passed as an array.
 * Does not read repository config for memory paths.
 */
export function defaultGitRootFinder(realPath: string): string | null {
  try {
    const result = spawnSync(
      "git",
      ["-C", realPath, "rev-parse", "--show-toplevel"],
      { encoding: "utf8", timeout: 2000 }
    );
    if (result.status !== 0) return null;
    const out = (result.stdout ?? "").trim();
    return out.length > 0 ? path.resolve(out) : null;
  } catch {
    return null;
  }
}
