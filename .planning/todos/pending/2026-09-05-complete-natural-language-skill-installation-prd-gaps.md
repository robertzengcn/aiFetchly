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

- [ ] **1. Implement typed dependency approval and installation**
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

- [ ] **2. Expose approved repository-command execution to the renderer**
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

- [ ] **3. Close every ordinary-argument and source-URL secret bypass**
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

- [ ] **4. Implement real transparent deferred-tool hydration and replay**
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

- [ ] **5. Add transactional idempotency, mutation leases, and retry limits**
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

- [ ] **6. Enforce conversation/session correlation on every lifecycle call**
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

- [ ] **7. Correct natural-language update, repair, and configure routing**
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

- [ ] **8. Complete lifecycle support for every package kind and expose it in UI**
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

- [ ] **9. Make linked development mode target the original source**
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

- [ ] **10. Record real Git provenance and support GitHub without local Git**
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

- [ ] **11. Complete precedence-aware, bounded package inspection**
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

- [ ] **12. Enforce prompt-skill capability narrowing and approved helper execution**
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

- [ ] **13. Validate durable prompt invocations during compaction recovery**
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

- [ ] **14. Make installer tool-boundary enforcement session-aware**
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

- [ ] **15. Implement the PRD's missing critical end-to-end scenarios**
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

- [ ] All tasks above are implemented and individually committed with tests.
- [ ] `yarn testmain --run` passes.
- [ ] `yarn test:components` passes.
- [ ] `yarn test:e2e` passes with every required installer scenario enabled.
- [ ] Cross-platform process and activation tests pass on Linux/macOS and
      Windows, including managed-copy and link/junction lifecycle behavior.
- [ ] A fresh requirement trace maps every `FR-01`–`FR-31` and
      `NFR-01`–`NFR-12` to production code and direct verification evidence.
