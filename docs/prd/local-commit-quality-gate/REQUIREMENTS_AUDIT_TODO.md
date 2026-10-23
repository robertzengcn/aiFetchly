# Local Commit Quality Gate — Requirements Audit and Open TODOs

Audit date: 2026-10-23

Worktree: `.worktrees/local-commit-quality-gate`

Branch: `worktree-local-commit-quality-gate`

Reviewed HEAD: `bb5948a4a`

Requirements: [PRD.md](PRD.md), [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md)

## Verdict

**Not all requirements are implemented or verified.** The core hook, selected rules, bounded exceptions, commands, and integration suite exist. However, additional probes demonstrate false passes, false rejections, incomplete deep coverage, and a filesystem boundary violation. The earlier `IMPLEMENTATION_TODO.md` resolution statement that all 18 bugs are fixed and only two delivery items remain is too broad.

This is a new audit of the current implementation. Earlier findings are not automatically reopened: each item below describes the remaining behavior at the reviewed HEAD. This change records tasks only; it does not fix implementation code or regenerate exceptions.

The two requirement files in this worktree are byte-identical (SHA-256 checked) to the absolute paths supplied under `/home/robertzeng/project/aiFetchly/docs/prd/local-commit-quality-gate/`.

Priority: **P1** = false pass, required coverage missing, or unsafe write; **P2** = false rejection, incomplete diagnostics, or release verification gap; **P3** = documentation consistency.

## Verification performed

| Check | Observed result | Interpretation |
|---|---|---|
| `yarn test:quality-gate` | 50 passed, 0 failed; approximately 9.4 seconds | Existing tests pass; they do not cover all requirements below. |
| `yarn quality:doctor` | Exit 0; all checks passed; 735 exception entries | Installation works here. Doctor has incomplete checks; see F13. |
| `yarn lint` | Exit 0; 0 errors, 87 warnings | Existing Vue CLI lint command still runs after configuration consolidation. |
| `yarn quality:audit` | Exit 0; 1,732 raw findings across 736 file/rule pairs | This is predominantly tracked legacy debt, not 1,732 new feature defects. One new unexcepted pair is in the gate's own fixture test; see F12. |
| `yarn quality:deep` | Exit 1 at typed-lint chunk 1/16; 69 errors, 233 warnings | Real typed findings stop later steps as designed. Neither typecheck step ran. This alone is not a new gate defect; the silent scope omissions in F05 are. |
| Additional disposable-repository and API probes | Reproduced F01–F10 behavior described below | Actual source/configuration files in this worktree were not changed for probes. |
| Dialect smoke probes | JSX, TSX, CJS parse successfully; malformed Vue template emits Vue errors | These probes do not replace the missing committed compatibility fixtures. |

Full repository application tests, Electron execution, native database operations, fresh dependency installation, macOS/Windows runs, and new benchmark measurements were not performed. Existing performance claims were reviewed as artifacts, not independently remeasured.

## Requirement coverage

“Implemented” means supported by inspected code and the relevant checks performed here, not proof against every possible input.

| PRD ID | Status | Evidence / remaining work |
|---|---|---|
| QG-01 automatic installed hook | Implemented here; installation evidence incomplete | Hook and Husky shims are present; F13, V04. |
| QG-02 staged source selection | Implemented for common cases; edge verification incomplete | NUL-delimited ACMR selection exists; V01 covers actual copies, renames, deletions, submodules. |
| QG-03 complete staged contents | Partial | Partial-staging tests pass, but untracked policy can alter the result; F02, V01. |
| QG-04 errors/parser failures block | Failing in exception edge cases | Unknown-rule errors and Vue template parsing errors can be accepted as debt; F03. |
| QG-05 selected rule policy | Mostly implemented; contract deviation | SonarJS/TS/Vue rules run; explicit return types remain warnings; F14. |
| QG-06 bounded legacy policy | Partial | Count ceilings work; per-function complexity and manifest validation remain incomplete; F04, F09. |
| QG-07 actionable diagnostics | Partial | Error details and retry hints exist; warning/debt details and operational JSON are incomplete; F10. |
| QG-08 preserve index/worktree/stashes | Common cases implemented; interrupted-run verification incomplete | Read-only runner and backup behavior exist; V01. |
| QG-09 offline installed operation | Implementation appears local; required execution proof missing | V02. |
| QG-10 documentation fast path / policy validation | Partial | Ordinary docs skip linting; invalid policy-only commits can pass; F01. |
| QG-11 fast/deep/audit/fix/doctor commands | All present; incomplete behavior | F05, F08, F10, F11, F13. |
| QG-12 infrastructure failures never pass | Failing | F01 and F03; also F05 config diagnostics and V01 interruption coverage. |
| QG-13 unusual filenames | Partly verified | Space/Unicode integration test passes; remaining names/platform cases in V01/V04. |
| QG-14 direct-import restrictions | Failing for supported forms | Alias normalization, unrelated-path false positives, TS require imports, inline type exports; F06–F07. |
| QG-15 deeper semantic checks documented | Documented; deep coverage incomplete | F05, V03. |
| QG-16 Git CLI/GUI/platform support | Linux CLI verified only | V04. |

## Confirmed defects and incomplete implementation

### F01 — P1: Policy-only commits accept invalid effective ESLint configuration

- [ ] **Validate effective ESLint policy before reporting a policy-only commit as passed.**
- **Requirements:** QG-10, QG-12; technical design §§5–7; AC-10.
- **Location:** `scripts/quality/pre-commit.mjs:168` — the validation child imports modules and validates the exception manifest, but does not resolve/execute the ESLint configuration.
- **Reproduction:** In a disposable initialized repository with this hook installed, add `"missing-plugin/nonexistent-rule": "error"` to `.eslintrc.json` and stage only that JSON file. A real `git commit` exits **0**, prints `staged policy inputs validated`, then `lint engine skipped`. Staging a valid TS file afterward rejects its commit because the rule does not exist.
- **Impact:** A broken policy is committed as a success and prevents subsequent source commits. JSON/module loadability is insufficient to validate rule names, rule options, parser/plugin resolution, or effective profiles.
- **Done when:** Policy-only commits exercise representative effective configurations and reject invalid rules/options/plugins with an operational diagnostic. Validate staged package/lockfile control changes as applicable. Add a real-commit regression for the example above and preserve the ordinary documentation-only fast path.

### F02 — P1: Untracked policy helpers can weaken the staged policy

- [ ] **Check untracked effective policy inputs as well as tracked unstaged edits.**
- **Requirements:** QG-03, QG-12; AC-16; technical design §6.1.
- **Location:** `scripts/quality/pre-commit.mjs:151` uses only `git diff --name-only`; `policy.cjs` is loaded before this consistency check.
- **Reproduction:** Stage a change to `policy.cjs` that imports `./local-overrides.cjs`; leave that new helper untracked with `module.exports = { '@typescript-eslint/no-explicit-any': 'off' }`. Stage `export const value: any = 1;`. The real coordinator exits **0**, while `git ls-files --others` still lists the helper.
- **Impact:** The gate accepts source using policy that will not exist in the commit/fresh checkout.
- **Done when:** Effective policy dependencies must exist in the index and match it, including new helpers and ignore inputs. Reject missing/untracked dependencies before evaluating them. Use NUL-delimited path enumeration and test this exact staged-helper/untracked-dependency case.

### F03 — P1: Operational errors and Vue parsing errors can be exempted

- [ ] **Make configuration/rule-resolution and parser errors non-exceptable independently of `message.fatal`.**
- **Requirements:** QG-04, QG-06, QG-12; PRD §8.8; technical design §9; AC-10.
- **Location:** `scripts/quality/check-exceptions.mjs:139` onward only protects messages with `fatal`; rule validation at line 91 only checks string/wildcard shape.
- **Reproduction A:** Enable a nonexistent ESLint rule and add an exception for that rule/file. The real `lint-files.mjs --json Good.ts` exits **0**, reports one accepted debt item, and reports no operational errors despite `Definition for rule ... was not found`.
- **Reproduction B:** Lint `<template>{{ value + }}</template>`. Vue emits severity-2 `vue/no-parsing-error`, with `fatal` unset. `applyExceptions` with a matching allowance removes the parsing error and reports one accepted finding.
- **Impact:** Configuration failures and invalid Vue syntax can appear as successful checks.
- **Done when:** Known operational/parser diagnostics always survive exception filtering, manifest entries for such categories are rejected, and missing definitions yield operational failure. Add both reproductions as tests; retain existing protection for fatal TypeScript parser errors.

### F04 — P1: Aggregate complexity does not meet the required per-function ceiling contract

- [ ] **Enforce one exceptional complex function per file, or implement function identities and individual ceilings.**
- **Requirements:** AC-09; QG-06; technical design §9 explicitly requires this for files with multiple complex functions.
- **Location:** `scripts/quality/check-exceptions.mjs:195` onward; `scripts/quality/exceptions.json`.
- **Evidence:** There are **370** complexity allowance entries, **120** with `maxCount > 1`. Aggregate `maxTotalComplexity` is optional in the validator. An allowance with count 2, maximum 30, total 50 accepts findings **25 + 25** after a baseline of **30 + 20**: the second function worsens while total/count stay constant. Probe result: zero blockers, two accepted findings.
- **Impact:** The earlier “BUG-3 fixed” claim does not satisfy the technical design's explicit prohibition. Aggregate sums reduce exposure but do not identify which function became harder to understand.
- **Done when:** Reject multi-function allowances without identities/ceilings, or refactor those files to satisfy the single-function requirement. Add same-sum redistribution, function deletion/replacement, and aggregate-omission regressions. Any alternative needs an explicit requirements revision, not only a limitations note.

### F05 — P1: Deep lint silently excludes all Vue files and included JavaScript

- [ ] **Use an explicit, validated typed scope that includes Vue and supported JS/tooling targets.**
- **Requirements:** QG-11, QG-15; AC-14; technical design §7 deep profile.
- **Location:** `scripts/quality/deep-scope.mjs:27`; `scripts/quality/deep.mjs:64`; `scripts/quality/eslint-deep.cjs`.
- **Evidence:** `resolveTypedScope(process.cwd())` returns **3,109** typed targets and **zero `.vue` targets**, despite `src/**/*.vue` in `tsconfig.json`. Plain TypeScript config enumeration is not supplied Vue extension support. `forge.config.js` appears in `jsInProject`, but only `typedTargets` is passed to ESLint; the output nevertheless says included JS is “also in scope.” Tooling outside the root TSConfig gets only a fast pass. TS config read/parse diagnostics are also ignored.
- **Impact:** Floating/misused promises in Vue scripts and included JS never reach the requested typed rules. Later `vue-tsc` cannot replace those ESLint rules.
- **Done when:** Provide the dedicated typed TSConfig/scope described by the design, include Vue correctly, lint included JS, enumerate intentional exclusions accurately, and fail on config diagnostics. Add real typed Vue/JS fixtures that fail for both requested rules, plus orchestration tests proving order, stop-on-failure, and no watch commands.

### F06 — P1/P2: Architecture path normalization both misses DB imports and rejects unrelated modules

- [ ] **Normalize aliases and require a matching prefix before extension/index matching.**
- **Requirements:** QG-14; AC-11/AC-12; technical design §8.
- **Location:** `scripts/quality/rules/index.cjs:47` and `:67`.
- **False pass:** `import '@/entityTypes/../model/Foo'` in a worker passes the real runner with zero blockers. Alias mapping concatenates `src/` without normalizing `..`; the allowed `entityTypes` prefix then conceals the model destination. `@/modules/../config/SqliteDb` also escapes the rule.
- **False rejection:** `_internals.isProhibited('@/utils.ts', 'src/childprocess/probe.ts', ...)` returns **true**. The extension test slices by the prohibited prefix's length without first checking that the prefix matches; `src/utils.ts` happens to have the same stem length as `src/model`.
- **Done when:** Alias and relative forms undergo equivalent lexical normalization. Extension/index matching runs only after a real path-prefix match. Test normalized traversal, valid unrelated same-length names, true DB extensions, and `entityTypes` allowances for both boundaries.

### F07 — P1/P2: Architecture AST handling misses TS require imports and mishandles type exports

- [ ] **Cover TypeScript import-equals and inline export type modifiers.**
- **Requirements:** QG-14; technical design §8 literal `require` and genuine type-only handling.
- **Location:** `scripts/quality/architecture-check.mjs:59`, `:67`, `:125`.
- **False pass:** `import Db = require('typeorm'); export { Db };` in a worker exits **0**. The parser emits `TSImportEqualsDeclaration` / `TSExternalModuleReference`, not a `CallExpression`; no import is collected.
- **False rejection:** `export { type Foo } from '@/entity/Foo';` exits **1** with a DB-import finding. Export specifiers expose `exportKind`, but `declarationIsTypeOnly` only checks each specifier's `importKind`.
- **Done when:** Literal TS require imports block; all-type exports pass; mixed runtime/type exports block. Add worker and IPC regressions for each form.

### F08 — P1: Filesystem boundaries are not enforced consistently

- [ ] **Protect policy reads and explicit fixes against symlink escapes.**
- **Requirements:** Technical design §11 requires source and policy files to stay within the repository; QG-11 fix behavior.
- **Location:** `scripts/quality/fix.mjs:35`; `scripts/quality/check-exceptions.mjs:42`; policy imports in the coordinator. `lint-files.mjs` protects selected source realpaths, but these other paths do not.
- **Reproduction A:** In a disposable repo, point `Linked.ts` to a temporary file outside that repo containing `export let value = 1;`. `quality:fix Linked.ts` exits **0** and rewrites the outside file to `export const value = 1;`.
- **Reproduction B:** Point `scripts/quality/exceptions.json` to a temporary manifest outside the repo. The real fast runner loads it and exits **0**.
- **Done when:** Centralize lexical/realpath boundary validation for all source and policy reads/writes, before loading policy or applying fixes. Handle symlinked parents as well as files. Add tests that verify external bytes remain unchanged on rejected fixes.

### F09 — P2: Exception schema validation accepts invalid dates and non-exact paths

- [ ] **Validate calendar dates and exact canonical repository paths.**
- **Requirements:** QG-06; technical design §9.
- **Location:** `scripts/quality/check-exceptions.mjs:87` and `:106`.
- **Evidence:** `loadManifest` returns no errors for `expiresOn: '2099-99-99'` and for `path: '*'`. The date check verifies only a digit pattern, so impossible future dates can keep allowances active. Empty/noncanonical/platform-absolute path cases are not fully constrained. F03 separately covers prohibited rule categories.
- **Done when:** Round-trip actual calendar dates; reject wildcard, empty, absolute, traversal, and noncanonical paths consistently across platforms. Validate top-level and entry object shapes without uncaught TypeErrors. Add leap-day/date-boundary and malformed-JSON-shape tests.

### F10 — P2: Diagnostics omit warnings/debt details and operational JSON

- [ ] **Complete the human and machine-readable reporting contract.**
- **Requirements:** QG-07; technical design §10.
- **Location:** `scripts/quality/lint-files.mjs:248` onward and its `failOperational`; `scripts/quality/audit.mjs`.
- **Reproduction:** `export function value() { return 1; }` produces JSON with `warningCount: 1`, but no warning rule/location/message. Accepted debt is only a number, not distinguishable detailed findings. JSON blockers omit a severity field. Operational failures exit before a versioned JSON document; `operationalErrors` is always empty on the path that emits JSON. Audit prints human text plus a draft array, not the specified versioned JSON summary.
- **Done when:** Provide structured findings for warnings, accepted debt, blockers, and operational errors; keep stdout valid JSON in JSON mode, including failures. Bound human output while supplying actionable details and a reliable full-output command. Explicitly distinguish working-tree runner invocation from staged coordinator execution.

### F11 — P2: Full audit omits eligible files and does not report nonzero allowance reductions

- [ ] **Make the audit inventory and tightening report match the selected policy scope.**
- **Requirements:** QG-11; PRD §8; technical design §9–10.
- **Location:** `scripts/quality/audit.mjs:47` targets only `src`, `test`, `scripts`; the manifest comparison begins near line 135.
- **Evidence from code:** Root source/tooling files such as `forge.config.js` and `vite*.ts`/`vite*.mjs` are outside this inventory although the hook selects supported extensions anywhere. A count reduced from 5 to 2 is not reported as a tightening candidate: only complete disappearance is reported as stale. Aggregate complexity reductions/excess are not compared against existing totals. Fatal/unknown-rule pairs can also enter the printed draft allowance list.
- **Done when:** Inventory all eligible tracked source under the shared exclusions, distinguish missing paths from resolved rules, compare counts and all supported ceilings, and never suggest parser/infrastructure exceptions. Add small fixtures with root tooling, nonzero count reductions, stale paths, and fatal findings.

### F12 — P2: The gate's own fixture test fails its gate

- [ ] **Remove the unused import without adding an exception.**
- **Location:** `test/quality-gate/rules.fixtures.test.mjs:13` imports unused `os`.
- **Reproduction:** `node scripts/quality/lint-files.mjs --json test/quality-gate/rules.fixtures.test.mjs` exits **1** at line 13, column 8, rule `@typescript-eslint/no-unused-vars`.
- **Impact:** The test suite passes, but a commit touching this fixture file is rejected. Full audit proposes a new allowance for the gate's own code, contrary to the earlier zero-debt claim.
- **Done when:** The fixture file passes both its tests and the actual fast runner without a new allowance.

### F13 — P2: Doctor can report working installation without an executable hook

- [ ] **Check the actual shim and prove rejection through the installed hook.**
- **Requirements:** QG-01, QG-11; AC-18.
- **Location:** `scripts/quality/doctor.mjs:108` checks only existence of `.husky/_`; the probe at line 152 invokes `lint-files.mjs` directly.
- **Evidence from code:** An empty shim directory satisfies `husky:shims`. A comment containing the coordinator path satisfies the hook-content check. The probe checks only exit 1, so an unrelated lint/configuration error can satisfy the duplicated-branch test. This does not demonstrate that Git executes the hook. The probe also uses a fixed worktree filename instead of its allocated OS temp directory.
- **Done when:** Validate the expected shim file and platform-appropriate executability, use the real manifest validator, check the expected rule in probe output, and perform an actual fixture commit rejection in an isolated checkout with the installed hook wiring. Use unique temporary probe paths and preserve existing user files.

### F14 — P2: Explicit return types remain a documented design deviation

- [ ] **Reconcile the required blocking policy with the warning-only implementation.**
- **Requirements:** Technical design §7 initial rule contract says error; PRD §7 and repository policy require explicit returns with legacy accounting.
- **Location:** `scripts/quality/policy.cjs:65`; operator guide's release-one decisions.
- **Evidence:** A new exported function without a return annotation exits **0**, warning only. The operator guide records that decision, but the requested technical design still specifies error and there is no reviewed return-type debt baseline.
- **Done when:** Enable the required blocking policy with reviewed legacy migration, or obtain and record an explicit change to the requirement/design. Do not mark the original error-severity requirement implemented merely because the deviation is documented.

## Acceptance and release evidence still required

### V01 — P2: Complete failure, Git-state, and filename integration coverage

- [ ] Add interruption/timeout/restoration-failure tests in disposable repositories. Check staged blob IDs, index tree identity, worktree bytes, and pre-existing stash identities on success and rejection; verify recovery guidance identifies the retained backup. Make the safety timeout configurable as required by technical design §11.
- [ ] Inject missing dependencies, malformed effective configs, parser failures, unexpected ignores, unsafe symlinks, and concurrent staging. Existing source inspection and the single ordinary stash test do not prove timeout recovery.
- [ ] Exercise actual `C` copy records and `R` rename records, deletion-only changes, submodules, leading hyphens, quotes/newlines where supported, alternate `GIT_INDEX_FILE`, and worktree hook setup. Assert the intended status record was produced before asserting selection. The existing “copy” test writes unrelated invalid content into a new file and does not assert that Git emitted `C`; it can pass while testing a plain addition.
- [ ] Test policy deletion/replacement and unsupported source encodings explicitly. Current UTF-8 reads do not perform an explicit decoding-validity check.
- **Mapping:** QG-02/03/08/12/13; AC-04–07, AC-10, AC-15–17; technical design §§6, 11–12.

### V02 — P2: Run the real hook with network access disabled

- [ ] Replace the insufficient offline execution proof with an actual staged-source commit under network denial, covering the coordinator, lint-staged, lint runner, and child processes.
- **Evidence:** `test/quality-gate/offline.test.mjs` imports policy/checker modules and runs `git --version`. It never invokes `pre-commit.mjs`, `lint-files.mjs`, lint-staged, or `git commit`. The socket monkey patch is not propagated to child Node processes; the static scan also removes all lines containing backticks. The test header's “real commit” claim is inaccurate.
- **Done when:** Both valid and invalid source commits produce the expected result with networking denied throughout execution. Add a negative control that attempts networking and proves the harness catches it.
- **Mapping:** QG-09; AC-13.

### V03 — P2: Finish dependency and dialect compatibility deliverables

- [ ] Declare `vue-eslint-parser` as an explicit development dependency and update `yarn.lock`; it is directly imported by `architecture-check.mjs` but currently resolved transitively. Technical design §3.6 requires direct declarations.
- [ ] Commit valid/invalid fixtures for JS module, CJS, JSX, TSX, ordinary Vue `<script>`, Vue script setup, and Vue template parsing; verify the selected rules as well as parser startup. Add the typed Vue fixtures from F05.
- [ ] Verify the declared minimum Node version, rather than only Node 22.19.0; update the matrix with exact tested versions and results.
- **Evidence:** Current matrix explicitly acknowledges missing JSX/TSX fixtures and incorrectly lists a TS `parse-error.ts` fixture as Vue-template proof. Current 50-test suite does not contain the full dialect matrix. Audit-time JSX/TSX/CJS smoke probes passed, which is useful but not durable regression coverage.
- **Mapping:** QG-05/16; AC-02/03/10/14; PRD §7.1; technical design §3.

### V04 — P2: Fresh-checkout and supported platform/GUI verification

- [ ] In a fresh checkout with declared dependencies installed from the lockfile, run prepare, doctor, a valid fixture commit, and an invalid fixture commit. Do not substitute a symlink to this worktree's installed dependencies or a hand-written shim.
- [ ] Run Linux/macOS/Windows and at least representative Git GUI hook execution, recording supported versions and limitations. Existing docs appropriately mark macOS/Windows unverified; that is not evidence of QG-16 completion.
- [ ] Make the integration harness portable before using it as Windows evidence: it currently shells out to unquoted `chmod +x`, uses POSIX `/dev/null`, and creates a directory symlink without a Windows accommodation.
- **Mapping:** QG-01/16; AC-18; technical design §12.

### V05 — P2: Complete reproducible performance evidence

- [ ] Retain a repeatable benchmark harness and per-run timings for each of the three PRD workloads, including file bytes/line counts, actual CPU model and RAM, and a separately recorded cold-start sample/method.
- **Existing artifact:** `docs/development/quality-gate-performance.md` reports 20 runs and p95 34 ms / 862 ms / 1,513 ms, all under the budgets. This audit did not find a reason to assert those timings are false and did not rerun them.
- **Remaining gap:** CPU is only “28 vCPU (host class),” RAM is described using process RSS rather than workstation RAM, and cold startup is discussed without a separately tabulated measured sample. No committed benchmark harness/raw sample series accompanies the report. The documented p95 expression should make its zero-based/one-based indexing unambiguous.
- **Mapping:** PRD §10 and release completion in §12; technical design §12.

### D01 — P3: Correct implementation status and finish the copyable setup guide

- [ ] Link this audit from the historical `IMPLEMENTATION_TODO.md` and clearly mark its old snapshot sections; it currently says both “all 18 fixed” and “each item is still open.” Do not erase historical evidence.
- [ ] Add the verified exact install command (`yarn add --dev --exact eslint-plugin-sonarjs@1.0.4`) to the implementation guide, the concrete ESLint 8 configuration fragment, a single-file check, and an explicit ESLint 8 legacy versus ESLint 9 flat-config distinction. The proposed technical design still uses a version placeholder; the operator guide names the version but lacks a complete copyable recipe.
- [ ] Correct the matrix's test count, Vue-template proof, direct-parser dependency status, and Node/platform verification status. Explain the aggregate complexity implementation accurately while F04 remains open.
- [ ] Reconcile the operator guide's measured-performance claims with its later “not measured” paragraph; qualify doctor/offline/safety claims according to actual coverage.
- **Mapping:** PRD §7.1 and §§9–12; technical design §§3, 7.1, 12–14.

## Acceptance scenario disposition

| Scenario | Current disposition |
|---|---|
| AC-01 explicit `any` | Ordinary invalid commit rejects; F02 demonstrates a policy-consistency false pass. |
| AC-02 valid TS/Vue | TS commit and Vue runner fixtures pass; complete dialect/commit coverage remains V03. |
| AC-03 complexity threshold | Existing above/below TS fixtures pass; retain them and extend per V03/F04. |
| AC-04 staged violation, unstaged fix | Existing rejection test passes; exact preservation assertions remain V01. |
| AC-05 valid staged, unstaged violation | Existing success test passes; exact preservation assertions remain V01. |
| AC-06 docs-only | Existing real-commit test passes; policy-control exception incomplete in F01. |
| AC-07 selection and names | Spaces/Unicode verified; other Git/name cases remain V01. |
| AC-08 legacy count | Ordinary count unit tests pass; schema validation remains F09. |
| AC-09 complexity growth | Fails the multi-function requirement; F04. |
| AC-10 operational/parser failures | Incomplete and false-pass cases reproduced; F01/F03/V01. |
| AC-11 worker dependencies | Common forms pass tests; F06/F07 identify false passes/rejections. |
| AC-12 IPC dependencies | Same normalizer/AST defects as workers; F06/F07. |
| AC-13 offline hook | Not proven by current offline tests; V02. |
| AC-14 deep validation | Typed errors correctly stop the run, but Vue/JS are omitted; F05. |
| AC-15 preservation/interruption | Ordinary rejection/stash tests pass; interruption/restoration proof missing; V01. |
| AC-16 policy consistency | Tracked edits rejected; untracked effective helper passes; F02. |
| AC-17 unexpected ignore | Guard exists; committed end-to-end coverage still required; V01. |
| AC-18 fresh install/doctor rejection | Current doctor passes; fresh-install real-hook proof remains F13/V04. |

## Suggested execution order

1. Fix false passes and boundary violations: F01–F04, F06–F08.
2. Restore full requested deep coverage and schema/reporting behavior: F05, F09–F11, F13–F14.
3. Fix the gate's own unused import (F12), then add the regression tests alongside each implementation fix.
4. Complete V01–V05 and reconcile documentation (D01).

Each completed logical unit should be tested and committed under the repository's normal hook. Do not add blanket allowances, regenerate the baseline automatically, or bypass the hook to claim completion.
