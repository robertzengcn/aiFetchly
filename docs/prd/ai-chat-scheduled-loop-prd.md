# AI Chat V2 Scheduled Loop Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-01
- **Owner**: AiFetchly Desktop Engineering
- **Related documents**:
  - [AI Chat V2 Goal and Loop Commands PRD](./ai-chat-goal-loop-prd.md)
  - [AI Chat V2 Goal and Loop Technical Design](./ai-chat-goal-loop-technical-design.md)
  - `docs/skills/ai-message-task-prd/README.md`
  - `docs/superpowers/specs/2026-06-09-scheduled-ai-message-task-design.md`
  - `src/service/ScheduledAiMessageRunner.ts`
  - `src/service/AIChatQueryEngine.ts`
  - `src/modules/AIChatV2Module.ts`
  - `src/modules/AiMessageTaskModule.ts`
  - `src/modules/BackgroundScheduler.ts`

## 1. Executive Summary

AiFetchly should extend AI Chat V2 `/loop` with a persistent, interval-based
scheduled-message mode:

```text
/loop 5m check if the deployment finished and tell me what happened
```

The command schedules the supplied prompt to run every five minutes. Every
scheduled execution must remain in the exact AI Chat V2 conversation where the
user entered the command. It must not create a new chat for each execution and
must not silently fall back to an `ai-msg-*` conversation.

Each occurrence becomes a normal, durable conversation turn:

1. A scheduled user message is appended to the originating conversation.
2. The AI receives that conversation's existing history and context.
3. The assistant response is appended to the same conversation.
4. An open renderer is notified that the conversation changed.
5. If another conversation is open, AiFetchly updates the conversation preview
   and unread state without navigating the user away from their current work.

The feature must reuse the existing persistent scheduler, AI message task
entities, and AI Chat V2 query engine. The scheduler owns when a run starts.
`AIChatQueryEngine` owns transcript assembly and chat-message persistence. A
shared conversation-turn coordinator prevents interactive and scheduled turns
from interleaving in the same conversation.

The existing immediate goal-loop command remains backward compatible:

```text
/loop 5
```

Bare integers continue to mean a maximum number of immediate goal iterations.
A duration followed by a prompt selects scheduled-message mode.

## 2. Background

### 2.1 Existing goal-loop behavior

The goal-loop PRD defines `/loop <maxIterations>` as bounded autonomous work
toward an approved conversation goal. It requires an active goal and runs maker
turns immediately until the goal completes, blocks, needs input, or reaches a
limit.

That behavior answers:

> How many immediate continuation iterations may the agent perform?

It does not answer:

> Run this prompt again after a real-world waiting period.

### 2.2 Existing scheduled-message infrastructure

AiFetchly already has most of the backend foundation for recurring AI messages:

- `AiMessageTaskEntity` stores a prompt, model, conversation ID, tool policy,
  and per-run limits.
- `AiMessageTaskRunEntity` records scheduled execution results.
- `ScheduleTaskEntity` and `BackgroundScheduler` provide persistent scheduling.
- `TaskExecutorService` routes `TaskType.AI_MESSAGE` to
  `ScheduledAiMessageRunner`.
- `ScheduledAiMessageRunner` checks AI availability, invokes the AI service,
  and records the final result.

The current scheduled runner passes `conversation_id` to the AI API but does
not append its user and assistant messages to the normal AI Chat V2 transcript.
Consequently, using the same identifier is not sufficient to provide a real
same-chat experience.

### 2.3 Existing AI Chat V2 persistence

`AIChatQueryEngine` already performs the complete interactive turn lifecycle:

- resolves or reuses a `v2-*` conversation ID;
- saves the user message through `AIChatV2Module`;
- loads and assembles existing conversation history;
- invokes the model and tools;
- saves the assistant response;
- updates memory, compaction, and conversation metadata;
- emits typed lifecycle events.

Scheduled loops should use this lifecycle rather than creating a parallel chat
history implementation.

## 3. Problem Statement

Users need to monitor work that changes over time, such as deployments, imports,
campaign results, scraping jobs, or external approvals. Repeatedly sending the
same prompt manually is inefficient.

If recurring messages create a new conversation per run:

- the model loses prior observations and decisions;
- results become scattered across the conversation list;
- the user cannot follow progress as a coherent timeline;
- context compaction and conversation memory cannot work consistently;
- cancellation and audit history become harder to understand;
- repeated runs may produce contradictory answers because each starts cold.

If a scheduled runner merely passes a reused ID to a remote endpoint without
persisting local messages:

- scheduled results do not appear in Chat V2 history;
- reopening the chat omits scheduled turns;
- local transcript assembly differs from what the remote service saw;
- renderer state can become inconsistent with database state;
- later interactive turns cannot reliably include scheduled observations.

The product requires one authoritative conversation transcript shared by
interactive and scheduled turns.

## 4. Product Decisions

The following decisions are part of this PRD, not open implementation choices.

1. A scheduled loop is permanently bound to the originating `v2-*`
   conversation.
2. Every occurrence persists both its scheduled user message and assistant
   response in `ai_chat_messages`.
3. Scheduled runs use `AIChatQueryEngine` for transcript assembly and message
   persistence.
4. The persistent scheduler decides when runs are due; long-lived `setTimeout`
   calls are not the source of truth.
5. Bare numeric `/loop` arguments retain current goal-loop semantics.
6. Duration-based `/loop` commands require an explicit prompt in the MVP.
7. One active scheduled loop is allowed per conversation in the MVP.
8. Interactive and scheduled turns may not execute concurrently in the same
   conversation.
9. Interactive work has priority. A due scheduled occurrence is deferred or
   coalesced instead of interrupting an interactive turn.
10. Scheduled loops are always bounded by execution count and lifetime.
11. Missed occurrences never replay as a burst after restart or sleep.
12. The database is authoritative. Renderer notifications are refresh hints,
    not the durable record.
13. A missing or deleted conversation pauses the schedule; the runtime never
    creates a replacement conversation automatically.
14. Scheduled tool permissions are task-scoped and do not inherit broad
    interactive approval state automatically.

## 5. Goals

1. Support Claude-Code-style interval input such as `5m` and `2h`.
2. Schedule a prompt directly from AI Chat V2 with minimal syntax.
3. Keep every occurrence and response in the originating conversation.
4. Preserve full conversation context across scheduled and interactive turns.
5. Reuse existing scheduling and scheduled-AI-message infrastructure.
6. Reuse `AIChatQueryEngine` rather than duplicating transcript logic.
7. Prevent concurrent turns from corrupting conversation ordering.
8. Provide visible status, next-run time, limits, results, and cancellation.
9. Recover predictably after application restart or operating-system sleep.
10. Preserve existing AI enablement, workspace, tool approval, and plan safety
    boundaries.
11. Keep schedule and run history auditable.
12. Maintain backward compatibility with `/loop <maxIterations>`.

## 6. Non-Goals

The MVP will not include:

- unbounded or permanent scheduled loops;
- second-level intervals;
- cloud execution while the desktop application is closed;
- multiple active scheduled loops in one conversation;
- concurrent interactive and scheduled turns in one conversation;
- automatic creation of a goal contract from an arbitrary scheduled prompt;
- automatic inference that a schedule should stop solely because the assistant
  used words such as "done" or "complete";
- replay of every occurrence missed while the application was closed;
- automatic approval of shell, file-write, authentication, payment, messaging,
  or other high-impact tools;
- renderer-side database or scheduler access;
- worker-process database access;
- streaming scheduled tokens into whichever conversation happens to be open;
- silent migration of existing standalone AI message schedules into Chat V2;
- guaranteed execution at an exact wall-clock instant;
- replacing the existing schedule-management UI.

## 7. Target Users and Use Cases

### 7.1 Deployment monitoring

```text
/loop 5m check if deployment 218 finished and summarize its result
```

The user sees successive deployment observations in the same chat and can ask a
follow-up question using the accumulated context.

### 7.2 Campaign monitoring

```text
/loop 1h --times 8 -- summarize new campaign replies and flag urgent leads
```

Each hourly summary appears in the same campaign conversation.

### 7.3 Long-running import monitoring

```text
/loop every 15m --for 3h -- check the contact import and report new failures
```

The loop expires after three hours even if the user does not stop it manually.

### 7.4 User continues chatting while schedule remains active

The user may send interactive messages between scheduled occurrences. The next
scheduled occurrence must include those messages in its assembled transcript.

## 8. Command Grammar

### 8.1 Backward-compatible immediate goal loop

```text
/loop <maxIterations>
```

Examples:

```text
/loop 3
/loop 10
```

This mode requires an active, approved goal and retains the behavior defined by
the goal-loop PRD.

### 8.2 Scheduled-loop shorthand

```text
/loop <interval> <prompt>
```

Examples:

```text
/loop 5m check if the deployment finished and tell me what happened
/loop 2h summarize any new campaign replies
```

The shorthand expands to configured default execution-count and lifetime
limits. The resolved limits must be shown to the user when the schedule starts.

### 8.3 Canonical scheduled-loop syntax

```text
/loop every <interval> [--times <count>] [--for <duration>] -- <prompt>
```

Examples:

```text
/loop every 5m --times 12 -- check if the deployment finished
/loop every 1h --for 8h -- summarize new campaign replies
/loop every 30m --times 6 --for 3h -- check the import status
```

When both `--times` and `--for` are present, the schedule stops at whichever
limit is reached first.

The `--` separator is required when advanced flags are used. It prevents prompt
text containing words such as "times" or "for" from being interpreted as
command options.

### 8.4 Management syntax

Because the MVP permits one active scheduled loop per conversation, the active
conversation supplies the schedule context:

```text
/loop status
/loop stop
/loop pause
/loop resume
```

These commands act only on the active conversation's scheduled loop. They must
never stop or modify a loop in another conversation.

### 8.5 Duration rules

MVP units:

- `m`: minutes
- `h`: hours

MVP validation:

- minimum interval: `1m`;
- maximum interval: `24h`;
- values must be positive base-10 integers;
- units are case-insensitive on input and normalized to lowercase;
- spaces between the value and unit are not accepted in the shorthand;
- decimals, signs, scientific notation, mixed units, and unknown units are
  rejected;
- parsed milliseconds must be a safe integer;
- prompt text must be non-empty after trimming.

Rejected examples:

```text
/loop 0m check deployment
/loop -5m check deployment
/loop 1.5h check deployment
/loop 5 minutes check deployment
/loop 5m
/loop 5d check deployment
```

### 8.6 Default limits

Recommended centralized MVP defaults:

```ts
SCHEDULED_LOOP_MIN_INTERVAL_MS = 60_000
SCHEDULED_LOOP_MAX_INTERVAL_MS = 86_400_000
SCHEDULED_LOOP_DEFAULT_MAX_RUNS = 24
SCHEDULED_LOOP_MAX_RUNS = 100
SCHEDULED_LOOP_DEFAULT_MAX_LIFETIME_MS = 86_400_000
SCHEDULED_LOOP_MAX_LIFETIME_MS = 7 * 86_400_000
```

The shorthand `/loop 5m <prompt>` therefore runs at most 24 times and for at
most 24 hours. At a five-minute interval, the execution-count limit normally
ends the schedule first.

## 9. User Experience

### 9.1 Starting a scheduled loop

When the command is accepted, Chat V2 should append the visible slash command
and a concise local result in the same conversation:

```text
Scheduled every 5 minutes. Maximum 24 runs or 24 hours. Next run: 14:35.
```

The result should provide compact Pause and Stop controls. The command response
must not claim that a run has executed yet.

### 9.2 Scheduled turns in the transcript

Each occurrence should appear as a normal user/assistant turn with scheduled
metadata. The renderer may use a small clock icon and timestamp to distinguish
the generated user turn from a manually typed message.

The stored user-message content should be the prompt itself. Scheduling labels
belong in metadata and presentation, not in model-facing prompt text.

Example transcript:

```text
You
/loop 5m check if deployment 218 finished and summarize the result

AiFetchly
Scheduled every 5 minutes. Maximum 24 runs or 24 hours.

Scheduled - Run 1
Check if deployment 218 finished and summarize the result

AiFetchly
Deployment 218 is still running. The build stage has completed.

Scheduled - Run 2
Check if deployment 218 finished and summarize the result

AiFetchly
Deployment 218 completed successfully at 14:39.
```

### 9.3 Conversation navigation

If the originating conversation is open:

- append or reload the completed scheduled turn;
- preserve scroll position unless the user is already near the bottom;
- do not overwrite an interactive draft;
- do not merge scheduled tokens into an active interactive assistant bubble.

If another conversation is open:

- do not navigate automatically;
- refresh the originating conversation's preview and timestamp;
- show an unread indicator;
- optionally display a desktop notification according to user settings.

### 9.4 Running and waiting status

The active conversation may show:

- schedule status: active, paused, running, expired, stopped, or failed;
- interval;
- completed run count and maximum run count;
- next planned run time;
- expiration time;
- latest run result or error;
- Pause, Resume, and Stop controls.

### 9.5 No new conversation per occurrence

The conversation list must show one conversation for the scheduled loop. A
scheduled occurrence must not create a new conversation-list entry.

## 10. Functional Requirements

### FR-1: Command classification

The slash-command parser must return distinct structured actions:

```ts
type AiLoopCommandAction =
  | {
      readonly type: "goal_loop";
      readonly maxIterations: number;
    }
  | {
      readonly type: "scheduled_loop";
      readonly intervalMs: number;
      readonly prompt: string;
      readonly maxRuns: number;
      readonly maxLifetimeMs: number;
    }
  | {
      readonly type: "scheduled_loop_control";
      readonly operation: "status" | "stop" | "pause" | "resume";
    };
```

Classification rules:

- bare digits select `goal_loop`;
- a duration token followed by a prompt selects `scheduled_loop`;
- the literal control keywords select `scheduled_loop_control`;
- malformed `/loop` input returns a typed validation error and does not fall
  through to ordinary chat;
- parsing performs no IPC, database, scheduling, or AI work.

### FR-2: Conversation resolution

Starting a scheduled loop must resolve one authoritative conversation ID.

- If Chat V2 already has an active `v2-*` conversation, reuse it unchanged.
- If the user is composing in a new chat, create a `v2-*` ID before creating
  the schedule.
- Save the visible `/loop` command in that conversation so the conversation is
  durable immediately.
- Return the final conversation ID from the backend and set it as the active
  renderer conversation.
- Reject non-V2 IDs for chat-bound scheduled loops.
- Do not call `AiMessageTaskModule`'s fallback conversation-ID generator for
  this command path.

### FR-3: Persistent schedule creation

A main-process orchestration module should atomically or compensatingly create:

1. an AI message task containing the prompt and originating conversation ID;
2. an interval schedule linked to that task;
3. the initial schedule state and next-run time;
4. an audit record identifying the slash command as the source.

Suggested module:

```text
src/modules/AIChatScheduledLoopModule.ts
```

The module coordinates Models and existing Modules. The IPC handler must not
import TypeORM repositories.

If schedule creation fails after task creation, the module must remove or mark
the orphaned task inactive before returning an error.

### FR-4: Same-conversation invariant

For every scheduled-loop occurrence:

- `AiMessageTaskEntity.conversation_id` equals the originating conversation ID;
- `AiMessageTaskRunEntity.conversation_id` equals the same ID;
- the persisted scheduled user message uses the same ID;
- the persisted assistant message uses the same ID;
- all tool-call and tool-result messages use the same ID;
- event payloads use the same ID;
- no new conversation ID is generated at run time.

If any component detects an ID mismatch, it must fail the run with a structured
`CONVERSATION_MISMATCH` error and pause the schedule.

### FR-5: Query-engine execution

Scheduled loops must submit their prompt through `AIChatQueryEngine`, not call
`AiChatApi.streamMessage()` as an independent chat path.

The scheduled execution must therefore:

1. save the scheduled user message;
2. assemble existing history from `ai_chat_messages`;
3. include current plan, workspace, memory, and compaction context when safe;
4. run the model/tool loop under scheduled-task policy;
5. save tool calls and tool results when produced;
6. save the assistant response or permitted partial response;
7. record the scheduled task run result;
8. notify the renderer after durable persistence completes.

Extract production engine construction from renderer IPC into a reusable
factory instead of calling an IPC handler from the scheduler:

```text
src/service/AIChatQueryEngineFactory.ts
```

The factory must support interactive and scheduled execution profiles.

### FR-6: Internal turn metadata

The query engine needs trusted main-process turn context separate from the
renderer-supplied stream request:

```ts
interface AIChatTurnContext {
  readonly source: "interactive" | "scheduled_loop";
  readonly taskId?: number;
  readonly scheduleId?: number;
  readonly runId?: number;
  readonly occurrence: number;
  readonly scheduledFor?: string;
  readonly triggeredAt?: string;
}
```

Extend `ChatV2MessageMetadata.source` with `scheduled-loop` and store bounded
identifiers and timestamps. Renderer input must not be able to forge trusted
task, schedule, or run identifiers.

### FR-7: Conversation turn coordination

Introduce a shared main-process coordinator used by both interactive Chat V2
and scheduled loops:

```text
src/service/AIChatConversationTurnCoordinator.ts
```

It must enforce one active turn per conversation and provide a lease released
in `finally`.

Required policy:

- interactive turn running when a schedule is due: defer/coalesce scheduled
  occurrence;
- scheduled turn running when an interactive message arrives: either queue the
  interactive message briefly or return a clear busy state; do not abort and
  discard the scheduled transcript;
- another scheduled occurrence becomes due while one is running: coalesce it;
- turns in different conversations may run concurrently within global limits;
- stale leases are recovered after their owning execution terminates;
- process restart clears in-memory leases and reconstructs truth from durable
  run state.

### FR-8: Persistent interval scheduling

The scheduler must persist interval semantics rather than using a long-running
sleep inside `ScheduledAiMessageRunner` or `AIChatGoalLoopService`.

Recommended schedule fields:

```ts
triggerType: "interval";
intervalMs: number;
nextRunTime: Date;
maxExecutions: number;
expiresAt: Date;
misfirePolicy: "skip" | "run_once";
overlapPolicy: "coalesce";
```

An `interval` trigger is preferred over translating every duration to cron.
Cron cannot represent all fixed elapsed intervals cleanly, especially values
such as 90 minutes, and its wall-clock behavior differs across sleep and time
zone changes.

### FR-9: Missed-run handling

When the application starts or wakes:

- if no occurrence was missed, preserve `nextRunTime`;
- if occurrences were missed and the schedule is still within its limits, run
  at most one catch-up occurrence;
- never enqueue one run for every missed interval;
- compute the next future occurrence from the persisted schedule policy;
- record that the occurrence was a catch-up run;
- if the schedule expired while offline, mark it expired without running;
- daylight-saving and wall-clock changes must not produce duplicate runs.

The MVP default is `misfirePolicy: "run_once"`.

### FR-10: Overlap handling

If a run takes longer than its interval:

- do not run two occurrences concurrently;
- coalesce all due occurrences into one pending occurrence;
- increment a coalesced/missed counter for observability;
- schedule the next future occurrence after the active run finishes;
- never allow backlog growth without a fixed bound.

### FR-11: Renderer delivery

After the scheduled user and assistant messages are committed, the main process
must broadcast a narrow conversation-update event:

```ts
interface ChatV2ConversationUpdatedEvent {
  readonly conversationId: string;
  readonly reason: "scheduled_turn_completed" | "scheduled_turn_failed";
  readonly scheduleId: number;
  readonly runId: number;
  readonly userMessageId?: string;
  readonly assistantMessageId?: string;
  readonly occurredAt: string;
}
```

Suggested channel:

```text
ai-chat-v2:conversation-updated
```

The event is a refresh hint only. The renderer must read authoritative history
through the existing Chat V2 history API.

### FR-12: Run results and transcript consistency

`AiMessageTaskRunEntity` should link the scheduled execution record to its chat
rows using stable message IDs:

```ts
userMessageId?: string;
assistantMessageId?: string;
scheduledFor?: Date;
occurrence: number;
catchUp: boolean;
deliveryState: "persisted" | "notified" | "notification_failed";
```

The run is not `completed` until the assistant result and associated chat rows
are durably persisted. A renderer-notification failure does not fail the AI run;
it records `notification_failed`, because history can be recovered from the
database.

### FR-13: Control operations

`status`, `pause`, `resume`, and `stop` must be backend-authoritative.

- `pause` prevents new occurrences but does not delete history.
- `resume` computes a new future `nextRunTime`; it does not immediately replay
  every missed occurrence.
- `stop` prevents future occurrences and allows an active occurrence to finish
  unless the user explicitly chooses Stop Current Run.
- Stop Current Run aborts the active query engine and persists a cancelled run.
- `status` returns renderer-safe schedule and latest-run information.
- repeated operations are idempotent.

### FR-14: Conversation deletion and clearing

If a conversation has an active scheduled loop:

- deleting the conversation requires explicit confirmation that the schedule
  will also be stopped;
- confirmed deletion stops the schedule before deleting messages;
- clearing conversation history also requires confirmation;
- a schedule whose conversation is missing is paused with
  `CONVERSATION_NOT_FOUND`;
- the scheduler must never recreate a deleted conversation;
- orphan detection runs during startup recovery.

### FR-15: Limits and automatic stopping

A scheduled loop stops when any of the following occurs:

- maximum executions reached;
- lifetime expires;
- user stops it;
- conversation is deleted or unavailable;
- AI access is disabled for a configured threshold of attempts;
- repeated identical run failures reach the configured threshold;
- task or schedule is disabled;
- required workspace or credential context becomes unavailable;
- a policy violation requires interactive user approval;
- the application determines the task configuration is invalid.

The MVP does not infer completion from unstructured assistant wording. A later
`--until` mode may use explicit deterministic checks or schema-validated
verification.

### FR-16: Tool policy

Scheduled loops are unattended execution and must use task-scoped policy:

- only explicitly approved tools are exposed or auto-approved;
- each tool name is revalidated against the current registry at run time;
- high-impact tools remain blocked unless a future policy explicitly supports
  exact-argument pre-approval;
- interactive conversation approval mode does not widen scheduled permissions;
- blocked requests are persisted and represented in the assistant context as
  failed tool results when the query loop supports continuation;
- tool calls count toward per-run quotas;
- workspace paths remain scoped to the conversation's approved workspace.

### FR-17: AI availability gate

Every handler or execution path that creates, starts, resumes, or runs a
scheduled AI loop must create `Token` and verify
`token.getValue(USER_AI_ENABLED) === "true"` before parsing untrusted execution
input, resolving providers, or constructing AI services. If the value is not
enabled, the IPC handler must immediately return the established
`{ status: false, msg, data: null }` response and the scheduler must record a
bounded `AI_DISABLED` failure without calling the AI API. Provider selection and
capability checks occur only after this mandatory gate passes.

### FR-18: Internationalization

All new user-facing text must be added to:

```text
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
```

This includes parser errors, schedule summaries, statuses, controls, recovery
messages, notifications, run labels, and deletion warnings.

## 11. State Model

### 11.1 Scheduled-loop status

```text
creating -> active -> running -> active
                  |           |
                  |           +-> paused
                  |           +-> failed
                  |           +-> expired
                  |           +-> stopped
                  |
                  +-> paused -> active
                  +-> expired
                  +-> stopped
```

Definitions:

- `creating`: task and schedule records are being created;
- `active`: waiting for the next occurrence;
- `running`: one occurrence owns the conversation turn lease;
- `paused`: no new occurrences will start until explicit resume;
- `expired`: a time or execution-count bound ended the schedule;
- `failed`: an unrecoverable configuration or repeated-run failure stopped it;
- `stopped`: explicitly stopped by the user or conversation deletion.

### 11.2 Occurrence status

```text
pending -> waiting_for_conversation -> running -> completed
                                   |          -> failed
                                   |          -> cancelled
                                   |          -> blocked_by_policy
                                   |          -> timeout
                                   +----------> coalesced
```

## 12. Data Model Guidance

### 12.1 Reuse existing entities

The implementation should reuse:

- `AiMessageTaskEntity` for prompt, conversation, model, and tool policy;
- `AiMessageTaskRunEntity` for each occurrence;
- `ScheduleTaskEntity` for trigger and next-run state;
- `AIChatMessageEntity` for the authoritative conversation transcript;
- existing schedule execution logs for scheduler-level diagnostics.

Do not create a second scheduled-loop message table.

### 12.2 Suggested entity extensions

`ScheduleTaskEntity`:

```ts
interval_ms?: number;
max_execution_count?: number;
expires_at?: Date;
misfire_policy?: "skip" | "run_once";
overlap_policy?: "coalesce";
source_conversation_id?: string;
```

`AiMessageTaskEntity`:

```ts
source_type?: "schedule_ui" | "chat_scheduled_loop";
```

`AiMessageTaskRunEntity`:

```ts
user_message_id?: string;
assistant_message_id?: string;
scheduled_for?: Date;
occurrence?: number;
catch_up?: boolean;
delivery_state?: "persisted" | "notified" | "notification_failed";
```

`ChatV2MessageMetadata`:

```ts
source: "chat-v2" | "slash-command" | "scheduled-loop";
scheduledLoop?: {
  scheduleId: number;
  runId: number;
  occurrence: number;
  scheduledFor?: string;
  catchUp: boolean;
};
```

### 12.3 Database architecture

- Models perform repository operations.
- Modules enforce validation, transitions, cleanup, and cross-record rules.
- Services orchestrate scheduler and query-engine execution.
- IPC handlers validate unknown payloads and call Modules/Services only.
- Renderer code calls narrow preload APIs and never accesses TypeORM.
- Worker processes never access these database tables directly.

## 13. Service Architecture

```text
AiChatV2 composer
  -> slash-command parser
  -> scheduled-loop renderer API
  -> scheduled-loop IPC handler (AI gate first)
  -> AIChatScheduledLoopModule
       -> AiMessageTaskModule/Model
       -> ScheduleTaskModule/Model
       -> AIChatV2Module

BackgroundScheduler
  -> TaskExecutorService
  -> ScheduledAiMessageRunner
  -> AIChatConversationTurnCoordinator
  -> AIChatQueryEngineFactory (scheduled profile)
  -> AIChatQueryEngine
       -> AIChatV2Module -> ai_chat_messages
       -> scheduled tool policy
  -> AiMessageTaskRunModule
  -> conversation update broadcaster
  -> renderer history refresh
```

### 13.1 Shared engine factory

The production query-loop dependencies currently assembled near Chat V2 IPC
should move behind a reusable factory. This avoids importing Electron IPC into
the scheduler and prevents configuration drift between interactive and
scheduled execution.

The scheduled profile must inject:

- task-scoped tool filtering;
- no interactive permission prompt dependency;
- scheduled-run cancellation;
- trusted turn metadata;
- an event sink that captures terminal result data;
- a renderer broadcaster independent of any specific IPC request sender.

### 13.2 Event sink behavior

The scheduled event sink should persist through the engine's normal Module
calls and collect lifecycle state for the task-run record. It should not send
normal stream chunks to whichever renderer initiated schedule creation.

For the MVP, notify renderers after terminal persistence. Live scheduled token
streaming can be added later with strict routing by conversation and run ID.

## 14. Scheduling Semantics

### 14.1 Interval anchor

The first occurrence is scheduled at:

```text
createdAt + interval
```

The confirmation UI must show the exact next-run timestamp. The command does
not execute immediately unless a future `--now` option is explicitly added.

### 14.2 Next-run calculation

After a completed or failed occurrence, calculate the next future time from the
persisted interval policy. Do not accumulate drift by blindly using
`completionTime + interval` unless that policy is explicitly selected.

Recommended MVP policy:

- preserve the original cadence anchor;
- skip elapsed slots;
- select the first slot strictly after the current time;
- coalesce missed slots into at most one catch-up run after restart.

### 14.3 Failure retry

Scheduler infrastructure may retry transient execution failures, but a retry
belongs to the same occurrence and run lineage. It must not append duplicate
scheduled user messages before the prior attempt's persistence state is known.

Use an idempotency key such as:

```text
scheduled-loop:<scheduleId>:<occurrence>
```

Message IDs derived from this key prevent duplicate transcript rows.

## 15. Safety and Trust Boundaries

1. Scheduled prompts are persisted user instructions, not trusted system
   instructions.
2. Content read from deployments, logs, websites, and tools is untrusted data.
3. Scheduled execution cannot show an interactive permission dialog and wait
   indefinitely.
4. Unapproved tool calls are blocked or pause the schedule with a clear reason.
5. Tool allowlists are stored per task and revalidated on every run.
6. Limits apply independently at schedule, occurrence, model-loop, tool-call,
   token, and runtime levels.
7. Conversation and workspace IDs are resolved in the main process.
8. Renderer-supplied schedule IDs never override conversation ownership.
9. Run results and notifications contain bounded, renderer-safe data.
10. Errors must not expose tokens, cookies, credentials, full environment
    variables, or unbounded logs.
11. Schedule creation and control actions are audited.
12. Conversation deletion cannot leave an active unattended schedule behind.

## 16. Error Handling

Recommended stable error codes:

| Code | Meaning | Schedule effect |
| --- | --- | --- |
| `INVALID_LOOP_SYNTAX` | Command cannot be parsed | No schedule created |
| `INVALID_INTERVAL` | Interval outside allowed bounds | No schedule created |
| `INVALID_LOOP_LIMIT` | Count or lifetime invalid | No schedule created |
| `PROMPT_REQUIRED` | Scheduled prompt is empty | No schedule created |
| `CONVERSATION_REQUIRED` | Conversation could not be resolved | No schedule created |
| `CONVERSATION_NOT_FOUND` | Bound conversation was deleted | Pause |
| `CONVERSATION_MISMATCH` | Task/run/message IDs disagree | Pause and alert |
| `LOOP_ALREADY_ACTIVE` | Conversation already has an active loop | No schedule created |
| `CONVERSATION_BUSY` | Interactive turn owns the lease | Defer/coalesce |
| `AI_DISABLED` | AI execution unavailable | Retry boundedly, then pause |
| `BLOCKED_BY_POLICY` | Tool needs unavailable approval | Pause or fail occurrence |
| `WORKSPACE_UNAVAILABLE` | Required workspace is unavailable | Pause |
| `RUN_TIMEOUT` | Occurrence exceeded runtime | Fail occurrence |
| `REPEATED_RUN_FAILURE` | Failure threshold reached | Fail schedule |
| `SCHEDULE_EXPIRED` | Lifetime elapsed | Expire |
| `MAX_RUNS_REACHED` | Execution bound reached | Expire |

User-facing messages must be localized, while logs and APIs may use stable
English error codes.

## 17. Observability and Audit

Each occurrence should record:

- task ID, schedule ID, run ID, and conversation ID;
- occurrence number and idempotency key;
- scheduled, triggered, started, and finished timestamps;
- whether it was a catch-up or retry;
- conversation-lock wait duration;
- coalesced occurrence count;
- user and assistant message IDs;
- model and token usage when available;
- tool call count and blocked tool summaries;
- final status and structured error code;
- renderer delivery state;
- next calculated run time.

Metrics should support answering:

- How many scheduled loops are active?
- How often are scheduled runs deferred by interactive chat?
- How many missed occurrences are coalesced?
- How many runs fail before writing transcript messages?
- How often do renderer notifications fail?
- Are duplicate occurrence or message IDs being produced?
- How much model/tool usage do scheduled loops consume?

## 18. Testing Requirements

### 18.1 Parser unit tests

Cover:

- legacy `/loop 5` classification;
- shorthand `5m` and `2h` parsing;
- canonical `every`, `--times`, `--for`, and `--` parsing;
- case normalization;
- empty prompts;
- zero, negative, decimal, overflow, and unknown units;
- invalid counts and lifetimes;
- control operations;
- malformed `/loop` returns validation instead of ordinary chat fallback;
- prompt text containing `for`, `times`, digits, or newlines.

### 18.2 Module and persistence tests

Cover:

- creation binds the exact originating `v2-*` conversation;
- new-chat creation returns and persists one V2 ID;
- no `ai-msg-*` fallback occurs;
- task and schedule creation compensation on partial failure;
- one active scheduled loop per conversation;
- pause, resume, stop, and status idempotency;
- conversation deletion stops the schedule;
- orphan recovery pauses the schedule;
- limits and next-run calculation survive restart.

### 18.3 Query-engine integration tests

Cover:

- scheduled user message is saved in the originating conversation;
- assistant message is saved in the same conversation;
- the next scheduled run receives prior scheduled and interactive messages;
- scheduled metadata contains task, schedule, run, and occurrence IDs;
- tool-call and tool-result messages use the same conversation ID;
- task-run rows link to the saved chat message IDs;
- direct scheduled API execution cannot bypass transcript persistence;
- partial, failed, cancelled, and policy-blocked runs remain internally
  consistent.

### 18.4 Concurrency tests

Cover:

- interactive turn blocks/defer scheduled run in the same conversation;
- scheduled turn does not abort an interactive turn;
- two due occurrences coalesce;
- different conversations can run within global concurrency limits;
- lease release occurs after success, error, timeout, and cancellation;
- restart does not preserve a stale in-memory lease;
- message ordering remains deterministic.

### 18.5 Scheduler tests

Cover:

- first run occurs after one interval;
- interval anchor and next future slot calculation;
- application sleep produces at most one catch-up;
- application restart produces at most one catch-up;
- expiration while offline produces no run;
- long-running occurrences do not overlap;
- transient retries use the same occurrence identity;
- max runs and lifetime stop at the first reached bound;
- time zone and daylight-saving changes do not duplicate occurrences.

### 18.6 Renderer tests

Cover:

- scheduled turns render in the same conversation;
- another open conversation is not replaced;
- originating conversation preview and unread status update;
- active interactive streams do not merge with scheduled results;
- history reload recovers after a missed renderer event;
- pause, resume, and stop controls reflect backend state;
- deletion warning appears for active schedules;
- all six locales contain every new key.

### 18.7 Security tests

Cover:

- AI enablement gate runs before request processing;
- renderer cannot forge trusted scheduled metadata;
- task-scoped tool allowlist is enforced;
- interactive approval mode does not widen scheduled permissions;
- missing workspace blocks workspace-scoped tools;
- secret-bearing errors and tool output are redacted;
- cross-conversation schedule control is rejected;
- worker process cannot access scheduled-loop database models.

## 19. Rollout Plan

### Phase 1: Parser and conversation-bound creation

- Add duration parsing and structured actions.
- Preserve numeric goal-loop behavior.
- Resolve/create the originating V2 conversation.
- Create bounded AI message task and interval schedule.
- Add status, pause, resume, and stop controls.

### Phase 2: Same-chat query-engine execution

- Extract `AIChatQueryEngineFactory`.
- Add trusted scheduled turn context.
- Route scheduled runner through the query engine.
- Persist scheduled user and assistant messages.
- Link task-run rows to message IDs.

### Phase 3: Concurrency and restart recovery

- Add shared conversation-turn coordinator.
- Add interval trigger and next-run persistence.
- Implement coalescing, catch-up, expiration, and idempotency.
- Add orphan and stale-run recovery.

### Phase 4: Renderer delivery and management

- Add conversation-update event.
- Refresh open history safely.
- Add unread conversation state and compact scheduled labels.
- Add schedule status and management UI.
- Add all translations.

### Phase 5: Hardening

- Complete concurrency, restart, security, and lifecycle tests.
- Add metrics and audit views.
- Add migration handling for existing AI message schedules.
- Validate packaged Electron behavior across supported platforms.

### Future phase: Verified stop conditions

Consider an explicit mode such as:

```text
/loop every 5m --until "deployment is terminal" -- check deployment 218
```

This must use deterministic checks or schema-validated verification. It must not
stop based only on an unstructured assistant claim.

## 20. Acceptance Criteria

1. `/loop 5` retains immediate goal-loop behavior.
2. `/loop 5m check deployment` creates a bounded scheduled loop.
3. The scheduled loop is bound to the exact originating `v2-*` conversation.
4. A new-chat command creates one durable V2 conversation before scheduling.
5. No scheduled occurrence creates a new conversation ID.
6. Every occurrence saves a scheduled user message in the originating chat.
7. Every successful occurrence saves its assistant response in the same chat.
8. Subsequent occurrences receive prior scheduled and interactive conversation
   history through `AIChatQueryEngine`.
9. Task and run records store the same conversation ID as transcript messages.
10. Scheduled task-run records link to user and assistant message IDs.
11. An open originating conversation refreshes after durable persistence.
12. A different open conversation is not replaced automatically.
13. Interactive and scheduled turns never execute concurrently in one
    conversation.
14. Missed occurrences produce at most one catch-up run.
15. Long-running occurrences never overlap.
16. Default and explicit execution/lifetime limits are enforced.
17. Pause, resume, stop, and status operations are idempotent and
    conversation-scoped.
18. Conversation deletion stops the linked schedule after confirmation.
19. AI availability and task-scoped tool policy are enforced on every run.
20. The renderer can recover all scheduled turns from database history after
    restart or a missed event.
21. All user-facing text is translated into English, Chinese, Spanish, French,
    German, and Japanese.
22. Parser, persistence, query-engine, concurrency, scheduler, renderer, and
    security tests pass.

## 21. Success Metrics

- Zero scheduled occurrences create unintended conversation-list entries.
- 100% of completed scheduled-loop runs link to the originating conversation
  and durable chat-message IDs.
- Zero concurrent turns execute in the same conversation.
- Zero restart recoveries enqueue more than one catch-up occurrence per
  schedule.
- At least 99% of renderer notification failures remain recoverable by history
  reload without transcript loss.
- 100% of unattended tool executions are covered by task-scoped policy.
- Scheduled-loop failure and cancellation reasons are visible in run history.

## 22. Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Interactive and scheduled turns interleave | Corrupt ordering or stale context | Shared per-conversation turn coordinator |
| Direct AI runner bypasses local transcript | Same ID but missing visible history | Route through `AIChatQueryEngine` |
| App restart replays many missed runs | Cost and message flood | `run_once` misfire policy and coalescing |
| Interval shorter than run duration | Concurrent duplicate work | Non-overlap lease and one pending occurrence |
| Repeated prompt inflates context | Cost and context pressure | Existing context assembler and compaction |
| Renderer misses completion event | Stale UI | Database authority and history refresh |
| Conversation is deleted | Orphan unattended task | Confirmed cascade stop and startup orphan scan |
| Broad interactive approval leaks into scheduler | Unsafe unattended tools | Separate task-scoped scheduled policy |
| Partial schedule creation leaves orphan task | Resource leak | Transaction or compensating cleanup |
| Retry duplicates transcript messages | Confusing history | Occurrence idempotency keys and stable message IDs |
| Natural-language completion is wrong | Premature stop | No implicit completion in MVP |
| Existing cron model cannot express intervals | Incorrect cadence | Add first-class interval trigger |

## 23. Open Questions

The following decisions may be finalized during technical design without
changing the core same-conversation requirement:

1. Should an interactive message wait briefly behind a running scheduled turn,
   or immediately offer a Stop Scheduled Run action?
2. Should `stop` let the current occurrence finish by default, or abort it?
3. Should desktop notifications be enabled by default for scheduled results?
4. Should existing schedule-UI AI message tasks optionally opt into Chat V2
   transcript delivery?
5. Should the schedule-management page deep-link back to its originating chat?
6. What global concurrency limit should apply across different conversations?
7. How many consecutive `AI_DISABLED` occurrences should pause a schedule?
8. Should scheduled user turns be collapsed visually when many consecutive
   runs use identical prompt text?
9. Should a future verified `--until` mode reuse goal acceptance criteria or
   define a smaller monitoring-condition contract?

## 24. Definition of Done

The feature is complete when a user can enter a bounded interval `/loop`
command, close and reopen the chat view, continue chatting between occurrences,
and see every scheduled request and response in the same originating
conversation with correct ordering, context, status, cancellation, recovery,
tool policy, audit history, and translations.
