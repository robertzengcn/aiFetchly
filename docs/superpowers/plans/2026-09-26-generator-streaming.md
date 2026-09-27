# AI Chat Workspace Generator Streaming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the generator-streaming PRD (`docs/prd/ai-chat-workspace-generator-streaming-prd.md`): Stage A explicit execution contract (outcome-returning engine, lifecycle notifications, strict persistence, one owner + durable run per turn, single finalization) on the existing sink transport, then Stage B async-generator delivery (provider iterator, single generator loop, progress multiplexer, delivery-mode flag).

**Architecture:** Stage A keeps the callback/sink transport and fixes the contract: `AIChatQueryEngine.runTurn()` returns `AIChatSegmentOutcome` (= existing `AIChatTurnTerminalEvent`), `AIChatCoordinator` derives run status only from outcomes, pause/resume become owner-driven (`claimPending*` + `resumeClaimed`), queue-drained turns get durable runs through a new `dispatchQueuedTurn` coordinator API. Stage B adds `streamEvents()` provider iteration and an `iterate()` async-generator loop implementation with `run()` as a draining facade, switched by an internal config flag (default `callback`).

**Tech Stack:** TypeScript 5, Electron main process, Vitest (`yarn testmain`, `vitest.service.config.mjs`, `test:components`), Vue 3 + vue-i18n (6 languages) for the tool-card failure UI.

**Worktree:** `../aiFetchly-generator-streaming` on branch `generator-streaming` from `dev`.

---

## Current-code facts the plan relies on (verified 2026-09-26 at dev `fd5f43c8`)

- `AIChatQueryEngine.submitMessage(input: AIChatQuerySubmitInput): Promise<void>` — `src/service/AIChatQueryEngine.ts:759`. It persists the user message, then calls private `runPersistedTurn(...): Promise<AIChatTurnTerminalEvent>` (`:1405`), which maps the loop result to `AIChatTurnTerminalEvent` (`:1631-1649`). On `conversation_busy` it emits an `error` event through the sink (`:1152-1174`).
- `submitPersistedUserMessage(input): Promise<AIChatTurnTerminalEvent>` — `:1183` (queue path; user message already persisted).
- `handleLoopResult(result, module, eventSink)` — `:2126-2377`. Pre-switch: `flushEventSaves`, catalog snapshot save, `this.onTurnTerminalCb?.(conversationId, result.type)` for completed/cancelled/failed (`:2144-2150`). `case "completed"`: `saveAssistantMessage` → emit `complete` → auto-compact/session-memory → auto-dream ×2 → `DesktopNotifyService` → `dispatchStop` → `clearActiveTurnState` → `clearStagedConfirmedBatchRefs`. `case "cancelled"`/`"failed"` similar minus dream/notify (failed adds auth redirect + emergency compaction). Pause cases store `pendingPermissions`/`pendingPlanQuestions` maps (keyed by conversationId) and run NO side effects.
- `createPersistingEventSink(module, eventSink)` — `:2436-2499`. Forwards every event, persists only `tool_call`/`tool_result`, **swallows save errors with `log.error`**; `flush()` = `Promise.allSettled(saves)` then clear.
- `resumeToolAfterPermission(request): Promise<ResumeTurnResult>` — `:1764-1964`. Looks up `pendingPermissions` by conversationId (+ `firstEntry` fallback), synchronously moves the entry to `activeTurns`, runs the approved tool directly via `SkillExecutor.execute`, then `void this.loop.run(loopInput).then(handleLoopResult).catch(...)` — fire-and-forget, outside any scheduler/lease.
- `answerPlanQuestion(request): Promise<ResumeTurnResult>` — `:1975-2116`. Persists the answer via `AIChatPlanModule.answerQuestion` first, then the same fire-and-forget continuation.
- `stopActiveTurn(conversationId?)` / private `stopConversation` — `:1701-1754`: aborts the shared per-turn `AbortController`; for pending pauses it deletes the map entry, aborts, and emits `cancelled` on the pending sink.
- `AIChatQueryLoop` (`src/service/AIChatQueryLoop.ts`, 3631 lines): `run(input)` `:829-909` = transient content-level retry wrapper (defaults 3 attempts / 800 ms base; `isContentLevelTransientError` gate) around `runOnce(input, tracker)` `:911-2408`. `emitToolCall` `:1618-1630` emits `tool_call` then `await eventSink.flush?.()` BEFORE `executePreparedToolWithTimeout` (`:2042-2044`). `tool_progress` is emitted by callbacks inside tool execution (`:3131-3146`, `:2659-2673`, `:2708-2736`). Permission pause returns `{type:"paused_for_permission", pending: PendingPermissionTurn}` (`:2112-2144`); plan-question pause `:2574-2589`. Loop never emits terminal events; it returns results.
- `AIChatQueryEvents.ts` (`src/service/AIChatQueryEvents.ts`): `AIChatQueryEventSink` `:35` (`emit` + optional `flush`), 17-member `AIChatQueryEvent` union `:234`, `AIChatQueryLoopResult` `:271` (paused variants carry only `{type, pending}`), `PendingPermissionTurn` `:340`, `PendingPlanQuestionTurn` `:380`, `AIChatTurnTerminalEvent` `:549-564` (`completed|cancelled|failed|paused_for_permission|paused_for_plan_question|conversation_busy`), `AIChatQueryErrorEvent` `:183-191` (NO `toolCallId` today).
- `AIChatCoordinator.ts` (734 lines): `CoordinatorEngine` `:27-31` (`submitMessage|stopActiveTurn|getConversationRuntimeStatus`). `startRun` `:110-225` (gate → dedupe → busy delegation → `runModule.createRun({owner:"interactive"})` → scheduler.submit → response). `executeDispatch` `:346-472`: lease `tryAcquire` → `transition("running")` → `new AIChatRunEventAdapter(runId, conversationId)` PER DISPATCH `:379` → `engine.submitMessage(...)` → post-dispatch parked sample `:385-419` → **default `finalStatus = live.cancelRequested ? "cancelled" : "completed"`** `:421-431` → persist → route held terminal → `finalizeAfterTerminal`. `createRunSink` `:480-504`: non-terminal chunks → `router.sendDetailEvent` + `sampleEngineStatus(live)` `:498`; terminal chunk → held or `settleDetachedTerminal` `:491`. `sampleEngineStatus` `:555-577`. `settleDetachedTerminal` `:512-552`. `cancelRun` `:237-306`. `finalizeAfterTerminal` `:638-666` (deletes live entry, `onRunTerminal` hook, broadcast).
- `AIChatExecutionScheduler.ts`: `BasePriority` `SelectedInteractive=0 | OtherInteractive=1 | GoalOrAgent=2 | Scheduled=3 | Maintenance=4`; capacities `{general:3, browser:1, cpu:2, artifact_batch:3}`; `submit/pump/complete/requeue/cancelQueued`; per-conversation eligibility.
- `AIChatRunEventAdapter` (`src/service/AIChatRunEventAdapter.ts`): `wrap(chunk): ChatRunDetailEvent` stamps `runId` + monotonic `sequence`; `statusHintFor(eventType)`.
- `AIChatTurnQueueService.ts` (737 lines): deps `:70-83` incl. `engine` slice, `streamSinkFactory`, `tryAcquireLease`. `drainConversation` `:510-667`: idle check → `claimOldestForDispatch` → lease (`ownerId:"pending-queue"` wired in IPC) → `rebuildTurnInputs` → `engine.submitPersistedUserMessage({eventSink: this.deps.streamSinkFactory(), ...})` `:615-627` → terminal handling (completed → `scheduleDrain`; busy → release claim; else `holdQueue`). Hold/re-drain: `notifyExternalTurnTerminal` `:419-430`.
- `ai-chat-v2-ipc.ts` (1804 lines): `createQueryLoop` `:149-199` wires `streamChatCompletion = (req,onChunk,opt) => new AiChatApi().openAIChatCompletionStream(...)`. `getQueryEngine` `:283-326` (singleton; `onTurnTerminal` → `getQueueService().notifyExternalTurnTerminal` `:315-321`). `createBroadcastEventSink` `:359-387` — **synthetic runId `pending-queue-${++counter}`**, routes chunks to V2 broadcaster + `sharedWorkspaceEventRouter.sendDetailEvent`. `getQueueService` `:389-412` wires `streamSinkFactory: () => createBroadcastEventSink()` and lease `ownerId:"pending-queue"`. `handleResumeToolAfterPermission` `:1034-1069` (channel `AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION`), `handleAnswerQuestion` `:1346-1377` (channel `AI_CHAT_V2_ANSWER_QUESTION`) — both gate with `canUseChatWithReconcile()` then call the engine directly. Legacy send `handleStream` `:940-996` (channel `AI_CHAT_V2_STREAM`) → `engine.submitMessage`.
- `ai-chat-workspace-ipc.ts` (653 lines): `getAiChatWorkspaceCoordinator` `:80-170` — `onRunTerminal` → `getQueueService().notifyExternalTurnTerminal` `:93-109`; `busySubmit` `:116-166` → `queueService.submit({forceQueue:true})` → returns `{pendingRunId: \`pending-${pendingMessageId}\`}`. Bootstrap does `reconcileInterruptedRuns` `:285-312`.
- Providers: `ChatProviderClient` (`src/service/aiProvider/ChatProviderClient.ts:23-34`) = `listModels | complete | stream(request, onChunk, options)`. `AiChatApi.openAIChatCompletionStream(request, onChunk, {signal,onRetry,retryProfile,onRecoveryStatus})` — `src/api/aiChatApi.ts:2222-2253`; hosted variant `:2259+` owns retry profiles/endpoint fallback. `StreamRetryInfo` `:758`, `StreamRecoveryInfo` `:775`.
- `AgentRuntime.ts` constructs `new AIChatQueryLoop({streamChatCompletion, executeTool, ...})` with its own sink (`:335-340`); subagent events are NOT forwarded to the parent turn (parent sees tool results).
- `ScheduledAiMessageRunner.ts` builds engines via `AIChatQueryEngineFactory.createScheduled` and wraps its sink with `createOwnerAdapterSink` (`:312-343`).
- Renderer: `workspaceStreamPresenter.ts` `createWorkspaceStreamPresenter` (50 ms batching, duplicate/stale rejection). Workspace tool execution UI: `src/views/components/aiChatWorkspace/AiChatExecutionRow.vue` + `toolExecutionProjection.ts` + `src/views/components/aiChatV2/toolExecutionStateUtil.ts`.
- Test anchors all exist (design §17 list). `docs/superpowers/plans/` exists. `src/service/aiChat/` does NOT exist yet.
- Scripts: `yarn testmain` (main vitest), `yarn vitest --config vitest.service.config.mjs run`, `yarn vitest --config vite.utilityCode.config.mjs run <file>`, `yarn test:components`, `yarn typecheck`, `yarn vue-typecheck`. Vitest runs `tsc --noEmit` at startup (type-check gate).

### P0 open questions — resolutions (locked for this plan)

1. **Hosted retry conversion size**: the retry/endpoint-fallback machinery lives inside `openAIChatCompletionStreamHosted` (`aiChatApi.ts:2259+`, ~300 lines). B1 converts it once; the callback API becomes a facade over the iterator. No second retry implementation.
2. **Legacy V2 send reachability**: `AiChatV2.vue` is still routed; `handleStream` stays alive. `submitMessage` remains as deprecated wrapper; engine-internal resume stays for non-coordinator-owned turns.
3. **Subagent events**: `AgentRuntime` owns its sink; no parent forwarding exists. It keeps the `run()` facade contract — no owner routing.
4. **Scheduler tier for resumes**: resumed segments submit with `owner:"interactive"` → `SelectedInteractive` when the conversation is selected, `OtherInteractive` otherwise (same as direct sends).

---

# STAGE A

## Task A0: Worktree setup

**Files:** none (git operations only)

- [ ] Create worktree `../aiFetchly-generator-streaming` branch `generator-streaming` from `dev` (superpowers:using-git-worktrees).
- [ ] Symlink `node_modules` from the main checkout (worktrees have no node_modules; vitest/tsc fail with empty "typecheck" errors otherwise).
- [ ] Verify `yarn typecheck` passes on the pristine worktree before any edit (record baseline error count = 0).

## Task A-P0: Caller inventory + baseline outcome tests

**Files:**
- Create: `docs/prd/generator-streaming-p0-inventory.md`
- Test: `test/vitest/main/service/AIChatQueryEngine.runTurn.test.ts` (new)

- [ ] Write the inventory doc: every consumer of `AIChatQueryLoop`, `AIChatQueryEventSink`, engine submit/resume methods, and provider streaming APIs, classified as segment-owner / run-owner / background-loop. Content derived from the "Current-code facts" section above (coordinator, queue service, scheduled runner, `AgentRuntime`, V2 send/resume handlers, V2 stream sink, `AIChatRunOwnerAdapter`).
- [ ] Baseline test: `submitPersistedUserMessage` returns all six `AIChatTurnTerminalEvent` variants (use a stubbed `AIChatQueryLoop` — stub `loop.run` to return each result type; construct `new AIChatQueryEngine(stubLoop as unknown as AIChatQueryLoop)`; stub `AIChatV2Module.prototype.saveUserMessage*` / model methods with sinon **before** constructing modules). This pins the outcome union before A1 reuses it.
- [ ] Run: `yarn vitest --config vitest.service.config.mjs run test/vitest/main/service/AIChatQueryEngine.runTurn.test.ts` — PASS.
- [ ] Commit: `docs: add generator-streaming P0 caller inventory and baseline outcome tests`

## Task A1: Outcome-returning engine entry point + coordinator outcome consumption

**Files:**
- Modify: `src/service/AIChatQueryEvents.ts` (add `AIChatSegmentOutcome`)
- Modify: `src/service/AIChatQueryEngine.ts` (`runTurn`, `submitMessage` wrapper)
- Modify: `src/service/AIChatCoordinator.ts` (`CoordinatorEngine.runTurn`, outcome-driven status, remove sampling + default-completed)
- Test: `test/vitest/main/service/AIChatQueryEngine.runTurn.test.ts`, `test/vitest/main/aiChatWorkspaceCoordinator.test.ts`

- [ ] **Failing test 1 — engine `runTurn` returns the segment outcome** (extend runTurn.test.ts):

```typescript
it("runTurn returns the terminal outcome that submitMessage used to swallow", async () => {
  const engine = buildEngineWithLoopResult({ type: "completed", conversationId, assistantMessageId, fullContent: "hi", finishReason: "stop" });
  const outcome = await engine.runTurn({ eventSink: sink, request });
  assert.equal(outcome.type, "completed");
  assert.equal((outcome as { assistantMessageId: string }).assistantMessageId, assistantMessageId);
});
```

- [ ] **Failing test 2 — coordinator never defaults to completed** (aiChatWorkspaceCoordinator.test.ts): stub engine `runTurn` resolving `{ type: "paused_for_permission", conversationId, assistantMessageId }` with NO terminal chunk emitted; assert `runModule.transition` called with `"awaiting_permission"` and never `"completed"`; and stub `runTurn` rejecting with an arbitrary error → assert `transition(runId, "failed", {errorCode/summary containing "unclassified_segment_exit"})` (AC-17).

- [ ] Implement `AIChatSegmentOutcome` in `AIChatQueryEvents.ts` (next to `AIChatTurnTerminalEvent`, `:549`):

```typescript
/** Stage A §3.1: the explicit outcome of one execution segment (PRD FR-022). */
export type AIChatSegmentOutcome = AIChatTurnTerminalEvent;
```

- [ ] In `AIChatQueryEngine.ts`: rename the body of `submitMessage` (`:759-1175`) to `async runTurn(input: AIChatQuerySubmitInput): Promise<AIChatSegmentOutcome>` and make it `return terminal;` (the local from `runPersistedTurn`, `:1152`). Replace `submitMessage` with:

```typescript
/** @deprecated Outcome-swallowing wrapper for callers not yet migrated to runTurn (PRD FR-013). */
async submitMessage(input: AIChatQuerySubmitInput): Promise<void> {
  const outcome = await this.runTurn(input);
  if (outcome.type === "conversation_busy") {
    input.eventSink.emit({
      type: "error",
      conversationId: outcome.conversationId,
      errorMessage:
        "This conversation is still working on the previous message. Please wait for it to finish or stop it.",
    });
  }
}
```

- [ ] In `AIChatCoordinator.ts`: change `CoordinatorEngine` to `runTurn(input: AIChatQuerySubmitInput): Promise<AIChatSegmentOutcome>;` and update `executeDispatch` (`:379-431`):

```typescript
const adapter = live.adapter ?? new AIChatRunEventAdapter(runId, conversationId);
let outcome: AIChatSegmentOutcome;
try {
  outcome = await this.deps.engine.runTurn({
    request: this.buildEngineRequest(live),
    eventSink: this.createRunSink(live, adapter),
    lifecycle: this.createLifecycleListener(live), // added in Task A2; wire here
  });
} catch (err: unknown) {
  outcome = {
    type: "failed", conversationId, assistantMessageId: liveAssistantMessageId,
  };
  live.unclassifiedExit = { summary: safeErrorSummary(err) }; // → errorCode "unclassified_segment_exit"
}
const finalStatus = this.statusForOutcome(outcome, live);
```

  Add `statusForOutcome`:

```typescript
private statusForOutcome(outcome: AIChatSegmentOutcome, live: LiveRunState): ChatRunStatus {
  switch (outcome.type) {
    case "completed": case "cancelled": case "failed": return outcome.type;
    case "paused_for_permission": return "awaiting_permission";
    case "paused_for_plan_question": return "awaiting_user";
    case "conversation_busy": return "failed"; // unexpected for an admitted run — never "completed"
  }
}
```

  Delete: the post-dispatch parked sample (`:385-419`), the default-completed/cancelled-if-stop branch (`:421-431` → replaced by `statusForOutcome`; `cancelRequested` only matters when the engine produced no chunk AND the outcome says cancelled — the outcome already carries it), and the `sampleEngineStatus` call in `createRunSink` (`:498`). Keep: terminal-chunk holding + persist-before-route (`:434-450`). For a terminal outcome with NO held chunk (defensive), synthesize an error/complete chunk through the adapter so the UI still updates — never infer success from absence (FR-022).
- [ ] Update all `CoordinatorEngine` implementations in tests (`aiChatWorkspaceCoordinator.test.ts` stubs) to `runTurn`.
- [ ] Run both test files (commands above) — PASS. Then `yarn testmain` (full main suite) — record any pre-existing failures separately.
- [ ] Commit: `feat: outcome-returning engine entry point; coordinator derives status from segment outcomes only (FR-009/022)`

## Task A2a: Strict required persistence

**Files:**
- Modify: `src/service/AIChatQueryEvents.ts` (`AIChatRequiredPersistenceError`, `toolCallId` on error events)
- Modify: `src/service/AIChatQueryEngine.ts` (`createPersistingEventSink`, failure publication)
- Modify: `src/service/AIChatQueryLoop.ts` (exclude persistence errors from transient retry)
- Test: `test/vitest/main/service/AIChatQueryEngine.requiredPersistence.test.ts` (new)

- [ ] **Failing tests** (AC-02/AC-08): (1) tool-call save REJECTS → loop result is `failed`, the sink received `tool_call` then `error` with `errorCode:"tool_call_persist_failed"` + matching `toolCallId`, and the tool NEVER executed (stub `executeTool` counting calls). (2) tool-RESULT save rejects → same shape with `"tool_result_persist_failed"`. (3) a delayed save blocks execution: `saveToolCallMessage` returns a controllable promise; assert `executeTool` not called until it resolves. (4) persistence failure is not transient-retried: loop stub records `run()` attempts; assert one attempt only.

```typescript
class AIChatRequiredPersistenceError extends Error { /* see implementation below */ }
// test skeleton: stub AIChatV2Module.prototype.saveToolCallMessage to reject, loop stub's
// emitToolCall path — easiest: use a REAL AIChatQueryLoop with stubbed deps whose
// streamChatCompletion emits a tool-call chunk, mirroring AIChatQueryLoopAsyncPermission.test.ts patterns.
```

- [ ] Implement in `AIChatQueryEvents.ts`:

```typescript
/** Stage A §3.3: a required tool persistence write failed; dependent execution must stop. */
export class AIChatRequiredPersistenceError extends Error {
  constructor(
    readonly persistenceCode: "tool_call_persist_failed" | "tool_result_persist_failed",
    readonly toolCallId: string,
    readonly cause?: unknown
  ) {
    super(`Required persistence failed (${persistenceCode}) for tool call ${toolCallId}`);
    this.name = "AIChatRequiredPersistenceError";
  }
}
```

  Extend `AIChatQueryErrorEvent` (`:183-191`) with `readonly toolCallId?: string;`.

- [ ] Rewrite `createPersistingEventSink` (`:2436-2499`) strictness (keep forwarding-first):

```typescript
interface PendingRequiredSave {
  readonly kind: "tool_call" | "tool_result";
  readonly toolCallId: string;
  readonly promise: Promise<unknown>;
}
// emit(): unchanged forwarding + latestUsage tracking, but saves.push({kind, toolCallId, promise: module.saveX(...)}) WITHOUT .catch
// flush(): const batch = saves.splice(0, saves.length);
//   const settled = await Promise.allSettled(batch.map((s) => s.promise));
//   const failedIndex = settled.findIndex((r) => r.status === "rejected");
//   if (failedIndex >= 0) throw new AIChatRequiredPersistenceError(batch[failedIndex].kind === "tool_call" ? "tool_call_persist_failed" : "tool_result_persist_failed", batch[failedIndex].toolCallId, settled[failedIndex].reason);
```

- [ ] `flushPendingEventSaves` (`:2501-2509`): stop using blind `allSettled` for the flush barrier — delegate to the strict flush above (internal pre-loop-flush call sites that must not crash on old already-failed saves still route through the same path; the rejection is caught by `runPersistedTurn`'s catch).
- [ ] Failure publication: in `runPersistedTurn`'s catch (`:1650-1652`) and in `handleLoopResult`'s pre-switch flush (`:2131`), detect `err instanceof AIChatRequiredPersistenceError` and pass `{ errorCode: err.persistenceCode, toolCallId: err.toolCallId }` into `handleFailure` so its `error` event carries them. Ensure a tool whose RESULT failed to persist is never re-run (loop returns `failed` → engine finalizes failed; no retry path re-executes — covered by the no-transient-retry rule below).
- [ ] In `AIChatQueryLoop.run` retry predicate (`:882-890` `canRetry`): add `!(result.error instanceof AIChatRequiredPersistenceError)` (import the class from `AIChatQueryEvents`).
- [ ] Run new test file — PASS; run `yarn testmain` — no regressions.
- [ ] Commit: `feat: strict required persistence for tool calls/results blocks dependent execution (FR-006/007)`

## Task A2b: Explicit lifecycle notifications

**Files:**
- Modify: `src/service/AIChatQueryEvents.ts` (`AIChatTurnLifecycleListener`)
- Modify: `src/service/AIChatQueryEngine.ts` (listener input + `onAwaiting`/`onResumed` call sites)
- Modify: `src/service/AIChatCoordinator.ts` (`createLifecycleListener`; delete `sampleEngineStatus` + `mapEngineStatus`)
- Test: `test/vitest/main/aiChatWorkspaceCoordinator.test.ts`, `test/vitest/main/service/AIChatQueryEngine.lifecycle.test.ts` (new)

- [ ] **Failing tests**: engine calls `lifecycle.onAwaiting({kind:"permission", conversationId, assistantMessageId, toolCallId})` exactly once when the loop returns `paused_for_permission` (and `kind:"user_input"` + `questionId` for plan questions), and `onResumed({conversationId, assistantMessageId})` exactly once when `resumeClaimed` starts executing (A3 wires that; the engine-level test uses the legacy resume first). Coordinator test: waiting transition observed via the listener with NO chunk emitted (timing-race test: engine emits only a `token` then returns paused; assert transition to `awaiting_permission` — the old sampling could miss this).
- [ ] Implement the listener type in `AIChatQueryEvents.ts`:

```typescript
/** Stage A §3.2: explicit internal waiting/resume notifications (PRD FR-021). Synchronous, non-throwing. */
export interface AIChatTurnLifecycleListener {
  onAwaiting(event: {
    readonly kind: "permission" | "user_input";
    readonly conversationId: string;
    readonly assistantMessageId: string;
    readonly toolCallId?: string;
    readonly questionId?: string;
  }): void;
  onResumed(event: {
    readonly conversationId: string;
    readonly assistantMessageId: string;
  }): void;
}
```

- [ ] `AIChatQuerySubmitInput` (engine `:304`) gains `readonly lifecycle?: AIChatTurnLifecycleListener;` and `readonly ownerNotifiesTerminal?: boolean;`. Engine `handleLoopResult` pause cases (`:2341-2374`) call the CURRENT turn's listener: store `lifecycle` on the `ActiveTurnState` entry when registering (`:1529-1540`), then after `pendingPermissions.set(...)` call `entry.lifecycle?.onAwaiting({kind:"permission", ...})` inside a try/catch (never throws). `resumeToolAfterPermission`/`answerPlanQuestion` call `onResumed` right after re-registering `activeTurns` (carry the listener on the pending structures: add optional `lifecycle?: AIChatTurnLifecycleListener` to `PendingPermissionTurn`/`PendingPlanQuestionTurn` — loop pause constructors at `AIChatQueryLoop.ts:2112-2144/:2574-2589` must copy `input.lifecycle` into `pending`; add `readonly lifecycle?: AIChatTurnLifecycleListener` to `AIChatQueryLoopInput` `:462`).
- [ ] `onTurnTerminalCb` gating (FR-023 "queue notified once per run"): in `handleLoopResult` pre-switch (`:2144-2150`), skip the callback when the segment ran with `ownerNotifiesTerminal: true` (coordinator-owned runs notify in `finalizeAfterTerminal` instead). Coordinator passes `ownerNotifiesTerminal: true`.
- [ ] Coordinator `createLifecycleListener` (design §3.2 — persist transition, then broadcast):

```typescript
private createLifecycleListener(live: LiveRunState): AIChatTurnLifecycleListener {
  return {
    onAwaiting: (event) => {
      live.status = event.kind === "permission" ? "awaiting_permission" : "awaiting_user";
      void this.deps.runModule
        .transition(live.runId, live.status)
        .then(() => this.broadcastRunSummary(live.conversationId, event.kind === "permission" ? "permission_required" : "user_input_required"))
        .catch((err: unknown) => this.logTransitionError("lifecycle-awaiting", err));
    },
    onResumed: (event) => {
      live.status = "running";
      void this.deps.runModule
        .transition(live.runId, "running")
        .then(() => this.broadcastRunSummary(live.conversationId, "run_started"))
        .catch((err: unknown) => this.logTransitionError("lifecycle-resumed", err));
    },
  };
}
```

  Delete `sampleEngineStatus` (`:555-577`) and `mapEngineStatus` (`:722-733`) once no caller remains (check `executeDispatch` parked branch was removed in A1; `getLiveRuntime` may still read engine status for sidebar summaries — that read-only use stays).
- [ ] Side-effect gating check (FR-023/AC-18): add a test counting side effects per outcome (stub `compactAgent.enqueueAutoCompact`, dream services, `DesktopNotifyService.getInstance().show`, `dispatchStop` via HookDispatcher stub, `getConfirmedBatchReferenceRegistry().clear`) — completed fires each once; cancelled fires stop+cleanup only; failed fires failure set; BOTH pause variants fire none; resumed-then-completed fires the completed set exactly once for the whole run (onTurnTerminal once per run via owner).
- [ ] Run tests — PASS. `yarn testmain`.
- [ ] Commit: `feat: explicit awaiting/resumed lifecycle notifications replace engine status sampling (FR-021/023)`

## Task A2c: Tool-card failure states (UI + i18n + component tests)

**Files:**
- Modify: `src/views/components/aiChatWorkspace/toolExecutionProjection.ts` (map error chunks carrying `errorCode` `tool_call_persist_failed`/`tool_result_persist_failed` + `toolCallId` to a failed tool-card state)
- Modify: `src/views/components/aiChatWorkspace/AiChatExecutionRow.vue` (render failure label)
- Modify: `src/views/lang/{en,zh,es,fr,de,ja}.ts` (new keys)
- Test: `test/vitest/main/components/AiChatWorkspaceTranscript.test.ts` (extend) or a new `AiChatExecutionRow.test.ts`

- [ ] **Failing component test**: presenter applies `error` chunk with `errorCode:"tool_call_persist_failed"`, `toolCallId:"tc-1"` → the execution row for `tc-1` shows the localized "Tool not run: it could not be saved." failure state and never shows running/success. Second case `tool_result_persist_failed` → "Tool ran but its result could not be saved."
- [ ] Add i18n keys (all six files, same structure):

```typescript
// en.ts under aiChatWorkspace (follow existing nesting)
toolPersistFailure: {
  toolCallNotSaved: "Tool not run: it could not be saved.",
  toolResultNotSaved: "Tool ran but its result could not be saved.",
},
```

  zh: `工具未运行：保存失败。` / `工具已运行，但结果保存失败。` — es: `Herramienta no ejecutada: no se pudo guardar.` / `La herramienta se ejecutó, pero no se pudo guardar su resultado.` — fr: `Outil non exécuté : échec de l'enregistrement.` / `L'outil s'est exécuté, mais son résultat n'a pas pu être enregistré.` — de: `Tool nicht ausgeführt: Speichern fehlgeschlagen.` / `Tool wurde ausgeführt, aber das Ergebnis konnte nicht gespeichert werden.` — ja: `ツールは実行されませんでした：保存に失敗しました。` / `ツールは実行されましたが、結果を保存できませんでした。`
- [ ] Implement projection mapping + row rendering; run `yarn test:components` — PASS; `yarn vue-typecheck` — clean.
- [ ] Commit: `feat: tool-card failure states for required-persistence failures with 6-language i18n (FR-006/017)`

## Task A3a: Durable run identity for queue-drained turns

**Files:**
- Modify: `src/service/AIChatCoordinator.ts` (`dispatchQueuedTurn`)
- Modify: `src/service/AIChatTurnQueueService.ts` (delegate execution; drop `streamSinkFactory` + own lease)
- Modify: `src/main-process/communication/ai-chat-v2-ipc.ts` (remove `createBroadcastEventSink` + synthetic IDs; wire dispatcher)
- Test: `test/vitest/main/service/AIChatTurnQueueService.test.ts`, `test/vitest/main/aiChatWorkspaceCoordinator.test.ts`

- [ ] **Failing tests**: (1) queue drain calls `dispatchQueuedTurn` (stub) and maps the returned outcome to drain/hold exactly as before (completed → next drain scheduled; failed → `holdQueue("failed")`). (2) coordinator's `dispatchQueuedTurn` creates a durable run (`runModule.createRun` with `owner:"interactive"`), routes events through an `AIChatRunEventAdapter` with the REAL run id (assert emitted `ChatRunDetailEvent.runId` matches `createRun` result, sequence monotonic from 1), returns the engine outcome, and notifies `onRunTerminal` once. (3) no `pending-queue-` string appears in any emitted detail event (grep-level assertion in test).
- [ ] Queue service: replace `streamSinkFactory` dep with `dispatchQueuedTurn`:

```typescript
export interface AIChatQueueTurnDispatch {
  readonly conversationId: string;
  readonly pendingMessageId: string;
  readonly request: ChatV2StreamRequest;
  readonly savedUser: AIChatMessageEntity;       // from promoteDispatchToUserMessage
  readonly modelContent: string;
  readonly contentParts?: Array<OpenAITextContentPart | OpenAIImageUrlContentPart>;
  readonly assistantMessageId: string;           // deterministic assistant-pending-<id>
}
export interface AIChatQueueTurnDispatcher {
  dispatchQueuedTurn(input: AIChatQueueTurnDispatch): Promise<AIChatSegmentOutcome>;
}
```

  In `drainConversation` (`:615-627`): keep `rebuildTurnInputs` + `promoteDispatchToUserMessage`, then `terminal = await this.deps.dispatchQueuedTurn({...})`. Remove `tryAcquireLease` usage (coordinator's dispatch acquires the conversation lease + scheduler capacity; the queue keeps only FIFO/policy). Keep the queue's idle gate.
- [ ] Coordinator `dispatchQueuedTurn` (design §3.4): create run → live entry (status `queued`, adapter stored on `LiveRunState`, `queueDispatch` input stored) → `scheduler.submit({runId, conversationId, owner:"interactive"})` → `pump()` → return a promise resolved by `executeDispatch` when the segment settles. `executeDispatch` branches on `live.queueDispatch`:

```typescript
outcome = live.queueDispatch
  ? await this.deps.engine.submitPersistedUserMessage({
      eventSink: this.createRunSink(live, adapter),
      request: live.queueDispatch.request,
      savedUser: live.queueDispatch.savedUser,
      modelContent: live.queueDispatch.modelContent,
      ...(live.queueDispatch.contentParts ? { contentParts: live.queueDispatch.contentParts } : {}),
      assistantMessageId: live.queueDispatch.assistantMessageId,
      lifecycle, ownerNotifiesTerminal: true,
    })
  : await this.deps.engine.runTurn({ request: this.buildEngineRequest(live), eventSink: this.createRunSink(live, adapter), lifecycle, ownerNotifiesTerminal: true });
```

  Terminal handling identical to A1 (`statusForOutcome` + persist + route + `finalizeAfterTerminal`); the completion deferred resolves with the outcome. The run sink for queue turns ALSO forwards chunks to `AIChatV2EventBroadcaster.getInstance().emitStreamChunk/emitStreamComplete` so other surfaces keep working (design §3.4 "existing broadcaster emissions stay in the run sink").
- [ ] `ai-chat-v2-ipc.ts` `getQueueService` (`:389-412`): wire `dispatchQueuedTurn: (input) => getAiChatWorkspaceCoordinator().dispatchQueuedTurn(input)` (import from ai-chat-workspace-ipc; both are lazy singletons — no construction cycle at module load). Delete `createBroadcastEventSink` + `pendingTurnSinkCounter` (`:359-387`) and the `tryAcquireLease` ownerId `"pending-queue"` wiring. NOTE the import direction: ai-chat-workspace-ipc already imports from ai-chat-v2-ipc; put the dispatcher lookup in a lazy callback to avoid a cycle.
- [ ] `busySubmit` pending receipt (`pending-<pendingMessageId>`) stays — it is a queue receipt id, not a streamed run id (FR-005 concerns detail events; AC-16 asserts the DRAINED turn's events carry the durable id).
- [ ] Run queue + coordinator tests — PASS; `yarn testmain`.
- [ ] Commit: `feat: queue-drained turns get durable run identity and a single execution owner (FR-004/005)`

## Task A3b: Resume through the run owner

**Files:**
- Modify: `src/service/AIChatQueryEngine.ts` (`claimPendingPermission`, `claimPendingQuestion`, `resumeClaimed`, `cancelClaimed`)
- Modify: `src/service/AIChatCoordinator.ts` (`resumeRun`, resume dispatch, adapter in `LiveRunState`, remove `settleDetachedTerminal`)
- Modify: `src/main-process/communication/ai-chat-v2-ipc.ts` (route resume/answer handlers to owners)
- Test: `test/vitest/main/service/AIChatQueryEngine.resumeClaimed.test.ts` (new), `test/vitest/main/aiChatWorkspaceCoordinator.test.ts`

- [ ] **Failing tests**: (1) claim idempotency — first `claimPendingPermission(conv, toolId)` returns `{status:"claimed"}`; a duplicate call returns `{status:"already_claimed"}` and does NOT re-execute; a stale toolId returns `{status:"not_found"}`. (2) `resumeClaimed` returns the continuation outcome (`completed`) and calls `lifecycle.onResumed` once; the tool executes exactly once across claim+resume. (3) coordinator `resumeRun` with full scheduler capacity: claim → run transitions `queued` → (capacity frees) → `running` → outcome handled; approval not lost, applied once (AC-05). (4) Stop while resume waits for capacity → claim cancelled, run `cancelled`, tool never starts (AC-04). (5) duplicate approval after settlement → `{ok:false}`-style rejection, no second execution.
- [ ] Engine claim API:

```typescript
export type AIChatPendingClaim =
  | { readonly status: "claimed"; readonly conversationId: string; readonly assistantMessageId: string; readonly kind: "permission" | "question"; readonly toolCallId?: string; readonly questionId?: string; readonly pending: PendingPermissionTurn | PendingPlanQuestionTurn; }
  | { readonly status: "already_claimed" | "not_found" };
claimPendingPermission(conversationId: string, toolCallId: string): AIChatPendingClaim;
claimPendingQuestion(conversationId: string, questionId: string): AIChatPendingClaim;
cancelClaimed(conversationId: string): boolean;   // deletes claimed entry, aborts its controller
resumeClaimed(claim: Extract<AIChatPendingClaim, {status:"claimed"}>, options?: {
  readonly lifecycle?: AIChatTurnLifecycleListener;
}): Promise<AIChatSegmentOutcome>;
```

  Claims move the entry from `pendingPermissions`/`pendingPlanQuestions` into `claimedPending: Map<string, {kind, pending}>`. `resumeClaimed` = the current `resumeToolAfterPermission` continuation (tool execution + loop continuation) / `answerPlanQuestion` continuation, with: `onResumed` called at start; the fire-and-forget `void this.loop.run(...)` (`:1941-1959`, `:2094-2115`) REPLACED by `const result = await this.loop.run(...); await this.handleLoopResult(...); return <mapped AIChatSegmentOutcome>`; a second pause returns `paused_for_*` outcome to the caller. Question kind persists the answer via `planModule.answerQuestion` AFTER the claim (a persist failure finalizes failed, never re-executes).
- [ ] Legacy compat: keep `resumeToolAfterPermission`/`answerPlanQuestion` as wrappers that claim + `resumeClaimed` with the ORIGINAL pending sink and return `ResumeTurnResult` (legacy V2 sends, scheduled, subagent-adjacent paths — FR-013). Their continuation outcome is settled through the stored sink (existing behavior).
- [ ] Coordinator `resumeRun` (design §3.5):

```typescript
async resumeRun(input: {
  readonly conversationId: string;
  readonly runId?: string;
  readonly action:
    | { readonly kind: "permission"; readonly toolCallId: string }
    | { readonly kind: "answer"; readonly questionId: string; readonly answers: AskUserQuestionAnswer[] };
}): Promise<{ ok: boolean; error?: string }>;
```

  Flow: find live run (liveRuns by conversation; `runId` mismatch → `{ok:false}`); claim via engine (`already_claimed` → `{ok:true}` idempotent; `not_found` → `{ok:false,"No pending action"}`); `transition(runId,"queued")`, `live.status="queued"`, `live.resumeClaim = claim (+answers)`, `scheduler.submit`, `pump()`. On dispatch (`executeDispatch` resume branch): reacquire lease → `transition("running")` → `engine.resumeClaimed(claim, {lifecycle})` → outcome → A1 handling (another pause parks again with the SAME `LiveRunState`/adapter → sequence continuity, FR-005). `cancelRun` queued branch must also `engine.cancelClaimed(conversationId)` before finalizing cancelled.
- [ ] Move the adapter into `LiveRunState` (`adapter: AIChatRunEventAdapter`, created at `startRun`/`dispatchQueuedTurn`/`resumeRun` claim time) so resumed segments continue the sequence instead of restarting at 1 (FR-005; today the closure accidentally preserves it — make it explicit).
- [ ] IPC routing (`handleResumeToolAfterPermission` `:1034-1069`, `handleAnswerQuestion` `:1346-1377`): after gates/validation, if `getAiChatWorkspaceCoordinator().ownsConversation(conversationId)` (live run exists) → `coordinator.resumeRun(...)`; else → legacy engine wrapper. Deny paths unchanged (Stop-based, produce cancelled through the owner now).
- [ ] Remove `settleDetachedTerminal` + `dispatchSettled` once coordinator-owned resume paths settle via outcomes. Keep a guard: a terminal chunk arriving with no live run is dropped with a diagnostic log (late straggler), never applied.
- [ ] Run all Stage A tests + `yarn testmain`.
- [ ] Commit: `feat: permission/plan-question resume re-enters through the run owner with lease and capacity (FR-010/024)`

## Task A-VER: Stage A gate

- [ ] `yarn testmain` — no new failures (record pre-existing separately).
- [ ] `yarn vitest --config vitest.service.config.mjs run` — green.
- [ ] `yarn test:components` — green. `yarn typecheck` + `yarn vue-typecheck` — 0 errors.
- [ ] Map every Stage A acceptance scenario (AC-02/03/04/05/06/07/08/10/11/12/13/15/16/17/18) to a passing test by name in `docs/prd/generator-streaming-p0-inventory.md` (append a traceability table).
- [ ] Create `docs/prd/generator-streaming-operations.md`: Stage A behavior changes (resume now capacity-bound; unclassified exits fail; strict persistence), rollback = release revert, perf-budget measurement procedure (presenter-intake latency, 30 runs, fixtures) as the release gate record template.
- [ ] Commit: `docs: Stage A traceability and operations/rollback record`

---

# STAGE B (execute after Stage A is green; each phase independently shippable)

## Task B1: Provider iterator + callback facade

**Files:**
- Modify: `src/service/aiProvider/ChatProviderClient.ts` (`ChatProviderStreamEvent`, `ChatProviderIterationOptions`, `streamEvents`)
- Modify: `src/service/aiProvider/OpenAIStreamParser.ts` (native `parseBodyStream` async generator; callback API delegates)
- Modify: `src/service/aiProvider/OpenAICompatibleProviderClient.ts` (native `streamEvents`)
- Modify: `src/api/aiChatApi.ts` (`openAIChatCompletionStreamEvents`; callback API becomes facade)
- Test: `test/vitest/utilitycode/openAIStreamParser.test.ts` (extend), `test/vitest/main/service/chatProviderStreamEvents.test.ts` (new)

- [ ] **Failing tests**: split UTF-8 frames; fragmented tool-call argument deltas; usage-only final frame; `[DONE]` terminator with trailing buffered payload ignored; keepalive/comment lines; early consumer `return()` cancels the body reader (`body.cancel` called, reader lock released); abort before/during read rejects promptly; local+hosted retry events yield in causal order ({type:"retry"} then next chunk); facade invokes `onChunk`/`onRetry`/`onRecoveryStatus` exactly once per yielded event.
- [ ] Types per design §5.1 (`ChatProviderStreamEvent` = chunk|retry|recovery union; `ChatProviderIterationOptions` = `{signal, retryProfile?}`); `streamEvents(request, options): AsyncIterable<ChatProviderStreamEvent>` on `ChatProviderClient`.
- [ ] Convert `OpenAIStreamParser` to expose `async *parseBodyStream(body, signal): AsyncGenerator<OpenAIChatCompletionChunk, void, void>` — incremental decode with retained partial frames, `[DONE]` stop, `finally` releasing the reader/cancelling the body. Existing callback entry points delegate by draining this generator.
- [ ] `OpenAICompatibleProviderClient.streamEvents`: fetch → status/body checks → `yield* parseBodyStream(body, signal)`; cleanup in `finally`; `stream()` (callback) consumes `streamEvents`.
- [ ] `AiChatApi.openAIChatCompletionStreamEvents(request, options): AsyncIterable<ChatProviderStreamEvent>`: restructure `openAIChatCompletionStreamHosted`'s retry/endpoint-fallback loop to yield `{type:"chunk"}`/`{type:"retry"}`/`{type:"recovery"}` in place of callbacks (ONE retry implementation — the callback `openAIChatCompletionStream` becomes a draining facade). Local path delegates to the local client's `streamEvents`. Preserve: connection timeout vs stream-inactivity timeout vs recovery classification; abort listener cleanup on every exit.
- [ ] Run parser + new provider tests; `yarn testmain`.
- [ ] Commit: `feat: provider streamEvents async iteration with callback facade (FR-001 seam, B1)`

## Task B2: Generator loop, multiplexer, consumer

**Files:**
- Create: `src/service/aiChat/LatestValueSlot.ts`
- Create: `src/service/aiChat/consumeGenerator.ts`
- Modify: `src/service/AIChatQueryEvents.ts` (`AIChatLoopEvent`, `AIChatQueryGenerator`)
- Modify: `src/service/AIChatQueryLoop.ts` (`iterate()` single implementation; `run()` draining facade; `runToolWithProgress`)
- Test: `test/vitest/main/service/aiChatConsumeGenerator.test.ts`, `test/vitest/main/service/LatestValueSlot.test.ts` (new), extend `AIChatQueryLoop.test.ts`

- [ ] **Failing tests**: `consumeGenerator` returns the generator's final value; event-handler rejection → `abortProducer` called (sync, non-throwing), iterator closed, primary error re-thrown, cleanup error reported separately, never success; cancelled generator returns cancelled result. `LatestValueSlot`: set→changed resolves, latest-only retained under burst, close ignores late sets. Loop: `iterate()` yields tool_call BEFORE tool start and only after the consumer advances (assert via a gate in the consuming test); progress burst from a tool coalesces to latest-per-tool and never fails the segment; sync + async tools; supersede (isActiveTurn false mid-stream) aborts the provider request and closes the generator with no late deltas.
- [ ] Implement `LatestValueSlot` + `consumeGenerator` exactly per design §6/§12 (64 KiB progress cap → minimal phase/counts replacement event with count-only diagnostic; `undefined as never` confined to the close boundary).
- [ ] Type: `export type AIChatLoopEvent = Exclude<AIChatQueryEvent, { type: "complete" | "cancelled" | "error" }>;` and `export type AIChatQueryGenerator = AsyncGenerator<AIChatLoopEvent, AIChatQueryLoopResult, void>;`
- [ ] Loop conversion: define `AIChatQueryGeneratorInput` (= `AIChatQueryLoopInput` minus `eventSink`) and `async *iterate(input): AIChatQueryGenerator` — convert `runOnce`'s emissions (`eventSink.emit(x)` → `yield x`; drop `await eventSink.flush?.()` — the consumer provides the barrier) and wrap tool execution with `yield* runToolWithProgress(...)`. `run(input)` becomes the facade: create the legacy sink, drain `iterate()` forwarding events, and `await sink.flush?.()` after each `tool_call`/`tool_result` yield to preserve persist-before-execute ordering (design §5.2). `isActiveTurn` supersede in generator mode: consumer stop aborts the provider signal; generator `finally` closes the progress slot.
- [ ] Run loop tests + `AIChatQueryLoopCancellation.test.ts` + `AIChatQueryLoopAsyncPermission.test.ts` (facade parity) — PASS.
- [ ] Commit: `feat: single generator loop implementation with progress multiplexer and result-preserving consumer (FR-001/016, B2)`

## Task B3: Delivery-mode flag + owner consumer switch

**Files:**
- Create: `src/service/aiChat/AIChatStreamImplementationConfig.ts`
- Modify: `src/service/AIChatQueryEngine.ts` (generator-mode consumer using `consumeGenerator` with §8 event-handler table; mode captured per run)
- Test: `test/vitest/main/service/AIChatStreamImplementationConfig.test.ts` (new), engine tests

- [ ] **Failing tests**: invalid env values → default `callback` + logged; injected mutable provider: change mode mid-run and while paused → each run keeps its captured mode through resume; next new run uses the new mode (AC-14). Generator-mode engine: events reach the sink in order, tool_call persistence awaited before tool start, final outcome returned, cancellation aborts producer, forced close never reports success.
- [ ] Config: `AI_CHAT_STREAM_IMPLEMENTATION=callback|generator` read once at startup through an injectable provider (default `callback`; validate + log chosen mode only). Capture on the run/turn state at acceptance; every segment + resume of that run uses the captured mode.
- [ ] Engine switch (owner-side only — the loop has ONE implementation after B2): `callback` mode keeps the Stage A sink path; `generator` mode drains `iterate()` via `consumeGenerator` with the §8 required-write handler (token/reasoning forward-only; usage_update tracks attribution; tool_call → forward + await save before next; tool_result → forward + await save; pause → park + `onAwaiting`). Never fail over mid-run; never run both consumers against real tools.
- [ ] Run engine + integration tests; `yarn testmain`.
- [ ] Commit: `feat: AI_CHAT_STREAM_IMPLEMENTATION delivery-mode switch with per-run pinning (FR-018, B3)`

## Task B-VER: Final gates

- [ ] `yarn testmain`, service vitest, `yarn test:components`, `yarn typecheck`, `yarn vue-typecheck` — all green.
- [ ] E2E smoke (`yarn build:e2e && xvfb-run -a yarn playwright test test/e2e/specs/workspace-shell.test.ts test/e2e/specs/toolApproval.test.ts test/e2e/specs/aiChatQueueSteering.test.ts test/e2e/specs/aiChatLifecycle.test.ts`) — pass or record pre-existing failures separately.
- [ ] Append Stage B traceability (AC-01/09/14/19) + rollback steps to `docs/prd/generator-streaming-operations.md`.
- [ ] Commit: `docs: Stage B traceability and rollback record`

---

## Self-review notes

- Spec coverage: FR-001→B2, FR-002/003→B1/B2 parity tests, FR-004/005→A3a, FR-006→A2a+A2c, FR-007→A2a, FR-008→A1/A3b cancellation tests, FR-009→A1, FR-010→A3b, FR-011→A2a no-retry + B1 retry parity, FR-012→presenter tests untouched (compat), FR-013→A3b legacy wrappers + B tests, FR-014→existing gates preserved (tests assert), FR-015→B1/B2 cleanup tests, FR-016→B2, FR-017→A2a/A2c, FR-018→B3, FR-019→existing reconciliation untouched (AC-13 via existing restart tests), FR-020→P0 inventory, FR-021→A2b, FR-022→A1, FR-023→A2b, FR-024→A3b, FR-025→preserved (plan tests exist in AIChatQueryLoop.test.ts), FR-026→B2.
- Performance budgets (PRD §5) are release-gate measurement work: the procedure + fixture requirements are recorded in the ops doc (Task A-VER); in-session functional gates are the scenario tests.
- Rollback: Stage A = release revert (no schema/format change). Stage B = mode flag to `callback` (new runs only) per ops doc.
