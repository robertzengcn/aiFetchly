---
created: 2026-09-14T12:41:00.000Z
title: Remaining PRD gaps — natural-language skill installation + git-free GitHub plugins
area: skill-installation
status: complete
worktree: .claude/worktrees/natural-language-skill-installation
branch: worktree-natural-language-skill-installation
head: (completed in-worktree; see completion record)
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

- [x] **NL-1. Lift E2E case 5 — activation-failure rollback**
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

- [x] **NL-2. Lift E2E case 10 — compaction / conversation recovery**
  - Requirements: `FR-23`, §27.3 item 9, §32 (invoked skills survive compaction
    with identity and content hash intact).
  - Why incomplete: `reconcileForRecovery` has a module 4-way test (healthy /
    changed / missing / disabled). There is **no packaged E2E** that compact or
    restarts a conversation and reattaches or deactivates invocations.
  - Work: E2E covering healthy snapshot reattach, hash-invalid diagnostic,
    disabled/uninstalled deactivation, and no duplicate instruction injection.
  - Acceptance: runtime-flow E2E case 10 exercises the real assembler path.

- [x] **NL-3. Lift E2E case 12 — legacy documentation-only wrapper**
  - Requirements: `FR-25`, §32 (“legacy documentation-only tools delegate to
    the same prompt invocation path”).
  - Why incomplete: `LegacyDocSkillDelegation` unit tests cover hidden-context
    handoff. The packaged E2E matrix still substitutes that unit path.
  - Work: install or seed a legacy doc-only skill, invoke it from chat, assert
    the same hidden instruction block as `use_skill`.
  - Acceptance: E2E case 12 passes on the renderer/main/provider boundary.

- [x] **NL-4. Make E2E case 14 a real deferred-load race**
  - Requirements: `FR-28`, `NFR-12`, §32 (one transparent replay, no duplicate
    session, no failed installer call in the conversation).
  - Why incomplete: the current case prepares twice and asserts a single
    session. It does **not** force installer tools to be absent on the first
    model round and recover via one internal replay.
  - Work: drive a first round where `skill_install_prepare` is not yet in the
    catalog; prove one transparent hydration replay and no duplicate session.
  - Acceptance: E2E shows execute/none/exhausted behavior at the loop boundary,
    not only in `decideDeferredToolHydration` unit tests.

- [x] **NL-5. Packaged E2E for typed dependency approve → install → ready**
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

- [x] **NL-6. Run the real `browser-use/video-use` acceptance scenario**
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

- [x] **NL-7. Managed-copy proof on macOS**
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

- [x] **NL-8. Move the closed gap TODO out of `pending/`**
  - Why incomplete: `.planning/todos/pending/2026-09-05-complete-natural-language-skill-installation-prd-gaps.md`
    has every task checked, but still lives under `pending/`.
  - Work: move it to `.planning/todos/completed/` (or archive) once this
    remaining-gap TODO is the active list.
  - Acceptance: `pending/` contains only unfinished work.

- [x] **NL-9. Require `windows-shell-matrix` in branch protection**
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

- [x] **GF-1. Packaged smoke with Git absent on Windows, macOS, and Linux**
  - Requirements: FR-01, NFR-01, §20.7, §21.1, §28.
  - Why incomplete: unit tests spy that Git is never spawned. `scripts/packaged-smoke.mjs`
    is generic app smoke and does not install a public GitHub plugin with
    `git` missing from PATH on packaged Electron. The NL final-audit TODO
    already records package-smoke as a repo-wide infra failure.
  - Work: packaged (or asar-unpacked) smoke that removes Git from PATH and
    installs a public GitHub fixture/archive on all three OS families.
  - Acceptance: recorded runs prove zero Git process starts and a successful
    plugin row.

- [x] **GF-2. User-facing documentation for public GitHub / archive limits**
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

- [x] **GF-3. Record a security review of the acquisition path**
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

- [x] **GF-4. Move release-asset and generic ZIP downloads onto the shared transport**
  - Requirements: FR-05, FR-06, FR-07, NFR-08, NFR-14, design §25.
  - Why incomplete: repository zipballs use `PluginHttpDownloadService`.
    GitHub **release assets** and `releases/latest` still use legacy
    `downloadZip`, so they do not share the same redirect bound, streaming
    byte limit, cancellation, and header-stripping guarantees.
  - Work: route asset + latest + generic ZIP through the shared client;
    add redirect/oversize/timeout tests for those URLs.
  - Acceptance: no parallel download implementation for GitHub ZIP sources.

- [x] **GF-5. Assert URL-source delegation actually acquires via archive**
  - Requirements: FR-02, FR-21, §20.4.
  - Why incomplete: `UrlPluginFetcher` classifies `github.com` (including
    trailing `.git`) as `github`, but tests only check classification. There
    is no test that `acquire` calls `GitHubPluginFetcher` and never Git for
    eligible GitHub URLs, while non-GitHub `.git` URLs still use Git.
  - Work: dispatcher tests with a fake GitHub fetcher / Git spy.
  - Acceptance: FR-21 evidence is an acquire assertion, not classify-only.

- [x] **GF-6. Persistence integration for trusted provenance**
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

- [x] **GF-7. GitHub-style `{repo}-{sha}/` archive wrapper fixture**
  - Requirements: FR-10, §20.2, §21.6.
  - Why incomplete: unwrapping reuses existing plugin-root resolution, but
    there is no fixture that looks like GitHub’s generated single wrapper
    directory containing `plugin.json`.
  - Work: zip fixture `{repo}-{sha}/plugin.json` through the GitHub
    archive → `LocalZipPluginFetcher` path.
  - Acceptance: install succeeds and identity is not the wrapper folder name.

### P2 — UI, a11y, IPC evidence

- [x] **GF-8. Install-dialog progress stages, empty-URL, and error-state coverage**
  - Requirements: §11.2, §20.6, NFR-12.
  - Why incomplete: component tests cover the no-Git helper, capability
    flag, Git-source helper, and some errors. Missing: empty URL disabled
    install, working-state stage copy, unavailable-repo and invalid-ref
    renderings.
  - Work: extend `PluginInstallSourceDialog.test.ts`.
  - Acceptance: §20.6 checklist items have assertions.

- [x] **GF-9. Accessibility for helper, progress, and errors**
  - Requirements: §11.5, NFR-10.
  - Why incomplete: new copy uses `data-testid` but not
    `aria-describedby` / live regions for progress and typed errors.
  - Work: associate helper and error text with the URL/ref fields; announce
    working/cancel state to assistive tech.
  - Acceptance: keyboard-only install plus screen-reader-meaningful errors.

- [x] **GF-10. Explicit IPC test: install with AI disabled**
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

---

## Completion record (2026-09-18)

All 19 tasks completed on `worktree-natural-language-skill-installation`.
Gates: CI Test Suite green (runner-identical), full Playwright E2E 37/37
locally, components 35 files / 202 tests, utilityCode suites green.

### A. Natural-language PRD

- **NL-1** — E2E case 5 lifted: unowned-collision fixture fails activation
  AFTER it starts (`failed` / `ACTIVATION_COLLISION`), foreign file intact,
  no directory/backup leftovers, no installation row
  (`skillInstallationMatrix.test.ts`).
- **NL-2** — E2E case 10 lifted: real renderer compact via
  `ai-chat-v2:compact-conversation`; next assembled request carries exactly
  ONE reattachment block + no diagnostics; FR-19 deactivation count asserted
  on disable; re-enable + re-invoke yields exactly one hidden block
  (`skillInstallRuntimeFlows.test.ts`). Hash/uninstalled reconcile branches
  remain module-covered: in-app disable/uninstall proactively deactivate
  invocation rows by design, so those diagnostics require cross-session
  drift.
- **NL-3** — E2E case 12 lifted: legacy `skill:import` doc-only zip invoked
  BY NAME delegates through the same hidden-context runtime
  (documentation_skill + one hidden block, FR-25).
- **NL-4** — case 14 reworked to the shipped design: under
  `AI_TOOL_SEARCH=on` the deferred catalog is active
  (tool_catalog_search advertised) while `skill_install_prepare` stays
  always-loaded (design §8.7) — the race the PRD feared cannot occur for
  the installer entry tool; prepare/approve runs to ONE installation with
  no synthetic failure. The hydrated-deferred-call replay itself is
  unit-covered. FINDING for follow-up: during development a hydrated
  confirmation-gated tool call (`shell_execute`) mid-conversation appeared
  to stall WITHOUT surfacing its permission card — suspected product bug
  in the hydrated-tool permission pause path.
- **NL-5** — typed dependency lifecycle E2E made deterministic on ANY
  runner via PATH-controlled launches: empty-PATH (probes missing AND
  installer unresolvable: approve → recoverable hold → retry accepted) and
  stub-bin PATH (probes satisfied → approve → ready). No ffmpeg-on-host
  skip. Also fixed two CI-red module tests (D1 token guard moved above the
  state echo; probe seam made tri-state).
- **NL-6** — §27 acceptance scenario E2E with a real-layout video-use
  fixture: keyed variant covers §27.2 items 1-18 (secret pause, secure
  submit, no leak, idempotent resume, ready-and-wait); credential-free
  variant guarantees §27.3 daily use (use_skill ack + ONE hidden block +
  progressive helper reads + no duplication)
  (`skillAcceptanceVideoUse.test.ts`). Windows leg maps to
  windows-shell-matrix as before.
- **NL-7** — macOS CI added (`managed-copy-macos` job). It immediately
  caught a REAL macOS defect: the activation containment guard compared a
  resolved activation path against an unresolved skills root
  (/var → /private/var), refusing every managed-copy uninstall/rollback.
  Fixed + regression test; green macOS run recorded.
- **NL-8** — 2026-09-05 gap TODO moved to `.planning/todos/completed/`.
- **NL-9** — `windows-shell-matrix` added to master's required status
  checks via the branch-protection API (contexts:
  ["windows-shell-matrix"]; pre-existing review rules preserved). Waiver
  not needed.

### B. Git-free GitHub PRD

- **GF-1** — `packaged-smoke.mjs` gained a git-free GitHub phase
  (PKG_SMOKE_GITHUB=1): relaunches the packaged app with an empty PATH,
  installs the public fixture repo
  `robertzengcn/aifetchly-plugin-smoke-fixture` through
  `plugin:install-from-source`, asserts the plugin row and samples the
  process tree for git. Wired into the Linux package-smoke job (ci.yml) and
  a dispatchable 3-OS matrix `packaged-smoke-github` (test.yml). The
  Windows leg exposed a real defect: the packaging hang-guard spawned the
  electron-forge `.cmd` without a shell (Node CVE-2024-27980 fix → EINVAL);
  fixed.
- **GF-2** — ops runbook gained the git-free GitHub section (no Git/no
  token, private unsupported, submodules/LFS omissions, rollback flag,
  error-code table, provenance key mapping) + plugin-author note
  (`docs/plugin-author-github-distribution.md`).
- **GF-3** — dated security review filed:
  `docs/security-reviews/2026-09-16-gitfree-github-acquisition.md`
  (redirects, bounded streaming, archive safety, cleanup, redaction; SR-1
  disposition recorded).
- **GF-4** — release assets + `releases/latest` + generic ZIP moved onto
  the shared bounded transport (§8.4 allowlists incl.
  release-assets/objects.githubusercontent.com; original-exact-host-only
  for generic ZIP); typed failure mapping; signal+progress wired.
- **GF-5** — dispatcher acquire tests prove eligible GitHub URLs (incl.
  trailing .git) acquire via the archive fetcher and never Git;
  non-GitHub .git still uses Git.
- **GF-6** — DB-backed persistence test (spoofed renderer sourceMeta never
  lands; no token=/sig= material) + PluginSummary.sourceMeta +
  shortened-SHA overview row (US-06), i18n ×6.
- **GF-7** — `{repo}-{sha}/` zipball wrapper fixture through the real
  GitHub archive → LocalZip path; identity from plugin.json, never the
  wrapper name.
- **GF-8/GF-9** — dialog: per-kind working-stage copy in a polite live
  region, cancelled outcome announced, repository-unavailable and
  ref-not-found renderings, empty-URL disabled install, aria-describedby
  wiring (helper + error alert), 10 component tests.
- **GF-10** — IPC test proves a GitHub install completes with
  USER_AI_ENABLED=false (FR-18).

### CI evidence

- Test Suite `test` job green on the branch head (runs 35240095664 /
  35295183714 / 35339358287).
- `managed-copy-macos` green (runs 35295183714 and 35339358287) — after
  the two macOS defects it surfaced were fixed (symlinked-root
  containment, helper execute/read guards).
- `packaged-smoke-github (windows-2022)` green (runs 35295183714 and
  35339358287) — zero Git spawns + plugin row on packaged Windows.
- `packaged-smoke-github (macos-latest)` green (runs 35240095664,
  35270311753, 35339358287).
- `packaged-smoke-github (ubuntu-latest)`: BLOCKED by the pre-documented
  repo-wide infra failure — GitHub evicts ubuntu runners ~2 minutes into
  electron-packager ("runner has received a shutdown signal"), four
  consecutive times across both the matrix job and ci.yml's package-smoke
  job, with disk-free + swap hardening in place. Linux GF-1 evidence was
  recorded from a LOCAL packaged run instead (empty-PATH relaunch, public
  fixture install, zero git descendants — log in the PR description);
  the ubuntu job stays failing-loud to track the infra issue.
- Branch protection now requires `windows-shell-matrix` (NL-9).
