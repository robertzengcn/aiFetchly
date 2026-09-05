import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as path from "node:path";
import type { Stats } from "node:fs";

/**
 * Worker-side cache path validation (technical design §13.9).
 *
 * The maintenance worker NEVER trusts paths from the main process blindly:
 * every operation re-validates the managed root (not the FS root, not the
 * home/tmp directory, exact `managed-browser-cache/vN` suffix), checks the
 * scope/queue-path grammar, verifies containment, and walks the path
 * components with lstat to reject planted symlinks. All of this runs INSIDE
 * the worker so a compromised or buggy main process cannot turn the
 * maintenance worker into a recursive-delete oracle.
 */

export type CachePathCheck = { ok: true } | { ok: false; reasonCode: string };

export interface CachePathValidatorDeps {
  readonly lstat?: (p: string) => Promise<Stats>;
  readonly homedir?: () => string;
  readonly tmpdir?: () => string;
}

/** Deletion-queue directory name inside the managed root. */
export const CACHE_DELETING_DIR_NAME = "deleting";

/** Scope directory basenames: 24-char lowercase hex (opaque tokens). */
const SCOPE_TOKEN_PATTERN = /^[0-9a-f]{24}$/;

/** Queue entry basenames under `deleting/` (crash-recognizable grammar). */
const QUEUE_ENTRY_PATTERN = /^[a-z0-9-]{8,64}$/;

export class CachePathValidator {
  private readonly lstat: (p: string) => Promise<Stats>;
  private readonly homedir: () => string;
  private readonly tmpdir: () => string;

  public constructor(deps: CachePathValidatorDeps = {}) {
    this.lstat = deps.lstat ?? ((p) => nodeFs.lstat(p));
    this.homedir = deps.homedir ?? (() => nodeOs.homedir());
    this.tmpdir = deps.tmpdir ?? (() => nodeOs.tmpdir());
  }

  /**
   * Re-validate a managed root received over the wire: not the filesystem
   * root / home / tmp, normalized, and ending with the versioned cache
   * suffix (`managed-browser-cache/vN`).
   */
  public validateManagedRoot(root: string): CachePathCheck {
    if (!root || root.length > 1024) {
      return { ok: false, reasonCode: "cache_root_invalid" };
    }
    if (path.normalize(root) !== root) {
      return { ok: false, reasonCode: "cache_root_invalid" };
    }
    if (root === path.parse(root).root) {
      return { ok: false, reasonCode: "cache_root_invalid" };
    }
    if (root === this.homedir() || root === this.tmpdir()) {
      return { ok: false, reasonCode: "cache_root_invalid" };
    }
    const suffix = path.join("managed-browser-cache", "v1");
    if (!root.endsWith(suffix)) {
      return { ok: false, reasonCode: "cache_root_invalid" };
    }
    return { ok: true };
  }

  /** Validate a scope path: `<managedRoot>/<24-hex>` — nothing else. */
  public validateScopePath(scopePath: string, managedRoot: string): CachePathCheck {
    if (!scopePath || scopePath.length > 1024) {
      return { ok: false, reasonCode: "cache_path_invalid" };
    }
    const basename = path.basename(scopePath);
    if (!SCOPE_TOKEN_PATTERN.test(basename)) {
      return { ok: false, reasonCode: "cache_path_invalid" };
    }
    if (path.dirname(scopePath) !== managedRoot) {
      return { ok: false, reasonCode: "cache_path_invalid" };
    }
    if (path.normalize(scopePath) !== scopePath) {
      return { ok: false, reasonCode: "cache_path_invalid" };
    }
    return { ok: true };
  }

  /**
   * Validate a deletion-queue path: `<managedRoot>/deleting/<entry>` where
   * the entry matches the crash-recognizable grammar.
   */
  public validateQueuePath(queuePath: string, managedRoot: string): CachePathCheck {
    if (!queuePath || queuePath.length > 1024) {
      return { ok: false, reasonCode: "cache_path_invalid" };
    }
    const basename = path.basename(queuePath);
    if (!QUEUE_ENTRY_PATTERN.test(basename)) {
      return { ok: false, reasonCode: "cache_path_invalid" };
    }
    const expectedParent = path.join(managedRoot, CACHE_DELETING_DIR_NAME);
    if (path.dirname(queuePath) !== expectedParent) {
      return { ok: false, reasonCode: "cache_path_invalid" };
    }
    if (path.normalize(queuePath) !== queuePath) {
      return { ok: false, reasonCode: "cache_path_invalid" };
    }
    return { ok: true };
  }

  /**
   * Walk every path component below `managedRoot` down to `target` with
   * lstat and reject if ANY is a symlink. Missing components are tolerated
   * (races with a just-deleted scope are expected — callers handle ENOENT).
   */
  public async assertNoSymlinkComponents(
    target: string,
    managedRoot: string
  ): Promise<CachePathCheck> {
    const relative = path.relative(managedRoot, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return { ok: false, reasonCode: "cache_path_invalid" };
    }
    const parts = relative.split(path.sep).filter((p) => p.length > 0);
    let current = managedRoot;
    for (const part of parts) {
      current = path.join(current, part);
      let info: Stats;
      try {
        info = await this.lstat(current);
      } catch {
        // ENOENT (or similar) — the caller decides how to treat a missing
        // path; a missing path cannot be a symlink escape.
        return { ok: true };
      }
      if (info.isSymbolicLink()) {
        return { ok: false, reasonCode: "cache_symlink_rejected" };
      }
    }
    return { ok: true };
  }
}
