#!/usr/bin/env node
/**
 * Fresh-checkout drill (V04, AC-18): prove the gate installs and enforces
 * from a CLEAN clone with dependencies installed from the lockfile — no
 * symlinked or copied node_modules, no hand-written shims.
 *
 * Steps (each reported, first failure aborts with a nonzero exit):
 *  1. git clone --no-hardlinks <source> into a temp workspace
 *  2. yarn install --frozen-lockfile        (network required — this is a
 *     setup-time operation, never performed by the hook)
 *  3. yarn prepare                          (husky shims)
 *  4. yarn quality:doctor                   (full diagnostics incl. the
 *     real-commit rejection probe)
 *  5. git commit a VALID fixture             (must pass)
 *  6. git commit an INVALID fixture          (must be rejected)
 *
 * Usage: node scripts/quality/fresh-checkout-drill.mjs [source-repo-path]
 * (defaults to this checkout). The clone is kept on failure for inspection
 * and its path printed.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = process.argv[2] ? path.resolve(process.argv[2]) : repoRoot;
const workspace = mkdtempSync(path.join(os.tmpdir(), 'qg-fresh-drill-'));
const clone = path.join(workspace, 'repo');

function step(label, command, args, opts = {}) {
  process.stdout.write(`\n=== ${label}: ${command} ${args.join(' ')}\n`);
  const res = spawnSync(command, args, {
    cwd: clone,
    encoding: 'utf8',
    stdio: 'inherit',
    timeout: opts.timeout ?? 15 * 60_000,
  });
  if (res.error) {
    fail(label, res.error.message);
  }
  return res.status;
}

function fail(label, detail) {
  process.stderr.write(`\nDRILL FAILED at "${label}": ${detail}\n`);
  process.stderr.write(`Clone kept for inspection: ${clone}\n`);
  process.exit(1);
}

process.stdout.write(`fresh-checkout drill\n  source: ${source}\n  clone:  ${clone}\n`);

// 1. Clone
const cloned = spawnSync('git', ['clone', '--no-hardlinks', source, clone], {
  encoding: 'utf8',
  stdio: 'inherit',
});
if (cloned.status !== 0) fail('clone', `git clone exited ${cloned.status}`);

// 2. Install from the lockfile (setup-time network use is expected here).
const install = step('yarn install --frozen-lockfile', 'yarn', [
  'install', '--frozen-lockfile', '--ignore-scripts',
]);
if (install !== 0) {
  // Native rebuilds (better-sqlite3) are not needed for the gate itself.
  fail('yarn install', `exit ${install} — the drill requires a networked environment`);
}
step('yarn prepare (husky)', 'yarn', ['prepare'], { timeout: 5 * 60_000 });

// 4. Doctor (includes the real-commit rejection probe).
const doctor = step('yarn quality:doctor', 'yarn', ['quality:doctor']);
if (doctor !== 0) fail('doctor', `exit ${doctor}`);

// Commit identity for the probe commits.
spawnSync('git', ['config', 'user.email', 'drill@t'], { cwd: clone });
spawnSync('git', ['config', 'user.name', 'drill'], { cwd: clone });

// 5. Valid fixture must commit through the installed hook.
writeFileSync(path.join(clone, 'DrillGood.ts'), 'export const two = 1 + 1;\n');
spawnSync('git', ['add', 'DrillGood.ts'], { cwd: clone });
const good = step('commit valid fixture', 'git', ['commit', '-m', 'drill: valid']);
if (good !== 0) fail('valid commit', `exit ${good} — the gate rejected a clean fixture`);

// 6. Invalid fixture must be REJECTED through the installed hook.
writeFileSync(path.join(clone, 'DrillBad.ts'), 'export const v: any = 1;\n');
spawnSync('git', ['add', 'DrillBad.ts'], { cwd: clone });
const bad = step('commit invalid fixture (expected to fail)', 'git', [
  'commit', '-m', 'drill: invalid',
]);
if (bad === 0) fail('invalid commit', 'exit 0 — the gate ACCEPTED an invalid fixture!');

process.stdout.write('\nDRILL PASSED: fresh checkout installs and enforces the gate.\n');
rmSync(workspace, { recursive: true, force: true });
process.exit(0);
