# Design: Scheduled AI Message Task

**Date:** 2026-06-09
**Status:** Approved
**PRD:** `doc/skills/ai-message-task-prd/README.md`
**Tech Advice:** `doc/skills/ai-message-task-prd/technology-advice/README.md`

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runner architecture | Standalone runner (Approach A) | Clean separation from UI-oriented StreamEventProcessor; easier to test |
| Conversation model | New conversation per run | Avoids context pollution; each run log maps to one conversation |
| Run results display | Dedicated page + AI chat history | Both: dedicated run history page (primary) and AI chat persistence |
| Phasing | All 4 phases in one pass | Faster delivery; larger but cohesive PR |

---

## 1. Data Layer

### New Files

- `src/entity/AiMessageTask.entity.ts`
- `src/entity/AiMessageTaskRun.entity.ts`
- `src/entityTypes/aiMessageTaskTypes.ts`

### Modified Files

- `src/entity/ScheduleTask.entity.ts` — add `AI_MESSAGE = "ai_message"` to TaskType enum

### Types (`aiMessageTaskTypes.ts`)

```ts
export enum AiMessageTaskStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
  PAUSED = "paused",
}

export enum AiMessageRunStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
  BLOCKED_BY_POLICY = "blocked_by_policy",
  TIMEOUT = "timeout",
}

export enum AiMessageErrorCode {
  AI_DISABLED = "AI_DISABLED",
  TASK_NOT_FOUND = "TASK_NOT_FOUND",
  TOOL_NOT_ALLOWED = "TOOL_NOT_ALLOWED",
  TOOL_LIMIT_EXCEEDED = "TOOL_LIMIT_EXCEEDED",
  RUNTIME_TIMEOUT = "RUNTIME_TIMEOUT",
  REMOTE_AI_ERROR = "REMOTE_AI_ERROR",
  TOOL_EXECUTION_FAILED = "TOOL_EXECUTION_FAILED",
  CONVERSATION_CONTINUE_FAILED = "CONVERSATION_CONTINUE_FAILED",
}

export interface AiMessageTaskToolPolicy {
  allowedToolNames: string[];
  autoApproveTools: boolean;
  maxToolCalls: number;
  maxRuntimeMs: number;
  maxContinueCalls: number;
}
```

### AiMessageTaskEntity Fields

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | integer (PK, auto-increment) | auto | |
| name | text | required | |
| description | text | "" | |
| message | text | required | The prompt sent to AI |
| system_prompt | text | null | Optional system prompt |
| model | text | null | Optional model override |
| conversation_id | text | null | Not reused; generated per run |
| allowed_tools_json | text | "[]" | JSON string of tool name array |
| auto_approve_tools | boolean | false | |
| max_tool_calls | integer | 10 | |
| max_runtime_ms | integer | 300000 (5 min) | |
| max_continue_calls | integer | 10 | |
| status | text | "active" | AiMessageTaskStatus |
| last_run_time | datetime | null | |
| last_result_summary | text | null | |
| last_error_message | text | null | |
| created_at | datetime | now | |
| updated_at | datetime | now | |

### AiMessageTaskRunEntity Fields

| Field | Type | Notes |
|-------|------|-------|
| id | integer (PK, auto-increment) | |
| task_id | integer (FK) | References AiMessageTask |
| schedule_id | integer (nullable) | References ScheduleTask |
| conversation_id | text | Generated per run |
| status | text | AiMessageRunStatus |
| started_at | datetime | |
| finished_at | datetime | |
| duration_ms | integer | |
| tool_calls_count | integer | |
| blocked_tool_calls_json | text | JSON array of blocked call records |
| assistant_final_message | text | |
| error_message | text | |
| metadata_json | text | |

---

## 2. Model + Module Layer

### New Files

- `src/model/AiMessageTask.model.ts` — extends BaseDb
- `src/model/AiMessageTaskRun.model.ts` — extends BaseDb
- `src/modules/AiMessageTaskModule.ts` — extends BaseModule
- `src/modules/AiMessageTaskRunModule.ts` — extends BaseModule

### AiMessageTaskModule Responsibilities

- CRUD for AI message tasks (create, read, update, delete, list)
- Validate `message` (required), `model` (optional)
- Validate `allowed_tools_json`: parse JSON, call `AiMessageToolCatalogService` to verify each tool name is a real schedulable built-in skill
- Check `USER_AI_ENABLED` before task creation
- Update task status, last_run_time, last_result_summary, last_error_message
- Expose task detail for schedule validation

### AiMessageTaskRunModule Responsibilities

- Create run record (status: pending -> running)
- Update run status, duration, tool_calls_count, blocked_tool_calls_json
- Append blocked tool call metadata
- List run history by task_id and schedule_id
- Get latest run for a task

---

## 3. Tool Catalog + Policy Service

### New Files

- `src/service/AiMessageToolCatalogService.ts`
- `src/service/ScheduledAiToolPolicy.ts`

### SchedulableAiToolSummary

```ts
export interface SchedulableAiToolSummary {
  readonly name: string;
  readonly description: string;
  readonly permissionCategory: SkillPermissionCategory;
  readonly source: "built-in";
  readonly requiresConfirmation: boolean;
  readonly schedulable: boolean;
  readonly autoApproveAllowed: boolean;
  readonly blockedReason?: string;
  readonly riskLevel: "low" | "medium" | "high" | "blocked";
}
```

### ScheduledToolDecision

```ts
export interface ScheduledToolDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly riskLevel: "low" | "medium" | "high" | "blocked";
}
```

### AiMessageToolCatalogService

- `listSchedulableBuiltInTools()` -> `SchedulableAiToolSummary[]`
- Reads built-in skills from registry (source === "built-in")
- Uses `ScheduledAiToolPolicy.describeBuiltInTool()` for mapping

### ScheduledAiToolPolicy

- `describeBuiltInTool(skill: SkillDefinition)` -> `SchedulableAiToolSummary`
- `canAutoApproveScheduledTool(params)` -> `ScheduledToolDecision`

### V1 Default Rules

| Category | Schedulable | Auto-Approve | Risk Level | Blocked Reason |
|----------|-------------|--------------|------------|----------------|
| pure | yes | yes | low | - |
| network (allowlisted) | yes | if listed | medium | - |
| automation (allowlisted) | yes | if listed | medium | - |
| shell | no | no | blocked | "Shell execution blocked for unattended tasks in v1" |
| filesystem | no | no | blocked | "Filesystem write/edit blocked for unattended tasks in v1" |
| non-built-in | no | no | blocked | "Only built-in tools supported in v1" |
| MCP | no | no | blocked | "MCP tools blocked for unattended tasks in v1" |

---

## 4. Headless Runner

### New File

- `src/service/ScheduledAiMessageRunner.ts`

### Flow

1. Create run log via `AiMessageTaskRunModule` (status: running, started_at)
2. Check `USER_AI_ENABLED` — if disabled, fail with `AI_DISABLED`
3. Load task configuration via `AiMessageTaskModule`
4. Generate new `conversation_id` (uuid)
5. Get schedulable tool definitions from catalog, filter to task's `allowed_tools_json`
6. Convert filtered skills to `ToolFunction[]` for AI server
7. Call `AiChatApi.streamMessage()` with filtered tools
8. Process stream events:
   - `token`: accumulate assistant text
   - `tool_call`: check policy -> execute approved tool or return blocked result
   - `error`: record and decide whether to continue
   - `done`: finalize
9. If tool_call approved: execute via `SkillExecutor` with `skipPermissionCheck: true` and scheduled metadata, then send results via `AiChatApi.streamContinueWithToolResults()`
10. If tool_call blocked: return blocked result to AI server, record in blocked_tool_calls
11. Repeat until done or safety limit hit
12. Update run log and task status

### ScheduledSkillExecutionMetadata Extension

```ts
export interface ScheduledSkillExecutionMetadata {
  readonly executionMode: "scheduled";
  readonly aiMessageTaskId: number;
  readonly scheduleId?: number;
  readonly aiMessageRunId: number;
  readonly autoApproved: boolean;
}
```

Add to `SkillExecutionContext`:
```ts
readonly scheduled?: ScheduledSkillExecutionMetadata;
```

### Safety Limits (Enforced in Runner)

| Limit | Default | Check |
|-------|---------|-------|
| max_runtime_ms | 300000 (5 min) | Elapsed time |
| max_tool_calls | 10 | Count before execution |
| max_continue_calls | 10 | Count before continue |
| max consecutive failures | 3 | Count consecutive failures |
| max assistant message length | 100KB | Truncate if exceeded |
| max tool result size | 50KB | Truncate before sending |

### Cancellation

- In-memory `Map<number, AbortController>` keyed by run ID
- `cancel(runId)` method aborts the active stream
- Runner catches AbortError, marks run as cancelled

### Error Handling

- All errors caught, persisted to run log error_message
- Re-thrown to TaskExecutorService so schedule execution log records failure
- Tool failures returned to AI server as structured `ToolExecutionResult` with success: false

---

## 5. TaskExecutorService Integration

### Modified File

- `src/modules/TaskExecutorService.ts`

### Changes

- Add `aiMessageTaskModule: AiMessageTaskModule` field
- Add `scheduledAiMessageRunner: ScheduledAiMessageRunner` field
- Add `case TaskType.AI_MESSAGE:` to `executeScheduledTask()` switch
- Add `executeAiMessageTask(taskId: number, scheduleId?: number): Promise<number>` method
- Add `AI_MESSAGE` case to `getTaskStatus()` and `cancelTask()`

---

## 6. IPC Handlers

### New File

- `src/main-process/communication/ai-message-task-ipc.ts`

### IPC Channels

| Channel | Purpose |
|---------|---------|
| `AI_MESSAGE_TASK_CREATE` | Create AI message task |
| `AI_MESSAGE_TASK_UPDATE` | Update AI message task |
| `AI_MESSAGE_TASK_DELETE` | Delete AI message task |
| `AI_MESSAGE_TASK_LIST` | List AI message tasks |
| `AI_MESSAGE_TASK_DETAIL` | Get task detail |
| `AI_MESSAGE_TASK_RUNS_LIST` | List run logs for a task |
| `AI_MESSAGE_TASK_RUN_DETAIL` | Get run detail |
| `AI_MESSAGE_TASK_LIST_AVAILABLE_TOOLS` | Get schedulable tools catalog |

All handlers check `USER_AI_ENABLED` before doing AI work.

---

## 7. UI

### New Files

- Vue component for AI message task creation/editing form
- Vue component for run history display
- Pinia store integration
- Preload API additions for IPC channels

### Modified Files

- All 6 language files: `src/views/lang/{en,zh,es,fr,de,ja}.ts`

### UI Fields

- Task name, description
- Message (prompt), system prompt
- Model selector
- Tool allowlist with risk labels and blocked reasons
- Auto-approve toggle
- Safety limit inputs (max tool calls, max runtime, max continue calls)

---

## 8. Results in AI Chat History

Scheduled run results appear in both:
1. **Dedicated task run page** (primary) — shows tool execution history, blocked calls, errors
2. **Main AI chat history** — the conversation is persisted through existing AI chat persistence after the run completes

---

## New Files Summary

| File | Purpose |
|------|---------|
| `src/entity/AiMessageTask.entity.ts` | Task entity |
| `src/entity/AiMessageTaskRun.entity.ts` | Run log entity |
| `src/entityTypes/aiMessageTaskTypes.ts` | Types and enums |
| `src/model/AiMessageTask.model.ts` | Task data access |
| `src/model/AiMessageTaskRun.model.ts` | Run log data access |
| `src/modules/AiMessageTaskModule.ts` | Task business logic |
| `src/modules/AiMessageTaskRunModule.ts` | Run log business logic |
| `src/service/AiMessageToolCatalogService.ts` | Tool catalog |
| `src/service/ScheduledAiToolPolicy.ts` | Tool policy |
| `src/service/ScheduledAiMessageRunner.ts` | Headless runner |
| `src/main-process/communication/ai-message-task-ipc.ts` | IPC handlers |
| Vue components | Task management UI |

## Modified Files Summary

| File | Change |
|------|--------|
| `src/entity/ScheduleTask.entity.ts` | Add `AI_MESSAGE` to TaskType |
| `src/entityTypes/skillTypes.ts` | Add `scheduled?` to SkillExecutionContext |
| `src/modules/TaskExecutorService.ts` | Add AI_MESSAGE execution path |
| `src/views/lang/{en,zh,es,fr,de,ja}.ts` | Add i18n keys |
