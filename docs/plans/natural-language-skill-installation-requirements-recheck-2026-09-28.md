# Natural-language skill installation: requirements recheck

Date: 2026-09-28. Reviewed implementation: `58558c24`.

**Verdict: not all PRD/technical-design requirements are implemented yet.**
The remediation fixes several earlier defects, but important user flows still
fail. The appended “all 12 findings implemented” statement in the September 22
audit is not supported by the current end-to-end code paths.

This recheck follows the previous requirements matrix, reviews the intervening
49-file diff, and checks the updated worktree PRD and technical design. Their
recovery-policy clarification is accepted: changed linked content preserves the
verified snapshot with a diagnostic; missing/disabled/uninstalled skills do not
reattach. No production code was changed in this audit.

## Validation

- Existing targeted backend tests: **11 files / 187 tests passed**, with the
  TypeScript gate enabled. Includes installation module/lifecycle, command
  runner, routing/policy, prompt loader/invocation/catalog, chat credential guard,
  engine credential boundary, and catalog counters.
- Complete component suite: **35 files / 202 tests passed**.
- **Eight additional observation probes** confirmed uncovered defects: six
  backend cases and two component cases. They assert the defective behavior,
  so their passing results are reproduction evidence, not acceptance success.
- Direct pure-function probes confirmed a remaining installer shell-policy bypass
  and incorrect handling of quoted command arguments.
- Electron E2E, live Windows/macOS execution, current remote CI, production
  telemetry, and real network acquisition were not rerun. The remediation record
  contains historical platform/E2E evidence; this recheck does not independently
  certify those runs or their equivalence to current HEAD.
- Temporary probe files were removed from the worktree. Copies and logs remain
  under `/tmp/skill-recheck-20260928-*` for this environment.

## Fixes confirmed in the updated code

- Active-session request matching now includes ref, subdirectory, and mode.
- Selected managed-copy roots are joined during activation and existing-service
  routing. Submitted selections are persisted.
- Updates carry the previous installation ID; same-name replacement produces a
  review warning and supersedes old enabled rows.
- Backend secret resume checks all required credentials; secure submission
  validates the variable against the plan. TOKEN/SECRET detection is improved.
- Dependency approval happens before activation, and cancellation includes
  dependency-hold rollback handling.
- Prompt selection refuses when any recognized essential section cannot fit.
- Direct ordinary-message credential shapes are rejected before chat persistence.
- GitHub fetcher provenance is consumed instead of discarded.
- Constraints are stored on the plan, python3 maps to python, and dependency
  probe evidence is returned.
- Recovery semantics are aligned, and catalog lines now include runtime IDs.

These fixes do not close the remaining integration gaps below.

## Remaining findings

### R1 — High: required-command checkpoint is not a usable, consistent flow

**FR-06, FR-07, FR-14–FR-17; PRD §18.4, §22; design §8.3.**

- `SkillInstallCard.vue:496` omits `awaiting_commands` from the states that show
  command-run controls. The backend now stops there, but the user cannot run the
  commands from the card. **Component probe confirmed the controls are absent.**
- `SkillInstallationModule.ts:1202` resumes a credential-complete installation
  directly into activation/import without checking pending commands. Dependency
  completion has the same omission at `:1000`. **Backend probe:** a plan with
  `FIRST_API_KEY=` and `uv sync` goes from awaiting-secret to ready with its
  required command never run.
- `SkillApprovedCommandRunner.ts:191` compares the entire mutable staging tree
  against the original acquisition hash before every command. **Backend probe:**
  the first approved setup command writes `prepared.txt`; the next approved
  command is refused with `SOURCE_CHANGED_AFTER_APPROVAL`. Normal multi-command
  setup must account for its own approved writes.
- For executable/plugin plans, completing the final command only transitions to
  `activating`, without invoking the respective import service
  (`SkillInstallationModule.ts:1333`).
- Command parsing still splits on whitespace and filters arguments instead of
  preserving shell quoting (`SkillInstallPlanner.ts:303`). For example,
  `node -e "console.log(1)"` retains literal quotes in the argument passed with
  shell disabled; that evaluates a string rather than the intended expression.
  The runner also proceeds if source hashing throws (`SkillApprovedCommandRunner.ts:199`).

Use one continuation method for approval, dependency completion, secret resume,
and command completion, and test that method through the card and actual runner.

### R2 — High: multi-skill selection still installs only one skill

**FR-05–FR-08; PRD §11.3.**

`approve()` and all continuation paths still choose only the first selected
candidate (`SkillInstallationModule.ts:657` onward). **Backend probe:** select
both `skills/one:prompt` and `skills/two:prompt`; the session reports ready but
only `audit-one` is installed.

The card has no candidate selection control and still sends no selected IDs
(`SkillInstallCard.vue:526`). The safe plan does not expose candidate IDs
(`SkillInstallationModule.ts:2768`). Persisting a selection is not the same as
activating it or allowing the user to choose it.

The new multi-selection regression test supplies IDs without the `:prompt`
suffix, ignores the approval result, and only checks that status is not failed
(`test/vitest/main/SkillInstallationModule.test.ts:2061`). It does not establish
successful selection/activation.

### R3 — High: multi-secret UI cannot advance to the remaining credential

**FR-15–FR-17; PRD §19 and §22.1.**

The backend correctly stays in awaiting-secret until every credential exists.
However, the card always extracts the first uppercase name from the unchanged
summary (`SkillInstallCard.vue:509`); snapshots list all credential names, not
the next missing one (`SkillInstallationModule.ts:2818`).

**Component probe:** after submitting `FIRST_API_KEY` for a two-key plan, the
card still labels/submits `FIRST_API_KEY`. There is no selector or automatic
advance to `SECOND_API_KEY`. The backend completeness fix therefore exposes a
renderer dead end for normal multi-key plans.

### R4 — High: session/ready reuse still violates identity and correlation

**FR-02, FR-17, FR-29, NFR-01; PRD §10.2.**

Active matching now checks request fields, but not the calling conversation
(`SkillInstallationModule.ts:272`; `SkillInstallation.model.ts:161`).
**Backend probe:** A prepares a source; B prepares the identical request and
receives A's session ID; B's status call then fails with
`INSTALL_SESSION_CONVERSATION_MISMATCH`.

Ready reuse still does not compare source subdirectory (`SkillInstallationModule.ts:291`).
**Backend probe:** after installing the repository root, asking for its different
`nested` skill reports the root skill ready without preparing the requested one.
It also compares request mode `linked` against persisted `symbolic-link` or
`junction`, and compares requested branch/tag text against resolved commit
identity. Those are different representations. Health reuse only checks structure.

### R5 — High: nested linked installs still activate the wrong directory

**FR-09, FR-11, FR-19; PRD §11.3, §17.3, §24.1.**

The selected root is joined initially, but linked mode resets it to the source
repository root (`SkillInstallationModule.ts:2359`). **Backend probe:** linked
installation of `nested/SKILL.md` with `subdirectory: "nested"` prepares, then
fails activation.

Persistence also stores only the candidate path relative to the inspection root
(`:2409`), losing a separately requested subdirectory. Updating such an install
can therefore reacquire the wrong location. Plugin/executable rows still persist
an empty subdirectory (`:2300`). Inspection still reads installation instructions
at the inspection root rather than each discovered wrapper/child root
(`SkillPackageInspectionService.ts:91`).

### R6 — Medium: retry still drops constraints and linked mode

**FR-04, FR-15, FR-18–FR-20; PRD §9.2, §10.1.**

Retry now restores ref/subdirectory, but omits the persisted plan constraints
and selected IDs. It checks `requestedMode` for `symbolic-link`/`junction` even
though prepare stores the request value `linked`
(`SkillInstallationModule.ts:1580`). Linked requests consequently retry as
default managed copies. Retry still reacquires in a fresh session instead of
resuming completed setup checkpoints.

### R7 — Medium: model-aware/aggregate prompt budget is not wired into execution

**FR-24; design §10.7.**

The essential-section omission is fixed. However, `remainingContextTokens` is
only declared in `skillTypes.ts:225` and read in `skillsRegistry.ts:2431`.
There is no production assignment anywhere under `src/`. The actual invocation
still falls back to fixed 16,000/8,000 limits and does not subtract active skills.
Adding an optional field to the execution context did not connect it to the
model window, assembled prompt size, or completion reserve.

### R8 — High: generic fallback enforcement remains incomplete

**FR-30, NFR-11; PRD §9.7; design §8.6.**

The earlier `git -c ... clone` case is fixed. **Direct probe:** under explicit
install intent, `cp -r video-use ~/.aifetchly/skills/video-use` is still allowed by
`evaluateSkillInstallationToolPolicy()` (`SkillInstallationToolPolicy.ts:65`).
The regex's `\b-r` boundary does not match a space followed by a hyphen. Other
ordinary permission checks remain separate; this is a failure of the promised
installer-specific enforcement.

Manual approval now stores the target URI, but still does not require a typed
provider manual-action result or bind the exact operation/cwd/capabilities
(`SkillInstallationModule.ts:2070`). A matching target authorizes any call at the
policy layer (`SkillInstallationToolPolicy.ts:106`). This does not meet the
specified bounded manual-action contract.

### R9 — Medium: review, management, dependency, and localization requirements remain partial

**FR-06, FR-14, NFR-08; PRD §18, §22; design §14.1.**

Safe-plan permissions/activationTarget and manager linkedTarget fields have
been added to backend views, but the Vue templates do not render them. The
activation target is still the placeholder `<global prompt skills>`. Management
still lacks dependency versions/paths, granted permissions, last verification,
and reveal-source UI. Risk and skill-kind enums remain untranslated.

Dependency planning remains a small system-binary list with text evidence; it
does not provide the specified persistent dependency bindings/resolved paths,
version constraints, or full language-environment/MCP/model classifications.
Fixing python3 detection alone does not complete the dependency contract.

### R10 — Medium: newly added installer metrics are not emitted

**NFR-12; technical design §19.**

`ToolCatalogCounters` adds installer and hydration keys to its in-memory
snapshot, but `logSnapshot()` still prints only the original six catalog fields
(`src/service/ToolCatalogCounters.ts:89`). The 50-turn emission hook therefore
does not emit the newly claimed installer metrics. Tests check counters and 49
turns, not the contents of the emitted 50th-turn event.

Required prepare-to-ready timings, first-tool-category correlation, and other
specified observability dimensions are not established by those three counters.

## Updated traceability disposition

All 43 IDs from the previous audit are accounted for below. “Present” means no
specific new gap established in this review, not fresh full-platform acceptance.

| Requirements | Disposition | Basis |
| --- | --- | --- |
| FR-01 | Partial | Routing exists; deterministic source/language coverage and semantic model selection not fully established. |
| FR-02 | Partial | R4. |
| FR-03 | Present | Trusted GitHub provenance now consumed. |
| FR-04 | Partial | Nested instruction reading and retry constraints, R5/R6. |
| FR-05 | Present | Classification exists; completing selected installations is separately blocked by R2. |
| FR-06 | Partial | R1/R2/R9. |
| FR-07 | Partial | Correct services selected after secret resume, but command-completion import is incomplete, R1. |
| FR-08 | Present | Root prompt managed-copy path retained. |
| FR-09 | Partial | Canonical prompt context exists; selected linked roots are wrong, R5. |
| FR-10 | Platform evidence not rerun | Managed-copy code and prior CI evidence exist. |
| FR-11 | Partial | R5; current Windows junction run not verified. |
| FR-12, FR-13 | Present | Shared scope and separate resource capabilities retained. |
| FR-14 | Partial | R1/R9. |
| FR-15, FR-16, FR-17 | Partial | R1/R3/R4; credential storage and completeness guards exist. |
| FR-18 | Partial | Terminal constraints persist initially but are lost on retry, R6. |
| FR-19, FR-20 | Partial | Lifecycle improvements exist; R1/R4/R5/R6 remain. |
| FR-21, FR-22 | Present | Catalog now carries IDs; hidden-context invocation retained. |
| FR-23 | Present | Updated recovery policy and implementation align. |
| FR-24 | Partial | R7. |
| FR-25, FR-26, FR-27, FR-28 | Present | Legacy adapter, application policy, separate entry points, bounded hydration retained; full E2E not rerun. |
| FR-29, FR-30 | Partial | R4/R8. |
| FR-31 | Improved; not exhaustive | Raw ordinary-message secret-shape guard added; inspection shows scheduled submissions bypass it and pasted-content expansion happens later. Do not infer all input channels are covered. |
| NFR-01 | Partial | R4/R6. |
| NFR-02 | Platform evidence not rerun | Prior Windows CI evidence exists. |
| NFR-03 | Improved; not exhaustive | Direct chat guard, secure store and runner redaction exist; all persistence/expanded-input paths not proven. |
| NFR-04 | Partial / not fully verified | Existing staging bounds remain; source inspection/planning skill-count and exhaustion coverage not independently closed. |
| NFR-05 | Present | Ownership/link-preservation safeguards retained; prior cancellation defect fixed. |
| NFR-06 | Partial | Required-command executable/plugin completion regression, R1. |
| NFR-07 | Present | AI-serving IPC gates retained. |
| NFR-08 | Partial | R1/R2/R3/R9 despite a green existing component suite. |
| NFR-09, NFR-10 | Present | Bounded metadata-only discovery and inert prompt loading retained. |
| NFR-11 | Partial | R8. |
| NFR-12 | Partial | R10; provider-neutral versioned routing still present. |

## Completion decision

Do not mark the PRD complete yet. Prioritize the command continuation/card flow,
multi-skill and multi-secret interactions, then request identity and nested-link
lifecycle handling. Add assertions for successful outcomes and actual renderer
actions rather than only persisted fields or non-failed states. Complete budget,
fallback, metadata/UI, and emitted-metric integration before final platform and
Electron acceptance sign-off.
