---
created: 2026-08-26T15:10:00.000Z
title: AI chat workspace PRD gaps remaining after 2026-08-26 second pass
area: ui
files:
  - docs/prd/ai-chat-workspace-ui-redesign-prd.md
  - docs/prd/ai-chat-workspace-ui-redesign-technical-design.md
  - docs/prd/ai-chat-workspace-ui-redesign-implementation-plan.md
  - src/views/components/aiChatWorkspace/AiChatWorkspaceTranscript.vue
  - src/views/components/aiChatWorkspace/AiChatPlanDecisionCard.vue
  - src/views/components/aiChatWorkspace/toolExecutionProjection.ts
  - src/views/store/selectedConversation.ts
  - test/vitest/main/components/AiChatWorkspaceTranscript.test.ts
  - test/vitest/main/aiChatWorkspaceIntegration.test.ts
  - test/vitest/main/components/workspaceShellA11y.test.ts
  - test/e2e/workspace-shell.spec.ts
---

## Problem

Second-pass audit (2026-08-26) after commits `60f6ccc6`, `4d9913dc`,
`4bee4fae`, `e9b5f12b`. Of the 17 tracked items, 11 code gaps are now closed
(FR-040 parity test, FR-043/044/050 component tests, FR-047 classification,
FR-052 dedup, FR-057 custom text, FR-059 retry propagation, FR-062 single
plan owner) and design section 28.7 is 5/6 covered. `yarn testmain` passes
(428 files / 3782 tests). Six items remain open; none block the others.

### Confirmed incomplete requirements

| Requirement | Status | Reason | Completion evidence required |
| --- | --- | --- | --- |
| FR-042 | Partial | `AiChatWorkspaceTranscript.vue:131` still calls `buildToolExecutionGroups(messages)` without the second `liveEvents` argument. The live detail-event overlay is proven only in the pure-projection unit test (`workspaceProjections.test.ts`); the mounted selected-conversation transcript never receives streaming updates, so a running tool does not evolve in place from live events. | Thread the selected conversation's buffered detail events (from `selectedConversation` store) into the transcript prop and pass them through to `buildToolExecutionGroups(messages, liveEvents)`; add a component test that mounts with persisted TOOL_CALL + a live `tool_progress` event and asserts the row status/progress changes without a second card. |
| FR-056 | Incomplete | `AiChatPlanDecisionCard.vue` renders Approve (primary) + Request changes (secondary) + Review full plan, but the PRD §12.7-required infrequent **discard/reject overflow action is absent** — no discard control or i18n key exists anywhere in the workspace components. A user cannot reject/discard an awaiting-approval plan from the redesigned surface. | Add an overflow menu to `AiChatPlanDecisionCard` containing Discard/reject (with confirmation), add `workspaceChat.plan.discard` (+ confirm text) keys to all six locales (parity test will enforce), emit through the durable `rejectChatV2Plan` path, and add a component test asserting the hierarchy: exactly one primary (Approve), one secondary (Request changes), discard only in overflow. |

### Required verification gaps

| Contract | Status | Reason | Completion evidence required |
| --- | --- | --- | --- |
| Technical design section 28.7 | Partial | Integration suite covers three-active-plus-queued-fourth, same-conversation serialization, renderer reload, stale terminal events, and worker failure (`aiChatWorkspaceIntegration.test.ts:109-247`). The required **full application restart** scenario (coordinator re-init from durable run rows, queued runs reconciled to interrupted) has no test. | Add a restart test: seed non-terminal runs, dispose the coordinator/DB singleton, re-initialize from the same SQLite path, assert bootstrap reports interrupted/idle per design §19.4 and no run resumes silently. |
| PRD section 34.3 (FR-038–041, FR-064) | Partial | Transcript execution/plan surfaces now have component tests, but there is no dedicated suite for sidebar tree keyboard navigation/focus behavior, header status precedence, inspector resize/tabs, run strip states, long translations overflowing labels, reduced-motion behavior, and non-color state cues (icons + aria labels). | Add `test/vitest/main/components/workspaceShell*` suites mounting `AiChatWorkspaceSidebar`, `AiChatConversationHeader`, `AiChatRunStrip`, `AiChatInspector` covering focus order, aria names, truncation under long zh/ja strings, and icon+label state rendering; include in standard `yarn testmain`. |
| PRD section 34.4 / AC 3–6, 12–18, 23–30 | Unverified | `test/e2e/workspace-shell.spec.ts` contains 9 tests (7 shell subset + 2 behind `AIFETCHLY_E2E_LIVE_AI`). Missing scenarios: background unread completion clears on select, bounded queueing visible as Queued state, permission resume after decision, selected vs inactive artifact auto-open, restart reconciliation E2E, scheduled-loop pause/resume/stop controls, keyboard-only end-to-end use, tool grouping in a live run, complete plan lifecycle (draft→question→approval→execute→receipt). | Implement the seven missing scenarios (live-guarded where a provider is needed), run all sixteen locally, and record results in the implementation plan. |
| PRD sections 27 and 34.5 / AC 19–20 | Unverified | Only algorithm microbenchmarks exist (`workspacePerformance.test.ts`). No packaged-app measurements: p95 selection/history load, renderer process count, DOM node count, heap growth across switches, 500-switch soak, artifact-preview resource release against documented budgets. | Run representative legacy-database measurements plus the 500-switch and artifact soak tests on a packaged build; record p95/renderer/DOM/heap numbers versus budgets in the implementation plan verification section. |
| Technical design section 30 compatibility checklist | Unverified | No capability-to-destination matrix demonstrating a tested destination for every legacy capability: goal loop, scheduled loop, seven-layer recovery, spoken response, voice input, workspace memory/trust, agent tasks, notifications, attachments, at-mentions, slash commands, compaction, MCP management relocation, and all plan/tool actions. | Create the matrix document (capability → new destination → verifying test → result), verify every row, and get sign-off before retiring the classic UI. |
| Technical design section 33 definition of done | Blocked | Requires passing traceable verification for all 64 FRs plus the performance/a11y/i18n/compatibility gates above. No 64-row FR matrix exists yet; blocked until the rows above close. | Publish the 64-row matrix linking each FR to its implementation location and passing automated/manual verification result; then update the PRD delivery checklist. |

### Existing positive evidence (preserve)

- All 11 previously-open code FRs closed with tests; `yarn testmain`
  428 files / 3,782 tests green including the new parity, transcript
  component, and integration suites.
- Single plan-status owner established (shell dock removed); transcript
  deduplication guarded by component tests.
- Custom-answer field and retry error state localized in all six languages
  and enforced by the recursive parity test.

## Solution

Close in four traceable units:

1. Wire live detail events into `AiChatWorkspaceTranscript` (prop from the
   selected-conversation store) and add the persisted+live evolving-row
   component test (FR-042).
2. Add the overflow discard/reject action to `AiChatPlanDecisionCard` with
   six-language keys and a hierarchy assertion test (FR-056).
3. Add the full-restart integration scenario (design §28.7 sixth case).
4. Produce the remaining verification evidence: §34.3 shell a11y/i18n
   suites, the seven missing §34.4 E2E scenarios, packaged-app §34.5
   performance/soak records, the §30 compatibility matrix, and finally the
   §33 64-row FR matrix with delivery-checklist update.

Do not enable the redesign by default or retire the classic UI until all
four units pass.
