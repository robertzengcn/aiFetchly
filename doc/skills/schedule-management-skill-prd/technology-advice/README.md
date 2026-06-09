# Technology Advice: AI Schedule Management Built-In Skill

This document gives implementation-focused advice for the AI schedule management built-in skill described in the PRD. It is aligned with aiFetchly's Electron main-process architecture, TypeScript module boundaries, and existing scheduler implementation.

---

## 1. Architecture Fit

Keep schedule AI tools in the Electron main process. The AI server should request tool calls through the existing AI chat skill execution path, but the desktop app remains authoritative for validation, database writes, scheduler synchronization, and execution.

Recommended files:

- `src/service/ScheduleAiTools.ts` for tool implementation logic.
- `src/config/skillsRegistry.ts` for built-in skill schemas and lightweight execute wrappers.
- Existing `src/modules/ScheduleTaskModule.ts` for schedule CRUD.
- Existing `src/modules/ScheduleManager.ts` for in-memory cron job synchronization and immediate execution.
- Existing `src/modules/ScheduleExecutionLogModule.ts` for schedule execution history.

Do not add schedule CRUD logic directly to `skillsRegistry.ts`. The registry is already large and should remain a declaration/dispatch layer.

---

## 2. Recommended Service Split

Create `ScheduleAiTools.ts` as a collection of exported functions rather than a large stateful singleton.

Recommended public functions:

- `listSchedulesForAi(args)`
- `getScheduleDetailsForAi(args)`
- `listScheduleExecutionsForAi(args)`
- `createScheduleForAi(args)`
- `updateScheduleForAi(args)`
- `deleteScheduleForAi(args)`
- `pauseScheduleForAi(args)`
- `resumeScheduleForAi(args)`
- `runScheduleNowForAi(args)`

Internal helpers:

- `parsePagination(args)`
- `parseSort(args)`
- `safeSchedulePayload(schedule)`
- `safeExecutionPayload(execution)`
- `validateTaskReference(taskType, taskId)`
- `normalizeCreateInput(args)`
- `normalizeUpdateInput(args)`
- `toToolSuccess(result)`
- `toToolFailure(error)`

### Why

- Keeps all AI-facing schedule behavior testable without loading the full registry.
- Keeps scheduler side effects close to validation and persistence.
- Avoids a second database access path.

---

## 3. Registry Integration

Register each schedule tool in `BUILT_IN_SKILLS` in `src/config/skillsRegistry.ts`.

Read tools:

- `requiresConfirmation: false`
- `permissionCategory: "automation"`

Write tools:

- `requiresConfirmation: true`
- `permissionCategory: "automation"`

The registry execute handlers should be thin:

```ts
execute: async (args) => {
  const result = await createScheduleForAi(args);
  return {
    success: result.success,
    result: result as unknown as Record<string, unknown>,
  };
}
```

Avoid dynamic imports unless they are needed to break a circular dependency. Existing built-in tools use both direct service imports and dynamic module imports; for this feature, direct imports from `ScheduleAiTools.ts` are clearer.

---

## 4. Runtime Data Flow

### 4.1 Create Active Cron Schedule

1. AI proposes `create_schedule` tool call.
2. Permission flow asks user to confirm.
3. `ScheduleAiTools.createScheduleForAi()` validates arguments.
4. `validateTaskReference(task_type, task_id)` confirms the target task exists.
5. `ScheduleTaskModule.createSchedule()` persists the row.
6. The service reloads the saved schedule with `getScheduleById(id)`.
7. If `schedule.is_active` and `schedule.trigger_type === TriggerType.CRON`, call `ScheduleManager.getInstance().addSchedule(schedule)`.
8. Return a safe schedule payload.

### 4.2 Update Schedule

1. Load current schedule first.
2. Validate patch fields.
3. If final `task_type` or final `task_id` changes, validate the final task reference.
4. Call `ScheduleTaskModule.updateSchedule(id, update)`.
5. Reload updated schedule.
6. Call `ScheduleManager.getInstance().updateSchedule(updatedSchedule)`.
7. Return safe payload.

### 4.3 Delete Schedule

Preferred order:

1. Load schedule; fail if missing.
2. Call `ScheduleManager.getInstance().removeSchedule(scheduleId)` so no stale cron job remains.
3. Call `ScheduleTaskModule.deleteSchedule(scheduleId)`.
4. If delete fails because child schedules exist, consider re-adding the loaded schedule to the manager when it was an active cron schedule.

This rollback-like re-add protects runtime state when database deletion is rejected after the cron job was removed.

### 4.4 Pause and Resume

Use `ScheduleManager.pauseSchedule(scheduleId)` and `ScheduleManager.resumeSchedule(scheduleId)` instead of calling `ScheduleTaskModule` directly. Those manager methods already update database status and runtime jobs together.

### 4.5 Run Now

Use `ScheduleManager.executeSchedule(scheduleId)`. It already:

- loads the schedule
- checks active state
- logs execution start
- calls `TaskExecutorService`
- updates execution status and schedule statistics
- triggers dependent jobs

Do not duplicate execution logging in `ScheduleAiTools.ts`.

---

## 5. Type Design

Define AI tool argument and result types in `ScheduleAiTools.ts` or a dedicated file such as `src/entityTypes/schedule-ai-tool-types.ts`.

Suggested result shape:

```ts
export interface ScheduleToolSuccess<T> {
  success: true;
  data: T;
}

export interface ScheduleToolFailure {
  success: false;
  error: {
    code: ScheduleToolErrorCode;
    message: string;
  };
}

export type ScheduleToolResult<T> =
  | ScheduleToolSuccess<T>
  | ScheduleToolFailure;
```

Suggested error code enum:

```ts
export enum ScheduleToolErrorCode {
  VALIDATION_FAILED = "VALIDATION_FAILED",
  SCHEDULE_NOT_FOUND = "SCHEDULE_NOT_FOUND",
  TASK_NOT_FOUND = "TASK_NOT_FOUND",
  INVALID_CRON = "INVALID_CRON",
  DEPENDENCY_CONFLICT = "DEPENDENCY_CONFLICT",
  SCHEDULER_SYNC_FAILED = "SCHEDULER_SYNC_FAILED",
  EXECUTION_FAILED = "EXECUTION_FAILED",
}
```

Use `unknown` at the boundary for raw registry args, then normalize into typed request objects. Avoid `any`.

---

## 6. Input Validation Strategy

Use one of these two approaches:

1. Prefer existing local validation style if the repo already validates tool args manually.
2. Use `zod` if it is already available in the project dependency graph for AI tools.

Recommended validation rules:

- `page`: integer, minimum `0`, default `0`.
- `size`: integer, `1..100`, default `20`.
- `schedule_id`: positive integer.
- `task_id`: positive integer.
- `task_type`: one of `TaskType` enum values.
- `trigger_type`: one of `TriggerType` enum values.
- `status`: one of `ScheduleStatus` enum values.
- `dependency_condition`: one of `DependencyCondition` enum values.
- `delay_minutes`: integer `0..1440` for AI-created schedules.
- `name`: non-empty string, max `255`.
- `description`: max `1000`.

Let `ScheduleTaskModule.validateSchedule()` remain the final domain validator, but do not rely on it as the only AI boundary. The AI service should reject malformed tool arguments before calling modules.

---

## 7. Task Reference Validation

Before creating a schedule or changing `task_type`/`task_id`, confirm the referenced task exists.

Recommended implementation:

```ts
async function validateTaskReference(
  taskType: TaskType,
  taskId: number
): Promise<void> {
  switch (taskType) {
    case TaskType.SEARCH:
      if (!(await new SearchTaskModule().read(taskId))) throwTaskNotFound();
      return;
    case TaskType.EMAIL_EXTRACT:
      if (!(await new EmailSearchTaskModule().getTaskDetail(taskId))) throwTaskNotFound();
      return;
    case TaskType.BUCK_EMAIL:
      if (!(await new BuckEmailTaskModule().read(taskId))) throwTaskNotFound();
      return;
    case TaskType.GOOGLE_MAPS:
      if (!(await new GoogleMapsModule().getSearchRecord(taskId))) throwTaskNotFound();
      return;
    case TaskType.YANDEX_MAPS:
      if (!(await new YandexMapsModule().getSearchRecord(taskId))) throwTaskNotFound();
      return;
    case TaskType.YELLOW_PAGES:
      // Add or reuse a YellowPagesModule read/detail method.
      return;
  }
}
```

Yellow Pages needs special attention. `YellowPagesModule` already supports task execution, but if it lacks a direct read/detail method for task existence, add a small module method for lookup instead of validating through a model in the AI service.

---

## 8. Scheduler Synchronization Rules

`ScheduleManager` owns runtime cron jobs. Database writes alone are insufficient.

Rules:

- Create active cron schedule -> `addSchedule(schedule)`.
- Create inactive schedule -> no manager action needed.
- Update any schedule -> `updateSchedule(updatedSchedule)` after successful persistence.
- Delete schedule -> `removeSchedule(scheduleId)`.
- Pause schedule -> `ScheduleManager.pauseSchedule(scheduleId)`.
- Resume schedule -> `ScheduleManager.resumeSchedule(scheduleId)`.
- Run now -> `ScheduleManager.executeSchedule(scheduleId)`.

If manager sync fails after persistence, return `SCHEDULER_SYNC_FAILED` with the schedule payload and a clear warning that the database mutation succeeded but runtime sync failed. Do not silently report full success.

---

## 9. Safe Payload Mapping

Never return raw task records or credentials through schedule tools.

Safe schedule fields:

- `id`
- `name`
- `description`
- `task_type`
- `task_id`
- `cron_expression`
- `is_active`
- `status`
- `trigger_type`
- `parent_schedule_id`
- `dependency_condition`
- `delay_minutes`
- `last_run_time`
- `next_run_time`
- `execution_count`
- `failure_count`
- `last_error_message`

Safe execution fields:

- `id`
- `schedule_id`
- `status`
- `message`
- `duration`
- `parent_execution_id`
- `triggered_by`
- `task_output_id`
- `createdAt`
- `updatedAt`

Serialize `Date` values to ISO strings at the service boundary so renderer and AI output are predictable.

---

## 10. Permission and AI Enablement

The AI chat IPC handlers already include `USER_AI_ENABLED` checks. Keep that gate before skill execution. Do not add a second product-plan decision layer inside each schedule service function unless the skill execution path can bypass the IPC gate.

Write tools must require confirmation. The existing permission prompt machinery should be reused; do not implement a separate confirmation flow for schedules.

Confirmation copy should include:

- operation name
- schedule name or ID
- target task type and ID for create/update
- cron expression and active state for create/update
- warning when the operation can trigger future automation

---

## 11. Dependency Handling

The current schedule table includes legacy dependency fields (`parent_schedule_id`, `dependency_condition`, `delay_minutes`), while `ScheduleDependencyModule` also manages explicit dependency rows.

For v1, keep dependency support conservative:

- Allow basic dependency fields only if existing schedule UI/API already uses them.
- Prefer a separate future dependency tool if complex graph editing is needed.
- If explicit dependency creation is required, call `ScheduleManager.addDependency()` or `ScheduleDependencyModule.createDependency()` through a dedicated confirmed tool.

Do not mix implicit parent fields and explicit dependency rows in one AI call unless the existing product model requires both.

---

## 12. Error Handling

Convert known failures to structured tool errors.

Recommended mappings:

- Missing schedule -> `SCHEDULE_NOT_FOUND`
- Missing target task -> `TASK_NOT_FOUND`
- `Schedule validation failed` -> `VALIDATION_FAILED`
- Invalid cron -> `INVALID_CRON`
- Child schedules prevent deletion -> `DEPENDENCY_CONFLICT`
- Circular dependency -> `DEPENDENCY_CONFLICT`
- `ScheduleManager` add/update/remove failure -> `SCHEDULER_SYNC_FAILED`
- Immediate execution failure -> `EXECUTION_FAILED`

Raw exceptions should be logged locally but returned to AI as sanitized messages.

---

## 13. Testing Strategy

### Unit Tests

Test `ScheduleAiTools.ts` with mocked modules/managers:

- argument parsing rejects malformed IDs and enum values
- pagination bounds are enforced
- safe schedule payload omits unsafe fields
- missing schedule maps to `SCHEDULE_NOT_FOUND`
- missing task maps to `TASK_NOT_FOUND`
- create defaults `is_active` to `false`
- update validates final task reference when task fields change

### Integration Tests

Use real schedule modules against a test database when practical:

- create active cron schedule registers manager job
- update cron expression refreshes manager job
- delete schedule removes manager job
- pause removes manager job
- resume re-adds active cron job
- child schedule prevents deletion
- run now writes execution logs

### Registry Tests

- schedule read skills are registered and do not require confirmation
- schedule write skills are registered and require confirmation
- tool schemas expose expected required fields and enum values

---

## 14. Rollout Recommendation

Ship in three narrow changes:

1. Read-only tools and safe payload mapping.
2. Create/update/delete tools with confirmation and scheduler sync.
3. Pause/resume/run-now tools plus integration coverage.

This order keeps the first release useful while limiting side-effect risk during initial testing.

---

## 15. Implementation Watchouts

- Do not call `ScheduleTaskModel` directly from `ScheduleAiTools.ts`.
- Do not use `app.getPath("userData")` for database path resolution.
- Do not add schedule worker files under `src/modules/`.
- Do not return raw task payloads.
- Do not report success if persistence succeeded but scheduler sync failed.
- Be careful with delete ordering; if deletion fails after `removeSchedule`, re-add the active cron job.
- Use explicit return types on all new functions.
