# AI Chat Message Queue and Steering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the AI Chat V2 composer usable during active turns — messages submitted while busy are durably queued (FIFO), and an explicit **Steer** action promotes a queued text message into the active turn at a safe boundary without starting obsolete tools.

**Architecture:** Main process owns a new `ai_chat_pending_messages` SQLite table (Model/Module access only), a queue service that routes ALL ordinary sends through durable pending rows and drains them FIFO per conversation, and a steering mailbox consumed by `AIChatQueryLoop` at five safe boundaries. Renderer presents pending bubbles and sends intent over new AI-gated IPC; stream/pending lifecycle events are broadcast to all windows.

**Tech Stack:** TypeScript, Electron IPC, TypeORM + better-sqlite3, Zod v4 (`zod/v4`), Vue 3 + Vuetify, Vitest.

**Source docs:** `docs/ai-chat-message-queue-prd.md` (v2.0), `docs/ai-chat-message-queue-technical-design.md` (v1.0).

**Verified premises (differ from tech design where noted):**
- Entities register in `src/config/SqliteDb.ts` `entities: [...]` (~line 433) — there is NO `src/config/dbEntities.ts`.
- `AI_CHAT_V2_STREAM` is `ipcMain.on` + `event.sender.send` (not invoke). New pending channels use `invoke` via `registerAiValidatedHandler` (`src/main-process/communication/_shared/registerValidatedHandler.ts`).
- Stream renderer listeners attach per-send inside `streamChatV2Message` (`src/views/api/aiChatV2.ts`) — must move to mount-lifetime subscription since queue dispatch starts turns without a renderer call.
- Composer currently swaps Send→Stop while streaming (`AiChatV2Composer.vue` ~line 225) — PRD 7.1 requires both visible.
- `AIChatQueryEngine.concurrentTurns.test.ts:243` asserts same-conversation re-send ABORTS prior turn — design §12.3 replaces this with `CONVERSATION_BUSY`; test must be updated.
- 7 component tests under `test/vitest/main/components/` mock `streamChatV2Message` — must migrate to the new pending-create API.
- Windows register with broadcasters in `src/main-process/communication/index.ts:76`.

**Explicitly deferred (PRD Phase 3/4 tail):** Electron E2E specs (7), analytics counters beyond structured logs, conversation-summary queue-count badge, terminal-row pruning >30 days, attachment steering. Unit/component/i18n coverage for Phases 0–2 IS in scope.

---

## File Structure

### New files

| File | Responsibility |
| --- | --- |
| `src/entity/AIChatPendingMessage.entity.ts` | Pending-message table mapping |
| `src/model/AIChatPendingMessage.model.ts` | Atomic conditional claims + transcript promotion transactions |
| `src/modules/AIChatPendingMessageModule.ts` | Validation, limits, views, cleanup |
| `src/service/AIChatPendingMessagePreparationService.ts` | Send-time attachment/paste/mention preparation (extracted from engine) |
| `src/service/AIChatTurnQueueService.ts` | Submission routing, FIFO drain, hold/resume, recovery |
| `src/service/AIChatTurnControl.ts` | Per-turn two-phase steering mailbox |
| `src/service/AIChatV2EventBroadcaster.ts` | Window-safe pending + interactive stream broadcasts |
| `src/schemas/ipc/aiChatPendingMessage.ts` | Strict Zod request schemas |
| `src/views/components/aiChatV2/AiChatV2PendingMessage.vue` | Pending bubble: status, Steer/Remove/Resume |
| `test/vitest/main/model/AIChatPendingMessage.model.test.ts` | Model behavior (DB-backed) |
| `test/vitest/main/modules/AIChatPendingMessageModule.test.ts` | Module limits/views/cleanup |
| `test/vitest/main/service/AIChatTurnQueueService.test.ts` | Queue orchestration |
| `test/vitest/main/service/AIChatQueryLoopSteering.test.ts` | Safe-boundary behavior |
| `test/vitest/main/service/AIChatTurnControl.test.ts` | Two-phase reservation |
| `test/vitest/main/service/ToolJobRegistry.signal.test.ts` | Phase 0 abort propagation |
| `test/vitest/main/components/AiChatV2PendingMessage.test.ts` | Pending bubble rendering/actions |
| `test/vitest/main/components/AiChatV2Composer.queueSend.test.ts` | Composer send-while-streaming |

### Changed files

`src/config/SqliteDb.ts` (entity registration) · `src/entityTypes/aiChatV2Types.ts` (pending view/event/metadata types) · `src/entityTypes/skillTypes.ts` (SkillExecutionContext unchanged — signal exists) · `src/model/AIChatAttachment.model.ts` (+`getByMessageId`, `deleteByMessageId`) · `src/modules/AIChatAttachmentModule.ts` (same) · `src/service/AIChatQueryEngine.ts` (submitPersistedUserMessage, runPersistedTurn split, turn control, CONVERSATION_BUSY) · `src/service/AIChatQueryLoop.ts` (boundaries, synthetic results, visibleContent, tracker.steeringObserved) · `src/service/AIChatQueryEvents.ts` (direction_updated event, loop input control, terminal classification) · `src/service/ToolJobRegistry.ts` (abort signal) · `src/service/agentTools/runSubagentTool.ts` (signal) · `src/main-process/communication/ai-chat-v2-ipc.ts` (pending handlers, broadcaster sink, clear cascade, recovery) · `src/main-process/communication/index.ts` (broadcaster registration) · `src/config/channellist.ts` (6 channels) · `src/config/usersetting.ts` (2 flag keys) · `src/preload.ts` (invoke + receive allowlists) · `src/views/api/aiChatV2.ts` (pending API + stream subscriptions) · `src/views/components/aiChatV2/AiChatV2.vue` (queue send path, background turn renderer, pending state) · `AiChatV2Composer.vue` (Send+Stop coexist) · `AiChatV2Messages.vue` (merge pending) · `AiChatV2Message.vue` (direction marker) · `src/views/lang/{en,zh,es,fr,de,ja}.ts`.

---

## Task 1: Phase 0 — truthful cancellation

**Files:** Modify `src/service/ToolJobRegistry.ts`, `src/service/AIChatQueryLoop.ts` (`executeAsyncTool`), `src/service/agentTools/runSubagentTool.ts`. Test: `test/vitest/main/service/ToolJobRegistry.signal.test.ts`.

- [ ] **1.1 Write failing tests**: registry `start()` exposes `handle.signal` (AbortSignal); `cancel()`/`shutdown()` abort it; queued-then-cancelled job never spawns. Async-tool test: `executeTool` receives `context.signal === handle.signal` (assert via fake deps capturing context; registry swapped via `setDefaultToolJobRegistry` with poll interval small). Subagent test: `runtime.runSync` receives `deps.signal === context.signal` (stub `AgentRuntimeRegistry.getRuntime`).
- [ ] **1.2 Implement registry signal**: `ToolJobSpawnHandle` gains `readonly signal: AbortSignal`; `start()` creates one `AbortController` per job; `cancel()`/`shutdown()` call `abort()` before marking cancelled; queued jobs removed without running. Keep `onCancel` for compat.
- [ ] **1.3 Loop propagation**: in `executeAsyncTool`, pass `signal: handle.signal` into the `deps.executeTool` context.
- [ ] **1.4 Subagent propagation**: `runSubagentTool.execute` passes `signal: context.signal` into `runtime.runSync(request, {...getDefaultAgentRuntimeDeps(), signal: context.signal})`.
- [ ] **1.5 Run** `AIFETCHLY_SKIP_TSC=1 npx vitest run test/vitest/main/service/ToolJobRegistry.signal.test.ts --config vite.main.config.mjs` → PASS. Then full `yarn testmain` for the three touched suites.
- [ ] **1.6 Commit**: `feat: propagate abort signals through ToolJobRegistry, async tools, and run_subagent`

## Task 2: Pending entity + Model (atomic state machine)

**Files:** Create `src/entity/AIChatPendingMessage.entity.ts`, `src/model/AIChatPendingMessage.model.ts`. Modify `src/config/SqliteDb.ts`, `src/entityTypes/aiChatV2Types.ts` (status/view types). Test: `test/vitest/main/model/AIChatPendingMessage.model.test.ts`.

- [ ] **2.1 Types in `aiChatV2Types.ts`**: `AIChatPendingMessageStatus` (8 states), `AIChatSafeBoundary` (5), `ChatV2SteeringMetadata`, `ChatV2DirectionTransition`, `AIChatPendingMessageView`, `AIChatPendingMessageEvent`, `ChatV2HistoryResponse.pendingMessages?`.
- [ ] **2.2 Entity** per design §7.1 (columns: pendingMessageId, clientRequestId, conversationId, userMessageId, content, modelContent, status, requestOptionsJson, attachmentMetadataJson, messageMetadataJson, claimToken, targetAssistantMessageId, steeringBoundary, sentMessageId, failureCode, failureMessage, recoveryReason, attemptCount, claimedAt, terminalAt; extends AuditableEntity; indexes as designed). Register in `SqliteDb.ts` entities list.
- [ ] **2.3 Model** (`extends BaseDb`, worker-guard on `process.env.WORKER_TYPE`):
  - `create()` — idempotent by `clientRequestId` unique index (conflict → load existing, verify conversationId + SHA-256 content/options digest → `IDEMPOTENCY_CONFLICT` error code on mismatch).
  - `claimOldestForDispatch(conversationId)` / `claimForSteering(pendingMessageId, targetAssistantMessageId)` — conditional `UPDATE ... WHERE status='queued'` (+ claimToken, claimedAt, attemptCount+1); 0 rows → reload + return conflict result.
  - `promoteDispatchToUserMessage()` / `promoteSteeringToUserMessage()` — one `DataSource.transaction`: reload with expected status+claimToken → insert `AIChatMessageEntity` with deterministic `userMessageId` (insert-if-absent semantics via messageId lookup) → update pending to `sent`/`applied` + linkage + terminalAt.
  - `pauseConversationQueued(conversationId, reason)` (queued→paused), `resumeConversation(conversationId)` (paused→queued FIFO), `cancel(pendingMessageId)`, `listByConversation` (non-terminal + recent terminal, `id ASC`), `listNonTerminalAll`, `recoverOnStartup()` per design §16.1, `deleteByConversation`, `markFailed`, `restoreSteeringToQueued(pendingMessageId, claimToken)`.
- [ ] **2.4 Attachment accessors**: `AIChatAttachment.model.ts` +`getByMessageId(messageId)`, `deleteByMessageId(messageId)`; module wrappers.
- [ ] **2.5 DB-backed tests** (pattern from `AIChatPendingMessage.model.test.ts` siblings using temp USERSDBPATH): idempotent create, FIFO order, competing claims (one winner), atomic promotion (user row + terminal state together), restart reconciliation paths, cancel deletes attachment bytes.
- [ ] **2.6 Commit**: `feat: add ai_chat_pending_messages entity, model, and atomic claim/promotion operations`

## Task 3: Pending Module + Preparation Service

**Files:** Create `src/modules/AIChatPendingMessageModule.ts`, `src/service/AIChatPendingMessagePreparationService.ts`. Modify engine to use the preparation service. Test: `test/vitest/main/modules/AIChatPendingMessageModule.test.ts`.

- [ ] **3.1 Preparation service**: extract `prepareAttachmentContent`, `stageDocumentMarkdowns`, `persistAttachmentBytes` from `AIChatQueryEngine` + the pasted-text/@-mention/model-content resolution into `prepare(input: {request, conversationId})` returning `{displayContent, modelContent, attachmentMetadata, messageMetadata, contentParts}`. Staging failure → throw before any pending write (design §7.4).
- [ ] **3.2 Module**: `createPendingMessage` (limits: ≤20 non-terminal/conversation, ≤32k content chars, attachment limits via existing `normalizeChatV2UploadedFiles` rules; deterministic `userMessageId = user-pending-<pendingMessageId>`; stores display/model content + requestOptions subset + attachment bytes via attachment module), `listViews` (maps entity→view, `sequence = id`, computes `canSteer` from status+attachments), `cancelPending` (+ attachment cleanup), `clearConversation`, view sanitization (never returns modelContent/claimToken/requestOptions).
- [ ] **3.3 Tests**: limits reject without partial writes; view sanitization; cancel removes attachment rows; queue-cap enforcement.
- [ ] **3.4 Commit**: `feat: add pending message module with limits, views, and send-time preparation service`

## Task 4: Turn control (steering mailbox) + engine refactor

**Files:** Create `src/service/AIChatTurnControl.ts`. Modify `src/service/AIChatQueryEngine.ts`, `src/service/AIChatQueryEvents.ts`. Tests: `test/vitest/main/service/AIChatTurnControl.test.ts`, update `AIChatQueryEngine.concurrentTurns.test.ts`.

- [ ] **4.1 `AIChatTurnControl`** per design §10.1: `reserve(pendingMessageId)`, `commit(reservation, instruction)`, `cancelReservation`, `consume(boundary)` (drains committed instructions in order, invoking injected `persist` per item BEFORE returning them to the loop; on persist failure → already-applied stay applied, later stay steering, throws `STEERING_PERSISTENCE_FAILED`), `close()` (idempotent; marks unusable), `hasPending()`. Max 10 instructions per boundary consume.
- [ ] **4.2 Engine changes**:
  - `ActiveTurnState` gains `control: AIChatTurnControl`.
  - Split `submitMessage()` → private `prepareAndPersistUserTurn()` (steps 1–2 today) + `runPersistedTurn()` (steps 3–9) returning `AIChatTurnTerminalEvent` (`{type: "completed"|"cancelled"|"failed"|"paused_for_permission"|"paused_for_plan_question"|"conversation_busy", conversationId, assistantMessageId?}`).
  - New public `submitPersistedUserMessage(input: {eventSink, request, savedUser, modelContent, contentParts?, assistantMessageId?})` → assembles context, calls `runPersistedTurn`, returns terminal classification.
  - `runPersistedTurn` returns `conversation_busy` (no abort, no events) when activeTurns/pendingPermissions/pendingPlanQuestions already has the conversation (design §12.3). Update `concurrentTurns` test accordingly (same-conversation re-send now busy; cross-conversation still concurrent).
  - `reserveSteering(conversationId, pendingMessageId)` / `commitSteering(conversationId, reservation, instruction)` — only when `activeTurns` has a `running` entry; commit returns false after close → caller restores DB state.
  - On pause (`paused_for_permission`/`paused_for_plan_question`) and terminal results: `control.close()`; loop input carries `steeringControl`.
  - `handleLoopResult` persists `directionTransitions` + combined `fullContent` steering data on the final assistant row (metadata `directionTransitions`).
- [ ] **4.3 `AIChatQueryEvents.ts`**: `AIChatQueryLoopInput.steeringControl?: AIChatTurnControl`; `AIChatQueryDirectionUpdatedEvent` (`type:"direction_updated"`, conversationId, messageId, boundary, pendingMessageIds, contentOffset); completed result gains `directionTransitions?: readonly ChatV2DirectionTransition[]` and `steeringApplied?: boolean`.
- [ ] **4.4 Tests**: two-phase reserve/commit race (turn closes between phases), busy classification, close-on-pause.
- [ ] **4.5 Commit**: `feat: split engine turn preparation from execution and add per-turn steering control`

## Task 5: Queue service

**Files:** Create `src/service/AIChatTurnQueueService.ts`. Test: `test/vitest/main/service/AIChatTurnQueueService.test.ts`.

- [ ] **5.1 Interface** per design §9.1: `submit`, `steer`, `cancel`, `resumeConversation`, `list`, `onTurnTerminal`, `recoverOnStartup`, `clearConversation`, `clearAll`. Deps injected: `{engine, pendingModule, preparationService, broadcaster, coordinator, isAiEnabled}`.
- [ ] **5.2 Submit algorithm** (design §9.2): AI gate → module create/reuse → broadcast queued/paused event → if conversation idle + not held + oldest claimable → schedule `drainConversation` → return receipt `{conversationId, disposition, pendingMessage}`.
- [ ] **5.3 Drain algorithm** (design §9.3): in-memory promise chain per conversationId (serialize); acquire interactive lease from `AIChatConversationTurnCoordinator` (tryAcquire; on busy → release claim back to queued and stop); conditional claim oldest → `dispatching` (broadcast) → `promoteDispatchToUserMessage` → rebuild `ChatV2StreamRequest` from stored requestOptions + attachments BLOBs → `engine.submitPersistedUserMessage` with broadcaster sink → await terminal → release lease → `completed` → schedule one next drain; `cancelled`/`failed`/pause variants → `pauseConversationQueued` + broadcast `paused`.
  - Dispatch failure before model work → mark row `paused` with failureCode, broadcast, keep visible.
  - AI disabled at drain time → hold queue (paused, `AI_FEATURE_DISABLED`), no rows lost.
- [ ] **5.4 Steer algorithm** (design §10.3): load row, validate same-conversation + text-only + queued → `engine.reserveSteering` → conditional DB claim `queued→steering` w/ target assistant id → `engine.commitSteering` → broadcast `steering`; commit-false → DB restore `steering→queued`; no running turn → `TURN_NOT_STEERABLE` leaves queued.
- [ ] **5.5 Recovery** (design §16.1): nonterminal rows — `dispatching`→sent/paused(recovered_dispatch) via transcript lookup; `steering`→applied/paused(recovered_steering) via steering metadata lookup; `queued`→paused(recovered_after_restart); broadcast refresh hint; never auto-run.
- [ ] **5.6 Tests** (stub deps, real Module on temp DB where useful): idle submit schedules exactly one dispatch; busy submit stays queued; terminal completed drains next; stop/error/permission/question pauses; resume restores FIFO; conversations independent; lease collision blocks scheduled; steer happy path + race fallbacks; recovery matrix.
- [ ] **5.7 Commit**: `feat: add AIChatTurnQueueService with FIFO drain, steering, hold, and restart recovery`

## Task 6: Query loop safe boundaries

**Files:** Modify `src/service/AIChatQueryLoop.ts`. Test: `test/vitest/main/service/AIChatQueryLoopSteering.test.ts`.

- [ ] **6.1 Boundary helper** `applySteeringAtBoundary({boundary, loopInput, messages, unstartedCalls, visibleContentLength})` → `{applied: boolean, skippedCallIds, steeringBatch?}`. When no `steeringControl` or nothing committed → no-op. Round budget: applying when `round + 1 >= CHAT_V2_MAX_TOOL_ROUNDS` → return failed `STEERING_ROUND_LIMIT` (items remain steering → paused by terminal handling).
- [ ] **6.2 Checkpoints**:
  1. `before_model` — top of round loop before `streamChatCompletion`.
  2. `after_model` — after parsedCalls/willContinue resolved, before `buildAssistantToolCallMessage` push: if steering → push assistant tool-call message, emit synthetic skipped results for ALL calls, apply steering, `continue`.
  3. `before_tool` — top of each valid parsed-call iteration (before policy checks/emitToolCall): if steering → synthetic result for this + all not-yet-resulted calls, break call loop, apply steering, next round.
  4. `after_tool` — after tool result pushed + handoff: if steering → skip remaining calls with synthetic results, apply, break.
  5. `before_complete` — in `!willContinue` branch: if steering → apply and `continue` (forces continuation round) instead of `break`.
- [ ] **6.3 Synthetic result** `{success:false, skipped:true, reason:"superseded_by_user_steering"}` via existing `tool_result` event + `messages.push` — one per unstarted `tool_call_id` (track `resultedCallIds: Set<string>`; includes malformed-arg calls not yet resulted).
- [ ] **6.4 Applying**: after all required tool results, push one `role:"user"` message per instruction with wrapped modelContent `[User steering update received while this response was running]\n<text>`; emit `direction_updated` (ids + boundary + contentOffset only); record transition `{contentOffset, boundary, pendingMessageIds, occurredAt}`; continue next round.
- [ ] **6.5 visibleContent accumulator**: append each round's emitted text once; completed result carries `fullContent = visibleContent` + `directionTransitions` when steering applied (legacy path unchanged otherwise).
- [ ] **6.6 Retry interaction**: `RoundContentTracker.steeringObserved` — transient retry requires `!delivered && !steeringObserved`.
- [ ] **6.7 Steering model wrapper below system/policy; completed steering data reaches engine result.**
- [ ] **6.8 Tests** (fake deps + fake control): before-first-model; after-model-before-tools; between tool A and B (A result kept, B synthetic, next request contains A result + B skipped + steering); multiple steering order preserved; every skipped call exactly one result; before_complete forces continuation; round-limit failure; retry does not replay applied steering; cancellation distinct.
- [ ] **6.9 Commit**: `feat: apply steering at five safe boundaries with synthetic skipped tool results`

## Task 7: IPC + preload + broadcaster

**Files:** Create `src/schemas/ipc/aiChatPendingMessage.ts`, `src/service/AIChatV2EventBroadcaster.ts`. Modify `src/config/channellist.ts`, `src/config/usersetting.ts`, `src/preload.ts`, `src/main-process/communication/ai-chat-v2-ipc.ts`, `src/main-process/communication/index.ts`. Test: extend/new `test/vitest/main/aiChatPendingMessageIpc.test.ts`.

- [ ] **7.1 Channels**: `AI_CHAT_V2_PENDING_CREATE/LIST/STEER/CANCEL/RESUME` (invoke) + `AI_CHAT_V2_PENDING_EVENT` (main→renderer). Flag keys `AI_CHAT_MESSAGE_QUEUE_ENABLED`, `AI_CHAT_MESSAGE_STEERING_ENABLED` in usersetting (Token-backed, default "true"; steering requires queue).
- [ ] **7.2 Zod schemas** (`zod/v4`, strict, IDs ≤100 chars, conversationId `v2-` prefix or empty for new, message ≤32k, uploadedFiles array ≤3 of bounded objects; reuse `aiChatV2PastedContentsSchema`).
- [ ] **7.3 Broadcaster**: singleton; `register(win)` (wired in `index.ts` next to conversation-update broadcaster); emits pending events (`AI_CHAT_V2_PENDING_EVENT`) and forwards interactive stream chunks/completes to all live windows on existing channels. `createEventSink` in `ai-chat-v2-ipc.ts` routes through it (single-window app unaffected; queue-dispatched turns now reachable).
- [ ] **7.4 Handlers** via `registerAiValidatedHandler` calling the queue service singleton (created alongside `getQueryEngine`, reset on DB switch): create (flag check → service.submit), list, steer (flag check), cancel, resume. `handleClearConversation`/`handleClearAll` cascade through `queueService.clearConversation/clearAll` first. `handleHistory` includes `pendingMessages` from service.list. `resetAiChatV2RuntimeForDatabaseSwitch` resets queue service + schedules `recoverOnStartup` for the new DB. Registration-time fire-and-forget `recoverOnStartup()` (guarded, idempotent).
- [ ] **7.5 Preload**: add 5 invoke channels to invoke allowlist; add `AI_CHAT_V2_PENDING_EVENT` to receive/removeListener/removeAllLists allowlists.
- [ ] **7.6 Tests**: AI gate before parse (isAiEnabled false → no service call); schema rejects oversized/unknown; sanitized DTOs (no modelContent/claimToken); flag off blocks create but allows list/cancel/resume.
- [ ] **7.7 Commit**: `feat: add pending-message IPC channels, broadcaster, and preload allowlists`

## Task 8: Renderer — queue + pending UI

**Files:** Modify `src/views/api/aiChatV2.ts`, `AiChatV2.vue`, `AiChatV2Composer.vue`, `AiChatV2Messages.vue`, `AiChatV2Message.vue`. Create `AiChatV2PendingMessage.vue`. Tests: `AiChatV2PendingMessage.test.ts`, `AiChatV2Composer.queueSend.test.ts`, migrate the 7 existing component tests mocking `streamChatV2Message`.

- [ ] **8.1 API layer**: `createChatV2PendingMessage(clientRequestId, request)`, `listChatV2PendingMessages`, `steerChatV2PendingMessage`, `cancelChatV2PendingMessage`, `resumeChatV2PendingQueue`, `subscribeChatV2PendingEvents(handler): () => void`, `subscribeChatV2StreamEvents(onChunk, onComplete): () => void` (mount-lifetime on existing chunk/complete channels).
- [ ] **8.2 AiChatV2.vue**: 
  - Per-conversation `pendingMessages` in runtime map; history load seeds from `pendingMessages`; mount-lifetime subscriptions route events (filter by conversation).
  - `onSend` ordinary path: keep command parsing/attachment prep; replace `streamChatV2Message` await with optimistic pending shell + `createChatV2PendingMessage` (draft cleared via `onAccepted` after durable receipt); receipt replaces shell; on rejection show error and keep message available.
  - Extract the per-turn chunk processor from the old closure into `createConversationTurnRenderer(conversationId, userBubble)` (assistant placeholder, token/reasoning/tool/plan/usage handling, terminal handling, runtime-status patches). Mount-lifetime stream subscription starts a renderer for `start` chunks of conversations without an active renderer; cleans up on terminal events. Stop button → `stopChatV2Stream(conversationId)` unchanged; queue pauses (main-side).
  - Pending event handling: `dispatching` → promote bubble to delivered user row; `steering`/`applied`/`cancelled`/`failed`/`paused` → update bubble state; `sent` → drop pending bubble (delivered row appears via history/stream).
- [ ] **8.3 Composer**: Send always visible while streaming (Stop remains adjacent separate action, per PRD 7.1); disabled rules unchanged.
- [ ] **8.4 AiChatV2Messages.vue**: merge delivered + pending by timestamp then sequence; pending rows render `AiChatV2PendingMessage` (props: view, runtimeStatus, steeringEnabled; emits steer/cancel/resume).
- [ ] **8.5 AiChatV2PendingMessage.vue**: muted/dashed bubble, localized status + icon (`mdi-clock-outline`, `mdi-directions-fork` for Steer), Steer (visible iff `canSteer` && running; disabled+tooltip when attachments), Remove (queued/paused/failed), Send next/Resume (paused), busy state while action pending, `aria-live="polite"` status region, keyboard focus.
- [ ] **8.6 AiChatV2Message.vue**: render direction marker segments from `metadata.directionTransitions[].contentOffset` (localized, presentation-only).
- [ ] **8.7 i18n**: add `aiChatV2.queue.*` keys (queued, steer, steering, applied, applied_after_tool, direction_updated, dispatching, paused, failed, remove, resume, send_next, attachments_not_steerable, limit_reached, recovered_after_restart, cancel_failed, steer_failed) to all 6 language files with fallback pattern.
- [ ] **8.8 Tests**: pending bubble status/action matrix; steer disabled for attachments; composer can Send while streaming; migration of the 7 mocking suites to the new API (mock `createChatV2PendingMessage` resolving receipt; stream chunks via `subscribeChatV2StreamEvents` mock).
- [ ] **8.9 Commit(s)**: `feat: renderer queue submission, pending bubbles, steer UI, and direction markers` (+ separate `test:` commit for suite migration if cleaner)

## Task 9: Verification gates + hardening

- [ ] **9.1** `npx tsc --noEmit` (one-shot) → 0 new errors.
- [ ] **9.2** `yarn testmain` → new suites pass; no regressions (known pre-existing failures excluded).
- [ ] **9.3** `yarn test:components` → pass.
- [ ] **9.4** One-shot `vue-tsc` → 0 new errors.
- [ ] **9.5** i18n parity test (all 6 files contain every new key).
- [ ] **9.6** Fix findings; commit per fix. Final commit: `chore: verify message queue gates`.

## Deferred follow-ups (documented, not in this pass)

E2E specs 1–7 (PRD §17.5), analytics counters, queue-count badge on conversation summaries, terminal-row pruning, attachment steering (PRD Phase 4).
