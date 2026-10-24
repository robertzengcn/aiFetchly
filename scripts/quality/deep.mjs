#!/usr/bin/env node
/**
 * Deep validation command (PRD QG-11/QG-15, AC-14; tech design §7 deep).
 *
 * Sequential, working-tree (NOT index-exact) validation:
 *  1. Typed ESLint (floating/misused promises) over ONLY the files the
 *     root tsconfig covers (BUG-1: parsing a file outside
 *     parserOptions.project is a fatal error). F05: the scope now INCLUDES
 *     the tsconfig's Vue scripts (275 files) and in-project JS — the old
 *     plain-TS enumeration silently skipped both while claiming them "in
 *     scope". Membership is resolved in deep-scope.mjs; files are passed
 *     EXPLICITLY so no directory expansion can pull an out-of-project
 *     file back in.
 *  2. Fast-profile lint over the tooling scripts (not in the tsconfig).
 *  3. `tsc --noEmit` and `vue-tsc --noEmit` via process.execPath + the
 *     real JS entries (BUG-14: spawning `yarn` by name breaks under
 *     shell:false on Windows; .cmd shims are not executable).
 *
 * Stops on first failure; never invokes watch scripts; never runs in the
 * pre-commit hook. The step sequence is exported as data (buildSteps) so
 * orchestration tests can assert order, stop-on-failure, and the absence
 * of watch flags without running the engines.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { resolveTypedScope } = await import('./deep-scope.mjs');

/**
 * The deep pipeline as data (F05). Order is contract: typed lint first,
 * then tooling lint, then tsc, then vue-tsc. No step ever passes a watch
 * flag. Exported for orchestration tests.
 */
export function buildSteps(root, scope) {
  const eslintArgs = (config) => [
    path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js'),
    '--no-eslintrc',
    '--config',
    path.join(root, 'scripts', 'quality', config),
  ];
  // F05: in-project JS joins the typed pass (forge.config.js etc.).
  const typedFiles = [...scope.typedTargets, ...scope.jsInProject];
  const steps = [];
  const CHUNK = 200;
  for (let i = 0; i < typedFiles.length; i += CHUNK) {
    steps.push({
      label: `typed lint ${Math.floor(i / CHUNK) + 1}/${Math.ceil(typedFiles.length / CHUNK)}`,
      command: process.execPath,
      // B06: file operands after the terminator can never be parsed as
      // options — a tracked '-bad.ts' must stay an operand.
      args: [...eslintArgs('eslint-deep.cjs'), '--', ...typedFiles.slice(i, i + CHUNK)],
    });
  }
  steps.push({
    label: 'tooling lint (fast profile)',
    command: process.execPath,
    args: [
      ...eslintArgs('eslint-fast.cjs'),
      '--ext', '.js,.jsx,.cjs,.mjs,.ts,.tsx,.vue',
      '--',
      'scripts',
    ],
  });
  steps.push({
    label: 'typecheck',
    command: process.execPath,
    args: [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'],
  });
  steps.push({
    label: 'vue-typecheck',
    command: process.execPath,
    args: [
      path.join(root, 'node_modules', 'vue-tsc', 'bin', 'vue-tsc.js'),
      '--noEmit', '--incremental', 'false',
    ],
  });
  return steps;
}

/**
 * Sequential stop-on-failure runner (F05). `runStep` executes one step and
 * returns its exit status; returns { failedAt, status } describing where
 * the pipeline stopped (failedAt null when everything passed).
 */
export function runSteps(steps, runStep) {
  for (const step of steps) {
    const status = runStep(step);
    if (status !== 0) return { failedAt: step.label, status };
  }
  return { failedAt: null, status: 0 };
}

function main() {
  process.stdout.write(
    'quality deep: WORKING-TREE typed validation (not an index-exact commit check)\n'
  );

  let scope;
  try {
    scope = resolveTypedScope(repoRoot);
  } catch (e) {
    process.stderr.write(`quality deep: ${e.message}\n`);
    process.exit(2);
  }
  process.stdout.write(
    `typed lint scope: ${scope.typedTargets.length} typed file(s) ` +
      `(${scope.vueTargets.length} .vue script file(s), ${scope.jsInProject.length} in-project JS file(s))\n` +
      'out of typed scope by design: tooling outside the tsconfig (fast-linted below) ' +
      'and tsconfig exclusions (node_modules, test/e2e)\n'
  );

  const outcome = runSteps(
    buildSteps(repoRoot, scope),
    (step) => {
      process.stdout.write(
        `\n--- ${step.label}: ${path.basename(step.command)} ${step.args.join(' ')}\n`
      );
      const result = spawnSync(step.command, step.args, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'inherit',
      });
      return result.status ?? 2;
    }
  );
  if (outcome.failedAt !== null) {
    process.stderr.write(
      `\nquality deep: FAILED at step "${outcome.failedAt}" (exit ${outcome.status}). Later steps were not run.\n`
    );
    process.exit(outcome.status ?? 2);
  }
  process.stdout.write('\nquality deep: all steps passed\n');
  process.exit(0);
}

const invokedAsScript =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main();
}
