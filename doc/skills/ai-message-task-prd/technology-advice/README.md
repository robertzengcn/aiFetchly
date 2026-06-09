# Technology Advice: Scheduled AI Message Task

This document gives implementation-focused advice for adding the `ai_message` task type and scheduled, policy-gated AI tool execution described in the PRD.

The most important design rule is that scheduled AI execution must be headless, auditable, and policy-scoped. It should not reuse UI permission prompts, and it should not bypass all skill permissions globally.

---

## 1. Architecture Fit

Run scheduled AI message tasks from the Electron main process through the existing scheduler path:

```text
ScheduleManager
  -> TaskExecutorService.executeScheduledTask()
  -> TaskType.AI_MESSAGE
  -> AiMessageTaskModule
  -> ScheduledAiMessageRunner
  -> AiChatApi.streamMessage()
  -> ScheduledAiToolPolicy
  -> SkillExecutor
  -> AiChatApi.streamContinueWithToolResults()
```

Recommended new files:

- `src/entity/AiMessageTask.entity.ts`
- `src/entity/AiMessageTaskRun.entity.ts`
- `src/entityTypes/aiMessageTaskTypes.ts`
- `src/model/AiMessageTask.model.ts`
- `src/model/AiMessageTaskRun.model.ts`
- `src/modules/AiMessageTaskModule.ts`
- `src/modules/AiMessageTaskRunModule.ts`
- `src/service/ScheduledAiMessageRunner.ts`
- `src/service/ScheduledAiToolPolicy.ts`
- `src/service/AiMessageToolCatalogService.ts`

Existing files to extend:

- `src/entity/ScheduleTask.entity.ts`
- `src/entityTypes/schedule-type.ts`
- `src/modules/TaskExecutorService.ts`
- `src/config/skillsRegistry.ts`
- AI message task IPC files under `src/main-process/communication/`
- Vue task management pages and all language files under `src/views/lang/`

Do not place database logic in IPC handlers. Do not create worker database access.

---

## 2. Built-In Tool Catalog Function

The system should provide a function that returns built-in skill/function call names for creating AI message tasks.

Do this as a dedicated service, not as ad hoc registry reads in Vue or IPC:

- `AiMessageToolCatalogService.listSchedulableBuiltInTools()`
- optional IPC: `AI_MESSAGE_TASK_LIST_AVAILABLE_TOOLS`
- optional built-in read tool: `list_available_ai_message_task_tools`

### Why a Catalog Service Is Needed

`SkillRegistry.getAllToolFunctions()` returns LLM-facing function definitions and includes dynamically discovered MCP tools. The AI message task UI needs a safer and richer list:

- tool name
- description
- permission category
- whether it is built-in
- whether it can be auto-approved in scheduled mode
- why it is blocked if not schedulable
- default recommendation state

Raw function names are not enough because some tools must not run unattended.

### Recommended Output Shape

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

Example response:

```json
{
  "success": true,
  "tools": [
    {
      "name": "list_schedules",
      "description": "List schedules available in the application.",
      "permissionCategory": "automation",
      "source": "built-in",
      "requiresConfirmation": false,
      "schedulable": true,
      "autoApproveAllowed": true,
      "riskLevel": "low"
    },
    {
      "name": "shell_execute",
      "description": "Execute a local shell command.",
      "permissionCategory": "shell",
      "source": "built-in",
      "requiresConfirmation": true,
      "schedulable": false,
      "autoApproveAllowed": false,
      "blockedReason": "Shell execution is blocked for unattended scheduled AI tasks in v1.",
      "riskLevel": "blocked"
    }
  ]
}
```

### Registry API Recommendation

Add a registry helper that returns `SkillDefinition` metadata for built-ins only:

```ts
function listBuiltInSkillDefinitions(): SkillDefinition[] {
  return Array.from(registry.values()).filter(
    (skill) => skill.source === "built-in"
  );
}
```

Then `AiMessageToolCatalogService` should map these definitions into `SchedulableAiToolSummary`.

Do not use `getAllToolFunctions()` for the task creation allowlist because it includes MCP tools and strips execution metadata such as `permissionCategory`, `requiresConfirmation`, and `source`.

---

## 3. Tool Schedulability Policy

Use one policy module for both:

- task creation UI catalog decisions
- runtime scheduled tool-call allow/deny decisions

Recommended service:

- `ScheduledAiToolPolicy`

Recommended functions:

```ts
function describeBuiltInToolForSchedule(
  skill: SkillDefinition
): SchedulableAiToolSummary;

function canAutoApproveScheduledTool(params: {
  readonly skill: SkillDefinition;
  readonly taskPolicy: AiMessageTaskToolPolicy;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
}): ScheduledToolDecision;
```

Decision shape:

```ts
export interface ScheduledToolDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly riskLevel: "low" | "medium" | "high" | "blocked";
}
```

Default v1 rules:

- Allow `pure` built-ins.
- Allow selected read-only built-ins.
- Allow selected non-destructive `network` tools only when explicitly allowlisted.
- Allow selected non-destructive `automation` tools only when explicitly allowlisted.
- Block `shell` tools.
- Block filesystem write/edit tools.
- Block system dependency install tools.
- Block email sending tools unless a future exact-recipient policy exists.
- Block schedule mutation tools unless a future exact-schedule policy exists.
- Block MCP tools in v1.
- Block user and marketplace skills in v1 for scheduled auto-approval.

The policy must be local and deterministic. The remote AI server cannot alter it.

---

## 4. Data Model Advice

### 4.1 `AiMessageTaskEntity`

Recommended fields:

- `id`
- `name`
- `description`
- `message`
- `system_prompt`
- `model`
- `conversation_id`
- `allowed_tools_json`
- `auto_approve_tools`
- `max_tool_calls`
- `max_runtime_ms`
- `max_continue_calls`
- `status`
- `last_run_time`
- `last_result_summary`
- `last_error_message`

Keep `allowed_tools_json` as a JSON string in SQLite for v1. Parse and validate it in the module/service boundary.

### 4.2 `AiMessageTaskRunEntity`

Recommended fields:

- `id`
- `task_id`
- `schedule_id`
- `conversation_id`
- `status`
- `started_at`
- `finished_at`
- `duration_ms`
- `tool_calls_count`
- `blocked_tool_calls_json`
- `assistant_final_message`
- `error_message`
- `metadata_json`

Store blocked tool calls separately from successful tool calls so users can understand what the scheduled agent attempted.

---

## 5. Module and Model Boundaries

Use the standard three-layer pattern:

- Model: TypeORM access only.
- Module: task business logic and validation.
- IPC: request parsing and Module calls only.

Recommended module responsibilities:

### `AiMessageTaskModule`

- create/update/delete/list tasks
- validate message, model, limits, and allowed tool names
- call `AiMessageToolCatalogService` to verify selected tools are schedulable
- expose task detail for schedule validation
- update task status and last result fields

### `AiMessageTaskRunModule`

- create run record
- update run status
- append/update blocked tool call metadata
- list run history
- fetch latest run

Do not let `ScheduledAiMessageRunner` write directly through repositories. It should call Modules.

---

## 6. TaskExecutorService Integration

Add `TaskType.AI_MESSAGE = "ai_message"` in `ScheduleTask.entity.ts`.

Then update `TaskExecutorService`:

```ts
case TaskType.AI_MESSAGE:
  taskOutputId = await this.executeAiMessageTask(schedule.task_id, schedule.id);
  break;
```

Recommended method:

```ts
async executeAiMessageTask(
  taskId: number,
  scheduleId?: number
): Promise<number> {
  const runner = new ScheduledAiMessageRunner();
  const result = await runner.run({ taskId, scheduleId });
  return result.runId;
}
```

Also update:

- `getTaskStatus`
- `cancelTask`
- `validateTaskConfiguration`
- task execution statistics if used
- schedule AI tool validation for `TaskType.AI_MESSAGE`

Cancellation can be implemented with an in-memory abort controller map in the runner, keyed by task ID or run ID.

---

## 7. Headless Runner Design

Do not reuse `StreamEventProcessor` directly for scheduled runs. It is UI-oriented and sends renderer IPC chunks, handles retained active stream state, and waits for permission prompts.

Instead, extract or duplicate the lower-level tool loop into `ScheduledAiMessageRunner`.

Runner responsibilities:

1. Create run log.
2. Check `USER_AI_ENABLED`.
3. Load task configuration.
4. Generate or reuse conversation ID.
5. Get schedulable tool definitions.
6. Filter tools to the task's allowed set.
7. Call `AiChatApi.streamMessage()`.
8. Accumulate assistant tokens.
9. On `tool_call`, call policy.
10. Execute approved tool with scheduled context.
11. Save tool call/result.
12. Send result through `streamContinueWithToolResults()`.
13. Stop on done, error, cancellation, or safety limit.
14. Update run log and task status.

Use the existing `AiChatApi.streamMessage()` and `streamContinueWithToolResults()` APIs. Do not create a second remote AI API path unless the current API cannot support headless continuation.

---

## 8. Scheduled Skill Execution Context

Extend `SkillExecutionContext` to support scheduled execution metadata:

```ts
export interface ScheduledSkillExecutionMetadata {
  readonly executionMode: "scheduled";
  readonly aiMessageTaskId: number;
  readonly scheduleId?: number;
  readonly aiMessageRunId: number;
  readonly autoApproved: boolean;
}
```

Then add an optional field to `SkillExecutionContext`:

```ts
readonly scheduled?: ScheduledSkillExecutionMetadata;
```

Runtime execution should work like this:

1. `ScheduledAiMessageRunner` checks `ScheduledAiToolPolicy`.
2. If allowed, call `SkillExecutor.execute()` with `skipPermissionCheck: true` and `scheduled` metadata.
3. If not allowed, do not call `SkillExecutor`; return a blocked tool result.

This keeps `SkillPermissionService` behavior unchanged for interactive chat and makes the scheduled bypass explicit and auditable.

---

## 9. Available Tool Filtering for AI Server

When running an AI message task, do not send every registry tool to the AI server.

Use this strategy:

1. Load built-in skill definitions from registry.
2. Convert to catalog summaries through `AiMessageToolCatalogService`.
3. Keep only tools where:
   - `schedulable === true`
   - tool name is in `allowed_tools_json`, or permission category is `pure`
   - v1 risk policy allows the tool category
4. Convert the filtered `SkillDefinition[]` to `ToolFunction[]`.
5. Pass those functions as `client_tools`.

This reduces the chance that the AI server requests tools the task cannot run.

Still enforce policy at runtime. Filtering is guidance; the runtime policy is enforcement.

---

## 10. Tool Call Persistence

Reuse `ToolExecutionService` where possible for saving tool calls and results, but include scheduled metadata.

Recommended metadata fields:

- `executionMode: "scheduled"`
- `aiMessageTaskId`
- `aiMessageRunId`
- `scheduleId`
- `autoApproved`
- `blockedByPolicy`
- `blockedReason`

If `ToolExecutionService` is too tightly coupled to `AIChatModule`, add a narrow scheduled wrapper rather than writing directly to repositories.

---

## 11. UI and IPC Recommendations

### IPC

Add IPC handlers for:

- create AI message task
- update AI message task
- delete AI message task
- list AI message tasks
- get AI message task detail
- list AI message task runs
- get available built-in tools for AI message task

The available-tools IPC should return `SchedulableAiToolSummary[]`, not raw `ToolFunction[]`.

### UI

Task creation UI should show:

- prompt fields
- model selection
- schedule fields or schedule link
- available built-in tool list
- risk labels
- blocked tools disabled with reasons
- auto-approve toggle
- safety limit inputs

Tool allowlist selection should save only tool names. The backend should revalidate names on every create/update because registry contents can change.

Update all language files:

- `en.ts`
- `zh.ts`
- `es.ts`
- `fr.ts`
- `de.ts`
- `ja.ts`

---

## 12. Safety Limits

Implement limits in the runner, not only in UI validation:

- max runtime
- max tool calls
- max continue calls
- max consecutive tool failures
- max final assistant message length
- max tool result payload size

If a limit is reached:

1. Mark run as failed or timeout.
2. Save the limit reason.
3. Return failure to `TaskExecutorService`.
4. Let `ScheduleManager` log the schedule execution failure.

---

## 13. Error Handling

Use structured error codes:

- `AI_DISABLED`
- `TASK_NOT_FOUND`
- `TOOL_NOT_ALLOWED`
- `TOOL_BLOCKED_BY_CATEGORY`
- `TOOL_LIMIT_EXCEEDED`
- `RUNTIME_TIMEOUT`
- `REMOTE_AI_ERROR`
- `TOOL_EXECUTION_FAILED`
- `CONVERSATION_CONTINUE_FAILED`

Blocked tool result example:

```json
{
  "success": false,
  "error": "Tool blocked by scheduled AI task policy",
  "code": "TOOL_NOT_ALLOWED",
  "tool_name": "shell_execute"
}
```

Send blocked tool results back to the AI server when the conversation can continue. This lets the model produce a useful final explanation instead of hanging.

---

## 14. Testing Strategy

### Unit Tests

- tool catalog returns built-in skill names with metadata
- catalog excludes or marks MCP/user/marketplace tools blocked
- policy allows pure tools
- policy blocks shell
- policy blocks file write/edit
- policy blocks unlisted tools
- task create/update rejects unknown allowed tool names
- runner stops at max tool calls
- runner stops at max continue calls

### Integration Tests

- create AI message task with empty tool allowlist
- scheduled run completes without tools
- scheduled run executes an approved built-in read tool
- scheduled run blocks unapproved tool and stores blocked call
- `TaskExecutorService` executes `TaskType.AI_MESSAGE`
- AI disabled prevents run before remote call
- schedule execution log records success/failure

### Registry Tests

- `listBuiltInSkillDefinitions()` returns built-ins only
- tool catalog preserves `permissionCategory`, `requiresConfirmation`, and `source`
- schedulable tools convert back to valid `ToolFunction[]` for `AiChatApi`

---

## 15. Rollout Plan

1. Add catalog service and available-tools IPC.
2. Add AI message task and run entities/modules.
3. Add task CRUD UI using the catalog.
4. Add `TaskType.AI_MESSAGE` execution without tools.
5. Add headless tool loop with policy-gated built-in tools.
6. Add schedule integration and run history.
7. Add stricter policies for higher-risk tools only after exact-argument approval exists.

The catalog service should be built first because it informs the UI, task validation, and runtime filtering.

---

## 16. Implementation Watchouts

- Do not use `SkillRegistry.getAllToolFunctions()` as the task allowlist source; it includes MCP tools and loses metadata.
- Do not store full tool definitions in the AI message task. Store tool names and revalidate against the registry.
- Do not auto-approve shell execution in v1.
- Do not auto-approve filesystem write/edit in v1.
- Do not let the remote AI server request policy changes during runtime.
- Do not rely on UI validation for safety. Enforce policy in the runner.
- Do not modify unrelated translation files while adding backend-only pieces.
