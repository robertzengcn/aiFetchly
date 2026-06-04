/**
 * FilePathGuard — centralized path-safety enforcement for AI file tools.
 *
 * Every file tool MUST route its path through `validate()` before
 * performing any filesystem operation.  This single class enforces:
 *
 *   1. Null-byte / malformed-character rejection
 *   2. Path normalization (removes `..`, redundant separators)
 *   3. Symlink resolution (realpath check)
 *   4. Workspace-root jail (resolved path must start with an allowed root)
 *   5. Deny-list matching (blocks sensitive locations regardless of root)
 */

import * as fs from "fs";
import * as path from "path";
import picomatch from "picomatch";
import type {
  PathValidationResult,
  DenyListConfig,
} from "@/entityTypes/fileToolTypes";
import { DEFAULT_DENY_LIST } from "@/config/fileToolConfig";

export class FilePathGuard {
  private readonly roots: readonly string[];
  private readonly denyList: readonly DenyListConfig[];
  private readonly denyMatchers: ReadonlyArray<(p: string) => boolean>;

  constructor(
    roots: readonly string[],
    denyList: readonly DenyListConfig[] = DEFAULT_DENY_LIST
  ) {
    // Normalise roots to resolved absolute paths
    this.roots = roots.map((r) => path.resolve(r));
    this.denyList = denyList;
    this.denyMatchers = denyList.map((entry) =>
      picomatch(entry.patterns, { dot: true, nocase: true })
    );
  }

  /**
   * Validate a user-supplied path against all safety rules.
   *
   * Returns `{ safe: true, resolvedPath }` on success, or
   * `{ safe: false, error }` on violation.
   */
  validate(inputPath: string): PathValidationResult {
    // 1. Null-byte / control-character rejection
    if (inputPath.includes("\0")) {
      return {
        safe: false,
        resolvedPath: "",
        error: "Path contains null bytes",
      };
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(inputPath)) {
      return {
        safe: false,
        resolvedPath: "",
        error: "Path contains control characters",
      };
    }

    // 2. Resolve to absolute path (handles relative, .., redundant separators)
    let resolved: string;
    if (path.isAbsolute(inputPath)) {
      resolved = path.normalize(inputPath);
    } else {
      // Resolve relative to the first workspace root
      resolved = path.resolve(this.roots[0] ?? process.cwd(), inputPath);
    }

    // 3. Symlink resolution (realpath)
    try {
      if (fs.existsSync(resolved)) {
        resolved = fs.realpathSync(resolved);
      } else {
        // For non-existent paths, resolve parent directories that do exist
        const parent = path.dirname(resolved);
        if (fs.existsSync(parent)) {
          const realParent = fs.realpathSync(parent);
          resolved = path.join(realParent, path.basename(resolved));
        }
      }
    } catch {
      return {
        safe: false,
        resolvedPath: "",
        error: "Failed to resolve real path",
      };
    }

    // 4. Workspace-root jail — resolved path must be under at least one root
    const underRoot = this.roots.some(
      (root) => resolved.startsWith(root + path.sep) || resolved === root
    );
    if (!underRoot) {
      return {
        safe: false,
        resolvedPath: "",
        error: "Path is outside the allowed workspace roots",
      };
    }

    // 5. Deny-list check — compute relative path from matching root
    const relPath = this.computeRelativePath(resolved);
    for (let i = 0; i < this.denyMatchers.length; i++) {
      if (this.denyMatchers[i](relPath)) {
        return {
          safe: false,
          resolvedPath: "",
          error: `Access denied by security policy: ${this.denyList[i].description}`,
        };
      }
    }

    return { safe: true, resolvedPath: resolved };
  }

  /** Get the configured workspace roots. */
  getRoots(): readonly string[] {
    return this.roots;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Compute a forward-slash relative path from the matching root.
   * Uses the first root that is a prefix of `resolved`.
   */
  private computeRelativePath(resolved: string): string {
    for (const root of this.roots) {
      if (resolved.startsWith(root + path.sep) || resolved === root) {
        const rel = path.relative(root, resolved);
        // picomatch expects forward slashes
        return rel.split(path.sep).join("/");
      }
    }
    return resolved;
  }
}
