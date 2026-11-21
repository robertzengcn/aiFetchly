/**
 * Local AST architecture rules for the quality gate (tech design §8).
 *
 * Both rules inspect DIRECT imports only: ES import/export declarations,
 * require() calls, and literal dynamic imports. `@/` aliases and relative
 * paths are normalized lexically against the importing file — no module
 * execution, no resolution through node_modules. Type-only imports of
 * entityTypes and `import type` entity imports are allowed where they cannot
 * initialize persistence.
 *
 * Release-one limitation (documented in docs/development/local-quality-gate.md):
 * these rules do not prove transitive reachability — a worker importing a
 * shared module that itself imports a model still passes. A dependency-graph
 * audit covers that later.
 */

const path = require('path');

/** Prohibited direct dependencies for workers (src/childprocess/**). */
const WORKER_PROHIBITED = [
  'src/model',
  'src/entity',
  'src/config/SqliteDb',
  'typeorm',
  'better-sqlite3',
  'sqlite3',
];

/** Prohibited direct dependencies for IPC handlers. */
const IPC_PROHIBITED = [
  'src/model',
  'src/entity',
  'src/config/SqliteDb',
  'typeorm',
  'better-sqlite3',
  'sqlite3',
];

/** Always-permitted prefixes: type surfaces cannot initialize persistence. */
const ALLOWED_PREFIXES = ['src/entityTypes'];

/**
 * Normalize a specifier (`@/modules/X`, `./Y`, `Z`) to a repository-relative
 * path WITHOUT extension when it targets repo source, or null for bare
 * module specifiers (returned as-is for package comparison).
 */
function classifySpecifier(rawSpecifier, importerRepoPath) {
  const spec = rawSpecifier;
  if (spec.startsWith('@/')) {
    // The repo's vite/tsconfig alias maps @/ -> src/, so the normalized
    // repo path is 'src/' + the rest — matching the src/-rooted prohibited
    // prefixes regardless of where the importing file lives. The result is
    // NORMALIZED exactly like the relative form: without this,
    // '@/entityTypes/../model/Foo' kept the allowed entityTypes prefix and
    // concealed its src/model destination (F06).
    return { kind: 'repo', repoPath: path.posix.normalize('src/' + spec.slice(2)) };
  }
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const importerDir = path.posix.dirname(importerRepoPath);
    const joined = path.posix.normalize(path.posix.join(importerDir, spec));
    return { kind: 'repo', repoPath: joined };
  }
  return { kind: 'package', name: spec };
}

/**
 * Does a normalized repo path (extension-less) fall under a prohibited repo
 * prefix while not being in an allowed prefix?
 */
function repoPathMatches(repoPath, prohibitedRepoPrefix) {
  if (ALLOWED_PREFIXES.some((p) => repoPath === p || repoPath.startsWith(p + '/'))) {
    return false;
  }
  if (
    repoPath === prohibitedRepoPrefix ||
    repoPath.startsWith(prohibitedRepoPrefix + '/')
  ) {
    return true;
  }
  // BUG-7: a FILE-prefix prohibition (e.g. src/config/SqliteDb) must also
  // match the same path spelled WITH an extension or an index segment —
  // tech design §8 "compare normalized repository paths, including
  // explicit extension and index-file variants".
  // F06: extension/index matching runs ONLY after a real stem-prefix
  // match. The old code sliced by prefix LENGTH without requiring the
  // prefix to match at all, so the unrelated `src/utils.ts` "matched"
  // `src/model` (same stem length) and was falsely rejected.
  if (!repoPath.startsWith(prohibitedRepoPrefix)) {
    return false;
  }
  const rest = repoPath.slice(prohibitedRepoPrefix.length);
  if (rest === '/index' || /^\/index\.[A-Za-z0-9]+$/.test(rest)) {
    // src/config/SqliteDb/index.ts (directory-module form)
    return true;
  }
  if (rest.length > 0 && rest[0] === '.') {
    // src/config/SqliteDb.ts / .js / .tsx — but NOT src/config/SqliteDbFoo
    return /^\.[A-Za-z0-9]+$/.test(rest);
  }
  return false;
}

function isProhibited(specifier, importerRepoPath, prohibitedRepoPrefixes, prohibitedPackages) {
  const classified = classifySpecifier(specifier, importerRepoPath);
  if (classified.kind === 'package') {
    // Compare the package root, not a deep import path: `typeorm/foo` still
    // matches `typeorm`.
    const pkgRoot = classified.name.split('/')[0];
    return prohibitedPackages.includes(pkgRoot) || prohibitedPackages.includes(classified.name);
  }
  return prohibitedRepoPrefixes.some((prefix) =>
    repoPathMatches(classified.repoPath, prefix)
  );
}

/**
 * The live checker is scripts/quality/architecture-check.mjs, which imports
 * the normalization helpers (_internals below) and runs its own AST pass.
 * The ESLint-rule form that used to live here was a dead second
 * implementation that could drift from the checker — removed (BUG-18).
 */

const WORKER_REPO_PREFIXES = WORKER_PROHIBITED.filter((p) => p.startsWith('src/'));
const WORKER_PACKAGES = WORKER_PROHIBITED.filter((p) => !p.startsWith('src/'));
const IPC_REPO_PREFIXES = IPC_PROHIBITED.filter((p) => p.startsWith('src/'));
const IPC_PACKAGES = IPC_PROHIBITED.filter((p) => !p.startsWith('src/'));

// Exported for the checker and unit tests: the prohibited lists (single
// source) plus the lexical-normalization helpers the live pass uses.
module.exports = {
  worker: { repoPrefixes: WORKER_REPO_PREFIXES, packages: WORKER_PACKAGES },
  ipc: { repoPrefixes: IPC_REPO_PREFIXES, packages: IPC_PACKAGES },
  _internals: {
    classifySpecifier,
    isProhibited,
    repoPathMatches,
  },
};
