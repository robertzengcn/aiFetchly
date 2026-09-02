# Natural-Language Skill Installation — Final Audit TODO

**Audit date:** 2026-09-02  
**Status:** Incomplete — release and Definition of Done gates remain open  
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

### 3. Run and record the blocking Windows process-provider CI gate

- [ ] Push the branch or PR and run the `windows-shell-matrix` job on a real
      `windows-2022` runner.
- [ ] Record the successful run URL or artifact in the PR verification notes.
- [ ] Ensure the job remains required and cannot be silently skipped.

**Reason:** The Windows provider and a blocking workflow job exist, but a Linux
worktree cannot demonstrate that PowerShell, cmd, native programs, encoding,
and process-tree termination work on Windows. The PRD explicitly makes real
Windows CI a release gate.

**References:** PRD NFR-02; §16.4, §26.3, §27, and §32. Technical design §7.4
and §25.

**Complete when:** The current commit passes the required Windows job with no
skipped Windows cases.

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

## Verification snapshot from this audit

The following checks passed on Linux on 2026-09-02:

- TypeScript `tsc --noEmit`
- 207 targeted main-process/runtime tests
- 18 installer-card component tests
- 3 existing Electron installer E2E tests

These passing checks are evidence for the implemented core, but they do not
replace the missing model-driven, full-matrix, and real-Windows release gates
listed above.
