/**
 * Reporting contract tests (F10; tech design §10).
 *
 * The --json document must carry structured findings for WARNINGS (not
 * just a count), per-blocker severity, detailed ACCEPTED DEBT (not just a
 * number), populated operationalErrors on failure paths, and a mode field
 * distinguishing staged coordinator execution from direct working-tree
 * invocation. Human output stays capped with a reliable full-output
 * pointer.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const fixtureDir = path.join(repoRoot, 'tmp-quality-report');

before(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
  mkdirSync(fixtureDir, { recursive: true });
  // Missing return type = advisory WARNING under the fast profile.
  writeFileSync(
    path.join(fixtureDir, 'Mixed.ts'),
    'export function double(x: number) {\n  return x * 2;\n}\n'
  );
  writeFileSync(path.join(fixtureDir, 'Bad.ts'), 'export const v: any = 1;\n');
});

after(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

function runRunner(args, env = {}) {
  const res = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'quality', 'lint-files.mjs'), ...args],
    { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, ...env } }
  );
  return res;
}

function parseJson(stdout) {
  return JSON.parse(stdout);
}

describe('JSON reporting (F10)', () => {
  test('warnings are structured findings with rule/location/message', () => {
    const res = runRunner(['--json', path.join('tmp-quality-report', 'Mixed.ts')]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const doc = parseJson(res.stdout);
    assert.equal(doc.schema, 'quality-gate/1');
    assert.equal(doc.mode, 'working-tree-fast', 'direct invocation is working-tree');
    assert.ok(doc.warningCount >= 1, 'expected the missing return type as a warning');
    const warn = doc.warnings.find(
      (w) => w.ruleId === '@typescript-eslint/explicit-function-return-type'
    );
    assert.ok(warn, JSON.stringify(doc.warnings));
    assert.equal(typeof warn.line, 'number');
    assert.equal(typeof warn.column, 'number');
    assert.ok(warn.message.length > 0);
  });

  test('blockers carry a severity field; stdout stays pure JSON', () => {
    const res = runRunner(['--json', path.join('tmp-quality-report', 'Bad.ts')]);
    assert.equal(res.status, 1);
    const doc = parseJson(res.stdout);
    assert.equal(doc.blockerCount, 1);
    assert.equal(doc.blockers[0].severity, 2);
    assert.equal(doc.blockers[0].ruleId, '@typescript-eslint/no-explicit-any');
    assert.ok((doc.blockers[0].path || '').includes('Bad.ts'));
  });

  test('staged coordinator execution is distinguished by mode', () => {
    const res = runRunner(['--json', path.join('tmp-quality-report', 'Mixed.ts')], {
      QUALITY_GATE_CONTEXT: 'lint-staged',
    });
    assert.equal(res.status, 0);
    const doc = parseJson(res.stdout);
    assert.equal(doc.mode, 'staged-fast');
  });

  test('operational failures still emit a versioned JSON document', () => {
    const res = runRunner(['--json', '../../outside-repo.ts']);
    assert.equal(res.status, 2);
    const doc = parseJson(res.stdout);
    assert.equal(doc.schema, 'quality-gate/1');
    assert.equal(doc.operationalErrors.length, 1);
    assert.match(doc.operationalErrors[0], /boundary|outside the repository/);
    assert.equal(doc.blockerCount, 0);
  });
});

describe('human reporting (F10)', () => {
  test('capped human output summarizes warnings', () => {
    const res = runRunner([path.join('tmp-quality-report', 'Mixed.ts')]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /warning\(s\)/);
  });
});
