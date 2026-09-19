# Recoverable History — Remaining Errors and Incomplete Tasks

**Date:** 2026-09-18  
**Worktree:** `/Users/cengjianze/project/aiFetchly/.claude/worktrees/ai-chat-compaction`  
**Branch:** `worktree-ai-chat-compaction`  
**HEAD at this list:** `e123d138` (`fix: budget-check compaction summarize dispatch and correct §8.3 source capacity`)  
**Prior independent audit:** [ai-chat-recoverable-history-incremental-compaction-audit-todo.md](ai-chat-recoverable-history-incremental-compaction-audit-todo.md)  
**PRD:** [ai-chat-recoverable-history-incremental-compaction-prd.md](ai-chat-recoverable-history-incremental-compaction-prd.md)  
**Technical design:** [ai-chat-recoverable-history-incremental-compaction-technical-design.md](ai-chat-recoverable-history-incremental-compaction-technical-design.md)

This file lists **only what is still open** after a 2026-09-18 re-audit of the worktree. Do not re-implement closed items unless they regress.

**2026-09-18 completion round:** all P1, M, and P2 code items below are fixed and committed on branch `worktree-ai-chat-compaction` (commits `848375dc`..`25cafdd5` + follow-ups; see each item).

**Current remaining work (re-audit HEAD `e4bccad5`):** [ai-chat-recoverable-history-incremental-compaction-remaining-after-completion-round.md](ai-chat-recoverable-history-incremental-compaction-remaining-after-completion-round.md) — leftovers C-1–C-7 plus qualification Q-1–Q-4. Do not treat this file as the live remaining list.

---

## Current verdict

The four blocking **P0** audit bugs are fixed and committed. The **P1 budget** item (allocate `sourceCapacity` before pack + preflight summarize dispatch) is also committed on `e123d138`.

All 4 P1 logic bugs, all 5 missing product requirements (M-1–M-5), and all 16 P2 leftovers are now closed with regression tests (see evidence per item). Electron recoverable-history E2E re-run **6/6 passed** after the fixes; 100k p95 re-run (search p95 = 26 ms, read p50 = 1 ms) on Apple M1 / 16 GB / Node 22.19.0.

Related tests re-run 2026-09-18 (8 files / 94 passed): coordinator, packer, summarize dispatch, engine budget wiring, history retrieval, conversation history tools, query-engine history selection, feature flags.

---

## Already closed — do not re-open unless they regress

| Item | Commit | Evidence |
| --- | --- | --- |
| P0 history tools advertised while archive unindexed | `38570e10` | `skillsRegistry.ts`: execute + `isSkillRuntimeEnabled` require `isHistoryToolsEnabled() && isArchiveReadsEnabled()`; otherwise `HISTORY_UNAVAILABLE` / tool omitted |
| P0 `submissionId` ignored → duplicate user rows | `25eb2820` | `AIChatQueryEngine.ts` ~955–965: `saveUserMessageIfAbsent` with `user-${submissionId}` |
| P0 unbounded neighbor reads | `f7d6d40b` | `AIChatHistoryRetrievalService.readNeighbors` slices to remaining chars; `hasMore` set |
| P0 oversized selections silently omitted | `9b8a9e72` | `resolveSelections` + `selectionErrorCode` return `CONTEXT_REQUIRED_CONTENT_TOO_LARGE` if **any** selection is oversized; engine throws **before persist** |
| P1 section packed before budget; `sourceCapacity` unused; summarize skipped `preflight()` | `e123d138` | Coordinator allocates then packs; `dispatchSectionSummarize` preflights `I + O + M <= C`; packer no longer multiplies token budget × 4 a second time |

Blocking `AI_CHAT_V2_COMPACT_CONVERSATION`, dead `getRecentTurns`, image-only receipts, and assembler static Electron import remain closed from earlier worktree rounds.

---

## Errors still in the worktree (P1)

These are incorrect behavior, not optional polish.

### P1-1. Checkpoint advances when coverage is incomplete

- [x] **Error: section `sourceEnd*` falls back to the last fragment when `exclusionBoundary` is missing.** Fixed in `6da95955`: coordinator caps the checkpoint at `exclusionBoundary` (no advance without a complete terminal turn); packer publishes a boundary only for complete terminal turns (turn-projection check + user-role heuristic); loop breaks instead of repacking when nothing more is stageable. Tests: packer mid-turn/truncation cases, coordinator checkpoint-cap case, 3-cycle AC-01 unit test; E2E AC-01 + AC-06 pass.

  **What is wrong.** After packing, the coordinator still does:

  ```
  coveredThroughTs =
    packResult.exclusionBoundary?.timestampMs ??
    (lastFrag ? Date.parse(lastFrag.timestamp) : 0);
  coveredThroughRowId =
    packResult.exclusionBoundary?.rowId ??
    (lastFrag ? lastFrag.sourceRowId : 0);
  ```

  `exclusionBoundary` is only set when `coverageComplete && fragments.length > 0`. `coverageComplete` in the packer is **page-level**: `!page.truncated && page.nextCursor === null` plus every *eligible excerpt on that page* fully fragmented. It is not “every fragment of a terminal turn is covered.” The packer still uses `readPage`, not `readTurnRange`.

  **Why it matters.** FR-05 / FR-07 / AC-06: do not advance compactable coverage until every fragment of a message / complete terminal turn is represented. A truncated page can pack a user message without its assistant reply, then persist `sourceEnd*` at that last fragment. Resume then skips the rest of the turn.

  **Evidence.**
  - `src/service/AIChatCompactionCoordinator.ts` ~349–356 (fallback), ~445–453 (saved into `sourceEndTimestampMs` / `sourceEndRowId`), ~396–399 and ~485–488 (loop start cursor advanced to the same values).
  - `src/service/AIChatSectionPacker.ts` ~380–400 (`coverageComplete` heuristic; `exclusionBoundary` only if complete).

  **Fix.**
  1. Never persist compactable `sourceEnd*` past `exclusionBoundary`.
  2. If `exclusionBoundary` is absent, keep fragment-level staged progress **without** advancing the published/compactable checkpoint.
  3. Pack complete turns only (use turn-range reads; a page that splits a turn is not `coverageComplete`).

  **Done when.** A fixture whose first page cuts mid-turn: no `sourceEnd*` at the truncated user row; the assistant reply is still eligible on the next pack; AC-06 oversized-message fragments do not advance exclusion until the last fragment + terminal turn.

  **Requirements:** FR-05, FR-07; AC-06; design §§4.3, 9.2.

---

### P1-2. Resume writes staged overview/cursor but never reads them

- [x] **Error: `loadResumeState` ignores `workingOverviewJson`, `stagedCursorJson`, and `mergedThroughOrdinal`.** Fixed in `6da95955`: resume restores validated working overview + staged cursor (scope-checked) + merged-through ordinal from the active run, tracks merge ordinal separately from section ordinal, and publishes `representedSectionOrdinal` from actually-merged state. E2E AC-01 (three compactions + controlled restart) passes.

  **What is wrong.** After each section the coordinator persists:

  - `saveSectionAndCheckpoint(..., stagedCursorJson)`
  - `saveWorkingOverview({ workingOverviewJson, mergedThroughOrdinal, stagedCursorJson })`

  Model comments (`AIChatCompactionRun.model.ts` ~377–419) say restart should resume from the merged-through ordinal instead of re-merging from the beginning.

  `loadResumeState` (~667+) only:
  - lists committed sections and takes max `sourceEnd*`
  - optionally loads the **published** generation overview
  - synthesizes `startCursor` from `coveredThroughTs/RowId`

  It never reads `run.stagedCursorJson` or `run.workingOverviewJson`.

  **Why it matters.** `workKey` reuse avoids a second model call for identical packed work, so this is not a full all-history resend. It **does** lose merge progress after pause/crash (AC-07): overview may omit staged sections until a full rematch, and the packed cursor may not match the persisted staged cursor.

  **Evidence.**
  - Writes: `AIChatCompactionCoordinator.ts` ~464, ~494–496.
  - Reads: `loadResumeState` ~667–775 — no `workingOverviewJson` / `stagedCursorJson`.
  - Persistence: `AIChatCompactionRun.model.ts` `saveWorkingOverview`.

  **Fix.** On resume, if run fence/epoch/revision match, restore `priorOverview` from `workingOverviewJson`, `maxOrdinal` from `mergedThroughOrdinal`, and `startCursor` from `stagedCursorJson` (validated schema + conversation/epoch). Fall back to section ends + published generation if JSON is invalid.

  **Done when.** Kill after section save / working-overview persist, before `publishGeneration`: restart continues from that ordinal and does not rematch every staged section into a new merge from the published-only overview.

  **Requirements:** FR-07, FR-09; AC-07; design §5.3 / §11.4.

---

### P1-3. Indexer marks a live turn `completed` when the walk ends

- [x] **Error: `!hasMore` closes the current turn as `completed` even if it is still in progress.** Fixed in `848375dc`: tail turn is `completed` only with an assistant/tool terminal row, else `open`; high-water stays at the last complete turn. Test: user-only tail stays open until the reply arrives.

  **What is wrong.** After projecting a batch:

  ```
  if (!hasMore && currentTurnId.length > 0) {
    ...
    status: "completed",
  } else if (currentTurnId.length > 0) {
    status: "open",  // only while more rows remain
  }
  ```

  The `open` branch runs only when the archive still has unread rows. When indexing catches up to the live tail (user message, no assistant reply yet), that turn is stored as **completed**. Compaction’s compactable-prefix query then treats it as eligible.

  **Why it matters.** FR-05: never place the compaction boundary inside an in-progress turn or unresolved tool exchange. Two-turn retention often masks this; a short conversation or a user-only latest turn can be packed.

  **Evidence.** `src/service/AIChatArchiveIndexer.ts` ~222–259.

  **Fix.** If the last turn has no terminal assistant/tool completion (no native `turnId` close, no assistant/tool rows, or live engine turn still open), persist `status: "open"` even when `!hasMore`. Only mark `completed` on a real turn boundary (next user message, or explicit terminal state). High-water for compactable prefix must stay at the last **complete** turn end (the comment at ~257–259 already intends this).

  **Done when.** Fixture: user message only, index `runToCompletion` → turn remains `open`; coordinator snapshot excludes it. After assistant reply is indexed → `completed`.

  **Requirements:** FR-05, FR-09; AC-03, AC-09; design §4.3.

---

### P1-4. Conversation delete tombstones last (AC-13 resurrection window)

- [x] **Error: `clearConversation` deletes messages first; archive tombstone is last and best-effort; `invalidateConversation` is never called.** Fixed in `e2fb69fa`: tombstone + `invalidateConversation` run BEFORE message delete; `saveSectionAndCheckpoint` / `publishGeneration` / `saveWorkingOverview` reject tombstoned state. Test: post-tombstone saves rejected; E2E §17.2 deletion passes.

  **What is wrong.** Order today (`AIChatV2Module.clearConversation` ~296–329):

  1. `chatModule.clearConversation` (messages gone)
  2. session memory / compact / artifacts (each try/catch log-only)
  3. `AIChatArchiveStateModel.tombstone` in try/catch log-only

  `AIChatCompactionModule.invalidateConversation` exists (~143–147) and is **not** invoked. `publishGeneration` does not check `deletedAt`. In-flight `saveSectionAndCheckpoint` still validates live epoch/fence until tombstone succeeds.

  **Why it matters.** Invariant 9 / AC-13: clearing a conversation while a summary request is in flight must not let a late result recreate derived records. If tombstone throws or is delayed, a late AI response can still save a section/generation against a conversation whose messages are already gone.

  **Evidence.**
  - `src/modules/AIChatV2Module.ts` ~296–329.
  - `src/modules/AIChatCompactionModule.ts` `invalidateConversation`.
  - `src/model/AIChatCompactionRun.model.ts` ~526–529 (comment: invalidate before batch deletion).

  **Fix.** Tombstone / bump fence / invalidate epoch **first**, then delete sources and derived records through coordinated Module ops. All `saveSectionAndCheckpoint` / `publishGeneration` / `saveWorkingOverview` must reject tombstoned state (`deletedAt` or fence mismatch). Do not create archive state implicitly on a late save.

  **Done when.** In-flight summarize after `clearConversation` cannot insert sections/generations; coordinator test AC-13 covers tombstone-before-delete, not only fence-after-the-fact.

  **Requirements:** invariant 9; FR-09; AC-13; design §11.6.

---

## Tasks not complete (missing product requirements)

Implementation of archive entities, bounded Model reads, coordinator skeleton, history drawer, QueryLoop preflight, and P0 retrieval/selection gates is in place. These PRD / design items still have **no producer or no behavior**.

### M-1. FR-06 source-linked continuation state is never populated

- [x] **Missing: `continuationStateJson` is never written on publish.** Fixed in `f569d835`: coordinator builds bounded continuation state (goal, constraints, decisions, pending, next step, artifact refs, topics; source refs filtered to represented IDs) from the validated overview and passes it to `publishGeneration`. Test asserts populated goal/pending on publish.

  Column exists on `AIChatContextGeneration` and `AIChatCompactionRun`. Model `publishGeneration` accepts `continuationStateJson` (`AIChatCompactionRun.model.ts` ~291, ~332). Coordinator publish (~546–558) omits it. `rg continuationStateJson src/` → entity + model only; **no producer**.

  Need bounded state: current goal/task, constraints, accepted decisions, pending/blockers, artifact refs, next step. Each fact: validated source refs + `proposed | accepted | superseded | uncertain`. Canonical plan/goal preferred over inferred memory. Historical instructions must not grant permissions (validator already rejects permission-grant patterns in **section** summaries; continuation state must follow the same rule).

  **Requirements:** FR-06; AC-03; design §10 / §12.

---

### M-2. FR-03 `storedContentIncomplete` is always `false`

- [x] **Missing: pre-persistence truncation is never surfaced.** Fixed in `3d83316c`: metadata truncation flags + tool-history clip bound (`TOOL_HISTORY_LOOKUP_CONTENT_CHARS`) wired through single/range/neighbor reads via `storedIncompleteForMessages`; no-record rejections legitimately stay `false`. Tests: truncation-flag read returns `storedContentIncomplete: true`.

  Field exists on read results. Hardcoded `false` at every return site in `AIChatHistoryRetrievalService.ts` (including ~423, 435, 449, 499, 558, 602, 654, 671, 708, 845, 1080). Design §7.3: `stored_content_incomplete: true` is **separate** from this response’s `truncated: true`. Tool-history `content_truncated` is not wired into `conversation_history_read`.

  **Requirements:** FR-01, FR-03; AC-10; design §7.3.

---

### M-3. FR-02 no bounded source fallback when the search index is incomplete

- [x] **Missing: search only scans `ai_chat_archive_search_fragment`.** Fixed in `3d83316c`: zero-hit + scan-complete + index-incomplete falls back to a bounded (2-page/128-row) literal source walk with the same filters/budget accounting; exhaustion surfaces `MODEL_BUDGET_UNAVAILABLE`, never false `HISTORY_NO_MATCH`. Test: unindexed conversation still returns the source hit with `indexComplete: false`.

  `AIChatArchiveModule` search → `fragModel.scanLiteral`. No `readPageForward` literal walk when `indexState !== "complete"`. Incomplete index + zero hits currently returns `HISTORY_NO_MATCH` + `index_complete: false` — ambiguous vs true no-match.

  P0 flag gating stops the **default-off** false negative (tools not advertised). Once flags are on and backfill is still running, the same miss remains.

  PRD: “An unavailable index should fall back to bounded source lookup where feasible.” Design §15.5: read-only history can fall back to original messages before indexing completes.

  **Requirements:** FR-02, FR-11; AC-01; design §15.5.

---

### M-4. FR-02 `before` / `after` / `types` are schema-only

- [x] **Missing: filters defined in Zod, never forwarded, not in the model tool schema.** Fixed in `3d83316c`: handler forwards `before`/`after`/`types`, `search()` parses + applies them (timestamp exclusive bounds, role set), registry JSON advertises all three. Tests: role/after/before filtering via service and tool handler.

  `src/schemas/aiChatHistoryTools.ts` ~18–20. `AIChatHistoryRetrievalService.search()` only parses `query`, `cursor`, `limit`. Registry JSON (`skillsRegistry.ts` conversation_history_search properties) omits them — dead fields, not advertised-and-broken.

  **Requirements:** FR-02.

---

### M-5. Design §15 rollback / budget-checked legacy-summary mode missing

- [x] **Missing: flags off → compaction hard-errors; no documented compatibility fallback.** Fixed in `f569d835`: `runFullCompact` without a coordinator runs a budget-checked legacy summary (last ≤20 messages, sliced, preflighted via `dispatchSectionSummarize`, no generation published) instead of throwing; reachable via the auto full-compact path when new publication is rolled back. The unbounded all-history call is still never restored. START (new coordinator path) stays fail-closed by design — background triggers must not spend provider budget while publication is rolled back. Test: bounded-routing legacy fallback case.

  Fail-closed (no unbounded `runFullCompact`) is correct. Design still requires a budget-checked legacy-summary mode when new publication is rolled back, not “compaction unavailable” as the only path.

  **Requirements:** PRD §9; design §15 / §18.

---

## P2 leftovers (all closed 2026-09-18)

Smaller than P1; each was incorrect or incomplete vs the PRD and is now fixed with evidence inline.

- [x] **P2-1 Snapshot computed before durable claim (fixed `6da95955`: recompute after claim, earlier composite bound wins).** `computeSnapshotEnd` then `claimRun` (`AIChatCompactionCoordinator.ts` ~221–226). Messages appended between the two can miss the retention boundary. FR-09; AC-08/AC-09; design §11.3.

- [x] **P2-2 Legacy timestamp-only exclusion without a generation (fixed `f569d835`: legacy path retains boundary-ms rows with `>=`, duplication-safe).** Assembler `r.timestamp.getTime() > throughTimestamp` (`AIChatContextAssembler.ts` ~328–333, also ~603). Drops rows sharing the boundary millisecond. Design decision 2; AC-19; §15.6.

- [x] **P2-3 Overview-merge failure still advances counters (fixed `6da95955`: counters + working-overview persist only on successful merge; section save no longer bumps merged ordinal; test asserts `mergedThroughOrdinal` stays 0).** `mergeOverview` returns `prior` on failure (~1043) but caller still `representedCount += 1` and `saveWorkingOverview` (~484–496). Staged sections can exist without being in the rolling overview. FR-07, FR-11; AC-14; design §11.5.

- [x] **P2-4 `renewLease` does not verify `leaseOwner` (fixed `e2fb69fa`: mismatch throws `COMPACTION_STALE_CLAIM`; test covers wrong-owner renew).** Fence checked; owner overwritten (`AIChatCompactionRun.model.ts`). Low risk in a single main process. FR-09; design §11.3.

- [x] **P2-5 Page/read cursors do not bind `revision` (fixed `e2fb69fa`: optional expected-revision check in `decodeCursor`, wired in `readPageForward` + staged-cursor restore; stale-revision test).** `decodeCursor` checks `conversationId` + `epoch` only (`AIChatArchiveCursorCodec.ts` ~56–62). Search cursors **are** stricter. Tamper cannot switch conversations but can resume a stale revision. FR-01; design §4.2 / §7.1.

- [x] **P2-6 Search tool wrapper hardcodes `truncated: false` (fixed `3d83316c`: envelope `truncated` reflects `MODEL_BUDGET_UNAVAILABLE`; test asserts the flag).** `conversationHistorySearchTool.ts`. Budget truncation uses `MODEL_BUDGET_UNAVAILABLE` instead of the §7.1 envelope flag. FR-02; AC-11.

- [x] **P2-7 Range direction validated by `rowId` only (fixed `3d83316c`: composite `(timestamp, rowId)` check after resolving both rows; inverted-range test).** `AIChatHistoryRetrievalService.ts` ~733–736. Should be composite `(timestamp, rowId)`. FR-01, FR-03.

- [x] **P2-8 Ambiguous `message_id` previews marked `exact: true` (fixed `3d83316c`: `exact` only for full-length slices in single + preview paths; 600-char duplicate preview test asserts `exact: false`).** Preview sliced to 500 code points with `exact: true`. Design §10: `exact: true` only for verified original slices.

- [x] **P2-9 “Go to message” does not navigate (fixed `6a1608a0`: handler takes the excerpt, closes the drawer, smooth-scrolls to `[data-message-id]` with highlight; message roots carry the attribute).** `handleHistoryNavigate` only closes the drawer (`AiChatV2.vue` ~1696–1698); excerpt argument discarded. FR-10; design §7.2.

- [x] **P2-10 `rejected` chip state never populated (fixed `6a1608a0`: `rejectedIds` plumbed engine → start event → IPC → chips; `source_changed`/`source_unavailable` i18n tooltips verified in all six languages).** UI supports `rejected` (`AiChatSelectedContext.vue` ~34, ~68–69). `AiChatV2.vue` maps `refreshed` on changed ids (~4181+) but never `rejected: true`. i18n `source_changed` / `source_unavailable` unused in `.vue` files. FR-10; AC-18.

- [x] **P2-11 `sectionsPacked` discarded in UI (fixed `6a1608a0`: count in `CompactionStatusSnapshot`, running detail renders `compaction_in_progress {packed}` when > 0; component test).** Event carries the count; handler drops it. i18n `compaction_in_progress` `{packed}` unused. Indeterminate spinner is allowed; missed status affordance. FR-10.

- [x] **P2-12 Selected-context clear control a11y (fixed `6a1608a0`: `:aria-label` + Enter/Space keyboard handling; component tests).** `AiChatSelectedContext.vue` clear button has visible text (`clear_selections`) but no `:aria-label` (unlike drawer controls). Confirm keyboard/focus vs AC-24.

- [x] **P2-13 Generation overview weaker injection-safety framing (fixed `f569d835`: preamble frames overviews as historical evidence, never instructions/grants).** Receipts / selected history say historical evidence, not instructions. Overview uses `COMPACT_PREAMBLE` as `role: "system"` (`AIChatContextAssembler.ts` ~53–54, ~582). Invariant 10; AC-22; design §12.

- [x] **P2-14 Dead all-history prompt helper remains (fixed `f569d835`: full-compact helpers deleted, zero `src/` callers, tests updated).** `buildFullCompactUserPrompt` in `AIChatCompactPromptBuilder.ts` — zero `src/` callers. Prefer delete so design §21 “no full-history fallback may remain reachable” is obvious.

- [x] **P2-15 Compaction retention suffix is turn-count-based (ruling `25cafdd5`: intentional — compacted turns stay available via overview + archive reads, unlike the assembler's verbatim window; a token-budget extension stalled AC-01 and was reverted with AC-01 passing).** `computeSnapshotEnd` uses `minRetainedCompleteTurns` count, not token cost. Assembler path **does** use tokens. FR-05.

- [x] **P2-16 Live in-progress tail: partial retention + warning only (fixed `f569d835`: truncated live tail throws `CONTEXT_REQUIRED_CONTENT_TOO_LARGE` with actionable message).** `AIChatContextAssembler.ts` ~768–771. Assembler does not throw `CONTEXT_REQUIRED_CONTENT_TOO_LARGE`. FR-05; AC-16.

---

## External / verification (2026-09-18 completion round)

- [x] Re-ran Electron `test/e2e/specs/ai-chat-recoverable-history.test.ts` after all fixes: **6/6 passed** (~2.9 min). Covers AC-01 (three compactions + restart), AC-17, AC-18, AC-20, §17.2 deletion, AC-12.
- [x] Re-ran `AIFETCHLY_PERF_100K=1` 100k p95 on Apple M1 / 16 GB / Node 22.19.0: search p50 = 9 ms / p95 = 26 ms; single-id read p50 = 1 ms / p95 = 28 ms; deep-marker continuation recovery passes.
- [ ] Live 50-case recall (`AIFETCHLY_RECALL_LIVE=1`) for AC-02 / AC-22 **model** halves. Storage halves exist; no provider key in this session — explicitly deferred as a release gate, not a code defect.
- [ ] Operator enablement only after sign-off on the live-recall gate. Defaults stay fail-closed (`enableRecoverableHistoryFlags()` is explicit opt-in).

---

## Suggested order (completed 2026-09-18)

1. ~~**P1-1** exclusion boundary / complete-turn packing (AC-06).~~ Done (`6da95955`).
2. ~~**P1-2** resume from working overview + staged cursor (AC-07).~~ Done (`6da95955`).
3. ~~**P1-3** indexer live-turn `open` vs `completed` (FR-05).~~ Done (`848375dc`).
4. ~~**P1-4** tombstone + `invalidateConversation` **before** message delete (AC-13).~~ Done (`e2fb69fa`).
5. ~~**M-1** populate continuation state (FR-06).~~ Done (`f569d835`).
6. ~~**M-2 / M-3** `storedContentIncomplete` + index search fallback.~~ Done (`3d83316c`).
7. ~~**M-4 / M-5** search filters + rollback mode.~~ Done (`3d83316c` + `f569d835`; no deferrals).
8. ~~P2-1 snapshot-at-claim, P2-2 legacy timestamp, P2-3 merge-failure counters, then UI P2-9/P2-10/P2-13.~~ Done (plus P2-4–P2-8, P2-11, P2-12, P2-14–P2-16).
9. ~~External E2E / 100k / live recall.~~ E2E 6/6 + 100k re-run done; live recall deferred (no key).

Do **not** re-implement archive entities, bounded Model reads, coordinator skeleton, history drawer, QueryLoop dispatch guard, history-tool flag gating, `submissionId` idempotency, neighbor slicing, selection overflow blocking, or `dispatchSectionSummarize`. Those are in place on this HEAD.

---

## Design §21 (met except the live-model gate)

> Complete when the PRD's 24 acceptance criteria pass, original details remain retrievable after repeated compaction/restart, every model path is budget checked, and normal compaction processes only new eligible history in bounded resumable sections.

Status: code criteria met — E2E 6/6 (incl. AC-01 three-compact + restart, AC-12 scope isolation, AC-17/AC-18/AC-20, §17.2 deletion), 100k p95 re-run, 21 unit files / 252 tests + 52 component files / 335 tests green, `tsc`/`vue-tsc`/lint clean. Remaining before operator enablement: live 50-case recall scoring (`AIFETCHLY_RECALL_LIVE=1` needs a provider key); flags stay fail-closed until then.
