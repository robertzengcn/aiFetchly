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

## Gap-closure pass (2026-08-21) — FR coverage completed

After the initial slice, a PRD audit found 14 partial and 5 missing FRs; all
functional gaps are now closed (commits c83b640f..57ca507e):

- **FR-036**: bootstrap reconciles non-terminal runs to `interrupted` before
  reporting runtime state (design §19.4); tested.
- **PRD §33 flag**: `USER_AI_CHAT_WORKSPACE_REDESIGN` (default off) with
  get/set IPC; the classic dock stays the default, the workspace footer
  carries a durable mode toggle with rollback, and layout reroutes chat /
  dashboard-ask entries to `/aiworkspace` when enabled.
- **FR-010**: overflow is complete — rename, export (JSON transcript
  download), duplicate (durable copy + select), compact, clear, and confirmed
  destructive delete (messages + artifacts + memory + binding + projection).
- **FR-012**: composer controls — mode/model/tool-approval selectors with the
  context-usage badge that opens Context; selections forwarded on send.
- **FR-013/FR-061**: goal state from `goal_*` events, scheduled-loop
  running/paused from durable state, and recovery — all rendered in the run
  strip (single stop: goal → loop → run) and Activity (loop
  pause/resume/stop controls).
- **FR-026/FR-030**: `openImmediately` artifacts preserve metadata and
  auto-open the Artifacts inspector for the selected conversation; artifact
  cards reopen persisted artifacts.
- **FR-005/FR-006**: pointer-drag + keyboard inspector resize on wide
  screens; measured wide/medium/narrow modes render the inspector as an
  overlay and the sidebar as a separate overlay surface with backdrop.
- **FR-038**: tree/treeitem roving keyboard model (arrows navigate and
  expand/collapse; Enter selects).
- **FR-046/FR-054/FR-059**: Activity execution rows expose expandable safe
  Details; the plan view renders every persisted version with selector,
  per-version change reason/author, submitted clarification answers, and the
  decision timeline.
- **FR-022 + §32 voice**: composer voice events route to the AI-provider
  voice settings page with TTS stop; an explicit payload-privacy test proves
  summary events are field-bounded and body-free.

Verification: `yarn testmain` 425 files / 3772 tests (one unrelated
HookDispatcher timing flake that passes in isolation), workspace test set
61/61, tsc + vue-tsc clean on every commit.

## Completion pass (2026-08-22) — remaining engineering items closed

- **Attachment sends**: the workspace start-run path accepts bounded
  uploaded files (count/mime/size Zod caps) normalized with the exact legacy
  bounds; the shell encodes renderer `File` objects and forwards them.
- **Owner adapters (design §8.3)**: `AIChatRunOwnerAdapter` wraps an owner
  subsystem's sink unchanged while keeping the shared run envelope durable
  (persist-before-broadcast); the scheduled runner routes through it with
  `owner=scheduled` + schedule sourceId so background loops appear in the
  sidebar. Goal runs already surface via `goal_*` events + durable goal
  tables; no production MakerTurnExecutor binding exists to wrap yet.
  Six pre-existing dead-code lint errors in the runner were removed.
- **Performance fixtures (§34.5)**: runnable guards with regression
  ceilings — 10k-token batching, 5k-tool-pair grouping, 1,000-run scheduler
  churn, anti-starvation aging at 500-queue scale, 100-workspace/
  1,000-conversation sidebar projection, and a 1,000-message cursor walk
  with no gap/overlap/drift under concurrent inserts.
- **E2E (§34.4)**: `test/e2e/workspace-shell.spec.ts` + Playwright config +
  `yarn e2e:workspace` covering the runnable subset (three regions, header
  rules, exact overflow contents, new chat, inspector tabs, §33 toggle,
  narrow-viewport overlay) with live-AI scenarios guarded behind
  `AIFETCHLY_E2E_LIVE_AI=1`.

Verification: `yarn testmain` 427 files / 3,777 tests all passing; workspace
utilityCode set 57/57; tsc + vue-tsc clean on every commit (23 commits).

## Explicitly deferred (per PRD phased rollout)

- Full E2E suite + performance fixtures (PRD §34.4–34.5) — validation phase.
- Moving scheduled-loop/goal/agent execution behind the scheduler as owner
  adapters (envelopes + reconciliation exist; owner migration is a later
  phase — legacy paths keep working unchanged).
- Virtual-list replacement for the bounded message window (design §12.2).
