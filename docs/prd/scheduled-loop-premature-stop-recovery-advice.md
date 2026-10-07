# AI Task Completion and Premature-Stop Recovery PRD

## Document information

- Version: 3.0
- Updated: 2026-10-04
- Status: Proposed requirements; documentation only, implementation has not started.
- Owner: AiFetchly Desktop Engineering; AI server engineering owns server diagnostics.
- Technical design: [Shared task completion and recovery](./scheduled-loop-premature-stop-recovery-technical-design.md).
- Related: [Scheduled-loop PRD](./ai-chat-scheduled-loop-prd.md), [scheduled-loop design](./ai-chat-scheduled-loop-technical-design.md), [goal-loop design](./ai-chat-goal-loop-technical-design.md), [query-engine PRD](./ai-chat-query-engine-prd.md).
- This document retains its original filename so existing references continue to work. Version 3 expands version 2 to manually started tasks in the initial release; neither scheduling nor `/goal` is required for recovery.

## 1. Problem and intended outcome

Manually started and scheduled AI executions can end with `finish_reason: "stop"`, no tool calls, and text such as “Let me try the direct tool name approach:” while the requested work remains unfinished. AiFetchly ends the turn despite unfinished work and may also record a scheduled occurrence as successful. The user receives neither the requested result nor a reliable explanation of why execution stopped.

The product must distinguish **the end of a model response**, **the end of a chat turn**, **the outcome of a task execution**, and **the lifetime of the recurring schedule**. These are separate decisions.

The desired behavior is to continue unfinished, authorized work within explicit limits; finish promptly when the requested result is supported by evidence; pause when input or permission is needed; and report incomplete work honestly when recovery cannot succeed.

The user has approved this direction for specification. Numeric defaults and interfaces below are proposed decisions, not descriptions of already shipped behavior.

## 2. Current behavior and evidence boundaries

The following observations were checked against local code on 2026-10-04:

| Observation | Current source |
| --- | --- |
| Valid parsed tool calls can execute even when the provider reports `stop`. | `src/service/AIChatQueryLoop.ts`, parsed-call / `willContinue` branch |
| Text-stop recovery requires `goalAutoContinue`, no plan context, tools committed in this invocation, no last failed tool, and non-empty text. It does not verify completion. | `AIChatQueryLoop.ts`, `goalTextStop` |
| `goalAutoContinue` depends on an active conversation goal. Scheduled context alone does not enable it. | `src/service/AIChatQueryEngine.ts`, `shouldAutoContinueGoal` |
| The text-stop counter resets when a round commits to tool calls, before those tools necessarily succeed. | `AIChatQueryLoop.ts`, `executedToolRound` assignment |
| Exhausting recovery or round limits can still return a completed chat-turn result. | `AIChatQueryLoop.ts`, final return |
| The scheduled sink maps `complete` to a completed outcome; the runner records success. | `src/service/ScheduledLoopEventSink.ts`; `src/service/ScheduledAiMessageRunner.ts` |
| The server normally forwards adapter chunks and infers `tool_calls` or `stop` when a stream lacks a terminal chunk. | `../aifetchserver/aifetchserver/api/openai_compatible.py`, streaming response builder |
| Server model selection treats `auto` as an unspecified model. | `openai_compatible.py`, `_normalize_model_name` |

These establish a client completion-policy weakness. They do **not** establish the cause of a particular production stop. A correlated trace is needed to distinguish provider behavior, adapter normalization, missing terminal data, gateway behavior, and token-limit behavior.

The earlier assertions that `auto` proves a gateway defect, scheduled recovery has at most three additional requests per turn, and broadening the predicate has no regression risk are superseded.

The [official OpenAI SDK definition](https://github.com/openai/openai-python/blob/main/src/openai/types/chat/chat_completion.py) describes `stop` as a natural stopping point or stop sequence. It is not evidence that an application-level task succeeded.

## 3. Scope

### 3.1 Initial release

- Apply one shared completion boundary to every accepted manual Chat V2 turn and enrolled chat-bound scheduled occurrence.
- Automatically enroll actionable manual requests and requested deliverables; no `/goal`, `/loop`, schedule, or extra task-mode switch is required.
- Resolve ordinary answers, task execution, and preparation/approval stages without granting new permissions. A response ending and a verified task outcome remain separate.
- Use durable execution identity independent of schedule tables; a scheduled occurrence references this execution.
- Cover empty/text-only stops before tools, after tools, and after permission resumes.
- Distinguish normal stops, missing terminal data, truncation, and execution limits.
- Preserve the originating conversation, execution, transcript, approvals, and workspace. Scheduled executions additionally retain occurrence, cadence, and overlap rules.
- Persist criteria, evidence, recovery counters, task outcome, and terminal reason.
- Display recovery and outcomes in manual chat, conversation reload, and scheduled task-history surfaces.
- Add server diagnostics without making the server execute desktop tools or determine desktop success.

### 3.2 Later integrations

Legacy schedule-page tasks and other AI features outside Chat V2 need separate adapters and compatibility tests. Manual Chat V2 tasks are part of the initial release. Tool availability, an old goal, a retrieved instruction, or a schedule elsewhere in the conversation cannot enroll an unrelated response into that objective.

### 3.3 Non-goals

- Guarantee completion of arbitrary natural-language tasks.
- Rewrite `stop` into `tool_calls`, fabricate tool calls, or increase output limits for every stop.
- Create temporary `/goal` records to activate a recovery flag.
- Let the model expand permissions, change the objective, or increase limits.
- Restart the full task from its initial prompt after every stop.
- Automatically replay interrupted work after restart.
- Stop recurrence because one occurrence completed; schedule-wide natural-language stop conditions remain separate.

## 4. Vocabulary and outcomes

| Term | Meaning |
| --- | --- |
| Model response | One provider generation ending with a finish reason or transport event. |
| Chat turn | Model/tool execution for one user message, including continuations/resumes. |
| Execution | One accepted manual task or scheduled occurrence with a stable main-process ID and bounded execution policy. |
| Occurrence | A scheduled trigger linked to one execution; manual tasks have no occurrence or schedule record. |
| Response-only turn | A normal question/conversation ending without a task-success claim or task recovery loop. |
| Completion contract | Requested outcome, required criteria, evidence sources, and scope frozen for an execution. |
| Verified completion | Every required criterion passes with admissible current evidence. |
| Progress | New contract-relevant evidence, such as qualifying saved records or a confirmed job-state change. |
| Semantic continuation | New maker request because the preceding response ended while work remained. |
| Transport retry | Another wire attempt to obtain the same response; not a semantic continuation. |

Task outcomes are `verified_complete`, `incomplete`, `needs_user_input`, `blocked_by_policy`, `failed`, `cancelled`, and `timeout`. Response-only turns use a distinct response-ended result, with no verified task-success badge. Closing the stream never implies task success.

A pending permission is non-terminal: preserve its existing bounded wait and resume handle. A supported pending question or plan approval can also preserve the execution under a bounded wait. Final `needs_user_input` closes the execution when no live resume handle remains; only scheduled executions additionally pause their schedule. These states must not be conflated.

`incomplete` means execution ended without sufficient completion evidence. Include saved progress, remaining work, and a reason such as `NO_PROGRESS`, `CONTINUATION_LIMIT`, `VERIFICATION_UNAVAILABLE`, or `UNKNOWN_ACTION_OUTCOME`. It is not a successful task execution or occurrence.

## 5. User scenarios

### 5.1 Manually started work followed by premature stop

The user types “save 100 qualifying contacts” directly into chat, without a slash command or schedule. Tools save 54 and the model announces more searching before emitting `stop`. Check the actual saved qualifying count, continue from 54, and complete only after the agreed count and qualification requirements pass.

### 5.2 Stop before any tool

The first response says “I'll check the deployment now” and stops. No observation was retrieved. Recovery may request the approved check within budget; it must not require a prior tool round.

### 5.3 Genuine completion

The requested status was retrieved and an accurate explanation produced. Verification passes and the execution finishes without another maker request.

### 5.4 Recurring monitoring

For “check deployment status every five minutes,” retrieving and reporting the current state completes this occurrence even if deployment is still running. Do not poll until deployment completion unless explicitly requested. Recurrence retains its cadence.

### 5.5 Permission or missing information

Use the existing permission card for gated actions. For missing credentials or answers, explain the missing input and pause. Do not repeatedly nudge around the same restriction or invent an answer.

### 5.6 No meaningful progress

Repeated tool discovery or identical searches do not renew recovery allowances. End incomplete within limits, retaining useful partial results and the repeated obstruction.

### 5.7 Uncertain external action

A send request times out after dispatch. Query its operation receipt/job status; do not send again merely because the response is absent. If the result cannot be resolved, end incomplete and require reconciliation.

### 5.8 Text deliverable or ambiguous task

For “write a short summary,” the final text is the deliverable and may be checked against supplied sources. For “grow my business,” do not invent targets. Request clarification or use explicitly labeled best-effort execution; a weak contract cannot yield unchecked verified success.

### 5.9 Ordinary question

“What does this setting mean?” receives a sufficient explanation and ends normally. The presence of tools or a previous campaign task cannot cause contact collection, mandatory tool use, or a continuation loop.

### 5.10 Approved manual plan

“Create a campaign” enters planning. A saved draft or approval request is preparation, not campaign completion. Approval resumes the same execution and consumed limits; actual campaign criteria apply after the approved scope is frozen. Recovery cannot approve the plan itself. When the request is only “draft a campaign plan,” the draft is the requested deliverable and can complete without creating a campaign.

### 5.11 Transport Retry versus Continue versus new work

A network retry reuses the accepted submission and execution. “Continue” for a live pending task retains its context and limits. A terminal task is not silently revived; continuing it creates a linked successor with remaining allowances, or an explicitly requested new bounded attempt. Existing records/receipts are reconciled before either path performs effects.

### 5.12 Stop and new manual request

Stop aborts checking and recovery as well as model work. A different request must not inherit the unfinished task's objective or allowances. New scope replaces/cancels old active work through the existing conversation coordinator; late results cannot overwrite the new turn.

### 5.13 Multi-part manual request

“Find 20 leads, save them, and draft an email” requires evidence for all three requested outcomes. A draft alone does not pass. “Draft an email” alone never grants authority to send it.

## 5A. Manual-task enrollment and lifecycle

The recommended design is automatic request resolution plus one shared completion controller. Requiring a separate task toggle would leave normal manually typed tasks exposed. Retrying every model stop indiscriminately would loop on valid answers and blockers. Neither alternative is the release behavior.

### FR-17 — Protect manual requests by default

Every accepted manual Chat V2 submission passes through a trusted main-process request resolver and completion boundary. Stable execution identity is registered before potentially slow resolution so Stop already works. Action requests, information-gathering tasks, and requested text/artifact deliverables receive execution-scoped completion handling automatically. A task is protected even when its first response has no tool call, no content, or only a promise to act. The resolver must not require a preceding successful tool execution or an active goal.

### FR-18 — Resolve intent conservatively

Use validated action/task templates and structured request analysis where templates do not cover the request. Source the objective from the actual user message and user-approved references; retrieve content only as task data. Explicit referential follow-ups can use the linked prior objective. An assistant promise, tool result, quoted instruction, attachment, selected history, runtime nudge, or renderer-supplied system prompt cannot independently authorize work.

Route each turn as response-only, task-verified, task-best-effort, or preparation requiring approval/input. Do not use punctuation, keyword matching, or “tools were called” alone to decide. For “check the latest deployment status,” retrieval/report is the task even though it resembles a question. For “what is a deployment?”, a sufficient explanation ends normally. Classifier outputs are advisory until main-process schema/source/scope validation; their failure cannot silently downgrade an actionable request to unchecked success.

If material targets, actions, or expected outcomes are ambiguous, ask one focused question or deliver explicitly unverified best-effort work. Routine inferred criteria restating an unambiguous user request require no additional confirmation. Classification can neither enable AI nor broaden any approval or outbound-send permission.

### FR-19 — Form usable manual contracts

Support a count/target, fresh observation plus report, changed/saved artifact, user-requested text deliverable, confirmed operation, and conjunctions of requested outcomes. Derived criteria must retain source references and distinguish draft/start/finish/send semantics. The original request and approved plan determine scope; the maker cannot lower a target or invent completion conditions.

General natural-language tasks may use qualitative criteria anchored to the actual request and supplied evidence. A best-effort task without admissible required criteria cannot pass verified. When completion cannot be determined, end with an unverified-result explanation or needed clarification rather than generating repeated work solely to satisfy the checker.

### FR-20 — One execution, one completion owner

Manual execution has its own durable identity, not a fake schedule/run or `/goal` record. Immutable execution outcomes reference a separate versioned ledger so Continue successors can spend remaining allowance without modifying old outcomes. The shared engine owns its lifetime; scheduled runner and goal controller are adapters. Freeze one completion owner per execution: standalone controller or actual goal controller. An unrelated active conversation goal cannot take over an ordinary manual request. Goal-controlled maker rounds cannot simultaneously start the standalone semantic-recovery loop.

### FR-21 — Preparation, pauses, and follow-ups

Planning, approval, permission, and supported question waits retain the same execution, source-message links, evidence, receipts, remaining limits, and original authority. A draft plan does not satisfy execution criteria. Before effect execution, freeze the original request plus actually approved plan as the contract; post-freeze scope changes create a successor, rather than editing a paused contract in place.

A transport retry with the same accepted submission is idempotent. A linked “continue” reuses remaining limits and progress and never automatically refreshes exhausted allowances. An explicit Retry remaining work/new attempt may create new bounded allowances, clearly shown as a new attempt; it does not authorize repeating confirmed or uncertain effects. Cancelled work requires an explicit new request. New unrelated work receives an independent objective, and conversation serialization prevents overlapping writers.

### FR-22 — Honest manual UX

Manual chat displays Working, Checking completion, Continuing, waiting states, and the final outcome. Stop remains available during checking/recovery and aborts all owned work promptly. A valid response-only answer closes normally with no task-success badge. Task Completed means verified; Incomplete explains saved progress, remaining work, and the stopping reason. An unverified result cannot appear as Completed on live stream, history reload, or notification.

Render bounded response segments and one coherent final deliverable; do not show repeated internal nudges as new user messages. Permission/questions remain the existing interactive controls. After interruption, show progress and an explicit continue/retry path only if available and safe. Retry distinguishes unfinished work from replaying the original request. No duplicate toast is generated for each recovery attempt.

### FR-23 — Execution-wide manual limits

All automatic retries, maker/checker/intent-resolution requests, compaction/fallback, tool calls, and permission resumes consume one execution ledger. Manual defaults are 3 semantic continuations, 60 provider attempts, 6 checker attempts, 50 tool executions, 128,000 accounted tokens, and 10 minutes active runtime. Intent resolution has at most 2 provider attempts, included in the total; scheduled contract configuration normally avoids this work. Trusted settings may tune limits within hard caps; manual active runtime has a 30-minute hard maximum. Waits have a one-hour backstop and do not reset consumed budgets. Existing stricter tool/permission limits still apply.

### FR-24 — Durable outcomes without schedule accounting

Persist manual contract/policy, execution state, progress, result-message links, receipts, and final outcome independently of schedule tables. Manual finalization never changes recurrence, schedule success counts, or failure streaks. Scheduled finalization links the same execution outcome and updates its occurrence/schedule atomically. Restart never automatically repeats unfinished manual actions, and a new conversation or execution ID cannot bypass an unresolved earlier operation for the same intent/target.

## 6. Completion-contract requirements

### FR-01 — Preserve the objective

Store the exact objective and originating user-message identity. Derived criteria may clarify requirements explicitly present in the objective but cannot add targets, recipients, actions, permissions, or schedule-wide stop conditions. Freeze policy at acceptance and executable contract before the first task action. A planning stage can resolve approved scope before that freeze; later edits affect future executions, not an executing/paused frozen contract.

### FR-02 — Define execution-local completion

Support observations, saved data, artifacts, text deliverables, and confirmed operations. State whether evidence is execution-local or cumulative against an approved campaign/job. A recurring observation remains satisfiable while its external process is still running.

### FR-03 — Prefer authoritative evidence

Use saved records, artifact hashes/content, approved checks, and external receipts. Maker claims, requested tool calls, and generic tool success do not prove side-effect completion. Every required criterion must pass; optional passes cannot compensate for required failures.

Evidence must be current and scoped to the execution or explicitly approved cumulative target. Unrelated existing files and another execution's results cannot satisfy execution-local work.

### FR-04 — Qualitative checks and unknown results

Use a separate tool-free checker for qualitative criteria. Schema-validate its response and require references to actual supplied evidence. It cannot override deterministic failure or resolve an uncertain operation through assertion. Invalid output, bad references, timeout, or absent evidence yields unknown, never pass.

Contracts have `verified` or `best_effort` mode. Best-effort allows bounded work without a complete automatic verification contract but cannot receive a verified-success badge unless valid evidence establishes every required criterion. Otherwise end incomplete with an unverified-result explanation. Historical completed rows remain historical; they are not retroactively verified.

A contract with zero required criteria cannot pass vacuously. Unsupported contracts need clarification or a validated task configuration before a future verified run; the maker cannot invent new acceptance criteria during recovery.

## 7. Recovery requirements

### FR-05 — Application-level decision boundary

For enrolled tasks, an internal response-end candidate reaches the controller before a terminal completion event is emitted. The controller returns continue, complete, wait, or non-success. Neither manual chat nor the scheduler decides task success from `finish_reason` alone. All owners defer terminal signals until the recovery decision and durable finalization are complete.

### FR-06 — Distinguish stop conditions

| Condition | Handling |
| --- | --- |
| Valid parsed calls, including a provider `stop`. | Execute through normal validation/policy/budgets; no invented calls. |
| Normal no-tool response ending. | Response-only answers end naturally. Task routes verify the contract and continue only for unfinished feasible work. |
| Missing reliable terminal indicator. | Record incomplete-stream provenance; use bounded transport/output recovery; no inferred task success. |
| `length` or truncated arguments. | Bounded output recovery; partial unvalidated calls never execute. |
| Content filter or explicit safety refusal. | Surface the restriction; no bypass continuation. |
| AI disabled, permanent auth error, or quota denial. | Existing actionable failure/pause; semantic recovery cannot override it. |
| Round/request/token/runtime cap. | Complete only from already admissible evidence; otherwise incomplete/timeout. |
| User Stop, replacement request, or schedule Stop. | Abort promptly, fence late callbacks, and preserve their distinct cancellation semantics. |

### FR-07 — Evidence-based continuation

A continuation states the unchanged objective, verified progress, unmet criteria, failures, restrictions, and allowed next steps. Preserve transcript/tool groups. Do not say work is unfinished after criteria passed or demand tools for a valid text deliverable.

### FR-08 — Execution-wide budgets

Enforce total continuations, provider attempts, actual tool executions, checker requests, active runtime, and accounted tokens across all recovery layers/resumes. Tool calls, compaction, model switches, and repeated `run()` invocations never reset total counters.

Proposed initial defaults:

| Limit | Rule |
| --- | --- |
| Semantic continuations | Manual default 3; scheduled `min(task.maxContinueCalls, 3)`; hard maximum 10 for either. |
| Consecutive eligible no-progress responses | 3; persists across resumes; relevant new evidence alone resets the streak. |
| Provider dispatch attempts | 60 total, including intent resolution, maker, checker, compaction, retries, and fallback. |
| Checker attempts | 6 total; at most 2 per unchanged candidate, including one transient/invalid-response retry. |
| Tool executions | Manual default 50; scheduled existing task `maxToolCalls`; count attempts, not successful calls only. |
| Active runtime | Manual default 10 minutes, hard cap 30 minutes; scheduled minimum of task runtime and existing 10-minute cap. Bounded permission/input/approval waits exclude active time; consumed time persists. |
| Permission/input/approval wait | One-hour backstop per execution without refreshing on repeated wait/resume; never refresh other budgets. |
| Accounted tokens | 128,000 input plus output tokens across requests; conservative estimates if usage is missing. Execution guard, not guaranteed billing ceiling. |

General round-cap cycles remain a backstop and cannot bypass these smaller run budgets. Reserve work before dispatch and reconcile afterward. Only trusted validated configuration changes the defaults.

### FR-09 — Results-based stall detection

Compute progress from relevant source revisions and metrics, excluding timestamps alone, random IDs, repeated text, and discovery traffic. Same normalized tool request plus unchanged result is a stall signal. A changed error can justify another allowed action but cannot replenish the total continuation allowance.

### FR-10 — Same-execution resume

Grant/deny retains execution ID, optional occurrence reference, contract snapshot, counters, consumed active time, evidence, and trusted outbound authorization. Recovery creates no second submitted user request, execution, or claimed occurrence. Actual user answers/approvals remain real linked messages, rather than runtime nudges. Persist denial and do not repeatedly pursue the denied operation.

### FR-11 — Protect consequential actions

Use durable operation identities tied to domain intent/target rather than changing provider tool-call IDs. Reuse existing send/job authorization/dedup where possible. Confirmed actions return their receipt; pending actions are queried; uncertain outcomes require reconciliation. Do not claim universal exactly-once effects when the provider lacks idempotency/status lookup.

Distinct occurrences can repeat explicitly recurring actions, subject to existing campaign/recipient-level deduplication. Recovery never broadens permission to repeat actions.

### FR-12 — Persist honest outcomes

Manual executions finalize without touching schedules. For scheduled executions only, verified completion increments successful occurrences. Incomplete/failed/timeout runs increment the existing failure streak and follow its three-failure policy. Input/policy blocks pause the schedule. User cancellation is not a failure. Interruption remains distinct.

An incomplete `UNKNOWN_ACTION_OUTCOME` prevents manual replay and requires reconciliation. For scheduled origin it additionally increments the failure count once and pauses the schedule immediately, overriding normal next-occurrence handling. Resume cannot bypass an unresolved operation.

Persist outcome, evidence summary, counters, and linked assistant result before terminal outcome events or notifications. Recoverable provider errors and proposed response endings remain non-terminal while recovery is being decided. Result persistence precedes final delivery for manual and scheduled tasks alike. Persistence failure never sends success. Repeated finalization increments schedule counters at most once.

## 8. UX requirements

### FR-13 — Visible execution and outcomes

Show checking-completion and continuing-work states when appropriate. Preserve streamed content/tool history without presenting concatenated repetitive preambles as a final success. Final output includes the result, verified progress, remaining work/blocker, and stopping reason.

Display Completed only for enrolled verified outcomes. Display Incomplete, Needs input, Blocked, Cancelled, or Timed out accurately. Best-effort output explains that completion was not verified. Provider internals belong in expandable diagnostics.

### FR-14 — Actions and notifications

- Manual Stop cancels that execution, including checker/recovery. Replacement input fences the old execution before accepting new work.
- Stop current scheduled run cancels that occurrence; future recurrence follows existing controls.
- Stop schedule prevents future occurrences and handles associated active work under existing behavior.
- Grant/deny or supported question/approval answers resume the same execution; manual actions never inherit scheduled pre-authorization.
- Resume schedule creates a future occurrence; it does not blindly replay an uncertain prior action.
- History/restart retain progress and remaining work.
- Deliver one final outcome event per execution and notifications under existing preferences; recovery steps do not produce duplicate notifications.

### FR-15 — Internationalization and UI tests

Translate every new state/message/action in `en`, `zh`, `es`, `fr`, `de`, and `ja`, with English fallbacks. UI changes require component tests; streaming/permission/history flows require E2E coverage.

## 9. Server diagnostic requirements

### FR-16 — Preserve reasons and record provenance

Preserve valid provider finish reasons. Distinguish provider-originated, adapter-normalized, synthetic-missing-terminal, and transport-error endings. Correlate desktop requests/executions and optional scheduled runs with server query IDs, selected provider/model, safe upstream response ID, tool-schema identities, output budget, usage source, and terminal-chunk observation.

Routine diagnostics exclude credentials, full prompts, recipient data, tool arguments, and reasoning. Use safe identifiers/codes, lengths, and schema-definition hashes. Metadata remains optional and compatible with old clients; desktop completion control must work without it.

## 10. Reliability and compatibility

- NFR-01: Preserve one active writer/turn per conversation, interactive priority, and coalescing.
- NFR-02: All evidence/checker work is bounded and abortable. Verification failure cannot become unchecked success.
- NFR-03: Database access remains in Models/Modules using `Token`/`USERSDBPATH`; no worker direct access.
- NFR-04: AI IPC handlers gate AI enablement before parsing/constructing work; checker dispatch rechecks entitlement.
- NFR-05: Restart marks unfinished manual executions and scheduled occurrences interrupted and preserves checkpoints/receipts; no automatic action replay.
- NFR-06: Existing OpenAI-compatible stream semantics remain compatible; diagnostic fields are optional.
- NFR-07: Recovery/evidence use the same workspace, policy, outbound authorization, and plan/question boundaries.
- NFR-08: Store bounded redacted evidence; checker treats it as untrusted data and has no mutation tools.
- NFR-09: Manual coverage requires no schedule record, active goal, prior tool call, or user task-mode toggle.
- NFR-10: One terminal event per execution, emitted after durable finalization; stale callbacks cannot affect a newer execution.
- NFR-11: Distinguish response-ended, task outcome, goal outcome, and occurrence accounting in every serializer.
- NFR-12: Intent-resolution errors and feature rollback cannot silently turn enrolled unfinished work into verified success.

## 11. Acceptance criteria

| ID | Scenario | Required assertion |
| --- | --- | --- |
| AC-01 | Save 54/100 contacts then text-stop. | Continue from 54; verify qualifying saved count before completion. |
| AC-02 | First response announces work with no tool. | Same-execution recovery without a prerequisite tool round. |
| AC-03 | All required evidence passes. | Complete without another maker call. |
| AC-04 | Status check finds external job still running. | Observation occurrence completes; recurrence continues. |
| AC-05 | Repeated discoveries/searches yield no new evidence. | End incomplete within limits; no success increment. |
| AC-06 | Permission pause/grant followed by another stop. | Counters/context retained; no duplicate user message. |
| AC-07 | Permission denial or missing input. | Honor restriction/pause; no workaround nudges. |
| AC-08 | Any total budget exhausted. | No later dispatch; evidence-backed completion or explicit non-success. |
| AC-09 | Send succeeded but response was lost. | Reconcile/reuse receipt; never resend on recovery. |
| AC-10 | Send outcome cannot be resolved. | Unknown-action incomplete outcome; no blind replay. |
| AC-11 | Checker invents evidence or deterministic checks fail. | Reject success. |
| AC-12 | Filter/error/truncation/missing terminal. | Distinct treatment/provenance; no fabricated tools or bypass. |
| AC-13 | Restart after dispatch or before notification. | Retain interrupted progress; deduplicate finalization/delivery. |
| AC-14 | Ordinary chat or immediate goal loops. | Valid answer ends naturally; exactly one completion owner; no goal/approval leakage or stacked nudges. |
| AC-15 | Result/checkpoint persistence fails. | No success notification or count increment. |
| AC-16 | History reload in supported languages. | Correct statuses, progress, translations, and available actions. |
| AC-17 | Manual “save 100 contacts,” no slash command or schedule. | Automatic task enrollment; 54/100 stop continues; no schedule entity/count is created. |
| AC-18 | Manual first response empty or “I will check” with no tool. | Shared boundary detects missing result and allows bounded same-execution recovery. |
| AC-19 | Ordinary question versus fresh-information task. | Explanation ends naturally; “check latest status” requires actual retrieval/report. |
| AC-20 | Manual text deliverable and multi-part request. | Actual valid text can pass without tools; every requested part must pass. |
| AC-21 | Resolver/checker fails or task is ambiguous. | Unknown/clarification/unverified outcome; no false Completed or invented target. |
| AC-22 | Manual permission/question/plan approval resume. | Same execution and remaining limits; no scheduled send pre-authorization. |
| AC-23 | Manual planning emits stop after draft. | Wait for actual approval; no task success or mutation from a draft. |
| AC-24 | Manual Stop during verification/recovery. | Prompt cancellation; no additional maker/tool dispatch or late success. |
| AC-25 | New unrelated request during old task. | Fence/cancel old owner before new writer; new objective does not inherit old goal. |
| AC-26 | Same submission transport retry. | One accepted user message/execution, no duplicated effects or renewed limits. |
| AC-27 | “Continue” after interruption/incomplete. | Linked progress/receipts/baselines and remaining ledger, with one active successor; explicit new attempt is visibly distinct; no hidden allowance renewal. |
| AC-28 | Manual effect dispatched, stream lost or process restarted. | Reconcile receipts; unknown blocks replay even in a new run/conversation. |
| AC-29 | Manual recovery loops through tool traffic/compaction/model fallback. | Total request/tool/time/token counters stay monotonic. |
| AC-30 | Recoverable error arrives before recovery decision. | Desktop remains attached; non-terminal progress only; one durable terminal outcome. |
| AC-31 | Active goal exists but user asks unrelated question. | No automatic goal takeover; explicitly goal-owned iterations retain single-owner behavior. |
| AC-32 | Manual terminal result or persistence race/reload. | Honest stored status, no schedule accounting, idempotent final event identity and no stale overwrite. |

## 12. Delivery and rollout

1. Shared request/end classification and read-only shadow verification for manual and scheduled paths; no new maker actions or verified labels.
2. Enable manual and scheduled observation/data/text tasks together with contracts, execution persistence, budgets, complete outcome UI, and AC-17–27/29–32. Manual coverage is a release gate, not a later compatibility phase.
3. Enable consequential actions on both paths only after operation guards and fault-injection tests pass AC-09/10/13/28.
4. Adapt legacy schedule-page and non-Chat-V2 AI features separately; never infer new targets silently.

Sample the shared feature flag at execution acceptance and freeze its policy. Rollback disables new enrollment/recovery but never converts unfinished enrolled work into success or removes receipts. Schema changes are additive. Historical completed rows retain historical meaning and are not relabeled verified.

Measure evidence-backed completion, premature-stop recovery, incomplete reasons, extra resolver/maker/checker calls, usage with actual/estimated labels, latency, pause behavior, and duplicate effects. Launch requires all acceptance tests, zero duplicate effects in fault-injection tests, and zero enrolled non-verified runs recorded successful. Compare production improvements against a shadow baseline, segmented by manual/scheduled origin, request route, and action risk. No release is complete if only scheduled tasks are protected.

## 13. Risks and decisions

| Risk | Decision |
| --- | --- |
| No reliable task completion test. | Clarify or best-effort labeling; no unchecked verified success. |
| Checker repeats maker mistakes. | Deterministic evidence first, independent invocation, validated references. |
| Recovery increases cost. | Persist total limits and reserve requests; distinguish billed usage from context size. |
| Timestamp changes look productive. | Use relevant revisions/metrics, not timestamps alone. |
| External effects cannot be guaranteed exactly once. | Durable uncertainty and reconciliation; no blind replay. |
| Existing goal checks are incomplete. | Reuse interfaces selectively and strengthen actual evidence checks. |
| Monitor confused with finish-until-done job. | Verify this execution's observation/report, not eventual external success. |
| Manual task classified as chat or question classified as action. | Validated intent resolution, ambiguity handling, and paired request tests; no permission from classification. |
| Continue/new request renews limits or replays sends. | Explicit linkage/attempt semantics, immutable outcomes, remaining allowances, and cross-execution reconciliation. |

The companion technical design defines interfaces, storage, decision precedence, pause/resume behavior, operation protection, and test ownership. This documentation does not implement the feature or resolve production provider attribution without a trace.
