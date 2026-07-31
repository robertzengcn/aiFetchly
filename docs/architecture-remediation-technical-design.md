# Architecture Remediation Program - Technical Design Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-07-10
- **Owner**: AiFetchly Desktop Engineering
- **Companion docs**:
  - `docs/prd/architecture-remediation-prd.md` — **WHAT** (requirements, acceptance criteria, workstreams)
  - `docs/architecture-optimization-review.md` — **WHY** (evidence, root causes, file:line findings)
  - This document — **HOW** (technical design, code patterns, migration mechanics)

> This document defines the technical approach for each workstream in the remediation PRD. It is prescriptive about interfaces, schemas, and migration mechanics so that implementation is mechanical and reviewable. Where a decision is still open, it is flagged as an **[ADR-NN]** candidate (see §14).

---

## 1. Purpose & Scope

This is the engineering design for the nine-workstream remediation program (WS-0 … WS-8) defined in the PRD. It covers:

- The **current technical architecture** (real layering, key abstractions, data flow).
- **Cross-cutting patterns** reused across workstreams (response envelope, `lazySchema`, `SecureStore`, DI, `Logger`).
- **Per-workstream technical design**: target interfaces (with TypeScript/Zod code), before/after refactor mechanics, alternatives considered, and ASCII sequence diagrams.
- **Data model**, **testing**, **observability**, **rollout/rollback**, and **threat model** details.

Non-goals: re-deriving the problem statement or acceptance criteria (those live in the PRD); re-listing findings (those live in the review).

---

## 2. Current Technical Architecture

### 2.1 Real Layering (four-plus layers, not three)

CLAUDE.md documents *IPC → Module → Model → Entity → DB*. The reality includes an orchestration layer (`src/service/`) that owns AI/streaming:

```
┌──────────────────────────────────────────────────────────────────┐
│  Renderer (Vue 3)                                                │
│  Component → windowInvoke(channel, data) ── contextBridge ──┐    │
└──────────────────────────────────────────────────────────────┼───┘
                                                                │ IPC
┌───────────────────────────────────────────────────────────────▼───┐
│  IPC Handler  (src/main-process/communication/*-ipc.ts)           │
│  registerValidatedHandler / registerAiValidatedHandler            │
│   • Zod safeParse  • fail-closed envelope  • AI-gate (AI fns)     │
│   • NEVER touches TypeORM repositories (boundary intact)          │
└────────┬───────────────────────────────────────┬──────────────────┘
         │                                       │
         ▼ (orchestration/AI/streaming)          ▼ (single-domain CRUD + rules)
┌────────────────────────┐              ┌──────────────────────────────────────┐
│  Service               │              │  Module  (src/modules/*)              │
│  (src/service/*)       │              │   extends BaseModule                  │
│  AIChatQueryLoop,      │              │   • uses Models for data access       │
│  StreamEventProcessor, │              │   • business rules                    │
│  ToolExecutor …        │              └───────────────┬──────────────────────┘
│  UNDOCUMENTED in       │                              │
│  CLAUDE.md  ← fix WS-8 │                              ▼
└────────────────────────┘              ┌──────────────────────────────────────┐
                                        │  Model  (src/model/*.model.ts)        │
                                        │   extends BaseDb → TypeORM repository │
                                        │   (legacy *db.ts raw SQL — fix WS-3)  │
                                        └───────────────┬──────────────────────┘
                                                        ▼
                                        ┌──────────────────────────────────────┐
                                        │  Entity (src/entity/*.entity.ts)      │
                                        │   TypeORM @Entity → SQLite (sqlite-vec)│
                                        └──────────────────────────────────────┘
```

**Parallel side-path for CPU-heavy work** (boundary intact — verified):

```
Task → Service/Module → utilityProcess.fork(worker) ──┐
                                                       │ parentPort / process.send
Renderer ◄── IPC ── Main ──◄── worker message ─────────┘
                       │
                       ▼ (Zod-parse worker output)
                   Model.save(...)   ← only main touches DB; workers NEVER do
```

### 2.2 Key Abstractions (as they exist today)

| Abstraction | Location | Notes |
|---|---|---|
| `CommonMessage<T>` envelope | `src/entityTypes/commonType.ts` | `{ status: boolean, msg: string, data: T \| null }` |
| `registerValidatedHandler` | `src/main-process/communication/_shared/registerValidatedHandler.ts` | `safeParse` → envelope; 30/40 handlers use it |
| `registerAiValidatedHandler` | same file | AI-gate **first**, then parse, then run |
| `AiFeatureGate.isAiEnabled()` | `src/service/AiFeatureGate.ts` | Fail-closed; reads `USER_AI_ENABLED` via `Token` |
| `lazySchema` | `src/utils/lazySchema.ts` | Defers schema construction; pairs with `zodToJsonSchema` WeakMap cache |
| `BaseDb` | `src/model/Basedb.ts` | Holds `SqliteDb`; legacy subclasses assign `this.db = Scraperdb.getdb()` |
| `BaseModule` | `src/modules/baseModule.ts` | Constructor eagerly touches DB + filesystem (makes testing destructive) |
| `SqliteDb` singleton | `src/config/SqliteDb.ts` | `getInstance(filepath)`; fire-and-forget destroy on path change; `synchronize: true` |
| `ElectronStoreService` | `src/modules/electronstoreservice.ts` | `electron-store` with **no encryptionKey**; keytar commented out |
| Worker Zod contract | `src/schemas/worker/*` | `lazySchema(() => z.discriminatedUnion("type", [...]))`; adopted by 2/15 workers |

---

## 3. Design Principles (technical)

1. **Preserve the `CommonMessage<T>` contract.** No renderer change is required for any IPC work — the envelope stays `{status,msg,data}`.
2. **Wrap, don't rewrite.** Prefer adapter patterns (`SecureStore`, DI registry) that change internals without changing caller signatures.
3. **Validate at every trust boundary.** IPC input, worker messages, persisted config, and plugin/marketplace manifests all pass through Zod `safeParse`.
4. **Lazy over eager.** Constructors must not perform I/O (DB, fs, network). Defer to an explicit `ensureConnection()`/`init()`.
5. **One source of truth per contract.** One Zod schema per IPC channel and per worker message; one transport; one platform factory.
6. **Reversible by default.** Every schema/storage change ships a downgrade path and a pre-change backup.
7. **Observable.** `Logger` (winston) everywhere; structured errors with codes; no `console.*` in shipped code.

---

## 4. Cross-Cutting Patterns

These appear in multiple workstreams; defined once here and referenced below.

### 4.1 The validated-IPC pattern (canonical — keep & extend)

Already implemented in `registerValidatedHandler.ts`. The migration target for the 10 raw handlers (WS-1 R1.5) is to **replicate this exact pattern**, not invent a new one:

```typescript
// src/schemas/ipc/search.ts  (example: existing kill-process schema)
import { z } from "zod";                 // see ADR-5 re: zod vs zod/v4
import { lazySchema } from "@/utils/lazySchema";

export const searchKillProcessInputSchema = lazySchema(() =>
  z.object({ pid: z.number().int().positive() })
);

// src/main-process/communication/search-ipc.ts
import { registerValidatedHandler } from "./_shared/registerValidatedHandler";
import { searchKillProcessInputSchema } from "@/schemas/ipc/search";

registerValidatedHandler(
  "search:kill-process",
  searchKillProcessInputSchema,
  async (input) => SearchController.killProcessByPID(input.pid)  // now typed {pid:number}
);
```

**Rules for any new/migrated handler:**
- Schema lives in `src/schemas/ipc/<domain>.ts`, wrapped in `lazySchema(() => …)`.
- Handler imports `registerValidatedHandler` (or `registerAiValidatedHandler` for AI functions).
- Handler body receives **already-parsed, typed** input — no `JSON.parse`, no `as` assertions.
- Handler returns raw data; the wrapper applies the `CommonMessage<T>` envelope.

### 4.2 `lazySchema` discipline

`zodToJsonSchema` caches via a `WeakMap` keyed on the schema object. Schemas constructed inline (new object each call) defeat the cache. **Always** wrap with `lazySchema(() => schema)`. This is already the convention in `schemas/worker/*` and `schemas/ipc/*`; enforce via review and a lint check (ADR-6).

### 4.3 Structured error type (ADR-2 decision)

Today: `CustomError` is dead (0 uses in `src/modules/`); 463 raw `throw new Error`. The design adopts a **single lightweight error class** used across service/module layers, surfaced as a string `msg` in the envelope at the IPC boundary (no behavior change for renderer):

```typescript
// src/modules/AppError.ts  (proposed)
export interface AppErrorMeta {
  readonly code: string;            // machine-readable, e.g. "marketplace-fetch-failed"
  readonly cause?: unknown;
  readonly [key: string]: unknown;  // structured context (secrets already redacted by caller)
}

export class AppError extends Error {
  constructor(
    message: string,
    public readonly meta: AppErrorMeta = { code: "unknown" }
  ) {
    super(message);
    this.name = "AppError";
  }
}

// Boundary behavior (unchanged for renderer):
// registerValidatedHandler catch → err instanceof AppError
//   ? { status:false, msg: redact(err.message), data:null }
//   : { status:false, msg: "Internal error", data:null }
```

**Decision ADR-2:** adopt `AppError` and delete `customError.ts`; add eslint `no-throw-literal` + custom rule to forbid raw `throw new Error(...)` in `src/modules` and `src/service` (allow only `throw new AppError(...)`). Renderer sees identical `msg` strings either way.

---

## 5. Workstream Technical Designs

### WS-1 — Security Hardening

#### 5.1.1 Secret encryption at rest — `SecureStore` adapter

**Current** (`electronstoreservice.ts:48-72`): `new Store(getStoreOptions(serviceName))` with no `encryptionKey`; `setValue` writes plaintext.

**Design:** an adapter that wraps values with Electron `safeStorage` and keeps the **same public method names** so `Token` and other callers are unchanged.

```typescript
// src/modules/SecureStore.ts  (proposed)
import Store from "electron-store";
import { safeStorage } from "electron";

const SENSITIVE_KEY_SUFFIXES = ["token", "secret", "password", "cookie", "apikey", "api_key"];

function isSensitive(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_SUFFIXES.some((s) => k.includes(s));
}

export class SecureStore {
  private store: Store;
  private readonly encryptionAvailable: boolean;

  constructor(service: string) {
    this.store = new Store(getStoreOptions(`${getAppName()}_${service}`));
    this.encryptionAvailable = safeStorage.isEncryptionAvailable();
    if (!this.encryptionAvailable && process.env.NODE_ENV === "production") {
      // Linux without keyring: fail loudly so we don't silently store plaintext.
      log.error("SecureStore: safeStorage unavailable; secrets will be plaintext");
    }
  }

  setValue(key: string, value: string): void {
    if (isSensitive(key) && this.encryptionAvailable) {
      const buf = safeStorage.encryptString(value);
      this.store.set(key, buf.toString("base64"));   // store base64 of encrypted buffer
    } else {
      this.store.set(key, value);
    }
  }

  getValue(key: string): unknown {
    const raw = this.store.get(key);
    if (typeof raw === "string" && isSensitive(key) && this.encryptionAvailable) {
      try {
        return safeStorage.decryptString(Buffer.from(raw, "base64"));
      } catch {
        // Likely a pre-migration plaintext value — fall through to migration.
        return raw;
      }
    }
    return raw;
  }

  /** One-time migration of existing plaintext sensitive values → encrypted. */
  migratePlaintextValues(): number { /* iterate store, re-encrypt sensitive string values */ }

  deleteValue(key: string): void { this.store.delete(key); }
  clearStore(): void { this.store.clear(); }
}
```

**Migration mechanics (zero-downtime for existing sessions):**
1. Ship `SecureStore`. `ElectronStoreService` becomes a thin alias or is replaced call-site-by-call-site.
2. On app boot (once), call `SecureStore.migratePlaintextValues()`: for each sensitive key, if the value is a non-base64 plaintext string, re-encrypt. Read tries decrypt first, falls back to plaintext, so the transition is graceful.
3. Feature-flag with `AIFETCHLY_ENCRYPT_STORE` (default on); if mass-decryption fails, flip the flag to read plaintext and re-issue.

**Threat model note:** `safeStorage` uses the OS keychain (macOS Keychain, Windows DPAPI, Linux libsecret/keyring). This restores the protection `keytar` provided before it was commented out, without re-introducing the native module.

**[ADR-1]** `safeStorage` (chosen) vs. `electron-store` `encryptionKey` (rejected: a hardcoded key in asar is trivially extractable). `safeStorage` binds to OS user credentials.

#### 5.1.2 Navigation guard + main-window sandbox

**Current** (`background.ts:369-489`): `setWindowOpenHandler` exists; **no `will-navigate`**; main window has `contextIsolation:true, nodeIntegration:false` but **no `sandbox:true`**.

**Design:**

```typescript
// src/background.ts  (add near window creation, after line ~438)
const TRUSTED_ORIGINS = new Set([
  app.isPackaged ? `file://` : new URL(VITE_DEV_SERVER_URL).origin,
  // app://<protocol> and any first-party schemes
]);

function isTrustedNavigation(url: string): boolean {
  try {
    const u = new URL(url);
    return TRUSTED_ORIGINS.has(u.origin) || u.protocol === "app:";
  } catch {
    return false;
  }
}

mainWindow.webContents.on("will-navigate", (e, url) => {
  if (!isTrustedNavigation(url)) {
    log.warn(`[security] blocked navigation to ${redactUrl(url)}`);
    e.preventDefault();
  }
});
// Also hook will-redirect for redirect chains:
mainWindow.webContents.on("will-redirect", (e, url) => {
  if (!isTrustedNavigation(url)) e.preventDefault();
});
```

**Sandbox decision [ADR-3]:** Attempt `sandbox: true` on the main window. If a preload dependency (e.g. a Node API used in `preload.ts`) breaks, either (a) move that logic to the main process and expose via IPC, or (b) document a compensating control and file a follow-up. Do **not** ship sandbox half-enabled.

#### 5.1.3 `exec` → `execFile` (argv)

**Current** (`SearchController.ts:792-793, 825`): `exec(\`kill -9 ${pid}\`)` / `exec(\`taskkill /PID ${pid} /F\`)`.

```typescript
// After (no shell, no interpolation)
import { execFile } from "node:child_process";

killProcessByPID(pid: number): void {
  const cmd = process.platform === "win32" ? "taskkill" : "kill";
  const args = process.platform === "win32" ? ["/PID", String(pid), "/F"] : ["-9", String(pid)];
  execFile(cmd, args, (err) => { if (err) log.error(`kill ${pid} failed: ${err.message}`); });
}
```

The Zod schema already constrains `pid` to `z.number().int().positive()`, so this is defense-in-depth, not a live exploit fix.

#### 5.1.4 Preload payload logging

**Current** (`preload.ts:426-428, 435, 437`): `console.log("send", channel, data)` in all environments. Wrap each in `if (import.meta.env?.DEV)` (or the existing `isDevelopment` gate) and prefer removal. This is also covered by the `no-console` eslint rule in WS-7.

---

### WS-2 — CI Test Gate & Coverage

#### 5.2.1 Coverage configuration

```javascript
// vite.main.config.mjs  (test block addition)
test: {
  globals: true,
  environment: "node",
  setupFiles: ["./test/vitest/main/setup.ts"],
  globalSetup: ["./test/vitest/_typecheck/globalSetup.ts"],   // preserve tsc gate
  coverage: {
    provider: "v8",
    reporter: ["text", "html", "lcov"],
    reportsDirectory: "./coverage/main",
    include: ["src/main-process/**", "src/service/**", "src/modules/**", "src/model/**"],
    exclude: ["**/*.test.ts", "test/**", "src/**/*.d.ts", "**/index.ts"],
    // thresholds: set to CURRENT baseline first (see 5.2.3), then ratchet
  },
}
```

#### 5.2.2 Unified CI command

```jsonc
// package.json (scripts)
"test:ci": "yarn test && yarn testmain && yarn vitest --config vitest.service.config.mjs",
"test:coverage": "yarn testmain --coverage"
```

#### 5.2.3 Graduated gate (avoid the 80% cliff)

A blanket 80% gate on legacy code would block every PR. Strategy:

1. **Measure baseline**: run coverage once, record per-directory numbers in `docs/test-coverage-baseline.md`.
2. **Global floor = baseline − 2%** (prevents regression, allows churn).
3. **Diff coverage = 80%** on new/changed lines via a diff-aware reporter (e.g. run coverage then compute changed-line coverage against the PR diff). Block PRs that add untested changed lines below 80%.
4. **Ratchet**: each quarter, raise the floor to the new measured median.

```yaml
# .github/workflows/build.yml  (new test job, runs before package jobs)
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20.19.3" }
      - run: yarn install --frozen-lockfile
      - run: yarn test:ci
      - uses: actions/upload-artifact@v4
        with: { name: coverage, path: coverage/ }
```

**[ADR-4]** Diff-coverage gate (chosen) vs. blanket 80% (rejected: blocks legacy refactors immediately, encourages gaming). The type-check gate (`globalSetup.ts` → `tsc --noEmit`) is preserved and runs as part of `testmain`.

---

### WS-3 — Database Integrity

#### 5.3.1 From `synchronize` to migrations

**Current** (`SqliteDb.ts:520`): `synchronize: true` always.

**Design:** TypeORM's built-in migration runner, gated by environment.

```typescript
// src/config/SqliteDb.ts  (DataSource construction)
const isProd = app.isPackaged || process.env.NODE_ENV === "production";

new DataSource({
  type: "better-sqlite3",
  database: dbpath,
  entities: [...allEntities],
  synchronize: !isProd,        // dev-only convenience
  migrations: [...allMigrations],
  migrationsRun: isProd,       // auto-run pending on boot in prod
  logging: false,
  prepareDatabase: (db) => { sqliteVec.load(db); db.pragma("journal_mode = WAL"); },
});
```

**Migration mechanics:**
1. **Generate baseline** against a DB whose schema matches current entities:
   `yarn migration:generate -- src/migrations/0000_baseline.ts` (TypeORM emits the SQL to recreate the schema; on an existing DB this becomes a no-op because the schema already matches).
2. **First-run safety**: on boot, **back up** the user DB file to `<db>.bak-<timestamp>` before running migrations. If `migrationsRun` throws, restore from the backup and surface a structured error.
3. **Down migrations**: every migration ships `down()`; add `yarn migration:revert` for support.
4. **Entity changes**: contributors run `yarn migration:generate` to produce the diff migration; `synchronize` stays on in dev so they see schema changes immediately without manual SQL.

```
App boot (prod):
  DB file exists? ─no→ create fresh, run all migrations up
       │yes
       ▼
  Copy <db> → <db>.bak-<ts>      (backup, always)
       │
       ▼
  DataSource.initialize() with migrationsRun:true
       │
       ├─ ok  → delete backups older than 7 days, continue boot
       └─ err → restore latest backup, log AppError(code:"db-migration-failed"), halt
```

**[ADR-7]** TypeORM migrations (chosen) vs. a custom version-table runner (rejected: TypeORM already provides `query-runner`, transactions, and `down()`; no need to roll our own). vs. keeping `synchronize` (rejected for prod: silent data loss on entity refactor).

#### 5.3.2 Consolidate data-access to TypeORM repositories

**Current:** 76 `*.model.ts` (TypeORM) + 20 `*db.ts` (raw `better-sqlite3` via `Scraperdb.getdb()`).

**Mechanics (per file, one PR each):**
1. Identify live consumers of the legacy `*db.ts` (e.g. `accountCookiesdb` ← `socialAccountApi.ts`, `socialaccount-controller.ts`).
2. Ensure a `.model.ts` exists with equivalent repository methods (create if missing).
3. Switch consumers to the `.model.ts`.
4. Delete the `*db.ts`. Grep confirms zero importers.
5. When the last `*db.ts` is gone, delete `Scraperdb` and remove the raw-SQL path; assign `this.db` cleanup in `BaseDb` is no longer needed.

**`BaseDb` cleanup** (until migration complete, make the contract subclass-independent):

```typescript
// src/model/Basedb.ts  (interim fix)
export abstract class BaseDb {
  protected sqliteDb: SqliteDb;
  protected db!: Database;                       // assigned centrally now
  constructor(filepath: string) {
    this.sqliteDb = SqliteDb.getInstance(filepath);
    // Centralize what every legacy subclass was doing by hand:
    this.db = Scraperdb.getInstance(filepath).getdb();
  }
  public async ensureConnection(): Promise<void> { await SqliteDb.ensureInitialized(); }
}
```

#### 5.3.3 Centralized worker guard

**Current:** `WORKER_TYPE` check in only ~4 models. **Design:** enforce in `BaseDb`/`BaseModule` (centralized, real) rather than per-file.

```typescript
// src/model/Basedb.ts
private assertNotWorker(): void {
  if (process.env.WORKER_TYPE) {
    throw new AppError("Direct DB access from a worker process is forbidden; use IPC to main", {
      code: "db-access-from-worker",
    });
  }
}
constructor(filepath: string) {
  this.assertNotWorker();
  /* ... */
}
```

This makes the documented rule (CLAUDE.md) actually true. Workers already don't import models (verified), so this is defense-in-depth that turns an implicit invariant into an enforced one.

#### 5.3.4 Path-safe singleton

**Current** (`SqliteDb.ts:608-640`): filepath change → fire-and-forget `destroy()` + immediate new instance (race risk).

```typescript
// Design: immutable path after init, guarded transition.
public static getInstance(filepath: string): SqliteDb {
  if (!filepath) throw new AppError("empty dbpath", { code: "db-empty-path" });
  if (SqliteDb.instance) {
    if (SqliteDb.currentDbPath !== filepath) {
      // Programmer error in a single-user app — the path is set once at boot.
      throw new AppError(
        `DB path immutable: ${SqliteDb.currentDbPath} → ${filepath}`,
        { code: "db-path-mutation" }
      );
    }
    return SqliteDb.instance;
  }
  SqliteDb.instance = new SqliteDb(filepath);
  SqliteDb.currentDbPath = filepath;
  return SqliteDb.instance;
}
// If a legitimate multi-tenant path switch is ever needed, add an explicit
// async `SqliteDb.switchPath(filepath)` guarded by a mutex (single transition
// at a time, all callers await the same promise).
```

#### 5.3.5 `SqliteVecDatabase.ts` cleanup

Delete the ~40% commented-out bodies (`saveIndex`, `optimizeIndex`, `restoreIndex`, `cleanup`, `createDataSource`). Replace `driver as any` (×4) with typed access:

```typescript
import { BetterSqlite3Driver } from "typeorm/driver/better-sqlite3/BetterSqlite3Driver";
// ...
const driver = dbConnection.connection.driver as BetterSqlite3Driver;
const database = driver.database;   // Database (better-sqlite3), typed
```

Add an identifier allowlist for dynamic table names (currently interpolated):

```typescript
const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
function assertSafeIdentifier(name: string): void {
  if (!IDENT.test(name)) throw new AppError(`unsafe table identifier: ${name}`, { code: "unsafe-ident" });
}
// usage: assertSafeIdentifier(this.currentVirtualTableName);
//        database.prepare(`DELETE FROM "${this.currentVirtualTableName}"`).run();
```

Switch `console.*` → `Logger` (ties to WS-7).

---

### WS-4 — Worker Reliability & Contract Unification

#### 5.4.1 Unified worker message contract

**Gold standard** (already in `schemas/worker/contactExtraction.ts`):

```typescript
export const contactExtractionWorkerOutboundSchema = lazySchema(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("worker-ready") }),
    z.object({ type: z.literal("extraction-progress"), resultId: z.number().int().positive(), /* ... */ }),
    /* ... */
  ])
);
export type ContactExtractionWorkerOutbound = z.infer<ReturnType<typeof contactExtractionWorkerOutboundSchema>>;
```

**Design:** a **shared base** so every worker composes common control messages instead of redeclaring them with different casing.

```typescript
// src/schemas/worker/_shared.ts  (proposed)
import { z } from "zod";
import { lazySchema } from "@/utils/lazySchema";

// Every worker MUST use `type` as the discriminator (not `action`, not `event`).
// Control messages common to all workers:
export const workerControlOutbound = [
  z.object({ type: z.literal("worker-ready") }),
  z.object({
    type: z.literal("worker-log"),
    level: z.enum(["info", "warn", "error", "debug"]).default("info"),
    args: z.array(z.unknown()).default([]),
  }),
  z.object({
    // drain in-flight requests on fatal error, then the worker exits(1).
    type: z.literal("worker-fatal"),
    requestIds: z.array(z.string()),
    message: z.string(),
    code: z.string(),
  }),
];

// A worker composes: lazySchema(() => z.discriminatedUnion("type", [...workerControlOutbound, ...domainSpecific]))
```

**Transport unification [ADR-8]:** standardize on `utilityProcess.fork` + `parentPort`. Retire `process.send`/`process.on("message")`. Delete `utils/childProcessMessage.ts` `parseChildMessage` (the 3-format normalizer) once all workers are migrated. Until then, new workers MUST use the new transport; a tracker lists the legacy ones.

**Main-side validation chokepoint:**

```typescript
// src/main-process/communication/_shared/workerMessageRouter.ts  (proposed)
// One place that validates worker → main messages before they reach a Module.
export function handleWorkerMessage<T>(
  raw: unknown,
  schema: () => ZodType<T>,
  onValid: (msg: T) => void | Promise<void>
): void {
  const parsed = schema().safeParse(typeof raw === "string" ? JSON.parse(raw) : raw);
  if (!parsed.success) {
    log.warn(`[worker] dropped malformed message: ${parsed.error.message}`);
    return;          // drop, never crash main
  }
  void onValid(parsed.data);
}
```

#### 5.4.2 Bounded restart policy

**Current** (`contactExtraction-ipc.ts:114-123`): `setTimeout(spawnWorker, 5000)` forever.

```typescript
// src/modules/WorkerRestartPolicy.ts  (proposed)
export class WorkerRestartPolicy {
  private attempts: number[] = [];   // timestamps of recent restarts
  constructor(
    private readonly maxRestartsInWindow = 5,
    private readonly windowMs = 60_000,
    private readonly baseDelayMs = 1_000,
    private readonly maxDelayMs = 30_000
  ) {}

  /** Returns delay in ms, or null if the circuit is open (stop restarting). */
  nextRestartDelayMs(): number | null {
    const now = Date.now();
    this.attempts = this.attempts.filter((t) => now - t < this.windowMs);
    if (this.attempts.length >= this.maxRestartsInWindow) return null;   // circuit open
    this.attempts.push(now);
    const exp = Math.min(this.baseDelayMs * 2 ** this.attempts.length, this.maxDelayMs);
    return exp;                                                          // exponential backoff
  }
  reset(): void { this.attempts = []; }   // call after sustained healthy uptime
}
```

On `nextRestartDelayMs()` returning `null`, mark the task `Failed` (via the owning Module) instead of looping.

#### 5.4.3 Fatal-error handling (mirror `LocalEmbeddingWorker`)

`ContactExtractionWorker.ts:69-80` currently only `console.error`s. Target:

```typescript
// src/childprocess/contact-extraction/ContactExtractionWorker.ts
const activeRequestIds = new Set<string>();

process.on("uncaughtException", (err) => {
  log.error("[worker] uncaughtException", err);
  drainAndExit(err);
});
process.on("unhandledRejection", (reason) => {
  log.error("[worker] unhandledRejection", reason);
  drainAndExit(reason instanceof Error ? reason : new Error(String(reason)));
});

function drainAndExit(err: Error): void {
  try {
    parentPort?.postMessage(JSON.stringify({
      type: "worker-fatal",
      requestIds: [...activeRequestIds],
      message: err.message,
      code: "worker-crash",
    }));
  } finally {
    process.exit(1);
  }
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
```

Main-side, on `worker-fatal`, reject the in-flight promises for the listed `requestId`s (the clients already do this in `LocalEmbeddingWorkerClient`/`SkillWorkerClient`).

#### 5.4.4 Persisted queue

`ExtractionQueue` keeps `queue/active/processing` in memory. Design: checkpoint to the DB via a `ContactExtractionJob` entity (or reuse the existing `ContactInfo.extractionStatus`), and have main re-queue on worker boot:

```
Worker boot:
  1. send worker-ready
  2. main reads jobs where extractionStatus='pending' OR (='running' AND stale heartbeat)
  3. main re-sends extract-contact for those — worker resumes, no loss
```

This makes the queue crash-recoverable without the worker itself touching the DB.

#### 5.4.5 `WorkerCoordinator` — global process/browser budget

```typescript
// src/modules/WorkerCoordinator.ts  (proposed)
export class WorkerCoordinator {
  private active = new Map<string, { proc: ChildProcess; browsers: Set<Browser> }>();
  private readonly maxConcurrentBrowsers: number;   // platform/RAM-derived (ADR-9)

  async acquireSlot(workerId: string): Promise<void> {
    if (this.countBrowsers() >= this.maxConcurrentBrowsers) {
      throw new AppError("Worker concurrency budget exhausted", { code: "worker-budget-full" });
    }
    /* ...register... */
  }
  registerBrowser(workerId: string, b: Browser): void { /* track for forced cleanup */ }
  async forceCleanupAll(): Promise<void> {
    // called from app.on('before-quit'): close every tracked browser + kill procs
    for (const { browsers, proc } of this.active.values()) {
      await Promise.allSettled([...browsers].map((b) => b.close().catch(() => {})));
      proc.kill();
    }
  }
  private countBrowsers(): number { /* sum browsers across active */ }
}
```

`app.on("before-quit")` calls `WorkerCoordinator.forceCleanupAll()` — this also satisfies WS-4 R4.5 (the never-called `cleanupContactExtractionWorker` becomes a coordinator method).

---

### WS-5 — Module-Layer Health

#### 5.5.1 Lazy `BaseModule` (prerequisite for DI/testing)

**Current** (`baseModule.ts:7-29`): constructor eagerly runs `new Token()` → `SqliteDb.getInstance()` → `fs.mkdirSync`.

```typescript
// src/modules/baseModule.ts  (refactored)
export abstract class BaseModule {
  protected dbpath!: string;          // assigned in ensureConnection
  protected sqliteDb!: SqliteDb;
  private connected = false;

  public async ensureConnection(): Promise<void> {
    if (this.connected) return;
    this.dbpath = resolveDbPath();          // pure helper, no side effect until here
    this.sqliteDb = SqliteDb.getInstance(this.dbpath);
    await SqliteDb.ensureInitialized();
    this.connected = true;
  }
}
function resolveDbPath(): string {
  const dbpath = new Token().getValue(USERSDBPATH);
  if (dbpath) return dbpath;
  // test fallback — still lazy, only materialized when ensureConnection is called
  const tmp = path.join(os.tmpdir(), "aifetchly-test");
  fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}
```

**Effect:** `new SomeModule()` in a unit test no longer touches the DB or filesystem. `ensureConnection()` is called explicitly before the first query (most modules already call it; add a lint/audit for those that don't).

#### 5.5.2 Lightweight DI for hub modules

**Decision [ADR-10]:** no DI container framework. Use **constructor injection with defaults** so production call-sites are unchanged but tests can inject fakes.

```typescript
// src/modules/TaskExecutorService.ts  (before: 7 hard-new)
constructor(
  private readonly deps: {
    searchTask: SearchTaskModule;
    buckEmail: BuckEmailTaskModule;
    search: SearchModule;
    emailSearch: EmailSearchTaskModule;
    yellowPages: YellowPagesModule;
    googleMaps: GoogleMapsModule;
    yandexMaps: YandexMapsModule;
    aiMessage: AiMessageTaskModule;
  } = {
    searchTask: new SearchTaskModule(),
    buckEmail: new BuckEmailTaskModule(),
    search: new SearchModule(),
    emailSearch: new EmailSearchTaskModule(),
    yellowPages: new YellowPagesModule(),
    googleMaps: new GoogleMapsModule(),
    yandexMaps: new YandexMapsModule(),
    aiMessage: new AiMessageTaskModule(),
  }
) {}

// Production: new TaskExecutorService()           // unchanged
// Test:        new TaskExecutorService({ ...fakes })
```

Apply the same shape to `YellowPagesOrchestrator`, `RagSearchModule`, `AIChatV2Module`, `buckEmailTaskModule`.

#### 5.5.3 Platform factory consolidation

Delete `PlatformFactory.ts`, `UnifiedPlatformFactory.ts`, top-level `PlatformAdapterFactory.ts`. Collapse the 3 hand-maintained 15-element lists into one map:

```typescript
// src/modules/platforms/PlatformAdapterFactory.ts  (consolidated)
const ADAPTER_REGISTRY: ReadonlyMap<string, () => IBasePlatformAdapter> = new Map([
  ["YellowPagesComAdapter", () => new YellowPagesComAdapter()],
  ["YelpComAdapter",        () => new YelpComAdapter()],
  // ...single source of truth
]);

export function createAdapter(name: string): IBasePlatformAdapter {
  const factory = ADAPTER_REGISTRY.get(name);
  if (!factory) throw new AppError(`unknown adapter: ${name}`, { code: "adapter-unknown" });
  return factory();
}
export const availableAdapters = (): string[] => [...ADAPTER_REGISTRY.keys()];
export const isAdapterAvailable = (name: string): boolean => ADAPTER_REGISTRY.has(name);
```

Adding a platform = one map entry (was: edit 3 lists + `index.ts`).

#### 5.5.4 Error contract — see §4.3 (`AppError`)

#### 5.5.5 God-module decomposition strategy

Mechanical, one file per PR:
- `YellowPagesProcessManager` (1795 lines) → `YellowPagesLifecycleService` (spawn/kill), `YellowPagesIpcRouter` (message handling), `YellowPagesErrorRecovery`. The `@OneLine` invariant: each extracted file owns one responsibility and stays < 400 lines.
- `lib/function.ts` (1226) → `lib/datetime.ts`, `lib/strings.ts`, `lib/ids.ts`, etc.
- Enforce via eslint `max-lines` (warn 400, error 800 — matches the existing CLAUDE.md rule).

---

### WS-6 — Frontend Migration Completion

#### 5.6.1 Pinia migration (auth/permission-safe)

**Pattern** — port a `vuex-module-decorators` class module to a setup-style Pinia store, preserving logic:

```typescript
// BEFORE: src/views/store/modules/user.ts  (Vuex class module)
@Module({ dynamic: true, store, name: "user" })
class UserModule extends VuexModule {
  token = "";
  @Mutation setToken(t: string) { this.token = t; }
  @Action async login(data) { const res = await login(data); this.setToken(res.token); }
}

// AFTER: src/views/store/user.ts  (Pinia setup store)
export const useUserStore = defineStore("user", () => {
  const token = ref("");
  const setToken = (t: string) => { token.value = t; };           // immutable update
  async function login(data: LoginInput) {
    const res = await windowInvoke("user:login", loginInputSchema, data);
    if (res.status) setToken(res.data.token);
    return res;
  }
  return { token, setToken, login };
});
```

**Cutover safety:** port one module at a time; keep the Vuex module live in parallel until all call-sites migrate; delete Vuex + `vuex-module-decorators` + `vue-class-component` in the final PR. Manual + automated UAT on login and permission-route flows gates deletion.

#### 5.6.2 `useApiCall` composable

```typescript
// src/views/composables/useApiCall.ts  (proposed)
export function useApiCall<T>(channel: string) {
  const data = ref<T | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function invoke(input: unknown): Promise<T | null> {
    loading.value = true; error.value = null;
    try {
      const res = await windowInvoke(channel, input);
      if (res.status) { data.value = res.data as T; return res.data as T; }
      error.value = res.msg;
      useSnackbar().error(res.msg);
      return null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : "Unknown error";
      useSnackbar().error(error.value);
      return null;
    } finally { loading.value = false; }
  }
  return { data, loading, error, invoke };
}
```

Adoption gives every page a uniform loading/error path (e.g. `proxy.vue` currently has none).

#### 5.6.3 v1 AI chat retirement

Gated by a **parity checklist** (functions + i18n keys present in v2): streaming, attachments, tool-call rendering, plan approval, session memory, MCP tools. Once v2 covers all, delete `AiChatBox.vue`, `ai-chat-ipc.ts`, `api/aiChat.ts`, `api/aiChatWithRAG.ts`, and remove v1 wiring from `layout.vue`. God-component split of `AiChatV2.vue` (2106 lines) follows the WS-5 decomposition pattern (template/composer/state split, mirroring the existing `aiChatV2/` subcomponents).

#### 5.6.4 Renderer types from Zod

```typescript
// src/views/api/search.ts
import { searchResultOutputSchema } from "@/schemas/ipc/search";
type SearchResult = z.infer<ReturnType<typeof searchResultOutputSchema>>;  // no hand-written interface
```

Delete the duplicate `Iresponse` (`api/types.d.ts:28` vs `utils/apirequest.ts:1`); keep one, derived from the schema.

---

### WS-7 — Type & Logging Discipline

#### 5.7.1 `no-console` + `Logger`

```jsonc
// .eslintrc.json  (addition)
{
  "rules": {
    "no-console": ["error", { "allow": ["warn", "error"] }],
    "@typescript-eslint/no-explicit-any": "warn",
    "no-restricted-imports": ["error", { "paths": [{ "name": "electron", "importNames": ["ipcRenderer"] }] }]
  },
  "overrides": [
    { "files": ["src/modules/Logger.ts"], "rules": { "no-console": "off" } }
  ]
}
```

Codemod `console.log` → `log.info`/`log.debug`; `console.error` → `log.error`. `Logger` (`src/modules/Logger.ts`, winston) is the only escape hatch.

#### 5.7.2 Strict tsconfig

```jsonc
// tsconfig.json  (flip these)
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,             // was false
    "strictPropertyInitialization": true, // was false
    "noImplicitThis": true,            // was false
    // UN-MOCK electron-store for non-test compiles: move the alias to tsconfig.test.json
  }
}
```

Move the `electron-store` → `test/mocks/*` alias out of the production `paths` into a `tsconfig.test.json` that extends the base, so production type-check catches real API drift.

#### 5.7.3 Zod version reconciliation [ADR-5]

Two consistent options (pick one):
- **(A) Honor the mandate:** pin `"zod": "^3.25.0"` (the minimum exposing `./v4`), codemod `from "zod"` → `from "zod/v4"` across the 58 sites.
- **(B) Drop the mandate:** keep `from "zod"`, remove the `zod/v4` rule from CLAUDE.md, document v3 semantics.

Recommended: **(A)** only if a concrete v4 feature (e.g. `z.discriminatedUnion` improvements, `z.interface`) is needed; otherwise **(B)** to stop contradicting the code. Either way, add a lint check that the import style is consistent repo-wide.

---

### WS-8 — Architecture Documentation

Update CLAUDE.md "Architecture Overview" to the four-layer reality (§2.1 diagram), add the "where does new code go?" rule (Service = orchestration/streaming/AI/tool-calls; Module = single-domain CRUD + rules; Model = data access; Entity = schema), and seed `docs/adr/` with the ADRs referenced throughout this document (ADR-1 … ADR-10). Each ADR: context → decision → consequences → alternatives.

---

## 6. Data Model Changes

| Change | Entity/Schema | Workstream |
|---|---|---|
| DB migrations table | TypeORM `migrations` (auto) | WS-3 |
| `ContactExtractionJob` (queue checkpoint) | new `src/entity/ContactExtractionJob.entity.ts` | WS-4 |
| `WorkerCoordinator` runtime state | in-memory only (no entity) | WS-4 |
| `AppError` | new `src/modules/AppError.ts` (not persisted) | WS-5 |
| DB-path backup files | `<db>.bak-<ts>` (filesystem, not entity) | WS-3 |
| No entity changes required for WS-1/WS-2/WS-6/WS-7 | — | — |

No breaking entity changes are introduced by this program; `synchronize` removal is handled by the baseline migration capturing the current schema exactly.

---

## 7. Testing Strategy (technical)

- **Unit**: hub modules with injected fakes (WS-5); `SecureStore` encrypt/decrypt round-trip + migration (WS-1); `WorkerRestartPolicy` backoff/circuit (WS-4); `WorkerCoordinator` budget enforcement (WS-4); `AppError` boundary mapping (WS-5).
- **Contract**: every IPC schema gets a parse test (valid + invalid samples); every worker message schema gets a round-trip test.
- **Integration**: migration up + down on a copy of a real user DB (WS-3); worker crash → re-queue recovery (WS-4); `will-navigate` blocked vs trusted (WS-1).
- **Regression**: the IPC suite (`test/vitest/main/ipc/*`) runs in CI (WS-2) — guards the boundary invariants (no DB in handlers).
- **Manual UAT**: login/permission flows post-Pinia (WS-6); v2 chat parity checklist (WS-6).

Tests live per the placement rules in CLAUDE.md (`test/vitest/main/`, `test/vitest/utilitycode/`, `test/modules/`).

---

## 8. Observability

- **Structured logs** via `Logger` (winston): every boundary event (validation failure, worker restart, migration step, security block) emits a leveled log with a `code`.
- **`AppError.meta.code`** propagates structured error codes to the envelope `msg` where useful, and to diagnostics bundles (redacting secrets per existing `pluginMarketplaceRedact` precedent).
- **Worker diagnostics**: `worker-fatal` messages carry `requestIds` so dropped work is traceable.
- **Coverage** lcov uploaded as a CI artifact for trending.

---

## 9. Rollout & Rollback Mechanics

- **Feature flags** for high-risk changes: `AIFETCHLY_ENCRYPT_STORE` (WS-1), `AIFETCHLY_DB_MIGRATIONS` (WS-3, default on after verification).
- **Per-workstream PRs**: no big-bang. Each WS-5/WS-6 refactor lands one module/component at a time.
- **DB rollback**: every migration has `down()`; pre-migration backup file is restored automatically on migration error.
- **Secret rollback**: flip the encrypt flag; existing values decrypt-or-fallback to plaintext.
- **Worker rollback**: per-worker; legacy contract files retained until all workers migrated, then deleted.
- **CI gate rollback**: `test` job starts as `continue-on-error` if initial flakiness is high, then hardens.

---

## 10. Performance Considerations

- `synchronize:false` in prod removes per-boot schema introspection (small boot win).
- `WorkerCoordinator` cap prevents RAM blow-up from unbounded browser fan-out.
- `lazySchema` + `WeakMap` cache keeps Zod → JSON-schema conversion cheap for AI tool definitions.
- Strict tsconfig / `no-console` have no runtime cost.
- God-file decomposition improves HMR and type-check times materially (the 3,690-line `AiChatBox.vue` is currently a compile sink).

---

## 11. Security Threat Model (summary)

| Threat | Control |
|---|---|
| Theft of at-rest tokens from userData | `safeStorage` encryption (WS-1) |
| Renderer navigates to attacker origin, preload re-injects `window.api` | `will-navigate`/`will-redirect` guard + main-window sandbox (WS-1) |
| Command injection via `pid` | `execFile` argv + Zod `int().positive()` (WS-1) |
| Malformed IPC payload crashes handler/worker | `safeParse` at every boundary; drop, don't crash (WS-1, WS-4) |
| Worker reads auth token from env | confirmed trusted-bundled-code-only; message-handshake if that changes (WS-1) |
| Direct `ipcRenderer` import in renderer bypasses allowlist | eslint `no-restricted-imports` (WS-1/WS-7) |
| Schema drift between preload allowlist and main registrations | (follow-up) reconcile channel lists; single source via `channellist.ts` |
| DB corruption on migration | pre-migration backup + verified `down()` (WS-3) |

---

## 12. Sequence Diagrams

### 12.1 Validated IPC request (post WS-1)

```
Renderer                Preload (contextBridge)        Main (ipcMain.handle)
   │ windowInvoke("x", data)                              │
   │──────api.invoke("x", JSON.stringify(data))──────────▶│
   │                                                       │ registerValidatedHandler
   │                                                       │  raw = string → JSON.parse
   │                                                       │  schema().safeParse(raw)
   │                                                       │   ├ fail → {status:false,msg,data:null}
   │                                                       │   └ ok   → handler(parsed.data)
   │                                                       │             → Service/Module → Model
   │                                                       │ ← {status:true,msg:"ok",data}
   │◀─────────────── CommonMessage<T> ────────────────────│
```

### 12.2 Worker crash recovery (post WS-4)

```
Main                     Worker                  DB (via Main only)
  │ fork + parentPort      │                         │
  │──extract-contact──────▶│                         │
  │                        │ processing…             │
  │                        │ ✗ uncaughtException     │
  │                        │ drainAndExit():         │
  │◀──worker-fatal─────────│ postMessage({requestIds,│
  │                         msg,code}); exit(1)      │
  │ reject in-flight promises for requestIds         │
  │ WorkerRestartPolicy.nextRestartDelayMs()         │
  │   ├ delay → refork, main re-queues pending jobs ─▶ re-send extract-contact
  │   └ null (circuit open) → mark task Failed       │ (no DB access by worker)
```

### 12.3 DB migration on boot (post WS-3, prod)

```
boot → DB file exists?
        ├ no → create → run all migrations up ──▶ continue
        └ yes → copy <db> → <db>.bak-<ts>
                DataSource.initialize() (migrationsRun:true)
                 ├ ok → prune backups >7d → continue
                 └ err → restore <db>.bak-<ts> → log AppError(code:db-migration-failed) → halt
```

---

## 13. Alternatives Considered (cross-cutting)

| Decision | Chosen | Rejected (why) |
|---|---|---|
| Secret storage | `safeStorage` | `electron-store` encryptionKey (extractable from asar); re-add `keytar` (native module cost) |
| Validation | Extend existing `registerValidatedHandler` | New validation lib / decorator system (unnecessary; 75% already adopted) |
| Migrations | TypeORM migrations runner | Custom version-table (reinvents transactions/down); keep `synchronize` (silent data loss) |
| DI | Constructor injection w/ defaults | `tsyringe`/`inversify` (heavyweight; overkill for ~7 hubs) |
| Worker contract | Zod `discriminatedUnion` per worker + shared control base | Single mega-schema (unwieldy); TS interfaces only (no runtime validation) |
| Coverage gate | Diff-coverage 80% + ratcheting floor | Blanket 80% (blocks legacy; encourages gaming) |
| God-file split | Extract-by-responsibility, one PR each | Big-bang rewrite (risk; blocks other work) |

---

## 14. ADR Index (to be authored in `docs/adr/`)

- **ADR-1** Secret storage via `safeStorage` (WS-1)
- **ADR-2** Adopt `AppError`; delete `customError.ts`; lint raw throws (WS-5)
- **ADR-3** Main-window sandbox: enable, or document compensating control (WS-1)
- **ADR-4** Graduated diff-coverage gate, not blanket 80% (WS-2)
- **ADR-5** Zod `zod/v4` mandate: honor (pin ^3.25.0) or drop (WS-7)
- **ADR-6** `lazySchema` required for all IPC/worker schemas (WS-1/WS-4)
- **ADR-7** TypeORM migrations over `synchronize` in production (WS-3)
- **ADR-8** Single worker transport: `utilityProcess.fork` + `parentPort` (WS-4)
- **ADR-9** Worker/browser concurrency budget value & derivation (WS-4)
- **ADR-10** Constructor injection with defaults for hub modules (WS-5)

---

## 15. Implementation File Map (technical additions)

**New files (this design introduces):**
- `src/modules/SecureStore.ts` (WS-1)
- `src/modules/AppError.ts` (WS-5)
- `src/modules/WorkerRestartPolicy.ts`, `src/modules/WorkerCoordinator.ts` (WS-4)
- `src/schemas/worker/_shared.ts`, `src/main-process/communication/_shared/workerMessageRouter.ts` (WS-4)
- `src/schemas/ipc/<domain>.ts` for each of the 10 migrated handlers (WS-1)
- `src/migrations/0000_baseline.ts` + subsequent (WS-3)
- `src/entity/ContactExtractionJob.entity.ts` (WS-4)
- `src/views/composables/useApiCall.ts` (WS-6)
- Pinia stores replacing Vuex modules (WS-6)
- `tsconfig.test.json` (electron-store mock alias relocated) (WS-7)
- `docs/adr/0001…0010-*.md` (WS-8)
- `docs/test-coverage-baseline.md` (WS-2)

**Deleted files (this design confirms):** (see PRD §14) — `ChildProcessManager.ts`, `ChildProcessScraper.ts`, dead platform factories, `scraperdb.ts` + migrated `*db.ts`, v1 AI chat files, `componets/` typo dir, `HomeView.vue`, `utils/childProcessMessage.ts` (post-transport-unification), `customError.ts` (post-`AppError`), `vite.worker.config.mjs`.

---

## 16. Definition of Done (technical)

- Every code pattern in §4/§5 is implemented behind the PRD's acceptance criteria.
- All new boundaries validate with Zod (`safeParse`); all constructors are I/O-free; all errors flow through `AppError` → envelope.
- CI runs the full suite with coverage; diff-coverage ≥ 80%; type-check gate green with strict tsconfig.
- DB changes apply via migrations in prod; `synchronize` off; backup/restore verified.
- Workers share one transport + one contract pattern; restart policy bounded; coordinator enforces the budget and cleans up on quit.
- `safeStorage` encrypts sensitive store values; navigation guard blocks untrusted origins; main window sandboxed (or documented).
- CLAUDE.md matches the four-layer reality; ADRs 1–10 authored.
- `docs/architecture-optimization-review.md` marks each finding resolved.

---

## References

- `docs/architecture-optimization-review.md` — evidence base
- `docs/prd/architecture-remediation-prd.md` — requirements & workstreams
- `src/main-process/communication/_shared/registerValidatedHandler.ts` — validation pattern
- `src/service/AiFeatureGate.ts` — fail-closed gate pattern
- `src/schemas/worker/contactExtraction.ts` — worker contract gold standard
- `src/config/SqliteDb.ts`, `src/model/Basedb.ts`, `src/modules/baseModule.ts` — DB/base layer
- `src/modules/electronstoreservice.ts` — store layer to wrap
- Electron `safeStorage`: <https://www.electronjs.org/docs/latest/api/safe-storage>
- TypeORM migrations: <https://typeorm.io/migrations>
