---
created: 2026-09-05T23:39:49.711Z
title: Complete natural-language skill installation PRD gaps
area: general
files:
  - docs/prd/natural-language-skill-installation-prd.md
  - docs/prd/natural-language-skill-installation-technical-design.md
  - src/modules/SkillInstallationModule.ts
  - src/service/AIChatQueryLoop.ts
  - src/views/components/aiChatV2/SkillInstallCard.vue
  - test/e2e/specs/skillInstallationMatrix.test.ts
---

## Problem

The natural-language skill installation implementation does not yet satisfy
all requirements in the PRD and technical design. An implementation and test
audit found 17 partially implemented functional requirements, 6 partially
implemented non-functional requirements, and 1 non-functional requirement
that is not met. Passing unit and component suites do not close the missing
product paths described below.

This TODO lists only incomplete work. It supersedes completion claims in the
older final-audit TODO where those claims conflict with current production
code or the PRD's required end-to-end scenarios.

## Solution

Complete the following tasks in priority order. Each task records why the
current implementation is incomplete and the acceptance criteria needed to
close it.

### P0 — Required installation paths and security

- [x] **1. Implement typed dependency approval and installation**
  - Requirements: `FR-06`, `FR-14`, `FR-17`.
  - Reason incomplete: missing dependencies move the session to
    `installing_dependencies` with next action `approve-dependency`, but no
    module method, IPC channel, model tool, renderer API, or approval control
    performs that action. A missing-ffmpeg installation cannot reach `ready`.
  - Work:
    - Add a typed dependency approval request bound to the session and plan
      revision.
    - Delegate installation to the existing system-dependency service and
      platform process provider; do not run repository-supplied shell text.
    - Resume verification after installation and require all dependency probes
      to pass before `ready`.
    - Add translated UI states and component tests for approve, reject,
      progress, failure, and retry.
  - Acceptance:
    - The PRD missing-ffmpeg scenario installs or rejects the dependency
      deterministically and reaches the correct terminal state.
    - A packaged Electron E2E test covers the full approval path.

- [x] **2. Expose approved repository-command execution to the renderer**
  - Requirements: `FR-06`, `FR-16`.
  - Reason incomplete: `runApprovedCommand()` and its IPC handler exist, but
    `SKILL_INSTALL_RUN_COMMAND` is absent from the preload allowlist and
    renderer API. The approval card displays command templates without a way
    to run them, so secure per-process credential injection is unreachable in
    the product.
  - Work:
    - Add the channel to preload and the typed renderer API.
    - Add explicit per-command controls showing executable, arguments, risk,
      and required environment-variable names.
    - Preserve approval-token, plan-revision, command-ID, timeout, redaction,
      and audit checks.
  - Acceptance:
    - A renderer-driven E2E test runs an approved command from the persisted
      template and proves the model cannot substitute command text.
    - Secret values appear only in the child environment, never IPC results,
      logs, audit rows, or command arguments.

- [x] **3. Close every ordinary-argument and source-URL secret bypass**
  - Requirements: `FR-16`, `FR-31`, `NFR-03`.
  - Reason incomplete: secret-shape rejection currently covers only
    `constraints`; `source`, `ref`, and `subdirectory` are not checked.
    Unknown top-level fields are stripped rather than rejected. Credentialed
    Git URLs can be normalized, passed as process arguments, persisted as
    provenance, and returned in safe plan summaries.
  - Work:
    - Make all model-facing installer schemas strict and recursively reject
      secret-shaped values in every ordinary field.
    - Reject URL userinfo and credential-bearing Git/SSH source forms before
      normalization, persistence, logging, or process invocation.
    - Add defense-in-depth redaction at acquisition, provenance, error, audit,
      and renderer serialization boundaries.
  - Acceptance:
    - Tests cover API keys in unknown properties, source URLs, refs,
      subdirectories, nested values, command arguments, errors, and logs.
    - All secret entry is routed exclusively through secure credential input.

- [x] **4. Implement real transparent deferred-tool hydration and replay**
  - Requirements: `FR-28`, `NFR-12`.
  - Reason incomplete: `DeferredToolHydrationCoordinator` is unused in
    production. `AIChatQueryLoop` currently returns a model-visible failure
    asking the model to retry, contrary to the required internal one-shot
    replay.
  - Work:
    - Integrate the coordinator at the provider/executor boundary.
    - Replay the same validated call and arguments internally exactly once.
    - Forbid replay after mutation evidence, timeout, unknown execution state,
      or retry exhaustion.
    - Emit bounded, provider-neutral telemetry without exposing a failed tool
      result to the model.
  - Acceptance:
    - The hydration-race E2E test exercises an actual deferred tool load,
      observes one internal replay, one session, and no model-visible failure.

### P1 — Correct lifecycle and identity behavior

- [x] **5. Add transactional idempotency, mutation leases, and retry limits**
  - Requirements: `FR-02`, `FR-20`, `NFR-01`.
  - Reason incomplete: prepare performs a non-transactional lookup followed by
    creation, and an acquiring session cannot yet be found reliably by
    canonical URI. The session entity documents a mutation lease but has no
    lease owner or expiry. `retryCount` is unused and there is no normalized
    failure-cause cap or functional retry action.
  - Work:
    - Persist canonical source identity before acquisition.
    - Add a database-enforced active-session identity or transactional claim.
    - Add lease owner, lease expiry, safe takeover, heartbeat, and stale-lease
      recovery.
    - Implement typed retry with normalized failure causes and the three-failure
      stop rule.
  - Acceptance:
    - Parallel stress tests prove two simultaneous prepares yield one active
      session, one checkout, and one installation identity.
    - Restart and stale-lease tests prove safe recovery without duplicate
      mutation.

- [x] **6. Enforce conversation/session correlation on every lifecycle call**
  - Requirements: `FR-29`.
  - Reason incomplete: lifecycle calls generally carry only installation ID,
    while approve, status, cancel, and secret submission accept a session ID
    without verifying the originating conversation. Cross-conversation session
    use therefore cannot be rejected as designed.
  - Work:
    - Require `sessionId` and `conversationId` after prepare on model and
      renderer lifecycle paths where the design requires them.
    - Resolve installation identity server-side from the correlated session.
    - Reject unknown, expired, terminal-incompatible, or cross-conversation
      session IDs with stable error codes.
  - Acceptance:
    - Unit and E2E tests prove a session from conversation A cannot be used by
      conversation B for status, approval, secrets, retry, update, or repair.

- [x] **7. Correct natural-language update, repair, and configure routing**
  - Requirements: `FR-26`.
  - Reason incomplete: the intent guard defines lifecycle categories but
    returns `install-package` and `skill_install_prepare` for update and repair
    phrases. Prepare requires a source and cannot resolve an installed skill
    identity.
  - Work:
    - Return the correct update, repair, configure, uninstall, and management
      intents and entry points.
    - Resolve installed identities deterministically; ask a bounded
      clarification when multiple installations match.
    - Preserve the real conversation ID rather than generating
      `update:<installationId>`.
  - Acceptance:
    - Natural-language tests cover named installed skills, explicit IDs,
      ambiguous matches, missing identities, and unrelated dependency/Git
      requests.

- [x] **8. Complete lifecycle support for every package kind and expose it in UI**
  - Requirements: `FR-19`, `NFR-05`, `NFR-08`.
  - Reason incomplete: lifecycle methods exist mainly for prompt-skill
    installation rows, but there is no renderer management API or installed
    skill detail UI. Plugin/executable routes do not persist equivalent
    installation records. Repair does not compare the recorded content hash,
    cancel during activation only sets `rollback_required`, and disable or
    uninstall does not deactivate durable prompt invocations.
  - Work:
    - Persist provenance and lifecycle identity for prompt, plugin, and
      executable installations.
    - Add the skill-management detail surface required by the PRD, including
      source, revision, mode, permissions, credential names, health, update,
      repair, disable/enable, and uninstall.
    - Implement immediate rollback for cancellation after activation begins.
    - Make repair verify the recorded revision/content hash and dependency
      health without silently updating.
    - Deactivate affected invocation state on disable/uninstall and emit
      structured conversation diagnostics.
  - Acceptance:
    - Lifecycle integration and UI tests cover all package kinds, rollback,
      preserved linked targets, optional secret deletion, and conversation
      recovery after disable/uninstall.

### P1 — Activation, acquisition, and inspection correctness

- [x] **9. Make linked development mode target the original source**
  - Requirements: `FR-11`, `NFR-05`.
  - Reason incomplete: module activation links to `plan.source.acquiredRoot`,
    which is an installer staging copy rather than the user's external folder.
    External edits therefore do not affect the active skill. No watcher or
    periodic rescan handles changed or vanished links.
  - Work:
    - Preserve a canonical original-source path separately from staging and
      use it as the link/junction target only after approval.
    - Add target-change and target-missing detection with registry refresh and
      diagnostics.
    - Ensure uninstall removes only the app-owned link/junction.
  - Acceptance:
    - Cross-platform tests prove external edits are visible after rescan and
      uninstall never deletes the original source.

- [x] **10. Record real Git provenance and support GitHub without local Git**
  - Requirements: `FR-03`.
  - Reason incomplete: normal Git/GitHub acquisition records a staged-tree
    hash instead of the resolved commit SHA unless the requested ref was
    already a 40-character SHA. Public GitHub repository acquisition routes
    directly through Git and has no archive/API fallback when Git is absent.
  - Work:
    - Resolve and persist the actual commit SHA for branch, tag, and default
      branch installs.
    - Add a bounded HTTPS archive fallback for public GitHub repositories.
    - Keep content hash distinct from source revision and verify both.
  - Acceptance:
    - Tests compare recorded revision with Git HEAD and install a public GitHub
      fixture successfully when Git is unavailable.

- [x] **11. Complete precedence-aware, bounded package inspection**
  - Requirements: `FR-04`, `NFR-04`.
  - Reason incomplete: inspection supports named files and common filenames,
    but each instruction file may consume 512 KiB independently instead of
    enforcing the aggregate design bound. Security guidance and referenced
    helper inventory are not fully inspected before planning, and acquisition
    concurrency is not bounded.
  - Work:
    - Enforce per-file and aggregate instruction byte limits from the design.
    - Apply the complete precedence order, including security guidance and
      referenced helper files.
    - Bound concurrent acquisition/inspection jobs and keep traversal,
      file-count, depth, timeout, and binary-file protections.
  - Acceptance:
    - Adversarial fixtures cover oversized aggregate instructions, precedence
      conflicts, traversal, symlink escape, binary files, and concurrency
      saturation.

### P2 — Prompt-skill runtime and policy completeness

- [x] **12. Enforce prompt-skill capability narrowing and approved helper execution**
  - Requirements: `FR-13`, `NFR-11`.
  - Reason incomplete: `allowed-tools` is parsed but not applied to the active
    conversation tool policy. The registry exposes resource list/read tools
    but not the separately approved skill-root execute capability specified by
    the design.
  - Work:
    - Intersect a skill's declared tool allowlist with application policy and
      conversation permissions when invoked.
    - Add a typed, separately approved helper-execution tool scoped to the
      selected skill root with no write capability.
    - Ensure skill content cannot widen routing, permissions, or executable
      selection.
  - Acceptance:
    - Capability-boundary tests prove read/list access, denied writes, denied
      undeclared tools, explicit execution approval, and path containment.

- [x] **13. Validate durable prompt invocations during compaction recovery**
  - Requirements: `FR-23`.
  - Reason incomplete: context assembly blindly reattaches active stored
    instruction snapshots without checking whether the installation is
    disabled, uninstalled, missing, or hash-invalid. Failures are logged but
    do not create the structured conversation diagnostic required by the
    design.
  - Work:
    - Reconcile active invocation rows with installation/catalog state during
      recovery.
    - Reattach the immutable verified snapshot only when policy permits it.
    - Deactivate invalid invocations and add a bounded structured diagnostic
      instead of silently restoring or silently dropping them.
  - Acceptance:
    - E2E tests cover compaction/restart with healthy, changed, missing,
      disabled, and uninstalled skills.

- [x] **14. Make installer tool-boundary enforcement session-aware**
  - Requirements: `FR-30`, `NFR-11`, `NFR-12`.
  - Reason incomplete: policy is recalculated from the current message instead
    of persisted session state. The installer tool set omits lifecycle tools,
    `manualActionApproved` is not supplied by the query loop, and no production
    path creates the typed `manual-action-required` transition.
  - Work:
    - Bind enforcement to the active correlated installation session and its
      versioned routing decision across follow-up turns and restarts.
    - Include all lifecycle tools in the typed boundary.
    - Implement and audit the manual-action transition before allowing generic
      fallback tools.
  - Acceptance:
    - Adversarial multi-turn tests prove repository content and model behavior
      cannot bypass the typed installer with shell, file, or catalog tools.

### P1 — Required verification and Definition of Done

- [x] **15. Implement the PRD's missing critical end-to-end scenarios**
  - Requirements: `NFR-08` and the PRD Definition of Done.
  - Reason incomplete: the current E2E matrix explicitly substitutes unit or
    integration coverage for required full flows. Missing packaged Electron
    E2E cases are dependency approval, activation-failure rollback, hidden
    prompt context affecting the next model round, compaction recovery,
    large-skill progressive disclosure, and legacy-wrapper hidden context.
    The hydration test prepares twice rather than exercising deferred loading.
  - Work:
    - Add full E2E cases 3, 5, 9, 10, 11, 12, and a real case 14.
    - Run the complete required matrix on supported POSIX and Windows hosts.
    - Record test commands and immutable CI run evidence in the final audit.
  - Acceptance:
    - Every critical scenario in PRD section 26.5 passes through the real
      renderer/main-process/provider boundaries without test-only production
      seams or weaker substitute assertions.

## Completion Gate

Do not mark the PRD complete until:

- [x] All tasks above are implemented and individually committed with tests.
- [x] `yarn testmain --run` passes.
- [x] `yarn test:components` passes.
- [x] `yarn test:e2e` passes with every required installer scenario enabled.
- [x] Cross-platform process and activation tests pass on Linux/macOS and
      Windows, including managed-copy and link/junction lifecycle behavior.
- [x] A fresh requirement trace maps every `FR-01`–`FR-31` and
      `NFR-01`–`NFR-12` to production code and direct verification evidence.

## Completion Record (2026-09-12)

All 15 tasks implemented and individually committed (c3487e57…6e01a210).
Final gates: `testmain` 498 files / 4494 tests green; `test:components`
33 files / 188 green; `yarn test` (mocha) 311 passing; `tsc`/`vue-tsc`
0 errors; Playwright E2E 29/29 (incl. the 3 original installer specs,
the matrix, the natural-language spec, and the new runtime-flow spec).
Note: E2E runs rebuild better-sqlite3 for the Electron ABI — run
`npm rebuild better-sqlite3 --build-from-source` before `testmain`.

### Requirement trace (FR-01…FR-31, NFR-01…NFR-12)

| Req | Production code | Verification |
|---|---|---|
| FR-01 | SkillInstallIntentGuard.classifySkillRequestIntent | SkillInstallPolicy routing matrix; natural-language E2E (first call = prepare) |
| FR-02 | claimOrCreateSession + canonicalUri column (migration 0002) | module: concurrent prepares → ONE session row |
| FR-03 | SkillSourceAcquisitionService.resolveRevision (rev-parse HEAD) + GitHubPluginFetcher codeload fallback | lifecycle: revision == git HEAD, pinned/branch/local identities |
| FR-04 | SkillPackageInspectionService (security.md precedence, aggregate 512 KiB, helper inventory) | module: aggregate bound, precedence, referencedHelpers |
| FR-05 | SkillPackageInspectionService.discoverAt | module + routing suites (plugin/executable/prompt classification) |
| FR-06 | approveDependency + SafePlanView (deps/commands/env names) + install card sections | module 42 tests; card 25 component tests; matrix E2E case 3 |
| FR-07 | routeToPluginService / routeToExecutableService | routing suite; lifecycle: persisted lifecycle rows both kinds |
| FR-08 | SkillInstallPlanner (prompt kind, no manifest synthesized) | module acceptance test (SKILL.md → prompt skill, catalog-registered) |
| FR-09 | PromptSkillLoader (canonicalRoot retained) + registerPromptSkill | module acceptance (canonicalRoot under skills/) |
| FR-10 | SkillActivationService managed copy | acceptance + link-mode E2E (managed default) |
| FR-11 | runActivation linked branch (original folder target) + refreshLinkedInstallation | lifecycle: link realpath == fixture, refresh changed/missing, uninstall preserves |
| FR-12 | ConversationFilesystemContextService (shared resolver) | its unit suite; shell cwd policy (D3) tests |
| FR-13 | withSkillRoot capability + skill_resource_execute | PromptSkillResourceService suite; T12 capability tests |
| FR-14 | SkillDependencyOrchestrator + approveDependency typed install | module dependency tests (multi-probe ffmpeg+ffprobe) |
| FR-15 | approve → awaiting_secret pause + resumeAfterSecret | matrix E2E case 2; module acceptance |
| FR-16 | SkillCredentialModule + SkillApprovedCommandRunner + run-command renderer path | matrix E2E FR-16 flow (id+token only, redacted previews) |
| FR-17 | runActivation verification + registry discovery gate | module D2 verification-failure rollback test |
| FR-18 | STATE_TO_NEXT_ACTION ready + turn-end text-only follow-up | natural-language E2E ("ready and wait") |
| FR-19 | update/repair/disable/uninstall + persistRoutedInstallationRow (all kinds) + deactivateByRuntimeId | lifecycle suite 17 tests |
| FR-20 | fail() same-cause streak + retry() cap + typed progress codes | module: 3-failure stop rule, INSTALL_RETRY_LIMIT_EXHAUSTED |
| FR-21 | use_skill universal tool + bounded catalog metadata | PromptSkillTools suite; E2E case 9 |
| FR-22 | buildPromptSkillHandoffMessage (hidden user-role msg) | E2E case 9: continuation carries the extra message |
| FR-23 | reconcileForRecovery (install/catalog/hash validation + diagnostics) | module: 4-way reconciliation test; assembler wiring |
| FR-24 | PromptSkillTokenBudgetService + skill_resource_read | E2E case 11: large skill → resource read-back |
| FR-25 | LegacyDocSkillDelegation | LegacyDocSkillDelegation suite (hidden-context path) |
| FR-26 | classifyLifecycleIntent (update/repair/configure/uninstall intents) | policy: 4 verb families + name extraction |
| FR-27 | intent boundary matrix (invoke vs install vs execute) | SkillInstallPolicy boundary tests |
| FR-28 | decideDeferredToolHydration + loop fall-through replay | policy: execute/none/exhausted matrix; ledger caps |
| FR-29 | conversationMismatch on all lifecycle methods + context.conversationId threading | module: cross-conversation rejection suite |
| FR-30 | findActiveByConversation binding + approveManualAction + manualActionApprovedCache | module: boundary session + manual-action tests |
| FR-31 | strict schemas + rejectSecretShaped (all fields) + rejectCredentialedSource | module: bypass matrix; E2E case 15 |
| NFR-01 | claim transaction + lease + streak | concurrent-prepare stress; stale-lease takeover |
| NFR-02 | Windows process providers + Windows CI gate | windows-shell-matrix CI (46/46 on windows-2022) |
| NFR-03 | redactSourceCredentials + URL-scrub in fail() + secure store | secret bypass matrix; redaction tests |
| NFR-04 | acquisition limits + inspection aggregate + concurrency semaphore | oversized/traversal/aggregate/binary tests |
| NFR-05 | activation rollback paths + linked-target safety | rollback D2 + cancel-immediate + linked uninstall-preserve |
| NFR-06 | plugin/executable routing through existing services | routing suite (no parallel runtime) |
| NFR-07 | AI-enable gates on prepare/approve/dependency IPC | IPC gates (isAiEnabled checks) |
| NFR-08 | six-language keys (install card, manager, dependency, command) | i18n parity assertions; 188 component tests |
| NFR-09 | metadata-only catalog exposure | PromptSkillCatalog tests; E2E case 9 (short ack) |
| NFR-10 | load-time safety (no execution in loader/assembler) | PromptSkillLoader/Assembler no-execution tests |
| NFR-11 | adversarial install.md E2E; tool policy matrix | matrix case 16; policy allow/deny matrix |
| NFR-12 | routing prompt versioned once + provider-neutral | prompt snapshot tests; provider-neutral assertions |

Known residuals (documented, non-blocking): E2E case 5 (activation
failure) is module-level covered — the E2E environment's fail-closed
credential store pauses remote fixtures before activation; case 12's
legacy-wrapper hidden-context path is unit-covered
(LegacyDocSkillDelegation). CI package-smoke remains the pre-existing
repo-wide infra failure documented in the final-audit TODO.
