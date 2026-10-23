/**
 * Repository filesystem-boundary enforcement (tech design §11; F08).
 *
 * Source files and policy inputs must physically live inside the
 * repository. A lexical check alone is not enough: a symlinked file (or a
 * file inside a symlinked directory) resolves outside the repo, and both
 * reads (policy, manifest) and writes (quality:fix) would then touch bytes
 * the commit can never contain. realpathSync resolves the FULL chain, so
 * symlinked parents are covered by the same check.
 *
 * Shared by the lint runner (source selection), the fix command, the
 * exception-manifest loader, and the coordinator's policy preflight — the
 * checks must never drift apart again (lint-files protected source
 * realpaths while fix.mjs and the manifest loader did not).
 */

const fs = require('fs');
const path = require('path');

/** realpath of the repo root (falls back to the lexical root if unresolvable). */
function realRootOf(repoRoot) {
  try {
    return fs.realpathSync(repoRoot);
  } catch {
    return repoRoot;
  }
}

/**
 * Assert that `absPath` stays inside `repoRoot` both lexically and after
 * resolving symlinks. Returns the lexically resolved path. Throws Error
 * with an operator-readable message otherwise. A missing file passes the
 * lexical check and returns normally (ENOENT is the engine's error to
 * report, not a boundary violation); any other resolution failure throws.
 */
function assertInsideRepo(repoRoot, absPath, label) {
  const resolved = path.resolve(repoRoot, absPath);
  const insideLexical =
    resolved === repoRoot || resolved.startsWith(repoRoot + path.sep);
  if (!insideLexical) {
    throw new Error(`${label} escapes the repository boundary: ${absPath} -> ${resolved}`);
  }
  let real;
  try {
    real = fs.realpathSync(resolved);
  } catch (e) {
    if (e.code === 'ENOENT') return resolved;
    throw new Error(`${label} could not be resolved: ${absPath} (${e.message})`);
  }
  const realRoot = realRootOf(repoRoot);
  const insideReal = real === realRoot || real.startsWith(realRoot + path.sep);
  if (!insideReal) {
    throw new Error(`${label} resolves (symlink) outside the repository: ${absPath} -> ${real}`);
  }
  return resolved;
}

module.exports = { assertInsideRepo, realRootOf };
