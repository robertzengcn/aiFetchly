# Local Commit Quality Gate — Product Requirements

Status: Proposed; this document does not install or enable the gate.
Date: 2026-10-21
Project: AiFetchly
Technical companion: [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md)

## 1. Problem and intended outcome

Developers and coding agents need immediate feedback when a commit introduces confusing logic, suspicious conditions, explicit `any`, unused code, or forbidden dependencies. Waiting for hosted CI is unsuitable for this local workflow. A single file-level complexity score does not explain which statements should change and cannot establish correctness.

Provide a free, local pre-commit gate using the existing Husky and lint-staged installation, ESLint, TypeScript/Vue rules, and selected SonarJS rules. A blocking finding rejects the commit and reports its file, position, rule, and reason. Normal commits check staged source files without running the application, compiling the project, accessing the database, or contacting a service.

## 2. Repository evidence

Inspected on the date above:

- `.husky/pre-commit` invokes lint-staged, a second staged ESLint pass, full-project lint, `yarn typecheck`, and `yarn vue-typecheck`.
- `package.json` maps staged JS/TS/Vue files to `scripts/lint-staged-eslint.sh`, which uses `eslint --fix` and shell word splitting for batches.
- `.eslintrc.json` uses Vue and TypeScript recommended configurations, but explicit `any` and unused variables are warnings.
- A second ESLint configuration exists in `package.json`. The implementation must establish one authoritative policy rather than assume the configurations combine.
- Current declared tools include ESLint 8, TypeScript ESLint 7, Vue ESLint 9, Husky 9, and lint-staged 16. SonarJS is not currently declared.
- The existing hook's full-project commands can slow down even documentation-only commits.

These are configuration observations, not performance measurements or a claim that every existing check passes.

## 3. Users and scenarios

| User | Need | Expected result |
|---|---|---|
| Developer | Commit a small TypeScript change | Only staged source is linted; useful feedback appears locally |
| Coding agent | Understand a rejected commit | Stable rule IDs and source positions make the repair concrete |
| Vue contributor | Edit script and template code | Vue parsing remains intact and template rules still run |
| Maintainer | Improve a complex legacy function | Existing debt does not force unrelated refactoring |
| Offline contributor | Commit after dependencies are installed | No downloads, account, API key, or network request |
| Contributor using partial staging | Commit only selected hunks | Unstaged fixes cannot conceal a staged violation |

## 4. Goals

1. Reject newly introduced violations of the selected blocking rules before a normal local commit completes.
2. Keep the routine hook narrowly scoped and measurable.
3. Preserve Git index and working-tree contents on both success and failure.
4. Reuse the existing stack with minimal dependency and configuration changes.
5. Provide a gradual, explicit migration for legacy violations.
6. Keep deeper checks available as an intentional local command.

## 5. Non-goals

- No required hosted CI, branch protection change, or cloud quality service.
- No SonarQube server, dashboard, paid subscription, or AI review API.
- No FTA score or repository-wide synthetic quality score as the merge/commit criterion.
- No guarantee of bug-free code or comprehensive security detection.
- No full test suite, full type checking, or type-aware linting in the default hook.
- No application UI, IPC, database entity, worker process, or translation changes.
- No simultaneous Oxlint migration or Semgrep rollout.
- No claim that local hooks prevent deliberate bypass by the repository owner.

Existing CI workflows remain outside this feature's scope. This design neither requires nor removes them.

## 6. Product behavior and requirements

| ID | Requirement | Priority |
|---|---|---|
| QG-01 | A normal `git commit` runs the installed local gate automatically | Must |
| QG-02 | Check staged added, modified, copied, and renamed supported source files; skip deleted files | Must |
| QG-03 | Check complete staged file contents, not only modified lines and not unstaged working-tree content | Must |
| QG-04 | Any active error or parser failure blocks the commit | Must |
| QG-05 | Include selected SonarJS, TypeScript, Vue, and basic ESLint checks | Must |
| QG-06 | Use an explicit, bounded legacy exception policy | Must |
| QG-07 | Show relative path, line, column, rule ID, severity, message, and a fix/retry hint | Must |
| QG-08 | Do not auto-fix, auto-stage, drop hunks, or delete user stashes during the normal gate | Must |
| QG-09 | Work offline after installation; never download missing tools in the hook | Must |
| QG-10 | Documentation-only commits skip lint engine startup, except policy-control changes | Must |
| QG-11 | Provide explicit local fast, deep, audit, fix, and installation-diagnostic commands | Must |
| QG-12 | Configuration, dependency, parser, timeout, or restoration failures must never appear as a pass | Must |
| QG-13 | Handle spaces, Unicode, leading hyphens, and platform-supported unusual file names safely | Must |
| QG-14 | Add direct-import architecture restrictions for workers and IPC files | Must |
| QG-15 | Document deeper checks for rules that cannot be established by syntax-only linting | Must |
| QG-16 | Support Git CLI and GUIs that execute normal Git hooks on supported developer platforms | Must |

Supported source extensions for release one: `.js`, `.jsx`, `.cjs`, `.mjs`, `.ts`, `.tsx`, and `.vue`. Include tests and tooling code with appropriate parser/environment overrides. Declaration files retain applicable TypeScript rules; disable only rules that are invalid for declarations. Generated output, vendored code, dependencies, and dedicated invalid-code test fixtures have explicit narrow exclusions.

## 7. Blocking policy

The initial policy combines bug patterns with maintainability limits:

| Category | Initial decision |
|---|---|
| Syntax and Vue template errors | Block |
| Explicit `any` | Block in enabled scope |
| Unused variables/imports | Block; preserve documented underscore convention |
| Identical branches and repeated conditions | Block using selected verified rules |
| Cognitive complexity | Initial maximum 15 per function; calibrate using a read-only audit |
| Missing explicit function return types | Enable according to repository policy; account for legacy debt |
| Direct prohibited dependency imports | Block in worker/IPC boundaries |
| Cosmetic style preferences | Preserve current policy; do not make all warnings blocking |
| Unhandled/misused promises requiring type information | Deep local command, not routine pre-commit |

A complexity value of 15 is a proposed project threshold, not a proven boundary between correct and incorrect code. It measures function reasoning complexity, unlike FTA's file aggregate. Refactoring should improve cohesion and readability; splitting files merely to manipulate a score is not an acceptance criterion.

### 7.1 SonarJS configuration deliverable

The implementation must include a copyable setup guide, not just a list of tools. Follow technical design section 7.1 for the actual configuration examples.

1. Install an exact compatible `eslint-plugin-sonarjs` release as a development dependency and commit `yarn.lock`. No global installation or server is required.
2. Register `sonarjs` in the ESLint 8 `plugins` array. Use the existing Vue parser configuration and delegate TypeScript script parsing correctly.
3. Enable these initial SonarJS rules explicitly:

```json
{
  "plugins": ["sonarjs"],
  "rules": {
    "sonarjs/cognitive-complexity": ["error", 15],
    "sonarjs/no-identical-functions": "error",
    "sonarjs/no-all-duplicated-branches": "error"
  }
}
```

This is a configuration fragment to merge with the existing policy, not a replacement for the repository's entire ESLint configuration. Do not enable the complete SonarJS recommended preset in the fast hook: it may introduce expensive, type-dependent, or noisy rules beyond the selected policy.

4. Connect the explicit fast profile to the existing Husky/lint-staged flow. A SonarJS error must reject a staged commit; a warning must remain nonblocking.
5. Document how to change the complexity limit, inspect effective rules, run a single-file check, and diagnose missing-plugin/configuration errors.
6. Verify a deliberately duplicated-branch fixture fails and a corrected fixture passes, including a Vue script fixture.

Configuration acceptance: the guide must identify exact file locations, show install and verification commands, distinguish ESLint 8 legacy syntax from ESLint 9 flat syntax, and explain that the three SonarJS rules above require no SonarQube account, service URL, or token. Version compatibility must be established before publishing the final installation command with its exact version.

## 8. Legacy code rollout

Do not abruptly enable new rules across every legacy file and leave the project unable to commit.

1. Run a local read-only inventory before enforcement and classify actual findings.
2. Fix cheap, unambiguous violations in the implementation scope.
3. Record remaining reviewed debt in a tracked exception manifest with file, rule, maximum allowed count, rationale, owner, and expiry date.
4. Require no increase in the permitted count for an exceptional file/rule; new files have no allowance.
5. Complexity exceptions additionally record a numeric ceiling that may not increase. The technical design specifies the necessary comparison behavior.
6. No automatic baseline regeneration in a commit hook. New allowances are deliberate policy changes.
7. Expired exceptions block when their file is touched. A full audit also detects expired exceptions in untouched files.
8. Parser failures and infrastructure failures cannot be excepted.

Count allowances can miss a replacement of one violation with another. Release one discloses this limitation; it does not claim perfect tracking of semantic debt. Follow-up work may add AST fingerprints if the additional complexity is justified.

## 9. Developer experience

Successful example:

```text
quality: checked 4 staged files in 1.8s; 0 blockers; 2 warnings
```

Rejected example:

```text
src/modules/Example.ts:42:3 error sonarjs/cognitive-complexity
Function complexity 22 exceeds the configured limit 15.
Commit blocked. Simplify the function, stage the correction, and retry.
Deep checks were not run.
```

These timings and messages are illustrative, not measured results.

A missing dependency reports the installation command and fails; it must not invoke a network-capable `npx` fallback. A restoration failure gives recovery guidance and identifies any retained lint-staged backup. A deliberate hook bypass is a documented Git limitation, not a normal repair suggestion.

## 10. Performance and privacy

Proposed acceptance budgets on a documented reference workstation, after dependency installation:

| Workload | Target |
|---|---|
| Documentation-only commit with no policy changes | p95 under 1 second |
| Up to 10 small/medium staged source files, at most 5,000 total lines | p95 under 5 seconds |
| 50 staged source files, at most 25,000 total lines | p95 under 15 seconds |

Measure at least 20 runs per workload, report cold startup separately, and record OS, CPU, RAM, Node, package versions, and file sizes. These are release targets, not current guarantees. If missed, profile parser/rule time and limit expensive rules before considering a different engine. Large commits remain checked; timeouts fail with a clear diagnostic rather than silently passing.

Source code, diagnostics, and timing data remain local. No remote analytics or uploads. The tooling must not initialize Electron or native database bindings.

## 11. Acceptance scenarios

| ID | Scenario | Acceptance |
|---|---|---|
| AC-01 | New staged file contains explicit `any` | Commit rejected with precise rule/location |
| AC-02 | Valid TS and Vue changes | Commit succeeds |
| AC-03 | Function exceeds complexity ceiling | Commit rejected; within-ceiling fixture passes |
| AC-04 | Staged violation is fixed only in unstaged hunks | Commit rejected; unstaged fix preserved |
| AC-05 | Valid staged content has an unstaged violation | Commit may pass; unstaged content preserved |
| AC-06 | Documentation-only change | No full lint/typecheck/test invocation |
| AC-07 | Deleted/renamed/spaced/Unicode file | Correct selection; no shell argument splitting |
| AC-08 | Legacy allowed count stays constant or decreases | Commit allowed; increase rejected |
| AC-09 | Allowed complex function becomes more complex | Commit rejected even if violation count is unchanged |
| AC-10 | Missing plugin, malformed config, or parser error | Clear failure, no false success |
| AC-11 | Worker imports a model through supported alias/relative form | Commit rejected |
| AC-12 | IPC handler imports TypeORM or database implementation | Commit rejected |
| AC-13 | Git hook executed offline | No network attempt and normal result |
| AC-14 | Deep validation requested | Typed rules and existing typecheck commands run locally |
| AC-15 | Lint fails or process is interrupted | Index/worktree/stashes preserved or explicit recoverable failure |
| AC-16 | Gate policy has unstaged edits | Fail with instruction to stage or restore policy changes |
| AC-17 | Selected file is unexpectedly ignored | Fail with explanation rather than claim it was checked |
| AC-18 | Hook dependency installed in a fresh checkout | Doctor verifies installation and fixture commit rejection |

## 12. Delivery plan

1. Compatibility and inventory: prove the selected SonarJS version works with the existing ESLint/Vue stack and measure existing debt.
2. Policy implementation: explicit rule allowlist, architecture restrictions, reviewed exception manifest, and focused tests.
3. Hook replacement: one lint-staged pass, no auto-fix, robust argument handling, no full-project checks in normal commits.
4. Local deep commands and operator documentation: typed lint, type checks, recovery, and diagnostics.
5. Verification: acceptance fixtures, offline execution, platform checks, and recorded benchmarks.

Completion requires the acceptance suite, performance report, and documented compatibility matrix. Creating these design documents alone does not complete the feature.

## 13. Decisions and future options

Selected: ESLint + SonarJS + existing TypeScript/Vue tooling. FTA is omitted because actionable rule findings better match the request. Oxlint remains a future performance experiment if measurements justify migration. Semgrep CE remains optional for deeper security patterns. No decision about either tool is needed to implement this PRD.

## 14. References

- [SonarJS ESLint plugin](https://github.com/SonarSource/SonarJS/blob/master/packages/analysis/src/jsts/rules/README.md): local rule-based bug and maintainability checks.
- [lint-staged](https://github.com/lint-staged/lint-staged): staged task execution and backup behavior.
- [Husky](https://typicode.github.io/husky/): Git hook integration.
- [Type-aware linting](https://typescript-eslint.io/getting-started/typed-linting/): deeper checks incur project-analysis costs.
- [FTA scoring](https://ftaproject.dev/docs/scoring): explains why a score is advisory rather than proof of correctness.
