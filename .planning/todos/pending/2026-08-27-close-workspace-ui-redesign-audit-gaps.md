---
created: 2026-08-27T03:34:29.402Z
title: Close workspace UI redesign audit gaps
area: ui
files:
  - docs/prd/ai-chat-workspace-ui-redesign-prd.md:1267
  - docs/prd/ai-chat-workspace-ui-redesign-technical-design.md:1776
  - docs/prd/inner-page-ui-convergence-prd.md:754
  - docs/prd/inner-page-ui-convergence-technical-design.md:1383
  - docs/prd/ipr-traceability-matrix.md:6
  - src/views/router/index.ts:6
  - src/views/router/uiMigrationRegistry.ts:45
  - src/views/layout/layout.vue:130
  - src/views/components/appShell/AppWorkspaceShell.vue:1
  - src/views/components/appShell/AppCenterRouteHost.vue:47
  - src/views/components/aiChatWorkspace/AiChatWorkspaceShell.vue:465
  - src/views/components/aiChatWorkspace/AiChatWorkspaceTranscript.vue:40
  - src/views/components/aiChatWorkspace/AiChatPlanDecisionCard.vue:28
  - src/views/components/aiChatWorkspace/SemanticToolResult.vue:1
  - src/main-process/communication/ai-chat-workspace-ipc.ts:181
  - src/main-process/communication/ai-chat-v2-ipc.ts:917
  - src/service/AIChatCoordinator.ts:371
  - src/service/AIChatRunOwnerAdapter.ts:45
  - src/service/ScheduledAiMessageRunner.ts:318
  - src/views/store/chatWorkspace.ts:116
  - src/views/store/selectedConversation.ts:105
  - test/vitest/main/components/uiMigrationCoverage.test.ts:9
  - test/e2e/workspace-shell.spec.ts:93
---

## Problem

The 2026-08-27 implementation audit found that the AI Chat Workspace UI
Redesign and Inner-Page UI Convergence PRDs are not complete, despite the
all-green claims in `docs/prd/ipr-traceability-matrix.md`. The audit compared
all 64 `FR` requirements and all 56 `IPR` requirements with the source,
focused tests, and cross-owner runtime wiring.

This file is the current consolidated gap list. Earlier workspace-redesign
TODOs remain useful historical records, but they predate the integration
findings below and must not be used alone to declare the PRDs complete.

### Open implementation tasks

- [ ] **Unify chat and inner pages under the persistent application shell.**
  - Requirements: FR-001, FR-002, IPR-001, IPR-002, IPR-007, IPR-045.
  - Reason incomplete: `/aiworkspace` is a separate top-level route, while
    authenticated inner pages render through `layout.vue`. The intended
    `AppWorkspaceShell` and `AppInspectorHost` are defined but never mounted,
    so navigation between chat and inner pages replaces the global shell.
  - Completion evidence: mount one authenticated shell around both chat and
    route-owned center surfaces; prove that global navigation and the shell do
    not remount when navigating between chat and at least two inner families;
    add wide, medium, and narrow route-integration tests.

- [ ] **Replace wrapper-only page migration with real template convergence.**
  - Requirements: IPR-004 through IPR-050, especially IPR-009, IPR-013,
    IPR-014, IPR-024, IPR-037, IPR-043, IPR-047, and IPR-048.
  - Reason incomplete: all 50 registry entries are marked `converged`, but 49
    pages only add an outer `AppPageShell`. No page consumes key convergence
    primitives such as `useCollectionState`, `AppDataTable`, `SettingsShell`,
    `SettingFieldFrame`, `StickyFormActions`, `useUnsavedChangesGuard`,
    `TaskDecisionCard`, or `AppPageOverflowMenu`. Legacy widgets still contain
    hard-coded English, local hex colors, icon-only controls, local state
    presentations, and forbidden `any` types.
  - Completion evidence: audit each of the 50 surfaces against its assigned
    template; migrate its toolbar/actions/states/forms/details/task decisions;
    remove hard-coded customer text and local palettes; change registry state
    to `converged` only after a page-family behavior test passes.

- [ ] **Fix per-family rollout and registry truthfulness.**
  - Requirements: IPR-051, IPR-053 and technical design sections 26 and 30.
  - Reason incomplete: `AppCenterRouteHost` tests the `scheduleEnabled` Ref
    object rather than `.value`, making it always truthy, and applies that one
    schedule flag to every family. The registry therefore bypasses the legacy
    frame for every claimed-converged route without independent family gates.
  - Completion evidence: resolve rollout state by route family, read Ref
    values correctly, add flag-on/flag-off tests for at least Schedule,
    Settings, and Automation, and ensure registry state reflects actual
    implementation maturity.

- [ ] **Make plan Request Changes collect and submit feedback.**
  - Requirements: FR-051, FR-056, FR-059.
  - Reason incomplete: `AiChatPlanDecisionCard` emits `request-changes`
    without feedback; `AiChatWorkspaceTranscript` emits an empty string; IPC
    rejects blank feedback; the shell catches and hides the error. The visible
    secondary action therefore performs no durable transition.
  - Completion evidence: open a localized feedback surface, reject blank
    input before IPC, submit non-empty feedback, expose recoverable failure,
    and verify the revised plan plus durable request-changes receipt.

- [ ] **Restore artifact reopen actions in conversation history.**
  - Requirements: FR-026 and FR-030.
  - Reason incomplete: grouped artifact tool results render only static text
    in `SemanticToolResult`; they expose no artifact ID, open event, or
    keyboard action. Live auto-open and the inspector list work, but the
    required durable transcript card cannot reopen a persisted artifact.
  - Completion evidence: preserve artifact identity in the execution
    projection, render an accessible reopen action, route it to the selected
    conversation's inspector, and test persisted-history reload and reopen.

- [ ] **Register summary subscriptions during workspace bootstrap.**
  - Requirements: FR-020 and FR-021.
  - Reason incomplete: the renderer subscribes locally after bootstrap, but
    the main `AIChatEventRouter` registers the renderer only in the select
    handler. A workspace with no selected conversation misses background
    status, attention, completion, and unread summaries until first selection.
  - Completion evidence: register/unregister the sender independently of
    selection, retain selected-only detail routing, and test background
    summaries immediately after opening an empty workspace.

- [ ] **Route scheduled, goal, and agent runs through the shared workspace contracts.**
  - Requirements: FR-013, FR-020, FR-021, FR-023, FR-025 and compatibility
    requirements for goals, scheduled loops, and background agents.
  - Reason incomplete: scheduled execution forwards detail through the legacy
    scheduled stream while the redesigned store listens only to workspace
    detail events. The owner adapter broadcasts summary metadata but not
    selected-conversation detail. Goal and agent execution are not integrated
    with the shared workspace run envelope/router.
  - Completion evidence: adopt the run-owner adapter and shared event router
    for every owner; keep workers database-free; verify live selected detail,
    lightweight inactive summaries, permission/user decisions, terminal
    persistence, and reload reconstruction for each owner.

- [ ] **Correct unread persistence for interactive and scheduled completion.**
  - Requirements: FR-021 and FR-024.
  - Reason incomplete: `AIChatRunOwnerAdapter` hard-codes `unread: false`, so
    inactive scheduled completions cannot become unread. For interactive runs,
    a selected renderer clears unread only in local state after a terminal
    event and does not advance durable `lastReadAt`, allowing unread to return
    after reload.
  - Completion evidence: derive unread from selection/read-marker semantics,
    persist the read marker after a selected terminal result is displayed, and
    test inactive completion, selected completion, reload, and later selection.

- [ ] **Enforce persistence-before-summary for all run transitions.**
  - Requirements: FR-023 and FR-037.
  - Reason incomplete: `AIChatCoordinator.sampleEngineStatus()` starts the
    durable waiting transition without awaiting it, then broadcasts the
    summary immediately. Focused tests logged a transition conflict where the
    delayed waiting write reached an already completed run.
  - Completion evidence: serialize waiting and terminal transitions, publish
    hints only after successful persistence, fence stale revisions, and add a
    deterministic waiting-to-terminal race test with no warning or conflict.

- [ ] **Preserve dashboard prompts and notification navigation in redesign mode.**
  - Requirements: core flows in PRD section 22 and the compatibility checklist.
  - Reason incomplete: the dashboard passes `?prompt=...`, but the workspace
    explicitly discards it instead of seeding the composer. Notification clicks
    still open the legacy dock and send a legacy selection request even when
    that dock is unmounted by the redesign flag.
  - Completion evidence: seed a new workspace composer without auto-sending,
    focus it, route notification clicks to `/aiworkspace`, select the requested
    conversation, and cover both flows with navigation tests.

- [ ] **Correct and expand end-to-end verification.**
  - Requirements: chat PRD sections 34-35, inner-page PRD sections 27 and 30,
    chat design section 28, and inner-page design section 28.
  - Reason incomplete: the current New Chat E2E expects the no-conversation
    empty state after `onNewChat` has selected a non-null conversation ID, and
    its title claims composer focus without asserting focus. Live-AI scenarios
    are skipped by default. Inner-page tests validate registry counts and
    primitive contracts rather than actual family behavior; there is no full
    responsive, keyboard, accessibility, visual, compatibility, or packaged
    performance matrix for the 50 surfaces.
  - Completion evidence: repair New Chat expectations; add deterministic
    provider-independent fixtures; execute background switch, queue,
    permission, artifact, restart, tool, and plan flows; add representative
    collection/form/detail/results/settings/task-state tests in wide, medium,
    and narrow modes; record packaged renderer/DOM/heap/soak budgets.

- [ ] **Restore a clean standard verification gate.**
  - Requirements: both technical-design definitions of done and repository
    TypeScript rules.
  - Reason incomplete: the standard targeted `yarn testmain` invocation stops
    before tests because `tsc --noEmit` reports 20 errors. Vitest also excludes
    this `.claude/worktrees/...` path unless its exclusion is overridden.
    Focused tests pass only when the typecheck gate is bypassed.
  - Completion evidence: `yarn testmain`, component tests, utility tests,
    `yarn vue-check`/non-watch typecheck, lint, and workspace E2E all run from
    this worktree without bypass flags and exit successfully.

- [ ] **Resolve the remaining product and rollout gates.**
  - Requirements: inner-page PRD acceptance criteria 22-24 and Definition of
    Done; inner-page technical design section 30.
  - Reason incomplete: legacy CSS removal is deferred pending two stable
    releases, the Statistics retention decision is open, and
    `innerPageShellV2` defaults off. Therefore active customers still use the
    legacy shell and the convergence completion gate is not met.
  - Completion evidence: record the Statistics retain/retire decision and
    execute it; complete the stability window before deleting legacy CSS;
    pass rollout gates; enable the approved shell by default; verify rollback.

- [ ] **Replace the all-green traceability claim with evidence-backed status.**
  - Requirements: all FR-001 through FR-064 and IPR-001 through IPR-056.
  - Reason incomplete: `ipr-traceability-matrix.md` marks every IPR green based
    largely on component existence or registry classification, while its own
    product-gated table lists deferred, open, and flag-gated acceptance items.
  - Completion evidence: update each row to implemented, partial, missing,
    deferred, or verified; link to the actual consuming page/runtime path and
    a passing behavior test; do not mark either PRD complete until every
    non-deferred requirement has evidence and every deferral is approved.

## Solution

Close the work in dependency order:

1. Integrate the persistent shell and correct route-family rollout.
2. Repair plan feedback, artifact history actions, prompt/notification entry,
   summary registration, owner routing, unread persistence, and transition
   serialization.
3. Migrate each page family beyond an outer wrapper and keep registry status
   honest until its behavior, localization, accessibility, and responsive
   contracts pass.
4. Resolve the product gates, restore a clean standard test/typecheck command,
   run the full E2E/accessibility/visual/performance matrix, and update the
   120-row FR/IPR traceability evidence.

Do not enable the redesign by default, remove the classic UI, or declare the
four PRD/design documents complete until every checklist item above is closed.
