# Architecture Remediation Program — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement remaining tasks. Completed tasks use `[x]`; pending tasks use `- [ ]`.

**Goal:** Execute the nine-workstream (WS-0…WS-8) remediation program from `docs/prd/architecture-remediation-prd.md`, starting with the low-risk MVP wave (WS-0 + WS-1 + WS-2), then sequencing the structural/data-integrity waves behind a green CI gate.

**Architecture:** Preserve every existing strength (Zod `registerValidatedHandler`, fail-closed AI gate, intact no-DB-in-workers boundary, 6-language i18n parity). Wrap rather than rewrite (`SecureStore`, constructor-injection-with-defaults, `WorkerCoordinator`). Gate every trust boundary with Zod `safeParse`. Make constructors I/O-free. Reversible by default (feature flags, `down()` migrations, pre-change backups).

**Tech Stack:** Electron 35, Vue 3 + Vuetify + Pinia, TypeScript 5, TypeORM + better-sqlite3 + sqlite-vec, Vitest + Mocha, Zod, Puppeteer.

**Source docs:** PRD (`docs/prd/architecture-remediation-prd.md`), technical design (`docs/architecture-remediation-technical-design.md`), evidence (`docs/architecture-optimization-review.md`).

---

## 0. Scope decision (read first)

This is a **program, not a feature** — ~25–40 weeks of incremental work across 9 independently-shippable workstreams. The PRD's own recommendation is an MVP wave: **WS-0 + WS-1 + WS-2**.

**This plan implements the MVP wave in detail** (WS-0 is already complete). **WS-3…WS-8 are given as a roadmap** — each is multi-week, requires WS-2's CI gate to be green first, and warrants its own detailed plan (brainstorm → spec → plan) when started, because they involve real-DB migration testing, auth-flow UAT, and god-file decomposition that cannot be safely batched.

Per the PRD's hard dependency: **WS-2 (CI gate) must be green before WS-3/4/5/6 refactors begin.** We do not refactor what we cannot verify.

---

## 1. Verified ground-truth (corrections to the PRD)

The PRD cites file:line locations from an architecture review. Before editing, we verified the current state. Several PRD assumptions are **inaccurate** — the plan below follows reality, not the PRD text:

| PRD assumption | Verified reality | Impact |
|---|---|---|
| WS-1: secrets stored in **plaintext** `electron-store` | `src/modules/token.ts` **already encrypts** via `CryptoSource` (AES) before `store.setValue`; `electron-store` itself has no `encryptionKey`. The dead code `encryptionKey: "ai-fetchly-key"` in `token.ts` is never passed to the store. | R1.1 is "replace extractable-key CryptoSource with OS-bound `safeStorage`", not "add encryption to plaintext". Migration must read existing CryptoSource-encrypted values, not plaintext. |
| WS-1 R1.5 lists `ai-workspace-memory-ipc.ts`, `diagnostics-ipc.ts`, `hooks-ipc.ts` | These files **do not exist**. | The real raw-handler set is: `ai-chat-v2-ipc` (17), `sync-msg` (11), `ai-user-memory-ipc` (7), `ai-workspace-ipc` (6), `contactExtraction-ipc` (3), `userIpc` (5), `websocket-ipc` (5), `async-msg` (1), plus mixed files. |
| WS-1 R1.8: "4 known files" with direct `ipcRenderer` | Only **1 active** import: `src/views/api/sessionRecording.ts:1`. One more is commented out. | The lint rule is cheap to enable after migrating that one file. |
| WS-1 R1.2: no navigation guard; main window unsandboxed | Confirmed: no `will-navigate`/`will-redirect`; `webPreferences` has `contextIsolation:true, nodeIntegration:false`, `sandbox` not explicitly set. `setWindowOpenHandler` (background.ts:372) returns `allow` for every URL and its override omits sandbox/contextIsolation. | Navigation guard is additive + safe. Sandbox needs preload Node-usage audit before flipping. |
| WS-2: "334 test files" | Actual: 210 vitest + 37 mocha + 3 rag ≈ 250 `.test.ts`. `test/vitest/taskCode/` does **not exist**; `test/vitest/main/setup.ts` does **not exist**. No config has `coverage`. | Baseline numbers differ; coverage config starts from scratch. |
| WS-2: typecheck gate | `globalSetup` (tsc --noEmit) is wired into `vite.main.config.mjs` + `vite.utilityCode.config.mjs` **only** — NOT taskCode/service/components configs. | Preserve existing; optionally extend later. |
| `electron-store` aliased to test mock in tsconfig | Confirmed: `tsconfig.json` `paths` maps `electron-store` → `./test/mocks/electron-store.ts` (also `electron`, `electron-log`). | WS-7 R7.2: move these aliases to `tsconfig.test.json`. |

**Verified facts reused throughout this plan** (file:line):
- Canonical IPC pattern: `src/main-process/communication/_shared/registerValidatedHandler.ts` — `registerValidatedHandler(channel, schema: () => ZodType<TInput>, handler)`; envelope `{status,msg,data}` via `satisfies CommonMessage<T>`; on parse-fail returns `{status:false,msg,data:null}`.
- `CommonMessage<T>` = `{ status: boolean; msg: string; data?: Type }` (`src/entityTypes/commonType.ts:53-57`).
- `lazySchema<T>(factory)` = memoizing thunk (`src/utils/lazySchema.ts`).
- Logger: `import { log } from "@/modules/Logger"` → `log.info/warn/error/debug(...)`.
- Schema convention: `src/schemas/ipc/*.ts`, `lazySchema(() => z.strictObject({...}))`, shared helpers in `src/schemas/ipc/_shared/common.ts` (`byIdInputSchema`, `noInputSchema`).
- Worker gold standard: `src/schemas/worker/contactExtraction.ts` (lazySchema + `z.discriminatedUnion("type", [...])` + inferred types).
- `background.ts`: `win` declared :94, created :297; `isDevelopment` :53; `MAIN_WINDOW_VITE_DEV_SERVER_URL` global :54, used :406/:410; `before-quit` :516.

---

## 2. Wave 1 — MVP (implemented this session)

### WS-0 — Supply-chain & repo hygiene ✅ COMPLETE

Committed in `c446eb99` + `c17d437c`. Verified: `node_modules/crypto` and `node_modules/sqlite3` absent; lockfile clean; `.env*` ignored (`.env.example` kept); no tracked timestamp files; forge config syntax valid. (Kept `vite.buckEmail.config.mjs` — `src/buckEmail.ts` is a real disabled entry. Deferred `keytar`/`vuex`/`vue-class-component` removal to WS-1/WS-6 per PRD R0.6.)

---

### WS-1 — Security hardening (safe subset)

> **Scope decision:** R1.1 (secret encryption) is the highest-risk item because `Token` already uses `CryptoSource`. We ship the `SecureStore` (safeStorage) adapter **with tests** and **feature-flagged off by default** (`AIFETCHLY_ENCRYPT_STORE=1` to enable), plus a CryptoSource-aware migration path. Full cutover is a follow-up once the flag soaks. R1.2/R1.4/R1.6/R1.8 are low-risk and land now. R1.3 (sandbox) lands as an audited decision + explicit flag, not a blind flip. R1.5 (raw→validated) lands a few high-value handlers as exemplars; the rest are a tracked follow-up.

**Files:** `src/modules/SecureStore.ts` (new), `src/modules/electronstoreservice.ts`, `src/background.ts`, `src/preload.ts`, `src/controller/SearchController.ts`, `src/views/api/sessionRecording.ts`, `src/schemas/ipc/contactExtraction.ts` (new), `src/main-process/communication/contactExtraction-ipc.ts`, `.eslintrc.json`, `docs/adr/`.

#### Task WS-1.1 — `SecureStore` adapter (safeStorage) + tests  [feature-flagged]

**Files:** Create `src/modules/SecureStore.ts`; Test `test/vitest/main/modules/SecureStore.test.ts`.

- [ ] **Step 1: Write failing test** — encrypt/decrypt round-trip; sensitive-key detection (`token`/`cookie`/`apikey`); plaintext-fallback for pre-migration values; `safeStorage` unavailable path.
- [ ] **Step 2: Run → FAIL** (`vitest --config vite.main.config.mjs test/vitest/main/modules/SecureStore.test.ts`).
- [ ] **Step 3: Implement `SecureStore`** per tech-design §5.1.1 — wraps `electron-store`, encrypts sensitive keys with `safeStorage.encryptString()` → base64; `getValue` decrypts-or-falls-back; `migratePlaintextValues()`. **Note:** existing `Token` values are CryptoSource-encrypted JSON, so the migration must treat already-encrypted base64 as "leave to Token" and only re-wrap when appropriate — the flag stays off until this is validated against a real user store.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(ws-1): add SecureStore (safeStorage) adapter with migration + tests`.

#### Task WS-1.2 — Navigation guards (`will-navigate` / `will-redirect`)

**Files:** Modify `src/background.ts` (near window creation, after :315); Test `test/vitest/main/background.navigation.test.ts`.

- [ ] **Step 1: Write failing test** — `isTrustedNavigation("https://evil.example")` → false; `file://...` and dev-origin → true; `app://` → true.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — extract `isTrustedNavigation(url)` (pure), register `webContents.on("will-navigate")` + `("will-redirect")` on `win` that `preventDefault()` + `log.warn` for untrusted origins. Mirror the guard in `setWindowOpenHandler`'s override path (background.ts:372) — deny non-trusted URLs instead of the current blanket `allow`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(ws-1): add navigation guards (will-navigate/will-redirect) + harden setWindowOpenHandler`.

#### Task WS-1.3 — `exec` → `execFile` (argv) in SearchController

**Files:** Modify `src/controller/SearchController.ts` (import :16; call sites :792, :825, :837, :918).

- [ ] **Step 1: Write failing test** — `killProcessByPID` calls `execFile` with `["-9", String(pid)]` (posix) / `["/PID", String(pid), "/F"]` (win32); no shell, no template interpolation.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — `import { execFile } from "node:child_process"`; helper `killPid(pid)` using `execFile(cmd, args, cb)`; replace all 4 `exec(\`...${pid}...\`)` sites. `pid` is already `number` (typed) — defense-in-depth.
- [ ] **Step 4: Run → PASS; `grep -nE "exec\(\\\`" src/controller/SearchController.ts` → clean.**
- [ ] **Step 5: Commit** `fix(ws-1): replace exec string interpolation with execFile argv in SearchController`.

#### Task WS-1.4 — Gate preload payload logging behind dev

**Files:** Modify `src/preload.ts` (lines 378, 380, 387, 389).

- [ ] **Step 1:** Add `const isDev = process.env.NODE_ENV !== "production";` at top (matches `background.ts:53`); wrap the 4 `console.log("send"…)` calls in `if (isDev)`. Prefer removing the pre-whitelist logs (378/387) entirely; keep post-whitelist (380/389) dev-gated.
- [ ] **Step 2:** `grep -n "console.log" src/preload.ts` → only dev-gated.
- [ ] **Step 3: Commit** `fix(ws-1): gate IPC payload logging in preload behind NODE_ENV`.

#### Task WS-1.5 — Forbid direct `ipcRenderer` in renderer + migrate the one caller

**Files:** Modify `src/views/api/sessionRecording.ts`; `.eslintrc.json`.

- [ ] **Step 1:** Replace `import { ipcRenderer } from 'electron'` in `sessionRecording.ts` with the preload `window.api` equivalent (or `windowInvoke`).
- [ ] **Step 2:** Add `no-restricted-imports` to `.eslintrc.json` forbidding `{ ipcRenderer }` from `electron` for `src/views/**` (per tech-design §5.7.1).
- [ ] **Step 3:** `grep -rn "ipcRenderer" src/views` → empty.
- [ ] **Step 4: Commit** `feat(ws-1): forbid direct ipcRenderer in renderer; migrate sessionRecording`.

#### Task WS-1.6 — Migrate `contactExtraction-ipc` onto `registerValidatedHandler` (exemplar)

**Files:** Create `src/schemas/ipc/contactExtraction.ts`; Modify `src/main-process/communication/contactExtraction-ipc.ts` (raw `.handle` at :372, :453, :480 use `JSON.parse(request) as ContactExtractionRequest`).

- [ ] **Step 1:** Define `lazySchema` input schemas for the 3 channels; add parse tests.
- [ ] **Step 2:** Convert each `ipcMain.handle` to `registerValidatedHandler(channel, schema, async (input) => …)`; drop `JSON.parse` + `as`.
- [ ] **Step 3:** Run the IPC vitest suite (`test/vitest/main/ipc/`) → green.
- [ ] **Step 4: Commit** `refactor(ws-1): migrate contactExtraction-ipc to registerValidatedHandler`.
- [ ] **Follow-up (tracked, not this session):** `ai-chat-v2-ipc` (17), `sync-msg` (11), `ai-user-memory-ipc` (7), `ai-workspace-ipc` (6), `userIpc`, `websocket-ipc`, `async-msg`, + the mixed files' raw `.on` handlers. ~50 handlers total.

#### Task WS-1.7 — ADRs + sandbox decision

- [ ] Seed `docs/adr/0001-secret-storage-safestorage.md` (ADR-1), `docs/adr/0003-main-window-sandbox.md` (ADR-3: enable-or-document).
- [ ] Audit `preload.ts` for Node-builtin usage; if sandbox-safe, set `sandbox: true` in `webPreferences` (background.ts:303) and verify dev launch; else document compensating control in ADR-3 and file follow-up.

---

### WS-2 — CI test gate & coverage foundation

**Files:** `package.json`, `vite.main.config.mjs`, `vite.utilityCode.config.mjs`, `vite.taskCode.config.mjs`, `.github/workflows/build.yml`, `docs/test-coverage-baseline.md`.

#### Task WS-2.1 — Coverage tooling + config

- [ ] **Step 1:** `yarn add --dev @vitest/coverage-v8`.
- [ ] **Step 2:** Add `test.coverage` (provider `v8`, reporters `text`/`html`/`lcov`, `include src/**`, `exclude` tests/fixtures/mocks) to `vite.main.config.mjs`, `vite.utilityCode.config.mjs`, `vite.taskCode.config.mjs` (per tech-design §5.2.1).
- [ ] **Step 3:** Run `yarn testmain --coverage` → produces `coverage/`.
- [ ] **Step 4: Commit** `feat(ws-2): add @vitest/coverage-v8 + coverage config`.

#### Task WS-2.2 — Unified `test:ci` command

- [ ] **Step 1:** Add scripts: `"test:ci": "yarn test && yarn testmain && yarn vitest --config vitest.service.config.mjs"`, `"test:coverage": "yarn testmain --coverage"`. Keep `yarn test` (mocha) for the inner loop.
- [ ] **Step 2:** Run `yarn test:ci` locally → green (or quarantine flaky via `continue-on-error`).
- [ ] **Step 3: Commit** `feat(ws-2): add unified yarn test:ci command`.

#### Task WS-2.3 — CI test job (before packaging)

- [ ] **Step 1:** Add a `test` job to `.github/workflows/build.yml` (ubuntu, node 20.19.3, `yarn install --frozen-lockfile`, `yarn test:ci`, upload `coverage/` artifact). Initially `continue-on-error: true`; ratchet to hard after green.
- [ ] **Step 2:** Preserve the tsc gate — CI must NOT use `AIFETCHLY_SKIP_TSC=1`.
- [ ] **Step 3: Commit** `ci(ws-2): run full test suite + coverage on every PR`.

#### Task WS-2.4 — Baseline + graduated gate doc

- [ ] **Step 1:** Measure per-directory coverage; record in `docs/test-coverage-baseline.md`.
- [ ] **Step 2:** Document the graduated gate (global floor = baseline − 2%; diff-coverage 80% on changed lines; quarterly ratchet) — ADR-4.

---

## 3. Waves 2–4 — Roadmap (each gets its own detailed plan when started)

> These require WS-2 green first. Each is incremental (one PR per unit). Full TDD task breakdowns are written when the workstream is started; below is the approach, first step, and risk.

### WS-3 — Database integrity (L, high risk on R3.1)
**First step:** generate baseline migration; gate `synchronize` to `NODE_ENV!=='production'`; `migrationsRun` in prod; pre-migration DB backup + restore-on-error (tech-design §5.3.1, ADR-7). Then consolidate `*db.ts` → `.model.ts` one-per-PR; centralize `WORKER_TYPE` guard in `BaseDb`; make `SqliteDb.getInstance` path-immutable; clean `SqliteVecDatabase.ts` (`as any` → typed `BetterSqlite3Driver`, identifier allowlist). **Must:** test up+down on a copy of a real user DB.

### WS-4 — Worker reliability & contract unification (L)
Delete `ChildProcessManager.ts`/`ChildProcessScraper.ts`; add `WorkerRestartPolicy` (bounded restarts + circuit-break); mirror `LocalEmbeddingWorker` fatal handling in `ContactExtractionWorker` (drain + `worker-fatal` + exit); persist queue / main re-queue on boot; wire `before-quit` cleanup; unify contract in `src/schemas/worker/_shared.ts` + `workerMessageRouter.ts`; `WorkerCoordinator` budget (ADR-8/9). Crash-recovery tests gate each step.

### WS-5 — Module-layer health (L)
Make `BaseModule` lazy (no I/O in ctor — unblocks testing) first; constructor-injection-with-defaults for the ~7 hubs (`TaskExecutorService`, `YellowPagesOrchestrator`, `YellowPagesProcessManager`, `RagSearchModule`, …) (ADR-10); adopt `AppError` + delete `customError.ts` + lint raw throws (ADR-2); consolidate to 3 platform factories; prune dead interfaces; split god modules one-PR-each (≤400 lines, lint `max-lines`).

### WS-6 — Frontend migration completion (L)
Port `user`/`permission`/`settings`/`error-log`/`app` Vuex-class-modules → setup-style Pinia (preserve auth-token + permission-route logic; parity tests + UAT); drop `vuex`/`vuex-module-decorators`/`vue-class-component`/`vue-template-compiler`; retire v1 AI chat behind a parity checklist; split god components; consolidate API layer through `windowInvoke` + `useApiCall` composable; derive renderer types from Zod. Keep 6-language i18n parity.

### WS-7 — Type & logging discipline (M)
Codemod `console.*` → `Logger` + `no-console` eslint (allow `Logger.ts`); flip `noImplicitAny`/`strictPropertyInitialization`/`noImplicitThis` per-directory; un-mock `electron-store` via `tsconfig.test.json`; reconcile Zod version (ADR-5). Incremental; fix-forward.

### WS-8 — Architecture docs reconciliation (S, ongoing)
Update CLAUDE.md to the four-layer reality (IPC → **Service** or **Module** → Model → Entity → DB) + "where does new code go?" rule; fix inaccurate claims (worker guard per WS-3, `zod/v4` per WS-7, `src/api/`→`src/views/api/` per WS-6); seed `docs/adr/` (ADR-1…10). Update as each workstream ships.

---

## 4. Cross-cutting rules (apply to every task)

- **TDD:** test first (RED) → minimal impl (GREEN) → refactor. Changed-line coverage ≥ 80%.
- **Commits:** conventional (`feat`/`fix`/`refactor`/`chore`/`ci`/`docs`/`test`); one logical unit per commit; no attribution (per user global setting).
- **i18n:** any new/changed UI string → all 6 language files.
- **Boundaries:** IPC handlers stay thin (validate → Service/Module → envelope); workers never touch DB; DB path via `Token`/`USERSDBPATH`.
- **Immutability:** new objects, never in-place mutation.

---

## 5. Self-review notes

- **Spec coverage:** WS-0 (R0.1–R0.5) ✅; WS-1 R1.1/R1.2/R1.3/R1.5(exemplar)/R1.6/R1.8 covered, R1.4(sandbox)=decision, R1.7(worker token)=documented-safe, R1.5 remainder=tracked follow-up; WS-2 R2.1–R2.6 covered. WS-3…WS-8 = roadmap (each needs its own plan).
- **PRD corrections** baked into §1 so future work does not re-litigate or trust stale file:line refs.
- **Honest deferrals:** R1.1 full cutover, R1.3 sandbox flip, R1.5 ~50 raw handlers, and all of WS-3…WS-8 are explicitly out of this session's MVP and given a concrete next step.
