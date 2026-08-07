# AI Chat V2 Scheduled Loop Technical Design

## 1. Purpose

This document defines how to implement the interval-based `/loop` behavior in
the [AI Chat V2 Scheduled Loop PRD](./ai-chat-scheduled-loop-prd.md).

The target command is:

```text
/loop 5m check if the deployment finished and tell me what happened
```

Every scheduled occurrence must execute against, and persist into, the exact
AI Chat V2 conversation where the command was created. The implementation must
not create a new conversation for each occurrence.

This design preserves the existing immediate goal-loop command:

```text
/loop 5
```

Bare integers continue to select a bounded goal loop. Duration tokens followed
by a prompt select a persistent scheduled-message loop.

## 2. Scope and Supersession

The earlier scheduled AI message design at
`docs/superpowers/specs/2026-06-09-scheduled-ai-message-task-design.md` selected
"new conversation per run." This document supersedes that decision only for
AI Chat V2 scheduled loops created from `/loop <duration> <prompt>`.

Existing schedule-page AI message tasks remain unchanged unless they explicitly
opt into `source_type = "chat_scheduled_loop"` and provide a valid `v2-*`
conversation ID. This avoids silently changing the behavior of existing user
schedules.

This design covers:

- command parsing and validation;
- conversation resolution and command persistence;
- interval schedule persistence;
- occurrence claiming and idempotency;
- reuse of `AIChatQueryEngine`;
- same-conversation message persistence;
- task-scoped scheduled tool policy;
- per-conversation concurrency control;
- restart, sleep, overlap, retry, and cancellation handling;
- renderer notification and history refresh;
- conversation deletion behavior;
- schema evolution, rollout, and tests.

It does not implement verified natural-language stop conditions. A future
`--until` mode must use a separate deterministic or schema-validated verifier.

## 3. Existing System Assessment

### 3.1 Components to reuse

| Component | Current responsibility | Scheduled-loop responsibility |
| --- | --- | --- |
| `AiChatV2.vue` | Chat UI, conversation navigation, stream rendering | Dispatch structured scheduled-loop actions and refresh changed conversations |
| `AIChatV2Module` | Save/load V2 messages and conversations | Persist command, scheduled user turns, and assistant turns |
| `AIChatQueryEngine` | Assemble history, persist a user turn, run query loop, persist assistant result | Execute one scheduled occurrence in the originating conversation |
| `AIChatQueryLoop` | Model/tool rounds, recovery, tool results | Remain the inner model/tool loop under a scheduled execution profile |
| `AiMessageTaskEntity` | Persistent AI task prompt and policy | Store scheduled-loop prompt, conversation ID, and unattended tool policy |
| `AiMessageTaskRunEntity` | One AI message execution record | Link one occurrence to chat message IDs and occurrence metadata |
| `ScheduleTaskEntity` | Persistent schedule and next-run state | Store interval cadence, limits, anchor, and recovery policy |
| `BackgroundScheduler` | Poll due schedules and queue execution | Claim due interval occurrences without overlap or replay bursts |
| `TaskExecutorService` | Route schedule types to executors | Continue routing `AI_MESSAGE` to `ScheduledAiMessageRunner` |
| `ScheduledAiMessageRunner` | Headless direct AI API execution | Become an adapter around `AIChatQueryEngine` for chat-bound tasks |
| `ScheduledAiToolPolicy` | Validate unattended tool execution | Supply the scheduled engine's task-scoped tool decisions |

### 3.2 Current gaps

1. `parseAiGoalCommand()` accepts only a bare integer.
2. `ScheduleTaskEntity` supports cron, dependency, and manual triggers, but not
   fixed elapsed intervals.
3. `ScheduleTaskModel.getSchedulesReadyToExecute()` selects only cron rows.
4. `ScheduledAiMessageRunner` calls `AiChatApi.streamMessage()` directly.
5. Scheduled results are persisted to task-run history but not the Chat V2
   transcript.
6. `AiMessageTaskModule.createTask()` generates an `ai-msg-*` conversation when
   no ID is supplied.
7. Query-engine construction is private to `ai-chat-v2-ipc.ts`.
8. Interactive and scheduled engines do not share a conversation mutex.
9. Existing renderer stream channels are scoped to an initiating IPC sender,
   not background schedule delivery.
10. Schedule retries lack a transcript idempotency key.

### 3.3 Architectural constraints

- IPC handlers check `Token` and `USER_AI_ENABLED` before parsing payloads or
  constructing services.
- IPC handlers contain no database access.
- Models own TypeORM repository operations.
- Modules own validation and business transitions.
- Worker processes never access the database.
- Renderer code never imports Models, Modules, TypeORM, or Electron main APIs.
- All externally supplied values are decoded from `unknown`.
- New and modified functions have explicit return types.
- New code does not use `any`.
- All user-facing strings are translated in all six supported languages.

## 4. Target Architecture

```text
Renderer
  AiChatV2.vue
    -> SlashCommandDispatcher
    -> aiChatScheduledLoop renderer API
    -> IPC

Main process creation path
  ai-chat-scheduled-loop-ipc.ts
    -> mandatory AI gate
    -> request decoder
    -> AIChatScheduledLoopModule
         -> AIChatV2Module
         -> AiMessageTaskModel
         -> ScheduleTaskModel

Main process execution path
  BackgroundScheduler
    -> claim due interval occurrence
    -> TaskExecutorService
    -> ScheduledAiMessageRunner
         -> AIChatConversationTurnCoordinator
         -> AIChatQueryEngineFactory.createScheduled(...)
         -> AIChatQueryEngine.submitMessage(...)
              -> AIChatV2Module / AIChatModule
              -> AIChatQueryLoop
              -> ScheduledAiToolPolicy
         -> AiMessageTaskRunModule
         -> AIChatConversationUpdateBroadcaster

Renderer delivery path
  ai-chat-v2:conversation-updated
    -> refresh originating conversation if open
    -> otherwise update preview and unread state
```

### 4.1 Source-of-truth rules

- SQLite is authoritative for schedules, runs, and transcript messages.
- `next_run_time` is authoritative for when the scheduler should claim work.
- `(schedule_id, occurrence)` is authoritative for occurrence identity.
- `conversation_id` on the AI message task is authoritative for transcript
  ownership.
- Renderer events are refresh hints only.
- In-memory maps are execution aids, never recovery state.

## 5. File Plan

### 5.1 New files

```text
src/config/aiChatScheduledLoopConfig.ts
src/entityTypes/aiChatScheduledLoopTypes.ts
src/service/slashCommands/AiChatLoopCommandParser.ts
src/modules/AIChatScheduledLoopModule.ts
src/service/AIChatQueryEngineFactory.ts
src/service/AIChatConversationTurnCoordinator.ts
src/service/AIChatConversationUpdateBroadcaster.ts
src/main-process/communication/ai-chat-scheduled-loop-ipc.ts
src/views/api/aiChatScheduledLoop.ts
```

### 5.2 Modified files

```text
src/entity/ScheduleTask.entity.ts
src/entity/AiMessageTask.entity.ts
src/entity/AiMessageTaskRun.entity.ts
src/entityTypes/aiMessageTaskTypes.ts
src/entityTypes/aiChatV2Types.ts
src/entityTypes/schedule-type.ts
src/model/ScheduleTask.model.ts
src/model/AiMessageTask.model.ts
src/model/AiMessageTaskRun.model.ts
src/modules/ScheduleTaskModule.ts
src/modules/AiMessageTaskModule.ts
src/modules/AiMessageTaskRunModule.ts
src/modules/TaskExecutorService.ts
src/modules/BackgroundScheduler.ts
src/modules/AIChatV2Module.ts
src/service/AIChatQueryEngine.ts
src/service/ScheduledAiMessageRunner.ts
src/main-process/communication/ai-chat-v2-ipc.ts
src/main-process/communication/index.ts
src/config/channellist.ts
src/preload.ts
src/views/components/aiChatV2/AiChatV2.vue
src/views/utils/aiGoalCommand.ts
src/views/lang/{en,zh,es,fr,de,ja}.ts
src/config/SqliteDb.ts
```

`src/views/utils/aiGoalCommand.ts` should become a compatibility re-export or
be removed after all callers use `AiChatLoopCommandParser`.

## 6. Command Parser Design

### 6.1 Parsed types

Add pure shared types in `aiChatScheduledLoopTypes.ts`:

```ts
export type AiLoopCommand =
  | { readonly type: "none" }
  | {
      readonly type: "goal_loop";
      readonly maxIterations: number | null;
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
      readonly operation: "status" | "pause" | "resume" | "stop";
    }
  | {
      readonly type: "invalid_loop";
      readonly code:
        | "INVALID_LOOP_SYNTAX"
        | "INVALID_INTERVAL"
        | "INVALID_LOOP_LIMIT"
        | "PROMPT_REQUIRED";
    };
```

### 6.2 Grammar

```text
goal-loop       := "/loop" WS integer
shorthand       := "/loop" WS duration WS prompt
canonical       := "/loop" WS "every" WS duration options "--" prompt
control         := "/loop" WS ("status" | "pause" | "resume" | "stop")
duration        := positive-integer ("m" | "h")
options         := *(WS ("--times" WS integer | "--for" WS duration))
prompt          := one-or-more non-whitespace characters, including newlines
```

### 6.3 Parsing algorithm

1. Trim outer whitespace without modifying prompt-internal whitespace.
2. Match control commands first using exact case-insensitive tokens.
3. Match a bare integer next. Do not allow trailing prompt text in goal mode.
4. If the first argument is `every`, require the canonical separator `--`.
5. Parse canonical flags only before the first separator.
6. Otherwise parse the first token as shorthand duration and treat the entire
   remainder as prompt.
7. Convert durations with checked integer arithmetic.
8. Validate bounds from `aiChatScheduledLoopConfig.ts`.
9. Return `invalid_loop` for all recognized but malformed `/loop` input.
10. Return `none` only when the input is not a `/loop` command.

Do not use one large regular expression for the full canonical grammar. Tokenize
the option prefix and parse it explicitly so errors can be classified and prompt
content is not accidentally consumed as flags.

### 6.4 Duration parser

```ts
export interface ParsedDuration {
  readonly value: number;
  readonly unit: "m" | "h";
  readonly milliseconds: number;
}

export function parseScheduledLoopDuration(
  token: string
): ParsedDuration | null;
```

Validation order:

1. Match `^(\d+)([mMhH])$`.
2. Parse with `Number.parseInt`.
3. Require `Number.isSafeInteger(value)` and `value > 0`.
4. Multiply by the unit using a checked result.
5. Require the final value inside the relevant interval or lifetime bound.

### 6.5 Double validation

The renderer may use the pure parser for immediate UX, but the main process
must decode and validate the structured request again. Renderer parsing is not
a trust boundary.

## 7. Configuration

Add centralized constants:

```ts
export const SCHEDULED_LOOP_MIN_INTERVAL_MS = 60_000;
export const SCHEDULED_LOOP_MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const SCHEDULED_LOOP_DEFAULT_MAX_RUNS = 24;
export const SCHEDULED_LOOP_MAX_RUNS = 100;
export const SCHEDULED_LOOP_DEFAULT_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const SCHEDULED_LOOP_MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const SCHEDULED_LOOP_MAX_CONSECUTIVE_FAILURES = 3;
export const SCHEDULED_LOOP_CONVERSATION_LOCK_WAIT_MS = 30_000;
export const SCHEDULED_LOOP_STALE_RUN_MS = 10 * 60 * 1000;
```

Do not reuse `GOAL_LOOP_DEFAULT_MAX_RUNTIME_MS` for schedule lifetime. One is a
single immediate goal run cap; the other bounds a persistent recurring schedule.

## 8. Shared Types and Renderer Views

```ts
export type ScheduledLoopStatus =
  | "active"
  | "paused"
  | "running"
  | "expired"
  | "failed"
  | "stopped";

export type ScheduledLoopMisfirePolicy = "skip" | "run_once";
export type ScheduledLoopOverlapPolicy = "coalesce";

export interface CreateScheduledLoopRequest {
  readonly conversationId?: string;
  readonly rawCommand: string;
  readonly prompt: string;
  readonly intervalMs: number;
  readonly maxRuns: number;
  readonly maxLifetimeMs: number;
  readonly model?: string;
}

export interface ScheduledLoopView {
  readonly scheduleId: number;
  readonly taskId: number;
  readonly conversationId: string;
  readonly prompt: string;
  readonly status: ScheduledLoopStatus;
  readonly intervalMs: number;
  readonly maxRuns: number;
  readonly claimedRuns: number;
  readonly successfulRuns: number;
  readonly consecutiveFailures: number;
  readonly nextRunAt?: string;
  readonly expiresAt: string;
  readonly latestRunId?: number;
  readonly latestErrorCode?: string;
}

export interface CreateScheduledLoopResponse {
  readonly conversationId: string;
  readonly commandMessageId: string;
  readonly resultMessageId: string;
  readonly loop: ScheduledLoopView;
}
```

Control requests contain only a conversation ID. The backend looks up the one
active chat-created schedule for that conversation rather than trusting a
renderer-supplied schedule ID.

## 9. Database Schema

### 9.1 Schedule trigger

Extend `TriggerType`:

```ts
export enum TriggerType {
  CRON = "cron",
  INTERVAL = "interval",
  DEPENDENCY = "dependency",
  MANUAL = "manual",
}
```

Extend `ScheduleStatus` for durable terminal state:

```ts
export enum ScheduleStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  PAUSED = "paused",
  EXPIRED = "expired",
  FAILED = "failed",
  STOPPED = "stopped",
}
```

`running` is a renderer view derived from an active task-run row; it is not a
schedule status. Terminal statuses always set `is_active = false`.

### 9.2 ScheduleTaskEntity additions

Add nullable columns so existing rows remain valid:

| Column | Type | Purpose |
| --- | --- | --- |
| `interval_ms` | integer nullable | Fixed elapsed cadence |
| `interval_anchor_at` | datetime nullable | Stable cadence origin |
| `max_execution_count` | integer nullable | Maximum claimed occurrences |
| `expires_at` | datetime nullable | Absolute schedule lifetime bound |
| `misfire_policy` | varchar(20) nullable | `skip` or `run_once` |
| `overlap_policy` | varchar(20) nullable | `coalesce` |
| `source_conversation_id` | varchar(100) nullable | Indexed V2 ownership lookup |
| `claimed_execution_count` | integer default 0 | Claimed occurrences including failures |
| `consecutive_failure_count` | integer default 0 | Automatic pause/fail threshold |
| `last_claimed_occurrence` | integer default 0 | Monotonic occurrence identity |
| `coalesced_occurrence_count` | integer default 0 | Missed/overlapped diagnostic count |
| `terminal_reason` | varchar(64) nullable | Stable stop/expiry/failure code |

Add indexes:

```ts
@Index(["trigger_type", "is_active", "next_run_time"])
@Index(["source_conversation_id", "task_type", "is_active"])
```

For interval rows, `cron_expression` should become nullable. Validation requires
cron only for `CRON` and interval fields only for `INTERVAL`.

### 9.3 AiMessageTaskEntity additions

```ts
@Column("varchar", { length: 32, nullable: true })
source_type?: "schedule_ui" | "chat_scheduled_loop";
```

For `chat_scheduled_loop`, `conversation_id` is required and must match
`^v2-[A-Za-z0-9-]+$`. The generic task creation fallback remains available only
for standalone schedule-page tasks.

### 9.4 AiMessageTaskRunEntity additions

Extend `AiMessageTaskRunStatus` with recovery-visible states used by the
scheduler:

```ts
export type AiMessageTaskRunStatus =
  | "pending"
  | "waiting_for_conversation"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked_by_policy"
  | "timeout"
  | "coalesced"
  | "interrupted";
```

| Column | Type | Purpose |
| --- | --- | --- |
| `occurrence` | integer nullable | Stable schedule occurrence number |
| `attempt` | integer default 1 | Retry number within one occurrence |
| `scheduled_for` | datetime nullable | Original slot time |
| `catch_up` | boolean default false | Run created by misfire recovery |
| `user_message_id` | varchar(100) nullable | Chat transcript link |
| `assistant_message_id` | varchar(100) nullable | Chat transcript link |
| `delivery_state` | varchar(32) nullable | Persistence/notification state |
| `error_code` | varchar(64) nullable | Stable machine-readable failure |
| `idempotency_key` | varchar(160) nullable unique | Retry/restart deduplication |

Add a composite unique index:

```ts
@Index(["schedule_id", "occurrence"], { unique: true })
```

SQLite permits multiple `NULL` values, so standalone task runs without a
schedule or occurrence remain valid.

### 9.5 Chat message metadata

Extend `ChatV2MessageMetadata`:

```ts
export interface ChatV2ScheduledLoopMetadata {
  readonly scheduleId: number;
  readonly taskId: number;
  readonly runId: number;
  readonly occurrence: number;
  readonly scheduledFor?: string;
  readonly catchUp: boolean;
  readonly status?: "running" | "completed" | "failed" | "cancelled";
}

export interface ChatV2MessageMetadata {
  source: "chat-v2" | "slash-command" | "scheduled-loop";
  scheduledLoop?: ChatV2ScheduledLoopMetadata;
  /** Visible in history but excluded from model, compact, and memory context. */
  localOnly?: boolean;
  // existing fields remain unchanged
}
```

The raw `/loop` command and its local confirmation row use `localOnly: true`.
Scheduled occurrence prompts and assistant results do not. Update
`AIChatContextAssembler`, `OpenAIChatTranscriptBuilder`, compact input, and
memory source collection to exclude local-only rows. Otherwise the model may
interpret schedule-management UI text as a new user instruction.

### 9.6 Schema evolution

`SqliteDb` currently uses `synchronize: true` and no TypeORM migrations.
Therefore:

1. Add new columns as nullable or with non-destructive defaults.
2. Register no new entity unless a later design proves one is necessary.
3. Verify upgrade from a copied database containing existing cron, dependency,
   standalone AI message, and Chat V2 rows.
4. Verify TypeORM does not drop or rewrite unrelated schedule data.
5. Backfill `source_type = "schedule_ui"` only when needed for discrimination;
   null continues to mean legacy standalone behavior.
6. Do not backfill conversation ownership for old task runs.

## 10. Model Layer

### 10.1 ScheduleTaskModel additions

```ts
interface CreateIntervalScheduleRecord {
  readonly name: string;
  readonly taskId: number;
  readonly conversationId: string;
  readonly intervalMs: number;
  readonly anchorAt: Date;
  readonly nextRunAt: Date;
  readonly maxExecutionCount: number;
  readonly expiresAt: Date;
  readonly misfirePolicy: ScheduledLoopMisfirePolicy;
  readonly overlapPolicy: ScheduledLoopOverlapPolicy;
}
```

Required methods:

```ts
createIntervalSchedule(input: CreateIntervalScheduleRecord): Promise<number>;
findChatScheduledLoop(conversationId: string): Promise<ScheduleTaskEntity | null>;
findDueIntervalSchedules(now: Date, limit: number): Promise<ScheduleTaskEntity[]>;
claimIntervalOccurrence(input: ClaimOccurrenceInput): Promise<ClaimOccurrenceResult>;
updateIntervalAfterResult(input: IntervalResultUpdate): Promise<void>;
pauseWithReason(id: number, reason: string): Promise<void>;
stopWithReason(id: number, reason: string): Promise<void>;
expireWithReason(id: number, reason: string): Promise<void>;
```

`claimIntervalOccurrence()` must run in a database transaction and condition its
update on the row still being active and due. This closes the race between
overlapping scheduler polls.

### 10.2 AiMessageTaskModel additions

```ts
createChatScheduledTask(input: CreateChatScheduledTaskRecord): Promise<number>;
findChatScheduledTask(id: number): Promise<AiMessageTaskEntity | null>;
deactivateChatScheduledTask(id: number): Promise<void>;
```

The chat-specific create method requires a V2 conversation and never generates
one.

### 10.3 AiMessageTaskRunModel additions

```ts
createOccurrence(input: CreateOccurrenceRecord): Promise<number>;
getByIdempotencyKey(key: string): Promise<AiMessageTaskRunEntity | null>;
linkUserMessage(runId: number, messageId: string): Promise<void>;
linkAssistantMessage(runId: number, messageId: string): Promise<void>;
markInterruptedRuns(cutoff: Date): Promise<number>;
```

Repository errors for the unique idempotency key must be converted into a read
of the existing run, not a second occurrence.

### 10.4 No direct repositories outside Models

`AIChatScheduledLoopModule`, `ScheduledAiMessageRunner`, scheduler code, and IPC
handlers call Model/Module methods only. If atomic creation requires repositories
from multiple tables, add a Model transaction method or pass a TypeORM
`EntityManager` through internal Model methods. Do not put repository calls in
the IPC handler.

## 11. AIChatScheduledLoopModule

### 11.1 Responsibilities

- create or resolve the originating conversation;
- validate that it is a `v2-*` conversation;
- enforce one active scheduled loop per conversation;
- save the visible command and local confirmation messages;
- create the task and interval schedule;
- compensate partial creation failures;
- return renderer-safe schedule state;
- implement status, pause, resume, and stop;
- stop schedules before conversation deletion;
- validate ownership on every operation.

### 11.2 Creation flow

```text
create(request)
  1. Validate already-decoded bounds and prompt.
  2. Resolve conversationId with AIChatV2Module.createConversationIfNeeded().
  3. Require final ID to start with v2-.
  4. Check no active chat scheduled loop exists for the conversation.
  5. Generate stable commandMessageId and resultMessageId.
  6. Save the raw slash command with source=slash-command and localOnly=true.
  7. Create AiMessageTask(source_type=chat_scheduled_loop).
  8. Create ScheduleTask(trigger_type=interval, initially inactive).
  9. Activate the schedule only after all linked records exist.
 10. Save the localized-neutral confirmation data as a localOnly slash result.
 11. Return IDs and ScheduledLoopView.
```

Store structured confirmation metadata and a stable English content fallback.
The renderer localizes controls and labels from metadata.

### 11.3 Transaction and compensation

Preferred: create task, schedule, and command/result rows in one database
transaction through a dedicated transaction-capable Model method.

Acceptable incremental implementation:

1. Save command row.
2. Create inactive task.
3. Create inactive schedule.
4. Activate both.
5. On failure, stop/delete the schedule, deactivate/delete the task, and mark
   the command result as failed.

Never leave an active schedule pointing at a missing task.

### 11.4 Control semantics

- `status`: read-only and safe to repeat.
- `pause`: set schedule inactive/paused and keep next-run metadata for display.
- `resume`: require valid task/conversation, compute a new future next run, and
  clear recoverable terminal reason.
- `stop`: mark schedule stopped and task inactive; do not delete history.
- `stopCurrentRun`: signal the runner's abort controller and then stop future
  occurrences.

## 12. IPC and Preload Design

### 12.1 Channels

```ts
AI_CHAT_V2_SCHEDULED_LOOP_CREATE = "ai-chat-v2:scheduled-loop-create";
AI_CHAT_V2_SCHEDULED_LOOP_GET = "ai-chat-v2:scheduled-loop-get";
AI_CHAT_V2_SCHEDULED_LOOP_PAUSE = "ai-chat-v2:scheduled-loop-pause";
AI_CHAT_V2_SCHEDULED_LOOP_RESUME = "ai-chat-v2:scheduled-loop-resume";
AI_CHAT_V2_SCHEDULED_LOOP_STOP = "ai-chat-v2:scheduled-loop-stop";
AI_CHAT_V2_SCHEDULED_LOOP_STOP_RUN = "ai-chat-v2:scheduled-loop-stop-run";
AI_CHAT_V2_CONVERSATION_UPDATED = "ai-chat-v2:conversation-updated";
```

### 12.2 Mandatory handler ordering

Every scheduled-loop handler follows this order:

```ts
if (new Token().getValue(USER_AI_ENABLED) !== "true") {
  return {
    status: false,
    msg: "AI functionality is only available to subscribers.",
    data: null,
  };
}

const decoded = decodeRequest(input);
if (!decoded.ok) return denied(decoded.message);
return serviceOperation(decoded.value);
```

The AI gate occurs before request parsing, Model/Module construction, provider
resolution, and schedule mutation.

### 12.3 Decoders

Decode `unknown` using explicit guards or the repository's standard validation
library. Validate:

- strings and trimmed non-empty prompt;
- exact V2 conversation format when supplied;
- safe integer durations and counts;
- configured bounds;
- absence of unexpected ownership overrides.

### 12.4 Renderer API

`src/views/api/aiChatScheduledLoop.ts` exposes typed functions using
`windowInvoke`. It does not expose raw channel names or Electron objects.

## 13. Query Engine Factory

### 13.1 Motivation

`ai-chat-v2-ipc.ts` currently constructs the production `AIChatQueryLoop` and
singleton `AIChatQueryEngine`. Scheduled code must not import or invoke an IPC
handler. Extract construction into `AIChatQueryEngineFactory`.

### 13.2 Profiles

```ts
export type AIChatExecutionProfile =
  | { readonly kind: "interactive" }
  | {
      readonly kind: "scheduled";
      readonly policy: AiMessageTaskToolPolicy;
      readonly taskId: number;
      readonly scheduleId: number;
      readonly runId: number;
    };
```

```ts
export interface AIChatQueryEngineFactory {
  create(profile: AIChatExecutionProfile): AIChatQueryEngine;
}
```

Interactive IPC may retain one engine instance for pending permission/question
state. Each scheduled occurrence gets a dedicated engine instance because its
abort lifecycle and policy are run-scoped. The shared conversation coordinator
prevents these separate instances from racing on one conversation.

### 13.3 Scheduled tool executor

The scheduled profile wraps `SkillExecutor.execute()`:

1. Confirm the requested tool exists.
2. Confirm it appears in the task allowlist.
3. Call `canAutoApproveScheduledTool()`.
4. Enforce run tool-call quota.
5. Attach scheduled execution metadata.
6. Execute only when allowed.
7. Return a structured failed tool result when blocked.
8. Never open an interactive permission prompt.

The scheduled profile disables auto-plan entry and Plan Mode tools. If the
conversation has a plan awaiting approval, pending question, or unresolved
permission request, preflight pauses the schedule rather than sending a turn.

## 14. AIChatQueryEngine Changes

### 14.1 Internal turn context

Extend `AIChatQuerySubmitInput`, not the renderer `ChatV2StreamRequest`:

```ts
export interface AIChatScheduledTurnContext {
  readonly source: "scheduled_loop";
  readonly taskId: number;
  readonly scheduleId: number;
  readonly runId: number;
  readonly occurrence: number;
  readonly scheduledFor: string;
  readonly catchUp: boolean;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
}

export interface AIChatQuerySubmitInput {
  readonly eventSink: AIChatQueryEventSink;
  readonly request: ChatV2StreamRequest;
  readonly scheduledContext?: AIChatScheduledTurnContext;
}
```

Because `scheduledContext` is supplied only by main-process code, the renderer
cannot forge schedule/run ownership metadata.

### 14.2 Stable message IDs

Interactive turns keep generated IDs. Scheduled turns use:

```text
scheduled-user-<scheduleId>-<occurrence>
scheduled-assistant-<scheduleId>-<occurrence>
```

`AIChatModule.saveMessage()` already reuses an existing row by `messageId`.
Its current behavior updates an existing row, including timestamp and content,
which is not sufficient for retry idempotency. Add
`saveMessageIfAbsent()` for scheduled turns. If the ID exists, validate the
conversation, role, and content hash and return it without mutation. A mismatch
fails with `CONVERSATION_MISMATCH`. Stable IDs plus insert-if-absent behavior keep
ordering unchanged during retries. Add a database index on
`AIChatMessageEntity.messageId` if performance testing shows lookup cost; do not
make it unique until existing databases have been checked for duplicates.

### 14.3 Metadata persistence

When `scheduledContext` is present:

- save the user row with `source: "scheduled-loop"`;
- copy the bounded scheduled-loop metadata;
- use the supplied assistant ID;
- save the assistant row with matching metadata and terminal status;
- emit normal engine events containing the bound conversation ID.

### 14.4 Conversation requirement

The engine must not call `createConversationIfNeeded()` without the supplied
conversation in scheduled mode. It requires an existing `v2-*` ID and verifies
that at least the originating command row or another conversation message
exists before saving the scheduled turn.

### 14.5 Terminal result capture

The scheduled event sink collects:

- start and message IDs;
- terminal type;
- model and token usage;
- full or partial assistant content;
- permission, plan, or question pauses;
- error code and safe error message.

The engine remains responsible for chat persistence. The runner uses the sink
only to update `AiMessageTaskRunEntity` and schedule state.

## 15. Conversation Turn Coordinator

### 15.1 Interface

```ts
export type ConversationTurnOwner = "interactive" | "scheduled";

export interface ConversationTurnLease {
  readonly conversationId: string;
  readonly owner: ConversationTurnOwner;
  readonly leaseId: string;
  release(): void;
}

export interface AcquireConversationTurnInput {
  readonly conversationId: string;
  readonly owner: ConversationTurnOwner;
  readonly ownerId: string;
  readonly waitMs: number;
  readonly signal?: AbortSignal;
}

export class AIChatConversationTurnCoordinator {
  acquire(input: AcquireConversationTurnInput): Promise<ConversationTurnLease>;
  tryAcquire(input: Omit<AcquireConversationTurnInput, "waitMs">):
    ConversationTurnLease | null;
}
```

### 15.2 Queue policy

- At most one active lease per conversation.
- FIFO among waiters of the same priority.
- Interactive waiters have priority over scheduled waiters not yet granted.
- A granted scheduled lease is not preempted.
- Scheduled wait timeout returns `CONVERSATION_BUSY`; scheduler coalesces.
- Aborted waiters are removed immediately.
- Lease release is idempotent.
- All call sites release in `finally`.

### 15.3 Integration

Interactive Chat V2 acquires a lease immediately before `submitMessage()` and
releases it after the engine reaches a terminal or paused state. Resume actions
for permission and questions reacquire the same conversation lease.

Scheduled execution acquires after durable occurrence creation but before
saving the scheduled user message. A busy result does not create a duplicate
run. It marks that run `waiting_for_conversation` and requeues the same run ID
with a bounded delay. If a later cadence slot becomes due while that run remains
pending, the later slot is counted as coalesced and no new run row is created.
When the wait budget or schedule lifetime expires, mark the pending run
`coalesced` or `cancelled` with a stable reason.

### 15.4 Restart behavior

Leases are in memory and disappear at restart. Startup recovery marks stale
`running` task-run rows interrupted before new schedules are claimed. Database
occurrence keys prevent recovery from duplicating old transcript turns.

## 16. Occurrence Scheduling Algorithm

### 16.1 Cadence definition

Let:

```text
A = interval_anchor_at
I = interval_ms
n = occurrence number, starting at 1
scheduledFor(n) = A + n * I
```

The first run is due at `A + I`.

### 16.2 Next future occurrence

For current time `T`:

```text
nextOccurrence(T) = floor((T - A) / I) + 1
nextRunTime(T) = A + nextOccurrence(T) * I
```

If `T < A`, use occurrence 1. Use checked arithmetic and clamp invalid dates.

### 16.3 Atomic claim

For each due interval row:

1. Begin a transaction.
2. Re-read the schedule.
3. Require active status, `next_run_time <= now`, and `now < expires_at`.
4. Require `claimed_execution_count < max_execution_count`.
5. Compute `delta = next_run_time - A`. Require `delta >= I` and
   `delta % I === 0`; otherwise pause the invalid schedule. Set
   `occurrence = delta / I`. Occurrence numbers may jump after missed slots;
   `claimed_execution_count` separately counts actual runs.
6. Insert the task-run row with unique idempotency key.
7. Increment claimed count and last occurrence.
8. Advance `next_run_time` to the first future cadence slot.
9. Increment coalesced count by skipped elapsed slots.
10. Commit and enqueue the claimed run.

Advancing `next_run_time` during claim prevents the next scheduler poll from
claiming the same slot while the run is executing.

Before claiming another slot, check for an existing `pending` or `running` run
for the schedule. If one exists, advance past the newly due slot and increment
`coalesced_occurrence_count` without creating a second run.

### 16.4 Misfire recovery

At startup or wake:

- `skip`: advance to the first future slot without creating a run;
- `run_once`: claim one catch-up occurrence, mark `catch_up = true`, count all
  additional elapsed slots as coalesced, then advance to the first future slot;
- expired schedules transition to expired before claim;
- schedules at max claimed count transition to expired before claim.

### 16.5 Retry identity

Retries do not increment occurrence or claimed count. They increment `attempt`
and reuse:

```text
scheduled-loop:<scheduleId>:<occurrence>
```

They also reuse stable user and assistant message IDs. A retry should inspect
the existing run and transcript state before resubmitting:

- assistant terminal row exists: treat persistence as completed;
- user row exists but no assistant row: resume/retry the same occurrence;
- neither exists: start normally;
- mismatched conversation: pause with `CONVERSATION_MISMATCH`.

## 17. ScheduledAiMessageRunner Redesign

### 17.1 Mode dispatch

Preserve legacy standalone behavior behind an explicit source check:

```ts
if (task.source_type !== "chat_scheduled_loop") {
  return this.runLegacyStandaloneTask(task, run);
}
return this.runChatScheduledLoop(task, schedule, run);
```

The legacy method may continue direct API execution until separately migrated.
New chat-created loops must always take the query-engine path.

### 17.2 Chat-bound execution flow

```text
runChatScheduledLoop(task, schedule, run)
  1. Verify USER_AI_ENABLED again at execution time.
  2. Re-read task, schedule, and run through Modules.
  3. Validate source_type and all conversation IDs match.
  4. Validate schedule is not stopped/expired.
  5. Check conversation exists and plan has no unresolved user boundary.
  6. Acquire conversation turn lease.
  7. Create scheduled engine and event sink.
  8. Submit prompt with stable scheduled context.
  9. Wait for terminal engine event and persistence barrier.
 10. Link message IDs and complete/fail/cancel run.
 11. Update schedule counters and terminal policy.
 12. Broadcast conversation update after persistence.
 13. Release lease in finally.
```

### 17.3 Status mapping

| Engine outcome | Run status | Schedule action |
| --- | --- | --- |
| completed | completed | Reset consecutive failures |
| cancelled by user | cancelled | Stop when requested, otherwise continue |
| timeout | timeout | Increment consecutive failures |
| model/API error | failed | Increment consecutive failures |
| tool blocked | blocked_by_policy | Pause schedule |
| permission needed | blocked_by_policy | Pause schedule |
| plan approval needed | blocked_by_policy | Pause schedule |
| user question needed | blocked_by_policy | Pause schedule |
| conversation missing/mismatch | failed | Pause schedule |

After the configured repeated-failure threshold, mark the schedule failed and
clear future execution.

### 17.4 Cancellation registry

Maintain an in-memory `Map<number, AbortController>` keyed by task-run ID. Stop
Current Run resolves the active run by conversation through the Module, aborts
it, and relies on the runner `finally` block for cleanup. The registry is not
used to decide whether a durable run exists.

## 18. Renderer Delivery

### 18.1 Broadcaster abstraction

Do not import `BrowserWindow` into the runner. Inject:

```ts
export interface AIChatConversationUpdateSink {
  emit(event: ChatV2ConversationUpdatedEvent): void;
}
```

`registerCommunicationIpcHandlers(win)` registers the current window's
`webContents` with `AIChatConversationUpdateBroadcaster`. It removes destroyed
targets and sends bounded JSON on `AI_CHAT_V2_CONVERSATION_UPDATED`.

### 18.2 Event type

```ts
export interface ChatV2ConversationUpdatedEvent {
  readonly conversationId: string;
  readonly reason:
    | "scheduled_turn_completed"
    | "scheduled_turn_failed"
    | "scheduled_loop_state_changed";
  readonly scheduleId: number;
  readonly runId?: number;
  readonly userMessageId?: string;
  readonly assistantMessageId?: string;
  readonly occurredAt: string;
}
```

No prompt, full assistant content, tool output, or secret-bearing error is sent
on this event. The renderer reloads authoritative data.

### 18.3 AiChatV2 handling

On event:

1. Refresh conversation summaries.
2. If the event conversation is not active, mark it unread and stop.
3. If it is active and no turn is streaming, call `loadHistory()`.
4. If it is active and streaming, record a pending refresh flag.
5. When the active stream terminates, reload if the flag is set.
6. Preserve composer draft and scroll position.
7. Auto-scroll only if the user was already near the bottom.

Do not push scheduled tokens into the normal interactive stream state in the
MVP.

### 18.4 Conversation list unread state

Unread scheduled updates may remain renderer-local for the MVP, keyed by
conversation ID. If unread state must survive restart, add a dedicated durable
conversation state design rather than overloading message metadata.

## 19. Conversation Lifecycle

### 19.1 Clear/delete preflight

Before `AIChatV2Module.clearConversation()` is called, the IPC orchestration
path asks `AIChatScheduledLoopModule` for an active schedule.

- No active schedule: clear normally.
- Active schedule and no confirmation: return a structured conflict.
- Confirmed: stop schedule and active run, then clear messages.

Do not make `AIChatV2Module` import the scheduled-loop module. Keep lifecycle
coordination in a higher-level service or IPC orchestration layer to avoid a
module cycle.

### 19.2 Startup orphan scan

For active chat-created schedules:

1. Validate task exists and is active.
2. Validate task conversation equals schedule source conversation.
3. Validate at least one Chat V2 message exists for the conversation.
4. Pause invalid rows with a stable terminal reason.
5. Mark stale running occurrences interrupted.
6. Apply expiration and max-run rules.
7. Then allow normal scheduler polling.

## 20. Error Contracts

Add stable error codes:

```ts
export type ScheduledLoopErrorCode =
  | "INVALID_LOOP_SYNTAX"
  | "INVALID_INTERVAL"
  | "INVALID_LOOP_LIMIT"
  | "PROMPT_REQUIRED"
  | "LOOP_ALREADY_ACTIVE"
  | "CONVERSATION_REQUIRED"
  | "CONVERSATION_NOT_FOUND"
  | "CONVERSATION_MISMATCH"
  | "CONVERSATION_BUSY"
  | "AI_DISABLED"
  | "WORKSPACE_UNAVAILABLE"
  | "BLOCKED_BY_POLICY"
  | "RUN_TIMEOUT"
  | "REPEATED_RUN_FAILURE"
  | "SCHEDULE_EXPIRED"
  | "MAX_RUNS_REACHED"
  | "RUN_INTERRUPTED";
```

Persist codes separately from safe display messages. Logs may include internal
correlation IDs, but renderer responses must not contain raw stack traces,
tokens, cookies, environment values, or unbounded tool output.

## 21. Security Design

### 21.1 Trust boundaries

- Slash text and renderer requests are untrusted.
- Schedule/task/run IDs from renderer input are untrusted.
- Model output and tool output are untrusted.
- The task's conversation ownership and allowlist are trusted only after main
  process database lookup and validation.
- Broadcaster events contain identifiers only and are not authorization.

### 21.2 Scheduled tool restrictions

- No global permission bypass.
- No implicit inheritance from conversation `auto_approve` mode.
- Only task allowlisted and policy-approved built-in tools.
- Shell, file write/edit, authentication, payment, outbound messaging, schedule
  mutation, and dependency installation remain blocked in the MVP.
- Workspace reads still pass workspace resolution and path guards.
- Tool arguments and results are bounded and redacted before audit persistence.

### 21.3 Cross-conversation protection

Control operations accept a conversation ID and resolve ownership server-side.
If a schedule ID is ever accepted for management UI interoperability, the
Module verifies its `source_conversation_id` equals the active conversation
before mutation.

## 22. Internationalization

Add a consistent `aiChatV2.scheduledLoop` group in all six language files.

Required concepts include:

- syntax and validation errors;
- schedule-created summary;
- active, paused, running, expired, failed, and stopped labels;
- next run, expiration, run count, and latest error;
- Pause, Resume, Stop, and Stop Current Run;
- conversation-busy deferral;
- policy-blocked and AI-disabled states;
- deletion/clear confirmation;
- scheduled-run badge and catch-up label;
- unread scheduled result notification.

Persist stable metadata and error codes. Localize at presentation time whenever
possible so changing application language updates old transcript controls.

## 23. Testing Strategy

### 23.1 Parser tests

File:

```text
test/vitest/utilitycode/AiChatLoopCommandParser.test.ts
```

Test legacy numeric behavior, shorthand/canonical duration syntax, flags,
controls, bounds, malformed recognized commands, multiline prompts, safe integer
handling, and prompt text containing option-like words.

### 23.2 Model and Module tests

Files:

```text
test/vitest/main/modules/AIChatScheduledLoopModule.test.ts
test/vitest/modules/ScheduleTaskModule.interval.test.ts
test/vitest/modules/AiMessageTaskRunModule.occurrence.test.ts
```

Test creation, compensation, one-active-loop rule, same-conversation invariant,
atomic claim, unique occurrence, status controls, expiration, ownership checks,
and orphan recovery.

### 23.3 Query engine tests

Extend:

```text
test/vitest/main/service/AIChatQueryEngine.test.ts
```

Test trusted scheduled context, stable IDs, user/assistant metadata, history
assembly including prior scheduled and interactive turns, plan preflight, and
terminal persistence.

### 23.4 Runner tests

```text
test/vitest/main/service/ScheduledAiMessageRunner.chatLoop.test.ts
```

Test source dispatch, AI gate, conversation mismatch, engine invocation, run
linkage, policy block, timeout, cancellation, failure threshold, broadcaster
ordering, and legacy standalone behavior.

### 23.5 Coordinator tests

```text
test/vitest/main/service/AIChatConversationTurnCoordinator.test.ts
```

Test mutual exclusion, interactive priority, FIFO behavior, timeout, abort,
idempotent release, different-conversation concurrency, and cleanup.

### 23.6 Scheduler tests

Extend BackgroundScheduler tests for:

- first occurrence at anchor plus interval;
- atomic double-poll claim;
- next future slot calculation;
- run-once and skip misfire policies;
- expiry while offline;
- max claimed count;
- long-run overlap coalescing;
- retry reuse of occurrence and message IDs;
- stale running recovery;
- clock and time zone changes.

Use an injected clock. Do not rely on real timers in unit tests.

### 23.7 IPC tests

```text
test/vitest/main/ipc/ai-chat-scheduled-loop-ipc.test.ts
```

Assert AI gate occurs before decoder/Module construction, invalid unknown input
is rejected, responses are sanitized, and cross-conversation controls fail.

### 23.8 Renderer tests

Test same-chat history refresh, deferred refresh during interactive streaming,
conversation preview/unread update, no automatic navigation, draft preservation,
controls, deletion conflict, and all translation keys.

### 23.9 Upgrade tests

Create a database fixture from the pre-change schema containing:

- cron and dependency schedules;
- legacy AI message tasks and runs;
- multiple Chat V2 conversations;
- active and inactive rows.

Open it with the new entity schema and verify all old rows and behavior remain.

## 24. Implementation Order

1. Add shared types, config, and parser with unit tests.
2. Add nullable schema fields and upgrade fixture tests.
3. Add interval Model/Module operations and atomic claim tests.
4. Add `AIChatScheduledLoopModule` creation/control logic.
5. Add IPC, preload, and renderer API with mandatory AI gate tests.
6. Extract `AIChatQueryEngineFactory` without changing interactive behavior.
7. Add trusted scheduled turn context and stable message IDs.
8. Add conversation turn coordinator and integrate interactive Chat V2.
9. Route chat-created scheduled tasks through the query engine.
10. Add interval polling, occurrence claiming, recovery, and coalescing.
11. Add broadcaster and renderer history refresh/unread behavior.
12. Add conversation clear/delete preflight.
13. Add translations, observability, packaged-app smoke tests, and full
    regression coverage.

Each step should be committed as a complete logical unit and must leave type
checking and relevant tests passing.

## 25. Verification Commands

Recommended focused checks:

```text
npx vitest run test/vitest/utilitycode/AiChatLoopCommandParser.test.ts
npx vitest run test/vitest/main/modules/AIChatScheduledLoopModule.test.ts
npx vitest run test/vitest/main/service/AIChatConversationTurnCoordinator.test.ts
npx vitest run test/vitest/main/service/ScheduledAiMessageRunner.chatLoop.test.ts
npx vitest run test/vitest/main/ipc/ai-chat-scheduled-loop-ipc.test.ts
yarn vue-check
yarn build
```

Also run the existing goal-loop, Chat V2, scheduler, AI message task, and
conversation-history suites to detect regressions.

## 26. Failure and Recovery Scenarios

| Scenario | Required result |
| --- | --- |
| App closes before first run | Persisted next run is recovered; at most one catch-up |
| App crashes after occurrence claim | Stale run marked interrupted; retry uses same occurrence |
| User message saved before crash | Retry reuses stable user message row |
| Assistant saved before run completion update | Recovery detects assistant row and finalizes run |
| Renderer closed during completion | Database persists result; next load shows it |
| Renderer event delivery fails | Mark notification failure only; do not fail AI run |
| Interactive turn active at due time | Scheduled run defers/coalesces; interactive turn continues |
| Scheduled turn active when user sends | User waits briefly or receives busy action; scheduled turn is not discarded |
| Tool requires permission | Tool blocked and schedule paused; no unattended prompt waits |
| Conversation deleted | Schedule stopped first or orphan scan pauses it |
| AI disabled after creation | No API call; bounded failure and eventual pause |
| Interval shorter than run | No overlap; future occurrence coalesced |
| Scheduler polls twice | Transaction and unique occurrence permit one claim |
| Task/schedule conversation mismatch | Run fails and schedule pauses |

## 27. Key Invariants

The implementation is correct only if all invariants hold:

1. A chat-created scheduled loop has exactly one originating `v2-*`
   conversation.
2. Task, schedule, run, user message, assistant message, tool messages, and
   renderer events agree on that conversation ID.
3. No scheduled occurrence generates a conversation ID.
4. One conversation has at most one active turn.
5. One schedule occurrence has at most one task-run row.
6. One occurrence has stable user and assistant message IDs across retries.
7. A run cannot be completed before transcript persistence finishes.
8. A notification cannot create or alter transcript data.
9. Missed slots cannot create an unbounded backlog.
10. Interactive approval state cannot widen unattended tool permissions.
11. Deleting a conversation cannot leave an active chat-created schedule.
12. Bare integer `/loop` behavior remains unchanged.

## 28. Definition of Done

The technical implementation is complete when a duration-based `/loop` can be
created from a new or existing Chat V2 conversation, survives application
restart, executes bounded non-overlapping occurrences, uses the full existing
conversation transcript, writes every scheduled turn back to that transcript,
coexists safely with interactive messages, enforces task-scoped tool policy,
supports pause/resume/stop, recovers idempotently from partial failures, updates
the renderer without changing conversations, and passes the parser, schema,
Module, engine, runner, scheduler, IPC, renderer, security, upgrade, and packaged
application tests described above.
