# Scheduled AI Task Completion and Premature-Stop Recovery PRD

## Document information

- Version: 2.0
- Updated: 2026-10-04
- Status: Proposed requirements; documentation only, implementation has not started.
- Owner: AiFetchly Desktop Engineering; AI server engineering owns server diagnostics.
- Technical design: [Scheduled task completion and recovery](./scheduled-loop-premature-stop-recovery-technical-design.md).
- Related: [Scheduled-loop PRD](./ai-chat-scheduled-loop-prd.md), [scheduled-loop design](./ai-chat-scheduled-loop-technical-design.md), [goal-loop design](./ai-chat-goal-loop-technical-design.md), [query-engine PRD](./ai-chat-query-engine-prd.md).
- This document retains its original filename so existing references continue to work. Version 2 replaces the earlier minimal recovery recommendation.

## 1. Problem and intended outcome

Some scheduled AI executions end with `finish_reason: "stop"`, no tool calls, and text such as “Let me try the direct tool name approach:” while the requested work remains unfinished. AiFetchly ends the turn and may record the scheduled occurrence as successful. The user receives neither the requested result nor a reliable explanation of why execution stopped.

The product must distinguish **the end of a model response**, **the end of a chat turn**, **the outcome of a scheduled occurrence**, and **the lifetime of the recurring schedule**. These are separate decisions.

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

- Apply a completion controller to enrolled chat-bound scheduled occurrences.
- Cover empty/text-only stops before tools, after tools, and after permission resumes.
- Distinguish normal stops, missing terminal data, truncation, and execution limits.
- Preserve the originating conversation, occurrence, transcript, approvals, workspace, cadence, and overlap rules.
- Persist criteria, evidence, recovery counters, task outcome, and terminal reason.
- Display recovery and outcomes in existing scheduled-chat and task-history surfaces.
- Add server diagnostics without making the server execute desktop tools or determine desktop success.

### 3.2 Later integrations

The controller interfaces should support explicitly autonomous interactive tasks and legacy schedule-page tasks. Those integrations need separate enrollment and compatibility tests. Ordinary chat does not become autonomous merely because tools or a scheduled loop exist in its conversation.

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
| Occurrence | One claimed scheduled execution, identified by existing run/occurrence keys. |
| Completion contract | Requested outcome, required criteria, evidence sources, and scope frozen for an occurrence. |
| Verified completion | Every required criterion passes with admissible current evidence. |
| Progress | New contract-relevant evidence, such as qualifying saved records or a confirmed job-state change. |
| Semantic continuation | New maker request because the preceding response ended while work remained. |
| Transport retry | Another wire attempt to obtain the same response; not a semantic continuation. |

Task outcomes are `verified_complete`, `incomplete`, `needs_user_input`, `blocked_by_policy`, `failed`, `cancelled`, and `timeout`.

A pending permission is non-terminal: preserve its existing bounded wait and resume handle. Final `needs_user_input` closes an occurrence and pauses the schedule when a question cannot be resolved through that permission workflow. These states must not be conflated.

`incomplete` means execution ended without sufficient completion evidence. Include saved progress, remaining work, and a reason such as `NO_PROGRESS`, `CONTINUATION_LIMIT`, `VERIFICATION_UNAVAILABLE`, or `UNKNOWN_ACTION_OUTCOME`. It is not a successful occurrence.

## 5. User scenarios

### 5.1 Useful work followed by premature stop

For “save 100 qualifying contacts,” tools save 54 and the model announces more searching before emitting `stop`. Check the actual saved qualifying count, continue from 54, and complete only after the agreed count and qualification requirements pass.

### 5.2 Stop before any tool

The first response says “I'll check the deployment now” and stops. No observation was retrieved. Recovery may request the approved check within budget; it must not require a prior tool round.

### 5.3 Genuine completion

The requested status was retrieved and an accurate explanation produced. Verification passes and the occurrence finishes without another maker request.

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

## 6. Completion-contract requirements

### FR-01 — Preserve the objective

Store the exact objective and originating user-message identity. Derived criteria may clarify requirements explicitly present in the objective but cannot add targets, recipients, actions, permissions, or schedule-wide stop conditions. Freeze contract/policy versions at occurrence start. Edits affect future occurrences, not a paused occurrence.

### FR-02 — Define occurrence-local completion

Support observations, saved data, artifacts, text deliverables, and confirmed operations. State whether evidence is occurrence-local or cumulative against an approved campaign/job. A recurring observation remains satisfiable while its external process is still running.

### FR-03 — Prefer authoritative evidence

Use saved records, artifact hashes/content, approved checks, and external receipts. Maker claims, requested tool calls, and generic tool success do not prove side-effect completion. Every required criterion must pass; optional passes cannot compensate for required failures.

Evidence must be current and scoped to the run or explicitly approved cumulative target. Unrelated existing files and another occurrence's results cannot satisfy occurrence-local work.

### FR-04 — Qualitative checks and unknown results

Use a separate tool-free checker for qualitative criteria. Schema-validate its response and require references to actual supplied evidence. It cannot override deterministic failure or resolve an uncertain operation through assertion. Invalid output, bad references, timeout, or absent evidence yields unknown, never pass.

Contracts have `verified` or `best_effort` mode. Best-effort allows bounded work without a complete automatic verification contract but cannot receive a verified-success badge unless valid evidence establishes every required criterion. Otherwise end incomplete with an unverified-result explanation. Historical completed rows remain historical; they are not retroactively verified.

A contract with zero required criteria cannot pass vacuously. Unsupported contracts need clarification or a validated task configuration before a future verified run; the maker cannot invent new acceptance criteria during recovery.

## 7. Recovery requirements

### FR-05 — Application-level decision boundary

For enrolled tasks, an internal response-end candidate reaches the controller before a terminal completion event is emitted. The controller returns continue, complete, wait, or non-success. The scheduler never decides task success from `finish_reason` alone.

### FR-06 — Distinguish stop conditions

| Condition | Handling |
| --- | --- |
| Valid parsed calls, including a provider `stop`. | Execute through normal validation/policy/budgets; no invented calls. |
| Normal no-tool response ending. | Verify the contract; continue only for unfinished feasible work. |
| Missing reliable terminal indicator. | Record incomplete-stream provenance; use bounded transport/output recovery; no inferred task success. |
| `length` or truncated arguments. | Bounded output recovery; partial unvalidated calls never execute. |
| Content filter or explicit safety refusal. | Surface the restriction; no bypass continuation. |
| AI disabled, permanent auth error, or quota denial. | Existing actionable failure/pause; semantic recovery cannot override it. |
| Round/request/token/runtime cap. | Complete only from already admissible evidence; otherwise incomplete/timeout. |
| User Stop or schedule Stop. | Abort promptly and preserve their distinct cancellation semantics. |

### FR-07 — Evidence-based continuation

A continuation states the unchanged objective, verified progress, unmet criteria, failures, restrictions, and allowed next steps. Preserve transcript/tool groups. Do not say work is unfinished after criteria passed or demand tools for a valid text deliverable.

### FR-08 — Occurrence-wide budgets

Enforce total continuations, provider attempts, actual tool executions, checker requests, active runtime, and accounted tokens across all recovery layers/resumes. Tool calls, compaction, model switches, and repeated `run()` invocations never reset total counters.

Proposed initial defaults:

| Limit | Rule |
| --- | --- |
| Semantic continuations | `min(task.maxContinueCalls, 3)`; configurable hard maximum 10. |
| Consecutive eligible no-progress responses | 3; persists across resumes; relevant new evidence alone resets the streak. |
| Provider dispatch attempts | 60 total, including maker, checker, compaction, retries, and fallback. |
| Checker attempts | 6 total; at most 2 per unchanged candidate, including one transient/invalid-response retry. |
| Tool executions | Existing task `maxToolCalls`; count attempts, not successful calls only. |
| Active runtime | Minimum of task runtime and existing scheduled 10-minute cap; exclude permission waits, retain consumed time. |
| Permission wait | Existing one-hour backstop; never refresh other budgets. |
| Accounted tokens | 128,000 input plus output tokens across requests; conservative estimates if usage is missing. Execution guard, not guaranteed billing ceiling. |

General round-cap cycles remain a backstop and cannot bypass these smaller run budgets. Reserve work before dispatch and reconcile afterward. Only trusted validated configuration changes the defaults.

### FR-09 — Results-based stall detection

Compute progress from relevant source revisions and metrics, excluding timestamps alone, random IDs, repeated text, and discovery traffic. Same normalized tool request plus unchanged result is a stall signal. A changed error can justify another allowed action but cannot replenish the total continuation allowance.

### FR-10 — Same-occurrence resume

Grant/deny retains run ID, occurrence, contract snapshot, counters, consumed active time, evidence, and trusted outbound authorization. Recovery creates no second scheduled user message or claimed occurrence. Persist denial and do not repeatedly pursue the denied operation.

### FR-11 — Protect consequential actions

Use durable operation identities tied to domain intent/target rather than changing provider tool-call IDs. Reuse existing send/job authorization/dedup where possible. Confirmed actions return their receipt; pending actions are queried; uncertain outcomes require reconciliation. Do not claim universal exactly-once effects when the provider lacks idempotency/status lookup.

Distinct occurrences can repeat explicitly recurring actions, subject to existing campaign/recipient-level deduplication. Recovery never broadens permission to repeat actions.

### FR-12 — Persist honest outcomes

Only verified completion increments successful occurrences. Incomplete/failed/timeout runs increment the existing failure streak and follow its three-failure policy. Input/policy blocks pause the schedule. User cancellation is not a failure. Interruption remains distinct.

An incomplete `UNKNOWN_ACTION_OUTCOME` increments the failure count once and pauses the schedule immediately for reconciliation, overriding normal next-occurrence handling. Resume cannot bypass an unresolved operation.

Persist outcome, evidence summary, counters, and linked assistant result before successful notifications. Persistence failure never sends success. Repeated finalization increments schedule counters at most once.

## 8. UX requirements

### FR-13 — Visible execution and outcomes

Show checking-completion and continuing-work states when appropriate. Preserve streamed content/tool history without presenting concatenated repetitive preambles as a final success. Final output includes the result, verified progress, remaining work/blocker, and stopping reason.

Display Completed only for enrolled verified outcomes. Display Incomplete, Needs input, Blocked, Cancelled, or Timed out accurately. Best-effort output explains that completion was not verified. Provider internals belong in expandable diagnostics.

### FR-14 — Actions and notifications

- Stop current run cancels that occurrence; future recurrence follows existing controls.
- Stop schedule prevents future occurrences and handles associated active work under existing behavior.
- Grant/deny resumes the same pending permission occurrence.
- Resume schedule creates a future occurrence; it does not blindly replay an uncertain prior action.
- History/restart retain progress and remaining work.
- Deliver one final outcome notification per occurrence under existing notification preferences; recovery steps do not produce duplicate notifications.

### FR-15 — Internationalization and UI tests

Translate every new state/message/action in `en`, `zh`, `es`, `fr`, `de`, and `ja`, with English fallbacks. UI changes require component tests; streaming/permission/history flows require E2E coverage.

## 9. Server diagnostic requirements

### FR-16 — Preserve reasons and record provenance

Preserve valid provider finish reasons. Distinguish provider-originated, adapter-normalized, synthetic-missing-terminal, and transport-error endings. Correlate desktop requests/runs with server query IDs, selected provider/model, safe upstream response ID, tool-schema identities, output budget, usage source, and terminal-chunk observation.

Routine diagnostics exclude credentials, full prompts, recipient data, tool arguments, and reasoning. Use safe identifiers/codes, lengths, and schema-definition hashes. Metadata remains optional and compatible with old clients; desktop completion control must work without it.

## 10. Reliability and compatibility

- NFR-01: Preserve one active writer/turn per conversation, interactive priority, and coalescing.
- NFR-02: All evidence/checker work is bounded and abortable. Verification failure cannot become unchecked success.
- NFR-03: Database access remains in Models/Modules using `Token`/`USERSDBPATH`; no worker direct access.
- NFR-04: AI IPC handlers gate AI enablement before parsing/constructing work; checker dispatch rechecks entitlement.
- NFR-05: Restart marks unfinished occurrences interrupted and preserves checkpoints/receipts; no automatic action replay.
- NFR-06: Existing OpenAI-compatible stream semantics remain compatible; diagnostic fields are optional.
- NFR-07: Recovery/evidence use the same workspace, policy, outbound authorization, and plan/question boundaries.
- NFR-08: Store bounded redacted evidence; checker treats it as untrusted data and has no mutation tools.

## 11. Acceptance criteria

| ID | Scenario | Required assertion |
| --- | --- | --- |
| AC-01 | Save 54/100 contacts then text-stop. | Continue from 54; verify qualifying saved count before completion. |
| AC-02 | First response announces work with no tool. | Same-occurrence recovery without a prerequisite tool round. |
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
| AC-14 | Ordinary chat or immediate goal loops. | Lifecycle/ownership retained; no scheduled-policy leakage. |
| AC-15 | Result/checkpoint persistence fails. | No success notification or count increment. |
| AC-16 | History reload in supported languages. | Correct statuses, progress, translations, and available actions. |

## 12. Delivery and rollout

1. Diagnostics and read-only shadow verification; no new maker actions or verified labels.
2. Enroll approved observation/data tasks with contracts, budgets, persistence, and complete outcome UI.
3. Enroll consequential actions only after operation guards and fault-injection tests pass AC-09/10/13.
4. Enroll legacy schedules/explicit autonomous chat separately; never infer new targets silently.

Sample the feature flag at occurrence start and freeze its policy. Rollback disables new enrollment/recovery but never converts unfinished enrolled work into success or removes receipts. Schema changes are additive. Historical completed rows retain historical meaning and are not relabeled verified.

Measure evidence-backed completion, premature-stop recovery, incomplete reasons, extra maker/checker calls, usage with actual/estimated labels, latency, pause behavior, and duplicate effects. Launch requires all acceptance tests, zero duplicate effects in fault-injection tests, and zero enrolled non-verified runs recorded successful. Compare production improvements against a shadow baseline.

## 13. Risks and decisions

| Risk | Decision |
| --- | --- |
| No reliable task completion test. | Clarify or best-effort labeling; no unchecked verified success. |
| Checker repeats maker mistakes. | Deterministic evidence first, independent invocation, validated references. |
| Recovery increases cost. | Persist total limits and reserve requests; distinguish billed usage from context size. |
| Timestamp changes look productive. | Use relevant revisions/metrics, not timestamps alone. |
| External effects cannot be guaranteed exactly once. | Durable uncertainty and reconciliation; no blind replay. |
| Existing goal checks are incomplete. | Reuse interfaces selectively and strengthen actual evidence checks. |
| Monitor confused with finish-until-done job. | Verify this occurrence's observation/report, not eventual external success. |

The companion technical design defines interfaces, storage, decision precedence, pause/resume behavior, operation protection, and test ownership. This documentation does not implement the feature or resolve production provider attribution without a trace.
