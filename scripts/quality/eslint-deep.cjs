/**
 * Deep typed ESLint profile (tech design §7 deep).
 *
 * Scope is the TWO type-aware rules the fast hook cannot run
 * (`no-floating-promises`, `no-misused-promises`) — deep validation is for
 * "rules that cannot be established by syntax-only linting" (PRD QG-15),
 * NOT a re-run of the fast blockers. The fast rules are enforced at commit
 * time against STAGED content with the exception manifest applied; the CLI
 * pass here has no manifest applicator, so re-inheriting those rules would
 * just re-report the entire tracked legacy baseline on every deep run.
 */

const path = require('path');

module.exports = {
  root: true,
  // Base repo policy (parsers, Vue handling) — NOT the fast gate profile.
  extends: [require.resolve('../../.eslintrc.json')],
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
