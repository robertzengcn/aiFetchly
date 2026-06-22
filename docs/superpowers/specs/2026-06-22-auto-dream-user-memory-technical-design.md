# Technical Design: Auto-Dream User Memory

**Date:** 2026-06-22
**Status:** Draft
**PRD:** [2026-06-22-auto-dream-user-memory-prd.md](2026-06-22-auto-dream-user-memory-prd.md)
**Builds on:** [2026-06-15-agent-memory-compact-technical-design.md](2026-06-15-agent-memory-compact-technical-design.md)
**Related areas:** `ai-chat-v2`, agent runtime, skill/tool execution, TypeORM persistence

## Design Intent

Add durable cross-session memory for the current local user database.

This design adapts Claude Code's auto-dream idea to AiFetchly's architecture:

- Claude Code stores project memory in markdown files under a git-root-derived memory directory.
- AiFetchly should store user/account memory in SQLite through TypeORM.
- Claude Code consolidates recent transcripts into a long-term memory index.
- AiFetchly should consolidate AI Chat V2 messages and agent task transcripts/tool calls into structured memory records.

The result is a controlled memory layer that future AI Chat V2 turns can use without depending on one conversation's compact summary.

## Current State

AiFetchly already has the pieces needed to add durable memory safely:

- `AIChatContextAssembler` injects conversation-local compact context into chat prompts.
- `AIChatCompactAgentService` runs background session compact after completed assistant turns.
- `AIChatV2Module` persists AI Chat V2 messages and clears compact state with conversations.
- `AgentRuntime` persists agent tasks, transcripts, tool calls, and final results.
- `AgentTaskModule` exposes task snapshots, messages, and tool calls through model/module boundaries.
- `ai-chat-v2-ipc.ts` and `agent-runtime-ipc.ts` already check `USER_AI_ENABLED` before AI-facing operations.
- `SqliteDb.ts` uses TypeORM `synchronize: true` and registers entities centrally.

This design extends those patterns. It does not introduce worker database writes, direct IPC database access, or file-based memory.

## Architecture

```text
AI Chat V2 turn completion
  |
  v
AIChatQueryEngine.handleLoopResult()
  |
  +--> AIChatCompactAgentService.enqueueSessionMemoryUpdate()
  |
  +--> AIAutoDreamService.evaluateAfterChatTurn()

Agent task completion
  |
  v
AgentRuntime.runSync()
  |
  +--> AIAutoDreamService.evaluateAfterAgentTask()

Manual memory UI / IPC
  |
  v
ai-user-memory-ipc.ts
  |
  v
AIUserMemoryService
  |
  v
AIUserMemoryModule / AIMemoryConsolidationRunModule
  |
  v
AIUserMemoryModel / AIMemoryConsolidationRunModel
  |
  v
SQLite TypeORM tables

Future prompt assembly
  |
  v
AIChatContextAssembler
  |
  +--> AIUserMemoryRetrievalService
  |
  +--> AIChatCompactModule / AIChatSessionMemoryModule
  |
  v
OpenAI-compatible messages[]
```

The memory write path is always:

```text
Service -> Module -> Model -> Entity -> SQLite
```

IPC handlers validate and delegate. Workers never touch these tables.

## File Structure

Create:

- `src/entity/AIUserMemory.entity.ts`
- `src/entity/AIMemoryConsolidationRun.entity.ts`
- `src/entityTypes/aiUserMemoryTypes.ts`
- `src/model/AIUserMemory.model.ts`
- `src/model/AIMemoryConsolidationRun.model.ts`
- `src/modules/AIUserMemoryModule.ts`
- `src/modules/AIMemoryConsolidationRunModule.ts`
- `src/service/AIUserMemoryService.ts`
- `src/service/AIUserMemoryRetrievalService.ts`
- `src/service/AIAutoDreamService.ts`
- `src/service/AIAutoDreamPromptBuilder.ts`
- `src/service/AIAutoDreamSourceCollector.ts`
- `src/main-process/communication/ai-user-memory-ipc.ts`
- `src/views/api/aiUserMemory.ts`
- `test/vitest/main/modules/AIUserMemoryModule.test.ts`
- `test/vitest/main/modules/AIMemoryConsolidationRunModule.test.ts`
- `test/vitest/main/service/AIUserMemoryRetrievalService.test.ts`
- `test/vitest/main/service/AIAutoDreamPromptBuilder.test.ts`
- `test/vitest/main/service/AIAutoDreamService.test.ts`
- `test/vitest/main/ipc/ai-user-memory-ipc.test.ts`

Modify:

- `src/config/SqliteDb.ts`
- `src/config/usersetting.ts`
- `src/config/channellist.ts`
- `src/main-process/communication/index.ts`
- `src/main-process/communication/ai-chat-v2-ipc.ts`
- `src/service/AIChatQueryEngine.ts`
- `src/service/AIChatContextAssembler.ts`
- `src/service/AgentRuntime.ts`
- `src/modules/AgentTaskModule.ts`
- `src/model/AgentTask.model.ts`
- `src/preload.ts`
- UI files in a later milestone.

## Type Definitions

Create `src/entityTypes/aiUserMemoryTypes.ts`.

```ts
export type AIUserMemoryType =
  | "preference"
  | "fact"
  | "decision"
  | "reference"
  | "workflow";

export type AIUserMemoryStatus =
  | "active"
  | "archived"
  | "contradicted";

export type AIUserMemorySourceKind =
  | "manual"
  | "chat_v2"
  | "agent_task"
  | "auto_dream";

export type AIMemoryConsolidationStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AIUserMemoryView {
  id: number;
  memoryId: string;
  type: AIUserMemoryType;
  title: string;
  content: string;
  status: AIUserMemoryStatus;
  confidence: number;
  sourceKind?: AIUserMemorySourceKind;
  sourceConversationId?: string;
  sourceAgentTaskId?: string;
  sourceMessageIds?: string[];
  lastUsedAt?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AIUserMemoryCreateInput {
  type: AIUserMemoryType;
  title: string;
  content: string;
  sourceKind?: AIUserMemorySourceKind;
  sourceConversationId?: string;
  sourceAgentTaskId?: string;
  sourceMessageIds?: string[];
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface AIUserMemoryUpdateInput {
  memoryId: string;
  type?: AIUserMemoryType;
  title?: string;
  content?: string;
  status?: AIUserMemoryStatus;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface AIUserMemorySearchInput {
  query?: string;
  type?: AIUserMemoryType;
  status?: AIUserMemoryStatus;
  sourceKind?: AIUserMemorySourceKind;
  limit?: number;
  offset?: number;
}

export interface AIMemoryInjectionResult {
  memories: AIUserMemoryView[];
  tokenEstimate: number;
  contextBlock: string;
}
```

Conventions:

- Keep DTOs separate from entities.
- Do not use `any`.
- Use `Record<string, unknown>` for metadata and validated model JSON.
- IDs exposed to services use `memoryId` and `runId`, not numeric primary keys.

## Database Entities

### AIUserMemoryEntity

Create `src/entity/AIUserMemory.entity.ts`.

```ts
import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("ai_user_memories")
@Index("idx_ai_user_memories_memory_id", ["memoryId"], { unique: true })
@Index("idx_ai_user_memories_type", ["type"])
@Index("idx_ai_user_memories_status", ["status"])
@Index("idx_ai_user_memories_source_kind", ["sourceKind"])
@Index("idx_ai_user_memories_source_conversation", ["sourceConversationId"])
@Index("idx_ai_user_memories_source_agent_task", ["sourceAgentTaskId"])
@Index("idx_ai_user_memories_last_used", ["lastUsedAt"])
@Index("idx_ai_user_memories_updated", ["updatedAt"])
export class AIUserMemoryEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  memoryId: string;

  @Order(2)
  @Column("varchar", { length: 30, nullable: false })
  type: string;

  @Order(3)
  @Column("varchar", { length: 200, nullable: false })
  title: string;

  @Order(4)
  @Column("text", { nullable: false })
  content: string;

  @Order(5)
  @Column("varchar", { length: 30, nullable: false, default: "active" })
  status: string;

  @Order(6)
  @Column("int", { nullable: false, default: 100 })
  confidence: number;

  @Order(7)
  @Column("varchar", { length: 30, nullable: true })
  sourceKind?: string | null;

  @Order(8)
  @Column("varchar", { length: 100, nullable: true })
  sourceConversationId?: string | null;

  @Order(9)
  @Column("varchar", { length: 100, nullable: true })
  sourceAgentTaskId?: string | null;

  @Order(10)
  @Column("simple-json", { nullable: true })
  sourceMessageIds?: string[] | null;

  @Order(11)
  @Column("datetime", { nullable: true })
  lastUsedAt?: Date | null;

  @Order(12)
  @Column("simple-json", { nullable: true })
  metadata?: Record<string, unknown> | null;
}
```

### AIMemoryConsolidationRunEntity

Create `src/entity/AIMemoryConsolidationRun.entity.ts`.

```ts
import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("ai_memory_consolidation_runs")
@Index("idx_memory_runs_run_id", ["runId"], { unique: true })
@Index("idx_memory_runs_status", ["status"])
@Index("idx_memory_runs_started", ["startedAt"])
@Index("idx_memory_runs_finished", ["finishedAt"])
export class AIMemoryConsolidationRunEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  runId: string;

  @Order(2)
  @Column("varchar", { length: 30, nullable: false })
  status: string;

  @Order(3)
  @Column("datetime", { nullable: false })
  startedAt: Date;

  @Order(4)
  @Column("datetime", { nullable: true })
  finishedAt?: Date | null;

  @Order(5)
  @Column("datetime", { nullable: true })
  reviewedSince?: Date | null;

  @Order(6)
  @Column("datetime", { nullable: true })
  reviewedThrough?: Date | null;

  @Order(7)
  @Column("int", { nullable: false, default: 0 })
  chatConversationsReviewed: number;

  @Order(8)
  @Column("int", { nullable: false, default: 0 })
  agentTasksReviewed: number;

  @Order(9)
  @Column("int", { nullable: false, default: 0 })
  memoriesCreated: number;

  @Order(10)
  @Column("int", { nullable: false, default: 0 })
  memoriesUpdated: number;

  @Order(11)
  @Column("int", { nullable: false, default: 0 })
  memoriesArchived: number;

  @Order(12)
  @Column("varchar", { length: 100, nullable: true })
  model?: string | null;

  @Order(13)
  @Column("text", { nullable: true })
  errorMessage?: string | null;
}
```

### SqliteDb Registration

Add both entities to `src/config/SqliteDb.ts`:

```ts
import { AIUserMemoryEntity } from "@/entity/AIUserMemory.entity";
import { AIMemoryConsolidationRunEntity } from "@/entity/AIMemoryConsolidationRun.entity";
```

Add them near the AI chat and agent entities in the `entities` array.

## Settings And Channels

### User Settings

Modify `src/config/usersetting.ts`:

```ts
export const USER_AI_AUTO_DREAM = "user_ai_auto_dream";
export const USER_AI_MEMORY_INJECTION = "user_ai_memory_injection";
```

Defaults:

- `USER_AI_AUTO_DREAM`: disabled unless value is exactly `"true"`.
- `USER_AI_MEMORY_INJECTION`: enabled unless value is exactly `"false"`.

Rationale:

- Manual memory can ship before auto-dream.
- Retrieval can work as soon as the user has explicit memories.
- Automatic extraction waits for the memory management UI.

### IPC Channels

Modify `src/config/channellist.ts`:

```ts
export const AI_USER_MEMORY_LIST = "ai:user-memory:list";
export const AI_USER_MEMORY_CREATE = "ai:user-memory:create";
export const AI_USER_MEMORY_UPDATE = "ai:user-memory:update";
export const AI_USER_MEMORY_ARCHIVE = "ai:user-memory:archive";
export const AI_USER_MEMORY_DELETE = "ai:user-memory:delete";
export const AI_USER_MEMORY_RUN_AUTO_DREAM = "ai:user-memory:auto-dream:run";
export const AI_USER_MEMORY_AUTO_DREAM_STATUS = "ai:user-memory:auto-dream:status";
```

Register them in `src/preload.ts` using the existing allowlist pattern.

## Model Layer

### AIUserMemoryModel

Create `src/model/AIUserMemory.model.ts`.

Responsibilities:

- CRUD by `memoryId`.
- Search active/archived/contradicted memories.
- Update `lastUsedAt`.
- Hard delete by `memoryId`.
- Bulk fetch for retrieval and consolidation.

Suggested methods:

```ts
export class AIUserMemoryModel extends BaseDb {
  async create(input: AIUserMemoryEntity): Promise<AIUserMemoryEntity>;
  async getByMemoryId(memoryId: string): Promise<AIUserMemoryEntity | null>;
  async list(input: AIUserMemorySearchInput): Promise<AIUserMemoryEntity[]>;
  async updateByMemoryId(
    memoryId: string,
    updates: Partial<AIUserMemoryEntity>
  ): Promise<AIUserMemoryEntity>;
  async archive(memoryId: string): Promise<void>;
  async deleteByMemoryId(memoryId: string): Promise<number>;
  async markUsed(memoryIds: string[], usedAt: Date): Promise<void>;
  async listActiveForRetrieval(limit: number): Promise<AIUserMemoryEntity[]>;
}
```

Search implementation:

- Escape `%` and `_` for LIKE queries.
- Search `title` and `content`.
- Default status filter should be `active` unless caller asks otherwise.
- Default limit should be 50.
- Maximum limit should be 200.

### AIMemoryConsolidationRunModel

Create `src/model/AIMemoryConsolidationRun.model.ts`.

Responsibilities:

- Create run records.
- Complete/fail/cancel run records.
- Find latest successful run.
- Detect active `running` run.
- Recover stale running runs.

Suggested methods:

```ts
export class AIMemoryConsolidationRunModel extends BaseDb {
  async createRunning(input: {
    runId: string;
    startedAt: Date;
    reviewedSince?: Date | null;
    reviewedThrough?: Date | null;
  }): Promise<AIMemoryConsolidationRunEntity>;

  async completeRun(input: {
    runId: string;
    finishedAt: Date;
    chatConversationsReviewed: number;
    agentTasksReviewed: number;
    memoriesCreated: number;
    memoriesUpdated: number;
    memoriesArchived: number;
    model?: string;
  }): Promise<void>;

  async failRun(runId: string, errorMessage: string, finishedAt: Date): Promise<void>;
  async getLatestSuccessfulRun(): Promise<AIMemoryConsolidationRunEntity | null>;
  async getRunningRun(): Promise<AIMemoryConsolidationRunEntity | null>;
  async markStaleRunningFailed(before: Date): Promise<number>;
}
```

## Module Layer

### AIUserMemoryModule

Create `src/modules/AIUserMemoryModule.ts`.

Module responsibilities:

- Resolve database path through `BaseModule`.
- Validate memory type/status values.
- Generate `memoryId`.
- Normalize title/content.
- Clamp confidence to 0-100.
- Sanitize source metadata shape.
- Convert entities to views.

Suggested public API:

```ts
export class AIUserMemoryModule extends BaseModule {
  async createMemory(input: AIUserMemoryCreateInput): Promise<AIUserMemoryView>;
  async updateMemory(input: AIUserMemoryUpdateInput): Promise<AIUserMemoryView>;
  async archiveMemory(memoryId: string): Promise<void>;
  async deleteMemory(memoryId: string): Promise<number>;
  async getMemory(memoryId: string): Promise<AIUserMemoryView | null>;
  async listMemories(input: AIUserMemorySearchInput): Promise<AIUserMemoryView[]>;
  async markMemoriesUsed(memoryIds: string[], usedAt?: Date): Promise<void>;
  async listActiveForRetrieval(limit?: number): Promise<AIUserMemoryView[]>;
}
```

Validation rules:

- `title`: trim, 1-200 chars.
- `content`: trim, 1-8000 chars.
- `type`: closed taxonomy only.
- `status`: closed status only.
- `sourceMessageIds`: strings only, max 100 ids.
- `metadata`: JSON-serializable object only, no functions.

### AIMemoryConsolidationRunModule

Create `src/modules/AIMemoryConsolidationRunModule.ts`.

Suggested public API:

```ts
export class AIMemoryConsolidationRunModule extends BaseModule {
  async startRun(input: {
    reviewedSince?: Date | null;
    reviewedThrough?: Date | null;
  }): Promise<AIMemoryConsolidationRunView>;

  async completeRun(input: CompleteMemoryRunInput): Promise<void>;
  async failRun(runId: string, errorMessage: string): Promise<void>;
  async getLatestSuccessfulRun(): Promise<AIMemoryConsolidationRunView | null>;
  async getRunningRun(): Promise<AIMemoryConsolidationRunView | null>;
  async recoverStaleRunningRuns(staleBefore: Date): Promise<number>;
}
```

Use this module as the durable lock record for manual status views. The service still keeps an in-process lock for fast duplicate prevention.

## Service Layer

### AIUserMemoryService

Create `src/service/AIUserMemoryService.ts`.

This is the main application service for manual memory operations and memory writes from AI tools.

Constructor deps:

```ts
export interface AIUserMemoryServiceDeps {
  memoryModule?: AIUserMemoryModule;
  isAIEnabled?: () => boolean;
}
```

Methods:

```ts
export class AIUserMemoryService {
  async createManualMemory(input: AIUserMemoryCreateInput): Promise<AIUserMemoryView>;
  async rememberFromAssistant(input: {
    title: string;
    content: string;
    type?: AIUserMemoryType;
    conversationId?: string;
    sourceMessageIds?: string[];
  }): Promise<AIUserMemoryView>;
  async list(input: AIUserMemorySearchInput): Promise<AIUserMemoryView[]>;
  async update(input: AIUserMemoryUpdateInput): Promise<AIUserMemoryView>;
  async archive(memoryId: string): Promise<void>;
  async delete(memoryId: string): Promise<number>;
}
```

AI gate:

- Manual CRUD does not need `USER_AI_ENABLED`.
- `rememberFromAssistant()` should check AI enablement because it is an AI tool/service path.
- Any future transform/extract operation must check AI enablement before calling a model.

### AIUserMemoryRetrievalService

Create `src/service/AIUserMemoryRetrievalService.ts`.

Responsibilities:

- Select a small relevant subset of active memories.
- Produce a bounded memory context block.
- Track used memory ids.
- Keep deterministic retrieval for v1.

Inputs:

```ts
export interface AIUserMemoryRetrievalInput {
  currentUserMessage: string;
  conversationId?: string;
  mode: "chat" | "plan";
  maxMemories?: number;
  maxTokens?: number;
}
```

Defaults:

- `maxMemories = 10`
- `maxTokens = 2000`

Scoring:

```text
score =
  keywordScore(title + content, currentUserMessage) * 10
  + typeWeight
  + recencyWeight
  + sourceWeight
  + lastUsedWeight
```

Type weights:

- `preference`: 8
- `decision`: 6
- `workflow`: 5
- `reference`: 4
- `fact`: 3

Source weights:

- same `sourceConversationId`: 4
- manual memory: 3
- auto-dream memory: 2
- otherwise: 0

Keyword score:

- Lowercase.
- Split on non-alphanumeric boundaries.
- Drop tokens shorter than 3 chars.
- Count unique token overlap.
- Give title matches double weight.

Context format:

```text
Durable user memory:
Use these memories as background context. Prefer the current user message if it conflicts.

- [preference] Title: content
- [decision] Title: content
```

Do not include archived or contradicted memories.

After assembly, call `AIUserMemoryModule.markMemoriesUsed(memoryIds)`. This can be awaited because it is a local SQLite update, but failures should be logged and ignored to avoid blocking chat.

### AIAutoDreamSourceCollector

Create `src/service/AIAutoDreamSourceCollector.ts`.

Responsibilities:

- Build compact source packets for consolidation.
- Avoid passing huge raw transcripts.
- Review both chat and agent sources.
- Track source boundaries with timestamps.

Types:

```ts
export interface AutoDreamSourcePacket {
  sourceKind: "chat_v2" | "agent_task";
  sourceId: string;
  updatedAt: string;
  title: string;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt?: string;
    metadata?: Record<string, unknown>;
  }>;
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    status: string;
    resultSummary?: string;
    errorMessage?: string;
  }>;
}
```

Chat collection:

- Use `AIChatV2Module.getConversations()` to find v2 conversations.
- Add a new model/module method for "conversations touched after timestamp" to avoid loading every conversation.
- For each candidate, read messages with `AIChatV2Module.getConversationMessages()`.
- Include `MessageType.MESSAGE` rows.
- Include tool result summaries from metadata when concise.
- Exclude large raw tool result content.

Agent task collection:

- Add `AgentTaskModel.listFinishedAfter(since, limit)` and `AgentTaskModule.listFinishedAfter(since, limit)`.
- Read messages with `AgentTaskModule.listMessages(agentTaskId)`.
- Read tool calls with `AgentTaskModule.listToolCalls(agentTaskId)`.
- Include final task result summary.
- Exclude bulky task packet data unless needed to understand the user's goal.

Bounds:

- Max 5 chat conversations per run in v1.
- Max 5 agent tasks per run in v1.
- Max 30 messages per source packet.
- Max 1200 chars per message.
- Max 300 chars per tool result summary.

These limits prevent background memory from becoming a hidden transcript uploader.

### AIAutoDreamPromptBuilder

Create `src/service/AIAutoDreamPromptBuilder.ts`.

Responsibilities:

- Build system prompt.
- Build user prompt from existing active memories and source packets.
- Validate and normalize model JSON output.

System prompt requirements:

- Extract only durable future-useful memories.
- Use closed taxonomy.
- Do not preserve secrets, tokens, cookies, passwords, private scraped data, or large raw outputs.
- Prefer explicit user statements over inference.
- Merge duplicates.
- Archive contradictions.
- Return JSON only.

Expected model output:

```ts
export interface AutoDreamModelOutput {
  create: Array<{
    type: AIUserMemoryType;
    title: string;
    content: string;
    confidence: number;
    sourceKind: "chat_v2" | "agent_task";
    sourceId: string;
    sourceMessageIds?: string[];
    reason: string;
  }>;
  update: Array<{
    memoryId: string;
    title?: string;
    content?: string;
    confidence?: number;
    reason: string;
  }>;
  archive: Array<{
    memoryId: string;
    reason: string;
  }>;
}
```

Validation:

- Parse JSON with `JSON.parse`.
- Reject non-object output.
- Drop unknown fields.
- Drop invalid memory types.
- Drop `content` matching secret-like patterns.
- Clamp confidence.
- Enforce max title/content lengths.
- Ensure `sourceId` exists in the submitted source packets.
- Ensure update/archive `memoryId` exists in existing memories.

Secret-like patterns:

- `sk-`
- `api_key`
- `access_token`
- `refresh_token`
- `password`
- `cookie`
- long base64-like strings
- JWT-like `xxxxx.yyyyy.zzzzz`

This is a filter, not a security proof. The UI must still let users inspect and delete memories.

### AIAutoDreamService

Create `src/service/AIAutoDreamService.ts`.

Constructor deps:

```ts
export interface AIAutoDreamServiceDeps {
  completeChat(request: OpenAIChatCompletionRequest): Promise<OpenAIChatCompletionResponse>;
  isAIEnabled(): boolean;
  isAutoDreamEnabled(): boolean;
  memoryModule?: AIUserMemoryModule;
  runModule?: AIMemoryConsolidationRunModule;
  sourceCollector?: AIAutoDreamSourceCollector;
}
```

Constants:

```ts
const MIN_HOURS_BETWEEN_RUNS = 24;
const MIN_CHANGED_SOURCES = 5;
const RUNNING_STALE_MS = 60 * 60 * 1000;
const FAILURE_CIRCUIT_THRESHOLD = 3;
const FAILURE_COOLDOWN_MS = 10 * 60 * 1000;
```

Public API:

```ts
export class AIAutoDreamService {
  evaluateAfterChatTurn(input: {
    conversationId: string;
    reason: "assistant_turn_completed";
  }): Promise<void>;

  evaluateAfterAgentTask(input: {
    agentTaskId: string;
    reason: "agent_task_completed";
  }): Promise<void>;

  runNow(input?: {
    force?: boolean;
    reason?: string;
  }): Promise<AIMemoryConsolidationRunView>;

  getStatus(): Promise<AIAutoDreamStatusView>;
}
```

Gate order:

1. Return if already in process.
2. Return if `USER_AI_ENABLED` is not `"true"`.
3. Return if `USER_AI_AUTO_DREAM` is not `"true"` unless `force` is true.
4. Recover stale running runs older than 1 hour.
5. Return if a running run exists.
6. Return if latest successful run is newer than 24 hours unless `force` is true.
7. Collect changed source counts.
8. Return if fewer than 5 changed sources unless `force` is true.
9. Create running run record.
10. Call model.
11. Validate output.
12. Apply memory changes.
13. Complete run record.
14. On failure, mark run failed and leave chat/task unaffected.

In-process lock:

```ts
private inFlight: Promise<AIMemoryConsolidationRunView | null> | null = null;
```

Durable lock:

- `AIMemoryConsolidationRunEntity.status = "running"` acts as a cross-service status record.
- On startup or before a new run, stale running rows older than 1 hour are marked failed.

Why both:

- In-process lock prevents duplicate work in one app process.
- DB run status gives UI observability and crash recovery.

Memory application:

```text
for each archive:
  AIUserMemoryModule.updateMemory({ memoryId, status: "archived" })

for each update:
  AIUserMemoryModule.updateMemory({ memoryId, title, content, confidence })

for each create:
  AIUserMemoryModule.createMemory({ ... })
```

Apply archives before updates/creates so contradictions clear first.

Failure behavior:

- Log error.
- Mark run failed.
- Do not throw from `evaluateAfterChatTurn()` or `evaluateAfterAgentTask()`.
- `runNow()` may return a failed status view or throw only at IPC boundary by design. Prefer returning status for easier UI.

## AI Chat V2 Integration

### Context Assembly

Modify `AIChatContextAssembler`.

Add:

```ts
private readonly durableMemory = new AIUserMemoryRetrievalService();
```

Extend result:

```ts
readonly usedDurableMemory: boolean;
readonly durableMemoryCount: number;
```

Insert durable memory after the base system prompt and before compact context:

```ts
messages.push({ role: "system", content: systemPrompt });

const durable = await this.durableMemory.retrieve({
  currentUserMessage: input.currentUserMessage,
  conversationId: input.conversationId,
  mode: input.mode,
  maxMemories: 10,
  maxTokens: 2000,
});

if (durable.contextBlock.length > 0) {
  messages.push({ role: "system", content: durable.contextBlock });
}

if (fullCompact) {
  messages.push({ role: "system", content: COMPACT_PREAMBLE + fullCompact.summary });
} else if (sessionMemory) {
  messages.push({ role: "system", content: COMPACT_PREAMBLE + sessionMemory.summary });
}
```

Setting:

- Skip durable retrieval if `USER_AI_MEMORY_INJECTION === "false"`.

Conflict rule:

- Durable memory is advisory.
- Current user message wins over memory.
- Recent conversation history wins over older durable memory when they conflict.

### Auto-Dream Trigger

Modify `AIChatQueryEngine`.

Dependency:

```ts
autoDreamService?: AIAutoDreamService;
```

In `handleLoopResult()` after a completed assistant turn:

```ts
if (this.autoDreamService) {
  this.autoDreamService
    .evaluateAfterChatTurn({
      conversationId,
      reason: "assistant_turn_completed",
    })
    .catch((err) =>
      console.error("[ai-auto-dream] chat trigger failed:", err)
    );
}
```

This mirrors the existing compact enqueue pattern and must not block the streamed completion event.

### IPC Singleton Wiring

Modify `ai-chat-v2-ipc.ts`.

Add singleton:

```ts
let autoDreamService: AIAutoDreamService | null = null;

function getAutoDreamService(): AIAutoDreamService {
  if (!autoDreamService) {
    const tokenService = new Token();
    autoDreamService = new AIAutoDreamService({
      completeChat: (request) => new AiChatApi().openAIChatCompletion(request),
      isAIEnabled: () => tokenService.getValue(USER_AI_ENABLED) === "true",
      isAutoDreamEnabled: () =>
        tokenService.getValue(USER_AI_AUTO_DREAM) === "true",
    });
  }
  return autoDreamService;
}
```

Pass it into `AIChatQueryEngine`.

## Agent Runtime Integration

Modify `AgentRuntime`.

Add optional dependency:

```ts
export interface AgentRuntimeDeps {
  autoDreamService?: AIAutoDreamService;
  // existing deps...
}
```

After `saveResult()` and `setStatus("completed")`, enqueue:

```ts
deps?.autoDreamService
  ?.evaluateAfterAgentTask({
    agentTaskId,
    reason: "agent_task_completed",
  })
  .catch((err) =>
    console.error("[ai-auto-dream] agent trigger failed:", err)
  );
```

Do not wait for the run to complete before returning `AgentResult`.

If `AgentRuntime` is created from IPC or another service, that caller should pass the same singleton `AIAutoDreamService` used by AI Chat V2. If no service is passed, agent tasks still run normally.

## Manual Memory IPC

Create `src/main-process/communication/ai-user-memory-ipc.ts`.

Handlers:

- `AI_USER_MEMORY_LIST`
- `AI_USER_MEMORY_CREATE`
- `AI_USER_MEMORY_UPDATE`
- `AI_USER_MEMORY_ARCHIVE`
- `AI_USER_MEMORY_DELETE`
- `AI_USER_MEMORY_RUN_AUTO_DREAM`
- `AI_USER_MEMORY_AUTO_DREAM_STATUS`

Rules:

- List/create/update/archive/delete are not model calls. They may be available without `USER_AI_ENABLED` if product wants memory management visible while AI is disabled.
- `RUN_AUTO_DREAM` must check `USER_AI_ENABLED` before parsing request data.
- All handlers parse JSON safely and return `CommonMessage<T>`.
- No handler should use TypeORM repositories directly.

Example:

```ts
async function handleRunAutoDream(
  data: string
): Promise<CommonMessage<AIMemoryConsolidationRunView | null>> {
  if (!isAIEnabled()) {
    return denied("AI functionality is only available to subscribers.");
  }
  try {
    const req = data ? JSON.parse(data) : {};
    const result = await getAutoDreamService().runNow({
      force: req.force === true,
      reason: "manual_ipc",
    });
    return ok(result);
  } catch (err) {
    return denied(userSafeError(err));
  }
}
```

Register the new IPC file in `src/main-process/communication/index.ts`.

## AI Tool For "Remember This"

The PRD recommends a controlled tool/service path instead of text-only detection.

Add a built-in skill/tool later:

```ts
remember_user_memory({
  type?: "preference" | "fact" | "decision" | "reference" | "workflow",
  title: string,
  content: string
})
```

Execution path:

```text
AIChatQueryLoop tool call
  -> SkillExecutor
  -> controlled built-in memory skill
  -> AIUserMemoryService.rememberFromAssistant()
  -> AIUserMemoryModule.createMemory()
```

The tool should require normal tool permission unless product explicitly chooses always-allow. This gives users control before an assistant writes durable memory.

## Prompt Injection Text

Use a stable system block:

```text
Durable user memory:
The following memories are saved for this local user database.
Use them as background context. Do not reveal or quote them unless relevant.
If they conflict with the current user message, follow the current user message.

- [preference] Concise replies: User prefers direct engineering explanations.
- [decision] Auto-dream storage: Use SQLite structured memory scoped to the local user database.
```

Do not call it "project memory" because scope is local user database, not workspace.

## Auto-Dream Prompt Shape

System prompt:

```text
You consolidate durable user memories for AiFetchly.
Only save facts useful in future sessions.
Allowed types: preference, fact, decision, reference, workflow.
Do not store secrets, credentials, tokens, cookies, passwords, private scraped data, or full transcript text.
Prefer explicit user statements over inferred facts.
Merge duplicates with existing memories.
Archive memories contradicted by newer explicit user statements.
Return JSON only.
```

User prompt sections:

1. Existing active memories.
2. Existing archived/contradicted memories only if needed for contradiction checks, capped tightly.
3. Source packets from AI Chat V2 conversations.
4. Source packets from agent tasks and tool calls.
5. Required JSON schema.

Output parser should reject markdown-wrapped JSON unless the normalizer can safely strip a single fenced code block.

## Source Boundary Strategy

V1 should use consolidation run timestamps.

Algorithm:

1. `latest = runModule.getLatestSuccessfulRun()`.
2. `reviewedSince = latest?.reviewedThrough ?? null`.
3. `reviewedThrough = new Date()` before collecting sources.
4. Collect chat conversations and agent tasks updated after `reviewedSince` and before or equal to `reviewedThrough`.
5. Store both timestamps on the run.

This avoids adding per-source cursor tables in v1.

Limitations:

- If one source fails model validation, the whole run may fail and retry later.
- If a source changes while a run is active, it will be picked up in the next run because `reviewedThrough` was captured before collection.

Future improvement:

- Add `ai_memory_source_reviews` for per-source boundaries if runs become large.

## Locking And Failure Recovery

Use two locks:

1. In-process promise lock in `AIAutoDreamService`.
2. Durable `running` run row in `ai_memory_consolidation_runs`.

Before starting:

- Mark `running` runs older than 1 hour as failed.
- If a non-stale running run exists, skip.

Repeated failures:

- Count recent failed runs since latest success.
- If 3 consecutive failures happened within 10 minutes, skip automatic runs.
- Manual `runNow({ force: true })` bypasses this failure circuit.

This is a circuit breaker, meaning a small failure-control mechanism that stops repeatedly doing work that is already failing.

## Data Retention And Deletion

Conversation clear:

- Do not delete durable memories by default when an AI Chat V2 conversation is cleared.
- Source attribution may point to a deleted conversation. UI should show the source as unavailable.

Agent task deletion:

- If task deletion is added later, do not delete durable memories by default.

Memory delete:

- Archive is default.
- Permanent delete hard deletes `ai_user_memories` row.
- No tombstone in v1.

Consolidation run retention:

- Keep all runs initially.
- Later, prune successful runs older than 90 days while preserving the latest 20.

## Security And Privacy Controls

Required filters before model prompt:

- Cap source text length.
- Strip known secret-like values from source packets.
- Exclude raw cookies and auth metadata.
- Exclude large scraped lead/contact result payloads.
- Summarize tool results by `resultSummary`, not raw result JSON.

Required filters after model output:

- Validate JSON schema.
- Reject unknown types/status values.
- Reject memory content with credential-like patterns.
- Drop overlong content.
- Drop source ids that were not in the run input.

Trust boundary:

- Treat auto-dream model output as untrusted.
- Validate before every database write.
- Do not use model-provided SQL, paths, or executable content.

## Testing Plan

### Module Tests

`test/vitest/main/modules/AIUserMemoryModule.test.ts`

- creates memory with valid fields.
- rejects invalid type.
- rejects empty title/content.
- clamps confidence.
- lists active memories by default.
- archives memory.
- hard deletes memory.
- marks memories used.

`test/vitest/main/modules/AIMemoryConsolidationRunModule.test.ts`

- creates running run.
- completes run with counts.
- fails run with error.
- returns latest successful run.
- detects running run.
- marks stale running run failed.

### Service Tests

`test/vitest/main/service/AIUserMemoryRetrievalService.test.ts`

- excludes archived and contradicted memories.
- respects max memory count.
- respects max token budget.
- ranks preference above low-relevance fact when both match.
- marks injected memories used.
- produces stable context block ordering.

`test/vitest/main/service/AIAutoDreamPromptBuilder.test.ts`

- builds prompt with existing memories and source packets.
- parses valid JSON output.
- rejects invalid JSON.
- drops invalid memory type.
- drops secret-like content.
- drops source ids outside the input packet.

`test/vitest/main/service/AIAutoDreamService.test.ts`

- skips when AI disabled.
- skips when auto-dream disabled.
- skips when time gate has not passed.
- skips when changed source count is too small.
- force run bypasses time/source gates.
- serializes concurrent runs.
- creates, updates, and archives memories from validated model output.
- records failed run on model error.
- does not throw from chat/agent evaluate methods.

### IPC Tests

`test/vitest/main/ipc/ai-user-memory-ipc.test.ts`

- list delegates to service/module.
- create validates request payload.
- update validates memory id.
- archive delegates to module.
- delete delegates to module.
- run auto-dream checks AI enabled before parsing request data.
- status returns latest run.

### Integration Tests

- `AIChatContextAssembler` includes durable memory before compact context.
- `AIChatContextAssembler` skips memory when `USER_AI_MEMORY_INJECTION === "false"`.
- `AIChatQueryEngine` triggers auto-dream after completed turn.
- `AgentRuntime` triggers auto-dream after completed task.

## Rollout Sequence

### Step 1: Data Layer

Add entities, types, models, modules, and SqliteDb registration.

Verification:

- `yarn vue-check`
- module tests

Commit:

```bash
git add src/entity src/entityTypes src/model src/modules src/config/SqliteDb.ts test/vitest/main/modules
git commit -m "feat(ai-memory): add durable user memory data layer"
```

### Step 2: Manual Memory IPC

Add service, IPC handlers, channels, preload allowlist, and frontend API.

Verification:

- IPC tests.
- Manual invoke through renderer API or test harness.

Commit:

```bash
git commit -m "feat(ai-memory): add manual memory management IPC"
```

### Step 3: Retrieval Injection

Add retrieval service and wire `AIChatContextAssembler`.

Verification:

- assembler tests.
- retrieval service tests.

Commit:

```bash
git commit -m "feat(ai-memory): inject durable memories into AI chat context"
```

### Step 4: Auto-Dream From Chat

Add prompt builder, source collector chat path, auto-dream service, and query engine trigger.

Verification:

- service tests.
- query engine trigger tests.

Commit:

```bash
git commit -m "feat(ai-memory): consolidate chat history with auto-dream"
```

### Step 5: Auto-Dream From Agent Tasks

Add source collector agent path, `AgentTaskModule` listing methods, and `AgentRuntime` trigger.

Verification:

- service tests for agent sources.
- runtime trigger test.

Commit:

```bash
git commit -m "feat(ai-memory): include agent tasks in auto-dream consolidation"
```

### Step 6: UI

Add memory management UI and settings/status views. Update all languages.

Verification:

- `yarn vue-check`
- UI tests if available.
- manual language smoke test.

Commit:

```bash
git commit -m "feat(ai-memory): add memory management UI"
```

## Open Risks

1. **Memory quality drift:** Auto-dream may save low-value facts. Mitigation: auto-dream disabled by default until UI exists, strict taxonomy, confidence, user archive/delete.
2. **Sensitive data leakage:** Source transcripts may contain credentials or scraped private data. Mitigation: pre-prompt source filters, post-output validation, conservative source caps.
3. **Prompt bloat:** Durable memory could crowd out current context. Mitigation: 10 memory and 2,000 token cap.
4. **Duplicate memories:** The model may create repeated facts. Mitigation: prompt existing memories, model update path, deterministic duplicate check by normalized title/content.
5. **Hidden background cost:** Auto-dream calls model in the background. Mitigation: 24-hour and 5-source gates, disabled default, status UI.
6. **Stale source boundaries:** Timestamp-only review can retry whole failed batches. Mitigation: acceptable for v1, add per-source review table later if needed.

## Implementation Checklist

- [ ] Add `USER_AI_AUTO_DREAM` and `USER_AI_MEMORY_INJECTION`.
- [ ] Add `AIUserMemoryEntity`.
- [ ] Add `AIMemoryConsolidationRunEntity`.
- [ ] Register entities in `SqliteDb.ts`.
- [ ] Add shared memory types.
- [ ] Add memory and run models.
- [ ] Add memory and run modules.
- [ ] Add manual memory service.
- [ ] Add manual memory IPC and frontend API.
- [ ] Add retrieval service.
- [ ] Wire durable memory into `AIChatContextAssembler`.
- [ ] Add auto-dream source collector.
- [ ] Add auto-dream prompt builder and validator.
- [ ] Add auto-dream service.
- [ ] Wire chat completion trigger.
- [ ] Wire agent task completion trigger.
- [ ] Add tests by layer.
- [ ] Add memory management UI and all language translations.

