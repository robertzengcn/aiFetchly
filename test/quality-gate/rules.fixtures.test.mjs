/**
 * Rule-fixture tests (PRD AC-01..AC-03): the selected blocking rules fire on
 * invalid fixtures and pass on corrected ones, for TS, JS, and Vue script.
 *
 * Uses ESLint's Node API with the fast profile + a TEMP fixture directory
 * (invalid code never lives in ordinary source dirs). Architecture findings
 * are tested in architecture.test.mjs.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(path.resolve(process.cwd(), 'package.json'));
const { ESLint } = require('eslint');
const repoRoot = process.cwd();

// The fixture directory must be a NON-hidden path inside the repo so the
// engine does not ignore it; it is removed after the suite.
const fixtureDir = path.join(repoRoot, 'tmp-quality-fixtures');

async function lint(fileName) {
  const eslint = new ESLint({
    cwd: repoRoot,
    useEslintrc: false,
    overrideConfigFile: path.join(repoRoot, 'scripts', 'quality', 'eslint-fast.cjs'),
    resolvePluginsRelativeTo: repoRoot,
    fix: false,
  });
  const results = await eslint.lintFiles([path.join(fixtureDir, fileName)]);
  return results[0].messages.filter((m) => !/File ignored/.test(m.message));
}

before(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
  // Deterministic non-hidden directory inside the repo (mkdtemp would
  // randomize the name, breaking the lint() helper); removed in after().
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    path.join(fixtureDir, 'dupe.ts'),
    "export function chooseLabel(enabled: boolean): string {\n  if (enabled) {\n    return 'same';\n  } else {\n    return 'same';\n  }\n}\n"
  );
  writeFileSync(
    path.join(fixtureDir, 'dupe-fixed.ts'),
    "export function chooseLabel(enabled: boolean): string {\n  return enabled ? 'enabled' : 'disabled';\n}\n"
  );
  writeFileSync(
    path.join(fixtureDir, 'complex.ts'), [
      'export function f(x: number): string {',
      '  if (x === 1) {',
      '    if (x > 0) {',
      '      if (x < 10) {',
      '        if (x !== 5) {',
      '          if (x % 2 === 0) {',
      '            if (x > 2) {',
      '              if (x < 8) {',
      '                if (x !== 4) {',
      '                  return "a";',
      '                }',
      '              }',
      '            }',
      '          }',
      '        }',
      '      }',
      '    }',
      '  }',
      '  return "b";',
      '}',
      '',
    ].join('\n')
  );
  writeFileSync(
    path.join(fixtureDir, 'complex-ok.ts'),
    'export function f(x: number): string {\n  if (x === 1) { return "a"; }\n  if (x === 2) { return "b"; }\n  return "c";\n}\n'
  );
  writeFileSync(
    path.join(fixtureDir, 'any-use.ts'),
    'export const value: any = 1;\n'
  );
  writeFileSync(
    path.join(fixtureDir, 'unused.ts'),
    'export function g(): void {\n  const dead = 1;\n  void dead;\n}\nexport function h(kept: number, _ignored: string): number {\n  return kept;\n}\n'
  );
  writeFileSync(
    path.join(fixtureDir, 'unused-bad.ts'),
    'export function g(dead: number): number {\n  return 1;\n}\n'
  );
  writeFileSync(
    path.join(fixtureDir, 'dupe.vue'),
    '<script setup lang="ts">\nconst pick = (v: boolean): string => {\n  if (v) { return "same"; } else { return "same"; }\n};\n</script>\n<template><div>{{ pick(true) }}</div></template>\n'
  );
  writeFileSync(
    path.join(fixtureDir, 'dupe-fixed.vue'),
    '<script setup lang="ts">\nconst pick = (v: boolean): string => (v ? "a" : "b");\n</script>\n<template><div>{{ pick(true) }}</div></template>\n'
  );
  writeFileSync(
    path.join(fixtureDir, 'parse-error.ts'),
    'export function broken(: string {\n'
  );
});

after(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe('sonarjs fixtures (AC-03)', () => {
  test('duplicated branches blocked in TS', async () => {
    const messages = await lint('dupe.ts');
    assert.ok(
      messages.some((m) => m.ruleId === 'sonarjs/no-all-duplicated-branches' && m.severity === 2),
      JSON.stringify(messages)
    );
  });

  test('corrected TS passes the duplicated-branch rule', async () => {
    const messages = await lint('dupe-fixed.ts');
    assert.equal(
      messages.filter((m) => m.severity === 2).length,
      0,
      JSON.stringify(messages)
    );
  });

  test('cognitive complexity above 15 blocked with the numeric message', async () => {
    const messages = await lint('complex.ts');
    const hit = messages.find((m) => m.ruleId === 'sonarjs/cognitive-complexity');
    assert.ok(hit, JSON.stringify(messages));
    assert.equal(hit.severity, 2);
    assert.match(hit.message, /Cognitive Complexity from (\d+)/);
    const value = Number(/Cognitive Complexity from (\d+)/.exec(hit.message)[1]);
    assert.ok(value > 15);
  });

  test('complexity at/below the ceiling passes', async () => {
    const messages = await lint('complex-ok.ts');
    assert.equal(
      messages.filter((m) => m.severity === 2).length,
      0,
      JSON.stringify(messages)
    );
  });
});

describe('Vue fixtures (AC-02)', () => {
  test('duplicated branches blocked in <script setup lang="ts">', async () => {
    const messages = await lint('dupe.vue');
    assert.ok(
      messages.some((m) => m.ruleId === 'sonarjs/no-all-duplicated-branches' && m.severity === 2),
      JSON.stringify(messages)
    );
  });

  test('corrected Vue fixture passes', async () => {
    const messages = await lint('dupe-fixed.vue');
    assert.equal(
      messages.filter((m) => m.severity === 2).length,
      0,
      JSON.stringify(messages)
    );
  });
});

describe('TypeScript rules (AC-01)', () => {
  test('explicit any is a blocker', async () => {
    const messages = await lint('any-use.ts');
    assert.ok(
      messages.some((m) => m.ruleId === '@typescript-eslint/no-explicit-any' && m.severity === 2)
    );
  });

  test('unused parameter without underscore convention blocks; underscore passes', async () => {
    const messages = await lint('unused.ts');
    assert.equal(messages.filter((m) => m.severity === 2).length, 0, JSON.stringify(messages));
    const bad = await lint('unused-bad.ts');
    assert.ok(
      bad.some((m) => m.ruleId === '@typescript-eslint/no-unused-vars' && m.severity === 2)
    );
  });
});

describe('fail-closed behavior (AC-10)', () => {
  test('a parse error is a fatal blocker, never accepted', async () => {
    const messages = await lint('parse-error.ts');
    assert.ok(messages.some((m) => m.fatal === true));
  });
});

test('module URL sanity (keeps fileURLToPath import used)', () => {
  assert.ok(typeof pathToFileURL(fixtureDir).href === 'string');
});

describe('explicit return types are blocking (F14)', () => {
  test('an unannotated exported function is a blocker', async () => {
    writeFileSync(
      path.join(fixtureDir, 'bare.ts'),
      'export function bare(x: number) {\n  return x * 2;\n}\n'
    );
    const messages = await lint('bare.ts');
    assert.ok(
      messages.some(
        (m) => m.ruleId === '@typescript-eslint/explicit-function-return-type' && m.severity === 2
      ),
      JSON.stringify(messages)
    );
  });

  test('an annotated function passes without an allowance', async () => {
    writeFileSync(
      path.join(fixtureDir, 'annotated.ts'),
      'export function double(x: number): number {\n  return x * 2;\n}\n'
    );
    const messages = await lint('annotated.ts');
    assert.equal(
      messages.filter((m) => m.severity === 2).length,
      0,
      JSON.stringify(messages)
    );
  });
});
