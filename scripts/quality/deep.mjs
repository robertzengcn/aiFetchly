#!/usr/bin/env node
/**
 * Deep validation command (PRD QG-11/QG-15, AC-14; tech design §7 deep).
 *
 * Sequential, working-tree (NOT index-exact) validation: typed ESLint pass
 * (floating/misused promises) with the deep profile, then the existing
 * non-watch `yarn typecheck` and `yarn vue-typecheck`. Stops on first
 * failure; never invokes watch scripts; never runs in the pre-commit hook.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function runStep(label, command, args) {
  process.stdout.write(`\n${
    String.fromCharCode(0x2500).repeat(3)
  } ${label}: ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.stderr.write(`\nquality deep: FAILED at step "${label}" (exit ${result.status}). Later steps were not run.\n`);
    process.exit(result.status ?? 2);
  }
}

process.stdout.write(
  'quality deep: WORKING-TREE typed validation (not an index-exact commit check)\n'
);

// 1. Typed ESLint over the source tree (deep profile). The deep profile
//    extends the fast profile and adds parser services; the ESLint CLI with
//    --no-eslintrc keeps discovery explicit.
runStep('typed lint', path.join(repoRoot, 'node_modules', '.bin', 'eslint'), [
  '--no-eslintrc',
  '--config',
  path.join(repoRoot, 'scripts', 'quality', 'eslint-deep.cjs'),
  '--ext',
  '.js,.jsx,.cjs,.mjs,.ts,.tsx,.vue',
  'src',
  'test',
  'scripts',
]);

// 2/3. Existing non-watch type checks.
runStep('typecheck', 'yarn', ['typecheck']);
runStep('vue-typecheck', 'yarn', ['vue-typecheck']);

process.stdout.write('\nquality deep: all steps passed\n');
process.exit(0);
