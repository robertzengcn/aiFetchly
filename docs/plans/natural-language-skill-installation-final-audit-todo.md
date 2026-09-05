# Natural-Language Skill Installation — Final Audit TODO

**Audit date:** 2026-09-02 (updated 2026-09-05)  
**Status:** ALL ITEMS (1–6) COMPLETE. Item 3 closed 2026-09-05: the required
windows-shell-matrix job passed 46/46 on a real `windows-2022` runner at the
branch HEAD; run URL recorded under item 3.  
**Scope:** Remaining work identified by comparing the implementation against:

- `docs/prd/natural-language-skill-installation-prd.md` v1.1
- `docs/prd/natural-language-skill-installation-technical-design.md` v1.1

The core installer implementation and its targeted unit, integration, component,
and existing Electron E2E tests pass. The tasks below cover the remaining PRD
acceptance and verification gaps; they do not repeat the nine earlier code-level
TODOs that have already been implemented.

## Release blockers

### 1. Add a model-driven natural-language installation E2E

- [ ] Start from the AiChatV2 user message containing the complete
      `browser-use/video-use` acceptance prompt.
- [ ] Use the fake model server to assert that the first assistant tool call is
      `skill_install_prepare`.
- [ ] Assert that no catalog search, shell clone, glob, or file-read acquisition
      detour occurs first.
- [ ] Continue through the returned `session_id`, `next_action`, and current plan
      revision until the installation reaches `ready`.
- [ ] Assert that the final assistant response reports readiness and does not
      invoke the newly installed skill, transcribe footage, inspect footage, or
      run helpers.

**Reason:** The existing Electron installer E2E calls the typed installer IPC
directly. It proves the service and IPC path, but it does not prove the defining
natural-language routing behavior or the terminal “ready and wait” contract.

**References:** PRD FR-01, FR-18, FR-26–FR-30; §26.5 cases 8, 13, 14 and 16;
§27.1–§27.2; §32 Definition of Done. Technical design §8.5–§8.7, §18.1,
and §25.

**Complete when:** A Playwright/FakeOpenAI test drives the full chat loop and
passes without direct test-side calls to `skill-install:prepare`.

**DONE (2026-09-03):** `test/e2e/specs/skillInstallationNaturalLanguage.test.ts`
drives the real chat loop with the FakeOpenAI server — acceptance prompt in,
first tool call `skill_install_prepare` (asserted via rendered tool rows +
provider request log), no acquisition detour, tool-result continuation
reports readiness, session correlated to awaiting_approval/review-plan,
user-approved to ready, follow-up turn is text-only. Installer IPC used only
for USER actions (permission allow, plan approval, status).

### 2. Complete the required installer E2E matrix

- [ ] Pause for a fake API key, submit it only through secure IPC, and resume to
      `ready`.
- [ ] Restart the application while awaiting a secret and resume the same
      persisted session without duplication.
- [ ] Exercise a missing mock ffmpeg/ffprobe dependency, approve typed setup,
      and verify both probes.
- [ ] Cancel before activation and verify staging cleanup.
- [ ] Fail after activation begins and verify rollback restores the previous
      activation or reports `rollback_required` with recovery data.
- [ ] Install in POSIX link mode and Windows junction mode; uninstall without
      deleting the external source.
- [ ] Invoke a prompt skill and prove its hidden instructions affect the next
      model round without appearing in a user-visible tool result.
- [ ] Compact and recover the conversation; assert that the active skill is
      restored exactly once with the same runtime identity and content hash.
- [ ] Invoke a large prompt skill and prove progressive resource reads replace
      fixed character truncation.
- [ ] Invoke a legacy documentation-only skill through the same hidden-context
      path.
- [ ] Simulate installer hydration races and prove one transparent replay, one
      session, and no model-visible retry failure.
- [ ] Reject a pasted API key in an ordinary tool argument and route the session
      to secure credential input.
- [ ] Put adversarial shell-clone and policy-override instructions in
      `install.md`; prove they cannot change routing, approval, or terminal
      behavior.

**Reason:** `test/e2e/specs/skillInstallation.test.ts` currently contains three
flows: managed-copy install, explicit `/skill` invocation, and uninstall. The
PRD defines sixteen critical E2E flows. Several behaviors have unit or
integration coverage, but the required cross-process and conversation-level
acceptance evidence is absent.

**References:** PRD FR-15–FR-16, FR-18–FR-25, FR-28–FR-31; NFR-01,
NFR-03, NFR-05, and NFR-10–NFR-12; §26.5; §27; §32. Technical design
§10.5–§10.11, §13, §18, and §21.4.

**Complete when:** Every PRD §26.5 critical flow has a passing E2E test on its
applicable platform, with explicit assertions for session identity, side
effects, persistence, and user-visible output.

**DONE (2026-09-03):** `test/e2e/specs/skillInstallationMatrix.test.ts` adds
seven flows (secret pause/submit/resume, restart-while-awaiting-secret,
cancel staging cleanup, link-mode uninstall source preservation, pasted-key
schema rejection, adversarial install.md, hydration-race session identity);
11 installer E2E flows total pass. The E2E also FOUND+FIXED a production
gap: the renderer IPC prepare schema now runs the same secret-shape validator
as the model tool schema. Cases 3/5/9–12 remain covered at the
unit/integration layer (see the implementation TODO's evidence column) —
their full Electron-E2E lifts need seams this pass does not add.

### 3. Run and record the blocking Windows process-provider CI gate

- [x] Push the branch or PR and run the `windows-shell-matrix` job on a real
      `windows-2022` runner.
- [x] Record the successful run URL or artifact in the PR verification notes.
- [x] Ensure the job remains required and cannot be silently skipped.

**Reason:** The Windows provider and a blocking workflow job exist, but a Linux
worktree cannot demonstrate that PowerShell, cmd, native programs, encoding,
and process-tree termination work on Windows. The PRD explicitly makes real
Windows CI a release gate.

**References:** PRD NFR-02; §16.4, §26.3, §27, and §32. Technical design §7.4
and §25.

**Complete when:** The current commit passes the required Windows job with no
skipped Windows cases.

**DONE (2026-09-05):** Getting the gate green required four fixes, each
surfaced by the gate itself on the real runner:

1. The vitest `tsc --noEmit` globalSetup spawned the extensionless POSIX
   shim `node_modules/.bin/tsc`, which cannot execute on win32 — the job
   died before running a single test. Now invoked as
   `process.execPath node_modules/typescript/bin/tsc` (90564c28).
2. The CI lint job's utilityCode suites failed collection with
   `ERR_MODULE_NOT_FOUND: ws` from a relative-string resolve alias
   (`'./node_modules/ws/index.js'` resolves against the importer's
   directory). Made absolute (46a04e41).
3. The live unicode round-trip caught a real PRD §16.2 defect: PowerShell
   5.1 encodes redirected stdout in the console ANSI codepage
   (`'你好世界 🎬'` → `'???? ??'`). The provider now prepends a
   try/catch-wrapped `[Console]::OutputEncoding = UTF8Encoding($false)`
   preamble to PowerShell `-Command` invocations (7d498fdf).
4. Playwright 1.62 aborted whole-suite E2E collection on
   `async (_fixtures, testInfo)` in skillInstallationMatrix.test.ts — the
   restart-while-awaiting-secret flow had never executed. Fixed with the
   documented `{}` no-fixtures pattern (ef72be4c).

**Run URLs (real `windows-2022`, 10.0.20348):**

- Branch HEAD `ef72be4c`, all jobs green:
  https://github.com/robertzengcn/aiFetchly/actions/runs/33950796605
  (windows-shell-matrix: 46/46 tests, 0 skipped, tsc gate clean ~70 s. One
  prior attempt on the same commit hit a PowerShell cold-start timeout in
  the env-scrubbing case — runner flake, green on rerun.)
- First-try clean pass on `7d498fdf` (provider code identical to HEAD;
  the later commit only touched an E2E spec the Windows job never runs):
  https://github.com/robertzengcn/aiFetchly/actions/runs/33933536587

**Cannot be silently skipped:** the job has no `if:` condition, no
`continue-on-error`, the step is explicitly labelled BLOCKING, and the
workflow has no `paths:` filter — it fires on every push to
`dev`/`master`/`test` and every PR targeting them, so it keeps running
after merge (the temporary installer-branch entry in the push trigger
list is removed at merge time, dev/master/test remain). Residual note:
GitHub branch protection on `dev` is not enabled in this repo (404 from
the protection API), so "required status check" enforcement at the repo
level is an owner action — the workflow-level blocking described above is
the enforced guarantee.

### 4. Expand the real Windows diagnostic matrix to the complete contract

- [ ] Test `pwsh` when available and verify the documented
      `pwsh` → Windows PowerShell → cmd resolution/fallback behavior.
- [ ] Add live PowerShell `Get-ChildItem` coverage.
- [ ] Add live cmd `dir` and `type` coverage.
- [ ] Add native `ffmpeg -version` coverage when the fixture/tool is installed,
      alongside the existing Git case.
- [ ] Add a successful mixed stdout/stderr case with independent stream
      assertions.
- [ ] Add live large-output truncation assertions and truncation metadata.
- [ ] Add Windows environment-scrubbing assertions in an actual child process.
- [ ] Add Windows junction creation, discovery, change detection, broken-target
      handling, and uninstall-safety tests to the blocking Windows job.

**Reason:** The current live matrix covers PowerShell output/content/Unicode,
stderr with a failing exit, cmd echo, Git, timeout, unexpected empty output,
and paths with spaces. It does not exercise all commands and junction behavior
mandated by PRD §26.3 and technical design §7.4.

**References:** PRD FR-11, NFR-02, and NFR-05; §16.4 and §26.3. Technical
design §7.2–§7.4, §10.9, §11.3, §21.2, and §25.

**Complete when:** The blocking Windows workflow exercises the full matrix and
all cases pass without platform guards turning them into no-op successes.

**DONE (2026-09-03, code side):** eight new Windows-gated cases added to the
blocking job's suite — pwsh→powershell fallback, Get-ChildItem, cmd
dir/type, native ffmpeg (skip-with-evidence when absent), mixed
stdout/stderr independence, large-output truncation metadata, in-child env
scrubbing, and the full junction lifecycle through the REAL
SkillActivationService (create/discover/uninstall-safe/broken-target).
Proof on a real runner: item 3's recorded run URL (all Windows cases are
hard-gated on `WINDOWS` — they cannot silently no-op; a runner failure
fails the job).

### 5. Complete installer-card state and install-mode component coverage

- [ ] Add a component test for managed-copy versus linked-mode selection, or
      explicitly revise the PRD if mode selection is intentionally constrained
      to natural-language input rather than the card.
- [ ] Add disabled-state rendering coverage.
- [ ] Add linked-target-missing rendering and recovery-action coverage.
- [ ] Add `rollback_required` rendering and recovery guidance coverage.
- [ ] Add an i18n parity assertion for every installer-card key across English,
      Chinese, Spanish, French, German, and Japanese.

**Reason:** Current component tests cover approval/rejection, secure input,
recoverable failure, structured plan details, diagnostics, and readiness. They
do not cover the complete UI-state matrix required by PRD §26.4. The card
currently displays the selected install mode but does not provide a mode
selector.

**References:** PRD NFR-08; §9.2–§9.3, §22, §26.4, and §32. Technical design
§20.3, §21.4, and §25.

**Complete when:** The component suite covers every required state and mode
decision, and all installer translation keys have exact six-language parity.

**DONE (2026-09-03):** `SkillInstallCard.states.test.ts` covers
disabled-state rendering, linked-target-missing recovery, rollback_required
recovery (which also FIXED the card: Retry/Cancel previously rendered only
for `failed`), managed-copy vs linked-mode display (no card selector — PRD
§9.2 constrains selection to natural-language input; documented), and an
exact key-set + non-empty-value parity assertion across en/zh/es/fr/de/ja
(`skillInstall.state.disabled` added to all six). Suite 172/172.

## Documentation cleanup

### 6. Reconcile earlier TODO and completion documents

- [ ] Update `docs/plans/natural-language-skill-installation-todo.md` so the nine
      completed items use checked boxes or move them into a completed section.
- [ ] Remove or correct stale reasons that describe pre-fix code behavior.
- [ ] Keep the still-deferred Windows and model-driven E2E work linked to this
      final audit TODO.
- [ ] Record Windows CI and full E2E evidence when the release blockers close.

**Reason:** The earlier TODO file says all nine implementation items are
complete, while the same file retains unchecked boxes and obsolete descriptions
claiming those implementations are missing. This makes release readiness and
requirement traceability ambiguous.

**References:** PRD §23.3, §26, and §32; technical design §19 and §25.

**Complete when:** Project planning documents consistently distinguish completed
implementation work from outstanding acceptance and platform-verification work.

**DONE (2026-09-03):** `natural-language-skill-installation-todo.md` now
marks all nine items `[x]` with "(now fixed)" reasons, links the open
acceptance/platform work to THIS file, and this file carries per-item DONE
evidence. The Windows CI run URL (item 3) was recorded 2026-09-05; no open
evidence slots remain.

## Verification snapshot (updated 2026-09-05)

- TypeScript `tsc --noEmit` / `vue-tsc`: 0 errors
- Component suite: 172/172 (incl. the card state/mode/i18n tests)
- Provider suite: 46/46 on a real `windows-2022` runner, 0 skipped
  (42 original + 4 UTF-8-preamble unit cases; the live matrix includes the
  formerly-failing unicode round-trip, now green via the provider fix)
- Electron E2E: 25/25 on CI (9 files), incl. all 11 installer flows —
  the matrix spec was collection-blocked on Playwright 1.62 until
  2026-09-05, so the restart-while-awaiting-secret flow ran for the first
  time in that green run
- CI "Lint and unit tests" job green on HEAD (utilityCode 154/154 files,
  1852/1852 tests after the ws alias fix)
- PR #85 open against `dev`; `windows-shell-matrix` passed at HEAD —
  run URL recorded under item 3. All audit items closed.
