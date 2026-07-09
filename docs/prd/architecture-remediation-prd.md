# Architecture Remediation Program - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-07-10
- **Owner**: AiFetchly Desktop Engineering
- **Related docs**:
  - `docs/architecture-optimization-review.md` — the evidence base and root-cause analysis for every item in this PRD
  - `CLAUDE.md` — documented architecture (three-layer) that this program reconciles with reality
  - `docs/prd/plugin-marketplace-support-prd.md` — reference PRD format
  - `docs/sqlite-vec-migration-spec.md`, `docs/rag-migration-guide.md` — prior migration precedents

---

## 1. Executive Summary

The architecture review (`docs/architecture-optimization-review.md`) found aiFetchly to be **large, mature, and functional**, with several excellent seams (Zod-validated IPC wrapper, fail-closed AI gate, intact no-DB-in-workers boundary, fully-parity i18n, real platform-adapter pattern). It also found the codebase carrying the weight of **three stalled migrations** (Vue 2→3, v1→v2 AI chat, keytar→electron-store), an **undocumented `src/service/` layer** holding the AI brain, a **testing program that CI never runs**, and a handful of **security gaps** at the Electron boundary.

This PRD defines a **remediation program**, not a single feature. It is organized into **nine independently-shippable workstreams (WS-0 … WS-8)** sequenced by risk: security and data-integrity first, then the testing/CI foundation that makes every later change safe, then reliability, then the larger consolidation and migration work. Each workstream has explicit acceptance criteria, a file map, effort estimate, risk, and rollback plan.

**Guiding principles:**

1. **Data safety first.** No schema or storage change ships without a migration path and a backup story.
2. **Test gate before refactor.** The CI test gate (WS-2) is a prerequisite for the riskier refactors (WS-4, WS-5, WS-6). We do not refactor what we cannot verify.
3. **Incremental, ship-safe, no big-bang.** Every workstream is independently deliverable and independently revertible. No "freeze the codebase" milestone.
4. **Delete over maintain.** Stalled dual systems are retired, not just documented. Dead code is removed, not commented.
5. **Document the real architecture.** CLAUDE.md is reconciled with the actual layering as part of the program, not after.

**Recommended first release (MVP of this program):** WS-0 (supply-chain quick wins) + WS-1 (security hardening) + WS-2 (CI test gate). These three are low-risk, high-value, and unblock everything else.

---

## 2. Background

### 2.1 Current State (as measured)

| Dimension | Finding |
|---|---|
| Size | ~257K LOC, 1,112 source files (938 `.ts` + 174 `.vue`), 1,632 indexed files |
| Layering reality | Four-plus layers, not three: IPC → `src/service/` (166 files, undocumented) **or** `src/modules/` (213) → `src/model/` → `src/entity/` → DB |
| IPC validation | 30/40 handlers use `registerValidatedHandler` (75%); 10 bypass Zod |
| Worker boundary | No DB-access violations in workers (intact) |
| DB | `synchronize: true`, zero migrations, two data-access systems (76 TypeORM `.model.ts` + 20 raw-SQL `*db.ts`), two SQLite drivers (one dead) |
| Testing | 334 test files exist; **CI runs 0**; `yarn test` runs 43 (Mocha only); **no coverage tooling** |
| Security | `contextIsolation`/CSP/allowlists solid; but secrets in plaintext `electron-store`, no `will-navigate` guard, main window unsandboxed |
| Migrations in flight | Vuex+class-modules **and** Pinia both live; v1 **and** v2 AI chat both shipped; keytar commented out, secrets in plaintext |

### 2.2 How We Got Here

The codebase grew feature-first across multiple major framework transitions (Vue 2 → Vue 3, TypeORM adoption, Electron 35, sqlite-vec integration, AI/skills/plugins). Each transition was started but not completed because new features took priority. The result is a working app that carries every intermediate state simultaneously. This program completes the transitions and removes the intermediate states, rather than adding more.

---

## 3. Problem Statement

The review identified problems grouped into six themes. Each maps to one or more workstreams below.

1. **Security gaps at the trust boundary** — plaintext secret storage, missing navigation guard, unsandboxed main window, unvalidated IPC handlers, payload logging in preload. *(→ WS-1)*
2. **No enforced test gate** — tests exist but CI never runs them; coverage is unmeasurable. *(→ WS-2)*
3. **Data-integrity risk** — `synchronize: true` with no migrations; dual data-access systems; path-keyed mutable singleton. *(→ WS-3)*
4. **Worker reliability gaps** — dead process manager, uncapped restart loop, crash-lost queues, fragmented message contracts, no global backpressure. *(→ WS-4)*
5. **Module/frontend debt** — god modules/components, no DI (untestable hubs), stalled Pinia migration, v1/v2 duplication, factory sprawl. *(→ WS-5, WS-6)*
6. **Discipline drift** — ~4,000 `console.*` calls, ~570 `any` usages, half-strict tsconfig, dead abstractions. *(→ WS-7)*

---

## 4. Goals

1. Eliminate every P0 security and data-integrity gap identified in the review.
2. Make the full test suite run in CI with measurable coverage, so every subsequent change is verifiable.
3. Complete the three stalled migrations (Pinia, v2 AI chat, secret storage) and remove the superseded systems.
4. Reconcile the documented architecture (CLAUDE.md) with the real `src/service/` layer and codify the placement rules.
5. Make the hub modules (`TaskExecutorService`, `YellowPagesOrchestrator`, `YellowPagesProcessManager`, `RagSearchModule`) unit-testable.
6. Reduce worker crash blast radius (bounded restarts, persisted queues, single message contract).
7. Establish lint/type gates that prevent the drift from recurring (`no-console`, `no-explicit-any`, strict tsconfig, Zod-mandate enforcement).

## 5. Non-Goals

This program will **not**:

- Rewrite the application or change the tech stack (Electron + Vue 3 + TypeORM + SQLite stays).
- Replace SQLite with a different database.
- Replace Puppeteer or the scraping engine.
- Add new product features. (Feature PRDs remain separate; this program may sequence behind/around them.)
- Achieve 100% test coverage. The target is a **measurable** gate (80% on changed/touched code), not blanket coverage of legacy scrapers.
- Refactor every large file. Only the highest-risk god files are in scope; others are capped via lint going forward.
- Change the i18n key structure (it is already fully parity across 6 languages — a strength to preserve).

## 6. Target Users (of this program)

- **6.1 Future contributors** — need a predictable layering rule, a green CI, and testable modules to contribute safely.
- **6.2 End users** — indirectly benefit from no silent data loss, no plaintext-token exposure, and fewer crash/hang bugs.
- **6.3 Reviewers/security** — need the Electron boundary hardened to pass external audit.
- **6.4 The codebase itself** — needs the weight of three stalled migrations removed to keep build/HMR times manageable.

---

## 7. Workstream Overview & Sequencing

Workstreams are independently shippable. Dependencies are noted; otherwise order is by risk/value.

| WS | Title | Priority | Effort | Depends On | Shippable Independently |
|---|---|---|---|---|---|
| WS-0 | Supply-chain & repo hygiene quick wins | P0 | S | — | ✅ |
| WS-1 | Security hardening (IPC + Electron boundary) | P0 | M | — | ✅ |
| WS-2 | CI test gate & coverage foundation | P0 | M | — | ✅ |
| WS-3 | Database integrity (migrations, model consolidation) | P1 | L | WS-2 | ✅ |
| WS-4 | Worker reliability & contract unification | P1 | L | WS-2 | ✅ |
| WS-5 | Module-layer health (DI, error contract, factory consolidation) | P1 | L | WS-2, WS-5 partially WS-4 | ✅ |
| WS-6 | Frontend migration completion (Pinia, v2 chat, god components) | P1/P2 | L | WS-2 | ✅ |
| WS-7 | Type & logging discipline | P2 | M | WS-2 | ✅ |
| WS-8 | Architecture documentation reconciliation | P1 | S | WS-5 | ✅ |

**Suggested delivery waves:**
- **Wave 1 (MVP):** WS-0 + WS-1 + WS-2 — unblocks all refactors, closes security/data holes.
- **Wave 2:** WS-3 + WS-4 + WS-8 — data safety + reliability + docs.
- **Wave 3:** WS-5 + WS-6 — structural debt.
- **Wave 4:** WS-7 — discipline gates (can also run incrementally alongside Waves 2–3).

---

## 8. Workstream Details

> Each workstream lists: Problem → Requirements → Acceptance Criteria → Approach → Files → Effort → Risk → Rollback.

### WS-0 — Supply-Chain & Repo Hygiene Quick Wins

**Problem.** The dependency tree and repo root carry dead weight and supply-chain smells: a bogus `crypto` npm package, a fully-dead `sqlite3` driver still rebuilt/packaged, a fully-commented-out `keytar`, orphan Vite configs, and accidentally-committed Vite timestamp files. These inflate the installer, confuse contributors, and flag in audits.

**Requirements.**

- R0.1 Remove `"crypto"` from `dependencies` (it ships no code; all imports resolve to the Node builtin).
- R0.2 Remove `"sqlite3"` and `"@types/sqlite3"`; remove `sqlite3` from `forge.config.js` `rebuildConfig.onlyModules` and asar `unpackDir`; delete the no-op `rebuild-sqlite3` script.
- R0.3 Remove `sqlite3`-related steps from `.github/workflows/build.yml` (e.g. `yarn add … sqlite3@latest` on macOS).
- R0.4 Delete orphan `vite.worker.config.mjs` (zero references); decide on `vite.buckEmail.config.mjs` (forge entry commented).
- R0.5 Broaden `.gitignore`: replace the two narrow timestamp lines with `vite.*.config.mjs.timestamp-*.mjs`; broaden `.env*` with `!.env.example`. Remove the 4 committed `*.timestamp-*.mjs` files.
- R0.6 Audit and remove other fully-commented-out dependencies after their owning workstream ships (keytar is removed in WS-1; vue-class-component/vuex in WS-6).

**Acceptance Criteria.**

- `yarn build` / `yarn make-win:prod` succeeds with `crypto` and `sqlite3` removed.
- `node_modules/crypto` and `node_modules/sqlite3` are absent after install.
- `git ls-files | grep timestamp` returns nothing.
- `.env.test` and `.env.production` are git-ignored (`git check-ignore` confirms).
- No `sqlite3` references remain in `forge.config.js` or `build.yml`.

**Approach.** Mechanical removal + build verification. Low risk because `sqlite3` has zero active imports (all commented) and `crypto` resolves to the builtin.

**Files.** `package.json`, `forge.config.js`, `.github/workflows/build.yml`, `.gitignore`, `vite.worker.config.mjs` (delete), `vite.buckEmail.config.mjs` (decide).

**Effort.** S (≤ 1 day). **Risk.** Very low. **Rollback.** Revert the commit.

---

### WS-1 — Security Hardening (IPC + Electron Boundary)

**Problem.** Five gaps weaken an otherwise-solid boundary: (1) secrets stored in plaintext `electron-store` (keytar was removed); (2) no `will-navigate` handler, so the renderer can navigate to an external origin and the privileged preload re-injects `window.api` there; (3) main window not sandboxed; (4) `exec` string interpolation for process kill (`SearchController`); (5) ~24% of IPC handlers bypass Zod, and the preload `console.log`s every IPC payload.

**Requirements.**

- R1.1 **Encrypt secrets at rest.** Use Electron `safeStorage.encryptString()`/`decryptString()` around every `electron-store` `set`/`get` for sensitive keys (auth tokens, cookies, API keys), or construct `electron-store` with an `encryptionKey`. Detect `safeStorage.isEncryptionAvailable()` and fail loudly in dev if unavailable (on Linux without a keyring, document the fallback).
- R1.2 **Add navigation guards.** Register `webContents.on('will-navigate', …)` and `webContents.on('will-redirect', …)` on the main window; `preventDefault()` unless the target URL is a trusted app origin (`app://`, `file://`, dev server). Mirror on child windows.
- R1.3 **Sandbox the main window** (`sandbox: true` in `webPreferences`) OR document a compensating-control decision in `background.ts` if a preload dependency blocks it; if blocked, file a follow-up to remove the dependency.
- R1.4 **Replace `exec` interpolation.** In `SearchController.killProcessByPID`, use `execFile`/`spawn` with an args array (`['-9', String(pid)]` / `['/PID', String(pid), '/F']`).
- R1.5 **Migrate raw IPC handlers onto `registerValidatedHandler`.** Define Zod schemas for the 10 bypassing handlers; prioritize `ai-chat-v2-ipc.ts` (17 raw handles) and `contactExtraction-ipc.ts` (`JSON.parse` + `as`).
- R1.6 **Stop logging IPC payloads in preload.** Remove/gate-behind-`isDevelopment` the `console.log("send", channel, data)` calls in `preload.ts`.
- R1.7 **Worker auth token.** Confirm `WORKER_AUTH_TOKEN` is only ever read by trusted bundled worker code; if plugins/skills can influence worker code, move to a message-based handshake instead of env injection. Document the threat model.
- R1.8 **Forbid direct `ipcRenderer` imports in the renderer** via eslint (`no-restricted-imports`), covering the 4 known files.

**Acceptance Criteria.**

- A test asserts that a token written via the store is **not** present in cleartext in the resulting JSON file on disk (decrypt round-trips correctly).
- A test asserts `will-navigate` to `https://evil.example` is prevented on the main window; trusted-origin navigation is allowed.
- `SearchController.killProcessByPID` has no `exec(\`...${pid}...\`)` pattern (grep clean).
- All 10 previously-raw handlers pass through `registerValidatedHandler` and have a schema in `src/schemas/ipc/*`.
- `preload.ts` contains no unconditional `console.log` of IPC payloads.
- eslint CI fails on any new direct `ipcRenderer` import under `src/views/`.

**Approach.** WS-1.1 is the highest-value item — wrap the store with a `SecureStore` adapter so callers are unchanged. WS-1.5 is the largest; do it handler-by-handler with a schema file per domain, reusing the existing `registerValidatedHandler`. WS-1.2/1.3 are small but must be verified against all window-creation paths.

**Files.** `src/modules/electronstoreservice.ts`, `src/modules/token.ts`, `src/background.ts`, `src/preload.ts`, `src/controller/SearchController.ts`, `src/main-process/communication/{ai-chat-v2-ipc,contactExtraction-ipc,ai-user-memory-ipc,ai-workspace-ipc,ai-workspace-memory-ipc,diagnostics-ipc,hooks-ipc,userIpc,websocket-ipc}.ts`, `src/schemas/ipc/*`, `.eslintrc.json`.

**Effort.** M (1–2 weeks). **Risk.** Medium — secret encryption must not break existing sessions (provide a one-time migration of existing plaintext values on first read). **Rollback.** Feature-flag the encryption (`AIFETCHLY_ENCRYPT_STORE`); if decryption fails en masse, disable the flag and re-issue plaintext reads.

---

### WS-2 — CI Test Gate & Coverage Foundation

**Problem.** 334 test files exist but CI runs **zero** of them (`build.yml` only packages). `yarn test` runs only the 43 Mocha tests. There is **no coverage tooling**, so the mandated 80% gate is unmeasurable. The best-tested layer (IPC handlers, ~30 vitest files) is never run in CI.

**Requirements.**

- R2.1 **Add coverage tooling.** Add `@vitest/coverage-v8`; configure `test.coverage` (provider `v8`, reporters `text`/`html`/`lcov`, include `src/**`, exclude test/fixtures/mocks) in `vite.main.config.mjs`, `vite.utilityCode.config.mjs`, `vite.taskCode.config.mjs`.
- R2.2 **Unify the test command.** Create `yarn test:ci` that runs the full Mocha + vitest suite and emits coverage. Keep `yarn test` (Mocha) for the inner dev loop.
- R2.3 **Wire CI.** Add a `test` job to `.github/workflows/build.yml` that runs `yarn test:ci` on every push/PR, **before** packaging. Upload the lcov as an artifact.
- R2.4 **Coverage gate (graduated).** Add a coverage threshold that starts at the **current** measured baseline (to avoid blocking immediately) and ratchets up. Gate **changed-line coverage** at 80% via a diff-aware check (e.g. `--changed`/a diff-coverage tool), not a blanket 80% on legacy.
- R2.5 **Keep the type-check gate.** Preserve the existing `test/vitest/_typecheck/globalSetup.ts` `tsc --noEmit` gate (it is a strength); ensure CI uses it (not `AIFETCHLY_SKIP_TSC`).
- R2.6 **Surface the IPC suite.** Ensure `test/vitest/main/ipc/*.test.ts` is included in the default vitest run and CI.

**Acceptance Criteria.**

- A PR that breaks an existing IPC test is **blocked** by CI.
- `yarn test:ci` prints a coverage summary; an `lcov.info` artifact is produced.
- Diff coverage on a sample PR is reported; new/changed lines are gated at ≥ 80%.
- The full suite runs green on a clean checkout in CI.
- Document the measured baseline coverage number in `docs/` once established.

**Approach.** Start with the existing 334 tests; do not write new tests in this workstream (that comes per-refactor). The graduated gate avoids a "fix everything to 80%" cliff while preventing regression on new code.

**Files.** `package.json`, `.github/workflows/build.yml`, `vite.main.config.mjs`, `vite.utilityCode.config.mjs`, `vite.taskCode.config.mjs`, `vitest.service.config.mjs`.

**Effort.** M (1 week). **Risk.** Low — purely additive to CI. **Rollback.** Make the test job `continue-on-error` initially if flaky tests surface, then harden.

---

### WS-3 — Database Integrity

**Problem.** `synchronize: true` (`SqliteDb.ts:520`) auto-mutates the live schema from entity metadata on every boot — a data-loss risk on any entity change. Two parallel data-access systems coexist (76 TypeORM `.model.ts` + 20 raw-SQL `*db.ts` via a legacy `Scraperdb`). `BaseDb` declares `db` but never assigns it. The `WORKER_TYPE` guard exists in only ~4 models, not the base. `SqliteDb.getInstance(filepath)` swaps connections fire-and-forget on path change. Entities are under-indexed (40/78).

**Requirements.**

- R3.1 **Introduce migrations.** Generate a baseline migration from current entities; gate `synchronize` to `NODE_ENV !== 'production'` (keep `true` in dev for ergonomics); run pending migrations on app boot in production. Add `yarn migration:generate` and `yarn migration:run` scripts.
- R3.2 **Consolidate to one data-access style (TypeORM repositories).** Migrate the live `*db.ts` files (e.g. `accountCookiesdb`) to `.model.ts` equivalents, one per sprint. Delete `Scraperdb` and the raw-SQL path when the last consumer is gone. Until then, assign `this.db` in `BaseDb` so the contract is not subclass-dependent.
- R3.3 **Centralize the worker guard.** Put the `process.env.WORKER_TYPE` check in `BaseDb`/`BaseModule` (throw on DB access from a worker), OR remove the claim from CLAUDE.md. Prefer centralized enforcement.
- R3.4 **Make the singleton path-safe.** Treat a `filepath` mismatch after first init as a hard error (or guard the swap with a mutex so concurrent callers await the same transition). Document that the DB path is immutable post-init.
- R3.5 **Profile and add indices.** Identify hot query paths (FK lookups, status filters) and add `@Index` to the under-indexed entities. Add a `@Index` lint/review nudge for new entities.
- R3.6 **Clean `SqliteVecDatabase.ts`.** Delete the ~40% commented-out dead code; replace `driver as any` (×4) with typed `BetterSqlite3Driver` access; add an identifier-allowlist helper for dynamic table names; switch to `Logger`.

**Acceptance Criteria.**

- In a production build, schema changes are applied **only** via migrations; `synchronize` is confirmed off in prod config.
- A downgrade/rollback migration exists and is tested.
- No `*db.ts` raw-SQL files remain that are actually consumed (legacy ones deleted or migrated); `Scraperdb` is gone.
- `BaseDb` either enforces the worker guard centrally or CLAUDE.md no longer claims it does.
- A concurrent-`getInstance` test does not produce a destroyed connection under a live caller.
- `SqliteVecDatabase.ts` has no commented-out method bodies and no `as any` on the driver.

**Approach.** R3.1 first (unblocks safe entity changes). R3.2 is incremental — migrate one legacy model per PR, with the old file deleted only when grep confirms zero consumers. R3.6 is self-contained.

**Files.** `src/config/SqliteDb.ts`, `src/model/Basedb.ts`, `src/modules/baseModule.ts`, `src/model/*db.ts` (migrate/delete), `src/model/scraperdb.ts` (delete), `src/modules/adapters/SqliteVecDatabase.ts`, `src/entity/*.entity.ts` (indices), `package.json` (migration scripts).

**Effort.** L (3–5 weeks, incremental). **Risk.** High on R3.1 — a bad migration can corrupt user data. Mitigate: back up the DB file before running migrations on boot; test migration + rollback on a copy of a real user DB. **Rollback.** Each migration is reversible; the pre-migration DB file is backed up.

---

### WS-4 — Worker Reliability & Contract Unification

**Problem.** `ChildProcessManager.ts` is dead code with latent bugs (wrong spawn mechanism, delete-before-exit zombie risk, no retry). The contact-extraction worker has an **uncapped restart loop** (`contactExtraction-ipc.ts:114-123`), **only `console.error`s on fatal** (no exit), an **in-memory queue** lost on crash, and a `cleanupContactExtractionWorker()` that is **never called**. Worker message contracts are fragmented across 4 files with 4 casing conventions and 2 transports. There is **no global backpressure** across managers.

**Requirements.**

- R4.1 **Delete dead process managers.** Remove `src/modules/ChildProcessManager.ts` and `src/modules/ChildProcessScraper.ts`. Document `YellowPagesProcessManager` + `ChildProcessAdapterFactory` as canonical.
- R4.2 **Bound worker restarts.** Add a restart policy (max N restarts in a sliding window, exponential backoff, circuit-break → mark task Failed). Make `setupWorkerHandlers` real or delete it.
- R4.3 **Fix fatal-error handling.** Make `ContactExtractionWorker` mirror `LocalEmbeddingWorker`/`SkillWorker`: on `uncaughtException`/`unhandledRejection`, drain in-flight `requestId`s, send a fatal-error message to main, then `process.exit(1)`. Register `SIGTERM`/`SIGINT`.
- R4.4 **Persist queue state.** Persist `ExtractionQueue` state to the DB (or have main re-queue on worker boot) so a crash does not lose pending/in-flight jobs.
- R4.5 **Wire app-quit cleanup.** Call `cleanupContactExtractionWorker()` from `app.on('before-quit')`; ensure all browser-bearing workers close their browsers on exit.
- R4.6 **Unify the message contract.** Collapse `IPCMessage.ts`/`IPCMessageProtocol.ts`/`BackgroundProcessMessages.ts` into one Zod source in `src/schemas/worker/*` (discriminated unions). Migrate the ~13 workers not yet on it. Standardize on **one transport** (`utilityProcess.fork` + `parentPort`) and **one discriminator field** (`type`).
- R4.7 **Global process/browser budget.** Introduce a `WorkerCoordinator` singleton that all managers ask for a slot before spawning, and that tracks every launched `Browser` for forced cleanup on crash/exit. Cap total concurrent browser-bearing workers.
- R4.8 **Remove the 3-format normalizer.** Once transport is unified, delete `utils/childProcessMessage.ts` `parseChildMessage`.

**Acceptance Criteria.**

- A test simulates a worker that crashes on startup; the restart loop stops after N attempts and the task is marked Failed (no infinite loop).
- A test simulates a worker crash mid-batch; queued/in-flight jobs are recovered (re-queued), not lost.
- `app.on('before-quit')` cleanly shuts down the contact-extraction worker and closes its browser.
- `grep -r "process.send" src/childprocess` shows a single, documented transport (or a migration plan to get there).
- All worker inbound messages pass through a Zod `safeParse`; malformed messages are dropped, not crashed on.
- A test asserts the `WorkerCoordinator` blocks the (N+1)-th browser-bearing worker when the budget is exhausted.
- `ChildProcessManager.ts` and `ChildProcessScraper.ts` are deleted; no importers remain.

**Approach.** R4.1/R4.2/R4.3/R4.5 are quick reliability wins. R4.6/R4.7 are larger and can land incrementally (new workers use the new contract; a migration tracker retires old ones). Prioritize the contract for the maps/YellowPages/Skill workers.

**Files.** `src/modules/ChildProcessManager.ts` (delete), `src/modules/ChildProcessScraper.ts` (delete), `src/main-process/communication/contactExtraction-ipc.ts`, `src/childprocess/contact-extraction/{ContactExtractionWorker,ExtractionQueue}.ts`, `src/modules/interface/{IPCMessage,IPCMessageProtocol,BackgroundProcessMessages}.ts` (collapse), `src/schemas/worker/*`, `src/utils/childProcessMessage.ts` (delete), new `src/modules/WorkerCoordinator.ts`, `src/background.ts` (before-quit wiring).

**Effort.** L (4–6 weeks, incremental). **Risk.** Medium — touching worker lifecycle can introduce deadlocks; mitigate with the crash-recovery tests above. **Rollback.** Per-worker; each migration is independently revertible.

---

### WS-5 — Module-Layer Health (DI, Error Contract, Factory Consolidation)

**Problem.** Hub modules (`TaskExecutorService`, `YellowPagesOrchestrator`, `YellowPagesProcessManager`, `RagSearchModule`) are un-unit-testable: they hard-`new` 7+ collaborators, and `BaseModule`'s constructor touches the DB singleton + filesystem. `CustomError` is dead (0 uses; 463 raw `throw new Error`). Three error strategies coexist. The platform-adapter system has 5 overlapping factories (3 dead/test-only). ~7 of 29 `interface/` files have zero implementations. God modules exceed 1,000 lines.

**Requirements.**

- R5.1 **Introduce constructor injection for hub modules.** Add a lightweight DI mechanism (hand-rolled registry or `tsyringe`) for the ~7 hubs; inject collaborators via constructor so fakes can substitute. No global container mandate — start with the hubs.
- R5.2 **Make `BaseModule` lazy.** Do not touch the DB singleton or filesystem in the constructor; defer to `ensureConnection()`. This makes `new SomeModule()` in tests non-destructive.
- R5.3 **Adopt one error contract.** Either re-adopt `CustomError` + a `{status,data,msg}` envelope with an eslint rule forbidding raw `throw new Error`/bare returns in modules, **or** delete `customError.ts`. Pick one; enforce it.
- R5.4 **Consolidate platform factories.** Delete `PlatformFactory.ts`, `UnifiedPlatformFactory.ts`, and the top-level `PlatformAdapterFactory.ts`. Keep `PlatformRegistry` + `platforms/PlatformAdapterFactory` + `ChildProcessAdapterFactory`. Collapse the 3 hand-maintained 15-element adapter lists into one registry map.
- R5.5 **Prune dead interfaces.** Delete the ~7 zero-implementation interfaces (`IScraperEngine`, `IProxyApi`, `IProgressReporter`, `IDataExtractor`, `IFactory`, `EmbeddingImpl`, `LlmImpl`, `TraditionalTranslateImpl`) or back them with real implementations. Decide on `FaissVectorDatabase` (commented out) — implement or remove.
- R5.6 **Split god modules.** Extract cohesive responsibilities from `YellowPagesProcessManager` (1795), `RagSearchModule` (1525), `SearchModule` (1235), `lib/function.ts` (1226 → split into focused utils). Target ≤ 400 lines per file; enforce via lint (warn > 400, error > 800 — the existing project rule).

**Acceptance Criteria.**

- `TaskExecutorService`, `YellowPagesOrchestrator`, `YellowPagesProcessManager`, `RagSearchModule` each have a passing unit test that substitutes a fake collaborator (impossible today).
- `new SomeModule()` in a test does not create a DB connection or touch the filesystem (assert via spy).
- Every module follows one documented error contract; `customError.ts` is either enforced or deleted.
- `grep` confirms only the 3 canonical platform-factory files remain.
- No `interface/` file has zero implementations (deleted or backed).
- No module exceeds 800 lines; the god files are under their targets.

**Approach.** R5.2 first (small, unblocks R5.1 testing). R5.1 hub-by-hub. R5.4/R5.5 are deletions — verify with the call-graph (codegraph) before removing. R5.6 is incremental; do not attempt all god files at once.

**Files.** `src/modules/baseModule.ts`, `src/modules/{TaskExecutorService,YellowPagesOrchestrator,YellowPagesProcessManager,RagSearchModule}.ts`, `src/modules/customError.ts` (decide), `src/modules/{PlatformFactory,UnifiedPlatformFactory,PlatformAdapterFactory}.ts` (delete), `src/modules/platforms/PlatformAdapterFactory.ts` (dedupe), `src/modules/interface/*` (prune), `src/modules/lib/function.ts` (split).

**Effort.** L (5–8 weeks, incremental). **Risk.** Medium-high — DI refactor touches hot paths. Mitigate: WS-2 must be green first; refactor one hub at a time behind its existing tests + new ones. **Rollback.** Per-module revert.

---

### WS-6 — Frontend Migration Completion

**Problem.** State management is stalled mid-migration: Vuex-class-modules (canonical, load-bearing for auth/permissions) **and** Pinia (1 theme store) both live, plus `vue-class-component` (1 dead file) and `vue-template-compiler` (Vue 2 tool). v1 AI chat (`AiChatBox.vue`, 3,690 lines) and v2 (`AiChatV2.vue`, 2,106) are both shipped and wired into the shell. 15 components exceed 600 lines. The API layer is mixed (canonical `windowInvoke` + 9 raw `window.api.invoke` + a competing `api/hooks.ts` wrapper + 4 direct `ipcRenderer` imports). Two API directories. No shared error/loading composable. ~120 `any` usages and a duplicate `Iresponse` type. Dead code (`componets/` typo dir, `HomeView.vue`, empty `asyncRoutes`).

**Requirements.**

- R6.1 **Finish the Pinia migration.** Port `user`, `permission`, `settings`, `error-log`, `app` Vuex-class-modules to setup-style Pinia stores (preserving the auth-token and permission-route logic). Drop `vuex`, `vuex-module-decorators`, `vue-class-component`, `vue-template-compiler`.
- R6.2 **Retire v1 AI chat.** Confirm v2 parity (features + i18n); delete `AiChatBox.vue`, `ai-chat-ipc.ts`, `api/aiChat.ts`, `api/aiChatWithRAG.ts`; remove v1 wiring from `layout.vue`.
- R6.3 **Split god components.** Decompose `AiChatV2.vue` (2,106), `yellowpages/create.vue` (1,636), `SearchDetailTable.vue` (1,630), `drag-resizeble.vue` (1,328), `KnowledgeLibrary.vue` (1,229) by responsibility. Enforce a ~400-line component cap via lint.
- R6.4 **Consolidate the API layer.** Route all IPC through `windowInvoke`; merge/delete the `api/hooks.ts` wrapper; forbid direct `ipcRenderer` imports (ties to WS-1 R1.8). Consolidate `src/api/` into `src/views/api/`.
- R6.5 **Add a shared error/loading composable.** Create `useApiCall` (wraps `windowInvoke` + try/catch + loading ref + snackbar) and adopt across pages; ensure every page has a user-visible error path (e.g. `proxy.vue` currently has none).
- R6.6 **Tighten renderer types.** Derive renderer types from `src/schemas/ipc/*` via `z.infer`; delete the duplicate `Iresponse`; reduce the ~120 `any` usages.
- R6.7 **Remove dead frontend code.** Delete `src/views/componets/` (typo), `HomeView.vue`, the empty `asyncRoutes` machinery + its callers, and the typo `drag-resizeble` (rename to `drag-resizable`).

**Acceptance Criteria.**

- Only Pinia is registered in `main.ts`; `vuex`/`vuex-module-decorators`/`vue-class-component` are absent from `package.json`.
- v1 AI chat files are deleted; the chat feature works end-to-end via v2.
- No `.vue` file exceeds 800 lines; flagged god components are under target.
- `grep -r "window.api.invoke" src/views` (outside the wrapper) returns nothing; `grep -r "ipcRenderer" src/views` returns nothing.
- `src/api/` no longer exists (consolidated into `src/views/api/`).
- Every page that calls IPC uses `useApiCall` (or equivalent) and shows errors on failure.
- `Iresponse` is declared once; renderer edge types are derived from Zod schemas.

**Approach.** R6.1 is the highest-risk (auth/permissions) — do it behind feature parity tests and a careful cutover. R6.2 needs a parity checklist. R6.3/R6.4/R6.7 are incremental. Keep i18n parity (all 6 languages) for any renamed/added keys.

**Files.** `src/views/store/modules/*` (port), `src/views/store/appMain.ts`, `src/views/main.ts`, `src/views/components/aiChat/AiChatBox.vue` (delete), `src/views/components/aiChatV2/*`, `src/main-process/communication/ai-chat-ipc.ts` (delete), `src/api/*` (consolidate/delete), `src/views/utils/apirequest.ts`, new `src/views/composables/useApiCall.ts`, `package.json`.

**Effort.** L (6–8 weeks, incremental). **Risk.** Medium-high on R6.1 (auth regression). Mitigate: WS-2 green first; manual + automated UAT on login/permission flows. **Rollback.** Per-store / per-component revert.

---

### WS-7 — Type & Logging Discipline

**Problem.** ~4,000 `console.*` calls vs 26 `Logger` imports (violates the project's own rule). ~570 `any`/`as any`. tsconfig claims `strict: true` but disables `noImplicitAny`/`strictPropertyInitialization`/`noImplicitThis`, and aliases `electron-store` to a test mock in the production path (masks API drift).

**Requirements.**

- R7.1 **`console.*` → `Logger`.** Codemod/replace `console.log`/`console.error`/`console.warn` with the existing `Logger` across `src/`. Add an eslint `no-console` rule with `Logger` as the allowed escape hatch. Strip the preload payload logging (ties to WS-1 R1.6).
- R7.2 **Tighten tsconfig.** Flip `noImplicitAny`, `strictPropertyInitialization`, `noImplicitThis` to `true`; fix the resulting errors incrementally per-directory (not all at once). Un-mock `electron-store` for non-test compiles.
- R7.3 **Reduce `any`.** Replace `as any`/`: any` with proper types or `unknown` (+ narrowing). Prioritize the data-heavy pages/modules.
- R7.4 **Enforce the Zod mandate.** Reconcile the CLAUDE.md `zod/v4` rule with reality: either pin `zod ^3.25.0` and migrate imports to `zod/v4`, or drop the mandate and keep `from "zod"`. Add an eslint rule or convention check to keep them consistent.

**Acceptance Criteria.**

- `grep -r "console.log" src` count drops to near-zero (only allowed escape hatches); CI `no-console` rule is green.
- tsconfig has `noImplicitAny`/`strictPropertyInitialization`/`noImplicitThis` all `true`; `yarn tsc-result` is green.
- `electron-store` is not aliased to a mock in the production tsconfig path.
- The Zod import convention is consistent repo-wide and matches CLAUDE.md.

**Approach.** R7.1 can be largely automated (codemod) but needs human review for log levels. R7.2 is incremental — enable per-folder with `// eslint-disable` escape hatches retired over time.

**Files.** `src/modules/Logger.ts`, `src/**/*.ts`, `src/**/*.vue`, `tsconfig.json`, `.eslintrc.json`, `package.json` (zod pin).

**Effort.** M (2–3 weeks, incremental). **Risk.** Low-medium — `no-console`/strict can surface latent bugs (good) but may be noisy initially. **Rollback.** Per-directory.

---

### WS-8 — Architecture Documentation Reconciliation

**Problem.** CLAUDE.md documents a three-layer architecture (IPC → Module → Model → Entity → DB) that omits `src/service/` (166 files, the AI brain). It also claims a `WORKER_TYPE` guard that isn't systematically enforced, and a Zod `zod/v4` rule that isn't followed. The documentation and the code have diverged, which misleads contributors and AI agents.

**Requirements.**

- R8.1 **Document the real layering.** Update CLAUDE.md's Architecture Overview to describe IPC → **Service** (orchestration/AI/streaming) **or Module** (single-domain CRUD + business rules) → Model → Entity → DB, with a decision rule for service-vs-module placement.
- R8.2 **Codify placement rules.** Add a short "where does new code go?" section: Services orchestrate multiple modules and own streaming/AI/tool-calls; Modules are single-domain CRUD + rules; Models are data access; Entities are schema.
- R8.3 **Fix the inaccurate claims.** Reconcile the `WORKER_TYPE` claim (enforced centrally in WS-3 R3.3, or removed), the `zod/v4` rule (WS-7 R7.4), and the `src/api/` location (now `src/views/api/` per WS-6 R6.4).
- R8.4 **Add an architecture decision record (ADR) index.** Seed `docs/adr/` with ADRs for the decisions this program makes (migrations over synchronize, Pinia over Vuex, one worker contract, one transport, DI for hubs). Reference the review for rationale.

**Acceptance Criteria.**

- CLAUDE.md's layering section matches the actual directory responsibilities; a new contributor can decide where to place a new feature from the doc alone.
- No CLAUDE.md claim contradicts the code (worker guard, zod path, api dir).
- At least one ADR exists per major decision in WS-3/WS-4/WS-5/WS-6.

**Approach.** Light-touch documentation; mostly writing. Best done as each workstream ships (update the relevant section when the code lands), with a final reconciliation pass.

**Files.** `CLAUDE.md`, new `docs/adr/*`.

**Effort.** S (ongoing, ≤ 1 day total). **Risk.** None. **Rollback.** N/A.

---

## 9. Cross-Cutting Requirements

These apply to **every** workstream:

### 9.1 Testing
- Every code change adds or updates tests; changed-line coverage ≥ 80% (per WS-2).
- No new IPC handler without a Zod schema; no new worker without a Zod message contract.
- New entities include indices where queried by FK/status.

### 9.2 Internationalization
- Any new/changed user-facing string is added to **all six** language files (`en/zh/es/fr/de/ja`). Preserve the existing 47/47 parity.
- Use `t('key')` with English fallback.

### 9.3 Three-Layer (Four-Layer) Discipline
- IPC handlers stay thin: validate → call Service/Module → return envelope. **Never** touch TypeORM repositories directly (the boundary is currently clean; keep it).
- Workers never access the DB directly (currently clean; keep it).
- DB path via `Token`/`USERSDBPATH`, not `app.getPath('userData')` for DB access.

### 9.4 Security Checklist (per change)
- No hardcoded secrets; secrets encrypted at rest (post WS-1).
- All renderer input Zod-validated before use.
- No shell string-interpolation of untrusted input (`execFile`/argv only).
- Error messages redact tokens/PII.

### 9.5 Immutability & Error Handling
- Immutable update patterns (no in-place mutation).
- Explicit error handling at every level; user-friendly messages in UI, detailed context server-side.

---

## 10. Sequencing & Dependencies

```
Wave 1 (MVP, unblocks all):  WS-0  ──┐
                              WS-1  ─┤  (security + CI gate)
                              WS-2 ──┘
                                   │
Wave 2 (safety + reliability): WS-3 (DB integrity) ──┐
                               WS-4 (workers) ───────┤── needs WS-2 green
                               WS-8 (docs, ongoing) ─┘
                                   │
Wave 3 (structural debt):     WS-5 (modules) ──┐── needs WS-2; WS-5 hubs benefit from WS-4
                              WS-6 (frontend) ─┤── needs WS-2
                                   │            │
Wave 4 (discipline):          WS-7 (types/logging) ── incremental, can run alongside Waves 2–3
```

Hard dependencies: **WS-2 (CI gate) must be green before WS-3/WS-4/WS-5/WS-6 refactors begin.** WS-5 R5.1 (DI) is eased by WS-4 R4.7 (coordinator) but not blocked by it. WS-8 is ongoing.

---

## 11. Risk Management

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Secret-encryption migration breaks existing sessions (WS-1) | Med | High | One-time plaintext→encrypted migration on first read; feature-flag; verify round-trip in test |
| Bad DB migration corrupts user data (WS-3) | Low | Critical | Back up DB file pre-migration; test up + down on a real user DB copy; gate `synchronize` off only after baseline migration is verified |
| Worker lifecycle change introduces deadlock/hang (WS-4) | Med | High | Crash-recovery tests; per-worker rollout; restart-loop bounds have a hard ceiling |
| Pinia migration regresses auth/permissions (WS-6) | Med | High | Parity tests + UAT on login/permission flows; keep Vuex until parity proven |
| `no-console`/strict tsconfig surfaces latent bugs (WS-7) | High | Low | Incremental per-folder enablement; fix-forward, don't blanket-disable |
| Big-bang temptation (doing WS-5/WS-6 at once) | Med | High | Enforce per-module/per-component PRs; no "freeze" milestone |
| CI test gate goes red on day 1 (flaky tests) (WS-2) | Med | Med | `continue-on-error` initially; quarantine/flaky-track; ratchet up |

---

## 12. Success Metrics / KPIs

**Security & integrity:**
- 0 P0 security findings open (plaintext secrets, navigation bypass, unsandboxed main window, `exec` injection pattern).
- 0 data-loss incidents from schema changes (migrations only in prod).
- 100% of IPC handlers Zod-validated.

**Testing:**
- CI runs the full suite on every PR (from 0 today).
- Measured coverage baseline established; changed-line coverage ≥ 80%.
- The 4 hub modules have passing unit tests with fake collaborators (from 0 today).

**Debt reduction:**
- `vuex`/`vuex-module-decorators`/`vue-class-component`/`keytar`/`sqlite3`/`crypto` removed from `dependencies`.
- v1 AI chat deleted.
- Dead process managers deleted; 1 worker message contract; 1 transport.
- 3 canonical platform factories (from 5).
- `console.log` count in `src/` reduced by ≥ 90%.

**Velocity/health:**
- CLAUDE.md layering matches reality; "where does new code go?" is answerable from docs.
- No module/component > 800 lines (lint-enforced).
- tsconfig fully strict; `yarn tsc-result` green.

---

## 13. Open Questions / Decisions Needed

1. **Secret storage mechanism** — `safeStorage` (OS keychain-backed) vs. `electron-store` `encryptionKey`. Prefer `safeStorage`; confirm Linux fallback behavior. *(WS-1)*
2. **Main-window sandbox** — can `sandbox: true` be enabled given current preload usage, or does a preload dependency block it? *(WS-1)*
3. **DI approach** — hand-rolled registry vs. `tsyringe` vs. no container (constructor injection only). Recommend starting with plain constructor injection + a small registry for hubs. *(WS-5)*
4. **Error contract** — re-adopt `CustomError` + envelope, or delete `customError.ts` and standardize on thrown errors with a single envelope at the IPC boundary? *(WS-5)*
5. **Zod version** — pin `^3.25.0` + migrate to `zod/v4`, or drop the `zod/v4` mandate? *(WS-7)*
6. **Worker transport** — commit fully to `utilityProcess.fork` + `parentPort` and retire `process.send`, or keep both? Recommend one. *(WS-4)*
7. **Global concurrency budget value** — what is the cap on concurrent browser-bearing workers (RAM-dependent; per-platform)? *(WS-4)*
8. **Migration cutover** — run migrations on every boot (check + apply) or only on version bump? *(WS-3)*
9. **v1 AI chat parity bar** — what is the exact feature/i18n parity checklist that gates v1 deletion? *(WS-6)*
10. **Coverage gate scope** — diff-coverage only, or also a slowly-ratcheting global floor? *(WS-2)*

---

## 14. Implementation File Map (summary)

**New files:**
- `src/modules/WorkerCoordinator.ts` (WS-4)
- `src/schemas/worker/*` unified contracts (WS-4)
- `src/schemas/ipc/*` for the 10 migrated handlers (WS-1)
- `src/views/composables/useApiCall.ts` (WS-6)
- Pinia stores replacing Vuex modules (WS-6)
- DB migrations under a `migrations/` dir (WS-3)
- `docs/adr/*` (WS-8)

**Deleted files (program-wide):**
- `src/modules/ChildProcessManager.ts`, `src/modules/ChildProcessScraper.ts` (WS-4)
- `src/modules/{PlatformFactory,UnifiedPlatformFactory,PlatformAdapterFactory}.ts` (WS-5)
- `src/modules/interface/*` dead interfaces (WS-5)
- `src/model/scraperdb.ts` + migrated `*db.ts` (WS-3)
- `src/views/components/aiChat/AiChatBox.vue`, `src/main-process/communication/ai-chat-ipc.ts`, `src/api/aiChat.ts`, `src/api/aiChatWithRAG.ts` (WS-6)
- `src/views/componets/` (typo dir), `src/views/HomeView.vue` (WS-6)
- `src/utils/childProcessMessage.ts` (WS-4, post-transport-unification)
- `vite.worker.config.mjs` (WS-0)
- `customError.ts` (WS-5, if "delete" decision)

**Modified files (high-impact):**
- `package.json` (remove crypto/sqlite3/keytar/vuex/vue-class-component; add coverage tooling; pin zod; migration scripts)
- `forge.config.js`, `.github/workflows/build.yml`, `.gitignore`, `tsconfig.json`, `.eslintrc.json`
- `src/config/SqliteDb.ts`, `src/model/Basedb.ts`, `src/modules/baseModule.ts`
- `src/background.ts`, `src/preload.ts`, `src/modules/electronstoreservice.ts`, `src/modules/token.ts`
- `CLAUDE.md`

---

## 15. Definition of Done (Program)

- All P0 items (WS-0, WS-1, WS-2) shipped and verified in a production build.
- CI runs the full test suite with coverage on every PR; changed-line coverage ≥ 80%.
- Secrets encrypted at rest; Electron navigation-bypass path closed; main window sandboxed (or documented compensating control).
- DB schema changes apply via migrations only; `synchronize` off in production.
- The three stalled migrations completed and superseded systems removed (Pinia-only, v2-chat-only, no plaintext secrets).
- Hub modules unit-testable with fake collaborators.
- One worker message contract; one worker transport; dead process managers removed.
- CLAUDE.md reconciled with the real architecture; ADRs capture the major decisions.
- `console.log` epidemic resolved; tsconfig fully strict; Zod mandate consistent.
- No regression in the 6-language i18n parity; no regression in the intact no-DB-in-workers / no-DB-in-IPC boundaries.
- `docs/architecture-optimization-review.md` updated to mark each finding resolved.

---

## Appendix A — Mapping: Review Findings → Workstreams

| Review finding (§) | Workstream |
|---|---|
| Plaintext secrets (§6) | WS-1 |
| No `will-navigate` / unsandboxed main window (§6) | WS-1 |
| `exec` interpolation (§6) | WS-1 |
| Raw IPC handlers bypass Zod (§6) | WS-1 |
| Preload payload logging (§6) | WS-1 / WS-7 |
| CI runs 0 tests / no coverage (§7, §8) | WS-2 |
| Bogus `crypto`, dead `sqlite3`, stray files (§7) | WS-0 |
| `synchronize:true`, dual data-access, dual driver, singleton, worker guard, indexing (§4.2) | WS-3 (+WS-0 for driver) |
| Dead `ChildProcessManager`, restart loop, fatal handling, queue loss, contract fragmentation, no backpressure (§4.3) | WS-4 |
| God modules, no DI, dead `CustomError`, factory tangle, aspirational interfaces (§4.4) | WS-5 |
| Stalled Pinia, v1/v2 chat, god components, mixed API layer, dead code (§4.5) | WS-6 |
| `console.*` epidemic, `any`, half-strict tsconfig, vector dead code (§4.6) | WS-7 |
| Undocumented `src/service/` layer (§4.1) | WS-8 |

## Appendix B — Effort & Sizing Legend

- **S** — ≤ 1 week, mostly mechanical, low risk.
- **M** — 1–2 weeks, some design, medium risk, verifiable.
- **L** — 3+ weeks, incremental across multiple PRs, higher risk, requires WS-2 green first.
