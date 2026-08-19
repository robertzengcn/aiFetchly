# AI Chat Workspace UI Redesign — Implementation Plan

- **Version**: 1.0
- **Created**: 2026-08-19
- **Source**: [`ai-chat-workspace-ui-redesign-prd.md`](./ai-chat-workspace-ui-redesign-prd.md) · [`ai-chat-workspace-ui-redesign-technical-design.md`](./ai-chat-workspace-ui-redesign-technical-design.md)
- **Status**: In execution

## Deliverable

A feature-flagged vertical slice through technical-design Phases 0–7: durable
run/conversation projections, main-process execution ownership (coordinator +
bounded scheduler + event router), new workspace IPC contracts, the three-region
workspace shell (sidebar / selected conversation / inspector), cohesive tool
execution groups, lifecycle-specific plan presentation, and six-language i18n.
The legacy AiChatV2 dock remains fully functional with the flag off
(PRD §33 rollback).

**Flag**: `USER_AI_CHAT_WORKSPACE_REDESIGN` (Token setting, default `false`).
When enabled: the app-nav gains a Chat Workspace entry rendering the new shell
and the legacy dock is hidden on non-workspace routes.

## Stages (each committed separately)

### Stage 1 — Shared contracts + durable foundation
- `src/entityTypes/aiChatWorkspaceTypes.ts` — `ChatRunStatus`, `ChatRunOwner`,
  `WorkspaceConversationSummary`, `ConversationSummaryEvent`,
  `ChatRunDetailEvent`, `StartChatRunRequest/Response`, `ChatHistoryPage*`,
  `WorkspaceSidebarResponse` (PRD §16, design §8/§11).
- Entities: `AIChatConversation.entity.ts` (sidebar projection incl. unread
  markers), `AIChatRun.entity.ts` (run envelope + revision), extend
  `Workspace.entity.ts` (`workspaceKey`, `canonicalRootPath`) and
  `AIChatMessage.entity.ts` (nullable `runId`); register in `SqliteDb.ts`.
- Models: `AIChatConversation.model.ts` (upsert, cursor pages, monotonic
  `markRead`, rename), `AIChatRun.model.ts` (compare-and-set transitions,
  non-terminal queries).
- Modules: `AIChatConversationModule.ts` (effective summary projection §8.6,
  idempotent backfill §26.2, workspace-key backfill §26.3),
  `AIChatRunModule.ts` (transition rules §9.1, startup reconciliation §19.4).
- Tests: projection insert/update/repair, CAS transitions, unread monotonicity.

### Stage 2 — Runtime services (main process)
- `src/service/AIChatEventRouter.ts` — per-webContents selected-conversation
  map + generation counter; detailed events only to the matching selection;
  redacted summary events to all live windows; destroyed-webContents cleanup
  (design §7.5, §18).
- `src/service/AIChatExecutionScheduler.ts` — resource-class queues (general
  default 3, clamp 1–3), weighted aging fairness, queued/running cancellation,
  per-conversation eligibility via `AIChatConversationTurnCoordinator`
  (design §10).
- Tests: routing by generation, bounded concurrency, starvation aging,
  cancellation idempotence, same-conversation serialization.

### Stage 3 — Coordinator + workspace IPC
- `src/schemas/ipc/aiChatWorkspace.ts` (Zod v4) for every new channel.
- `src/service/AIChatRunEventAdapter.ts` — engine-event → run envelope:
  sequence numbering, status observation (awaiting_permission /
  awaiting_user / terminal fence).
- `src/service/AIChatCoordinator.ts` — AI-gate first, validate, persist run
  envelope (queued) → scheduler dispatch → engine execution with a run-owned
  router sink → durable terminal transition **before** summary broadcast;
  idempotent cancel; duplicate `clientRequestId` dedupe.
- `src/main-process/communication/ai-chat-workspace-ipc.ts` —
  `ai-chat-workspace:{bootstrap,select,unsubscribe-detail,start-run,
  cancel-run,history-page,mark-read,rename,activity}` + main→renderer
  `{summary-event,detail-event}` channels; registered in `background.ts`.
- Channels added to `channellist.ts` + `preload.ts` invoke/listener whitelist.
- The legacy `ai-chat-v2:*` stream path is refactored so its sink factory
  targets an abstract sender (no behavior change), enabling coordinator reuse.
- Tests: coordinator lifecycle, gate ordering, IPC schema rejection.

### Stage 4 — Renderer foundation
- `src/views/api/aiChatWorkspace.ts` — typed invoke bridge + subscribe/unsub.
- `src/views/store/chatWorkspace.ts` (Pinia) — workspace groups, summaries,
  selection generation, inspector state; applies summary events.
- `src/views/store/selectedConversation.ts` — bounded message window (200),
  runtime snapshot, detail-event application, 50 ms delta batching with
  terminal flush (design §12–§13).

### Stage 5 — Workspace shell UI
- Route `/aiworkspace` (`AI_Chat_Workspace`, aiNavigable) →
  `AiChatWorkspaceShell.vue` composing:
  - `AiChatWorkspaceSidebar.vue` (global nav + workspace/conversation tree,
    state indicators per PRD §10.3, unread, keyboard nav, search)
  - Center: `AiChatConversationHeader.vue` (title, ONE summarized status via
    precedence §15.4, inspector toggle, overflow menu), reused
    `AiChatV2Messages`/`AiChatV2Composer`, new `AiChatRunStrip.vue`
  - `AiChatInspector.vue` — Artifacts / Activity / Context tabs; artifacts
    reuse the single sandboxed `AiArtifactWorkspace` iframe preview.
- `layout.vue`: flag on → hide legacy dock + add workspace nav entry.

### Stage 6 — Tool execution + plan presentation
- `toolExecutionProjection.ts` — pure reducer pairing TOOL_CALL/TOOL_RESULT by
  `toolCallId`, grouping per assistant response, legacy unpaired receipts,
  live-event overlay (FR-042..050).
- `AiChatExecutionGroup/Row/SemanticToolResult.vue` + localized action-label
  registry.
- `planPresentationProjection.ts` + `AiChatPlanDecisionCard.vue`,
  `AiChatPlanQuestionFlow.vue` (one-question-at-a-time + review),
  `AiChatPlanReceipt.vue`, `AiChatPlanActivityView.vue`,
  `SafePlanMarkdown.vue` (token-tree rendering, HTML disabled) (FR-051..064).
- Tests: pairing/order/collapse policy, semantic classification, surface
  selection precedence, markdown safety.

### Stage 7 — Internationalization
All new keys in `en/zh/es/fr/de/ja` (sidebar states, header statuses, run
strip, inspector, execution labels, plan lifecycle, empty/error states).

### Stage 8 — Verification
`yarn tsc` (one-shot), `yarn vue-check` (one-shot), vitest
main/utilityCode/components suites; fix all regressions.

## Explicitly deferred (per PRD phased rollout)

- Full E2E suite + performance fixtures (PRD §34.4–34.5) — validation phase.
- Moving scheduled-loop/goal/agent execution behind the scheduler as owner
  adapters (envelopes + reconciliation exist; owner migration is a later
  phase — legacy paths keep working unchanged).
- Virtual-list replacement for the bounded message window (design §12.2).
