/**
 * Fast pre-commit ESLint profile (ESLint 8 legacy config, tech design §7).
 *
 * Deliberately extends the repository's authoritative .eslintrc.json —
 * this is an explicit extension, never filesystem discovery (the runner
 * sets useEslintrc: false and points at this file). No parserOptions.project
 * and no type services: staged snapshots must lint without analyzing the
 * whole project, and unstaged dependency edits must not affect results.
 *
 * The base .eslintrc.json already configures vue-eslint-parser with the
 * TypeScript parser delegated for script sections (parserOptions.parser),
 * so Vue templates and <script setup lang="ts"> work unchanged.
 */

const {
  sonarRules,
  typescriptBlockingRules,
  typescriptAdvisoryRules,
  coreBlockingRules,
} = require('./policy.cjs');

module.exports = {
  root: true,
  // Extend the existing base policy by absolute path so no parent/package
  // discovery can alter the gate. When the duplicate package.json
  // eslintConfig is removed, this remains the only extension chain.
  extends: [require.resolve('../../.eslintrc.json')],
  plugins: ['sonarjs'],
  rules: {
    ...coreBlockingRules,
    ...sonarRules,
    // TypeScript-scoped rules live in the TS/TSX/Vue overrides below so
    // they never run against plain JS with espree (the TS-only rule
    // explicit-function-return-type crashes on espree ASTs).
    ...typescriptBlockingRules.javascriptSafe,
    // Architecture rules (aifetchly/*) run as a dedicated AST pass in
    // architecture-check.mjs — ESLint 8 legacy config cannot package an
    // in-repo plugin. See this file's header and the runner.
  },
  overrides: [
    {
      // TypeScript files (incl. Vue script via the base vue parser chain):
      // the full TS blocking + advisory set.
      files: ['**/*.ts', '**/*.tsx', '**/*.vue'],
      rules: {
        ...typescriptBlockingRules.rules,
        ...typescriptAdvisoryRules,
      },
    },
    {
      // CommonJS tooling scripts (this directory): node source type.
      files: ['scripts/**/*.cjs'],
      parserOptions: { sourceType: 'commonjs', ecmaVersion: 'latest' },
      env: { node: true, es2021: true },
    },
    {
      // Tests: declare framework globals instead of importing env presets
      // that could pull config discovery back in.
      files: [
        'test/**/*.test.ts',
        'test/**/*.test.tsx',
        'test/vitest/**/*.ts',
      ],
      env: { node: true, es2021: true },
      rules: {
        // Test-local declarations for harness shapes are conventional;
        // explicit any in tests stays BLOCKING (repo rule) — no override.
      },
    },
    {
      // Declaration files: keep linting, disable only rules that are
      // meaningless without an implementation body.
      files: ['**/*.d.ts'],
      rules: {
        '@typescript-eslint/explicit-function-return-type': 'off',
      },
    },
  ],
};
