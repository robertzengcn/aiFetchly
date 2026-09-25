# AI Chat Workspace Generator Streaming — PRD

## Document information

| Field | Value |
| --- | --- |
| Status | Proposed — requirements for future implementation |
| Version | 1.0 |
| Date | 2026-09-13 |
| Product | AiFetchly desktop application |
| Primary UI | `src/views/components/aiChatWorkspace/` |
| Technical design | [Generator streaming technical design](./ai-chat-workspace-generator-streaming-technical-design.md) |
| Source baseline | Repository commit `a21ba198`; observations are point-in-time, not claims about later implementations |

## 1. Product decision

Adopt async generators for incremental LLM and agent-loop output in the main process. Continue delivering serializable IPC events to the workspace store and presenter. Keep a final return value for the outcome of each execution segment.

The workspace is the sole UI target for new product work. `src/views/components/aiChatV2/AiChatV2.vue` is a retiring screen, but shared components, types, APIs, and backend services with V2 names remain dependencies until separately extracted or retired.

This proposal changes internal event delivery while preserving chat capabilities. It does not promise faster model inference, better answers, or lower token costs. The expected benefit is simpler event composition, testable ordering, and explicit completion, cancellation, and waiting behavior.

## 2. Problem and evidence

AiFetchly already streams results. `ChatProviderClient.stream()` invokes an `onChunk` callback and returns `Promise<void>`. `AIChatQueryLoop` emits incremental events through `AIChatQueryEventSink`, then returns `AIChatQueryLoopResult`. The engine persists results; the workspace coordinator associates them with a run and routes events to the renderer.

This spreads one execution across callbacks, sink wrappers, return values, asynchronous persistence, and sampled runtime state. It makes changes harder to reason about, especially when a tool needs approval, a request retries, or the UI detaches.

Concrete findings from the baseline:

| Finding | Product implication |
| --- | --- |
| The loop returns completed, cancelled, failed, permission-pause, or plan-question-pause outcomes | Finishing one function must not automatically display success |
| The engine wraps sinks with asynchronous tool-call/result persistence and a flush barrier | Reordering events can break tools that depend on persisted records |
| The coordinator owns execution independently of renderer selection | Changing conversations must continue to leave work running |
| The workspace presenter batches deltas and rejects stale/duplicate events | Generator adoption must preserve responsive rendering and correct transcript identity |
| The coordinator samples some waiting states from the engine | Waiting and resume transitions need explicit integration tests |
| Workspace components reuse V2 composer/message components | Deleting the V2 directory would break the supported UI |

These are migration concerns, not a claim that every listed failure currently occurs.

## 3. Relationship to existing plans

Read this document with the [workspace redesign PRD](./ai-chat-workspace-ui-redesign-prd.md), [workspace redesign technical design](./ai-chat-workspace-ui-redesign-technical-design.md), and [workspace capability-parity design](./ai-chat-workspace-v2-capability-parity-technical-design.md).

This proposal governs the generator delivery mechanism, its integration contract, and regression gates. Existing feature plans continue to govern queue acceptance, steering policy, tool authorization, voice, artifacts, goals, scheduled loops, and capability parity. A capability described in a proposed parity document must not be assumed already implemented.

The migration must preserve the capabilities present when implementation begins. It must not introduce a second message dispatcher or require completion of every separate parity feature. Any genuine conflict must be recorded in the implementation plan with the affected requirement IDs before changing behavior.

## 4. Users and desired outcomes

| User | Desired outcome |
| --- | --- |
| Person chatting in a workspace | Text, reasoning when enabled, and tool progress appear incrementally |
| Person working across conversations | Background work continues; sidebar summaries identify waiting and completed work |
| Person approving an action or answering plan questions | Work pauses accurately, resumes once, and preserves prior context |
| Person stopping a run | New work stops, partial output remains consistent, and the UI leaves the running state |
| Engineer maintaining agent behavior | One typed incremental stream and one explicit segment outcome can be tested without mounting Vue |

## 5. Goals and success measures

1. Make the query loop's incremental output an async-generator contract consumed by the main process.
2. Preserve all meaningful event payloads and ordering for the supported workspace flows.
3. Make segment completion distinct from run completion, including permission and plan pauses.
4. Preserve required persistence-before-execution and persistence-before-terminal-publication boundaries.
5. Keep UI lifetime independent from execution lifetime.
6. Support an incremental migration with safe compatibility for shared callers.

Release success requires all mandatory acceptance scenarios in section 12 to pass, no duplicate tool side effects in deterministic migration tests, and no missing final outcomes or false success on waiting/error paths.

Performance targets are proposed release budgets, not measured baseline claims. Compare identical scripted provider fixtures before and after the change: added p95 provider-chunk-to-presenter latency must be at most 20 ms; total scripted run duration and peak application-owned streaming-buffer memory must not regress by more than 10% outside measurement noise. Preserve the presenter's default 50 ms batching window. Collect at least 30 runs per fixture on the same machine after warmup and record the baseline, variance, and result. If a budget is infeasible, revise it with evidence before release rather than silently waive it.

## 6. Scope

### 6.1 Included

- Provider stream iteration for hosted and OpenAI-compatible providers used by workspace chat.
- Query-loop generator output and engine consumption of its final outcome.
- Tool progress adapters only where producer APIs remain callback-based.
- Run lifecycle integration, cancellation, pause/resume, persistence, retries, and cleanup affected by the change.
- Workspace event routing, store, and presenter compatibility.
- Existing background/shared engine callers through a compatibility facade and regression tests.
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
- A requirement to run every application streaming API through generators.

## 7. Functional requirements

All requirements below are mandatory unless marked follow-up.

| ID | Requirement | Acceptance evidence |
| --- | --- | --- |
| FR-001 | The main-process query loop exposes typed incremental events through an async generator and returns an explicit segment outcome | Consumer retrieves all events and the final outcome without losing either |
| FR-002 | The workspace receives text and reasoning deltas before provider completion | A delayed fixture visibly streams before its final chunk |
| FR-003 | Preserve tool-call, tool-progress, tool-result, usage, retry, recovery, plan, and direction-change semantics supported by the current path | Normalized event traces match baseline meaning and causal order |
| FR-004 | A run has one execution owner; the renderer only subscribes to its output | Switching, reloading, or destroying a window does not cancel the run |
| FR-005 | Events retain conversation, run, message, and tool identity as applicable, with a monotonic run sequence | No event is applied to another conversation; resumed segments do not reset the same run's sequence |
| FR-006 | Required tool-call persistence completes before dependent tool execution begins | A delayed save blocks execution; a failed required save prevents execution |
| FR-007 | Terminal success/cancellation publication follows required message and run-state persistence | UI does not announce durable completion ahead of required writes |
| FR-008 | Stop aborts provider work, retry waits, and cancellable tools; it prevents subsequent rounds and suppresses late output | Cancellation works at every tested boundary and finalizes once |
| FR-009 | Permission and question pauses produce waiting status, not completed status | Waiting persists until the matching user action, explicit cancellation, or recovery decision |
| FR-010 | Resume validates the pending action and resumes once with preserved trusted context | Duplicate/stale responses cannot repeat tool execution or corrupt another run |
| FR-011 | Retries preserve current classifications, limits, cancellation, partial-output handling, and tool-safety rules | No additional automatic tool replay or duplicated transcript content |
| FR-012 | Preserve workspace selection handshake, stale/duplicate rejection, delta batching, and terminal flush behavior | Presenter and selection race tests pass |
| FR-013 | Shared callers continue to function through one engine and a temporary callback facade | Queue, goal, schedule, and permission-resume contract tests pass where they use this engine |
| FR-014 | AI handlers gate enablement before parsing or starting AI work; existing permission controls remain authoritative | Disabled AI starts no provider or tool work |
| FR-015 | Successful, failed, cancelled, paused, and abandoned iteration release owned streaming resources appropriately | No pending reads/listeners/producers remain in deterministic cleanup tests |
| FR-016 | Callback adapters have bounded memory and explicit overflow semantics | Slow-consumer tests cannot silently lose critical events or grow without a limit |
| FR-017 | Errors are classified and shown consistently; iterator/consumer failure cannot be inferred as success | Failure tests leave accurate UI/runtime state and safe partial history |
| FR-018 | Migration mode is fixed for an accepted run, including resumed segments | A configuration change never starts a second implementation for the same run |
| FR-019 | Restart uses existing durable reconciliation rather than attempting to serialize a generator | Interrupted work is represented honestly and no tool automatically repeats |
| FR-020 | Inventory all workspace imports from V2 before removing legacy code | Shared composer, messages, settings controls, utilities, and APIs remain usable |
| FR-021 | Follow-up: replace sampled waiting/resume state with explicit internal lifecycle notifications | Additive change with separate tests; initial migration still must satisfy FR-009/010 |

## 8. Workspace behavior

### Normal conversation

Send retains the existing acceptance and run-ID response. The user sees the accepted message, incremental assistant output, and tool progress. Completion flushes buffered text and shows a final result only after required persistence succeeds. Usage and metadata remain available after history reload.

### Multiple conversations and windows

Moving from conversation A to B changes detailed subscriptions. A continues running in the main process. Other windows may observe the same run through routing; none directly consumes its generator. Sidebar summaries remain lightweight and inactive histories stay unmounted. Returning to A uses the existing snapshot/selection handshake, not replay from a retained generator.

### Approval and plan questions

The transcript presents the existing approval/question surface. The run shows a waiting state. No subsequent dependent action executes before authorization or the required answer. Resume preserves message/tool IDs, plan context, tool catalog, and trusted user-intent context. A pause does not hold an open LLM response body merely to await a human decision.

### Stop, errors, and recovery

Stop affects the selected run or its owning subsystem according to current controls. Partial output is finalized consistently. A tool already carrying out an external action may not be reversible; cancellation must not claim otherwise or automatically repeat it. Network recovery preserves the existing policy and user-visible recovery state. An unrecoverable failure never turns into a successful completion because an iterator ended.

### Accessibility and localization

No new UI copy is required for the baseline migration. If lifecycle or error presentation changes, use existing localized patterns and update English, Chinese, Spanish, French, German, and Japanese together. Preserve keyboard interactions, focus behavior, accessible labels, and existing screen-reader announcement cadence; do not announce every token.

## 9. Reliability and data requirements

- Preserve TypeORM Model/Module access and Token-based database path resolution.
- Never place database access in IPC handlers, renderer code, or worker-only code.
- A persistence failure must not be reduced to an ordinary provider retry.
- Do not log prompt bodies, tool arguments, reasoning, credentials, or generated content to migration metrics.
- Sequences provide ordering and duplicate suppression; they do not imply a durable replay log.
- No new database entity or history migration is required by default. If implementation discovers a missing durable checkpoint, propose its schema separately with rollback analysis.
- Keep existing history compatible with both delivery implementations during rollout.

## 10. Delivery phases

| Phase | Deliverable | Exit gate |
| --- | --- | --- |
| P0 | Caller inventory, baseline traces, pause/resume ownership analysis, performance fixtures | Every current event family and segment outcome has a test owner |
| P1 | Provider iterator API and callback compatibility facade | Hosted/local parser, retry, abort, and cleanup contract tests pass |
| P2 | Generator query loop and typed engine consumer | Final result retrieval, tool ordering, error paths, and resume context pass |
| P3 | Workspace coordinator integration | Waiting/terminal distinction, sequence continuity, detach/reload, and cancellation pass |
| P4 | Controlled rollout and regression evidence | Required suites and performance budgets pass; rollback exercised |
| P5 | Remove obsolete internal sink plumbing; separately retire unused screen code | Dependency inventory proves retained callers/components are supported |

Do not execute both old and new implementations against real tools to compare them. Differential testing uses recorded/scripted provider responses and fake tools. Switching migration mode affects only new runs; live and waiting runs retain their selected implementation.

## 11. Dependencies and risks

| Risk | Mitigation |
| --- | --- |
| Generator return outcome is discarded | Dedicated typed consumer and all-outcome tests |
| Callback queue only disguises the old architecture | Native provider iteration and direct query-loop yields; adapters only at bounded producer edges |
| Persistence is accidentally detached from execution | Await required writes before advancing the generator |
| Pause is interpreted as successful completion | Explicit segment outcome and coordinator transition tests |
| Resume loses its event destination or sequence | Run-owned context retained across segments; no renderer-owned sink in pending state |
| UI detachment closes the generator | Main-process ownership tests with zero subscribers |
| Shared V2 dependencies are removed | Import/caller inventory and separate retirement work |
| Rollout repeats a non-idempotent tool | Never fail over mid-run or shadow-execute live tools |
| Separate parity work changes the same boundaries | Rebase implementation inventory and reconcile responsibilities without duplicating dispatch |

## 12. Acceptance scenarios and traceability

| ID | Scenario and required result | Requirements |
| --- | --- | --- |
| AC-01 | Delayed text/reasoning stream renders progressively and final history equals accepted output | FR-001–003, FR-007, FR-012 |
| AC-02 | Tool-call save is delayed then succeeds; tool starts afterward. Repeat with a failed save; tool never starts | FR-006, FR-017 |
| AC-03 | Switch conversations, detach all windows, and reattach during a run; execution continues and selected history is correct | FR-004/005/012 |
| AC-04 | Stop before dispatch, during provider read, retry backoff, tool progress, and a waiting state; no later round starts | FR-008/015 |
| AC-05 | Permission pause preserves waiting state; approval resumes once, denial follows existing policy, duplicate approval is safe | FR-009/010 |
| AC-06 | Plan question/answer and plan approval preserve their distinct existing workflows and do not publish false completion | FR-003/009/010 |
| AC-07 | Provider error before and after partial output preserves retry policy and yields accurate final state | FR-011/017 |
| AC-08 | Event consumer or required persistence fails; provider is aborted, generator is closed, no success is emitted | FR-006/007/015/017 |
| AC-09 | Slow consumer and callback burst stay within configured limits; overflow fails visibly and never silently drops tool/results | FR-016 |
| AC-10 | Duplicate, stale, and resumed-segment events cannot duplicate text or attach it to another run | FR-005/012 |
| AC-11 | Shared background/queue callers execute through the compatibility facade with no extra user-message persistence or tool calls | FR-013/018 |
| AC-12 | AI disabled means no parsing-dependent AI work, provider connection, or tool execution; existing gates remain enforced | FR-014 |
| AC-13 | Restart during running/waiting state reconciles persisted state without generator serialization or automatic tool replay | FR-019 |
| AC-14 | Toggle migration mode while a run is active/paused; that run remains on one implementation; the next new run uses the new setting | FR-018 |
| AC-15 | Workspace composer, transcript, inspectors, and localized changed states pass component and E2E tests | FR-012/020 |

## 13. Definition of done

The feature is complete when the generator path is the selected workspace implementation, every mandatory requirement has passing evidence, the provider and tool compatibility boundaries are documented, performance budgets are met, and rollback has been exercised without replaying real side effects. UI changes and their tests must be committed together. Finishing these planning documents does not itself complete the feature.

Open implementation questions must be resolved during P0: exact retry callback inventory, each shared caller's pause ownership, and callback-adapter production limits. The technical design supplies proposed defaults and decision rules. No unresolved question permits weakening persistence, cancellation, authorization, or run-lifetime guarantees.
