---
created: 2026-09-05T23:38:46.839Z
title: Close AI chat-first shell PRD gaps
area: ui
files:
  - docs/prd/ai-chat-first-application-shell-prd.md:741
  - docs/prd/ai-chat-first-application-shell-technical-design.md:336
  - src/views/components/aiChatV2/WorkspaceBadge.vue:1
  - src/views/components/aiChatWorkspace/AiChatCenterSurface.vue:20
  - src/views/composables/useConversationWorkspace.ts:112
  - src/views/components/aiChatV2/AiChatV2Composer.vue:147
  - src/views/composables/useAiChatVoice.ts:266
  - src/views/components/appShell/AppCenterRouteHost.vue:14
  - src/views/layout/AuthenticatedWorkspaceLayout.vue:131
  - test/e2e/specs/workspace-shell.test.ts:29
  - test/e2e/specs/workspace-shell-keyboard.test.ts:52
  - package.json:71
---

## Problem

The AI Chat-First Application Shell and Composer Refinement implementation is
substantially complete, but the 2026-09-06 audit found that it does not yet
satisfy the PRD and technical-design definitions of done. Of 56 functional
requirements, 44 have complete implementation and verification evidence, 9 are
partial, and 3 are not implemented.

The persistent shell, authenticated routing, two-row composer, shared voice
orchestration, inspector adapter, and window-state implementation are present.
The remaining work is concentrated in workspace chooser state coverage, draft
continuity, voice discoverability, accessibility, and end-to-end validation.

### Incomplete implementation jobs

- [ ] **Implement the complete conversation-workspace chooser state model.**
  - Requirements: FR-WS-002, FR-WS-003; acceptance criteria 9, 10, and 12.
  - Reason incomplete: `WorkspaceBadge.vue` renders a path plus Change and
    Memory actions, but does not render the workspace display label or approval
    state. `AiChatCenterSurface.vue` does not consume the composable's loading
    state and has no distinct pending-approval, missing/unavailable-path, or
    busy presentation. The no-workspace state says `No workspace set` but does
    not expose the required explicit `Choose workspace` action and explanatory
    context. Refresh failures render the raw exception string instead of a
    localized, sanitized retry state.
  - Completion evidence: render and component-test loading, none selected,
    pending approval, approved, untrusted instructions, unavailable path,
    selection error, and busy states. Show name, shortened path, icon-plus-text
    approval status, Choose/Change action, and localized retry behavior in all
    six languages.

- [ ] **Block unsafe workspace changes while a run is active.**
  - Requirement: FR-WS-007; acceptance criterion 13.
  - Reason incomplete: workspace setup/change events are forwarded without
    consulting `selectedStore.isBusy`, so users can open the change flow while
    a workspace-backed tool may be running. No disabled reason such as
    `Available after current run` is exposed.
  - Completion evidence: disable or defer Choose/Change while unsafe work is
    active, preserve the current workspace, provide localized visible and
    accessible reasoning, and test both blocked and safe transitions.

- [ ] **Persist composer drafts and attachments across center-route changes.**
  - Requirement: FR-COMP-011; acceptance criterion 21.
  - Reason incomplete: typed text, selected files, and pasted-text state are
    component-local refs in `AiChatV2Composer.vue`. `AppCenterRouteHost.vue`
    replaces the route component without a keep-alive or per-conversation draft
    store, so an inner-page round trip destroys the unsent draft. Generated
    image selections are also owned by the route-mounted center component and
    are lost when that component unmounts.
  - Completion evidence: move draft ownership to a bounded per-conversation
    store/composable or an equivalent durable renderer boundary. Restore text,
    attachments, pasted-text references, and generated-image references after
    Chat -> inner page -> Chat and conversation switches. Clear only after the
    existing accepted-send rule. Add component and deterministic E2E tests.

- [ ] **Keep voice controls discoverable when settings or prerequisites fail.**
  - Requirements: FR-COMP-009, FR-VOICE-001, FR-VOICE-003, FR-VOICE-005;
    acceptance criteria 20, 22, and 25.
  - Reason incomplete: `useAiChatVoice.loadSettings()` sets `inputEnabled` to
    false on a settings-load failure, while the composer mounts the microphone
    only under `v-if="voiceEnabled"`. This silently removes a recoverable
    capability instead of showing a disabled/setup state. During an active run,
    the disabled microphone retains the normal start-recording label and does
    not expose why it is unavailable.
  - Completion evidence: distinguish policy-disabled from recoverable
    unavailable/setup states; keep the microphone visible for recoverable
    failures; expose localized setup, busy, permission, recording,
    transcription, and failure text; preserve typed drafts and attachments;
    and test each state in the default chat-center surface.

- [ ] **Meet the minimum interaction-target and zoom accessibility contract.**
  - Requirements: PRD sections 16.4 and 21; FR-QUAL-004.
  - Reason incomplete: several shell controls are smaller than the required
    40x40px target, including the 36x36 narrow-navigation opener. There is no
    recorded 200% zoom verification, and the incomplete workspace states cannot
    yet prove status is conveyed by text/icon rather than color alone.
  - Completion evidence: raise applicable targets to at least 40x40px, verify
    visible focus rings are not clipped, prove status/selection semantics in
    component assertions, and record an automated or manual 200% zoom pass with
    no horizontal page scrolling.

### Incomplete verification jobs

- [ ] **Complete the PRD-required shell and composer E2E matrix.**
  - Requirements: FR-QUAL-003, FR-QUAL-005, FR-QUAL-006; PRD section 26.4;
    technical design sections 25.6 and 25.7.
  - Reason incomplete: the current shell specs cover normal startup, default
    chat, Back-to-app absence, textarea/control order, three inner routes, New
    chat return, active-route state, a narrow drawer, and part of the keyboard
    flow. They do not cover workspace selection/approval, conversation
    selection from an inner page, draft restoration, voice setup and visible
    microphone states, browser back/forward, or persisted normal/maximized
    window restoration. The renderer-reload/run-preservation case is skipped
    unless a live provider is configured. The keyboard spec does not exercise
    workspace selection or microphone controls.
  - Completion evidence: add deterministic provider-independent fixtures for
    every missing scenario, extend keyboard-only coverage through workspace and
    voice actions, and keep live-provider coverage as an additional optional
    layer rather than the only proof of run preservation.

- [ ] **Make the documented `yarn test:e2e` quality gate self-contained.**
  - Requirements: acceptance criterion 37 and technical design section 25.7.
  - Reason incomplete: `yarn test:e2e` builds Electron and starts Playwright but
    does not start or validate the renderer server. From a clean shell it fails
    before assertions with `ERR_CONNECTION_REFUSED` at port 5173. Starting
    `yarn dev:renderer` separately allowed the PRD-specific specs to run, but
    that undocumented prerequisite means the required command itself is not a
    reliable gate.
  - Completion evidence: have Playwright manage the renderer through
    `webServer`, or update the script with equivalent lifecycle/readiness
    handling. From a clean checkout, one command must start dependencies, run
    the complete suite, and shut them down with a zero exit status.

- [ ] **Record final cross-platform and accessibility validation.**
  - Requirements: PRD Definition of Done items 12-14 and rollout Phase 5.
  - Reason incomplete: automated unit/component coverage is green, but there is
    no recorded Windows, macOS, and supported Linux window-geometry validation,
    no 200% zoom result, and no complete keyboard/screen-reader validation for
    workspace and voice flows.
  - Completion evidence: publish the platform and accessibility matrix with
    dates/results, link failures to fixes, and run the final component, router,
    main-process, E2E, TypeScript, and translation gates after all gaps close.

### Audit baseline to preserve

- `yarn test:components`: 51 files and 318 tests passed.
- `yarn typecheck`: passed.
- `yarn vue-typecheck`: passed.
- Window geometry/state focused tests: 29 passed.
- Conversation workspace composable focused tests: 11 passed.
- Translation parity focused tests: 5 passed.
- PRD-specific Electron shell specs with the renderer running: 9 passed and 1
  live-provider test skipped.
- Direct `yarn test:e2e`: failed before assertions because the renderer server
  was not running; this was a harness/gate failure, not a feature assertion.

## Solution

Close the work in four logical units:

1. Implement and test the full workspace chooser state machine, including the
   active-run safety gate and localized/sanitized errors.
2. Add bounded per-conversation draft ownership and prove route-round-trip
   restoration for every draft payload type.
3. Make voice availability explicit in all recoverable states and finish the
   interaction-size, keyboard, focus, and zoom accessibility work.
4. Make `yarn test:e2e` self-contained, add the missing deterministic E2E
   scenarios, run the complete verification matrix, and update requirement
   status only after every row has passing evidence.

Do not mark the PRD or technical design complete until all checklist items are
closed and the Definition of Done passes without skipped required scenarios.
