# Generator Streaming — P0 Caller Inventory

| Field | Value |
| --- | --- |
| Date | 2026-09-26 |
| Baseline | `fd5f43c8` (branch `dev`) |
| Purpose | PRD §10 P0 exit gate: every current event family, segment outcome, and caller has a test owner |
| PRD | [Generator streaming PRD](./ai-chat-workspace-generator-streaming-prd.md) |
| Technical design | [Generator streaming technical design](./ai-chat-workspace-generator-streaming-technical-design.md) |

## 1. Consumers of the execution engine

| Caller | File | Entry point | Owns | Notes |
| --- | --- | --- | --- | --- |
| Workspace coordinator | `src/service/AIChatCoordinator.ts` (wired in `src/main-process/communication/ai-chat-workspace-ipc.ts:80-170`) | `engine.submitMessage` via `executeDispatch` (`:379-383`), `stopActiveTurn`, `getConversationRuntimeStatus` | **Run** (scheduler, lease, run rows, adapter, terminal routing) | Today swallows the segment outcome and infers status from chunks + sampled engine status (removed in A1/A2) |
| Durable message queue | `src/service/AIChatTurnQueueService.ts` (`drainConversation :510-667`, engine slice `:31-58`; wired in `ai-chat-v2-ipc.ts:389-412`) | `engine.submitPersistedUserMessage` | **Policy** (FIFO/steering/hold) — NOT execution ownership today | Drained turns stream through `createBroadcastEventSink` with synthetic runId `pending-queue-N` (removed in A3) |
| Scheduled runner | `src/service/ScheduledAiMessageRunner.ts` (`:312-343`, `:632`) via `AIChatQueryEngineFactory.createScheduled` | `engine.submitMessage({scheduledContext})` with `createOwnerAdapterSink` | **Run** (durable run envelope for scheduled owner) | Separate engine instance per scheduled execution |
| Subagents | `src/service/AgentRuntime.ts` (`:335-340`) | constructs `AIChatQueryLoop` directly with own deps + sink | **Segment** | Events are NOT forwarded to the parent turn (parent observes tool results) |
| Legacy V2 send | `ai-chat-v2-ipc.ts` `handleStream` (`:940-996`, channel `AI_CHAT_V2_STREAM`) | `engine.submitMessage` | none (engine-owned) | Retiring screen still routed; stays on the `submitMessage` wrapper (FR-013) |
| Permission resume | `ai-chat-v2-ipc.ts` `handleResumeToolAfterPermission` (`:1034-1069`) | `engine.resumeToolAfterPermission` | none today | Fire-and-forget continuation outside scheduler/lease (fixed in A3) |
| Plan-answer resume | `ai-chat-v2-ipc.ts` `handleAnswerQuestion` (`:1346-1377`) | `engine.answerPlanQuestion` | none today | Same fire-and-forget shape (fixed in A3) |

`ChatRunOwner` = `interactive | scheduled | goal | agent` (`src/entityTypes/aiChatWorkspaceTypes.ts:16`). No goal runner calls the engine at the baseline.

## 2. Provider streaming seam consumers

`AIChatQueryLoopDeps.streamChatCompletion` is wired at exactly three sites:

1. `ai-chat-v2-ipc.ts` `createQueryLoop` (`:149-199`) → `AiChatApi.openAIChatCompletionStream` (hosted + local resolution).
2. `AIChatQueryEngineFactory.createQueryLoop` (`:42-56`) → scheduled engines.
3. `AgentRuntime.ts` (`:335-340`) → subagent loops (retry base delay 0).

## 3. Event families and their test owners

All event types flow through `AIChatQueryEventSink` → `createPersistingEventSink` (persists `tool_call`/`tool_result` only) → owner sink → (`aiChatV2StreamSink` mapping) → router/presenter.

| Event family | Producer | Existing test owner |
| --- | --- | --- |
| `start`, `token`, `reasoning_delta`, `usage_update` | loop stream accumulation | `AIChatQueryLoop.test.ts` |
| `retry_connect`, `recovery_status` | loop transient retry + recovery layers | `AIChatQueryLoop.test.ts` |
| `tool_call`, `tool_progress`, `tool_result` | loop tool execution paths | `AIChatQueryLoop.test.ts`, `AIChatQueryLoopAsyncPermission.test.ts` |
| `plan_*`, `ask_user_question`, `direction_updated` | loop plan/steering | `AIChatQueryLoop.test.ts` |
| `complete`, `cancelled`, `error` | engine `handleLoopResult` (after persistence) | `AIChatQueryEngine.test.ts` |
| Terminal outcome union (`AIChatTurnTerminalEvent`) | engine `runPersistedTurn` mapping | **`AIChatQueryEngine.runTurn.test.ts`** (new, this change) |
| Coordinator status transitions | `AIChatCoordinator` | `aiChatWorkspaceCoordinator.test.ts` |
| Queue drain/hold outcomes | queue service | `AIChatTurnQueueService.test.ts` |
| Scheduled owner envelope | owner adapter | `aiChatRunOwnerAdapter.test.ts`, `ScheduledAiMessageRunner.chatLoop.test.ts` |
| Presenter batching/dedup | renderer | `workspaceStreamPresenter.test.ts`, `AiChatWorkspaceTranscript.test.ts` |

## 4. Pause/resume ownership analysis (baseline)

- A paused run's pending structure (`PendingPermissionTurn` / `PendingPlanQuestionTurn`, `AIChatQueryEvents.ts:340/:380`) carries the ORIGINAL owner's wrapped sink in a closure plus the shared `AbortController`. Sequence continuity across resume exists only because of that closure.
- The coordinator releases lease + scheduler capacity when a run parks (`executeDispatch` finally, `:467-471`); the resumed continuation later re-enters through `resumeToolAfterPermission`'s fire-and-forget `void this.loop.run(...)` (`AIChatQueryEngine.ts:1941-1959`) — outside the coordinator's scheduler and lease — and its terminal is settled by `settleDetachedTerminal` (`AIChatCoordinator.ts:512-552`).
- Queue-drained turns that pause settle through the same broadcast-sink closure; the queue sees the paused outcome via the returned `AIChatTurnTerminalEvent` and holds.

## 5. P0 open questions — resolutions

| Question | Resolution |
| --- | --- |
| Hosted retry conversion size (PRD §13) | Retry/endpoint-fallback lives inside `openAIChatCompletionStreamHosted` (`aiChatApi.ts:2259+`, ~300 lines). B1 converts it once; callback API becomes the facade. No second retry implementation. |
| Is the legacy V2 send handler reachable from supported UI? | Yes — `AiChatV2.vue` is still routed. `handleStream` stays alive behind the deprecated `submitMessage` wrapper; engine-internal resume remains for non-coordinator-owned turns. |
| Are subagent events forwarded to the parent turn? | No. `AgentRuntime` owns its sink; the parent observes tool results only. Subagents keep the `run()` facade contract; no owner routing. |
| Scheduler tier for resumed segments | `owner:"interactive"` submission → `SelectedInteractive` when the conversation is selected, `OtherInteractive` otherwise (same as direct sends; `AIChatExecutionScheduler.ts:16-22`). |

## 6. Stage A traceability

Filled at the Stage A gate (`docs/prd/generator-streaming-operations.md`).

## 7. Requirement conflict decisions (TODO-15, recorded 2026-10-07)

### FR-026 / AC-19 — same-conversation supersede vs busy-queue policy

**Decision: the busy-queue policy wins; AC-19's re-send-supersedes is NOT implemented as specified.**
Evidence: `AIChatQueryEngine.runPersistedTurn()` rejects a busy conversation with
`conversation_busy` (never replaces), and the coordinator routes busy sends into the durable
queue (message-queue PRD §9.2). The loop's `isActiveTurn()` filter suppresses stale chunks from
an aborted turn but does not itself abort a provider request on ownership loss — the request
owner (Stop / scheduler) drives aborts today. Implementing literal supersession would replace
the queue's FIFO/steering contract. **Affected IDs: FR-026, AC-19.** If product later wants
supersession, it must be a product decision revising the queue contract, and losing ownership
must abort the provider request and close the iterator — not merely suppress token callbacks.

### FR-014 / AC-12 — "AI disabled" wording vs local-provider eligibility

**Decision: keep provider-aware gating; do NOT add a literal universal `USER_AI_ENABLED` gate.**
Evidence: `canUseChat()` (`ai-chat-v2-ipc.ts`) delegates to `AIProviderResolver`, which
intentionally allows a configured local provider when hosted AI is disabled — a supported
product capability (offline/local AI). All modified AI IPC handlers (START_RUN, resume,
answer-question, pending handlers via `registerChatValidatedHandler`) gate before parsing or
provider work. **Affected IDs: FR-014, AC-12.** Tests cover hosted-disabled separately from
local-enabled; adding the literal Token gate would break supported local AI.

## 8. Workspace V2 import inventory (TODO-15)

Shared V2 code the workspace depends on (verified by import scan; deletion of any of these
breaks the supported UI — preservation tests cover the transcribed components):

| Category | Imports | Used by (workspace) |
| --- | --- | --- |
| Components | `AiChatV2Composer.vue`, `AiChatV2ModeSelector.vue`, `AiChatV2ModelSelector.vue`, `AiChatV2ToolApprovalModeSelector.vue`, `AiChatV2ContextBadge.vue`, `AiChatVoiceOutputToggle.vue`, `AiChatVoiceRuntimeInstallDialog.vue`, `WorkspaceBadge.vue`, `WorkspaceRequiredCard.vue`, `WorkspaceTrustCard.vue`, `WorkspaceMemoryPanel.vue`, `AiChatV2Message.vue`, `AiChatV2PendingMessage.vue` | `AiChatCenterSurface.vue`, `AiChatWorkspaceTranscript.vue` |
| Utilities | `contextUsageUtil` | `AiChatContextPanel.vue` |
| Types | `ChatV2MessageView` + `aiChatV2Types` (many) | `AiChatOutboundBatchReviewCard.vue`, `AiChatInspector.vue`, `AiChatActivityPanel.vue`, `toolExecutionProjection.ts`, `planPresentationProjection.ts`, and others |
| IPC handlers | `ai-chat-v2-ipc.ts` (`getQueryEngine`, `getQueueService`, `canUseChat`, history helpers) | `ai-chat-workspace-ipc.ts` |
| APIs | V2 stream/pending/resume channels (the workspace's resume/answer route through the V2 handler by design §14) | workspace center surface |

No V2-named file may be deleted or moved without updating these imports and running
`yarn test:components` + the transcript component tests.
