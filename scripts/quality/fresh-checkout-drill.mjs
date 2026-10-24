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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * Audit V01 portability: spawning bare 'yarn' breaks under shell:false on
 * Windows (.cmd shim). Drive yarn's JS entry through process.execPath when
 * the clone has one; fall back to the bare name otherwise.
 */
function yarnArgs(sub) {
  const yarnJs = path.join(clone, 'node_modules', 'yarn', 'bin', 'yarn.js');
  return existsSync(yarnJs)
    ? { cmd: process.execPath, args: [yarnJs, ...sub] }
    : { cmd: 'yarn', args: sub };
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
const installCmd = yarnArgs(['install', '--frozen-lockfile', '--ignore-scripts']);
const install = step('yarn install --frozen-lockfile', installCmd.cmd, installCmd.args);
if (install !== 0) {
  // Native rebuilds (better-sqlite3) are not needed for the gate itself.
  fail('yarn install', `exit ${install} — the drill requires a networked environment`);
}
const prepareCmd = yarnArgs(['prepare']);
const prepare = step('yarn prepare (husky)', prepareCmd.cmd, prepareCmd.args, { timeout: 5 * 60_000 });
if (prepare !== 0) fail('yarn prepare', `exit ${prepare} — hook installation failed`);

// 4. Doctor (includes the real-commit rejection probe).
const doctorCmd = yarnArgs(['quality:doctor']);
const doctor = step('yarn quality:doctor', doctorCmd.cmd, doctorCmd.args);
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
