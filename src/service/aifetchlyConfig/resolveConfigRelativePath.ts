/**
 * resolveConfigRelativePath — CFG-05 path-safety helper.
 *
 * Validates a relative path claimed to live under a trusted config root and
 * returns either the resolved absolute path or a structured error. Mirrors
 * the shape of FilePathGuard (realpath + null-byte + structured result) but
 * is intentionally simpler: phase 13 only scans a small set of well-known
 * files, so this helper exists primarily as the contract that phase 14+
 * workspace scanning will route every discovered relative path through.
 *
 * Security invariants (T-13-01):
 *   - reject absolute paths (POSIX leading "/" or Windows drive letter)
 *   - reject ".." traversal after normalization
 *   - reject null bytes and control characters
 *   - reject symlinks whose realpath escapes the root (existing files)
 *   - reject non-existing paths whose lexical resolution escapes the root
 *
 * This function NEVER throws; all error paths return { ok: false, reason }.
 */

import * as fs from "fs";
import * as path from "path";

export type ResolveConfigPathResult =
  | { ok: true; absolutePath: string }
  | { ok: false; reason: string };

const WINDOWS_DRIVE_RE = /^[A-Za-z]:[\\/]/;

export function resolveConfigRelativePath(
  rootPath: string,
  relativePath: string
): ResolveConfigPathResult {
  // 1. Null-byte rejection.
  if (relativePath.includes("\0")) {
    return {
      ok: false,
      reason: `relative path contains null bytes: ${JSON.stringify(relativePath)}`,
    };
  }
  // 2. Control-character rejection (mirror FilePathGuard).
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(relativePath)) {
    return {
      ok: false,
      reason: `relative path contains control characters: ${JSON.stringify(relativePath)}`,
    };
  }

  // 3. Reject absolute paths. path.isAbsolute catches POSIX "/", the regex
  //    catches Windows drive letters (the helper must be platform-safe even
  //    though phase 13 ships on desktop OSes).
  if (path.isAbsolute(relativePath) || WINDOWS_DRIVE_RE.test(relativePath)) {
    return {
      ok: false,
      reason: `relative path is absolute, must be relative under the config root: ${relativePath}`,
    };
  }

  // 4. Normalize and reject any ".." segment. path.normalize collapses "."
  //    and resolves ".." where possible, but a leading or mid ".." that
  //    escapes the root must still be caught.
  const normalizedRelative = path.normalize(relativePath);
  if (normalizedRelative === "") {
    return {
      ok: false,
      reason: "relative path is empty after normalization",
    };
  }
  for (const seg of normalizedRelative.split(path.sep)) {
    if (seg === "..") {
      return {
        ok: false,
        reason: `relative path escapes the config root via '..': ${relativePath}`,
      };
    }
  }

  const resolvedRoot = path.resolve(rootPath);
  const candidate = path.resolve(resolvedRoot, normalizedRelative);

  // 5. Symlink resolution. For existing entries, realpath and verify the
  //    real path is still inside the root. For non-existing entries, resolve
  //    the parent (if it exists) and verify; otherwise fall back to the
  //    lexical prefix check on the candidate.
  try {
    if (fs.existsSync(candidate)) {
      const real = fs.realpathSync(candidate);
      if (!isInsideRoot(real, resolvedRoot)) {
        return {
          ok: false,
          reason: `relative path resolves to a realpath outside the config root (symlink escape): ${relativePath}`,
        };
      }
      return { ok: true, absolutePath: real };
    }
    const parent = path.dirname(candidate);
    if (fs.existsSync(parent)) {
      const realParent = fs.realpathSync(parent);
      const realCandidate = path.join(realParent, path.basename(candidate));
      if (!isInsideRoot(realCandidate, resolvedRoot)) {
        return {
          ok: false,
          reason: `relative path resolves to a realpath outside the config root (symlink escape): ${relativePath}`,
        };
      }
      return { ok: true, absolutePath: realCandidate };
    }
    // Parent does not exist either — verify lexically.
    if (!isInsideRoot(candidate, resolvedRoot)) {
      return {
        ok: false,
        reason: `relative path resolves outside the config root: ${relativePath}`,
      };
    }
    return { ok: true, absolutePath: candidate };
  } catch {
    return {
      ok: false,
      reason: `failed to resolve realpath for: ${relativePath}`,
    };
  }
}

function isInsideRoot(target: string, root: string): boolean {
  if (target === root) return true;
  // Boundary-safe prefix check: target must be exactly root OR start with
  // root + separator (a naive startsWith would let /foo/bar match /foo/baz).
  return target.startsWith(root + path.sep);
}
