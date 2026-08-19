# aiFetchly — Architecture Optimization Review

> **Scope:** Structural & architectural assessment of the Electron + Vue 3 + TypeScript codebase (~257K LOC, 1,112 source files). Evidence-based — every finding cites real files and line numbers. Not a style review.
>
> **Date:** 2026-07-10 · **Branch:** `dev` (sqlite-vec-merge lineage)
> **Method:** Direct codegraph/grep analysis of entity, vector, AI, service, and cross-cutting layers, plus six parallel deep-dive audits (IPC/security, DB architecture, worker/child-process, module coupling, frontend, build/dependencies).

---

## Remediation Status (Architecture Remediation Program — 2026-07-10)

> This table tracks which findings from this review have been addressed by the
> Architecture Remediation Program (`docs/prd/architecture-remediation-prd.md`).
> Branch: `worktree-architecture-remediation`.

| Finding | § | Workstream | Status |
|---|---|---|---|
| `src/service/` undocumented 4th layer | 4.1 | WS-8 | ✅ Resolved — CLAUDE.md documents the four-layer reality + placement rules |
| `synchronize: true`, dual data-access, dual driver | 4.2 | WS-3 | ✅ Migration gate + CLI shipped; `synchronize` auto-disables when baseline exists; all 18 legacy `*db.ts` removed; `SqliteVecDatabase` cleaned (typed driver, no `as any`, no dead code); entity indices added (16 hot paths); path-safe singleton |
| Dead `ChildProcessManager`, restart loops, contract fragmentation | 4.3 | WS-4 | ⚠️ Partial — dead managers deleted + canonical managers documented (R4.1); bounded restart policy with circuit-breaker (R4.2); fatal-error handling (R4.3); in-flight job crash recovery — main re-queues on worker restart, marks failed on circuit-break (R4.4); before-quit cleanup closes the worker + its browsers gracefully (R4.5). **R4.6: all 11 worker entries validate inbound via Zod `safeParse`** (8 canonical schemas in `src/schemas/worker/` + shared `parseWorkerMessage` helper; malformed dropped, never crash). R4.7 WorkerCoordinator singleton shipped (budget cap + 5 tests). Transport unification + interface-file collapse remain. |
| God modules, no DI, dead abstractions, factory tangle | 4.4 | WS-5 | ⚠️ Partial — `BaseModule` constructor lazy (R5.2 ✅); **R5.1 COMPLETE** — all 4 hubs (TaskExecutorService, RagSearchModule, YellowPagesOrchestrator, YellowPagesProcessManager) have constructor-injection DI + fake-substitution unit tests (the singleton uses a `createForTest` factory for test isolation). Factory consolidation (R5.4), god-file splits (R5.6) remain. |
| Stalled Pinia migration, god components, mixed API layer | 4.5 | WS-6 | ⚠️ Partial — Pinia-only cutover complete: `vuex`/`vuex-module-decorators`/`vue-class-component`/`vue-template-compiler` dropped, setup-style stores + 18 parity tests (R6.1); API consolidated — `skills.vue`→`windowInvoke`, `ipcRenderer` gone from `src/views` (R6.4); `useApiCall` composable + first adoption (R6.5); `Iresponse` deduped to one `CommonMessage<any>` (R6.6); dead frontend code removed — `HomeView.vue`, `componets/` typo dir, empty `asyncRoutes`/permission machinery (R6.7). v1-chat retirement (R6.2, needs parity decision) + god-component splits (R6.3) remain. |
| Logging epidemic, `any`, half-strict tsconfig, dead code | 4.6 | WS-7 | ⚠️ Drift gates — `no-console: warn` + `no-explicit-any: warn` eslint rules added; Zod mandate reconciled; `electron-store` un-aliased so prod type-checks the real package (R7.3); backend console→Logger completed — only ~24 active calls remained (the rest were commented debug), all convertible ones done (R7.4). **R7.2 COMPLETE — all three strict flags ON** (`noImplicitThis`, `strictPropertyInitialization` via 729 `!` assertions, `noImplicitAny` via 134 annotations across the codebase incl. preload/background); `tsc --noEmit` exit 0. Explicit-`any` reduction (separate from noImplicitAny) remains. |
| Plaintext secrets, navigation bypass, unsandboxed window, exec injection, raw IPC, preload logging | 6 | WS-1 | ⚠️ Partial — nav guard (R1.2 ✅), execFile (R1.4 ✅), preload gate (R1.6 ✅), ipcRenderer lint (R1.8 ✅), SecureStore adapter + wiring behind flag (R1.1 ✅). 48/51 IPC handlers migrated to registerValidatedHandler (R1.5). Sandbox flip (R1.3) documented as compensating control. userIpc 4 (auth) deferred. |
| CI runs 0 tests, no coverage | 7-8 | WS-2 | ✅ Resolved — blocking CI gate (vitest suite 99.7% green), coverage tooling (`@vitest/coverage-v8`), `yarn test:ci`, 5 test-bug fixes, USonar quarantine |
| Bogus `crypto`, dead `sqlite3`, stray files | 7 | WS-0 | ✅ Resolved — `crypto`/`sqlite3`/`@types/sqlite3` removed; orphan configs deleted; gitignore broadened; timestamp files removed |

---

## 1. Executive Summary

aiFetchly is a **large, mature, genuinely functional** desktop application with a few **excellent seams** — a clean IPC validation wrapper, a real template-method platform-adapter pattern, fully-parity i18n, and an intact "no DB in workers" boundary. The core problem is not that it doesn't work; it's that **two migrations stalled mid-flight and the codebase now carries the weight of both worlds simultaneously**, with a third undocumented layer quietly holding the brain.

**The three things dragging the architecture down:**

1. **Stalled migrations everywhere.** Vue 2 → Vue 3 (Vuex-class-modules + Pinia + `vue-class-component` all live), v1 AI chat → v2 (both shipped, both wired into the shell), keytar → electron-store (keytar fully commented out, secrets now stored in plaintext). Each "both worlds" state doubles maintenance surface and confuses every new contributor.

2. **The `src/service/` layer (166 files) is the real business-logic brain but is undocumented in CLAUDE.md's "three-layer architecture."** The biggest, most important files — `AIChatQueryLoop` (73 KB), `StreamEventProcessor` (68 KB), `ToolExecutor` (57 KB) — live there, while the architecture guide talks only about IPC → Module → Model → Entity. The documented model and the reality have diverged.

3. **Testing is effectively unenforced.** 334 test files exist, but **CI runs zero of them** (it only packages), `yarn test` runs only 43 (Mocha), and there is **no coverage tooling at all** — the mandated 80% coverage gate is unmeasurable. The best-tested layer (IPC handlers, ~30 vitest files) is never run in CI.

**If you do only five things:** (1) store secrets with `safeStorage`/encrypted store; (2) add a `will-navigate` handler + sandbox the main window; (3) wire the vitest suite into CI with coverage; (4) finish the Pinia migration and delete Vuex/vue-class-component; (5) retire the v1 AI chat. Details in §9.

---

## 2. Codebase at a Glance

| Metric | Value |
|---|---|
| Source LOC (`.ts` + `.vue`) | **~257,000** |
| Source files | 1,112 (938 `.ts` + 174 `.vue`) |
| Indexed symbols (codegraph) | 23,020 nodes / 43,334 edges |
| `src/modules/` | 213 files (~50K LOC) |
| `src/service/` | **166 files** (undocumented in CLAUDE.md) |
| `src/model/` | 96 files (76 modern `*.model.ts` + 20 legacy `*db.ts`) |
| `src/entity/` | 80 entities |
| `src/views/` | 268 files |
| `src/childprocess/` | 36 files |
| IPC handler files | 40 (30 use Zod wrapper = 75%) |
| Test files | 334 — but **CI runs 0**, `yarn test` runs 43 |
| Vite configs at root | 16 (3 orphaned/dead) |
| `console.log` / `console.error` in `src/` | **~2,662 / ~1,320** (~4,000 total) |
| `as any` / `: any` in `src/` | 174 / 393 (~570) |

**Largest files (god objects):**

| Size | File | Note |
|---|---|---|
| 256 KB | `src/childprocess/YellowPagesScraper.ts` | Single worker file |
| 112 KB | `src/views/components/aiChat/AiChatBox.vue` | **3,690 lines** — god component |
| 87 KB | `src/api/aiChatApi.ts` | Wrong directory (`src/api/` vs `src/views/api/`) |
| 83 KB | `src/config/skillsRegistry.ts` | Giant config |
| 74 KB | `src/service/AIChatQueryLoop.ts` | Undocumented layer |
| 69 KB | `src/service/StreamEventProcessor.ts` | Undocumented layer |
| 1,795 lines | `src/modules/YellowPagesProcessManager.ts` | God module (32 methods) |
| 1,525 lines | `src/modules/RagSearchModule.ts` | God module |
| 740 lines | `src/modules/interface/IPlatformConfig.ts` | A 740-line *interface* file |

---

## 3. Architecture Strengths (What's Working Well)

**S1. The IPC validation wrapper is real and widely adopted.**
`src/main-process/communication/_shared/registerValidatedHandler.ts:18-44` centralizes Zod `safeParse` → fail-closed `{status:false,msg,data:null}` envelope, with `registerAiValidatedHandler` (`:56-95`) additionally gating on `AiFeatureGate` *before* parsing. **30 of 40 handler files use it.** This is the single best piece of cross-cutting infrastructure in the codebase.

**S2. `AiFeatureGate` is fail-closed and well-documented.**
`src/service/AiFeatureGate.ts` is the single source of truth for the `USER_AI_ENABLED` check; if the Token store is unreachable it returns `false` rather than silently enabling paid features. Both AI-chat handlers (v1 and v2) gate correctly.

**S3. The "no database access in workers" boundary is intact.**
Grep across all of `src/childprocess/` for `SqliteDb|BaseDb|getRepository|typeorm|app.getPath` returns **no real DB writes** (only DOM `.remove()` calls and method names that happen to match). Workers send results to main via IPC; main persists. This is the architecture's strongest property and it genuinely holds. Reference implementation: `ContactExtractionWorker` → `process.send({type:"extraction-progress"})` → zod-parse at `contactExtraction-ipc.ts:130` → `ContactInfoModule`.

**S4. The "no DB in IPC handlers" rule also holds.**
Zero `getRepository`/`new DataSource` references in `src/main-process/communication/`. Handlers delegate to Modules. The three-layer separation is respected at this boundary.

**S5. Hardened Electron renderer boundary (mostly).**
`contextIsolation: true` (`background.ts:378`), `nodeIntegration: false` (`:377`), child windows `sandbox: true` (`:485`), `event.sender` stripped on receive (`preload.ts:496-499`), per-method channel allowlists in the contextBridge (`preload.ts:381-926`), origin-aware `setWindowOpenHandler` (`background.ts:438-489`), and a strict production CSP (`script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'` at `:903-915`). The raw `ipcRenderer` object is **never** exposed wholesale.

**S6. Clean template-method platform-adapter pattern.**
`IBasePlatformAdapter` → `BasePlatformAdapter` → 16 concrete adapters (`YellowPagesComAdapter`, `YelpComAdapter`, …) is a working, real abstraction — not aspirational. The vector-DB stack (`IVectorDatabase` → `AbstractVectorDatabase` → `SqliteVecDatabase`) is similarly proper interface→abstract→concrete layering.

**S7. i18n is genuinely complete — the cleanest area of the codebase.**
All six language files (`en/zh/es/fr/de/ja.ts`) have exactly **47/47 top-level sections with zero key drift**. Byte-size differences (zh 92 KB vs ja 112 KB) are CJK translation-length artifacts, not missing keys. This is rare and commendable.

**S8. Disciplined route lazy-loading.**
`src/views/router/index.ts` uses dynamic `() => import(...)` for essentially every page; only the `Layout` shell is eager. Initial route bundle stays lean. `createWebHashHistory` is correct for Electron.

**S9. No circular imports in the core module graph.**
The suspected cluster (`EmailSearchTaskModule`, `TaskExecutorService`, `AIChatV2Module`, `SystemSettingModule`, `RagSearchModule`) forms a **DAG, not a cycle**. Dependency direction is one-way where it matters.

**S10. Bidirectional Zod validation at the worker boundary (for 2 reference workers).**
`ContactExtractionWorker` validates inbound (`contactExtractionWorkerInboundSchema().safeParse`) and main validates worker output (`contactExtractionWorkerOutboundSchema`), both using `z.discriminatedUnion`. The gold standard — it just needs adopting everywhere (see §4.3).

---

## 4. Pain Points & Anti-Patterns

### 4.1 The documented architecture is wrong: `src/service/` is an undocumented 4th layer

CLAUDE.md describes a **three-layer** data architecture: *IPC Handler → Module → Model → Entity → DB*. Reality is **four-plus layers**, and the most important one is hidden:

- `src/service/` holds **166 files** including the entire AI orchestration brain: `AIChatQueryLoop` (73 KB), `StreamEventProcessor` (68 KB), `ToolExecutor` (57 KB), `AIChatQueryEngine` (40 KB), `ChunkingService`, `VectorStoreService`, `SkillExecutor`, `AgentRuntime`, `MCPToolService`.
- CLAUDE.md mentions `src/service/` only twice and never describes its role, residents, or how it relates to `src/modules/`.
- IPC handlers import from **both** layers: 30 handler files import `@/modules`, 14 import `@/service`. There is no documented rule for when to put logic in `service` vs `module`.

**Why it matters:** New contributors (and the CLAUDE.md instructions given to AI agents) operate on a mental model that is missing the layer where the hardest code lives. Business logic placement is a coin flip.

**Concrete fix:**
1. Update CLAUDE.md's "Architecture Overview" to describe the real layering: *IPC Handler → Service (orchestration/AI) or Module (CRUD/domain) → Model → Entity → DB*. State the decision rule (e.g., "Services orchestrate multiple modules and own streaming/AI; Modules are single-domain CRUD + business rules").
2. Consider collapsing `service` and `modules` into one `src/domain/` with subfolders, **or** formally splitting: `modules` = data-access + domain logic, `service` = use-cases/orchestration. Pick one and document it.

---

### 4.2 Database layer — `synchronize: true`, two data-access systems, two drivers

**P1 — `synchronize: true` with zero migrations.** `src/config/SqliteDb.ts:520`. TypeORM auto-mutates the live schema from entity metadata on every boot. For a shipped desktop app holding **user data** (campaigns, scraped contacts, auth tokens), a single entity refactor can silently drop/recreate columns and destroy data. There are no migration files and no migration workflow.

*Fix:* Generate a baseline migration (`typeorm migration:generate` against current entities), set `synchronize: false` in production (keep `true` only behind a `NODE_ENV !== 'production'` gate for dev), and add a `yarn migrate` step to the app boot path. See §9 P1-b.

**P1 — Two parallel data-access systems in `src/model/`.** 76 modern `*.model.ts` files use TypeORM repositories (`this.getRepository()`); 20 legacy `*db.ts` files use **raw better-sqlite3 SQL** (`this.db.prepare("INSERT …")`) reaching through a *third* legacy class `Scraperdb.getdb()`. Some legacy files are still live — e.g. `accountCookiesdb` is used by `src/api/socialAccountApi.ts` and `src/controller/socialaccount-controller.ts`. Worse, `BaseDb` (`src/model/Basedb.ts`) declares `protected db: Database` but **never assigns it in the constructor** (the assignment is commented out at `:24`); each legacy subclass must wire `this.db = Scraperdb.getInstance(filepath).getdb()` itself. This is brittle and inconsistent.

*Fix:* Pick TypeORM repositories as the single data-access style. Migrate the 20 live `*db.ts` files to `.model.ts` equivalents (one per sprint), then delete `Scraperdb` and the raw-SQL path. Until then, at minimum assign `this.db` in `BaseDb` so the contract isn't subclass-dependent.

**P2 — Dual SQLite drivers.** `better-sqlite3` (^11.9.1) is the live driver (21 active imports across `src/model/*.ts`). `sqlite3` (^5.1.6) has **zero** active imports — every `sqlite3` import is commented out (`taskResultdb.ts:1`, `scraperdb.ts:1`, `taskrundb.ts:1`, `SqliteDb.ts:85`). Yet `sqlite3` is still rebuilt and packaged (`forge.config.js:137-143` `rebuildConfig.onlyModules` and `:64` asar `unpackDir`), CI runs `yarn add … sqlite3@latest` on macOS (`build.yml:301`), the `rebuild-sqlite3` script (`package.json:68`) is a no-op `console.log` stub, and both `@types/better-sqlite3` **and** `@types/sqlite3` are present (API-incompatible typings).

*Fix:* Remove `sqlite3`, `@types/sqlite3`, the `sqlite3` lines in `forge.config.js`, and the stub script. Single driver, single typing.

**P2 — `SqliteDb.getInstance(filepath)` is a path-keyed mutable singleton.** `SqliteDb.ts:608-640`: if the requested `filepath` differs from `currentDbPath`, it **fire-and-forgets** `oldInstance.connection.destroy()` and immediately constructs a new instance. Two near-simultaneous callers with different paths during init can thrash the connection — one wins, the other's connection is destroyed underneath it. Fine for a single-user desktop app in the common case, but a subtle correctness trap.

*Fix:* Make path immutable after first init (treat a path mismatch as a programmer error / throw), or guard the swap with a mutex so concurrent callers await the same transition.

**P2 — The documented `WORKER_TYPE` guard is mostly fiction.** CLAUDE.md states "Models enforce no database access from worker processes (check `process.env.WORKER_TYPE`)." In reality the guard exists in only **~4 models** (`Hook.model.ts`, `AIWorkspaceMemory.model.ts`, `AIWorkspaceMemoryConsolidationRun.model.ts`, `HookAudit.model.ts`) and is **not in `BaseDb` or `BaseModule`**. The real protection is that workers don't import models (S3), not that models refuse workers. Defense-in-depth is present in a handful of files, not systematic.

*Fix:* Either put the `WORKER_TYPE` check in `BaseDb`/`BaseModule` (centralized, real enforcement) or delete the claim from CLAUDE.md. Don't leave the documentation asserting an enforcement that doesn't exist.

**P2 — Under-indexing.** Only **40 of 78** entities declare `@Index`; relation counts are low (7 `@OneToMany`, 15 `@ManyToOne`, 1 `@ManyToMany`). For a data-heavy scraping app querying by foreign keys and status fields, this means full table scans at scale. (Counter-example: `ContactInfo.entity.ts` is clean — `@Index(['resultId'])`, proper column naming, nullable typing, JSON columns — use it as the template.)

---

### 4.3 Worker / child-process architecture — dead manager, restart loops, contract fragmentation

**P1 — `ChildProcessManager.ts` is dead code with latent bugs.** Zero importers (only `ChildProcessAdapterFactory.ts` is live, used by `YellowPagesScraper.ts:1255`). Yet it's the file most people would assume is "the" process manager, and it carries real defects if revived: it spawns via Node `spawn("node", [...])` (`:130-136`) instead of the `utilityProcess.fork` used by every other manager; it hardcodes one worker (`YellowPagesScraperProcess.js`); `killProcess` (`:310-313`) deletes from the process map **before** the child exits (orphan risk if SIGTERM is ignored); `waitForProcessReady` busy-polls; and `handleProcessExit` just `delete`s (results lost, no restart).

*Fix:* Delete `src/modules/ChildProcessManager.ts` and `src/modules/ChildProcessScraper.ts`. Document `YellowPagesProcessManager` + `ChildProcessAdapterFactory` as the canonical managers.

**P1 — Uncapped worker auto-restart loop.** `src/main-process/communication/contactExtraction-ipc.ts:114-123`: on non-zero exit, `setTimeout(() => spawnWorker(), 5000)` with **no `maxRestart` counter, no exponential backoff, no circuit breaker.** A worker that crashes on startup (bad env, missing dep) loops forever. `setupWorkerHandlers()` (`:166-170`) is a no-op — misleading dead code.

*Fix:* Add a bounded restart policy (e.g. max 5 restarts in 60s, exponential backoff, then mark task Failed and stop). Make `setupWorkerHandlers` real or delete it.

**P1 — Inconsistent fatal-error handling.** `ContactExtractionWorker.ts:69-80` installs `uncaughtException`/`unhandledRejection` handlers that **only `console.error`** — no `process.exit`, no notification to main, no rejection of in-flight jobs; the worker continues in a potentially-corrupt state. It also has **no `SIGTERM`/`SIGINT` handler** (its own comment at `:65` claims it does). Contrast with the gold standard: `LocalEmbeddingWorker.ts:198-208` and `SkillWorker.ts:174-184` both drain `activeRequestIds` and `process.exit(1)`.

*Fix:* Make `ContactExtractionWorker` mirror `LocalEmbeddingWorker`: drain in-flight requests, send a fatal-error message to main, then `exit(1)`; register `SIGTERM`/`SIGINT`.

**P1 — In-memory queue state lost on crash.** `ExtractionQueue.ts:14-19` stores `queue`/`active`/`processing`/`batchId` in process memory; `maxRetries=3` only covers per-job failures, not process death. Combined with the uncapped restart loop, each crash iteration can leak a batch. And `cleanupContactExtractionWorker()` (`contactExtraction-ipc.ts:557`) is **defined but never called** — zero callers, no `app.on('before-quit')` wiring.

*Fix:* Persist queue state to the DB (or re-queue protocol from main on worker boot), and wire `cleanupContactExtractionWorker` into `app.on('before-quit')`.

**P2 — Three competing message-contract layers + 2 transports.** Worker IPC is described in (at least) four places with different vocabularies: `interface/IPCMessage.ts` (`'START'|'STOP'`, `taskId:number`), `interface/IPCMessageProtocol.ts` (`MessageType` enum: `TASK_COMPLETED`), `interface/BackgroundProcessMessages.ts` (string literals + manual type guards, `'COMPLETED'`), and the clean `schemas/worker/*.ts` Zod layer — adopted by only **2 of ~15 workers**. Each worker re-declares its own message interfaces in **at least four casing conventions** (`START` vs `extract-contact` vs `EXECUTE_SKILL` vs `initialize`), and one (`utils/AIRecoveryBridge.ts:58`) uses `action:` instead of `type:`. Two transports coexist (`process.send` vs utilityProcess `parentPort`), delivering different shapes — which is why `utils/childProcessMessage.ts:35-99` needs a 3-format normalizer (`parseChildMessage`).

*Fix:* Collapse `IPCMessage.ts`/`IPCMessageProtocol.ts`/`BackgroundProcessMessages.ts` into one Zod `schemas/worker/*` source of truth. Migrate the remaining ~13 workers onto it. Standardize on one transport (`utilityProcess.fork` + `parentPort`) and one discriminator field (`type`).

**P2 — No global backpressure.** `concurrency-implementation.ts` bounds concurrency *within one puppeteer-cluster*; `ExtractionQueue` bounds to 3 *within one contact worker*; `emailSearchConcurrency.ts` is separate. But there is **no global semaphore** across managers. N concurrent scraping tasks → N utilityProcesses, each launching its own browser cluster. No admission control on total OS processes or Chrome instances. Each manager tracks only its own `activeProcesses` map. Also `browserManager.ts` is a pure factory with **no browser registry** — if a worker dies without running its SIGTERM handler, its Chrome is an orphan with no central handle to close.

*Fix:* Introduce a process/browser-budget registry (e.g. a `WorkerCoordinator` singleton) that all managers ask for a slot before spawning, and that tracks every launched `Browser` for forced cleanup.

---

### 4.4 Module layer — god modules, no DI, dead abstractions, factory tangle

**P1 — God modules.** `YellowPagesProcessManager.ts` (1,795 lines, 32 methods, singleton owning subprocess + IPC + error handling), `RagSearchModule.ts` (1,525), `SearchModule.ts` (1,235), `lib/function.ts` (1,226 — a catch-all util), `PlatformTestingFramework.ts` (1,006), `BackgroundScheduler.ts` (874), plus a 740-line *interface* file `interface/IPlatformConfig.ts`. Any of these is a "touch it and pray" file.

*Fix:* Extract cohesive responsibilities. `YellowPagesProcessManager` → split lifecycle / IPC / persistence / error-handling. `lib/function.ts` → break into `datetime.ts`, `strings.ts`, etc. Cap modules at ~400 lines (the project rule already says 800 max).

**P1 — No DI container; `new` everywhere → untestable.** No inversify/tsyringe. **100** `new XxxModule(...)` calls in `src/main-process/`, **57** in `src/modules/`. Worst offender: `TaskExecutorService.ts:46-54` hard-instantiates **7 collaborators** in its constructor (`SearchTaskModule`, `BuckEmailTaskModule`, `SearchModule`, `EmailSearchTaskModule`, `YellowPagesModule`, `GoogleMapsModule`, `YandexMapsModule`, `AiMessageTaskModule`). None can be substituted with fakes. Same in `YellowPagesOrchestrator.ts:47-54`, `buckEmailTaskModule.ts:68-72`, `AIChatV2Module.ts:36-38`. Compounding this, `BaseModule`'s constructor (`baseModule.ts:7-29`) runs `new Token()` → `SqliteDb.getInstance()` → `fs.mkdirSync` — so `new SomeModule()` in a test is **destructive** (touches the real DB singleton and filesystem).

*Fix:* Introduce lightweight constructor injection (even a hand-rolled registry) for the ~7 hub modules. Make `BaseModule` lazy: don't touch the DB/filesystem until `ensureConnection()` is called. This alone makes the orchestrators unit-testable.

**P2 — `CustomError` is dead; three error strategies coexist.** `src/modules/customError.ts` is used **0 times** in `src/modules/` (survives only in 2–3 `childprocess`/`controller` files, some commented). Meanwhile there are **463 `throw new Error(...)`** in `src/modules/`, plus modules that return raw data, return `null`, or return `{status,…}`. A module's caller cannot predict whether it throws, returns null, or returns data without reading the source. The `{status,data,msg}` envelope is applied only at the IPC boundary.

*Fix:* Either re-adopt `CustomError` + an envelope with a lint rule forbidding raw `throw new Error`/bare returns in modules, **or** delete `customError.ts` to stop misleading readers. Pick one error contract and enforce it.

**P2 — Platform-adapter system is a 5-factory tangle.** Five coexisting factory/registry systems:
- `PlatformRegistry.ts` — real, production + tests.
- `platforms/PlatformAdapterFactory.ts` — static `switch` over class names; **canonical production path** via `ChildProcessAdapterFactory`.
- `ChildProcessAdapterFactory.ts` — thin wrapper, production.
- `PlatformAdapterFactory.ts` (top-level) — dynamic `import()`; **tests only**.
- `PlatformFactory.ts` — referenced only in a doc comment.
- `UnifiedPlatformFactory.ts` — has its *own private* `ConfigurationPlatformAdapter` (duplicating the real file); **tests only**.

Additionally `platforms/PlatformAdapterFactory.ts:100-143` hand-maintains the same 15-element adapter list **three times** (`isAdapterAvailable`, `getAvailableAdapters`, the `createAdapter` switch). Adding a platform means editing all three plus `index.ts`.

*Fix:* Delete `PlatformFactory.ts`, `UnifiedPlatformFactory.ts`, and the top-level `PlatformAdapterFactory.ts`. Keep `PlatformRegistry` + `platforms/PlatformAdapterFactory` + `ChildProcessAdapterFactory`. Collapse the three lists into one registry map.

**P2 — Half the `interface/` dir is aspirational.** ~7 of 29 interfaces have zero implementations/consumers: `IScraperEngine`, `IProxyApi`, `IProgressReporter`, `IDataExtractor`, `IFactory`, and the 129-byte stubs `EmbeddingImpl.ts`/`LlmImpl.ts`/`TraditionalTranslateImpl.ts`. `FaissVectorDatabase` is commented out (`adapters/FaissVectorDatabase.ts:25`), so the "pluggable vector DB" abstraction currently has **exactly one implementation**. These create the illusion of a layered architecture that doesn't exist.

*Fix:* Prune the dead interfaces, or back them with real implementations. Don't keep abstractions with a single commented-out implementation.

---

### 4.5 Frontend — stalled Pinia migration, god components, mixed API layer

**P1 — State management is fragmented and mid-migration with no winner.** Four state libs declared, three paradigms live:

| Library | Importers in `src/views` | Backs |
|---|---|---|
| `vuex-module-decorators` | 5 (`store/modules/{app,user,settings,permission,error-log}.ts`) | **Canonical, load-bearing**: auth/token, permissions, settings |
| `vuex` | 1 (`store/index.ts`) | Empty `Vuex.Store({})` root |
| `pinia` | 1 (`store/appMain.ts`) | Only `theme` + `isMobile` (~50 lines) |
| `vue-class-component` | 1 (`HomeView.vue`) | Dead — not routed |

Both are registered simultaneously (`main.ts:83-88`). The Vuex **class modules** are the load-bearing stores (`UserModule` holds the auth token, `:58-160`); Pinia was added and one slice ported, then the port stopped. `vue-class-component@^8.0.0-0` is a **pre-release line** and `vuex-module-decorators` is essentially unmaintained.

*Fix:* Finish the Pinia migration — port `user`/`permission`/`settings`/`error-log` modules to setup-style Pinia stores — then drop `vuex` + `vuex-module-decorators` + `vue-class-component` + `vue-template-compiler` (a Vue 2 tool coexisting with `vue@3`) in one sweep. Delete the unrouted `HomeView.vue`.

**P1 — God components.** 15 components exceed 600 lines. `AiChatBox.vue` is **3,690 lines** (~20 `ref()`/`reactive()` in one file — template + streaming + tool-call rendering + state all at once). `AiChatV2.vue` (2,106), `yellowpages/create.vue` (1,636), `SearchDetailTable.vue` (1,630), `drag-resizeble/drag-resizeble.vue` (1,328). Because `AiChatBox`/`AiChatV2` are pulled by `layout.vue` (always-loaded shell), at least one multi-thousand-line component ships on startup. The `aiChatV2/` decomposition into ~20 focused files proves the team can split — they just haven't retired v1.

*Fix:* Finish retiring v1 AI chat (delete `AiChatBox.vue` + `ai-chat-ipc.ts` once v2 parity is confirmed). Split the remaining god components by responsibility (table logic vs. template vs. state). Enforce a ~400-line component cap via lint.

**P2 — API layer is mixed despite a canonical wrapper.** `windowInvoke` (`src/views/utils/apirequest.ts`) is canonical (44 files), but **9 files call `window.api.invoke(...)` directly**, bypassing envelope handling — including *inconsistently within one file* (`api/users.ts`: `login` uses raw invoke, `Signout`/`GetloginUserInfo` use the wrapper). `api/hooks.ts:64-76` reinvents its **own** `invoke<T>()` with a *different* envelope contract — two competing abstractions. **4 files import `ipcRenderer` directly** (`api/users.ts`, `api/hooks.ts`, `api/sessionRecording.ts`, `pages/socialtask/socialtaskrun.vue`), reaching past the preload bridge and partially negating `contextIsolation`. There are also **two API directories** (`src/api/` 10 files incl. the 87 KB `aiChatApi.ts`, and `src/views/api/` 45 files).

*Fix:* Route all IPC through `windowInvoke`; delete the `api/hooks.ts` wrapper or merge its contract; forbid direct `ipcRenderer` imports in the renderer via lint/eslint. Consolidate to one `src/views/api/` directory.

**P2 — `any` proliferation (~120 in views) + duplicate types.** `: any` ×58 in `.vue` + ×44 in `.ts`; concentrated in data-heavy pages (`yellowpages/list.vue` 10, `TaskDetailsView.vue` 8). `Iresponse` is declared twice (`api/types.d.ts:28` exported, `utils/apirequest.ts:1` local) — drift-prone. The IPC contract is effectively untyped at the edges.

*Fix:* Derive renderer types from the Zod schemas in `src/schemas/ipc/*` via `z.infer`. Delete the duplicate `Iresponse`.

**P2 — Ad-hoc error/loading; no shared composable.** Zero `useSnack`/`useToast`/`useNotif`. Each page reinvents error UI (`search/index.vue` bespoke `alert`/`v-dialog`; `yellowpages/create.vue` inline `v-alert`; `proxy/proxy.vue` has **no try/catch at all**). `loading` flags are hand-rolled per page.

*Fix:* Add a `useApiCall` / `useSnackbar` composable that wraps `windowInvoke` + try/catch + loading ref + toast, and adopt it across pages.

**P3 — Dead frontend code.** Typo directory `src/views/componets/` (orphaned), typo `components/drag-resizeble/` (should be `drag-resizable`), the unrouted `HomeView.vue`, the empty `asyncRoutes = []` (`router/index.ts:986`) yet `PermissionModule.GenerateRoutes(roles)` is still called (`store/modules/user.ts:74-78,138-142`) — role-based route generation that produces nothing. Three overlapping AI-chat API files (`api/aiChat.ts`, `api/aiChatV2.ts`, `api/aiChatWithRAG.ts`).

*Fix:* Delete the typo dirs, `HomeView.vue`, and the dead dynamic-routing machinery; consolidate the three AI-chat API files post-v1-retirement.

---

### 4.6 Cross-cutting — logging, types, dead code

**P1 — `console.log` epidemic.** **~2,662 `console.log` + ~1,320 `console.error`** across `src/` (~4,000 statements); `Logger.ts` (a capable 12 KB winston-based class) is imported by only **26 files**. In `src/modules/` alone: 757 `console.log` / 585 `console.error` / 89 `console.warn`. This directly violates the project's own rule (`rules/typescript/coding-style.md`: "No `console.log` statements in production code"). Worse, the **preload logs every IPC payload** (`preload.ts:426-428, 435, 437` — `console.log("send", channel, data)`) in all environments, leaking potentially sensitive search/account/AI data to the renderer devtools console.

*Fix:* Replace `console.*` with `Logger` via a codemod; strip the preload payload logging (or gate it behind `isDevelopment`). Add an eslint rule (`no-console`) with `Logger` as the allowed escape hatch.

**P2 — `any` usage (~570) despite the "NEVER use `any`" rule.** 174 `as any` + 393 `: any`. (One bright spot: `catch (e: unknown)` is used 73 times vs `catch (e: any)` **0 times** — the catch-clause rule is genuinely followed.) `tsconfig.json` says `"strict": true` but silently weakens it: `noImplicitAny: false`, `strictPropertyInitialization: false`, `noImplicitThis: false`. So "strict" is half-strict and `any` leaks without complaint.

*Fix:* Flip `noImplicitAny`/`strictPropertyInitialization`/`noImplicitThis` to `true` and fix the resulting errors incrementally per-directory. Note: tsconfig also aliases `electron-store` to a `test/mocks/*` path (`tsconfig.json:34-48`), which means production type-checking resolves it to the mock — masking real API drift. Un-mock it for non-test compiles.

**P2 — Abandoned `SqliteVecDatabase.ts` is ~40% dead code.** `src/modules/adapters/SqliteVecDatabase.ts`: `saveIndex`, `optimizeIndex`, `restoreIndex`, `cleanup`, and `createDataSource` are **entirely commented-out stubs**. It reaches into TypeORM internals via `driver as any` (×4, at `:339, 677, 772, 802`) — fragile across TypeORM version bumps. It interpolates a table name into SQL (`DELETE FROM ${this.currentVirtualTableName}` `:396`, `SELECT … FROM ${this.currentVirtualTableName}` `:686`) — currently safe because the name is internally generated, but a pattern smell. And it `console.log`s throughout instead of using `Logger`.

*Fix:* Delete the commented-out blocks. Introduce an allowlisted-identifier helper for dynamic table names (validate against `^[a-zA-Z_][a-zA-Z0-9_]*$`). Replace `driver as any` with a typed TypeORM `BetterSqlite3Driver` access. Switch to `Logger`.

---

## 5. Scalability Concerns

**How well does this scale past ~500 files? It's already straining at ~1,112.**

1. **The module/service boundary will collapse without a rule.** With `src/modules` (213) + `src/service` (166) = ~379 business-logic files and no documented decision rule, every new feature's placement is a judgment call that drifts. At 2× scale this becomes un-navigable. **Decision rule + documentation is the highest-leverage scalability fix.**

2. **God files are merge-conflict magnets and compile-time sinks.** `YellowPagesScraper.ts` (256 KB), `AiChatBox.vue` (3,690 lines), `skillsRegistry.ts` (83 KB), `AIChatQueryLoop.ts` (73 KB). More developers → more simultaneous edits → more conflicts. HMR/type-check on these is already painful. Caps + decomposition are essential before headcount grows.

3. **Untestable hubs block safe change.** `TaskExecutorService`, `YellowPagesOrchestrator`, `YellowPagesProcessManager`, `RagSearchModule` are un-unit-testable (hard-`new` collaborators + `BaseModule` filesystem side effects) and also the highest-churn files. This is the classic "scary core" that slows every feature. DI + lazy `BaseModule` (§4.4) is the unlock.

4. **Worker fan-out has no ceiling.** No global process/browser budget means scale = N tasks × M browsers per task. On a user's desktop this becomes memory pressure and zombie Chrome. A `WorkerCoordinator` (§4.3) is needed before multi-task concurrency is a headline feature.

5. **`synchronize: true` doesn't scale to schema evolution.** Every entity change risks data loss with no migration trail. As entities grow past 80, this becomes existential for user-data integrity.

6. **Contract fragmentation compounds.** 4 worker-message contracts, 5 platform factories, 3 AI-chat systems, 2 state stores, 2 API dirs, 2 SQLite drivers. Each duplicated concept is a place where two implementations silently diverge. Consolidation is cheaper now than at 2× scale.

7. **CI doesn't run tests.** Scaling contributors without a CI test gate means regressions land silently. This must precede any team growth.

---

## 6. Security Review

### What's solid
- `contextIsolation: true`, `nodeIntegration: false` on main + child windows (`background.ts:377-378, 484`).
- Child windows `sandbox: true` (`background.ts:485`).
- contextBridge exposes **named methods only**, each with a per-method channel allowlist; `event.sender` stripped on receive (`preload.ts:381-926, 496-499`). Raw `ipcRenderer` is never exposed.
- Strict production CSP: `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'` (`background.ts:903-915`).
- Origin-aware `setWindowOpenHandler`; external links go to `shell.openExternal` only for `http:`/`https:` (`background.ts:438-489`).
- Path-traversal guards on file/plugin handlers (`ai-chat-ipc.ts:1342-1350`, `plugin-ipc.ts:156-158, 247-249`); CRLF rejection on spawn-bound plugin fields (`plugin-ipc.ts:203-217`).
- MCP stdio trust requires trusted origin **+** a native `dialog.showMessageBox` gesture (`mcp-tool-ipc.ts:141-180`).
- AI file-open uses argv passing + AppleScript `quoted form of`, not string interpolation (`ai-chat-ipc.ts:1305-1335`).
- Secrets are not committed (`.env` gitignored, CI materializes from GitHub Secrets).

### Gaps (priority order)

**P0 — Secrets stored in plaintext on disk.** `keytar` (OS keychain) is fully commented out (`token.ts:3,14,47,52`, `electronstoreservice.ts:1-2`). Tokens/cookies now go to `electron-store@8.2.0` constructed with **no `encryptionKey`** (`electronstoreservice.ts:54`), and Electron `safeStorage` is not used either. Auth tokens/cookies sit as cleartext JSON under `userData`, readable by any process/backup. This is a regression from the keychain approach.
*Fix:* Use Electron `safeStorage.encryptString()` before writing to `electron-store` (or pass an `encryptionKey`), and document that macOS uses the Keychain via `safeStorage` under the hood. This is the single highest-priority security fix.

**P0 — No `will-navigate` handler; main window not sandboxed.** Grep across `src/` finds only `setWindowOpenHandler` — there is **no `webContents.on('will-navigate', …)`**. The main window can be navigated to an arbitrary external URL via `window.location.href`/redirects/link clicks, and because the main window's `webPreferences` omit `sandbox: true` (`background.ts:369-380`), the privileged `preload.js` is re-injected into that external origin with full Node access, exposing `window.api` to attacker-controlled content. This is a real navigation-bypass → privilege-leak path.
*Fix:* Add `mainWindow.webContents.on('will-navigate', (e, url) => { if (!isTrustedOrigin(url)) e.preventDefault(); })` near `background.ts:438`, and set `sandbox: true` on the main window (or document why it must stay off and add compensating controls).

**P1 — `exec` with string interpolation for process kill.** `SearchController.ts:792-793, 825`: `exec(isWindows ? \`taskkill /PID ${pid} /F\` : \`kill -9 ${pid}\`, …)`. `pid` comes from the renderer. The Zod schema (`schemas/ipc/search.ts:70`: `z.number().int().positive()`) currently blocks shell metacharacters, so it's **not exploitable today** — but it's the canonical command-injection pattern, and a future schema relaxation would silently open the sink.
*Fix:* Replace with `execFile`/`spawn` and an args array (`['kill', '-9', String(pid)]`).

**P1 — ~24% of IPC handlers bypass Zod validation.** 10 handler files use raw `ipcMain.handle` with ad-hoc `typeof`/`JSON.parse`/`as` assertions. Worst: `ai-chat-v2-ipc.ts` (17 raw `ipcMain.handle` calls with scattered `typeof req.conversationId !== "string"` checks and `JSON.parse(data ?? "{}")`), and `contactExtraction-ipc.ts:372,453,480` (`JSON.parse(request)` then `as ContactExtractionRequest`). The strong `registerValidatedHandler` pattern exists but has **no enforcement** that new handlers use it.
*Fix:* Migrate the 10 raw handlers (prioritize `ai-chat-v2-ipc.ts`); add a lint/review rule that new handlers must use `registerValidatedHandler`.

**P2 — Worker auth token passed via env.** `contactExtraction-ipc.ts:94-102` passes `WORKER_AUTH_TOKEN` to a spawned Node worker via `env`. If that worker ever executes attacker-influenced code (malicious plugin/skill), the token is readable via `process.env`. Confirm workers only run trusted bundled code, or move to an explicit message-based handshake.

**P2 — `console.log` of IPC payloads in preload** (see §4.6) leaks sensitive data to devtools.

**P2 — `.gitignore` doesn't cover `.env.test`/`.env.production`** (only `.env` + `.env.development`). Nothing is leaked yet (only `.env.example` tracked), but it's one careless `git add` away. Broaden to `.env*` with `!.env.example`.

**P2 — Direct `ipcRenderer` imports in 4 renderer files** (`api/users.ts`, `api/hooks.ts`, `api/sessionRecording.ts`, `pages/socialtask/socialtaskrun.vue`) weaken the preload-bridge isolation model.

---

## 7. Build, Dependency & Test Hygiene

**P0 — CI runs zero tests; no coverage tooling.** `.github/workflows/build.yml` only packages (`yarn make-win:test`/`make-mac:test`). The 287 vitest files — including all `test/vitest/main/ipc/*.test.ts` (the only real IPC-handler coverage) — are **never run in CI**. `yarn test` runs only the 43 Mocha tests. There is no `c8`/`istanbul`/`@vitest/coverage-v8` dependency or `coverage` config anywhere. The mandated 80% coverage gate is **unmeasurable**, let alone enforced.
*Fix:* Add `@vitest/coverage-v8`, configure `test.coverage` in the vitest configs, and wire `yarn test` (or a new `yarn ci:test`) into `build.yml` to run the full vitest + mocha suites with a coverage gate.

**P1 — Bogus `crypto` npm package (supply-chain cruft).** `package.json:103` `"crypto": "^1.0.1"`. The installed `node_modules/crypto` ships **no `index.js`** (only `package.json` + `README.md`); all 17 `from "crypto"` imports in `src/` resolve to the Node builtin. Pure dead weight in the installer and a classic audit red flag.
*Fix:* Remove `"crypto"` from `dependencies`.

**P1 — Zod v4 mandate followed 0%.** CLAUDE.md mandates `import { z } from "zod/v4"`. Reality: `from "zod/v4"` → **0 hits**, `from "zod"` → **58 hits**. And `^3.24.0` doesn't even guarantee the `./v4` subpath resolves (it needs 3.25+; the lockfile resolves to 3.25.76). The codebase is silently on Zod v3 semantics despite a "MANDATORY RULE."
*Fix:* Either pin `zod` to `^3.25.0` and migrate imports to `zod/v4`, or drop the `zod/v4` mandate and keep `from "zod"`. Don't leave the rule and the code in contradiction.

**P2 — Dead/orphan build configs.** 16 `vite.*.config.mjs` files (one per Forge entry — inherent to Forge's model). Three are dead: `vite.worker.config.mjs` (0 references), `vite.buckEmail.config.mjs` (forge entry commented at `forge.config.js:419-422`), `vite.utilityCode.config.mjs` (test-only). Four stray `*.timestamp-*.mjs` files are accidentally committed (`.gitignore` only covers `main` and `utilityCode` timestamp patterns, not `buckEmail`/`taskCode`).
*Fix:* Delete `vite.worker.config.mjs`; decide on `buckEmail`; replace the two narrow `.gitignore` timestamp lines with `vite.*.config.mjs.timestamp-*.mjs`.

**P2 — Legacy dependency bloat.** `vue-class-component` (1 dead user), `vuex` + `vuex-module-decorators` (superseded by Pinia), `vue-template-compiler@^2.7.14` (Vue 2 tool with Vue 3), `keytar` (fully commented out) — all removable after the migrations in §4.5 finish.

**P3 — tsconfig half-strict + aliased mock** (see §4.6). `electron-store` aliased to `test/mocks/*` in the production tsconfig path masks real API drift.

---

## 8. Testing Reality vs. the 80% Mandate

- **334 test files exist** — but they're narrowly distributed: `test/modules/` 43 (Mocha), `test/vitest/` 287, `test/rag`/`service`/`utils` 4.
- **The IPC layer is the best-tested** (~30 `test/vitest/main/ipc/*.test.ts` + `contactExtractionWorkerIpc.test.ts`) — but **never run in CI**.
- **The heaviest, riskiest code is barely tested**: the 200+ KB of Puppeteer scrapers (`YellowPagesScraper.ts`, `googleScraper.ts`, `searchScraper.ts`, `bingScraper.ts`) have essentially no behavioral tests — only ad-hoc `vitest-*` npm scripts. `src/service/` orchestration (`AIChatQueryLoop`, `ToolExecutor`, `StreamEventProcessor`) is largely uncovered.
- **No coverage measurement** exists, so "80%" is aspirational.
- The TypeScript type-check gate in vitest (`test/vitest/_typecheck/globalSetup.ts` running `tsc --noEmit`) is a real strength — but its value is undermined by `tsconfig`'s half-strict settings (§4.6).

*Strategic fix:* Before chasing coverage %, (1) wire the existing vitest suite into CI (free win — the tests already exist), (2) add coverage tooling to make the number measurable, (3) prioritize tests for the untestable hubs (§4.4) *after* making them testable via DI.

---

## 9. Prioritized Roadmap

### P0 — Do now (security / data-integrity / free wins)
1. **Encrypt secrets at rest** — `safeStorage.encryptString()` before `electron-store.set`, or pass `encryptionKey`. (`electronstoreservice.ts:54`, `token.ts`)
2. **Add `will-navigate` guard + sandbox the main window** — prevents navigation-bypass → preload privilege leak. (`background.ts` near `:438`, `:369-380`)
3. **Wire vitest into CI** — the 287 tests already exist; CI runs 0 today. (`.github/workflows/build.yml`)
4. **Remove bogus `crypto` dependency** — `package.json:103`.
5. **Remove `sqlite3` driver + types + rebuild/packaging lines** — zero active imports.

### P1 — Do this quarter (reliability / maintainability)
6. **Migrate off `synchronize: true`** — baseline migration, gate `synchronize` to dev only.
7. **Bound the worker restart loop** + make `ContactExtractionWorker` exit on fatal + wire `cleanupContactExtractionWorker` to `before-quit`. (`contactExtraction-ipc.ts:114-123`, `ContactExtractionWorker.ts:69-80`)
8. **Delete dead `ChildProcessManager.ts`/`ChildProcessScraper.ts`**; document the canonical managers.
9. **Finish the Pinia migration**; drop `vuex`/`vuex-module-decorators`/`vue-class-component`.
10. **Retire v1 AI chat** (delete `AiChatBox.vue`, `ai-chat-ipc.ts`, `api/aiChat.ts`) once v2 parity is confirmed.
11. **Migrate the 10 raw IPC handlers onto `registerValidatedHandler`** (prioritize `ai-chat-v2-ipc.ts`).
12. **Replace `exec` interpolation in `SearchController.killProcessByPID`** with `execFile`/argv.
13. **Reconcile Zod** — pin `^3.25.0` + migrate to `zod/v4`, or drop the mandate.
14. **Document the `src/service/` layer** in CLAUDE.md with a service-vs-module decision rule.
15. **Add `@vitest/coverage-v8`** + a coverage gate; add the IPC suite to the default `yarn test`.

### P2 — Do when touching the area (hygiene / consolidation)
16. **Collapse the 5 platform factories** to the canonical 3; dedupe the 15-element adapter list.
17. **Consolidate worker message contracts** to one `schemas/worker/*` Zod source; standardize transport + `type` discriminator.
18. **Introduce a global `WorkerCoordinator`** for process/browser budget + forced cleanup.
19. **Introduce constructor injection** for the ~7 hub modules; make `BaseModule` lazy (no DB/fs in constructor).
20. **Migrate the 20 legacy `*db.ts`** raw-SQL models to TypeORM repositories; delete `Scraperdb`.
21. **`console.log` → `Logger` codemod**; strip preload payload logging; add `no-console` eslint rule.
22. **Flip `noImplicitAny`/`strictPropertyInitialization`/`noImplicitThis` to true** per-directory.
23. **Clean `SqliteVecDatabase.ts`** (delete dead blocks, fix `as any`, typed driver access).
24. **Split god modules/components** under ~400-line caps; extract `lib/function.ts` into focused utils.
25. **Consolidate `src/api/` into `src/views/api/`**; route all IPC through `windowInvoke`; add a `useApiCall` composable.
26. **Prune dead interfaces** in `src/modules/interface/`; delete `customError.ts` or re-adopt it with enforcement.

### P3 — Nice to have
27. Delete orphan configs, typo dirs, `HomeView.vue`, dead `asyncRoutes` machinery.
28. Broaden `.gitignore` (`.env*`, timestamp files).
29. Add DB indices to the ~38 under-indexed entities (profile first).

---

## Appendix: Evidence Index (key files)

| Concern | File(s) |
|---|---|
| IPC validation | `src/main-process/communication/_shared/registerValidatedHandler.ts` |
| AI gate | `src/service/AiFeatureGate.ts` |
| Renderer security | `src/background.ts:369-489, 903-915`; `src/preload.ts:381-926` |
| Plaintext secrets | `src/modules/electronstoreservice.ts:54`; `src/modules/token.ts` |
| DB singleton / synchronize | `src/config/SqliteDb.ts:520, 608-640` |
| Model split | `src/model/Basedb.ts`; `src/model/accountCookiesdb.ts`; `src/model/*.model.ts` |
| Vector dead code | `src/modules/adapters/SqliteVecDatabase.ts` |
| Dead process manager | `src/modules/ChildProcessManager.ts` |
| Worker restart loop | `src/main-process/communication/contactExtraction-ipc.ts:114-123` |
| Worker contracts | `src/modules/interface/{IPCMessage,IPCMessageProtocol,BackgroundProcessMessages}.ts`; `src/schemas/worker/*` |
| God modules | `src/modules/{YellowPagesProcessManager,RagSearchModule,SearchModule,TaskExecutorService}.ts` |
| Hub hard-`new` | `src/modules/TaskExecutorService.ts:46-54` |
| Platform factory tangle | `src/modules/{PlatformRegistry,PlatformFactory,UnifiedPlatformFactory,PlatformAdapterFactory,ChildProcessAdapterFactory}.ts` |
| State fragmentation | `src/views/store/modules/*.ts`; `src/views/store/appMain.ts`; `src/views/main.ts:83-88` |
| God components | `src/views/components/aiChat/AiChatBox.vue`; `src/views/components/aiChatV2/AiChatV2.vue` |
| Stalled migrations | `package.json:103,110,129,143,161,169,174-175,182,273`; `forge.config.js:137-143` |
| CI gap | `.github/workflows/build.yml` |
| Half-strict tsconfig | `tsconfig.json:4-9, 34-48` |
