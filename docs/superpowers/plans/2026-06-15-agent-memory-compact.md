# Agent Memory And Conversation Compact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ai-chat-v2's fixed 30-message context window with a provider-neutral compact system that maintains a rolling session memory after each completed turn and supports manual full-compact, while preserving original chat history.

**Architecture:** Add two TypeORM entities (`ai_chat_session_memories`, `ai_chat_compact_summaries`) following the existing Entity→Model→Module→Service→IPC layering. Introduce `AIChatContextAssembler` (owns prompt assembly), `AIChatCompactAgentService` (background queue + full compact), `AIChatTokenEstimator` (token budgeting), and `AIChatCompactPromptBuilder` (prompt templates). Wire the assembler into `AIChatQueryEngine` in place of `buildOpenAITranscript()`, and enqueue session-memory updates after completed assistant turns.

**Tech Stack:** TypeScript 5.x, TypeORM + better-sqlite3, Electron main-process services, Vitest with `vi.mock` for module isolation.

**Scope (this plan):** PRD Milestones 1–4 (database layer, session memory compact, context assembler, full compact + manual IPC). UI controls (Milestone 5) and durable cross-conversation memory (Milestone 6) are explicitly deferred to follow-up plans.

**Out of scope:**
- UI for compact status / manual compact button (deferred — IPC is exposed and tested).
- Auto-threshold full compact (we ship the trigger path but only manual + prompt-too-large fallback call it in this plan).
- Durable memory taxonomy, inspect/edit/archive UI.

**Conventions used throughout:**
- Entities extend `AuditableEntity` and use `@Order(n)` from `@/entity/order.decorator`.
- Models extend `BaseDb` (constructor takes `dbpath`), expose `this.repository` via `this.sqliteDb.connection.getRepository(Entity)`.
- Modules extend `BaseModule` (auto-resolves `dbpath` from `Token`), instantiate models with `this.dbpath`.
- Services are plain classes with constructor-injected deps for testability.
- Tests live in `test/vitest/main/service/` and `test/vitest/main/modules/` and use `vi.mock` for Module/Api isolation.
- Every IPC handler checks `isAIEnabled()` before parsing request data.

---

## File Structure

**Create:**
- `src/entity/AIChatSessionMemory.entity.ts` — TypeORM entity for `ai_chat_session_memories`.
- `src/entity/AIChatCompactSummary.entity.ts` — TypeORM entity for `ai_chat_compact_summaries`.
- `src/entityTypes/aiChatCompactTypes.ts` — Shared types: status unions, view interfaces, request/response shapes.
- `src/model/AIChatSessionMemory.model.ts` — Data access for session memory.
- `src/model/AIChatCompactSummary.model.ts` — Data access for compact summaries.
- `src/modules/AIChatSessionMemoryModule.ts` — Business logic for session memory.
- `src/modules/AIChatCompactModule.ts` — Business logic for compact summaries.
- `src/service/AIChatTokenEstimator.ts` — Conservative `length/4` token estimator.
- `src/service/AIChatCompactPromptBuilder.ts` — Prompt templates + summary normalization.
- `src/service/AIChatCompactAgentService.ts` — Background session-memory queue + full compact.
- `src/service/AIChatContextAssembler.ts` — Final prompt assembler.
- `test/vitest/main/service/AIChatTokenEstimator.test.ts`
- `test/vitest/main/service/AIChatCompactPromptBuilder.test.ts`
- `test/vitest/main/service/AIChatCompactAgentService.test.ts`
- `test/vitest/main/service/AIChatContextAssembler.test.ts`
- `test/vitest/main/modules/AIChatSessionMemoryModule.test.ts`
- `test/vitest/main/modules/AIChatCompactModule.test.ts`
- `test/vitest/main/ipc/ai-chat-v2-compact-ipc.test.ts`

**Modify:**
- `src/config/SqliteDb.ts` — register both new entities.
- `src/modules/AIChatV2Module.ts` — add compact-clear cascade.
- `src/service/AIChatQueryEngine.ts` — use context assembler; enqueue session-memory update after completion.
- `src/main-process/communication/ai-chat-v2-ipc.ts` — inject new deps into engine factory; add manual compact handler.
- `src/config/channellist.ts` — add `AI_CHAT_V2_COMPACT_CONVERSATION`.

---

## Task 1: Session Memory Entity + SqliteDb Registration

**Files:**
- Create: `src/entity/AIChatSessionMemory.entity.ts`
- Modify: `src/config/SqliteDb.ts` (add import + entity to the `entities` array)

- [ ] **Step 1: Write the entity**

Create `src/entity/AIChatSessionMemory.entity.ts`:

```ts
import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("ai_chat_session_memories")
@Index("idx_session_memories_conv", ["conversationId"], { unique: true })
@Index("idx_session_memories_status", ["status"])
@Index("idx_session_memories_updated", ["updatedAt"])
export class AIChatSessionMemoryEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(2)
  @Column("text", { nullable: false })
  summary: string;

  @Order(3)
  @Column("varchar", { length: 100, nullable: true })
  coveredThroughMessageId?: string;

  @Order(4)
  @Column("datetime", { nullable: true })
  coveredThroughTimestamp?: Date;

  @Order(5)
  @Column("int", { nullable: false, default: 0 })
  sourceMessageCount: number;

  @Order(6)
  @Column("int", { nullable: true })
  tokenEstimate?: number;

  @Order(7)
  @Column("varchar", { length: 100, nullable: true })
  model?: string;

  @Order(8)
  @Column("int", { nullable: false, default: 0 })
  failureCount: number;

  @Order(9)
  @Column("text", { nullable: true })
  lastError?: string;

  @Order(10)
  @Column("varchar", { length: 30, nullable: false, default: "active" })
  status: string; // 'active' | 'updating' | 'failed' | 'disabled'
}
```

- [ ] **Step 2: Register in SqliteDb**

In `src/config/SqliteDb.ts`:
- Add to imports near `AIChatPlanApprovalEntity`:

```ts
import { AIChatSessionMemoryEntity } from "@/entity/AIChatSessionMemory.entity";
```

- Add `AIChatSessionMemoryEntity,` to the `entities: [...]` array (after `AIChatPlanApprovalEntity,`).

- [ ] **Step 3: Type check**

Run: `yarn vue-check 2>&1 | tail -20` (or `yarn tsc --noEmit` if vue-check is unavailable).
Expected: no new errors mentioning `AIChatSessionMemory`.

- [ ] **Step 4: Commit**

```bash
git add src/entity/AIChatSessionMemory.entity.ts src/config/SqliteDb.ts
git commit -m "feat(ai-chat-compact): add AIChatSessionMemoryEntity"
```

---

## Task 2: Compact Summary Entity + SqliteDb Registration

**Files:**
- Create: `src/entity/AIChatCompactSummary.entity.ts`
- Modify: `src/config/SqliteDb.ts`

- [ ] **Step 1: Write the entity**

Create `src/entity/AIChatCompactSummary.entity.ts`:

```ts
import "reflect-metadata";
import { Entity, Column, Index, PrimaryGeneratedColumn } from "typeorm";
import AuditableEntity from "./Auditable.entity";
import { Order } from "./order.decorator";

@Entity("ai_chat_compact_summaries")
@Index("idx_compact_summaries_conv", ["conversationId"])
@Index("idx_compact_summaries_conv_status", ["conversationId", "status"])
@Index("idx_compact_summaries_through", ["throughTimestamp"])
export class AIChatCompactSummaryEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 100, nullable: false, unique: true })
  compactId: string;

  @Order(2)
  @Column("varchar", { length: 100, nullable: false })
  conversationId: string;

  @Order(3)
  @Column("text", { nullable: false })
  summary: string;

  @Order(4)
  @Column("varchar", { length: 100, nullable: true })
  fromMessageId?: string;

  @Order(5)
  @Column("varchar", { length: 100, nullable: false })
  throughMessageId: string;

  @Order(6)
  @Column("datetime", { nullable: false })
  throughTimestamp: Date;

  @Order(7)
  @Column("int", { nullable: false, default: 0 })
  sourceMessageCount: number;

  @Order(8)
  @Column("int", { nullable: true })
  inputTokenEstimate?: number;

  @Order(9)
  @Column("int", { nullable: true })
  outputTokenEstimate?: number;

  @Order(10)
  @Column("varchar", { length: 100, nullable: true })
  model?: string;

  @Order(11)
  @Column("varchar", { length: 30, nullable: false, default: "active" })
  status: string; // 'active' | 'superseded' | 'failed'
}
```

- [ ] **Step 2: Register in SqliteDb**

Add import `import { AIChatCompactSummaryEntity } from "@/entity/AIChatCompactSummary.entity";` and `AIChatCompactSummaryEntity,` to the `entities` array right after the session memory entity.

- [ ] **Step 3: Type check**

Run: `yarn vue-check 2>&1 | tail -20`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/entity/AIChatCompactSummary.entity.ts src/config/SqliteDb.ts
git commit -m "feat(ai-chat-compact): add AIChatCompactSummaryEntity"
```

---

## Task 3: Compact Shared Types

**Files:**
- Create: `src/entityTypes/aiChatCompactTypes.ts`

- [ ] **Step 1: Write the types**

Create `src/entityTypes/aiChatCompactTypes.ts`:

```ts
export type AIChatSessionMemoryStatus =
  | "active"
  | "updating"
  | "failed"
  | "disabled";

export type AIChatCompactSummaryStatus = "active" | "superseded" | "failed";

/** Serializer-friendly view used by modules, services, and IPC. */
export interface AIChatSessionMemoryView {
  conversationId: string;
  summary: string;
  coveredThroughMessageId?: string;
  coveredThroughTimestamp?: string;
  sourceMessageCount: number;
  tokenEstimate?: number;
  model?: string;
  failureCount: number;
  lastError?: string;
  status: AIChatSessionMemoryStatus;
  updatedAt?: string;
}

export interface AIChatCompactSummaryView {
  compactId: string;
  conversationId: string;
  summary: string;
  fromMessageId?: string;
  throughMessageId: string;
  throughTimestamp: string;
  sourceMessageCount: number;
  inputTokenEstimate?: number;
  outputTokenEstimate?: number;
  model?: string;
  status: AIChatCompactSummaryStatus;
  updatedAt?: string;
}

export interface AIChatCompactConversationRequest {
  conversationId: string;
}
```

- [ ] **Step 2: Type check**

Run: `yarn vue-check 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/entityTypes/aiChatCompactTypes.ts
git commit -m "feat(ai-chat-compact): add shared compact type definitions"
```

---

## Task 4: Session Memory Model

**Files:**
- Create: `src/model/AIChatSessionMemory.model.ts`
- Test: `test/vitest/main/modules/AIChatSessionMemoryModel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/modules/AIChatSessionMemoryModel.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { AIChatSessionMemoryModel } from "@/model/AIChatSessionMemory.model";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-compact-mem-model");
beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  // fresh singleton per test file process
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
});

describe("AIChatSessionMemoryModel", () => {
  it("upserts by conversationId (insert then update)", async () => {
    const model = new AIChatSessionMemoryModel(tmpDir);
    await SqliteDb.ensureInitialized();

    const created = await model.upsertMemory({
      conversationId: "v2-conv-1",
      summary: "# Session Memory\n## Current Goal\nship it",
      coveredThroughMessageId: "msg-1",
      coveredThroughTimestamp: new Date(1),
      sourceMessageCount: 1,
      tokenEstimate: 10,
      model: "test-model",
      status: "active",
    });
    expect(created.conversationId).toBe("v2-conv-1");
    expect(created.failureCount).toBe(0);

    const updated = await model.upsertMemory({
      conversationId: "v2-conv-1",
      summary: "# Session Memory\n## Current Goal\nship it v2",
      coveredThroughMessageId: "msg-2",
      coveredThroughTimestamp: new Date(2),
      sourceMessageCount: 2,
      tokenEstimate: 20,
      model: "test-model",
      status: "active",
    });
    expect(updated.sourceMessageCount).toBe(2);

    const all = await model.listAll();
    expect(all.length).toBe(1);
  });

  it("getByConversation returns null when absent", async () => {
    const model = new AIChatSessionMemoryModel(tmpDir);
    await SqliteDb.ensureInitialized();
    expect(await model.getByConversation("v2-missing")).toBeNull();
  });

  it("records failure count and lastError", async () => {
    const model = new AIChatSessionMemoryModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await model.upsertMemory({
      conversationId: "v2-fail",
      summary: "",
      sourceMessageCount: 0,
      status: "active",
    });
    const after = await model.recordFailure("v2-fail", "boom");
    expect(after.failureCount).toBe(1);
    expect(after.lastError).toBe("boom");
  });

  it("deletes by conversation", async () => {
    const model = new AIChatSessionMemoryModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await model.upsertMemory({
      conversationId: "v2-del",
      summary: "x",
      sourceMessageCount: 0,
      status: "active",
    });
    const affected = await model.deleteByConversation("v2-del");
    expect(affected).toBe(1);
    expect(await model.getByConversation("v2-del")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/modules/AIChatSessionMemoryModel.test.ts`
Expected: FAIL — module `@/model/AIChatSessionMemory.model` not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/model/AIChatSessionMemory.model.ts`:

```ts
import { BaseDb } from "@/model/Basedb";
import { AIChatSessionMemoryEntity } from "@/entity/AIChatSessionMemory.entity";
import { Repository } from "typeorm";
import type { AIChatSessionMemoryStatus } from "@/entityTypes/aiChatCompactTypes";

export interface SessionMemoryUpsertInput {
  conversationId: string;
  summary: string;
  coveredThroughMessageId?: string;
  coveredThroughTimestamp?: Date;
  sourceMessageCount: number;
  tokenEstimate?: number;
  model?: string;
  status: AIChatSessionMemoryStatus;
}

export class AIChatSessionMemoryModel extends BaseDb {
  public repository: Repository<AIChatSessionMemoryEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository =
      this.sqliteDb.connection.getRepository(AIChatSessionMemoryEntity);
  }

  async getByConversation(
    conversationId: string
  ): Promise<AIChatSessionMemoryEntity | null> {
    return this.repository.findOne({ where: { conversationId } });
  }

  async upsertMemory(
    input: SessionMemoryUpsertInput
  ): Promise<AIChatSessionMemoryEntity> {
    const existing = await this.getByConversation(input.conversationId);
    if (existing) {
      const patch: Partial<AIChatSessionMemoryEntity> = {
        summary: input.summary,
        sourceMessageCount: input.sourceMessageCount,
        status: input.status,
      };
      if (input.coveredThroughMessageId !== undefined)
        patch.coveredThroughMessageId = input.coveredThroughMessageId;
      if (input.coveredThroughTimestamp !== undefined)
        patch.coveredThroughTimestamp = input.coveredThroughTimestamp;
      if (input.tokenEstimate !== undefined)
        patch.tokenEstimate = input.tokenEstimate;
      if (input.model !== undefined) patch.model = input.model;
      await this.repository.update({ id: existing.id }, patch);
      return (await this.repository.findOne({ where: { id: existing.id } }))!;
    }
    const entity = new AIChatSessionMemoryEntity();
    entity.conversationId = input.conversationId;
    entity.summary = input.summary;
    entity.sourceMessageCount = input.sourceMessageCount;
    entity.status = input.status;
    if (input.coveredThroughMessageId !== undefined)
      entity.coveredThroughMessageId = input.coveredThroughMessageId;
    if (input.coveredThroughTimestamp !== undefined)
      entity.coveredThroughTimestamp = input.coveredThroughTimestamp;
    if (input.tokenEstimate !== undefined)
      entity.tokenEstimate = input.tokenEstimate;
    if (input.model !== undefined) entity.model = input.model;
    return this.repository.save(entity);
  }

  async setStatus(
    conversationId: string,
    status: AIChatSessionMemoryStatus
  ): Promise<void> {
    await this.repository.update({ conversationId }, { status });
  }

  async recordFailure(
    conversationId: string,
    errorMessage: string
  ): Promise<AIChatSessionMemoryEntity | null> {
    const existing = await this.getByConversation(conversationId);
    if (!existing) return null;
    const next = existing.failureCount + 1;
    await this.repository.update(
      { id: existing.id },
      { failureCount: next, lastError: errorMessage }
    );
    return this.repository.findOne({ where: { id: existing.id } });
  }

  async resetFailures(conversationId: string): Promise<void> {
    await this.repository.update(
      { conversationId },
      { failureCount: 0, lastError: undefined as unknown as string }
    );
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    const r = await this.repository.delete({ conversationId });
    return r.affected ?? 0;
  }

  async deleteAllV2(): Promise<number> {
    const r = await this.repository.delete({});
    return r.affected ?? 0;
  }

  /** Test-only helper — never call from production code. */
  async listAll(): Promise<AIChatSessionMemoryEntity[]> {
    return this.repository.find();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn vitest run test/vitest/main/modules/AIChatSessionMemoryModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model/AIChatSessionMemory.model.ts test/vitest/main/modules/AIChatSessionMemoryModel.test.ts
git commit -m "feat(ai-chat-compact): add AIChatSessionMemoryModel with upsert/failure/clear"
```

---

## Task 5: Compact Summary Model

**Files:**
- Create: `src/model/AIChatCompactSummary.model.ts`
- Test: `test/vitest/main/modules/AIChatCompactSummaryModel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/modules/AIChatCompactSummaryModel.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { AIChatCompactSummaryModel } from "@/model/AIChatCompactSummary.model";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-compact-sum-model");
beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
});

describe("AIChatCompactSummaryModel", () => {
  it("saves and fetches active summary", async () => {
    const m = new AIChatCompactSummaryModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await m.saveFullCompact({
      compactId: "compact-1",
      conversationId: "v2-c1",
      summary: "# Compact Summary\n## Primary Request\nship",
      fromMessageId: "msg-1",
      throughMessageId: "msg-5",
      throughTimestamp: new Date(5),
      sourceMessageCount: 5,
      inputTokenEstimate: 100,
      outputTokenEstimate: 50,
      model: "test-model",
      status: "active",
    });
    const active = await m.getActiveSummary("v2-c1");
    expect(active?.compactId).toBe("compact-1");
    expect(active?.status).toBe("active");
  });

  it("marks prior active as superseded when a new active is saved", async () => {
    const m = new AIChatCompactSummaryModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await m.saveFullCompact({
      compactId: "compact-1",
      conversationId: "v2-c2",
      summary: "v1",
      throughMessageId: "msg-3",
      throughTimestamp: new Date(3),
      sourceMessageCount: 3,
      status: "active",
    });
    await m.saveFullCompact({
      compactId: "compact-2",
      conversationId: "v2-c2",
      summary: "v2",
      throughMessageId: "msg-6",
      throughTimestamp: new Date(6),
      sourceMessageCount: 6,
      status: "active",
    });
    const active = await m.getActiveSummary("v2-c2");
    expect(active?.compactId).toBe("compact-2");
    const all = await m.listByConversation("v2-c2");
    expect(all.length).toBe(2);
    expect(all.find((s) => s.compactId === "compact-1")?.status).toBe(
      "superseded"
    );
  });

  it("deletes by conversation and deleteAllV2", async () => {
    const m = new AIChatCompactSummaryModel(tmpDir);
    await SqliteDb.ensureInitialized();
    await m.saveFullCompact({
      compactId: "compact-3",
      conversationId: "v2-c3",
      summary: "x",
      throughMessageId: "m",
      throughTimestamp: new Date(1),
      sourceMessageCount: 1,
      status: "active",
    });
    expect(await m.deleteByConversation("v2-c3")).toBe(1);
    expect(await m.getActiveSummary("v2-c3")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/modules/AIChatCompactSummaryModel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/model/AIChatCompactSummary.model.ts`:

```ts
import { BaseDb } from "@/model/Basedb";
import { AIChatCompactSummaryEntity } from "@/entity/AIChatCompactSummary.entity";
import { Repository } from "typeorm";
import type { AIChatCompactSummaryStatus } from "@/entityTypes/aiChatCompactTypes";

export interface CompactSummarySaveInput {
  compactId: string;
  conversationId: string;
  summary: string;
  fromMessageId?: string;
  throughMessageId: string;
  throughTimestamp: Date;
  sourceMessageCount: number;
  inputTokenEstimate?: number;
  outputTokenEstimate?: number;
  model?: string;
  status: AIChatCompactSummaryStatus;
}

export class AIChatCompactSummaryModel extends BaseDb {
  public repository: Repository<AIChatCompactSummaryEntity>;

  constructor(dbpath: string) {
    super(dbpath);
    this.repository =
      this.sqliteDb.connection.getRepository(AIChatCompactSummaryEntity);
  }

  async getActiveSummary(
    conversationId: string
  ): Promise<AIChatCompactSummaryEntity | null> {
    return this.repository.findOne({
      where: { conversationId, status: "active" },
      order: { throughTimestamp: "DESC" },
    });
  }

  async listByConversation(
    conversationId: string
  ): Promise<AIChatCompactSummaryEntity[]> {
    return this.repository.find({
      where: { conversationId },
      order: { throughTimestamp: "ASC" },
    });
  }

  async saveFullCompact(
    input: CompactSummarySaveInput
  ): Promise<AIChatCompactSummaryEntity> {
    if (input.status === "active") {
      await this.markSuperseded(input.conversationId);
    }
    const entity = new AIChatCompactSummaryEntity();
    entity.compactId = input.compactId;
    entity.conversationId = input.conversationId;
    entity.summary = input.summary;
    entity.throughMessageId = input.throughMessageId;
    entity.throughTimestamp = input.throughTimestamp;
    entity.sourceMessageCount = input.sourceMessageCount;
    entity.status = input.status;
    if (input.fromMessageId !== undefined)
      entity.fromMessageId = input.fromMessageId;
    if (input.inputTokenEstimate !== undefined)
      entity.inputTokenEstimate = input.inputTokenEstimate;
    if (input.outputTokenEstimate !== undefined)
      entity.outputTokenEstimate = input.outputTokenEstimate;
    if (input.model !== undefined) entity.model = input.model;
    return this.repository.save(entity);
  }

  async markSuperseded(
    conversationId: string,
    exceptCompactId?: string
  ): Promise<number> {
    const actives = await this.repository.find({
      where: { conversationId, status: "active" },
    });
    let affected = 0;
    for (const a of actives) {
      if (exceptCompactId && a.compactId === exceptCompactId) continue;
      await this.repository.update({ id: a.id }, { status: "superseded" });
      affected += 1;
    }
    return affected;
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    const r = await this.repository.delete({ conversationId });
    return r.affected ?? 0;
  }

  async deleteAllV2(): Promise<number> {
    const r = await this.repository.delete({});
    return r.affected ?? 0;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `yarn vitest run test/vitest/main/modules/AIChatCompactSummaryModel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model/AIChatCompactSummary.model.ts test/vitest/main/modules/AIChatCompactSummaryModel.test.ts
git commit -m "feat(ai-chat-compact): add AIChatCompactSummaryModel with active-supersede logic"
```

---

## Task 6: Session Memory Module (View Conversion + Public API)

**Files:**
- Create: `src/modules/AIChatSessionMemoryModule.ts`
- Test: `test/vitest/main/modules/AIChatSessionMemoryModule.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/modules/AIChatSessionMemoryModule.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { AIChatSessionMemoryModule } from "@/modules/AIChatSessionMemoryModule";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-compact-mem-mod");
beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath = null;
  (SqliteDb as unknown as { initPromise: unknown }).initPromise = null;
  // Use the temp dir as the module's dbpath source.
  process.env.AIFETCHLY_TEST_DBPATH = tmpDir;
});

// Override Token to point at tmpDir so BaseModule resolves the test db.
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return process.env.AIFETCHLY_TEST_DBPATH ?? tmpDir;
    }
  },
}));

import { vi } from "vitest";

describe("AIChatSessionMemoryModule", () => {
  it("round-trips a memory through upsert + getByConversation", async () => {
    const mod = new AIChatSessionMemoryModule();
    await SqliteDb.ensureInitialized();
    const view = await mod.upsertMemory({
      conversationId: "v2-a",
      summary: "# Session Memory",
      sourceMessageCount: 0,
      status: "active",
    });
    expect(view.conversationId).toBe("v2-a");
    expect(view.failureCount).toBe(0);
    const fetched = await mod.getByConversation("v2-a");
    expect(fetched?.conversationId).toBe("v2-a");
  });

  it("increments failureCount and stores lastError via recordFailure", async () => {
    const mod = new AIChatSessionMemoryModule();
    await SqliteDb.ensureInitialized();
    await mod.upsertMemory({
      conversationId: "v2-b",
      summary: "",
      sourceMessageCount: 0,
      status: "active",
    });
    const v = await mod.recordFailure("v2-b", "timeout");
    expect(v?.failureCount).toBe(1);
    expect(v?.lastError).toBe("timeout");
  });

  it("deletes memory for a conversation", async () => {
    const mod = new AIChatSessionMemoryModule();
    await SqliteDb.ensureInitialized();
    await mod.upsertMemory({
      conversationId: "v2-del",
      summary: "x",
      sourceMessageCount: 0,
      status: "active",
    });
    expect(await mod.deleteByConversation("v2-del")).toBe(1);
    expect(await mod.getByConversation("v2-del")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/modules/AIChatSessionMemoryModule.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/modules/AIChatSessionMemoryModule.ts`:

```ts
import { BaseModule } from "@/modules/baseModule";
import {
  AIChatSessionMemoryModel,
  SessionMemoryUpsertInput,
} from "@/model/AIChatSessionMemory.model";
import type {
  AIChatSessionMemoryStatus,
  AIChatSessionMemoryView,
} from "@/entityTypes/aiChatCompactTypes";

export class AIChatSessionMemoryModule extends BaseModule {
  private memoryModel: AIChatSessionMemoryModel;

  constructor() {
    super();
    this.memoryModel = new AIChatSessionMemoryModel(this.dbpath);
  }

  async getByConversation(
    conversationId: string
  ): Promise<AIChatSessionMemoryView | null> {
    const e = await this.memoryModel.getByConversation(conversationId);
    return e ? this.toView(e) : null;
  }

  async upsertMemory(
    input: SessionMemoryUpsertInput
  ): Promise<AIChatSessionMemoryView> {
    const e = await this.memoryModel.upsertMemory(input);
    return this.toView(e);
  }

  async setStatus(
    conversationId: string,
    status: AIChatSessionMemoryStatus
  ): Promise<void> {
    await this.memoryModel.setStatus(conversationId, status);
  }

  async markUpdating(conversationId: string): Promise<void> {
    await this.memoryModel.setStatus(conversationId, "updating");
  }

  async recordFailure(
    conversationId: string,
    errorMessage: string
  ): Promise<AIChatSessionMemoryView | null> {
    const e = await this.memoryModel.recordFailure(conversationId, errorMessage);
    return e ? this.toView(e) : null;
  }

  async resetFailures(conversationId: string): Promise<void> {
    await this.memoryModel.resetFailures(conversationId);
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    return this.memoryModel.deleteByConversation(conversationId);
  }

  async deleteAllV2(): Promise<number> {
    return this.memoryModel.deleteAllV2();
  }

  private toView(e: {
    conversationId: string;
    summary: string;
    coveredThroughMessageId?: string;
    coveredThroughTimestamp?: Date;
    sourceMessageCount: number;
    tokenEstimate?: number;
    model?: string;
    failureCount: number;
    lastError?: string;
    status: string;
    updatedAt?: Date;
  }): AIChatSessionMemoryView {
    return {
      conversationId: e.conversationId,
      summary: e.summary,
      coveredThroughMessageId: e.coveredThroughMessageId,
      coveredThroughTimestamp: e.coveredThroughTimestamp?.toISOString(),
      sourceMessageCount: e.sourceMessageCount,
      tokenEstimate: e.tokenEstimate,
      model: e.model,
      failureCount: e.failureCount,
      lastError: e.lastError,
      status: e.status as AIChatSessionMemoryStatus,
      updatedAt: e.updatedAt?.toISOString(),
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `yarn vitest run test/vitest/main/modules/AIChatSessionMemoryModule.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/AIChatSessionMemoryModule.ts test/vitest/main/modules/AIChatSessionMemoryModule.test.ts
git commit -m "feat(ai-chat-compact): add AIChatSessionMemoryModule with view conversion"
```

---

## Task 7: Compact Summary Module

**Files:**
- Create: `src/modules/AIChatCompactModule.ts`
- Test: `test/vitest/main/modules/AIChatCompactModule.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/modules/AIChatCompactModule.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { AIChatCompactModule } from "@/modules/AIChatCompactModule";
import { SqliteDb } from "@/config/SqliteDb";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = path.join(os.tmpdir(), "aifetchly-compact-mod");
beforeEach(() => {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  (SqliteDb as unknown as { instance: unknown }).instance = null;
  (SqliteDb as unknown as { currentDbPath: string | null }).currentDbPath =
    null;
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

describe("AIChatCompactModule", () => {
  it("saves a full compact and exposes the active summary", async () => {
    const mod = new AIChatCompactModule();
    await SqliteDb.ensureInitialized();
    const v = await mod.saveFullCompact({
      compactId: "c-1",
      conversationId: "v2-z",
      summary: "# Compact Summary",
      throughMessageId: "m-5",
      throughTimestamp: new Date(5),
      sourceMessageCount: 5,
      status: "active",
    });
    expect(v.compactId).toBe("c-1");
    const active = await mod.getActiveSummary("v2-z");
    expect(active?.compactId).toBe("c-1");
  });

  it("clears by conversation", async () => {
    const mod = new AIChatCompactModule();
    await SqliteDb.ensureInitialized();
    await mod.saveFullCompact({
      compactId: "c-2",
      conversationId: "v2-clear",
      summary: "x",
      throughMessageId: "m",
      throughTimestamp: new Date(1),
      sourceMessageCount: 1,
      status: "active",
    });
    expect(await mod.deleteByConversation("v2-clear")).toBe(1);
    expect(await mod.getActiveSummary("v2-clear")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/modules/AIChatCompactModule.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/modules/AIChatCompactModule.ts`:

```ts
import { BaseModule } from "@/modules/baseModule";
import {
  AIChatCompactSummaryModel,
  CompactSummarySaveInput,
} from "@/model/AIChatCompactSummary.model";
import type { AIChatCompactSummaryView } from "@/entityTypes/aiChatCompactTypes";

export class AIChatCompactModule extends BaseModule {
  private compactModel: AIChatCompactSummaryModel;

  constructor() {
    super();
    this.compactModel = new AIChatCompactSummaryModel(this.dbpath);
  }

  async getActiveSummary(
    conversationId: string
  ): Promise<AIChatCompactSummaryView | null> {
    const e = await this.compactModel.getActiveSummary(conversationId);
    return e ? this.toView(e) : null;
  }

  async saveFullCompact(
    input: CompactSummarySaveInput
  ): Promise<AIChatCompactSummaryView> {
    const e = await this.compactModel.saveFullCompact(input);
    return this.toView(e);
  }

  async markSuperseded(
    conversationId: string,
    exceptCompactId?: string
  ): Promise<number> {
    return this.compactModel.markSuperseded(conversationId, exceptCompactId);
  }

  async deleteByConversation(conversationId: string): Promise<number> {
    return this.compactModel.deleteByConversation(conversationId);
  }

  async deleteAllV2(): Promise<number> {
    return this.compactModel.deleteAllV2();
  }

  private toView(e: {
    compactId: string;
    conversationId: string;
    summary: string;
    fromMessageId?: string;
    throughMessageId: string;
    throughTimestamp: Date;
    sourceMessageCount: number;
    inputTokenEstimate?: number;
    outputTokenEstimate?: number;
    model?: string;
    status: string;
    updatedAt?: Date;
  }): AIChatCompactSummaryView {
    return {
      compactId: e.compactId,
      conversationId: e.conversationId,
      summary: e.summary,
      fromMessageId: e.fromMessageId,
      throughMessageId: e.throughMessageId,
      throughTimestamp: e.throughTimestamp.toISOString(),
      sourceMessageCount: e.sourceMessageCount,
      inputTokenEstimate: e.inputTokenEstimate,
      outputTokenEstimate: e.outputTokenEstimate,
      model: e.model,
      status: e.status as AIChatCompactSummaryView["status"],
      updatedAt: e.updatedAt?.toISOString(),
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `yarn vitest run test/vitest/main/modules/AIChatCompactModule.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/AIChatCompactModule.ts test/vitest/main/modules/AIChatCompactModule.test.ts
git commit -m "feat(ai-chat-compact): add AIChatCompactModule"
```

---

## Task 8: Token Estimator

**Files:**
- Create: `src/service/AIChatTokenEstimator.ts`
- Test: `test/vitest/main/service/AIChatTokenEstimator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/AIChatTokenEstimator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AIChatTokenEstimator } from "@/service/AIChatTokenEstimator";
import type { OpenAIChatMessage } from "@/api/aiChatApi";

describe("AIChatTokenEstimator", () => {
  it("uses ceil(length/4) for plain text", () => {
    const est = new AIChatTokenEstimator();
    expect(est.estimateText("")).toBe(0);
    expect(est.estimateText("hello")).toBe(2); // 5/4 = 1.25 -> 2
    expect(est.estimateText("12345678")).toBe(2); // 8/4 = 2
  });

  it("counts role + content per message", () => {
    const est = new AIChatTokenEstimator();
    const msg: OpenAIChatMessage = { role: "user", content: "hello world" };
    const t = est.estimateMessage(msg);
    expect(t).toBeGreaterThan(0);
  });

  it("sums an array of messages with overhead", () => {
    const est = new AIChatTokenEstimator();
    const total = est.estimateMessages([
      { role: "system", content: "abc" },
      { role: "user", content: "defghi" },
    ]);
    expect(total).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/service/AIChatTokenEstimator.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Create `src/service/AIChatTokenEstimator.ts`:

```ts
import type { OpenAIChatMessage } from "@/api/aiChatApi";

/** Conservative per-message overhead added to account for role tagging. */
const MESSAGE_OVERHEAD_TOKENS = 4;

/** Safety buffer added to final prompt totals. */
const PROMPT_SAFETY_BUFFER_TOKENS = 256;

export class AIChatTokenEstimator {
  estimateText(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  estimateMessage(message: OpenAIChatMessage): number {
    const role = typeof message.role === "string" ? message.role : "";
    const content = typeof message.content === "string" ? message.content : "";
    let total = this.estimateText(role) + this.estimateText(content);
    if (message.tool_call_id) {
      total += this.estimateText(message.tool_call_id);
    }
    if (Array.isArray(message.tool_calls)) {
      total += this.estimateText(JSON.stringify(message.tool_calls));
    }
    return total + MESSAGE_OVERHEAD_TOKENS;
  }

  estimateMessages(messages: readonly OpenAIChatMessage[]): number {
    let sum = 0;
    for (const m of messages) {
      sum += this.estimateMessage(m);
    }
    return sum + PROMPT_SAFETY_BUFFER_TOKENS;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `yarn vitest run test/vitest/main/service/AIChatTokenEstimator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/service/AIChatTokenEstimator.ts test/vitest/main/service/AIChatTokenEstimator.test.ts
git commit -m "feat(ai-chat-compact): add AIChatTokenEstimator with conservative length/4 heuristic"
```

---

## Task 9: Compact Prompt Builder

**Files:**
- Create: `src/service/AIChatCompactPromptBuilder.ts`
- Test: `test/vitest/main/service/AIChatCompactPromptBuilder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/AIChatCompactPromptBuilder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildSessionMemorySystemPrompt,
  buildSessionMemoryUserPrompt,
  buildFullCompactSystemPrompt,
  buildFullCompactUserPrompt,
  normalizeSessionMemorySummary,
  normalizeFullCompactSummary,
  SESSION_MEMORY_HEADINGS,
  FULL_COMPACT_HEADINGS,
} from "@/service/AIChatCompactPromptBuilder";

describe("AIChatCompactPromptBuilder", () => {
  it("session memory system prompt forbids secrets", () => {
    const p = buildSessionMemorySystemPrompt();
    expect(p.toLowerCase()).toContain("secret");
    expect(p.toLowerCase()).toContain("token");
  });

  it("session memory user prompt embeds existing memory and new messages", () => {
    const u = buildSessionMemoryUserPrompt("old memory", [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    expect(u).toContain("old memory");
    expect(u).toContain("hi");
    expect(u).toContain("hello");
    for (const h of SESSION_MEMORY_HEADINGS) {
      expect(u).toContain(h);
    }
  });

  it("full compact user prompt embeds all messages", () => {
    const u = buildFullCompactUserPrompt([
      { role: "user", content: "do X" },
      { role: "assistant", content: "ok" },
    ]);
    expect(u).toContain("do X");
    expect(u).toContain("ok");
    for (const h of FULL_COMPACT_HEADINGS) {
      expect(u).toContain(h);
    }
  });

  it("normalizeSessionMemorySummary injects missing headings", () => {
    const { summary, ok } = normalizeSessionMemorySummary(
      "## Current Goal\nship"
    );
    expect(ok).toBe(true);
    for (const h of SESSION_MEMORY_HEADINGS) {
      expect(summary).toContain(h);
    }
  });

  it("normalizeSessionMemorySummary rejects empty content", () => {
    const { ok } = normalizeSessionMemorySummary("   ");
    expect(ok).toBe(false);
  });

  it("normalizeFullCompactSummary injects missing headings", () => {
    const { summary, ok } = normalizeFullCompactSummary(
      "## Primary Request\nship it"
    );
    expect(ok).toBe(true);
    for (const h of FULL_COMPACT_HEADINGS) {
      expect(summary).toContain(h);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/service/AIChatCompactPromptBuilder.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Create `src/service/AIChatCompactPromptBuilder.ts`:

```ts
import type { OpenAIChatMessage } from "@/api/aiChatApi";

export const SESSION_MEMORY_HEADINGS = [
  "# Session Memory",
  "## Current Goal",
  "## User Preferences In This Session",
  "## Decisions Made",
  "## Files And Tools Used",
  "## Errors And Fixes",
  "## Pending Tasks",
  "## Last Known State",
  "## Next Useful Step",
] as const;

export const FULL_COMPACT_HEADINGS = [
  "# Compact Summary",
  "## Primary Request",
  "## Current State",
  "## Important Decisions",
  "## Technical Concepts",
  "## Files, Modules, And Tools",
  "## Errors And Fixes",
  "## Pending Tasks",
  "## User Constraints",
  "## Next Step",
] as const;

const SECRET_RULE =
  "Do not store secrets, tokens, cookies, credentials, or unnecessary raw data.";

export function buildSessionMemorySystemPrompt(): string {
  return [
    "You maintain compact session memory for an AI chat conversation.",
    "Update the existing memory using only the new conversation messages.",
    "Preserve durable state needed to continue the session.",
    SECRET_RULE,
    "Return markdown using the required section headings exactly.",
  ].join(" ");
}

export function buildSessionMemoryUserPrompt(
  existingMemory: string | null | undefined,
  newMessages: readonly OpenAIChatMessage[]
): string {
  const memoryBlock = existingMemory && existingMemory.trim().length > 0
    ? `Existing session memory:\n${existingMemory.trim()}`
    : "Existing session memory:\n<empty>";
  const msgs = newMessages
    .map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : ""}`)
    .join("\n");
  return [
    memoryBlock,
    "",
    "New messages:",
    msgs,
    "",
    "Return updated session memory with these headings:",
    ...SESSION_MEMORY_HEADINGS,
  ].join("\n");
}

export function buildFullCompactSystemPrompt(): string {
  return [
    "You create compact continuation summaries for an AI chat application.",
    "Summarize the provided conversation so another assistant can continue accurately.",
    "Keep facts, decisions, constraints, pending tasks, tool outcomes, and current state.",
    SECRET_RULE,
    "Use the required markdown headings exactly.",
  ].join(" ");
}

export function buildFullCompactUserPrompt(
  messages: readonly OpenAIChatMessage[]
): string {
  const msgs = messages
    .map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : ""}`)
    .join("\n");
  return [
    "Conversation messages to compact:",
    msgs,
    "",
    "Return a compact summary with:",
    ...FULL_COMPACT_HEADINGS,
  ].join("\n");
}

function ensureHeadings(
  raw: string,
  headings: readonly string[]
): { summary: string; ok: boolean } {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) {
    return { summary: "", ok: false };
  }
  let out = trimmed;
  for (let i = 0; i < headings.length; i += 1) {
    const h = headings[i];
    if (!out.includes(h)) {
      // Insert missing heading after the previous heading if possible, else at end.
      const prev = i > 0 ? headings[i - 1] : null;
      const insert = prev && out.includes(prev)
        ? out.replace(prev, `${prev}\n${h}\n`)
        : `${out}\n${h}\n`;
      out = insert;
    }
  }
  return { summary: out.trim(), ok: true };
}

export function normalizeSessionMemorySummary(
  raw: string
): { summary: string; ok: boolean } {
  return ensureHeadings(raw, SESSION_MEMORY_HEADINGS);
}

export function normalizeFullCompactSummary(
  raw: string
): { summary: string; ok: boolean } {
  return ensureHeadings(raw, FULL_COMPACT_HEADINGS);
}
```

- [ ] **Step 4: Run tests**

Run: `yarn vitest run test/vitest/main/service/AIChatCompactPromptBuilder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/service/AIChatCompactPromptBuilder.ts test/vitest/main/service/AIChatCompactPromptBuilder.test.ts
git commit -m "feat(ai-chat-compact): add compact prompt builder + summary normalization"
```

---

## Task 10: Compact Agent Service (Session Memory Queue)

**Files:**
- Create: `src/service/AIChatCompactAgentService.ts`
- Test: `test/vitest/main/service/AIChatCompactAgentService.test.ts`

This task ships the session-memory update path only. Full compact is added in Task 12.

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/AIChatCompactAgentService.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { AIChatCompactAgentService } from "@/service/AIChatCompactAgentService";
import type { OpenAIChatCompletionResponse } from "@/api/aiChatApi";

// --- Mocks --------------------------------------------------------------
const mockGetByConversation = vi.fn();
const mockUpsertMemory = vi.fn();
const mockMarkUpdating = vi.fn();
const mockRecordFailure = vi.fn();
const mockResetFailures = vi.fn();

vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: vi.fn().mockImplementation(() => ({
    getByConversation: mockGetByConversation,
    upsertMemory: mockUpsertMemory,
    markUpdating: mockMarkUpdating,
    recordFailure: mockRecordFailure,
    resetFailures: mockResetFailures,
  })),
}));

const mockGetConversationMessages = vi.fn();
const mockGetActiveSummary = vi.fn();
const mockSaveFullCompact = vi.fn();
const mockMarkSuperseded = vi.fn();

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    getConversationMessages: mockGetConversationMessages,
    getDefaultSystemPrompt: vi.fn().mockReturnValue("sysp"),
    createConversationIfNeeded: vi.fn((id?: string) => id ?? "v2-x"),
  })),
}));

vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: vi.fn().mockImplementation(() => ({
    getActiveSummary: mockGetActiveSummary,
    saveFullCompact: mockSaveFullCompact,
    markSuperseded: mockMarkSuperseded,
  })),
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({ getValue: vi.fn() })),
}));

import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";
vi.mock("@/config/usersetting", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/config/usersetting")>();
  return { ...actual };
});

function makeCompletion(text: string): OpenAIChatCompletionResponse {
  return {
    id: "resp-1",
    object: "chat.completion",
    created: 1,
    model: "test-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  };
}

function makeAgent(opts: {
  aiEnabled?: boolean;
  completeChat?: (req: unknown) => Promise<OpenAIChatCompletionResponse>;
}) {
  const tokenService = new Token();
  const deps = {
    completeChat:
      opts.completeChat ??
      vi.fn().mockResolvedValue(makeCompletion("# Session Memory\n## Current Goal\nx")),
    isEnabled: () => opts.aiEnabled ?? true,
  };
  return new AIChatCompactAgentService(tokenService, deps);
}

describe("AIChatCompactAgentService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    USER_AI_ENABLED;
  });

  it("skips session memory update when AI is disabled", async () => {
    const agent = makeAgent({ aiEnabled: false });
    await agent.enqueueSessionMemoryUpdate({
      conversationId: "v2-disabled",
      reason: "assistant_turn_completed",
    });
    expect(mockUpsertMemory).not.toHaveBeenCalled();
  });

  it("skips when conversationId is missing or non-v2", async () => {
    const agent = makeAgent({});
    await agent.enqueueSessionMemoryUpdate({
      conversationId: "",
      reason: "test",
    });
    await agent.enqueueSessionMemoryUpdate({
      conversationId: "legacy-conv",
      reason: "test",
    });
    expect(mockGetByConversation).not.toHaveBeenCalled();
  });

  it("updates session memory with new messages", async () => {
    mockGetByConversation.mockResolvedValue(null);
    mockGetConversationMessages.mockResolvedValue([
      {
        messageId: "m1",
        conversationId: "v2-new",
        role: "user",
        content: "hello",
        timestamp: new Date(1),
        messageType: "message",
      },
      {
        messageId: "m2",
        conversationId: "v2-new",
        role: "assistant",
        content: "hi",
        timestamp: new Date(2),
        messageType: "message",
      },
    ]);
    mockUpsertMemory.mockImplementation(async (input) => ({
      conversationId: input.conversationId,
      summary: input.summary,
      failureCount: 0,
      status: "active",
    }));

    const completeChat = vi
      .fn()
      .mockResolvedValue(makeCompletion("# Session Memory\n## Current Goal\nx"));
    const agent = makeAgent({ completeChat });

    await agent.enqueueSessionMemoryUpdate({
      conversationId: "v2-new",
      reason: "assistant_turn_completed",
    });

    expect(completeChat).toHaveBeenCalled();
    expect(mockUpsertMemory).toHaveBeenCalled();
    const call = mockUpsertMemory.mock.calls[0][0];
    expect(call.conversationId).toBe("v2-new");
    expect(call.sourceMessageCount).toBe(2);
    expect(call.coveredThroughMessageId).toBe("m2");
    expect(call.failureCount).toBeUndefined();
  });

  it("skips when there are no new messages after boundary", async () => {
    mockGetByConversation.mockResolvedValue({
      conversationId: "v2-stale",
      coveredThroughMessageId: "m-last",
    });
    mockGetConversationMessages.mockResolvedValue([
      {
        messageId: "m-last",
        conversationId: "v2-stale",
        role: "user",
        content: "x",
        timestamp: new Date(1),
        messageType: "message",
      },
    ]);
    const agent = makeAgent({});
    await agent.enqueueSessionMemoryUpdate({
      conversationId: "v2-stale",
      reason: "test",
    });
    expect(mockUpsertMemory).not.toHaveBeenCalled();
  });

  it("records failure when the model call throws", async () => {
    mockGetByConversation.mockResolvedValue(null);
    mockGetConversationMessages.mockResolvedValue([
      {
        messageId: "m1",
        conversationId: "v2-fail",
        role: "user",
        content: "x",
        timestamp: new Date(1),
        messageType: "message",
      },
    ]);
    mockRecordFailure.mockResolvedValue({ failureCount: 1 });
    const completeChat = vi.fn().mockRejectedValue(new Error("boom"));
    const agent = makeAgent({ completeChat });

    await agent.enqueueSessionMemoryUpdate({
      conversationId: "v2-fail",
      reason: "test",
    });

    expect(mockRecordFailure).toHaveBeenCalledWith(
      "v2-fail",
      expect.any(String)
    );
  });

  it("does not run two updates for the same conversation in parallel", async () => {
    mockGetByConversation.mockResolvedValue(null);
    mockGetConversationMessages.mockResolvedValue([
      {
        messageId: "m1",
        conversationId: "v2-parallel",
        role: "user",
        content: "x",
        timestamp: new Date(1),
        messageType: "message",
      },
    ]);
    mockUpsertMemory.mockResolvedValue({ failureCount: 0 });
    let resolve: ((v: OpenAIChatCompletionResponse) => void) | null = null;
    const completeChat = vi.fn(
      () =>
        new Promise<OpenAIChatCompletionResponse>((r) => {
          resolve = r;
        })
    );
    const agent = makeAgent({ completeChat });

    const p1 = agent.enqueueSessionMemoryUpdate({
      conversationId: "v2-parallel",
      reason: "test",
    });
    const p2 = agent.enqueueSessionMemoryUpdate({
      conversationId: "v2-parallel",
      reason: "test",
    });
    await Promise.all([p1, p2]);
    expect(completeChat).toHaveBeenCalledTimes(1);
    resolve?.(makeCompletion("# Session Memory\n## Current Goal\nx"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/service/AIChatCompactAgentService.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Create `src/service/AIChatCompactAgentService.ts`:

```ts
import { AIChatSessionMemoryModule } from "@/modules/AIChatSessionMemoryModule";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { AIChatCompactModule } from "@/modules/AIChatCompactModule";
import { AIChatTokenEstimator } from "@/service/AIChatTokenEstimator";
import {
  buildSessionMemorySystemPrompt,
  buildSessionMemoryUserPrompt,
  buildFullCompactSystemPrompt,
  buildFullCompactUserPrompt,
  normalizeSessionMemorySummary,
  normalizeFullCompactSummary,
} from "@/service/AIChatCompactPromptBuilder";
import type { Token } from "@/modules/token";
import type { USER_AI_ENABLED } from "@/config/usersetting";
import type {
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIChatMessage,
} from "@/api/aiChatApi";
import type { MessageType } from "@/entityTypes/commonType";
import type { AIChatCompactSummaryView } from "@/entityTypes/aiChatCompactTypes";

const V2_PREFIX = "v2-";
const MIN_DELTA_MESSAGES = 2;
const FAILURE_CIRCUIT_THRESHOLD = 3;

/** Avoids importing the enum value at runtime; mirrors MessageType.MESSAGE. */
function isMessageRow(row: { messageType?: MessageType }): boolean {
  return row.messageType === ("message" as unknown as MessageType);
}

export interface AIChatCompactAgentDeps {
  completeChat(
    request: OpenAIChatCompletionRequest
  ): Promise<OpenAIChatCompletionResponse>;
  /** Returns true when the user has AI enabled (USER_AI_ENABLED === 'true'). */
  isEnabled(): boolean;
}

export interface SessionMemoryUpdateInput {
  conversationId: string;
  reason: string;
}

export interface FullCompactInput {
  conversationId: string;
  model?: string;
}

export class AIChatCompactAgentService {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly memory = new AIChatSessionMemoryModule();
  private readonly compact = new AIChatCompactModule();
  private readonly v2 = new AIChatV2Module();
  private readonly estimator = new AIChatTokenEstimator();

  constructor(
    private readonly tokenService: Token,
    private readonly deps: AIChatCompactAgentDeps
  ) {}

  /**
   * Enqueue a background session-memory update. Never throws.
   * Resolves once the update is skipped, completed, or failed.
   */
  async enqueueSessionMemoryUpdate(
    input: SessionMemoryUpdateInput
  ): Promise<void> {
    if (!input.conversationId || !input.conversationId.startsWith(V2_PREFIX)) {
      console.log(
        `[ai-chat-compact] session update skipped (invalid conversationId) reason=${input.reason}`
      );
      return;
    }
    if (!this.deps.isEnabled()) {
      console.log(
        `[ai-chat-compact] session update skipped (AI disabled) conv=${input.conversationId}`
      );
      return;
    }
    // Per-conversation serialization.
    const existing = this.inFlight.get(input.conversationId);
    if (existing) {
      console.log(
        `[ai-chat-compact] session update skipped (already running) conv=${input.conversationId}`
      );
      return;
    }
    const p = this.runSessionMemoryUpdate(input).finally(() => {
      this.inFlight.delete(input.conversationId);
    });
    this.inFlight.set(input.conversationId, p);
    await p;
  }

  private async runSessionMemoryUpdate(
    input: SessionMemoryUpdateInput
  ): Promise<void> {
    try {
      const existing = await this.memory.getByConversation(
        input.conversationId
      );
      if (
        existing &&
        existing.failureCount >= FAILURE_CIRCUIT_THRESHOLD
      ) {
        console.log(
          `[ai-chat-compact] session update skipped (circuit broken) conv=${input.conversationId} failures=${existing.failureCount}`
        );
        return;
      }

      const allRows = await this.v2.getConversationMessages(
        input.conversationId
      );
      const sorted = [...allRows].sort((a, b) => {
        const t = a.timestamp.getTime() - b.timestamp.getTime();
        return t !== 0 ? t : a.id - b.id;
      });
      const boundaryIdx = existing?.coveredThroughMessageId
        ? sorted.findIndex(
            (r) => r.messageId === existing.coveredThroughMessageId
          )
        : -1;
      const newRows = sorted.slice(boundaryIdx + 1).filter(isMessageRow);
      if (newRows.length < MIN_DELTA_MESSAGES) {
        console.log(
          `[ai-chat-compact] session update skipped (delta too small) conv=${input.conversationId} delta=${newRows.length}`
        );
        return;
      }

      await this.memory.markUpdating(input.conversationId);

      const newMessages: OpenAIChatMessage[] = newRows.map((r) => ({
        role: r.role as OpenAIChatMessage["role"],
        content: r.content,
      }));
      const req: OpenAIChatCompletionRequest = {
        messages: [
          { role: "system", content: buildSessionMemorySystemPrompt() },
          {
            role: "user",
            content: buildSessionMemoryUserPrompt(
              existing?.summary ?? null,
              newMessages
            ),
          },
        ],
      };
      const startedAt = Date.now();
      const resp = await this.deps.completeChat(req);
      const raw = resp.choices?.[0]?.message?.content ?? "";
      const { summary, ok } = normalizeSessionMemorySummary(raw);
      if (!ok) {
        await this.memory.recordFailure(
          input.conversationId,
          "Compact model returned empty summary"
        );
        return;
      }
      const last = newRows[newRows.length - 1];
      const tokenEstimate = this.estimator.estimateText(summary);
      const priorCount = existing?.sourceMessageCount ?? 0;
      await this.memory.upsertMemory({
        conversationId: input.conversationId,
        summary,
        coveredThroughMessageId: last.messageId,
        coveredThroughTimestamp: last.timestamp,
        sourceMessageCount: priorCount + newRows.length,
        tokenEstimate,
        model: resp.model,
        status: "active",
      });
      await this.memory.resetFailures(input.conversationId);
      console.log(
        `[ai-chat-compact] session update completed conv=${input.conversationId} msgs=${newRows.length} tokens=${tokenEstimate} elapsed=${Date.now() - startedAt}ms`
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ai-chat-compact] compact failed conv=${input.conversationId}:`, err);
      try {
        await this.memory.recordFailure(input.conversationId, message);
      } catch {
        // swallow — never propagate failure out of the agent
      }
    }
  }

  /**
   * Run a full compact on demand. Returns the new active summary view.
   * Throws on failure — callers (IPC) are responsible for surfacing errors.
   */
  async runFullCompact(input: FullCompactInput): Promise<AIChatCompactSummaryView> {
    if (!input.conversationId.startsWith(V2_PREFIX)) {
      throw new Error("Full compact requires a v2- conversation id");
    }
    if (!this.deps.isEnabled()) {
      throw new Error("AI is not enabled");
    }
    const rows = await this.v2.getConversationMessages(input.conversationId);
    const sorted = [...rows]
      .filter(isMessageRow)
      .sort((a, b) => {
        const t = a.timestamp.getTime() - b.timestamp.getTime();
        return t !== 0 ? t : a.id - b.id;
      });
    if (sorted.length === 0) {
      throw new Error("No messages to compact");
    }
    const messages: OpenAIChatMessage[] = sorted.map((r) => ({
      role: r.role as OpenAIChatMessage["role"],
      content: r.content,
    }));
    const inputTokenEstimate = this.estimator.estimateMessages(messages);
    const startedAt = Date.now();
    console.log(
      `[ai-chat-compact] full compact started conv=${input.conversationId} msgs=${messages.length} tokens=${inputTokenEstimate}`
    );
    const resp = await this.deps.completeChat({
      messages: [
        { role: "system", content: buildFullCompactSystemPrompt() },
        {
          role: "user",
          content: buildFullCompactUserPrompt(messages),
        },
      ],
      ...(input.model ? { model: input.model } : {}),
    });
    const raw = resp.choices?.[0]?.message?.content ?? "";
    const { summary, ok } = normalizeFullCompactSummary(raw);
    if (!ok) {
      throw new Error("Compact model returned empty summary");
    }
    const last = sorted[sorted.length - 1];
    const first = sorted[0];
    const view = await this.compact.saveFullCompact({
      compactId: `compact-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      conversationId: input.conversationId,
      summary,
      fromMessageId: first.messageId,
      throughMessageId: last.messageId,
      throughTimestamp: last.timestamp,
      sourceMessageCount: sorted.length,
      inputTokenEstimate,
      outputTokenEstimate: this.estimator.estimateText(summary),
      model: resp.model,
      status: "active",
    });
    console.log(
      `[ai-chat-compact] full compact completed conv=${input.conversationId} elapsed=${Date.now() - startedAt}ms`
    );
    return view;
  }
}

/**
 * Production helper: read USER_AI_ENABLED via the Token service.
 * Exported so IPC can pass the same resolver into the agent.
 */
export function makeTokenAiEnabledResolver(
  tokenService: Token,
  settingKey: typeof USER_AI_ENABLED
): () => boolean {
  return () => tokenService.getValue(settingKey) === "true";
}
```

- [ ] **Step 4: Run tests**

Run: `yarn vitest run test/vitest/main/service/AIChatCompactAgentService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/service/AIChatCompactAgentService.ts test/vitest/main/service/AIChatCompactAgentService.test.ts
git commit -m "feat(ai-chat-compact): add AIChatCompactAgentService with session memory queue + full compact"
```

---

## Task 11: Context Assembler

**Files:**
- Create: `src/service/AIChatContextAssembler.ts`
- Test: `test/vitest/main/service/AIChatContextAssembler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/service/AIChatContextAssembler.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { AIChatContextAssembler } from "@/service/AIChatContextAssembler";
import type { AIChatMessageEntity } from "@/entity/AIChatMessage.entity";
import { MessageType } from "@/entityTypes/commonType";

const mockGetByConversation = vi.fn();
const mockGetActiveSummary = vi.fn();
const mockGetConversationMessages = vi.fn();

vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: vi.fn().mockImplementation(() => ({
    getByConversation: mockGetByConversation,
  })),
}));

vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: vi.fn().mockImplementation(() => ({
    getActiveSummary: mockGetActiveSummary,
  })),
}));

vi.mock("@/modules/AIChatV2Module", () => ({
  AIChatV2Module: vi.fn().mockImplementation(() => ({
    getConversationMessages: mockGetConversationMessages,
  })),
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({ getValue: vi.fn() })),
}));

function row(opts: Partial<AIChatMessageEntity>): AIChatMessageEntity {
  return {
    id: opts.id ?? 0,
    messageId: opts.messageId ?? "m",
    conversationId: opts.conversationId ?? "v2-x",
    role: opts.role ?? "user",
    content: opts.content ?? "",
    timestamp: opts.timestamp ?? new Date(0),
    messageType: opts.messageType ?? MessageType.MESSAGE,
  } as AIChatMessageEntity;
}

describe("AIChatContextAssembler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("puts system prompt first and current user message last", async () => {
    mockGetByConversation.mockResolvedValue(null);
    mockGetActiveSummary.mockResolvedValue(null);
    mockGetConversationMessages.mockResolvedValue([]);
    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "v2-x",
      currentUserMessage: "hi",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    expect(r.messages[0]).toEqual({ role: "system", content: "sysp" });
    expect(r.messages[r.messages.length - 1]).toEqual({
      role: "user",
      content: "hi",
    });
    expect(r.usedSessionMemory).toBe(false);
    expect(r.usedFullCompact).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it("includes session memory as a system block when available", async () => {
    mockGetByConversation.mockResolvedValue({
      conversationId: "v2-x",
      summary: "# Session Memory\n## Current Goal\nship",
      coveredThroughMessageId: "old-msg",
    });
    mockGetActiveSummary.mockResolvedValue(null);
    mockGetConversationMessages.mockResolvedValue([
      row({ messageId: "old-msg", role: "user", content: "old" }),
      row({ messageId: "new-msg", role: "assistant", content: "new" }),
    ]);
    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "v2-x",
      currentUserMessage: "next",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    expect(r.usedSessionMemory).toBe(true);
    const sysBlock = r.messages.find(
      (m) => m.role === "system" && m.content.includes("Conversation compact")
    );
    expect(sysBlock).toBeTruthy();
    expect(sysBlock!.content).toContain("ship");
    // The current user message should appear exactly once and be last.
    const userMsgs = r.messages.filter((m) => m.role === "user");
    expect(userMsgs.length).toBe(1);
    expect(userMsgs[0].content).toBe("next");
  });

  it("includes full compact summary and skips session memory when both exist", async () => {
    mockGetByConversation.mockResolvedValue({
      conversationId: "v2-x",
      summary: "session",
      coveredThroughMessageId: "old-msg",
    });
    mockGetActiveSummary.mockResolvedValue({
      conversationId: "v2-x",
      summary: "# Compact Summary\n## Primary Request\nX",
      throughMessageId: "old-msg",
    });
    mockGetConversationMessages.mockResolvedValue([
      row({ messageId: "new-msg", role: "assistant", content: "new" }),
    ]);
    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "v2-x",
      currentUserMessage: "next",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    expect(r.usedFullCompact).toBe(true);
    const summaryBlock = r.messages.find(
      (m) => m.role === "system" && m.content.includes("Primary Request")
    );
    expect(summaryBlock).toBeTruthy();
    // Session memory should NOT be included in addition when the full compact boundary covers it.
    const sessionBlock = r.messages.find(
      (m) =>
        m.role === "system" && m.content.includes("# Session Memory")
    );
    expect(sessionBlock).toBeUndefined();
  });

  it("preserves chronological order of recent history", async () => {
    mockGetByConversation.mockResolvedValue(null);
    mockGetActiveSummary.mockResolvedValue(null);
    mockGetConversationMessages.mockResolvedValue([
      row({ messageId: "a", role: "user", content: "a", timestamp: new Date(1) }),
      row({ messageId: "b", role: "assistant", content: "b", timestamp: new Date(2) }),
    ]);
    const asm = new AIChatContextAssembler();
    const r = await asm.assemble({
      conversationId: "v2-x",
      currentUserMessage: "c",
      baseSystemPrompt: "sysp",
      mode: "chat",
    });
    const roles = r.messages.map((m) => m.role + ":" + m.content).join("|");
    expect(roles).toBe("system:sysp|user:a|assistant:b|user:c");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/service/AIChatContextAssembler.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Create `src/service/AIChatContextAssembler.ts`:

```ts
import { AIChatSessionMemoryModule } from "@/modules/AIChatSessionMemoryModule";
import { AIChatCompactModule } from "@/modules/AIChatCompactModule";
import { AIChatV2Module } from "@/modules/AIChatV2Module";
import { AIChatTokenEstimator } from "@/service/AIChatTokenEstimator";
import { buildPlanModeSystemPrompt } from "@/service/PlanModePromptBuilder";
import type {
  OpenAIChatMessage,
  OpenAIMessageRole,
} from "@/api/aiChatApi";
import type { MessageType } from "@/entityTypes/commonType";
import type { AIChatPlanStateView } from "@/entityTypes/aiChatPlanTypes";
import type {
  AIChatSessionMemoryView,
  AIChatCompactSummaryView,
} from "@/entityTypes/aiChatCompactTypes";

const DEFAULT_RECENT_MESSAGE_WINDOW = 30;

const COMPACT_PREAMBLE =
  "Conversation compact context:\nThe following summary is a point-in-time memory of earlier conversation messages.\nUse it as context, but prefer recent messages when there is a conflict.\n\n";

export interface AIChatContextAssembleInput {
  readonly conversationId: string;
  readonly currentUserMessage: string;
  readonly baseSystemPrompt: string;
  readonly mode: "chat" | "plan";
  readonly model?: string;
  readonly maxTokens?: number;
  readonly planState?: AIChatPlanStateView | null;
  readonly recentMessageWindow?: number;
}

export interface AIChatContextAssembleResult {
  readonly messages: OpenAIChatMessage[];
  readonly tokenEstimate: number;
  readonly usedSessionMemory: boolean;
  readonly usedFullCompact: boolean;
  readonly compactTriggered: boolean;
  readonly warnings: readonly string[];
}

function isMessageRow(row: { messageType?: MessageType }): boolean {
  return row.messageType === ("message" as unknown as MessageType);
}

function roleOf(role: string): OpenAIMessageRole {
  if (role === "system" || role === "user" || role === "assistant") {
    return role;
  }
  return "user";
}

export class AIChatContextAssembler {
  private readonly memory = new AIChatSessionMemoryModule();
  private readonly compact = new AIChatCompactModule();
  private readonly v2 = new AIChatV2Module();
  private readonly estimator = new AIChatTokenEstimator();

  async assemble(
    input: AIChatContextAssembleInput
  ): Promise<AIChatContextAssembleResult> {
    const warnings: string[] = [];

    const systemPrompt =
      input.mode === "plan" && input.planState
        ? buildPlanModeSystemPrompt({
            baseSystemPrompt: input.baseSystemPrompt,
            planState: input.planState,
          })
        : input.baseSystemPrompt;

    const sessionMemory = await this.memory.getByConversation(
      input.conversationId
    );
    const fullCompact = await this.compact.getActiveSummary(
      input.conversationId
    );

    const historyRows = await this.v2.getConversationMessages(
      input.conversationId
    );
    const sorted = [...historyRows].sort((a, b) => {
      const t = a.timestamp.getTime() - b.timestamp.getTime();
      return t !== 0 ? t : a.id - b.id;
    });
    const window = input.recentMessageWindow ?? DEFAULT_RECENT_MESSAGE_WINDOW;
    const recent = sorted.slice(-window).filter(isMessageRow);

    // Drop any recent message that is already covered by an active full
    // compact boundary. Session memory is always advisory and is allowed
    // to overlap with recent history.
    const trimmedRecent = fullCompact
      ? recent.filter(
          (r) =>
            r.timestamp.getTime() >
            new Date(fullCompact.throughTimestamp).getTime()
        )
      : recent;

    const messages: OpenAIChatMessage[] = [];
    messages.push({ role: "system", content: systemPrompt });

    if (fullCompact) {
      messages.push({
        role: "system",
        content: COMPACT_PREAMBLE + fullCompact.summary,
      });
    } else if (sessionMemory) {
      messages.push({
        role: "system",
        content: COMPACT_PREAMBLE + sessionMemory.summary,
      });
    }

    for (const r of trimmedRecent) {
      messages.push({ role: roleOf(r.role), content: r.content });
    }

    messages.push({ role: "user", content: input.currentUserMessage });

    const tokenEstimate = this.estimator.estimateMessages(messages);

    return {
      messages,
      tokenEstimate,
      usedSessionMemory: !fullCompact && !!sessionMemory,
      usedFullCompact: !!fullCompact,
      compactTriggered: false,
      warnings,
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `yarn vitest run test/vitest/main/service/AIChatContextAssembler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/service/AIChatContextAssembler.ts test/vitest/main/service/AIChatContextAssembler.test.ts
git commit -m "feat(ai-chat-compact): add AIChatContextAssembler with summary + recent window"
```

---

## Task 12: Wire Assembler Into AIChatQueryEngine

**Files:**
- Modify: `src/service/AIChatQueryEngine.ts`
- Modify: `test/vitest/main/service/AIChatQueryEngine.test.ts`

The engine will accept an optional `AIChatContextAssembler`-like dependency so the existing tests (which pass a fake loop) still work. If no assembler is passed, fall back to the existing `buildOpenAITranscript` path so behavior is preserved.

- [ ] **Step 1: Update the engine constructor + submitMessage**

In `src/service/AIChatQueryEngine.ts`:

Add imports:

```ts
import { AIChatContextAssembler } from "@/service/AIChatContextAssembler";
```

Replace the constructor and the transcript-build section of `submitMessage`:

```ts
export interface AIChatQueryEngineDeps {
  /** Optional. When omitted, a default AIChatContextAssembler is constructed. */
  contextAssembler?: AIChatContextAssembler;
}

export class AIChatQueryEngine {
  private currentAbortController: AbortController | null = null;
  private currentConversationId: string | null = null;
  private currentAssistantMessageId: string | null = null;
  private pendingPermission: PendingPermissionTurn | null = null;
  private pendingPlanQuestion: PendingPlanQuestionTurn | null = null;
  private readonly contextAssembler: AIChatContextAssembler;

  constructor(
    private readonly loop: AIChatQueryLoop,
    deps?: AIChatQueryEngineDeps
  ) {
    this.contextAssembler =
      deps?.contextAssembler ?? new AIChatContextAssembler();
  }
```

In `submitMessage`, replace the `buildOpenAITranscript({...})` call (currently lines ~135-150) with:

```ts
      // Load history and assemble context via the context assembler.
      const basePrompt =
        request.systemPrompt ?? module.getDefaultSystemPrompt();
      const assembled = await this.contextAssembler.assemble({
        conversationId,
        currentUserMessage: request.message,
        baseSystemPrompt: basePrompt,
        mode: isPlanMode ? "plan" : "chat",
        model: request.model,
        maxTokens: request.maxTokens,
        planState,
      });

      assistantMessageId = `assistant-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      this.currentAssistantMessageId = assistantMessageId;
      messages = [...assembled.messages];
```

Also remove the now-unused `buildOpenAITranscript` import and the `CHAT_V2_PHASE1_MAX_HISTORY_MESSAGES` constant.

- [ ] **Step 2: Verify the existing engine tests still pass**

Run: `yarn vitest run test/vitest/main/service/AIChatQueryEngine.test.ts`
Expected: PASS (the existing tests construct the engine with a fake loop and no deps, which now hits the default assembler path — but those tests mock `AIChatV2Module.getConversationMessages` to return `[]`, and mock the plan module, so the assembler's call to `AIChatSessionMemoryModule`/`AIChatCompactModule` will construct real modules. To prevent DB access in those tests, we add module mocks.)

If the existing test file does NOT already mock `AIChatSessionMemoryModule`, `AIChatCompactModule`, and `AIChatContextAssembler`, add these mocks near the top of the file:

```ts
vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: vi.fn().mockImplementation(() => ({
    getByConversation: vi.fn().mockResolvedValue(null),
  })),
}));
vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: vi.fn().mockImplementation(() => ({
    getActiveSummary: vi.fn().mockResolvedValue(null),
  })),
}));
```

Re-run the engine test until it passes.

- [ ] **Step 3: Add a new test that verifies the assembler is used**

Append to `test/vitest/main/service/AIChatQueryEngine.test.ts`:

```ts
describe("AIChatQueryEngine context assembly", () => {
  it("delegates message building to the context assembler", async () => {
    const captured: OpenAIChatMessage[][] = [];
    const fakeAssembler = {
      assemble: vi.fn(async (input: unknown) => {
        const msgs: OpenAIChatMessage[] = [
          { role: "system", content: "custom-sysp" },
          { role: "user", content: (input as { currentUserMessage: string }).currentUserMessage },
        ];
        captured.push(msgs);
        return {
          messages: msgs,
          tokenEstimate: 10,
          usedSessionMemory: false,
          usedFullCompact: false,
          compactTriggered: false,
          warnings: [],
        };
      }),
    };
    const engine = new AIChatQueryEngine(
      {
        run: vi.fn().mockResolvedValue({
          type: "completed",
          conversationId: "v2-test-conv",
          assistantMessageId: "assistant-1",
          fullContent: "ok",
          finishReason: "stop",
          model: "m",
        }),
      } as unknown as AIChatQueryLoop,
      { contextAssembler: fakeAssembler as unknown as AIChatContextAssembler }
    );
    const { sink } = makeEventCollector();
    await engine.submitMessage({
      request: { message: "hi" },
      eventSink: sink,
    } as unknown as AIChatQuerySubmitInput);

    expect(fakeAssembler.assemble).toHaveBeenCalledTimes(1);
    expect(captured[0]).toEqual([
      { role: "system", content: "custom-sysp" },
      { role: "user", content: "hi" },
    ]);
  });
});
```

(Add necessary imports — `OpenAIChatMessage`, `AIChatContextAssembler`, `AIChatQuerySubmitInput` — at the top.)

- [ ] **Step 4: Run tests**

Run: `yarn vitest run test/vitest/main/service/AIChatQueryEngine.test.ts`
Expected: PASS — all existing tests + the new one.

- [ ] **Step 5: Commit**

```bash
git add src/service/AIChatQueryEngine.ts test/vitest/main/service/AIChatQueryEngine.test.ts
git commit -m "refactor(ai-chat-v2): route AIChatQueryEngine transcript through AIChatContextAssembler"
```

---

## Task 13: Enqueue Session Memory Update After Completion

**Files:**
- Modify: `src/service/AIChatQueryEngine.ts`
- Modify: `src/main-process/communication/ai-chat-v2-ipc.ts` (factory injection)
- Modify: `test/vitest/main/service/AIChatQueryEngine.test.ts`

- [ ] **Step 1: Add an optional compactAgent dependency to the engine**

In `src/service/AIChatQueryEngine.ts`:

```ts
import type { AIChatCompactAgentService } from "@/service/AIChatCompactAgentService";

export interface AIChatQueryEngineDeps {
  contextAssembler?: AIChatContextAssembler;
  compactAgent?: AIChatCompactAgentService;
}
```

In the constructor, capture it:

```ts
  private readonly compactAgent?: AIChatCompactAgentService;
  constructor(loop: AIChatQueryLoop, deps?: AIChatQueryEngineDeps) {
    this.loop_internal = loop; // store as field — see below
    // ...
  }
```

(The existing code uses `private readonly loop: AIChatQueryLoop` directly. Add `private readonly compactAgent?: AIChatCompactAgentService` as another parameter. The final constructor signature should read:)

```ts
  constructor(
    private readonly loop: AIChatQueryLoop,
    deps?: AIChatQueryEngineDeps
  ) {
    this.contextAssembler =
      deps?.contextAssembler ?? new AIChatContextAssembler();
    this.compactAgent = deps?.compactAgent;
  }
```

In `handleLoopResult`'s `"completed"` branch, AFTER the `eventSink.emit({ type: "complete", ... })` call and BEFORE `this.clearActiveTurnState()`, add:

```ts
        if (this.compactAgent) {
          void this.compactAgent.enqueueSessionMemoryUpdate({
            conversationId,
            reason: "assistant_turn_completed",
          });
        }
```

- [ ] **Step 2: Wire the agent into the IPC factory**

In `src/main-process/communication/ai-chat-v2-ipc.ts`, replace the body of `createQueryLoop()` + `getQueryEngine()`:

```ts
import { AIChatCompactAgentService } from "@/service/AIChatCompactAgentService";
import { Token } from "@/modules/token";
import { USER_AI_ENABLED } from "@/config/usersetting";

function getQueryEngine(): AIChatQueryEngine {
  if (!queryEngine) {
    const loop = createQueryLoop();
    const tokenService = new Token();
    const agent = new AIChatCompactAgentService(tokenService, {
      completeChat: (request) => new AiChatApi().openAIChatCompletion(request),
      isEnabled: () => tokenService.getValue(USER_AI_ENABLED) === "true",
    });
    queryEngine = new AIChatQueryEngine(loop, { compactAgent: agent });
  }
  return queryEngine;
}
```

- [ ] **Step 3: Add a test verifying the enqueue happens exactly once on completion**

In `test/vitest/main/service/AIChatQueryEngine.test.ts`, append:

```ts
describe("AIChatQueryEngine compact integration", () => {
  it("enqueues session memory update after a completed turn", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const fakeAgent = { enqueueSessionMemoryUpdate: enqueue };
    const engine = new AIChatQueryEngine(
      {
        run: vi.fn().mockResolvedValue({
          type: "completed",
          conversationId: "v2-test-conv",
          assistantMessageId: "assistant-1",
          fullContent: "ok",
          finishReason: "stop",
        }),
      } as unknown as AIChatQueryLoop,
      {
        contextAssembler: {
          assemble: vi.fn().mockResolvedValue({
            messages: [{ role: "system", content: "x" }],
            tokenEstimate: 0,
            usedSessionMemory: false,
            usedFullCompact: false,
            compactTriggered: false,
            warnings: [],
          }),
        } as unknown as AIChatContextAssembler,
        compactAgent: fakeAgent as unknown as AIChatCompactAgentService,
      }
    );
    const { sink } = makeEventCollector();
    await engine.submitMessage({
      request: { message: "hi" },
      eventSink: sink,
    } as unknown as AIChatQuerySubmitInput);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toEqual({
      conversationId: "v2-test-conv",
      reason: "assistant_turn_completed",
    });
  });

  it("does not enqueue after a cancelled turn", async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const fakeAgent = { enqueueSessionMemoryUpdate: enqueue };
    const engine = new AIChatQueryEngine(
      {
        run: vi.fn().mockResolvedValue({
          type: "cancelled",
          conversationId: "v2-test-conv",
          assistantMessageId: "assistant-1",
          partialContent: "",
        }),
      } as unknown as AIChatQueryLoop,
      {
        contextAssembler: {
          assemble: vi.fn().mockResolvedValue({
            messages: [{ role: "system", content: "x" }],
            tokenEstimate: 0,
            usedSessionMemory: false,
            usedFullCompact: false,
            compactTriggered: false,
            warnings: [],
          }),
        } as unknown as AIChatContextAssembler,
        compactAgent: fakeAgent as unknown as AIChatCompactAgentService,
      }
    );
    const { sink } = makeEventCollector();
    await engine.submitMessage({
      request: { message: "hi" },
      eventSink: sink,
    } as unknown as AIChatQuerySubmitInput);

    expect(enqueue).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run tests**

Run: `yarn vitest run test/vitest/main/service/AIChatQueryEngine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/service/AIChatQueryEngine.ts src/main-process/communication/ai-chat-v2-ipc.ts test/vitest/main/service/AIChatQueryEngine.test.ts
git commit -m "feat(ai-chat-v2): enqueue session memory update after completed assistant turn"
```

---

## Task 14: Clear Cascade In AIChatV2Module

**Files:**
- Modify: `src/modules/AIChatV2Module.ts`
- Test: `test/vitest/main/modules/AIChatV2ModuleClearCascade.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/modules/AIChatV2ModuleClearCascade.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const memDelete = vi.fn().mockResolvedValue(2);
const memDeleteAll = vi.fn().mockResolvedValue(5);
const compactDelete = vi.fn().mockResolvedValue(1);
const compactDeleteAll = vi.fn().mockResolvedValue(3);

vi.mock("@/modules/AIChatSessionMemoryModule", () => ({
  AIChatSessionMemoryModule: vi.fn().mockImplementation(() => ({
    deleteByConversation: memDelete,
    deleteAllV2: memDeleteAll,
  })),
}));
vi.mock("@/modules/AIChatCompactModule", () => ({
  AIChatCompactModule: vi.fn().mockImplementation(() => ({
    deleteByConversation: compactDelete,
    deleteAllV2: compactDeleteAll,
  })),
}));
// Keep the rest of the AIChatV2Module surface stubbed so no DB is touched.
vi.mock("@/modules/AIChatModule", () => ({
  AIChatModule: vi.fn().mockImplementation(() => ({
    clearConversation: vi.fn().mockResolvedValue(1),
    getConversationsWithMetadata: vi.fn().mockResolvedValue([]),
  })),
}));
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({ getValue: vi.fn() })),
}));

import { AIChatV2Module } from "@/modules/AIChatV2Module";

describe("AIChatV2Module compact clear cascade", () => {
  it("clearConversation also clears compact + session memory", async () => {
    const m = new AIChatV2Module();
    await m.clearConversation("v2-x");
    expect(memDelete).toHaveBeenCalledWith("v2-x");
    expect(compactDelete).toHaveBeenCalledWith("v2-x");
  });

  it("clearAllV2History also clears all compact + session memory", async () => {
    const m = new AIChatV2Module();
    await m.clearAllV2History();
    expect(memDeleteAll).toHaveBeenCalled();
    expect(compactDeleteAll).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/modules/AIChatV2ModuleClearCascade.test.ts`
Expected: FAIL (cascade calls not made).

- [ ] **Step 3: Modify `AIChatV2Module` to cascade clears**

In `src/modules/AIChatV2Module.ts`, add imports and fields:

```ts
import { AIChatSessionMemoryModule } from "@/modules/AIChatSessionMemoryModule";
import { AIChatCompactModule } from "@/modules/AIChatCompactModule";
```

Inside the class:

```ts
  private sessionMemoryModule: AIChatSessionMemoryModule;
  private compactModule: AIChatCompactModule;

  constructor() {
    super();
    this.chatModule = new AIChatModule();
    this.sessionMemoryModule = new AIChatSessionMemoryModule();
    this.compactModule = new AIChatCompactModule();
  }
```

Replace the two clear methods:

```ts
  async clearConversation(conversationId: string): Promise<number> {
    const deleted = await this.chatModule.clearConversation(conversationId);
    // Cascade compact + session memory clear. Failures are logged, not thrown.
    try {
      await this.sessionMemoryModule.deleteByConversation(conversationId);
    } catch (err) {
      console.error("[ai-chat-v2] clearConversation: session memory clear failed:", err);
    }
    try {
      await this.compactModule.deleteByConversation(conversationId);
    } catch (err) {
      console.error("[ai-chat-v2] clearConversation: compact clear failed:", err);
    }
    return deleted;
  }

  async clearAllV2History(): Promise<number> {
    const summaries = await this.getConversations();
    let total = 0;
    for (const s of summaries) {
      total += await this.chatModule.clearConversation(s.conversationId);
    }
    try {
      await this.sessionMemoryModule.deleteAllV2();
    } catch (err) {
      console.error("[ai-chat-v2] clearAllV2History: session memory clearAll failed:", err);
    }
    try {
      await this.compactModule.deleteAllV2();
    } catch (err) {
      console.error("[ai-chat-v2] clearAllV2History: compact clearAll failed:", err);
    }
    return total;
  }
```

- [ ] **Step 4: Run tests**

Run: `yarn vitest run test/vitest/main/modules/AIChatV2ModuleClearCascade.test.ts`
Expected: PASS.

Also re-run the engine test to make sure nothing regressed:

Run: `yarn vitest run test/vitest/main/service/AIChatQueryEngine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/AIChatV2Module.ts test/vitest/main/modules/AIChatV2ModuleClearCascade.test.ts
git commit -m "feat(ai-chat-v2): cascade compact + session memory cleanup on conversation clear"
```

---

## Task 15: Manual Compact IPC Channel

**Files:**
- Modify: `src/config/channellist.ts`
- Modify: `src/main-process/communication/ai-chat-v2-ipc.ts`
- Test: `test/vitest/main/ipc/ai-chat-v2-compact-ipc.test.ts`

- [ ] **Step 1: Add the channel constant**

In `src/config/channellist.ts`, after `AI_CHAT_V2_PLAN_VERSIONS`:

```ts
export const AI_CHAT_V2_COMPACT_CONVERSATION =
  "ai-chat-v2:compact-conversation";
```

- [ ] **Step 2: Write the failing test**

Create `test/vitest/main/ipc/ai-chat-v2-compact-ipc.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock electron's ipcMain BEFORE importing the module under test.
vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

const isAIEnabledFn = vi.fn(() => true);
vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn().mockImplementation((key: string) =>
      key === "USER_AI_ENABLED" ? "true" : ""
    ),
  })),
}));

// Capture the agent injected into the engine so we can drive runFullCompact.
let injectedAgent: { runFullCompact: ReturnType<typeof vi.fn> } | null = null;
vi.mock("@/service/AIChatCompactAgentService", () => ({
  AIChatCompactAgentService: vi.fn().mockImplementation(() => {
    const agent = { runFullCompact: vi.fn() };
    injectedAgent = agent;
    return agent;
  }),
}));

vi.mock("@/api/aiChatApi", () => ({
  AiChatApi: vi.fn().mockImplementation(() => ({})),
}));
vi.mock("@/service/AIChatQueryLoop", () => ({
  AIChatQueryLoop: vi.fn(),
}));
vi.mock("@/config/skillsRegistry", () => ({
  SkillRegistry: { getAllToolFunctions: vi.fn().mockResolvedValue([]) },
}));
vi.mock("@/service/SkillExecutor", () => ({
  SkillExecutor: { execute: vi.fn() },
}));

import { registerAiChatV2IpcHandlers } from "@/main-process/communication/ai-chat-v2-ipc";
import { ipcMain } from "electron";

describe("ai-chat-v2-ipc manual compact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    injectedAgent = null;
  });

  it("registers the compact channel", () => {
    registerAiChatV2IpcHandlers();
    const channels = (ipcMain.handle as unknown as ReturnType<typeof vi.fn>)
      .mock.calls.map((c: unknown[]) => c[0]);
    expect(channels).toContain("ai-chat-v2:compact-conversation");
  });

  it("returns denied when AI is disabled", async () => {
    isAIEnabledFn.mockReturnValueOnce(false);
    registerAiChatV2IpcHandlers();
    const calls = (ipcMain.handle as unknown as ReturnType<typeof vi.fn>).mock
      .calls;
    const compactCall = calls.find(
      (c: unknown[]) => c[0] === "ai-chat-v2:compact-conversation"
    );
    const handler = compactCall![1] as (
      _e: unknown,
      data: unknown
    ) => Promise<unknown>;
    const result = await handler({}, JSON.stringify({ conversationId: "v2-x" }));
    expect(result).toMatchObject({ status: false });
  });

  it("validates conversationId", async () => {
    registerAiChatV2IpcHandlers();
    const calls = (ipcMain.handle as unknown as ReturnType<typeof vi.fn>).mock
      .calls;
    const compactCall = calls.find(
      (c: unknown[]) => c[0] === "ai-chat-v2:compact-conversation"
    );
    const handler = compactCall![1] as (
      _e: unknown,
      data: unknown
    ) => Promise<unknown>;
    const result = await handler({}, JSON.stringify({ conversationId: "" }));
    expect(result).toMatchObject({ status: false });
  });

  it("returns compact summary on success", async () => {
    registerAiChatV2IpcHandlers();
    // Force the singleton creation to happen via a stream handler so the
    // agent is constructed.
    const calls = (ipcMain.handle as unknown as ReturnType<typeof vi.fn>).mock
      .calls;
    const compactCall = calls.find(
      (c: unknown[]) => c[0] === "ai-chat-v2:compact-conversation"
    );
    const handler = compactCall![1] as (
      _e: unknown,
      data: unknown
    ) => Promise<unknown>;
    // Simulate agent success by setting the mock before invocation.
    expect(injectedAgent).not.toBeNull();
    injectedAgent!.runFullCompact.mockResolvedValue({
      compactId: "c-1",
      conversationId: "v2-x",
      summary: "# Compact Summary",
      throughMessageId: "m",
      throughTimestamp: new Date(1).toISOString(),
      sourceMessageCount: 1,
      status: "active",
    });
    const result = await handler({}, JSON.stringify({ conversationId: "v2-x" }));
    expect(result).toMatchObject({ status: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn vitest run test/vitest/main/ipc/ai-chat-v2-compact-ipc.test.ts`
Expected: FAIL.

- [ ] **Step 4: Add the handler**

In `src/main-process/communication/ai-chat-v2-ipc.ts`:

1. Add `AIChatCompactAgentService` import (already added in Task 13) and `AI_CHAT_V2_COMPACT_CONVERSATION` to the channel-list import.

2. Expose a getter for the compact agent (alongside `getQueryEngine`):

```ts
let compactAgent: AIChatCompactAgentService | null = null;

function getCompactAgent(): AIChatCompactAgentService {
  if (!compactAgent) {
    const tokenService = new Token();
    compactAgent = new AIChatCompactAgentService(tokenService, {
      completeChat: (request) =>
        new AiChatApi().openAIChatCompletion(request),
      isEnabled: () => tokenService.getValue(USER_AI_ENABLED) === "true",
    });
  }
  return compactAgent;
}
```

(Update Task 13's `getQueryEngine` to call `getCompactAgent()` and reuse the same instance, instead of creating a new agent inline. This makes the IPC handler's compact agent and the engine's injected agent the same singleton.)

3. Add the handler:

```ts
async function handleCompactConversation(
  data: string
): Promise<CommonMessage<AIChatCompactSummaryView | null>> {
  if (!isAIEnabled()) {
    return denied("AI is not enabled");
  }
  const parsed = data
    ? (JSON.parse(data) as { conversationId?: string; model?: string })
    : {};
  if (!parsed.conversationId || typeof parsed.conversationId !== "string") {
    return denied("conversationId is required");
  }
  if (!parsed.conversationId.startsWith("v2-")) {
    return denied("conversationId must be a v2- conversation id");
  }
  try {
    const agent = getCompactAgent();
    const summary = await agent.runFullCompact({
      conversationId: parsed.conversationId,
      model: parsed.model,
    });
    return ok(summary);
  } catch (err) {
    return denied(userSafeError(err));
  }
}
```

Add the `AIChatCompactSummaryView` type import at the top:

```ts
import type { AIChatCompactSummaryView } from "@/entityTypes/aiChatCompactTypes";
```

4. Register the handler in `registerAiChatV2IpcHandlers()`:

```ts
  ipcMain.handle(AI_CHAT_V2_COMPACT_CONVERSATION, async (_e, data: unknown) =>
    handleCompactConversation((data as string) ?? "")
  );
```

- [ ] **Step 5: Run tests**

Run: `yarn vitest run test/vitest/main/ipc/ai-chat-v2-compact-ipc.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config/channellist.ts src/main-process/communication/ai-chat-v2-ipc.ts test/vitest/main/ipc/ai-chat-v2-compact-ipc.test.ts
git commit -m "feat(ai-chat-v2): expose AI_CHAT_V2_COMPACT_CONVERSATION IPC channel"
```

---

## Task 16: Final Verification Sweep

**Files:** none modified.

- [ ] **Step 1: Run the full ai-chat-compact + engine test suite**

Run: `yarn vitest run test/vitest/main/service/AIChatTokenEstimator.test.ts test/vitest/main/service/AIChatCompactPromptBuilder.test.ts test/vitest/main/service/AIChatCompactAgentService.test.ts test/vitest/main/service/AIChatContextAssembler.test.ts test/vitest/main/service/AIChatQueryEngine.test.ts test/vitest/main/modules/AIChatSessionMemoryModel.test.ts test/vitest/main/modules/AIChatCompactSummaryModel.test.ts test/vitest/main/modules/AIChatSessionMemoryModule.test.ts test/vitest/main/modules/AIChatCompactModule.test.ts test/vitest/main/modules/AIChatV2ModuleClearCascade.test.ts test/vitest/main/ipc/ai-chat-v2-compact-ipc.test.ts`
Expected: ALL PASS.

- [ ] **Step 2: Full type check**

Run: `yarn vue-check 2>&1 | tail -30`
Expected: no new errors related to compact, session memory, context assembler, or engine.

- [ ] **Step 3: Run the existing ai-chat-v2 IPC + loop tests for regression**

Run: `yarn vitest run test/vitest/main/ipc/ai-chat-v2-ipc.test.ts test/vitest/main/service/AIChatQueryLoop.test.ts test/vitest/main/service/OpenAIChatTranscriptBuilder.test.ts`
Expected: PASS (these should be unaffected — we left `buildOpenAITranscript` intact for any other consumers).

- [ ] **Step 4: Manual smoke check (optional, if dev env available)**

Run: `yarn dev` and in the running app, send a few messages in ai-chat-v2, then watch the main process console for `[ai-chat-compact] session update queued|completed` lines. (If AI is disabled, you should see `session update skipped (AI disabled)`.)

- [ ] **Step 5: Final commit if any docs need touching**

If `docs/superpowers/specs/2026-06-15-agent-memory-compact-prd.md` or `2026-06-15-agent-memory-compact-technical-design.md` need an "Implementation status: M1–M4 complete" note, add it.

```bash
git add docs/superpowers/specs/
git commit -m "docs(ai-chat-compact): mark Milestones 1-4 as implemented"
```

---

## Spec Coverage Self-Review

| PRD / Design requirement | Task(s) |
| --- | --- |
| Session memory entity, indexes, fields | T1 |
| Compact summary entity, indexes, fields | T2 |
| Status enums + view interfaces | T3 |
| Session memory model (upsert, markUpdating, recordFailure, resetFailures, delete, deleteAllV2) | T4 |
| Compact summary model (getActiveSummary, saveFullCompact, markSuperseded, delete, deleteAllV2) | T5 |
| Session memory module views | T6 |
| Compact summary module views | T7 |
| Token estimator (length/4 + overhead + buffer) | T8 |
| Compact prompt builder (Layer 4 + Layer 5 prompts + normalization) | T9 |
| Compact agent: AI-gated queue, per-conversation lock, skip conditions, failure tracking, circuit breaker | T10 |
| Compact agent: full compact path | T10 (`runFullCompact`) |
| Context assembler: system prompt, summary block, recent window, current message exactly once, chronological order | T11 |
| Engine integration: replace fixed cap with assembler | T12 |
| Enqueue session memory update after completed turn | T13 |
| Clear cascade (conversation + all v2) | T14 |
| Manual compact IPC channel + AI gate + validation | T15 |
| Observability (stable log prefixes) | T10, T13 |
| Security: AI gate, no-secrets prompt rule, summary deletion with chat history | T9, T10, T14, T15 |

**Deferred to follow-up plans (explicitly out of scope):**
- Milestone 5: UI controls (compact button, status indicator) + i18n.
- Auto-threshold full compact triggered by token estimate (the path exists via `runFullCompact`, but no background scheduler calls it yet).
- Milestone 6: Durable cross-conversation memory.

**Type consistency check:**
- `SessionMemoryUpsertInput` defined in T4, consumed by T6 and T10. ✓
- `CompactSummarySaveInput` defined in T5, consumed by T7 and T10. ✓
- `AIChatCompactSummaryView` defined in T3, returned by T7, T10, T15. ✓
- `AIChatSessionMemoryView` defined in T3, returned by T6. ✓
- `AIChatContextAssembleInput` / `AIChatContextAssembleResult` defined in T11, consumed by T12. ✓
- `AIChatCompactAgentDeps.completeChat` signature matches `AiChatApi.openAIChatCompletion` in T13/T15. ✓
- `AIChatQueryEngineDeps` extended in T12 then T13 (additive — no breaking change to existing constructor usage). ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-15-agent-memory-compact.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.
