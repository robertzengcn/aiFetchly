/**
 * Disposable gate-wired repository builder (F13) — shared by the doctor's
 * real-commit probe and the integration test suite so both exercise the
 * SAME wiring: a real `git init` repo whose hook invokes this checkout's
 * pre-commit coordinator against ITS tree (the coordinator resolves
 * repoRoot from its own location, so each fixture repo gets a copy of
 * scripts/quality + .eslintrc.json and a node_modules SYMLINK to the real
 * checkout — dependencies are never installed).
 *
 * The gate files are seed-committed with the hook disabled first: the
 * coordinator rejects UNTRACKED policy-control inputs (F02), so the
 * harness's own copied tree must be committed before any gated commit.
 */

import { execSync, spawnSync } from 'node:child_process';
import {
  mkdirSync, writeFileSync, rmSync, cpSync, symlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * @param {string} realRepo absolute path of the checkout providing the gate
 * @param {string} name sandbox suffix (unique per probe/test)
 * @returns {{ root: string, git: (args: string) => string, run: (args: string[]) => import('node:child_process').SpawnSyncReturns }}
 */
export function createDisposableGateRepo(realRepo, name) {
  const root = path.join(os.tmpdir(), `qg-gate-${name}-${process.pid}-${Date.now()}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const git = (args) => execSync(`git ${args}`, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  git('init -q');
  git('config user.email t@t');
  git('config user.name t');
  git('config core.hooksPath .husky/_');
  cpSync(path.join(realRepo, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  cpSync(path.join(realRepo, '.eslintrc.json'), path.join(root, '.eslintrc.json'));
  cpSync(path.join(realRepo, 'tsconfig.json'), path.join(root, 'tsconfig.json'));
  // V04 portability: a Windows directory symlink needs privileges — use a
  // junction there, a plain symlink elsewhere.
  const nodeModulesLink = path.join(root, 'node_modules');
  if (process.platform === 'win32') {
    symlinkSync(path.join(realRepo, 'node_modules'), nodeModulesLink, 'junction');
  } else {
    symlinkSync(path.join(realRepo, 'node_modules'), nodeModulesLink, 'dir');
  }
  writeFileSync(
    path.join(root, 'scripts', 'quality', 'exceptions.json'),
    JSON.stringify({ schemaVersion: 1, exceptions: [] })
  );
  mkdirSync(path.join(root, '.husky', '_'), { recursive: true });
  writeFileSync(
    path.join(root, '.husky', '_', 'pre-commit'),
    '#!/usr/bin/env sh\nnode "$PWD/scripts/quality/pre-commit.mjs"\n'
  );
  if (process.platform !== 'win32') {
    // POSIX shim must be executable; Windows git-for-windows shims do not
    // use the x bit.
    spawnSync('chmod', ['+x', path.join(root, '.husky', '_', 'pre-commit')]);
  }
  // Seed-commit the gate itself with hooks disabled (see header). The
  // "disabled" target is an EMPTY DIRECTORY — /dev/null is not portable
  // (V04) and an empty hooks dir means git finds no hooks anywhere.
  mkdirSync(path.join(root, '.husky-disabled'), { recursive: true });
  git('config core.hooksPath .husky-disabled');
  git('add scripts .eslintrc.json tsconfig.json');
  git('commit -q -m "seed gate"');
  git('config core.hooksPath .husky/_');
  return {
    root,
    git,
    run: (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }),
  };
}

/** Remove a disposable repo (safe against double-cleanup). */
export function removeDisposableGateRepo(root) {
  rmSync(root, { recursive: true, force: true });
}
