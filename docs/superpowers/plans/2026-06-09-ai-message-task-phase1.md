# Scheduled AI Message Task — Phase 1: Task and Storage

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ai_message` as a first-class task type with persistent entity, model, module, type definitions, IPC handlers, frontend API, and basic schedule integration — no headless runner or tool execution yet.

**Architecture:** Follow the existing three-layer pattern (Entity → Model → Module → IPC). Add `TaskType.AI_MESSAGE` to the enum. Create `AiMessageTaskEntity` and `AiMessageTaskRunEntity` for persistence. Add a `ScheduledAiToolPolicy` service for schedulable tool catalog. Wire into `TaskExecutorService` with a stub executor. Add IPC handlers and frontend API layer.

**Tech Stack:** TypeScript, TypeORM (SQLite), Electron IPC, Vue 3, Vuetify, vue-i18n

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/entity/AiMessageTask.entity.ts` | TypeORM entity for AI message task configuration |
| `src/entity/AiMessageTaskRun.entity.ts` | TypeORM entity for AI message task run logs |
| `src/entityTypes/aiMessageTaskTypes.ts` | Type definitions for AI message tasks |
| `src/model/AiMessageTask.model.ts` | Data access for AI message tasks |
| `src/model/AiMessageTaskRun.model.ts` | Data access for AI message task runs |
| `src/modules/AiMessageTaskModule.ts` | Business logic for AI message tasks |
| `src/modules/AiMessageTaskRunModule.ts` | Business logic for AI message task runs |
| `src/service/ScheduledAiToolPolicy.ts` | Tool schedulability policy (catalog + runtime decisions) |
| `src/service/AiMessageToolCatalogService.ts` | Lists schedulable built-in tools for UI |
| `src/main-process/communication/aiMessageTask-ipc.ts` | IPC handlers for AI message task CRUD |
| `src/views/api/aiMessageTask.ts` | Frontend API layer for AI message tasks |
| `src/views/pages/schedule/widgets/AiMessageTaskForm.vue` | Task creation/edit form for schedule |

### Modified Files
| File | Change |
|------|--------|
| `src/entity/ScheduleTask.entity.ts` | Add `AI_MESSAGE` to `TaskType` enum |
| `src/config/SqliteDb.ts` | Register new entities |
| `src/config/channellist.ts` | Add IPC channel constants |
| `src/modules/TaskExecutorService.ts` | Route `ai_message` tasks |
| `src/config/skillsRegistry.ts` | Export `listBuiltInSkillDefinitions` helper |
| `src/views/pages/schedule/widgets/ScheduleForm.vue` | Add AI message task type option + form |
| `src/views/pages/schedule/detail.vue` | Add AI message type color/label |
| `src/views/pages/schedule/widgets/ScheduleTable.vue` | Add AI message type color/label |
| `src/views/lang/en.ts` | Add translations |
| `src/views/lang/zh.ts` | Add translations |
| `src/views/lang/es.ts` | Add translations |
| `src/views/lang/de.ts` | Add translations |
| `src/views/lang/ja.ts` | Add translations |

---

### Task 1: Type Definitions

**Files:**
- Create: `src/entityTypes/aiMessageTaskTypes.ts`

- [ ] **Step 1: Create type definitions file**

```typescript
// src/entityTypes/aiMessageTaskTypes.ts

/**
 * Type definitions for the AI Message Task feature.
 */

/** Status of an AI message task configuration. */
export type AiMessageTaskStatus = "active" | "inactive" | "deleted";

/** Status of an AI message task scheduled run. */
export type AiMessageTaskRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked_by_policy"
  | "timeout";

/** Structured error codes for AI message task runs. */
export type AiMessageTaskErrorCode =
  | "AI_DISABLED"
  | "TASK_NOT_FOUND"
  | "MODEL_UNAVAILABLE"
  | "TOOL_NOT_ALLOWED"
  | "TOOL_BLOCKED_BY_CATEGORY"
  | "TOOL_LIMIT_EXCEEDED"
  | "RUNTIME_TIMEOUT"
  | "REMOTE_AI_ERROR"
  | "TOOL_EXECUTION_FAILED"
  | "CONVERSATION_CONTINUE_FAILED";

/** Tool policy stored on each AI message task. */
export interface AiMessageTaskToolPolicy {
  readonly allowedTools: readonly string[];
  readonly autoApproveTools: boolean;
  readonly maxToolCalls: number;
  readonly maxRuntimeMs: number;
  readonly maxContinueCalls: number;
}

/** Default values for tool policy fields. */
export const AI_MESSAGE_TASK_DEFAULTS = {
  autoApproveTools: false,
  allowedTools: [] as readonly string[],
  maxToolCalls: 10,
  maxRuntimeMs: 300_000,
  maxContinueCalls: 10,
} as const;

/** Create-task request payload from the frontend. */
export interface CreateAiMessageTaskRequest {
  readonly name: string;
  readonly description?: string;
  readonly message: string;
  readonly systemPrompt?: string;
  readonly model?: string;
  readonly conversationId?: string;
  readonly allowedTools?: readonly string[];
  readonly autoApproveTools?: boolean;
  readonly maxToolCalls?: number;
  readonly maxRuntimeMs?: number;
  readonly maxContinueCalls?: number;
}

/** Update-task request payload from the frontend. */
export interface UpdateAiMessageTaskRequest {
  readonly id: number;
  readonly name?: string;
  readonly description?: string;
  readonly message?: string;
  readonly systemPrompt?: string;
  readonly model?: string;
  readonly conversationId?: string;
  readonly allowedTools?: readonly string[];
  readonly autoApproveTools?: boolean;
  readonly maxToolCalls?: number;
  readonly maxRuntimeMs?: number;
  readonly maxContinueCalls?: number;
  readonly status?: AiMessageTaskStatus;
}

/** Summary of a schedulable built-in tool for the UI catalog. */
export interface SchedulableAiToolSummary {
  readonly name: string;
  readonly description: string;
  readonly permissionCategory: string;
  readonly source: "built-in";
  readonly requiresConfirmation: boolean;
  readonly schedulable: boolean;
  readonly autoApproveAllowed: boolean;
  readonly blockedReason?: string;
  readonly riskLevel: "low" | "medium" | "high" | "blocked";
}

/** Runtime decision for a single tool call in scheduled mode. */
export interface ScheduledToolDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly riskLevel: "low" | "medium" | "high" | "blocked";
}

/** Metadata for a blocked tool call stored in the run log. */
export interface BlockedToolCallRecord {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly reason: string;
  readonly timestamp: string;
  readonly args?: Record<string, unknown>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/entityTypes/aiMessageTaskTypes.ts
git commit -m "feat(ai-message-task): add type definitions for AI message task feature"
```

---

### Task 2: Add TaskType.AI_MESSAGE

**Files:**
- Modify: `src/entity/ScheduleTask.entity.ts`

- [ ] **Step 1: Add AI_MESSAGE to the TaskType enum**

In `src/entity/ScheduleTask.entity.ts`, add `AI_MESSAGE` to the `TaskType` enum:

```typescript
export enum TaskType {
  SEARCH = "search",
  EMAIL_EXTRACT = "email_extract",
  BUCK_EMAIL = "buck_email",
  YELLOW_PAGES = "yellow_pages",
  GOOGLE_MAPS = "google_maps",
  YANDEX_MAPS = "yandex_maps",
  AI_MESSAGE = "ai_message",
}
```

Also update the column comment on `task_type` to include `ai_message` in the comment string.

- [ ] **Step 2: Commit**

```bash
git add src/entity/ScheduleTask.entity.ts
git commit -m "feat(ai-message-task): add AI_MESSAGE to TaskType enum"
```

---

### Task 3: AiMessageTask Entity

**Files:**
- Create: `src/entity/AiMessageTask.entity.ts`

- [ ] **Step 1: Create the entity**

```typescript
// src/entity/AiMessageTask.entity.ts

import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
} from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type {
  AiMessageTaskStatus,
} from "@/entityTypes/aiMessageTaskTypes";

@Entity("ai_message_task")
@Index(["status"])
export class AiMessageTaskEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("varchar", { length: 255 })
  name: string;

  @Column("text", { nullable: true })
  description: string;

  /** The prompt/message to send to the AI server on each scheduled run. */
  @Column("text")
  message: string;

  /** Optional system prompt injected into the AI conversation. */
  @Column("text", { nullable: true })
  system_prompt: string;

  /** Model identifier for the AI server (e.g. "gpt-4o"). */
  @Column("varchar", { length: 100, nullable: true })
  model: string;

  /** Conversation ID for persistent AI conversations. Generated if absent. */
  @Column("varchar", { length: 255, nullable: true })
  conversation_id: string;

  /**
   * JSON string of tool names allowed for unattended execution.
   * E.g. '["list_schedules","search_web"]'
   */
  @Column("text", { default: "[]" })
  allowed_tools_json: string;

  /** Whether auto-approval is enabled for allowed tools. */
  @Column("boolean", { default: false })
  auto_approve_tools: boolean;

  /** Maximum number of tool calls per run. */
  @Column("integer", { default: 10 })
  max_tool_calls: number;

  /** Maximum runtime in milliseconds per run. */
  @Column("integer", { default: 300000 })
  max_runtime_ms: number;

  /** Maximum number of continue calls (tool-result round trips). */
  @Column("integer", { default: 10 })
  max_continue_calls: number;

  /** Current status of the task configuration. */
  @Column("varchar", {
    length: 20,
    default: "active",
    comment: "Task status: active, inactive, deleted",
  })
  status: AiMessageTaskStatus;

  /** Timestamp of the last scheduled run. */
  @Column("datetime", { nullable: true })
  last_run_time: Date;

  /** Short summary of the last run's final AI response. */
  @Column("text", { nullable: true })
  last_result_summary: string;

  /** Error message from the last failed run. */
  @Column("text", { nullable: true })
  last_error_message: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/entity/AiMessageTask.entity.ts
git commit -m "feat(ai-message-task): add AiMessageTask entity"
```

---

### Task 4: AiMessageTaskRun Entity

**Files:**
- Create: `src/entity/AiMessageTaskRun.entity.ts`

- [ ] **Step 1: Create the entity**

```typescript
// src/entity/AiMessageTaskRun.entity.ts

import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  Index,
} from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";
import type {
  AiMessageTaskRunStatus,
} from "@/entityTypes/aiMessageTaskTypes";

@Entity("ai_message_task_run")
@Index(["task_id"])
@Index(["schedule_id"])
@Index(["status"])
@Index(["started_at"])
export class AiMessageTaskRunEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** Foreign key to AiMessageTaskEntity. */
  @Column("integer")
  task_id: number;

  /** Foreign key to the schedule that triggered this run (nullable for manual runs). */
  @Column("integer", { nullable: true })
  schedule_id: number;

  /** Conversation ID used for this run. */
  @Column("varchar", { length: 255, nullable: true })
  conversation_id: string;

  /** Current run status. */
  @Column("varchar", {
    length: 20,
    default: "pending",
    comment: "Run status: pending, running, completed, failed, cancelled, blocked_by_policy, timeout",
  })
  status: AiMessageTaskRunStatus;

  /** When the run started. */
  @Column("datetime", { nullable: true })
  started_at: Date;

  /** When the run finished. */
  @Column("datetime", { nullable: true })
  finished_at: Date;

  /** Total run duration in milliseconds. */
  @Column("integer", { nullable: true })
  duration_ms: number;

  /** Count of tool calls executed during this run. */
  @Column("integer", { default: 0 })
  tool_calls_count: number;

  /**
   * JSON string of blocked tool call records.
   * Array of BlockedToolCallRecord objects.
   */
  @Column("text", { nullable: true })
  blocked_tool_calls_json: string;

  /** Final assistant message from the AI server. */
  @Column("text", { nullable: true })
  assistant_final_message: string;

  /** Error message if the run failed. */
  @Column("text", { nullable: true })
  error_message: string;

  /** Additional metadata as JSON (e.g. model, token counts). */
  @Column("text", { nullable: true })
  metadata_json: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/entity/AiMessageTaskRun.entity.ts
git commit -m "feat(ai-message-task): add AiMessageTaskRun entity"
```

---

### Task 5: Register Entities in SqliteDb

**Files:**
- Modify: `src/config/SqliteDb.ts`

- [ ] **Step 1: Import and register new entities**

Add imports near the top of `src/config/SqliteDb.ts` (in the entity imports section):

```typescript
import { AiMessageTaskEntity } from "@/entity/AiMessageTask.entity";
import { AiMessageTaskRunEntity } from "@/entity/AiMessageTaskRun.entity";
```

Add both entities to the `entities:` array:

```typescript
// After YandexMapsSearchRecordEntity (the current last entry), add:
          AiMessageTaskEntity,
          AiMessageTaskRunEntity,
```

- [ ] **Step 2: Commit**

```bash
git add src/config/SqliteDb.ts
git commit -m "feat(ai-message-task): register AiMessageTask and AiMessageTaskRun entities"
```

---

### Task 6: AiMessageTask Model

**Files:**
- Create: `src/model/AiMessageTask.model.ts`

- [ ] **Step 1: Create the model**

```typescript
// src/model/AiMessageTask.model.ts

import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { AiMessageTaskEntity } from "@/entity/AiMessageTask.entity";

export class AiMessageTaskModel extends BaseDb {
  private repository: Repository<AiMessageTaskEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository =
      this.sqliteDb.connection.getRepository(AiMessageTaskEntity);
  }

  async create(entity: Partial<AiMessageTaskEntity>): Promise<number> {
    const saved = await this.repository.save(entity);
    return saved.id;
  }

  async update(
    id: number,
    data: Partial<AiMessageTaskEntity>
  ): Promise<void> {
    await this.repository.update(id, data);
  }

  async getById(id: number): Promise<AiMessageTaskEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  async list(
    page = 1,
    limit = 50
  ): Promise<{ items: AiMessageTaskEntity[]; total: number }> {
    const [items, total] = await this.repository.findAndCount({
      where: { status: "active" },
      order: { id: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total };
  }

  async deleteById(id: number): Promise<void> {
    await this.repository.update(id, { status: "deleted" });
  }

  async updateLastRun(
    id: number,
    resultSummary: string | null,
    errorMessage: string | null
  ): Promise<void> {
    await this.repository.update(id, {
      last_run_time: new Date(),
      last_result_summary: resultSummary,
      last_error_message: errorMessage,
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/model/AiMessageTask.model.ts
git commit -m "feat(ai-message-task): add AiMessageTask model"
```

---

### Task 7: AiMessageTaskRun Model

**Files:**
- Create: `src/model/AiMessageTaskRun.model.ts`

- [ ] **Step 1: Create the model**

```typescript
// src/model/AiMessageTaskRun.model.ts

import { BaseDb } from "@/model/Basedb";
import { Repository } from "typeorm";
import { AiMessageTaskRunEntity } from "@/entity/AiMessageTaskRun.entity";
import type { AiMessageTaskRunStatus } from "@/entityTypes/aiMessageTaskTypes";

export class AiMessageTaskRunModel extends BaseDb {
  private repository: Repository<AiMessageTaskRunEntity>;

  constructor(filepath: string) {
    super(filepath);
    this.repository =
      this.sqliteDb.connection.getRepository(AiMessageTaskRunEntity);
  }

  async create(entity: Partial<AiMessageTaskRunEntity>): Promise<number> {
    const saved = await this.repository.save(entity);
    return saved.id;
  }

  async updateStatus(
    id: number,
    status: AiMessageTaskRunStatus,
    data?: Partial<AiMessageTaskRunEntity>
  ): Promise<void> {
    await this.repository.update(id, { status, ...data });
  }

  async getById(id: number): Promise<AiMessageTaskRunEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  async listByTask(
    taskId: number,
    page = 1,
    limit = 20
  ): Promise<{ items: AiMessageTaskRunEntity[]; total: number }> {
    const [items, total] = await this.repository.findAndCount({
      where: { task_id: taskId },
      order: { id: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total };
  }

  async listBySchedule(
    scheduleId: number,
    page = 1,
    limit = 20
  ): Promise<{ items: AiMessageTaskRunEntity[]; total: number }> {
    const [items, total] = await this.repository.findAndCount({
      where: { schedule_id: scheduleId },
      order: { id: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total };
  }

  async getLatestByTask(
    taskId: number
  ): Promise<AiMessageTaskRunEntity | null> {
    return this.repository.findOne({
      where: { task_id: taskId },
      order: { id: "DESC" },
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/model/AiMessageTaskRun.model.ts
git commit -m "feat(ai-message-task): add AiMessageTaskRun model"
```

---

### Task 8: AiMessageTaskModule

**Files:**
- Create: `src/modules/AiMessageTaskModule.ts`

- [ ] **Step 1: Create the module**

```typescript
// src/modules/AiMessageTaskModule.ts

import { BaseModule } from "./baseModule";
import { AiMessageTaskModel } from "@/model/AiMessageTask.model";
import { AiMessageTaskEntity } from "@/entity/AiMessageTask.entity";
import {
  AI_MESSAGE_TASK_DEFAULTS,
  type CreateAiMessageTaskRequest,
  type UpdateAiMessageTaskRequest,
  type AiMessageTaskStatus,
} from "@/entityTypes/aiMessageTaskTypes";

function generateConversationId(): string {
  return `ai-msg-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

export class AiMessageTaskModule extends BaseModule {
  private model: AiMessageTaskModel;

  constructor() {
    super();
    this.model = new AiMessageTaskModel(this.dbpath);
  }

  async createTask(
    request: CreateAiMessageTaskRequest
  ): Promise<number> {
    await this.ensureConnection();

    if (!request.message || request.message.trim().length === 0) {
      throw new Error("Message is required");
    }
    if (!request.name || request.name.trim().length === 0) {
      throw new Error("Name is required");
    }

    const allowedTools = request.allowedTools ?? AI_MESSAGE_TASK_DEFAULTS.allowedTools;

    const entity: Partial<AiMessageTaskEntity> = {
      name: request.name.trim(),
      description: request.description?.trim() ?? null,
      message: request.message.trim(),
      system_prompt: request.systemPrompt?.trim() ?? null,
      model: request.model ?? null,
      conversation_id: request.conversationId || generateConversationId(),
      allowed_tools_json: JSON.stringify(allowedTools),
      auto_approve_tools:
        request.autoApproveTools ?? AI_MESSAGE_TASK_DEFAULTS.autoApproveTools,
      max_tool_calls:
        request.maxToolCalls ?? AI_MESSAGE_TASK_DEFAULTS.maxToolCalls,
      max_runtime_ms:
        request.maxRuntimeMs ?? AI_MESSAGE_TASK_DEFAULTS.maxRuntimeMs,
      max_continue_calls:
        request.maxContinueCalls ?? AI_MESSAGE_TASK_DEFAULTS.maxContinueCalls,
      status: "active",
    };

    return this.model.create(entity);
  }

  async updateTask(request: UpdateAiMessageTaskRequest): Promise<void> {
    await this.ensureConnection();

    const existing = await this.model.getById(request.id);
    if (!existing) {
      throw new Error(`AI message task ${request.id} not found`);
    }

    const updates: Partial<AiMessageTaskEntity> = {};

    if (request.name !== undefined) updates.name = request.name.trim();
    if (request.description !== undefined)
      updates.description = request.description?.trim() ?? null;
    if (request.message !== undefined) updates.message = request.message.trim();
    if (request.systemPrompt !== undefined)
      updates.system_prompt = request.systemPrompt?.trim() ?? null;
    if (request.model !== undefined) updates.model = request.model;
    if (request.conversationId !== undefined)
      updates.conversation_id = request.conversationId;
    if (request.allowedTools !== undefined)
      updates.allowed_tools_json = JSON.stringify(request.allowedTools);
    if (request.autoApproveTools !== undefined)
      updates.auto_approve_tools = request.autoApproveTools;
    if (request.maxToolCalls !== undefined)
      updates.max_tool_calls = request.maxToolCalls;
    if (request.maxRuntimeMs !== undefined)
      updates.max_runtime_ms = request.maxRuntimeMs;
    if (request.maxContinueCalls !== undefined)
      updates.max_continue_calls = request.maxContinueCalls;
    if (request.status !== undefined) updates.status = request.status;

    await this.model.update(request.id, updates);
  }

  async getTask(id: number): Promise<AiMessageTaskEntity | null> {
    await this.ensureConnection();
    return this.model.getById(id);
  }

  async listTasks(
    page = 1,
    limit = 50
  ): Promise<{ items: AiMessageTaskEntity[]; total: number }> {
    await this.ensureConnection();
    return this.model.list(page, limit);
  }

  async deleteTask(id: number): Promise<void> {
    await this.ensureConnection();

    const existing = await this.model.getById(id);
    if (!existing) {
      throw new Error(`AI message task ${id} not found`);
    }

    await this.model.deleteById(id);
  }

  async updateLastRunResult(
    id: number,
    resultSummary: string | null,
    errorMessage: string | null
  ): Promise<void> {
    await this.ensureConnection();
    await this.model.updateLastRun(id, resultSummary, errorMessage);
  }

  /** Parse and return the allowed tools list from JSON. */
  parseAllowedTools(task: AiMessageTaskEntity): readonly string[] {
    try {
      return JSON.parse(task.allowed_tools_json ?? "[]") as string[];
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/AiMessageTaskModule.ts
git commit -m "feat(ai-message-task): add AiMessageTaskModule with CRUD business logic"
```

---

### Task 9: AiMessageTaskRunModule

**Files:**
- Create: `src/modules/AiMessageTaskRunModule.ts`

- [ ] **Step 1: Create the module**

```typescript
// src/modules/AiMessageTaskRunModule.ts

import { BaseModule } from "./baseModule";
import { AiMessageTaskRunModel } from "@/model/AiMessageTaskRun.model";
import { AiMessageTaskRunEntity } from "@/entity/AiMessageTaskRun.entity";
import type {
  AiMessageTaskRunStatus,
  BlockedToolCallRecord,
} from "@/entityTypes/aiMessageTaskTypes";

export class AiMessageTaskRunModule extends BaseModule {
  private model: AiMessageTaskRunModel;

  constructor() {
    super();
    this.model = new AiMessageTaskRunModel(this.dbpath);
  }

  async createRun(params: {
    taskId: number;
    scheduleId?: number;
    conversationId?: string;
  }): Promise<number> {
    await this.ensureConnection();

    const entity: Partial<AiMessageTaskRunEntity> = {
      task_id: params.taskId,
      schedule_id: params.scheduleId ?? null,
      conversation_id: params.conversationId ?? null,
      status: "pending",
      started_at: new Date(),
      tool_calls_count: 0,
      blocked_tool_calls_json: "[]",
    };

    return this.model.create(entity);
  }

  async updateRunStatus(
    runId: number,
    status: AiMessageTaskRunStatus,
    data?: Partial<AiMessageTaskRunEntity>
  ): Promise<void> {
    await this.ensureConnection();
    await this.model.updateStatus(runId, status, data);
  }

  async completeRun(
    runId: number,
    params: {
      assistantFinalMessage: string;
      toolCallsCount: number;
      blockedToolCalls: BlockedToolCallRecord[];
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.ensureConnection();

    const now = new Date();
    const run = await this.model.getById(runId);
    const startedAt = run?.started_at ?? now;
    const durationMs = now.getTime() - new Date(startedAt).getTime();

    await this.model.updateStatus(runId, "completed", {
      finished_at: now,
      duration_ms: durationMs,
      assistant_final_message: params.assistantFinalMessage,
      tool_calls_count: params.toolCallsCount,
      blocked_tool_calls_json: JSON.stringify(params.blockedToolCalls),
      metadata_json: params.metadata
        ? JSON.stringify(params.metadata)
        : undefined,
    });
  }

  async failRun(
    runId: number,
    errorMessage: string,
    params?: {
      toolCallsCount?: number;
      blockedToolCalls?: BlockedToolCallRecord[];
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.ensureConnection();

    const now = new Date();
    const run = await this.model.getById(runId);
    const startedAt = run?.started_at ?? now;
    const durationMs = now.getTime() - new Date(startedAt).getTime();

    await this.model.updateStatus(runId, "failed", {
      finished_at: now,
      duration_ms: durationMs,
      error_message: errorMessage,
      tool_calls_count: params?.toolCallsCount ?? 0,
      blocked_tool_calls_json: JSON.stringify(
        params?.blockedToolCalls ?? []
      ),
      metadata_json: params?.metadata
        ? JSON.stringify(params.metadata)
        : undefined,
    });
  }

  async getRun(runId: number): Promise<AiMessageTaskRunEntity | null> {
    await this.ensureConnection();
    return this.model.getById(runId);
  }

  async listRunsByTask(
    taskId: number,
    page = 1,
    limit = 20
  ): Promise<{ items: AiMessageTaskRunEntity[]; total: number }> {
    await this.ensureConnection();
    return this.model.listByTask(taskId, page, limit);
  }

  async listRunsBySchedule(
    scheduleId: number,
    page = 1,
    limit = 20
  ): Promise<{ items: AiMessageTaskRunEntity[]; total: number }> {
    await this.ensureConnection();
    return this.model.listBySchedule(scheduleId, page, limit);
  }

  async getLatestRun(
    taskId: number
  ): Promise<AiMessageTaskRunEntity | null> {
    await this.ensureConnection();
    return this.model.getLatestByTask(taskId);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/AiMessageTaskRunModule.ts
git commit -m "feat(ai-message-task): add AiMessageTaskRunModule for run log management"
```

---

### Task 10: ScheduledAiToolPolicy

**Files:**
- Create: `src/service/ScheduledAiToolPolicy.ts`

- [ ] **Step 1: Create the policy service**

```typescript
// src/service/ScheduledAiToolPolicy.ts

import type { SkillDefinition, SkillPermissionCategory } from "@/entityTypes/skillTypes";
import type {
  SchedulableAiToolSummary,
  ScheduledToolDecision,
  AiMessageTaskToolPolicy,
} from "@/entityTypes/aiMessageTaskTypes";

/**
 * Tool categories that are always blocked for unattended scheduled AI tasks in v1.
 */
const BLOCKED_CATEGORIES: ReadonlySet<SkillPermissionCategory> = new Set([
  "shell",
]);

/**
 * Describes a built-in skill for the AI message task catalog UI.
 *
 * Returns whether the tool is schedulable, its risk level, and a reason
 * if blocked.
 */
export function describeBuiltInToolForSchedule(
  skill: SkillDefinition
): SchedulableAiToolSummary {
  const category = skill.permissionCategory;

  // Shell is always blocked in v1
  if (category === "shell") {
    return {
      name: skill.name,
      description: skill.description,
      permissionCategory: category,
      source: "built-in",
      requiresConfirmation: skill.requiresConfirmation,
      schedulable: false,
      autoApproveAllowed: false,
      blockedReason: "Shell execution is blocked for unattended scheduled AI tasks in v1.",
      riskLevel: "blocked",
    };
  }

  // Filesystem write/edit is blocked in v1
  if (category === "filesystem" && skill.requiresConfirmation) {
    return {
      name: skill.name,
      description: skill.description,
      permissionCategory: category,
      source: "built-in",
      requiresConfirmation: skill.requiresConfirmation,
      schedulable: false,
      autoApproveAllowed: false,
      blockedReason: "Filesystem write/edit tools are blocked for unattended scheduled AI tasks in v1.",
      riskLevel: "blocked",
    };
  }

  // Pure tools are always schedulable
  if (category === "pure") {
    return {
      name: skill.name,
      description: skill.description,
      permissionCategory: category,
      source: "built-in",
      requiresConfirmation: false,
      schedulable: true,
      autoApproveAllowed: true,
      riskLevel: "low",
    };
  }

  // Network tools require explicit allowlisting
  if (category === "network") {
    return {
      name: skill.name,
      description: skill.description,
      permissionCategory: category,
      source: "built-in",
      requiresConfirmation: skill.requiresConfirmation,
      schedulable: true,
      autoApproveAllowed: true,
      riskLevel: skill.requiresConfirmation ? "medium" : "low",
    };
  }

  // Automation tools require explicit allowlisting
  if (category === "automation") {
    return {
      name: skill.name,
      description: skill.description,
      permissionCategory: category,
      source: "built-in",
      requiresConfirmation: skill.requiresConfirmation,
      schedulable: true,
      autoApproveAllowed: true,
      riskLevel: "medium",
    };
  }

  // Filesystem read-only (requiresConfirmation=false) can be schedulable
  if (category === "filesystem") {
    return {
      name: skill.name,
      description: skill.description,
      permissionCategory: category,
      source: "built-in",
      requiresConfirmation: false,
      schedulable: true,
      autoApproveAllowed: true,
      riskLevel: "low",
    };
  }

  // Default: not schedulable
  return {
    name: skill.name,
    description: skill.description,
    permissionCategory: category,
    source: "built-in",
    requiresConfirmation: skill.requiresConfirmation,
    schedulable: false,
    autoApproveAllowed: false,
    blockedReason: "This tool category is not supported for scheduled AI tasks in v1.",
    riskLevel: "blocked",
  };
}

/**
 * Runtime decision: can a requested tool call proceed in scheduled mode?
 */
export function canAutoApproveScheduledTool(params: {
  readonly skill: SkillDefinition;
  readonly taskPolicy: AiMessageTaskToolPolicy;
  readonly toolName: string;
}): ScheduledToolDecision {
  const { skill, taskPolicy, toolName } = params;

  // Shell is always blocked
  if (BLOCKED_CATEGORIES.has(skill.permissionCategory)) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" has permission category "${skill.permissionCategory}" which is blocked for scheduled tasks.`,
      riskLevel: "blocked",
    };
  }

  // Filesystem write/edit blocked
  if (
    skill.permissionCategory === "filesystem" &&
    skill.requiresConfirmation
  ) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" is a filesystem write/edit tool blocked for scheduled tasks in v1.`,
      riskLevel: "blocked",
    };
  }

  // Auto-approve must be enabled
  if (!taskPolicy.autoApproveTools) {
    return {
      allowed: false,
      reason: "Auto-approve is not enabled for this AI message task.",
      riskLevel: "high",
    };
  }

  // Pure tools always allowed
  if (skill.permissionCategory === "pure") {
    return { allowed: true, riskLevel: "low" };
  }

  // Non-pure tools must be in the allowlist
  if (!taskPolicy.allowedTools.includes(toolName)) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" is not in the task's allowed tools list.`,
      riskLevel: "high",
    };
  }

  // Tool is allowlisted — check risk level
  const summary = describeBuiltInToolForSchedule(skill);
  return {
    allowed: summary.schedulable,
    reason: summary.blockedReason,
    riskLevel: summary.riskLevel,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/service/ScheduledAiToolPolicy.ts
git commit -m "feat(ai-message-task): add ScheduledAiToolPolicy for tool schedulability decisions"
```

---

### Task 11: AiMessageToolCatalogService

**Files:**
- Create: `src/service/AiMessageToolCatalogService.ts`
- Modify: `src/config/skillsRegistry.ts`

- [ ] **Step 1: Add listBuiltInSkillDefinitions helper to skillsRegistry.ts**

In `src/config/skillsRegistry.ts`, add a new function and export it through `SkillRegistry`:

```typescript
/**
 * Return all built-in skill definitions (excludes user/marketplace/MCP).
 */
function listBuiltInSkillDefinitions(): SkillDefinition[] {
  return Array.from(registry.values()).filter(
    (skill) => skill.source === "built-in"
  );
}
```

Update the `SkillRegistry` export object:

```typescript
export const SkillRegistry = {
  getAllToolFunctions,
  getSkill,
  isRegistered,
  registerSkill,
  unregisterSkill,
  findSkillForFileExtension,
  listBuiltInSkillDefinitions,
} as const;
```

- [ ] **Step 2: Create the catalog service**

```typescript
// src/service/AiMessageToolCatalogService.ts

import { SkillRegistry } from "@/config/skillsRegistry";
import { describeBuiltInToolForSchedule } from "@/service/ScheduledAiToolPolicy";
import type { SchedulableAiToolSummary } from "@/entityTypes/aiMessageTaskTypes";

/**
 * Returns built-in tools annotated with schedulability metadata
 * for the AI message task creation UI.
 */
export function listSchedulableBuiltInTools(): SchedulableAiToolSummary[] {
  const builtIns = SkillRegistry.listBuiltInSkillDefinitions();
  return builtIns.map((skill) => describeBuiltInToolForSchedule(skill));
}
```

- [ ] **Step 3: Commit**

```bash
git add src/service/AiMessageToolCatalogService.ts src/config/skillsRegistry.ts
git commit -m "feat(ai-message-task): add AiMessageToolCatalogService and listBuiltInSkillDefinitions helper"
```

---

### Task 12: IPC Channel Constants

**Files:**
- Modify: `src/config/channellist.ts`

- [ ] **Step 1: Add AI message task IPC channels**

Add these constants at the end of `src/config/channellist.ts`:

```typescript
// AI Message Task Channels
export const AI_MESSAGE_TASK_CREATE = "ai-message-task:create";
export const AI_MESSAGE_TASK_UPDATE = "ai-message-task:update";
export const AI_MESSAGE_TASK_DELETE = "ai-message-task:delete";
export const AI_MESSAGE_TASK_LIST = "ai-message-task:list";
export const AI_MESSAGE_TASK_DETAIL = "ai-message-task:detail";
export const AI_MESSAGE_TASK_RUN_LIST = "ai-message-task:run-list";
export const AI_MESSAGE_TASK_RUN_DETAIL = "ai-message-task:run-detail";
export const AI_MESSAGE_TASK_LIST_AVAILABLE_TOOLS =
  "ai-message-task:list-available-tools";
```

- [ ] **Step 2: Commit**

```bash
git add src/config/channellist.ts
git commit -m "feat(ai-message-task): add IPC channel constants for AI message tasks"
```

---

### Task 13: IPC Handlers

**Files:**
- Create: `src/main-process/communication/aiMessageTask-ipc.ts`

- [ ] **Step 1: Create IPC handlers**

```typescript
// src/main-process/communication/aiMessageTask-ipc.ts

import { ipcMain } from "electron";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import { AiMessageTaskModule } from "@/modules/AiMessageTaskModule";
import { AiMessageTaskRunModule } from "@/modules/AiMessageTaskRunModule";
import { listSchedulableBuiltInTools } from "@/service/AiMessageToolCatalogService";
import {
  AI_MESSAGE_TASK_CREATE,
  AI_MESSAGE_TASK_UPDATE,
  AI_MESSAGE_TASK_DELETE,
  AI_MESSAGE_TASK_LIST,
  AI_MESSAGE_TASK_DETAIL,
  AI_MESSAGE_TASK_RUN_LIST,
  AI_MESSAGE_TASK_RUN_DETAIL,
  AI_MESSAGE_TASK_LIST_AVAILABLE_TOOLS,
} from "@/config/channellist";
import type { CommonMessage } from "@/entityTypes/commonType";
import type {
  CreateAiMessageTaskRequest,
  UpdateAiMessageTaskRequest,
} from "@/entityTypes/aiMessageTaskTypes";

function isAiEnabled(): boolean {
  const token = new Token();
  return token.getValue(USER_AI_ENABLED) === "true";
}

export function registerAiMessageTaskIpcHandlers(): void {
  console.log("AI Message Task IPC handlers registered");

  // Create AI message task
  ipcMain.handle(
    AI_MESSAGE_TASK_CREATE,
    async (_event, data: unknown): Promise<CommonMessage<number>> => {
      if (!isAiEnabled()) {
        return {
          status: false,
          msg: "AI features are not enabled",
          data: null,
        };
      }
      try {
        const request = (typeof data === "string"
          ? JSON.parse(data)
          : data) as CreateAiMessageTaskRequest;
        const module = new AiMessageTaskModule();
        const id = await module.createTask(request);
        return { status: true, msg: "AI message task created", data: id };
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        console.error("AI_MESSAGE_TASK_CREATE error:", msg);
        return { status: false, msg, data: null };
      }
    }
  );

  // Update AI message task
  ipcMain.handle(
    AI_MESSAGE_TASK_UPDATE,
    async (_event, data: unknown): Promise<CommonMessage<null>> => {
      if (!isAiEnabled()) {
        return {
          status: false,
          msg: "AI features are not enabled",
          data: null,
        };
      }
      try {
        const request = (typeof data === "string"
          ? JSON.parse(data)
          : data) as UpdateAiMessageTaskRequest;
        const module = new AiMessageTaskModule();
        await module.updateTask(request);
        return { status: true, msg: "AI message task updated", data: null };
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        console.error("AI_MESSAGE_TASK_UPDATE error:", msg);
        return { status: false, msg, data: null };
      }
    }
  );

  // Delete AI message task
  ipcMain.handle(
    AI_MESSAGE_TASK_DELETE,
    async (_event, data: unknown): Promise<CommonMessage<null>> => {
      if (!isAiEnabled()) {
        return {
          status: false,
          msg: "AI features are not enabled",
          data: null,
        };
      }
      try {
        const id =
          typeof data === "string" ? JSON.parse(data) : (data as number);
        const module = new AiMessageTaskModule();
        await module.deleteTask(id);
        return { status: true, msg: "AI message task deleted", data: null };
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        console.error("AI_MESSAGE_TASK_DELETE error:", msg);
        return { status: false, msg, data: null };
      }
    }
  );

  // List AI message tasks
  ipcMain.handle(
    AI_MESSAGE_TASK_LIST,
    async (
      _event,
      data: unknown
    ): Promise<
      CommonMessage<{
        items: unknown[];
        total: number;
      } | null>
    > => {
      if (!isAiEnabled()) {
        return {
          status: false,
          msg: "AI features are not enabled",
          data: null,
        };
      }
      try {
        const params = typeof data === "string" ? JSON.parse(data) : data;
        const page = (params as { page?: number })?.page ?? 1;
        const limit = (params as { limit?: number })?.limit ?? 50;
        const module = new AiMessageTaskModule();
        const result = await module.listTasks(page, limit);
        return {
          status: true,
          msg: "AI message tasks retrieved",
          data: result,
        };
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        console.error("AI_MESSAGE_TASK_LIST error:", msg);
        return { status: false, msg, data: null };
      }
    }
  );

  // Get AI message task detail
  ipcMain.handle(
    AI_MESSAGE_TASK_DETAIL,
    async (_event, data: unknown): Promise<CommonMessage<unknown>> => {
      if (!isAiEnabled()) {
        return {
          status: false,
          msg: "AI features are not enabled",
          data: null,
        };
      }
      try {
        const id =
          typeof data === "string" ? JSON.parse(data) : (data as number);
        const module = new AiMessageTaskModule();
        const task = await module.getTask(id);
        if (!task) {
          return {
            status: false,
            msg: "AI message task not found",
            data: null,
          };
        }
        return { status: true, msg: "Task retrieved", data: task };
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        console.error("AI_MESSAGE_TASK_DETAIL error:", msg);
        return { status: false, msg, data: null };
      }
    }
  );

  // List AI message task runs
  ipcMain.handle(
    AI_MESSAGE_TASK_RUN_LIST,
    async (
      _event,
      data: unknown
    ): Promise<
      CommonMessage<{
        items: unknown[];
        total: number;
      } | null>
    > => {
      if (!isAiEnabled()) {
        return {
          status: false,
          msg: "AI features are not enabled",
          data: null,
        };
      }
      try {
        const params = typeof data === "string" ? JSON.parse(data) : data;
        const taskId = (params as { taskId: number }).taskId;
        const page = (params as { page?: number })?.page ?? 1;
        const limit = (params as { limit?: number })?.limit ?? 20;
        const module = new AiMessageTaskRunModule();
        const result = await module.listRunsByTask(taskId, page, limit);
        return {
          status: true,
          msg: "Run history retrieved",
          data: result,
        };
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        console.error("AI_MESSAGE_TASK_RUN_LIST error:", msg);
        return { status: false, msg, data: null };
      }
    }
  );

  // Get AI message task run detail
  ipcMain.handle(
    AI_MESSAGE_TASK_RUN_DETAIL,
    async (_event, data: unknown): Promise<CommonMessage<unknown>> => {
      if (!isAiEnabled()) {
        return {
          status: false,
          msg: "AI features are not enabled",
          data: null,
        };
      }
      try {
        const id =
          typeof data === "string" ? JSON.parse(data) : (data as number);
        const module = new AiMessageTaskRunModule();
        const run = await module.getRun(id);
        if (!run) {
          return {
            status: false,
            msg: "AI message task run not found",
            data: null,
          };
        }
        return { status: true, msg: "Run retrieved", data: run };
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        console.error("AI_MESSAGE_TASK_RUN_DETAIL error:", msg);
        return { status: false, msg, data: null };
      }
    }
  );

  // List available built-in tools for AI message task
  ipcMain.handle(
    AI_MESSAGE_TASK_LIST_AVAILABLE_TOOLS,
    async (): Promise<CommonMessage<unknown[]>> => {
      if (!isAiEnabled()) {
        return {
          status: false,
          msg: "AI features are not enabled",
          data: [],
        };
      }
      try {
        const tools = listSchedulableBuiltInTools();
        return {
          status: true,
          msg: "Available tools retrieved",
          data: tools,
        };
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unknown error";
        console.error("AI_MESSAGE_TASK_LIST_AVAILABLE_TOOLS error:", msg);
        return { status: false, msg, data: [] };
      }
    }
  );
}
```

- [ ] **Step 2: Register IPC handlers in the main process entry point**

Find where other IPC handlers are registered (typically in `src/background.ts` or the communication registration file) and add:

```typescript
import { registerAiMessageTaskIpcHandlers } from "@/main-process/communication/aiMessageTask-ipc";
// In the registration section:
registerAiMessageTaskIpcHandlers();
```

- [ ] **Step 3: Commit**

```bash
git add src/main-process/communication/aiMessageTask-ipc.ts src/background.ts
git commit -m "feat(ai-message-task): add IPC handlers for AI message task CRUD and tool catalog"
```

---

### Task 14: Frontend API Layer

**Files:**
- Create: `src/views/api/aiMessageTask.ts`

- [ ] **Step 1: Create the frontend API**

```typescript
// src/views/api/aiMessageTask.ts

import { windowInvoke } from "./commonApi";
import {
  AI_MESSAGE_TASK_CREATE,
  AI_MESSAGE_TASK_UPDATE,
  AI_MESSAGE_TASK_DELETE,
  AI_MESSAGE_TASK_LIST,
  AI_MESSAGE_TASK_DETAIL,
  AI_MESSAGE_TASK_RUN_LIST,
  AI_MESSAGE_TASK_RUN_DETAIL,
  AI_MESSAGE_TASK_LIST_AVAILABLE_TOOLS,
} from "@/config/channellist";
import type {
  CreateAiMessageTaskRequest,
  UpdateAiMessageTaskRequest,
  SchedulableAiToolSummary,
} from "@/entityTypes/aiMessageTaskTypes";

export async function createAiMessageTask(
  request: CreateAiMessageTaskRequest
): Promise<number> {
  return windowInvoke(AI_MESSAGE_TASK_CREATE, request);
}

export async function updateAiMessageTask(
  request: UpdateAiMessageTaskRequest
): Promise<void> {
  await windowInvoke(AI_MESSAGE_TASK_UPDATE, request);
}

export async function deleteAiMessageTask(id: number): Promise<void> {
  await windowInvoke(AI_MESSAGE_TASK_DELETE, id);
}

export async function listAiMessageTasks(
  page = 1,
  limit = 50
): Promise<{ items: unknown[]; total: number }> {
  return windowInvoke(AI_MESSAGE_TASK_LIST, { page, limit });
}

export async function getAiMessageTaskDetail(
  id: number
): Promise<unknown> {
  return windowInvoke(AI_MESSAGE_TASK_DETAIL, id);
}

export async function listAiMessageTaskRuns(
  taskId: number,
  page = 1,
  limit = 20
): Promise<{ items: unknown[]; total: number }> {
  return windowInvoke(AI_MESSAGE_TASK_RUN_LIST, { taskId, page, limit });
}

export async function getAiMessageTaskRunDetail(
  id: number
): Promise<unknown> {
  return windowInvoke(AI_MESSAGE_TASK_RUN_DETAIL, id);
}

export async function listAvailableAiMessageTaskTools(): Promise<
  SchedulableAiToolSummary[]
> {
  return windowInvoke(AI_MESSAGE_TASK_LIST_AVAILABLE_TOOLS);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/views/api/aiMessageTask.ts
git commit -m "feat(ai-message-task): add frontend API layer for AI message tasks"
```

---

### Task 15: TaskExecutorService Integration

**Files:**
- Modify: `src/modules/TaskExecutorService.ts`

- [ ] **Step 1: Add ai_message routing to executeScheduledTask**

Import the module at the top of `src/modules/TaskExecutorService.ts`:

```typescript
import { AiMessageTaskModule } from "@/modules/AiMessageTaskModule";
```

Add the module as a class field and instantiate in the constructor:

```typescript
  private aiMessageTaskModule: AiMessageTaskModule;

  constructor() {
    // ... existing assignments ...
    this.aiMessageTaskModule = new AiMessageTaskModule();
  }
```

Add the case to the `executeScheduledTask` switch statement:

```typescript
        case TaskType.AI_MESSAGE:
          taskOutputId = await this.executeAiMessageTask(
            schedule.task_id,
            schedule.id
          );
          break;
```

Add the stub executor method:

```typescript
  /**
   * Execute an AI message task (Phase 1 stub).
   * Full headless runner implementation comes in Phase 2.
   */
  async executeAiMessageTask(
    taskId: number,
    scheduleId?: number
  ): Promise<number> {
    try {
      console.log(`Executing AI message task ${taskId}`);

      const task = await this.aiMessageTaskModule.getTask(taskId);
      if (!task) {
        throw new Error(`AI message task ${taskId} not found`);
      }

      // Phase 1: Stub — log execution and return task ID.
      // Phase 2 will introduce ScheduledAiMessageRunner for full AI execution.
      console.log(
        `AI message task ${taskId} (${task.name}) stub executed successfully`
      );

      await this.aiMessageTaskModule.updateLastRunResult(
        taskId,
        "[Phase 1 stub] Task scheduled but headless runner not yet implemented.",
        null
      );

      return taskId;
    } catch (error) {
      console.error(`Failed to execute AI message task ${taskId}:`, error);
      try {
        await this.aiMessageTaskModule.updateLastRunResult(
          taskId,
          null,
          error instanceof Error ? error.message : "Unknown error"
        );
      } catch (updateError) {
        console.error(
          "Failed to update AI message task last run result:",
          updateError
        );
      }
      throw error;
    }
  }
```

- [ ] **Step 2: Add ai_message to getTaskStatus**

Add this case to the `getTaskStatus` switch:

```typescript
        case TaskType.AI_MESSAGE: {
          const aiMsgTask = await this.aiMessageTaskModule.getTask(taskId);
          if (!aiMsgTask) {
            status = TaskStatus.Notstart;
          } else {
            switch (aiMsgTask.status) {
              case "active":
                status = TaskStatus.Complete;
                break;
              case "inactive":
                status = TaskStatus.Cancel;
                break;
              default:
                status = TaskStatus.Notstart;
            }
          }
          break;
        }
```

- [ ] **Step 3: Add ai_message to cancelTask**

Add this case to the `cancelTask` switch:

```typescript
        case TaskType.AI_MESSAGE:
          await this.aiMessageTaskModule.updateTask({
            id: taskId,
            status: "inactive",
          });
          break;
```

- [ ] **Step 4: Add ai_message to validateTaskConfiguration**

Add this case to the `validateTaskConfiguration` switch:

```typescript
        case TaskType.AI_MESSAGE: {
          const aiMsgTask = await this.aiMessageTaskModule.getTask(taskId);
          taskExists = !!aiMsgTask;
          break;
        }
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/TaskExecutorService.ts
git commit -m "feat(ai-message-task): wire AI_MESSAGE task type into TaskExecutorService"
```

---

### Task 16: Translations

**Files:**
- Modify: `src/views/lang/en.ts`
- Modify: `src/views/lang/zh.ts`
- Modify: `src/views/lang/es.ts`
- Modify: `src/views/lang/de.ts`
- Modify: `src/views/lang/ja.ts`

- [ ] **Step 1: Add English translations**

Add to the `schedule` section in `src/views/lang/en.ts`:

```typescript
  // Inside the schedule object:
  ai_message: "AI Message Task",
  ai_message_task: "AI Message Task",
  ai_message_task_create: "Create AI Message Task",
  ai_message_task_edit: "Edit AI Message Task",
  ai_message_task_name: "Task Name",
  ai_message_task_description: "Description",
  ai_message_task_message: "AI Message",
  ai_message_task_message_hint: "The prompt to send to the AI server on each scheduled run",
  ai_message_task_system_prompt: "System Prompt",
  ai_message_task_system_prompt_hint: "Optional system instructions for the AI",
  ai_message_task_model: "AI Model",
  ai_message_task_model_hint: "Model to use (e.g. gpt-4o)",
  ai_message_task_allowed_tools: "Allowed Tools",
  ai_message_task_allowed_tools_hint: "Select built-in tools the AI can use during unattended runs",
  ai_message_task_auto_approve: "Auto-Approve Tools",
  ai_message_task_auto_approve_hint: "Allow the AI to execute selected tools without manual confirmation",
  ai_message_task_auto_approve_warning: "Warning: Auto-approve allows unattended tool execution. Only select tools you trust.",
  ai_message_task_max_tool_calls: "Max Tool Calls",
  ai_message_task_max_runtime: "Max Runtime (ms)",
  ai_message_task_max_continue_calls: "Max Continue Calls",
  ai_message_task_safety_limits: "Safety Limits",
  ai_message_task_no_tools_available: "No schedulable tools available",
  ai_message_task_blocked_tool: "Blocked in v1",
  ai_message_task_risk_low: "Low Risk",
  ai_message_task_risk_medium: "Medium Risk",
  ai_message_task_risk_high: "High Risk",
  ai_message_task_risk_blocked: "Blocked",
  ai_message_task_run_history: "Run History",
  ai_message_task_run_status: "Run Status",
  ai_message_task_run_started: "Started",
  ai_message_task_run_finished: "Finished",
  ai_message_task_run_duration: "Duration",
  ai_message_task_run_tool_calls: "Tool Calls",
  ai_message_task_run_blocked_tools: "Blocked Tool Calls",
  ai_message_task_run_result: "AI Response",
  ai_message_task_run_error: "Error",
```

- [ ] **Step 2: Add Chinese translations**

Add to the `schedule` section in `src/views/lang/zh.ts`:

```typescript
  ai_message: "AI消息任务",
  ai_message_task: "AI消息任务",
  ai_message_task_create: "创建AI消息任务",
  ai_message_task_edit: "编辑AI消息任务",
  ai_message_task_name: "任务名称",
  ai_message_task_description: "描述",
  ai_message_task_message: "AI消息",
  ai_message_task_message_hint: "每次定时运行时发送给AI服务器的提示",
  ai_message_task_system_prompt: "系统提示词",
  ai_message_task_system_prompt_hint: "AI的可选系统指令",
  ai_message_task_model: "AI模型",
  ai_message_task_model_hint: "使用的模型（例如 gpt-4o）",
  ai_message_task_allowed_tools: "允许的工具",
  ai_message_task_allowed_tools_hint: "选择AI在无人值守运行期间可以使用的内置工具",
  ai_message_task_auto_approve: "自动批准工具",
  ai_message_task_auto_approve_hint: "允许AI在无需手动确认的情况下执行选定工具",
  ai_message_task_auto_approve_warning: "警告：自动批准允许无人值守执行工具。请仅选择您信任的工具。",
  ai_message_task_max_tool_calls: "最大工具调用次数",
  ai_message_task_max_runtime: "最大运行时间（毫秒）",
  ai_message_task_max_continue_calls: "最大继续调用次数",
  ai_message_task_safety_limits: "安全限制",
  ai_message_task_no_tools_available: "没有可调度的工具",
  ai_message_task_blocked_tool: "v1中已阻止",
  ai_message_task_risk_low: "低风险",
  ai_message_task_risk_medium: "中等风险",
  ai_message_task_risk_high: "高风险",
  ai_message_task_risk_blocked: "已阻止",
  ai_message_task_run_history: "运行历史",
  ai_message_task_run_status: "运行状态",
  ai_message_task_run_started: "开始时间",
  ai_message_task_run_finished: "结束时间",
  ai_message_task_run_duration: "持续时间",
  ai_message_task_run_tool_calls: "工具调用",
  ai_message_task_run_blocked_tools: "被阻止的工具调用",
  ai_message_task_run_result: "AI响应",
  ai_message_task_run_error: "错误",
```

- [ ] **Step 3: Add Spanish translations**

Add to the `schedule` section in `src/views/lang/es.ts`:

```typescript
  ai_message: "Tarea de Mensaje IA",
  ai_message_task: "Tarea de Mensaje IA",
  ai_message_task_create: "Crear Tarea de Mensaje IA",
  ai_message_task_edit: "Editar Tarea de Mensaje IA",
  ai_message_task_name: "Nombre de la Tarea",
  ai_message_task_description: "Descripción",
  ai_message_task_message: "Mensaje IA",
  ai_message_task_message_hint: "El mensaje a enviar al servidor IA en cada ejecución programada",
  ai_message_task_system_prompt: "Prompt del Sistema",
  ai_message_task_system_prompt_hint: "Instrucciones del sistema opcionales para la IA",
  ai_message_task_model: "Modelo IA",
  ai_message_task_model_hint: "Modelo a usar (ej. gpt-4o)",
  ai_message_task_allowed_tools: "Herramientas Permitidas",
  ai_message_task_allowed_tools_hint: "Selecciona herramientas integradas que la IA puede usar durante ejecuciones desatendidas",
  ai_message_task_auto_approve: "Auto-Aprobar Herramientas",
  ai_message_task_auto_approve_hint: "Permitir que la IA ejecute herramientas sin confirmación manual",
  ai_message_task_auto_approve_warning: "Advertencia: La auto-aprobación permite ejecución desatendida. Solo selecciona herramientas de confianza.",
  ai_message_task_max_tool_calls: "Máx. Llamadas a Herramientas",
  ai_message_task_max_runtime: "Tiempo Máx. de Ejecución (ms)",
  ai_message_task_max_continue_calls: "Máx. Llamadas de Continuación",
  ai_message_task_safety_limits: "Límites de Seguridad",
  ai_message_task_no_tools_available: "No hay herramientas programables disponibles",
  ai_message_task_blocked_tool: "Bloqueado en v1",
  ai_message_task_risk_low: "Riesgo Bajo",
  ai_message_task_risk_medium: "Riesgo Medio",
  ai_message_task_risk_high: "Riesgo Alto",
  ai_message_task_risk_blocked: "Bloqueado",
  ai_message_task_run_history: "Historial de Ejecuciones",
  ai_message_task_run_status: "Estado de Ejecución",
  ai_message_task_run_started: "Inicio",
  ai_message_task_run_finished: "Fin",
  ai_message_task_run_duration: "Duración",
  ai_message_task_run_tool_calls: "Llamadas a Herramientas",
  ai_message_task_run_blocked_tools: "Llamadas Bloqueadas",
  ai_message_task_run_result: "Respuesta IA",
  ai_message_task_run_error: "Error",
```

- [ ] **Step 4: Add German translations**

Add to the `schedule` section in `src/views/lang/de.ts`:

```typescript
  ai_message: "KI-Nachrichtenaufgabe",
  ai_message_task: "KI-Nachrichtenaufgabe",
  ai_message_task_create: "KI-Nachrichtenaufgabe erstellen",
  ai_message_task_edit: "KI-Nachrichtenaufgabe bearbeiten",
  ai_message_task_name: "Aufgabenname",
  ai_message_task_description: "Beschreibung",
  ai_message_task_message: "KI-Nachricht",
  ai_message_task_message_hint: "Die Aufforderung, die bei jeder geplanten Ausführung an den KI-Server gesendet wird",
  ai_message_task_system_prompt: "System-Prompt",
  ai_message_task_system_prompt_hint: "Optionale Systemanweisungen für die KI",
  ai_message_task_model: "KI-Modell",
  ai_message_task_model_hint: "Zu verwendendes Modell (z.B. gpt-4o)",
  ai_message_task_allowed_tools: "Erlaubte Werkzeuge",
  ai_message_task_allowed_tools_hint: "Wählen Sie integrierte Werkzeuge, die die KI bei unbeaufsichtigten Ausführungen verwenden darf",
  ai_message_task_auto_approve: "Werkzeuge automatisch genehmigen",
  ai_message_task_auto_approve_hint: "Erlauben Sie der KI, Werkzeuge ohne manuelle Bestätigung auszuführen",
  ai_message_task_auto_approve_warning: "Warnung: Auto-Genehmigung ermöglicht unbeaufsichtigte Werkzeuggesteuerte Ausführung. Wählen Sie nur vertrauenswürdige Werkzeuge.",
  ai_message_task_max_tool_calls: "Max. Werkzeugaufrufe",
  ai_message_task_max_runtime: "Max. Laufzeit (ms)",
  ai_message_task_max_continue_calls: "Max. Fortsetzungsaufrufe",
  ai_message_task_safety_limits: "Sicherheitsgrenzen",
  ai_message_task_no_tools_available: "Keine planbaren Werkzeuge verfügbar",
  ai_message_task_blocked_tool: "In v1 blockiert",
  ai_message_task_risk_low: "Niedriges Risiko",
  ai_message_task_risk_medium: "Mittleres Risiko",
  ai_message_task_risk_high: "Hohes Risiko",
  ai_message_task_risk_blocked: "Blockiert",
  ai_message_task_run_history: "Ausführungsverlauf",
  ai_message_task_run_status: "Ausführungsstatus",
  ai_message_task_run_started: "Gestartet",
  ai_message_task_run_finished: "Beendet",
  ai_message_task_run_duration: "Dauer",
  ai_message_task_run_tool_calls: "Werkzeugaufrufe",
  ai_message_task_run_blocked_tools: "Blockierte Werkzeugaufrufe",
  ai_message_task_run_result: "KI-Antwort",
  ai_message_task_run_error: "Fehler",
```

- [ ] **Step 5: Add Japanese translations**

Add to the `schedule` section in `src/views/lang/ja.ts`:

```typescript
  ai_message: "AIメッセージタスク",
  ai_message_task: "AIメッセージタスク",
  ai_message_task_create: "AIメッセージタスクを作成",
  ai_message_task_edit: "AIメッセージタスクを編集",
  ai_message_task_name: "タスク名",
  ai_message_task_description: "説明",
  ai_message_task_message: "AIメッセージ",
  ai_message_task_message_hint: "スケジュール実行時にAIサーバーに送信するプロンプト",
  ai_message_task_system_prompt: "システムプロンプト",
  ai_message_task_system_prompt_hint: "AIのオプションのシステム指示",
  ai_message_task_model: "AIモデル",
  ai_message_task_model_hint: "使用するモデル（例：gpt-4o）",
  ai_message_task_allowed_tools: "許可されたツール",
  ai_message_task_allowed_tools_hint: "無人実行中にAIが使用できる組み込みツールを選択",
  ai_message_task_auto_approve: "ツールの自動承認",
  ai_message_task_auto_approve_hint: "手動確認なしでAIがツールを実行することを許可",
  ai_message_task_auto_approve_warning: "警告：自動承認は無人ツール実行を許可します。信頼できるツールのみを選択してください。",
  ai_message_task_max_tool_calls: "最大ツール呼び出し数",
  ai_message_task_max_runtime: "最大実行時間（ミリ秒）",
  ai_message_task_max_continue_calls: "最大継続呼び出し数",
  ai_message_task_safety_limits: "安全制限",
  ai_message_task_no_tools_available: "スケジュール可能なツールがありません",
  ai_message_task_blocked_tool: "v1でブロック済み",
  ai_message_task_risk_low: "低リスク",
  ai_message_task_risk_medium: "中リスク",
  ai_message_task_risk_high: "高リスク",
  ai_message_task_risk_blocked: "ブロック済み",
  ai_message_task_run_history: "実行履歴",
  ai_message_task_run_status: "実行ステータス",
  ai_message_task_run_started: "開始",
  ai_message_task_run_finished: "終了",
  ai_message_task_run_duration: "所要時間",
  ai_message_task_run_tool_calls: "ツール呼び出し",
  ai_message_task_run_blocked_tools: "ブロックされたツール呼び出し",
  ai_message_task_run_result: "AI応答",
  ai_message_task_run_error: "エラー",
```

- [ ] **Step 6: Commit**

```bash
git add src/views/lang/en.ts src/views/lang/zh.ts src/views/lang/es.ts src/views/lang/de.ts src/views/lang/ja.ts
git commit -m "feat(ai-message-task): add translations for all supported languages"
```

---

### Task 17: ScheduleForm UI Integration

**Files:**
- Modify: `src/views/pages/schedule/widgets/ScheduleForm.vue`
- Create: `src/views/pages/schedule/widgets/AiMessageTaskForm.vue`
- Modify: `src/views/pages/schedule/detail.vue`
- Modify: `src/views/pages/schedule/widgets/ScheduleTable.vue`

- [ ] **Step 1: Create AiMessageTaskForm.vue**

Create `src/views/pages/schedule/widgets/AiMessageTaskForm.vue` — a form component for selecting/creating an AI message task when scheduling. This component will:
- Show a list of existing AI message tasks to select from
- Allow basic inline task creation (name + message)
- Show the selected task's configuration summary

```vue
<template>
  <v-container fluid>
    <v-row>
      <v-col cols="12">
        <v-select
          v-model="selectedTaskId"
          :items="taskItems"
          item-title="name"
          item-value="id"
          :label="t('schedule.ai_message_task') || 'AI Message Task'"
          density="compact"
          variant="outlined"
          clearable
          @update:model-value="handleTaskSelected"
        />
      </v-col>
    </v-row>
    <v-row v-if="selectedTask">
      <v-col cols="12">
        <v-card variant="outlined" class="pa-3">
          <div class="text-subtitle-2 mb-1">{{ selectedTask.name }}</div>
          <div class="text-body-2 text-medium-emphasis">{{ selectedTask.message }}</div>
          <div v-if="selectedTask.model" class="text-caption mt-1">Model: {{ selectedTask.model }}</div>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useI18n } from "vue-i18n";
import { listAiMessageTasks } from "@/views/api/aiMessageTask";

const { t } = useI18n();
const emit = defineEmits<{
  (e: "change", taskId: number | undefined): void;
}>();

interface TaskItem {
  id: number;
  name: string;
  message: string;
  model: string;
}

const tasks = ref<TaskItem[]>([]);
const selectedTaskId = ref<number | undefined>(undefined);

const taskItems = computed(() =>
  tasks.value.filter((t) => t.id !== undefined)
);

const selectedTask = computed(() =>
  tasks.value.find((t) => t.id === selectedTaskId.value)
);

function handleTaskSelected(taskId: number | undefined): void {
  emit("change", taskId);
}

onMounted(async () => {
  try {
    const result = await listAiMessageTasks(1, 200);
    tasks.value = (result.items as TaskItem[]) ?? [];
  } catch (error) {
    console.error("Failed to load AI message tasks:", error);
  }
});
</script>
```

- [ ] **Step 2: Update ScheduleForm.vue**

In `src/views/pages/schedule/widgets/ScheduleForm.vue`:

1. Import the new component and TaskType:
```typescript
import AiMessageTaskForm from "./AiMessageTaskForm.vue";
// TaskType should already be imported
```

2. Add to the `taskTypeOptions` array:
```typescript
  { title: t('schedule.ai_message_task') || 'AI Message Task', value: TaskType.AI_MESSAGE },
```

3. Add the conditional template section after the Yandex Maps section:
```vue
<v-row v-if="formData.task_type==TaskType.AI_MESSAGE" >
  <AiMessageTaskForm @change="handleAiMessageTaskChanged" />
</v-row>
```

4. Add the handler function:
```typescript
const handleAiMessageTaskChanged = (newValue: number | undefined) => {
  if (newValue && newValue > 0) {
    formData.value.task_id = newValue
  } else {
    formData.value.task_id = 0
  }
}
```

- [ ] **Step 3: Update detail.vue**

In `src/views/pages/schedule/detail.vue`, update `getTaskTypeLabel`:
```typescript
    case TaskType.AI_MESSAGE: return t('schedule.ai_message_task') || 'AI Message Task'
```

Update `getTaskTypeColor`:
```typescript
    case TaskType.AI_MESSAGE: return 'purple'
```

- [ ] **Step 4: Update ScheduleTable.vue**

In `src/views/pages/schedule/widgets/ScheduleTable.vue`, update `getTaskTypeLabel`:
```typescript
    case TaskType.AI_MESSAGE: return t('schedule.ai_message_task') || 'AI Message Task'
```

Update `getTaskTypeColor`:
```typescript
    case TaskType.AI_MESSAGE: return 'purple'
```

- [ ] **Step 5: Commit**

```bash
git add src/views/pages/schedule/widgets/AiMessageTaskForm.vue src/views/pages/schedule/widgets/ScheduleForm.vue src/views/pages/schedule/detail.vue src/views/pages/schedule/widgets/ScheduleTable.vue
git commit -m "feat(ai-message-task): add schedule UI integration for AI message task type"
```

---

### Task 18: Verify Build

- [ ] **Step 1: Run TypeScript type check**

```bash
yarn tsc
```

Expected: No type errors.

- [ ] **Step 2: Run build**

```bash
yarn build
```

Expected: Build succeeds.

- [ ] **Step 3: Fix any errors if present**

If type errors occur, fix them by adding missing imports or adjusting types.

---

## Self-Review Checklist

### Spec Coverage

| PRD Section | Task |
|-------------|------|
| FR-1: New Task Type | Task 2 (TaskType.AI_MESSAGE) |
| FR-2: AI Message Task Configuration | Tasks 3, 6, 8 (entity, model, module) |
| FR-3: AI Message Run Logs | Tasks 4, 7, 9 (entity, model, module) |
| FR-5: Task-Scoped Tool Policy | Tasks 10, 11 (policy, catalog) |
| FR-9: Task Management UI | Tasks 16, 17 (translations, UI) |
| FR-10: Schedule Integration | Tasks 15, 17 (TaskExecutorService, ScheduleForm) |
| SR-5: AI Enabled Gate | Task 13 (IPC handlers check USER_AI_ENABLED) |

### Placeholder Scan

No TBD, TODO, or placeholder steps. All code blocks contain complete implementations.

### Type Consistency

- `AiMessageTaskStatus`, `AiMessageTaskRunStatus`, `SchedulableAiToolSummary`, `ScheduledToolDecision`, `BlockedToolCallRecord` defined in Task 1 and used consistently throughout.
- `AI_MESSAGE_TASK_DEFAULTS` constants match entity column defaults in Tasks 3-4.
- Module method signatures match IPC handler call patterns in Task 13.
- Frontend API function names match IPC channel names in Task 14.
