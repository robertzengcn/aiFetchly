/**
 * Deep-command tests (F05).
 *
 *  1. ORCHESTRATION: the step plan is explicit, ordered, stop-on-failure,
 *     and contains no watch flags — asserted against the exported
 *     buildSteps/runSteps data without running the engines.
 *  2. TYPED FIXTURES: real Vue script-setup and JS files that VIOLATE a
 *     requested typed rule (no-floating-promises) fail the deep profile,
 *     and corrected versions pass — proving the deep scope actually runs
 *     typed rules over Vue and in-project JS instead of silently skipping
 *     them. Uses a temporary project directory with its own tsconfig and
 *     a deep-style config that extends the repo's base policy.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const { buildSteps, runSteps } = await import(
  pathToFileURL(path.join(repoRoot, 'scripts', 'quality', 'deep.mjs')).href
);

// ---------------------------------------------------------------------------
// Orchestration (order, stop-on-failure, no watch)
// ---------------------------------------------------------------------------

describe('deep orchestration (F05)', () => {
  const scope = {
    included: new Set(),
    // Real scopes include the .vue subset inside typedTargets (see
    // resolveTypedScope); mirror that shape here.
    typedTargets: [
      ...Array.from({ length: 250 }, (_, i) => `src/File${i}.ts`),
      'src/Panel.vue',
    ],
    vueTargets: ['src/Panel.vue'],
    jsInProject: ['forge.config.js'],
    configDiagnostics: [],
  };

  test('step order: typed lint chunks, then tooling lint, then tsc, then vue-tsc', () => {
    const steps = buildSteps(repoRoot, scope);
    const labels = steps.map((s) => s.label);
    assert.deepEqual(labels, [
      'typed lint 1/2',
      'typed lint 2/2',
      'tooling lint (fast profile)',
      'typecheck',
      'vue-typecheck',
    ]);
  });

  test('typed chunks include the in-project JS files', () => {
    const steps = buildSteps(repoRoot, scope);
    const typedArgs = steps.filter((s) => s.label.startsWith('typed lint')).flatMap((s) => s.args);
    assert.ok(typedArgs.includes('forge.config.js'), 'in-project JS joins the typed pass');
    assert.ok(typedArgs.includes('src/File0.ts'));
    assert.ok(typedArgs.includes('src/Panel.vue'), 'Vue files join the typed pass');
  });

  test('no step ever passes a watch flag; eslint steps are explicit-config', () => {
    for (const step of buildSteps(repoRoot, scope)) {
      assert.ok(!step.args.includes('--watch'), step.label);
      assert.ok(!step.args.includes('-w'), step.label);
      assert.ok(!/--watch/.test(step.args.join(' ')), step.label);
      if (step.label.includes('lint')) {
        assert.ok(step.args.includes('--no-eslintrc'), step.label);
        assert.ok(
          step.args.some((a) => a.endsWith('eslint-fast.cjs') || a.endsWith('eslint-deep.cjs')),
          step.label
        );
      }
    }
  });

  test('runSteps stops at the first failure and reports where', () => {
    const steps = buildSteps(repoRoot, scope);
    const executed = [];
    const outcome = runSteps(steps, (step) => {
      executed.push(step.label);
      return step.label === 'tooling lint (fast profile)' ? 1 : 0;
    });
    assert.equal(outcome.failedAt, 'tooling lint (fast profile)');
    assert.equal(outcome.status, 1);
    assert.deepEqual(executed, ['typed lint 1/2', 'typed lint 2/2', 'tooling lint (fast profile)']);
  });

  test('runSteps reports success only when every step passed', () => {
    const steps = buildSteps(repoRoot, scope);
    const executed = [];
    const outcome = runSteps(steps, (step) => {
      executed.push(step.label);
      return 0;
    });
    assert.equal(outcome.failedAt, null);
    assert.equal(executed.length, steps.length);
  });
});

// ---------------------------------------------------------------------------
// Typed fixtures (Vue + JS really receive the typed rules)
// ---------------------------------------------------------------------------

const fixtureDir = path.join(repoRoot, 'tmp-quality-typed-fixture');

before(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    path.join(fixtureDir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { allowJs: true, strict: true, noEmit: true },
      include: ['**/*.ts', '**/*.vue', '**/*.js'],
    })
  );
  // Deep-style typed profile pointed at the fixture project. The config
  // lives INSIDE the repo so ESLint resolves plugins from the repo's
  // node_modules; project/tsconfigRootDir point at the fixture project.
  writeFileSync(
    path.join(fixtureDir, 'deep-fixture.cjs'),
    [
      'const path = require("path");',
      'module.exports = {',
      '  root: true,',
      '  extends: [require.resolve("../.eslintrc.json")],',
      '  parserOptions: {',
      '    parser: "@typescript-eslint/parser",',
      '    ecmaVersion: "latest",',
      '    sourceType: "module",',
      '    extraFileExtensions: [".vue"],',
      '    project: [__dirname + "/tsconfig.json"],',
      '    tsconfigRootDir: __dirname,',
      '  },',
      '  rules: {',
      '    "@typescript-eslint/no-floating-promises": "error",',
      '    "@typescript-eslint/no-misused-promises": "error",',
      '  },',
      '};',
      '',
    ].join('\n')
  );
  writeFileSync(
    path.join(fixtureDir, 'Bad.vue'),
    [
      '<template><div>{{ label }}</div></template>',
      '<script setup lang="ts">',
      "import { ref } from 'vue';",
      "const label = ref('x');",
      'async function work(): Promise<number> {',
      '  return 1;',
      '}',
      'function go(): void {',
      '  work();',
      '}',
      'go();',
      '</script>',
      '',
    ].join('\n')
  );
  writeFileSync(
    path.join(fixtureDir, 'Good.vue'),
    [
      '<template><div>{{ label }}</div></template>',
      '<script setup lang="ts">',
      "import { ref } from 'vue';",
      "const label = ref('x');",
      'async function work(): Promise<number> {',
      '  return 1;',
      '}',
      'function go(): void {',
      '  void work();',
      '}',
      'go();',
      '</script>',
      '',
    ].join('\n')
  );
  writeFileSync(
    path.join(fixtureDir, 'Bad.js'),
    [
      'async function work() {',
      '  return 1;',
      '}',
      'function run() {',
      '  work();',
      '}',
      'run();',
      '',
    ].join('\n')
  );
  writeFileSync(
    path.join(fixtureDir, 'Good.js'),
    [
      'async function work() {',
      '  return 1;',
      '}',
      'function run() {',
      '  void work();',
      '}',
      'run();',
      '',
    ].join('\n')
  );
});

after(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

function lintFixtures(names) {
  return spawnSync(
    process.execPath,
    [
      path.join(repoRoot, 'node_modules', 'eslint', 'bin', 'eslint.js'),
      '--no-eslintrc',
      '--config',
      path.join(fixtureDir, 'deep-fixture.cjs'),
      ...names.map((n) => path.join(fixtureDir, n)),
    ],
    { cwd: repoRoot, encoding: 'utf8', timeout: 180_000 }
  );
}

describe('deep typed fixtures (F05: Vue and JS receive the typed rules)', () => {
  test('a floating promise in a Vue <script setup> BLOCKS the typed profile', () => {
    const res = lintFixtures(['Bad.vue']);
    assert.equal(res.status, 1, `Bad.vue must fail:\n${res.stdout}${res.stderr}`);
    assert.ok(res.stdout.includes('no-floating-promises'), res.stdout);
  });

  test('the corrected Vue fixture passes the typed profile', () => {
    const res = lintFixtures(['Good.vue']);
    assert.equal(res.status, 0, `Good.vue must pass:\n${res.stdout}${res.stderr}`);
  });

  test('a floating promise in in-project JS BLOCKS the typed profile', () => {
    const res = lintFixtures(['Bad.js']);
    assert.equal(res.status, 1, `Bad.js must fail:\n${res.stdout}${res.stderr}`);
    assert.ok(res.stdout.includes('no-floating-promises'), res.stdout);
  });

  test('the corrected JS fixture passes the typed profile', () => {
    const res = lintFixtures(['Good.js']);
    assert.equal(res.status, 0, `Good.js must pass:\n${res.stdout}${res.stderr}`);
  });
});
