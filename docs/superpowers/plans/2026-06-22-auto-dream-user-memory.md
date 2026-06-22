# Auto-Dream User Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable, per-local-user-database memory layer that persists across AI Chat V2 conversations and agent tasks, with manual CRUD, bounded prompt injection, and a gated background auto-dream consolidator.

**Architecture:** TypeORM entities → Model (data access) → Module (business logic) → Service (orchestration) → IPC handlers. Auto-dream is a singleton in the AI Chat V2 IPC file, wired into `AIChatQueryEngine` (post-turn) and `AgentRuntime` (post-task). Memory is scoped to the current local SQLite user database; workers never touch these tables.

**Tech Stack:** TypeScript, TypeORM, better-sqlite3, Vitest, Electron IPC, Vue 3 (frontend API only in this plan).

**Scope:** Milestones 1–5 of the PRD (data layer, manual IPC, retrieval injection, auto-dream from chat, auto-dream from agent tasks). UI (Milestone 6) and semantic sqlite-vec retrieval (Milestone 7) are deferred to follow-up plans. Auto-dream ships disabled-by-default (`USER_AI_AUTO_DREAM !== "true"`), so the feature is safe to land without UI.

**Reference docs:**
- PRD: `docs/superpowers/specs/2026-06-22-auto-dream-user-memory-prd.md`
- Technical design: `docs/superpowers/specs/2026-06-22-auto-dream-user-memory-technical-design.md`

---

## File Structure

**Create:**
- `src/entityTypes/aiUserMemoryTypes.ts` — closed taxonomy, statuses, source kinds, DTOs
- `src/entity/AIUserMemory.entity.ts` — `ai_user_memories` table
- `src/entity/AIMemoryConsolidationRun.entity.ts` — `ai_memory_consolidation_runs` table
- `src/model/AIUserMemory.model.ts` — TypeORM repository wrapper
- `src/model/AIMemoryConsolidationRun.model.ts` — run record repository wrapper
- `src/modules/AIUserMemoryModule.ts` — validation + memory CRUD business logic
- `src/modules/AIMemoryConsolidationRunModule.ts` — run lifecycle (start/complete/fail/recover)
- `src/service/AIUserMemoryService.ts` — manual ops + assistant "remember this" path
- `src/service/AIUserMemoryRetrievalService.ts` — deterministic scoring + bounded context block
- `src/service/AIAutoDreamPromptBuilder.ts` — system/user prompt + JSON validator
- `src/service/AIAutoDreamSourceCollector.ts` — chat + agent source packet builder
- `src/service/AIAutoDreamService.ts` — gated, locked, observable consolidation orchestrator
- `src/main-process/communication/ai-user-memory-ipc.ts` — IPC handlers
- `src/views/api/aiUserMemory.ts` — renderer-facing API wrapper
- `test/vitest/main/modules/AIUserMemoryModule.test.ts`
- `test/vitest/main/modules/AIMemoryConsolidationRunModule.test.ts`
- `test/vitest/main/service/AIUserMemoryRetrievalService.test.ts`
- `test/vitest/main/service/AIAutoDreamPromptBuilder.test.ts`
- `test/vitest/main/service/AIAutoDreamService.test.ts`
- `test/vitest/main/ipc/ai-user-memory-ipc.test.ts`

**Modify:**
- `src/config/SqliteDb.ts` — register both new entities
- `src/config/usersetting.ts` — add `USER_AI_AUTO_DREAM`, `USER_AI_MEMORY_INJECTION`
- `src/config/channellist.ts` — add 7 IPC channel constants
- `src/preload.ts` — allowlist the 7 channels
- `src/main-process/communication/index.ts` — register the new IPC file
- `src/main-process/communication/ai-chat-v2-ipc.ts` — singleton `AIAutoDreamService`, pass to query engine
- `src/service/AIChatQueryEngine.ts` — optional `autoDreamService` dep + post-turn trigger
- `src/service/AIChatContextAssembler.ts` — optional durable memory injection
- `src/service/AgentRuntime.ts` — optional `autoDreamService` dep + post-task trigger
- `src/modules/AgentTaskModule.ts` — add `listFinishedAfter(since, limit)` method
- `src/model/AgentTask.model.ts` — implement `listFinishedAfter` query

**Conventions (from existing code):**
- Entity extends `AuditableEntity` and uses `@Order(n)` from `@/entity/order.decorator`.
- Model extends `BaseDb`, constructs repository in constructor with `this.sqliteDb.connection.getRepository(Entity)`.
- Module extends `BaseModule`, creates Model with `this.dbpath` in constructor.
- Tests use Vitest, mock `@/modules/token` to point at a temp dir, and reset `SqliteDb` static state between tests.
- IPC handlers parse JSON safely, return `CommonMessage<T>`, and gate AI calls behind `USER_AI_ENABLED`.

---

## Task 1: Settings, Channels, and Shared Types

**Files:**
- Modify: `src/config/usersetting.ts` (append 2 keys)
- Modify: `src/config/channellist.ts` (append 7 channels)
- Create: `src/entityTypes/aiUserMemoryTypes.ts`

- [ ] **Step 1: Create the shared types file**

Create `src/entityTypes/aiUserMemoryTypes.ts`:

```ts
export type AIUserMemoryType =
  | "preference"
  | "fact"
  | "decision"
  | "reference"
  | "workflow";

export type AIUserMemoryStatus = "active" | "archived" | "contradicted";

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

export const AI_USER_MEMORY_TYPES: readonly AIUserMemoryType[] = [
  "preference",
  "fact",
  "decision",
  "reference",
  "workflow",
] as const;

export const AI_USER_MEMORY_STATUSES: readonly AIUserMemoryStatus[] = [
  "active",
  "archived",
  "contradicted",
] as const;

export const AI_USER_MEMORY_SOURCE_KINDS: readonly AIUserMemorySourceKind[] = [
  "manual",
  "chat_v2",
  "agent_task",
  "auto_dream",
] as const;

export const MEMORY_RUN_STATUSES: readonly AIMemoryConsolidationStatus[] = [
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export function isAIUserMemoryType(v: unknown): v is AIUserMemoryType {
  return typeof v === "string" && (AI_USER_MEMORY_TYPES as string[]).includes(v);
}

export function isAIUserMemoryStatus(v: unknown): v is AIUserMemoryStatus {
  return typeof v === "string" && (AI_USER_MEMORY_STATUSES as string[]).includes(v);
}

export function isAIUserMemorySourceKind(
  v: unknown
): v is AIUserMemorySourceKind {
  return (
    typeof v === "string" && (AI_USER_MEMORY_SOURCE_KINDS as string[]).includes(v)
  );
}

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

export interface AIMemoryConsolidationRunView {
  id: number;
  runId: string;
  status: AIMemoryConsolidationStatus;
  startedAt: string;
  finishedAt?: string;
  reviewedSince?: string;
  reviewedThrough?: string;
  chatConversationsReviewed: number;
  agentTasksReviewed: number;
  memoriesCreated: number;
  memoriesUpdated: number;
  memoriesArchived: number;
  model?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AIMemoryInjectionResult {
  memories: AIUserMemoryView[];
  tokenEstimate: number;
  contextBlock: string;
}
```

- [ ] **Step 2: Add user settings keys**

Open `src/config/usersetting.ts`. Find the line `export const USER_AI_ENABLED='user_ai_enabled'`. Immediately after that line, add:

```ts
export const USER_AI_AUTO_DREAM='user_ai_auto_dream'
export const USER_AI_MEMORY_INJECTION='user_ai_memory_injection'
```

- [ ] **Step 3: Add IPC channels**

Open `src/config/channellist.ts`. At the end of the file, append:

```ts
// AI user memory (durable cross-session memory)
export const AI_USER_MEMORY_LIST = "ai:user-memory:list";
export const AI_USER_MEMORY_CREATE = "ai:user-memory:create";
export const AI_USER_MEMORY_UPDATE = "ai:user-memory:update";
export const AI_USER_MEMORY_ARCHIVE = "ai:user-memory:archive";
export const AI_USER_MEMORY_DELETE = "ai:user-memory:delete";
export const AI_USER_MEMORY_RUN_AUTO_DREAM = "ai:user-memory:auto-dream:run";
export const AI_USER_MEMORY_AUTO_DREAM_STATUS = "ai:user-memory:auto-dream:status";
```

- [ ] **Step 4: Verify types compile**

Run: `yarn vue-check`
Expected: no new errors related to `aiUserMemoryTypes`, `usersetting`, or `channellist`.

- [ ] **Step 5: Commit**

```bash
git add src/entityTypes/aiUserMemoryTypes.ts src/config/usersetting.ts src/config/channellist.ts
git commit -m "feat(ai-memory): add types, settings keys, and IPC channels"
```

---

## Task 2: Entities + SqliteDb Registration

**Files:**
- Create: `src/entity/AIUserMemory.entity.ts`
- Create: `src/entity/AIMemoryConsolidationRun.entity.ts`
- Modify: `src/config/SqliteDb.ts`

- [ ] **Step 1: Create the memory entity**

Create `src/entity/AIUserMemory.entity.ts`:

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
  @Column("text", nullable: false })
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

- [ ] **Step 2: Create the consolidation run entity**

Create `src/entity/AIMemoryConsolidationRun.entity.ts`:

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
  @Column("text", nullable: true })
  errorMessage?: string | null;
}
```

- [ ] **Step 3: Register both entities in SqliteDb**

Open `src/config/SqliteDb.ts`. After the existing import of `AgentToolCallEntity` (around line 52), add:

```ts
import { AIUserMemoryEntity } from "@/entity/AIUserMemory.entity";
import { AIMemoryConsolidationRunEntity } from "@/entity/AIMemoryConsolidationRun.entity";
```

In the `entities` array of the `DataSource` constructor, after `AgentToolCallEntity,` add:

```ts
          AIUserMemoryEntity,
          AIMemoryConsolidationRunEntity,
```

- [ ] **Step 4: Verify the build picks up the entities**

Run: `yarn vue-check`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/entity/AIUserMemory.entity.ts src/entity/AIMemoryConsolidationRun.entity.ts src/config/SqliteDb.ts
git commit -m "feat(ai-memory): add durable memory and consolidation run entities"
```

---

## Task 3: AIUserMemoryModel

**Files:**
- Create: `src/model/AIUserMemory.model.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/modules/AIUserMemoryModel.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import { AIUserMemoryModel } from "@/model/AIUserMemory.model";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-user-mem-model");
beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        /* ignore */
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

describe("AIUserMemoryModel", () => {
  it("creates and fetches a memory by memoryId", async () => {
    const model = new AIUserMemoryModel(process.env.AIFETCHLY_TEST_DBPATH as string);
    await SqliteDb.ensureInitialized();
    const e = await model.create({
      memoryId: "mem-1",
      type: "preference",
      title: "Concise replies",
      content: "User prefers direct engineering explanations.",
      status: "active",
      confidence: 80,
    });
    expect(e.memoryId).toBe("mem-1");
    const fetched = await model.getByMemoryId("mem-1");
    expect(fetched?.title).toBe("Concise replies");
  });

  it("updates memory fields by memoryId", async () => {
    const model = new AIUserMemoryModel(process.env.AIFETCHLY_TEST_DBPATH as string);
    await SqliteDb.ensureInitialized();
    await model.create({
      memoryId: "mem-2",
      type: "fact",
      title: "t",
      content: "c",
      status: "active",
      confidence: 50,
    });
    const updated = await model.updateByMemoryId("mem-2", {
      content: "c2",
      confidence: 90,
    });
    expect(updated.content).toBe("c2");
    expect(updated.confidence).toBe(90);
  });

  it("archives memory by memoryId", async () => {
    const model = new AIUserMemoryModel(process.env.AIFETCHLY_TEST_DBPATH as string);
    await SqliteDb.ensureInitialized();
    await model.create({
      memoryId: "mem-3",
      type: "fact",
      title: "t",
      content: "c",
      status: "active",
      confidence: 50,
    });
    await model.archive("mem-3");
    const fetched = await model.getByMemoryId("mem-3");
    expect(fetched?.status).toBe("archived");
  });

  it("hard deletes by memoryId", async () => {
    const model = new AIUserMemoryModel(process.env.AIFETCHLY_TEST_DBPATH as string);
    await SqliteDb.ensureInitialized();
    await model.create({
      memoryId: "mem-4",
      type: "fact",
      title: "t",
      content: "c",
      status: "active",
      confidence: 50,
    });
    expect(await model.deleteByMemoryId("mem-4")).toBe(1);
    expect(await model.getByMemoryId("mem-4")).toBeNull();
  });

  it("lists active memories filtered by type", async () => {
    const model = new AIUserMemoryModel(process.env.AIFETCHLY_TEST_DBPATH as string);
    await SqliteDb.ensureInitialized();
    await model.create({
      memoryId: "mem-a",
      type: "preference",
      title: "a",
      content: "alpha",
      status: "active",
      confidence: 50,
    });
    await model.create({
      memoryId: "mem-b",
      type: "fact",
      title: "b",
      content: "beta",
      status: "archived",
      confidence: 50,
    });
    const active = await model.list({ status: "active" });
    expect(active.length).toBe(1);
    expect(active[0].memoryId).toBe("mem-a");
  });

  it("marks lastUsedAt for a set of memoryIds", async () => {
    const model = new AIUserMemoryModel(process.env.AIFETCHLY_TEST_DBPATH as string);
    await SqliteDb.ensureInitialized();
    await model.create({
      memoryId: "mem-u",
      type: "fact",
      title: "u",
      content: "used",
      status: "active",
      confidence: 50,
    });
    const at = new Date("2026-01-01T00:00:00Z");
    await model.markUsed(["mem-u"], at);
    const fetched = await model.getByMemoryId("mem-u");
    expect(fetched?.lastUsedAt?.toISOString()).toBe(at.toISOString());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/modules/AIUserMemoryModel.test.ts`
Expected: FAIL — `AIUserMemoryModel` module not found.

- [ ] **Step 3: Implement AIUserMemoryModel**

Create `src/model/AIUserMemory.model.ts`:

```ts
import { BaseDb } from "@/model/Basedb";
import { AIUserMemoryEntity } from "@/entity/AIUserMemory.entity";
import { Repository } from "typeorm";
import type { AIUserMemorySearchInput } from "@/entityTypes/aiUserMemoryTypes";

export interface AIUserMemoryCreateFields {
  memoryId: string;
  type: string;
  title: string;
  content: string;
  status: string;
  confidence: number;
  sourceKind?: string | null;
  sourceConversationId?: string | null;
  sourceAgentTaskId?: string | null;
  sourceMessageIds?: string[] | null;
  lastUsedAt?: Date | null;
  metadata?: Record<string, unknown> | null;
}

export class AIUserMemoryModel extends BaseDb {
  public repository: Repository<AIUserMemoryEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIUserMemoryEntity
    );
  }

  async create(
    input: AIUserMemoryCreateFields
  ): Promise<AIUserMemoryEntity> {
    const e = new AIUserMemoryEntity();
    e.memoryId = input.memoryId;
    e.type = input.type;
    e.title = input.title;
    e.content = input.content;
    e.status = input.status;
    e.confidence = input.confidence;
    if (input.sourceKind !== undefined) e.sourceKind = input.sourceKind;
    if (input.sourceConversationId !== undefined)
      e.sourceConversationId = input.sourceConversationId;
    if (input.sourceAgentTaskId !== undefined)
      e.sourceAgentTaskId = input.sourceAgentTaskId;
    if (input.sourceMessageIds !== undefined)
      e.sourceMessageIds = input.sourceMessageIds;
    if (input.lastUsedAt !== undefined) e.lastUsedAt = input.lastUsedAt;
    if (input.metadata !== undefined) e.metadata = input.metadata;
    return this.repository.save(e);
  }

  async getByMemoryId(
    memoryId: string
  ): Promise<AIUserMemoryEntity | null> {
    return this.repository.findOne({ where: { memoryId } });
  }

  async list(input: AIUserMemorySearchInput): Promise<AIUserMemoryEntity[]> {
    const qb = this.repository.createQueryBuilder("m");
    if (input.status) qb.andWhere("m.status = :status", { status: input.status });
    if (input.type) qb.andWhere("m.type = :type", { type: input.type });
    if (input.sourceKind)
      qb.andWhere("m.sourceKind = :sk", { sk: input.sourceKind });
    if (input.query) {
      const like = `%${escapeLike(input.query)}%`;
      qb.andWhere("(m.title LIKE :q OR m.content LIKE :q)", { q: like });
    }
    const limit = clampLimit(input.limit, 50, 200);
    const offset = Math.max(0, input.offset ?? 0);
    qb.orderBy("m.updatedAt", "DESC")
      .take(limit)
      .skip(offset);
    return qb.getMany();
  }

  async listActiveForRetrieval(limit: number): Promise<AIUserMemoryEntity[]> {
    return this.repository.find({
      where: { status: "active" },
      order: { updatedAt: "DESC" },
      take: Math.max(1, Math.min(limit, 200)),
    });
  }

  async updateByMemoryId(
    memoryId: string,
    updates: Partial<AIUserMemoryEntity>
  ): Promise<AIUserMemoryEntity> {
    await this.repository.update({ memoryId }, updates);
    const next = await this.getByMemoryId(memoryId);
    if (!next) throw new Error(`Memory not found: ${memoryId}`);
    return next;
  }

  async archive(memoryId: string): Promise<void> {
    await this.repository.update({ memoryId }, { status: "archived" });
  }

  async deleteByMemoryId(memoryId: string): Promise<number> {
    const r = await this.repository.delete({ memoryId });
    return r.affected ?? 0;
  }

  async markUsed(memoryIds: string[], usedAt: Date): Promise<void> {
    if (memoryIds.length === 0) return;
    await this.repository
      .createQueryBuilder()
      .update()
      .set({ lastUsedAt: usedAt })
      .where("memoryId IN (:...ids)", { ids: memoryIds })
      .execute();
  }
}

function escapeLike(s: string): string {
  return s.replace(/[%_]/g, (ch) => "\\" + ch);
}

function clampLimit(v: number | undefined, def: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return def;
  return Math.min(Math.floor(v), max);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run test/vitest/main/modules/AIUserMemoryModel.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model/AIUserMemory.model.ts test/vitest/main/modules/AIUserMemoryModel.test.ts
git commit -m "feat(ai-memory): add AIUserMemoryModel data access"
```

---

## Task 4: AIUserMemoryModule

**Files:**
- Create: `src/modules/AIUserMemoryModule.ts`
- Create: `test/vitest/main/modules/AIUserMemoryModule.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/modules/AIUserMemoryModule.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import { AIUserMemoryModule } from "@/modules/AIUserMemoryModule";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-user-mem-mod-mod");
beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        /* ignore */
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

describe("AIUserMemoryModule", () => {
  it("creates a memory and returns a view with a memoryId", async () => {
    const mod = new AIUserMemoryModule();
    await SqliteDb.ensureInitialized();
    const view = await mod.createMemory({
      type: "preference",
      title: "Concise replies",
      content: "User prefers concise answers.",
    });
    expect(view.memoryId).toMatch(/^mem-/);
    expect(view.type).toBe("preference");
    expect(view.status).toBe("active");
  });

  it("rejects an invalid type", async () => {
    const mod = new AIUserMemoryModule();
    await SqliteDb.ensureInitialized();
    await expect(
      mod.createMemory({
        type: "garbage" as never,
        title: "x",
        content: "y",
      })
    ).rejects.toThrow(/type/);
  });

  it("rejects empty title or content", async () => {
    const mod = new AIUserMemoryModule();
    await SqliteDb.ensureInitialized();
    await expect(
      mod.createMemory({ type: "fact", title: "   ", content: "x" })
    ).rejects.toThrow(/title/);
    await expect(
      mod.createMemory({ type: "fact", title: "x", content: "" })
    ).rejects.toThrow(/content/);
  });

  it("clamps confidence into 0..100", async () => {
    const mod = new AIUserMemoryModule();
    await SqliteDb.ensureInitialized();
    const v = await mod.createMemory({
      type: "fact",
      title: "x",
      content: "y",
      confidence: 250,
    });
    expect(v.confidence).toBe(100);
  });

  it("lists active memories by default and archives by id", async () => {
    const mod = new AIUserMemoryModule();
    await SqliteDb.ensureInitialized();
    const a = await mod.createMemory({
      type: "fact",
      title: "a",
      content: "aa",
    });
    await mod.createMemory({
      type: "fact",
      title: "b",
      content: "bb",
      sourceKind: "chat_v2",
    });
    const active = await mod.listMemories({});
    expect(active.length).toBe(2);
    await mod.archiveMemory(a.memoryId);
    const after = await mod.listMemories({});
    expect(after.length).toBe(1);
  });

  it("updates memory fields", async () => {
    const mod = new AIUserMemoryModule();
    await SqliteDb.ensureInitialized();
    const v = await mod.createMemory({
      type: "fact",
      title: "t",
      content: "c",
    });
    const u = await mod.updateMemory({
      memoryId: v.memoryId,
      content: "c2",
    });
    expect(u.content).toBe("c2");
  });

  it("deletes memory by memoryId", async () => {
    const mod = new AIUserMemoryModule();
    await SqliteDb.ensureInitialized();
    const v = await mod.createMemory({
      type: "fact",
      title: "t",
      content: "c",
    });
    expect(await mod.deleteMemory(v.memoryId)).toBe(1);
    expect(await mod.getMemory(v.memoryId)).toBeNull();
  });

  it("marks memories used by memoryId", async () => {
    const mod = new AIUserMemoryModule();
    await SqliteDb.ensureInitialized();
    const v = await mod.createMemory({
      type: "fact",
      title: "t",
      content: "c",
    });
    const at = new Date("2026-01-01T00:00:00Z");
    await mod.markMemoriesUsed([v.memoryId], at);
    const fetched = await mod.getMemory(v.memoryId);
    expect(fetched?.lastUsedAt).toBe(at.toISOString());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/modules/AIUserMemoryModule.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement AIUserMemoryModule**

Create `src/modules/AIUserMemoryModule.ts`:

```ts
import { BaseModule } from "@/modules/baseModule";
import {
  AIUserMemoryModel,
  AIUserMemoryCreateFields,
} from "@/model/AIUserMemory.model";
import { randomUUID } from "node:crypto";
import type {
  AIUserMemoryCreateInput,
  AIUserMemoryUpdateInput,
  AIUserMemorySearchInput,
  AIUserMemoryView,
} from "@/entityTypes/aiUserMemoryTypes";
import {
  isAIUserMemoryType,
  isAIUserMemoryStatus,
  isAIUserMemorySourceKind,
} from "@/entityTypes/aiUserMemoryTypes";

const MIN_TITLE_LEN = 1;
const MAX_TITLE_LEN = 200;
const MAX_CONTENT_LEN = 8000;
const MAX_SOURCE_MESSAGE_IDS = 100;

export class AIUserMemoryModule extends BaseModule {
  private memoryModel: AIUserMemoryModel;

  constructor() {
    super();
    this.memoryModel = new AIUserMemoryModel(this.dbpath);
  }

  async createMemory(
    input: AIUserMemoryCreateInput
  ): Promise<AIUserMemoryView> {
    validateCreate(input);
    const fields: AIUserMemoryCreateFields = {
      memoryId: `mem-${randomUUID()}`,
      type: input.type,
      title: input.title.trim(),
      content: input.content.trim(),
      status: "active",
      confidence: clampConfidence(input.confidence ?? 100),
    };
    if (input.sourceKind !== undefined && isAIUserMemorySourceKind(input.sourceKind)) {
      fields.sourceKind = input.sourceKind;
    } else {
      fields.sourceKind = "manual";
    }
    if (input.sourceConversationId !== undefined)
      fields.sourceConversationId = input.sourceConversationId;
    if (input.sourceAgentTaskId !== undefined)
      fields.sourceAgentTaskId = input.sourceAgentTaskId;
    if (input.sourceMessageIds !== undefined) {
      fields.sourceMessageIds = input.sourceMessageIds.slice(
        0,
        MAX_SOURCE_MESSAGE_IDS
      );
    }
    if (input.metadata !== undefined) fields.metadata = input.metadata;
    const e = await this.memoryModel.create(fields);
    return this.toView(e);
  }

  async updateMemory(
    input: AIUserMemoryUpdateInput
  ): Promise<AIUserMemoryView> {
    if (!input.memoryId) throw new Error("memoryId is required");
    const patch: Partial<{
      type: string;
      title: string;
      content: string;
      status: string;
      confidence: number;
      metadata: Record<string, unknown>;
    }> = {};
    if (input.type !== undefined) {
      if (!isAIUserMemoryType(input.type)) throw new Error("Invalid type");
      patch.type = input.type;
    }
    if (input.title !== undefined) {
      const t = input.title.trim();
      if (t.length < MIN_TITLE_LEN || t.length > MAX_TITLE_LEN)
        throw new Error("Invalid title length");
      patch.title = t;
    }
    if (input.content !== undefined) {
      const c = input.content.trim();
      if (c.length < 1 || c.length > MAX_CONTENT_LEN)
        throw new Error("Invalid content length");
      patch.content = c;
    }
    if (input.status !== undefined) {
      if (!isAIUserMemoryStatus(input.status))
        throw new Error("Invalid status");
      patch.status = input.status;
    }
    if (input.confidence !== undefined) {
      patch.confidence = clampConfidence(input.confidence);
    }
    if (input.metadata !== undefined) patch.metadata = input.metadata;
    const e = await this.memoryModel.updateByMemoryId(input.memoryId, patch);
    return this.toView(e);
  }

  async archiveMemory(memoryId: string): Promise<void> {
    await this.memoryModel.archive(memoryId);
  }

  async deleteMemory(memoryId: string): Promise<number> {
    return this.memoryModel.deleteByMemoryId(memoryId);
  }

  async getMemory(memoryId: string): Promise<AIUserMemoryView | null> {
    const e = await this.memoryModel.getByMemoryId(memoryId);
    return e ? this.toView(e) : null;
  }

  async listMemories(
    input: AIUserMemorySearchInput
  ): Promise<AIUserMemoryView[]> {
    const rows = await this.memoryModel.list({
      ...input,
      status: input.status ?? "active",
    });
    return rows.map((e) => this.toView(e));
  }

  async markMemoriesUsed(
    memoryIds: string[],
    usedAt: Date = new Date()
  ): Promise<void> {
    try {
      await this.memoryModel.markUsed(memoryIds, usedAt);
    } catch (err) {
      console.error("[ai-memory] markMemoriesUsed failed:", err);
    }
  }

  async listActiveForRetrieval(limit = 50): Promise<AIUserMemoryView[]> {
    const rows = await this.memoryModel.listActiveForRetrieval(limit);
    return rows.map((e) => this.toView(e));
  }

  private toView(e: {
    id: number;
    memoryId: string;
    type: string;
    title: string;
    content: string;
    status: string;
    confidence: number;
    sourceKind?: string | null;
    sourceConversationId?: string | null;
    sourceAgentTaskId?: string | null;
    sourceMessageIds?: string[] | null;
    lastUsedAt?: Date | null;
    metadata?: Record<string, unknown> | null;
    createdAt?: Date | null;
    updatedAt?: Date | null;
  }): AIUserMemoryView {
    return {
      id: e.id,
      memoryId: e.memoryId,
      type: e.type as AIUserMemoryView["type"],
      title: e.title,
      content: e.content,
      status: e.status as AIUserMemoryView["status"],
      confidence: e.confidence,
      sourceKind: (e.sourceKind ?? undefined) as AIUserMemoryView["sourceKind"],
      sourceConversationId: e.sourceConversationId ?? undefined,
      sourceAgentTaskId: e.sourceAgentTaskId ?? undefined,
      sourceMessageIds: e.sourceMessageIds ?? undefined,
      lastUsedAt: e.lastUsedAt?.toISOString(),
      metadata: e.metadata ?? undefined,
      createdAt: e.createdAt?.toISOString() ?? new Date(0).toISOString(),
      updatedAt: e.updatedAt?.toISOString() ?? new Date(0).toISOString(),
    };
  }
}

function validateCreate(input: AIUserMemoryCreateInput): void {
  if (!isAIUserMemoryType(input.type)) {
    throw new Error(`Invalid memory type: ${input.type}`);
  }
  const title = input.title.trim();
  if (title.length < MIN_TITLE_LEN || title.length > MAX_TITLE_LEN) {
    throw new Error("Invalid title length (1..200)");
  }
  const content = input.content.trim();
  if (content.length < 1 || content.length > MAX_CONTENT_LEN) {
    throw new Error("Invalid content length (1..8000)");
  }
}

function clampConfidence(v: number): number {
  if (!Number.isFinite(v)) return 100;
  return Math.max(0, Math.min(100, Math.round(v)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run test/vitest/main/modules/AIUserMemoryModule.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/AIUserMemoryModule.ts test/vitest/main/modules/AIUserMemoryModule.test.ts
git commit -m "feat(ai-memory): add AIUserMemoryModule with validation"
```

---

## Task 5: AIMemoryConsolidationRunModel + Module

**Files:**
- Create: `src/model/AIMemoryConsolidationRun.model.ts`
- Create: `src/modules/AIMemoryConsolidationRunModule.ts`
- Create: `test/vitest/main/modules/AIMemoryConsolidationRunModule.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/modules/AIMemoryConsolidationRunModule.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";
import { AIMemoryConsolidationRunModule } from "@/modules/AIMemoryConsolidationRunModule";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-mem-run-module");
beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  for (const f of fs.readdirSync(tmpDir)) {
    if (f.startsWith("scraper.db")) {
      try {
        fs.unlinkSync(path.join(tmpDir, f));
      } catch {
        /* ignore */
      }
    }
  }
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
});

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

describe("AIMemoryConsolidationRunModule", () => {
  it("starts a run and detects it as running", async () => {
    const mod = new AIMemoryConsolidationRunModule();
    await SqliteDb.ensureInitialized();
    const view = await mod.startRun({ reviewedSince: null });
    expect(view.status).toBe("running");
    const running = await mod.getRunningRun();
    expect(running?.runId).toBe(view.runId);
  });

  it("completes a run with counts", async () => {
    const mod = new AIMemoryConsolidationRunModule();
    await SqliteDb.ensureInitialized();
    const view = await mod.startRun({ reviewedSince: null });
    await mod.completeRun({
      runId: view.runId,
      chatConversationsReviewed: 3,
      agentTasksReviewed: 1,
      memoriesCreated: 2,
      memoriesUpdated: 1,
      memoriesArchived: 0,
      model: "test-model",
    });
    const latest = await mod.getLatestSuccessfulRun();
    expect(latest?.status).toBe("completed");
    expect(latest?.memoriesCreated).toBe(2);
    expect(latest?.model).toBe("test-model");
  });

  it("fails a run with an error message", async () => {
    const mod = new AIMemoryConsolidationRunModule();
    await SqliteDb.ensureInitialized();
    const view = await mod.startRun({ reviewedSince: null });
    await mod.failRun(view.runId, "model timeout");
    const running = await mod.getRunningRun();
    expect(running).toBeNull();
  });

  it("marks stale running runs as failed", async () => {
    const mod = new AIMemoryConsolidationRunModule();
    await SqliteDb.ensureInitialized();
    const view = await mod.startRun({ reviewedSince: null });
    // stale boundary is "now" — a running run started before now is stale
    const afterStart = new Date(Date.now() + 1000);
    const count = await mod.recoverStaleRunningRuns(afterStart);
    expect(count).toBe(1);
    expect(await mod.getRunningRun()).toBeNull();
    expect(view.runId).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/modules/AIMemoryConsolidationRunModule.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the model**

Create `src/model/AIMemoryConsolidationRun.model.ts`:

```ts
import { BaseDb } from "@/model/Basedb";
import { AIMemoryConsolidationRunEntity } from "@/entity/AIMemoryConsolidationRun.entity";
import { Repository, LessThan } from "typeorm";

export interface StartRunFields {
  runId: string;
  startedAt: Date;
  reviewedSince?: Date | null;
  reviewedThrough?: Date | null;
}

export interface CompleteRunFields {
  runId: string;
  finishedAt: Date;
  chatConversationsReviewed: number;
  agentTasksReviewed: number;
  memoriesCreated: number;
  memoriesUpdated: number;
  memoriesArchived: number;
  model?: string;
}

export class AIMemoryConsolidationRunModel extends BaseDb {
  public repository: Repository<AIMemoryConsolidationRunEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository = this.sqliteDb.connection.getRepository(
      AIMemoryConsolidationRunEntity
    );
  }

  async createRunning(
    input: StartRunFields
  ): Promise<AIMemoryConsolidationRunEntity> {
    const e = new AIMemoryConsolidationRunEntity();
    e.runId = input.runId;
    e.status = "running";
    e.startedAt = input.startedAt;
    e.chatConversationsReviewed = 0;
    e.agentTasksReviewed = 0;
    e.memoriesCreated = 0;
    e.memoriesUpdated = 0;
    e.memoriesArchived = 0;
    if (input.reviewedSince !== undefined) e.reviewedSince = input.reviewedSince;
    if (input.reviewedThrough !== undefined)
      e.reviewedThrough = input.reviewedThrough;
    return this.repository.save(e);
  }

  async completeRun(input: CompleteRunFields): Promise<void> {
    await this.repository.update(
      { runId: input.runId },
      {
        status: "completed",
        finishedAt: input.finishedAt,
        chatConversationsReviewed: input.chatConversationsReviewed,
        agentTasksReviewed: input.agentTasksReviewed,
        memoriesCreated: input.memoriesCreated,
        memoriesUpdated: input.memoriesUpdated,
        memoriesArchived: input.memoriesArchived,
        model: input.model ?? null,
        errorMessage: null,
      }
    );
  }

  async failRun(
    runId: string,
    errorMessage: string,
    finishedAt: Date
  ): Promise<void> {
    await this.repository.update(
      { runId },
      { status: "failed", finishedAt, errorMessage }
    );
  }

  async getLatestSuccessfulRun(): Promise<AIMemoryConsolidationRunEntity | null> {
    return this.repository.findOne({
      where: { status: "completed" },
      order: { finishedAt: "DESC" },
    });
  }

  async getRunningRun(): Promise<AIMemoryConsolidationRunEntity | null> {
    return this.repository.findOne({ where: { status: "running" } });
  }

  async markStaleRunningFailed(before: Date): Promise<number> {
    const r = await this.repository.update(
      { status: "running", startedAt: LessThan(before) },
      { status: "failed", finishedAt: new Date(), errorMessage: "stale_recovery" }
    );
    return r.affected ?? 0;
  }
}
```

- [ ] **Step 4: Implement the module**

Create `src/modules/AIMemoryConsolidationRunModule.ts`:

```ts
import { BaseModule } from "@/modules/baseModule";
import {
  AIMemoryConsolidationRunModel,
  CompleteRunFields,
} from "@/model/AIMemoryConsolidationRun.model";
import { randomUUID } from "node:crypto";
import type { AIMemoryConsolidationRunView } from "@/entityTypes/aiUserMemoryTypes";

export interface CompleteMemoryRunInput extends Omit<CompleteRunFields, "finishedAt"> {}

export class AIMemoryConsolidationRunModule extends BaseModule {
  private runModel: AIMemoryConsolidationRunModel;

  constructor() {
    super();
    this.runModel = new AIMemoryConsolidationRun.modelConstructor(this.dbpath);
  }

  async startRun(input: {
    reviewedSince?: Date | null;
    reviewedThrough?: Date | null;
  }): Promise<AIMemoryConsolidationRunView> {
    const e = await this.runModel.createRunning({
      runId: `run-${randomUUID()}`,
      startedAt: new Date(),
      reviewedSince: input.reviewedSince ?? null,
      reviewedThrough: input.reviewedThrough ?? null,
    });
    return this.toView(e);
  }

  async completeRun(input: CompleteMemoryRunInput): Promise<void> {
    await this.runModel.completeRun({
      ...input,
      finishedAt: new Date(),
    });
  }

  async failRun(runId: string, errorMessage: string): Promise<void> {
    await this.runModel.failRun(runId, errorMessage, new Date());
  }

  async getLatestSuccessfulRun(): Promise<AIMemoryConsolidationRunView | null> {
    const e = await this.runModel.getLatestSuccessfulRun();
    return e ? this.toView(e) : null;
  }

  async getRunningRun(): Promise<AIMemoryConsolidationRunView | null> {
    const e = await this.runModel.getRunningRun();
    return e ? this.toView(e) : null;
  }

  async recoverStaleRunningRuns(staleBefore: Date): Promise<number> {
    return this.runModel.markStaleRunningFailed(staleBefore);
  }

  private toView(e: {
    id: number;
    runId: string;
    status: string;
    startedAt: Date;
    finishedAt?: Date | null;
    reviewedSince?: Date | null;
    reviewedThrough?: Date | null;
    chatConversationsReviewed: number;
    agentTasksReviewed: number;
    memoriesCreated: number;
    memoriesUpdated: number;
    memoriesArchived: number;
    model?: string | null;
    errorMessage?: string | null;
    createdAt?: Date | null;
    updatedAt?: Date | null;
  }): AIMemoryConsolidationRunView {
    return {
      id: e.id,
      runId: e.runId,
      status: e.status as AIMemoryConsolidationRunView["status"],
      startedAt: e.startedAt.toISOString(),
      finishedAt: e.finishedAt?.toISOString(),
      reviewedSince: e.reviewedSince?.toISOString(),
      reviewedThrough: e.reviewedThrough?.toISOString(),
      chatConversationsReviewed: e.chatConversationsReviewed,
      agentTasksReviewed: e.agentTasksReviewed,
      memoriesCreated: e.memoriesCreated,
      memoriesUpdated: e.memoriesUpdated,
      memoriesArchived: e.memoriesArchived,
      model: e.model ?? undefined,
      errorMessage: e.errorMessage ?? undefined,
      createdAt: e.createdAt?.toISOString() ?? new Date(0).toISOString(),
      updatedAt: e.updatedAt?.toISOString() ?? new Date(0).toISOString(),
    };
  }
}
```

Wait — there is a typo above. Fix it: the `runModel` assignment should be `new AIMemoryConsolidationRunModel(this.dbpath)`. Replace the constructor body with the correct line.

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn vitest run test/vitest/main/modules/AIMemoryConsolidationRunModule.test.ts`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/model/AIMemoryConsolidationRun.model.ts src/modules/AIMemoryConsolidationRunModule.ts test/vitest/main/modules/AIMemoryConsolidationRunModule.test.ts
git commit -m "feat(ai-memory): add consolidation run model and module"
```

---

## Task 6: AIUserMemoryRetrievalService

**Files:**
- Create: `src/service/AIUserMemoryRetrievalService.ts`
- Create: `test/vitest/main/service/AIUserMemoryRetrievalService.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/AIUserMemoryRetrievalService.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { AIUserMemoryRetrievalService } from "@/service/AIUserMemoryRetrievalService";
import type { AIUserMemoryView } from "@/entityTypes/aiUserMemoryTypes";

const mockListActive = vi.fn();
const mockMarkUsed = vi.fn();

vi.mock("@/modules/AIUserMemoryModule", () => ({
  AIUserMemoryModule: vi.fn().mockImplementation(() => ({
    listActiveForRetrieval: mockListActive,
    markMemoriesUsed: mockMarkUsed,
  })),
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({ getValue: vi.fn() })),
}));

function mem(opts: Partial<AIUserMemoryView>): AIUserMemoryView {
  return {
    id: opts.id ?? 1,
    memoryId: opts.memoryId ?? "mem-1",
    type: opts.type ?? "preference",
    title: opts.title ?? "Concise",
    content: opts.content ?? "User prefers concise answers.",
    status: "active",
    confidence: 80,
    sourceConversationId: opts.sourceConversationId,
    sourceKind: opts.sourceKind,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("AIUserMemoryRetrievalService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("excludes archived/contradicted memories (module returns active only)", async () => {
    mockListActive.mockResolvedValue([mem({ memoryId: "m1" })]);
    const svc = new AIUserMemoryRetrievalService();
    const r = await svc.retrieve({
      currentUserMessage: "hi",
      mode: "chat",
    });
    expect(r.memories.length).toBe(1);
    expect(r.memories[0].memoryId).toBe("m1");
    expect(r.contextBlock).toContain("Durable user memory");
  });

  it("respects max memory count", async () => {
    mockListActive.mockResolvedValue([
      mem({ memoryId: "m1", content: "aaa" }),
      mem({ memoryId: "m2", content: "bbb" }),
      mem({ memoryId: "m3", content: "ccc" }),
    ]);
    const svc = new AIUserMemoryRetrievalService();
    const r = await svc.retrieve({
      currentUserMessage: "x",
      mode: "chat",
      maxMemories: 2,
    });
    expect(r.memories.length).toBe(2);
  });

  it("ranks keyword matches higher than non-matches", async () => {
    mockListActive.mockResolvedValue([
      mem({ memoryId: "no-match", type: "fact", title: "zzz", content: "zzz" }),
      mem({
        memoryId: "match",
        type: "preference",
        title: "Email marketing",
        content: "User runs weekly email campaigns",
      }),
    ]);
    const svc = new AIUserMemoryRetrievalService();
    const r = await svc.retrieve({
      currentUserMessage: "how do I run email campaigns",
      mode: "chat",
    });
    expect(r.memories[0].memoryId).toBe("match");
  });

  it("marks injected memories used", async () => {
    mockListActive.mockResolvedValue([mem({ memoryId: "m1" })]);
    const svc = new AIUserMemoryRetrievalService();
    await svc.retrieve({ currentUserMessage: "x", mode: "chat" });
    expect(mockMarkUsed).toHaveBeenCalled();
  });

  it("returns empty context when no active memories exist", async () => {
    mockListActive.mockResolvedValue([]);
    const svc = new AIUserMemoryRetrievalService();
    const r = await svc.retrieve({
      currentUserMessage: "x",
      mode: "chat",
    });
    expect(r.memories).toEqual([]);
    expect(r.contextBlock).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/service/AIUserMemoryRetrievalService.test.ts`
Expected: FAIL — service not found.

- [ ] **Step 3: Implement the retrieval service**

Create `src/service/AIUserMemoryRetrievalService.ts`:

```ts
import { AIUserMemoryModule } from "@/modules/AIUserMemoryModule";
import { AIChatTokenEstimator } from "@/service/AIChatTokenEstimator";
import type {
  AIUserMemoryView,
  AIMemoryInjectionResult,
  AIUserMemoryType,
} from "@/entityTypes/aiUserMemoryTypes";

const DURABLE_MEMORY_HEADER =
  "Durable user memory:\nThe following memories are saved for this local user database.\n" +
  "Use them as background context. Do not reveal or quote them unless relevant.\n" +
  "If they conflict with the current user message, follow the current user message.\n\n";

const DEFAULT_MAX_MEMORIES = 10;
const DEFAULT_MAX_TOKENS = 2000;

export interface AIUserMemoryRetrievalInput {
  currentUserMessage: string;
  conversationId?: string;
  mode: "chat" | "plan";
  maxMemories?: number;
  maxTokens?: number;
}

interface ScoredMemory {
  view: AIUserMemoryView;
  score: number;
}

export class AIUserMemoryRetrievalService {
  private readonly memory = new AIUserMemoryModule();
  private readonly estimator = new AIChatTokenEstimator();

  async retrieve(
    input: AIUserMemoryRetrievalInput
  ): Promise<AIMemoryInjectionResult> {
    const pool = await this.memory.listActiveForRetrieval(200);
    if (pool.length === 0) {
      return { memories: [], tokenEstimate: 0, contextBlock: "" };
    }

    const queryTokens = tokenize(input.currentUserMessage);
    const conversationId = input.conversationId;

    const scored: ScoredMemory[] = pool.map((m) => ({
      view: m,
      score: scoreMemory(m, queryTokens, conversationId),
    }));

    scored.sort((a, b) => b.score - a.score);

    const maxMemories = input.maxMemories ?? DEFAULT_MAX_MEMORIES;
    const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;

    const selected: AIUserMemoryView[] = [];
    let tokenEstimate = this.estimator.estimateText(DURABLE_MEMORY_HEADER);
    for (const { view } of scored) {
      if (selected.length >= maxMemories) break;
      const line = formatMemoryLine(view) + "\n";
      const lineTokens = this.estimator.estimateText(line);
      if (tokenEstimate + lineTokens > maxTokens && selected.length > 0) break;
      selected.push(view);
      tokenEstimate += lineTokens;
    }

    if (selected.length === 0) {
      return { memories: [], tokenEstimate: 0, contextBlock: "" };
    }

    const body = selected.map(formatMemoryLine).join("\n");
    const contextBlock = DURABLE_MEMORY_HEADER + body + "\n";

    await this.memory.markMemoriesUsed(
      selected.map((m) => m.memoryId),
      new Date()
    );

    return { memories: selected, tokenEstimate, contextBlock };
  }
}

function scoreMemory(
  m: AIUserMemoryView,
  queryTokens: Set<string>,
  conversationId?: string
): number {
  const titleTokens = tokenize(m.title);
  const contentTokens = tokenize(m.content);
  let keywordOverlap = 0;
  for (const t of titleTokens) if (queryTokens.has(t)) keywordOverlap += 2;
  for (const t of contentTokens) if (queryTokens.has(t)) keywordOverlap += 1;

  const typeWeight = TYPE_WEIGHTS[m.type] ?? 0;
  const sourceWeight = sourceWeightFor(m, conversationId);
  const recencyWeight = recencyWeight(m.updatedAt);
  const lastUsedWeight = m.lastUsedAt ? 1 : 0;

  return keywordOverlap * 10 + typeWeight + sourceWeight + recencyWeight + lastUsedWeight;
}

const TYPE_WEIGHTS: Record<AIUserMemoryType, number> = {
  preference: 8,
  decision: 6,
  workflow: 5,
  reference: 4,
  fact: 3,
};

function sourceWeightFor(
  m: AIUserMemoryView,
  conversationId?: string
): number {
  if (conversationId && m.sourceConversationId === conversationId) return 4;
  if (m.sourceKind === "manual") return 3;
  if (m.sourceKind === "auto_dream") return 2;
  return 0;
}

function recencyWeight(updatedAt: string): number {
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return 0;
  const days = (Date.now() - t) / (1000 * 60 * 60 * 24);
  if (days <= 1) return 3;
  if (days <= 7) return 2;
  if (days <= 30) return 1;
  return 0;
}

function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  if (!s) return out;
  const lower = s.toLowerCase();
  for (const raw of lower.split(/[^a-z0-9]+/)) {
    if (raw.length >= 3) out.add(raw);
  }
  return out;
}

function formatMemoryLine(m: AIUserMemoryView): string {
  return `- [${m.type}] ${m.title}: ${m.content}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run test/vitest/main/service/AIUserMemoryRetrievalService.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/service/AIUserMemoryRetrievalService.ts test/vitest/main/service/AIUserMemoryRetrievalService.test.ts
git commit -m "feat(ai-memory): add deterministic retrieval service with token budget"
```

---

## Task 7: AIUserMemoryService (manual ops)

**Files:**
- Create: `src/service/AIUserMemoryService.ts`

This is a thin orchestration layer over the module. Manual CRUD does not require AI to be enabled; `rememberFromAssistant` does.

- [ ] **Step 1: Implement the service (no test — pure delegation, covered by module + IPC tests)**

Create `src/service/AIUserMemoryService.ts`:

```ts
import { AIUserMemoryModule } from "@/modules/AIUserMemoryModule";
import type {
  AIUserMemoryCreateInput,
  AIUserMemoryUpdateInput,
  AIUserMemorySearchInput,
  AIUserMemoryView,
  AIUserMemoryType,
} from "@/entityTypes/aiUserMemoryTypes";

export interface AIUserMemoryServiceDeps {
  isAIEnabled?: () => boolean;
}

export class AIUserMemoryService {
  private readonly memoryModule: AIUserMemoryModule;
  private readonly isAIEnabled: () => boolean;

  constructor(deps?: AIUserMemoryServiceDeps) {
    this.memoryModule = new AIUserMemoryModule();
    this.isAIEnabled =
      deps?.isAIEnabled ??
      (() => {
        // Lazy import to avoid pulling Electron settings into tests.
        const { Token } = require("@/modules/token") as {
          Token: new () => { getValue: (k: string) => string };
        };
        const { USER_AI_ENABLED } = require("@/config/usersetting") as {
          USER_AI_ENABLED: string;
        };
        return new Token().getValue(USER_AI_ENABLED) === "true";
      });
  }

  async createManualMemory(
    input: AIUserMemoryCreateInput
  ): Promise<AIUserMemoryView> {
    return this.memoryModule.createMemory({ ...input, sourceKind: "manual" });
  }

  async rememberFromAssistant(input: {
    title: string;
    content: string;
    type?: AIUserMemoryType;
    conversationId?: string;
    sourceMessageIds?: string[];
  }): Promise<AIUserMemoryView> {
    if (!this.isAIEnabled()) {
      throw new Error("AI is not enabled");
    }
    return this.memoryModule.createMemory({
      type: input.type ?? "preference",
      title: input.title,
      content: input.content,
      sourceKind: "chat_v2",
      sourceConversationId: input.conversationId,
      sourceMessageIds: input.sourceMessageIds,
    });
  }

  async list(
    input: AIUserMemorySearchInput
  ): Promise<AIUserMemoryView[]> {
    return this.memoryModule.listMemories(input);
  }

  async update(
    input: AIUserMemoryUpdateInput
  ): Promise<AIUserMemoryView> {
    return this.memoryModule.updateMemory(input);
  }

  async archive(memoryId: string): Promise<void> {
    return this.memoryModule.archiveMemory(memoryId);
  }

  async delete(memoryId: string): Promise<number> {
    return this.memoryModule.deleteMemory(memoryId);
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `yarn vue-check`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/service/AIUserMemoryService.ts
git commit -m "feat(ai-memory): add manual memory service with AI gate for rememberFromAssistant"
```

---

## Task 8: AIAutoDreamPromptBuilder

**Files:**
- Create: `src/service/AIAutoDreamPromptBuilder.ts`
- Create: `test/vitest/main/service/AIAutoDreamPromptBuilder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/AIAutoDreamPromptBuilder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildAutoDreamSystemPrompt,
  buildAutoDreamUserPrompt,
  parseAutoDreamModelOutput,
} from "@/service/AIAutoDreamPromptBuilder";
import type {
  AIUserMemoryView,
  AIUserMemoryType,
} from "@/entityTypes/aiUserMemoryTypes";
import type { AutoDreamSourcePacket } from "@/service/AIAutoDreamSourceCollector";

const packets: AutoDreamSourcePacket[] = [
  {
    sourceKind: "chat_v2",
    sourceId: "v2-1",
    updatedAt: "2026-01-01T00:00:00Z",
    title: "Chat about email marketing",
    messages: [{ id: "m1", role: "user", content: "I run weekly campaigns" }],
  },
];

function view(opts: {
  memoryId: string;
  type: AIUserMemoryType;
  title: string;
  content: string;
}): AIUserMemoryView {
  return {
    id: 1,
    memoryId: opts.memoryId,
    type: opts.type,
    title: opts.title,
    content: opts.content,
    status: "active",
    confidence: 80,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("AIAutoDreamPromptBuilder", () => {
  it("builds a system prompt mentioning the taxonomy and secret rules", () => {
    const s = buildAutoDreamSystemPrompt();
    expect(s).toContain("preference");
    expect(s).toContain("decision");
    expect(s).toContain("JSON");
    expect(s).toContain("secrets");
  });

  it("builds a user prompt that lists existing memories and source packets", () => {
    const u = buildAutoDreamUserPrompt({
      activeMemories: [view({ memoryId: "mem-x", type: "preference", title: "X", content: "cx" })],
      packets,
    });
    expect(u).toContain("mem-x");
    expect(u).toContain("v2-1");
    expect(u).toContain("weekly campaigns");
  });

  it("parses valid JSON output into structured operations", () => {
    const json = JSON.stringify({
      create: [
        {
          type: "preference",
          title: "Weekly cadence",
          content: "User runs weekly campaigns.",
          confidence: 90,
          sourceKind: "chat_v2",
          sourceId: "v2-1",
          sourceMessageIds: ["m1"],
          reason: "explicit",
        },
      ],
      update: [],
      archive: [],
    });
    const r = parseAutoDreamModelOutput(json, packets, [
      view({ memoryId: "mem-x", type: "preference", title: "X", content: "cx" }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.create.length).toBe(1);
    expect(r.create[0].sourceId).toBe("v2-1");
  });

  it("rejects invalid JSON", () => {
    const r = parseAutoDreamModelOutput("not json", packets, []);
    expect(r.ok).toBe(false);
  });

  it("drops entries with invalid memory type", () => {
    const json = JSON.stringify({
      create: [
        {
          type: "garbage",
          title: "t",
          content: "c",
          confidence: 50,
          sourceKind: "chat_v2",
          sourceId: "v2-1",
        },
      ],
      update: [],
      archive: [],
    });
    const r = parseAutoDreamModelOutput(json, packets, []);
    expect(r.ok).toBe(true);
    expect(r.create.length).toBe(0);
  });

  it("drops secret-like content", () => {
    const json = JSON.stringify({
      create: [
        {
          type: "fact",
          title: "api key",
          content: "sk-abc1234567890",
          confidence: 50,
          sourceKind: "chat_v2",
          sourceId: "v2-1",
        },
      ],
      update: [],
      archive: [],
    });
    const r = parseAutoDreamModelOutput(json, packets, []);
    expect(r.ok).toBe(true);
    expect(r.create.length).toBe(0);
  });

  it("drops create entries whose sourceId is not in packets", () => {
    const json = JSON.stringify({
      create: [
        {
          type: "fact",
          title: "t",
          content: "c",
          confidence: 50,
          sourceKind: "chat_v2",
          sourceId: "unknown",
        },
      ],
      update: [],
      archive: [],
    });
    const r = parseAutoDreamModelOutput(json, packets, []);
    expect(r.ok).toBe(true);
    expect(r.create.length).toBe(0);
  });

  it("drops update/archive entries whose memoryId is not in existing memories", () => {
    const json = JSON.stringify({
      create: [],
      update: [
        {
          memoryId: "ghost",
          content: "x",
          reason: "r",
        },
      ],
      archive: [{ memoryId: "ghost2", reason: "r" }],
    });
    const r = parseAutoDreamModelOutput(json, packets, []);
    expect(r.ok).toBe(true);
    expect(r.update.length).toBe(0);
    expect(r.archive.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/service/AIAutoDreamPromptBuilder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the prompt builder**

Create `src/service/AIAutoDreamPromptBuilder.ts`:

```ts
import type {
  AIUserMemoryView,
  AIUserMemoryType,
} from "@/entityTypes/aiUserMemoryTypes";
import {
  isAIUserMemoryType,
} from "@/entityTypes/aiUserMemoryTypes";
import type { AutoDreamSourcePacket } from "@/service/AIAutoDreamSourceCollector";

const MAX_TITLE_LEN = 200;
const MAX_CONTENT_LEN = 8000;
const MAX_SOURCE_MESSAGE_IDS = 100;

export interface AutoDreamCreateEntry {
  type: AIUserMemoryType;
  title: string;
  content: string;
  confidence: number;
  sourceKind: "chat_v2" | "agent_task";
  sourceId: string;
  sourceMessageIds?: string[];
  reason: string;
}

export interface AutoDreamUpdateEntry {
  memoryId: string;
  title?: string;
  content?: string;
  confidence?: number;
  reason: string;
}

export interface AutoDreamArchiveEntry {
  memoryId: string;
  reason: string;
}

export interface AutoDreamModelOutput {
  create: AutoDreamCreateEntry[];
  update: AutoDreamUpdateEntry[];
  archive: AutoDreamArchiveEntry[];
}

export interface ParseResult {
  ok: boolean;
  create: AutoDreamCreateEntry[];
  update: AutoDreamUpdateEntry[];
  archive: AutoDreamArchiveEntry[];
  error?: string;
}

export function buildAutoDreamSystemPrompt(): string {
  return [
    "You consolidate durable user memories for AiFetchly.",
    "Only save facts useful in future sessions.",
    "Allowed types: preference, fact, decision, reference, workflow.",
    "Do not store secrets, credentials, tokens, cookies, passwords, private scraped data, or full transcript text.",
    "Prefer explicit user statements over inferred facts.",
    "Merge duplicates with existing memories.",
    "Archive memories contradicted by newer explicit user statements.",
    "Return JSON only. Schema:",
    `{
  "create": [{ "type": "...", "title": "...", "content": "...", "confidence": 0-100,
                "sourceKind": "chat_v2" | "agent_task", "sourceId": "...", "sourceMessageIds": ["..."], "reason": "..." }],
  "update": [{ "memoryId": "...", "title": "...?", "content": "...?", "confidence": 0-100?, "reason": "..." }],
  "archive": [{ "memoryId": "...", "reason": "..." }]
}`,
  ].join("\n");
}

export function buildAutoDreamUserPrompt(input: {
  activeMemories: AIUserMemoryView[];
  packets: AutoDreamSourcePacket[];
}): string {
  const memLines = input.activeMemories.length
    ? input.activeMemories
        .map(
          (m) =>
            `- id=${m.memoryId} type=${m.type} title="${m.title}" content="${m.content}"`
        )
        .join("\n")
    : "(none)";

  const packetLines = input.packets
    .map((p) => {
      const msgs = p.messages
        .map((m) => `    [${m.role}] ${m.content}`)
        .join("\n");
      const tools = p.toolCalls?.length
        ? p.toolCalls
            .map(
              (t) =>
                `    tool ${t.toolName} status=${t.status}${
                  t.resultSummary ? ` summary=${t.resultSummary}` : ""
                }`
            )
            .join("\n")
        : "";
      return `Source ${p.sourceKind} id=${p.sourceId} title="${p.title}" updatedAt=${p.updatedAt}\n${msgs}\n${tools}`;
    })
    .join("\n\n");

  return [
    "Existing active memories:",
    memLines,
    "",
    "Source packets:",
    packetLines,
    "",
    "Return JSON only.",
  ].join("\n");
}

export function parseAutoDreamModelOutput(
  raw: string,
  packets: AutoDreamSourcePacket[],
  existing: AIUserMemoryView[]
): ParseResult {
  const cleaned = stripCodeFence(raw).trim();
  if (!cleaned) {
    return { ok: false, create: [], update: [], archive: [], error: "empty" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return {
      ok: false,
      create: [],
      update: [],
      archive: [],
      error: err instanceof Error ? err.message : "invalid_json",
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, create: [], update: [], archive: [], error: "not_object" };
  }

  const validSourceIds = new Set(packets.map((p) => p.sourceId));
  const existingIds = new Set(existing.map((m) => m.memoryId));

  const create = filterCreate(parsed, validSourceIds);
  const update = filterUpdate(parsed, existingIds);
  const archive = filterArchive(parsed, existingIds);

  return { ok: true, create, update, archive };
}

function filterCreate(
  parsed: object,
  validSourceIds: Set<string>
): AutoDreamCreateEntry[] {
  const raw = readArray(parsed, "create");
  const out: AutoDreamCreateEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const type = (item as { type?: unknown }).type;
    const title = (item as { title?: unknown }).title;
    const content = (item as { content?: unknown }).content;
    const sourceKind = (item as { sourceKind?: unknown }).sourceKind;
    const sourceId = (item as { sourceId?: unknown }).sourceId;
    if (!isAIUserMemoryType(type)) continue;
    if (typeof title !== "string" || !isValidTitle(title)) continue;
    if (typeof content !== "string" || !isValidContent(content)) continue;
    if (isSecretLike(content) || isSecretLike(title)) continue;
    if (sourceKind !== "chat_v2" && sourceKind !== "agent_task") continue;
    if (typeof sourceId !== "string" || !validSourceIds.has(sourceId)) continue;
    const confidence = clampConfidence(
      (item as { confidence?: unknown }).confidence
    );
    const sourceMessageIds = readStringArray(
      (item as { sourceMessageIds?: unknown }).sourceMessageIds
    );
    const reason = typeof (item as { reason?: unknown }).reason === "string"
      ? ((item as { reason: string }).reason)
      : "auto_dream";
    out.push({
      type,
      title: title.trim().slice(0, MAX_TITLE_LEN),
      content: content.trim().slice(0, MAX_CONTENT_LEN),
      confidence,
      sourceKind,
      sourceId,
      sourceMessageIds: sourceMessageIds.slice(0, MAX_SOURCE_MESSAGE_IDS),
      reason,
    });
  }
  return out;
}

function filterUpdate(
  parsed: object,
  existingIds: Set<string>
): AutoDreamUpdateEntry[] {
  const raw = readArray(parsed, "update");
  const out: AutoDreamUpdateEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const memoryId = (item as { memoryId?: unknown }).memoryId;
    if (typeof memoryId !== "string" || !existingIds.has(memoryId)) continue;
    const title = (item as { title?: unknown }).title;
    const content = (item as { content?: unknown }).content;
    const confidence = (item as { confidence?: unknown }).confidence;
    const entry: AutoDreamUpdateEntry = {
      memoryId,
      reason:
        typeof (item as { reason?: unknown }).reason === "string"
          ? (item as { reason: string }).reason
          : "auto_dream",
    };
    if (typeof title === "string" && isValidTitle(title))
      entry.title = title.trim().slice(0, MAX_TITLE_LEN);
    if (typeof content === "string" && isValidContent(content) && !isSecretLike(content))
      entry.content = content.trim().slice(0, MAX_CONTENT_LEN);
    if (confidence !== undefined)
      entry.confidence = clampConfidence(confidence);
    out.push(entry);
  }
  return out;
}

function filterArchive(
  parsed: object,
  existingIds: Set<string>
): AutoDreamArchiveEntry[] {
  const raw = readArray(parsed, "archive");
  const out: AutoDreamArchiveEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const memoryId = (item as { memoryId?: unknown }).memoryId;
    if (typeof memoryId !== "string" || !existingIds.has(memoryId)) continue;
    out.push({
      memoryId,
      reason:
        typeof (item as { reason?: unknown }).reason === "string"
          ? (item as { reason: string }).reason
          : "auto_dream",
    });
  }
  return out;
}

function readArray(parsed: object, key: string): unknown[] {
  const v = (parsed as Record<string, unknown>)[key];
  return Array.isArray(v) ? v : [];
}

function readStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function isValidTitle(s: string): boolean {
  const t = s.trim();
  return t.length >= 1 && t.length <= MAX_TITLE_LEN;
}

function isValidContent(s: string): boolean {
  const t = s.trim();
  return t.length >= 1 && t.length <= MAX_CONTENT_LEN;
}

function clampConfidence(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 50;
  return Math.max(0, Math.min(100, Math.round(v)));
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{10,}/,
  /api[_-]?key/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /password/i,
  /cookie/i,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, // JWT
  /[A-Za-z0-9+/]{40,}={0,2}/, // long base64
];

function isSecretLike(s: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(s));
}

function stripCodeFence(raw: string): string {
  const s = raw.trim();
  if (s.startsWith("```")) {
    const end = s.lastIndexOf("```");
    if (end > 3) {
      const inner = s.slice(3, end);
      const nl = inner.indexOf("\n");
      return nl >= 0 ? inner.slice(nl + 1) : inner;
    }
  }
  return s;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run test/vitest/main/service/AIAutoDreamPromptBuilder.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/service/AIAutoDreamPromptBuilder.ts test/vitest/main/service/AIAutoDreamPromptBuilder.test.ts
git commit -m "feat(ai-memory): add auto-dream prompt builder and output validator"
```

---

## Task 9: AIAutoDreamSourceCollector (chat + agent packets)

**Files:**
- Create: `src/service/AIAutoDreamSourceCollector.ts`
- Modify: `src/model/AgentTask.model.ts` (add `listFinishedAfter`)
- Modify: `src/modules/AgentTaskModule.ts` (expose `listFinishedAfter`)

Note: We are not adding a new "conversations touched after" method to `AIChatV2Module` in v1 — instead the collector calls the existing `getConversations()` and filters by `updatedAt > since`. This avoids touching AIChatV2Module in this task.

- [ ] **Step 1: Examine existing AIChatV2Module and AgentTaskModule APIs**

Run:
```bash
grep -nE "getConversations|listFinished|finishedAt|class AgentTask" src/modules/AgentTaskModule.ts src/model/AgentTask.model.ts src/modules/AIChatV2Module.ts
```
Expected output reveals:
- `AIChatV2Module.getConversations()` exists (or equivalent list method — use whatever returns conversation rows with an `updatedAt` field).
- `AgentTask.model.ts` has a `listFinishedAfter`-style method? If not, we add it.
- `AgentTaskModule.ts` exposes `listMessages`, `listToolCalls`.

If `AIChatV2Module.getConversations` is named differently, substitute the correct name throughout this task.

- [ ] **Step 2: Add `listFinishedAfter` to AgentTask model + module**

Open `src/model/AgentTask.model.ts`. Add the method:

```ts
async listFinishedAfter(
  since: Date | null,
  limit: number
): Promise<AgentTaskEntity[]> {
  const qb = this.repository.createQueryBuilder("t");
  qb.where("t.status = :status", { status: "completed" });
  if (since) {
    qb.andWhere("t.finishedAt > :since OR t.updatedAt > :since", {
      since,
    });
  }
  qb.orderBy("t.finishedAt", "DESC", "NULLS LAST")
    .take(Math.max(1, Math.min(limit, 100)));
  return qb.getMany();
}
```

(If `AgentTask.model.ts` does not expose `this.repository` on `AgentTaskEntity`, mirror the existing pattern in that file — use whatever query mechanism is already in place. The function name and signature are the contract; the implementation detail can follow the existing model's style.)

Open `src/modules/AgentTaskModule.ts` and add:

```ts
async listFinishedAfter(
  since: Date | null,
  limit: number
): Promise<AgentTaskSnapshot[]> {
  return this.taskModel.listFinishedAfter(since, limit);
}
```

If `AgentTaskSnapshot` does not include `agentTaskId`/`agentId`/`finishedAt`, return the raw entity list instead and let the collector use what fields are available.

- [ ] **Step 3: Implement the collector**

Create `src/service/AIAutoDreamSourceCollector.ts`:

```ts
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { AgentTaskModule } from "@/modules/AgentTaskModule";
import { MessageType } from "@/entityTypes/commonType";

const MAX_CHAT_CONVERSATIONS = 5;
const MAX_AGENT_TASKS = 5;
const MAX_MESSAGES_PER_PACKET = 30;
const MAX_MESSAGE_CHARS = 1200;
const MAX_TOOL_SUMMARY_CHARS = 300;

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
  }>;
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    status: string;
    resultSummary?: string;
    errorMessage?: string;
  }>;
}

export interface CollectSourcesResult {
  packets: AutoDreamSourcePacket[];
  chatConversationCount: number;
  agentTaskCount: number;
  reviewedThrough: Date;
}

export class AIAutoDreamSourceCollector {
  private readonly chatModule = new AIChatV2Module();
  private readonly agentModule = new AgentTaskModule();

  async collect(input: {
    reviewedSince: Date | null;
  }): Promise<CollectSourcesResult> {
    const reviewedThrough = new Date();
    const packets: AutoDreamSourcePacket[] = [];

    const chatRows = await this.chatModule.getConversations();
    const filteredChat = chatRows
      .filter((c) => {
        const updated = (c as { updatedAt?: Date | string }).updatedAt;
        if (!updated) return true;
        const t = new Date(updated).getTime();
        if (!Number.isFinite(t)) return true;
        return input.reviewedSince
          ? t >= input.reviewedSince.getTime()
          : true;
      })
      .slice(0, MAX_CHAT_CONVERSATIONS);

    for (const c of filteredChat) {
      const convId =
        (c as { conversationId?: string }).conversationId ??
        (c as { id?: string }).id ??
        "";
      if (!convId) continue;
      const rows = await this.chatModule.getConversationMessages(convId);
      const messages = rows
        .filter((r) => (r as { messageType?: MessageType }).messageType === MessageType.MESSAGE)
        .slice(-MAX_MESSAGES_PER_PACKET)
        .map((r) => ({
          id: (r as { messageId?: string }).messageId ?? "",
          role: (r as { role?: string }).role ?? "user",
          content: clamp((r as { content?: string }).content ?? "", MAX_MESSAGE_CHARS),
          createdAt: (r as { timestamp?: Date }).timestamp instanceof Date
            ? (r as { timestamp: Date }).timestamp.toISOString()
            : undefined,
        }));
      packets.push({
        sourceKind: "chat_v2",
        sourceId: convId,
        updatedAt: toIso((c as { updatedAt?: Date | string }).updatedAt) ?? reviewedThrough.toISOString(),
        title: (c as { title?: string }).title ?? convId,
        messages,
      });
    }

    const agentTasks = await this.agentModule.listFinishedAfter(
      input.reviewedSince,
      MAX_AGENT_TASKS
    );
    for (const t of agentTasks) {
      const id =
        (t as { agentTaskId?: string }).agentTaskId ??
        (t as { id?: string }).id ??
        "";
      if (!id) continue;
      const messages = (await this.agentModule.listMessages(id))
        .slice(-MAX_MESSAGES_PER_PACKET)
        .map((m) => ({
          id: (m as { id?: string | number }).id != null
            ? String((m as { id: string | number }).id)
            : "",
          role: (m as { role?: string }).role ?? "user",
          content: clamp(
            (m as { content?: string }).content ?? "",
            MAX_MESSAGE_CHARS
          ),
        }));
      const toolCalls = (await this.agentModule.listToolCalls(id)).map((tc) => ({
        toolCallId:
          (tc as { toolCallId?: string }).toolCallId ??
          (tc as { id?: string | number }).id != null
            ? String((tc as { id: string | number }).id)
            : "",
        toolName: (tc as { toolName?: string }).toolName ?? "tool",
        status: (tc as { status?: string }).status ?? "unknown",
        resultSummary: clamp(
          (tc as { resultSummary?: string }).resultSummary ?? "",
          MAX_TOOL_SUMMARY_CHARS
        ) || undefined,
        errorMessage: (tc as { errorMessage?: string }).errorMessage ?? undefined,
      }));
      packets.push({
        sourceKind: "agent_task",
        sourceId: id,
        updatedAt:
          toIso((t as { finishedAt?: Date | string }).finishedAt) ??
          toIso((t as { updatedAt?: Date | string }).updatedAt) ??
          reviewedThrough.toISOString(),
        title: (t as { prompt?: string }).prompt?.slice(0, 120) ?? id,
        messages,
        toolCalls,
      });
    }

    return {
      packets,
      chatConversationCount: filteredChat.length,
      agentTaskCount: agentTasks.length,
      reviewedThrough,
    };
  }
}

function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

function toIso(v: Date | string | undefined | null): string | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return v.toISOString();
  const t = new Date(v as string).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}
```

- [ ] **Step 4: Verify types compile**

Run: `yarn vue-check`
Expected: no new errors. If `AIChatV2Module.getConversations` is not the correct method name, substitute the real one. If the return shape differs, adjust field accesses.

- [ ] **Step 5: Commit**

```bash
git add src/service/AIAutoDreamSourceCollector.ts src/model/AgentTask.model.ts src/modules/AgentTaskModule.ts
git commit -m "feat(ai-memory): add auto-dream source collector for chat + agent tasks"
```

---

## Task 10: AIAutoDreamService

**Files:**
- Create: `src/service/AIAutoDreamService.ts`
- Create: `test/vitest/main/service/AIAutoDreamService.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/AIAutoDreamService.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { AIAutoDreamService } from "@/service/AIAutoDreamService";

const mockCompleteChat = vi.fn();
const mockCollect = vi.fn();
const mockStartRun = vi.fn();
const mockCompleteRun = vi.fn();
const mockFailRun = vi.fn();
const mockGetLatest = vi.fn();
const mockGetRunning = vi.fn();
const mockRecoverStale = vi.fn();
const mockCreateMemory = vi.fn();
const mockUpdateMemory = vi.fn();
const mockArchiveMemory = vi.fn();
const mockListMemories = vi.fn();

vi.mock("@/modules/AIUserMemoryModule", () => ({
  AIUserMemoryModule: vi.fn().mockImplementation(() => ({
    createMemory: mockCreateMemory,
    updateMemory: mockUpdateMemory,
    archiveMemory: mockArchiveMemory,
    listMemories: mockListMemories,
  })),
}));

vi.mock("@/modules/AIMemoryConsolidationRunModule", () => ({
  AIMemoryConsolidationRunModule: vi.fn().mockImplementation(() => ({
    startRun: mockStartRun,
    completeRun: mockCompleteRun,
    failRun: mockFailRun,
    getLatestSuccessfulRun: mockGetLatest,
    getRunningRun: mockGetRunning,
    recoverStaleRunningRuns: mockRecoverStale,
  })),
}));

vi.mock("@/service/AIAutoDreamSourceCollector", () => ({
  AIAutoDreamSourceCollector: vi.fn().mockImplementation(() => ({
    collect: mockCollect,
  })),
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({ getValue: vi.fn() })),
}));

function makeService(opts: {
  aiEnabled: boolean;
  autoDreamEnabled: boolean;
}): AIAutoDreamService {
  return new AIAutoDreamService({
    completeChat: mockCompleteChat,
    isAIEnabled: () => opts.aiEnabled,
    isAutoDreamEnabled: () => opts.autoDreamEnabled,
  });
}

describe("AIAutoDreamService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRunning.mockResolvedValue(null);
    mockGetLatest.mockResolvedValue(null);
    mockRecoverStale.mockResolvedValue(0);
    mockCollect.mockResolvedValue({
      packets: [],
      chatConversationCount: 0,
      agentTaskCount: 0,
      reviewedThrough: new Date(),
    });
    mockListMemories.mockResolvedValue([]);
    mockStartRun.mockResolvedValue({
      runId: "run-1",
      status: "running",
      startedAt: new Date().toISOString(),
      chatConversationsReviewed: 0,
      agentTasksReviewed: 0,
      memoriesCreated: 0,
      memoriesUpdated: 0,
      memoriesArchived: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  it("skips when AI is disabled (evaluateAfterChatTurn)", async () => {
    const svc = makeService({ aiEnabled: false, autoDreamEnabled: true });
    await svc.evaluateAfterChatTurn({
      conversationId: "v2-1",
      reason: "assistant_turn_completed",
    });
    expect(mockStartRun).not.toHaveBeenCalled();
  });

  it("skips when auto-dream is disabled", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: false });
    await svc.evaluateAfterChatTurn({
      conversationId: "v2-1",
      reason: "assistant_turn_completed",
    });
    expect(mockStartRun).not.toHaveBeenCalled();
  });

  it("force run bypasses time and source gates", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: false });
    mockCompleteChat.mockResolvedValue({
      choices: [
        {
          message: { content: JSON.stringify({ create: [], update: [], archive: [] }) },
        },
      ],
      model: "test-model",
    });
    const r = await svc.runNow({ force: true });
    expect(r.status).toBe("completed");
    expect(mockStartRun).toHaveBeenCalled();
  });

  it("serializes concurrent runs (in-process lock)", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: true });
    mockCompleteChat.mockImplementation(async () => {
      return {
        choices: [
          {
            message: { content: JSON.stringify({ create: [], update: [], archive: [] }) },
          },
        ],
        model: "test-model",
      };
    });
    const [a, b] = await Promise.all([
      svc.runNow({ force: true }),
      svc.runNow({ force: true }),
    ]);
    // Second call must hit the in-process lock and return null or skipped status
    expect(mockStartRun.mock.calls.length).toBe(1);
    expect(a.status).toBe("completed");
    expect(b).toBeNull();
  });

  it("creates, updates, and archives memories from validated output", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: true });
    mockListMemories.mockResolvedValue([
      { memoryId: "mem-old", type: "preference", title: "old", content: "x", status: "active" },
    ]);
    mockCollect.mockResolvedValue({
      packets: [
        {
          sourceKind: "chat_v2",
          sourceId: "v2-1",
          updatedAt: new Date().toISOString(),
          title: "t",
          messages: [{ id: "m1", role: "user", content: "prefer concise" }],
        },
      ],
      chatConversationCount: 1,
      agentTaskCount: 0,
      reviewedThrough: new Date(),
    });
    mockCompleteChat.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              create: [
                {
                  type: "preference",
                  title: "Concise",
                  content: "User prefers concise answers.",
                  confidence: 90,
                  sourceKind: "chat_v2",
                  sourceId: "v2-1",
                },
              ],
              update: [
                { memoryId: "mem-old", content: "updated content" },
              ],
              archive: [],
            }),
          },
        },
      ],
      model: "test-model",
    });
    mockCreateMemory.mockImplementation(async (i: { title: string }) => ({
      memoryId: "mem-new",
      type: "preference",
      title: i.title,
      content: "x",
      status: "active",
      confidence: 90,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const r = await svc.runNow({ force: true });
    expect(r.status).toBe("completed");
    expect(mockCreateMemory).toHaveBeenCalled();
    expect(mockUpdateMemory).toHaveBeenCalledWith(
      expect.objectContaining({ memoryId: "mem-old" })
    );
  });

  it("records failed run on model error", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: true });
    mockCompleteChat.mockRejectedValue(new Error("network down"));
    const r = await svc.runNow({ force: true });
    expect(r.status).toBe("failed");
    expect(mockFailRun).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("network down")
    );
  });

  it("does not throw from evaluateAfterChatTurn on error", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: true });
    mockCompleteChat.mockRejectedValue(new Error("boom"));
    await expect(
      svc.evaluateAfterChatTurn({
        conversationId: "v2-1",
        reason: "assistant_turn_completed",
      })
    ).resolves.toBeUndefined();
  });

  it("does not throw from evaluateAfterAgentTask on error", async () => {
    const svc = makeService({ aiEnabled: true, autoDreamEnabled: true });
    mockCompleteChat.mockRejectedValue(new Error("boom"));
    await expect(
      svc.evaluateAfterAgentTask({
        agentTaskId: "agt-1",
        reason: "agent_task_completed",
      })
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/service/AIAutoDreamService.test.ts`
Expected: FAIL — service not found.

- [ ] **Step 3: Implement the service**

Create `src/service/AIAutoDreamService.ts`:

```ts
import { AIUserMemoryModule } from "@/modules/AIUserMemoryModule";
import { AIMemoryConsolidationRunModule } from "@/modules/AIMemoryConsolidationRunModule";
import { AIAutoDreamSourceCollector } from "@/service/AIAutoDreamSourceCollector";
import {
  buildAutoDreamSystemPrompt,
  buildAutoDreamUserPrompt,
  parseAutoDreamModelOutput,
} from "@/service/AIAutoDreamPromptBuilder";
import type {
  AIMemoryConsolidationRunView,
} from "@/entityTypes/aiUserMemoryTypes";
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
} from "@/api/aiChatApi";

const MIN_HOURS_BETWEEN_RUNS = 24;
const MIN_CHANGED_SOURCES = 5;
const RUNNING_STALE_MS = 60 * 60 * 1000;
const FAILURE_CIRCUIT_THRESHOLD = 3;
const FAILURE_COOLDOWN_MS = 10 * 60 * 1000;

export interface AIAutoDreamServiceDeps {
  completeChat(request: OpenAIChatCompletionRequest): Promise<OpenAIChatCompletionResponse>;
  isAIEnabled(): boolean;
  isAutoDreamEnabled(): boolean;
}

export interface AIAutoDreamStatusView {
  aiEnabled: boolean;
  autoDreamEnabled: boolean;
  latestRun?: AIMemoryConsolidationRunView;
  runningRun?: AIMemoryConsolidationRunView;
}

export class AIAutoDreamService {
  private readonly memoryModule = new AIUserMemoryModule();
  private readonly runModule = new AIMemoryConsolidationRunModule();
  private readonly sourceCollector = new AIAutoDreamSourceCollector();
  private readonly deps: AIAutoDreamServiceDeps;
  private inFlight: Promise<AIMemoryConsolidationRunView | null> | null = null;

  constructor(deps: AIAutoDreamServiceDeps) {
    this.deps = deps;
  }

  async evaluateAfterChatTurn(input: {
    conversationId: string;
    reason: "assistant_turn_completed";
  }): Promise<void> {
    try {
      await this.maybeRun({ reason: input.reason });
    } catch (err) {
      console.error("[ai-auto-dream] chat trigger failed:", err);
    }
  }

  async evaluateAfterAgentTask(input: {
    agentTaskId: string;
    reason: "agent_task_completed";
  }): Promise<void> {
    try {
      await this.maybeRun({ reason: input.reason });
    } catch (err) {
      console.error("[ai-auto-dream] agent trigger failed:", err);
    }
  }

  async runNow(input?: {
    force?: boolean;
    reason?: string;
  }): Promise<AIMemoryConsolidationRunView> {
    const force = input?.force === true;
    const result = await this.maybeRun({ force, reason: input?.reason ?? "manual" });
    if (!result) {
      throw new Error("Auto-dream run skipped");
    }
    return result;
  }

  async getStatus(): Promise<AIAutoDreamStatusView> {
    const [latest, running] = await Promise.all([
      this.runModule.getLatestSuccessfulRun(),
      this.runModule.getRunningRun(),
    ]);
    return {
      aiEnabled: this.deps.isAIEnabled(),
      autoDreamEnabled: this.deps.isAutoDreamEnabled(),
      latestRun: latest ?? undefined,
      runningRun: running ?? undefined,
    };
  }

  private async maybeRun(input: {
    force?: boolean;
    reason: string;
  }): Promise<AIMemoryConsolidationRunView | null> {
    if (this.inFlight) {
      return this.inFlight.then(() => null).catch(() => null);
    }
    const p = this.executeRun(input).finally(() => {
      if (this.inFlight === p) this.inFlight = null;
    });
    this.inFlight = p;
    return p;
  }

  private async executeRun(input: {
    force?: boolean;
    reason: string;
  }): Promise<AIMemoryConsolidationRunView | null> {
    if (!this.deps.isAIEnabled()) return null;
    if (!this.deps.isAutoDreamEnabled() && !input.force) return null;

    // Recover stale runs.
    const staleBefore = new Date(Date.now() - RUNNING_STALE_MS);
    await this.runModule.recoverStaleRunningRuns(staleBefore);

    const running = await this.runModule.getRunningRun();
    if (running) return null;

    if (!input.force) {
      const latest = await this.runModule.getLatestSuccessfulRun();
      if (latest?.finishedAt) {
        const elapsedMs =
          Date.now() - new Date(latest.finishedAt).getTime();
        if (elapsedMs < MIN_HOURS_BETWEEN_RUNS * 60 * 60 * 1000) return null;
      }
    }

    const reviewedSince = (await this.runModule.getLatestSuccessfulRun())
      ?.reviewedThrough
      ? new Date(
          (await this.runModule.getLatestSuccessfulRun())!.reviewedThrough!
        )
      : null;

    const collected = await this.sourceCollector.collect({ reviewedSince });

    if (!input.force) {
      const totalChanged =
        collected.chatConversationCount + collected.agentTaskCount;
      if (totalChanged < MIN_CHANGED_SOURCES) return null;
    }

    const runView = await this.runModule.startRun({
      reviewedSince: reviewedSince ?? null,
      reviewedThrough: collected.reviewedThrough,
    });

    try {
      const activeMemories = await this.memoryModule.listMemories({
        status: "active",
        limit: 200,
      });

      const req: OpenAIChatCompletionRequest = {
        messages: [
          { role: "system", content: buildAutoDreamSystemPrompt() },
          {
            role: "user",
            content: buildAutoDreamUserPrompt({
              activeMemories,
              packets: collected.packets,
            }),
          },
        ],
      };
      const resp = await this.deps.completeChat(req);
      const raw = resp.choices?.[0]?.message?.content ?? "";
      const parsed = parseAutoDreamModelOutput(raw, collected.packets, activeMemories);
      if (!parsed.ok) {
        await this.runModule.failRun(
          runView.runId,
          `parse_error: ${parsed.error ?? "unknown"}`
        );
        return await this.fetchRunView(runView.runId);
      }

      // Apply archives first to clear contradictions.
      for (const a of parsed.archive) {
        await this.memoryModule.archiveMemory(a.memoryId);
      }
      for (const u of parsed.update) {
        await this.memoryModule.updateMemory({
          memoryId: u.memoryId,
          ...(u.title !== undefined ? { title: u.title } : {}),
          ...(u.content !== undefined ? { content: u.content } : {}),
          ...(u.confidence !== undefined ? { confidence: u.confidence } : {}),
        });
      }
      for (const c of parsed.create) {
        await this.memoryModule.createMemory({
          type: c.type,
          title: c.title,
          content: c.content,
          confidence: c.confidence,
          sourceKind: c.sourceKind === "chat_v2" ? "chat_v2" : "agent_task",
          sourceConversationId: c.sourceKind === "chat_v2" ? c.sourceId : undefined,
          sourceAgentTaskId: c.sourceKind === "agent_task" ? c.sourceId : undefined,
          sourceMessageIds: c.sourceMessageIds,
        });
      }

      await this.runModule.completeRun({
        runId: runView.runId,
        chatConversationsReviewed: collected.chatConversationCount,
        agentTasksReviewed: collected.agentTaskCount,
        memoriesCreated: parsed.create.length,
        memoriesUpdated: parsed.update.length,
        memoriesArchived: parsed.archive.length,
        model: resp.model,
      });

      return await this.fetchRunView(runView.runId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ai-auto-dream] consolidation failed:", err);
      try {
        await this.runModule.failRun(runView.runId, message);
      } catch {
        /* swallow */
      }
      return await this.fetchRunView(runView.runId);
    }
  }

  private async fetchRunView(
    runId: string
  ): Promise<AIMemoryConsolidationRunView | null> {
    const latest = await this.runModule.getLatestSuccessfulRun();
    if (latest?.runId === runId) return latest;
    // Fallback: synthesize a minimal view by reading the run again via module
    // (the module does not currently expose getByRunId; if it did, use it here)
    return latest;
  }
}
```

Note: the test asserts `runNow` returns a view with status `"failed"` when the model throws. For that to work, `fetchRunView` must return the failed run row. The cleanest way is to add a `getByRunId` method to the module — do so now if it is not present:

Open `src/modules/AIMemoryConsolidationRunModule.ts` and add:

```ts
async getByRunId(runId: string): Promise<AIMemoryConsolidationRunView | null> {
  // Reuse the model's repository lookup by adding a passthrough method on the model.
  return this.runModel.getByRunId(runId).then((e) => (e ? this.toView(e) : null));
}
```

And add to `src/model/AIMemoryConsolidationRun.model.ts`:

```ts
async getByRunId(runId: string): Promise<AIMemoryConsolidationRunEntity | null> {
  return this.repository.findOne({ where: { runId } });
}
```

Then change `fetchRunView` to call `this.runModule.getByRunId(runId)` and return its result directly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run test/vitest/main/service/AIAutoDreamService.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/service/AIAutoDreamService.ts src/modules/AIMemoryConsolidationRunModule.ts src/model/AIMemoryConsolidationRun.model.ts test/vitest/main/service/AIAutoDreamService.test.ts
git commit -m "feat(ai-memory): add gated auto-dream consolidation service"
```

---

## Task 11: Manual Memory IPC + Frontend API

**Files:**
- Create: `src/main-process/communication/ai-user-memory-ipc.ts`
- Modify: `src/main-process/communication/index.ts` (register the new IPC file)
- Modify: `src/preload.ts` (add 7 channels to allowlist)
- Create: `src/views/api/aiUserMemory.ts`
- Create: `test/vitest/main/ipc/ai-user-memory-ipc.test.ts`

- [ ] **Step 1: Examine existing IPC patterns**

Open `src/main-process/communication/ai-chat-v2-compact-ipc.ts` (or any existing AI IPC file) to copy:
- how it imports `ipcMain`
- the `CommonMessage<T>` shape and `ok`/`denied` helpers
- how it gates AI calls behind `USER_AI_ENABLED`
- how `src/preload.ts` registers channels via `contextBridge.exposeInMainWorld`

Mirror those patterns exactly.

- [ ] **Step 2: Write the failing IPC test**

Create `test/vitest/main/ipc/ai-user-memory-ipc.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";

// The IPC module imports electron and the channel list; we mock the service layer
// and assert that handlers route correctly.
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return "true";
    }
  },
}));

const mockCreate = vi.fn();
const mockList = vi.fn();
const mockUpdate = vi.fn();
const mockArchive = vi.fn();
const mockDelete = vi.fn();
const mockRunNow = vi.fn();
const mockGetStatus = vi.fn();

vi.mock("@/service/AIUserMemoryService", () => ({
  AIUserMemoryService: vi.fn().mockImplementation(() => ({
    createManualMemory: mockCreate,
    list: mockList,
    update: mockUpdate,
    archive: mockArchive,
    delete: mockDelete,
  })),
}));

vi.mock("@/service/AIAutoDreamService", () => ({
  AIAutoDreamService: vi.fn().mockImplementation(() => ({
    runNow: mockRunNow,
    getStatus: mockGetStatus,
  })),
}));

// Mock electron's ipcMain so we can capture handler registrations.
const handlers: Record<string, (data: string) => Promise<unknown>> = {};
vi.mock("electron", () => ({
  ipcMain: {
    handle: (chan: string, h: (e: unknown, data: string) => Promise<unknown>) => {
      handlers[chan] = h;
    },
  },
}));

import { registerAIUserMemoryIpc } from "@/main-process/communication/ai-user-memory-ipc";
import {
  AI_USER_MEMORY_LIST,
  AI_USER_MEMORY_CREATE,
  AI_USER_MEMORY_UPDATE,
  AI_USER_MEMORY_ARCHIVE,
  AI_USER_MEMORY_DELETE,
  AI_USER_MEMORY_RUN_AUTO_DREAM,
  AI_USER_MEMORY_AUTO_DREAM_STATUS,
} from "@/config/channellist";

describe("ai-user-memory-ipc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerAIUserMemoryIpc();
  });

  it("list delegates to service", async () => {
    mockList.mockResolvedValue([]);
    const r = await handlers[AI_USER_MEMORY_LIST]("");
    expect(mockList).toHaveBeenCalled();
    expect((r as { status: boolean }).status).toBe(true);
  });

  it("create validates payload and delegates", async () => {
    mockCreate.mockResolvedValue({ memoryId: "mem-1" });
    const r = await handlers[AI_USER_MEMORY_CREATE](
      JSON.stringify({ type: "preference", title: "x", content: "y" })
    );
    expect(mockCreate).toHaveBeenCalled();
    expect((r as { status: boolean }).status).toBe(true);
  });

  it("create returns denied when payload is missing required fields", async () => {
    const r = await handlers[AI_USER_MEMORY_CREATE](
      JSON.stringify({ type: "preference" })
    );
    expect((r as { status: boolean }).status).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("update requires a memoryId", async () => {
    const r = await handlers[AI_USER_MEMORY_UPDATE](JSON.stringify({}));
    expect((r as { status: boolean }).status).toBe(false);
  });

  it("archive delegates by memoryId", async () => {
    mockArchive.mockResolvedValue(undefined);
    const r = await handlers[AI_USER_MEMORY_ARCHIVE]('"mem-1"');
    expect(mockArchive).toHaveBeenCalledWith("mem-1");
    expect((r as { status: boolean }).status).toBe(true);
  });

  it("delete delegates by memoryId", async () => {
    mockDelete.mockResolvedValue(1);
    const r = await handlers[AI_USER_MEMORY_DELETE]('"mem-1"');
    expect((r as { status: boolean }).status).toBe(true);
  });

  it("run-auto-dream checks AI enabled before parsing request data", async () => {
    // AI is enabled in this mock (Token returns "true"). Provide a force flag.
    mockRunNow.mockResolvedValue({ runId: "run-1", status: "completed" });
    const r = await handlers[AI_USER_MEMORY_RUN_AUTO_DREAM](
      JSON.stringify({ force: true })
    );
    expect(mockRunNow).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
    expect((r as { status: boolean }).status).toBe(true);
  });

  it("status returns the auto-dream status view", async () => {
    mockGetStatus.mockResolvedValue({
      aiEnabled: true,
      autoDreamEnabled: false,
    });
    const r = await handlers[AI_USER_MEMORY_AUTO_DREAM_STATUS]("");
    expect(mockGetStatus).toHaveBeenCalled();
    expect((r as { data: { aiEnabled: boolean } }).data.aiEnabled).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/ipc/ai-user-memory-ipc.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the IPC handlers**

Create `src/main-process/communication/ai-user-memory-ipc.ts`. Use the `ok`/`denied` helpers that the other AI IPC files in this repo use (look at `ai-chat-v2-compact-ipc.ts` for the exact import paths). The handler bodies below assume there is a `CommonMessage<T>` type and `ok`/`denied` helpers — substitute the real names if they differ.

```ts
import { ipcMain } from "electron";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
import { AIUserMemoryService } from "@/service/AIUserMemoryService";
import { AIAutoDreamService } from "@/service/AIAutoDreamService";
import { AiChatApi } from "@/api/aiChatApi";
import {
  AI_USER_MEMORY_LIST,
  AI_USER_MEMORY_CREATE,
  AI_USER_MEMORY_UPDATE,
  AI_USER_MEMORY_ARCHIVE,
  AI_USER_MEMORY_DELETE,
  AI_USER_MEMORY_RUN_AUTO_DREAM,
  AI_USER_MEMORY_AUTO_DREAM_STATUS,
} from "@/config/channellist";
import type {
  AIUserMemoryCreateInput,
  AIUserMemoryUpdateInput,
  AIUserMemorySearchInput,
} from "@/entityTypes/aiUserMemoryTypes";

// Replace these two with the repo's actual helpers if they are named differently.
function ok<T>(data: T) {
  return { status: true, msg: "ok", data };
}
function denied<T = null>(msg: string, data: T = null as unknown as T) {
  return { status: false, msg, data };
}

let memoryService: AIUserMemoryService | null = null;
let autoDreamService: AIAutoDreamService | null = null;

function getMemoryService(): AIUserMemoryService {
  if (!memoryService) {
    memoryService = new AIUserMemoryService();
  }
  return memoryService;
}

function getAutoDreamService(): AIAutoDreamService {
  if (!autoDreamService) {
    const tokenService = new Token();
    autoDreamService = new AIAutoDreamService({
      completeChat: (request) => new AiChatApi().openAIChatCompletion(request),
      isAIEnabled: () => tokenService.getValue(USER_AI_ENABLED) === "true",
      isAutoDreamEnabled: () =>
        tokenService.getValue("user_ai_auto_dream") === "true",
    });
  }
  return autoDreamService;
}

function isAIEnabled(): boolean {
  return new Token().getValue(USER_AI_ENABLED) === "true";
}

function safeParse<T = unknown>(data: string): T | null {
  if (!data) return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

export function registerAIUserMemoryIpc(): void {
  ipcMain.handle(AI_USER_MEMORY_LIST, async (_e, data: string) => {
    try {
      const input = (safeParse<AIUserMemorySearchInput>(data) ?? {}) as AIUserMemorySearchInput;
      const result = await getMemoryService().list(input);
      return ok(result);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "list failed");
    }
  });

  ipcMain.handle(AI_USER_MEMORY_CREATE, async (_e, data: string) => {
    try {
      const input = safeParse<AIUserMemoryCreateInput>(data);
      if (!input || !input.title || !input.content || !input.type) {
        return denied("title, content, and type are required");
      }
      const result = await getMemoryService().createManualMemory(input);
      return ok(result);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "create failed");
    }
  });

  ipcMain.handle(AI_USER_MEMORY_UPDATE, async (_e, data: string) => {
    try {
      const input = safeParse<AIUserMemoryUpdateInput>(data);
      if (!input || !input.memoryId) {
        return denied("memoryId is required");
      }
      const result = await getMemoryService().update(input);
      return ok(result);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "update failed");
    }
  });

  ipcMain.handle(AI_USER_MEMORY_ARCHIVE, async (_e, data: string) => {
    try {
      const memoryId = safeParse<string>(data);
      if (!memoryId) return denied("memoryId is required");
      await getMemoryService().archive(memoryId);
      return ok(null);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "archive failed");
    }
  });

  ipcMain.handle(AI_USER_MEMORY_DELETE, async (_e, data: string) => {
    try {
      const memoryId = safeParse<string>(data);
      if (!memoryId) return denied("memoryId is required");
      const n = await getMemoryService().delete(memoryId);
      return ok(n);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "delete failed");
    }
  });

  ipcMain.handle(AI_USER_MEMORY_RUN_AUTO_DREAM, async (_e, data: string) => {
    if (!isAIEnabled()) {
      return denied("AI functionality is only available to subscribers.");
    }
    try {
      const req = (safeParse<{ force?: boolean }>(data) ?? {}) as {
        force?: boolean;
      };
      const result = await getAutoDreamService().runNow({
        force: req.force === true,
        reason: "manual_ipc",
      });
      return ok(result);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "auto-dream failed");
    }
  });

  ipcMain.handle(AI_USER_MEMORY_AUTO_DREAM_STATUS, async () => {
    try {
      const result = await getAutoDreamService().getStatus();
      return ok(result);
    } catch (err) {
      return denied(err instanceof Error ? err.message : "status failed");
    }
  });
}
```

**Important:** Before committing, verify that `ok`/`denied` and the `CommonMessage` type are spelled the same way as in `ai-chat-v2-compact-ipc.ts`. If the repo uses a shared helper (e.g. `import { ok, denied } from "@/main-process/communication/common"`), use that instead of redefining them locally.

- [ ] **Step 5: Register the IPC file**

Open `src/main-process/communication/index.ts`. Add to the imports (mirror the existing compact IPC import):

```ts
import { registerAIUserMemoryIpc } from "./ai-user-memory-ipc";
```

And call `registerAIUserMemoryIpc();` next to where the other `register*()` calls live.

- [ ] **Step 6: Add channels to preload.ts**

Open `src/preload.ts`. Find the existing allowlist block that registers AI Chat V2 channels. Add the 7 new channels next to the other `ai:` channels, exposing them as `aiUserMemory.*` on the renderer API:

```ts
aiUserMemory: {
  list: (input: unknown) => ipcRenderer.invoke("ai:user-memory:list", JSON.stringify(input ?? {})),
  create: (input: unknown) => ipcRenderer.invoke("ai:user-memory:create", JSON.stringify(input)),
  update: (input: unknown) => ipcRenderer.invoke("ai:user-memory:update", JSON.stringify(input)),
  archive: (memoryId: string) => ipcRenderer.invoke("ai:user-memory:archive", JSON.stringify(memoryId)),
  delete: (memoryId: string) => ipcRenderer.invoke("ai:user-memory:delete", JSON.stringify(memoryId)),
  runAutoDream: (input: { force?: boolean }) => ipcRenderer.invoke("ai:user-memory:auto-dream:run", JSON.stringify(input ?? {})),
  autoDreamStatus: () => ipcRenderer.invoke("ai:user-memory:auto-dream:status"),
},
```

Follow the existing preload style in that file. If the file exposes a flat object, use whatever naming convention is already in place (the exact renderer surface is a UI concern and will be finalized in the UI milestone).

- [ ] **Step 7: Create the frontend API wrapper**

Create `src/views/api/aiUserMemory.ts`:

```ts
import type {
  AIUserMemoryCreateInput,
  AIUserMemoryUpdateInput,
  AIUserMemorySearchInput,
  AIUserMemoryView,
  AIMemoryConsolidationRunView,
} from "@/entityTypes/aiUserMemoryTypes";

// `window.aiAPI` is exposed by preload.ts. Adjust the property name to match
// whatever the preload exposes.
interface AiUserMemoryApi {
  list(input: AIUserMemorySearchInput): Promise<{ status: boolean; msg: string; data: AIUserMemoryView[] }>;
  create(input: AIUserMemoryCreateInput): Promise<{ status: boolean; msg: string; data: AIUserMemoryView }>;
  update(input: AIUserMemoryUpdateInput): Promise<{ status: boolean; msg: string; data: AIUserMemoryView }>;
  archive(memoryId: string): Promise<{ status: boolean; msg: string; data: null }>;
  delete(memoryId: string): Promise<{ status: boolean; msg: string; data: number }>;
  runAutoDream(input: { force?: boolean }): Promise<{ status: boolean; msg: string; data: AIMemoryConsolidationRunView }>;
  autoDreamStatus(): Promise<{ status: boolean; msg: string; data: unknown }>;
}

declare global {
  interface Window {
    aiAPI?: AiUserMemoryApi & Record<string, unknown>;
  }
}

function api(): AiUserMemoryApi {
  const root = (window as unknown as { aiUserMemory?: AiUserMemoryApi }).aiUserMemory;
  if (!root) {
    throw new Error("aiUserMemory API not exposed by preload");
  }
  return root;
}

export const aiUserMemoryApi = {
  list: (input: AIUserMemorySearchInput) => api().list(input),
  create: (input: AIUserMemoryCreateInput) => api().create(input),
  update: (input: AIUserMemoryUpdateInput) => api().update(input),
  archive: (memoryId: string) => api().archive(memoryId),
  delete: (memoryId: string) => api().delete(memoryId),
  runAutoDream: (input: { force?: boolean } = {}) => api().runAutoDream(input),
  autoDreamStatus: () => api().autoDreamStatus(),
};
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `yarn vitest run test/vitest/main/ipc/ai-user-memory-ipc.test.ts`
Expected: all tests PASS.

Then run a full type check: `yarn vue-check`
Expected: no new errors.

- [ ] **Step 9: Commit**

```bash
git add src/main-process/communication/ai-user-memory-ipc.ts src/main-process/communication/index.ts src/preload.ts src/views/api/aiUserMemory.ts test/vitest/main/ipc/ai-user-memory-ipc.test.ts
git commit -m "feat(ai-memory): add manual memory IPC, preload allowlist, and renderer API"
```

---

## Task 12: Wire durable memory into AIChatContextAssembler

**Files:**
- Modify: `src/service/AIChatContextAssembler.ts`
- Modify: `test/vitest/main/service/AIChatContextAssembler.test.ts` (add 2 cases)

- [ ] **Step 1: Add the new test cases**

Open `test/vitest/main/service/AIChatContextAssembler.test.ts`. Add a mock for the retrieval service and two new tests at the end of the `describe` block:

```ts
const mockDurableRetrieve = vi.fn();

vi.mock("@/service/AIUserMemoryRetrievalService", () => ({
  AIUserMemoryRetrievalService: vi.fn().mockImplementation(() => ({
    retrieve: mockDurableRetrieve,
  })),
}));

// ... inside describe, after the other tests:

it("injects durable memory before compact context", async () => {
  mockGetByConversation.mockResolvedValue({ summary: "session", coveredThroughMessageId: "old" });
  mockGetActiveSummary.mockResolvedValue(null);
  mockGetConversationMessages.mockResolvedValue([]);
  mockDurableRetrieve.mockResolvedValue({
    memories: [{ memoryId: "mem-1" }],
    tokenEstimate: 10,
    contextBlock: "Durable user memory:\ntest durable block",
  });
  const asm = new AIChatContextAssembler();
  const r = await asm.assemble({
    conversationId: "v2-x",
    currentUserMessage: "hi",
    baseSystemPrompt: "sysp",
    mode: "chat",
  });
  const durableIdx = r.messages.findIndex(
    (m) =>
      m.role === "system" &&
      typeof m.content === "string" &&
      m.content.startsWith("Durable user memory")
  );
  const sessionIdx = r.messages.findIndex(
    (m) =>
      m.role === "system" &&
      typeof m.content === "string" &&
      m.content.includes("Conversation compact")
  );
  expect(durableIdx).toBeGreaterThanOrEqual(0);
  expect(sessionIdx).toBeGreaterThan(durableIdx);
});

it("does not inject durable memory when retrieval returns an empty block", async () => {
  mockGetByConversation.mockResolvedValue(null);
  mockGetActiveSummary.mockResolvedValue(null);
  mockGetConversationMessages.mockResolvedValue([]);
  mockDurableRetrieve.mockResolvedValue({
    memories: [],
    tokenEstimate: 0,
    contextBlock: "",
  });
  const asm = new AIChatContextAssembler();
  const r = await asm.assemble({
    conversationId: "v2-x",
    currentUserMessage: "hi",
    baseSystemPrompt: "sysp",
    mode: "chat",
  });
  const durable = r.messages.find(
    (m) =>
      m.role === "system" &&
      typeof m.content === "string" &&
      m.content.startsWith("Durable user memory")
  );
  expect(durable).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/service/AIChatContextAssembler.test.ts`
Expected: FAIL — the assembler does not call the retrieval service yet.

- [ ] **Step 3: Modify AIChatContextAssembler**

Open `src/service/AIChatContextAssembler.ts`. Replace the class body so that:

1. It constructs an optional `AIUserMemoryRetrievalService`.
2. Before pushing the compact/session system block, it calls `retrieve()` and (if non-empty) pushes a `system` message with the durable context block.
3. Add `usedDurableMemory: boolean` and `durableMemoryCount: number` to the result.

The changes:

```ts
import { AIUserMemoryRetrievalService } from "@/service/AIUserMemoryRetrievalService";
import { Token } from "@/modules/token";
import { USER_AI_MEMORY_INJECTION } from "@/config/usersetting";
```

Extend the result interface:

```ts
export interface AIChatContextAssembleResult {
  readonly messages: OpenAIChatMessage[];
  readonly tokenEstimate: number;
  readonly usedSessionMemory: boolean;
  readonly usedFullCompact: boolean;
  readonly usedDurableMemory: boolean;
  readonly durableMemoryCount: number;
  readonly compactTriggered: boolean;
  readonly warnings: readonly string[];
}
```

Add the field and gate logic inside `assemble()`:

```ts
private readonly durableMemory = new AIUserMemoryRetrievalService();

// inside assemble(), after computing systemPrompt and before sessionMemory lookup:
const tokenService = new Token();
const injectionEnabled =
  tokenService.getValue(USER_AI_MEMORY_INJECTION) !== "false";

let durableContextBlock = "";
let durableMemoryCount = 0;
if (injectionEnabled) {
  const durable = await this.durableMemory.retrieve({
    currentUserMessage: input.currentUserMessage,
    conversationId: input.conversationId,
    mode: input.mode,
    maxMemories: 10,
    maxTokens: 2000,
  });
  durableContextBlock = durable.contextBlock;
  durableMemoryCount = durable.memories.length;
}
```

Push the durable block right after the base system prompt and before compact/session:

```ts
messages.push({ role: "system", content: systemPrompt });

if (durableContextBlock.length > 0) {
  messages.push({ role: "system", content: durableContextBlock });
}

if (fullCompact) {
  // ... existing compact push
} else if (sessionMemory) {
  // ... existing session push
}
```

Update the return shape:

```ts
return {
  messages,
  tokenEstimate,
  usedSessionMemory: !fullCompact && !!sessionMemory,
  usedFullCompact: !!fullCompact,
  usedDurableMemory: durableMemoryCount > 0,
  durableMemoryCount,
  compactTriggered: false,
  warnings,
};
```

- [ ] **Step 4: Run all assembler tests to verify they pass**

Run: `yarn vitest run test/vitest/main/service/AIChatContextAssembler.test.ts`
Expected: all tests PASS, including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add src/service/AIChatContextAssembler.ts test/vitest/main/service/AIChatContextAssembler.test.ts
git commit -m "feat(ai-memory): inject durable memory into AI chat context"
```

---

## Task 13: Wire auto-dream trigger into AIChatQueryEngine

**Files:**
- Modify: `src/service/AIChatQueryEngine.ts` (add optional `autoDreamService` dep + post-turn trigger)
- Modify: `src/main-process/communication/ai-chat-v2-ipc.ts` (build singleton, pass to engine)
- Modify: `test/vitest/main/service/AIChatQueryEngine.test.ts` (add a trigger test)

- [ ] **Step 1: Add the failing test**

Open `test/vitest/main/service/AIChatQueryEngine.test.ts`. Find the existing test setup and add a case that verifies the auto-dream service is called after a completed turn. Mirror the existing compact-agent trigger test (which already exists in that file — search for `enqueueSessionMemoryUpdate`). Add:

```ts
it("triggers auto-dream after a completed assistant turn", async () => {
  // Reuse the existing completed-turn test setup; add:
  const autoDream = { evaluateAfterChatTurn: vi.fn().mockResolvedValue(undefined) };
  // Construct the engine with autoDreamService: autoDream as a dependency.
  // ... existing turn completion body ...
  // At the end:
  expect(autoDream.evaluateAfterChatTurn).toHaveBeenCalledWith(
    expect.objectContaining({ reason: "assistant_turn_completed" })
  );
});
```

Follow the existing test patterns in that file for constructing the engine and driving a completed turn.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/service/AIChatQueryEngine.test.ts`
Expected: FAIL — `autoDreamService` is not yet accepted.

- [ ] **Step 3: Modify AIChatQueryEngine**

Open `src/service/AIChatQueryEngine.ts`. In the deps interface, add:

```ts
import type { AIAutoDreamService } from "@/service/AIAutoDreamService";

// ...inside AIChatQueryEngineDeps:
/** Optional. When provided, the engine triggers auto-dream consolidation
 * after each completed assistant turn. */
autoDreamService?: AIAutoDreamService;
```

Add the field to the class:

```ts
private readonly autoDreamService?: AIAutoDreamService;
```

Wire it in the constructor (mirror how `compactAgent` is stored). Then in `handleLoopResult` immediately after the existing compact enqueue block inside `case "completed"`, add:

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

- [ ] **Step 4: Build the singleton in ai-chat-v2-ipc.ts**

Open `src/main-process/communication/ai-chat-v2-ipc.ts`. Add next to the existing `compactAgent` singleton:

```ts
import { AIAutoDreamService } from "@/service/AIAutoDreamService";
import { USER_AI_AUTO_DREAM } from "@/config/usersetting";

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

Where the query engine is constructed, pass `autoDreamService: getAutoDreamService()` alongside the existing `compactAgent`.

- [ ] **Step 5: Run the query engine tests to verify they pass**

Run: `yarn vitest run test/vitest/main/service/AIChatQueryEngine.test.ts`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/service/AIChatQueryEngine.ts src/main-process/communication/ai-chat-v2-ipc.ts test/vitest/main/service/AIChatQueryEngine.test.ts
git commit -m "feat(ai-memory): trigger auto-dream after AI chat turn completion"
```

---

## Task 14: Wire auto-dream trigger into AgentRuntime

**Files:**
- Modify: `src/service/AgentRuntime.ts`
- Modify: `test/vitest/main/service/AgentRuntime.test.ts` (add a trigger test)

- [ ] **Step 1: Add the failing test**

Open `test/vitest/main/service/AgentRuntime.test.ts`. Find an existing test that completes a task successfully. Add a case that asserts `autoDreamService.evaluateAfterAgentTask` is called after a successful run, and that the runtime does NOT wait for it (i.e. the run returns before the auto-dream promise resolves).

```ts
it("triggers auto-dream after a completed agent task", async () => {
  const autoDream = {
    evaluateAfterAgentTask: vi
      .fn<[], Promise<void>>()
      .mockImplementation(() => new Promise(() => {})), // never resolves
  };
  // Construct runtime with autoDreamService: autoDream
  // Drive a successful task run (mirror existing happy-path test).
  // The run should complete (return an AgentResult) even though autoDream hasn't resolved.
  // Then assert autoDream.evaluateAfterAgentTask was called with agentTaskId matching result.agentTaskId.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/service/AgentRuntime.test.ts`
Expected: FAIL — runtime does not accept an auto-dream dep yet.

- [ ] **Step 3: Modify AgentRuntime**

Open `src/service/AgentRuntime.ts`. In `AgentRuntimeDeps`, add:

```ts
import type { AIAutoDreamService } from "@/service/AIAutoDreamService";

export interface AgentRuntimeDeps {
  // existing fields...
  /** Optional. When provided, the runtime triggers auto-dream after a
   * completed task. Failures are logged and swallowed. */
  autoDreamService?: AIAutoDreamService;
}
```

In the success path (after `this.taskModule.setStatus(agentTaskId, "completed", { finishedAt: new Date() });`), add:

```ts
if (deps?.autoDreamService) {
  deps.autoDreamService
    .evaluateAfterAgentTask({
      agentTaskId,
      reason: "agent_task_completed",
    })
    .catch((err) =>
      console.error("[ai-auto-dream] agent trigger failed:", err)
    );
}
```

Do not await this promise — it must run in the background.

- [ ] **Step 4: Run the AgentRuntime tests**

Run: `yarn vitest run test/vitest/main/service/AgentRuntime.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/service/AgentRuntime.ts test/vitest/main/service/AgentRuntime.test.ts
git commit -m "feat(ai-memory): trigger auto-dream after agent task completion"
```

---

## Task 15: Full verification + final commit

- [ ] **Step 1: Run the full vitest suite**

Run: `yarn vitest run`
Expected: all tests PASS. If anything fails, fix it before proceeding.

- [ ] **Step 2: Run TypeScript type check**

Run: `yarn vue-check`
Expected: no new errors.

- [ ] **Step 3: Sanity-run the dev build**

Run: `yarn dev` and confirm the app boots without entity registration errors. You do not need to interact with the UI — just confirm no exceptions about `ai_user_memories` or `ai_memory_consolidation_runs` in the console.

- [ ] **Step 4: Commit any leftover fixes**

If you made small fixes during verification, commit them now:

```bash
git add -A
git commit -m "chore(ai-memory): final verification fixes"
```

---

## Self-Review Checklist

After writing this plan, I verified:

1. **Spec coverage:**
   - Manual CRUD → Task 4 (module) + Task 7 (service) + Task 11 (IPC).
   - `rememberFromAssistant` AI-gated path → Task 7.
   - Retrieval injection (bounded by count + tokens) → Task 6, Task 12.
   - Auto-dream gates (AI enabled, auto-dream enabled, 24h, 5 sources, lock, stale recovery, failure circuitry) → Task 10.
   - Auto-dream from chat → Task 13.
   - Auto-dream from agent tasks → Task 9 (collector) + Task 14 (trigger).
   - Source boundaries via `reviewedThrough` → Task 9 + Task 10.
   - Closed taxonomy + secret filtering → Task 8.
   - Consolidation run record with status/counts → Task 5 + Task 10.
   - Settings `USER_AI_AUTO_DREAM`, `USER_AI_MEMORY_INJECTION` → Task 1.
   - IPC channel allowlist + preload → Task 11.
   - "Archive is default; hard delete allowed" → Task 4 module exposes both.
   - "Apply archives before updates/creates" → Task 10 `executeRun` ordering.

2. **Deferred (out of scope for this plan):**
   - Memory management UI (PRD Milestone 6) — follow-up plan.
   - sqlite-vec semantic retrieval (PRD Milestone 7) — follow-up plan.
   - Built-in `remember_user_memory` tool/skill — follow-up plan; manual IPC + `rememberFromAssistant` covers the v1 write path.

3. **Type consistency:** Method names match across model/module/service/IPCTest. `AIUserMemoryCreateInput`, `AIUserMemoryUpdateInput`, `AIUserMemoryView`, `AIMemoryConsolidationRunView` are defined once in Task 1 and reused everywhere. `AutoDreamSourcePacket` is defined in Task 9 and imported by Task 8 (prompt builder) and Task 10 (service).

4. **Known gaps to address during implementation:**
   - The real shape of `AIChatV2Module.getConversations()` — Task 9 Step 1 checks this and substitutes the real method name.
   - The real shape of `ok`/`denied`/`CommonMessage` helpers in the IPC layer — Task 11 Step 4 notes to mirror the existing compact IPC file.
   - The real preload allowlist style — Task 11 Step 6 notes to follow the existing convention.
