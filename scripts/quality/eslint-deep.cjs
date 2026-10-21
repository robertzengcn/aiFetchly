/**
 * Deep typed ESLint profile (tech design §7 deep).
 *
 * Working-tree (not index-exact) typed validation, run only by the explicit
 * `yarn quality:deep` command. Adds the two type-aware promise rules on the
 * existing TypeScript ESLint 7 stack via parserOptions.project scoped to the
 * deep tsconfig; never used by the pre-commit hook.
 */

const path = require('path');

module.exports = {
  root: true,
  // Inherits every fast rule (and the object-form plugins) from the fast
  // profile; the deep profile only ADDS type services + typed rules.
  extends: [require.resolve('./eslint-fast.cjs')],
  parserOptions: {
    parser: '@typescript-eslint/parser',
    ecmaVersion: 'latest',
    sourceType: 'module',
    extraFileExtensions: ['.vue'],
    project: ['./tsconfig.json'],
    tsconfigRootDir: path.resolve(__dirname, '..', '..'),
  },
  rules: {
    // Type-aware rules (deep only — require parser services).
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
  },
};
