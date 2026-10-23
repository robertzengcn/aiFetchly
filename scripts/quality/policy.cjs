/**
 * Single source of truth for the local commit quality gate policy.
 *
 * Shared by the fast pre-commit profile (eslint-fast.cjs), the deep typed
 * profile (eslint-deep.cjs), the exception checker (check-exceptions.mjs),
 * and the audit command. Never duplicate a threshold or rule ID elsewhere —
 * import it from here (tech design §7.1.B).
 */

const COGNITIVE_COMPLEXITY_LIMIT = 15;

/** Selected SonarJS rules (syntax-only, no type info required). */
const sonarRules = {
  'sonarjs/cognitive-complexity': ['error', COGNITIVE_COMPLEXITY_LIMIT],
  'sonarjs/no-identical-functions': 'error',
  'sonarjs/no-all-duplicated-branches': 'error',
};

/**
 * Blocking TypeScript rules for the fast profile. Split because two of them
 * require the TypeScript AST: running them against plain .js files (parsed
 * with espree) crashes @typescript-eslint/eslint-plugin 7 — see
 * explicit-function-return-type's getFunctionHeadLoc. The TS-only subset
 * applies to .ts/.tsx/.vue files; `javascriptSafe` (no-unused-vars)
 * applies everywhere.
 */
const TS_AST_REQUIRED_RULES = {
  '@typescript-eslint/no-explicit-any': 'error',
};

const typescriptBlockingRules = {
  rules: TS_AST_REQUIRED_RULES,
  javascriptSafe: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        // Documented repo convention: a leading underscore marks intentionally
        // unused parameters/variables (see .eslintrc.json history and the
        // argsIgnorePattern fix from 2026-08-20).
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
  },
};

/**
 * Explicit return types stay WARN in the fast profile for now: the repo has
 * substantial legacy debt here and PRD §7 requires accounting for it before
 * enforcement. The deep audit reports counts; flip to 'error' after the
 * manifest absorbs the debt.
 */
const typescriptAdvisoryRules = {
  '@typescript-eslint/explicit-function-return-type': 'warn',
};

/** Core correctness rules that need no parser services. */
const coreBlockingRules = {
  'no-dupe-else-if': 'error',
  'no-unreachable': 'error',
};

/** Architecture restrictions (custom AST rules in ./rules/). */
const architectureRules = {
  'aifetchly/no-worker-db-imports': 'error',
  'aifetchly/no-ipc-db-imports': 'error',
};

const architectureScopes = {
  'aifetchly/no-worker-db-imports': ['src/childprocess/**'],
  'aifetchly/no-ipc-db-imports': ['src/main-process/communication/**'],
};

/** Source extensions the gate selects (PRD §6 release one). */
const sourceExtensions = ['.js', '.jsx', '.cjs', '.mjs', '.ts', '.tsx', '.vue'];

/**
 * Approved ignores: generated output, vendored code, dependencies, and the
 * dedicated invalid-code fixtures (excluded from ordinary lint, included only
 * by the test harness via inline config). A selected file matching one of
 * these is excluded WITH a reported reason (AC-17), never silently.
 */
const approvedIgnores = [
  '.vite/**',
  'dist/**',
  'coverage/**',
  'node_modules/**',
  'test/quality-gate/fixtures/invalid/**',
];

/**
 * Policy/control inputs whose unstaged edits reject a commit and whose
 * STAGED edits trigger validation before any exit (§6.1). Documentation is
 * deliberately absent: the operator guide is documentation, not policy —
 * a docs-only commit including it still takes the skip path (BUG-17).
 */
const policyControlInputs = [
  '.eslintrc.json',
  'scripts/quality/**',
  'package.json',
  'yarn.lock',
  '.gitignore',
  '.eslintignore',
];

/**
 * POSIX glob → RegExp for the simple glob forms used in approvedIgnores
 * (`**` any path, `*` any segment characters). Shared by the runner and
 * the audit so ignore semantics cannot drift apart (F11).
 */
function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '@@DOUBLESTAR@@')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped.split('@@DOUBLESTAR@@').join('.*')}$`);
}

const approvedIgnoreRegexes = approvedIgnores.map(globToRegExp);

/** Which approved ignore pattern covers this repo-relative POSIX path (or null)? */
function approvedIgnorePatternFor(relPath) {
  for (let i = 0; i < approvedIgnores.length; i += 1) {
    if (approvedIgnoreRegexes[i].test(relPath)) return approvedIgnores[i];
  }
  return null;
}

module.exports = {
  COGNITIVE_COMPLEXITY_LIMIT,
  sonarRules,
  typescriptBlockingRules,
  typescriptAdvisoryRules,
  coreBlockingRules,
  architectureRules,
  architectureScopes,
  sourceExtensions,
  approvedIgnores,
  approvedIgnorePatternFor,
  policyControlInputs,
};
