"use strict";
/**
 * Patches @electron-forge/core-utils' forked `remote-rebuild.js` to short-circuit
 * to a no-op when `FORGE_SKIP_NATIVE_REBUILD=1` is set.
 *
 * Why this exists:
 *   CI's package-smoke job sets `FORGE_SKIP_NATIVE_REBUILD=1` and configures
 *   `rebuildConfig.onlyModules: []` so @electron/rebuild compiles nothing during
 *   electron-packager's "Preparing native dependencies" step. BUT an empty
 *   `onlyModules` array is *truthy* in `@electron/rebuild`'s `ModuleWalker`
 *   (node_modules/@electron/rebuild/lib/module-walker.js): it still pushes every
 *   prod/optional/dev dependency key, recursively walks the entire dependency
 *   graph (`walkModules` → `markChildrenAsProdDeps`), and `findAllModulesIn`
 *   recurses through every nested `node_modules` calling `fs.realpath` on each
 *   entry. The only thing the empty array skips is the final `includes()` check
 *   that pushes to `modulesToRebuild` — i.e. it skips the *compile*, not the
 *   *walk*. On the constrained GitHub Actions runner this full-graph traversal
 *   of a large node_modules (puppeteer, realm, canvas, typeorm, langchain, …)
 *   stalls "Preparing native dependencies" until the runner loses
 *   communication with the server.
 *
 *   `rebuild-native` (run by `package:ci` before packaging) already builds
 *   better-sqlite3 for Electron, and the smoke verify step only checks worker
 *   files + renderer HTML layout — neither needs a runtime native rebuild. So
 *   the packaging-time rebuild is pure wasted work that we want to skip
 *   *entirely*, walk included.
 *
 *   forge's `listrCompatibleRebuildHook` (which prints "Preparing native
 *   dependencies") is hardcoded in `@electron-forge/core/dist/api/package.js`
 *   and always forks `remote-rebuild.js`; there is no config flag to omit it.
 *   Patching the forked worker to exit immediately when the skip env var is set
 *   is the only way to truly bypass the walk. The patched worker sends the
 *   `rebuild-done` IPC message forge awaits, then exits 0, so forge treats it
 *   as a successful no-op rebuild.
 *
 *   Idempotent: re-applies only if the guard is missing. Reinstalls restore the
 *   upstream file, so the postinstall/prePackage hook keeps it current.
 *
 * Invoked from the `postinstall` hook and the forge `prePackage` hook so the
 * patch is always present before any packaging run.
 */
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

/**
 * @returns {string|null} path to the installed remote-rebuild.js, or null when
 *   the package isn't installed (e.g. production install without devDeps).
 */
function findRemoteRebuildPath() {
  const candidates = [
    path.join(
      PROJECT_ROOT,
      "node_modules",
      "@electron-forge",
      "core-utils",
      "dist",
      "remote-rebuild.js"
    ),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

// Sentinel the patch inserts at the top of the worker. Re-applying checks for
// this so the patch is idempotent across runs.
const GUARD_MARKER = "/* AIFETCHLY-SKIP-NATIVE-REBUILD-GUARD */";

// The no-op guard block. Runs before the upstream `rebuild()` call. When
// FORGE_SKIP_NATIVE_REBUILD=1, emits the `rebuild-done` IPC message that
// forge's listrCompatibleRebuildHook awaits (see @electron-forge/core-utils
// dist/rebuild.js), then exits 0 so the parent treats the step as done.
const GUARD_BLOCK = `${GUARD_MARKER}
if (process.env.FORGE_SKIP_NATIVE_REBUILD === '1' && process.send) {
  process.send({ msg: 'rebuild-done' });
  process.exit(0);
}
`;

/**
 * @param {string} filePath - absolute path to remote-rebuild.js
 * @returns {boolean} true if the file was modified, false if already patched
 */
function patchRemoteRebuild(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return false;
  }

  if (raw.includes(GUARD_MARKER)) {
    return false;
  }

  // Insert the guard immediately after the `@electron/rebuild` require line,
  // which is the first statement. This guarantees the guard runs before the
  // upstream `rebuild()` invocation whatever the upstream file shape.
  const requireLine = 'const rebuild_1 = require("@electron/rebuild");';
  const requireAlt = "const rebuild_1 = require('@electron/rebuild');";
  const idx = raw.includes(requireLine)
    ? raw.indexOf(requireLine) + requireLine.length
    : raw.includes(requireAlt)
      ? raw.indexOf(requireAlt) + requireAlt.length
      : -1;

  let patched;
  if (idx >= 0) {
    patched = raw.slice(0, idx) + "\n" + GUARD_BLOCK + raw.slice(idx);
  } else {
    // Fallback: prepend the guard at the very top (after the strict directive).
    patched = raw.replace(
      /"use strict";\s*/,
      (m) => `"use strict";\n${GUARD_BLOCK}`
    );
  }

  try {
    fs.writeFileSync(filePath, patched, "utf-8");
    console.log(
      `patch-remote-rebuild: inserted skip guard into ${filePath} (active when FORGE_SKIP_NATIVE_REBUILD=1)`
    );
    return true;
  } catch (err) {
    console.warn(`patch-remote-rebuild: failed to write ${filePath}: ${err}`);
    return false;
  }
}

function run() {
  const filePath = findRemoteRebuildPath();
  if (!filePath) {
    // core-utils not installed — nothing to patch. Fine for production installs.
    return 0;
  }
  patchRemoteRebuild(filePath);
  return 0;
}

if (require.main === module) {
  process.exit(run());
}

module.exports = { run, patchRemoteRebuild, findRemoteRebuildPath };