---
created: 2026-08-26T12:00:00.000Z
title: AI chat workspace PRD remaining gaps after 2026-08-26 audit
area: ui
files:
  - docs/prd/ai-chat-workspace-ui-redesign-prd.md
  - docs/prd/ai-chat-workspace-ui-redesign-technical-design.md
  - docs/prd/ai-chat-workspace-ui-redesign-implementation-plan.md
  - src/views/components/aiChatWorkspace/AiChatWorkspaceShell.vue
  - src/views/components/aiChatWorkspace/AiChatWorkspaceTranscript.vue
  - src/views/components/aiChatWorkspace/AiChatExecutionRow.vue
  - src/views/components/aiChatWorkspace/AiChatExecutionGroup.vue
  - src/views/components/aiChatWorkspace/SemanticToolResult.vue
  - src/views/components/aiChatWorkspace/toolExecutionProjection.ts
  - src/views/components/aiChatWorkspace/planPresentationProjection.ts
  - src/views/components/aiChatWorkspace/AiChatPlanQuestionFlow.vue
  - src/views/components/aiChatWorkspace/AiChatPlanDecisionCard.vue
  - src/views/components/aiChatV2/AiChatV2Message.vue
  - src/views/components/aiChatV2/AiChatV2PlanApprovalCard.vue
  - src/views/lang/en.ts
  - src/views/lang/zh.ts
  - src/views/lang/es.ts
  - src/views/lang/fr.ts
  - src/views/lang/de.ts
  - src/views/lang/ja.ts
  - test/vitest/utilitycode/workspaceProjections.test.ts
  - test/e2e/workspace-shell.spec.ts
---

## Problem

Post `a573def6` gap-closure, the 2026-08-25 pending todo (`2026-08-25-close-ai-chat-workspace-prd-gaps.md`) still blocks PRD section 33 Definition of Done. Locale keys were added, the workspace shell now uses `AiChatWorkspaceTranscript` + `buildToolExecutionGroups`/`selectPlanPresentation`, and `draftToggleOption` enforces single-select. However several confirmed FR code gaps remain and **all** verification items (PRD 34.3/34.4/34.5, design 28.7/30/33) still lack passing traceable tests/evidence. The redesign must not be made default until each row below has implementation + passing automated/manual verification.

### Confirmed incomplete requirements (code)

| Requirement | Status | Reason | Completion evidence required |
| --- | --- | --- | --- |
| FR-040 | Partial | `workspaceChat.header.export/duplicate/deleteConfirm` now present in all 6 locales (fixed in `src/views/lang/en.ts:3084`, `zh.ts:2961`, `fr.ts:3100`, `ja.ts:3052`), but no recursive `workspaceChat` key-parity / non-empty-value test exists for en/zh/es/fr/de/ja. Auditors cannot prove fallback will not regress. | Add parity test covering all `workspaceChat.*` namespaces across 6 languages and make it part of standard test command. |
| FR-042 | Partial | `AiChatWorkspaceTranscript.vue:121` projects via `buildToolExecutionGroups(messages)` but never passes `liveEvents`; live detail-event overlay (`toolExecutionProjection.ts:250` `liveEvents` param) is exercised only in `workspaceProjections.test.ts:161` unit test, not in the selected conversation transcript. Reload+persisted path works, live streaming evolving row is unproven in component/E2E. | Pass `selectedStore.detailEvents` (or router live events) into transcript, add component test that pairs persisted call + live `tool_progress`/`tool_result` into one evolving row. |
| FR-043 | Partial | Transcript correctly yields one row per `toolCallId` (`toolExecutionProjection.ts:148` `byCallId`), but no component/E2E assertion proves only one DOM row per stable `toolCallId` and that generic `Tool Call`/`Tool Result` cards are absent from the redesigned transcript. `AiChatV2Message.vue:20,61` still contains generics (used by classic dock). | Add transcript component test: given paired call/result, assert single `workspace-execution-row-*` and zero generic `Tool Call`/`Tool Result` cards. |
| FR-044 | Partial | `AiChatWorkspaceTranscript.vue:29` + `AiChatExecutionGroup.vue:6` + `AiChatExecutionRow.vue:1` are wired and order is unit-tested (`workspaceProjections.test.ts:192`), but no transcript-level test proves groups preserve assistant-response order while rendering. | Add transcript rendering test for multi-call order preservation. |
| FR-047 | Incomplete | `SemanticToolResult.vue:2` dispatches `artifact/images/error/summary/files/permission/structured`, but `toolExecutionProjection.ts:85 classifyOutput()` only detects `artifact/error/images/summary/structured`. `files` (file-change summary) and `permission` (SkillApprovalCard) never classified, falling back to generic `summary`. No test for file/image/permission/error dispatch without extra generic wrapper. | Extend `classifyOutput` to detect `files` and permission prompts, wire `SemanticToolResult` without generic `AiChatV2Message` wrapper, add classification tests for all 6 kinds. |
| FR-050 | Partial | Legacy unpaired rows now route to `legacy-receipt` (`AiChatWorkspaceTranscript.vue:35`, `toolExecutionProjection.ts:140`) and unit-tested (`workspaceProjections.test.ts:70`). No reload fixture loading persisted legacy history (call without id / result without id) through transcript and asserting compact receipts. | Add reload fixture (legacy DB history) + transcript test. |
| FR-052 | Incomplete | `AiChatWorkspaceTranscript.vue:202` loops over every message with `planStateView`/`planEventType` and calls `selectPlanPresentation(messages)` per occurrence, so 2 plan-bearing messages produce 2 identical `plan-decision` cards. Latest-only filter not enforced in render loop. | Render exactly one lifecycle-specific surface for the latest plan (deduplicate loop), add component test that 2 plan messages yield 1 card + that deprecated `AiChatV2PlanApprovalCard` is absent from transcript. |
| FR-056 | Incomplete | `AiChatPlanDecisionCard.vue:28-53` uses Approve primary + Request Changes secondary + Review full plan, but no overflow discard/reject per PRD 12.7/12.8 requirement (discard in overflow). `AiChatV2PlanApprovalCard.vue:30-63` still exposes equally prominent Reject alongside Approve. Requirement demands exclusively the new hierarchy. | Remove/relegate legacy plan card from workspace path, add overflow discard menu to `AiChatPlanDecisionCard` (with i18n), test exclusive hierarchy. |
| FR-057 | Incomplete | `planPresentationProjection.ts:171 draftToggleOption(draft, idx, multiSelect)` now enforces single-select replace (fixed), and `AiChatPlanQuestionFlow.vue:161` passes `multiSelect`. However `AiChatPlanQuestionFlow.vue:28-49` has no editable custom-answer field despite `customTextByIndex` state and PRD 12.8 customText support; `planPresentationProjection.ts:144` retains `customTextByIndex` but unused in UI. | Add custom-text input where question allows it, bind to `customTextByIndex`, extend reducer + component tests for single-select enforcement, custom text round-trip, Back/Continue/review semantics. |
| FR-059 | Incomplete | `AiChatPlanQuestionFlow.vue:107 submitError` exists but is never set from IPC failure; `AiChatWorkspaceShell.vue:573-590 onAnswerQuestion` only `console.warn` on `answerChatV2Question` failure and silently swallows exception. No prop/event to surface `submitError` to the flow, no localized retry state, no durable submitted-answer receipt verification. | Propagate persistence failure to flow via prop/event, retain draft until success, show localized `workspaceChat.plan.submitError` + retry action, keep success receipt from durable history, add test. |
| FR-062 | Incomplete | Two plan-status owners exist simultaneously: `AiChatWorkspaceShell.vue:156-173` pinned `pinnedQuestion/pinnedApproval/planReceipt` above composer **and** `AiChatWorkspaceTranscript.vue:41-52` inline `plan-decision/plan-receipt/plan-question`. This duplicates status/action surfaces, violating "one status owner per level". No test proving no duplicate. | Establish single owner (keep dock or transcript, remove duplicate), add component test asserting exactly one plan-status/action surface at a time across transcript + dock + run strip + Activity. |

### Required verification and rollout gaps

| Contract | Status | Reason | Completion evidence required |
| --- | --- | --- | --- |
| PRD 34.3 and FR-038-041 / FR-064 | Unverified | No dedicated component/accessibility/localization suite for new sidebar, header, inspector, run strip, execution groups, plan surfaces, focus behavior, long translations, reduced motion, non-color state cues. `workspaceProjections.test.ts:1` covers only projection pure functions. | Add component + a11y + i18n suites per PRD 34.3 and include in `yarn testmain`. |
| PRD 34.4 / AC 3-6, 12-18, 23-30 | Unverified | `test/e2e/workspace-shell.spec.ts:1` is a 7-test shell subset + 2 live-provider tests guarded by `AIFETCHLY_E2E_LIVE_AI` (`workspace-shell.spec.ts:22,135`). Required 16 E2E scenarios (background unread completion, bounded queueing, permission resume, selected/inactive artifacts, restart reconciliation, scheduled-loop controls, keyboard-only, tool grouping, complete plan lifecycle) are absent. | Implement/run all 16 scenarios; live scenarios guarded but runnable. |
| PRD 27 & 34.5 / AC 19-20 | Unverified | `test/vitest/utilitycode/workspacePerformance.test.ts:1` contains microbenchmark ceilings only; no packaged-app p95 selection/history, renderer/DOM/heap, 500-switch soak, artifact resource-release measurements against budgets. | Run packaged-app representative legacy-DB performance + soak fixtures; record results. |
| Technical design 28.7 | Unverified | No cross-layer coordinator/router/scheduler/renderer integration tests for three active runs + queued fourth, same-conversation serialization, reload/resubscription, full restart, stale terminal events, worker failure. Unit tests exist for projections. | Add integration tests per design 28.7. |
| Technical design 30 compatibility checklist | Unverified | No traceability matrix demonstrating tested destination for every legacy capability (goal, scheduled loop, recovery, voice, workspace memory/trust, agent tasks, notifications, all plan/tool actions). | Create capability-to-destination test matrix and verify each row. |
| Technical design 33 definition of done | Blocked | Requires passing traceable verification for all 64 FRs + performance budgets + a11y/i18n + compatibility. Items above prevent gate. No 64-row FR matrix exists. | Publish 64-row FR matrix linking each FR to implementation + passing verification. |

### Existing positive evidence (preserve)

- Conversation/run projections, coordinator, scheduler, event router, summary privacy, history pagination, stream batching, shell structure, inspector, artifact sandboxing, rollback flag (`USER_AI_CHAT_WORKSPACE_REDESIGN` default off, `AiChatWorkspaceShell.vue:303`, footer toggle) remain present.
- `a573def6` correctly fixed FR-040 keys, introduced `AiChatWorkspaceTranscript.vue:1` with cohesive execution groups, semantic labels (`AiChatExecutionRow.vue:12`), concise plan decision card (`AiChatPlanDecisionCard.vue:1` without nested scroller), and single-select enforcement.
- Unit coverage: `workspaceProjections.test.ts:36` (pairing, legacy receipts, artifact/error classification, collapse policy, live overlay, order, action labels, plan surface selection) — extend rather than replace.
- `yarn testmain` and `vue-tsc --noEmit` clean on audit commit; `workspace-shell.spec.ts:51` shell E2E subset passes.

The `docs/prd/ai-chat-workspace-ui-redesign-implementation-plan.md:178-183` explicitly defers full E2E/performance, owner migration, and virtual-list work; reconcile those deferrals with PRD acceptance criteria before marking done.

## Solution

Close in traceable units (do not make redesign default or retire classic UI until all pass):

1. **Transcript live + classification + dedup**: pass `liveEvents` to transcript, extend `classifyOutput` for `files`/`permission`, deduplicate `AiChatWorkspaceTranscript.vue:202` loop to single latest plan surface, remove duplicate Shell pinned owner or transcript inline owner for FR-062, add component tests for FR-042-050/052.
2. **Plan question & retry contract**: add custom-text field bound to `customTextByIndex`, fix FR-057 tests, propagate `AiChatWorkspaceShell.vue:573` failure to `AiChatPlanQuestionFlow.vue:107 submitError` with localized retry, keep draft until success, test receipt.
3. **Decision hierarchy**: add overflow discard/reject to `AiChatPlanDecisionCard`, ensure exclusively new hierarchy (no legacy plan card in workspace transcript), i18n for new keys.
4. **FR-040 parity**: add recursive `workspaceChat` parity test for en/zh/es/fr/de/ja.
5. **Verification suites**: implement PRD 34.3 component/a11y/i18n, 34.4 full 16-scenario E2E, 27/34.5 packaged-app performance/soak, design 28.7 integration, design 30 compatibility matrix, and publish the 64-row FR traceability matrix; update PRD delivery checklist only after each row has passing evidence.
