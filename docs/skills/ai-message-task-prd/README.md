# PRD: Scheduled AI Message Task

**Version:** 1.0  
**Date:** 2026-06-09  
**Status:** Draft  
**Owner:** aiFetchly Core Team

---

## 1. Background and Problem

aiFetchly already supports scheduled task execution through `ScheduleManager`, `ScheduleTaskModule`, and `TaskExecutorService`. The AI chat system already supports remote AI conversations, tool/function definitions, local built-in skill execution, and permission prompts for sensitive tools.

Users want a new task type that can be scheduled like other automation tasks:

> Send a configured message to the AI server on schedule, allow the AI server to request built-in skill/function calls, execute approved local tools automatically during the unattended run, and return tool results to the AI server until the AI produces a final response.

Current gaps:

- `TaskType` has no AI message task.
- AI chat execution is currently UI-oriented and can pause for user permission.
- Scheduled jobs run unattended, so interactive permission prompts cannot block runtime.
- Automatically allowing all requested tools would create an unsafe trust boundary.
- There is no task-level policy for which AI-requested tools may run without user confirmation.

---

## 2. Product Goal

Add a scheduled AI message task that can run headlessly from the scheduler while safely executing only pre-approved built-in skills/function calls.

### 2.1 Primary Goals

- Add `ai_message` as a first-class task type in task management and scheduling.
- Let users configure a prompt/message that will be sent to the AI server on schedule.
- Let the scheduled AI run use built-in skills/function calls when the user has pre-approved those tools for that task.
- Prevent unattended execution of unapproved or high-risk tools.
- Persist task runs, final AI responses, tool calls, blocked tool calls, and errors for inspection.
- Reuse existing AI chat API, skill registry, skill executor, and schedule execution architecture.

### 2.2 Non-Goals (v1)

- No global permission bypass for all built-in skills.
- No auto-approval for arbitrary MCP tools by default.
- No auto-approval for shell execution in v1.
- No auto-approval for file write/edit in v1.
- No replacement of the interactive AI chat UI.
- No new worker process unless future runtime isolation requires it.
- No AI-created task definitions inside this feature; this feature runs a user-configured AI message task.

---

## 3. Core Product Decision

Scheduled AI message tasks must use **task-scoped pre-approval**, not global auto-allow.

This means:

- The user confirms the AI message task configuration.
- The task stores an allowlist of tool names that may run unattended.
- Runtime auto-allows only tools on that allowlist and only within the task's safety limits.
- Any unapproved tool call is blocked, logged, and returned to the AI server as a failed tool result.

The phrase "auto allow during runtime" means:

> Auto-allow only tools explicitly approved for this scheduled AI message task.

It does not mean:

> Skip every skill permission check because the scheduler is running.

---

## 4. Scope

### In Scope

- Add `TaskType.AI_MESSAGE = "ai_message"`.
- Add AI message task entity/model/module for task configuration.
- Add AI message run log entity/model/module for scheduled run history.
- Add headless AI message runner for scheduled execution.
- Add task-level tool auto-approval policy.
- Add integration in `TaskExecutorService.executeScheduledTask()`.
- Add task validation/status/cancel support where applicable.
- Add schedule support so AI message tasks can be created and run by existing scheduler flow.
- Add UI/task management support for creating and editing AI message tasks.
- Update translations for all user-facing UI text.

### Out of Scope

- Full agent workflow builder.
- Long-running multi-day AI sessions.
- Interactive permission prompts during scheduled execution.
- Running local tools from renderer process.
- Allowing worker processes to access database directly.
- Allowing remote AI server to override the task's stored tool policy.

---

## 5. User Stories

1. As a user, I can create an AI message task with a prompt and optional system prompt.
2. As a user, I can schedule that AI message task using existing schedule management.
3. As a user, I can choose which built-in skills the AI is allowed to run unattended.
4. As a user, I can set runtime safety limits such as max tool calls and max runtime.
5. As a user, I can inspect each scheduled run's final AI response and tool execution history.
6. As a user, if AI requests an unapproved tool, the task blocks it and records why.
7. As a developer, I can test scheduled AI execution without renderer IPC or UI permission prompts.

---

## 6. Functional Requirements

### FR-1: New Task Type

Add a new schedule task type:

```ts
TaskType.AI_MESSAGE = "ai_message"
```

Acceptance criteria:

- `ScheduleTaskEntity.TaskType` includes `ai_message`.
- Schedule create/update validation accepts `ai_message`.
- `TaskExecutorService.executeScheduledTask()` routes `ai_message` tasks to the scheduled AI message executor.
- Task status, cancellation, and validation paths handle `ai_message`.

### FR-2: AI Message Task Configuration

Create a persistent AI message task record.

Required fields:

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

Defaults:

- `auto_approve_tools`: `false`
- `allowed_tools_json`: `[]`
- `max_tool_calls`: `10`
- `max_runtime_ms`: `300000`
- `max_continue_calls`: `10`

Acceptance criteria:

- AI message tasks can be created, read, updated, deleted, and listed through Module/Model classes.
- IPC handlers do not access the database directly.
- `conversation_id` is generated when absent.
- Disabled AI access prevents task execution and records a clear error.

### FR-3: AI Message Run Logs

Create a separate run log for each scheduled execution.

Required fields:

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

Acceptance criteria:

- Every scheduled run creates a run log.
- Final response and errors are persisted.
- Tool call count and blocked tool calls are visible in run details.
- Run logs can be queried by task and schedule.

### FR-4: Headless AI Message Runner

Create a headless runner for scheduled execution.

Recommended component:

- `ScheduledAiMessageRunner`

Responsibilities:

- Load AI message task configuration.
- Check `USER_AI_ENABLED` before calling the AI server.
- Build AI chat request with configured message, model, system prompt, conversation ID, and available tools filtered by policy.
- Consume remote stream events.
- Execute approved tool calls locally.
- Send tool results back through `AiChatApi.streamContinueWithToolResults()`.
- Continue until completion or safety limit.
- Persist transcript and run result.

Acceptance criteria:

- Runner does not depend on renderer IPC events.
- Runner does not show UI permission prompts.
- Runner handles remote `tool_call`, `token`, `error`, and completion events.
- Runner returns the AI message task run ID or another stable output ID to `TaskExecutorService`.

### FR-5: Task-Scoped Tool Policy

Each AI message task must define which tools are allowed for unattended execution.

Policy fields:

- `allowed_tools_json`: array of tool names.
- `auto_approve_tools`: boolean.
- `max_tool_calls`: integer.
- `max_runtime_ms`: integer.
- `max_continue_calls`: integer.

Runtime rules:

- Pure tools may run without confirmation.
- Built-in non-pure tools may run only if listed in `allowed_tools_json` and `auto_approve_tools` is true.
- Unknown tools are blocked.
- Unlisted tools are blocked.
- Shell tools are blocked in v1 even if listed.
- File write/edit tools are blocked in v1 even if listed.
- MCP tools are blocked by default in v1 unless a future explicit MCP policy is added.

Acceptance criteria:

- A tool outside the policy returns a failed tool result to the AI server.
- Blocked tool calls are stored in run logs.
- Tool policy cannot be changed by the remote AI response.

### FR-6: Auto-Approval Execution Context

Extend skill execution with a scheduled context rather than bypassing all permission checks.

Recommended context fields:

- `executionMode`: `"interactive" | "scheduled"`
- `scheduledTaskId`
- `scheduleId`
- `allowedToolNames`
- `autoApprovePolicyId` or equivalent metadata

Acceptance criteria:

- Interactive chat behavior remains unchanged.
- Scheduled AI runs can skip interactive permission prompts only for policy-approved tools.
- `SkillExecutor` or a wrapper checks the task policy before using `skipPermissionCheck`.
- Audit logs identify scheduled auto-approved tool calls.

### FR-7: Tool Result Loop

The scheduled runner must complete the full AI tool-call loop:

1. Send message to AI server with filtered `client_tools`.
2. Receive `tool_call`.
3. Check task policy.
4. Execute approved local tool.
5. Persist tool call and result.
6. Send result to AI server.
7. Continue until final AI response or safety limit.

Acceptance criteria:

- AI server receives tool results in the existing `ToolExecutionResult` format.
- Multiple tool calls can be handled within limits.
- Consecutive failures do not crash the scheduler.
- Final assistant message is persisted.

### FR-8: Safety Limits

Scheduled AI message runs must enforce hard limits.

Required limits:

- `max_runtime_ms`
- `max_tool_calls`
- `max_continue_calls`
- max assistant output size
- max tool result size
- max consecutive tool failures

Acceptance criteria:

- Exceeding a limit stops the run with a clear status.
- The run log records which limit was hit.
- Scheduler execution log marks the schedule as failed when the run fails.

### FR-9: Task Management UI

Add AI message task management UI.

Required UI fields:

- task name
- description
- message
- system prompt
- model
- conversation mode or conversation ID
- tool allowlist selector
- auto-approve toggle
- max tool calls
- max runtime
- max continue calls

Acceptance criteria:

- AI message task can be created and edited.
- User-facing text uses i18n keys in all supported languages.
- Tool allowlist clearly warns about unattended automation.
- Shell and file write/edit tools are not selectable for unattended auto-approval in v1.

### FR-10: Schedule Integration

AI message tasks must be schedulable through existing schedule infrastructure.

Acceptance criteria:

- Schedule create/update supports `task_type: "ai_message"`.
- Schedule execution invokes the AI message task.
- Schedule execution logs include success/failure and duration.
- Existing schedule dependency behavior can trigger AI message tasks.

---

## 7. Security Requirements

### SR-1: No Global Permission Bypass

The system must not add a global "scheduled run skips all permission checks" path.

### SR-2: High-Risk Tool Defaults

The following tools/categories must not auto-run unattended in v1:

- shell execution
- filesystem write/edit
- arbitrary MCP tools
- dependency installation
- tools that send email, unless a future exact-recipient approval policy is added
- schedule mutation tools, unless a future exact schedule-management policy is added

### SR-3: Local App Is Authoritative

The AI server may request tool calls, but the local app decides:

- whether the tool is known
- whether it is allowed by task policy
- whether execution limits permit it
- whether arguments pass local validation

### SR-4: Auditability

Every scheduled tool call must record:

- task ID
- schedule ID
- conversation ID
- tool name
- sanitized arguments
- auto-approved or blocked decision
- result status
- execution duration
- timestamp

### SR-5: AI Enabled Gate

Scheduled AI message execution must check `USER_AI_ENABLED` before calling the AI server or executing AI-requested tools.

---

## 8. Data Flow

```text
ScheduleManager
  -> TaskExecutorService.executeScheduledTask(schedule)
  -> TaskType.AI_MESSAGE
  -> ScheduledAiMessageRunner.run(taskId, scheduleId)
  -> AiChatApi.streamMessage()
  -> AI server returns tokens/tool calls
  -> ScheduledAiToolPolicy checks requested tool
  -> SkillExecutor executes approved tool
  -> AiChatApi.streamContinueWithToolResults()
  -> runner persists final result and run log
  -> TaskExecutorService returns run output ID
```

---

## 9. Technical Constraints

- Database logic must live in Model/Module classes.
- IPC handlers must call Modules; they must not use TypeORM repositories directly.
- Worker processes must not access the database directly.
- New child/worker entry points, if ever needed, must be placed in `src/childprocess/`.
- All AI feature IPC handlers must check `USER_AI_ENABLED` before doing AI work.
- All user-facing UI text must update `en`, `zh`, `es`, `fr`, `de`, and `ja` translations.
- New TypeScript code must avoid `any` and use explicit return types.

---

## 10. Error Handling

Suggested run statuses:

- `pending`
- `running`
- `completed`
- `failed`
- `cancelled`
- `blocked_by_policy`
- `timeout`

Suggested error codes:

- `AI_DISABLED`
- `TASK_NOT_FOUND`
- `MODEL_UNAVAILABLE`
- `TOOL_NOT_ALLOWED`
- `TOOL_LIMIT_EXCEEDED`
- `RUNTIME_TIMEOUT`
- `REMOTE_AI_ERROR`
- `TOOL_EXECUTION_FAILED`
- `CONVERSATION_CONTINUE_FAILED`

Acceptance criteria:

- Errors are persisted in AI message run logs.
- Scheduler execution log receives a clear success/failure state.
- Tool failures are returned to the AI server as structured tool results when possible.

---

## 11. Non-Functional Requirements

### Reliability

- Scheduled runs must not hang waiting for UI permission.
- Runtime limits must stop runaway tool loops.
- Failed tool calls must not crash the scheduler process.

### Security

- Unattended automation must be policy-gated.
- Dangerous tool categories must be disabled by default.
- Arguments and outputs must be sanitized before audit logging.

### Maintainability

- Headless scheduled AI flow should share lower-level helpers with interactive chat where practical.
- UI-specific `StreamEventProcessor` behavior should not be required for scheduled execution.
- Policy checks should be isolated and unit-testable.

### Performance

- The runner should not load unnecessary UI or renderer state.
- Tool definitions sent to the AI server should be filtered to tools allowed by the task policy.
- Tool result payloads must be size-limited before sending back to the AI server.

---

## 12. Test Requirements

### Unit Tests

- AI message task validation.
- Tool policy allow/deny decisions.
- High-risk tool category default blocking.
- Safety limit enforcement.
- Error code mapping.
- Safe audit payload formatting.

### Integration Tests

- Scheduled AI message task executes with no tools.
- Scheduled AI message task executes an approved read-only built-in tool.
- Unapproved tool call is blocked and returned to the AI server.
- Shell tool request is blocked in scheduled mode.
- Max tool call limit stops a loop.
- AI disabled state prevents execution.
- `TaskExecutorService` routes `TaskType.AI_MESSAGE` correctly.
- Schedule execution log records success/failure.

### Manual QA

- Create AI message task from task management UI.
- Select safe built-in tools for unattended use.
- Schedule the task with a cron expression.
- Verify the run appears in task and schedule logs.
- Verify blocked tool calls are visible.
- Verify translations display in all supported languages.

---

## 13. Rollout Plan

### Phase 1: Task and Storage

- Add `TaskType.AI_MESSAGE`.
- Add task entity/model/module.
- Add run log entity/model/module.
- Add basic task management UI without tool execution.

### Phase 2: Headless AI Run Without Tools

- Add `ScheduledAiMessageRunner`.
- Send scheduled message to AI server.
- Persist final response and run logs.
- Integrate with `TaskExecutorService`.

### Phase 3: Policy-Gated Tool Calls

- Add scheduled tool policy.
- Filter available tools sent to AI server.
- Execute approved built-in tools.
- Block unapproved tools with structured results.

### Phase 4: Schedule and UI Hardening

- Add full schedule create/edit support for `ai_message`.
- Add run history UI.
- Add all language translations.
- Add safety warnings and validation.

### Phase 5: Advanced Policies

- Consider exact-argument approval for email sending or schedule mutation tools.
- Consider controlled MCP allowlist.
- Consider per-tool quotas and cost tracking.

---

## 14. Open Questions

1. Should AI message tasks use a persistent conversation by default, or create a new conversation for each scheduled run?
2. Should users be able to approve exact tool arguments, such as a fixed email template or recipient list, in v1?
3. Should run results appear in the main AI chat history, a dedicated task run page, or both?
4. Should AI message tasks be allowed to trigger other schedules through dependency chains in v1?

---

## 15. Success Metrics

- Scheduled AI message task can run unattended without UI prompts.
- 100% of unattended tool executions are covered by task-scoped allowlist policy.
- Zero unattended shell/file-write executions in v1.
- Failed or blocked tool requests are visible in run history.
- Scheduler does not hang or leak active runs when AI server requests repeated tools.
