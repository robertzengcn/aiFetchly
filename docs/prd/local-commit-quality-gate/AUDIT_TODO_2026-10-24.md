# Local Commit Quality Gate — Current Audit and Remaining TODOs

Audit date: 2026-10-24. Reviewed implementation: `92297f75a` on `worktree-local-commit-quality-gate`.

Requirements: [PRD.md](PRD.md) and [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md).

## Verdict

**Not all requirements are complete.** The main gate, selected rules, exception mechanism, local commands, compatibility fixtures, and benchmark artifacts exist. However, this review identified **12 reproducible defects**, plus outstanding installation, platform, recovery, and rollout work. Passing the current test suite is insufficient to declare the feature complete.

This is a new audit of the current code. It does not reopen resolved findings merely because they appear in the historical [requirements audit](REQUIREMENTS_AUDIT_TODO.md) or [implementation TODO](IMPLEMENTATION_TODO.md). Those files' resolution statements are not evidence that the cases below work. This change records tasks only; no implementation or exception allowances were changed.

Priorities: **P1** = false success or unreliable enforcement/verification; **P2** = incorrect rejection, missing coverage, boundary violation, or incomplete diagnostics; **P3** = minor output-contract defect. Every unchecked item below remains open.

## Verification performed

| Check | Current result | Interpretation |
|---|---|---|
| `yarn test:quality-gate` | **142 passed**, 0 failed, 0 skipped; 26.92 seconds | Existing regression coverage passes. Additional probes below expose uncovered cases. |
| `node scripts/quality/doctor.mjs` | Exit 0; all checks passed in this checkout | Current installation passes its checks; B02 demonstrates that doctor can also pass a broken installation. |
| `yarn lint` | Exit 0; 0 errors, 87 warnings | Existing Vue CLI lint remains operational. |
| `node scripts/quality/audit.mjs --json` | Exit 0; 4,051 inventory files; 5,037 raw findings; 1,584 file/rule pairs; 22 draft pairs | Mostly existing debt, not 5,037 newly introduced gate bugs. No reported expired/stale allowances, ceiling breaches, or manifest errors. Audit limitations are B03–B07. |
| `node scripts/quality/deep.mjs` | Exit 1 at typed-lint chunk 1/17; 69 errors and 233 warnings | Real typed findings stop the pipeline as designed. Subsequent chunks and both typecheck steps did **not** run. This failure alone is not a gate implementation defect. |
| Disposable-repository/API probes | Reproduced B01–B12 | Probes changed only temporary repositories or in-memory inputs. No application code was changed. |
| Performance artifacts | Report, harness, and raw samples exist | Existing report records 20 runs/workload and passing p95 budgets. Benchmarks were inspected, not rerun in this review. |

No fresh dependency installation, macOS/Windows/GUI run, application execution, or full application test suite was performed. The compatibility report records an earlier failed fresh-install attempt; that historical environment failure was not reproduced here.

## PRD requirement coverage

“Implemented” means supported by current code and reviewed tests, not a guarantee against every possible input. Some defects affect auxiliary commands rather than the normal pre-commit path; the distinction matters.

| ID | Status | Evidence / remaining work |
|---|---|---|
| QG-01 automatic installed hook | Implemented here; installation verification partial | Real commit tests pass; doctor can falsely certify broken wiring (B02); fresh installation/platform evidence remains (V01–V02). |
| QG-02 staged source selection | Partial | ACMR, rename/copy/deletion tests pass; suffixed gitlinks are incorrectly selected (B09). |
| QG-03 complete staged content | Implemented for tested normal paths | Both directions of partial staging and alternate-index tests pass. |
| QG-04 errors/parser failures block | Implemented in fast runner | Explicit-any, parser, unknown-rule, Vue parsing, and exception regressions pass. Auxiliary audit status is defective (B04). |
| QG-05 selected SonarJS/TS/Vue/core rules | Implemented | Exact SonarJS dependency, dialect fixtures, and blocking return-type rule exist. |
| QG-06 bounded legacy exceptions | Mechanism implemented; rollout incomplete | Validated counts, dates, per-function complexity positions, and expiry tests exist. Twenty-two existing pairs remain unreviewed (V04). |
| QG-07 actionable diagnostics | Partial | Blocker details and most runner JSON exist; successful hook warnings/summary disappear, and audit filenames can be corrupted (B07/B11/B12). |
| QG-08 preserve index/worktree/stashes | Implemented for tested paths; recovery verification partial | Success/rejection, partial staging, stashes, alternate index, and concurrent-staging tests pass. Mid-run interruption/restoration failure remains untested (V03). |
| QG-09 offline installed operation | Implemented with local evidence | Static scan and socket-poisoned real-commit tests pass; no hook download fallback. |
| QG-10 docs fast path / policy validation | Partial | Docs skip ESLint; most staged policy is validated. Deleting the runner evades policy validation (B01). |
| QG-11 local staged/deep/audit/fix/doctor commands | Present, with incomplete behavior | B02–B08/B12 describe command defects; the existence of commands does not establish correctness. |
| QG-12 operational failures cannot pass | Failing in demonstrated paths | B01/B02/B04; dependency declarations are incompletely validated (B10). |
| QG-13 unusual filenames | Hook cases tested; auxiliary commands partial | Hook spaces/Unicode/hyphens/quotes/newlines pass. Audit/deep option parsing and audit delimiter handling fail (B06–B07). |
| QG-14 direct-import architecture restrictions | Implemented for documented direct forms | Alias/relative paths, extensions, runtime/type-only forms, and literal import/require fixtures pass. Transitive/computed access remains an explicitly documented non-goal. |
| QG-15 deeper semantic checks | Documented; coverage partial | Typed rules and sequential checks exist; included JSX is silently omitted (B08). |
| QG-16 supported CLI/GUI/platform operation | Partially verified | Linux CLI only; macOS, Windows, GUIs, and declared-minimum Node remain unverified (V02). |

## Confirmed bugs and implementation gaps

### B01 — P1: Deleting a required runner passes policy validation

- [ ] **Validate policy deletions separately from source-file selection.**
- **Requirements:** QG-10/QG-12; AC-10; technical design §§5–6.
- **Location:** `scripts/quality/pre-commit.mjs:170`, `:255`, `:100`.
- **Reproduction:** In a disposable gate-enabled repository, run `git rm scripts/quality/lint-files.mjs`, then commit that deletion alone.
- **Actual:** Commit exits 0 with `no staged source files (staged: 0 non-source) — lint engine skipped`. The next valid TypeScript commit fails with `MODULE_NOT_FOUND`.
- **Cause:** `--diff-filter=ACMR` removes deletions before the same list is used to detect policy changes. The early required-file check does not include the lint runner. The existing deletion test deletes `policy.cjs`, which happens to fail its import, so it misses this path.
- **Done when:** Enumerate all policy changes, including deletion and rename-away; verify required runtime helpers before a policy-only success. Add real-commit regressions for the runner and other required helpers. Keep ordinary deleted-source-only commits fast and valid.

### B02 — P1: Doctor can certify a hook that permits invalid commits

- [ ] **Make doctor's commit probe exercise the installation being diagnosed.**
- **Requirements:** QG-01/QG-11/QG-12; AC-18.
- **Location:** `scripts/quality/doctor.mjs:141` and `:229`; `scripts/quality/disposable-gate.mjs:57`.
- **Reproduction:** In a disposable repo, leave `.husky/pre-commit` containing the proper coordinator command, but set executable `.husky/_/pre-commit` to `#!/bin/sh`, a `# husky runner` comment, and `exit 0`. Run doctor, then stage `export const value: any = 1;` and commit.
- **Actual:** Doctor exits **0**, including `shim sources the husky runner` and `real git commit rejected the invalid fixture`; the actual invalid commit also exits **0**.
- **Cause:** Shim verification accepts a substring, including a comment. The supposed installation probe constructs a separate repository with a newly handwritten working shim; it does not test the user's installed shim, Husky runner, and user hook.
- **Done when:** Reproduce the actual hook chain safely in the disposable probe, or otherwise verify its execution without mutating the user's index. Test no-op/comment-only shims, early `exit 0`, missing runner `h`, and broken user-hook execution. Require the expected rejection diagnostic and a valid commit, not arbitrary failure alone.

### B03 — P1: Audit silently treats unexpectedly ignored source as checked

- [ ] **Fail the audit on unapproved ignores or missing lint results.**
- **Requirements:** QG-11/QG-12; technical design §§7,9; the same fail-closed selection principle as AC-17.
- **Location:** `scripts/quality/audit.mjs:82`; `scripts/quality/audit-core.mjs:37`.
- **Reproduction:** Track `Probe.ts` with `export const value: any = 1;` and add `Probe.ts` to `.eslintignore`; run `node scripts/quality/audit.mjs --json` in the disposable repository.
- **Actual:** Exit 0, `inventoryFiles: 1`, `totalBlockers: 0`, no reported error. Removing the ignore exposes the violation.
- **Impact:** The inventory claims coverage it did not perform. Existing allowances for ignored files can be reported as stale, encouraging incorrect removal.
- **Done when:** Compare requested files with results, distinguish shared approved exclusions from unexpected ignores, and report skipped/error counts accurately. Add explicit-ignore and hidden-path tests. Reuse the fast runner's semantics rather than silently dropping ESLint ignore warnings.

### B04 — P1: Audit returns success for a broken ESLint configuration

- [ ] **Return operational failure and structured diagnostics for audit infrastructure errors.**
- **Requirements:** QG-12; technical design §10.
- **Location:** `scripts/quality/audit.mjs:71`, `:178`.
- **Reproduction:** Enable nonexistent rule `not-a-rule` and audit a tracked TS file.
- **Actual:** `codeDefects` contains `Definition for rule 'not-a-rule' was not found.`, but the audit exits **0**. Other engine/bootstrap failure paths exit before emitting JSON despite `--json`.
- **Cause:** ESLint status 1 is accepted, and the final exit code considers only manifest errors.
- **Done when:** Classify configuration/rule-resolution failures separately and exit 2 with a versioned JSON operational-error document. Preserve the intentional exit-0 read-only inventory behavior for ordinary legacy lint findings; those findings alone are not this bug.

### B05 — P2: Audit reads source outside the repository through symlinks

- [ ] **Apply repository-boundary checks to audit inputs before linting.**
- **Requirements:** Technical design §§6.1,11.
- **Location:** `scripts/quality/audit.mjs:45`–`:68`.
- **Reproduction:** Track `Linked.ts` as a symlink to a temporary file outside the repository containing explicit `any`; run audit.
- **Actual:** Audit follows the link, reports external contents as ordinary `Linked.ts` debt, and exits 0. This is a read-boundary defect; no external rewrite was observed.
- **Done when:** Check source modes and realpaths using the shared boundary helper before engine startup; reject source symlinks and parent-directory escapes. Test that the external file is never treated as repository source and operational JSON explains the rejection.

### B06 — P2: Leading-hyphen filenames become ESLint options in audit/deep

- [ ] **Preserve filenames as operands in every ESLint CLI invocation.**
- **Requirements:** QG-13; technical design §11.
- **Location:** `scripts/quality/audit.mjs:67`; `scripts/quality/deep.mjs:53`.
- **Reproduction:** Track a valid root `-bad.ts` and run audit. Inspect `buildSteps` for the same in-project filename.
- **Actual:** Audit exits 2 with `Invalid option '-b' - perhaps you meant '-c'?`. Deep builds the same unprotected relative-file argument list. The normal staged runner's filename test passes because it uses a different API path.
- **Done when:** Pass absolute paths or an explicit `--` terminator before file operands; test real audit and typed-lint execution with leading hyphens, spaces, and Unicode.

### B07 — P2: Legal POSIX `::` filenames corrupt audit output and drafts

- [ ] **Use an unambiguous representation for audit path/rule keys.**
- **Requirements:** QG-07/QG-13; technical design §9 exact manifest paths/rules.
- **Location:** `scripts/quality/audit-core.mjs:73`, `:195`.
- **Reproduction:** Feed `buildAuditReport` an explicit-any finding at `src/a::b.ts`.
- **Actual:** The summary reports rule `b.ts`, and the draft is `{ path: 'src/a', ruleId: 'b.ts', ... }`, instead of the original path and rule.
- **Cause:** Composite `path::rule` strings are decoded with an unrestricted split.
- **Done when:** Use nested maps, tuples, or reversible serialization. Assert exact path/rule round-tripping, including POSIX colons, in summaries, manifest matching, and draft generation. Guard filesystem fixtures where Windows disallows the name.

### B08 — P2: Deep validation silently omits included JSX

- [ ] **Include `.jsx` in the typed JavaScript target set.**
- **Requirements:** QG-11/QG-15; technical design §7 explicit typed scope.
- **Location:** `scripts/quality/deep-scope.mjs:185`–`:187`.
- **Reproduction:** Use a temporary TSConfig with `allowJs: true`, `include: ['src/**/*']`, and `src/Panel.jsx`. Resolve the scope and build deep steps.
- **Actual:** TypeScript enumeration includes the file in `scope.included`, but neither `typedTargets` nor `jsInProject` contains it; no typed ESLint step checks it.
- **Scope qualification:** This reproduces a supported-input omission. No current application JSX file affected under the present root TSConfig was identified.
- **Done when:** Include supported in-project JSX and add an actual JSX floating/misused-promise regression, alongside a clean counterpart. Report any intentional exclusion explicitly.

### B09 — P2: Source-suffixed submodules are incorrectly checked as files

- [ ] **Filter Git mode `160000` out before source-file preflight.**
- **Requirements:** QG-02; technical design §6.1 explicitly requires skipping submodules.
- **Location:** `scripts/quality/pre-commit.mjs:191`, `:403`–`:416`.
- **Reproduction:** In a disposable repo, create an index gitlink named `vendored.ts` using `git update-index --add --cacheinfo 160000,<existing-commit>,vendored.ts`; leave the submodule directory uninitialized and commit.
- **Actual:** Commit is rejected because `staged source is missing from the working tree`. With a directory present, the coordinator claims to check one source file while lint-staged finds none.
- **Done when:** Select regular source blobs by mode as well as extension. Add initialized/uninitialized suffixed-gitlink tests. The existing `vendored` submodule test has no source suffix and does not cover this case.

### B10 — P2: Dependency validation omits directly required configuration packages

- [ ] **Validate the full directly consumed ESLint configuration dependency set.**
- **Requirements:** QG-12; technical design §3, especially direct parser/plugin declarations.
- **Location:** `scripts/quality/pre-commit.mjs:344`–`:352`; `.eslintrc.json:8`.
- **Reproduction:** Remove `@typescript-eslint/eslint-plugin` and `@vue/eslint-config-typescript` declarations from a staged package manifest while leaving existing `node_modules` installed.
- **Actual:** The policy commit succeeds and prints `staged policy inputs validated`; the required-dependency list omits both packages.
- **Impact qualification:** Acceptance of missing declarations was reproduced. Failure of a subsequent clean install depends on incidental transitive availability and was **not** separately reproduced.
- **Done when:** Derive or maintain the complete direct dependency contract, including shareable configs and plugins used by them; test missing declarations and manifest/installed-tree mismatches. Verify fresh lockfile installation as V01 rather than relying on current hoisting.

### B11 — P2: Successful hook output hides warnings and runner summaries

- [ ] **Surface bounded warning details and aggregate successful-run totals.**
- **Requirements:** QG-07; technical design §7 keeps warnings visible; §10 requires diagnostic details and totals.
- **Location:** `scripts/quality/lint-files.mjs:306`–`:327`; `scripts/quality/pre-commit.mjs:442`.
- **Reproduction:** Run the fast runner on warning-bearing, otherwise valid code; then commit valid/warning-bearing source through the hook.
- **Actual:** Direct human output prints blocker details and only a warning count, with no warning locations/rules/messages. Successful lint-staged task stdout is hidden, so the real commit shows task progress and `staged files passed` without the runner's elapsed time, warning count, or accepted-debt count.
- **Done when:** Show bounded warning diagnostics and a visible summary for actual commits, including multiple argument chunks. Keep warnings nonblocking and accepted debt distinct. Add assertions against real hook output, not only direct runner output.

### B12 — P3: Empty JSON invocation returns non-JSON success

- [ ] **Emit a valid empty report when JSON mode has no paths.**
- **Requirement:** Technical design §10 versioned JSON contract.
- **Location:** `scripts/quality/lint-files.mjs:72`–`:75`.
- **Reproduction:** `node scripts/quality/lint-files.mjs --json`.
- **Actual:** Exit 0 with `quality: no files to check`; JSON consumers cannot parse it.
- **Done when:** Emit a versioned zero-file report, or an explicit structured usage error if empty input is intentionally unsupported; test parsing and exit status.

## Outstanding delivery and validation tasks

### V01 — P2: Complete the fresh-checkout installation acceptance drill

- [ ] Run and retain a successful clean lockfile-install → prepare → doctor → valid commit → expected invalid-commit rejection drill after B02/B10 are fixed.
- **Requirements:** AC-18; PRD §12; technical design §§3,12.
- The harness exists at `scripts/quality/fresh-checkout-drill.mjs`; successful execution is still absent from the compatibility report. The historical failure was registry access/cache related, not a completed acceptance result.
- Before relying on it across platforms, fix the inspected portability problem at lines 63/70/73: it spawns bare `yarn` with `shell: false`, unlike the Node-entry strategy used elsewhere. Standard Windows `.cmd` shims require deliberate handling. This Windows failure was identified from code, not executed on Windows here.
- Also check the returned status from the `prepare` step at line 70; currently it is discarded. Require the expected rule/diagnostic for the invalid commit, rather than treating any nonzero status as proof of enforcement.
- **Done when:** Record actual versions, install result, prepare status, doctor result, and both commit outcomes from a clean clone using installed locked dependencies, not the symlink-based fixture helper.

### V02 — P2: Finish platform, GUI, and declared-minimum Node verification

- [ ] Run the focused suite and installation/commit checks on macOS and Windows, plus at least the supported Git GUI paths; verify the declared Node minimum or adjust the supported range deliberately.
- **Requirements:** QG-16; PRD §12; technical design §§3,12.
- `docs/development/quality-gate-compatibility.md` explicitly marks macOS, Windows, and GUIs **NOT TESTED**. Only Node **22.19.0** is verified, while `package.json` permits **22.0.0**.
- **Done when:** Record OS/Git/Node/package/GUI versions and real results, including filename cases supported on each OS. Scope support explicitly if a platform remains unsupported. Portable-looking code and a prepared harness are not execution evidence.

### V03 — P2: Verify interruption after backup creation and restoration failure

- [ ] Add synchronized mid-run interruption and forced restoration-failure fixtures in disposable repositories.
- **Requirements:** AC-15; QG-08/QG-12; technical design §§6.3,12.
- `test/quality-gate/git-integration.test.mjs:416`–`:446` uses a **1 ms** timeout, before meaningful lint-staged backup/hunk processing. It checks a generic `/stash/` recovery hint. No test injects SIGINT/SIGTERM after hidden unstaged hunks or forces restoration to fail.
- **Done when:** Wait until the backup exists and partial hunks are hidden, interrupt, and verify index blobs, worktree bytes, and pre-existing stashes. For an explicit recovery failure, identify the retained backup and demonstrate documented restoration in the sandbox. Do not delete user stashes or assert automatic recovery from uncatchable termination.
- **Qualification:** This is missing verification, not evidence that current runs lose user data.

### V04 — P2: Finish review of existing unmanifested legacy findings

- [ ] Review and either fix or deliberately approve each of the 22 existing file/rule pairs below.
- **Requirement:** PRD §8 gradual rollout without unrelated legacy refactoring; technical design §9.
- The current audit still produces **22 draft pairs across 18 files**. Commits touching these files can block even if they do not introduce the existing finding. The earlier report explicitly left this work review-pending.
- **Done when:** Fix cheap cases, then review any remaining exception individually with owner, rationale, expiry, and required function ceilings. Do not bulk-adopt generated drafts or regenerate the baseline automatically. Rerun audit after B03–B07 are addressed.

| Existing file | Rule | Current count |
|---|---|---:|
| `agent-harness/src/adapter/cli-database.ts` | `@typescript-eslint/explicit-function-return-type` | 2 |
| `agent-harness/src/adapter/cli-database.ts` | `sonarjs/cognitive-complexity` | 1 |
| `agent-harness/src/commands/contact.ts` | `sonarjs/cognitive-complexity` | 1 |
| `agent-harness/src/commands/dashboard.ts` | `sonarjs/cognitive-complexity` | 1 |
| `agent-harness/src/commands/email-extraction.ts` | `@typescript-eslint/no-explicit-any` | 2 |
| `agent-harness/src/commands/email-marketing.ts` | `@typescript-eslint/no-explicit-any` | 1 |
| `agent-harness/src/commands/maps.ts` | `@typescript-eslint/explicit-function-return-type` | 1 |
| `agent-harness/src/commands/search.ts` | `sonarjs/cognitive-complexity` | 1 |
| `agent-harness/src/commands/task.ts` | `@typescript-eslint/no-explicit-any` | 2 |
| `docs/scecurit_issues/verify-fixes.js` | `sonarjs/cognitive-complexity` | 2 |
| `forge.config.js` | `sonarjs/cognitive-complexity` | 1 |
| `typings/amap.d.ts` | `@typescript-eslint/no-explicit-any` | 5 |
| `typings/index.d.ts` | `@typescript-eslint/no-explicit-any` | 5 |
| `vite-plugin-close.ts` | `@typescript-eslint/no-unused-vars` | 1 |
| `vite-plugin-renderer-node-guard.ts` | `sonarjs/cognitive-complexity` | 1 |
| `vite-plugin-renderer-node-guard.ts` | `sonarjs/no-all-duplicated-branches` | 1 |
| `vite.buckEmail.config.mjs` | `@typescript-eslint/no-unused-vars` | 3 |
| `vite.main.config.mjs` | `@typescript-eslint/no-unused-vars` | 1 |
| `vite.main.shared.mjs` | `@typescript-eslint/no-unused-vars` | 1 |
| `vite.main.shared.mjs` | `sonarjs/cognitive-complexity` | 1 |
| `vite.utilityCode.config.mjs` | `@typescript-eslint/no-unused-vars` | 1 |
| `vite.utilityCode.config.mjs` | `no-dupe-keys` | 1 |

These counts are raw current findings, not automatically acceptable allowances. The separate 69 typed errors from the first deep chunk are existing application findings; this review did not establish that fixing all application type debt belongs to the gate implementation's scope.

### D01 — P3: Reconcile completion claims after remediation

- [ ] Update the implementation-status documents to distinguish implemented code, verified behavior, remaining debt, and environment-dependent evidence.
- Both source specification files still say “Proposed,” while the historical audit says every verification item was delivered and then acknowledges incomplete installation/platform execution. Neither wording provides an accurate current completion statement.
- **Done when:** Link this audit from the implementation record, record the resolution and validating test/commit for each task, and keep V01–V03 open until the corresponding execution evidence exists. Preserve historical results as historical rather than silently replacing them.

## Acceptance-scenario cross-check

| Scenario | Current conclusion |
|---|---|
| AC-01 explicit `any` | Real-commit rejection test passes. |
| AC-02 valid TS/Vue | TS commit and Vue rule/dialect fixtures pass; installation certification remains B02/V01. |
| AC-03 complexity | Above/below-threshold and per-function allowance fixtures pass. |
| AC-04 staged invalid / unstaged fix | Integration test passes with preserved unstaged content. |
| AC-05 staged valid / unstaged invalid | Integration test passes with preserved unstaged content. |
| AC-06 docs only | Integration test passes; policy deletion is the separate B01 gap. |
| AC-07 deletion/rename/spaces/Unicode | Existing integration cases pass; gitlink suffix and auxiliary filename gaps are B06/B07/B09. |
| AC-08 stable/decreased debt | Exception tests pass; rollout decisions remain V04. |
| AC-09 worsening complexity | Per-function ceiling tests pass. Position-based identities require deliberate manifest review when functions move. |
| AC-10 broken plugin/config/parser | Existing fast-path regressions pass; B01/B04 expose additional operational-validation failures. |
| AC-11 worker imports | Architecture fixtures pass for documented direct forms. |
| AC-12 IPC imports | Architecture fixtures pass for documented direct forms. |
| AC-13 offline hook | Socket-poisoned real-commit and negative-control tests pass. |
| AC-14 deep requested | Orchestration tests pass; JSX omission B08 remains. Actual current deep run stops on typed findings before typechecks. |
| AC-15 rejection/interruption/recovery | Ordinary rejection and early timeout covered; substantive interruption/restoration still V03. |
| AC-16 unstaged policy | Current consistency tests pass, including ignored untracked helpers. |
| AC-17 unexpectedly ignored file | Fast runner coverage passes; full audit does not preserve the same guarantee (B03). |
| AC-18 fresh installation/doctor | Incomplete: B02 and V01. A synthetic gate repository is not proof of the actual installation. |

## Suggested completion order

1. B01–B04: eliminate misleading successes and broken-policy commits.
2. B05–B10: enforce audit boundaries and complete filename, source-selection, typed-scope, and dependency handling.
3. B11–B12 and V03: finish visible diagnostics, structured output, and recovery evidence.
4. V04: review the remaining legacy rollout decisions explicitly.
5. V01–V02: execute clean installation and platform/minimum-version acceptance; then resolve D01 from recorded evidence.

The existing benchmark harness, raw samples, and compatibility fixtures are delivered artifacts and are not marked missing. Re-run relevant benchmarks after changes to the normal hook path; a new performance run was not needed merely to create this report.
