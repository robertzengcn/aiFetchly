/**
 * Audit command tests (F11): the report core's inventory/tightening
 * semantics, plus a disposable-repo integration proving ROOT-LEVEL
 * tooling files (outside src/test/scripts) enter the audit inventory.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
import {
  mkdirSync, writeFileSync, rmSync, cpSync, symlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const { buildAuditReport } = await import(
  pathToFileURL(path.join(repoRoot, 'scripts', 'quality', 'audit-core.mjs')).href
);

/** Shared complexity-finding factory (both complexity tests use it). */
const cx = (v, line) => ({
  path: 'src/B.ts',
  ruleId: 'sonarjs/cognitive-complexity',
  severity: 2,
  line,
  column: 1,
  message: `Refactor this function to reduce its Cognitive Complexity from ${v} to the 15 allowed.`,
});

const f = (over = {}) => ({
  path: 'src/A.ts',
  ruleId: '@typescript-eslint/no-explicit-any',
  severity: 2,
  fatal: false,
  line: 1,
  column: 1,
  message: 'Unexpected any.',
  ...over,
});
const ENTRY = (over = {}) => ({
  path: 'src/A.ts',
  ruleId: '@typescript-eslint/no-explicit-any',
  maxCount: 5,
  reason: 'legacy',
  owner: 'maintainer',
  expiresOn: '2099-01-01',
  ...over,
});

describe('audit report core (F11)', () => {
  test('nonzero count reductions are tightening candidates', () => {
    const report = buildAuditReport(
      [f(), f({ line: 2 }), f({ line: 3 })], // 3 findings vs maxCount 5
      { exceptions: [ENTRY()] },
      new Set(['src/A.ts'])
    );
    assert.ok(report.tightening.some((t) => t.kind === 'count' && t.detail.includes('5 -> 3')));
    assert.equal(report.stale.length, 0);
  });

  test('stale entries distinguish deleted files from rules that stopped firing', () => {
    const gone = buildAuditReport([], { exceptions: [ENTRY()] }, new Set([]));
    assert.equal(gone.stale[0].reason, 'file is not in the audited inventory (deleted or excluded)');
    const stopped = buildAuditReport([], { exceptions: [ENTRY()] }, new Set(['src/A.ts']));
    assert.equal(stopped.stale[0].reason, 'rule no longer fires on this file');
  });

  test('fatal / no-rule findings are code defects, never drafted', () => {
    const report = buildAuditReport(
      [f({ fatal: true, ruleId: null, message: 'Parsing error: ;' }), f()],
      { exceptions: [] },
      new Set(['src/A.ts'])
    );
    assert.ok(report.codeDefects.some((d) => d.fatal === true));
    // The ordinary finding IS drafted; the fatal one is not.
    assert.equal(report.draft.length, 1);
    assert.equal(report.draft[0].ruleId, '@typescript-eslint/no-explicit-any');
  });

  test('complexity drafts carry per-function identities and consistent aggregates', () => {
    const report = buildAuditReport([cx(30, 10), cx(20, 40)], { exceptions: [] }, new Set(['src/B.ts']));
    assert.equal(report.draft.length, 1);
    const d = report.draft[0];
    assert.equal(d.maxCount, 2);
    assert.deepEqual(d.functions, [
      { line: 10, column: 1, maxComplexity: 30 },
      { line: 40, column: 1, maxComplexity: 20 },
    ]);
    assert.equal(d.maxComplexity, 30);
    assert.equal(d.maxTotalComplexity, 50);
  });

  test('complexity easing and vanished functions are tightening candidates', () => {
    const entry = ENTRY({
      path: 'src/B.ts',
      ruleId: 'sonarjs/cognitive-complexity',
      maxCount: 2,
      maxComplexity: 30,
      maxTotalComplexity: 50,
      functions: [
        { line: 10, column: 1, maxComplexity: 30 },
        { line: 40, column: 1, maxComplexity: 20 },
      ],
    });
    // First function eased 30 -> 25; second function deleted.
    const report = buildAuditReport([cx(25, 10)], { exceptions: [entry] }, new Set(['src/B.ts']));
    assert.ok(report.tightening.some((t) => t.kind === 'function-ceiling' && t.detail.includes('30 -> 25')));
    assert.ok(report.tightening.some((t) => t.kind === 'function-gone'));
    assert.ok(report.tightening.some((t) => t.kind === 'count' && t.detail.includes('2 -> 1')));
    assert.ok(report.tightening.some((t) => t.kind === 'aggregate' && t.detail.includes('50 -> 25')));
    // Ceiling breach detection (would block when touched).
    const worse = buildAuditReport([cx(35, 10), cx(20, 40)], { exceptions: [entry] }, new Set(['src/B.ts']));
    assert.ok(worse.ceilingExceeded.some((c) => c.detail.includes('observed 35 > allowed 30')));
  });
});

// ---------------------------------------------------------------------------
// Integration: root-level tooling enters the inventory (disposable repo)
// ---------------------------------------------------------------------------

const realRepo = repoRoot;
const sandbox = path.join(os.tmpdir(), `qg-audit-${process.pid}`);

function setupDisposable() {
  rmSync(sandbox, { recursive: true, force: true });
  mkdirSync(sandbox, { recursive: true });
  const git = (args) => execSync(`git ${args}`, { cwd: sandbox, encoding: 'utf8', stdio: 'pipe' });
  git('init -q');
  git('config user.email t@t'); git('config user.name t');
  cpSync(path.join(realRepo, 'scripts'), path.join(sandbox, 'scripts'), { recursive: true });
  cpSync(path.join(realRepo, '.eslintrc.json'), path.join(sandbox, '.eslintrc.json'));
  symlinkSync(path.join(realRepo, 'node_modules'), path.join(sandbox, 'node_modules'), 'dir');
  writeFileSync(
    path.join(sandbox, 'scripts', 'quality', 'exceptions.json'),
    JSON.stringify({ schemaVersion: 1, exceptions: [] })
  );
  // ROOT-level tooling file with a blocker — outside src/test/scripts.
  writeFileSync(
    path.join(sandbox, 'root-tool.config.js'),
    'function answer() {\n  if (1 === 1) {\n    if (1 === 1) {\n      if (1 === 1) {\n        if (1 === 1) {\n          if (1 === 1) {\n            if (1 === 1) {\n              if (1 === 1) {\n                return 42;\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n  return 0;\n}\nmodule.exports = { answer };\n'
  );
  git('add root-tool.config.js scripts .eslintrc.json');
  git('commit -q -m seed');
  return { git };
}

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('audit inventory integration (F11)', () => {
  test('a root-level tooling file is inventoried and drafted', () => {
    setupDisposable();
    const res = spawnSync(
      process.execPath,
      [path.join(sandbox, 'scripts', 'quality', 'audit.mjs'), '--json'],
      { cwd: sandbox, encoding: 'utf8', timeout: 240_000, maxBuffer: 64 * 1024 * 1024 }
    );
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const doc = JSON.parse(res.stdout);
    assert.equal(doc.schema, 'quality-gate-audit/1');
    const drafted = doc.draftEntries.filter((e) => e.path === 'root-tool.config.js');
    assert.ok(
      drafted.some((e) => e.ruleId === 'sonarjs/cognitive-complexity'),
      `root tooling must be drafted, got: ${JSON.stringify(doc.draftEntries.map((e) => e.path + '::' + e.ruleId))}`
    );
    assert.ok(doc.inventoryFiles >= 1);
  });
});
