# Local Commit Quality Gate — Operator Guide

Status: implemented (worktree branch `worktree-local-commit-quality-gate`)
Requirements: [PRD](../prd/local-commit-quality-gate/PRD.md) · Design: [TECHNICAL_DESIGN](../prd/local-commit-quality-gate/TECHNICAL_DESIGN.md)

## What runs on `git commit`

`.husky/pre-commit` invokes one entry point: `node scripts/quality/pre-commit.mjs`.
The coordinator:

1. Verifies the pinned dependencies are installed (never downloads; no `npx` fallback).
2. Rejects unmerged index stages and unstaged edits to policy/control inputs
   (`.eslintrc.json`, `scripts/quality/**`, `package.json`, `yarn.lock`, ignore files).
3. Skips the lint engine entirely for documentation-only commits.
4. Runs ONE lint-staged pass (`concurrent: false`, default backup + partial-staging
   isolation ON, no `--fix` anywhere) over staged `.js/.jsx/.cjs/.mjs/.ts/.tsx/.vue` files.
5. Applies the reviewed legacy exceptions, then blocks on any remaining error with
   `path:line:col`, rule id, message, and a retry hint. A 120 s safety timeout fails
   the commit with a diagnostic — never a silent pass.

Output contract: `0` pass, `1` policy violation, `2` operational/configuration failure.
Warnings never block. Exit `2` is never a pass.

## Commands

| Command | Scope |
|---|---|
| `yarn quality:staged` | The same coordinator as the hook (staged snapshot semantics) |
| `yarn quality:deep` | Working-tree typed lint (`no-floating-promises`, `no-misused-promises`) + `yarn typecheck` + `yarn vue-typecheck`, sequential, stops on first failure |
| `yarn quality:audit` | Read-only full-source inventory, stale/expired exception detection, draft entries printed — never auto-applied |
| `yarn quality:fix <paths>` | Explicit working-tree `eslint --fix`; never stages anything |
| `yarn quality:doctor` | Node/deps/profiles/manifest/hooksPath diagnostics + an invalid-fixture rejection probe |
| `yarn test:quality-gate` | The gate's own test suite (Node test runner; no Electron/DB) |

## Changing policy

- **Complexity limit / rule severities**: edit `scripts/quality/policy.cjs` ONLY — it is
  the single source of truth consumed by the fast profile, deep profile, and exception
  checker. Do not duplicate thresholds elsewhere.
- After any rule change, run `yarn quality:audit` and review the printed draft entries.
- New allowances are deliberate policy changes: edit `scripts/quality/exceptions.json`
  by hand (path, ruleId, maxCount, optional maxComplexity, reason, owner, expiry).
  The hook never regenerates the baseline.
- Expired exceptions block as soon as their file is touched; `yarn quality:audit`
  also lists expired entries in untouched files.

### Exception entry shape

```json
{
  "path": "src/modules/LegacyExample.ts",
  "ruleId": "sonarjs/cognitive-complexity",
  "maxCount": 1,
  "maxComplexity": 24,
  "reason": "Split orchestration during the scheduled module refactor",
  "owner": "maintainer",
  "expiresOn": "2027-01-31"
}
```

Validation rejects wildcards, absolute/traversal paths, missing ceilings on complexity
entries, empty reason/owner, invalid dates, and duplicate (path, ruleId) pairs. Fatal
parse errors and operational failures can never be excepted.

## SonarJS setup (what was installed)

- `eslint-plugin-sonarjs@1.0.4` (exact) — peer `eslint ^8 || ^9` matches the installed
  ESLint 8.57.1; no SonarQube server, URL, or token is involved.
- Registered as `plugins: ['sonarjs']` in `scripts/quality/eslint-fast.cjs` with exactly
  three rules enabled: `cognitive-complexity` (limit 15), `no-identical-functions`,
  `no-all-duplicated-branches`. The full `sonarjs/recommended` preset is deliberately
  NOT enabled (expensive/type-dependent rules beyond the selected policy).
- Inspection commands:

```sh
node_modules/.bin/eslint --no-eslintrc --config scripts/quality/eslint-fast.cjs --print-config src/background.ts
node_modules/.bin/eslint --no-eslintrc --config scripts/quality/eslint-fast.cjs --print-config src/views/components/aiChatV2/AiChatV2.vue
```

The CLI does NOT apply the exception manifest or staged-snapshot semantics — use
`yarn quality:staged` for the real policy.

## Troubleshooting

| Symptom | Action |
|---|---|
| `eslint-plugin-sonarjs is not installed` | `yarn install` (setup-time network only; the hook never fetches) |
| `Definition for rule ... not found` | The pinned plugin version changed — verify rule ids against the release, never suppress |
| Vue parse failure at `<template>` | `vue-eslint-parser` must stay the outer parser (base `.eslintrc.json` already wires this) |
| `rule requests parser services` | Remove it from the fast profile or move it to `eslint-deep.cjs` |
| Valid direct lint but commit rejected | The staged snapshot differs from your working tree — check the finding path and staged hunks |
| Policy/control inputs have UNSTAGED edits | `git add` them or `git checkout -- <file>` |
| lint-staged backup mentioned in a failure | Follow its printed recovery line; the coordinator never blanket-deletes stashes |
| Deliberate bypass needed | `git commit --no-verify` is a documented Git limitation of any local hook, not a repair |

## Known limitations (release one)

- **Direct imports only**: the architecture rules do not prove a worker cannot
  transitively reach a database through a shared module; computed (non-literal)
  `import()` specifiers are not analyzed. A later dependency-graph audit covers this.
- **Count allowances can miss replacement**: swapping one violation for another at the
  same count passes. AST fingerprints are a possible follow-up, not shipped.
- **Complexity ceilings are per-file maxima**: one function can worsen below another
  function's existing ceiling. The manifest keeps complexity `maxCount` small so the
  exposure is bounded; per-function fingerprints are the follow-up.
- **Renaming a file does not transfer its allowances** — update the path in the same
  commit; `yarn quality:audit` lists stale entries for removal.
- Rules that need type information (unhandled/misused promises) run ONLY in
  `yarn quality:deep`, never in the pre-commit hook (PRD QG-15).
- Deep validation is working-tree, not index-exact, and says so in its output.

## Performance

Budgets (PRD §10) are release targets, not measured claims. The audit run over the
full tree (2,200+ files) completes in tens of seconds; the staged hook checks only
staged files (typically < 1 s engine startup + ~0.5 s/file). Record p95 numbers with
OS/CPU/Node versions before treating the budgets as met.

## Rollback

Revert the hook/config/dependency commits as one change (git revert of the QG commits
restores the previous multi-pass hook). A rollback must not leave hooks silently
disabled — `.husky/pre-commit` returning to its previous multi-line content IS the
rollback signal.
