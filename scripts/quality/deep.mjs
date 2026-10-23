#!/usr/bin/env node
/**
 * Deep validation command (PRD QG-11/QG-15, AC-14; tech design §7 deep).
 *
 * Sequential, working-tree (NOT index-exact) validation:
 *  1. Typed ESLint (floating/misused promises) over ONLY the files the
 *     root tsconfig includes (BUG-1: parsing a file outside
 *     parserOptions.project is a fatal error, so a blanket directory pass
 *     could never finish). Membership is resolved through the TypeScript
 *     compiler API — the same rule ts-eslint applies — and the excluded
 *     JS/MJS files are reported on an explicit scope line.
 *  2. Fast-profile lint over the tooling scripts (not in the tsconfig).
 *  3. `tsc --noEmit` and `vue-tsc --noEmit` via process.execPath + the
 *     real JS entries (BUG-14: spawning `yarn` by name breaks under
 *     shell:false on Windows; .cmd shims are not executable).
 *
 * Stops on first failure; never invokes watch scripts; never runs in the
 * pre-commit hook.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { resolveTypedScope } = await import('./deep-scope.mjs');

function fail(label, status) {
  process.stderr.write(
    `\nquality deep: FAILED at step "${label}" (exit ${status}). Later steps were not run.\n`
  );
  process.exit(status ?? 2);
}

function runStep(label, command, args) {
  process.stdout.write(`\n--- ${label}: ${path.basename(command)} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) fail(label, result.status);
}

process.stdout.write(
  'quality deep: WORKING-TREE typed validation (not an index-exact commit check)\n'
);

// --- Step 1 scope resolution (BUG-1) --------------------------------------
// Typed rules may only run on tsconfig-included files; anything else (shim
// .js under src, .mjs tooling) is reported as explicitly out of scope.
let scope;
try {
  scope = resolveTypedScope(repoRoot);
} catch (e) {
  process.stderr.write(`quality deep: ${e.message}\n`);
  process.exit(2);
}
const typedTargets = scope.typedTargets;

const eslintArgs = (config) => [
  path.join(repoRoot, 'node_modules', 'eslint', 'bin', 'eslint.js'),
  '--no-eslintrc',
  '--config',
  path.join(repoRoot, 'scripts', 'quality', config),
];

// Typed pass: tsconfig member files only, passed EXPLICITLY so no
// directory expansion can pull an out-of-project file back in.
const typedSkippedJs = scope.jsInProject.length;
process.stdout.write(
  `typed lint: ${typedTargets.length} tsconfig-included file(s)` +
    (typedSkippedJs > 0 ? `; ${typedSkippedJs} in-project JS file(s) also in scope` : '') +
    '; out-of-project JS/MJS (e.g. src/childprocess/electron-shim) is NOT in typed scope\n'
);
if (typedTargets.length > 0) {
  // Chunk to stay under argv limits on large trees.
  const CHUNK = 200;
  for (let i = 0; i < typedTargets.length; i += CHUNK) {
    runStep(
      `typed lint ${Math.floor(i / CHUNK) + 1}/${Math.ceil(typedTargets.length / CHUNK)}`,
      process.execPath,
      [...eslintArgs('eslint-deep.cjs'), ...typedTargets.slice(i, i + CHUNK)]
    );
  }
}

// --- Step 2: tooling scripts under the fast profile ------------------------
runStep('tooling lint (fast profile)', process.execPath, [
  ...eslintArgs('eslint-fast.cjs'),
  '--ext', '.js,.jsx,.cjs,.mjs,.ts,.tsx,.vue',
  'scripts',
]);

// --- Step 3: type checks via real JS entries (BUG-14) ----------------------
runStep('typecheck', process.execPath, [
  path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
  '--noEmit',
]);
runStep('vue-typecheck', process.execPath, [
  path.join(repoRoot, 'node_modules', 'vue-tsc', 'bin', 'vue-tsc.js'),
  '--noEmit', '--incremental', 'false',
]);

process.stdout.write('\nquality deep: all steps passed\n');
process.exit(0);
