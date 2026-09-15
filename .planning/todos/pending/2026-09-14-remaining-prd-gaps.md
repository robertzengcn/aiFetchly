---
created: 2026-09-14T12:41:00.000Z
title: Remaining PRD gaps — natural-language skill installation + git-free GitHub plugins
area: skill-installation
status: pending
worktree: .claude/worktrees/natural-language-skill-installation
branch: worktree-natural-language-skill-installation
head: 88fb9522
sources:
  - docs/prd/natural-language-skill-installation-prd.md
  - docs/prd/git-free-github-plugin-installation-prd.md
  - .planning/todos/pending/2026-09-05-complete-natural-language-skill-installation-prd-gaps.md
  - docs/plans/natural-language-skill-installation-final-audit-todo.md
files:
  - docs/prd/natural-language-skill-installation-prd.md
  - docs/prd/git-free-github-plugin-installation-prd.md
  - docs/skill-installation-operations.md
  - test/e2e/specs/skillInstallationMatrix.test.ts
  - test/e2e/specs/skillInstallRuntimeFlows.test.ts
  - src/service/pluginSources/GitHubPluginFetcher.ts
  - src/views/components/plugins/PluginInstallSourceDialog.vue
---

# Remaining PRD gaps

This TODO lists **only incomplete work** after the 2026-09-14 requirement audit
of git worktree `natural-language-skill-installation` (HEAD `88fb9522`).

It does **not** re-open FR/NFR items that already have production code and
direct unit/module/component coverage. It supersedes the 2026-09-12 completion
record where that record claimed DoD/E2E closure that the current tests do
not actually provide.

Out of scope (do not treat as gaps):

- Natural-language PRD §6 non-goals
- Git-free PRD private-repository / OAuth / `github-auth-required` (explicitly deferred from v1)
- Git-free Phase 3 fallback-flag removal (after two stable releases)
- Success-metrics product telemetry (optional; only if privacy-preserving telemetry already exists)

---

## A. Natural-language skill installation PRD

Requirements: `docs/prd/natural-language-skill-installation-prd.md` §5.1, §26.5, §27, §32.

### P0 — Required packaged E2E / Definition of Done

- [ ] **NL-1. Lift E2E case 5 — activation-failure rollback**
  - Requirements: `FR-17`, `NFR-05`, §26.5, §32 (“installation is atomic… reversible”).
  - Why incomplete: activation-failure rollback is proven only in module tests
    (`SkillActivationService` / D2 verification-failure). The packaged Electron
    E2E environment’s fail-closed credential store pauses remote fixtures
    **before** activation, so the matrix never reaches rollback-after-activation.
  - Work:
    - Add a fixture that fails **after** activation starts (local source, no
      secret pause).
    - Assert no leftover active registry row, copied install directory, or
      durable invocation.
  - Acceptance: Playwright E2E case 5 passes through renderer → IPC → module
    without a test-only production seam.

- [ ] **NL-2. Lift E2E case 10 — compaction / conversation recovery**
  - Requirements: `FR-23`, §27.3 item 9, §32 (invoked skills survive compaction
    with identity and content hash intact).
  - Why incomplete: `reconcileForRecovery` has a module 4-way test (healthy /
    changed / missing / disabled). There is **no packaged E2E** that compact or
    restarts a conversation and reattaches or deactivates invocations.
  - Work: E2E covering healthy snapshot reattach, hash-invalid diagnostic,
    disabled/uninstalled deactivation, and no duplicate instruction injection.
  - Acceptance: runtime-flow E2E case 10 exercises the real assembler path.

- [ ] **NL-3. Lift E2E case 12 — legacy documentation-only wrapper**
  - Requirements: `FR-25`, §32 (“legacy documentation-only tools delegate to
    the same prompt invocation path”).
  - Why incomplete: `LegacyDocSkillDelegation` unit tests cover hidden-context
    handoff. The packaged E2E matrix still substitutes that unit path.
  - Work: install or seed a legacy doc-only skill, invoke it from chat, assert
    the same hidden instruction block as `use_skill`.
  - Acceptance: E2E case 12 passes on the renderer/main/provider boundary.

- [ ] **NL-4. Make E2E case 14 a real deferred-load race**
  - Requirements: `FR-28`, `NFR-12`, §32 (one transparent replay, no duplicate
    session, no failed installer call in the conversation).
  - Why incomplete: the current case prepares twice and asserts a single
    session. It does **not** force installer tools to be absent on the first
    model round and recover via one internal replay.
  - Work: drive a first round where `skill_install_prepare` is not yet in the
    catalog; prove one transparent hydration replay and no duplicate session.
  - Acceptance: E2E shows execute/none/exhausted behavior at the loop boundary,
    not only in `decideDeferredToolHydration` unit tests.

- [ ] **NL-5. Packaged E2E for typed dependency approve → install → ready**
  - Requirements: `FR-06`, `FR-14`, `FR-17`, gap-TODO task 1 acceptance.
  - Why incomplete: `approveDependency` exists and module tests can reach
    `ready` with seams. Matrix E2E case 3 only covers **decline**, and skips
    when ffmpeg is already present on the runner. There is no packaged path
    that installs a typed dependency and then verifies probes before `ready`.
  - Work: deterministic missing-ffmpeg fixture (or injectable probe) that
    approves, runs the typed provider, and reaches `ready` — or rejects and
    stays in the correct terminal state.
  - Acceptance: Playwright covers approve, reject, progress, failure, and
    retry; decline-only is not sufficient.

### P1 — Acceptance scenario and platform evidence

- [ ] **NL-6. Run the real `browser-use/video-use` acceptance scenario**
  - Requirements: §27.1–§27.3, §32 (“the `browser-use/video-use` acceptance
    scenario passes without manual path repair”) on Windows **and** at least
    one POSIX platform.
  - Why incomplete: E2E uses **local fixtures** named `video-use` plus a
    scripted fake model. It does not acquire
    `https://github.com/browser-use/video-use`, read `install.md` first, wire
    ffmpeg/ffprobe, collect ElevenLabs through secure input, preserve
    `helpers/`, keep shell cwd on the footage workspace, or demonstrate
    later `use_skill` daily-use after compaction.
  - Work: either a controlled live/replay of the GitHub repository or a
    fixture that contains the real package layout and instruction files, then
    execute §27.2 (18 items) and §27.3 (9 items) on Windows + POSIX.
  - Acceptance: no manual path repair; install-and-wait does not transcribe;
    later footage request uses `use_skill` + hidden context + progressive
    helper reads.

- [ ] **NL-7. Managed-copy proof on macOS**
  - Requirements: `FR-10`, §32 (“managed copy works on all supported
    platforms”).
  - Why incomplete: managed-copy unit/activation tests run on Linux; Windows
    process/junction coverage exists (`windows-shell-matrix`). There is **no
    macOS CI** (or recorded macOS run) for managed copy.
  - Work: add a macOS job or record a gated local/CI run of activation
    managed-copy tests.
  - Acceptance: Linux, macOS, and Windows each have recorded passing
    managed-copy evidence.

### P2 — Process hygiene (does not change product behavior)

- [ ] **NL-8. Move the closed gap TODO out of `pending/`**
  - Why incomplete: `.planning/todos/pending/2026-09-05-complete-natural-language-skill-installation-prd-gaps.md`
    has every task checked, but still lives under `pending/`.
  - Work: move it to `.planning/todos/completed/` (or archive) once this
    remaining-gap TODO is the active list.
  - Acceptance: `pending/` contains only unfinished work.

- [ ] **NL-9. Require `windows-shell-matrix` in branch protection**
  - Requirements: `NFR-02` (evidence is a workflow, not an enforced gate).
  - Why incomplete: the workflow ran successfully
    (GitHub Actions run `33979107025`, 46/46) but repository branch
    protection does not require that check.
  - Work: add the check to required status checks, or document an explicit
    waiver.
  - Acceptance: merges cannot skip the Windows shell matrix without a
    recorded exception.

---

## B. Git-free GitHub plugin installation PRD

Requirements: `docs/prd/git-free-github-plugin-installation-prd.md` §12.1,
§13, §16–§18, §20–§21, §28; design Phase D / §25.

Private GitHub remains deferred — do not implement OAuth or tokens here.

### P0 — Definition of Done blockers

- [ ] **GF-1. Packaged smoke with Git absent on Windows, macOS, and Linux**
  - Requirements: FR-01, NFR-01, §20.7, §21.1, §28.
  - Why incomplete: unit tests spy that Git is never spawned. `scripts/packaged-smoke.mjs`
    is generic app smoke and does not install a public GitHub plugin with
    `git` missing from PATH on packaged Electron. The NL final-audit TODO
    already records package-smoke as a repo-wide infra failure.
  - Work: packaged (or asar-unpacked) smoke that removes Git from PATH and
    installs a public GitHub fixture/archive on all three OS families.
  - Acceptance: recorded runs prove zero Git process starts and a successful
    plugin row.

- [ ] **GF-2. User-facing documentation for public GitHub / archive limits**
  - Requirements: §28, design Phase D (`docs/skill-installation-operations.md`).
  - Why incomplete: the operations runbook last changed in `fdef4dab`
    (2026-08-28), before git-free commits. It does not explain: public
    install needs no Git and no token; private GitHub is unsupported on this
    source; archives omit submodules and Git LFS; commit-pin / release-asset
    recommendations for authors.
  - Work: update `docs/skill-installation-operations.md` and add a short
    plugin-author note (release assets or commit-pinned archives).
  - Acceptance: an operator can complete a public GitHub install without
    reading the PRD.

- [ ] **GF-3. Record a security review of the acquisition path**
  - Requirements: §17, §28 (“security review confirms safe redirects,
    bounded streaming, archive safety, cleanup, and redaction”).
  - Why incomplete: controls exist in `PluginHttpDownloadService` /
    `GitHubArchiveClient` / archive extraction, but there is no review
    artifact or sign-off in the worktree.
  - Work: security review covering HTTPS-only redirects, host allowlists,
    header stripping, byte/timeout limits, zip slip/symlink, temp cleanup,
    and provenance redaction. File the result under `docs/` (or the repo’s
    security-review location).
  - Acceptance: §28 security bullet has a dated review, not only unit tests.

### P1 — Transport, tests, and provenance fidelity

- [ ] **GF-4. Move release-asset and generic ZIP downloads onto the shared transport**
  - Requirements: FR-05, FR-06, FR-07, NFR-08, NFR-14, design §25.
  - Why incomplete: repository zipballs use `PluginHttpDownloadService`.
    GitHub **release assets** and `releases/latest` still use legacy
    `downloadZip`, so they do not share the same redirect bound, streaming
    byte limit, cancellation, and header-stripping guarantees.
  - Work: route asset + latest + generic ZIP through the shared client;
    add redirect/oversize/timeout tests for those URLs.
  - Acceptance: no parallel download implementation for GitHub ZIP sources.

- [ ] **GF-5. Assert URL-source delegation actually acquires via archive**
  - Requirements: FR-02, FR-21, §20.4.
  - Why incomplete: `UrlPluginFetcher` classifies `github.com` (including
    trailing `.git`) as `github`, but tests only check classification. There
    is no test that `acquire` calls `GitHubPluginFetcher` and never Git for
    eligible GitHub URLs, while non-GitHub `.git` URLs still use Git.
  - Work: dispatcher tests with a fake GitHub fetcher / Git spy.
  - Acceptance: FR-21 evidence is an acquire assertion, not classify-only.

- [ ] **GF-6. Persistence integration for trusted provenance**
  - Requirements: FR-13, FR-14, §16, US-06.
  - Why incomplete: fetcher tests check in-memory provenance. There is no
    install-from-source integration that asserts the stored plugin row has
    `sourceKind`, canonical URL, requested ref, and `resolvedCommitSha`,
    with no credentials or signed URLs. Design keys are used
    (`resolvedCommitSha`); PRD names `resolvedRevision` / `archiveType` are
    unused — document the mapping or persist equivalent fields.
  - Work: persistence test after a mocked archive install; UI overview
    should show a shortened resolved SHA (US-06).
  - Acceptance: DB row + renderer summary both show immutable revision.

- [ ] **GF-7. GitHub-style `{repo}-{sha}/` archive wrapper fixture**
  - Requirements: FR-10, §20.2, §21.6.
  - Why incomplete: unwrapping reuses existing plugin-root resolution, but
    there is no fixture that looks like GitHub’s generated single wrapper
    directory containing `plugin.json`.
  - Work: zip fixture `{repo}-{sha}/plugin.json` through the GitHub
    archive → `LocalZipPluginFetcher` path.
  - Acceptance: install succeeds and identity is not the wrapper folder name.

### P2 — UI, a11y, IPC evidence

- [ ] **GF-8. Install-dialog progress stages, empty-URL, and error-state coverage**
  - Requirements: §11.2, §20.6, NFR-12.
  - Why incomplete: component tests cover the no-Git helper, capability
    flag, Git-source helper, and some errors. Missing: empty URL disabled
    install, working-state stage copy, unavailable-repo and invalid-ref
    renderings.
  - Work: extend `PluginInstallSourceDialog.test.ts`.
  - Acceptance: §20.6 checklist items have assertions.

- [ ] **GF-9. Accessibility for helper, progress, and errors**
  - Requirements: §11.5, NFR-10.
  - Why incomplete: new copy uses `data-testid` but not
    `aria-describedby` / live regions for progress and typed errors.
  - Work: associate helper and error text with the URL/ref fields; announce
    working/cancel state to assistive tech.
  - Acceptance: keyboard-only install plus screen-reader-meaningful errors.

- [ ] **GF-10. Explicit IPC test: install with AI disabled**
  - Requirements: FR-18, §20.5.
  - Why incomplete: `PLUGIN_INSTALL_FROM_SOURCE` correctly uses
    `registerValidatedHandler` (not AI-gated), but tests do not set
    `USER_AI_ENABLED` false and still complete a GitHub/local install.
  - Work: add the IPC case.
  - Acceptance: FR-18 has a failing-if-regressed test.

---

## Explicitly not in this TODO

| Item | Reason |
|---|---|
| Private GitHub / tokens / `github-auth-required` | v1 non-goal; needs a separate PRD amendment |
| Remove `github_archive_install_enabled` fallback | Rollout Phase 3, after two stable releases |
| Product telemetry dashboards (§22) | Optional; only if telemetry already exists |
| NL FR-01–FR-13, FR-15–16, FR-18–22, FR-24, FR-26–27, FR-29–31 (except E2E lifts above) | Production code + tests exist |
| Owner “approve this PRD” ceremony | Process, not an engineering task unless product asks |

---

## Suggested order

1. NL-1, NL-5, GF-1 (DoD / packaged proof)
2. NL-2, NL-3, NL-4 (runtime E2E honesty)
3. GF-2, GF-4, GF-5, GF-6 (git-free correctness + docs)
4. NL-6, NL-7 (acceptance + macOS)
5. GF-3, GF-7–GF-10, NL-8, NL-9 (review, UI, hygiene)
