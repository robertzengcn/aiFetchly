# Recoverable History and Incremental Compaction — Independent Audit TODO

**Date:** 2026-09-17  
**Auditor:** independent code review of worktree (not the implementer's own TODO claims)  
**Worktree:** `/Users/cengjianze/project/aiFetchly/.claude/worktrees/ai-chat-compaction`  
**Branch:** `worktree-ai-chat-compaction`  
**HEAD at audit:** `7d3f7ed2` (`fix: close remaining compaction AC-01/AC-09 gaps without flipping flags`)  
**PRD:** [ai-chat-recoverable-history-incremental-compaction-prd.md](ai-chat-recoverable-history-incremental-compaction-prd.md)  
**Technical design:** [ai-chat-recoverable-history-incremental-compaction-technical-design.md](ai-chat-recoverable-history-incremental-compaction-technical-design.md)

Do **not** treat older `[x]` items in these worktree files as “nothing left”:

- `docs/prd/ai-chat-recoverable-history-incremental-compaction-todo.md`
- `docs/prd/ai-chat-recoverable-history-incremental-compaction-remaining-todo.md`
- `docs/prd/ai-chat-recoverable-history-incremental-compaction-open-todo.md`

This file is the independent audit after those implementer TODOs claimed remaining code items were closed.

---

## Verdict

The worktree contains a real, substantial implementation — not a stub. All four PRD milestones have working code:

- 7 new entities, 8 new Models, 2 Modules, ~14 new services, 4 Vue components
- 6-language i18n, new IPC channels
- ~25.5k insertions across 134 files vs merge base `f2aaa043`

Mechanical health at audit time:

- `npx tsc --noEmit -p tsconfig.json`: **clean** (`TSC_EXIT=0`)
- Feature unit tests: **16 files / 177 passed** (see verification log)
- Component gate `yarn test:components`: **52 files / 332 passed**

**It is not complete against the PRD.** Eleven real bugs were found; four are blocking. The most important problem is not in the compaction engine (which is genuinely bounded) but in rollout wiring: the two history tools are advertised to the model unconditionally while the archive indexer is gated behind a flag that **defaults off**, so in a default build the assistant can report “no match” for history that is sitting in the database.

No code was changed during this audit. Electron E2E, 100k-message p95, and live-provider recall scoring were **not** re-run here.

---

## What genuinely meets the PRD

The core scaling fix is real.

- `runFullCompact` no longer builds an all-history request; it delegates to `AIChatCompactionCoordinator` and throws if the coordinator is absent.
- Legacy all-history prompt builder (`buildFullCompactUserPrompt`) has **zero callers** in `src/`.
- Session-memory and reactive-overflow both route through the same coordinator.
- Section retry ceilings (≤2 reductions, ≤4 attempts) and the bounded one-section-at-a-time overview merge match design §8.3 / §16.
- When the new-compaction flag is off, compaction **fails closed** (errors) instead of falling back to unbounded summarization. That satisfies “no all-history path,” but compaction is inoperable until the flag is enabled.

Archive reads are properly bounded:

- Keyset pagination on composite `(timestamp, id)` with TypeORM `Brackets` predicates and `take(pageLimit)`.
- Unicode-safe code-point offsets (`AIChatArchiveTextUtil.codePointLength`).
- Cursors are opaque, versioned, and validated against conversation + epoch.
- Search cursors additionally bind query hash and revision.
- Conversation ID always comes from trusted tool context (`SkillExecutionContext.conversationId`), never a model argument.
- No cross-conversation leak path found; no SQL injection surface (search matching happens in JS over bound-parameter queries).

Concurrency has durable teeth:

- Synchronous in-flight map **before** the first await.
- Fence-bumped claims.
- Compare-and-swap on `activeGenerationId`.
- Deterministic section `workKey` for retry dedup.
- No DB transaction held across an AI call.

UI / IPC / i18n:

- i18n parity is exact — **45 new keys** present in all six language files (`en`, `zh`, `es`, `fr`, `de`, `ja`).
- Compaction IPC checks `canUseChat()` **before** parsing the payload (`handleCompactionStart`).
- Local history browsing correctly has **no** AI gate.
- Blocking `AI_CHAT_V2_COMPACT_CONVERSATION` channel was removed; START is the compact contract.
- QueryLoop runs `budgetService.preflight()` immediately before `streamChatCompletion`.

---

## Requirements scorecard

| Requirement | Status | Evidence / gap |
| --- | --- | --- |
| G2 / FR-07 no all-history summarization | **IMPLEMENTED** (fail-closed) | Coordinator required; no `completeChat` all-history path |
| FR-01 bounded archive reads | **IMPLEMENTED** | Keyset `(timestamp, id)`; code-point offsets. Page cursors do **not** bind `revision` (search cursors do). |
| FR-02 `conversation_history_search` | **PARTIAL** | Query 1–200, limit 10/20, opaque cursors, `HISTORY_NO_MATCH` only when scan complete. **Missing:** index-unavailable fallback; `before`/`after`/`types` unwired; tool wrapper hardcodes `truncated: false`. |
| FR-03 `conversation_history_read` | **PARTIAL** | Exclusive source_id / message_id / range; neighbors 0–2; 4k/8k caps. **Missing:** `storedContentIncomplete` always `false`. |
| FR-04 retrieval budget | **PARTIAL** | 8000 cumulative / 4 calls / interval dedup exist. **Bug:** neighbors bypass allowance. |
| Scope isolation / security | **IMPLEMENTED** | Trusted conversation context; cursor epoch binding; `findOne({ id, conversationId })`. |
| `conversation_tool_history` bounded lookup | **PARTIAL** | Indexed `getToolPair` + 256-row window. `stored_content_incomplete` not wired into history read. |
| FR-05 recent complete turns | **PARTIAL** | Assembler uses token-cost retention + receipts. Compaction snapshot uses **turn count** (`minRetainedCompleteTurns: 2`), not token cost. |
| FR-06 continuation state | **MISSING** | `continuationStateJson` column exists; coordinator never passes it on publish. |
| FR-07 incremental compaction | **PARTIAL** | `workKey` reuse; `representedSourceIds`. Resume ignores staged cursor / working overview. |
| FR-08 budget on compaction calls | **PARTIAL** | QueryLoop preflight yes. Compaction uses `allocateSectionCapacity` but **does not apply** returned `sourceCapacity`; summarize callbacks skip `preflight()`. |
| FR-09 concurrency / deletion | **PARTIAL** | Claim/fence/CAS/workKey good. Snapshot computed **before** claim. Tombstone **after** message delete. |
| FR-10 UI / selections | **PARTIAL** | Drawer/search/chips/status exist. Backend ignores `submissionId`. Oversized selections silently omitted. Navigate only closes drawer. |
| FR-11 failure / degraded | **PARTIAL** | Invalid summaries rejected. Index miss vs no-match weak. AI-disabled browse works at IPC level. |
| Design §8.3 source capacity applied | **NOT APPLIED** | `allocateSectionCapacity().sourceCapacity` unused by coordinator. |
| Design §11.5 overview merge bounded | **IMPLEMENTED** | Prior overview + one new section only. Merge-failure still advances counters (bug 11 related). |
| Design §13.3 submissionId reuse | **MISSING** on backend | Renderer sends it; engine always `saveUserMessage`. |
| Design §15 rollback / legacy-summary mode | **MISSING** | Flags off → hard error, not budget-checked legacy mode. |
| Design §18 feature flags | **PARTIAL** | Defaults fail-closed. `isHistoryToolsEnabled` / `isHistoryUiEnabled` **consumed nowhere**. Tools registered unconditionally. |
| AC-02 / AC-22 **model** halves | **UNVERIFIED** | Storage halves exist; live provider scoring needs `AIFETCHLY_RECALL_LIVE=1` + key. |
| AC-01 three-compact E2E / 100k p95 | **UNVERIFIED here** | Implementer claimed pass; this audit did not re-run E2E or 100k fixture. |

---

## Errors still in the worktree (fix these)

### Blocking

- [ ] **P0: History tools are exposed while the archive is unindexed.**
  - What is wrong: `isHistoryToolsEnabled()` and `isHistoryUiEnabled()` are defined in `src/config/featureFlags.ts` but consumed **nowhere**. Tools are registered unconditionally in `src/config/skillsRegistry.ts` (~1156 search, ~1253 read). Meanwhile `isArchiveReadsEnabled()` (default false, `=== "true"`) disables `AIChatArchiveIndexer` and `AIChatArchiveAppendCoupler`.
  - Why it matters: on a default build the model can call `conversation_history_search`, get zero fragments, and receive `HISTORY_NO_MATCH` for text that exists — inverted FR-04 (“never claim content was recovered when the source cannot be found”) as a **false negative**.
  - Evidence:
    - `src/config/featureFlags.ts` `isArchiveReadsEnabled` / `isHistoryToolsEnabled` / `isHistoryUiEnabled`
    - Flag consumers: `ai-chat-v2-ipc.ts` (new compaction only), `AIChatQueryEngine.ts`, `AIChatArchiveRecoveryStartup.ts`, `AIChatArchiveAppendCoupler.ts` — **no history-tools flag**
    - `src/config/skillsRegistry.ts` `CONVERSATION_HISTORY_SEARCH_TOOL_NAME` / `CONVERSATION_HISTORY_READ_TOOL_NAME`
  - Fix: gate the tools on `isHistoryToolsEnabled() && isArchiveReadsEnabled()`, **or** add the missing bounded source-scan fallback when the index is incomplete (FR-02). Prefer both.
  - Requirements: FR-02, FR-04, FR-11; AC-01, AC-20; design §18.

- [ ] **P0: `submissionId` is ignored by the backend; retries duplicate the user message.**
  - What is wrong: renderer sends a stable submission ID (`AiChatV2.vue` ~4148). IPC validates it (`ai-chat-v2-ipc.ts` ~833). `AIChatQueryEngine` never reads it and calls `saveUserMessage` unconditionally (~946).
  - Why it matters: a transport retry before `start` writes a second user row with a second selected-context block. Design §13.3 forbids this.
  - Evidence: `rg submissionId src/service/AIChatQueryEngine.ts src/modules/AIChatModule.ts src/modules/AIChatV2Module.ts` → no hits in engine/modules.
  - Fix: persist/lookup by `(conversationId, submissionId)` and reuse the same user message + selections.
  - Requirements: FR-10; AC-18; design §13.3.

- [ ] **P0: Neighbor reads are unbounded and bypass the retrieval budget.**
  - What is wrong: `readNeighbors` pushes `m.content ?? ""` whole, with no slicing and no allowance check, then adds cost afterwards (`AIChatHistoryRetrievalService.ts` ~868).
  - Why it matters: up to four multi-megabyte neighbor rows can land in one read response, breaking the 4,000 / 8,000-token allowance and PRD invariant 4.
  - Evidence:
    ```
    // AIChatHistoryRetrievalService.ts ~581–596 neighbors after main slice
    // ~866–869: out.push(toExcerpt(..., m.content ?? "", true));
    //            b.consumedTokens += this.estimateTokens(m.content ?? "");
    ```
  - Fix: slice neighbors to remaining per-call / cumulative allowance; set `has_more` / `truncated`; refuse if even the envelope cannot fit.
  - Requirements: FR-03, FR-04, FR-08; AC-11; design §7.2 / §7.4.

- [ ] **P0: Oversized selections are silently dropped instead of blocking the turn.**
  - What is wrong: `buildSelectedHistoryContextBlock` correctly throws `CONTEXT_REQUIRED_CONTENT_TOO_LARGE`, but `resolveSelectedHistory` discards `result.errorCode` and proceeds. Comment at `AIChatQueryEngine.ts` ~872: “Rejected/unavailable selections never block the turn.”
  - Why it matters: if every selection is oversized, the message sends with **zero** selected context while chips still show as attached. FR-10 requires asking the user to narrow; do not silently omit.
  - Evidence: `AIChatQueryEngine.ts` ~423–430, ~872–880; `SelectedHistoryContextBlock.ts` ~52–57.
  - Fix: if `errorCode === CONTEXT_REQUIRED_CONTENT_TOO_LARGE` (or all selections rejected for size), fail the turn with an actionable UI error; keep draft chips.
  - Requirements: FR-10; AC-16, AC-18; design §13.3.

### Significant

- [ ] **P1: Section is packed before it is budgeted; computed `sourceCapacity` is thrown away.**
  - What is wrong: `packer.pack()` runs at `AIChatCompactionCoordinator.ts` ~304 with the flat 12,000-token default (`sourceCapacityTokens` from input or `sectionSourceTargetTokens`). `allocateSectionCapacity` runs ~394 and only `errorCode` is checked. Returned `sourceCapacity` is never assigned.
  - Why it matters: design §8.3 requires `sourceCapacity = min(12000, C - Osection - M - promptOverhead - stateInputCost)` and that small-window models override 12,000 **downward**. Current order burns both reduction retries on every section for small models.
  - Extra: compaction summarize callbacks (`providerSummarize` in `ai-chat-v2-ipc.ts` ~296, `AIChatCompactAgentService`, `AIChatQueryEngineFactory`) call `openAIChatCompletion` / `completeChat` **without** `budgetService.preflight()` on the actual messages.
  - Evidence: `AIChatRequestBudgetService.ts` `allocateSectionCapacity` (~238–262); coordinator ~193–195, ~304–310, ~394–415.
  - Fix: allocate capacity **before** pack; pass `preflight.sourceCapacity` into `packer.pack`; run `preflight()` on the serialized summarize request.
  - Requirements: FR-08; AC-04, AC-15; design §8.3 / §8.5.

- [ ] **P1: Checkpoint advances even when coverage is incomplete.**
  - What is wrong: `coveredThroughTs` / `coveredThroughRowId` fall back to the last fragment when `exclusionBoundary` is undefined (`AIChatCompactionCoordinator.ts` ~320–327) — the `coverageComplete === false` case. Packer `coverageComplete` is **page-level** (`!page.truncated && page.nextCursor === null` plus per-message fragments), not terminal-turn-level (`AIChatSectionPacker.ts` ~367–381). Packer uses `readPage`, not `readTurnRange`.
  - Why it matters: FR-05 / AC-06: do not advance coverage until every fragment of a message / terminal turn is covered. A truncated page can pack a user message without its assistant reply.
  - Evidence: coordinator ~320–327; packer ~299–310, ~367–395.
  - Fix: do not persist `sourceEnd*` past `exclusionBoundary`; if absent, keep fragment-level staged progress **without** advancing the compactable checkpoint; pack complete turns only.
  - Requirements: FR-05, FR-07; AC-06; design §§4.3, 9.2.

- [ ] **P1: Resume state is written but never read.**
  - What is wrong: `stagedCursorJson`, `workingOverviewJson`, `mergedThroughOrdinal` are persisted by `saveWorkingOverview` (`AIChatCompactionCoordinator.ts` ~458, ~488–490; `AIChatCompactionRun.model.ts` ~377–419 comments promise resume from ordinal). `loadResumeState` (~661–768) reads **neither** — only section ends + published generation overview.
  - Why it matters: `workKey` reuse prevents duplicate model calls, so this costs **merge progress** rather than raw work. AC-07 is only partially satisfied (“restart reuses saved sections and keeps a consistent active generation”).
  - Fix: on resume, load `workingOverviewJson` + `mergedThroughOrdinal` + `stagedCursorJson` when fence/epoch/revision match.
  - Requirements: FR-07, FR-09; AC-07; design §5.3 / §11.4.

- [ ] **P1: Indexer can mark a live turn `completed`.**
  - What is wrong: when the walk finishes (`!hasMore`), the open turn is closed with `status: "completed"` (`AIChatArchiveIndexer.ts` ~222–240). The `open` branch only runs while more rows remain (~241–259).
  - Why it matters: a user message awaiting its reply becomes compactable, against FR-05 “never place the boundary inside an in-progress turn.” Two-turn retention usually masks it.
  - Fix: if the last turn has no terminal assistant/tool completion, persist `open` even when `!hasMore`; only mark `completed` on a real turn boundary.
  - Requirements: FR-05, FR-09; AC-03, AC-09; design §4.3.

- [ ] **P1: Deletion tombstones last, best-effort (AC-13 resurrection window).**
  - What is wrong: `clearConversation` deletes messages first, then session memory / compact / artifacts, then tombstones archive state at the end inside `try/catch` that only logs (`AIChatV2Module.ts` ~296–329). `invalidateConversation` exists (`AIChatCompactionRun.model.ts` ~526–529) but is **never called**. `publishGeneration` does not check `deletedAt`.
  - Why it matters: in that window — or if tombstone throws — in-flight `saveSectionAndCheckpoint` still validates against a live epoch and can recreate derived records for a deleted conversation.
  - Fix: tombstone / invalidate epoch+fence **first**, then delete sources and derived records; all save/publish must reject tombstoned state.
  - Requirements: invariant 9; FR-09; AC-13; design §11.6.

### Missing product requirements (not just bugs)

- [ ] **P1: FR-06 source-linked continuation state is never populated.**
  - `continuationStateJson` on `AIChatContextGeneration.entity.ts` ~69 and `AIChatCompactionRun.entity.ts` ~90; model accepts it (`AIChatCompactionRun.model.ts` ~291, ~332). Coordinator `publishGeneration` (`~546–558`) omits it. `rg continuationStateJson src/` shows only entity/model — **no producer**.
  - Need bounded state: current goal/task, constraints, accepted decisions, pending/blockers, artifact refs, next step; facts with validated source refs and proposed/accepted/superseded/uncertain; canonical plan/goal preferred over inferred memory.
  - Requirements: FR-06; AC-03; design §10 / §12.

- [ ] **P1: FR-03 `storedContentIncomplete` is always `false`.**
  - Hardcoded at all 12 return sites in `AIChatHistoryRetrievalService.ts` (e.g. ~423, 435, 449, 499, 558, 600, 652, 669, 706, 843, 1053). Design §7.3 requires this flag separate from response `truncated`.
  - Requirements: FR-01, FR-03; AC-10; design §7.3.

- [ ] **P1: FR-02 no bounded source fallback when search index is incomplete.**
  - Search only scans `ai_chat_archive_search_fragment` via `fragModel.scanLiteral`. PRD: “An unavailable index should fall back to bounded source lookup where feasible.” Combined with P0 flag/tool mismatch, this is how false `HISTORY_NO_MATCH` happens.
  - Incomplete index + zero hits currently returns `HISTORY_NO_MATCH` + `index_complete: false` — ambiguous vs true no-match.
  - Requirements: FR-02, FR-11; AC-01; design §15.5.

- [ ] **P2: FR-02 `before` / `after` / `types` are schema-only.**
  - Defined in `src/schemas/aiChatHistoryTools.ts` ~13–25. `search()` only forwards `query`, `cursor`, `limit` (`AIChatHistoryRetrievalService.ts` ~218). Registry JSON schema omits them entirely (`skillsRegistry.ts` ~1164–1188). Dead fields, not advertised-and-broken.
  - Requirements: FR-02.

- [ ] **P2: Design §15 rollback / budget-checked legacy-summary mode missing.**
  - Flags off → compaction throws. Must not restore unbounded summarization (good), but also does not provide the documented compatibility fallback.
  - Requirements: §9 compatibility; design §15 / §18.

### Minor

- [ ] **P2: Snapshot computed before durable claim (race).**
  - `computeSnapshotEnd` then `claimRun` (`AIChatCompactionCoordinator.ts` ~215–233). Comment says frozen at claim. Messages appended between the two can miss the retention boundary.
  - Requirements: FR-09; AC-08, AC-09; design §11.3.

- [ ] **P2: Legacy timestamp-only exclusion survives without a generation.**
  - Assembler filters `r.timestamp.getTime() > throughTimestamp` (`AIChatContextAssembler.ts` ~328–333). Drops rows sharing the boundary millisecond. Design decision 2 bans timestamp-only comparisons.
  - Requirements: §9.3; AC-19; design §15.6.

- [ ] **P2: Overview-merge failure still advances counters.**
  - `mergeOverview` returns `prior` on failure (~1003–1009) but caller still `representedCount += 1` and `saveWorkingOverview` (~469–491). Staged sections can exist without being reflected in the rolling overview.
  - Requirements: FR-07, FR-11; AC-14; design §11.5.

- [ ] **P2: `renewLease` does not verify `leaseOwner`.**
  - Fence checked; `leaseOwner` overwritten (`AIChatCompactionRun.model.ts` ~149–168). Low risk in a single main process.
  - Requirements: FR-09; design §11.3.

- [ ] **P2: Page/read cursors do not bind `revision`.**
  - `decodeCursor` checks conversationId + epoch only (`AIChatArchiveCursorCodec.ts` ~56–62). Tampered cursor cannot switch conversations but can resume a stale revision after source changes. Search cursors **are** stricter.
  - Requirements: FR-01; design §4.2 / §7.1.

- [ ] **P2: Search tool wrapper hardcodes `truncated: false`.**
  - `conversationHistorySearchTool.ts` ~40–46. Budget truncation uses `MODEL_BUDGET_UNAVAILABLE` instead of `truncated: true`.
  - Requirements: FR-02; AC-11; design §7.1 envelope.

- [ ] **P2: Range direction validated by `rowId` only.**
  - `AIChatHistoryRetrievalService.ts` ~733–736 `from.rowId > to.rowId`. Should be composite `(timestamp, rowId)`.
  - Requirements: FR-01, FR-03.

- [ ] **P2: Ambiguous `message_id` previews marked `exact: true`.**
  - Preview sliced to 500 code points with `exact: true` (~677–687).
  - Requirements: FR-03; design §10 (`exact: true` only for verified original slices).

- [ ] **P2: “Go to message” does not navigate.**
  - `handleHistoryNavigate` only closes the drawer (`AiChatV2.vue` ~1696–1698); excerpt argument discarded.
  - Requirements: FR-10; design §7.2.

- [ ] **P2: `rejected` chip state never populated.**
  - UI supports `rejected`/`refreshed` (`AiChatSelectedContext.vue` ~34). `AiChatV2.vue` only maps `refreshed` on `start` (~4181–4184). i18n `source_changed` / `source_unavailable` unused in any `.vue` file.
  - Requirements: FR-10; AC-18.

- [ ] **P2: `sectionsPacked` discarded in UI.**
  - Event carries count; handler drops it (`AiChatV2.vue` ~1638–1642). i18n `compaction_in_progress` `{packed}` unused. Allowed (indeterminate spinner), but a missed status affordance.
  - Requirements: FR-10.

- [ ] **P2: Selected-context clear button missing `aria-label`.**
  - `AiChatSelectedContext.vue` ~29–35. Other history controls have labels.
  - Requirements: FR-10; AC-24.

- [ ] **P2: Generation overview weaker injection-safety framing.**
  - Receipts / selected history say historical evidence, not instructions. Overview uses `COMPACT_PREAMBLE` as `role: "system"` (`AIChatContextAssembler.ts` ~53–54, ~569).
  - Requirements: invariant 10; AC-22; design §12.

- [ ] **P3: Dead all-history prompt helper remains.**
  - `AIChatCompactPromptBuilder.buildFullCompactUserPrompt` — unreachable but confusing.
  - Requirements: G2; design §21 (“no full-history fallback may remain reachable”). Prefer delete.

- [ ] **P3: Compaction retention suffix is turn-count-based.**
  - `computeSnapshotEnd` uses `minRetainedCompleteTurns` count (`AIChatCompactionCoordinator.ts` ~623–628), not token cost. Assembler path **does** use tokens.
  - Requirements: FR-05.

- [ ] **P3: Live in-progress tail: partial retention + warning only.**
  - `AIChatContextAssembler.ts` ~768–771. Downstream preflight may still reject; assembler does not throw `CONTEXT_REQUIRED_CONTENT_TOO_LARGE`.
  - Requirements: FR-05; AC-16.

---

## Suggested fix order

1. **P0 flag/tool mismatch** — stop advertising search/read until archive indexing is on, and/or add source-scan fallback.
2. **P0 `submissionId` idempotency** in `AIChatQueryEngine` / Module.
3. **P0 neighbor budget** + **P0 selection overflow must block the turn**.
4. **P1 apply `sourceCapacity` before pack** + compaction `preflight()`.
5. **P1 do not advance checkpoint without `exclusionBoundary`** + complete-turn packing.
6. **P1 resume from `workingOverviewJson` / staged cursor**.
7. **P1 indexer live-turn status** + **P1 tombstone-before-delete**.
8. **P1 populate continuation state** (FR-06) + `storedContentIncomplete` + index fallback.
9. Remaining P2 (legacy timestamp exclusion, snapshot-at-claim, navigate, rejected chips, a11y).
10. External: keyed-provider `AIFETCHLY_RECALL_LIVE=1` for AC-02 / AC-22 model halves. Keep flag defaults fail-closed until operator `enableRecoverableHistoryFlags()`.

Do **not** re-implement archive entities, bounded Model reads, coordinator skeleton, history drawer, or QueryLoop dispatch guard. Those are in place.

---

## Verification log (this audit, 2026-09-17)

Commands run from the worktree:

```
npx tsc --noEmit -p tsconfig.json          # TSC_EXIT=0
AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs \
  test/vitest/main/AIChatCompactionCoordinator.test.ts \
  test/vitest/main/AIChatSectionPacker.test.ts \
  test/vitest/main/AIChatRequestBudgetService.test.ts \
  test/vitest/main/AIChatHistoryRetrievalService.test.ts \
  test/vitest/main/AIChatArchiveModel.test.ts \
  test/vitest/main/ConversationHistoryTools.test.ts
# 6 files / 79 passed

AIFETCHLY_SKIP_TSC=1 yarn test:components
# 52 files / 332 passed

AIFETCHLY_SKIP_TSC=1 npx vitest run --config vite.main.config.mjs \
  test/vitest/main/AIChatCompactAgentBounded.test.ts \
  test/vitest/main/AIChatEngineBudgetWiring.test.ts \
  test/vitest/main/AIChatHistoricalRecall.test.ts \
  test/vitest/main/AIChatArchiveIndexer.test.ts \
  test/vitest/main/AIChatArchiveAppendCoupler.test.ts \
  test/vitest/main/AIChatArchiveRecoveryStartup.test.ts \
  test/vitest/main/AIChatSummaryValidator.test.ts \
  test/vitest/main/AIChatRecoverableFeatureFlags.test.ts \
  test/vitest/main/AIChatArchiveTurnReads.test.ts \
  test/vitest/main/AIChatArchivePerf.test.ts
# 10 files / 98 passed
```

Combined feature units this audit executed: **16 files / 177 passed**.

### Not run in this audit

- Electron E2E `test/e2e/specs/ai-chat-recoverable-history.test.ts` (implementer claimed 6/6 ~38–39s after `yarn build:e2e`)
- Full `yarn test:e2e`
- `AIFETCHLY_PERF_100K=1` 100k p95 (implementer claimed search p95=32 ms, read p95=1 ms on Apple M1 / 16 GB / Node 22.19.0 / better-sqlite3 13.0.2)
- Live-model recall (`AIFETCHLY_RECALL_LIVE=1`) — no provider key in this session

Treat those implementer numbers as **unconfirmed** until re-run.

---

## Implementer claims already closed (do not re-open unless they regress)

From `ai-chat-recoverable-history-incremental-compaction-open-todo.md` at HEAD `7d3f7ed2`. This audit **confirmed** the following are still true in code, or were not contradicted:

- Blocking `AI_CHAT_V2_COMPACT_CONVERSATION` channel / `handleCompactConversation` / renderer `compactConversation()` removed; START is the compact contract.
- Dead `getRecentTurns` helper removed (assembler uses paged `readTurnRows` + receipts).
- Image-only omitted-turn receipts added in assembler.
- Dynamic `import("electron")` in assembler replaced with static import.
- Packer equal-timestamp bound is composite `(timestamp, rowId)` (AC-09 packer bug the implementer listed as fixed — still verify if checkpoint fallback bug remains; it does, see P1 coverage).
- i18n 6-language key parity (this audit: 45 keys, no missing).
- QueryLoop final dispatch preflight exists.
- Coordinator retry ceilings exist (≤4 attempts, ≤2 reductions).
- Feature-flag defaults remain fail-closed; `enableRecoverableHistoryFlags()` writes all four Token keys.

---

## Design §21 completion definition (not met)

> The implementation is complete when the PRD's 24 acceptance criteria pass, original details remain retrievable after repeated compaction/restart, every model path is budget checked, and normal compaction processes only new eligible history in bounded resumable sections. No full-history summarization fallback may remain reachable through automatic, manual, session-memory, reactive, or compatibility paths.

Remaining to call this complete:

1. Close all P0/P1 items above.
2. Re-run Electron recoverable-history E2E after the P0 fixes.
3. Re-run 100k p95 with documented machine.
4. Live 50-case recall scoring (or explicitly defer as a release gate, not a “done” claim).
5. Operator enablement only after those gates — defaults stay fail-closed.
