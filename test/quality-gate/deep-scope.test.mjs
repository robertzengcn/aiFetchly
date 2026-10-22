/**
 * Deep-pass scope tests (BUG-1 done-when): a fixture tree with one
 * in-project TS file and one out-of-project JS file resolves exactly the
 * TS file into the typed scope and leaves the JS file out with an explicit
 * report. Also asserts the REAL repo scope excludes the electron shim.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const { resolveTypedScope } = await import(
  pathToFileURL(path.join(repoRoot, 'scripts', 'quality', 'deep-scope.mjs')).href
);

const fixtureRoot = path.join(repoRoot, 'tmp-quality-fixtures', 'deep-scope-repo');

before(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
  mkdirSync(path.join(fixtureRoot, 'src'), { recursive: true });
  writeFileSync(
    path.join(fixtureRoot, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { allowJs: false, noEmit: true },
      include: ['src/**/*.ts'],
    })
  );
  writeFileSync(path.join(fixtureRoot, 'src', 'InProject.ts'), 'export const a = 1;\n');
  // Out of project: .js under src (include is *.ts only) and .mjs tooling.
  writeFileSync(path.join(fixtureRoot, 'src', 'OutOfProject.js'), 'export const b = 1;\n');
  writeFileSync(path.join(fixtureRoot, 'tool.mjs'), 'export const c = 1;\n');
});

after(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('deep scope resolution (BUG-1)', () => {
  test('in-project TS in typed scope; out-of-project JS/MJS out, reported', () => {
    const scope = resolveTypedScope(fixtureRoot);
    assert.ok(scope.typedTargets.includes('src/InProject.ts'), JSON.stringify(scope.typedTargets));
    assert.ok(!scope.typedTargets.includes('src/OutOfProject.js'));
    assert.ok(!scope.typedTargets.includes('tool.mjs'));
    // Out-of-project files are not in `included` at all — the explicit
    // scope line in deep.mjs reports this exclusion.
    assert.ok(!scope.included.has('src/OutOfProject.js'));
    assert.ok(!scope.included.has('tool.mjs'));
  });

  test('in-project JS (allowJs) would land in jsInProject, not typedTargets', () => {
    writeFileSync(
      path.join(fixtureRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { allowJs: true, noEmit: true },
        include: ['src/**/*.ts', 'src/**/*.js'],
      })
    );
    const scope = resolveTypedScope(fixtureRoot);
    assert.ok(scope.jsInProject.includes('src/OutOfProject.js'));
    assert.ok(!scope.typedTargets.includes('src/OutOfProject.js'));
  });

  test('real repo: the electron shim is excluded from typed scope', () => {
    const scope = resolveTypedScope(repoRoot);
    assert.ok(
      !scope.typedTargets.includes('src/childprocess/electron-shim/electron.js'),
      'electron.js must not be in typed scope (BUG-1 fatal source)'
    );
    assert.ok(scope.typedTargets.length > 1000, 'real tree resolves a large scope');
  });

  test('missing tsconfig throws an operational error', () => {
    // Outside the repo: findConfigFile climbs PARENT directories, so an
    // empty dir inside the repo would find the repo's own tsconfig.
    const empty = mkdtempSync(path.join(os.tmpdir(), 'qg-no-tsconfig-'));
    try {
      assert.throws(() => resolveTypedScope(empty), /tsconfig\.json not found/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
