# Natural-language skill installation — status TODO

**RESOLVED 2026-10-08 (commits `0d0216c2` → `e27e817f`, all pushed).**
E1 (probe seam in the 3 affected tests — CI `test` green), E4 (§16.4
shallow clone in the Windows matrix; first execution failed on a
fixture-cwd bug, fixed in `707c017c` — `windows-shell-matrix` green),
E5 (`SOURCE_AUTH_REQUIRED` + the PRD §23.1 kebab→shipped table), E6
(deterministic RV7/RV8 tests), E2/E7 (Electron E2E green on
`37696767208` after two stale specs were updated for R4 conversation
scoping and R2 safePlan fields: videoUse `toMatchObject`, FR-15 case 7
restart reuses the original conversation id, FR-28 case 14 prepares
share one conversation id). Still open, both infra-not-branch: E3
(ubuntu packaged-smoke runner eviction) and the repo-wide
`Package smoke test` workflow failure (also red on master). The body
below is the original 2026-10-07 audit, kept as the record.

Checked 2026-10-07 against:

- PRD: `docs/prd/natural-language-skill-installation-prd.md`
- Technical design: `docs/prd/natural-language-skill-installation-technical-design.md`
- Worktree: `.claude/worktrees/natural-language-skill-installation`
- HEAD: `8e038ed89e5b535fb9c47e686d4046366a4d2f80` (`fix: second-review remediation R2`)
- Branch: `worktree-natural-language-skill-installation`, **11 commits ahead of origin** (origin tip `05397a35`)

Verdict: the FR-01–FR-31 and NFR-01–NFR-12 behavior is implemented in this worktree. The PRD is not closed. Two unit tests fail on CI whenever `ffmpeg` is absent, current HEAD has no CI run, and several PRD contract rows are still missing.

## Completed

These are present in the worktree at HEAD. “Completed” means the behavior and its main tests exist in source. It does not mean the latest CI is green.

| ID | What is done | Where |
| --- | --- | --- |
| FR-01 | Explicit English install / setup / register / update / repair / configure phrases with a source route to `skill_install_prepare`. Ordinary “install node dependencies” / “clone my repository” stay off that path. | `src/service/SkillInstallIntentGuard.ts` |
| FR-02 | One persisted session per normalized installation identity, with conversation binding and compare-and-set state. | `SkillInstallationModule`, `SkillInstallationSession` entity, migrations `0002` and `0003` |
| FR-03 | Sources land in app-owned staging. GitHub archive provenance keeps the fetcher commit SHA. Local directory and ZIP are supported. Credential-bearing URLs are stripped. | `src/service/SkillSourceAcquisitionService.ts` |
| FR-04 | `install.md` is read before the mutation plan, including a nested candidate after ticket D4b. | `SkillInstallPlanner`, `SkillPackageInspectionService` |
| FR-05 | Packages classify as prompt, executable, plugin, or ambiguous. Multiple candidates are selectable. | inspection + planner; multi-skill card in `SkillInstallCard.vue` |
| FR-06 | Approval shows source, revision, skills, dependencies, credentials, commands, and activation mode before mutation. | `SafePlanView`, `SkillInstallCard.vue` |
| FR-07 | Plugin and executable packages route through `PluginImportService` / `SkillImportService`. Disable and uninstall go back to those owners. | `SkillInstallationModule` |
| FR-08 | A root `SKILL.md` installs as a prompt skill. New prompt installs do not write a wrapper into the source tree. Legacy wrappers still delegate. | prompt catalog + `SkillImportService` legacy adapter |
| FR-09 | Invoked context includes the canonical skill directory and substitutes `${AIFETCHLY_SKILL_DIR}` and `${CLAUDE_SKILL_DIR}`. | `PromptSkillContextAssembler.ts` |
| FR-10 | Managed copy writes a sibling temp dir, checks the hash, then renames. | `SkillActivationService.ts` |
| FR-11 | Linked mode uses a POSIX symlink, a Windows junction, or managed copy with a warning. Uninstall removes the link, not the target. Junction create / discover / uninstall runs in the Windows matrix. | `SkillActivationService.ts`, `PlatformProcessProvider.test.ts` |
| FR-12 | Shell and file tools share `ConversationFilesystemContextService`. A missing workspace is `WORKSPACE_NOT_APPROVED`, not the home directory. | `ToolExecutor.ts`, `ShellToolService.ts` |
| FR-13 | `skill_resource_list` / `skill_resource_read` are read-only on the skill root. Execute is a separate capability. | `PromptSkillResourceService.ts` |
| FR-14 | `ffmpeg` and `ffprobe` are separate probes. Missing binaries hold at `approve-dependency` instead of reporting ready. | planner + dependency orchestrator |
| FR-15 | Approval, secret input, and command checkpoints pause and resume the same session, including restart while awaiting a secret. | module + `test/e2e/specs/skillInstallationMatrix.test.ts` |
| FR-16 | Secrets use Electron `safeStorage`. Unavailable encryption fails closed (`SECURE_STORAGE_UNAVAILABLE`). Values are injected into an approved child env by name. | `SkillCredentialService.ts`, `SkillCredentialModule.ts` |
| FR-17 | Ready requires acquisition, inspection, activation, dependency probes, required credentials, and catalog registration. | module verifier path inside `SkillInstallationModule` |
| FR-18 | “Install and wait” is a persisted terminal constraint. Installation does not invoke the new skill. | planner warnings + video-use E2E |
| FR-19 | Update, repair, disable, enable, uninstall, and rollback exist. Rollback backups live under `~/.aifetchly/skill-backups`. | module lifecycle methods |
| FR-20 | Progress is monotonic on `SKILL_INSTALL_PROGRESS`. Many structured failure codes exist (see the error section for the names that do not). | `appendEvent` in the module |
| FR-21 | One `use_skill` tool. The catalog lists name, description, and runtime id, not `SKILL.md` bodies. | `PromptSkillCatalogPresenter.ts` |
| FR-22 | A successful invoke appends a short tool acknowledgement, then one hidden normalized instruction block. | `PromptSkillInvocationService.ts` |
| FR-23 | Active invocations persist and reattach after compaction from the stored snapshot. A changed hash emits `SKILL_HASH_CHANGED`. | `PromptSkillInvocationModule` |
| FR-24 | Token budget can return full, section-selected, or metadata-only. Omitted sections are loaded with `skill_resource_read`. | `PromptSkillTokenBudgetService.ts` |
| FR-25 | Legacy documentation tools delegate to the same invocation service with `invocationSource: "legacy-adapter"`. | `SkillImportService.ts` |
| FR-26 | One application-owned policy text is injected before repository content. The compact reminder is on the prepare tool. | `SkillInstallationRoutingPromptSection.ts` |
| FR-27 | Install, `use_skill`, executable execution, and unrelated Git or dependency requests are different intents. | `SkillInstallIntentGuard.ts` |
| FR-28 | `skill_install_prepare` is always loaded while `AIFETCHLY_SKILL_INSTALL_ENABLED` is on. A deferred-load race replays once. | `ToolLoadPolicyService.ts`, `DeferredToolHydrationCoordinator.ts` |
| FR-29 | Later calls require `session_id`. Approval also requires `plan_revision`. A session from another conversation is rejected. | module conversation mismatch |
| FR-30 | After explicit install intent, clone / copy / link / register substitutes return `INSTALL_GENERIC_TOOL_FALLBACK_BLOCKED`. Unrelated workspace tools stay allowed. | `SkillInstallationToolPolicy.ts` |
| FR-31 | Ordinary tool schemas and `ChatCredentialGuard` reject pasted secrets. Collection is `SKILL_INSTALL_SUBMIT_SECRET` only while `awaiting_secret`. | `ChatCredentialGuard.ts`, skill-installation IPC |
| NFR-01 | Duplicate prepare resumes the active session or reports a verified ready install instead of a second checkout. Identity includes ref, subdirectory, and mode. | module prepare path. **The tests that prove the ready-reuse half are the CI failure below.** |
| NFR-02 | POSIX and Windows process providers capture stdout and stderr separately, decode UTF-8 and UTF-16LE, and flag `PROCESS_OUTPUT_EMPTY_UNEXPECTED`. The Windows job last succeeded. The shallow-clone row is still missing (error E4). | `src/service/process/` |
| NFR-03 | Secrets are kept out of plans, logs, and chat persistence on the guarded paths. Child env scrubbing drops known secret keys. | credential service + process provider |
| NFR-04 | Acquisition limits: timeout, archive size, file count, depth, and `SKILL.md` size. | `SkillSourceAcquisitionService` |
| NFR-05 | Uninstall checks installation identity and ownership. Links and junctions are unlinked. Shared dependencies stay. | activation service + module uninstall |
| NFR-06 | Existing executable skills stay on `SkillExecutor`. Prompt skills use the separate catalog. | registry split |
| NFR-07 | AI-serving install IPC checks `USER_AI_ENABLED` before work. | `src/main-process/communication/skill-installation-ipc.ts` |
| NFR-08 | `skillInstall` has 79 keys in en, zh, es, fr, de, and ja with no missing keys. Component tests cover the card and manager. | `src/views/lang/{en,zh,es,fr,de,ja}.ts`, `test/vitest/main/components/SkillInstall*.test.ts` |
| NFR-09 | Discovery context is metadata only. | catalog presenter |
| NFR-10 | Loading `SKILL.md` does not run commands, hooks, or network requests. | `PromptSkillLoader` / invocation service |
| NFR-11 | Adversarial `install.md` text cannot change routing or approval. Manual action is bound to an approved target. | tool policy + matrix E2E |
| NFR-12 | Routing policy is versioned (`SKILL_ROUTING_POLICY_VERSION = 1`). Installer metrics include policy version, intent, first tool, and hydration replay. | intent guard + metrics commits through `75eaa13a` |

Also done, from the 2026-10-05 review (ticket file `docs/plans/natural-language-skill-installation-review-2026-10-05-tickets.md`):

- Identity-bound uninstall, including the ownership file recording the installation id.
- Cancel or decline of a held update rolls back only if that session reached activation.
- Restart discovery reconciles installer directories with persisted identity and enabled state.
- Supersede unregisters the old runtime entry before the new one is marked ready.
- Install boundary is conversation-scoped.
- Allowed-tools narrowing applies after catalog filtering.
- Prompt-skill handoffs append after the whole tool batch.
- Per-candidate command working directories stay inside the staged root (ticket D4b, `00a4ad17`).

Database baseline `0000` plus feature migrations `0001`–`0004` are in `src/migrations/`. Operations text is `docs/skill-installation-operations.md`.

## Errors

### E1 — R4 ready-reuse tests fail when ffmpeg is not on PATH

**Severity:** release blocker. This is the only product-test failure in the last full CI run.

**Where**

- `test/vitest/main/SkillInstallationModule.test.ts`
- `it("a different-subdirectory request is not answered by the root ready row")` assertion at line 2438
- `it("a linked-mode request accepts a symbolic-link ready row (representation match)")` assertion at line 2468
- Fixture `install.md` says `Requires ffmpeg on PATH` (`makeVideoUseFixture`, same file)
- Probe seam defaults to `"real"` and these two tests never call `__setForceDependencySatisfied(true)`

**What CI did**

Run `36767164973` and CI run `36767164922`, both at origin tip `05397a35` (2026-09-30):

- Linux `test` job: 499 files passed, 1 failed. 4537 tests passed, **2 failed**, 3 skipped.
- macOS `managed-copy-macos`: the same 2 failures.
- `Lint and unit tests`: exit 1 on the same assertions (annotations at the then-current lines 2402 and 2432).
- Electron E2E was skipped because that job failed.

Assertion:

```text
Expected: "ready"
Received: "installing_dependencies"
```

The first test dies before it can check that a `subdirectory: "nested"` prepare is not answered by the root ready row. The second dies before it can check that a repeat linked prepare reports ready and a managed-copy prepare does not.

**Why**

Approve is doing what FR-14 requires: the plan contains ffmpeg, the runner has no ffmpeg, so the session holds at `installing_dependencies`. GitHub runners do not ship ffmpeg. This machine does (`/usr/bin/ffmpeg`), so the same tests can pass locally and still fail CI.

Other tests in the file already force the probe seam. These two do not. Commits after `05397a35` (`158fbbd9` through `8e038ed8`) touched the module and this test file and did not add the stub. The failure is still in the tree.

**Fix**

In both tests, set the dependency seam to satisfied before `approve`, the same way the deterministic ready tests already do. Then assert `ready`, then assert the subdirectory and linked-versus-copy identity checks. Do not weaken the product so a missing ffmpeg reports ready.

### E2 — Current HEAD has no CI, and the last run is red

HEAD `8e038ed8` is 11 commits ahead of `origin/worktree-natural-language-skill-installation` (`05397a35`). Those commits include audit R8–R10 and review tickets 1–10. GitHub Actions has no run for `8e038ed8`.

Last Test Suite job results at `05397a35`:

| Job | Result |
| --- | --- |
| `windows-shell-matrix` | success |
| `packaged-smoke-github (windows-2022)` | success |
| `packaged-smoke-github (macos-latest)` | success |
| `test` (Linux vitest) | failure, E1 |
| `managed-copy-macos` | failure, E1 |
| `packaged-smoke-github (ubuntu-22.04)` | failure, E3 |
| Electron E2E | skipped |

Until E1 is fixed, this branch is pushed, and `test`, `managed-copy-macos`, and Electron E2E pass, the PRD line “all main-process, component, Windows, and end-to-end tests pass” is not met.

### E3 — Ubuntu packaged smoke was cancelled mid-build

Job `packaged-smoke-github (ubuntu-22.04)` in run `36767164973` (`110064118850`):

- Checkout, dependency install, disk cleanup, and swap setup succeeded.
- `Build package (unpacked)` was **cancelled**.
- Log: `The runner has received a shutdown signal` and `The operation was canceled` at 2026-09-30T19:45:40Z.
- Windows and macOS packaged-smoke jobs in the same run succeeded.

This matches the earlier runner-eviction note. It is not an installer assertion failure. It still leaves the Linux packaged-smoke requirement without a green run at the latest CI commit.

### E4 — PRD §16.4 shallow local Git clone is not in the Windows matrix

`test/vitest/main/process/PlatformProcessProvider.test.ts` Windows block covers:

- PowerShell `Write-Output`, `Get-Content`, Unicode, stderr plus non-zero exit
- cmd `echo`
- `git --version`
- timeout process-tree kill
- paths with spaces
- `PROCESS_OUTPUT_EMPTY_UNEXPECTED`
- junction create, discover, and uninstall-safe

It does not cover the PRD row:

| Provider | Command | Expected result |
| --- | --- | --- |
| Native Git | shallow local fixture clone | target exists and commit matches |

`windows-shell-matrix` can stay green while this row is absent, because the job only runs this file.

### E5 — PRD §23.1 failure codes are not all present

The implementation uses a different vocabulary. These PRD strings have no match under the kebab-case name or the `SCREAMING_SNAKE` form:

| PRD code | Status |
| --- | --- |
| `source-auth-required` | Missing. SSH and `git@` sources are accepted and credentials in URLs are stripped, but an auth failure is not this code. |
| `install-routing-required` | Missing. The enforced substitute block is `INSTALL_GENERIC_TOOL_FALLBACK_BLOCKED`. |
| `plan-approval-required` | Behavior exists as `APPROVAL_REQUIRED`. |
| `activation-conflict` | Behavior exists as `ACTIVATION_COLLISION`. |
| `readiness-check-failed` | Behavior exists as `ACTIVATION_VERIFICATION_FAILED`. |
| `shell-output-missing` | Behavior exists as `PROCESS_OUTPUT_EMPTY_UNEXPECTED`. |
| `install-plan-revision-stale` | Behavior exists as `PLAN_REVISION_MISMATCH`. |

`source-auth-required` and `install-routing-required` need either an alias the UI and tests accept, or a PRD update if the shipped names are intentional.

### E6 — Two review cases have no end-to-end test

From `docs/plans/natural-language-skill-installation-review-2026-10-05-tickets.md`, item 11, still deferred at HEAD:

- **RV7.** A `rollback_required` result must stop the install loop. Enforced in `SkillInstallationModule` (comment near the unsuccessful-terminal stop) with a unit guard. No deterministic E2E.
- **RV8.** An incompatible dependency (probe passed, version too old) must hold instead of reporting ready. Enforced in the module. No E2E, because the harness has no “binary present but old” probe seam.

The ticket says the behavior is implemented. The missing tests are the remaining defect.

### E7 — Video-use acceptance is not proven on Windows

PRD §27 requires the `browser-use/video-use` scenario on Windows and at least one POSIX platform.

- POSIX path: `test/e2e/specs/skillAcceptanceVideoUse.test.ts` and `skillInstallationNaturalLanguage.test.ts`.
- Last Electron E2E job was **skipped** (E2).
- The Windows CI job runs only `PlatformProcessProvider.test.ts`. The spec comment that maps the Windows leg onto `windows-shell-matrix` does not execute the video-use dialogue, secret pause, or ready-and-wait assertions.

## Not counted as a product error

- Design file names that were merged: session and event models live in `src/model/SkillInstallation.model.ts`. Readiness checks live in the module and `SkillActivationService`. One worker, `src/childprocess/skill-installation/SkillInstallationWorker.ts`, covers acquisition and dependency execution.
- `TODO 5` / `TODO 6` / `TODO 7` / `TODO 8` / `TODO 9` comments in the module and IPC are labels on code that was later filled in (credential store, approved commands, progress events, safe plan view). They are not open work.
- The intent guard’s explicit patterns are English. The PRD’s normative phrases are English. Non-English wording relies on the always-loaded prepare tool and the policy prompt, not the blocking guard.
- Lint warnings on that CI run (`console` in `src/views/App.vue` and `forge.config.js`, Node 20 action deprecation) are outside this feature. They did not fail the job. E1 did.

## Work order

1. Fix E1 by forcing dependency probes satisfied in the two R4 tests, then run `SkillInstallationModule.test.ts` with ffmpeg absent from `PATH`.
2. Add the §16.4 shallow-clone Windows case (E4) and the two missing failure-code aliases or a documented rename (E5).
3. Add RV7 and RV8 end-to-end coverage once a probe-injection seam exists (E6).
4. Push HEAD and require green `test`, `managed-copy-macos`, Electron E2E, and `windows-shell-matrix` (E2, E7). Treat Ubuntu packaged-smoke cancellation (E3) as an infra rerun, not an installer logic change, unless the new log shows a real build error.
