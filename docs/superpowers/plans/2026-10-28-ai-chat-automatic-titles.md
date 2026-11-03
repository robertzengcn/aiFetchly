# AI Chat Automatic Titles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each new AI chat an automatic lightweight-model-generated title after its first meaningful completed exchange, with durable manual rename that always wins, strict no-fallback provider routing, and shared rename UX (header + sidebar + settings + 6 languages).

**Architecture:** A main-process `AIChatTitleService` consumes nonblocking notifications fired after durable interactive completion (both owners: coordinator dispatch + queue drain). It prepares bounded input via `AIChatConversationModule`, claims one attempt through a CAS `claimTitleAttempt` in `AIChatConversationModel`, dispatches to the pinned provider (hosted `small` alias with `forbid` fallback, or a literal custom `titleModel`), validates output, conditionally commits via `applyGeneratedTitle`, then publishes a revision-guarded `AI_CHAT_WORKSPACE_TITLE_UPDATED` event. Manual rename goes through an atomic column-scoped model write that suppresses generation and bumps `titleRevision`.

**Tech Stack:** Electron main process (TypeScript), TypeORM/better-sqlite3, Vue 3 + Pinia + Vuetify, zod, vitest (main/utilitycode/components), Playwright E2E.

**Source docs:** `docs/prd/ai-chat-automatic-titles-prd.md` (FR-01…FR-10, AC-01…AC-16), `docs/prd/ai-chat-automatic-titles-technical-design.md` (§4 persistence contract, §5 atomic writes, §6 wiring, §7 prompt, §8 routing, §10 IPC).

**Worktree:** `.claude/worktrees/ai-chat-automatic-titles` on branch `worktree-ai-chat-automatic-titles`, based on `dev` (95a6de803). `node_modules` is symlinked from the main checkout.

---

## Verified integration facts (from exploration, 2026-10-28)

- Entity `AIChatConversationEntity` (table `ai_chat_conversations`) has `title varchar(200) null`, `titleIsUserSet boolean default false`. Desktop DB uses `synchronize: true` (new columns auto-create); CLI migration chain in `src/config/dbMigrations.ts` is DORMANT but convention is to register an additive migration anyway.
- Model uses repository methods only (no query builder yet); worker guard `assertMainProcess()` on every method; `BaseDb` constructor takes `dbpath`.
- Full-row saves that must become column-scoped: `AIChatConversationModel.recordMessagePersisted` (update branch), `markRead`, and the post-create repair save inside `AIChatConversationModule.backfillProjections`.
- Completion seams: (a) `AIChatCoordinator.executeDispatch` — durable terminal transition (~line 935) then assistant projection (~939–949); (b) `AIChatTurnQueueService.drainConversation` completed branch (~1271–1304) after `projectTurnResult`. Coordinator `deps.onRunTerminal` already funnels to `notifyExternalTurnTerminal` — do NOT hook there (it lacks assistantMessageId and fires for cancelled/failed).
- Hosted small-alias retry: `AiChatApi.postHostedCompletionWithSmallModelRetry` (private, aiChatApi.ts:2388) retries a 404 once — with `fallbackModel` if set, else DELETES `model` (server default). Omitting `fallbackModel` is NOT strict. Internal request fields (`fallbackModel`, `callBudgetMs`) never serialize (payload builders copy known fields only).
- `OpenAICompatibleProviderClient.resolveModel` maps `small`/`haiku` → `config.defaultModel`; literal IDs pass through. No options bag for internal flags — they ride on the request object.
- `AIProviderConfigVersion` is a poll-on-read counter (`currentProviderConfigVersion()`), already bumped by `AIProviderSettingsService` on every provider change.
- Broadcast: `sharedWorkspaceEventRouter.broadcastSummary(event)` → `webContents.send(AI_CHAT_WORKSPACE_SUMMARY_EVENT, JSON.stringify(event))`. A new event channel must be added to `src/config/channellist.ts` + preload `receive:`/`removeListener:`/`removeAllListeners:` validChannels arrays (three separate arrays).
- Renderer store `chatWorkspace.ts` merges titles in `applySummaryEvent` (`event.title ?? existing?.title ?? ""`) with NO revision guard — this is the race to fix.
- Rename today: header `appPrompt` (generic prompt) → `renameConversation` IPC → `ok({ renamed })` → full `bootstrap()`; errors swallowed. Sidebar has NO per-row menu. Keyboard roving uses `data-nav-row` attributes — the new menu button must NOT carry `data-nav-row`.
- Settings: `AIProviderSettingsPanel.vue` + parent page `src/views/pages/systemsetting/ai_provider.vue` (sibling sections pattern: reasoning `v-switch`). Provider save IPC `AI_PROVIDER_SETTINGS_SAVE` accepts `{ mode, localProvider? }` and bumps config version.
- i18n: `workspaceChat.header.*` in `src/views/lang/{en,zh,es,fr,de,ja}.ts`, identical key trees; always `t(key) || "English"` fallback.
- Default-on Token flag pattern: `AIChatWorkspaceRollout.ts` `flagOn(key, defaultOn)` — empty/absent → default; `"false"`/`"0"` → off.
- Test DB setup: per-file copy-pasted `vi.mock("@/modules/token")` + SqliteDb singleton reset + `AIFETCHLY_TEST_DBPATH` (see `aiChatWorkspaceProjectionBackfillRace.test.ts`).

---

## File structure

**New files:**
| File | Responsibility |
|---|---|
| `src/service/aiChatTitle/AIChatTitleTypes.ts` | Pure types: `ChatTitleSource`, `ChatTitleGenerationStatus`, `ChatTitleFailureCode`, `ChatTitleUpdatedEvent`, `PreparedTitleCandidate` |
| `src/service/aiChatTitle/AIChatTitleText.ts` | Pure text utils: normalize, sanitize (credentials/emails/URLs/paths), codepoint-safe caps, UTF-8 byte budget |
| `src/service/aiChatTitle/AIChatTitleEligibility.ts` | Deterministic substantive-exchange detection (6-language greeting/ack lists) |
| `src/service/aiChatTitle/AIChatTitlePrompt.ts` | `chat-title-v1` instruction + bounded message builder (70/30 split) |
| `src/service/aiChatTitle/AIChatTitleValidator.ts` | Model-output validation (AI) + manual-name validation (user) |
| `src/service/AIChatTitleService.ts` | Background queue (cap 20, concurrency 1, 60 s expiry), claim→dispatch→commit→publish lifecycle |
| `src/config/aiChatTitlesSettings.ts` | `USER_AUTO_CHAT_TITLES_ENABLED` Token key + `isAutoChatTitlesEnabled()` (default on) |
| `src/migrations/1788480000000-0005-chat-title-lifecycle.ts` | Additive CLI migration (dormant chain, guarded ALTERs) |
| `src/views/components/aiChatWorkspace/AiChatRenameDialog.vue` | Shared rename dialog (v-text-field, counter, IME-safe Enter, inline error) |
| `test/vitest/main/aiChatTitlePersistence.test.ts` | Real-SQLite races/lifecycle/upgrade |
| `test/vitest/main/aiChatTitleService.test.ts` | Service queue/dedupe/priority/no-retry |
| `test/vitest/utilitycode/aiChatTitlePrompt.test.ts` | Eligibility/sanitize/budget/prompt/validator |
| `test/vitest/main/components/AiChatRenameDialog.test.ts` | Dialog interactions |
| `test/fixtures/aiChatTitles/evaluation-fixtures.json` | 60 multilingual eval fixtures (release-gate data) |
| `test/e2e/specs/aiChatTitles.test.ts` | E2E: delayed title, rename, restart |

**Modified files (surgical):**
`src/entity/AIChatConversation.entity.ts` (7 columns), `src/model/AIChatConversation.model.ts` (CAS + column-scoped writers), `src/modules/AIChatConversationModule.ts` (title policy), `src/service/AIChatCoordinator.ts` (notify dep), `src/service/AIChatTurnQueueService.ts` (notify dep), `src/service/AIChatEventRouter.ts` (broadcastTitleUpdate), `src/service/aiChatWorkspaceRuntime.ts` (service singleton), `src/main-process/communication/ai-chat-workspace-ipc.ts` (rename response + wiring + startup reconcile + delete cancel), `src/main-process/communication/ai-provider-ipc.ts` (settings save/get extension), `src/config/channellist.ts` + `src/preload.ts` (new channel), `src/schemas/ipc/aiChatWorkspace.ts` (rename response + canonical normalization), `src/entityTypes/aiChatWorkspaceTypes.ts` (titleRevision fields), `src/api/aiChatApi.ts` (strict policy + purpose log suppression), `src/service/aiProvider/OpenAICompatibleProviderClient.ts` (literal model bypass), `src/service/aiProvider/AIProviderConfigValidator.ts` + `AIProviderSettingsService.ts` (titleModel + binding), `src/entityTypes/aiProviderTypes.ts` (titleModel field), `src/views/api/aiChatWorkspace.ts` (subscribe + rename type), `src/views/store/chatWorkspace.ts` (revision reconciliation), `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue` (dialog), `AiChatWorkspaceSidebar.vue` (row menu), `src/views/pages/systemsetting/ai_provider.vue` (Chat titles section), `src/views/lang/{en,zh,es,fr,de,ja}.ts` (new keys), `src/config/dbMigrations.ts` (register migration), `test/vitest/utilitycode/aiChatApiProviderRouting.test.ts` + `openAICompatibleProviderClient.test.ts` (strict tests), `test/vitest/main/components/AiChatWorkspaceSidebar.test.ts` (row menu tests).

---

## Task 1: Persistence — entity columns, migration, types

**Files:** Modify `src/entity/AIChatConversation.entity.ts`, `src/entityTypes/aiChatWorkspaceTypes.ts` (no — types go in `src/service/aiChatTitle/AIChatTitleTypes.ts`), Create `src/service/aiChatTitle/AIChatTitleTypes.ts`, `src/migrations/1788480000000-0005-chat-title-lifecycle.ts`, Modify `src/config/dbMigrations.ts`.

- [ ] **1.1 Create `src/service/aiChatTitle/AIChatTitleTypes.ts`** (pure, node-free — safe to import anywhere):

```ts
/** Provenance of a conversation's visible title. */
export type ChatTitleSource =
  | "placeholder"
  | "excerpt"
  | "ai"
  | "user"
  | "legacy";

/** Lifecycle of automatic title generation within one epoch. */
export type ChatTitleGenerationStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "suppressed";

/** Bounded internal outcome codes (never conversation content). */
export type ChatTitleFailureCode =
  | "timeout"
  | "invalid_output"
  | "interrupted"
  | "provider_changed"
  | "feature_disabled"
  | "queue_full"
  | "provider_unavailable"
  | "missing_model"
  | "not_ready"
  | "stale"
  | "error";

/** Main→renderer title-only event payload (AI_CHAT_WORKSPACE_TITLE_UPDATED). */
export interface ChatTitleUpdatedEvent {
  readonly conversationId: string;
  readonly title: string | null;
  readonly titleRevision: number;
  readonly titleSource: ChatTitleSource;
}

/** Result of evaluating the first-three-exchange window for a candidate. */
export type PreparedTitleCandidate =
  | { kind: "eligible"; userText: string; assistantExcerpt: string; epoch: number; revision: number }
  | { kind: "pending_window" }   // fewer than 3 exchanges, none substantive yet — stay pending
  | { kind: "suppressed" }       // 3 non-substantive exchanges, or attempt already consumed/owned
  | { kind: "not_ready" };       // missing row / archived / manual ownership — do nothing
```

- [ ] **1.2 Extend the entity** — add after `titleIsUserSet` (keep existing columns untouched):

```ts
  /** Provenance of `title`. Defaults classify pre-existing rows as legacy. */
  @Column("varchar", { length: 16, nullable: false, default: "legacy" })
  titleSource!: string;

  /** Monotonic version of the visible title; guards renderer reconciliation. */
  @Column("int", { nullable: false, default: 0 })
  titleRevision!: number;

  /** Conversation-content lifecycle; increment when history is cleared. */
  @Column("int", { nullable: false, default: 0 })
  titleEpoch!: number;

  /** One-attempt lifecycle state within an epoch. */
  @Column("varchar", { length: 16, nullable: false, default: "suppressed" })
  titleGenerationStatus!: string;

  /** 0 or 1 within an epoch; incremented atomically by the claim. */
  @Column("int", { nullable: false, default: 0 })
  titleAttemptCount!: number;

  /** Unique claim identity for the current attempt; never reused. */
  @Column("varchar", { length: 64, nullable: true })
  titleRequestId!: string | null;

  /** Bounded internal outcome such as timeout/invalid_output/interrupted. */
  @Column("varchar", { length: 32, nullable: true })
  titleFailureCode!: string | null;
```

Note: entity keeps `string` types (matches file style — it uses plain types, not imported unions). Union-typed accessors live in model/service. `synchronize: true` adds these columns to dev/test DBs with defaults → pre-existing rows become `legacy/suppressed`, exactly per design §4.

- [ ] **1.3 Create the additive CLI migration** `src/migrations/1788480000000-0005-chat-title-lifecycle.ts`, modeled on migration 0002 (guarded `ALTER TABLE` via `pragma_table_info`, additive-only no-op `down`). Add columns exactly as above (`varchar(16) default 'legacy'`, `int default 0` ×3, `varchar(16) default 'suppressed'`, `int default 0`, `varchar(64)`, `varchar(32)`).

- [ ] **1.4 Register** in `src/config/dbMigrations.ts` `DB_MIGRATIONS` array (append).

- [ ] **1.5 Verify:** `npx tsc --noEmit` passes. Run any existing conversation projection test to confirm schema still initializes:
  `yarn vitest --config vite.main.config.mjs run test/vitest/main/aiChatConversationProjection.test.ts` → PASS.

- [ ] **1.6 Commit:** `git add -A && git commit -m "feat(chat-titles): add title lifecycle columns, types, and CLI migration"` (schema + types only; behavior unchanged — existing tests must stay green).

---

## Task 2: Persistence — model CAS methods + column-scoped writers

**Files:** Modify `src/model/AIChatConversation.model.ts`; Create `test/vitest/main/aiChatTitlePersistence.test.ts`.

All new model methods use `this.repository.createQueryBuilder().update(...).set(...).where(...).execute()` (better-sqlite3 executes single UPDATEs atomically) and start with `this.assertMainProcess()`.

- [ ] **2.1 Write failing tests** in `test/vitest/main/aiChatTitlePersistence.test.ts` using the copy-pasted DB setup block (mock Token → `AIFETCHLY_TEST_DBPATH`, reset SqliteDb singleton per test, `await SqliteDb.ensureInitialized()` per test). Test list (names = contracts):

  1. `claimTitleAttempt wins once and loses for a concurrent duplicate` — two sequential `claimTitleAttempt` calls with the same `(conversationId, epoch, revision)`, distinct requestIds → first returns `true`, second `false`; row is `running`, attempts=1.
  2. `claimTitleAttempt rejects when epoch/revision moved, user renamed, status not pending, attempts=1, or row missing/archived` — five sub-cases.
  3. `applyGeneratedTitle commits only for the live claim` — claim then `applyGeneratedTitle` → `{outcome:"applied", title, revision: revision+1}`; after a manual rename it returns `stale` and does not touch the row.
  4. `renameWithOwnership sets user ownership, suppresses generation, bumps revision, and clears request state` — also verify a later `applyGeneratedTitle` (same old claim) returns `stale`.
  5. `updateExcerptIfPending replaces a placeholder/greeting excerpt only while pending and nonmanual` — and is a no-op once `running`.
  6. `recordMessagePersisted no longer restores a stale title after rename` — rename → `recordMessagePersisted({generatedTitle:"X"})` → title stays the manual name and `titleSource==="user"` (regression for the full-row-save race).
  7. `markRead does not overwrite title columns after a concurrent rename` — interleave: read row, rename, `markRead` → manual title intact.
  8. `clearTitleLifecycleForHistoryClear: nonmanual → pending epoch+1 title null; manual → suppressed epoch+1 title kept`.
  9. `reconcileInterruptedTitleClaims marks running claims failed(interrupted) and returns count`.
  10. `repairLegacyUserTitles promotes legacy user-set rows to source=user (idempotent)`.
  11. `old-schema upgrade path: rows created before the columns exist behave as legacy/suppressed` — simulate by inserting a raw row with legacy defaults via a second repository/query and asserting `claimTitleAttempt` refuses (status `suppressed`).
  12. `createProjection accepts title lifecycle input` — `titleSource`, `titleGenerationStatus` seeded for interactive creation (`excerpt`/`pending`), and duplicate/backfill producers get `legacy`/`suppressed`.

- [ ] **2.2 Run** → FAIL (methods missing).

- [ ] **2.3 Implement in `AIChatConversationModel`:**

```ts
async claimTitleAttempt(input: {
  conversationId: string; epoch: number; revision: number; requestId: string;
}): Promise<boolean> {
  this.assertMainProcess();
  const result = await this.repository
    .createQueryBuilder()
    .update()
    .set({
      titleGenerationStatus: "running",
      titleAttemptCount: 1,
      titleRequestId: input.requestId,
      titleFailureCode: null,
      updatedAt: new Date(),
    })
    .where(
      "conversationId = :conversationId AND titleEpoch = :epoch AND titleRevision = :revision" +
      " AND titleIsUserSet = 0 AND titleSource IN ('placeholder','excerpt')" +
      " AND titleGenerationStatus = 'pending' AND titleAttemptCount = 0 AND archivedAt IS NULL",
      input
    )
    .execute();
  return (result.affected ?? 0) === 1;
}
```

`applyGeneratedTitle` — same shape: conditional on `titleEpoch`, `titleRevision`, `titleRequestId`, `titleGenerationStatus='running'`, `titleIsUserSet=0`; sets `title`, `titleSource='ai'`, status `succeeded`, `titleRevision = () => "titleRevision + 1"` (use `set({ titleRevision: () => "titleRevision + 1", ... })`), `titleFailureCode=null`. On success re-read the row and return `{ outcome: "applied", title: row.title, revision: row.titleRevision }`; zero affected + row exists → `{ outcome: "stale" }`; no row → `{ outcome: "missing" }`.

`markTitleAttemptFailed({ conversationId, requestId, failureCode })` — conditional on `running` + requestId; sets `failed` + code.

`renameWithOwnership(conversationId, title)` — column-scoped UPDATE: `title`, `titleIsUserSet=true`, `titleSource='user'`, `titleGenerationStatus='suppressed'`, `titleRequestId=null`, `titleFailureCode=null`, `titleRevision+1`, `updatedAt`; returns re-read entity or null when missing. Replaces the old `rename` (update all callers; delete the old full-row method).

`updateExcerptIfPending({ conversationId, epoch, excerpt })` — conditional on `titleEpoch`, `titleGenerationStatus='pending'`, `titleIsUserSet=0`, `titleSource IN ('placeholder','excerpt')`; sets `title`, `titleSource='excerpt'`.

`clearTitleLifecycleForHistoryClear(conversationId)` — read row; if `titleIsUserSet`: UPDATE `titleEpoch+1`, `titleRevision+1`, status `suppressed`, `titleRequestId=null`, `titleFailureCode=null` (keep title). Else: additionally `title=null`, `titleSource='placeholder'`, status `pending`, `titleAttemptCount=0`.

`reconcileInterruptedTitleClaims()` — UPDATE all `titleGenerationStatus='running'` → `failed` + `interrupted`; return affected count.

`repairLegacyUserTitles()` — UPDATE `titleSource='user'` WHERE `titleIsUserSet=1 AND titleSource!='user'`; return count.

- [ ] **2.4 Make `recordMessagePersisted` and `markRead` column-scoped** (design §5.3 writer audit):
  - `recordMessagePersisted` update branch: replace the `{...existing}` + `save` with (a) `createQueryBuilder().update().set({ preview, lastMessageAt, lastResultAt?, updatedAt })` scoped to `conversationId`; (b) `this.repository.increment({ conversationId }, "messageCount", 1)`; (c) excerpt seeding as a conditional update: `title = sanitized excerpt, titleSource='excerpt'` WHERE `conversationId=? AND title IS NULL AND titleIsUserSet=0 AND titleSource='placeholder' AND titleGenerationStatus='pending'`. Create branch: `createProjection` with `titleSource='excerpt'`, `titleGenerationStatus='pending'` when `generatedTitle` present, else `placeholder`/`pending`. Sanitize excerpt via `sanitizeExcerpt()` from `src/service/aiChatTitle/AIChatTitleText.ts` (Task 4 provides it — implement `AIChatTitleText.ts` FIRST or in the same commit; order tasks so 2.4 lands with 4.x). Return the re-read entity.
  - `markRead`: keep the monotonic pre-check, then column-scoped `update` of `lastReadAt` + `updatedAt` only (keyed by `id`).
  - `createProjection` input gains optional `titleSource?: ChatTitleSource` (default `legacy`) and `titleGenerationStatus?: ChatTitleGenerationStatus` (default `suppressed`) so each producer chooses explicitly.
  - `backfillProjections` post-create repair save (module): scope the second save to non-title columns (`messageCount`, `lastMessageAt`, `lastResultAt`, `lastReadAt`, `updatedAt`) via a column-scoped update — no title fields carried.

- [ ] **2.5 Run tests** → PASS (incl. existing `aiChatConversationProjection.test.ts` — update its expectations only where the contract intentionally changed, e.g. `rename` call sites; do not delete failing assertions without replacing them).

- [ ] **2.6 Commit:** `feat(chat-titles): atomic title claim/apply/rename writes and column-scoped projection writers`

---

## Task 3: Module title policy

**Files:** Modify `src/modules/AIChatConversationModule.ts`.

- [ ] **3.1 Add module methods** (each starts `await this.ensureConnection()`):

```ts
/** Atomic manual rename returning authoritative post-commit state. */
async applyManualRename(conversationId: string, title: string): Promise<
  { outcome: "renamed"; title: string; titleRevision: number } | { outcome: "missing" }
>;

/** Evaluate the first-three-exchange window (design §7.1) from durable rows. */
async prepareTitleCandidate(conversationId: string): Promise<PreparedTitleCandidate>;
// Implementation: read projection row. Manual/ai/succeeded/failed/suppressed-with-attempt
// → { kind: "suppressed" } (attempt consumed) or "not_ready" (manual/missing/archived).
// pending → load first page of messages via getConversationPage(conversationId, 40);
// pair user/assistant exchanges in order (trusted persisted IDs/roles only);
// count completed interactive exchanges (user message + nonempty assistant answer).
// 0 substantive & <3 exchanges → "pending_window". 0 substantive & >=3 → mark row
// suppressed via a model transition (pending→suppressed) and return "suppressed".
// Substantive found → return eligible with the EARLIEST substantive pair's texts
// (user message + assistant excerpt) + row's epoch/revision. Also call
// updateExcerptIfPending with the substantive user text so the sidebar excerpt
// improves even if generation later fails.

/** History-clear title lifecycle (FR-09). */
async clearTitleLifecycle(conversationId: string): Promise<void>;

/** Duplicate ownership copy (design §11). */
// In duplicateConversation: after createProjection (which now defaults legacy/suppressed),
// if source.titleIsUserSet → column-scoped copy of title/titleSource='user'/
// titleIsUserSet=true on the new row; else keep legacy/suppressed copy. Neither starts a job.

/** Startup: reconcile interrupted running claims + repair legacy user rows. */
async reconcileTitleStateOnStartup(): Promise<{ interrupted: number; repaired: number }>;
```

- [ ] **3.2 Rename call sites in the module** (`rename` wrapper) to `applyManualRename` semantics; keep `rename(conversationId, title)` as a thin boolean wrapper for compatibility if other callers exist (grep first — the IPC is the only production caller).

- [ ] **3.3 Tests:** extend `aiChatTitlePersistence.test.ts` with module-level cases: duplicate copies ownership both ways; clear lifecycle manual vs nonmanual; `prepareTitleCandidate` greeting-window behavior (2 greeting exchanges → `pending_window`; 3 → `suppressed`; greeting then task → `eligible` with the task text and updated excerpt).

- [ ] **3.4 Commit:** `feat(chat-titles): module title policy — candidate evaluation, ownership copy, clear lifecycle`

---

## Task 4: Title text utilities (eligibility, sanitize, budget, prompt, validators)

**Files:** Create `src/service/aiChatTitle/AIChatTitleText.ts`, `AIChatTitleEligibility.ts`, `AIChatTitlePrompt.ts`, `AIChatTitleValidator.ts`; Create `test/vitest/utilitycode/aiChatTitlePrompt.test.ts`.

- [ ] **4.1 Write failing tests** (`test/vitest/utilitycode/aiChatTitlePrompt.test.ts` — pure functions, no mocks):

  - `AIChatTitleText.normalizeText`: collapses whitespace/newlines to single spaces, trims.
  - `AIChatTitleText.sanitizeText`: replaces emails → `[email]`, raw URLs → `[link]`, absolute paths (`/home/...`, `C:\...`) → `[path]`, credential assignments (`api_key=...`, `password: ...`, `Bearer ...`, `sk-...` tokens) → `[redacted]` (case-insensitive key names, both `=` and `:` forms).
  - `AIChatTitleText.clipCodepoints(text, 80)`: never splits surrogate pairs (emoji test), max N Unicode code points.
  - `AIChatTitleText.clipToUtf8Bytes(text, 4096)`: truncates on a UTF-8 boundary, never mid-codepoint (CJK + emoji tests).
  - `AIChatTitleEligibility.isSubstantiveRequest`: true for short CJK ("帮我找悉尼的牙医"), brief commands ("summarize this csv"), mixed-language; false for empty/whitespace, punctuation-only, emoji-only, and exact greetings/acks in all six languages: `hi, hello, hey, thanks, thank you, ok, okay, sure, please help, good morning/afternoon/evening` / `你好, 嗨, 好的, 谢谢, 请帮忙, 早上好` / `hola, gracias, ok, de acuerdo, buenos días/tardes/noches` / `bonjour, salut, merci, d'accord, bonsoir` / `hallo, hi, danke, okay, gutten morgen/abend` / `こんにちは, こんにちは, ありがとう, お願いします, よろしく` — case-insensitive, punctuation-tolerant (`"Hi!"` is a greeting), with or without trailing `!/?/。/！`.
  - `AIChatTitlePrompt.buildTitleMessages({userText, assistantExcerpt})`: returns `[system: CHAT_TITLE_PROMPT_V1]` + one user message with structured JSON framing `{"user_request": "...", "assistant_answer_excerpt": "..."}` (conversation text NEVER interpolated into the system message); 70/30 budget split of a content byte budget after fixed instruction; unused assistant allocation flows to user; total serialized ≤ 4096 UTF-8 bytes; returns `{ messages, budget: { bytes, estimated: true } }`.
  - `CHAT_TITLE_PROMPT_V1` constant matches design §7.4 verbatim (test asserts key phrases: "Return only the title", "untrusted data", language-following instruction, "empty string").
  - `AIChatTitleValidator.validateGeneratedTitle`: trims; strips at most one outer matched quote pair; rejects multi-line, markdown fences, control/bidi chars (`‮`), strings containing `@`/`http`/`/home/` artifacts (post-sanitize leak guard); rejects >80 code points (returns `{ ok: false }`); accepts normal short titles; empty string → `{ ok: true, title: "" }` (means "model declined" — caller keeps excerpt).
  - `AIChatTitleValidator.validateManualTitle`: trims, normalizes line breaks to spaces, rejects empty/whitespace-only and >200 UTF-16 code units (`length`), rejects control chars except none needed; returns normalized or error code (`empty` | `too_long` | `invalid`).

- [ ] **4.2 Run** → FAIL. **4.3 Implement** the four pure modules (no Node imports — renderer-node-guard safe; no `any`; explicit return types; constants: `GENERATED_TITLE_MAX_CODEPOINTS = 80`, `MANUAL_TITLE_MAX_UTF16 = 200`, `TITLE_INPUT_BYTE_BUDGET = 4096`, `TITLE_MAX_OUTPUT_TOKENS = 64`, `TITLE_REQUEST_BUDGET_MS = 10000`). **4.4 Run** → PASS.

- [ ] **4.5 Commit:** `feat(chat-titles): eligibility, sanitization, budget, prompt, and validation utilities`

---

## Task 5: Strict provider routing + settings

**Files:** Modify `src/api/aiChatApi.ts`, `src/service/aiProvider/OpenAICompatibleProviderClient.ts`, `src/entityTypes/aiProviderTypes.ts`, `src/service/aiProvider/AIProviderConfigValidator.ts`, `src/service/aiProvider/AIProviderSettingsService.ts`, `src/main-process/communication/ai-provider-ipc.ts`, `src/config/aiChatTitlesSettings.ts` (new); extend `test/vitest/utilitycode/aiChatApiProviderRouting.test.ts` + `openAICompatibleProviderClient.test.ts`.

- [ ] **5.1 Failing tests** in `aiChatApiProviderRouting.test.ts`:
  - `hosted with smallModelFallbackPolicy=forbid makes exactly one request on a small-alias 404` — `mockPostJson` rejects 404 once; expect the call to throw AND `mockPostJson` called exactly once; assert wire body has no `smallModelFallbackPolicy`/`purpose` fields.
  - `hosted forbid policy does not change literal-model 404 behavior` (still throws, one call).
  - `hosted default (allow) still retries as before` — regression guard for compaction/small callers.
  - `_debugLogRequest` privacy: with `AICHAT_DEBUG_REQUEST=1` and `requestPurpose:"chat_title"`, no console.log contains message content (spy on console.log; assert not called or called with metadata only).
  In `openAICompatibleProviderClient.test.ts`:
  - `literalModel:true sends the model id verbatim even when it is named "small"` — wire body `model === "small"`.
  - `literalModel without model falls back to defaultModel`.
  - existing alias tests stay green (default behavior unchanged).

- [ ] **5.2 Implement:**
  - `OpenAIChatCompletionRequest` (aiChatApi.ts) gains two desktop-internal, never-serialized fields: `smallModelFallbackPolicy?: "allow" | "forbid"` (default `allow`) and `requestPurpose?: string`. In `postHostedCompletionWithSmallModelRetry`: when `request.smallModelFallbackPolicy === "forbid"`, skip the retry branch entirely (propagate the error). In `_debugLogRequest`: return early when the payload's `requestPurpose === "chat_title"` (log a one-line metadata-only notice instead).
  - `OpenAICompatibleProviderClient.resolveModel`: first line `if (request.literalModel === true && request.model) { return request.model; }` — add `literalModel?: boolean` to the request type used there (it's the same `OpenAIChatCompletionRequest` from the api layer or its provider-local type — follow the existing import).
  - `src/config/aiChatTitlesSettings.ts`: `export const USER_AUTO_CHAT_TITLES_ENABLED = "user_auto_chat_titles_enabled";` + `isAutoChatTitlesEnabled(): boolean` using the `flagOn` pattern (default `true`).
  - `LocalAIProviderConfig.titleModel?: string` (+ `LocalAIProviderConfigInput.titleModel?: string`) in `aiProviderTypes.ts`; `AIProviderSettingsView` gains `autoChatTitlesEnabled: boolean`.
  - `AIProviderConfigValidator`: accept optional `titleModel` — trimmed, 1–100 chars, no whitespace-only; invalid → error field (validation result union member).
  - `AIProviderSettingsService.saveLocalProvider` binding rule: if `input.titleModel !== undefined` → persist it; else if stored config exists and (`baseUrl` normalized or `preset`) changed → drop stored `titleModel`; else carry stored value forward. `getSettingsView()` returns `autoChatTitlesEnabled: isAutoChatTitlesEnabled()`.
  - `ai-provider-ipc.ts` save handler: accept optional `autoChatTitlesEnabled?: boolean` in the payload; when present, `token.setValue(USER_AUTO_CHAT_TITLES_ENABLED, String(value))` and `bumpProviderConfigVersion()`; get handler returns the view (already extended). Zod-validate the added fields (schema lives with the IPC parse in that file).
- [ ] **5.3 Run** both suites → PASS (plus existing small-model callers' tests). **5.4 Commit:** `feat(chat-titles): strict small-model no-fallback policy, literal model bypass, title settings`

---

## Task 6: `AIChatTitleService` + completion wiring + title event

**Files:** Create `src/service/AIChatTitleService.ts`; Modify `src/service/aiChatWorkspaceRuntime.ts`, `src/service/AIChatCoordinator.ts`, `src/service/AIChatTurnQueueService.ts`, `src/service/AIChatEventRouter.ts`, `src/config/channellist.ts`, `src/preload.ts`, `src/main-process/communication/ai-chat-workspace-ipc.ts`; Create `test/vitest/main/aiChatTitleService.test.ts`.

- [ ] **6.1 Channel + router:** add `export const AI_CHAT_WORKSPACE_TITLE_UPDATED = "ai-chat-workspace:title-updated";` to `channellist.ts`; add it to preload's `receive:`, `removeListener:`, and `removeAllListeners:` validChannels arrays (NOT invoke). Add `AIChatEventRouter.broadcastTitleUpdate(event: ChatTitleUpdatedEvent): void` mirroring `broadcastSummary` (JSON.stringify, pruneDestroyed loop).

- [ ] **6.2 `AIChatTitleService`** (constructor-injected deps for testability; process singleton via `aiChatWorkspaceRuntime.ts` `getSharedAIChatTitleService()` following the existing `let shared = null` pattern):

```ts
export interface AIChatTitleServiceDeps {
  /** Pinned-provider nonstreaming completion. Title requests NEVER route elsewhere. */
  completeTitle(request: OpenAIChatCompletionRequest, signal: AbortSignal): Promise<OpenAIChatCompletionResponse>;
  /** Resolves mode + (local) pinned config/key snapshot; null when unusable. */
  resolveTitleProvider(): { kind: "hosted" } | { kind: "local"; config: LocalAIProviderConfig; apiKey: string } | null;
  broadcastTitle(event: ChatTitleUpdatedEvent): void;
  providerConfigVersion(): number;
  isAutoTitlesEnabled(): boolean;
  isForegroundBusy(): () => boolean  // wired to shared scheduler/queue activity in IPC layer
}
```

  Public API: `notifyInteractiveTurnCompleted(input: { conversationId: string; assistantMessageId: string | null }): void` — fire-and-forget `void this.enqueue(...).catch(...)`; `cancelConversation(conversationId: string): void`; `reconcileOnStartup(): Promise<void>`; `resetForTesting(): void`.

  Queue/lifecycle rules (design §6): in-memory Map keyed by conversationId (dedupes duplicates from both owners — AC-03); capacity 20 — on overflow drop the NEWEST unclaimed entry (record `queue_full` diagnostic, row stays pending); entries expire after 60 s unclaimed (no attempt consumed); global concurrency 1; before dispatch require `!isForegroundBusy()` else wait/abort — if foreground work starts mid-flight, abort the fetch, mark the attempt failed (attempt consumed, excerpt retained).

  Dispatch sequence per job: (1) `providerConfigVersion()` snapshot; (2) `prepareTitleCandidate` — `not_ready`/`pending_window` → drop (no attempt); `suppressed` → drop; (3) `resolveTitleProvider()` — hosted requires `USER_AI_ENABLED === "true"` (checked inside resolver wiring) and uses `model: SMALL_MODEL_ALIAS, smallModelFallbackPolicy: "forbid"`; local requires `config.titleModel` (missing → record `missing_model`, drop — zero calls, AC-05) and uses `model: config.titleModel, literalModel: true` via a provider-pinned client; (4) `claimTitleAttempt` with fresh epoch/revision + `crypto.randomUUID()` requestId — lose → drop; (5) recheck version + flag — changed → `markTitleAttemptFailed("provider_changed"|"feature_disabled")` WITHOUT sending; (6) build messages via `buildTitleMessages`, `max_tokens: 64`, `stream: false`, `requestPurpose: "chat_title"`, `callBudgetMs: 10000` (hosted) / linked `AbortSignal.timeout(10000)` (local); (7) validate via `validateGeneratedTitle` — invalid/empty → `markTitleAttemptFailed("invalid_output")`, keep excerpt, no retry; (8) `applyGeneratedTitle` — `applied` → `broadcastTitle({conversationId, title, titleRevision, titleSource: "ai"})` AFTER commit; `stale`/`missing` → log + drop; (9) every exit path clears timers/abort listeners; all errors → `markTitleAttemptFailed` with a bounded code; title failures never propagate to the caller (swallowed + console.warn metadata-only).

  Diagnostics: content-free in-memory counters (candidates, eligible, claimed, dispatched, succeeded, failed-by-code, stale-dropped, queue-full) exposed via `getDiagnostics(): Record<string, number>` for tests — no external telemetry, no prompt/response logging.

- [ ] **6.3 Completion wiring (both owners):**
  - `AIChatCoordinatorDeps` gains optional `onInteractiveTurnCompleted?: (input: { conversationId: string; assistantMessageId: string | null }) => void`; fire it in `executeDispatch` AFTER the assistant projection write (~line 949) only when `finalStatus === "completed"` and `terminal` exists, with the terminal event's assistant message id (inspect `AIChatTurnTerminalEvent` for the exact field; if the coordinator path lacks the id, pass `null` — the module pairs exchanges from persisted rows anyway).
  - `AIChatTurnQueueService` deps gain the same optional callback; fire in `drainConversation`'s completed branch immediately after `projectTurnResult(...)` with `terminal.assistantMessageId`.
  - Wire both in `ai-chat-workspace-ipc.ts` (`getAiChatWorkspaceCoordinator`) and `ai-chat-v2-ipc.ts` (`getQueueService`) to `getSharedAIChatTitleService().notifyInteractiveTurnCompleted` — services must not import IPC modules (dep injection keeps the boundary).
  - Startup: in the workspace bootstrap handler's once-per-process block (where `reconcileInterruptedRuns` + backfills run), call `conversationModule.reconcileTitleStateOnStartup()` and `titleService.reconcileOnStartup()` (which delegates + clears memory queue).
  - Delete handler: `titleService.cancelConversation(id)` before deletion. Clear-messages path (locate the clear IPC handler during implementation — grep `clearConversation` callers) : call `conversationModule.clearTitleLifecycle(id)` + `titleService.cancelConversation(id)`.

- [ ] **6.4 Tests** (`test/vitest/main/aiChatTitleService.test.ts`, constructor-injected fakes, fake timers where needed):
  - duplicate notifications (both owners, same conversation) → single `completeTitle` call (AC-03).
  - queue cap 20 → 21st dropped, `queue_full` counted, no dispatch for it.
  - greeting-only window: candidate `pending_window` twice → zero provider calls; third → suppressed, zero calls (AC-02).
  - missing local `titleModel` → zero provider calls (AC-05).
  - hosted forbid: `completeTitle` rejects → attempt failed once, no second call, excerpt kept (AC-04/16).
  - manual rename during in-flight request → `applyGeneratedTitle` returns stale → no broadcast, no title change (AC-09).
  - provider version change after claim → no network call at all (failed `provider_changed`).
  - foreground busy → job waits; foreground starts mid-flight → abort + failed.
  - success path: broadcast payload `{conversationId, title, titleRevision, titleSource:"ai"}` after `applyGeneratedTitle` (order asserted).
  - scheduled/cancelled/failed owners never notify (unit-level: coordinator stub test asserting the callback fires only on completed).
- [ ] **6.5 Run** service tests + `yarn vitest --config vite.main.config.mjs run test/vitest/main/aiChatWorkspaceCoordinator.test.ts` (wiring regression). **6.6 Commit:** `feat(chat-titles): background title generation service with single-dispatch lifecycle and title-updated event`

---

## Task 7: IPC — rename contract + renderer API + store revision reconciliation

**Files:** Modify `src/schemas/ipc/aiChatWorkspace.ts`, `src/main-process/communication/ai-chat-workspace-ipc.ts`, `src/entityTypes/aiChatWorkspaceTypes.ts`, `src/views/api/aiChatWorkspace.ts`, `src/views/store/chatWorkspace.ts`; tests in `test/vitest/main/` (new `aiChatTitleRenameIpc.test.ts` following the existing IPC test pattern) + a store test.

- [ ] **7.1 Schema:** rename request keeps `{ conversationId, title }` but canonicalize title in the shared schema (trim + reject whitespace-only via `.refine`, max 200 stays, min 1 stays). Add response DTO types: `RenameConversationResponse { renamed: true; conversationId: string; title: string; titleRevision: number; titleSource: "user" }`.

- [ ] **7.2 IPC handler:** validate → `conversationModule.applyManualRename` → `missing` → `denied("chat-titles.conversation_not_found" stable code)` (NOT `ok({renamed:false})`); success → after commit `eventRouter.broadcastTitleUpdate({conversationId, title, titleRevision, titleSource:"user"})` then `ok({...})`. No repository access in the handler (module only).

- [ ] **7.3 Types:** `ConversationSummaryEvent` gains optional `titleRevision?: number`; `WorkspaceConversationSummary` gains `titleRevision: number`; sidebar DTO mapping in `getWorkspaceSidebar` passes `projection.titleRevision`; `broadcastRunSummary` in the coordinator attaches `titleRevision` when it reads the projection (title + revision together).

- [ ] **7.4 Renderer API:** `renameConversation` return type → `RenameConversationResponse`; add `subscribeTitleEvents(cb: (event: ChatTitleUpdatedEvent) => void): () => void` mirroring `subscribeSummaryEvents` (channel `AI_CHAT_WORKSPACE_TITLE_UPDATED`).

- [ ] **7.5 Store revision reconciliation:** add `titleRevisions: ref<Map<string, number>>`; `applyTitleUpdate(event)` — apply title to `conversationsById`/groups/unassigned ONLY when `event.titleRevision > (titleRevisions.get(id) ?? -1)`; record revision; unknown conversation → ignore (no resurrection of deleted rows). `applySummaryEvent`: when the event carries `title` and `titleRevision`, route through the same guard; when it carries `title` WITHOUT revision, apply only if no revision is recorded yet (legacy events cannot replace versioned titles). `bootstrap`: merge titles by revision (response rows carry `titleRevision` — seed the map). Subscribe to title events in `bootstrap` alongside the summary subscription (subscribe BEFORE requesting bootstrap data to avoid the gap — restructure `bootstrap` to subscribe first if not already).

- [ ] **7.6 Tests:** IPC — whitespace-only/oversize rejected; missing row → failure envelope; success → response shape + broadcast called with post-commit revision; no model/API invocation during rename (AC-13). Store — newer revision wins, older ignored, unversioned legacy title ignored after versioned, bootstrap merge keeps newer local. **7.7 Commit:** `feat(chat-titles): revisioned rename IPC contract and store reconciliation`

---

## Task 8: Shared rename dialog + header/center + sidebar actions

**Files:** Create `src/views/components/aiChatWorkspace/AiChatRenameDialog.vue`; Modify `AiChatCenterSurface.vue`, `AiChatWorkspaceSidebar.vue`, `src/views/store/chatWorkspace.ts` (shared `openRename` state or composable); Create `test/vitest/main/components/AiChatRenameDialog.test.ts`; extend `AiChatWorkspaceSidebar.test.ts`, `AiChatConversationHeader.test.ts`, center-surface tests.

- [ ] **8.1 `AiChatRenameDialog.vue`** (model on `WorkspaceMemoryEditorDialog.vue`): props `{ modelValue: boolean; conversationId: string | null; initialTitle: string; saving: boolean; error: string | null }`; emits `update:modelValue`, `save(title: string)`, `cancel`. v-text-field `counter="200" maxlength="200"` autofocus + select-on-focus; Enter saves ONLY when `!isComposing` (`@keydown.enter` checks `event.isComposing === false`); Escape cancels; Save disabled while `saving` or invalid (local validation via `validateManualTitle` — import from a renderer-safe path: the pure validator from Task 4 is node-free so import directly); inline error area `role="alert"`; focus returns to the invoking control on close (`activatorEl` captured at open); `data-testid="rename-dialog"`, input `"rename-dialog-input"`, save `"rename-dialog-save"`, cancel `"rename-dialog-cancel"`, error `"rename-dialog-error"`.

- [ ] **8.2 Center surface:** replace the `appPrompt`-based `onRename` with the shared dialog: open with `conversationId` + `headerTitle`; `onSave` → `renameConversation` → on success update store via `applyTitleUpdate`-compatible store action (authoritative response), no full `bootstrap()`; on failure keep dialog open with error text + preserve typed draft (AC-08/13). Keep the generic prompt machinery if other callers exist (grep `appPrompt(`).

- [ ] **8.3 Sidebar rows:** add a sibling actions button to BOTH grouped and unassigned rows (inside the `li`, after the nav `button` — never nested): `v-menu` with activator `mdi-dots-horizontal` icon button (`:aria-label`, `data-testid="workspace-conversation-menu-<id>"`, NO `data-nav-row` attribute), menu item "Rename chat" (`data-testid="workspace-conversation-rename-<id>"`). Opening the menu must not navigate (`@click.stop` on the activator). Rename targets that row's conversation (captured id, not selected id) → emits `rename(conversationId, title)` handled by the parent shell which hosts the single shared dialog.

- [ ] **8.4 Tests:** dialog — render, prefilled value, Save/Cancel/Enter/Escape, IME composition (`isComposing: true` Enter does NOT save), oversize/empty inline errors, save disabled while saving, error keeps draft (AC-08). Sidebar — menu button present on grouped + unassigned rows, keyboard reachable, rename emits with the ROW's id while another chat is selected, navigation not triggered (AC-08). Center — header rename opens the dialog; failed save keeps dialog + error. **8.5 Commit:** `feat(chat-titles): shared rename dialog with header and sidebar entry points`

---

## Task 9: Settings UI + translations (all six languages)

**Files:** Modify `src/views/pages/systemsetting/ai_provider.vue`, `src/views/api/aiProvider.ts` (save payload type), `src/views/lang/{en,zh,es,fr,de,ja}.ts`; extend a settings component test.

- [ ] **9.1 Settings section** in `ai_provider.vue` (sibling of the reasoning block, before `LocalAiComponentsPanel`): heading "Chat titles"; `v-switch` auto-title toggle (bound to a ref initialized from the settings view `autoChatTitlesEnabled`; on change → `saveAIProviderSettings({...currentView, autoChatTitlesEnabled: value})`); informational line for hosted mode ("uses the service's lightweight model"); when `mode === 'local'`: `v-combobox` title model (bound to `localProvider.titleModel`, saved through the normal provider save path — the binding rule in the service clears it on endpoint/preset change unless re-saved); hint text "Uses your configured provider" (never "offline"); note that naming uses a short excerpt and may incur a small amount of provider usage (FR-08).

- [ ] **9.2 i18n keys** — add to `workspaceChat` (`renameDialog: { title, label, save, cancel, limitHint, errorEmpty, errorTooLong, errorInvalid, errorSaveFailed, errorUnavailable, saving }`, `sidebar.renameAction`, `sidebar.menuButtonLabel`) and `aiProvider` (`chatTitles: { section, description, autoToggle, autoToggleHint, hostedModelLabel, hostedModelHint, customModelLabel, customModelHint, usageNote, providerNote }`) in ALL SIX files with real translations (write them once here during implementation — English fallbacks in components alongside every `t()` call). Also add the IPC error text key `workspaceChat.renameDialog.errorUnavailable` used for the missing-row envelope.

- [ ] **9.3 Test:** component test for the settings section (toggle persists via save call; local-mode model field appears; hosted shows informational text) + assert all six lang files contain the new key paths (a small loop test comparing key sets against `en.ts` — add to an existing lang-consistency test if one exists, else create `test/vitest/utilitycode/aiChatTitlesI18n.test.ts`). **9.4 Commit:** `feat(chat-titles): Chat titles settings section with six-language translations`

---

## Task 10: E2E spec + evaluation fixtures + full verification

**Files:** Create `test/e2e/specs/aiChatTitles.test.ts`, `test/fixtures/aiChatTitles/evaluation-fixtures.json`, `test/vitest/utilitycode/aiChatTitleFixtures.test.ts`.

- [ ] **10.1 E2E** (deterministic FakeOpenAI scenarios; hosted-enabled seed): (a) send a substantive first message → assistant answer renders, then header/sidebar title becomes the fake provider's canned title while chat stays usable (AC-01); (b) rename during the delay window → manual name wins over the late AI title (AC-09); (c) offline/hosted-disabled rename still succeeds (AC-13); (d) reopen/restart keeps titles (AC-03/12). FakeOpenAI must answer the `small`-model title request with a canned short title (scenario-driven, matching existing E2E fake-server patterns).

- [ ] **10.2 Fixtures:** 60 cases (10 per language: en/zh/es/fr/de/ja) covering lead research, email drafting, file analysis, multi-intent, vague/greeting, mixed-language, sensitive strings (secrets to be sanitized), misleading instructions, long text; each `{ id, language, userText, assistantExcerpt, expectedProperties: { language, topicKeywords, disallowedClaims? } }`. Utility test asserts fixture invariants (60 present, 10 per language, sensitive strings sanitized by `sanitizeText`, greetings classified non-substantive, substantive fixtures pass eligibility). Human-scored review is an operator release gate — document in the fixture file header (not automated).

- [ ] **10.3 Full verification sweep** (record outputs as AC evidence in the PR description):
```bash
yarn vitest --config vite.main.config.mjs run test/vitest/main/aiChatTitlePersistence.test.ts test/vitest/main/aiChatTitleService.test.ts
yarn vitest --config vite.main.config.mjs run test/vitest/main/aiChatWorkspaceCoordinator.test.ts test/vitest/main/aiChatConversationProjection.test.ts
yarn vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/aiChatTitlePrompt.test.ts test/vitest/utilitycode/aiChatApiProviderRouting.test.ts test/vitest/utilitycode/openAICompatibleProviderClient.test.ts
yarn test:components
npx tsc --noEmit && npx vue-tsc --noEmit
yarn build:e2e && xvfb-run -a yarn playwright test test/e2e/specs/aiChatTitles.test.ts
```
- [ ] **10.4 Final commits** per remaining logical unit; update the worktree status memory file.

---

## Acceptance-criteria traceability

| AC | Covered by |
|---|---|
| AC-01 | T4 eligibility, T6 service, T10 E2E(a) |
| AC-02 | T4 greeting lists, T6 greeting-window tests |
| AC-03 | T2 claim CAS, T6 queue dedupe + startup reconcile, T10(c) |
| AC-04 | T5 forbid policy + test |
| AC-05 | T6 missing_model zero-call test |
| AC-06 | T4 byte budget, T5/T6 caps + deadline |
| AC-07 | T4 validator/prompt language rule, T10 fixtures |
| AC-08 | T8 dialog tests (IME, keyboard, errors) |
| AC-09 | T2 stale apply, T6 rename-race test, T8/T10(b) |
| AC-10 | T2/T7 column-scoped writers + revision guard (title changes don't touch counters/markers) |
| AC-11 | T6 provider_changed/feature_disabled, T2 interrupted reconcile |
| AC-12 | T3 duplicate/clear, T2 upgrade test |
| AC-13 | T7 no-model rename, T8 error retention, T10(c) |
| AC-14 | T9 six languages + i18n key test, T4 sanitization, T5 log suppression |
| AC-15 | T6 owners fire only on completed interactive; scheduled runner untouched |
| AC-16 | T6 failure-path tests keep excerpt, no banner |

## Known deferrals (documented, not silent)

- Tokenizer-based 1,024-token cap: v1 uses the 4,096-byte bound with `estimated: true` usage (FR-04 allows when no supported tokenizer).
- Hosted small-model capability precheck via catalog: skipped — strict forbid policy makes an unavailable small model a clean single failed attempt (PRD FR-03 outcome).
- Human-scored 60-fixture evaluation + hosted deployment capability evidence: operator release gates (PRD §10/§12) — fixtures and harness land, scoring does not.
- `yarn package`/`yarn make`: forbidden locally (AGENTS.md) — packaged validation is CI.
