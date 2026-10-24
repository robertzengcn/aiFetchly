# Local Commit Quality Gate — Compatibility Matrix

Date: 2026-10-24 (updated for the requirements-audit remediation) · Branch
`worktree-local-commit-quality-gate` · verified against the installed tree.

## Dependency matrix (technical design §3)

| Package | Version (installed) | Peer requirements | Node engines | License | Compatible with installed ESLint 8.57.1? |
|---|---|---|---|---|---|
| `eslint-plugin-sonarjs` | **1.0.4 (pinned exact)** | `eslint ^8.0.0 \|\| ^9.0.0` | `>=16` | LGPL-3.0-only | YES — `^8.0.0` matches 8.57.1 |
| `eslint` | 8.57.1 | — | `^12.22 \|\| ^14.17 \|\| >=16` | MIT | (baseline) |
| `vue-eslint-parser` | 9.4.3 — **direct devDependency `^9.4.3` since 2026-10-24** | `eslint >=6` | `^14.17 \|\| >=16` | MIT | YES |
| `@typescript-eslint/parser` | 7.18.0 | `eslint ^8.56.0` | `^18.18 \|\| >=20` | BSD-2-Clause | YES — requires ≥8.56, installed 8.57.1 |
| `lint-staged` | 16.2.7 | — | `>=20.17` | MIT | YES |
| `husky` | 9.1.7 | — | `>=18` | MIT | YES |

**Effective Node minimum: >=20.17** (the strictest engine in the set —
`lint-staged` 16.2.7). The repo's `engines.node >=22.0.0` satisfies every
row; the repo constraint is therefore the binding minimum.

### Node version verification status

| Node version | Result |
|---|---|
| v22.19.0 | VERIFIED — full `yarn test:quality-gate` suite, doctor, real commits through the hook |
| v20.17–v21 (declared-eligible range below the repo engines floor) | NOT TESTED — the repo's own `engines.node >=22.0.0` excludes them; the toolchain floor is 20.17 only if that engine field is ever relaxed |
| v23+ | NOT TESTED |

The declared minimum is a recorded limitation, not a verified claim: only
22.19.0 has been exercised (this machine). Record additional versions here
when they are actually run.

`vue-eslint-parser` was previously resolved transitively while being
directly imported by `architecture-check.mjs` and named in the base
`.eslintrc.json`; it is now declared directly (`^9.4.3`, matching the
existing lockfile entry — `yarn install --frozen-lockfile` validates the
manifest against the unchanged lock).

## `requiresTypeChecking` for the enabled SonarJS rules

| Rule | `docs.requiresTypeChecking` | Fast-profile safe? |
|---|---|---|
| `sonarjs/cognitive-complexity` | not set (falsy) | YES — syntax-only |
| `sonarjs/no-identical-functions` | not set (falsy) | YES — syntax-only |
| `sonarjs/no-all-duplicated-branches` | not set (falsy) | YES — syntax-only |

Verified by reading `rules[<name>].meta.docs` on the pinned 1.0.4 install —
none request type information, matching the design requirement that the
fast profile never starts parser services.

## Parse proofs (technical design §3 step 3; V03)

Durable regression coverage lives in `test/quality-gate/dialects.test.mjs`
over COMMITTED fixtures under `test/quality-gate/fixtures/{valid,invalid}/dialects/`:
each invalid fixture is rejected by the EXPECTED rule (parser startup plus
rule execution, not just parsing) via the fast profile with ignores
disabled, and each valid counterpart passes the real runner end to end.
Typed Vue/JS handling is additionally proven by `deep.test.mjs` (typed rules
fire on Vue script setup and in-project JS through the deep profile).

| Dialect | Parse proof | Rule fixture |
|---|---|---|
| JS (module) | `good/bad-js.js` committed fixtures | YES (duplicated branches) |
| CJS | `good/bad-cjs.cjs` committed fixtures | YES (duplicated branches) |
| JSX | `good/bad-jsx.jsx` committed fixtures | YES (duplicated branches) |
| TS | `rules.fixtures.test.mjs` + dialects | YES (dupe/complexity/any/unused/return types) |
| TSX | `good/bad-tsx.tsx` committed fixtures | YES (explicit any) |
| Vue ordinary `<script lang="ts">` | `good/bad-vue-script.vue` | YES (duplicated branches) |
| Vue `<script setup lang="ts">` | `good/bad-vue-setup.vue` + `rules.fixtures.test.mjs` | YES |
| Vue template error | `bad-vue-template.vue` (a REAL template parse error) | YES (`vue/no-parsing-error`, never exceptable) |

Historical note: the 2026-10-23 audit correctly flagged that the earlier
matrix listed a TS `parse-error.ts` fixture as Vue-template proof and
acknowledged missing JSX/TSX fixtures; both gaps are closed by the
committed dialect suite above.

## Verification commands

```sh
yarn quality:doctor        # deps + profiles + manifest validator + shim
                           # executability + real-commit rejection probe
yarn test:quality-gate     # fixture, dialect, integration, offline,
                           # doctor, audit, and reporting suites
yarn lint                  # base-config repo lint unchanged
```
