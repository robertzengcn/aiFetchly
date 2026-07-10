# Workspace Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable, workspace-scoped memory layer for AI Chat V2, keyed by a stable `workspaceKey`, stored in SQLite via the existing Model/Module/IPC layering, with manual CRUD, deterministic retrieval + prompt injection, a UI panel, and a workspace-aware auto-dream consolidator.

**Architecture:** Renderer → IPC handler → Service → Module → Model → TypeORM Entity → SQLite. Every privileged operation resolves `workspaceKey` in the main process from the conversation's approved workspace; renderer-supplied keys are display hints only. Workspace memory is a separate table from `ai_user_memories` and never falls back to global memory.

**Tech Stack:** TypeScript 5.x, Electron (main + renderer), TypeORM, better-sqlite3, Vue 3 + Vuetify + Pinia, vue-i18n. Node `crypto`/`fs`/`child_process` for key resolution. No vector search in v1 (deterministic keyword scoring only).

**Source docs:**
- PRD: `docs/prd/workspace-memory-prd.md`
- Technical design (contains full code for most files): `docs/prd/workspace-memory-technical-design.md`

---

## Locked codebase-specific decisions (from exploration)

These are facts the technical design doc assumes but does not state; they were confirmed by reading the actual sibling files. **Follow these exactly.**

1. **Base class imports (casing matters):**
   - `import { BaseDb } from "@/model/Basedb";` — file is `Basedb.ts` (lowercase `db`), exported class is `BaseDb`.
   - `import { BaseModule } from "@/modules/baseModule";` — file is `baseModule.ts` (lowercase).
   - `import AuditableEntity from "./Auditable.entity";` — **default** import, not named.
   - `import { Order } from "./order.decorator";`
2. **Model constructor:** `constructor(dbpath: string) { super(dbpath); this.repository = this.sqliteDb.connection.getRepository(TheEntity); }`
3. **Module constructor:** `extends BaseModule`; `this.dbpath` is inherited; `this.memoryModel = new TheModel(this.dbpath);`
4. **Memory-ID generation (in the module, not model):** `wmem-${randomUUID()}` via `import { randomUUID } from "node:crypto";`. Runs use `wrun-${randomUUID()}`.
5. **TypeORM update with simple-json columns:** cast `updates as unknown as never` to satisfy `QueryDeepPartialEntity` (mirror `AIUserMemoryModel.updateByMemoryId`).
6. **Worker guard (safety net in model repository getter):**
   ```ts
   if (process.env.WORKER_TYPE) {
     throw new Error("Direct database access from worker process is not allowed. Worker should send data to main process via IPC.");
   }
   ```
7. **IPC helpers are copy-pasted per file** (NOT imported from a shared module). Copy `ok` / `denied` / `safeParse` / `isAIEnabled` + singleton getter + `_reset...ForTesting` from `ai-user-memory-ipc.ts` verbatim.
8. **AI gate placement:** manual CRUD handlers are NOT AI-gated (mirrors `ai-user-memory-ipc.ts` — only `RUN_AUTO_DREAM` and the natural-language "remember this" extraction check `isAIEnabled()`). Manual memory management must work without an AI subscription.
9. **Frontend API pattern:** mirror `src/views/api/aiUserMemory.ts` (self-contained, returns full `CommonMessage<T>` envelope, local `CH` constants, `JSON.stringify` string args). Do NOT use `windowInvoke`.
10. **Preload allowlist requires TWO edits** in `src/preload.ts`: the channel import block (~line 323) AND the `validChannels` array inside `invoke` (~line 824). Forgetting the second makes calls silently return `undefined`.
11. **`SqliteDb.ts`:** add the entity import near line 55 AND append to the `entities: [...]` array near line 498. `synchronize: true` → no migration script needed; tables auto-create on boot.
12. **Channel naming:** use the colon style `ai:workspace-memory:*` (matches the `ai:user-memory:*` memory sibling, not the `ai-workspace:*` kebab style).
13. **`Token` / `USER_AI_ENABLED`:** `new Token().getValue(USER_AI_ENABLED) === "true"` (strict string equality; unset → `""` → disabled).
14. **Settings default-on semantics:** read via `SystemSettingModule.getSettingValue(key)`; treat as enabled when `value !== "false"` (absent row = enabled).
15. **Context assembly injection point:** in `AIChatContextAssembler.assemble()`, push the workspace-memory system message **between** the "Active workspace" block (step 3) and the "Durable user memory" block (step 4). Wrap in try/catch; failure degrades to empty (never breaks chat).
16. **Tokenization (mirror `AIUserMemoryRetrievalService`):** `lower.split(/[^a-z0-9]+/)` keeping tokens with `length >= 3`.
17. **Secret filter caveat:** the existing broad pattern `/[A-Za-z0-9+/]{40,}={0,2}/` will flag long base64/URLs/hashes. For workspace memory (which legitimately references paths/SHAs), reuse the existing `SECRET_PATTERNS` set but **do not** add more aggressive patterns. Document this trade-off in code comments.
18. **Auto-dream trigger points:** `AIChatQueryEngine.ts:~697` (post chat turn) and `AgentRuntime.ts:~372` (post agent task). Both are fire-and-forget (`.catch` only).
19. **Lock isolation:** `AIWorkspaceAutoDreamService` gets its OWN `inFlight` field (do not share with user-memory auto-dream — they must run independently).
20. **No Zod** in the memory stack; use hand-rolled `isX(v: unknown): v is X` type guards (union + `as const` array + `.includes`).

---

## File map

### New files (24)

**Phase 1 — schema + CRUD + key resolution (9):**
- `src/entity/AIWorkspaceMemory.entity.ts`
- `src/entityTypes/aiWorkspaceMemoryTypes.ts`
- `src/model/AIWorkspaceMemory.model.ts`
- `src/modules/AIWorkspaceMemoryModule.ts`
- `src/service/WorkspaceKeyService.ts`
- `src/service/WorkspaceMemoryContextResolver.ts`
- `src/service/AIWorkspaceMemoryService.ts`
- `src/main-process/communication/ai-workspace-memory-ipc.ts`
- `src/views/api/aiWorkspaceMemory.ts`

**Phase 2 — retrieval + injection (1):**
- `src/service/AIWorkspaceMemoryRetrievalService.ts`

**Phase 3 — UI (3):**
- `src/views/components/aiChatV2/WorkspaceMemoryPanel.vue`
- `src/views/components/aiChatV2/WorkspaceMemoryEditorDialog.vue`
- `src/views/components/aiChatV2/WorkspaceMemoryStatusBadge.vue`

**Phase 4 — auto-dream (5 + shared helper):**
- `src/entity/AIWorkspaceMemoryConsolidationRun.entity.ts`
- `src/model/AIWorkspaceMemoryConsolidationRun.model.ts`
- `src/modules/AIWorkspaceMemoryConsolidationRunModule.ts`
- `src/service/AIWorkspaceAutoDreamService.ts`
- `src/service/AIWorkspaceAutoDreamPromptBuilder.ts`
- `src/service/MemorySecretFilter.ts` (shared — also reused by user-memory parser if low-risk)

**Tests (6):**
- `test/vitest/utilitycode/WorkspaceKeyService.test.ts`
- `test/vitest/main/modules/AIWorkspaceMemoryModule.test.ts`
- `test/vitest/main/AIWorkspaceMemoryRetrievalService.test.ts`
- `test/vitest/main/AIWorkspaceAutoDreamPromptBuilder.test.ts`
- `test/vitest/main/ai-workspace-memory-ipc.test.ts`
- `test/vitest/main/AIChatContextAssemblerWorkspaceMemory.test.ts`

### Modified files (14)

- `src/config/SqliteDb.ts` — register 2 entities
- `src/config/channellist.ts` — add 7 channel constants
- `src/config/settinggroupInit.ts` — add 3 setting constants + 3 items in `ai_preferences`
- `src/preload.ts` — allowlist 7 channels (2 places)
- `src/main-process/communication/index.ts` — register handler
- `src/service/WorkspaceResolver.ts` — add `resolveWithKey`
- `src/service/AIChatContextAssembler.ts` — inject workspace memory block + result fields
- `src/service/AIAutoDreamFactory.ts` — add `getSharedWorkspaceAutoDreamService`
- `src/service/AIAutoDreamSourceCollector.ts` — add workspace context to packets
- `src/service/AIChatQueryEngine.ts` — fire workspace auto-dream after chat turn
- `src/service/AgentRuntime.ts` — fire workspace auto-dream after agent task (via deps)
- `src/service/AgentRuntimeRegistry.ts` — pass workspace auto-dream dep
- `src/views/components/aiChatV2/WorkspaceBadge.vue` — add "Memory" action
- `src/views/components/aiChatV2/AiChatV2.vue` — mount panel, refresh on conversation change
- `src/views/lang/{en,zh,es,fr,de,ja}.ts` — add `workspaceMemory` section + 3 setting description keys

---

## Phase 1: Schema + manual CRUD + workspace key resolution

**Acceptance:** CRUD works for an approved workspace; CRUD fails (structured error) when no workspace is approved; isolation tests prove memories cannot cross `workspaceKey`.

### Task 1.1: Entity types

**Files:** Create `src/entityTypes/aiWorkspaceMemoryTypes.ts`

- [ ] **Step 1:** Create the file with the full content from technical-design §6 (types, `as const` arrays, `isAIWorkspaceMemoryType` / `isAIWorkspaceMemoryStatus` / `isAIWorkspaceMemorySourceKind` guards mirroring `aiUserMemoryTypes.ts`). Taxonomy: `project | decision | workflow | convention | reference | warning`. Status: `active | archived | contradicted`. SourceKind: `manual | chat_v2 | agent_task | auto_dream`. Include `AIWorkspaceMemoryView`, `AIWorkspaceMemoryCreateInput` (with `conversationId`), `AIWorkspaceMemoryUpdateInput` (with `conversationId`), `AIWorkspaceMemorySearchInput` (with `conversationId`), `AIWorkspaceMemoryInjectionResult`. Add `AIWorkspaceMemoryConsolidationRunView` + `AIWorkspaceAutoDreamStatusView` (mirror the user-memory equivalents, with `workspaceKey?` on the run view) — needed by Phase 4 but cheap to add now.
- [ ] **Step 2:** `yarn vue-check` (or `yarn tsc`) — confirm no type errors.

### Task 1.2: Entity

**Files:** Create `src/entity/AIWorkspaceMemory.entity.ts`; Modify `src/config/SqliteDb.ts`

- [ ] **Step 1:** Create the entity exactly as technical-design §5.1 (table `ai_workspace_memories`, the 8 indexes including composite `workspaceKey, status` and `workspaceKey, type`, all columns with `@Order(n)`). `extends AuditableEntity` (default import).
- [ ] **Step 2:** In `src/config/SqliteDb.ts`, add `import { AIWorkspaceMemoryEntity } from "@/entity/AIWorkspaceMemory.entity";` next to the `AIUserMemoryEntity` import (~line 54), and append `AIWorkspaceMemoryEntity,` to the `entities: [...]` array next to `AIUserMemoryEntity` (~line 497).
- [ ] **Step 3:** `yarn tsc` — confirm compilation. (Table auto-creates on next app boot via `synchronize: true`.)

### Task 1.3: Model

**Files:** Create `src/model/AIWorkspaceMemory.model.ts`

- [ ] **Step 1:** Create `AIWorkspaceMemoryModel extends BaseDb` mirroring `AIUserMemoryModel`, with these differences:
  - Constructor: `super(dbpath); this.repository = this.sqliteDb.connection.getRepository(AIWorkspaceMemoryEntity);`
  - `AIWorkspaceMemoryCreateFields` includes `workspaceKey: string` and `workspaceRoot: string`.
  - **Every** update/delete/get-by-id method takes `workspaceKey` as the first arg AND includes it in the WHERE clause (`getByWorkspaceAndMemoryId`, `updateByWorkspaceAndMemoryId`, `archive(workspaceKey, memoryId)`, `deleteByWorkspaceAndMemoryId`, `markUsed(workspaceKey, memoryIds, usedAt)`). This is the cross-scope safety net.
  - `listActiveForRetrieval(workspaceKey, limit)` filters `where: { workspaceKey, status: "active" }`, `order: { updatedAt: "DESC" }`, `take: Math.max(1, Math.min(limit, 200))`.
  - `list(input)` uses QueryBuilder with `where m.workspaceKey = :workspaceKey` plus optional query/type/status filters, `ESCAPE '\\'` on LIKE, `clampLimit`.
  - Worker guard at the top of the repository getter (decision #4/#6) — throw if `process.env.WORKER_TYPE`.
  - `updateByWorkspaceAndMemoryId` uses the `as unknown as never` cast for the partial (decision #5).
- [ ] **Step 2:** `yarn tsc`.
- [ ] **Step 3:** Commit: `feat: add AIWorkspaceMemory entity, types, and model`

### Task 1.4: Module

**Files:** Create `src/modules/AIWorkspaceMemoryModule.ts`

- [ ] **Step 1:** Create `AIWorkspaceMemoryModule extends BaseModule` mirroring `AIUserMemoryModule` with these differences:
  - Define `export interface WorkspaceMemoryScope { readonly workspaceKey: string; readonly workspaceRoot: string; }`.
  - Every public method takes `scope: WorkspaceMemoryScope` as the first arg.
  - `createMemory(scope, input)` generates `memoryId: \`wmem-${randomUUID()}\``, validates via `isAIWorkspaceMemory*` guards, clamps confidence, enforces length caps (`MIN_TITLE_LEN=1`, `MAX_TITLE_LEN=200`, `MAX_CONTENT_LEN=8000`, `MAX_SOURCE_MESSAGE_IDS=100`), rejects secret-like content via `MemorySecretFilter.looksSecretlike(title) || MemorySecretFilter.looksSecretlike(content)` (block both manual + automatic — decision from tech design §8.3). **Note:** `MemorySecretFilter` is created in Phase 4; for Phase 1, create a minimal `src/service/MemorySecretFilter.ts` NOW with just `looksSecretlike(s: string): boolean` so the module compiles. Phase 4 extends it.
  - Defaults: `status: "active"`, `confidence: 100` when not provided, `sourceKind: "manual"` when input fails the guard.
  - `toView(e)` converts entity → `AIWorkspaceMemoryView` (ISO-stringify dates, default `createdAt`/`updatedAt` to `new Date(0).toISOString()`).
- [ ] **Step 2:** Create minimal `src/service/MemorySecretFilter.ts`:
  ```ts
  const SECRET_PATTERNS: RegExp[] = [
    /sk-[A-Za-z0-9]{10,}/,
    /api[_-]?key/i,
    /access[_-]?token/i,
    /refresh[_-]?token/i,
    /password/i,
    /cookie/i,
    /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    /[A-Za-z0-9+/]{40,}={0,2}/, // NOTE: aggressive — may flag long base64/URLs/hashes; acceptable for v1 secret blocking.
  ];
  export function looksSecretlike(s: string): boolean {
    if (!s) return false;
    return SECRET_PATTERNS.some((re) => re.test(s));
  }
  ```
- [ ] **Step 3:** `yarn tsc`.
- [ ] **Step 4:** Write `test/vitest/main/modules/AIWorkspaceMemoryModule.test.ts` — unit-test create/list/update/archive/delete using the real module against a temp DB (mirror how `AIUserMemoryModule` is exercised). Cover: create validates type; update cannot affect a memory in another `workspaceKey` (pass wrong scope → returns not-found / 0 affected); archive then list-active excludes it; secret-like content throws. Use `_resetAIUserMemorySingletonsForTesting`-style resets if needed; prefer constructing the module directly (`new AIWorkspaceMemoryModule()`).
- [ ] **Step 5:** Run `AIFETCHLY_SKIP_TSC=1 yarn testmain --run AIWorkspaceMemoryModule.test.ts` — expect PASS (skip TSC only during tight inner loops; the full gate runs later).
- [ ] **Step 6:** Commit: `feat: add AIWorkspaceMemoryModule with workspace-scoped CRUD`

### Task 1.5: WorkspaceKeyService

**Files:** Create `src/service/WorkspaceKeyService.ts`; Test `test/vitest/utilitycode/WorkspaceKeyService.test.ts`

- [ ] **Step 1:** Write the failing test first (TDD RED):
  ```ts
  import { describe, expect, it, vi } from "vitest";
  import * as fs from "node:fs/promises";
  import { WorkspaceKeyService } from "@/service/WorkspaceKeyService";

  describe("WorkspaceKeyService", () => {
    it("derives a stable ws_ key from a canonical path", async () => {
      vi.spyOn(fs, "realpath").mockResolvedValue("/tmp/repo" as never);
      // mock spawnSync to return a git root
      const svc = new WorkspaceKeyService(() => "/tmp/repo"); // inject git-root finder for tests
      const r = await svc.resolve("/some/input");
      expect(r.workspaceKey).toMatch(/^ws_[a-f0-9]{32}$/);
      expect(r.canonicalRootPath).toBe("/tmp/repo");
      expect(r.gitRootDetected).toBe(true);
    });
    it("falls back to real path when git is unavailable", async () => {
      vi.spyOn(fs, "realpath").mockResolvedValue("/tmp/plain" as never);
      const svc = new WorkspaceKeyService(() => null);
      const r = await svc.resolve("/tmp/plain");
      expect(r.canonicalRootPath).toBe("/tmp/plain");
      expect(r.gitRootDetected).toBe(false);
    });
    it("hash is deterministic for the same canonical path", () => {
      const svc = new WorkspaceKeyService(() => null);
      expect(svc.hashWorkspacePath("/a/b")).toBe(svc.hashWorkspacePath("/a/b"));
      expect(svc.hashWorkspacePath("/a/b")).not.toBe(svc.hashWorkspacePath("/a/c"));
    });
  });
  ```
  Run → expect FAIL (module not found).
- [ ] **Step 2:** Implement `WorkspaceKeyService` per technical-design §4.3, but **make the git-root finder injectable** for testing: constructor takes an optional `findGitRoot?: (realPath: string) => string | null` defaulting to the real `spawnSync("git", [...])` implementation. `resolve(rootPath)` does `fs.realpath` → `findGitRoot(realInput) ?? realInput` → hash. `hashWorkspacePath` is public + pure (uses `node:crypto` sha256, slice 32, `ws_` prefix). Uses argument arrays for spawnSync (never a shell string).
- [ ] **Step 3:** Run the test → expect PASS.
- [ ] **Step 4:** Commit: `feat: add WorkspaceKeyService for stable workspace identity`

### Task 1.6: WorkspaceResolver.resolveWithKey + WorkspaceMemoryContextResolver

**Files:** Modify `src/service/WorkspaceResolver.ts`; Create `src/service/WorkspaceMemoryContextResolver.ts`

- [ ] **Step 1:** In `WorkspaceResolver.ts`, export a new interface `ResolvedWorkspaceWithKey` (technical-design §4.2) and add `async resolveWithKey(conversationId: string): Promise<ResolvedWorkspaceWithKey | null>` (technical-design §4.4). Returns `null` when no conversation, no record, or `approvalState !== "approved"`. Uses `new WorkspaceModule().getActiveWorkspace(conversationId)` and `new WorkspaceKeyService().resolve(record.rootPath)`.
- [ ] **Step 2:** Create `WorkspaceMemoryContextResolver` per technical-design §9.1 — `resolveForConversation(conversationId)` returns `WorkspaceMemoryContext | null`.
- [ ] **Step 3:** `yarn tsc`.
- [ ] **Step 4:** Commit: `feat: add workspace key resolution to WorkspaceResolver`

### Task 1.7: AIWorkspaceMemoryService

**Files:** Create `src/service/AIWorkspaceMemoryService.ts`

- [ ] **Step 1:** Create the service per technical-design §9.2. It holds a `WorkspaceMemoryContextResolver` and `AIWorkspaceMemoryModule`; each public method calls `requireContext(input.conversationId)` (throws `Error("Choose an approved workspace before using workspace memory.")` when null) then delegates to the module with the resolved scope. Public methods: `list`, `createManualMemory` (forces `sourceKind: "manual"`), `update`, `archive`, `delete`. `requireContext` is private.
- [ ] **Step 2:** `yarn tsc`.
- [ ] **Step 3:** Commit: `feat: add AIWorkspaceMemoryService conversation-aware facade`

### Task 1.8: Channels + preload + settings

**Files:** Modify `src/config/channellist.ts`, `src/preload.ts`, `src/config/settinggroupInit.ts`, all 6 `src/views/lang/*.ts`

- [ ] **Step 1:** In `channellist.ts`, append under a new `// Workspace Memory` section (colon style):
  ```ts
  export const AI_WORKSPACE_MEMORY_LIST = "ai:workspace-memory:list";
  export const AI_WORKSPACE_MEMORY_CREATE = "ai:workspace-memory:create";
  export const AI_WORKSPACE_MEMORY_UPDATE = "ai:workspace-memory:update";
  export const AI_WORKSPACE_MEMORY_ARCHIVE = "ai:workspace-memory:archive";
  export const AI_WORKSPACE_MEMORY_DELETE = "ai:workspace-memory:delete";
  export const AI_WORKSPACE_MEMORY_RUN_AUTO_DREAM = "ai:workspace-memory:auto-dream:run";
  export const AI_WORKSPACE_MEMORY_AUTO_DREAM_STATUS = "ai:workspace-memory:auto-dream:status";
  ```
- [ ] **Step 2:** In `preload.ts`, add all 7 constants to BOTH the import block AND the `validChannels` array (decision #10).
- [ ] **Step 3:** In `settinggroupInit.ts`, add 3 constants + 3 toggle items in the `ai_preferences` group (technical-design §11). Values `"1"`, type `"toggle"`, descriptions are i18n keys: `"ai-workspace-memory-injection-description"`, `"ai-workspace-auto-dream-description"`, `"ai-workspace-manual-memory-description"`.
- [ ] **Step 4:** In each of the 6 lang files, add the 3 description keys (English text in `en.ts`, proper translations in zh/es/fr/de/ja) inside the same section that holds `user_ai_auto_dream` / `user_ai_memory_injection`. Add an English fallback string for each. (Full `workspaceMemory` UI section is added in Phase 3, but add these 3 setting-description keys now so settings render.)
- [ ] **Step 5:** `yarn tsc && yarn vue-check`.
- [ ] **Step 6:** Commit: `feat: add workspace memory channels, preload allowlist, and settings`

### Task 1.9: IPC handler + renderer API

**Files:** Create `src/main-process/communication/ai-workspace-memory-ipc.ts`, `src/views/api/aiWorkspaceMemory.ts`; Modify `src/main-process/communication/index.ts`

- [ ] **Step 1:** Create the IPC handler file mirroring `ai-user-memory-ipc.ts`: copy `ok` / `denied` / `safeParse` / `isAIEnabled` + `getWorkspaceMemoryService()` singleton + `_resetAIWorkspaceMemorySingletonsForTesting()`. Register handlers for LIST, CREATE, UPDATE, ARCHIVE, DELETE, RUN_AUTO_DREAM (AI-gated), AUTO_DREAM_STATUS. Each CRUD handler: `safeParse` → require `conversationId` is a string → call service → `ok`/`denied`. RUN_AUTO_DREAM checks `isAIEnabled()` first. (Phase 4 wires the actual auto-dream call; for Phase 1, RUN_AUTO_DREAM can return `denied("not yet implemented")` — but since Phase 4 follows shortly, implement the stub to call `getSharedWorkspaceAutoDreamService().runNow(...)` guarded behind a try/catch. If Phase 4 isn't done yet, return a clear "not available" denied.)
- [ ] **Step 2:** Create `src/views/api/aiWorkspaceMemory.ts` mirroring `aiUserMemory.ts` (pattern A, decision #9): self-contained `api()` + `call<T>()` + local `CH` constants + `workspaceMemoryApi` object with `list`, `create`, `update`, `archive(memoryId, conversationId)`, `delete(memoryId, conversationId)`, `runAutoDream`, `autoDreamStatus`. **Crucial:** every method's input includes `conversationId`; archive/delete take `{ conversationId, memoryId }` and `JSON.stringify` it.
- [ ] **Step 3:** In `index.ts`, add the import and call `registerAIWorkspaceMemoryIpcHandlers();` inside the `try` block (no `win` arg needed).
- [ ] **Step 4:** Write `test/vitest/main/ai-workspace-memory-ipc.test.ts` covering: LIST requires `conversationId`; CREATE requires approved workspace (mock service to throw → `denied`); UPDATE/ARCHIVE/DELETE with a forged `workspaceKey` in the payload is ignored (the service resolves from `conversationId`, never trusts a renderer `workspaceKey`); RUN_AUTO_DREAM checks `isAIEnabled()` before parsing. Mock the service via the singleton reset + module mock.
- [ ] **Step 5:** Run tests → expect PASS.
- [ ] **Step 6:** Commit: `feat: add workspace memory IPC handlers and renderer API`

### Task 1.10: Phase 1 verification

- [ ] **Step 1:** Run `yarn tsc` (full typecheck).
- [ ] **Step 2:** Run `yarn testmain` (full main test gate, including the TSC globalSetup).
- [ ] **Step 3:** Manual sanity: the new table appears on next app boot (deferred to user; covered by `synchronize: true`).
- [ ] **Step 4:** Commit any fixups. Mark Phase 1 done.

---

## Phase 2: Retrieval + context injection

**Acceptance:** workspace memory is injected in the correct order (after active workspace, before durable user memory); cross-workspace leakage tests pass; disabled setting blocks injection; retrieval failure does not fail assembly.

### Task 2.1: AIWorkspaceMemoryRetrievalService

**Files:** Create `src/service/AIWorkspaceMemoryRetrievalService.ts`; Test `test/vitest/main/AIWorkspaceMemoryRetrievalService.test.ts`

- [ ] **Step 1:** Write the failing test first. Cover: (a) returns empty `{memories:[],tokenEstimate:0,contextBlock:""}` when no approved workspace (mock `WorkspaceMemoryContextResolver` → null); (b) retrieves only memories with matching `workspaceKey`; (c) excludes `archived` and `contradicted`; (d) scoring order — a `warning` with keyword overlap outranks a `project` with the same overlap; (e) respects `maxMemories` and `maxTokens` caps; (f) calls `markMemoriesUsed` on selected. Inject the module + resolver via constructor deps for testability.
- [ ] **Step 2:** Implement per technical-design §9.3 + §9.4. Differences from `AIUserMemoryRetrievalService`:
  - `DEFAULT_MAX_MEMORIES = 8`, `DEFAULT_MAX_TOKENS = 1800`, `DEFAULT_CANDIDATE_LIMIT = 200`.
  - Header text = technical-design §9.3 `WORKSPACE_MEMORY_HEADER` (verbatim — includes the conflict-resolution instructions).
  - `TYPE_WEIGHTS`: `warning:10, decision:9, workflow:7, convention:6, reference:5, project:4`.
  - Score formula (decision #16 tokenization): `keywordOverlap*10 + typeWeight + confidenceWeight + recencyWeight + lastUsedWeight`, where title-token overlap = 2/token, content-token overlap = 1/token, `confidenceWeight = Math.round(confidence/20)`, recency = `3`/`2`/`1` for ≤1/7/30 days, lastUsed = `1` if present.
  - Resolve workspace via `WorkspaceMemoryContextResolver`; return empty result (no throw) when null.
  - Use `AIChatTokenEstimator` for token budget (mirror user-memory service).
- [ ] **Step 3:** Run test → expect PASS.
- [ ] **Step 4:** Commit: `feat: add AIWorkspaceMemoryRetrievalService with deterministic scoring`

### Task 2.2: Context assembler integration

**Files:** Modify `src/service/AIChatContextAssembler.ts`; Test `test/vitest/main/AIChatContextAssemblerWorkspaceMemory.test.ts`

- [ ] **Step 1:** Add imports `AIWorkspaceMemoryRetrievalService` and `ai_workspace_memory_injection_enabled` (from `settinggroupInit`). Add field `private readonly workspaceMemory = new AIWorkspaceMemoryRetrievalService();`.
- [ ] **Step 2:** Extend `AIChatContextAssembleResult` with `readonly usedWorkspaceMemory: boolean;` and `readonly workspaceMemoryCount: number;`. Update all return sites (default `false`/`0` except the success path).
- [ ] **Step 3:** Insert the workspace-memory block **between** the "Active workspace" push (step 3) and the durable-memory block (step 4). Gate: read `ai_workspace_memory_injection_enabled` via `SystemSettingModule.getSettingValue`; skip when `=== "false"`. Wrap the whole retrieval in try/catch (decision #15); on error `console.error("[ai-chat-context] workspace memory retrieval failed:", err)` and continue with no block. Set `usedWorkspaceMemory = contextBlock.length > 0` and `workspaceMemoryCount = selected.length`.
- [ ] **Step 4:** Write context-assembler tests covering: workspace memory appears after the active-workspace system message and before the durable-memory system message (assert index ordering in `messages`); no approved workspace → no workspace-memory block and `usedWorkspaceMemory === false`; disabled setting → no block; retrieval throws → assembly still succeeds with `usedWorkspaceMemory === false`.
- [ ] **Step 5:** Run `yarn testmain --run AIChatContextAssemblerWorkspaceMemory.test.ts` → expect PASS. Then full `yarn testmain`.
- [ ] **Step 6:** Commit: `feat: inject workspace memory into AI Chat V2 context before durable memory`

### Task 2.3: Phase 2 verification

- [ ] **Step 1:** `yarn tsc && yarn testmain`.
- [ ] **Step 2:** Mark Phase 2 done.

---

## Phase 3: UI panel + i18n

**Acceptance:** user can list/create/edit/archive/delete from the panel; no-workspace and empty states are clear; all 6 lang files have the `workspaceMemory` keys; injection + auto-dream toggles are reachable.

### Task 3.1: i18n keys (all 6 languages)

**Files:** Modify `src/views/lang/{en,zh,es,fr,de,ja}.ts`

- [ ] **Step 1:** Add a `workspaceMemory` section to each lang file (mirror the existing `workspace` section at line ~2036 of `en.ts`). Keys (English in `en.ts`, translated in others): `title`, `panelTitle`, `noWorkspace`, `empty`, `emptyHint`, `create`, `edit`, `archive`, `delete`, `deleteConfirm`, `search`, `searchPlaceholder`, `typeProject`, `typeDecision`, `typeWorkflow`, `typeConvention`, `typeReference`, `typeWarning`, `statusActive`, `statusArchived`, `statusContradicted`, `source`, `sourceManual`, `sourceChatV2`, `sourceAgentTask`, `sourceAutoDream`, `confidence`, `lastUsedAt`, `updatedAt`, `showArchived`, `injectionEnabled`, `autoDreamEnabled`, `manualMemoryEnabled`, `runAutoDream`, `autoDreamRunning`, `autoDreamFailed`, `autoDreamLastRun`, `save`, `cancel`, `createError`, `deleteSuccess`. Use the `t('workspaceMemory.x') || 'English fallback'` pattern in components.
- [ ] **Step 2:** `yarn vue-check`.
- [ ] **Step 3:** Commit: `feat: add workspaceMemory i18n keys for all supported languages`

### Task 3.2: WorkspaceMemoryEditorDialog + WorkspaceMemoryStatusBadge

**Files:** Create the two components.

- [ ] **Step 1:** `WorkspaceMemoryEditorDialog.vue` — a Vuetify `v-dialog` with form fields: type (`v-select` of the 6 taxonomy types), title (`v-text-field`), content (`v-textarea`), confidence (`v-slider` 0-100), status (`v-select` active/archived/contradicted, edit mode only). Emits `save(input)` / `cancel`. All labels via `t('workspaceMemory.*')`.
- [ ] **Step 2:** `WorkspaceMemoryStatusBadge.vue` — small chip showing memory count + a button to open the panel; shows "auto-dream running" / "failed" states. Props: `count`, `autoDreamStatus`.
- [ ] **Step 3:** `yarn vue-check`.
- [ ] **Step 4:** Commit: `feat: add WorkspaceMemoryEditorDialog and status badge components`

### Task 3.3: WorkspaceMemoryPanel

**Files:** Create `src/views/components/aiChatV2/WorkspaceMemoryPanel.vue`

- [ ] **Step 1:** Build the panel: header with title + create button + "show archived" toggle + search field; a `v-list` of memories (title, type chip, content preview, status, source, updatedAt, lastUsedAt) with edit/archive/delete actions per row; empty state (`workspaceMemory.empty` + `emptyHint`) when no memories; `noWorkspace` state when `activeWorkspace` is null/not approved. Uses `workspaceMemoryApi` (pattern A — check `.status` on each call). Embeds `WorkspaceMemoryEditorDialog` for create/edit and a `v-dialog` confirm for delete. Renders the 3 setting toggles (injection / auto-dream / manual) via the existing system-settings API or local toggles that call a settings endpoint.
- [ ] **Step 2:** `yarn vue-check`.
- [ ] **Step 3:** Commit: `feat: add WorkspaceMemoryPanel with CRUD UX`

### Task 3.4: Wire into AiChatV2 + WorkspaceBadge

**Files:** Modify `src/views/components/aiChatV2/WorkspaceBadge.vue`, `src/views/components/aiChatV2/AiChatV2.vue`

- [ ] **Step 1:** In `WorkspaceBadge.vue`, add a "Memory" action/button that emits `request-open-memory`.
- [ ] **Step 2:** In `AiChatV2.vue`: import `WorkspaceMemoryPanel`; mount it inside `.v2-shell__workspace-panel` (near line ~181, beside `WorkspaceBadge`), controlled by a new `showWorkspaceMemory` ref; handle the `request-open-memory` event from `WorkspaceBadge`; extend `refreshWorkspace(id)` (line ~521) and the `watch(activeConversationId)` (line ~565) to also reset panel state when the conversation changes. Pass `conversationId` and `activeWorkspace` as props.
- [ ] **Step 3:** `yarn vue-check`.
- [ ] **Step 4:** Commit: `feat: mount WorkspaceMemoryPanel in AI Chat V2`

### Task 3.5: Phase 3 verification

- [ ] **Step 1:** `yarn vue-check && yarn tsc`.
- [ ] **Step 2:** Mark Phase 3 done. (Manual UI QA deferred to user per PRD §20.5.)

---

## Phase 4: Workspace auto-dream

**Acceptance:** grouped workspace consolidation works; invalid `workspaceKey` output is rejected by the parser; run status is visible; auto-dream never blocks chat or agent-task completion.

### Task 4.1: Consolidation run entity/model/module

**Files:** Create entity, model, module; Modify `src/config/SqliteDb.ts`

- [ ] **Step 1:** Create `AIWorkspaceMemoryConsolidationRunEntity` per technical-design §5.2 (table `ai_workspace_memory_consolidation_runs`, indexes incl. `workspaceKey`, all count columns default 0). Mirror `AIMemoryConsolidationRunEntity` + add `workspaceKey varchar(100) nullable`.
- [ ] **Step 2:** Register it in `SqliteDb.ts` (import + entities array).
- [ ] **Step 3:** Create the model mirroring `AIMemoryConsolidationRun.model.ts` (`createRunning`, `completeRun`, `failRun`, `getByRunId`, `getLatestSuccessfulRun(workspaceKey?)`, `getRunningRun(workspaceKey?)`, `markStaleRunningFailed`). Methods that scope by workspace take `workspaceKey`.
- [ ] **Step 4:** Create the module mirroring `AIMemoryConsolidationRunModule` (`runId: \`wrun-${randomUUID()}\``, `startRun({workspaceKey, reviewedSince, reviewedThrough})`, `completeRun`, `failRun`, `getByRunId`, `getLatestSuccessfulRun`, `getRunningRun`, `recoverStaleRunningRuns`).
- [ ] **Step 5:** `yarn tsc`.
- [ ] **Step 6:** Commit: `feat: add workspace memory consolidation run entity/model/module`

### Task 4.2: Prompt builder + parser

**Files:** Create `src/service/AIWorkspaceAutoDreamPromptBuilder.ts`; extend `src/service/MemorySecretFilter.ts`; Test `test/vitest/main/AIWorkspaceAutoDreamPromptBuilder.test.ts`

- [ ] **Step 1:** Extend `MemorySecretFilter.ts` with `redactSecrets(s: string): string` (replace matches with `[REDACTED]`) if useful for prompt-building; keep `looksSecretlike` intact. (Low-risk; do NOT refactor the user-memory parser in this PR.)
- [ ] **Step 2:** Write the failing parser test: valid JSON with correct `workspaceKey` passes; invalid `workspaceKey` (not in the provided set) → that item dropped; invalid type → dropped; secret-like content → dropped; `update`/`archive` referencing a `memoryId` not in the active set → dropped; malformed JSON → `ok:false, error`. Provide the `validWorkspaceKeys` set + active memories as inputs.
- [ ] **Step 3:** Implement the prompt builder per technical-design §15.5 + §15.6. `buildWorkspaceAutoDreamSystemPrompt()` uses the technical-design §15.5 text (workspace-specific). `buildWorkspaceAutoDreamUserPrompt({workspaceKey, workspaceRoot, activeMemories, packets})`. `parseWorkspaceAutoDreamModelOutput(raw, validWorkspaceKeys, existing)` returns `{ok, create, update, archive, error?}`. Parser rejects: invalid JSON, invalid type/sourceKind/sourceId, `workspaceKey` not in `validWorkspaceKeys`, title/content over caps, secret-like content, updates/archives for IDs outside the active set. Reuse `MemorySecretFilter.looksSecretlike`.
- [ ] **Step 4:** Run test → expect PASS.
- [ ] **Step 5:** Commit: `feat: add workspace auto-dream prompt builder and parser`

### Task 4.3: Source collector extension

**Files:** Modify `src/service/AIAutoDreamSourceCollector.ts`

- [ ] **Step 1:** Add `WorkspaceAwareAutoDreamSourcePacket extends AutoDreamSourcePacket` with optional `workspace?: { workspaceId, workspaceKey, workspaceRoot, displayName }` (technical-design §15.3). In `collect()`, after building each chat packet, resolve `workspaceResolver.resolveWithKey(convId)` and attach the workspace when present (null when missing). Agent-task packets: only attach workspace if the task already carries a conversationId mapping (do NOT infer from tool paths — tech design §15.3). Export a helper `groupByWorkspace(packets): Map<string, WorkspaceAwareAutoDreamSourcePacket[]>`.
- [ ] **Step 2:** `yarn tsc`. Add/extend a collector test if one exists; otherwise verify via the auto-dream service test in 4.4.
- [ ] **Step 3:** Commit: `feat: attach workspace context to auto-dream source packets`

### Task 4.4: AIWorkspaceAutoDreamService + factory

**Files:** Create `src/service/AIWorkspaceAutoDreamService.ts`; Modify `src/service/AIAutoDreamFactory.ts`; Test

- [ ] **Step 1:** Implement the service mirroring `AIAutoDreamService` (technical-design §15.1, §15.4, §15.7). OWN `inFlight` field (decision #19). `evaluateAfterChatTurn` / `evaluateAfterAgentTask` / `runNow` / `getStatus`. `executeRun` flow: gate on AI-enabled + `ai_workspace_auto_dream_enabled` (default-on) → recover stale → for each workspace group (from `groupByWorkspace`): enforce cooldown + min-sources per group → `startRun({workspaceKey, ...})` → build prompt → model call → parse → apply (archive → update → create via `AIWorkspaceMemoryModule` with the resolved scope) → `completeRun`. Catch → `failRun`. One run record per workspace group. Never throw into chat.
- [ ] **Step 2:** In `AIAutoDreamFactory.ts`, add `getSharedWorkspaceAutoDreamService()` + `_resetSharedWorkspaceAutoDreamServiceForTesting()` mirroring the existing factory (technical-design §15.2). Shares `AiChatApi().openAIChatCompletion` + `USER_AI_ENABLED` check; reads `ai_workspace_auto_dream_enabled` via `SystemSettingModule`.
- [ ] **Step 3:** Wire the RUN_AUTO_DREAM + AUTO_DREAM_STATUS IPC handlers (from Task 1.9) to `getSharedWorkspaceAutoDreamService().runNow({force})` / `.getStatus()` (AI-gated).
- [ ] **Step 4:** Write an auto-dream test covering: groups packets by `workspaceKey`; skips packets with no workspace; parser rejection of invalid `workspaceKey`; failed parse marks run `failed`; success path applies create/update/archive through the module. Mock the model call.
- [ ] **Step 5:** Run `yarn testmain`.
- [ ] **Step 6:** Commit: `feat: add AIWorkspaceAutoDreamService and factory singleton`

### Task 4.5: Trigger integration

**Files:** Modify `src/service/AIChatQueryEngine.ts`, `src/service/AgentRuntime.ts`, `src/service/AgentRuntimeRegistry.ts`

- [ ] **Step 1:** In `AgentRuntimeRegistry.getDefaultAgentRuntimeDeps()`, add `workspaceAutoDreamService: getSharedWorkspaceAutoDreamService()` alongside the existing `autoDreamService`.
- [ ] **Step 2:** In `AgentRuntime.ts:~372`, after the existing `autoDreamService.evaluateAfterAgentTask(...)`, add a fire-and-forget call to `deps?.workspaceAutoDreamService?.evaluateAfterAgentTask(...)` (`.catch` only).
- [ ] **Step 3:** In `AIChatQueryEngine.ts:~697` (and where the engine is constructed in `ai-chat-v2-ipc.ts:~131`), add the workspace service as a second dep and fire `workspaceAutoDreamService.evaluateAfterChatTurn(...)` after the existing user-memory trigger.
- [ ] **Step 4:** `yarn tsc && yarn testmain`.
- [ ] **Step 5:** Commit: `feat: trigger workspace auto-dream after chat turns and agent tasks`

### Task 4.6: Phase 4 + final verification

- [ ] **Step 1:** `yarn tsc && yarn vue-check && yarn testmain` — full gate green.
- [ ] **Step 2:** Verify Definition of Done (technical-design §22): 10 items, all satisfied. Note any deferrals explicitly.
- [ ] **Step 3:** Final commit if any fixups. Mark Phase 4 + plan done.

---

## Self-review notes

- **Spec coverage:** every FR-001…FR-014 maps to a task: key resolution (1.5, 1.6), storage (1.2, 1.3), layering (1.3, 1.4, 1.7, 1.9), manual ops (1.4, 1.7, 1.9, 3.3), retrieval (2.1), injection (2.2), global-interaction boundary (2.1 never falls back; 4.2 parser scopes by key), auto-dream (4.x), attribution (entity columns), contradiction/archival (1.4 archive + 4.2 parser), settings (1.8), UI (3.x), security (1.4 secret block, 1.6 main-process resolution, 1.9 forged-key test, worker guard 1.3), auditability (timestamps + run records 4.1).
- **Type consistency:** `WorkspaceMemoryScope` (1.4) used by 1.7, 2.1, 4.4. `AIWorkspaceMemoryView` (1.1) used everywhere. `wmem-`/`wrun-` prefixes (1.4, 4.1). Channel constants (1.8) consumed by 1.9 + preload. `ResolvedWorkspaceWithKey` (1.6) consumed by 2.1 + 4.3.
- **Placeholder scan:** none — every step has concrete files, code, or commands. Where the technical-design doc already contains full code (entity columns, prompt text), the plan references the section rather than duplicating, because duplicating 1600 lines would itself be a defect.
- **Scope honesty:** Phase 3 UI and Phase 4 auto-dream are large; if time/context runs short, Phases 1+2 deliver a standalone, testable, useful feature (manual workspace memory + injection) that satisfies the core PRD goals. Phase 3 and 4 are additive.
