# Workspace Memory - Technical Design

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Created date | 2026-07-06 |
| Status | Draft |
| Owner | AiFetchly engineering |
| Source PRD | `docs/prd/workspace-memory-prd.md` |
| Follow-on designs | `docs/prd/workspace-memory-ai-tools-technical-design.md`, `docs/prd/workspace-memory-auto-remember-technical-design.md`, `docs/prd/portable-workspace-memory-technical-design.md` |
| Primary code paths | `src/service/AIChatContextAssembler.ts`, `src/service/AIAutoDreamService.ts`, `src/service/AIAutoDreamSourceCollector.ts`, `src/modules/WorkspaceModule.ts`, `src/service/WorkspaceResolver.ts`, `src/main-process/communication/ai-workspace-ipc.ts`, `src/main-process/communication/ai-user-memory-ipc.ts`, `src/views/components/aiChatV2/AiChatV2.vue` |

## 1. Purpose

This document translates `docs/prd/workspace-memory-prd.md` into an implementation-facing technical design.

Workspace memory adds a durable project-scoped memory layer between conversation memory and global user memory:

```text
Conversation memory
  -> one conversation only

Workspace memory
  -> all conversations using the same approved workspace

User memory
  -> current local user database
```

The design keeps AiFetchly's current architecture:

```text
Renderer
  -> src/views/api/*
  -> Electron IPC handler
  -> Service / Module
  -> Model
  -> TypeORM Entity
  -> SQLite
```

The main technical rule is simple: **workspace memory is always filtered by a main-process resolved `workspaceKey`**. Renderer-supplied workspace keys are display hints only and must not decide memory access.

## 2. Current Behavior To Preserve

### 2.1 AI Gate

Any IPC operation that calls an AI model must check `USER_AI_ENABLED` before parsing or doing work.

Examples that must keep this behavior:

- manual workspace auto-dream run
- natural-language "remember this" extraction
- background consolidation

Non-AI CRUD operations can remain available if product wants memory management to work without an AI call, but handlers that are part of AI Chat surfaces should still follow the existing local convention when required by nearby handlers.

### 2.2 Database Layering

Database logic must stay out of IPC handlers.

Required layering:

```text
ai-workspace-memory-ipc.ts
  -> AIWorkspaceMemoryService
  -> AIWorkspaceMemoryModule
  -> AIWorkspaceMemoryModel
  -> AIWorkspaceMemoryEntity
```

Workers and child processes must never instantiate workspace memory models.

### 2.3 Existing User Memory

Existing `AIUserMemoryEntity`, `AIUserMemoryRetrievalService`, and `AIAutoDreamService` must continue to work for global user memory.

Workspace memory must not be stored in `ai_user_memories`. Keep the scope boundary visible in code, tests, and UI.

### 2.4 Existing Workspace Approval

Existing workspace records are conversation-bound and have `pending`, `approved`, or `revoked` state.

Workspace memory retrieval and writes require:

- a conversation ID
- an approved active workspace for that conversation
- a resolved canonical workspace key

## 3. Target Architecture

### 3.1 High-Level Flow

```text
AI Chat V2 submit message
  -> AIChatContextAssembler.assemble()
  -> WorkspaceResolver.resolveWithKey(conversationId)
  -> AIWorkspaceMemoryRetrievalService.retrieve()
  -> inject workspace memory block
  -> AIUserMemoryRetrievalService.retrieve()
  -> inject global user memory block
  -> compact/session memory
  -> recent messages
  -> model call
```

### 3.2 Manual Memory Flow

```text
Renderer workspace memory panel
  -> src/views/api/aiWorkspaceMemory.ts
  -> ai-workspace-memory-ipc.ts
  -> WorkspaceMemoryContextResolver.resolveForConversation()
  -> AIWorkspaceMemoryService
  -> AIWorkspaceMemoryModule
  -> AIWorkspaceMemoryModel
  -> ai_workspace_memories
```

### 3.3 Auto-Dream Flow

```text
Chat turn or agent task completes
  -> shared auto-dream service evaluates trigger
  -> source collector loads changed chats/tasks
  -> workspace resolver groups source packets by workspaceKey
  -> model consolidates workspace memory candidates
  -> parser validates workspaceKey, type, source, and secret filters
  -> AIWorkspaceMemoryModule applies create/update/archive
  -> run record is completed or failed
```

### 3.4 New Components

Add these implementation files:

```text
src/entity/AIWorkspaceMemory.entity.ts
src/entity/AIWorkspaceMemoryConsolidationRun.entity.ts
src/entityTypes/aiWorkspaceMemoryTypes.ts
src/model/AIWorkspaceMemory.model.ts
src/model/AIWorkspaceMemoryConsolidationRun.model.ts
src/modules/AIWorkspaceMemoryModule.ts
src/modules/AIWorkspaceMemoryConsolidationRunModule.ts
src/service/WorkspaceKeyService.ts
src/service/WorkspaceMemoryContextResolver.ts
src/service/AIWorkspaceMemoryService.ts
src/service/AIWorkspaceMemoryRetrievalService.ts
src/service/AIWorkspaceAutoDreamService.ts
src/service/AIWorkspaceAutoDreamPromptBuilder.ts
src/main-process/communication/ai-workspace-memory-ipc.ts
src/views/api/aiWorkspaceMemory.ts
```

Modify these existing files:

```text
src/config/SqliteDb.ts
src/config/channellist.ts
src/config/settinggroupInit.ts
src/main-process/communication/index.ts
src/service/WorkspaceResolver.ts
src/modules/WorkspaceModule.ts
src/service/AIChatContextAssembler.ts
src/service/AIAutoDreamFactory.ts
src/service/AIAutoDreamSourceCollector.ts
src/views/components/aiChatV2/AiChatV2.vue
src/views/components/aiChatV2/WorkspaceBadge.vue
src/views/lang/{en,zh,es,fr,de,ja}.ts
```

## 4. Workspace Key Resolution

### 4.1 Why A New Service

`WorkspaceResolver` currently answers: "does this conversation have an approved workspace?"

Workspace memory also needs: "what stable project identity should memories use?"

Add a dedicated `WorkspaceKeyService` and let `WorkspaceResolver` call it. This keeps path canonicalization and hashing testable.

### 4.2 Workspace Key Types

Add to `src/entityTypes/workspaceTypes.ts` or a new small type file:

```typescript
export interface ResolvedWorkspaceWithKey {
  readonly workspaceId: number;
  readonly conversationId: string;
  readonly rootPath: string;
  readonly canonicalRootPath: string;
  readonly workspaceKey: string;
  readonly displayName: string;
}
```

### 4.3 WorkspaceKeyService

Create `src/service/WorkspaceKeyService.ts`.

```typescript
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

export interface WorkspaceKeyResolution {
  readonly inputRootPath: string;
  readonly canonicalRootPath: string;
  readonly workspaceKey: string;
  readonly displayName: string;
  readonly gitRootDetected: boolean;
}

export class WorkspaceKeyService {
  async resolve(rootPath: string): Promise<WorkspaceKeyResolution> {
    const realInput = await fs.realpath(rootPath);
    const gitRoot = this.findGitRoot(realInput);
    const canonicalRootPath = gitRoot ?? realInput;
    const workspaceKey = this.hashWorkspacePath(canonicalRootPath);

    return {
      inputRootPath: realInput,
      canonicalRootPath,
      workspaceKey,
      displayName: path.basename(canonicalRootPath),
      gitRootDetected: gitRoot !== null,
    };
  }

  hashWorkspacePath(canonicalRootPath: string): string {
    const digest = crypto
      .createHash("sha256")
      .update(canonicalRootPath)
      .digest("hex")
      .slice(0, 32);
    return `ws_${digest}`;
  }

  private findGitRoot(realPath: string): string | null {
    const result = spawnSync("git", ["-C", realPath, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      timeout: 2000,
    });
    if (result.status !== 0) return null;
    const out = result.stdout.trim();
    return out.length > 0 ? path.resolve(out) : null;
  }
}
```

Implementation notes:

- Use `spawnSync` only in the main process.
- Treat Git lookup failure as normal.
- Never execute a shell string. Use argument arrays.
- Do not read repository config for memory paths.
- Tests should mock `spawnSync` and `fs.realpath`.

### 4.4 WorkspaceResolver Update

Extend `src/service/WorkspaceResolver.ts`.

```typescript
export class WorkspaceResolver {
  async resolve(conversationId: string): Promise<ResolvedWorkspace | null> {
    // Existing behavior remains.
  }

  async resolveWithKey(
    conversationId: string
  ): Promise<ResolvedWorkspaceWithKey | null> {
    if (!conversationId) return null;

    const module = new WorkspaceModule();
    const record = await module.getActiveWorkspace(conversationId);
    if (!record || record.approvalState !== "approved") return null;

    const key = await new WorkspaceKeyService().resolve(record.rootPath);
    return {
      workspaceId: record.id,
      conversationId: record.conversationId,
      rootPath: record.rootPath,
      canonicalRootPath: key.canonicalRootPath,
      workspaceKey: key.workspaceKey,
      displayName: record.label ?? key.displayName,
    };
  }
}
```

### 4.5 Optional Workspace Table Enhancement

The first implementation can compute `workspaceKey` on demand. For performance and audit, later add columns to `workspace`:

- `workspaceKey`
- `canonicalRootPath`
- `gitRootDetected`

If added now, populate them during `WorkspaceModule.setWorkspace()` and `approveWorkspace()`.

## 5. Data Model

### 5.1 AIWorkspaceMemoryEntity

Create `src/entity/AIWorkspaceMemory.entity.ts`.

```typescript
import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("ai_workspace_memories")
@Index("idx_ai_workspace_memories_memory_id", ["memoryId"], { unique: true })
@Index("idx_ai_workspace_memories_workspace", ["workspaceKey"])
@Index("idx_ai_workspace_memories_workspace_status", ["workspaceKey", "status"])
@Index("idx_ai_workspace_memories_workspace_type", ["workspaceKey", "type"])
@Index("idx_ai_workspace_memories_source_conversation", ["sourceConversationId"])
@Index("idx_ai_workspace_memories_source_agent_task", ["sourceAgentTaskId"])
@Index("idx_ai_workspace_memories_last_used", ["lastUsedAt"])
@Index("idx_ai_workspace_memories_updated", ["updatedAt"])
export class AIWorkspaceMemoryEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  memoryId: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  workspaceKey: string;

  @Order(3)
  @Column("varchar", { length: 1024, nullable: false })
  workspaceRoot: string;

  @Order(4)
  @Column("varchar", { length: 30, nullable: false })
  type: string;

  @Order(5)
  @Column("varchar", { length: 200, nullable: false })
  title: string;

  @Order(6)
  @Column("text", { nullable: false })
  content: string;

  @Order(7)
  @Column("varchar", { length: 30, nullable: false, default: "active" })
  status: string;

  @Order(8)
  @Column("int", { nullable: false, default: 100 })
  confidence: number;

  @Order(9)
  @Column("varchar", { length: 30, nullable: true })
  sourceKind?: string | null;

  @Order(10)
  @Column("varchar", { length: 100, nullable: true })
  sourceConversationId?: string | null;

  @Order(11)
  @Column("varchar", { length: 100, nullable: true })
  sourceAgentTaskId?: string | null;

  @Order(12)
  @Column("simple-json", { nullable: true })
  sourceMessageIds?: string[] | null;

  @Order(13)
  @Column("datetime", { nullable: true })
  lastUsedAt?: Date | null;

  @Order(14)
  @Column("simple-json", { nullable: true })
  metadata?: Record<string, unknown> | null;
}
```

### 5.2 AIWorkspaceMemoryConsolidationRunEntity

Use a separate run table. The existing `AIMemoryConsolidationRunEntity` is user-memory specific enough that adding workspace fields would make status screens ambiguous.

Create `src/entity/AIWorkspaceMemoryConsolidationRun.entity.ts`.

```typescript
@Entity("ai_workspace_memory_consolidation_runs")
@Index("idx_workspace_memory_runs_run_id", ["runId"], { unique: true })
@Index("idx_workspace_memory_runs_status", ["status"])
@Index("idx_workspace_memory_runs_workspace", ["workspaceKey"])
@Index("idx_workspace_memory_runs_started", ["startedAt"])
@Index("idx_workspace_memory_runs_finished", ["finishedAt"])
export class AIWorkspaceMemoryConsolidationRunEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("varchar", { length: 100, nullable: false, unique: true })
  runId: string;

  @Column("varchar", { length: 30, nullable: false })
  status: string;

  @Column("varchar", { length: 100, nullable: true })
  workspaceKey?: string | null;

  @Column("datetime", { nullable: false })
  startedAt: Date;

  @Column("datetime", { nullable: true })
  finishedAt?: Date | null;

  @Column("datetime", { nullable: true })
  reviewedSince?: Date | null;

  @Column("datetime", { nullable: true })
  reviewedThrough?: Date | null;

  @Column("int", { nullable: false, default: 0 })
  chatConversationsReviewed: number;

  @Column("int", { nullable: false, default: 0 })
  agentTasksReviewed: number;

  @Column("int", { nullable: false, default: 0 })
  memoriesCreated: number;

  @Column("int", { nullable: false, default: 0 })
  memoriesUpdated: number;

  @Column("int", { nullable: false, default: 0 })
  memoriesArchived: number;

  @Column("varchar", { length: 100, nullable: true })
  model?: string | null;

  @Column("text", { nullable: true })
  errorMessage?: string | null;
}
```

### 5.3 SqliteDb Registration

Add both new entities to `src/config/SqliteDb.ts`:

```typescript
import { AIWorkspaceMemoryEntity } from "@/entity/AIWorkspaceMemory.entity";
import { AIWorkspaceMemoryConsolidationRunEntity } from "@/entity/AIWorkspaceMemoryConsolidationRun.entity";
```

Then include them in the TypeORM entity list.

## 6. Entity Types

Create `src/entityTypes/aiWorkspaceMemoryTypes.ts`.

```typescript
export type AIWorkspaceMemoryType =
  | "project"
  | "decision"
  | "workflow"
  | "convention"
  | "reference"
  | "warning";

export type AIWorkspaceMemoryStatus =
  | "active"
  | "archived"
  | "contradicted";

export type AIWorkspaceMemorySourceKind =
  | "manual"
  | "chat_v2"
  | "agent_task"
  | "auto_dream";

export type AIWorkspaceMemoryConsolidationStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AIWorkspaceMemoryView {
  readonly id: number;
  readonly memoryId: string;
  readonly workspaceKey: string;
  readonly workspaceRoot: string;
  readonly type: AIWorkspaceMemoryType;
  readonly title: string;
  readonly content: string;
  readonly status: AIWorkspaceMemoryStatus;
  readonly confidence: number;
  readonly sourceKind?: AIWorkspaceMemorySourceKind;
  readonly sourceConversationId?: string;
  readonly sourceAgentTaskId?: string;
  readonly sourceMessageIds?: string[];
  readonly lastUsedAt?: string;
  readonly metadata?: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AIWorkspaceMemoryCreateInput {
  readonly conversationId: string;
  readonly type: AIWorkspaceMemoryType;
  readonly title: string;
  readonly content: string;
  readonly sourceKind?: AIWorkspaceMemorySourceKind;
  readonly sourceConversationId?: string;
  readonly sourceAgentTaskId?: string;
  readonly sourceMessageIds?: string[];
  readonly confidence?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface AIWorkspaceMemoryUpdateInput {
  readonly conversationId: string;
  readonly memoryId: string;
  readonly type?: AIWorkspaceMemoryType;
  readonly title?: string;
  readonly content?: string;
  readonly status?: AIWorkspaceMemoryStatus;
  readonly confidence?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface AIWorkspaceMemorySearchInput {
  readonly conversationId: string;
  readonly query?: string;
  readonly type?: AIWorkspaceMemoryType;
  readonly status?: AIWorkspaceMemoryStatus;
  readonly limit?: number;
  readonly offset?: number;
}

export interface AIWorkspaceMemoryInjectionResult {
  readonly memories: AIWorkspaceMemoryView[];
  readonly tokenEstimate: number;
  readonly contextBlock: string;
}
```

Add constant arrays and type guards like `aiUserMemoryTypes.ts`.

Important: renderer requests include `conversationId`, not `workspaceKey`. The main process resolves the key.

## 7. Model Layer

Create `src/model/AIWorkspaceMemory.model.ts`.

### 7.1 Create Fields

```typescript
export interface AIWorkspaceMemoryCreateFields {
  readonly memoryId: string;
  readonly workspaceKey: string;
  readonly workspaceRoot: string;
  readonly type: string;
  readonly title: string;
  readonly content: string;
  readonly status: string;
  readonly confidence: number;
  readonly sourceKind?: string | null;
  readonly sourceConversationId?: string | null;
  readonly sourceAgentTaskId?: string | null;
  readonly sourceMessageIds?: string[] | null;
  readonly lastUsedAt?: Date | null;
  readonly metadata?: Record<string, unknown> | null;
}
```

### 7.2 Required Methods

```typescript
export class AIWorkspaceMemoryModel extends BaseDb {
  public repository: Repository<AIWorkspaceMemoryEntity>;

  async create(input: AIWorkspaceMemoryCreateFields): Promise<AIWorkspaceMemoryEntity>;

  async getByMemoryId(memoryId: string): Promise<AIWorkspaceMemoryEntity | null>;

  async getByWorkspaceAndMemoryId(
    workspaceKey: string,
    memoryId: string
  ): Promise<AIWorkspaceMemoryEntity | null>;

  async list(input: {
    readonly workspaceKey: string;
    readonly query?: string;
    readonly type?: string;
    readonly status?: string;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<AIWorkspaceMemoryEntity[]>;

  async listActiveForRetrieval(
    workspaceKey: string,
    limit: number
  ): Promise<AIWorkspaceMemoryEntity[]>;

  async updateByWorkspaceAndMemoryId(
    workspaceKey: string,
    memoryId: string,
    updates: Partial<AIWorkspaceMemoryEntity>
  ): Promise<AIWorkspaceMemoryEntity>;

  async archive(workspaceKey: string, memoryId: string): Promise<void>;

  async deleteByWorkspaceAndMemoryId(
    workspaceKey: string,
    memoryId: string
  ): Promise<number>;

  async markUsed(
    workspaceKey: string,
    memoryIds: readonly string[],
    usedAt: Date
  ): Promise<void>;
}
```

All update/delete methods must include `workspaceKey` in the query. This prevents a memory ID from being operated on across scopes if a caller bug passes the wrong conversation ID.

### 7.3 Worker Guard

Mirror the repository guard pattern from existing architecture guidance:

```typescript
if (process.env.WORKER_TYPE) {
  throw new Error(
    "Direct database access from worker process is not allowed. " +
      "Worker should send data to main process via IPC."
  );
}
```

This is a safety net. Normal imports should already avoid model usage in workers.

## 8. Module Layer

Create `src/modules/AIWorkspaceMemoryModule.ts`.

### 8.1 Responsibilities

The module owns:

- field validation
- memory ID generation
- closed taxonomy enforcement
- content length caps
- confidence clamping
- secret-like content rejection for automatic writes
- workspace-scoped model calls
- view conversion

The module does not resolve a conversation into a workspace. It accepts a trusted resolved workspace context from the service layer.

### 8.2 Public API

```typescript
export interface WorkspaceMemoryScope {
  readonly workspaceKey: string;
  readonly workspaceRoot: string;
}

export class AIWorkspaceMemoryModule extends BaseModule {
  async createMemory(
    scope: WorkspaceMemoryScope,
    input: Omit<AIWorkspaceMemoryCreateInput, "conversationId">
  ): Promise<AIWorkspaceMemoryView>;

  async updateMemory(
    scope: WorkspaceMemoryScope,
    input: Omit<AIWorkspaceMemoryUpdateInput, "conversationId">
  ): Promise<AIWorkspaceMemoryView>;

  async archiveMemory(
    scope: WorkspaceMemoryScope,
    memoryId: string
  ): Promise<void>;

  async deleteMemory(
    scope: WorkspaceMemoryScope,
    memoryId: string
  ): Promise<number>;

  async getMemory(
    scope: WorkspaceMemoryScope,
    memoryId: string
  ): Promise<AIWorkspaceMemoryView | null>;

  async listMemories(
    scope: WorkspaceMemoryScope,
    input: Omit<AIWorkspaceMemorySearchInput, "conversationId">
  ): Promise<AIWorkspaceMemoryView[]>;

  async listActiveForRetrieval(
    scope: WorkspaceMemoryScope,
    limit?: number
  ): Promise<AIWorkspaceMemoryView[]>;

  async markMemoriesUsed(
    scope: WorkspaceMemoryScope,
    memoryIds: readonly string[],
    usedAt?: Date
  ): Promise<void>;
}
```

### 8.3 Validation Constants

Use these caps for parity with user memory unless product later changes them:

```typescript
const MIN_TITLE_LEN = 1;
const MAX_TITLE_LEN = 200;
const MAX_CONTENT_LEN = 8000;
const MAX_SOURCE_MESSAGE_IDS = 100;
```

For automatic extraction, reject secret-like content. Manual user-created memory may still warn or block depending on product decision. Recommended first implementation: block secret-like content for both manual and automatic workspace memory.

## 9. Service Layer

### 9.1 WorkspaceMemoryContextResolver

Create `src/service/WorkspaceMemoryContextResolver.ts`.

This service is the trust boundary between renderer requests and memory scope.

```typescript
export interface WorkspaceMemoryContext {
  readonly conversationId: string;
  readonly workspaceId: number;
  readonly workspaceKey: string;
  readonly workspaceRoot: string;
  readonly displayName: string;
}

export class WorkspaceMemoryContextResolver {
  async resolveForConversation(
    conversationId: string
  ): Promise<WorkspaceMemoryContext | null> {
    const resolved = await new WorkspaceResolver().resolveWithKey(conversationId);
    if (!resolved) return null;
    return {
      conversationId,
      workspaceId: resolved.workspaceId,
      workspaceKey: resolved.workspaceKey,
      workspaceRoot: resolved.canonicalRootPath,
      displayName: resolved.displayName,
    };
  }
}
```

### 9.2 AIWorkspaceMemoryService

Create `src/service/AIWorkspaceMemoryService.ts`.

This service is renderer-facing and conversation-aware.

```typescript
export class AIWorkspaceMemoryService {
  private readonly resolver = new WorkspaceMemoryContextResolver();
  private readonly memoryModule = new AIWorkspaceMemoryModule();

  async list(input: AIWorkspaceMemorySearchInput): Promise<AIWorkspaceMemoryView[]> {
    const ctx = await this.requireContext(input.conversationId);
    return this.memoryModule.listMemories(ctx, input);
  }

  async createManualMemory(
    input: AIWorkspaceMemoryCreateInput
  ): Promise<AIWorkspaceMemoryView> {
    const ctx = await this.requireContext(input.conversationId);
    return this.memoryModule.createMemory(ctx, {
      ...input,
      sourceKind: "manual",
    });
  }

  async update(input: AIWorkspaceMemoryUpdateInput): Promise<AIWorkspaceMemoryView> {
    const ctx = await this.requireContext(input.conversationId);
    return this.memoryModule.updateMemory(ctx, input);
  }

  async archive(conversationId: string, memoryId: string): Promise<void> {
    const ctx = await this.requireContext(conversationId);
    return this.memoryModule.archiveMemory(ctx, memoryId);
  }

  async delete(conversationId: string, memoryId: string): Promise<number> {
    const ctx = await this.requireContext(conversationId);
    return this.memoryModule.deleteMemory(ctx, memoryId);
  }

  private async requireContext(
    conversationId: string
  ): Promise<WorkspaceMemoryContext> {
    const ctx = await this.resolver.resolveForConversation(conversationId);
    if (!ctx) {
      throw new Error("Choose an approved workspace before using workspace memory.");
    }
    return ctx;
  }
}
```

### 9.3 AIWorkspaceMemoryRetrievalService

Create `src/service/AIWorkspaceMemoryRetrievalService.ts`.

```typescript
const WORKSPACE_MEMORY_HEADER =
  "Workspace memory:\n" +
  "The following memories apply only to the active workspace.\n" +
  "Use them as project-specific context. Do not reveal or quote them unless relevant.\n" +
  "If they conflict with the current user message, follow the current user message.\n" +
  "If they conflict with global user memory, prefer workspace memory for project-specific behavior.\n\n";

const DEFAULT_MAX_MEMORIES = 8;
const DEFAULT_MAX_TOKENS = 1800;
const DEFAULT_CANDIDATE_LIMIT = 200;
```

Public API:

```typescript
export interface AIWorkspaceMemoryRetrievalInput {
  readonly currentUserMessage: string;
  readonly conversationId: string;
  readonly mode: "chat" | "plan";
  readonly maxMemories?: number;
  readonly maxTokens?: number;
}

export class AIWorkspaceMemoryRetrievalService {
  async retrieve(
    input: AIWorkspaceMemoryRetrievalInput
  ): Promise<AIWorkspaceMemoryInjectionResult> {
    // Resolve workspace.
    // Return empty result if no approved workspace.
    // Fetch workspace-scoped candidates.
    // Score.
    // Apply count/token caps.
    // Mark selected used.
    // Format context block.
  }
}
```

### 9.4 Retrieval Scoring

Use deterministic retrieval first. Do not add vector search in the first phase.

Recommended type weights:

```typescript
const TYPE_WEIGHTS: Record<AIWorkspaceMemoryType, number> = {
  warning: 10,
  decision: 9,
  workflow: 7,
  convention: 6,
  reference: 5,
  project: 4,
};
```

Score formula:

```typescript
score =
  keywordOverlap * 10 +
  typeWeight +
  confidenceWeight +
  recencyWeight +
  lastUsedWeight;
```

Where:

- title token overlap counts 2 points per token
- content token overlap counts 1 point per token
- confidence contributes `Math.round(confidence / 20)`
- recency contributes 3 for <= 1 day, 2 for <= 7 days, 1 for <= 30 days
- last-used contributes 1

Tokenization can initially match `AIUserMemoryRetrievalService`:

```typescript
for (const raw of lower.split(/[^a-z0-9]+/)) {
  if (raw.length >= 3) out.add(raw);
}
```

## 10. Context Assembly Integration

Modify `src/service/AIChatContextAssembler.ts`.

### 10.1 New Dependency

Add:

```typescript
import { AIWorkspaceMemoryRetrievalService } from "@/service/AIWorkspaceMemoryRetrievalService";
import { ai_workspace_memory_injection_enabled } from "@/config/settinggroupInit";
```

Add field:

```typescript
private readonly workspaceMemory = new AIWorkspaceMemoryRetrievalService();
```

### 10.2 Prompt Order

Current order:

```text
base prompt
custom directive
active workspace
durable user memory
compact/session memory
recent messages
current user message
```

Target order:

```text
base prompt
custom directive
active workspace
workspace memory
durable user memory
compact/session memory
recent messages
current user message
```

### 10.3 Result Shape

Extend `AIChatContextAssembleResult`:

```typescript
readonly usedWorkspaceMemory: boolean;
readonly workspaceMemoryCount: number;
```

Keep existing durable memory fields.

### 10.4 Error Handling

Workspace memory retrieval failure must not break chat.

```typescript
try {
  const workspaceMem = await this.workspaceMemory.retrieve({
    currentUserMessage: input.currentUserMessage,
    conversationId: input.conversationId,
    mode: input.mode,
    maxMemories: 8,
    maxTokens: 1800,
  });
  if (workspaceMem.contextBlock.length > 0) {
    messages.push({ role: "system", content: workspaceMem.contextBlock });
  }
} catch (err) {
  console.error("[ai-chat-context] workspace memory retrieval failed:", err);
}
```

Do not fall back to global user memory if workspace memory fails. Global user memory has its own retrieval path.

## 11. Settings

Add to `src/config/settinggroupInit.ts`:

```typescript
export const ai_workspace_memory_injection_enabled =
  "user_ai_workspace_memory_injection";
export const ai_workspace_auto_dream_enabled =
  "user_ai_workspace_auto_dream";
export const ai_workspace_manual_memory_enabled =
  "user_ai_workspace_manual_memory";
```

Add the settings to the existing `ai_preferences` group:

```typescript
{
  key: ai_workspace_memory_injection_enabled,
  value: "1",
  description: "ai-workspace-memory-injection-description",
  type: "toggle",
},
{
  key: ai_workspace_auto_dream_enabled,
  value: "1",
  description: "ai-workspace-auto-dream-description",
  type: "toggle",
},
{
  key: ai_workspace_manual_memory_enabled,
  value: "1",
  description: "ai-workspace-manual-memory-description",
  type: "toggle",
},
```

Read settings through `SystemSettingModule`. Follow current behavior: if a setting row is absent, default enabled unless product changes the default.

## 12. IPC Design

### 12.1 Channel Names

Add to `src/config/channellist.ts`:

```typescript
export const AI_WORKSPACE_MEMORY_LIST = "ai:workspace-memory:list";
export const AI_WORKSPACE_MEMORY_CREATE = "ai:workspace-memory:create";
export const AI_WORKSPACE_MEMORY_UPDATE = "ai:workspace-memory:update";
export const AI_WORKSPACE_MEMORY_ARCHIVE = "ai:workspace-memory:archive";
export const AI_WORKSPACE_MEMORY_DELETE = "ai:workspace-memory:delete";
export const AI_WORKSPACE_MEMORY_RUN_AUTO_DREAM =
  "ai:workspace-memory:auto-dream:run";
export const AI_WORKSPACE_MEMORY_AUTO_DREAM_STATUS =
  "ai:workspace-memory:auto-dream:status";
```

Settings may use existing system settings APIs if available. Do not add duplicate settings IPC unless needed by UI ergonomics.

### 12.2 Handler

Create `src/main-process/communication/ai-workspace-memory-ipc.ts`.

Pattern should mirror `ai-user-memory-ipc.ts`, with one difference: every CRUD input must include `conversationId`, and the service resolves the workspace.

```typescript
export function registerAIWorkspaceMemoryIpcHandlers(): void {
  ipcMain.handle(AI_WORKSPACE_MEMORY_LIST, async (_e, data: unknown) => {
    try {
      const input = safeParse<AIWorkspaceMemorySearchInput>(data);
      if (!input || typeof input.conversationId !== "string") {
        return denied("conversationId is required");
      }
      const result = await getWorkspaceMemoryService().list(input);
      return ok(result);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "list failed");
    }
  });

  ipcMain.handle(AI_WORKSPACE_MEMORY_RUN_AUTO_DREAM, async (_e, data: unknown) => {
    if (!isAIEnabled()) {
      return denied("AI functionality is only available to subscribers.");
    }
    // parse and run manual workspace auto-dream
  });
}
```

### 12.3 Handler Registration

Update `src/main-process/communication/index.ts`:

```typescript
import { registerAIWorkspaceMemoryIpcHandlers } from "@/main-process/communication/ai-workspace-memory-ipc";

registerAIWorkspaceMemoryIpcHandlers();
```

### 12.4 Test Reset

Expose a test-only reset function:

```typescript
export function _resetAIWorkspaceMemorySingletonsForTesting(): void {
  workspaceMemoryService = null;
}
```

## 13. Renderer API

Create `src/views/api/aiWorkspaceMemory.ts`.

```typescript
import {
  AI_WORKSPACE_MEMORY_LIST,
  AI_WORKSPACE_MEMORY_CREATE,
  AI_WORKSPACE_MEMORY_UPDATE,
  AI_WORKSPACE_MEMORY_ARCHIVE,
  AI_WORKSPACE_MEMORY_DELETE,
  AI_WORKSPACE_MEMORY_RUN_AUTO_DREAM,
  AI_WORKSPACE_MEMORY_AUTO_DREAM_STATUS,
} from "@/config/channellist";

export async function listWorkspaceMemories(
  input: AIWorkspaceMemorySearchInput
): Promise<AIWorkspaceMemoryView[]> {
  const resp = await windowInvoke(AI_WORKSPACE_MEMORY_LIST, input);
  return Array.isArray(resp) ? resp : [];
}
```

Match existing `views/api/aiUserMemory.ts` wrapper style and `CommonMessage<T>` handling.

## 14. UI Integration

### 14.1 Component Structure

Add one focused component rather than expanding `AiChatV2.vue` heavily.

Recommended files:

```text
src/views/components/aiChatV2/WorkspaceMemoryPanel.vue
src/views/components/aiChatV2/WorkspaceMemoryEditorDialog.vue
src/views/components/aiChatV2/WorkspaceMemoryStatusBadge.vue
```

Update:

```text
src/views/components/aiChatV2/WorkspaceBadge.vue
src/views/components/aiChatV2/AiChatV2.vue
```

### 14.2 UI States

Required states:

- no approved workspace
- loading memories
- empty memory list
- active memory list
- archived/contradicted filter
- create dialog
- edit dialog
- delete confirmation
- auto-dream running
- auto-dream failed

### 14.3 Text And i18n

Add translations under a new `workspaceMemory` section in all language files.

Example keys:

```typescript
workspaceMemory: {
  title: "Workspace memory",
  noWorkspace: "Choose a workspace before using workspace memory.",
  empty: "No workspace memories yet.",
  create: "Create memory",
  edit: "Edit memory",
  archive: "Archive",
  delete: "Delete",
  typeDecision: "Decision",
  typeWorkflow: "Workflow",
  injectionEnabled: "Workspace memory injection",
  autoDreamEnabled: "Workspace auto-dream",
}
```

No hardcoded user-facing English should be added to Vue templates without translation fallback.

## 15. Auto-Dream Design

### 15.1 Separate Service

Create a separate `AIWorkspaceAutoDreamService` instead of overloading `AIAutoDreamService`.

Reason:

- user-memory and workspace-memory prompts differ
- workspace grouping is required
- run metrics are separate
- failure isolation is clearer

### 15.2 Shared Factory

Update `src/service/AIAutoDreamFactory.ts` to expose both singletons:

```typescript
export function getSharedAutoDreamService(): AIAutoDreamService;
export function getSharedWorkspaceAutoDreamService(): AIWorkspaceAutoDreamService;
```

Both should share:

- `AiChatApi().openAIChatCompletion`
- `USER_AI_ENABLED` check
- `SystemSettingModule` setting lookup

Each service should keep its own `inFlight` lock.

### 15.3 Source Packet Extension

Extend source collection output with workspace context.

```typescript
export interface WorkspaceAwareAutoDreamSourcePacket extends AutoDreamSourcePacket {
  readonly workspace?: {
    readonly workspaceId: number;
    readonly workspaceKey: string;
    readonly workspaceRoot: string;
    readonly displayName: string;
  };
}
```

In `AIAutoDreamSourceCollector`, resolve workspace per conversation:

```typescript
const workspace = await workspaceResolver.resolveWithKey(convId);
```

**Agent tasks:** `AgentTaskEntity` has `parentConversationId` and `agentConversationId`. Resolve workspace in this order:

1. `parentConversationId` if present
2. else `agentConversationId`
3. `WorkspaceResolver.resolveWithKey(conversationId)`
4. if no approved workspace, leave `workspace` unset (packet may still feed user auto-dream)

Do not infer workspace from tool paths or `taskPacket`. The original phase-1 skip ("no conversation link") is obsolete. Implementation: `docs/prd/workspace-memory-auto-remember-technical-design.md` §5.

### 15.4 Grouping

The workspace auto-dream service should group packets:

```typescript
const groups = new Map<string, WorkspacePacketGroup>();

for (const packet of packets) {
  if (!packet.workspace) continue;
  const key = packet.workspace.workspaceKey;
  // append packet to group
}
```

Run consolidation per group. A single scheduled evaluation may create several run records, one per workspace group.

### 15.5 Prompt Builder

Create `src/service/AIWorkspaceAutoDreamPromptBuilder.ts`.

System prompt:

```text
You consolidate workspace memories for AiFetchly.
Only save memories useful for future work in the provided workspace.
Allowed types: project, decision, workflow, convention, reference, warning.
Do not store secrets, credentials, tokens, cookies, passwords, private scraped data, raw file contents, or full transcript text.
Do not store facts that can be read directly from source files.
Prefer explicit user statements over inferred facts.
Merge duplicates with existing memories.
Archive memories contradicted by newer explicit user statements.
If a completed task established a durable procedure, create or update a workflow.
If a tool or command failed for a workspace-specific reason that would recur, create a warning.
Skip transient failures (rate limit, network, user cancel). Never paste CSV, contact lists, or raw logs.
Return JSON only.
```

Failure-oriented prompt text and the capped Layer C path: `docs/prd/workspace-memory-auto-remember-technical-design.md` §6–7.

User prompt includes:

- workspace key
- workspace root display
- active workspace memories
- source packets for that workspace only

### 15.6 Parser

The parser must reject:

- invalid JSON
- invalid memory type
- invalid source kind
- invalid source ID
- invalid workspace key
- title/content over length caps
- secret-like content
- updates/archive for memory IDs outside the active workspace memory set

Parser output:

```typescript
export interface WorkspaceAutoDreamParseResult {
  readonly ok: boolean;
  readonly create: WorkspaceAutoDreamCreateEntry[];
  readonly update: WorkspaceAutoDreamUpdateEntry[];
  readonly archive: WorkspaceAutoDreamArchiveEntry[];
  readonly error?: string;
}
```

### 15.7 Trigger Integration

After a chat turn completes, current code can continue to evaluate global user memory. Add workspace memory evaluation alongside it.

Ordering:

1. Visible chat response completes.
2. Global user auto-dream evaluates in background.
3. Workspace auto-dream evaluates in background.

Failures are logged only. They must not alter the chat response.

Also trigger workspace auto-dream after agent `failed` and `timeout` (not `cancelled`). Failed tasks are workspace sources; they stay completed-only for **user** auto-dream. Durable failures may take a separate capped warning path that must not advance the batch `reviewedThrough` watermark. See `docs/prd/workspace-memory-auto-remember-technical-design.md`.

## 16. Security Design

### 16.1 Scope Enforcement

All privileged operations must follow this sequence:

```text
input.conversationId
  -> WorkspaceResolver.resolveWithKey(conversationId)
  -> null means deny/empty
  -> module call with workspaceKey
  -> model query with workspaceKey in WHERE clause
```

Never trust these from renderer:

- `workspaceKey`
- `workspaceRoot`
- `workspaceId` for memory scoping

The renderer can display them, but the main process resolves them.

### 16.2 Secret Filtering

Create a shared helper if current user-memory parser has duplicated patterns:

```text
src/service/MemorySecretFilter.ts
```

Move or mirror the current patterns:

```typescript
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{10,}/,
  /api[_-]?key/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /password/i,
  /cookie/i,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
  /[A-Za-z0-9+/]{40,}={0,2}/,
];
```

Use it in:

- `AIWorkspaceMemoryModule`
- `AIWorkspaceAutoDreamPromptBuilder` parser
- existing user-memory parser if refactoring is low-risk

### 16.3 Logging

Never log full memory content in normal logs. Log IDs, counts, status, and error messages.

Allowed:

```text
[workspace-memory] retrieval selected 3 memories for ws_abc...
```

Avoid:

```text
[workspace-memory] selected memory content: ...
```

## 17. Error Handling

### 17.1 CRUD Errors

Return `CommonMessage<T>` errors through IPC:

- missing conversation: `conversationId is required`
- no workspace: `Choose an approved workspace before using workspace memory.`
- invalid type: `Invalid workspace memory type`
- memory not found: `Workspace memory not found`

### 17.2 Retrieval Errors

Retrieval errors should be logged and degraded to empty context.

Reason: memory improves answers but should not prevent the chat turn.

### 17.3 Auto-Dream Errors

Auto-dream errors should:

- mark run as failed
- store a short `errorMessage`
- log the error without memory content
- not throw into chat completion

## 18. Migration And Compatibility

### 18.1 No Existing Data Migration

Workspace memory starts empty. No existing `ai_user_memories` rows should be copied automatically.

Reason:

- user memories lack reliable workspace keys
- copying can cause cross-workspace leakage
- users can manually promote relevant memories later

### 18.2 Entity Registration Migration

Adding entities to TypeORM registration creates tables according to the app's existing schema initialization behavior.

Verify with:

- app startup on fresh DB
- app startup on existing DB
- `yarn init` if required by current migration flow

### 18.3 Backward Compatibility

Existing AI Chat V2 behavior remains unchanged when:

- no workspace is selected
- no workspace memories exist
- workspace memory injection setting is disabled
- workspace memory retrieval fails

## 19. Test Plan

### 19.1 Unit Tests

Place tests under `test/vitest/main/` or `test/vitest/utilitycode/` depending on dependency weight.

Add:

```text
test/vitest/main/WorkspaceKeyService.test.ts
test/vitest/main/modules/AIWorkspaceMemoryModule.test.ts
test/vitest/main/AIWorkspaceMemoryRetrievalService.test.ts
test/vitest/main/AIWorkspaceAutoDreamPromptBuilder.test.ts
```

Coverage:

- stable hash from canonical path
- Git root preferred when present
- Git failure falls back to real path
- type guard rejects invalid types
- create/list/update/archive/delete
- list filters by workspace key
- update/delete include workspace key
- retrieval excludes archived and contradicted memories
- scoring order
- token cap
- secret filter
- parser rejects invalid workspace key

### 19.2 IPC Tests

Add:

```text
test/vitest/main/ai-workspace-memory-ipc.test.ts
```

Coverage:

- list requires conversation ID
- create requires approved workspace
- update cannot affect memory from another workspace
- archive/delete cannot affect memory from another workspace
- manual auto-dream checks `USER_AI_ENABLED` before parsing
- forged workspace key in payload is ignored

### 19.3 Context Assembler Tests

Extend existing context assembler tests or add:

```text
test/vitest/main/AIChatContextAssemblerWorkspaceMemory.test.ts
```

Coverage:

- workspace memory appears after active workspace block
- workspace memory appears before global user memory
- no approved workspace injects no workspace memory
- disabled setting injects no workspace memory
- retrieval failure does not fail assembly

### 19.4 Auto-Dream Tests

Coverage:

- groups packets by workspace key
- skips packets without workspace
- parser rejects invalid key
- creates memories through workspace module
- archives only same-workspace memories
- failed model output marks run failed

### 19.5 Manual QA

Manual checklist:

1. Open AI Chat V2 and choose workspace A.
2. Create a workspace memory.
3. Start a new conversation with workspace A and confirm the memory is available.
4. Start a conversation with workspace B and confirm the memory is absent.
5. Archive the memory and confirm it is not injected.
6. Disable workspace memory injection and confirm no workspace memory block appears.
7. Run workspace auto-dream manually and inspect status.

## 20. Implementation Phases

### Phase 1: Schema And Manual CRUD

Files:

- `AIWorkspaceMemory.entity.ts`
- `aiWorkspaceMemoryTypes.ts`
- `AIWorkspaceMemory.model.ts`
- `AIWorkspaceMemoryModule.ts`
- `WorkspaceKeyService.ts`
- `WorkspaceMemoryContextResolver.ts`
- `AIWorkspaceMemoryService.ts`
- `ai-workspace-memory-ipc.ts`
- `aiWorkspaceMemory.ts`

Acceptance:

- CRUD works for approved workspace.
- CRUD fails for no workspace.
- workspace isolation tests pass.

### Phase 2: Retrieval And Context Injection

Files:

- `AIWorkspaceMemoryRetrievalService.ts`
- `AIChatContextAssembler.ts`
- `settinggroupInit.ts`

Acceptance:

- workspace memory is injected in the correct order.
- cross-workspace leakage tests pass.
- disabled setting blocks injection.

### Phase 3: UI

Files:

- `WorkspaceMemoryPanel.vue`
- `WorkspaceMemoryEditorDialog.vue`
- `WorkspaceBadge.vue`
- `AiChatV2.vue`
- language files

Acceptance:

- user can list/create/edit/archive/delete.
- no-workspace and empty states are clear.
- all supported language files have keys.

### Phase 4: Workspace Auto-Dream

Files:

- `AIWorkspaceAutoDreamService.ts`
- `AIWorkspaceAutoDreamPromptBuilder.ts`
- `AIWorkspaceMemoryConsolidationRun.entity.ts`
- `AIWorkspaceMemoryConsolidationRun.model.ts`
- `AIWorkspaceMemoryConsolidationRunModule.ts`
- `AIAutoDreamFactory.ts`
- `AIAutoDreamSourceCollector.ts`

Acceptance:

- grouped workspace consolidation works.
- invalid workspace key output is rejected.
- run status is visible.

### Phase 5: Auto-Remember After Task And Failure

Specified in `docs/prd/workspace-memory-auto-remember-technical-design.md`.

Files:

- `AIAutoDreamSourceCollector.ts` (agent workspace attach, failed statuses, chat tool-failure slice)
- `AgentTask.model.ts` / `AgentTaskModule.ts` (`listTerminalAfter`)
- `AgentRuntime.ts` (failed/timeout trigger)
- `AIWorkspaceAutoDreamService.ts` / prompt builders (Layer C)
- `AIWorkspaceMemoryConsolidationRun` (`runKind`)
- `WorkspaceFailureClassifier.ts`

Acceptance:

- agent packets with `parentConversationId` group by that workspace
- failed/timeout tasks can produce a capped `warning`
- Layer C does not move the Layer B cursor
- user auto-dream remains completed-only

## 21. Open Engineering Decisions

### 21.1 Worktree Sharing

Recommendation for v1: key by Git worktree root. Do not share memory across worktrees yet.

Reason: it is deterministic and avoids unexpected memory sharing. A later feature can add common-directory sharing as an explicit workspace setting.

### 21.2 Manual Remember Default Scope

Recommendation for v1: if an approved workspace is active, "remember this for this workspace" writes workspace scope. Plain "remember this" should keep using global user memory unless UI asks the user to choose scope.

Reason: explicit wording reduces accidental global or workspace writes.

### 21.3 Archived Memory Search

Recommendation for v1: default list shows active memories only. Add a status filter for archived and contradicted.

Reason: keeps normal UI clean while preserving auditability.

### 21.4 Per-Workspace Memory Limit

Recommendation for v1: no hard product cap, but retrieval caps remain strict. Add a soft warning in later UI if active memories exceed 200 for a workspace.

Reason: hard caps create surprising data loss. Retrieval already protects prompt size.

## 22. Definition Of Done

The feature is implementation-ready when:

1. `workspaceKey` resolution is deterministic and covered by tests.
2. Workspace memory CRUD is isolated by `workspaceKey`.
3. AI Chat V2 context assembly injects workspace memory before global user memory.
4. No workspace or revoked workspace means no workspace memory access.
5. Renderer-supplied workspace keys cannot control memory access.
6. User-facing UI text is translated in all supported language files.
7. Auto-dream validates workspace scope before writes.
8. Secret-like memory content is rejected by automatic extraction.
9. Test coverage includes no-cross-workspace retrieval and write attempts.
10. Existing global user memory behavior remains unchanged.

