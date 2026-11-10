# AI Chat Workspace Generator Streaming — PRD

## Document information

| Field | Value |
| --- | --- |
| Status | Proposed — requirements for future implementation |
| Version | 1.1 |
| Date | 2026-09-26 |
| Product | AiFetchly desktop application |
| Primary UI | `src/views/components/aiChatWorkspace/`, hosted by the chat-first shell (`AuthenticatedWorkspaceLayout` → `AppWorkspaceShell` → `AiChatCenterSurface`) |
| Technical design | [Generator streaming technical design](./ai-chat-workspace-generator-streaming-technical-design.md) |
| Source baseline | Repository commit `f43d5f6b`; observations are point-in-time, not claims about later implementations |

### Revision history

| Version | Change |
| --- | --- |
| 1.0 | Initial proposal against commit `a21ba198` |
| 1.1 | Revalidated against `f43d5f6b` (chat-first shell, durable message-queue unification, permission-resume completion). Split delivery into a reliability stage that does not depend on generators (Stage A) and the generator refactor (Stage B). Added the queue, resume, subagent, and scheduled execution paths, plus post-terminal side effects, plan-approval semantics, progress coalescing, and a single loop implementation for rollout |

## 1. Product decision

Deliver in two stages:

- **Stage A — explicit execution contract (reliability).** Every execution segment ends with a typed outcome consumed by its owner. Waiting and resume transitions are explicit notifications, not sampled state. Required persistence failures block dependent execution. Every workspace-visible turn has one owner and a durable run identity. Stage A uses the existing callback/sink transport and ships independently.
- **Stage B — async generators (maintainability).** Adopt async generators for incremental LLM and agent-loop output in the main process, with Stage A's tests as the safety net. Continue delivering serializable IPC events to the workspace store and presenter. Keep a final return value for the outcome of each execution segment.

Stage A carries the user-visible reliability value. Stage B changes internal event delivery while preserving chat capabilities. It does not promise faster model inference, better answers, or lower token costs; its benefit is simpler event composition, testable ordering, and explicit completion, cancellation, and waiting behavior. Stage B may be deferred without losing Stage A's guarantees.

The workspace is the sole UI target for new product work. `src/views/components/aiChatV2/AiChatV2.vue` is a retiring screen, but shared components, types, APIs, IPC handlers, and backend services with V2 names remain dependencies until separately extracted or retired.

## 2. Problem and evidence

AiFetchly already streams results. The query loop consumes provider output through the injected `AIChatQueryLoopDeps.streamChatCompletion(request, onChunk, options)` callback seam and emits incremental events through `AIChatQueryEventSink`, then returns `AIChatQueryLoopResult`. The engine persists results and publishes terminal events. Several owners wrap the engine and route events to the renderer.

This spreads one execution across callbacks, sink wrappers, return values, asynchronous persistence, sampled runtime state, and fire-and-forget continuations. It makes changes hard to reason about, especially when a tool needs approval, a request retries, a send is queued behind a busy turn, or the UI detaches.

Concrete findings at the baseline:

| Finding | Product implication |
| --- | --- |
| The loop returns completed, cancelled, failed, permission-pause, or plan-question-pause outcomes, but the workspace coordinator calls `submitMessage(): Promise<void>` and never receives them | Finishing one function must not automatically display success |
| When no terminal chunk arrived and no pause is sampled, the coordinator defaults the run to `completed` | An unclassified exit can be shown as success |
| Waiting states are inferred by sampling engine runtime status on each non-token chunk, plus one sample after dispatch returns. A paused run's later terminal is settled through the original sink closure | Waiting and resume transitions depend on timing and closures rather than explicit notifications |
| Tool-call persistence is ordered before execution (emit, then awaited flush), but save failures are logged and swallowed | A failed required save does not stop the tool from running |
| Busy-conversation sends go to the durable message queue. Queue-drained turns stream into the workspace with a synthetic `pending-queue-N` run ID, no durable run row, and outside the coordinator's scheduler | Not every workspace-visible turn has a durable identity or a single owner |
| Permission approval arrives through the V2 IPC handler. The engine runs the approved tool directly, then continues the loop as a fire-and-forget promise, outside the coordinator's scheduler and lease | Resumed work is not owned, capacity-limited, or observed by the run owner |
| Tool progress is emitted by callbacks while the loop awaits tool execution | Any pull-based design needs a progress multiplexer for every tool call |
| Loop/engine callers include the workspace coordinator, the queue service, the scheduled runner (separate engine instances), subagents (`AgentRuntime` constructs the loop directly), and the legacy V2 send handler | Contract changes must cover every caller, not only the workspace |
| Completed/cancelled/failed results trigger post-terminal side effects: compaction, auto-dream, desktop notification, Stop hooks, staged batch-reference cleanup, and queue re-drain | These must stay after durable finalization and never fire on a pause |
| Workspace components reuse V2 composer/message components and V2 IPC handlers | Deleting the V2 directory would break the supported UI |

These are migration concerns, not a claim that every listed failure currently reaches users.

## 3. Relationship to existing plans

Read this document with the [workspace redesign PRD](./ai-chat-workspace-ui-redesign-prd.md), [workspace redesign technical design](./ai-chat-workspace-ui-redesign-technical-design.md), [chat-first application shell PRD](./ai-chat-first-application-shell-prd.md), [chat-first shell technical design](./ai-chat-first-application-shell-technical-design.md), [message queue PRD](../ai-chat-message-queue-prd.md), [message queue technical design](../ai-chat-message-queue-technical-design.md), and [workspace capability-parity design](./ai-chat-workspace-v2-capability-parity-technical-design.md).

This proposal governs the execution-outcome contract, the generator delivery mechanism, their integration with run owners, and regression gates. Existing feature plans continue to govern queue acceptance and FIFO/steering policy, tool authorization, voice, artifacts, goals, scheduled loops, and capability parity. A capability described in a proposed parity document must not be assumed already implemented.

The migration must preserve the capabilities present when implementation begins. It must not introduce a second message dispatcher or require completion of every separate parity feature. Any genuine conflict must be recorded in the implementation plan with the affected requirement IDs before changing behavior.

## 4. Users and desired outcomes

| User | Desired outcome |
| --- | --- |
| Person chatting in a workspace | Text, reasoning when enabled, and tool progress appear incrementally |
| Person sending while a turn is running | The queued message runs later with the same visibility and status accuracy as a direct send |
| Person working across conversations | Background work continues; sidebar summaries identify waiting and completed work |
| Person approving an action or answering plan questions | Work pauses accurately, resumes once, and preserves prior context |
| Person stopping a run | New work stops, partial output remains consistent, and the UI leaves the running state |
| Engineer maintaining agent behavior | One typed incremental stream and one explicit segment outcome can be tested without mounting Vue |

## 5. Goals and success measures

Stage A:

1. Every execution segment ends with an explicit typed outcome received by its owner; completion is never inferred from the absence of a terminal event.
2. Waiting and resume transitions are explicit lifecycle notifications, not sampled engine state.
3. Required persistence failures block dependent execution and are shown as failures.
4. Every workspace-visible turn — direct, queue-drained, or resumed — has one main-process owner and a durable run identity.
5. Post-terminal side effects run once, after durable finalization, and never on a pause.

Stage B:

6. The query loop's incremental output becomes an async-generator contract consumed by the main process, with one loop implementation.
7. All meaningful event payloads and their ordering are preserved for the supported workspace flows.

Both stages:

8. UI lifetime stays independent from execution lifetime.
9. Migration is incremental, with safe compatibility for shared callers.

Release success for each stage requires all of that stage's mandatory acceptance scenarios in section 12 to pass, no duplicate tool side effects in deterministic tests, and no missing final outcomes or false success on waiting/error paths.

Performance targets are proposed release budgets, not measured baseline claims. Compare identical scripted provider fixtures before and after each stage. Measure latency at **presenter intake** (when the presenter receives the event, before its batching window), not at render: added p95 provider-chunk-to-presenter-intake latency must be at most 20 ms. Total scripted run duration and peak application-owned streaming-buffer memory must not regress by more than 10% outside measurement noise. Preserve the presenter's default 50 ms batching window. Collect at least 30 runs per fixture on the same machine after warmup and record the baseline, variance, and result. If a budget is infeasible, revise it with evidence before release rather than silently waive it.

## 6. Scope

### 6.1 Included

- An outcome-returning engine entry point for run owners, and removal of completion inference.
- Explicit internal lifecycle notifications for waiting and resume.
- Strict required persistence for tool calls and tool results.
- Durable run identity and single ownership for queue-drained turns and resumed segments.
- Provider stream iteration for hosted and OpenAI-compatible providers used by workspace chat.
- Query-loop generator output and engine consumption of its final outcome.
- A progress multiplexer for callback-delivered tool progress.
- Run lifecycle integration, cancellation, pause/resume, persistence, retries, and cleanup affected by the change.
- Workspace event routing, store, and presenter compatibility.
- Shared callers through a compatibility facade and regression tests: the message-queue service, scheduled runner, subagents (`AgentRuntime`), and the legacy V2 send and resume handlers until they are retired.
- Documentation, diagnostics, migration controls, and rollback procedure.

### 6.2 Excluded

- A new workspace visual design or a rewrite of its components.
- New functionality in the retiring `AiChatV2.vue` screen.
- Deleting or mass-renaming all V2-named files.
- Replacing Electron IPC, Pinia, Vue, TypeORM, SQLite, or the provider protocol.
- Sending generators, database objects, or execution controllers to the renderer.
- A new worker architecture, worker database access, or a new event-sourcing database.
- Automatic replay of tool side effects or interrupted runs after process restart.
- New model retry policies, queue policies, or authorization semantics unrelated to delivery.
- Turning plan approval into a waiting run state (see FR-025).
- A requirement to run every application streaming API through generators.

## 7. Functional requirements

All requirements below are mandatory unless marked follow-up. The Stage column says which stage must first satisfy a requirement; "Both" means Stage A must satisfy it and Stage B must preserve it.

| ID | Stage | Requirement | Acceptance evidence |
| --- | --- | --- | --- |
| FR-001 | B | The main-process query loop exposes typed incremental events through an async generator and returns an explicit segment outcome, with a single loop implementation | Consumer retrieves all events and the final outcome without losing either |
| FR-002 | Both | The workspace receives text and reasoning deltas before provider completion | A delayed fixture visibly streams before its final chunk |
| FR-003 | Both | Preserve tool-call, tool-progress, tool-result, usage, retry, recovery, plan, and direction-change semantics supported by the current path | Normalized event traces match baseline meaning and causal order |
| FR-004 | A | Every workspace-visible turn — direct send, queue-drained turn, or resumed segment — has exactly one main-process execution owner; the renderer only subscribes to its output | Switching, reloading, or destroying a window does not cancel the run; no turn streams to the workspace without an owner |
| FR-005 | A | Events retain conversation, durable run, message, and tool identity as applicable, with a monotonic run sequence owned by run context rather than a sink closure | No event is applied to another conversation; no synthetic run IDs reach the workspace; resumed segments do not reset the same run's sequence |
| FR-006 | A | Tool-call persistence stays ordered before execution (already true today); a failed required tool-call or tool-result save prevents dependent execution and marks that tool call failed in the UI | A delayed save blocks execution; a failed save prevents execution and the tool card never shows running or success |
| FR-007 | Both | Terminal success/cancellation publication follows required message and run-state persistence | UI does not announce durable completion ahead of required writes |
| FR-008 | Both | Stop aborts provider work, retry waits, and cancellable tools; it prevents subsequent rounds and suppresses late output | Cancellation works at every tested boundary and finalizes once |
| FR-009 | A | Permission and question pauses produce waiting status from the explicit segment outcome, not completed status | Waiting persists until the matching user action, explicit cancellation, or recovery decision |
| FR-010 | A | Resume validates the pending action and resumes once with preserved trusted context | Duplicate/stale responses cannot repeat tool execution or corrupt another run |
| FR-011 | Both | Retries preserve current classifications, limits, cancellation, partial-output handling, and tool-safety rules | No additional automatic tool replay or duplicated transcript content |
| FR-012 | Both | Preserve workspace selection handshake, stale/duplicate rejection, delta batching, and terminal flush behavior | Presenter and selection race tests pass |
| FR-013 | Both | Shared callers continue to function through one engine contract and a temporary callback facade: message-queue service, scheduled runner, subagents (`AgentRuntime`), permission resume, and the legacy V2 send handler while it exists. `ChatRunOwner` includes `goal`, but no goal runner calls the engine at the baseline; one added later must adopt this contract | Per-caller contract tests pass |
| FR-014 | Both | AI handlers gate enablement before parsing or starting AI work; existing permission controls remain authoritative | Disabled AI starts no provider or tool work |
| FR-015 | Both | Successful, failed, cancelled, paused, and abandoned iteration release owned streaming resources appropriately | No pending reads/listeners/producers remain in deterministic cleanup tests |
| FR-016 | B | The progress multiplexer keeps only the latest progress per tool call, is bounded by the number of concurrently running tools, and never fails or aborts a running tool because of progress volume. Non-replaceable events (text, reasoning, usage, tool calls/results, lifecycle) never pass through it | Burst tests stay bounded; a running tool is never aborted by progress volume; no non-replaceable event is lost |
| FR-017 | Both | Errors are classified and shown consistently; iterator/consumer failure cannot be inferred as success | Failure tests leave accurate UI/runtime state and safe partial history |
| FR-018 | B | The delivery mode is read through an injectable configuration provider and captured in run context at acceptance; every segment and resume of that run uses it | A configuration change never starts a second implementation for the same run |
| FR-019 | Both | Restart uses existing durable reconciliation rather than attempting to serialize a generator | Interrupted work is represented honestly and no tool automatically repeats |
| FR-020 | Both | Inventory all workspace imports from V2 (components, IPC handlers, utilities, APIs) before removing legacy code | Shared composer, messages, settings controls, utilities, and APIs remain usable |
| FR-021 | A | Replace sampled waiting/resume state with explicit internal lifecycle notifications (`awaiting_permission`, `awaiting_user`, `resumed`) carrying stable run identity | Waiting and resume transitions are observed without sampling; timing-race tests pass |
| FR-022 | A | Run owners consume an outcome-returning engine entry point; a segment that ends without a classified outcome is recorded as failed with a diagnostic, never as completed | An unclassified exit produces a failed run and a safe error |
| FR-023 | A | Post-terminal side effects (compaction, auto-dream triggers, desktop notification, Stop hooks, staged batch-reference cleanup, queue re-drain/hold) run exactly once, after durable finalization, only for completed/cancelled/failed under current rules, and never on a pause | Side-effect counters match the outcome; pauses trigger none |
| FR-024 | A | Permission and plan-question resume re-enter through the run's owner. The owner claims the pending action immediately, reacquires the conversation lease and scheduler capacity before any tool or model work, shows the run as queued while waiting for capacity, and observes the continuation's outcome. Stop cancels a resume that is waiting for capacity | Approving while capacity is full queues and then runs once; no unobserved continuation promise exists |
| FR-025 | Both | Preserve plan-approval semantics: `SubmitPlanForApproval` records the plan and the turn continues and can complete while the plan awaits approval. Turn completion must not be presented as plan approval, and approving a plan is a plan-state transition, not a run resume | Plan submit/approve traces match the baseline; UI distinguishes "turn finished, plan awaiting approval" from "plan approved" |
| FR-026 | B | A superseded turn (today suppressed through `isActiveTurn`) aborts its provider request and closes its generator; late output from it is never applied | Supersede tests show no late deltas and a released provider request |

## 8. Workspace behavior

### Normal conversation

Send retains the existing acceptance and run-ID response. The user sees the accepted message, incremental assistant output, and tool progress. Completion flushes buffered text and shows a final result only after required persistence succeeds. Usage and metadata remain available after history reload.

### Sending while busy

A send to a busy conversation keeps the durable message-queue behavior (pending bubble, steering, FIFO drain, hold on cancel/failure). When the queued message is drained, its turn gets a durable run ID and streams to the workspace with the same identity, sequence, and waiting/terminal accuracy as a direct send.

### Multiple conversations and windows

Moving from conversation A to B changes detailed subscriptions. A continues running in the main process. Other windows may observe the same run through routing; none directly consumes its execution. Sidebar summaries remain lightweight and inactive histories stay unmounted. Returning to A uses the existing snapshot/selection handshake, not replay.

### Approval and plan questions

The transcript presents the existing approval/question surface. The run shows a waiting state. No subsequent dependent action executes before authorization or the required answer. Resume preserves message/tool IDs, plan context, tool catalog, and trusted user-intent context. A pause does not hold an open LLM response body merely to await a human decision. If execution capacity is full when the user approves, the run shows as queued until capacity frees; the approval is not lost and is not applied twice.

Plan approval is not a pause: the turn that submitted the plan may complete, and the plan approval card remains the surface for approving.

### Stop, errors, and recovery

Stop affects the selected run or its owning subsystem according to current controls, including a resume waiting for capacity. Partial output is finalized consistently. A tool already carrying out an external action may not be reversible; cancellation must not claim otherwise or automatically repeat it. Network recovery preserves the existing policy and user-visible recovery state. An unrecoverable failure never turns into a successful completion because an execution ended without a terminal event.

### Accessibility and localization

No new UI copy is required for the baseline migration beyond failure states it introduces. If lifecycle or error presentation changes (for example "tool not run: could not be saved" or "waiting for capacity"), use existing localized patterns and update English, Chinese, Spanish, French, German, and Japanese together. Preserve keyboard interactions, focus behavior, accessible labels, and existing screen-reader announcement cadence; do not announce every token.

## 9. Reliability and data requirements

- Preserve TypeORM Model/Module access and Token-based database path resolution.
- Never place database access in IPC handlers, renderer code, or worker-only code.
- A persistence failure must not be reduced to an ordinary provider retry.
- Do not log prompt bodies, tool arguments, reasoning, credentials, or generated content to migration metrics.
- Sequences provide ordering and duplicate suppression; they do not imply a durable replay log.
- Queue-drained turns reuse the existing run entity and run-owner envelope; no new entity is required. If implementation discovers a missing durable checkpoint, propose its schema separately with rollback analysis.
- Keep existing history compatible with both delivery implementations during rollout.

## 10. Delivery phases

| Phase | Deliverable | Exit gate |
| --- | --- | --- |
| P0 | Caller inventory (coordinator, queue service, scheduled runner, `AgentRuntime`, V2 send/resume handlers), baseline traces, pause/resume ownership analysis, performance fixtures | Every current event family, segment outcome, and caller has a test owner |
| A1 | Outcome-returning engine entry point; coordinator and queue consume outcomes; completion inference removed | FR-009/022 scenarios pass; no default-to-completed path remains |
| A2 | Explicit lifecycle notifications replace sampling; strict required persistence; post-terminal side effects gated on finalization | FR-006/021/023 scenarios pass |
| A3 | Durable run identity for queue-drained turns; resume through the run owner with lease and capacity; sequence owned by run context | FR-004/005/010/024 scenarios pass. **Stage A release gate:** all Stage A scenarios and performance budgets pass |
| B1 | Provider iterator API and callback compatibility facade | Hosted/local parser, retry, abort, and cleanup contract tests pass |
| B2 | Single generator loop implementation (`run()` drains `iterate()`), progress multiplexer, typed engine consumer | Final result retrieval, tool ordering, error paths, resume context, and supersede pass |
| B3 | Owners switch to the generator consumer behind the delivery-mode flag | Waiting/terminal distinction, sequence continuity, detach/reload, and cancellation pass |
| B4 | Controlled rollout and regression evidence | Required suites and performance budgets pass; rollback exercised |
| B5 | Remove obsolete internal sink plumbing; separately retire unused screen code | Dependency inventory proves retained callers/components are supported |

Do not execute two implementations against real tools to compare them. Differential testing uses recorded/scripted provider responses and fake tools. Switching delivery mode affects only new runs; live and waiting runs keep their selected mode.

## 11. Dependencies and risks

| Risk | Mitigation |
| --- | --- |
| Generator return outcome is discarded | Dedicated typed consumer and all-outcome tests |
| Absence of a terminal event is read as success | Outcome-returning entry point in Stage A; unclassified exit is failed |
| Callback queue only disguises the old architecture | Native provider iteration and direct query-loop yields; adapter only for tool progress |
| Progress overflow aborts a tool with external effects | Latest-per-tool coalescing; progress never fails a segment |
| Persistence is accidentally detached from execution | Await required writes before advancing; failure blocks dependent work |
| Pause is interpreted as successful completion | Explicit segment outcome and coordinator transition tests |
| Resume loses its event destination or sequence | Run-owned context retained across segments; no sink closure in pending state |
| Resume deadlocks or is lost when capacity is full | Claim first, queue visibly, cancellable by Stop |
| Queue-drained turns stay unowned | Durable run via owner envelope in A3 |
| Post-terminal side effects fire on a pause or twice | Single finalization path with side-effect counters in tests |
| UI detachment closes the generator | Main-process ownership tests with zero subscribers |
| Shared V2 dependencies are removed | Import/caller inventory and separate retirement work |
| Two loop implementations drift during rollout | One loop implementation; the flag switches only the owner-side consumer |
| Rollout repeats a non-idempotent tool | Never fail over mid-run or shadow-execute live tools |
| Hosted retry conversion (in `aiChatApi.ts`) is larger than estimated | Size it in P0; keep the callback facade until parity is proven |
| Separate parity work changes the same boundaries | Rebase implementation inventory and reconcile responsibilities without duplicating dispatch |

## 12. Acceptance scenarios and traceability

| ID | Stage | Scenario and required result | Requirements |
| --- | --- | --- | --- |
| AC-01 | Both | Delayed text/reasoning stream renders progressively and final history equals accepted output | FR-001–003, FR-007, FR-012 |
| AC-02 | A | Tool-call save is delayed then succeeds; tool starts afterward. Repeat with a failed save; tool never starts and its card shows a failure, not running or success | FR-006, FR-017 |
| AC-03 | Both | Switch conversations, detach all windows, and reattach during a run; execution continues and selected history is correct | FR-004/005/012 |
| AC-04 | Both | Stop before dispatch, during provider read, retry backoff, tool progress, a waiting state, and a resume waiting for capacity; no later round starts | FR-008/015/024 |
| AC-05 | A | Permission pause preserves waiting state; approval resumes once, including when scheduler capacity is full at approval time; denial follows existing policy; duplicate approval is safe | FR-009/010/024 |
| AC-06 | Both | Plan question/answer pauses and resumes once. Plan submission lets the turn complete without the UI implying approval; approving the plan follows the existing plan workflow | FR-003/009/010/025 |
| AC-07 | Both | Provider error before and after partial output preserves retry policy and yields accurate final state | FR-011/017 |
| AC-08 | Both | Event consumer or required persistence fails; provider is aborted, execution is closed, no success is emitted | FR-006/007/015/017 |
| AC-09 | B | A progress burst from several concurrent tools stays within the bound, keeps the latest progress per tool, and never aborts a running tool; text, tool calls, and results never pass through the multiplexer | FR-016 |
| AC-10 | Both | Duplicate, stale, queue-drained, and resumed-segment events cannot duplicate text or attach it to another run | FR-005/012 |
| AC-11 | Both | Queue service, scheduled runner, subagents, permission resume, and the legacy V2 send handler execute through the contract with no extra user-message persistence or tool calls | FR-013/018 |
| AC-12 | Both | AI disabled means no parsing-dependent AI work, provider connection, or tool execution; existing gates remain enforced | FR-014 |
| AC-13 | Both | Restart during running/waiting state reconciles persisted state without generator serialization or automatic tool replay | FR-019 |
| AC-14 | B | With an injected configuration provider, change the delivery mode while a run is active and while one is paused; each keeps its mode through resume and the next new run uses the new mode. For the production environment variable, a change takes effect only after restart, where existing reconciliation applies | FR-018 |
| AC-15 | Both | Workspace composer, transcript, inspectors, and localized changed states pass component and E2E tests | FR-012/020 |
| AC-16 | A | Send while busy; when the queued message drains, its turn has a durable run ID, a monotonic sequence, and accurate waiting/terminal status in the workspace | FR-004/005 |
| AC-17 | A | A scripted segment ends with no terminal event and no pause; the run is recorded failed with a diagnostic, never completed | FR-022 |
| AC-18 | A | Completed, cancelled, failed, and paused segments trigger post-terminal side effects exactly as specified; pauses trigger none; none fire twice | FR-023 |
| AC-19 | B | A same-conversation re-send supersedes a streaming turn; the old provider request is aborted, its generator closed, and no late delta reaches the transcript | FR-026 |

## 13. Definition of done

**Stage A** is complete when every Stage A requirement has passing evidence, the Stage A performance budgets are met, and the change is released on the existing sink transport.

**Stage B** is complete when the generator path is the selected workspace implementation, every mandatory requirement has passing evidence, the provider and progress compatibility boundaries are documented, performance budgets are met, and rollback has been exercised without replaying real side effects.

UI changes and their tests must be committed together. Finishing these planning documents does not itself complete either stage.

Open questions to resolve during P0:

- Exact retry callback inventory and the size of converting hosted retry in `aiChatApi.ts`.
- Each shared caller's pause ownership, including whether the legacy V2 send handler is still reachable from supported UI.
- Whether subagent (`AgentRuntime`) events are forwarded to the parent turn and how.
- Scheduler tier used for resumed segments waiting for capacity.

The technical design supplies proposed defaults and decision rules. No unresolved question permits weakening persistence, cancellation, authorization, or run-lifetime guarantees.
