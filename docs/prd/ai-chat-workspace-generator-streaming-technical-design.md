# AI Chat Workspace Generator Streaming — Technical Design

## Document information

| Field | Value |
| --- | --- |
| Status | Proposed — interfaces and file additions below are design targets |
| Version | 1.1 |
| Date | 2026-09-26 |
| Requirements | [Generator streaming PRD](./ai-chat-workspace-generator-streaming-prd.md) |
| Inspected baseline | `f43d5f6b` (v1.0 inspected `a21ba198`) |
| Technology | Existing TypeScript, Electron, Vue 3, Pinia, TypeORM, SQLite, Fetch/SSE |

## 1. Decision and terminology

Deliver in two stages (PRD §1):

- **Stage A** makes the execution contract explicit on the existing sink transport: outcome-returning engine entry points, explicit lifecycle notifications, strict required persistence, one owner and a durable run for every workspace-visible turn, and a single finalization path for post-terminal side effects.
- **Stage B** replaces the transport: an async iterable for provider output and an async generator for query-loop events. `AIChatQueryLoopResult` stays the final return value of an execution segment. A main-process engine consumer processes events and obtains that return value. Run owners continue to own runs and IPC delivery.

Stage A lands first so that Stage B is a refactor with a regression net, not the vehicle for reliability fixes.

An **execution segment** runs until completion, cancellation, failure, or a pause requiring external input. A **run** is the durable workspace execution identity and may span several segments. A **provider attempt** is one HTTP streaming request within a segment. A **round** is a model/tool iteration. A **run owner** is the main-process component that accepts a run, holds its lease and scheduler capacity, consumes its segment outcomes, and publishes its terminal state. These lifetimes must not be collapsed into one iterator-end signal.

`yield` suspends generator execution until the consumer advances it. It is not a thread, a broadcast mechanism, or a durable checkpoint. `return` terminates that generator and carries its final value. `for await` consumes yielded values but does not expose the final return value. A generator cannot yield while it is awaiting another Promise; events produced by callbacks during that await need a multiplexer (§12).

The proposed design needs no new runtime dependency. Preserve ordinary Promise-returning APIs for nonstreaming completion, run acceptance, database operations, and commands such as Stop.

## 2. Source map and current behavior

Paths below link to current source, not proposed implementations.

| Source | Current responsibility | Migration impact |
| --- | --- | --- |
| [ChatProviderClient.ts](../../src/service/aiProvider/ChatProviderClient.ts) | `complete()` and callback `stream(): Promise<void>` | Stage B: add iterator API; retain temporary callback facade |
| [OpenAIStreamParser.ts](../../src/service/aiProvider/OpenAIStreamParser.ts) | Fetch-body SSE parsing and chunk callbacks | Stage B: incremental generator parsing and resource cleanup |
| [OpenAICompatibleProviderClient.ts](../../src/service/aiProvider/OpenAICompatibleProviderClient.ts) | Local/OpenAI-compatible streaming | Stage B: yield chunks through provider contract |
| [aiChatApi.ts](../../src/api/aiChatApi.ts) | Provider resolution, hosted streaming, `onRetry`/`onRecoveryStatus`, retry profiles, SSE handling | Stage B: preserve hosted and local differences while exposing iteration; size the retry conversion in P0 |
| [AIChatQueryLoop.ts](../../src/service/AIChatQueryLoop.ts) | Model/tool rounds; provider access through `AIChatQueryLoopDeps.streamChatCompletion`; sink emissions; loop result | Stage A: classify required-persistence failures. Stage B: native yields, progress multiplexer, single implementation |
| [AIChatQueryEvents.ts](../../src/service/AIChatQueryEvents.ts) | Event union, sink/flush, loop result, pending-state, `AIChatTurnTerminalEvent` | Stage A: segment outcome and lifecycle types. Stage B: yielded-event type; pending context without sink |
| [AIChatQueryEngine.ts](../../src/service/AIChatQueryEngine.ts) | Preparation, active/pending turns, persisting sink, loop outcomes, resume, post-terminal side effects | Stage A: outcome entry point, strict persistence, finalization path, owner-driven resume. Stage B: generator consumer |
| [AIChatQueryEngineFactory.ts](../../src/service/AIChatQueryEngineFactory.ts) | Builds scheduled engines and wires `streamChatCompletion` | Provider-seam and contract migration |
| [ai-chat-v2-ipc.ts](../../src/main-process/communication/ai-chat-v2-ipc.ts) | Shared engine singleton (`getQueryEngine`), legacy send, permission resume and plan-answer handlers, queue service wiring and its broadcast sink | Stage A: route resume through run owners; replace synthetic queue run IDs |
| [ai-chat-workspace-ipc.ts](../../src/main-process/communication/ai-chat-workspace-ipc.ts) | Coordinator wiring, `onRunTerminal` → queue, `busySubmit`, restart reconciliation | Stage A wiring |
| [AIChatCoordinator.ts](../../src/service/AIChatCoordinator.ts) | Run acceptance, busy-send delegation, scheduler/lease, run sink, status sampling, parked-turn detached settlement | Stage A: consume outcomes and lifecycle notifications; own resume |
| [AIChatTurnQueueService.ts](../../src/service/AIChatTurnQueueService.ts) | Durable pending queue, FIFO drain via `submitPersistedUserMessage`, hold/re-drain, steering | Stage A: drained turns get durable runs and one execution owner |
| [AIChatRunOwnerAdapter.ts](../../src/service/AIChatRunOwnerAdapter.ts) | Durable run envelope for non-coordinator owners (scheduled) | Reuse for owner-envelope semantics |
| [ScheduledAiMessageRunner.ts](../../src/service/ScheduledAiMessageRunner.ts) | Scheduled turns on factory-built engines with an owner-adapter sink | Shared-caller compatibility |
| [AgentRuntime.ts](../../src/service/AgentRuntime.ts) | Subagents construct `AIChatQueryLoop` directly with their own deps and sink | Shared-caller compatibility; Stage B loop contract |
| [aiChatV2StreamSink.ts](../../src/service/aiChatV2StreamSink.ts) | Maps engine events to `ChatV2StreamChunk` | Mapping facade retained |
| [AIChatRunEventAdapter.ts](../../src/service/AIChatRunEventAdapter.ts) | Adds run identity and sequence to chunks | Stage A: one adapter per run held in run context |
| [AIChatExecutionScheduler.ts](../../src/service/AIChatExecutionScheduler.ts) | Priority tiers, capacity, aging, requeue | Resume capacity (§3.5) |
| [AIChatEventRouter.ts](../../src/service/AIChatEventRouter.ts) | Selected details and global summaries | Keep transport/subscription ownership |
| [selectedConversation.ts](../../src/views/store/selectedConversation.ts) | Selection handshake, sending/stopping, pending-queue swap, detail subscriptions | Preserve public API and selection guards |
| [workspaceStreamPresenter.ts](../../src/views/utils/workspaceStreamPresenter.ts) | Batched projection, duplicate/stale rejection, `removeMessage` | Keep batching and immediate control-event flush |
| [AuthenticatedWorkspaceLayout.vue](../../src/views/layout/AuthenticatedWorkspaceLayout.vue), [AppWorkspaceShell.vue](../../src/views/components/appShell/AppWorkspaceShell.vue), [AiChatCenterSurface.vue](../../src/views/components/aiChatWorkspace/AiChatCenterSurface.vue) | Chat-first shell hosting the workspace (the standalone `AiChatWorkspaceShell.vue` was removed) | Target UI validation; shared V2 imports remain |

Current execution flows:

```text
Direct send (conversation idle)
Workspace -> selectedConversation -> workspace IPC -> coordinator.startRun
  -> scheduler + lease -> engine.submitMessage({ request, eventSink: runSink })   // Promise<void>
    -> loop.run({ ..., eventSink: persistingSink(runSink) })
      -> deps.streamChatCompletion(request, onChunk, { onRetry, onRecoveryStatus })
      -> eventSink.emit(event)
    <- AIChatQueryLoopResult handled inside the engine
  -> coordinator: terminal chunk held, or sampled pause, else default "completed"

Busy send
coordinator.startRun -> busySubmit -> queue service (durable pending row)
  ... on terminal re-drain -> engine.submitPersistedUserMessage(...)   // returns AIChatTurnTerminalEvent
      eventSink = createBroadcastEventSink()   // synthetic runId "pending-queue-N", no run row

Permission approval
Renderer -> V2 IPC resume handler -> engine.resumeToolAfterPermission
  -> engine runs the approved tool directly (outside the loop)
  -> void loop.run(...) with pending.eventSink (the original owner's sink closure)
  -> terminal reaches coordinator.settleDetachedTerminal via that closure
```

Important baseline details:

- `emitToolCall` emits `tool_call` and then awaits `eventSink.flush()` before executing, so persist-before-execute ordering already exists. `createPersistingEventSink()` forwards the event *before* scheduling the save, logs and swallows save errors, and flushes with `Promise.allSettled`. Stage A changes failure strictness, not ordering.
- The loop reaches providers through `AIChatQueryLoopDeps.streamChatCompletion(request, onChunk, { signal, onRetry, onRecoveryStatus })`, wired in `AIChatQueryEngineFactory`, `ai-chat-v2-ipc.ts`, and `AgentRuntime`. The loop also runs its own transient retry and recovery layers (`transientRetryConfig`, `recovery_status`).
- The loop never publishes `complete`/`cancelled`/`error` events; it returns results. The engine publishes terminal events after `saveAssistantMessage`.
- `submitMessage()` returns `Promise<void>`. `submitPersistedUserMessage()` already returns `AIChatTurnTerminalEvent`, including paused and busy outcomes.
- The coordinator samples engine runtime status on each non-token chunk and once after `submitMessage` resolves. With no terminal chunk and no sampled pause, it records `completed` (or `cancelled` if Stop was requested).
- A paused run's later terminal (resume completion, or deny/stop) arrives on the original run sink and is settled by `settleDetachedTerminal`. The run adapter is created per dispatch; sequence continuity across resume exists only because `pending.eventSink` captures that adapter in a closure.
- Pending permission/question structures contain an event sink and an abort controller. They cannot be serialized or treated as generator state.
- Permission resume re-executes the approved tool directly (outside the loop, with `seededToolImages`) and continues with a fire-and-forget `void this.loop.run(...)`. It runs outside the coordinator's scheduler and lease.
- `tool_progress` is emitted by callbacks — `emitProgress` in the tool execution context and the async-job poller — while the loop awaits the tool. The baseline loop executes tool calls sequentially.
- `SubmitPlanForApproval` records the plan and the loop continues (`continue`); the turn can then complete. Only permission and plan-question pauses exist in `AIChatQueryLoopResult`.
- After completed/cancelled/failed results, the engine runs post-terminal side effects: auto-compact or session-memory update, auto-dream triggers, desktop notification, Stop hooks (`dispatchStop`), staged batch-reference cleanup, and context-window emergency compaction on failure. The coordinator then notifies the queue (`onRunTerminal`).
- `ChatRunOwner` is `interactive | scheduled | goal | agent`. `ChatRunStatus` is `queued | running | awaiting_permission | awaiting_user | completed | failed | cancelled | interrupted`.

## 3. Stage A — explicit execution contract

### 3.1 Segment outcome entry point

Name the existing classification as the segment outcome rather than adding a second union:

```typescript
type AIChatSegmentOutcome = AIChatTurnTerminalEvent;
```

Add an outcome-returning engine entry point that shares its implementation with `submitPersistedUserMessage()`, for callers whose user message the engine still persists:

```typescript
interface OutcomeReturningEngine {
  runTurn(input: AIChatQuerySubmitInput): Promise<AIChatSegmentOutcome>;
}
```

`submitMessage(): Promise<void>` becomes a deprecated wrapper over `runTurn` for callers not yet migrated. `CoordinatorEngine` gains `runTurn`. The coordinator derives the run status from the outcome only:

| Outcome | Run status |
| --- | --- |
| `completed` / `cancelled` / `failed` | Same terminal status |
| `paused_for_permission` | `awaiting_permission` |
| `paused_for_plan_question` | `awaiting_user` |
| `conversation_busy` | Existing busy-send delegation; no new segment claimed |
| Engine throws, or no outcome | `failed` with `errorCode: "unclassified_segment_exit"` and a diagnostic |

The default-to-completed branch and the post-dispatch status sample are removed. The terminal chunk is still held and routed after the durable transition, as today.

### 3.2 Lifecycle notifications

Add an owner-supplied lifecycle listener to the engine input instead of sampling:

```typescript
interface AIChatTurnLifecycleListener {
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

The engine calls `onAwaiting` exactly once when it parks a turn and `onResumed` exactly once when a claimed resume starts executing. The owner persists the run transition, then broadcasts the summary (persistence precedes hints, as today). Listener methods are synchronous and non-throwing; the owner serializes its own async work. These are internal notifications mapped onto existing IPC payloads; no new IPC event types are exposed without matching schemas and presenter support.

### 3.3 Strict required persistence

- `createPersistingEventSink()` keeps forwarding `tool_call` before saving, so the UI stays responsive, but required saves (tool call, tool result) no longer swallow errors. `flush()` rejects with a typed `AIChatRequiredPersistenceError` carrying the tool call ID and a safe code.
- `emitToolCall` already awaits `flush()`. A rejection propagates before the tool starts, and the loop returns `failed`. Required-persistence errors are excluded from transient provider retry and recovery layers.
- The engine publishes the failure with `errorCode: "tool_call_persist_failed"` or `"tool_result_persist_failed"` and the affected `toolCallId`. `AIChatQueryErrorEvent` gains an optional `toolCallId`. The presenter marks that tool card "not run" (call failed) or "result not saved" (the tool ran but its result could not be stored). A tool whose result failed to persist is never re-run.
- Tool-card failure states are a UI change: add component tests and localized strings in all six languages.

### 3.4 Durable run identity for queue-drained turns

The queue service remains the FIFO/steering policy owner. The coordinator becomes the execution owner of drained rows:

```typescript
interface QueueExecutionOwner {
  dispatchQueuedTurn(input: {
    readonly conversationId: string;
    readonly pendingMessageId: string;
    readonly request: ChatV2StreamRequest;
  }): Promise<AIChatSegmentOutcome>;
}
```

`dispatchQueuedTurn` creates a durable run (`owner: "interactive"`), uses the same scheduler, lease, run context, adapter, and finalization path as a direct send, and returns the segment outcome to the queue, which drains or holds exactly as today. `createBroadcastEventSink()` and its `pending-queue-N` IDs are removed. The queue's own lease (`ownerId: "pending-queue"`) is replaced by the coordinator's lease. Existing broadcaster emissions required by other surfaces stay in the run sink.

### 3.5 Resume through the run owner

Resume requests (permission grant/deny, plan answer) are routed by the IPC handler to the run owner that parked the turn; the engine keeps an index from conversation to owning run. For coordinator-owned runs:

1. The IPC handler gates AI enablement, validates the payload, and calls `coordinator.resumeRun(runId, action)`.
2. The coordinator claims the pending action through the engine (`claimPendingPermission` / `claimPendingQuestion`). Claiming is idempotent: a second or stale claim returns the existing result and never re-executes.
3. The coordinator transitions the run to `queued`, submits it to the scheduler at the `SelectedInteractive` tier (P0 confirms the tier), and keeps the conversation held so no other direct send dispatches ahead of it. Busy sends continue to go to the durable queue.
4. On dispatch it reacquires the lease and calls `engine.resumeClaimed(claim, { lifecycle, eventSink })`, which returns `Promise<AIChatSegmentOutcome>`. The approved tool still executes first and directly (as today), followed by the continuation loop. The coordinator awaits the outcome and handles it exactly like §3.1, including another pause.
5. Stop while queued for resume cancels the claim, finalizes the run as `cancelled`, and never starts the tool.

Deny keeps the existing policy but produces a `cancelled` segment outcome delivered to the owner instead of a detached terminal. `settleDetachedTerminal` is removed once every resume path returns outcomes. The fire-and-forget `void this.loop.run(...)` becomes an awaited, owner-observed Promise.

The coordinator's live-run state holds the run's `AIChatRunEventAdapter`, so sequence continuity no longer depends on the sink closure in pending state. Callers that are not coordinator-owned (scheduled runner, legacy V2 send) keep a compatibility path: the engine resolves their continuation through the stored sink until they migrate.

This is an intentional behavior change: today resume bypasses scheduler capacity. Tests must cover approval while capacity is full.

### 3.6 Single finalization path

Move completed/cancelled/failed handling into one engine `finalizeSegment(outcome)` that runs in this order: persist assistant content/metadata, then publish the terminal event, then run post-terminal side effects. The owner then persists the run transition, routes the held terminal detail, and calls `onRunTerminal` once per run (not per segment). Pauses run none of the side effects. Tests count each side effect per outcome.

## 4. Target ownership and flow (Stage B)

```text
                       Electron main process
 Provider iterator
   | provider events (chunk / retry / recovery)
   v
 Query-loop generator -------- returns segment result
   | normalized nonterminal events             |
   v                                           v
 Engine consumer -> required Model/Module writes -> finalizeSegment
   | domain progress + explicit segment outcome + lifecycle notifications
   v
 Run owner (coordinator / scheduled runner / subagent host) -> durable run transitions
   | run adapter -> event router
   v
 IPC serialization
 ---------------------- process boundary -----------------------
 Pinia store -> workspace presenter -> workspace Vue components
```

| Owner | Owns | Does not own |
| --- | --- | --- |
| Provider/parser | HTTP body, incremental decoding, request-level abort | Workspace run status or DB writes |
| Query loop | Model/tool ordering, normalized progress, segment result | Renderer subscription lifetime |
| Engine | Generator draining, required persistence, pending turn context, finalization | Vue rendering or direct database work in IPC |
| Run owner | Run identity, admission, lease/capacity, segment lifecycle, resume, terminal routing | Parsing model SSE |
| Queue service | FIFO, hold/re-drain, steering policy | Executing turns (delegated to the coordinator) |
| Router | Fan-out to currently subscribed windows | Driving execution or retrying work |
| Presenter | Batched view projection and stale/duplicate filtering | Provider cancellation or execution ownership |

Only one consumer advances a given generator. Multiple windows subscribe after the owner/router. No separate iterator per observer; no generator `.next()` calls originating from renderer IPC.

## 5. Proposed Stage B contracts

The following types are design sketches. Existing names are retained where useful; new names are not currently exported.

### 5.1 Provider output

```typescript
type ChatProviderStreamEvent =
  | { readonly type: "chunk"; readonly chunk: OpenAIChatCompletionChunk }
  | { readonly type: "retry"; readonly info: StreamRetryInfo }
  | { readonly type: "recovery"; readonly info: StreamRecoveryInfo };

interface ChatProviderIterationOptions {
  readonly signal: AbortSignal;
  readonly retryProfile?: AIChatRecoveryProfile;
}

interface StreamingChatProvider {
  streamEvents(
    request: OpenAIChatCompletionRequest,
    options: ChatProviderIterationOptions
  ): AsyncIterable<ChatProviderStreamEvent>;
}
```

`StreamRetryInfo` and `StreamRecoveryInfo` already exist in `aiChatApi.ts`. All incremental provider status travels in this stream in causal order. Preserve available provider options during inventory; do not silently drop richer hosted options to fit the narrower local interface. Keep nonstreaming `complete()` unchanged. The parser itself can yield `OpenAIChatCompletionChunk`; request/retry layers add the provider envelope.

The loop's dependency seam changes from `AIChatQueryLoopDeps.streamChatCompletion` to `streamEvents`, updated at all three wiring sites (engine factory, V2 IPC, `AgentRuntime`). The temporary `stream(request, onChunk, options)` and `streamChatCompletion` facades consume `streamEvents()`, call legacy callbacks, and resolve after stream cleanup. The facade is an outward compatibility boundary, not a second provider implementation.

### 5.2 Query-loop output and result

```typescript
type AIChatLoopEvent = Exclude<
  AIChatQueryEvent,
  { type: "complete" | "cancelled" | "error" }
>;

type AIChatQueryGenerator = AsyncGenerator<
  AIChatLoopEvent,
  AIChatQueryLoopResult,
  void
>;
```

The loop already publishes no terminal events, so this narrowing matches current behavior. The core loop yields nonterminal progress and returns its result; the engine's `finalizeSegment` remains the single terminal publisher. Engine-owned `start` events and prepare-time errors stay in the engine.

Use `yield*` for helpers that naturally produce the same event stream and return useful values. Do not convert every helper into a generator: pure calculations, repository calls, and single-result tool APIs remain ordinary functions/Promises.

**Single implementation.** Define a new generator input containing the existing execution fields but no `eventSink`, and make `iterate(input)` the only loop implementation. From phase B2, `run(oldInput)` is a thin facade that drains `iterate()` into the legacy sink (awaiting `flush()` where the sink provides it) and returns the result. There is no second copy of the loop to keep in sync. The facade must not bypass required persistence or persist an event twice.

### 5.3 Segment completion

Stage A's `AIChatSegmentOutcome` (§3.1) is the Stage B segment result; Stage B only changes how it is produced. Run completion is derived from that outcome after required persistence, never from `done: true` alone.

## 6. Consuming a generator without losing its result

Use one helper for typed sequential draining. This standalone algorithm illustrates the consumer contract; production integration supplies ownership-specific cancellation and cleanup diagnostics.

```typescript
export async function consumeGenerator<E, R>(
  iterator: AsyncGenerator<E, R, void>,
  onEvent: (event: E) => Promise<void>,
  abortProducer: (reason: unknown) => void,
  onCleanupError: (error: unknown) => void
): Promise<R> {
  try {
    for (;;) {
      const step = await iterator.next();
      if (step.done === true) return step.value;
      await onEvent(step.value);
    }
  } catch (error: unknown) {
    abortProducer(error);
    try {
      await iterator.return(undefined as never);
    } catch (cleanupError: unknown) {
      onCleanupError(cleanupError);
    }
    throw error;
  }
}
```

The forced `.return()` value is deliberately ignored. `undefined as never` is confined to this cleanup boundary because a forcibly closed generator has no valid domain outcome to supply. Never route its synthetic completion as success. An implementation may use a dedicated iterator-close utility instead, with the same rule.

Requirements for this helper's integration:

- `abortProducer` must be synchronous and nonthrowing; diagnostics must not replace the primary error.
- Engine-level handling classifies exceptions, persists a safe outcome where possible, and publishes the appropriate failure once.
- Expected cancellation should normally let the generator return its cancelled result; external Stop first aborts the producer and the engine keeps draining to the result.
- Generator `finally` blocks release resources and must not yield additional business events.
- `.return()` alone cannot interrupt a pending network read; abort/cancel the underlying operation first.
- Never launch an unobserved consumer Promise. Its owner must handle rejection and scheduler cleanup.

## 7. Provider implementation (Stage B)

Convert parsing at the native response-body boundary. Avoid collecting the full stream and yielding only after completion.

1. Validate enablement/provider configuration at the existing gate before starting the request.
2. Acquire the response body reader after checking status and body presence.
3. Decode incrementally and retain incomplete frames across reads.
4. Yield parsed chunks, preserving fragmented content, tool-call arguments, reasoning fields, final usage-only frames, and supported finish reasons.
5. Treat `[DONE]` as the stream terminator; no later buffered payload may become output.
6. Preserve supported SSE comments, keepalives, line endings, and provider-specific parsing behavior. Protocol broadening is separate work unless needed to prevent a migration regression.
7. On cancellation, early consumer close, or failure, cancel the owned response body/request as appropriate and release the reader lock in `finally`.
8. Clean up retry timers and abort listeners on every exit.

Hosted and local implementations need separate fixtures. Do not assume their existing parsers, fallback behavior, or retry support are identical. The hosted retry loop in `aiChatApi.ts` (retry profiles, endpoint fallback, structured recovery) is the largest conversion; P0 sizes it, and the callback facade stays until parity is proven. Connection timeout, stream inactivity timeout, recovery policy, and consumer processing delay must remain distinguishable; a slow required DB write must not be mistaken for a retryable provider timeout.

An iterator naturally paces application reads. It does not bound OS/network buffering or guarantee provider-side cancellation. Measure application-owned buffers and verify request cleanup explicitly.

## 8. Persistence and event ordering

Stage A makes required writes strict on the sink path (§3.3). Stage B replaces sink-side writes with an awaited engine event handler. Existing Models and Modules remain the data-access boundary.

| Event/result | Required engine action before advancement/publication |
| --- | --- |
| `token`, `reasoning_delta` | Update current accumulation/projection as needed and forward; no new per-token SQL writes |
| `usage_update` | Update latest usage context so subsequent tool records retain attribution |
| `tool_call` | Forward, then await tool-call message persistence before requesting the next loop event and before executing the tool; on failure, abort the segment with `tool_call_persist_failed` |
| `tool_progress` | Forward safe progress; no durable per-progress log |
| `tool_result` | Await required result persistence before advancing to dependent model/tool work; on failure, abort with `tool_result_persist_failed` and never re-run the tool |
| Plan/question events | Preserve existing plan-module writes; do not duplicate persistence merely because transport changed |
| Completed/cancelled result | `finalizeSegment`: persist assistant content/metadata, publish terminal event, run post-terminal side effects; owner then transitions the durable run |
| Failed result | Persist safe partial/error state where possible; publish once; run failure side effects (emergency compaction when applicable); never announce durable success after a failed write |
| Pause result | Park pending context, call `onAwaiting`; no terminal event and no post-terminal side effects |

The loop must yield `tool_call` before invoking `executeTool()`. This is invalid:

```text
start tool promise -> yield tool_call -> await promise
```

The correct order is:

```text
yield tool_call -> engine saves -> engine calls next -> loop starts tool
```

Do not hold a database transaction across network requests or human approval. Await narrow writes/transactions. If required persistence fails, abort the segment and prevent dependent actions. A failed terminal run-state write permits a transient delivery/storage error indication, but never a misleading durable-success notification. Restart reconciliation remains the authority if durable finalization was impossible.

Persistence does not guarantee exactly-once external side effects. Keep existing tool IDs, authorization claims, and idempotency protections; an interrupted email/browser action must not be blindly retried.

## 9. Run and segment lifecycle

```text
queued -> running -> completed | failed | cancelled
              |
              +-> awaiting_permission -> queued (resume claimed) -> running (new segment)
              |
              +-> awaiting_user ------> queued (answer claimed)  -> running (new segment)

running / waiting / queued -> interrupted on restart reconciliation as applicable
```

These states map onto the existing `ChatRunStatus`; no new status is added.

| Segment outcome | Owner action |
| --- | --- |
| Completed | Persist completed state, publish held terminal event, notify queue once, release run context |
| Cancelled | Persist partial/cancelled state and publish once; no new segment |
| Failed/thrown/unclassified | Persist failure where possible; publish a safe failure; never default to completed |
| Permission pause | Retain logical run and pending context; transition to awaiting permission; no terminal event |
| Plan question pause | Retain logical run and question context; transition to awaiting user; no terminal event |
| Conversation busy | Preserve admission/queue policy; do not claim a new segment succeeded |

Release active execution capacity and the lease when a segment pauses, while keeping the conversation held for the paused run. Resume reacquires capacity and the lease before any tool/model work (§3.5); only the run owner schedules a resume.

Persist waiting state before notifying workspace summaries. Preserve the original run ID and its sequence counter across resumed segments; the adapter lives in run context.

Plan approval is not a segment outcome. `SubmitPlanForApproval` records the plan, the loop continues, and the turn may complete; approving the plan is a plan-module transition handled by the existing plan workflow (PRD FR-025).

## 10. Pause/resume context

Generators are not retained as long-lived suspended approval sessions. A segment ends with a pause outcome, releases provider resources, and stores the execution context the engine needs to resume.

Stage A adds an owning-run reference to pending structures alongside the existing `eventSink`. Stage B removes `eventSink` from pending structures; the owner supplies the event destination when it calls `resumeClaimed`. Compatibility sink references for non-migrated callers live outside canonical pending data.

Preserve, where applicable:

- Conversation, run, assistant-message, tool-call, question, and plan identities.
- Messages, next round, model/request parameters, plan context, and tool catalog snapshot.
- Trusted `sourceUserMessageId`, `intentDecisionId`, and outbound authorization fields.
- Seeded tool images from the directly executed approved tool.
- Cancellation ownership and a segment epoch used to reject late callbacks.
- The run's selected delivery mode and owner.

The resumed segment starts by executing the approved tool directly. In Stage B this becomes the first step of the resumed generator: it yields the tool's progress and result (the `tool_call` was persisted before the pause and is not re-emitted), the engine persists the result, and then the continuation loop runs.

Resume validates that the pending action still belongs to the run and has not been cancelled or consumed. Preserve current approval and denial semantics. Permission responses must use existing authorization services; `next(value)` is not a renderer-to-tool authorization channel.

Only one resume claims a pending action. A stale approval after Stop or a second identical answer is rejected or treated idempotently under existing conventions. Resume cannot recreate the user message or reset tool-call identity.

Pending runtime context is not claimed to be durable merely because it is a plain object. Preserve existing persisted plan/permission/history recovery, and mark unrecoverable active work interrupted after process restart. Never serialize an iterator or automatically replay its tool execution.

## 11. Cancellation and cleanup

Use a run-owned cancellation source and a segment/request-owned signal linked to it. Each callback adapter checks both cancellation and its segment epoch so a late callback from an old attempt cannot append to a resumed segment.

| Boundary | Stop behavior |
| --- | --- |
| Queued run | Remove/cancel admission; do not create a provider iterator |
| Resume claimed, waiting for capacity | Cancel the claim; finalize cancelled; never start the approved tool |
| Before first `.next()` | Check abort before any provider/tool side effect |
| Pending HTTP read | Abort request/cancel reader, then drain to cancelled outcome |
| Retry backoff | Cancel timer immediately; no next attempt |
| Tool running | Invoke existing cancellation hook; suppress late progress/results for cancelled ownership |
| Permission/question wait | Invalidate pending action and finalize cancellation without needing an active generator |
| Superseded turn (same-conversation re-send) | Abort its provider request, close its generator, drop late output (replaces the `isActiveTurn` check) |
| Consumer/persistence error | Abort producer, close iterator, classify failure rather than user cancellation |
| Renderer detach | Remove only the subscription; continue consuming |
| Application/database scope shutdown | Abort affected owners, complete cleanup, and reconcile durable state under existing policy |

Before starting any next model round/tool, recheck run ownership and cancellation. Resolve completion-versus-Stop races through one serialized finalization path. Once terminal state commits, a late Stop is a no-op; once cancellation wins before that commit, late provider completion cannot overwrite it.

Cleanup cannot claim to undo an already committed external action. Detached tools may finish externally; their callbacks must not resurrect the run. Generator `finally` handles streaming resources, while the owner's `finally` handles leases and scheduler capacity. Both must run without converting a pause into final run deletion.

## 12. Tool progress multiplexer (Stage B)

Tool progress is produced by callbacks while the loop awaits tool execution, so every tool call needs a multiplexer, not only some. The loop wraps each tool execution in a helper that races the tool Promise against a progress slot and yields progress as it arrives:

```typescript
async function* runToolWithProgress(
  start: (emit: (event: AIChatQueryToolProgressEvent) => void) =>
    Promise<ToolExecutionResult>,
  signal: AbortSignal
): AsyncGenerator<AIChatQueryToolProgressEvent, ToolExecutionResult, void> {
  const slot = new LatestValueSlot<AIChatQueryToolProgressEvent>();
  const toolPromise = start((event) => {
    if (!signal.aborted) slot.set(event);
  });
  const settled = toolPromise.then(
    (value) => ({ kind: "done" as const, value }),
    (error: unknown) => ({ kind: "error" as const, error })
  );
  try {
    for (;;) {
      const next = await Promise.race([settled, slot.changed()]);
      const latest = slot.take();
      if (latest) yield latest;
      if (next !== undefined) {
        if (next.kind === "error") throw next.error;
        return next.value;
      }
    }
  } finally {
    slot.close();
  }
}
```

`LatestValueSlot.changed()` resolves `undefined` when a new value is set. The sketch shows the contract, not final code.

Rules:

- **Coalesce, never fail.** Progress is current state, not a log. Keep only the latest progress per tool call; memory is bounded by the number of tool calls in flight (one at a time at the baseline, since tools run sequentially). Progress volume never aborts or fails a segment, because the tool may be performing an external action.
- **Only progress goes through the multiplexer.** Text/reasoning deltas, usage, tool calls, tool results, permission/recovery, and lifecycle events are yielded directly by the loop and are never coalesced or dropped. Final tool results travel through the tool's result Promise.
- **Oversized progress payloads.** A single progress payload above the proposed 64 KiB estimate is replaced by a minimal progress event (phase and counts, no message body) with a count-only diagnostic; it never fails the segment.
- **Close and cleanup.** After the tool settles or aborts, late progress is ignored with a count-only diagnostic. Closing removes producer listeners, abort listeners, timers, and pending resolver references.

Do not add a second unbounded queue between the engine and IPC. Keep the workspace's existing batching. The multiplexer is not evidence that application-wide backpressure is solved.

## 13. Retry, recovery, and errors

Preserve the distinction between request retry (hosted `onRetry` and the loop's transient retry), model-output recovery (`recovery_status` layers), and tool execution. Provider iterators yield retry/recovery notifications in their original order; the loop continues to emit its own recovery events. Consumer/persistence exceptions occur outside provider iteration and must not be caught as retryable transport errors.

For partial-output failures, preserve current accumulation/reset and recovery rules; never concatenate replayed text simply because another attempt yielded it. Preserve tool argument assembly by call index/ID, final usage, model/response metadata, reasoning, discovered tools, and steering transitions.

Differential traces should normalize timestamps and generated IDs while comparing payload meaning and causal order. They must also test intentional changes: required persistence failure now blocks dependent execution, pause outcomes cannot default to completed, unclassified exits fail, queue-drained turns carry durable run IDs, and resume waits for capacity.

Use `unknown` in catch blocks and typed error classifiers. Provider error details are not automatically safe UI text. Reuse safe error mapping and existing translated presentation.

## 14. Workspace and IPC compatibility

Keep existing workspace start/stop/select/history APIs. Start returns acceptance/run identity promptly (including the queued response for busy sends); it does not await the whole segment. Keep the selected-conversation detail envelope: conversation ID, run ID, sequence, emitted time, event type, and serializable payload.

Preserve:

- Subscribe-before-snapshot selection handshake and generation guards.
- Per-run monotonic sequence and duplicate/stale filtering.
- Pending-queue bubble swap and steering bubble clearing.
- Default 50 ms content/reasoning batching and immediate flush for control/terminal events.
- Redacted sidebar summaries; no inactive full-history subscriptions.
- Existing artifact and reasoning safety boundaries.

Sequence continuity is mandatory across same-process pause/resume. Sequence numbers alone cannot recover missing events; use existing authoritative history/runtime snapshots on reattachment. Do not promise lossless replay without a separately designed durable log.

Retain `createChatV2StreamSink` as a mapping facade initially. Its filename does not make it exclusive to the retiring screen. Direct neutral workspace mapping can follow after trace parity; avoid a simultaneous payload rewrite.

The permission-resume and plan-answer handlers live in `ai-chat-v2-ipc.ts` and serve the workspace. Keep their channels; change only their routing to run owners. All modified AI IPC handlers must check `Token` and `USER_AI_ENABLED` before request parsing/work. Keep contextBridge serialization/validation. No database access in renderer/IPC, no worker database access, and no new worker process required.

## 15. Migration file plan

| Area | Stage | Proposed work |
| --- | --- | --- |
| `src/service/AIChatQueryEvents.ts` | A | `AIChatSegmentOutcome` alias, lifecycle listener type, owning-run reference in pending structures, optional `toolCallId` on error events |
| `src/service/AIChatQueryEngine.ts` | A | `runTurn`, strict persisting sink, `finalizeSegment`, claim/`resumeClaimed` API, lifecycle calls |
| `src/service/AIChatQueryLoop.ts` | A | Propagate `AIChatRequiredPersistenceError` and exclude it from retry |
| `src/service/AIChatCoordinator.ts` | A | Outcome-driven status, lifecycle listener, `resumeRun`, `dispatchQueuedTurn`, adapter in run context; remove sampling and detached settlement |
| `src/service/AIChatTurnQueueService.ts` | A | Dispatch drained rows through the coordinator |
| `src/main-process/communication/ai-chat-v2-ipc.ts` | A | Route resume/answer to run owners; remove `createBroadcastEventSink` synthetic IDs |
| `src/main-process/communication/ai-chat-workspace-ipc.ts` | A | Wiring for queue execution owner and resume routing |
| `src/service/aiChatV2StreamSink.ts`, `workspaceStreamPresenter.ts`, tool-card components, `src/views/lang/*` | A | Tool-card failure states, localized strings, component tests |
| `src/service/aiProvider/ChatProviderClient.ts` | B | Provider event/options types and iterator method |
| `src/service/aiProvider/OpenAIStreamParser.ts` | B | Native iteration; callback consumption delegates to it |
| `src/service/aiProvider/OpenAICompatibleProviderClient.ts` | B | Native stream iteration |
| `src/api/aiChatApi.ts` | B | Hosted iterator, resolution, and callback facade preserving retry/recovery |
| `src/service/AIChatQueryLoop.ts` | B | `iterate()` as the single implementation, `run()` facade, `runToolWithProgress` |
| `src/service/AIChatQueryEngineFactory.ts`, `ai-chat-v2-ipc.ts`, `src/service/AgentRuntime.ts` | B | Switch the loop provider seam to `streamEvents` |
| Proposed `src/service/aiChat/consumeGenerator.ts` | B | Typed result-preserving consumer |
| Proposed `src/service/aiChat/LatestValueSlot.ts` | B | Progress multiplexer slot |
| `src/service/AIChatRunEventAdapter.ts`, `AIChatRunOwnerAdapter.ts`, `ScheduledAiMessageRunner.ts` | A/B | Compatibility review and owner-specific regression tests |

P0 records, for every consumer of `AIChatQueryLoop`, `AIChatQueryEventSink`, engine submit/resume methods, and provider streaming APIs, whether it owns a segment, a run, or a background loop. Do not assume workspace UI scope permits breaking shared backend callers.

Shared V2 components and IPC handlers remain in place initially. Extract to a neutral location in a separate change only when imports are updated and tests pass. Screen deletion is not a prerequisite for either stage.

## 16. Rollout and rollback

**Stage A** ships behind no delivery-mode flag. Its changes are contract corrections validated by tests; rollback is a release revert. Stage A adds no entity or history format, so no schema downgrade is needed.

**Stage B** introduces a proposed internal configuration `AI_CHAT_STREAM_IMPLEMENTATION=callback|generator`, read through an injectable configuration provider and defaulting to `callback` during migration. The production provider reads the environment variable once at startup; a change takes effect after restart, where existing reconciliation handles interrupted runs. Tests inject a mutable provider to exercise mode pinning. Validate values at startup and log only the chosen mode; do not expose a user-facing toggle.

Because the loop has a single implementation from B2 (§5.2), the flag switches only the owner-side consumer: `callback` drains `run()` into the Stage A sink path; `generator` uses `consumeGenerator` with the awaited engine handler. Loop-level defects are rolled back by release revert, not by the flag. Capture the mode in run context at acceptance; every segment and resume uses it. Do not run both consumers against real tools, fail over mid-stream, or restart a failed generator run on the callback path.

Stages:

1. Scripted fixtures and fake tools compare normalized traces.
2. Enable generator mode in development for workspace runs; run the full focused regression suite.
3. Enable in a controlled release after acceptance and performance gates pass.
4. Switch the default only after error/cleanup evidence is reviewed.
5. Remove the callback consumer after the rollback window; retain thin facades for callers still using callback signatures.

Rollback changes the mode for new runs only. Existing running/waiting runs drain or are explicitly stopped; they are never replayed automatically.

## 17. Test plan

| Layer | Stage | Required tests | PRD scenarios |
| --- | --- | --- | --- |
| Engine outcome | A | `runTurn` returns every outcome; unclassified exit fails; `submitMessage` wrapper unchanged for legacy callers | AC-17 |
| Persistence | A | Delayed and failed tool-call save; failed tool-result save; persistence errors never retried; tool never re-run | AC-02/08 |
| Finalization | A | Side-effect counters per outcome; none on pause; queue notified once per run | AC-18 |
| Coordinator | A | No false completion on pause; lifecycle notifications; resume claim/queue/lease; approval while capacity full; Stop while queued for resume; exactly one finalization; renderer detachment | AC-03/04/05/06 |
| Queue | A | Drained turn has durable run ID and sequence; drain/hold on returned outcome; steering unaffected | AC-10/16 |
| Consumer | B | Ordered events, all return variants, event-handler failure, generator throw, cleanup failure retains primary error, forced close never means success | AC-01/08 |
| Provider/parser | B | Split UTF-8/JSON/tool arguments, multiple frames, keepalive, usage-only end, `[DONE]`, early EOF, local/hosted retry behavior, abort before/during read, early return cleanup | AC-01/04/07 |
| Query loop | B | Tool-call-before-execution, result-before-next-round, reasoning/usage/catalog/steering preservation, sync and async tools, progress coalescing, supersede | AC-02/07/09/19 |
| Shared callers | Both | Queue, scheduled runner, subagents, permission resume, legacy V2 send; callback facade invoked once | AC-11 |
| Renderer | Both | Snapshot/event race, stale/duplicate suppression, terminal flush, waiting UI, tool-card failure states, Stop, reload, shared component compatibility | AC-03/10/15 |
| Integration | Both | Gate AI before work, mode pinned across resume via injected provider, restart reconciliation, rollback without replay | AC-12/13/14 |

Existing anchors include:

- `test/vitest/main/aiChatWorkspaceCoordinator.test.ts`
- `test/vitest/main/aiChatRunOwnerAdapter.test.ts`
- `test/vitest/main/AIChatQueryLoopCancellation.test.ts`
- `test/vitest/main/service/AIChatQueryLoop.test.ts`
- `test/vitest/main/service/AIChatQueryLoopAsyncPermission.test.ts`
- `test/vitest/main/service/AIChatQueryEngine.test.ts`
- `test/vitest/main/service/AIChatQueryEngine.concurrentTurns.test.ts`
- `test/vitest/main/service/AIChatTurnQueueService.test.ts`
- `test/vitest/main/service/ScheduledAiMessageRunner.chatLoop.test.ts`
- `test/vitest/main/service/AgentRuntime.test.ts`
- `test/vitest/utilitycode/openAIStreamParser.test.ts`
- `test/vitest/utilitycode/workspaceStreamPresenter.test.ts`
- `test/vitest/main/components/AiChatWorkspaceTranscript.test.ts`
- `test/e2e/specs/workspace-shell.test.ts`
- `test/e2e/specs/aiChatQueueSteering.test.ts`
- `test/e2e/specs/toolApproval.test.ts`
- `test/e2e/specs/aiChatLifecycle.test.ts`

Add focused engine/coordinator/provider tests under `test/vitest/main/service/` and new critical workspace flow tests under `test/e2e/specs/` with `.test.ts` names.

Implementation verification commands, confirmed present in package scripts/configuration:

```bash
yarn testmain
yarn vitest --config vitest.service.config.mjs run
yarn vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/workspaceStreamPresenter.test.ts
yarn test:components
yarn test:e2e
yarn typecheck
yarn vue-typecheck
```

Use deterministic provider/tool fixtures for CI, not paid/live LLM requests. Live provider smoke testing is optional supplemental evidence. Component tests are mandatory for renderer-facing changes; critical streaming flows also require E2E coverage. Record unrelated baseline failures separately; never describe an unrun or failing suite as passing.

## 18. Performance and diagnostics

Use the PRD's comparative budgets for each stage. Measure chunk latency at presenter intake, before the 50 ms batching window. Record request-start-to-first-chunk separately from chunk-to-presenter-intake latency so model/network variability does not hide application overhead. Compare scripted text, reasoning, multi-tool, progress-burst, and cancellation fixtures with at least 30 measured runs after warmup.

Count or time: active consumers, emitted event count by type, coalesced progress count, required-write latency and failures, cancelled reads, late callbacks suppressed, segment outcomes (including unclassified exits), resume wait-for-capacity time, cleanup errors, and time to terminal finalization. Every completed test should return active consumer/listener/timer counts to baseline.

Use correlation identifiers only where existing diagnostics policy permits. Do not include prompt text, deltas, reasoning, tool arguments, credentials, or full paths in metrics. Buffer byte budgets are estimates of serialized application payload, not a claim about total process RSS.

## 19. Decisions, alternatives, and remaining work

| Decision | Rationale and tradeoff |
| --- | --- |
| Stage A before generators | Delivers the reliability fixes on the existing transport and gives Stage B a regression net; requires touching coordinator/engine twice |
| Outcome-returning entry point | Removes completion inference and sampling; requires migrating owners off `submitMessage` |
| Resume through the run owner | One owner, capacity-limited and observed resumes; approvals may wait for capacity |
| Coordinator executes queue-drained turns | Durable identity and one scheduler; the queue keeps policy only |
| Await required persistence before advancement | Makes dependency ordering testable; exposes previously swallowed save failures as user-visible failures |
| Main-process generator consumption | Preserves background work; requires explicit bridge to IPC |
| Yield progress, return segment outcome | Matches existing result semantics; needs a result-aware consumer |
| Single loop implementation | No drift between two loop copies; the flag cannot roll back loop-level defects |
| Coalescing progress multiplexer | Bounded without failing tools; intermediate progress values may be skipped |
| Keep callback facades temporarily | Supports shared callers; requires a bounded removal plan |
| Keep workspace presenter and IPC | Limits migration surface; does not remove all callbacks from the application |
| Native provider iteration | Avoids wrapping the whole engine in a queue; requires both provider implementations to change |
| No generator serialization | Honest restart behavior; live local iterator position cannot survive process exit |

Rejected as the initial approach: a generator per Vue component, replacing every `return` with `yield`, full event-sourcing persistence, an unbounded callback-to-generator wrapper around the whole engine, two parallel loop implementations, failing segments on progress overflow, and simultaneous V2 mass-renaming. Each increases scope or risk without being necessary for this migration.

P0 must resolve the exact shared-caller inventory, the size of the hosted retry conversion, the scheduler tier for resumes waiting for capacity, whether the legacy V2 send handler is reachable from supported UI, and how subagent events reach the parent turn. Review any concurrent capability-parity implementation before editing coordinator/queue ownership. The design's non-negotiable gates are no false completion on pause or unclassified exit, no dependent tool before required persistence, no run cancellation on UI detach, no unowned workspace-visible turn, and no automatic replay during rollback.
