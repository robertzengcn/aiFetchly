# PRD: AI Schedule Management Built-In Skill

**Version:** 1.0  
**Date:** 2026-06-09  
**Status:** Draft  
**Owner:** aiFetchly Core Team

---

## 1. Background and Problem

aiFetchly already has a schedule system for running saved automation tasks on cron, dependency, or manual triggers. The application also has a built-in skill registry that lets AI chat call approved local tools.

Users want the AI server to create, update, edit, and delete schedules in the desktop application. Today, schedule management is available through application modules, but there is no first-class AI tool contract for it.

Current gaps:

- AI chat cannot safely create or manage schedules.
- A direct database write would not update the in-memory cron jobs owned by `ScheduleManager`.
- The AI needs structured discovery tools before it can choose valid `task_type` and `task_id` values.
- Schedule changes can trigger future automation, so write operations need explicit user confirmation.

---

## 2. Product Goal

Enable AI chat to manage application schedules through built-in skills while preserving the existing Module/Model architecture and keeping `ScheduleManager` as the authoritative runtime scheduler.

### 2.1 Primary Goals

- Let AI list and inspect existing schedules.
- Let AI create schedules for existing supported tasks.
- Let AI update schedule metadata, cron expressions, status, and activation state.
- Let AI delete schedules only when dependency rules allow it.
- Keep the in-memory scheduler synchronized after every create, update, pause, resume, or delete.
- Require user confirmation for every write operation.

### 2.2 Non-Goals (v1)

- No direct database access from AI tools.
- No AI-created task records; v1 schedules existing tasks only.
- No free-form execution of arbitrary code or commands.
- No schedule dependency graph editor beyond existing parent/dependency fields.
- No UI redesign for the scheduler page.
- No new worker process.

---

## 3. Scope

### In Scope

- Add built-in schedule management skills in `src/config/skillsRegistry.ts`.
- Add a dedicated service such as `src/service/ScheduleAiTools.ts`.
- Reuse `ScheduleTaskModule` for schedule CRUD.
- Reuse `ScheduleManager` for runtime cron synchronization.
- Reuse `ScheduleExecutionLogModule` for execution history reads where useful.
- Add validation that referenced task records exist before schedule creation or task reassignment.
- Return sanitized structured schedule payloads to AI chat.

### Out of Scope

- Creating new automation tasks from schedule tool calls.
- Replacing the existing scheduler implementation.
- Persisting a new audit table in v1.
- Running schedule logic inside renderer process.
- Allowing child or worker processes to access schedule database state directly.

---

## 4. Users and Use Cases

### 4.1 Primary Users

- Users who want AI chat to set up recurring automation.
- Users who need help modifying cron schedules.
- Users who want AI to inspect recent schedule health and suggest fixes.

### 4.2 User Stories

1. As a user, I can ask AI to list my schedules and see which ones are active.
2. As a user, I can ask AI to schedule an existing search, email extraction, maps, or email task.
3. As a user, I see a confirmation prompt before AI creates, updates, pauses, resumes, runs, or deletes a schedule.
4. As a user, I can ask AI to pause or resume a schedule without manually finding it in the UI.
5. As a user, I can ask AI why a schedule failed recently and get execution history.
6. As a developer, I can test schedule AI tools without reading `skillsRegistry.ts` business logic.

---

## 5. Functional Requirements

### FR-1: Read-Only Schedule Discovery Tools

Register read-only built-in skills:

- `list_schedules`
- `get_schedule_details`
- `list_schedule_executions`

Read tools must use `requiresConfirmation: false` and `permissionCategory: "automation"`.

`list_schedules` input:

- `page` number, default `0`
- `size` number, default `20`, max `100`
- optional `sort_key`
- optional `sort_order`

`get_schedule_details` input:

- `schedule_id` number, required

`list_schedule_executions` input:

- `schedule_id` number, optional
- `page` number, default `0`
- `size` number, default `20`, max `100`
- optional `status`
- optional `triggered_by`

Acceptance criteria:

- AI can inspect schedules without mutating state.
- Responses do not expose internal database objects directly.
- Pagination bounds are enforced.

### FR-2: Schedule Mutation Tools

Register write built-in skills:

- `create_schedule`
- `update_schedule`
- `delete_schedule`
- `pause_schedule`
- `resume_schedule`
- `run_schedule_now`

All write tools must use:

- `requiresConfirmation: true`
- `permissionCategory: "automation"`
- `source: "built-in"`

Acceptance criteria:

- The confirmation prompt clearly describes the target schedule and requested mutation.
- A denied confirmation performs no schedule mutation.
- Each mutation returns structured success/failure output.

### FR-3: Dedicated Schedule AI Tool Service

Create a service such as `ScheduleAiTools.ts` to hold tool implementation logic.

The registry should only define schemas and call service functions.

Required service responsibilities:

- Validate and normalize AI tool arguments.
- Call `ScheduleTaskModule` for database-backed schedule operations.
- Call `ScheduleManager` after successful mutations.
- Validate referenced task existence.
- Shape safe response payloads.
- Convert thrown errors to structured tool results.

Acceptance criteria:

- `skillsRegistry.ts` does not contain complex schedule CRUD logic.
- Service functions have explicit TypeScript return types.
- No `any` types are introduced.

### FR-4: Create Schedule

`create_schedule` must create a schedule for an existing task.

Input fields:

- `name` string, required
- `description` string, optional
- `task_type` enum, required: `search`, `email_extract`, `buck_email`, `yellow_pages`, `google_maps`, `yandex_maps`
- `task_id` number, required
- `cron_expression` string, required for cron schedules
- `is_active` boolean, default `false`
- `trigger_type` enum, default `cron`
- `parent_schedule_id` number, optional
- `dependency_condition` enum, optional
- `delay_minutes` number, default `0`

Product decision:

- AI-created schedules should default to inactive in v1 unless the user explicitly asks for an active schedule and confirms the action.

Acceptance criteria:

- Invalid cron expressions are rejected before persistence.
- Missing target tasks are rejected before persistence.
- When an active cron schedule is created, `ScheduleManager.addSchedule()` is called after the row is saved.
- Response includes `id`, `name`, `task_type`, `task_id`, `cron_expression`, `is_active`, `status`, `trigger_type`, and `next_run_time`.

### FR-5: Update Schedule

`update_schedule` must update an existing schedule.

Input fields:

- `schedule_id` number, required
- optional schedule fields from `ScheduleUpdateRequest`

Acceptance criteria:

- Existing schedule must be loaded before update.
- If `task_type` or `task_id` changes, the new referenced task must exist.
- If cron or activation state changes, the in-memory cron job is refreshed through `ScheduleManager.updateSchedule()`.
- The tool returns the updated safe schedule payload.

### FR-6: Delete Schedule

`delete_schedule` must delete a schedule only when existing dependency rules allow it.

Input fields:

- `schedule_id` number, required

Acceptance criteria:

- Schedule is removed from `ScheduleManager` before or immediately after database deletion.
- Schedules with child schedules are rejected using existing `ScheduleTaskModule.deleteSchedule()` behavior.
- Response includes `{ deleted: true, schedule_id }`.

### FR-7: Pause and Resume Schedule

`pause_schedule` and `resume_schedule` must delegate runtime behavior to `ScheduleManager`.

Acceptance criteria:

- Pause updates database status and removes the cron job.
- Resume updates database status and re-adds the cron job if active.
- Both tools return the latest schedule state.

### FR-8: Run Schedule Now

`run_schedule_now` must execute an existing active schedule immediately through `ScheduleManager.executeSchedule()`.

Acceptance criteria:

- Requires confirmation.
- Rejects missing or inactive schedules with a clear error.
- Uses existing execution logging behavior.
- Returns a structured result indicating execution was started or completed according to current scheduler behavior.

---

## 6. Validation Requirements

### VR-1: AI Enabled Gate

Schedule AI tool access occurs inside the AI feature flow. Any IPC handler that serves AI skill execution must continue checking `USER_AI_ENABLED` before tool execution.

Acceptance criteria:

- If AI is disabled, schedule skills are not executed.
- The result follows the existing disabled-AI response shape.

### VR-2: Task Reference Validation

Before creating a schedule or changing `task_type`/`task_id`, the service must verify that the referenced task exists.

Suggested mappings:

- `search` -> `SearchTaskModule.read(id)`
- `email_extract` -> `EmailSearchTaskModule.getTaskDetail(id)`
- `buck_email` -> `BuckEmailTaskModule.read(id)`
- `yellow_pages` -> `YellowPagesModule` task lookup
- `google_maps` -> `GoogleMapsModule.getSearchRecord(id)`
- `yandex_maps` -> `YandexMapsModule.getSearchRecord(id)`

Acceptance criteria:

- A missing referenced task returns a clear validation error.
- The schedule row is not created or updated when validation fails.

### VR-3: Cron Validation

Use existing schedule validation and cron parsing behavior.

Acceptance criteria:

- Invalid cron expressions are rejected.
- `next_run_time` is calculated for valid active cron schedules.

### VR-4: Dependency Safety

When dependency fields are provided, use existing dependency validation and circular dependency protection where available.

Acceptance criteria:

- Invalid parent schedule IDs are rejected.
- Circular dependency risks are surfaced as errors or warnings before mutation.

---

## 7. Data and Response Contract

### 7.1 Safe Schedule Payload

Tool responses should return only safe fields:

```json
{
  "id": 12,
  "name": "Daily dentist lead search",
  "description": "Runs every weekday morning",
  "task_type": "google_maps",
  "task_id": 48,
  "cron_expression": "0 9 * * 1-5",
  "is_active": true,
  "status": "active",
  "trigger_type": "cron",
  "parent_schedule_id": null,
  "dependency_condition": null,
  "delay_minutes": 0,
  "last_run_time": null,
  "next_run_time": "2026-06-10T09:00:00.000Z",
  "execution_count": 0,
  "failure_count": 0,
  "last_error_message": null
}
```

### 7.2 Tool Error Payload

Errors should be structured:

```json
{
  "success": false,
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Google Maps task 48 was not found"
  }
}
```

Suggested error codes:

- `VALIDATION_FAILED`
- `SCHEDULE_NOT_FOUND`
- `TASK_NOT_FOUND`
- `INVALID_CRON`
- `DEPENDENCY_CONFLICT`
- `SCHEDULER_SYNC_FAILED`
- `EXECUTION_FAILED`

---

## 8. Security and Permission Requirements

### SR-1: Confirmation for Side Effects

All schedule write tools require user confirmation because schedule changes can trigger automation later.

### SR-2: No Direct Database Access from Registry

`skillsRegistry.ts` must not instantiate TypeORM repositories or write database rows directly.

### SR-3: No Worker Database Access

No worker process should be introduced for this feature. If future worker behavior is added, it must communicate with main process via IPC for all database operations.

### SR-4: Safe Data Exposure

Schedule skill responses must not expose credentials, account tokens, email service passwords, browser cookies, or raw task payloads.

---

## 9. Non-Functional Requirements

### Reliability

- Scheduler state must match database state after successful mutations.
- Tool calls should return structured errors rather than uncaught exceptions.
- Delete and update operations should be idempotent where possible.

### Maintainability

- Business logic belongs in `ScheduleAiTools.ts`, not in registry definitions.
- Existing `ScheduleTaskModule`, `ScheduleManager`, and `ScheduleExecutionLogModule` APIs should be reused.
- New code must use explicit TypeScript types and avoid `any`.

### Performance

- Read tools should support pagination.
- Mutation tools should perform only necessary lookups.
- Scheduler synchronization should not reload all schedules unless targeted sync fails.

---

## 10. Rollout Plan

### Phase 1: Read and Inspect

- Add `list_schedules`.
- Add `get_schedule_details`.
- Add `list_schedule_executions`.
- Validate safe response payload shape.

### Phase 2: Safe Mutations

- Add `create_schedule`, `update_schedule`, `delete_schedule`.
- Add referenced task validation.
- Add targeted `ScheduleManager` synchronization after mutations.

### Phase 3: Operational Controls

- Add `pause_schedule`, `resume_schedule`, and `run_schedule_now`.
- Verify execution logging and scheduler state behavior.

### Phase 4: Hardening

- Add focused unit tests.
- Add integration tests around scheduler sync.
- Add optional schedule mutation audit events if product needs a dedicated audit trail.

---

## 11. Test Requirements

### Unit Tests

- Argument validation for each tool.
- Safe payload mapping.
- Task reference validation for each supported `TaskType`.
- Error mapping for missing schedules, missing tasks, invalid cron expressions, and dependency conflicts.

### Integration Tests

- Creating an active cron schedule registers a cron job.
- Updating cron expression refreshes the cron job.
- Deleting a schedule removes the cron job.
- Pausing removes the cron job.
- Resuming re-adds the cron job when applicable.
- Child schedule deletion protection still works.

### Manual QA

- Ask AI to list schedules.
- Ask AI to create an inactive schedule for an existing task.
- Ask AI to create an active schedule and verify confirmation appears.
- Ask AI to update the cron expression and verify `next_run_time` changes.
- Ask AI to delete a schedule with no children.
- Ask AI to delete a schedule with children and verify rejection.

---

## 12. Open Questions

1. Should v1 expose dependency schedule creation through a separate `create_schedule_dependency` tool instead of overloading `create_schedule`?
2. Should schedule mutation audit events get a dedicated database table, or is skill execution audit enough for v1?
3. Should `run_schedule_now` block until execution finishes, or return immediately after starting execution if long-running tasks are common?

---

## 13. Success Metrics

- AI can successfully list and inspect schedules.
- At least 95% of valid AI-created schedule requests succeed after user confirmation.
- Zero known cases where database schedule state and `ScheduleManager` runtime state diverge after a successful tool call.
- No schedule write operation runs without explicit user confirmation.
- No schedule tool creates a schedule for a missing task record.
