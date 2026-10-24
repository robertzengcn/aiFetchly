/**
 * Dialect compatibility suite (V03; tech design §3.3): COMMITTED valid and
 * invalid fixtures for every supported source dialect — JS module, CommonJS,
 * JSX, TSX, ordinary Vue <script>, Vue <script setup lang="ts">, and Vue
 * template parsing. Each invalid fixture must be rejected BY THE EXPECTED
 * RULE (parser startup plus rule execution, not just parsing), and each
 * valid counterpart must pass the real fast runner.
 *
 * Invalid fixtures live under fixtures/invalid/** (an approved gate ignore)
 * so they never pollute the audit; valid fixtures are ordinary tracked
 * source and must stay lint-clean.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';

const repoRoot = process.cwd();
const nodeRequire = createRequire(path.join(repoRoot, 'package.json'));
const { ESLint } = nodeRequire('eslint');

function runRunner(rel) {
  return spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'quality', 'lint-files.mjs'), '--json', rel],
    { cwd: repoRoot, encoding: 'utf8', timeout: 120_000 }
  );
}

/**
 * Lint one INVALID fixture with the fast profile and ignores DISABLED —
 * the fixtures/invalid/** tree is an approved gate ignore precisely so it
 * never enters ordinary linting; the explicit test harness opts in
 * (policy.cjs approvedIgnores documents this contract).
 */
async function lintInvalid(name) {
  const eslint = new ESLint({
    cwd: repoRoot,
    useEslintrc: false,
    overrideConfigFile: path.join(repoRoot, 'scripts', 'quality', 'eslint-fast.cjs'),
    resolvePluginsRelativeTo: repoRoot,
    fix: false,
    ignore: false,
  });
  const [result] = await eslint.lintFiles([path.join(repoRoot, INVALID, name)]);
  return result.messages;
}

const INVALID = 'test/quality-gate/fixtures/invalid/dialects';
const VALID = 'test/quality-gate/fixtures/valid/dialects';

const CASES = [
  { name: 'bad-js.js', expect: 'sonarjs/no-all-duplicated-branches' },
  { name: 'bad-cjs.cjs', expect: 'sonarjs/no-all-duplicated-branches' },
  { name: 'bad-jsx.jsx', expect: 'sonarjs/no-all-duplicated-branches' },
  { name: 'bad-tsx.tsx', expect: '@typescript-eslint/no-explicit-any' },
  { name: 'bad-vue-script.vue', expect: 'sonarjs/no-all-duplicated-branches' },
  { name: 'bad-vue-setup.vue', expect: 'sonarjs/no-all-duplicated-branches' },
  { name: 'bad-vue-template.vue', expect: 'vue/no-parsing-error' },
];

describe('dialect fixtures (V03)', () => {
  for (const { name, expect } of CASES) {
    test(`invalid ${name} is rejected by ${expect}`, async () => {
      const messages = await lintInvalid(name);
      assert.ok(
        messages.some((m) => m.ruleId === expect && m.severity === 2),
        `expected ${expect} among ${JSON.stringify(messages.map((m) => [m.ruleId, m.severity]))}`
      );
    });
  }

  for (const name of [
    'good-js.js',
    'good-cjs.cjs',
    'good-jsx.jsx',
    'good-tsx.tsx',
    'good-vue-script.vue',
    'good-vue-setup.vue',
    'good-vue-template.vue',
  ]) {
    test(`valid ${name} passes the real fast runner`, () => {
      const res = runRunner(`${VALID}/${name}`);
      assert.equal(res.status, 0, `expected pass:\n${res.stdout}${res.stderr}`);
    });
  }
});
