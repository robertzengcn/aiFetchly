# Local Commit Quality Gate — Implementation Audit

Date: 2026-10-22
Worktree: `.worktrees/local-commit-quality-gate`
Branch: `worktree-local-commit-quality-gate`
HEAD: `ee97149c7` (`fix(quality-gate): review fixes — execPath bins, deep scope, rename parse, shared adapter`)
Specs: [PRD.md](PRD.md), [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md)

This file records what is implemented on that worktree, what is still open, and the defects found by reading the gate and by running it. It is an audit checklist, not a claim that the feature is finished.

## Resolution (2026-10-23)

All 18 audit bugs fixed on this branch (commits fb3392b3b..c8a832127);
all delivery items delivered except the two explicitly platform-gated ones.

| Item | Status | Commit |
|---|---|---|
| BUG-1 deep cannot finish | FIXED — tsconfig-membership scope via TS compiler API; out-of-project JS excluded on an explicit scope line; 4-test deep-scope fixture suite | a7813a025 |
| BUG-2 IPC files uncommittable | FIXED — audit runs the architecture pass and drafts allowances; 13 findings across 7 IPC files recorded as reviewed allowances (verified live: emailTemplate-ipc.ts commits) | 70a7105ae |
| BUG-3 complexity AC-09 | FIXED — maxTotalComplexity aggregate ceiling added to all 370 complexity entries and enforced; raising a lesser function while count holds now blocks (bounded by the documented swap limitation) | 70a7105ae |
| BUG-4 bulk baseline | FIXED — gate-own files carry ZERO allowances (every violation fixed in code: visitors decomposed, unused imports removed); regenerated 735-entry manifest has rule-specific reasons carrying actual counts/ceilings; inherited recommended errors kept deliberately and named in policy.cjs + entry reasons | 70a7105ae |
| BUG-5 policy-only commits | FIXED — staged policy inputs validate before any exit (schemaVersion-99 probe rejected live) | fb3392b3b |
| BUG-6 copy records | FIXED — C records consume both paths; integration-tested under diff.renames=copies | fb3392b3b3b + c93dc1812 |
| BUG-7 SqliteDb extension bypass | FIXED — extension + index-segment forms block (SqliteDbFoo still passes) | f756db8e2 |
| BUG-8 inline type modifiers | FIXED — all-inline-type allowed, mixed value+type blocks | f756db8e2 |
| BUG-9 parse failures exceptable | FIXED — fatal:true; regression-tested under an active allowance | f756db8e2 |
| BUG-10 index identity | FIXED — git write-tree compared before/after; concurrent staging refuses with retry hint | fb3392b3b |
| BUG-11 quality:fix profile | FIXED — fix.mjs: fast profile, explicit paths, refuses empty list, never stages | 1834dd2be |
| BUG-12 doctor probe in repo | FIXED — gitignored non-hidden tmp-quality-probe/, finally-deleted, output states it probes the runner | 1834dd2be |
| BUG-13 timeout recovery | FIXED — stash recovery guidance on timeout + spawn-error paths | fb3392b3b |
| BUG-14 yarn by name | FIXED — tsc/vue-tsc via execPath + real JS entries | a7813a025 |
| BUG-15 approved ignores | FIXED — wired into fast config; approved skips printed, unexpected exit 2 | 1834dd2be |
| BUG-16 JSON output | FIXED — versioned quality-gate/1 on pure stdout (human on stderr), human blockers capped at 50, --json-as-first-arg flag | 1834dd2be |
| BUG-17 guide as policy | FIXED — removed from policyControlInputs | fb3392b3b |
| BUG-18 nits | FIXED — local-date expiry, realpath symlink check, dead rule impl deleted, tmp-quality-* gitignored | fb3392b3b/f756db8e2/1834dd2be |

Delivery items: git-integration suite (11 real-commit tests — c93dc1812),
failure injection (covered: broken manifest, unmerged paths, engine errors;
timeout interruption left to review of AC-15's stash test), offline
evidence (static + dynamic, 7affeb3ef), performance report (all budgets
PASS, 7affeb3ef), compatibility matrix (7affeb3ef), explicit-return-types
decision (warn-only, documented), fast-profile inheritance decision
(documented), lint-staged-eslint.sh removed, worktree-prepare note
(c8a832127). OPEN: macOS/Windows platform runs; fresh-checkout yarn
install drill (simulated by doctor + sandbox suites).

## Verdict

The hook, fast ESLint profile, SonarJS pin, exception applicator, architecture checker, and operator commands exist, and the in-repo Node test suite passes (30 tests, 0 failures). The feature is not complete against the PRD. Several Must requirements are only partly met, and a normal commit that touches existing IPC handlers is rejected. `yarn quality:deep` cannot finish on this tree.

## How this was checked

- Compared `48a1161e1..HEAD` (design commit through the latest gate commit) with PRD §6–§12 and technical design §2–§12.
- Read `scripts/quality/*`, `.husky/pre-commit`, `package.json`, and `scripts/quality/exceptions.json` (736 entries).
- Ran `node --test "test/quality-gate/*.test.mjs"` in the worktree: 30 passed, 0 failed, about 5.3s.
- Resolved the fast profile with ESLint's Node API for `src/background.ts` and `AiChatV2.vue`.
- Ran `checkArchitecture` on every JS/TS file under `src/childprocess` and `src/main-process/communication` (167 files).
- Smoke-tested the deep profile on `src/config/appInfo.ts` (clean, ~24s) and on `src/childprocess/electron-shim/electron.js` (fatal parse error).
- Inspected lint-staged 16.2.7 `getSpawnedTask.js`: string tasks are split once, then filenames are appended as an argv array (`shell` is not used). Spaces and Unicode in filenames are not re-split by the shell.

No commit was created during this audit. Partial-staging, offline, and Windows hook runs were not executed.

---

## Completed

- [x] **QG-01 hook entry.** `.husky/pre-commit` is `node scripts/quality/pre-commit.mjs`. `core.hooksPath` is `.husky/_`, and this worktree has the Husky 9 shim directory. `package.json` `lint-staged` no longer calls `scripts/lint-staged-eslint.sh`. The old `npx lint-staged` / `xargs npx eslint` / full `yarn lint` / `yarn typecheck` / `yarn vue-typecheck` hook is gone.
- [x] **QG-02 selection, in the common case.** Staged added, modified, and renamed paths are taken from `git diff --cached --name-status --diff-filter=ACMR -z`. Deletions are not in that filter. Rename records (`R100`, two paths) keep the destination. See the copy-status bug below for status `C`.
- [x] **QG-03 staged contents, by delegating to lint-staged.** `scripts/quality/lint-staged.config.mjs` is passed explicitly. The coordinator does not pass `--no-stash`, `--no-hide-partially-staged`, or `--fix`. lint-staged 16 appends filenames as argv, so the runner's `lintFiles(files)` sees the paths lint-staged checked out. There is no disposable-repo test proving a staged violation still fails when the fix exists only as an unstaged hunk.
- [x] **QG-04 / QG-12 fail closed for engine and parser errors that ESLint marks fatal.** `lint-files.mjs` turns an ESLint throw into exit 2. A fatal parse message stays a blocker. `scripts/quality/pre-commit.mjs` resolves `eslint`, `eslint-plugin-sonarjs`, `vue-eslint-parser`, `@typescript-eslint/parser`, and `lint-staged` from the repo and does not call `npx`.
- [x] **QG-05 selected rules are actually active.** Effective fast config (ESLint 8.57.1, `eslint-plugin-sonarjs@1.0.4`):
  - `sonarjs/cognitive-complexity`: `["error", 15]`
  - `sonarjs/no-identical-functions`: `"error"`
  - `sonarjs/no-all-duplicated-branches`: `"error"`
  - `@typescript-eslint/no-explicit-any`: `"error"` on TS/TSX/Vue
  - `@typescript-eslint/no-unused-vars`: `"error"` with `^_` args/vars/caught errors
  - `no-unused-vars`: `"off"` (no duplicate report)
  - `no-dupe-else-if`, `no-unreachable`: `"error"`
  - Vue files use `vue-eslint-parser`. `parserOptions.project` is absent on the fast profile.
  - `@typescript-eslint/no-floating-promises` is absent from the fast profile.
- [x] **QG-08 no auto-fix on the hook.** The runner constructs ESLint with `fix: false`.
- [x] **QG-09 offline hook.** The hook only `require.resolve`s installed packages and spawns local `git`, `node`, and `lint-staged`. Setup network use is `yarn install`, outside the hook.
- [x] **QG-11 command names exist.** `quality:staged`, `quality:deep`, `quality:audit`, `quality:fix`, `quality:doctor`, `test:quality-gate` are in `package.json`.
- [x] **SonarJS install.** Exact devDependency `eslint-plugin-sonarjs@1.0.4` (peer `eslint ^8 || ^9`, Node `>=16`, license `LGPL-3.0-only`). The recommended preset is not enabled. `yarn.lock` is updated. Operator notes are in `docs/development/local-quality-gate.md`.
- [x] **Duplicate ESLint config removed.** `package.json` `eslintConfig` is gone. `.eslintrc.json` remains the base that `scripts/quality/eslint-fast.cjs` extends by absolute path, with `useEslintrc: false` in the runner.
- [x] **Rule fixtures (AC-01, AC-02, AC-03, part of AC-10).** `test/quality-gate/rules.fixtures.test.mjs` covers explicit `any`, underscore unused-vars, duplicated branches in TS and Vue `<script setup lang="ts">`, complexity above 15, a below-ceiling fixture, and a fatal parse error. Invalid samples are created under `tmp-quality-fixtures/` for the test and deleted afterward. They are not left in `src/`.
- [x] **Exception unit tests (part of AC-08, AC-09).** `test/quality-gate/exceptions.test.mjs` covers duplicate keys, wildcard rules, traversal paths, expiry, the SonarJS 1.0.4 complexity sentence, unknown complexity text failing closed, count ceilings, and fatal messages.
- [x] **Architecture unit tests (part of AC-11, AC-12).** Alias, relative `../model`, `import type`, `require('typeorm')`, and `import('better-sqlite3')` are covered. A scan of the real worker tree produced zero findings.
- [x] **Legacy manifest shape.** `scripts/quality/exceptions.json` is schemaVersion 1, 736 entries, 618 files, 0 missing paths, 0 expired on 2026-10-22 (every entry expires `2027-01-31`). Complexity entries carry `maxComplexity`. The hook does not rewrite the file.
- [x] **Docs for limitations that were implemented.** Direct-import-only scope, count replacement, per-file complexity ceilings, rename non-transfer, and "deep is working-tree" are written in `docs/development/local-quality-gate.md`.

---

## Bugs

Each item is still open. Line numbers refer to the worktree at `ee97149c7`.

### BUG-1 — `yarn quality:deep` cannot finish

- **Requirements:** QG-11, QG-15, AC-14
- **Where:** `scripts/quality/deep.mjs` lines 46–55; `scripts/quality/eslint-deep.cjs` lines 17–29
- **What happens:** The deep profile sets `parserOptions.project` to `./tsconfig.json` for every file. `deep.mjs` then lints all of `src` and `test` with extensions `.js,.jsx,.cjs,.mjs,.ts,.tsx,.vue`. `src/childprocess/electron-shim/electron.js` is not in that tsconfig. ESLint returns a fatal parsing error:

  `Parsing error: ESLint was configured to run on .../electron.js using parserOptions.project: .../tsconfig.json. However, that TSConfig does not include this file.`

  `runStep` exits on the first non-zero status, so `yarn typecheck` and `yarn vue-typecheck` never start.
- **Evidence:** Deep lint of `src/config/appInfo.ts` succeeded (0 messages, ~24s, project load included). Deep lint of `electron.js` returned `fatalErrorCount` 1 in ~5s.
- **Done when:** `yarn quality:deep` gets past typed lint on this tree. Typed rules run on files the tsconfig includes. JS/MJS files outside the project are either in a dedicated deep tsconfig or omitted with an explicit scope line in the command output. A test runs the deep orchestrator against a fixture tree that contains one in-project TS file and one out-of-project JS file.

### BUG-2 — Existing IPC files cannot be committed

- **Requirements:** PRD §8 (do not make the current tree uncommittable), QG-06, QG-14
- **Where:** `scripts/quality/architecture-check.mjs`; `scripts/quality/exceptions.json` has zero `aifetchly/*` entries
- **What happens:** The checker is live on the hook and matches the whole staged file. These current value imports are blockers, with no allowance and no code fix:

  | File | Imports |
  |---|---|
  | `src/main-process/communication/ai-chat-workspace-ipc.ts:45` | `@/model/AIChatMessage.model` |
  | `src/main-process/communication/emailMarketingIpc.ts:43-46` | four `@/entity/*` value imports |
  | `src/main-process/communication/emailReceive-ipc.ts:68-70` | three `@/entity/*` value imports |
  | `src/main-process/communication/emailTemplate-ipc.ts:3` | `@/entity/EmailTemplate.entity` |
  | `src/main-process/communication/googleMaps-ipc.ts:16` | `@/model/Proxy.model` |
  | `src/main-process/communication/outboundEmailDelivery-ipc.ts:26-27` | two `@/model/*` imports |
  | `src/main-process/communication/yandexMaps-ipc.ts:17` | `@/model/Proxy.model` |

  13 findings, 7 files. `import type` from `@/entity/*` is allowed (confirmed: `emailExtractionMapsUrls.ts`, `plugin-ipc.ts`, and `ai-chat-v2-ipc.ts` were not reported). Worker files were clean.
- **Also:** `scripts/quality/audit.mjs` runs the ESLint CLI only. It never calls `checkArchitecture`, so a full audit does not list this debt and will not draft allowances for it.
- **Done when:** Each of these imports is either moved behind a module/controller or recorded as a reviewed allowance, and `yarn quality:audit` prints architecture findings. A commit that only touches one of these files is possible after that choice. New files still have no allowance.

### BUG-3 — Complexity allowances do not satisfy AC-09 on 121 files

- **Requirements:** AC-09; technical design §9 (only one above-threshold function per excepted file, unless function-level fingerprints exist)
- **Where:** `scripts/quality/check-exceptions.mjs` lines 145–168; `scripts/quality/exceptions.json`
- **What happens:** For `sonarjs/cognitive-complexity`, a finding is accepted when its count slot is free and the number parsed from the message is `<= maxComplexity`. `maxComplexity` is the worst function in the file, and `maxCount` is the number of over-threshold functions. Any other function in that file may rise up to the worst ceiling without changing the count.
- **Inventory:** 372 complexity entries. 251 have `maxCount` 1 (AC-09 holds for those). 121 have `maxCount` > 1. Worst rows:

  | Path | maxCount | maxComplexity |
  |---|---|---|
  | `src/service/AIChatQueryLoop.ts` | 7 | 752 |
  | `src/childprocess/YellowPagesScraper.ts` | 27 | 250 |
  | `src/views/components/aiChatV2/AiChatV2.vue` | 9 | 180 |
  | `src/controller/emailMarketingController.ts` | 4 | 174 |
  | `src/service/AIChatQueryEngine.ts` | 7 | 171 |

  On `AIChatQueryLoop.ts`, a function at complexity 16 can become 752 and the hook still accepts it. The unit test only covers a single finding whose own number exceeds `maxComplexity`. The shipped manifest does not follow the design rule that multi-function files must not get a complexity allowance until fingerprints exist.
- **Done when:** Every complexity allowance has `maxCount: 1`, or each function has its own fingerprint and ceiling. Raising any allowed function's complexity fails the hook even when the finding count stays the same. A fixture covers a two-function file.

### BUG-4 — The manifest is a bulk baseline, not reviewed debt

- **Requirements:** PRD §8 steps 2–3 and 6 (fix cheap violations; record reviewed debt; no automatic baseline as policy)
- **Where:** `scripts/quality/exceptions.json` (736 entries)
- **What happens:** Every entry uses owner `maintainer`, expiry `2027-01-31`, and the same reason: `Legacy baseline adopted 2026-10-21 from the quality audit; count/ceiling pinned — new findings block`. Counts:

  | Rule | Entries |
  |---|---|
  | `sonarjs/cognitive-complexity` | 372 |
  | `@typescript-eslint/no-unused-vars` | 210 |
  | `@typescript-eslint/no-explicit-any` | 111 |
  | `sonarjs/no-identical-functions` | 26 |
  | `sonarjs/no-all-duplicated-branches` | 7 |
  | `no-unreachable` | 5 |
  | `require-yield` | 2 |
  | `no-regex-spaces`, `prefer-const`, `no-unexpected-multiline` | 1 each |

  Unused locals and explicit `any` were the cheap fixes the rollout asked to make before freezing a ceiling. They were frozen instead. `require-yield`, `prefer-const`, `no-regex-spaces`, and `no-unexpected-multiline` are inherited `eslint:recommended` errors, not rules the fast policy selected on its own.
- **Done when:** Cheap unused-import / explicit-`any` hits in the gate's own new files are fixed (the quality scripts themselves should not need allowances unless a maintainer wrote a per-file reason). Remaining entries have a specific reason. Inherited recommended rules are either left as real errors with a named reason or kept out of the fast blocker set on purpose.

### BUG-5 — Policy-only commits do not validate the policy

- **Requirements:** Technical design §5 (policy-only changes validate policy/configuration before the no-source exit); QG-12
- **Where:** `scripts/quality/pre-commit.mjs` lines 127–160
- **What happens:** The comment says staged policy inputs are validated. The code only uses that list to avoid the docs-only exit. It then starts lint-staged, whose only task is `*.{js,jsx,cjs,mjs,ts,tsx,vue}`. A commit that stages a broken `scripts/quality/exceptions.json` and no source file never calls `loadManifest`. lint-staged reports no matching files and the hook exits 0. The next source commit fails. A configuration commit has already been recorded as a pass.
- **Done when:** If `exceptions.json`, `eslint-fast.cjs`, `policy.cjs`, or `lint-staged.config.mjs` is staged, the coordinator loads and validates them before exit, including when no source file is staged. A disposable-repo test commits a manifest with `schemaVersion: 99` and expects rejection.

### BUG-6 — Copied paths desynchronize the staged-file parser

- **Requirements:** QG-02 (copied files), AC-07
- **Where:** `scripts/quality/pre-commit.mjs` lines 109–121
- **What happens:** `git diff -z --name-status` emits `C100\0old\0new\0` when copy detection is on (`diff.renames=copies` or `copy`). The parser only consumes two paths when the status starts with `R`. A copy is treated as one path, and every later record is read at the wrong offset. This worktree's `diff.renames` is unset (Git default detects renames only), so a stock config does not hit it. A developer or CI image with `diff.renames=copies` can make `stagedSource` empty and take the docs-only exit while lint-staged is never started. That is a false pass.
- **Done when:** Statuses `C` and `R` both consume `old` and `new`, and only `new` is linted. A test feeds a NUL record list that contains a copy followed by a modified file and expects both destinations, in order.

### BUG-7 — `SqliteDb` with an extension bypasses the architecture rule

- **Requirements:** QG-14; technical design §8 (compare extension and index variants)
- **Where:** `scripts/quality/rules/index.cjs` `repoPathMatches` (lines 67–75), used by `architecture-check.mjs`
- **What happens:** Directory prefixes match `src/model/Foo.ts` because of the trailing slash. The file prefix `src/config/SqliteDb` matches only the exact string or `src/config/SqliteDb/`. Probe:

  | Specifier | Prohibited? |
  |---|---|
  | `@/config/SqliteDb` | yes |
  | `@/config/SqliteDb.ts` | no |
  | `@/config/SqliteDb.js` | no |
  | `typeorm/browser` | yes |
  | `@/entityTypes/Foo` | no |

  No current worker/IPC file uses the `.ts` form. The bypass is available to any new import that spells the extension.
- **Done when:** `@/config/SqliteDb.ts`, `.js`, `.tsx`, and the extensionless form all block, and `src/entityTypes/**` still passes. A unit test covers the extension form.

### BUG-8 — Inline `type` modifiers are treated as runtime imports

- **Requirements:** Technical design §8 (genuine type-only imports stay allowed); AC-11 / AC-12 false positives
- **Where:** `scripts/quality/architecture-check.mjs` line 175 (`if (entry.typeOnly) continue`) and `collectDirectImports` (lines 59–63), which sets `typeOnly` only from `ImportDeclaration.importKind === 'type'`
- **What happens:** `import { type Foo } from '@/entity/Foo.entity'` parses as `importKind: 'value'` with a specifier `importKind: 'type'`. The checker flags it. The same hole exists for `export { type Foo } from '...'`. The tests cover `import type` only. A probe of that inline form returned `typeOnly: false`.
- **Done when:** A declaration is ignored only when every specifier is type-only (or the declaration itself is `import type` / `export type`). A mixed value-and-type import still blocks. Tests cover both forms.

### BUG-9 — Architecture parse failures can be excepted

- **Requirements:** PRD §8.8; technical design §9 (parser and operational failures cannot be excepted)
- **Where:** `scripts/quality/architecture-check.mjs` lines 156–164; `scripts/quality/check-exceptions.mjs` lines 117–120
- **What happens:** A read or parse failure is pushed as rule `aifetchly/no-worker-db-imports` or `aifetchly/no-ipc-db-imports`, severity 2, with no `fatal: true`. The message says "never exceptable". The applicator only forces `message.fatal` through. Once a file has an allowance for that rule id, a parse failure consumes one `maxCount` slot and can disappear.
- **Done when:** Those findings set `fatal: true` (or a dedicated non-exceptable rule id the applicator always keeps). A unit test puts a parse-failure message under an architecture allowance and still sees it in `results`.

### BUG-10 — The hook never checks that the index stayed unchanged

- **Requirements:** Technical design §6.2
- **Where:** `scripts/quality/pre-commit.mjs` (lint-staged spawn at lines 190–229). There is no `git write-tree` / `git rev-parse` comparison before and after.
- **What happens:** The runner is read-only (`fix: false`), which avoids the usual ESLint rewrite. The design still requires the coordinator to reject the run if the index tree changes, including a concurrent `git add` during the hook. Today a changed index is still a successful commit when lint-staged returns 0.
- **Done when:** The coordinator records the index tree id before lint-staged and compares it after. A mismatch exits 2 and tells the user to retry, without `git reset` or stash deletion. A disposable-repo test covers it.

### BUG-11 — `quality:fix` does not run the gate profile

- **Requirements:** QG-11; technical design §10 (`yarn quality:fix <paths>` fixes the working tree and does not stage)
- **Where:** `package.json` script `quality:fix`: `node node_modules/eslint/bin/eslint.js --fix`
- **What happens:** The command uses the repository `.eslintrc.json`, where explicit `any` and unused vars are warnings, and SonarJS is not registered. It does not pass `--no-eslintrc` or `scripts/quality/eslint-fast.cjs`. It does not `git add` (that part is right). Running it with no paths lints from the config's default targets and can rewrite files the user did not name.
- **Done when:** The script runs the fast profile, `fix: true`, only on the paths the user passed, and refuses to run with an empty path list. It still does not stage. A test snapshots a file before and after and checks `git diff --cached` is empty.

### BUG-12 — `quality:doctor` writes its probe into the repository

- **Requirements:** AC-18 (doctor proves a fixture is rejected); technical design §11 (stay inside a temp directory)
- **Where:** `scripts/quality/doctor.mjs` lines 122–148
- **What happens:** `mkdtempSync` creates a directory and the `finally` block deletes it, but the probe file is `path.join(repoRoot, 'tmp-quality-doctor-fixture.ts')`. The temp directory is never used. The file is deleted only after `spawnSync` returns. A crash, timeout, or Ctrl-C leaves a violating `.ts` file at the repo root. It is not gitignored. The probe calls `lint-files.mjs` on the working tree. It does not create a commit, so AC-18's "fixture commit rejection" is not what doctor checks.
- **Done when:** The fixture lives only under the temp directory (or a gitignored probe path), deletion is in `finally`, and doctor either documents that it checks the runner rather than a commit or actually rejects a commit in a disposable repo.

### BUG-13 — Timeout recovery does not identify a lint-staged backup

- **Requirements:** AC-15; PRD §9 (restoration failure names any retained lint-staged backup)
- **Where:** `scripts/quality/pre-commit.mjs` lines 212–216
- **What happens:** On `ETIMEDOUT` the message says the commit was not created and points at `yarn quality:doctor`. `spawnSync` kills lint-staged mid-backup. The text does not mention `git stash list` or lint-staged's backup stash. The coordinator also does not restore anything itself, which matches the design, but the user-facing hint does not.
- **Done when:** The timeout and spawn-error paths print lint-staged's recovery hint (stash list / apply) and state that the hook will not delete stashes. A disposable-repo test interrupts the runner and asserts the pre-existing user stash is still present.

### BUG-14 — `yarn quality:deep` spawns `yarn` by name

- **Requirements:** QG-16; technical design §11 (argument arrays, `shell: false`, Windows via Node entry points)
- **Where:** `scripts/quality/deep.mjs` lines 67–68
- **What happens:** `spawnSync('yarn', ['typecheck'])` and the vue-typecheck step use the default `shell: false`. On Windows, `yarn` is typically `yarn.cmd`, and `spawnSync` does not run `.cmd` shims. The earlier review fixed lint-staged and ESLint to `process.execPath` plus the real JS entry. These two steps were not converted. The hook itself is a one-line `sh` script and is a separate path.
- **Done when:** Typecheck steps spawn `process.execPath` on the local tool entry, or spawn `yarn` with the same Windows-safe pattern already used for ESLint. A unit test asserts the spawn file and argv without starting a full typecheck.

### BUG-15 — Approved ignores are not wired, and a selected ignored file always fails closed without the approved path

- **Requirements:** AC-17; technical design §7 and §11 (approved generated/vendored/fixture paths are skipped with a reason; any other ignore is a failure)
- **Where:** `scripts/quality/policy.cjs` `approvedIgnores` (lines 84–90); `scripts/quality/eslint-fast.cjs` does not read that list; `scripts/quality/lint-files.mjs` lines 78–99
- **What happens:** `approvedIgnores` lists `.vite/**`, `dist/**`, `coverage/**`, `node_modules/**`, and `test/quality-gate/fixtures/invalid/**`. The fast config never sets `ignorePatterns` from that list. The fixture directory does not exist. `.eslintignore` only ignores `scripts/codesign-retry-shim/codesign`. Any selected file ESLint drops or tags with "File ignored" becomes exit 2, including a path the policy calls approved. The failure text is clear, which covers the "do not pretend it was checked" half of AC-17. The approved-skip half is not implemented.
- **Done when:** Approved patterns are applied in the fast config, a staged file matching one is skipped with the pattern printed, and a staged file ignored for any other reason still exits 2. Tests cover both.

### BUG-16 — JSON output was specified and then stripped

- **Requirements:** Technical design §10 (versioned JSON: mode, files, elapsed time, findings, accepted debt, blockers, operational errors; bounded human output)
- **Where:** `scripts/quality/lint-files.mjs` line 37 (`filter((a) => a !== '--json')`) and lines 149–183
- **What happens:** `--json` is removed and no JSON document is written. Human output lists every blocker with no cap. Warnings are a count only (path, line, column, rule, and message are printed for errors). A file whose name is the single argument `--json` would be dropped and the runner would exit 0 with "no files to check".
- **Done when:** `--json` emits one versioned object on stdout and keeps human diagnostics on stderr. Human blocker output is capped with the total count and a pointer to the JSON. `--json` is not removed from the file list.

### BUG-17 — Operator-guide edits are treated as policy changes

- **Requirements:** QG-10 (documentation-only commits skip lint engine startup, except policy-control changes)
- **Where:** `scripts/quality/policy.cjs` lines 98–101 (`docs/development/local-quality-gate.md` is in `policyControlInputs`)
- **What happens:** Technical design §6.1 names ESLint config, quality scripts, the exception manifest, lint-staged config, package manifest, lockfile, and ignore files. The operator guide is documentation. Staging only that file skips the docs-only exit and starts lint-staged. Lint-staged then finds no source match. Engine startup is extra work, and the performance budget for docs-only commits was not measured either way.
- **Done when:** That markdown path is not a policy input. A docs-only commit, including that file, prints the skip line and does not spawn lint-staged. Staging `policy.cjs` still refuses the skip and validates policy (see BUG-5).

### BUG-18 — Low-severity correctness nits

- **UTC expiry.** `check-exceptions.mjs` line 63 uses `new Date().toISOString().slice(0, 10)`, which is the UTC date. Near midnight a local expiry date flips a day early or late. Compare the local calendar date, and add a test around a date boundary.
- **Symlink parents.** The coordinator rejects an index mode `120000` file (`pre-commit.mjs` lines 162–178). `lint-files.mjs` lines 46–53 uses `path.resolve` and a string prefix check, which does not resolve a parent directory symlink. A symlink directory inside the repo can make `readFileSync` follow a path outside the worktree. Reject when `realpath` of the file or any parent leaves the repository.
- **Dead second implementation.** `scripts/quality/rules/index.cjs` `CallExpression` looks for `callee.type === 'ImportExpression'`. The live checker in `architecture-check.mjs` handles a top-level `ImportExpression`, and the tests exercise that path. The ESLint rule object is not what the hook runs. Delete it or make the checker call it so the two cannot drift.
- **Test and doctor litter.** `test/quality-gate/rules.fixtures.test.mjs` writes `tmp-quality-fixtures/` inside the repo. Combined with BUG-12, a killed process leaves violating sources in the worktree. Neither path is gitignored.

---

## Acceptance scenarios

| ID | Result | Notes |
|---|---|---|
| AC-01 | Partial | Fixture test blocks explicit `any` with rule id and location. No git commit is asserted. |
| AC-02 | Partial | Corrected TS and Vue script fixtures have zero errors. No commit is asserted. JSX/TSX/CJS/MJS have no fixtures. |
| AC-03 | Partial | Above-15 and below-ceiling TS fixtures pass in the test suite. Vue complexity is not fixtured. |
| AC-04 | Not verified | Depends on lint-staged's default partial-stash. No disposable-repo test. |
| AC-05 | Not verified | Same as AC-04. |
| AC-06 | Partial | Non-source, non-policy commits return before lint-staged. The operator guide is misclassified (BUG-17). No timing measurement. |
| AC-07 | Partial | NUL parsing and lint-staged argv avoid shell splitting. Copy records are wrong (BUG-6). No Unicode, space, or leading-hyphen fixture. |
| AC-08 | Partial | Unit test covers count increase. No commit test. Bulk baseline means "reviewed" is not true (BUG-4). |
| AC-09 | Failing on the tree | Unit test covers one function over its own ceiling. 121 files can grow a lesser function up to the file max (BUG-3). |
| AC-10 | Partial | Fatal parse fixture passes. Missing plugin and malformed config are handled in code and not integration-tested. Policy-only broken manifest still passes (BUG-5). |
| AC-11 | Partial | Unit tests and a clean worker-tree scan. Extension bypass (BUG-7) and inline `type` (BUG-8) remain. |
| AC-12 | Failing on the tree | The rule fires. Seven current IPC files are blocked with no allowance (BUG-2). |
| AC-13 | Not verified | Hook has no network call site. No offline run was performed. |
| AC-14 | Failing | Deep profile loads for an in-project TS file. The deep command fatals on JS under `src` (BUG-1). No test asserts step order or that watch scripts are absent. |
| AC-15 | Not verified | No interrupt fixture. Timeout text omits the backup stash (BUG-13). Index identity is not compared (BUG-10). |
| AC-16 | Partial | Unstaged edits of the listed policy paths use `git diff --name-only`. Untracked new policy files are invisible to `git diff`. No disposable-repo test. |
| AC-17 | Partial | Unexpected ignores exit 2 with a reason. Approved ignores are not applied (BUG-15). |
| AC-18 | Partial | `quality:doctor` checks Node, the pinned SonarJS version, profile load, manifest shape, hooksPath, shim directory, hook file text, and a duplicated-branch runner probe. It does not install a fresh checkout and does not reject a commit (BUG-12). |

---

## Delivery items still open

PRD §12 says completion needs the acceptance suite, a performance report, and a compatibility matrix. Those artifacts are not in the branch.

- [ ] **Git integration suite** (technical design §12): disposable repos for partial staging, unborn `HEAD`, renames, deletions, spaces, Unicode, pre-existing stashes, and index blob ids before and after both success and failure. Map them to AC-04, AC-05, AC-07, AC-15, AC-16.
- [ ] **Failure-injection tests:** missing `eslint-plugin-sonarjs`, unreadable fast config, timeout, and a lint-staged backup left behind. AC-10, AC-15.
- [ ] **Offline run:** hook with network blocked after `yarn install`. AC-13.
- [ ] **Fresh checkout:** `yarn install` (runs `prepare`), `yarn quality:doctor`, then a fixture commit that must be rejected. AC-18.
- [ ] **Platform note:** Linux was the only OS exercised here. Design §12 asks for Linux, macOS, and Windows, with any limitation recorded before the gate is enabled on that platform. BUG-14 is the known Windows defect in `quality:deep`.
- [ ] **Performance report (PRD §10):** at least 20 runs for docs-only, 10 files / 5,000 lines, and 50 files / 25,000 lines. Record p95, cold start separately, OS, CPU, RAM, Node, package versions, and file sizes. The operator guide says the budgets are not measured. `no-identical-functions` is enabled in the fast hook and is the first rule to time if a budget is missed.
- [ ] **Compatibility matrix (technical design §3):** engines, peer dependency, license, and `requiresTypeChecking` for the three SonarJS rules; parse proof for JS, CJS, JSX, TS, TSX, Vue `<script>`, Vue `<script setup lang="ts">`, and a Vue template syntax error; Node minimum actually tested. The operator guide records ESLint 8.57.1 and SonarJS 1.0.4 only. `vue-eslint-parser` is resolved (9.4.3) and checked by doctor, and it is not a direct dependency. Technical design §7.1 says to declare it because the fast path refers to it.
- [ ] **Explicit return types.** Technical design §7 lists `@typescript-eslint/explicit-function-return-type` as an error. `policy.cjs` sets it to `'warn'`, so new functions without a return type do not block. PRD §7 allows accounting for legacy debt. That debt is not in the manifest (the rule is not an error, so the audit did not collect it). Either switch it to error and baseline the real debt, or document warn-only as the release-one decision in the operator guide.
- [ ] **Fast profile is not an allowlist.** `eslint-fast.cjs` extends the full `.eslintrc.json` (`eslint:recommended`, `plugin:vue/vue3-recommended`, `@vue/eslint-config-typescript/recommended`) and then adds the selected errors. Effective TS parsing goes through `vue-eslint-parser` for `src/background.ts` as well as Vue files, with the TypeScript parser delegated. That is why Vue fixtures work. It also means every inherited error-level rule blocks a commit. The design asked to enable the selected rules and to keep cosmetic warnings non-blocking. Warnings stay non-blocking. Inherited errors were not reviewed one by one.
- [ ] **`scripts/lint-staged-eslint.sh` is still in the tree.** Nothing in `package.json` calls it. Remove it or point its header comment at the new runner so the next edit does not wire `npx` back in.
- [ ] **Worktree shim gap.** `.gitignore` ignores `.husky/_/`. A new worktree does not get the generated shim. Until `yarn prepare` runs in that worktree, Git never starts the hook, and the commit succeeds with no gate. Doctor reports a missing shim. The operator guide does not say to run `yarn prepare` in each worktree. Add that sentence. The coordinator cannot detect a hook that Git did not start.

---

## Suggested order

1. BUG-1 and BUG-2. Deep is unusable, and seven IPC files cannot be committed on this hook.
2. BUG-3 and BUG-4. Tighten or fingerprint complexity allowances, and replace the single boilerplate reason for any allowance that remains.
3. BUG-5, BUG-6, BUG-7, BUG-8, BUG-9. These are false passes or false blocks in the coordinator and the architecture rule.
4. BUG-10 through BUG-18, then the missing disposable-repo, offline, benchmark, and compatibility artifacts.

PRD §12: design documents and a passing unit suite do not finish the feature. The acceptance suite, the performance report, and the compatibility matrix are still required.
