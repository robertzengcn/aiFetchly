# AI Chat Workspace Generator Streaming — Technical Design

## Document information

| Field | Value |
| --- | --- |
| Status | Proposed — interfaces and file additions below are design targets |
| Version | 1.0 |
| Date | 2026-09-13 |
| Requirements | [Generator streaming PRD](./ai-chat-workspace-generator-streaming-prd.md) |
| Inspected baseline | `a21ba198` |
| Technology | Existing TypeScript, Electron, Vue 3, Pinia, TypeORM, SQLite, Fetch/SSE |

## 1. Decision and terminology

Use an async iterable for provider output and an async generator for query-loop events. Keep `AIChatQueryLoopResult` as the final return value of an execution segment. A main-process engine consumer processes events and obtains that return value. The coordinator continues to own workspace runs and IPC delivery.

An **execution segment** runs until completion, cancellation, failure, or a pause requiring external input. A **run** is the workspace execution identity and may span several segments. A **provider attempt** is one HTTP streaming request within a segment. A **round** is a model/tool iteration. These lifetimes must not be collapsed into one iterator-end signal.

`yield` suspends generator execution until the consumer advances it. It is not a thread, a broadcast mechanism, or a durable checkpoint. `return` terminates that generator and carries its final value. `for await` consumes yielded values but does not expose the final return value.

The proposed design needs no new runtime dependency. Preserve ordinary Promise-returning APIs for nonstreaming completion, run acceptance, database operations, and commands such as Stop.

## 2. Source map and current behavior

Paths below link to current source, not proposed implementations.

| Source | Current responsibility | Migration impact |
| --- | --- | --- |
| [ChatProviderClient.ts](../../src/service/aiProvider/ChatProviderClient.ts) | `complete(): Promise<Response>` and callback `stream(): Promise<void>` | Add iterator API; retain temporary callback facade |
| [OpenAIStreamParser.ts](../../src/service/aiProvider/OpenAIStreamParser.ts) | Fetch-body SSE parsing and chunk callbacks | Incremental generator parsing and resource cleanup |
| [OpenAICompatibleProviderClient.ts](../../src/service/aiProvider/OpenAICompatibleProviderClient.ts) | Local/OpenAI-compatible streaming | Yield chunks through provider contract |
| [aiChatApi.ts](../../src/api/aiChatApi.ts) | Provider resolution, hosted streaming, retry/recovery callbacks, SSE handling | Preserve hosted and local differences while exposing iteration |
| [AIChatQueryLoop.ts](../../src/service/AIChatQueryLoop.ts) | Model/tool rounds, callback consumption, sink emissions, loop result | Native event yields; preserve agent decisions |
| [AIChatQueryEvents.ts](../../src/service/AIChatQueryEvents.ts) | Event union, sink/flush, loop and pending-state contracts | Separate yielded events from terminal outcomes; remove pending sink ownership |
| [AIChatQueryEngine.ts](../../src/service/AIChatQueryEngine.ts) | Preparation, active/pending turns, persistence, loop outcomes, resume | Consume generator and preserve all entry/resume paths |
| [AIChatCoordinator.ts](../../src/service/AIChatCoordinator.ts) | Workspace run acceptance, scheduler, sink adaptation, durable state | Consume explicit segment outcomes and retain run context across pauses |
| [AIChatRunEventAdapter.ts](../../src/service/AIChatRunEventAdapter.ts) | Adds run identity and sequence to chunks | One adapter/sequence owner per run across segments |
| [AIChatEventRouter.ts](../../src/service/AIChatEventRouter.ts) | Selected details and global summaries | Keep transport/subscription ownership |
| [selectedConversation.ts](../../src/views/store/selectedConversation.ts) | Selection handshake, sending/stopping, detail subscriptions | Preserve public API and selection guards |
| [workspaceStreamPresenter.ts](../../src/views/utils/workspaceStreamPresenter.ts) | Batched projection and duplicate/stale rejection | Keep batching and immediate control-event flush |
| [AiChatWorkspaceShell.vue](../../src/views/components/aiChatWorkspace/AiChatWorkspaceShell.vue) | Supported workspace composition | Target UI validation; shared V2 imports remain |

Current execution flow:

```text
Workspace -> selectedConversation -> workspace IPC -> coordinator
  -> engine.submitMessage({ request, eventSink })
    -> loop.run({ ..., eventSink: persistingSink })
      -> provider(request, onChunk)
      -> eventSink.emit(event)
    <- Promise<AIChatQueryLoopResult>
  -> V2 chunk mapper -> run adapter -> router -> IPC -> presenter
```

Important baseline details:

- `AIChatQueryEventSink.flush()` is an optional persistence barrier. The loop awaits it before some tool executions.
- `createPersistingEventSink()` currently forwards events and schedules tool record writes; some save errors are logged and swallowed. The target strengthens required-write failures to block dependent execution. This is an intentional reliability change requiring tests, not a claim of exact error-path parity.
- `submitMessage()` currently returns `Promise<void>`. The persisted-user-message path exposes `AIChatTurnTerminalEvent`, including paused and busy outcomes.
- The coordinator currently inspects terminal chunks and samples runtime state. Implementation must not retain a default-completed inference when the new segment consumer returns a pause without a terminal chunk.
- Pending permission/question structures currently contain an event sink and abort controller. They cannot simply be serialized or treated as generator state.
- Hosted retry/recovery behavior is richer than the small provider interface. Preserve `onRetry`, structured recovery, retry profiles, endpoint fallback, and provider gates during adaptation.

## 3. Target ownership and flow

```text
                       Electron main process
 Provider iterator
   | provider events (chunk / retry / recovery)
   v
 Query-loop generator -------- returns segment result
   | normalized nonterminal events             |
   v                                           v
 Engine consumer -> required Model/Module writes -> outcome handling
   | domain progress + explicit segment outcome
   v
 Coordinator / run context -> durable run transitions
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
| Engine | Generator draining, required persistence, pending turn context, outcome handling | Vue rendering or direct database work in IPC |
| Coordinator | Run identity, admission, segment lifecycle integration, terminal routing | Parsing model SSE |
| Router | Fan-out to currently subscribed windows | Driving execution or retrying work |
| Presenter | Batched view projection and stale/duplicate filtering | Provider cancellation or execution ownership |

Only one consumer advances a given generator. Multiple windows subscribe after the coordinator/router. No separate iterator per observer; no generator `.next()` calls originating from renderer IPC.

## 4. Proposed contracts

The following types are design sketches. Existing names are retained where useful; new names are not currently exported.

### 4.1 Provider output

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

All incremental provider status travels in this stream in causal order. Preserve available provider options during inventory; do not silently drop richer hosted options to fit the current narrower local interface. Keep nonstreaming `complete()` unchanged. The parser itself can yield `OpenAIChatCompletionChunk`; request/retry layers add the provider envelope.

The temporary `stream(request, onChunk, options)` facade consumes `streamEvents()`, calls legacy callbacks, and resolves after stream cleanup. The facade is an outward compatibility boundary, not a second provider implementation.

### 4.2 Query-loop output and result

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

The core loop yields nonterminal progress and returns its result. The engine remains responsible for final complete/cancelled/error publication after persistence. This avoids two independent terminal publishers. Audit existing emission sites before introducing the narrowed union; prepare-time errors and engine-owned start events need not be moved into the loop merely for uniformity.

Use `yield*` for helpers that naturally produce the same event stream and return useful values. Do not convert every helper into a generator: pure calculations, repository calls, and single-result tool APIs remain ordinary functions/Promises.

Define a new generator input containing the existing execution fields but no `eventSink`. During migration, a deprecated `run(oldInput)` can drain `iterate(newInput)` into the legacy sink and return the result. Required persistence semantics must remain awaited by the engine; the facade must not bypass them or persist an event twice.

### 4.3 Segment completion

Use the existing `AIChatTurnTerminalEvent` classification as the basis for a clearly named engine segment result, including completed, cancelled, failed, permission pause, question pause, and conversation busy. Avoid adding a second contradictory outcome union.

Add an outcome-returning workspace engine entry point or evolve the structural coordinator interface. Preserve `submitMessage(): Promise<void>` only as a deprecated caller facade where necessary. The workspace coordinator must receive the actual outcome; inspecting the absence of a terminal event is insufficient.

Run completion is derived from that outcome after required persistence, never from `done: true` alone.

## 5. Consuming a generator without losing its result

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

## 6. Provider implementation

Convert parsing at the native response-body boundary. Avoid collecting the full stream and yielding only after completion.

1. Validate enablement/provider configuration at the existing gate before starting the request.
2. Acquire the response body reader after checking status and body presence.
3. Decode incrementally and retain incomplete frames across reads.
4. Yield parsed chunks, preserving fragmented content, tool-call arguments, reasoning fields, final usage-only frames, and supported finish reasons.
5. Treat `[DONE]` as the stream terminator; no later buffered payload may become output.
6. Preserve supported SSE comments, keepalives, line endings, and provider-specific parsing behavior. Protocol broadening is separate work unless needed to prevent a migration regression.
7. On cancellation, early consumer close, or failure, cancel the owned response body/request as appropriate and release the reader lock in `finally`.
8. Clean up retry timers and abort listeners on every exit.

Hosted and local implementations need separate fixtures. Do not assume their existing parsers, fallback behavior, or retry support are identical. Connection timeout, stream inactivity timeout, recovery policy, and consumer processing delay must remain distinguishable; a slow required DB write must not be mistaken for a retryable provider timeout.

An iterator naturally paces application reads. It does not bound OS/network buffering or guarantee provider-side cancellation. Measure application-owned buffers and verify request cleanup explicitly.

## 7. Persistence and event ordering

Replace sink-side detached writes on the generator path with an awaited engine event handler. Existing Models and Modules remain the data-access boundary.

| Event/result | Required engine action before advancement/publication |
| --- | --- |
| `token`, `reasoning_delta` | Update current accumulation/projection as needed and forward; no new per-token SQL writes |
| `usage_update` | Update latest usage context so subsequent tool records retain attribution |
| `tool_call` | Await tool-call message persistence before requesting the next loop event and before executing the tool |
| `tool_progress` | Forward safe progress; no new durable per-progress log |
| `tool_result` | Await required result persistence before advancing to dependent model/tool work |
| Plan/question events | Preserve existing plan-module writes; do not duplicate persistence merely because transport changed |
| Completed/cancelled result | Finalize assistant content/metadata, then transition the durable run and publish terminal detail/summary |
| Failed result | Persist safe partial/error state where possible; never announce successful durability after a failed write |

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

## 8. Run and segment lifecycle

```text
queued -> running -> completed | failed | cancelled
              |
              +-> awaiting_permission -> running (new segment)
              |
              +-> awaiting_user ------> running (new segment)

running / waiting -> interrupted on restart reconciliation as applicable
```

Map these conceptual states to the existing run schema. Do not add a status merely to match this diagram.

| Segment outcome | Coordinator action |
| --- | --- |
| Completed | Persist completed state, publish held terminal event, release run context |
| Cancelled | Persist partial/cancelled state and publish once; no new segment |
| Failed/thrown failure | Persist failure where possible; publish a safe failure; never default to completed |
| Permission pause | Retain logical run and pending context; transition to awaiting permission; no terminal-success event |
| Plan question pause | Retain logical run and question context; transition to awaiting user; no terminal-success event |
| Conversation busy | Preserve admission/queue policy; do not claim a new segment succeeded |

Release active execution capacity when a segment pauses, while preserving the logical conversation hold. Resume must reacquire scheduling capacity and the appropriate conversation lease before any tool/model work. Integrate with the existing queue/coordinator owners; do not let both independently schedule the same resume.

Persist waiting state before notifying workspace summaries. Preserve the original run ID and its sequence counter across resumed segments. Keep the adapter in run-owned context, not as a fresh local object for every dispatch.

Baseline parity must cover waiting outcomes even before the optional explicit lifecycle-event follow-up. In that follow-up, introduce engine-level `awaiting_permission`, `awaiting_user`, and `resumed` notifications with stable identities, replacing status sampling incrementally. Map them to existing UI payloads initially; do not expose new IPC types without matching schemas and presenter support.

## 9. Pause/resume context

Generators are not retained as long-lived suspended approval sessions. End the segment with a pause outcome, release provider resources, and store the same execution context the engine already needs to resume.

Remove `eventSink` from generator-owned pending structures. Store a run/owner reference resolved in the main process instead. Keep compatibility sink references outside canonical pending data until their callers migrate.

Preserve, where applicable:

- Conversation, run, assistant-message, tool-call, question, and plan identities.
- Messages, next round, model/request parameters, plan context, and tool catalog snapshot.
- Trusted `sourceUserMessageId`, `intentDecisionId`, and outbound authorization fields.
- Cancellation ownership and a segment epoch used to reject late callbacks.
- The run's selected migration mode and continuation destination.

Resume validates that the pending action still belongs to the run and has not been cancelled or consumed. Preserve current approval and denial semantics. Permission responses must use existing authorization services; `next(value)` is not a new renderer-to-tool authorization channel.

Only one resume claims a pending action. A stale approval after Stop or a second identical answer is rejected or treated idempotently under existing conventions. Resume cannot recreate the user message or reset tool-call identity.

Pending runtime context is not claimed to be durable merely because it is a plain object. Preserve existing persisted plan/permission/history recovery, and mark unrecoverable active work interrupted after process restart. Never serialize an iterator or automatically replay its tool execution.

## 10. Cancellation and cleanup

Use a run-owned cancellation source and a segment/request-owned signal linked to it. Each callback adapter checks both cancellation and its segment epoch so a late callback from an old attempt cannot append to a resumed segment.

| Boundary | Stop behavior |
| --- | --- |
| Queued run | Remove/cancel admission; do not create a provider iterator |
| Before first `.next()` | Check abort before any provider/tool side effect |
| Pending HTTP read | Abort request/cancel reader, then drain to cancelled outcome |
| Retry backoff | Cancel timer immediately; no next attempt |
| Tool running | Invoke existing cancellation hook; suppress late progress/results for cancelled ownership |
| Permission/question wait | Invalidate pending action and finalize cancellation without needing an active generator |
| Consumer/persistence error | Abort producer, close iterator, classify failure rather than user cancellation |
| Renderer detach | Remove only the subscription; continue consuming |
| Application/database scope shutdown | Abort affected owners, complete cleanup, and reconcile durable state under existing policy |

Before starting any next model round/tool, recheck run ownership and cancellation. Resolve completion-versus-Stop races through one serialized finalization path. Once terminal state commits, a late Stop is a no-op; once cancellation wins before that commit, late provider completion cannot overwrite it.

Cleanup cannot claim to undo an already committed external action. Detached tools may finish externally; their callbacks must not resurrect the run. Generator `finally` handles streaming resources, while the coordinator's `finally` handles execution leases and scheduler capacity. Both must run without converting a pause into final run deletion.

## 11. Callback-only progress adapters

Use a bounded async queue only for APIs that cannot natively yield, such as independently delivered tool-job progress. A proposed `AsyncEventQueue<T>` needs `push`, `next`, normal close, failure, abort, and disposal behavior with one consumer.

Proposed initial budgets: 256 queued entries and 1 MiB of estimated serialized payload per adapter, with a configurable lower test limit. These are new design defaults, not current settings. Inventory large tool-result payloads before enabling them in production; final result objects should usually travel through the tool's result Promise instead of the progress queue.

Overflow rules:

- Coalesce replaceable progress for the same tool only within the same contiguous progress region.
- Do not reorder across tool calls/results, permission, recovery, or terminal boundaries.
- Do not drop text/reasoning deltas, usage, tool arguments/results, or lifecycle events.
- If the producer supports awaiting capacity, pause it. Otherwise abort/fail the segment with an internal `stream_buffer_overflow` classification instead of silently losing critical data.
- Oversized single payloads obey the same explicit failure policy; never truncate a tool result silently.
- Normal close drains queued items before completion. Failure/abort rejects the pending read and discards remaining queued progress; no buffered success is delivered after failure.
- Dispose removes producer listeners, abort listeners, timers, and pending resolver references. Late pushes are ignored with a count-only diagnostic.

Do not add a second unbounded queue between the engine and IPC. Keep the workspace's existing batching. A queue adapter is not evidence that application-wide backpressure is solved.

## 12. Retry, recovery, and errors

Preserve the distinction between request retry, model-output recovery, and tool execution. Provider iterators yield retry/recovery notifications in their original order. Consumer/persistence exceptions occur outside provider iteration and must not be caught as retryable transport errors.

For partial-output failures, preserve current accumulation/reset and recovery rules; never concatenate replayed text simply because another attempt yielded it. Preserve tool argument assembly by call index/ID, final usage, model/response metadata, reasoning, discovered tools, and steering transitions.

Differential traces should normalize timestamps and generated IDs while comparing payload meaning and causal order. They must also test intentional changes: required persistence failure now blocks dependent execution, and pause outcomes cannot default to completed.

Use `unknown` in catch blocks and typed error classifiers. Provider error details are not automatically safe UI text. Reuse safe error mapping and existing translated presentation.

## 13. Workspace and IPC compatibility

Keep existing workspace start/stop/select/history APIs. Start returns acceptance/run identity promptly; it does not await the whole generator. Keep the selected-conversation detail envelope: conversation ID, run ID, sequence, emitted time, event type, and serializable payload.

Preserve:

- Subscribe-before-snapshot selection handshake and generation guards.
- Per-run monotonic sequence and duplicate/stale filtering.
- Default 50 ms content/reasoning batching and immediate flush for control/terminal events.
- Redacted sidebar summaries; no inactive full-history subscriptions.
- Existing artifact and reasoning safety boundaries.

Sequence continuity is mandatory across same-process pause/resume. Sequence numbers alone cannot recover missing events; use existing authoritative history/runtime snapshots on reattachment. Do not promise lossless replay without a separately designed durable log.

Retain `createChatV2StreamSink` as a mapping facade initially. Its filename does not make it exclusive to the retiring screen. Direct neutral workspace mapping can follow after trace parity; avoid a simultaneous payload rewrite.

All modified AI IPC handlers must check `Token` and `USER_AI_ENABLED` before request parsing/work. Keep contextBridge serialization/validation. No database access in renderer/IPC, no worker database access, and no new worker process required.

## 14. Migration file plan

| Area | Proposed work |
| --- | --- |
| `src/service/aiProvider/ChatProviderClient.ts` | Add provider event/options types and iterator method |
| `src/service/aiProvider/OpenAIStreamParser.ts` | Add native iteration and make callback consumption delegate to it |
| `src/service/aiProvider/OpenAICompatibleProviderClient.ts` | Expose native stream iteration |
| `src/api/aiChatApi.ts` | Hosted iterator, resolution, and callback facade preserving retry/recovery |
| `src/service/AIChatQueryEvents.ts` | Generator event/result types and pending context ownership changes |
| `src/service/AIChatQueryLoop.ts` | `iterate()` and generator helpers, phased removal of direct core sink emissions |
| Proposed `src/service/aiChat/consumeGenerator.ts` | Typed result-preserving consumer |
| Proposed `src/service/aiChat/AsyncEventQueue.ts` | Bounded callback-progress adapter, only if inventory requires it |
| `src/service/AIChatQueryEngine.ts` | Awaited event handler, result-returning entry point, all resume paths |
| `src/service/AIChatCoordinator.ts` | Outcome-aware segment handling and retained run context |
| `src/service/AIChatRunEventAdapter.ts` | Preserve sequence owner across segments |
| `src/service/AIChatTurnQueueService.ts`, `AIChatRunOwnerAdapter.ts`, and discovered callers | Compatibility review and owner-specific regression tests |
| Workspace stores/presenter/components | Only contract or lifecycle changes needed by migration; corresponding tests |

Before implementation, search all consumers of `AIChatQueryLoop`, `AIChatQueryEventSink`, engine submit/resume methods, and provider streaming APIs. Record whether each caller owns a segment, a run, or a background loop. Do not assume workspace UI scope permits breaking shared backend callers.

Shared V2 components remain in place initially. Extract to a neutral location in a separate change only when imports are updated and tests pass. Screen deletion is not a prerequisite for generator adoption.

## 15. Rollout and rollback

Introduce a proposed internal configuration `AI_CHAT_STREAM_IMPLEMENTATION=callback|generator`, defaulting to callback during migration. This setting does not exist at the inspected baseline. Validate values at startup and log only the chosen mode; do not expose a user-facing toggle.

Capture mode in the main-process run context at acceptance. Every segment and resume uses that mode. While both implementations exist, both must read/write the same compatible message/run data. Do not run both against real tools, fail over mid-stream, or restart a failed generator run on the callback path.

Stages:

1. Scripted fixtures and fake tools compare normalized traces.
2. Enable generator mode in development for workspace runs; run the full focused regression suite.
3. Enable in a controlled release after acceptance and performance gates pass.
4. Switch the default only after error/cleanup evidence is reviewed.
5. Remove the temporary old loop implementation after the rollback window; retain thin facades for callers still using callback signatures.

Rollback changes the mode for new runs only. Existing running/waiting runs drain or are explicitly stopped; they are never replayed automatically. For a restart-based rollback, reconcile interrupted durable states through existing startup logic. No schema downgrade should be necessary because this proposal adds no required entity or history format.

The short coexistence period is allowed for rollback; permanent duplicated orchestration is not the target. After cleanup, callback facades drain the canonical generator implementation.

## 16. Test plan

| Layer | Required tests | PRD scenarios |
| --- | --- | --- |
| Consumer | Ordered events, all return variants, event-handler failure, generator throw, cleanup failure retains primary error, forced close never means success | AC-01/08 |
| Provider/parser | Split UTF-8/JSON/tool arguments, multiple frames, keepalive, usage-only end, `[DONE]`, early EOF, local/hosted retry behavior, abort before/during read, early return cleanup | AC-01/04/07 |
| Query loop | Tool-call-before-execution, result-before-next-round, reasoning/usage/catalog/steering preservation, synchronous and async tools, bounded progress | AC-02/07/09 |
| Engine | Completed/cancelled/failed/pause outcomes, required persistence rejection, every resume entry point, trusted context preservation | AC-02/05/06/08 |
| Coordinator | No false completion on pause; resume capacity/lease; same run sequence; cancellation race; exactly one finalization; renderer detachment | AC-03/04/05/06/10 |
| Shared callers | Queue acceptance/promotion, goals, schedules, permission continuation, callback facade invoked once | AC-11 |
| Renderer | Snapshot/event race, stale/duplicate suppression, terminal flush, waiting UI, Stop, reload, shared component compatibility | AC-03/10/15 |
| Integration | Gate AI before work, mode pinned across resume, restart reconciliation, rollback without replay | AC-12/13/14 |

Existing anchors include:

- `test/vitest/main/aiChatWorkspaceCoordinator.test.ts`
- `test/vitest/main/AIChatQueryLoopCancellation.test.ts`
- `test/vitest/main/service/AIChatQueryLoop.test.ts`
- `test/vitest/main/service/AIChatQueryLoopAsyncPermission.test.ts`
- `test/vitest/main/service/AIChatQueryEngine.test.ts`
- `test/vitest/main/service/AIChatQueryEngine.concurrentTurns.test.ts`
- `test/vitest/utilitycode/workspaceStreamPresenter.test.ts`
- `test/vitest/main/components/AiChatWorkspaceTranscript.test.ts`
- `test/e2e/workspace-shell.spec.ts`

Add focused generator/provider tests under `test/vitest/main/service/` and new critical workspace flow tests under `test/e2e/specs/` with `.test.ts` names. Existing differently named E2E files remain valid baseline coverage; do not rename them merely for this refactor.

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

## 17. Performance and diagnostics

Use the PRD's comparative budgets. Record request-start-to-first-chunk separately from chunk-to-presenter latency so model/network variability does not hide application overhead. Compare scripted text, reasoning, multi-tool, slow-consumer, and cancellation fixtures with at least 30 measured runs after warmup.

Count or time: active consumers, emitted event count by type, maximum adapter depth/bytes, required-write latency, cancelled reads, late callbacks suppressed, segment outcomes, cleanup errors, and time to terminal finalization. Every completed test should return active consumer/listener/timer counts to baseline.

Use correlation identifiers only where existing diagnostics policy permits. Do not include prompt text, deltas, reasoning, tool arguments, credentials, or full paths in metrics. Buffer byte budgets are estimates of serialized application payload, not a claim about total process RSS.

## 18. Decisions, alternatives, and remaining work

| Decision | Rationale and tradeoff |
| --- | --- |
| Main-process generator consumption | Preserves background work; requires explicit bridge to IPC |
| Yield progress, return segment outcome | Matches existing result semantics; needs a result-aware consumer |
| Await required persistence before advancement | Makes dependency ordering testable; can expose existing swallowed save failures |
| Keep callback facades temporarily | Supports shared callers; requires a bounded removal plan |
| Keep workspace presenter and IPC | Limits migration surface; does not remove all callbacks from the application |
| Native provider iteration | Avoids wrapping the whole engine in a queue; requires both provider implementations to change |
| No generator serialization | Honest restart behavior; live local iterator position cannot survive process exit |

Rejected as the initial approach: a generator per Vue component, replacing every `return` with `yield`, full event-sourcing persistence, an unbounded callback-to-generator wrapper around the whole engine, and simultaneous V2 mass-renaming. Each increases scope or changes ownership without being necessary for this migration.

P0 must resolve the exact shared-caller inventory, how each owner schedules resumed segments, and measured adapter limits. Review any concurrent capability-parity implementation before editing coordinator/queue ownership. The design's non-negotiable gates are no false completion on pause, no dependent tool before required persistence, no run cancellation on UI detach, and no automatic replay during rollback.
