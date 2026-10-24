/**
 * Doctor tests (F13): the diagnostics must catch a missing shim FILE (an
 * empty shim directory used to pass), and the decisive real-commit probe
 * must fail when Git cannot execute the hook wiring.
 *
 * Doctor derives its repo root from its own location, so each case runs
 * the COPY of doctor.mjs inside a disposable repo wired to this checkout.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const realRepo = process.cwd();
const { createDisposableGateRepo } = await import(
  pathToFileURL(path.join(realRepo, 'scripts', 'quality', 'disposable-gate.mjs')).href
);

const sandboxes = [];
function makeRepo(name) {
  const repo = createDisposableGateRepo(realRepo, `doctor-${name}`);
  sandboxes.push(repo.root);
  return repo;
}
after(() => {
  for (const s of sandboxes) rmSync(s, { recursive: true, force: true });
});

function runDoctor(root) {
  return spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'quality', 'doctor.mjs')],
    { cwd: root, encoding: 'utf8', timeout: 240_000 }
  );
}

describe('doctor diagnostics (F13)', () => {
  test('a missing pre-commit shim file fails the husky:shims check', () => {
    const repo = makeRepo('missing-shim');
    rmSync(path.join(repo.root, '.husky', '_', 'pre-commit'));
    const res = runDoctor(repo.root);
    assert.equal(res.status, 2, 'doctor must fail without the executable shim');
    assert.match(res.stdout, /FAIL\] husky:shims/);
  });

  test('a non-executable shim file fails the husky:shims check (POSIX)', { skip: process.platform === 'win32' }, () => {
    const repo = makeRepo('nonexec-shim');
    const shim = path.join(repo.root, '.husky', '_', 'pre-commit');
    spawnSync('chmod', ['-x', shim]);
    const res = runDoctor(repo.root);
    assert.equal(res.status, 2, 'doctor must fail when the shim is not executable');
    assert.match(res.stdout, /FAIL\] husky:shims/);
    assert.match(res.stdout, /NOT executable/);
  });

  test('a hook file that only COMMENTS about the coordinator fails husky:pre-commit', () => {
    const repo = makeRepo('comment-hook');
    const repo_husky = path.join(repo.root, '.husky', 'pre-commit');
    // The disposable repo has no user-level .husky/pre-commit (only the
    // shim); write one that mentions the coordinator only in a comment.
    writeFileSync(repo_husky, '# TODO node scripts/quality/pre-commit.mjs\ntrue\n');
    const res = runDoctor(repo.root);
    assert.equal(res.status, 2);
    assert.match(res.stdout, /FAIL\] husky:pre-commit/);
  });

  test('a semantically invalid manifest fails the exceptions check', () => {
    const repo = makeRepo('bad-manifest');
    // Wildcard ruleId passes JSON shape checks but fails the real validator.
    writeFileSync(
      path.join(repo.root, 'scripts', 'quality', 'exceptions.json'),
      JSON.stringify({
        schemaVersion: 1,
        exceptions: [{ path: 'A.ts', ruleId: 'sonarjs/*', maxCount: 1, reason: 'x', owner: 'm', expiresOn: '2099-01-01' }],
      })
    );
    const res = runDoctor(repo.root);
    assert.equal(res.status, 2);
    assert.match(res.stdout, /FAIL\] exceptions\.json/);
  });
});

describe('audit 2026-10-24 fix (B02)', () => {
  test('a comment-only no-op shim fails the shim-content check', () => {
    const repo = makeRepo('b02-noop-shim');
    writeFileSync(
      path.join(repo.root, '.husky', '_', 'pre-commit'),
      '#!/bin/sh\n# husky runner\nexit 0\n'
    );
    spawnSync('chmod', ['+x', path.join(repo.root, '.husky', '_', 'pre-commit')]);
    const res = runDoctor(repo.root);
    assert.equal(res.status, 2);
    assert.match(res.stdout, /FAIL\] husky:shim-content/);
    assert.match(res.stdout, /never invokes the husky runner/);
  });
});
