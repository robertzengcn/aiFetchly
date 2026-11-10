---
created: 2026-08-25T23:39:36.724Z
title: Close AI chat workspace PRD gaps
area: ui
files:
  - docs/prd/ai-chat-workspace-ui-redesign-prd.md:1267
  - docs/prd/ai-chat-workspace-ui-redesign-technical-design.md:1776
  - docs/prd/ai-chat-workspace-ui-redesign-implementation-plan.md:178
  - src/views/components/aiChatWorkspace/AiChatWorkspaceShell.vue:99
  - src/views/components/aiChatWorkspace/AiChatPlanQuestionFlow.vue:28
  - src/views/components/aiChatWorkspace/planPresentationProjection.ts:171
  - src/views/components/aiChatV2/AiChatV2Messages.vue:12
  - src/views/components/aiChatV2/AiChatV2Message.vue:3
  - src/views/components/aiChatV2/AiChatV2PlanApprovalCard.vue:18
  - src/views/lang/en.ts:3130
  - src/views/lang/zh.ts:3007
  - src/views/lang/es.ts:3158
  - src/views/lang/fr.ts:3146
  - src/views/lang/de.ts:3155
  - src/views/lang/ja.ts:3098
  - test/e2e/workspace-shell.spec.ts:10
---

## Problem

The AI Chat Workspace UI Redesign is substantially implemented, but it does
not yet satisfy the PRD and technical-design definition of done. The audit on
2026-08-26 found both confirmed UI contract violations and required validation
that has not been performed. The redesign must not be declared complete or
made the default until every item below has implementation evidence and a
passing traceable test.

### Confirmed incomplete requirements

| Requirement | Status | Reason | Completion evidence required |
| --- | --- | --- | --- |
| FR-040 | Incomplete | `workspaceChat.header.export`, `workspaceChat.header.duplicate`, and `workspaceChat.header.deleteConfirm` exist in Spanish and German but are missing from the English, Chinese, French, and Japanese `workspaceChat` namespaces. The UI therefore falls back to English literals in four locales. | Add the three keys to all missing locale files and add a recursive `workspaceChat` key-parity/non-empty-value test for all six languages. |
| FR-042 | Incomplete | The redesigned transcript passes persisted messages directly to `AiChatV2Messages`, which renders tool calls and results as separate messages. The evolving execution-row projection is used only in Activity. | Render a paired call/result as one evolving row in the selected conversation and cover persisted plus live-event updates. |
| FR-043 | Incomplete | `AiChatV2Message.vue` still displays generic `Tool Call` and `Tool Result` cards whenever the records can be paired. | Remove generic paired cards from the redesigned transcript and add a component/E2E assertion that only one row exists per stable `toolCallId`. |
| FR-044 | Incomplete | Related executions are grouped in `AiChatActivityPanel`, but not under one assistant execution summary in the conversation. | Wire `buildToolExecutionGroups()` and `AiChatExecutionGroup` into the selected transcript while preserving assistant-response order. |
| FR-045 | Incomplete | The transcript's primary labels remain generic `Tool Call`/`Tool Result`; the human-readable action-label projection is not used there. | Make the semantic action the primary transcript label and keep the raw tool name secondary. |
| FR-047 | Incomplete | Artifact and specialized result content remains nested inside a generic legacy tool-result wrapper in the transcript. | Dispatch specialized artifact, file, image, permission, and error surfaces directly without an additional generic result card. |
| FR-050 | Incomplete | The compact legacy-receipt projection exists, but unpaired legacy history in the transcript still uses the legacy generic message renderer. | Route unpairable legacy tool rows through compact standalone receipts and add reload fixtures. |
| FR-052 | Incomplete | A new latest-plan decision/receipt can be pinned above the composer while the same plan metadata is also rendered by the legacy all-purpose plan card in message history. Resolved transitions therefore do not consistently collapse to receipts. | Filter legacy plan cards from the redesigned transcript and render only lifecycle-specific summaries, decisions, and receipts. |
| FR-055 | Incomplete | The reused `AiChatV2PlanApprovalCard` renders the complete plan inside a `max-height: 400px; overflow-y: auto` nested transcript scroller. | Keep the conversation card concise and move the complete structured plan exclusively to Activity. |
| FR-056 | Incomplete | The legacy plan card places Approve, Reject, and Request Changes together as prominent actions; rejection is not relegated to an infrequent overflow action. | Use the new decision hierarchy exclusively: Approve primary, Request Changes secondary, discard/reject in overflow. |
| FR-057 | Incomplete | `draftToggleOption()` always accumulates option indexes. A question marked single-select can therefore visually select multiple options even though submission keeps only the first. The component also has no editable custom-answer field despite carrying `customTextByIndex`. | Make selection mode explicit in the reducer/component, enforce one selected option for single-select questions, support custom text where allowed, and test Back/Continue/review semantics. |
| FR-059 | Partial | Question submission failures are only logged by the parent. `AiChatPlanQuestionFlow` declares `submitError`, but the failure is never sent back to that surface, so the promised retry feedback is not shown. | Propagate persistence failure/success to the flow, retain the draft until success, show a localized retry state, and verify the durable submitted-answer receipt. |
| FR-062 | Incomplete | Plan state can appear simultaneously in the legacy transcript plan card, the new pinned decision/receipt, the run strip, and Activity. | Establish one status owner per level and add a component test proving no duplicate plan status/action surfaces. |

### Required verification and rollout gaps

These items may contain working code, but the PRD explicitly requires passing
verification before completion. They remain open until that evidence exists.

| Contract | Status | Reason | Completion evidence required |
| --- | --- | --- | --- |
| PRD section 34.3 and FR-038–041/FR-064 | Unverified | There is no dedicated component suite covering the new sidebar, header, inspector, run strip, execution groups, plan surfaces, focus behavior, long translations, reduced motion, and non-color state cues. | Add the component/accessibility/localization tests listed in PRD section 34.3 and make them part of the standard test command. |
| PRD section 34.4 / acceptance criteria 3–6, 12–18, 23–30 | Unverified | The Playwright file describes itself as a runnable subset. It contains seven local shell tests and two live-provider tests guarded by `AIFETCHLY_E2E_LIVE_AI`; most of the sixteen required E2E scenarios are absent. | Implement and run all sixteen scenarios, including background unread completion, bounded queueing, permission resume, selected/inactive artifacts, restart reconciliation, scheduled-loop controls, keyboard-only use, tool grouping, and the complete plan lifecycle. |
| PRD sections 27 and 34.5 / acceptance criteria 19–20 | Unverified | Current microbenchmarks guard algorithms, but the implementation plan explicitly defers full performance fixtures. There is no packaged-app evidence for p95 selection/history targets, renderer count, DOM count, heap growth, repeated switching, or artifact-preview resource release. | Run representative legacy-database measurements and the required 500-switch/artifact soak tests; record p95, renderer, DOM, and heap results against the documented budgets. |
| Technical design section 28.7 | Unverified | Cross-layer integration is covered by focused unit tests, not the complete coordinator/router/scheduler/renderer flows required by the design. | Add integration tests for three active runs plus a queued fourth, same-conversation serialization, reload/resubscription, full restart, stale terminal events, and worker failure. |
| Technical design section 30 compatibility checklist | Unverified | No signed-off traceability demonstrates a tested destination for every legacy capability, including goal, scheduled loop, recovery, spoken response, workspace memory/trust, agent tasks, notifications, and all plan/tool actions. | Create a capability-to-destination test matrix and verify every row before retiring the classic UI. |
| Technical design section 33 definition of done | Blocked | The definition requires passing traceable verification for all 64 FRs, representative performance budgets, accessibility/localization validation, and complete compatibility coverage. The items above prevent that gate from passing. | Produce a final 64-row requirements matrix linking each FR to implementation and a passing automated/manual verification result. |

### Existing positive evidence

The audit should preserve the completed foundation rather than rebuild it:

- Conversation/run projections, coordinator, scheduler, event router, summary
  privacy, history pagination, stream batching, shell structure, inspector,
  artifact sandboxing, and rollback flag are present.
- Focused audit runs passed 36 main-process tests and 24
  projection/performance tests.
- `vue-tsc --noEmit` completed successfully.

The implementation plan currently records full E2E/performance validation,
owner migration, and virtual-list work as explicitly deferred. Reconcile those
deferrals with the PRD acceptance criteria before marking the redesign done.

## Solution

Close the work in four traceable units:

1. Replace legacy transcript tool and plan rendering with the existing
   workspace execution/plan projections, then add component tests for every
   affected FR.
2. Correct the plan-question selection and retry contract and complete
   `workspaceChat` localization parity across all six languages.
3. Implement the missing E2E, accessibility, compatibility, and packaged-app
   performance/soak verification.
4. Publish a 64-row FR traceability matrix and update the PRD delivery
   checklist only after each row has passing evidence.

Do not make the redesign the default or retire the classic UI until all four
units pass and the technical-design definition of done is satisfied.
