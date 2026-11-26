# Local Commit Quality Gate — Operator Guide

Status: implemented (worktree branch `worktree-local-commit-quality-gate`)
Requirements: [PRD](../prd/local-commit-quality-gate/PRD.md) · Design: [TECHNICAL_DESIGN](../prd/local-commit-quality-gate/TECHNICAL_DESIGN.md) · Requirements-audit remediation: [REQUIREMENTS_AUDIT_TODO](../prd/local-commit-quality-gate/REQUIREMENTS_AUDIT_TODO.md)

## What runs on `git commit`

`.husky/pre-commit` invokes one entry point: `node scripts/quality/pre-commit.mjs`.
The coordinator:

1. Verifies the pinned dependencies are installed (never downloads; no `npx` fallback)
   and that the gate's own policy inputs physically live inside the repository
   (symlinked policy or an outside exceptions.json is an operational failure).
2. Rejects unmerged index stages; unstaged edits AND untracked files among the
   policy/control inputs (`.eslintrc.json` incl. root `.eslintrc*` fragments,
   `scripts/quality/**`, `package.json`, `yarn.lock`, ignore files) — the core
   list lives in the coordinator itself, so weakening `policyControlInputs`
   cannot silence the check.
3. Staged policy-control inputs are VALIDATED before any exit — module
   loadability, the manifest, AND the effective ESLint configuration (clean
   TS/Vue/CJS probes run through the real fast profile, so a nonexistent rule
   or broken plugin cannot commit). A staged `package.json`/`yarn.lock` that
   uninstalls the gate is rejected.
4. Skips the lint engine entirely for documentation-only commits.
5. Runs ONE lint-staged pass (`concurrent: false`, default backup + partial-staging
   isolation ON, no `--fix` anywhere) over staged `.js/.jsx/.cjs/.mjs/.ts/.tsx/.vue` files.
6. Applies the reviewed legacy exceptions, then blocks on any remaining error with
   `path:line:col`, rule id, message, and a retry hint. Configuration failures
   (missing rule definitions, invalid options) are OPERATIONAL failures — never
   accepted debt and never exceptable. A safety timeout (default 120 s, consciously
   configurable via `QUALITY_GATE_TIMEOUT_MS`) fails the commit with stash-recovery
   guidance — never a silent pass.

Output contract: `0` pass, `1` policy violation, `2` operational/configuration
failure (Git may normalize the hook's exit code to 1 — the diagnostics text is
authoritative). Warnings never block. Exit `2` is never a pass.

## Commands

| Command | Scope |
|---|---|
| `yarn quality:staged` | The same coordinator as the hook (staged snapshot semantics) |
| `yarn quality:deep` | Working-tree typed lint over the FULL tsconfig scope (TS + TSX + 275 Vue scripts + in-project JS) + `yarn typecheck` + `yarn vue-typecheck`, sequential, stops on first failure |
| `yarn quality:audit [--json]` | Read-only inventory of ALL tracked source (any directory), stale-with-reason / expired / tightening / ceiling-exceeded reporting, code defects that can never be excepted, draft entries — never auto-applied. `--json` emits the versioned `quality-gate-audit/1` document |
| `yarn quality:fix <paths>` | Explicit working-tree `eslint --fix`; never stages anything; refuses symlinked targets outside the repo |
| `yarn quality:doctor` | Node/deps/profiles/REAL manifest validator/hooksPath + executable shim file + comment-aware hook content + expected-rule rejection probe + an end-to-end real-commit rejection proof in an isolated checkout |
| `yarn quality:benchmark [runs] [--json-out F]` | Repeatable performance harness for the three PRD workloads; writes the raw sample series |
| `yarn quality:fresh-checkout` | Clean-clone drill: lockfile install → prepare → doctor → valid commit must pass → invalid commit must reject (requires a networked environment) |
| `yarn test:quality-gate` | The gate's own test suite (Node test runner; no Electron/DB) |

**Note:** the pre-commit hook lints STAGED FILES only — it does not run the test
suite. Run `yarn test:quality-gate` before committing gate changes (a red suite
once landed one commit late during this remediation).

## Changing policy

- **Complexity limit / rule severities**: edit `scripts/quality/policy.cjs` ONLY — it is
  the single source of truth consumed by the fast profile, deep profile, and exception
  checker. Do not duplicate thresholds elsewhere.
- After any rule change, run `yarn quality:audit` and review the printed draft entries.
- New allowances are deliberate policy changes: edit `scripts/quality/exceptions.json`
  by hand (path, ruleId, maxCount, reason, owner, expiry; complexity entries also carry
  per-function identities and ceilings — see below). The hook never regenerates the
  baseline, and the audit never auto-applies drafts.
- Expired exceptions block as soon as their file is touched; `yarn quality:audit`
  also lists expired entries in untouched files.

### Exception entry shape

```json
{
  "path": "src/modules/LegacyExample.ts",
  "ruleId": "sonarjs/cognitive-complexity",
  "maxCount": 2,
  "maxComplexity": 30,
  "maxTotalComplexity": 50,
  "functions": [
    { "line": 10, "column": 1, "maxComplexity": 30 },
    { "line": 40, "column": 1, "maxComplexity": 20 }
  ],
  "reason": "Split orchestration during the scheduled module refactor",
  "owner": "maintainer",
  "expiresOn": "2027-01-31"
}
```

- Ordinary rules: `maxCount` pins the current finding count; debt may only shrink.
- **Complexity entries require per-function identities**: a finding is accepted only
  at its baselined `line`/`column`, within THAT function's own ceiling, within the
  count, and within the aggregate sum. A redistribution (30+20 → 25+25) blocks; a
  moved or replacement function at a new position is new debt and blocks. `functions`
  length must equal `maxCount`; `maxComplexity`/`maxTotalComplexity` must equal the
  per-function max/sum. Use `yarn quality:audit --json` (`draftEntries`) to draft
  consistent entries after review.
- Validation rejects wildcards, absolute/traversal/noncanonical paths, impossible
  calendar dates (leap-year aware), missing or inconsistent ceilings, empty
  reason/owner, and duplicate (path, ruleId) pairs.
- Fatal parse errors, `vue/no-parsing-error`, and configuration/rule-resolution
  failures can NEVER be excepted (manifest entries naming them are rejected).

## SonarJS setup — copyable recipe

This repository runs **ESLint 8 with the legacy `.eslintrc` config format**.
ESLint 9's flat config (`eslint.config.js`, `@eslint/js`, plugin objects in
`languageOptions`) is INCOMPATIBLE with this stack — do not copy examples from
current SonarJS/ESLint docs into this repo without translating them, and do not
`require()` plugin objects into a `.eslintrc` file (legacy config only accepts
plugin name strings resolved from `node_modules`).

Setup-time installation (exact pin; the hook never executes this):

```sh
yarn add --dev --exact eslint-plugin-sonarjs@1.0.4
```

- Peer `eslint ^8 || ^9` matches the installed ESLint 8.57.1; no SonarQube
  server, URL, or token is involved.
- `vue-eslint-parser` is a DIRECT devDependency (`^9.4.3`) — it is imported by
  `architecture-check.mjs` and named in the base `.eslintrc.json`.
- The gate's fast profile (`scripts/quality/eslint-fast.cjs`) enables exactly
  three SonarJS rules (all `requiresTypeChecking: false`):

```js
// ESLint 8 LEGACY config (extends the repo's authoritative .eslintrc.json)
const { sonarRules, coreBlockingRules, approvedIgnores } = require('./policy.cjs');
module.exports = {
  root: true,
  extends: [require.resolve('../../.eslintrc.json')],
  plugins: ['sonarjs'], // legacy string form — resolved from node_modules
  ignorePatterns: approvedIgnores,
  rules: {
    ...coreBlockingRules,      // no-dupe-else-if, no-unreachable
    ...sonarRules,             // cognitive-complexity 15, no-identical-functions,
                               // no-all-duplicated-branches
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};
```

Single-file check (through the REAL gate semantics — staged snapshot, manifest,
architecture pass, and the JSON/exit-code contract):

```sh
node scripts/quality/lint-files.mjs --json src/background.ts
```

Inspection only (NO manifest application, NO staged semantics):

```sh
node node_modules/eslint/bin/eslint.js --no-eslintrc \
  --config scripts/quality/eslint-fast.cjs --print-config src/background.ts
```

## Troubleshooting

| Symptom | Action |
|---|---|
| `eslint-plugin-sonarjs is not installed` | `yarn install` (setup-time network only; the hook never fetches) |
| `Definition for rule ... not found` | The effective configuration names a rule the pinned packages do not define — fix the config; this is an operational failure that can never be excepted |
| Vue parse failure at `<template>` | `vue-eslint-parser` must stay the outer parser (base `.eslintrc.json` already wires this); template parse errors are never exceptable |
| `rule requests parser services` | Remove it from the fast profile or move it to `eslint-deep.cjs` |
| Valid direct lint but commit rejected | The staged snapshot differs from your working tree — check the finding path and staged hunks; direct runs report `working-tree-fast`, hook runs `staged-fast` |
| `policy/control inputs have UNSTAGED edits` / `UNTRACKED policy/control inputs` | `git add` them, restore them, or delete them — a commit may not depend on policy a fresh checkout would not have |
| Selected path resolves (symlink) outside the repository | Policy and source must physically live in the repo; commit real files |
| lint-staged backup mentioned in a failure | Follow its printed recovery line; the coordinator never blanket-deletes stashes |
| Commit hangs | The safety timeout (default 120 s, `QUALITY_GATE_TIMEOUT_MS`) fails the run with recovery guidance — raise it consciously or reduce the batch |
| Deliberate bypass needed | `git commit --no-verify` is a documented Git limitation of any local hook, not a repair |

## Worktrees: run `yarn prepare` once per worktree

Git executes hooks from `core.hooksPath` (`.husky/_`), and the generated
shim directory is NOT checked out — a fresh git worktree has no `.husky/_`
until `yarn prepare` (or `husky`) runs inside it. Until then Git silently
runs NO hook in that worktree and every commit passes ungated.
`yarn quality:doctor` detects exactly this (`husky:shims` FAIL — it checks
the shim FILE and its executability, and proves Git actually rejects an
invalid commit in an isolated checkout).

## Policy decisions (explicit)

- **`explicit-function-return-type` is BLOCKING (since 2026-10-24)** — the
  design's rule contract says Error. Enabled with the reviewed legacy
  migration: all 3,270 pre-existing violations across 827 files under
  src/test/scripts + root configs are pinned per file (counts may only
  shrink; new or moved functions must annotate). `agent-harness/` is
  intentionally NOT baselined — review-pending like its other unmanifested
  pairs (`yarn quality:audit` lists them as drafts).
- **Inherited `eslint:recommended` errors stay blocking deliberately**
  (`no-unreachable`, `require-yield`, `prefer-const`, `no-regex-spaces`,
  `no-unexpected-multiline`, `no-control-regex`, …): they are correctness
  rules, not style. Their legacy findings are baselined with named reasons
  in the manifest. Cosmetic/style rules remain warnings.
- **Deep typed lint owns exactly the two typed rules** (floating/misused
  promises) — it does NOT re-run fast blockers (their legacy baseline is
  manifest-gated at commit time; a CLI pass cannot apply the manifest).
  The deep scope includes the tsconfig's Vue scripts and in-project JS by
  design; the command currently exits nonzero on genuine pre-existing typed
  findings in the tree — real debt the command exists to surface.

## Release evidence

- Performance: [quality-gate-performance.md](quality-gate-performance.md) —
  all three PRD §10 budgets measured PASS by the committed harness
  (p95 35.57 ms / 1,440.42 ms / 3,125.66 ms, adversarial corpus; raw
  sample series retained).
- Compatibility: [quality-gate-compatibility.md](quality-gate-compatibility.md) —
  engines/peers/licenses, requiresTypeChecking verification, committed
  dialect fixtures, Node verification status, platform/GUI status, and the
  fresh-checkout drill record.
- Offline: proven by a real commit through the full hook chain with sockets
  poisoned via NODE_OPTIONS (`test/quality-gate/offline.test.mjs`), plus the
  static scan of the hook graph.
- Safety/limits: interruption, concurrent staging, index/worktree/stash
  preservation, copy/rename records, alternate index, submodules, weird
  filenames, encodings, and policy deletion are covered by the disposable-repo
  suite (`test/quality-gate/git-integration.test.mjs`).

## Known limitations

- **Direct imports only**: the architecture rules do not prove a worker cannot
  transitively reach a database through a shared module; computed (non-literal)
  `import()` specifiers are not analyzed. A later dependency-graph audit covers this.
- **Count allowances can miss replacement** for ORDINARY rules: swapping one
  violation for another at the same count passes. (Complexity entries are immune
  since the per-function identity re-pin: a moved/replacement function has no
  allowance at its position.)
- **Renaming a file does not transfer its allowances** — update the path in the same
  commit; `yarn quality:audit` lists stale entries (with the reason: deleted/excluded
  vs rule no longer firing) for removal.
- Rules that need type information (unhandled/misused promises) run ONLY in
  `yarn quality:deep`, never in the pre-commit hook (PRD QG-15).
- Deep validation is working-tree, not index-exact, and says so in its output.
- Linux CLI is the only verified platform; the fresh-checkout drill requires a
  networked environment to run (see the compatibility matrix for status).

## Rollback

Revert the hook/config/dependency commits as one change (git revert of the QG commits
restores the previous multi-pass hook). A rollback must not leave hooks silently
disabled — `.husky/pre-commit` returning to its previous multi-line content IS the
rollback signal.
