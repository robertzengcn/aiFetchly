# Local Commit Quality Gate — Compatibility Matrix

Date: 2026-10-23 · Branch `worktree-local-commit-quality-gate` · verified against the installed tree.

## Dependency matrix (technical design §3)

| Package | Version (installed) | Peer requirements | Node engines | License | Compatible with installed ESLint 8.57.1? |
|---|---|---|---|---|---|
| `eslint-plugin-sonarjs` | **1.0.4 (pinned exact)** | `eslint ^8.0.0 \|\| ^9.0.0` | `>=16` | LGPL-3.0-only | YES — `^8.0.0` matches 8.57.1 |
| `eslint` | 8.57.1 | — | `^12.22 \|\| ^14.17 \|\| >=16` | MIT | (baseline) |
| `vue-eslint-parser` | 9.4.3 | `eslint >=6` | `^14.17 \|\| >=16` | MIT | YES |
| `@typescript-eslint/parser` | 7.18.0 | `eslint ^8.56.0` | `^18.18 \|\| >=20` | BSD-2-Clause | YES — requires ≥8.56, installed 8.57.1 |
| `lint-staged` | 16.2.7 | — | `>=20.17` | MIT | YES |
| `husky` | 9.1.7 | — | `>=18` | MIT | YES |

**Effective Node minimum: >=20.17** (the strictest engine in the set —
`lint-staged` 16.2.7). The repo's `engines.node >=22.0.0` satisfies every
row. Tested on Node v22.19.0. No package requires a Node newer than 22.

Note: `vue-eslint-parser` is resolved transitively but IS the parser named
in the fast profile's base `.eslintrc.json` — per technical design §7.1A it
should be promoted to a direct devDependency at merge-review time (doctor
already checks its resolvability every run).

## `requiresTypeChecking` for the enabled SonarJS rules

| Rule | `docs.requiresTypeChecking` | Fast-profile safe? |
|---|---|---|
| `sonarjs/cognitive-complexity` | not set (falsy) | YES — syntax-only |
| `sonarjs/no-identical-functions` | not set (falsy) | YES — syntax-only |
| `sonarjs/no-all-duplicated-branches` | not set (falsy) | YES — syntax-only |

Verified by reading `rules[<name>].meta.docs` on the pinned 1.0.4 install —
none request type information, matching the design requirement that the
fast profile never starts parser services.

## Parse proofs (technical design §3 step 3)

Proven by the committed fixture suite (`yarn test:quality-gate`, 48 tests):
plain JS is exercised by the gate's own scripts under `scripts/**`; TS and
Vue `<script setup lang="ts">` by `rules.fixtures.test.mjs` (invalid +
corrected); JS/CJS by the policy/scripts overrides and the `.mjs` runner
itself linting clean. JSX/TSX parse support is configured
(`ecmaFeatures.jsx` + TSX extension in `sourceExtensions`) but has no
committed fixture — JS/JSX/TSX are absent from `src/` today; the dialect
matrix records this as a gap to close if JSX enters the tree.

| Dialect | Parse proof | Rule fixture |
|---|---|---|
| JS (module) | gate's own `.mjs` scripts lint clean | indirect |
| CJS | `scripts/quality/*.cjs` lint clean | indirect |
| TS | `rules.fixtures.test.mjs` | YES (dupe/complexity/any/unused) |
| TSX | configured, no repo files | NONE (gap) |
| Vue `<script setup lang="ts">` | `rules.fixtures.test.mjs` | YES (dupe) |
| Vue template error | `parse-error.ts` fatal fixture (TS-level) | YES (fatal path) |

## Verification commands

```sh
yarn quality:doctor        # deps + profiles + hook + rejection probe
yarn test:quality-gate     # 48-test fixture suite
yarn lint                  # base-config repo lint unchanged after
                           # package.json eslintConfig removal (verified
                           # exit 0 on src/background.ts spot check)
```
