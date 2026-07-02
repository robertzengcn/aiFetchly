# Hooks System Management UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Hooks management page under System Settings that surfaces every registered hook, lets users configure their own command hooks (CRUD + trust), toggle the system globally, and inspect recent audit activity — delivering PRD Phase 4.

**Architecture:** Standard 3-layer DB pattern (Entity → Model → Module → IPC) on top of the existing Phase 1-3 hook backend. UI is a new master-detail page at route `system_setting_hooks`, mirroring how MCP/Skills sub-pages work. Persistence is SQLite via TypeORM. Global enable and builtin overrides live in `Token`. Trust state migrates from in-memory `Set` to a DB column hydrated at startup.

**Tech Stack:** TypeScript, Electron, TypeORM + better-sqlite3, Vue 3 + Vuetify + Pinia, vue-i18n, Mocha (model/module tests), Vitest (service/IPC tests).

**Spec:** `docs/superpowers/specs/2026-07-01-hooks-system-management-ui-design.md`

---

## File Map

**New files:**
- `src/entity/HookConfig.entity.ts` — TypeORM entity for user-configured hooks
- `src/entity/HookAuditEntry.entity.ts` — TypeORM entity for audit log rows
- `src/model/Hook.model.ts` — data access for HookConfig
- `src/model/HookAudit.model.ts` — data access for HookAuditEntry
- `src/modules/HookModule.ts` — business logic + registry sync + startup loader
- `src/modules/HookAuditModule.ts` — audit entry recording + lastRun update
- `src/main-process/communication/hooks-ipc.ts` — thin IPC handlers
- `src/views/api/hooks.ts` — renderer-side wrappers
- `src/views/pages/systemsetting/Hooks.vue` — the master-detail page
- `test/modules/Hook.model.test.ts` — Mocha tests
- `test/modules/HookAudit.model.test.ts` — Mocha tests
- `test/modules/HookModule.test.ts` — Mocha tests
- `test/modules/HookAuditModule.test.ts` — Mocha tests
- `test/vitest/utilitycode/hooks/HookRegistry.listAll.test.ts` — Vitest tests
- `test/vitest/utilitycode/hooks/HookCommandTrustService.persist.test.ts` — Vitest tests
- `test/vitest/main/hooks-ipc.test.ts` — Vitest tests

**Modified files:**
- `src/config/usersetting.ts` — add `USER_HOOKS_ENABLED` + `USER_HOOKS_BUILTIN_OVERRIDES` constants
- `src/config/SqliteDb.ts` — register two new entities (around line 499)
- `src/config/channellist.ts` — add `HOOKS_*` channel constants
- `src/service/hooks/HookRegistry.ts` — add `listAll`, `registerUserHook`, `replaceUserHooks`
- `src/service/hooks/HookCommandTrustService.ts` — DB-backed hydration
- `src/service/hooks/HookAuditService.ts` — add `PersistentHookAuditLogger`
- `src/service/hooks/HookDispatcher.ts` — read `USER_HOOKS_ENABLED` gate
- `src/main-process/communication/index.ts` — register hooks IPC
- `src/preload.ts` — whitelist `HOOKS_*` channels in `invoke` validChannels
- `src/views/router/index.ts` — add `system_setting_hooks` route
- `src/views/pages/systemsetting/index.vue` — add "Manage Hooks" sidebar button
- `src/views/lang/{en,zh,es,fr,de,ja}.ts` — add `system_settings.hooks.*` keys
- `src/background.ts` — call `HookModule.loadUserHooksIntoRegistry()` after SqliteDb init

---

## Task 1: Add Token Constants

**Files:**
- Modify: `src/config/usersetting.ts`

- [ ] **Step 1: Add constants**

Open `src/config/usersetting.ts`. After the existing `USER_AI_AUTO_PLAN` line (around line 16), add:

```ts
// Hooks system — Phase 4 global enable + builtin enabled-override map.
// Values are strings ("true"/"false") to match the Token store shape.
export const USER_HOOKS_ENABLED = "user_hooks_enabled";
// Value is a JSON string: { [hookId: string]: { enabled: boolean } }
export const USER_HOOKS_BUILTIN_OVERRIDES = "user_hooks_builtin_overrides";
```

- [ ] **Step 2: Verify type check**

Run: `yarn vue-check 2>&1 | tail -20`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/config/usersetting.ts
git commit -m "feat: add USER_HOOKS_ENABLED and USER_HOOKS_BUILTIN_OVERRIDES token constants"
```

---

## Task 2: HookConfig Entity

**Files:**
- Create: `src/entity/HookConfig.entity.ts`

- [ ] **Step 1: Write the entity**

Create `src/entity/HookConfig.entity.ts`:

```ts
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

/**
 * Persisted user-configured command hook.
 *
 * Only `source = "user"` rows are created through the UI. Built-in
 * callback hooks remain code-registered; their `enabled` state is
 * toggled via the USER_HOOKS_BUILTIN_OVERRIDES Token map, not this
 * table.
 *
 * Worker processes MUST NOT use this entity directly — they must
 * route through IPC to the main process (see Hook.model.ts guard).
 */
@Entity("hook_config")
@Index(["source"])
@Index(["eventName"])
@Index(["enabled", "trusted"])
export class HookConfigEntity {
  @PrimaryColumn({ type: "text" })
  id: string;

  @Column({ name: "event_name", type: "text" })
  eventName: string;

  @Column({ name: "matcher", type: "text", nullable: true })
  matcher: string | null;

  /** "command" for UI-created rows. "callback" reserved for future schema reuse. */
  @Column({ name: "hook_type", type: "text" })
  hookType: string;

  @Column({ type: "text" })
  command: string;

  @Column({ name: "cwd", type: "text", nullable: true })
  cwd: string | null;

  @Column({ name: "timeout_ms", type: "integer", default: 5000 })
  timeoutMs: number;

  /** "warn" | "block" */
  @Column({ name: "failure_mode", type: "text", default: "warn" })
  failureMode: string;

  @Column({ name: "status_message", type: "text", nullable: true })
  statusMessage: string | null;

  /** JSON-serialized string[] of env var names. */
  @Column({ name: "env_allowlist", type: "text", nullable: true })
  envAllowlist: string | null;

  /** Always "user" for rows created via UI. */
  @Column({ type: "text", default: "user" })
  source: string;

  @Column({ type: "boolean", default: false })
  enabled: boolean;

  @Column({ type: "boolean", default: false })
  trusted: boolean;

  @Column({ name: "last_run_at", type: "datetime", nullable: true })
  lastRunAt: Date | null;

  @Column({ name: "last_run_status", type: "text", nullable: true })
  lastRunStatus: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
```

- [ ] **Step 2: Verify type check**

Run: `yarn vue-check 2>&1 | tail -20`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/entity/HookConfig.entity.ts
git commit -m "feat: add HookConfig entity for persisted user hooks"
```

---

## Task 3: HookAuditEntry Entity

**Files:**
- Create: `src/entity/HookAuditEntry.entity.ts`

- [ ] **Step 1: Write the entity**

Create `src/entity/HookAuditEntry.entity.ts`:

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from "typeorm";

/**
 * One row per hook fire. Written by HookAuditModule.recordEntry,
 * read by the System Settings audit panel via hooks:listAudit.
 *
 * Mirrors the HookAuditEntry interface in entityTypes/hookTypes.ts.
 * Free-text fields (reason) are already secret-redacted by
 * HookAuditService before reaching this layer.
 */
@Entity("hook_audit_entry")
@Index(["timestamp"])
@Index(["hookId", "timestamp"])
export class HookAuditEntryEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "hook_run_id", type: "text" })
  hookRunId: string;

  @Column({ name: "hook_id", type: "text" })
  hookId: string;

  @Column({ name: "event_name", type: "text" })
  eventName: string;

  @Column({ type: "text" })
  source: string;

  /** "callback" | "command" */
  @Column({ type: "text" })
  type: string;

  @Column({ name: "match_query", type: "text", nullable: true })
  matchQuery: string | null;

  /** "started" | "success" | "blocked" | "failed" | "timeout" */
  @Column({ type: "text" })
  status: string;

  @Column({ name: "duration_ms", type: "integer", nullable: true })
  durationMs: number | null;

  @Column({ type: "text", nullable: true })
  reason: string | null;

  @Column({ type: "datetime" })
  timestamp: Date;
}
```

- [ ] **Step 2: Verify type check**

Run: `yarn vue-check 2>&1 | tail -20`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/entity/HookAuditEntry.entity.ts
git commit -m "feat: add HookAuditEntry entity for persisted audit log"
```

---

## Task 4: Register Entities in SqliteDb

**Files:**
- Modify: `src/config/SqliteDb.ts` (around lines 417-499)

- [ ] **Step 1: Add imports**

At the top of `src/config/SqliteDb.ts`, find the existing entity imports and add:

```ts
import { HookConfigEntity } from "../entity/HookConfig.entity";
import { HookAuditEntryEntity } from "../entity/HookAuditEntry.entity";
```

- [ ] **Step 2: Add to entities array**

In the `entities: [...]` array (around line 417-499), find the closing `WorkspaceEntity,` line and add after it (before the closing `]`):

```ts
          WorkspaceEntity,
          HookConfigEntity,
          HookAuditEntryEntity,
```

- [ ] **Step 3: Verify app initializes**

Run: `yarn tsc 2>&1 | tail -10`
Expected: no new errors referencing Hook entities.

- [ ] **Step 4: Commit**

```bash
git add src/config/SqliteDb.ts
git commit -m "feat: register HookConfig and HookAuditEntry entities"
```

---

## Task 5: Hook Model

**Files:**
- Create: `src/model/Hook.model.ts`
- Test: `test/modules/Hook.model.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/modules/Hook.model.test.ts`:

```ts
import { expect } from "chai";
import { HookModel } from "@/model/Hook.model";
import { HookConfigEntity } from "@/entity/HookConfig.entity";

describe("HookModel", () => {
  let model: HookModel;

  beforeEach(() => {
    model = new HookModel("");
  });

  afterEach(async () => {
    await model.deleteAll();
  });

  it("creates and reads a hook by id", async () => {
    const row = await model.create({
      id: "user-test-1",
      eventName: "PreToolUse",
      matcher: "shell_execute",
      hookType: "command",
      command: "node ./check.js",
      cwd: null,
      timeoutMs: 5000,
      failureMode: "warn",
      statusMessage: null,
      envAllowlist: null,
      source: "user",
      enabled: false,
      trusted: false,
    });

    expect(row.id).to.equal("user-test-1");
    const fetched = await model.findById("user-test-1");
    expect(fetched?.command).to.equal("node ./check.js");
    expect(fetched?.enabled).to.equal(false);
  });

  it("lists hooks filtered by source", async () => {
    await model.create({ id: "u1", eventName: "PreToolUse", hookType: "command", command: "a", timeoutMs: 5000, failureMode: "warn", source: "user", enabled: false, trusted: false });
    const rows = await model.listBySource("user");
    expect(rows.length).to.equal(1);
    expect(rows[0].id).to.equal("u1");
  });

  it("updates fields via patch", async () => {
    await model.create({ id: "u2", eventName: "Stop", hookType: "command", command: "old", timeoutMs: 5000, failureMode: "warn", source: "user", enabled: false, trusted: false });
    const updated = await model.update("u2", { command: "new", enabled: true });
    expect(updated.command).to.equal("new");
    expect(updated.enabled).to.equal(true);
  });

  it("deletes by id", async () => {
    await model.create({ id: "u3", eventName: "Stop", hookType: "command", command: "x", timeoutMs: 5000, failureMode: "warn", source: "user", enabled: false, trusted: false });
    await model.deleteById("u3");
    const fetched = await model.findById("u3");
    expect(fetched).to.equal(null);
  });

  it("throws when constructed in a worker process", () => {
    const previous = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = "/tmp/worker";
    try {
      expect(() => new HookModel("")).to.throw(/worker process/);
    } finally {
      if (previous === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previous;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/modules/Hook.model.test.ts 2>&1 | tail -20`
Expected: FAIL with `Cannot find module '@/model/Hook.model'`.

- [ ] **Step 3: Write the model**

Create `src/model/Hook.model.ts`:

```ts
import { Repository } from "typeorm";
import { HookConfigEntity } from "@/entity/HookConfig.entity";
import { SqliteDb } from "@/config/SqliteDb";
import { Token } from "@/modules/token";
import { USERSDBPATH } from "@/config/usersetting";

/**
 * Data access for persisted user hooks. Main-process only — the
 * constructor throws when `process.env.DATABASE_PATH` is set, which
 * is how worker processes are detected project-wide.
 */
export type NewHookRow = Omit<
  HookConfigEntity,
  "lastRunAt" | "lastRunStatus" | "createdAt" | "updatedAt"
>;

export type HookPatch = Partial<
  Pick<
    HookConfigEntity,
    | "eventName" | "matcher" | "hookType" | "command" | "cwd"
    | "timeoutMs" | "failureMode" | "statusMessage" | "envAllowlist"
    | "enabled" | "trusted"
  >
>;

export class HookModel {
  private readonly dbpath: string;

  constructor(dbpath: string) {
    if (process.env.DATABASE_PATH) {
      throw new Error(
        "Direct database access from worker process is not allowed. " +
        "Worker should send data to main process via IPC for database operations."
      );
    }
    const tokenService = new Token();
    this.dbpath = dbpath || tokenService.getValue(USERSDBPATH) || "";
  }

  private async getRepository(): Promise<Repository<HookConfigEntity>> {
    if (!this.dbpath) throw new Error("Database path not available");
    const db = SqliteDb.getInstance(this.dbpath);
    if (!db.connection.isInitialized) {
      await SqliteDb.ensureInitialized();
    }
    return db.connection.getRepository(HookConfigEntity);
  }

  async create(row: NewHookRow): Promise<HookConfigEntity> {
    const repo = await this.getRepository();
    const entity = new HookConfigEntity();
    Object.assign(entity, row);
    return repo.save(entity);
  }

  async findById(id: string): Promise<HookConfigEntity | null> {
    const repo = await this.getRepository();
    return repo.findOne({ where: { id } });
  }

  async listBySource(source: string): Promise<HookConfigEntity[]> {
    const repo = await this.getRepository();
    return repo.find({ where: { source } });
  }

  async listAll(): Promise<HookConfigEntity[]> {
    const repo = await this.getRepository();
    return repo.find();
  }

  async update(id: string, patch: HookPatch): Promise<HookConfigEntity> {
    const repo = await this.getRepository();
    await repo.update({ id }, patch as any);
    const refreshed = await repo.findOne({ where: { id } });
    if (!refreshed) throw new Error(`Hook not found: ${id}`);
    return refreshed;
  }

  async deleteById(id: string): Promise<void> {
    const repo = await this.getRepository();
    await repo.delete({ id });
  }

  async deleteAll(): Promise<void> {
    const repo = await this.getRepository();
    await repo.clear();
  }

  async updateRunStatus(
    id: string,
    status: string,
    at: Date
  ): Promise<void> {
    const repo = await this.getRepository();
    await repo.update({ id }, { lastRunStatus: status, lastRunAt: at });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/modules/Hook.model.test.ts 2>&1 | tail -20`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/model/Hook.model.ts test/modules/Hook.model.test.ts
git commit -m "feat: add HookModel with CRUD and worker-process guard"
```

---

## Task 6: HookAudit Model

**Files:**
- Create: `src/model/HookAudit.model.ts`
- Test: `test/modules/HookAudit.model.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/modules/HookAudit.model.test.ts`:

```ts
import { expect } from "chai";
import { HookAuditModel } from "@/model/HookAudit.model";

describe("HookAuditModel", () => {
  let model: HookAuditModel;

  beforeEach(() => {
    model = new HookAuditModel("");
  });

  afterEach(async () => {
    await model.clear();
  });

  async function insert(sample: Partial<any> & { hookRunId: string; hookId: string }) {
    return model.insert({
      hookRunId: sample.hookRunId,
      hookId: sample.hookId,
      eventName: sample.eventName ?? "PreToolUse",
      source: sample.source ?? "user",
      type: sample.type ?? "command",
      matchQuery: sample.matchQuery ?? null,
      status: sample.status ?? "success",
      durationMs: sample.durationMs ?? 10,
      reason: sample.reason ?? null,
      timestamp: sample.timestamp ?? new Date(),
    });
  }

  it("inserts and queries entries", async () => {
    await insert({ hookRunId: "r1", hookId: "h1" });
    const result = await model.query({ limit: 10, offset: 0 });
    expect(result.rows.length).to.equal(1);
    expect(result.total).to.equal(1);
    expect(result.rows[0].hookId).to.equal("h1");
  });

  it("filters by hookId", async () => {
    await insert({ hookRunId: "r1", hookId: "h1" });
    await insert({ hookRunId: "r2", hookId: "h2" });
    const result = await model.query({ hookId: "h1", limit: 10, offset: 0 });
    expect(result.rows.length).to.equal(1);
  });

  it("filters by status and eventName", async () => {
    await insert({ hookRunId: "r1", hookId: "h1", status: "blocked", eventName: "PreToolUse" });
    await insert({ hookRunId: "r2", hookId: "h2", status: "success", eventName: "PostToolUse" });
    const blocked = await model.query({ status: "blocked", limit: 10, offset: 0 });
    expect(blocked.rows.length).to.equal(1);
    const post = await model.query({ eventName: "PostToolUse", limit: 10, offset: 0 });
    expect(post.rows.length).to.equal(1);
  });

  it("paginates with offset", async () => {
    for (let i = 0; i < 5; i++) {
      await insert({ hookRunId: `r${i}`, hookId: `h${i}` });
    }
    const page = await model.query({ limit: 2, offset: 2 });
    expect(page.rows.length).to.equal(2);
    expect(page.total).to.equal(5);
  });

  it("orders by timestamp descending", async () => {
    const early = new Date("2026-01-01T00:00:00Z");
    const late = new Date("2026-06-01T00:00:00Z");
    await insert({ hookRunId: "r1", hookId: "h1", timestamp: early });
    await insert({ hookRunId: "r2", hookId: "h2", timestamp: late });
    const result = await model.query({ limit: 10, offset: 0 });
    expect(result.rows[0].hookId).to.equal("h2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/modules/HookAudit.model.test.ts 2>&1 | tail -10`
Expected: FAIL with `Cannot find module '@/model/HookAudit.model'`.

- [ ] **Step 3: Write the model**

Create `src/model/HookAudit.model.ts`:

```ts
import { Repository } from "typeorm";
import { HookAuditEntryEntity } from "@/entity/HookAuditEntry.entity";
import { SqliteDb } from "@/config/SqliteDb";
import { Token } from "@/modules/token";
import { USERSDBPATH } from "@/config/usersetting";

export interface HookAuditRow {
  hookRunId: string;
  hookId: string;
  eventName: string;
  source: string;
  type: string;
  matchQuery: string | null;
  status: string;
  durationMs: number | null;
  reason: string | null;
  timestamp: Date;
}

export interface HookAuditQuery {
  hookId?: string;
  eventName?: string;
  status?: string;
  fromTime?: Date;
  toTime?: Date;
  limit: number;
  offset: number;
}

export interface HookAuditQueryResult {
  rows: HookAuditEntryEntity[];
  total: number;
}

export class HookAuditModel {
  private readonly dbpath: string;

  constructor(dbpath: string) {
    if (process.env.DATABASE_PATH) {
      throw new Error(
        "Direct database access from worker process is not allowed. " +
        "Worker should send data to main process via IPC for database operations."
      );
    }
    const tokenService = new Token();
    this.dbpath = dbpath || tokenService.getValue(USERSDBPATH) || "";
  }

  private async getRepository(): Promise<Repository<HookAuditEntryEntity>> {
    if (!this.dbpath) throw new Error("Database path not available");
    const db = SqliteDb.getInstance(this.dbpath);
    if (!db.connection.isInitialized) {
      await SqliteDb.ensureInitialized();
    }
    return db.connection.getRepository(HookAuditEntryEntity);
  }

  async insert(row: HookAuditRow): Promise<HookAuditEntryEntity> {
    const repo = await this.getRepository();
    const entity = new HookAuditEntryEntity();
    Object.assign(entity, row);
    return repo.save(entity);
  }

  async query(q: HookAuditQuery): Promise<HookAuditQueryResult> {
    const repo = await this.getRepository();
    const qb = repo.createQueryBuilder("a");

    if (q.hookId) qb.andWhere("a.hookId = :hookId", { hookId: q.hookId });
    if (q.eventName) qb.andWhere("a.eventName = :eventName", { eventName: q.eventName });
    if (q.status) qb.andWhere("a.status = :status", { status: q.status });
    if (q.fromTime) qb.andWhere("a.timestamp >= :fromTime", { fromTime: q.fromTime });
    if (q.toTime) qb.andWhere("a.timestamp <= :toTime", { toTime: q.toTime });

    qb.orderBy("a.timestamp", "DESC").skip(q.offset).take(q.limit);

    const [rows, total] = await qb.getManyAndCount();
    return { rows, total };
  }

  async clear(): Promise<void> {
    const repo = await this.getRepository();
    await repo.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/modules/HookAudit.model.test.ts 2>&1 | tail -10`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/model/HookAudit.model.ts test/modules/HookAudit.model.test.ts
git commit -m "feat: add HookAuditModel with paginated query and filters"
```

---

## Task 7: HookModule

**Files:**
- Create: `src/modules/HookModule.ts`
- Test: `test/modules/HookModule.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/modules/HookModule.test.ts`:

```ts
import { expect } from "chai";
import { HookModule } from "@/modules/HookModule";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { HookCommandTrustService } from "@/service/hooks/HookCommandTrustService";
import type { HookEventName } from "@/entityTypes/hookTypes";

describe("HookModule", () => {
  let module: HookModule;

  beforeEach(() => {
    HookRegistry.resetForTests();
    HookCommandTrustService.resetForTests();
    module = new HookModule();
  });

  afterEach(async () => {
    HookRegistry.resetForTests();
    HookCommandTrustService.resetForTests();
    try { await module.deleteAllUserHooksForTests(); } catch { /* ok */ }
  });

  it("creates a user hook and rejects oversize matcher", async () => {
    try {
      await module.create({
        id: "u1",
        eventName: "PreToolUse" as HookEventName,
        matcher: "x".repeat(200),
        command: "node ./x",
        timeoutMs: 5000,
        failureMode: "warn",
        enabled: false,
        trusted: false,
      });
      expect.fail("should have rejected");
    } catch (err: unknown) {
      expect(String(err)).to.match(/matcher/i);
    }
  });

  it("creates a hook and registers it when enabled", async () => {
    await module.create({
      id: "u2",
      eventName: "PreToolUse" as HookEventName,
      matcher: "shell_execute",
      command: "node ./x",
      timeoutMs: 5000,
      failureMode: "warn",
      enabled: true,
      trusted: true,
    });

    const matched = HookRegistry.getMatchingHooks({
      eventName: "PreToolUse",
      matchQuery: "shell_execute",
    });
    expect(matched.find((h) => h.id === "u2")).to.not.equal(undefined);
  });

  it("does not register an untrusted command hook for execution", async () => {
    await module.create({
      id: "u3",
      eventName: "PreToolUse" as HookEventName,
      matcher: "*",
      command: "node ./x",
      timeoutMs: 5000,
      failureMode: "warn",
      enabled: true,
      trusted: false,
    });

    const matched = HookRegistry.getMatchingHooks({
      eventName: "PreToolUse",
      matchQuery: "anything",
    });
    expect(matched.find((h) => h.id === "u3")).to.equal(undefined);
  });

  it("updates fields and re-registers", async () => {
    await module.create({
      id: "u4",
      eventName: "PreToolUse" as HookEventName,
      matcher: "shell_execute",
      command: "node ./x",
      timeoutMs: 5000,
      failureMode: "warn",
      enabled: true,
      trusted: true,
    });
    await module.update("u4", { command: "node ./y" });

    const matched = HookRegistry.getMatchingHooks({
      eventName: "PreToolUse",
      matchQuery: "shell_execute",
    });
    const hook = matched.find((h) => h.id === "u4");
    expect(hook?.type === "command" && hook.command).to.equal("node ./y");
  });

  it("deletes a user hook and unregisters it", async () => {
    await module.create({
      id: "u5",
      eventName: "PreToolUse" as HookEventName,
      matcher: "*",
      command: "node ./x",
      timeoutMs: 5000,
      failureMode: "warn",
      enabled: true,
      trusted: true,
    });
    await module.deleteById("u5");
    const matched = HookRegistry.getMatchingHooks({
      eventName: "PreToolUse",
      matchQuery: "anything",
    });
    expect(matched.find((h) => h.id === "u5")).to.equal(undefined);
  });

  it("setTrusted writes through to HookCommandTrustService", async () => {
    await module.create({
      id: "u6",
      eventName: "PreToolUse" as HookEventName,
      matcher: "*",
      command: "node ./x",
      timeoutMs: 5000,
      failureMode: "warn",
      enabled: true,
      trusted: false,
    });
    await module.setTrusted("u6", true);
    expect(HookCommandTrustService.isTrusted("u6")).to.equal(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/modules/HookModule.test.ts 2>&1 | tail -10`
Expected: FAIL with `Cannot find module '@/modules/HookModule'`.

- [ ] **Step 3: Write the module**

Create `src/modules/HookModule.ts`:

```ts
import { BaseModule } from "./baseModule";
import { HookModel, NewHookRow, HookPatch } from "@/model/Hook.model";
import { HookConfigEntity } from "@/entity/HookConfig.entity";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { HookCommandTrustService } from "@/service/hooks/HookCommandTrustService";
import { HOOK_LIMITS } from "@/entityTypes/hookTypes";
import type {
  CommandHookDefinition,
  HookDefinition,
  HookEventName,
} from "@/entityTypes/hookTypes";

export interface CreateHookInput {
  id: string;
  eventName: HookEventName;
  matcher?: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  failureMode?: "warn" | "block";
  statusMessage?: string;
  envAllowlist?: string[];
  enabled?: boolean;
  trusted?: boolean;
}

/**
 * Business logic for user-configured hooks. Owns the bridge between
 * the persisted HookConfig table and the in-memory HookRegistry /
 * HookCommandTrustService.
 *
 * Main-process only. IPC handlers call this module; they never touch
 * the model layer directly.
 */
export class HookModule extends BaseModule {
  private readonly model: HookModel;

  constructor() {
    super();
    this.model = new HookModel(this.dbpath);
  }

  async create(input: CreateHookInput): Promise<HookConfigEntity> {
    this.validate(input);
    const row: NewHookRow = {
      id: input.id,
      eventName: input.eventName,
      matcher: input.matcher ?? null,
      hookType: "command",
      command: input.command,
      cwd: input.cwd ?? null,
      timeoutMs: input.timeoutMs ?? HOOK_LIMITS.defaultCommandTimeoutMs,
      failureMode: input.failureMode ?? "warn",
      statusMessage: input.statusMessage ?? null,
      envAllowlist: input.envAllowlist ? JSON.stringify(input.envAllowlist) : null,
      source: "user",
      enabled: input.enabled ?? false,
      trusted: input.trusted ?? false,
    };

    const saved = await this.model.create(row);
    this.syncRegistry(saved);
    return saved;
  }

  async update(id: string, patch: HookPatch): Promise<HookConfigEntity> {
    if (patch.matcher !== undefined && patch.matcher.length > HOOK_LIMITS.maxMatcherChars) {
      throw new Error(`matcher exceeds ${HOOK_LIMITS.maxMatcherChars} chars`);
    }
    if (patch.timeoutMs !== undefined && patch.timeoutMs > HOOK_LIMITS.maxCommandTimeoutMs) {
      throw new Error(`timeoutMs exceeds ${HOOK_LIMITS.maxCommandTimeoutMs}ms`);
    }
    const updated = await this.model.update(id, patch);
    this.syncRegistry(updated);
    return updated;
  }

  async deleteById(id: string): Promise<void> {
    const existing = await this.model.findById(id);
    if (existing?.source !== "user") {
      throw new Error(`Only user hooks can be deleted (id=${id})`);
    }
    await this.model.deleteById(id);
    HookCommandTrustService.setTrusted(id, false);
    // Registry: easiest correct behavior is to reload all user hooks.
    await this.reloadUserHooksInRegistry();
  }

  async setEnabled(id: string, enabled: boolean): Promise<HookConfigEntity> {
    return this.update(id, { enabled });
  }

  async setTrusted(id: string, trusted: boolean): Promise<HookConfigEntity> {
    const updated = await this.model.update(id, { trusted });
    HookCommandTrustService.setTrusted(id, trusted);
    this.syncRegistry(updated);
    return updated;
  }

  async listUserHooks(): Promise<HookConfigEntity[]> {
    return this.model.listBySource("user");
  }

  /**
   * Startup hydration. Reads all user hooks, pushes enabled ones into
   * HookRegistry, and populates HookCommandTrustService cache from
   * the trusted column.
   */
  async loadUserHooksIntoRegistry(): Promise<void> {
    const rows = await this.model.listBySource("user");
    const trusted = rows.filter((r) => r.trusted);
    for (const r of trusted) {
      HookCommandTrustService.setTrusted(r.id, true);
    }
    const defs = rows
      .filter((r) => r.enabled)
      .map((r) => this.toDefinition(r));
    HookRegistry.replaceUserHooks(defs);
  }

  async reloadUserHooksInRegistry(): Promise<void> {
    await this.loadUserHooksIntoRegistry();
  }

  async deleteAllUserHooksForTests(): Promise<void> {
    await this.model.deleteAll();
    HookRegistry.replaceUserHooks([]);
  }

  private validate(input: CreateHookInput): void {
    if (!input.id) throw new Error("id is required");
    if (!input.command) throw new Error("command is required");
    if (input.matcher && input.matcher.length > HOOK_LIMITS.maxMatcherChars) {
      throw new Error(`matcher exceeds ${HOOK_LIMITS.maxMatcherChars} chars`);
    }
    if (input.timeoutMs && input.timeoutMs > HOOK_LIMITS.maxCommandTimeoutMs) {
      throw new Error(`timeoutMs exceeds ${HOOK_LIMITS.maxCommandTimeoutMs}ms`);
    }
  }

  private toDefinition(row: HookConfigEntity): CommandHookDefinition {
    return {
      id: row.id,
      eventName: row.eventName as HookEventName,
      matcher: row.matcher ?? undefined,
      source: "user",
      enabled: row.enabled,
      trusted: row.trusted,
      type: "command",
      command: row.command,
      cwd: row.cwd ?? undefined,
      timeoutMs: row.timeoutMs,
      failureMode: row.failureMode as "warn" | "block",
      statusMessage: row.statusMessage ?? undefined,
      envAllowlist: row.envAllowlist ? JSON.parse(row.envAllowlist) : undefined,
    };
  }

  /**
   * Reconcile a single hook's state in the registry. Called after
   * any create/update/setEnabled/setTrusted. Cheap because
   * replaceUserHooks is an atomic swap of just user-source entries.
   */
  private syncRegistry(_row: HookConfigEntity): void {
    // Reload is the simplest correct reconciliation. The DB is the
    // source of truth; the registry is a derived view.
    void this.reloadUserHooksInRegistry();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/modules/HookModule.test.ts 2>&1 | tail -20`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/HookModule.ts test/modules/HookModule.test.ts
git commit -m "feat: add HookModule with registry sync and trust hydration"
```

---

## Task 8: HookAuditModule

**Files:**
- Create: `src/modules/HookAuditModule.ts`
- Test: `test/modules/HookAuditModule.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/modules/HookAuditModule.test.ts`:

```ts
import { expect } from "chai";
import { HookAuditModule } from "@/modules/HookAuditModule";

describe("HookAuditModule", () => {
  let auditModule: HookAuditModule;

  beforeEach(() => {
    auditModule = new HookAuditModule();
  });

  afterEach(async () => {
    try { await auditModule.clearForTests(); } catch { /* ok */ }
  });

  it("records an entry and returns it via query", async () => {
    await auditModule.recordEntry({
      hookRunId: "run-1",
      hookId: "h-1",
      eventName: "PreToolUse",
      source: "user",
      type: "command",
      matchQuery: "shell_execute",
      status: "blocked",
      durationMs: 3,
      reason: "matched dangerous pattern",
    });

    const result = await auditModule.query({ limit: 10, offset: 0 });
    expect(result.total).to.equal(1);
    expect(result.rows[0].hookId).to.equal("h-1");
    expect(result.rows[0].status).to.equal("blocked");
  });

  it("accepts filters and pagination", async () => {
    for (let i = 0; i < 3; i++) {
      await auditModule.recordEntry({
        hookRunId: `r${i}`,
        hookId: "h-1",
        eventName: "PreToolUse",
        source: "user",
        type: "command",
        status: "success",
        durationMs: i,
      });
    }
    const page = await auditModule.query({ limit: 2, offset: 0 });
    expect(page.rows.length).to.equal(2);
    expect(page.total).to.equal(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test test/modules/HookAuditModule.test.ts 2>&1 | tail -10`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Write the module**

Create `src/modules/HookAuditModule.ts`:

```ts
import { BaseModule } from "./baseModule";
import { HookAuditModel, HookAuditQuery, HookAuditQueryResult } from "@/model/HookAudit.model";
import { HookModel } from "@/model/Hook.model";
import type { HookAuditEntry, HookAuditStatus, HookEventName, HookSource, HookCommandType } from "@/entityTypes/hookTypes";

export interface RecordEntryInput {
  hookRunId: string;
  hookId: string;
  eventName: HookEventName;
  source: HookSource;
  type: HookCommandType;
  matchQuery?: string;
  status: HookAuditStatus;
  durationMs?: number;
  reason?: string;
}

/**
 * Records hook audit entries to SQLite and updates the matching
 * HookConfig row's lastRunAt/lastRunStatus fields.
 *
 * Called by HookAuditService.PersistentHookAuditLogger — never by
 * renderer code directly.
 */
export class HookAuditModule extends BaseModule {
  private readonly auditModel: HookAuditModel;
  private readonly hookModel: HookModel;

  constructor() {
    super();
    this.auditModel = new HookAuditModel(this.dbpath);
    this.hookModel = new HookModel(this.dbpath);
  }

  async recordEntry(input: RecordEntryInput): Promise<void> {
    await this.auditModel.insert({
      hookRunId: input.hookRunId,
      hookId: input.hookId,
      eventName: input.eventName,
      source: input.source,
      type: input.type,
      matchQuery: input.matchQuery ?? null,
      status: input.status,
      durationMs: input.durationMs ?? null,
      reason: input.reason ?? null,
      timestamp: new Date(),
    });

    // Refresh lastRun on the hook config row if it's a user hook.
    try {
      await this.hookModel.updateRunStatus(input.hookId, input.status, new Date());
    } catch {
      // Builtins / session hooks have no config row — ignore.
    }
  }

  async query(q: HookAuditQuery): Promise<HookAuditQueryResult> {
    return this.auditModel.query(q);
  }

  async clearForTests(): Promise<void> {
    await this.auditModel.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test test/modules/HookAuditModule.test.ts 2>&1 | tail -10`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/HookAuditModule.ts test/modules/HookAuditModule.test.ts
git commit -m "feat: add HookAuditModule for recording and querying audit entries"
```

---

## Task 9: HookRegistry Extensions

**Files:**
- Modify: `src/service/hooks/HookRegistry.ts`
- Test: `test/vitest/utilitycode/hooks/HookRegistry.listAll.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/utilitycode/hooks/HookRegistry.listAll.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { CallbackHookDefinition, CommandHookDefinition } from "@/entityTypes/hookTypes";

function cb(id: string): CallbackHookDefinition {
  return {
    id, eventName: "PreToolUse", source: "builtin",
    enabled: true, trusted: true, type: "callback", callback: () => ({}),
  };
}
function cmd(id: string, source: "user" | "session" = "user"): CommandHookDefinition {
  return {
    id, eventName: "PreToolUse", source,
    enabled: true, trusted: true, type: "command",
    command: "node -e 'process.stdin.resume()'",
  };
}

describe("HookRegistry.listAll / registerUserHook / replaceUserHooks", () => {
  beforeEach(() => {
    HookRegistry.resetForTests();
  });

  it("listAll returns empty when nothing registered", () => {
    expect(HookRegistry.listAll()).toEqual([]);
  });

  it("listAll returns builtin hooks", () => {
    HookRegistry.registerBuiltinHook(cb("b1"));
    const all = HookRegistry.listAll();
    expect(all.map((h) => h.id)).toEqual(["b1"]);
  });

  it("registerUserHook adds a user hook visible to listAll", () => {
    HookRegistry.registerBuiltinHook(cb("b1"));
    HookRegistry.registerUserHook(cmd("u1"));
    const all = HookRegistry.listAll();
    expect(all.map((h) => h.id)).toEqual(["b1", "u1"]);
  });

  it("replaceUserHooks atomically swaps user entries", () => {
    HookRegistry.registerBuiltinHook(cb("b1"));
    HookRegistry.registerUserHook(cmd("u1"));
    HookRegistry.replaceUserHooks([cmd("u2"), cmd("u3")]);
    const all = HookRegistry.listAll();
    expect(all.map((h) => h.id)).toEqual(["b1", "u2", "u3"]);
  });

  it("replaceUserHooks preserves builtin and session entries", () => {
    HookRegistry.registerBuiltinHook(cb("b1"));
    HookRegistry.registerSessionHook("s1", cmd("sess1", "session"));
    HookRegistry.registerUserHook(cmd("u1"));
    HookRegistry.replaceUserHooks([cmd("u_new")]);
    const all = HookRegistry.listAll({ includeSession: true });
    expect(all.map((h) => h.id).sort()).toEqual(["b1", "sess1", "u_new"]);
  });

  it("listAll filters by source", () => {
    HookRegistry.registerBuiltinHook(cb("b1"));
    HookRegistry.registerUserHook(cmd("u1"));
    expect(HookRegistry.listAll({ source: "user" }).map((h) => h.id)).toEqual(["u1"]);
    expect(HookRegistry.listAll({ source: "builtin" }).map((h) => h.id)).toEqual(["b1"]);
  });

  it("listAll hides session entries unless includeSession is true", () => {
    HookRegistry.registerSessionHook("s1", cmd("sess1", "session"));
    expect(HookRegistry.listAll()).toEqual([]);
    expect(HookRegistry.listAll({ includeSession: true }).map((h) => h.id)).toEqual(["sess1"]);
  });

  it("listAll filters by eventName", () => {
    const stopHook = { ...cb("b1"), eventName: "Stop" as const };
    HookRegistry.registerBuiltinHook(stopHook);
    HookRegistry.registerBuiltinHook(cb("b2"));
    expect(HookRegistry.listAll({ eventName: "Stop" }).map((h) => h.id)).toEqual(["b1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest run test/vitest/utilitycode/hooks/HookRegistry.listAll.test.ts 2>&1 | tail -20`
Expected: FAIL with `HookRegistry.listAll is not a function` (or similar).

- [ ] **Step 3: Update HookRegistry**

Open `src/service/hooks/HookRegistry.ts`. Add three methods to the `HookRegistryApi` interface and `HookRegistryImpl` class.

In the `HookRegistryApi` interface (around lines 37-44), replace the block with:

```ts
export interface HookLookupInput {
  readonly eventName: HookEventName;
  readonly matchQuery?: string;
  readonly sessionId?: string;
}

export interface ListAllFilter {
  readonly eventName?: HookEventName;
  readonly source?: HookSource;
  readonly includeSession?: boolean;
}

export interface HookRegistryApi {
  registerBuiltinHook(hook: CallbackHookDefinition): void;
  registerSessionHook(sessionId: string, hook: HookDefinition): void;
  registerUserHook(hook: HookDefinition): void;
  replaceUserHooks(hooks: HookDefinition[]): void;
  clearSessionHooks(sessionId: string): void;
  getMatchingHooks(input: HookLookupInput): readonly HookDefinition[];
  listAll(filter?: ListAllFilter): readonly HookDefinition[];
  /** Test-only: wipe all hooks including built-ins. */
  resetForTests(): void;
}
```

Then add implementations to `HookRegistryImpl`. Just before `resetForTests()` (around line 112), insert:

```ts
  registerUserHook(hook: HookDefinition): void {
    if (hook.source !== "user") {
      throw new Error(`registerUserHook requires source 'user', got '${hook.source}'`);
    }
    this.assertNoLeak(hook);
    this.push(hook);
  }

  replaceUserHooks(hooks: HookDefinition[]): void {
    // Remove all existing user entries, preserving builtin/session.
    for (const list of this.byEvent.values()) {
      const filtered = list.filter((e) => e.hook.source !== "user");
      list.length = 0;
      list.push(...filtered);
    }
    for (const hook of hooks) {
      if (hook.source !== "user") {
        throw new Error(`replaceUserHooks requires source 'user', got '${hook.source}'`);
      }
      this.push(hook);
    }
  }

  listAll(filter?: ListAllFilter): readonly HookDefinition[] {
    const seen = new Set<string>();
    const collected: RegistryEntry[] = [];

    for (const list of this.byEvent.values()) {
      for (const entry of list) {
        if (entry.hook.source === "session" && !filter?.includeSession) continue;
        if (filter?.eventName && entry.hook.eventName !== filter.eventName) continue;
        if (filter?.source && entry.hook.source !== filter.source) continue;
        if (seen.has(entry.hook.id)) continue;
        seen.add(entry.hook.id);
        collected.push(entry);
      }
    }

    collected.sort((a, b) => {
      const pa = SOURCE_PRIORITY[a.hook.source];
      const pb = SOURCE_PRIORITY[b.hook.source];
      if (pa !== pb) return pa - pb;
      return a.seq - b.seq;
    });

    return collected.map((e) => e.hook);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest run test/vitest/utilitycode/hooks/HookRegistry.listAll.test.ts 2>&1 | tail -10`
Expected: PASS (8 tests).

Also run the existing HookRegistry test to ensure no regression:

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest run test/vitest/utilitycode/hooks/HookRegistry.test.ts 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/service/hooks/HookRegistry.ts test/vitest/utilitycode/hooks/HookRegistry.listAll.test.ts
git commit -m "feat: add HookRegistry.listAll, registerUserHook, replaceUserHooks"
```

---

## Task 10: HookCommandTrustService Persistence

**Files:**
- Modify: `src/service/hooks/HookCommandTrustService.ts`
- Test: `test/vitest/utilitycode/hooks/HookCommandTrustService.persist.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/utilitycode/hooks/HookCommandTrustService.persist.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { HookCommandTrustService } from "@/service/hooks/HookCommandTrustService";

describe("HookCommandTrustService persistence hooks", () => {
  beforeEach(() => {
    HookCommandTrustService.resetForTests();
  });

  it("hydrateFromTrustedMap seeds the in-memory set", () => {
    HookCommandTrustService.hydrateFromTrustedMap(new Set(["a", "b"]));
    expect(HookCommandTrustService.isTrusted("a")).toBe(true);
    expect(HookCommandTrustService.isTrusted("b")).toBe(true);
    expect(HookCommandTrustService.isTrusted("c")).toBe(false);
  });

  it("hydrateFromTrustedMap replaces, not merges", () => {
    HookCommandTrustService.setTrusted("old", true);
    HookCommandTrustService.hydrateFromTrustedMap(new Set(["new"]));
    expect(HookCommandTrustService.isTrusted("old")).toBe(false);
    expect(HookCommandTrustService.isTrusted("new")).toBe(true);
  });

  it("snapshotTrusted returns the current trusted set", () => {
    HookCommandTrustService.setTrusted("x", true);
    HookCommandTrustService.setTrusted("y", true);
    const snap = HookCommandTrustService.snapshotTrusted();
    expect(snap.has("x")).toBe(true);
    expect(snap.has("y")).toBe(true);
    expect(snap.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest run test/vitest/utilitycode/hooks/HookCommandTrustService.persist.test.ts 2>&1 | tail -10`
Expected: FAIL with `hydrateFromTrustedMap is not a function`.

- [ ] **Step 3: Update HookCommandTrustService**

Open `src/service/hooks/HookCommandTrustService.ts`. Replace the entire file with:

```ts
/**
 * Trust store for command hooks. Persisted to the HookConfig table
 * (via HookModule.setTrusted) and hydrated at app startup from
 * loadUserHooksIntoRegistry.
 *
 * `HookDefinition.trusted` is the static flag set at registration
 * time. This service is the dynamic, user-approved layer on top —
 * a command hook only runs when both are true.
 *
 * Main-process only.
 */
class HookCommandTrustServiceImpl {
  private trusted = new Set<string>();

  isTrusted(hookId: string): boolean {
    return this.trusted.has(hookId);
  }

  setTrusted(hookId: string, trusted: boolean): void {
    if (!hookId) throw new Error("hookId is required");
    if (trusted) {
      this.trusted.add(hookId);
    } else {
      this.trusted.delete(hookId);
    }
  }

  /**
   * Replace the in-memory trusted set. Called by
   * HookModule.loadUserHooksIntoRegistry at startup with the set of
   * hook IDs whose HookConfig.trusted column is true.
   */
  hydrateFromTrustedMap(ids: Set<string>): void {
    this.trusted = new Set(ids);
  }

  /** Current trusted hook IDs. Used by tests and debug views. */
  snapshotTrusted(): Set<string> {
    return new Set(this.trusted);
  }

  /** Test-only: wipe all trust grants. */
  resetForTests(): void {
    this.trusted.clear();
  }
}

export const HookCommandTrustService = new HookCommandTrustServiceImpl();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest run test/vitest/utilitycode/hooks/HookCommandTrustService.persist.test.ts 2>&1 | tail -10`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/service/hooks/HookCommandTrustService.ts test/vitest/utilitycode/hooks/HookCommandTrustService.persist.test.ts
git commit -m "feat: add hydrate + snapshot methods to HookCommandTrustService"
```

---

## Task 11: Persistent Audit Logger

**Files:**
- Modify: `src/service/hooks/HookAuditService.ts`

- [ ] **Step 1: Add the persistent logger**

Open `src/service/hooks/HookAuditService.ts`. Find the existing `ConsoleHookAuditLogger` export (around line 75-90). Immediately after that block, add:

```ts
/**
 * Lazy-imported to avoid a circular dep at module load time:
 * HookAuditModule imports BaseModule which imports Token, and
 * HookAuditService is imported by HookDispatcher which is imported
 * widely. Deferring the import keeps the module graph acyclic.
 */
export interface PersistentHookAuditLogger extends HookAuditLogger {
  setModule(module: import("@/modules/HookAuditModule").HookAuditModule): void;
}

class PersistentHookAuditLoggerImpl implements PersistentHookAuditLogger {
  private module?: import("@/modules/HookAuditModule").HookAuditModule;

  setModule(module: import("@/modules/HookAuditModule").HookAuditModule): void {
    this.module = module;
  }

  log(entry: HookAuditEntry): void {
    // Always log to console first so behavior is observable in dev
    // even if the DB write fails.
    ConsoleHookAuditLogger.log(entry);

    const mod = this.module;
    if (!mod) return;

    // Fire-and-forget — the dispatcher must never block on audit.
    void mod.recordEntry({
      hookRunId: entry.hookRunId,
      hookId: entry.hookId,
      eventName: entry.eventName,
      source: entry.source,
      type: entry.type,
      matchQuery: entry.matchQuery,
      status: entry.status,
      durationMs: entry.durationMs,
      reason: entry.reason,
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[HookAuditService] persistent log failed:", err);
    });
  }
}

export const PersistentHookAuditLogger: PersistentHookAuditLogger = new PersistentHookAuditLoggerImpl();
```

Also find `getHookAuditLogger()` (near the bottom of the file) and update it to return the persistent logger by default:

```ts
let activeLogger: HookAuditLogger = ConsoleHookAuditLogger;

export function getHookAuditLogger(): HookAuditLogger {
  return activeLogger;
}

/** Called once at app startup to switch from console-only to DB-backed audit. */
export function setHookAuditLogger(logger: HookAuditLogger): void {
  activeLogger = logger;
}
```

- [ ] **Step 2: Verify type check**

Run: `yarn tsc 2>&1 | tail -10`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/service/hooks/HookAuditService.ts
git commit -m "feat: add PersistentHookAuditLogger writing to HookAuditModule"
```

---

## Task 12: Dispatcher Global-Enable Gate

**Files:**
- Modify: `src/service/hooks/HookDispatcher.ts`
- Modify: `test/vitest/utilitycode/hooks/HookDispatcher.test.ts` (extend)

- [ ] **Step 1: Add the failing test**

Open `test/vitest/utilitycode/hooks/HookDispatcher.test.ts`. Add this `describe` block at the end (before the final `});` or as a new block):

```ts
import { Token } from "@/modules/token";
import { USER_HOOKS_ENABLED } from "@/config/usersetting";

describe("HookDispatcher global-enable gate", () => {
  beforeEach(() => {
    HookRegistry.resetForTests();
  });

  it("returns EMPTY_AGGREGATE when USER_HOOKS_ENABLED is not 'true'", async () => {
    Token.setValue(USER_HOOKS_ENABLED, "false");
    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: {
        eventName: "PreToolUse",
        hookRunId: "r1",
        source: "system",
        timestamp: new Date().toISOString(),
        tool: { id: "t1", name: "shell_execute", source: "legacy-tool" },
        input: {},
        permissionState: { allowed: true, needsPrompt: false },
      },
    });
    expect(result.blocked).toBe(false);
    expect(result.executedHookIds).toEqual([]);
  });

  it("executes matching hooks when USER_HOOKS_ENABLED is 'true'", async () => {
    Token.setValue(USER_HOOKS_ENABLED, "true");
    HookRegistry.registerBuiltinHook({
      id: "gate-test",
      eventName: "PreToolUse",
      source: "builtin",
      enabled: true,
      trusted: true,
      type: "callback",
      callback: () => ({ continue: false, reason: "blocked by test" }),
    });
    const result = await HookDispatcher.executeHooks({
      eventName: "PreToolUse",
      input: {
        eventName: "PreToolUse",
        hookRunId: "r2",
        source: "system",
        timestamp: new Date().toISOString(),
        tool: { id: "t1", name: "shell_execute", source: "legacy-tool" },
        input: {},
        permissionState: { allowed: true, needsPrompt: false },
      },
    });
    expect(result.blocked).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest run test/vitest/utilitycode/hooks/HookDispatcher.test.ts 2>&1 | tail -15`
Expected: FAIL — gate not implemented, so `USER_HOOKS_ENABLED=false` case will run hooks.

- [ ] **Step 3: Add the gate**

Open `src/service/hooks/HookDispatcher.ts`. Add imports at the top (alongside existing imports):

```ts
import { Token } from "@/modules/token";
import { USER_HOOKS_ENABLED } from "@/config/usersetting";
```

Replace the `executeHooks` method body's first lines. Find `if (!this.enabled) return EMPTY_AGGREGATE;` (around line 33) and replace it with:

```ts
    // Global enable gate — Token-backed so the System Settings UI
    // can toggle the whole subsystem without touching dispatcher
    // internals. Defaults to OFF (no hooks) when the Token value is
    // unset, matching the PRD's "disabled by default" intent.
    if (Token.getValue(USER_HOOKS_ENABLED) !== "true") {
      return EMPTY_AGGREGATE;
    }
```

Remove the `private enabled = true;` field entirely (it's no longer used). If there are references to `this.enabled`, remove them too.

- [ ] **Step 4: Run test to verify it passes**

Run: `AIFETCHLY_SKIP_TSC=1 yarn vitest run test/vitest/utilitycode/hooks/HookDispatcher.test.ts 2>&1 | tail -15`
Expected: PASS (all existing tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/service/hooks/HookDispatcher.ts test/vitest/utilitycode/hooks/HookDispatcher.test.ts
git commit -m "feat: gate HookDispatcher on USER_HOOKS_ENABLED token"
```

---

## Task 13: Channel Constants

**Files:**
- Modify: `src/config/channellist.ts`

- [ ] **Step 1: Add constants**

At the end of `src/config/channellist.ts`, append:

```ts
// Hooks system — Phase 4 management UI channels.
export const HOOKS_LIST = "hooks:list";
export const HOOKS_CREATE = "hooks:create";
export const HOOKS_UPDATE = "hooks:update";
export const HOOKS_DELETE = "hooks:delete";
export const HOOKS_SET_ENABLED = "hooks:setEnabled";
export const HOOKS_SET_TRUSTED = "hooks:setTrusted";
export const HOOKS_GET_GLOBAL_ENABLE = "hooks:getGlobalEnable";
export const HOOKS_SET_GLOBAL_ENABLE = "hooks:setGlobalEnable";
export const HOOKS_LIST_AUDIT = "hooks:listAudit";
```

- [ ] **Step 2: Verify type check**

Run: `yarn tsc 2>&1 | tail -5`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/config/channellist.ts
git commit -m "feat: add HOOKS_* IPC channel constants"
```

---

## Task 14: Hooks IPC Handlers

**Files:**
- Create: `src/main-process/communication/hooks-ipc.ts`
- Test: `test/vitest/main/hooks-ipc.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/hooks-ipc.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the modules the IPC handler depends on.
vi.mock("@/modules/HookModule", () => {
  const fake = {
    create: vi.fn().mockResolvedValue({ id: "u1" }),
    update: vi.fn().mockResolvedValue({ id: "u1" }),
    deleteById: vi.fn().mockResolvedValue(undefined),
    setEnabled: vi.fn().mockResolvedValue({ id: "u1", enabled: true, source: "user" }),
    setTrusted: vi.fn().mockResolvedValue({ id: "u1", trusted: true }),
    listUserHooks: vi.fn().mockResolvedValue([{ id: "u1", source: "user" }]),
    loadUserHooksIntoRegistry: vi.fn().mockResolvedValue(undefined),
  };
  return { HookModule: vi.fn(() => fake), __fake: fake };
});

vi.mock("@/modules/HookAuditModule", () => {
  const fake = {
    query: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    recordEntry: vi.fn().mockResolvedValue(undefined),
  };
  return { HookAuditModule: vi.fn(() => fake), __fake: fake };
});

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn((key: string) => (key === "user_hooks_enabled" ? "true" : "")),
    setValue: vi.fn(),
  })),
}));

vi.mock("@/service/hooks/HookRegistry", () => ({
  HookRegistry: {
    listAll: vi.fn().mockReturnValue([
      { id: "b1", eventName: "PreToolUse", source: "builtin", type: "callback", enabled: true, trusted: true },
    ]),
  },
}));

import { ipcMain } from "electron";
import { registerHooksIpcHandlers } from "@/main-process/communication/hooks-ipc";
import { HookModule as HookModuleMock } from "@/modules/HookModule";
import { HookAuditModule as HookAuditModuleMock } from "@/modules/HookAuditModule";

const fakeHook = (HookModuleMock as any).__fake;
const fakeAudit = (HookAuditModuleMock as any).__fake;

describe("hooks-ipc handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Wipe registered handlers between tests
    (ipcMain as any)._clear?.();
    registerHooksIpcHandlers();
  });

  it("registers a handler for each HOOKS_* channel", () => {
    const channels = (ipcMain as any)._handledChannels?.() ?? [];
    for (const c of [
      "hooks:list", "hooks:create", "hooks:update", "hooks:delete",
      "hooks:setEnabled", "hooks:setTrusted",
      "hooks:getGlobalEnable", "hooks:setGlobalEnable", "hooks:listAudit",
    ]) {
      expect(channels).toContain(c);
    }
  });

  it("hooks:create delegates to HookModule.create", async () => {
    const result = await (ipcMain as any)._invoke("hooks:create", {
      id: "u1", eventName: "PreToolUse", command: "node x",
    });
    expect(fakeHook.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1", command: "node x" })
    );
    expect(result.status).toBe(true);
  });

  it("hooks:delete rejects when HookModule throws", async () => {
    fakeHook.deleteById.mockRejectedValueOnce(new Error("Only user hooks can be deleted"));
    const result = await (ipcMain as any)._invoke("hooks:delete", { id: "builtin-x" });
    expect(result.status).toBe(false);
    expect(result.msg).toMatch(/only user hooks/i);
  });

  it("hooks:listAudit delegates to HookAuditModule.query", async () => {
    const result = await (ipcMain as any)._invoke("hooks:listAudit", { limit: 10, offset: 0 });
    expect(fakeAudit.query).toHaveBeenCalled();
    expect(result.status).toBe(true);
    expect(result.data.total).toBe(0);
  });

  it("hooks:setGlobalEnable writes Token and returns the new value", async () => {
    const result = await (ipcMain as any)._invoke("hooks:setGlobalEnable", { enabled: true });
    expect(result.status).toBe(true);
    expect(result.data).toBe(true);
  });
});
```

> **Note on the `_invoke` / `_handledChannels` test helpers:** these require a thin test shim for `ipcMain`. If the project already has one (check `test/vitest/main/`), reuse it. If not, add a tiny one in the test file:

Add this near the top of the test file, before `describe`:

```ts
// Test-only ipcMain shim. Replace if a project-wide helper exists.
vi.mock("electron", () => {
  const handlers = new Map<string, (e: unknown, data: unknown) => Promise<unknown>>();
  return {
    ipcMain: {
      handle(channel: string, fn: (e: unknown, data: unknown) => Promise<unknown>) {
        handlers.set(channel, fn);
      },
      _handledChannels: () => Array.from(handlers.keys()),
      _invoke: (channel: string, data: unknown) =>
        (handlers.get(channel) ?? (() => Promise.reject(new Error("no handler"))))(undefined, data),
      _clear: () => handlers.clear(),
    },
  };
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain test/vitest/main/hooks-ipc.test.ts 2>&1 | tail -15`
Expected: FAIL with `Cannot find module '@/main-process/communication/hooks-ipc'`.

- [ ] **Step 3: Write the IPC handler**

Create `src/main-process/communication/hooks-ipc.ts`:

```ts
/**
 * Hooks IPC Handlers — Phase 4 management UI.
 *
 * Thin: input shape validation + delegation to HookModule /
 * HookAuditModule. No direct database access, no repository use.
 */
import { ipcMain } from "electron";
import { HookModule, CreateHookInput } from "@/modules/HookModule";
import { HookAuditModule } from "@/modules/HookAuditModule";
import { HookRegistry } from "@/service/hooks/HookRegistry";
import { Token } from "@/modules/token";
import {
  USER_HOOKS_ENABLED,
  USER_HOOKS_BUILTIN_OVERRIDES,
} from "@/config/usersetting";
import {
  HOOKS_LIST, HOOKS_CREATE, HOOKS_UPDATE, HOOKS_DELETE,
  HOOKS_SET_ENABLED, HOOKS_SET_TRUSTED,
  HOOKS_GET_GLOBAL_ENABLE, HOOKS_SET_GLOBAL_ENABLE,
  HOOKS_LIST_AUDIT,
} from "@/config/channellist";
import type { HookEventName, HookSource } from "@/entityTypes/hookTypes";

interface Envelope<T> { status: boolean; data: T | null; msg: string; }
function ok<T>(data: T): Envelope<T> { return { status: true, data, msg: "" }; }
function fail(msg: string): Envelope<null> { return { status: false, data: null, msg }; }

function isString(v: unknown): v is string { return typeof v === "string"; }
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function registerHooksIpcHandlers(): void {
  ipcMain.handle(HOOKS_LIST, async (_event, data) => {
    try {
      const filter = isObject(data) ? data : {};
      const source = isString(filter.source) ? filter.source as HookSource | "all" : "all";
      const includeSession = filter.includeSession === true;
      const eventName = isString(filter.eventName) ? filter.eventName as HookEventName : undefined;
      const all = HookRegistry.listAll({ source: source === "all" ? undefined : source, includeSession, eventName });
      return ok(all);
    } catch (err: unknown) {
      return fail(`hooks:list failed: ${String(err)}`);
    }
  });

  ipcMain.handle(HOOKS_CREATE, async (_event, data) => {
    if (!isObject(data)) return fail("invalid payload");
    try {
      const module = new HookModule();
      const created = await module.create(data as CreateHookInput);
      return ok(created);
    } catch (err: unknown) {
      return fail(`hooks:create failed: ${String(err)}`);
    }
  });

  ipcMain.handle(HOOKS_UPDATE, async (_event, data) => {
    if (!isObject(data) || !isString(data.id)) return fail("invalid payload");
    try {
      const module = new HookModule();
      const updated = await module.update(data.id, data.patch as Record<string, unknown>);
      return ok(updated);
    } catch (err: unknown) {
      return fail(`hooks:update failed: ${String(err)}`);
    }
  });

  ipcMain.handle(HOOKS_DELETE, async (_event, data) => {
    if (!isObject(data) || !isString(data.id)) return fail("invalid payload");
    try {
      const module = new HookModule();
      await module.deleteById(data.id);
      return ok({ ok: true });
    } catch (err: unknown) {
      return fail(String(err));
    }
  });

  ipcMain.handle(HOOKS_SET_ENABLED, async (_event, data) => {
    if (!isObject(data) || !isString(data.id) || typeof data.enabled !== "boolean") {
      return fail("invalid payload");
    }
    try {
      const module = new HookModule();
      const updated = await module.setEnabled(data.id, data.enabled as boolean);
      return ok({ id: updated.id, enabled: updated.enabled, source: updated.source });
    } catch (err: unknown) {
      return fail(String(err));
    }
  });

  ipcMain.handle(HOOKS_SET_TRUSTED, async (_event, data) => {
    if (!isObject(data) || !isString(data.id) || typeof data.trusted !== "boolean") {
      return fail("invalid payload");
    }
    try {
      const module = new HookModule();
      const updated = await module.setTrusted(data.id, data.trusted as boolean);
      return ok(updated);
    } catch (err: unknown) {
      return fail(String(err));
    }
  });

  ipcMain.handle(HOOKS_GET_GLOBAL_ENABLE, async () => {
    try {
      const t = new Token();
      return ok(t.getValue(USER_HOOKS_ENABLED) === "true");
    } catch (err: unknown) {
      return fail(String(err));
    }
  });

  ipcMain.handle(HOOKS_SET_GLOBAL_ENABLE, async (_event, data) => {
    if (!isObject(data) || typeof data.enabled !== "boolean") return fail("invalid payload");
    try {
      const t = new Token();
      t.setValue(USER_HOOKS_ENABLED, (data.enabled as boolean) ? "true" : "false");
      return ok(data.enabled as boolean);
    } catch (err: unknown) {
      return fail(String(err));
    }
  });

  ipcMain.handle(HOOKS_LIST_AUDIT, async (_event, data) => {
    const filter = isObject(data) ? data : {};
    try {
      const module = new HookAuditModule();
      const result = await module.query({
        hookId: isString(filter.hookId) ? filter.hookId : undefined,
        eventName: isString(filter.eventName) ? filter.eventName as HookEventName : undefined,
        status: isString(filter.status) ? filter.status : undefined,
        fromTime: typeof filter.fromTime === "string" ? new Date(filter.fromTime) : undefined,
        toTime: typeof filter.toTime === "string" ? new Date(filter.toTime) : undefined,
        limit: typeof filter.limit === "number" ? filter.limit : 100,
        offset: typeof filter.offset === "number" ? filter.offset : 0,
      });
      return ok(result);
    } catch (err: unknown) {
      return fail(String(err));
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `AIFETCHLY_SKIP_TSC=1 yarn testmain test/vitest/main/hooks-ipc.test.ts 2>&1 | tail -15`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main-process/communication/hooks-ipc.ts test/vitest/main/hooks-ipc.test.ts
git commit -m "feat: add hooks-ipc handlers delegating to HookModule and HookAuditModule"
```

---

## Task 15: Register Hooks IPC + Builtin Override Loader

**Files:**
- Modify: `src/main-process/communication/index.ts`

- [ ] **Step 1: Add import**

In `src/main-process/communication/index.ts`, find the import block (around line 38) and add:

```ts
import { registerHooksIpcHandlers } from "@/main-process/communication/hooks-ipc";
```

- [ ] **Step 2: Register in `registerCommunicationIpcHandlers`**

Find the call list inside the `try { ... }` block (around lines 70+ — where `registerPluginIpcHandlers()` etc. are called). Add:

```ts
    registerHooksIpcHandlers();
```

- [ ] **Step 3: Verify type check**

Run: `yarn tsc 2>&1 | tail -5`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/main-process/communication/index.ts
git commit -m "feat: register hooks IPC handlers"
```

---

## Task 16: Preload Exposure

**Files:**
- Modify: `src/preload.ts`

- [ ] **Step 1: Add channel constants to the whitelist**

In `src/preload.ts`, find the `invoke` method's `validChannels` array (around line 800-826). Add the hooks channels alongside the existing entries:

```ts
      // Dialog Channels
      DIALOG_PICK_FOLDER,
      // Hooks system channels — Phase 4
      HOOKS_LIST,
      HOOKS_CREATE,
      HOOKS_UPDATE,
      HOOKS_DELETE,
      HOOKS_SET_ENABLED,
      HOOKS_SET_TRUSTED,
      HOOKS_GET_GLOBAL_ENABLE,
      HOOKS_SET_GLOBAL_ENABLE,
      HOOKS_LIST_AUDIT,
    ];
```

- [ ] **Step 2: Add imports**

At the top of `src/preload.ts`, add to the existing channellist import:

```ts
import {
  // ... existing imports ...
  HOOKS_LIST,
  HOOKS_CREATE,
  HOOKS_UPDATE,
  HOOKS_DELETE,
  HOOKS_SET_ENABLED,
  HOOKS_SET_TRUSTED,
  HOOKS_GET_GLOBAL_ENABLE,
  HOOKS_SET_GLOBAL_ENABLE,
  HOOKS_LIST_AUDIT,
} from "../src/config/channellist";
```

(If the file uses a different import path pattern, match that. The constants themselves are exported from `@/config/channellist`.)

- [ ] **Step 3: Verify type check**

Run: `yarn tsc 2>&1 | tail -5`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/preload.ts
git commit -m "feat: whitelist HOOKS_* channels in preload"
```

---

## Task 17: Frontend API

**Files:**
- Create: `src/views/api/hooks.ts`

- [ ] **Step 1: Write the API module**

Create `src/views/api/hooks.ts`:

```ts
/**
 * Renderer-side API for the Hooks management UI. Wraps ipcRenderer
 * calls exposed via the preload bridge.
 */
import type {
  HookDefinition,
  HookEventName,
  HookAuditEntry,
  HookAuditStatus,
  HookSource,
} from "@/entityTypes/hookTypes";

export interface HookListFilter {
  source?: "builtin" | "user" | "all";
  includeSession?: boolean;
  eventName?: HookEventName;
}

export interface HookAuditFilter {
  hookId?: string;
  eventName?: HookEventName;
  status?: HookAuditStatus;
  limit?: number;
  offset?: number;
  fromTime?: string;
  toTime?: string;
}

export interface NewHookInput {
  id: string;
  eventName: HookEventName;
  matcher?: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  failureMode?: "warn" | "block";
  statusMessage?: string;
  envAllowlist?: string[];
  enabled?: boolean;
  trusted?: boolean;
}

export interface HookConfigRow {
  id: string;
  eventName: string;
  matcher: string | null;
  hookType: string;
  command: string;
  cwd: string | null;
  timeoutMs: number;
  failureMode: string;
  statusMessage: string | null;
  envAllowlist: string | null;
  source: string;
  enabled: boolean;
  trusted: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Envelope<T> { status: boolean; data: T; msg: string; }

function ipc(): typeof window.api {
  return (window as unknown as { api: typeof window.api }).api;
}

async function invoke<T>(channel: string, data?: unknown): Promise<T> {
  const env = await ipc().invoke(channel, data) as Envelope<T>;
  if (!env.status) {
    throw new Error(env.msg || `hooks call failed: ${channel}`);
  }
  return env.data;
}

export async function listHooks(filter?: HookListFilter): Promise<HookDefinition[]> {
  return invoke<HookDefinition[]>("hooks:list", filter ?? {});
}

export async function createHook(input: NewHookInput): Promise<HookConfigRow> {
  return invoke<HookConfigRow>("hooks:create", input);
}

export async function updateHook(
  id: string,
  patch: Partial<HookConfigRow>
): Promise<HookConfigRow> {
  return invoke<HookConfigRow>("hooks:update", { id, patch });
}

export async function deleteHook(id: string): Promise<void> {
  await invoke<{ ok: boolean }>("hooks:delete", { id });
}

export async function setHookEnabled(
  id: string,
  enabled: boolean
): Promise<{ id: string; enabled: boolean; source: HookSource }> {
  return invoke("hooks:setEnabled", { id, enabled });
}

export async function setHookTrusted(
  id: string,
  trusted: boolean
): Promise<HookConfigRow> {
  return invoke("hooks:setTrusted", { id, trusted });
}

export async function getHooksGlobalEnable(): Promise<boolean> {
  return invoke<boolean>("hooks:getGlobalEnable");
}

export async function setHooksGlobalEnable(enabled: boolean): Promise<boolean> {
  return invoke<boolean>("hooks:setGlobalEnable", { enabled });
}

export async function listHookAudit(
  filter?: HookAuditFilter
): Promise<{ rows: HookAuditEntry[]; total: number }> {
  return invoke("hooks:listAudit", filter ?? {});
}
```

- [ ] **Step 2: Verify type check**

Run: `yarn vue-check 2>&1 | tail -5`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/views/api/hooks.ts
git commit -m "feat: add frontend hooks API with typed wrappers"
```

---

## Task 18: Hooks Vue Page

**Files:**
- Create: `src/views/pages/systemsetting/Hooks.vue`

- [ ] **Step 1: Write the page**

Create `src/views/pages/systemsetting/Hooks.vue`. This is the master-detail UI from the approved layout (Approach A):

```vue
<template>
  <v-container fluid>
    <!-- Header -->
    <v-row align="center" class="mb-2">
      <v-col cols="6">
        <v-switch
          v-model="globalEnabled"
          :label="t('system_settings.hooks.global_enable') || 'Enable hooks globally'"
          color="primary"
          hide-details
          @update:model-value="onGlobalToggle"
        />
      </v-col>
      <v-col cols="6" class="text-right">
        <v-btn color="primary" @click="onAddNew">
          <v-icon left>mdi-plus</v-icon>
          {{ t('system_settings.hooks.add_command') || '+ Add command hook' }}
        </v-btn>
      </v-col>
    </v-row>

    <v-alert v-if="!globalEnabled" type="warning" density="compact" class="mb-2">
      {{ t('system_settings.hooks.global_disable_banner') || 'Hooks are globally disabled — no hook will fire.' }}
    </v-alert>

    <!-- Filters -->
    <v-row dense class="mb-2">
      <v-col cols="3">
        <v-select
          v-model="filterEvent"
          :items="eventOptions"
          :label="t('system_settings.hooks.filter_event') || 'Event'"
          density="compact"
          clearable
        />
      </v-col>
      <v-col cols="3">
        <v-select
          v-model="filterSource"
          :items="sourceOptions"
          :label="t('system_settings.hooks.filter_source') || 'Source'"
          density="compact"
        />
      </v-col>
      <v-col cols="3">
        <v-checkbox
          v-model="showSession"
          :label="t('system_settings.hooks.show_session') || 'Show session hooks'"
          density="compact"
          hide-details
        />
      </v-col>
    </v-row>

    <!-- Master-detail -->
    <v-row>
      <v-col cols="5">
        <v-card>
          <v-card-title>
            {{ t('system_settings.hooks.title') || 'Hooks Management' }}
            <v-chip size="x-small" class="ml-2">{{ visibleHooks.length }}</v-chip>
          </v-card-title>
          <v-divider />
          <v-list density="compact" style="max-height: 480px; overflow-y: auto;">
            <v-list-item
              v-for="hook in visibleHooks"
              :key="hook.id"
              :active="selectedId === hook.id"
              @click="onSelect(hook.id)"
            >
              <v-list-item-title>
                <v-icon small class="mr-1">{{ iconFor(hook) }}</v-icon>
                {{ hook.id }}
              </v-list-item-title>
              <v-list-item-subtitle>
                {{ hook.eventName }} · {{ hook.source }}
                <span v-if="isUntrustedCommand(hook)"> · ⚠ {{ t('system_settings.hooks.trust_required') || 'Trust required' }}</span>
              </v-list-item-subtitle>
            </v-list-item>
            <v-list-item v-if="visibleHooks.length === 0">
              <v-list-item-title class="text--disabled">
                {{ t('system_settings.hooks.list_empty') || 'No hooks configured yet' }}
              </v-list-item-title>
            </v-list-item>
          </v-list>
        </v-card>
      </v-col>

      <v-col cols="7">
        <v-card>
          <v-card-title>{{ editorTitle }}</v-card-title>
          <v-card-text v-if="!selectedHook && !creating">
            <p class="text--disabled">
              {{ t('system_settings.hooks.create_first') || 'Create your first command hook' }}
            </p>
          </v-card-text>
          <v-card-text v-else>
            <v-text-field
              v-model="form.id"
              :label="t('system_settings.hooks.field.event') || 'Hook ID'"
              :disabled="!creating"
              density="compact"
              class="mb-2"
            />
            <v-select
              v-model="form.eventName"
              :items="eventOptions"
              :label="t('system_settings.hooks.field.event') || 'Event'"
              :disabled="!isUserSource"
              density="compact"
              class="mb-2"
            />
            <v-text-field
              v-model="form.matcher"
              :label="t('system_settings.hooks.field.matcher') || 'Matcher'"
              :disabled="!isUserSource"
              density="compact"
              class="mb-2"
            />
            <v-text-field
              v-model="form.command"
              :label="t('system_settings.hooks.field.command') || 'Command'"
              :disabled="!isUserSource"
              density="compact"
              class="mb-2"
            />
            <v-text-field
              v-model.number="form.timeoutMs"
              type="number"
              :label="t('system_settings.hooks.field.timeout') || 'Timeout (ms)'"
              :disabled="!isUserSource"
              density="compact"
              class="mb-2"
            />
            <v-select
              v-model="form.failureMode"
              :items="['warn', 'block']"
              :label="t('system_settings.hooks.field.failure_mode') || 'Failure mode'"
              :disabled="!isUserSource"
              density="compact"
              class="mb-2"
            />
            <v-text-field
              v-model="form.statusMessage"
              :label="t('system_settings.hooks.field.status_message') || 'Status message'"
              :disabled="!isUserSource"
              density="compact"
              class="mb-2"
            />

            <div class="mt-2">
              <v-btn
                v-if="isUserSource"
                color="primary"
                variant="outlined"
                class="mr-2"
                @click="onSave"
              >
                {{ t('system_settings.hooks.button.save') || 'Save' }}
              </v-btn>
              <v-btn
                v-if="canTrust"
                color="warning"
                variant="outlined"
                class="mr-2"
                @click="onTrust"
              >
                {{ t('system_settings.hooks.button.trust') || 'Trust' }}
              </v-btn>
              <v-btn
                v-if="canUntrust"
                variant="outlined"
                class="mr-2"
                @click="onUntrust"
              >
                {{ t('system_settings.hooks.button.untrust') || 'Untrust' }}
              </v-btn>
              <v-btn
                v-if="isUserSource && !creating"
                color="error"
                variant="outlined"
                @click="onDelete"
              >
                {{ t('system_settings.hooks.button.delete') || 'Delete' }}
              </v-btn>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Audit panel -->
    <v-row class="mt-4">
      <v-col cols="12">
        <v-card>
          <v-card-title>
            {{ t('system_settings.hooks.audit_title') || 'Recent audit log' }}
          </v-card-title>
          <v-card-text>
            <v-row dense class="mb-2">
              <v-col cols="3">
                <v-select
                  v-model="auditFilter.eventName"
                  :items="eventOptions"
                  label="Event"
                  clearable
                  density="compact"
                />
              </v-col>
              <v-col cols="3">
                <v-select
                  v-model="auditFilter.status"
                  :items="['started','success','blocked','failed','timeout']"
                  label="Status"
                  clearable
                  density="compact"
                />
              </v-col>
              <v-col cols="3">
                <v-select
                  v-model="auditFilter.hookId"
                  :items="hookIdOptions"
                  label="Hook"
                  clearable
                  density="compact"
                />
              </v-col>
              <v-col cols="3">
                <v-select
                  v-model="auditLimit"
                  :items="[100, 500, 1000]"
                  label="Last N rows"
                  density="compact"
                />
              </v-col>
            </v-row>
            <v-data-table
              :headers="auditHeaders"
              :items="auditRows"
              :items-per-page="10"
              density="compact"
            >
              <template #item.timestamp="{ item }">
                {{ formatTime(item.timestamp) }}
              </template>
            </v-data-table>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Trust confirm dialog -->
    <v-dialog v-model="trustDialog" max-width="500">
      <v-card>
        <v-card-title>
          {{ t('system_settings.hooks.trust_confirm_title') || 'Trust this command hook?' }}
        </v-card-title>
        <v-card-text>
          {{ t('system_settings.hooks.trust_confirm_body') || 'Trusting means the local process will run on every matching event.' }}
          <br /><code>{{ form.command }}</code>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="trustDialog = false">
            {{ t('system_settings.hooks.button.cancel') || 'Cancel' }}
          </v-btn>
          <v-btn color="warning" @click="confirmTrust">
            {{ t('system_settings.hooks.button.trust') || 'Trust' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete confirm dialog -->
    <v-dialog v-model="deleteDialog" max-width="500">
      <v-card>
        <v-card-title>
          {{ t('system_settings.hooks.delete_confirm_title') || 'Delete this hook?' }}
        </v-card-title>
        <v-card-text>
          {{ t('system_settings.hooks.delete_confirm_body') || 'This action cannot be undone.' }}
          <br /><code>{{ form.id }}</code>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="deleteDialog = false">
            {{ t('system_settings.hooks.button.cancel') || 'Cancel' }}
          </v-btn>
          <v-btn color="error" @click="confirmDelete">
            {{ t('system_settings.hooks.button.delete') || 'Delete' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  listHooks, createHook, updateHook, deleteHook,
  setHookEnabled, setHookTrusted,
  getHooksGlobalEnable, setHooksGlobalEnable,
  listHookAudit,
  type NewHookInput,
} from "@/views/api/hooks";
import type {
  HookDefinition, HookEventName, HookAuditEntry,
} from "@/entityTypes/hookTypes";

const { t } = useI18n();

const EVENT_NAMES: HookEventName[] = [
  "SessionStart", "UserPromptSubmit", "PreToolUse",
  "PostToolUse", "PostToolUseFailure",
  "PermissionRequest", "PermissionDenied", "Stop",
];
const eventOptions = EVENT_NAMES;
const sourceOptions = ["all", "builtin", "user"];

const globalEnabled = ref(false);
const filterEvent = ref<HookEventName | undefined>(undefined);
const filterSource = ref<"all" | "builtin" | "user">("all");
const showSession = ref(false);
const allHooks = ref<HookDefinition[]>([]);
const selectedId = ref<string | null>(null);
const creating = ref(false);

const form = ref({
  id: "",
  eventName: "PreToolUse" as HookEventName,
  matcher: "*",
  command: "",
  cwd: "",
  timeoutMs: 5000,
  failureMode: "warn" as "warn" | "block",
  statusMessage: "",
});

const trustDialog = ref(false);
const deleteDialog = ref(false);

// Audit
const auditRows = ref<HookAuditEntry[]>([]);
const auditFilter = ref<{ eventName?: HookEventName; status?: string; hookId?: string }>({});
const auditLimit = ref(100);

const auditHeaders = [
  { title: "Time", key: "timestamp", sortable: true },
  { title: "Hook", key: "hookId" },
  { title: "Event", key: "eventName" },
  { title: "Status", key: "status" },
  { title: "Duration", key: "durationMs" },
  { title: "Reason", key: "reason" },
];

const visibleHooks = computed(() => allHooks.value);
const selectedHook = computed(() =>
  allHooks.value.find((h) => h.id === selectedId.value) ?? null
);
const isUserSource = computed(() =>
  creating.value || selectedHook.value?.source === "user"
);
const canTrust = computed(() =>
  !creating.value &&
  selectedHook.value?.source === "user" &&
  selectedHook.value?.type === "command" &&
  selectedHook.value?.trusted !== true
);
const canUntrust = computed(() =>
  !creating.value &&
  selectedHook.value?.source === "user" &&
  selectedHook.value?.type === "command" &&
  selectedHook.value?.trusted === true
);
const editorTitle = computed(() => {
  if (creating.value) return t("system_settings.hooks.add_command") || "+ Add command hook";
  if (selectedHook.value) return selectedHook.value.id;
  return "";
});
const hookIdOptions = computed(() => allHooks.value.map((h) => h.id));

function isUntrustedCommand(hook: HookDefinition): boolean {
  return hook.source === "user" && hook.type === "command" && !hook.trusted;
}
function iconFor(hook: HookDefinition): string {
  if (hook.source === "builtin") return hook.enabled ? "mdi-check" : "mdi-pause";
  if (isUntrustedCommand(hook)) return "mdi-alert";
  return hook.enabled ? "mdi-check" : "mdi-pause";
}

function formatTime(ts: string | Date): string {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  return d.toLocaleString();
}

async function loadAll() {
  try {
    allHooks.value = await listHooks({
      source: filterSource.value === "all" ? undefined : filterSource.value,
      includeSession: showSession.value,
      eventName: filterEvent.value,
    });
  } catch (err) {
    console.error("hooks:list failed", err);
  }
}

async function loadAudit() {
  try {
    const result = await listHookAudit({
      ...auditFilter.value,
      limit: auditLimit.value,
      offset: 0,
    });
    auditRows.value = result.rows;
  } catch (err) {
    console.error("hooks:listAudit failed", err);
  }
}

async function onGlobalToggle(value: boolean) {
  try {
    await setHooksGlobalEnable(value);
    globalEnabled.value = value;
  } catch (err) {
    console.error(err);
    globalEnabled.value = !value; // revert
  }
}

function onSelect(id: string) {
  creating.value = false;
  selectedId.value = id;
  const hook = allHooks.value.find((h) => h.id === id);
  if (!hook || hook.type !== "command") return;
  form.value = {
    id: hook.id,
    eventName: hook.eventName,
    matcher: hook.matcher ?? "*",
    command: hook.command,
    cwd: hook.cwd ?? "",
    timeoutMs: hook.timeoutMs ?? 5000,
    failureMode: hook.failureMode ?? "warn",
    statusMessage: hook.statusMessage ?? "",
  };
}

function onAddNew() {
  creating.value = true;
  selectedId.value = null;
  form.value = {
    id: "",
    eventName: "PreToolUse",
    matcher: "*",
    command: "",
    cwd: "",
    timeoutMs: 5000,
    failureMode: "warn",
    statusMessage: "",
  };
}

async function onSave() {
  try {
    if (creating.value) {
      const input: NewHookInput = {
        id: form.value.id,
        eventName: form.value.eventName,
        matcher: form.value.matcher,
        command: form.value.command,
        cwd: form.value.cwd || undefined,
        timeoutMs: form.value.timeoutMs,
        failureMode: form.value.failureMode,
        statusMessage: form.value.statusMessage || undefined,
        enabled: false, // user must explicitly enable after create
        trusted: false,
      };
      await createHook(input);
    } else if (selectedHook.value?.source === "user") {
      await updateHook(form.value.id, {
        matcher: form.value.matcher,
        command: form.value.command,
        cwd: form.value.cwd || null,
        timeoutMs: form.value.timeoutMs,
        failureMode: form.value.failureMode,
        statusMessage: form.value.statusMessage || null,
      });
    }
    creating.value = false;
    await loadAll();
  } catch (err) {
    console.error("save failed", err);
    alert(String(err));
  }
}

function onTrust() { trustDialog.value = true; }
function onUntrust() { void doUntrust(); }
async function doUntrust() {
  if (!selectedHook.value) return;
  try {
    await setHookTrusted(selectedHook.value.id, false);
    await loadAll();
  } catch (err) {
    console.error(err);
  }
}
async function confirmTrust() {
  trustDialog.value = false;
  if (!selectedHook.value) return;
  try {
    await setHookTrusted(selectedHook.value.id, true);
    await loadAll();
  } catch (err) {
    console.error(err);
  }
}

function onDelete() { deleteDialog.value = true; }
async function confirmDelete() {
  deleteDialog.value = false;
  if (!selectedHook.value) return;
  try {
    await deleteHook(selectedHook.value.id);
    selectedId.value = null;
    await loadAll();
  } catch (err) {
    console.error(err);
    alert(String(err));
  }
}

watch([filterSource, filterEvent, showSession], () => { void loadAll(); });
watch([auditFilter, auditLimit], () => { void loadAudit(); }, { deep: true });

onMounted(async () => {
  try {
    globalEnabled.value = await getHooksGlobalEnable();
  } catch (err) {
    console.error("getHooksGlobalEnable failed", err);
  }
  await loadAll();
  await loadAudit();
});
</script>
```

- [ ] **Step 2: Verify type check**

Run: `yarn vue-check 2>&1 | tail -10`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/views/pages/systemsetting/Hooks.vue
git commit -m "feat: add Hooks.vue master-detail management page"
```

---

## Task 19: Route + Sidebar Entry

**Files:**
- Modify: `src/views/router/index.ts`
- Modify: `src/views/pages/systemsetting/index.vue`
- Modify: `src/views/lang/{en,zh,es,fr,de,ja}.ts` (route title only)

- [ ] **Step 1: Add the route**

In `src/views/router/index.ts`, after the `system_setting_skills` block (around line 73), add a new sibling route:

```ts
      {
        path: "hooks",
        name: "system_setting_hooks",
        meta: {
          title: "route.hooks_management",
          icon: "mdi-hook",
          keepAlive: false,
          visible: false,
        },
        component: () => import("@/views/pages/systemsetting/Hooks.vue"),
        children: [],
      },
```

- [ ] **Step 2: Add sidebar button**

In `src/views/pages/systemsetting/index.vue`, find the `navigateToSkills` button (around line 26-35). After it, add:

```vue
            <v-btn
              color="primary"
              variant="outlined"
              block
              @click="navigateToHooks"
              class="mb-2"
            >
              <v-icon left>mdi-hook</v-icon>
              {{ t('system_settings.manage_hooks') || 'Manage Hooks' }}
            </v-btn>
```

Then in the `<script>` section, near `navigateToSkills`, add:

```ts
function navigateToHooks() {
  router.push({ name: 'system_setting_hooks' });
}
```

- [ ] **Step 3: Add route title in en.ts**

In `src/views/lang/en.ts`, near the existing `mcp_tools: "MCP Tools",` and `skills_management: "Skills Management",` entries (around line 142-144), add:

```ts
    hooks_management: "Hooks Management",
```

And near `manage_skills: "Manage Skills",` (around line 1156), add:

```ts
    manage_hooks: "Manage Hooks",
```

Repeat for `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts` with appropriate translations:

| Lang | route.hooks_management | system_settings.manage_hooks |
|---|---|---|
| zh | "Hooks 管理" | "管理 Hooks" |
| es | "Gestión de Hooks" | "Administrar Hooks" |
| fr | "Gestion des Hooks" | "Gérer les Hooks" |
| de | "Hooks-Verwaltung" | "Hooks verwalten" |
| ja | "Hooks管理" | "Hooksを管理" |

- [ ] **Step 4: Verify type check**

Run: `yarn vue-check 2>&1 | tail -5`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/views/router/index.ts src/views/pages/systemsetting/index.vue src/views/lang/*.ts
git commit -m "feat: add system_setting_hooks route and sidebar entry"
```

---

## Task 20: i18n Keys (All 6 Languages)

**Files:**
- Modify: `src/views/lang/{en,zh,es,fr,de,ja}.ts`

- [ ] **Step 1: Add the keys block to en.ts**

In `src/views/lang/en.ts`, inside the existing `system_settings: { ... }` block, after the existing entries (around line 1155 — `manage_mcp_tools`, `manage_skills`), add the full hooks sub-block. Use the canonical English text:

```ts
    manage_hooks: "Manage Hooks",
    hooks: {
      title: "Hooks Management",
      description: "Manage AI chat lifecycle hooks",
      global_enable: "Enable hooks globally",
      global_disable_banner: "Hooks are globally disabled — no hook will fire.",
      add_command: "+ Add command hook",
      filter_event: "Event",
      filter_source: "Source",
      filter_status: "Status",
      filter_hook: "Hook",
      last_rows: "Last {n} rows",
      show_session: "Show session hooks",
      list_empty: "No hooks configured yet",
      create_first: "Create your first command hook",
      trust_required: "Trust required",
      trust_confirm_title: "Trust this command hook?",
      trust_confirm_body: "Trusting means the local process \"{command}\" will run on every matching \"{event}\" event.",
      delete_confirm_title: "Delete this hook?",
      delete_confirm_body: "This action cannot be undone.",
      builtin_cannot_modify: "Built-in hooks cannot be modified",
      audit_title: "Recent audit log",
      audit_empty: "No hook activity recorded yet",
      audit_time: "Time",
      audit_duration: "Duration",
      audit_reason: "Reason",
      field: {
        event: "Event",
        matcher: "Matcher",
        type: "Type",
        command: "Command",
        cwd: "Working directory",
        timeout: "Timeout (ms)",
        failure_mode: "Failure mode",
        status_message: "Status message",
        env_allowlist: "Env allowlist (JSON)",
        enabled: "Enabled",
        trusted: "Trusted",
        source: "Source",
      },
      source: {
        builtin: "Built-in",
        user: "User",
        session: "Session",
      },
      status: {
        started: "Started",
        success: "Success",
        blocked: "Blocked",
        failed: "Failed",
        timeout: "Timeout",
      },
      button: {
        save: "Save",
        delete: "Delete",
        trust: "Trust",
        untrust: "Untrust",
        cancel: "Cancel",
      },
      toast: {
        saved: "Hook saved",
        deleted: "Hook deleted",
        trust_updated: "Trust updated",
        load_failed: "Failed to load hooks",
        create_failed: "Failed to create hook",
      },
    },
```

- [ ] **Step 2: Add the equivalent block to the other 5 language files**

For each of `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts`, add the **same key structure** (under the existing `system_settings: { ... }` block, alongside `manage_hooks` which was added in Task 19) with the values translated. Key structure must be **identical** (same nested keys), only the values change.

> The complete translated blocks for all 5 languages are large; the implementer should translate each English value. Use the table below as a guide for the most user-visible strings:

| key | zh | es | fr | de | ja |
|---|---|---|---|---|---|
| title | "Hooks 管理" | "Gestión de Hooks" | "Gestion des Hooks" | "Hooks-Verwaltung" | "Hooks管理" |
| global_enable | "全局启用 hooks" | "Habilitar hooks globalmente" | "Activer les hooks globalement" | "Hooks global aktivieren" | "Hooksを全体に有効化" |
| add_command | "+ 添加命令 hook" | "+ Añadir hook de comando" | "+ Ajouter un hook de commande" | "+ Befehls-Hook hinzufügen" | "+ コマンド hook を追加" |
| trust_required | "需要信任" | "Se requiere confianza" | "Confiance requise" | "Vertrauen erforderlich" | "トラストが必要" |
| audit_title | "近期审计日志" | "Registro de auditoría reciente" | "Journal d'audit récent" | "Letztes Audit-Log" | "最近の監査ログ" |

(Event names like `PreToolUse` stay as code identifiers in all languages — no translation needed.)

- [ ] **Step 3: Verify type check**

Run: `yarn vue-check 2>&1 | tail -5`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/views/lang/*.ts
git commit -m "feat(i18n): add system_settings.hooks.* keys to all 6 languages"
```

---

## Task 21: Startup Wiring

**Files:**
- Modify: `src/background.ts`

- [ ] **Step 1: Wire the startup loader**

In `src/background.ts`, find the `app.whenReady` block around line 631 (after `await SqliteDb.ensureInitialized();`). Add a new try/catch block in the same style as the existing ones (e.g. right after the `AgentDefinitionModule.ensureBuiltIns()` block, around line 638):

```ts
      // Phase 4: load persisted user hooks into the registry and
      // hydrate HookCommandTrustService from the DB. Must run AFTER
      // SqliteDb is initialized and AFTER the HookDispatcher / Registry
      // modules have been imported (they are, via the IPC layer).
      try {
        const { HookModule } = await import("@/modules/HookModule");
        const hookModule = new HookModule();
        await hookModule.loadUserHooksIntoRegistry();

        // Activate the persistent audit logger now that the module is ready.
        const { HookAuditModule } = await import("@/modules/HookAuditModule");
        const { PersistentHookAuditLogger, setHookAuditLogger } = await import(
          "@/service/hooks/HookAuditService"
        );
        PersistentHookAuditLogger.setModule(new HookAuditModule());
        setHookAuditLogger(PersistentHookAuditLogger);

        log.info("Hook subsystem loaded user hooks and persistent audit logger");
      } catch (err) {
        log.error("Failed to load hook subsystem:", err);
      }
```

- [ ] **Step 2: Verify type check**

Run: `yarn tsc 2>&1 | tail -5`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/background.ts
git commit -m "feat: load user hooks into registry and activate persistent audit at startup"
```

---

## Task 22: Builtin Override Loader

**Files:**
- Modify: `src/modules/HookModule.ts`

- [ ] **Step 1: Extend HookModule**

Open `src/modules/HookModule.ts`. Add a new method `applyBuiltinOverrides` and call it from `loadUserHooksIntoRegistry` (just before `HookRegistry.replaceUserHooks(...)`):

```ts
  /**
   * Read the builtin override map from Token and apply it to the
   * already-registered builtins. Builtins register themselves with
   * their code-defined default `enabled` state at app init; this
   * runs afterwards and flips the flag based on user preference.
   */
  async applyBuiltinOverrides(): Promise<void> {
    const { Token } = await import("@/modules/token");
    const { USER_HOOKS_BUILTIN_OVERRIDES } = await import("@/config/usersetting");
    const t = new Token();
    const raw = t.getValue(USER_HOOKS_BUILTIN_OVERRIDES);
    if (!raw) return;

    let map: Record<string, { enabled: boolean }>;
    try {
      map = JSON.parse(raw);
    } catch {
      console.warn("[HookModule] malformed builtin overrides JSON, ignoring");
      return;
    }

    const all = HookRegistry.listAll({ source: "builtin" });
    for (const hook of all) {
      const override = map[hook.id];
      if (!override) continue;
      // Builtins are immutable definitions; we re-register with
      // the overridden enabled flag. This is acceptable because
      // listAll returns copies (the registry's getMatchingHooks
      // re-reads from its own map).
      HookRegistry.registerBuiltinHook({
        ...hook,
        enabled: override.enabled,
      });
    }
  }
```

Then in `loadUserHooksIntoRegistry`, before `HookRegistry.replaceUserHooks(defs);`:

```ts
    await this.applyBuiltinOverrides();
    HookRegistry.replaceUserHooks(defs);
```

- [ ] **Step 2: Extend the IPC handler for `hooks:setEnabled` to persist builtin overrides**

Open `src/main-process/communication/hooks-ipc.ts`. In the `HOOKS_SET_ENABLED` handler, after the existing user-hook branch, add a builtin branch:

```ts
  ipcMain.handle(HOOKS_SET_ENABLED, async (_event, data) => {
    if (!isObject(data) || !isString(data.id) || typeof data.enabled !== "boolean") {
      return fail("invalid payload");
    }
    try {
      // User hooks: update via module
      const module = new HookModule();
      const userHook = await module.findById?.(data.id);  // optional helper
      if (userHook) {
        const updated = await module.setEnabled(data.id, data.enabled as boolean);
        return ok({ id: updated.id, enabled: updated.enabled, source: updated.source });
      }
      // Builtin: persist override in Token, mutate registry entry
      const t = new Token();
      const raw = t.getValue(USER_HOOKS_BUILTIN_OVERRIDES);
      const map = raw ? JSON.parse(raw) : {};
      map[data.id] = { enabled: data.enabled };
      t.setValue(USER_HOOKS_BUILTIN_OVERRIDES, JSON.stringify(map));
      return ok({ id: data.id, enabled: data.enabled as boolean, source: "builtin" });
    } catch (err: unknown) {
      return fail(String(err));
    }
  });
```

Add `findById` helper to HookModule:

```ts
  async findById(id: string) {
    return this.model.findById(id);
  }
```

> **Note:** `findById` returns `null` for builtin ids (they're not in the DB), so the IPC handler falls through to the builtin override branch. This works without requiring the IPC layer to know about the registry.

- [ ] **Step 3: Verify type check**

Run: `yarn tsc 2>&1 | tail -10`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/HookModule.ts src/main-process/communication/hooks-ipc.ts
git commit -m "feat: persist and apply builtin hook enabled overrides"
```

---

## Task 23: Manual Smoke Test

**Files:** (no code changes — verification only)

- [ ] **Step 1: Run the dev server**

Run: `yarn dev`
Expected: app starts without errors; no "Hook" related errors in console.

- [ ] **Step 2: Verify the page exists**

In the app: navigate to System Settings → click "Manage Hooks".
Expected: empty hooks list (no user hooks yet) showing the "Create your first command hook" message; the global switch defaults to off; audit table is empty with the "No hook activity" message.

- [ ] **Step 3: Create a hook**

Click "+ Add command hook". Fill in:
- ID: `smoke-test-1`
- Event: `PreToolUse`
- Matcher: `*`
- Command: `node -e "console.log(JSON.stringify({continue:true}))"`
- Timeout: `5000`
- Failure mode: `warn`

Save.
Expected: row appears in list with ⚠ "Trust required" badge.

- [ ] **Step 4: Trust + enable**

Select `smoke-test-1`. Click Trust → confirm. Update via IPC (set `enabled: true` in DB by editing and saving again, or by toggling if a switch is added in the row).
Expected: hook now appears without the ⚠ badge.

- [ ] **Step 5: Verify dispatcher fires it**

In another tab/window, run an AI chat that triggers any tool call. Check the audit panel.
Expected: a new audit row appears for `smoke-test-1` with status `success` and the command's JSON output captured.

- [ ] **Step 6: Verify global enable toggle**

Toggle the global switch off. Trigger another tool call. Check audit panel.
Expected: no new audit rows (dispatcher short-circuits on `USER_HOOKS_ENABLED !== "true"`).

- [ ] **Step 7: Verify persistence**

Restart the app (`yarn dev` again). Navigate back to Hooks page.
Expected: `smoke-test-1` is still present, still trusted, still enabled; the global switch is in the same state as left.

- [ ] **Step 8: Cleanup**

Delete `smoke-test-1` via the UI. Confirm dialog → row disappears.

- [ ] **Step 9: No final commit (no code changes)**

---

## Self-Review

Run this checklist after completing all tasks.

**Spec coverage:**

- [x] Entity layer — Tasks 2, 3
- [x] Model layer — Tasks 5, 6
- [x] Module layer — Tasks 7, 8
- [x] Service upgrades (Registry, Trust, Audit, Dispatcher) — Tasks 9, 10, 11, 12
- [x] IPC — Tasks 13, 14, 15, 16
- [x] Frontend API — Task 17
- [x] UI page + route + sidebar — Tasks 18, 19
- [x] i18n — Tasks 19 (titles), 20 (full block)
- [x] Startup wiring — Task 21
- [x] Builtin overrides — Task 22
- [x] Acceptance criteria verification — Task 23

**Placeholder scan:** No "TBD", "implement later", or unspecified code blocks. Translations for non-English languages are described as a translation task (the implementer produces them) rather than inlined because the canonical English block is the contract; the table in Task 20 lists the most visible strings.

**Type consistency:**
- `HookRegistry.listAll(filter?: ListAllFilter)` returns `readonly HookDefinition[]` — Task 9; used in IPC Task 14 and Vue page Task 18.
- `HookModule.create` accepts `CreateHookInput`; IPC `HOOKS_CREATE` passes through as `CreateHookInput` — Task 14.
- `hooks:setEnabled` envelope: `{ id, enabled, source }` — Task 14 IPC, Task 17 frontend API, Task 18 Vue handler. All match.
- `HookCommandTrustService.hydrateFromTrustedMap` / `snapshotTrusted` — Task 10; called from Task 7 `loadUserHooksIntoRegistry`.
- `HookAuditModule.recordEntry(input)` — Task 8; called by PersistentHookAuditLogger Task 11; module injected in Task 21.
- `USER_HOOKS_ENABLED` constant — Task 1; read by Dispatcher Task 12, IPC Task 14, Vue page Task 18.

**No contradictions found.** Plan is ready for execution.
