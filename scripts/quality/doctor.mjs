#!/usr/bin/env node
/**
 * Installation and configuration diagnostics (PRD QG-11, AC-18).
 *
 * Checks: Node version, pinned dependencies, config/profile loadability,
 * Husky hooksPath, the committed hook file, and a fixture rejection probe
 * (invalid code in a temp file — never committed). Read-only except for a
 * temp directory it creates under the OS tmpdir and removes.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const checks = [];
function check(name, ok, detail, fixHint) {
  checks.push({ name, ok, detail, fixHint });
}

// Node engine
const nodeMajor = Number(process.versions.node.split('.')[0]);
check('node', nodeMajor >= 22, `Node ${process.versions.node}`, 'Install Node >= 22');

// Pinned dependencies
for (const dep of [
  'eslint',
  'eslint-plugin-sonarjs',
  'eslint-plugin-vue',
  'vue-eslint-parser',
  '@typescript-eslint/parser',
  'lint-staged',
]) {
  let ok = false;
  let detail = 'not resolvable';
  try {
    const pkg = require(`${dep}/package.json`, { paths: [repoRoot] });
    ok = true;
    detail = `${dep}@${pkg.version}`;
    if (dep === 'eslint-plugin-sonarjs' && pkg.version !== '1.0.4') {
      ok = false;
      detail += ' (expected EXACT 1.0.4)';
    }
  } catch {
    /* detail already set */
  }
  check(`dependency:${dep}`, ok, detail, 'Run `yarn install` from the repository root');
}

// Profiles load
for (const profile of ['eslint-fast.cjs', 'policy.cjs', 'rules/index.cjs']) {
  try {
    require(path.join(repoRoot, 'scripts', 'quality', profile));
    check(`profile:${profile}`, true, 'loads');
  } catch (e) {
    check(`profile:${profile}`, false, e.message, 'Fix the profile; the hook fails closed on load errors');
  }
}

// Exception manifest
try {
  const manifest = JSON.parse(
    readFileSync(path.join(repoRoot, 'scripts', 'quality', 'exceptions.json'), 'utf8')
  );
  check(
    'exceptions.json',
    manifest.schemaVersion === 1 && Array.isArray(manifest.exceptions),
    `${manifest.exceptions.length} reviewed exception(s)`
  );
} catch (e) {
  check('exceptions.json', false, e.message, 'Restore or fix the manifest (schemaVersion 1)');
}

// Husky hook wiring
const hooksPath = spawnSync('git', ['config', 'core.hooksPath'], {
  cwd: repoRoot,
  encoding: 'utf8',
});
const hooksValue = (hooksPath.stdout || '').trim();
check(
  'husky:core.hooksPath',
  hooksValue === '.husky',
  `core.hooksPath=${hooksValue || '(unset)'}`,
  'Run `yarn prepare` (husky) to install the hook directory'
);
const hookFile = path.join(repoRoot, '.husky', 'pre-commit');
if (existsSync(hookFile)) {
  const content = readFileSync(hookFile, 'utf8');
  check(
    'husky:pre-commit',
    content.includes('scripts/quality/pre-commit.mjs'),
    content.trim().split('\n')[0],
    'The hook should be: node scripts/quality/pre-commit.mjs'
  );
} else {
  check('husky:pre-commit', false, '.husky/pre-commit missing', 'Run `yarn prepare`');
}

// Fixture rejection probe: invalid code must be REJECTED (fail closed proof).
let probeOk = false;
let probeDetail = 'probe did not run';
const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'quality-doctor-'));
try {
  const fixture = path.join(repoRoot, 'tmp-quality-doctor-fixture.ts');
  writeFileSync(
    fixture,
    "export function dup(v: boolean): string {\n  if (v) { return 'same'; } else { return 'same'; }\n}\n"
  );
  const run = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'quality', 'lint-files.mjs'), 'tmp-quality-doctor-fixture.ts'],
    { cwd: repoRoot, encoding: 'utf8', timeout: 60_000 }
  );
  rmSync(fixture, { force: true });
  probeOk = run.status === 1;
  probeDetail =
    run.status === 1
      ? 'invalid fixture correctly rejected'
      : `exit ${run.status} (expected 1)`;
} catch (e) {
  probeDetail = e.message;
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
check('probe:duplicated-branches', probeOk, probeDetail, 'The runner must reject a duplicated-branch fixture (exit 1)');

// Report
let failures = 0;
for (const c of checks) {
  const mark = c.ok ? 'ok  ' : 'FAIL';
  if (!c.ok) failures += 1;
  console.log(`[${mark}] ${c.name} — ${c.detail}`);
  if (!c.ok && c.fixHint) console.log(`        fix: ${c.fixHint}`);
}
console.log(
  failures === 0
    ? '\nquality doctor: all checks passed'
    : `\nquality doctor: ${failures} check(s) failed`
);
process.exit(failures === 0 ? 0 : 2);
