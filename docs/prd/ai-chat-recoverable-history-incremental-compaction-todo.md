# Recoverable History and Incremental Compaction — Remaining TODO

Date: 2026-09-17 (updated: P0+P1 complete, P2 partially qualified)

Worktree: `/Users/cengjianze/project/aiFetchly/.claude/worktrees/ai-chat-compaction`

Branch: `worktree-ai-chat-compaction`

HEAD: `7cf8956f` (`feat: bounded incremental compaction with recoverable history retrieval`) + uncommitted P0/P1/P2 round (see verification log below)

Status: **P0 and P1 complete and tested.** P2 deterministic qualification is substantially covered (50/50 recall storage, 10k scaled perf fixture, AC regression tests); the remaining P2 items need a live provider / reference machine / Electron run and are listed explicitly.

References:

- [PRD](ai-chat-recoverable-history-incremental-compaction-prd.md)
- [Technical design](ai-chat-recoverable-history-incremental-compaction-technical-design.md)

How to use this list: P0 items were correctness/regression defects in committed code (all fixed). P1 items were missing requirement slices (all implemented). P2 items are release qualification (design §21); deterministic parts are done, manual parts remain. A checkbox is closed only with the linked passing test/behavior noted under it.

Verification log for this round (2026-09-17, worktree):
- `npx tsc --noEmit -p tsconfig.json`: clean (0 errors)
- `npx vue-tsc --noEmit`: clean
- `npx eslint --no-fix` on all touched src/test files: clean
- Targeted main suites, all passing:
  - `AIChatHistoryRetrievalService` 29 · `AIChatCompactionCoordinator` 11 ·
    `AIChatArchiveModel/SectionPacker/SummaryValidator/Indexer/RequestBudget` (neighbors) ·
    `AIChatEngineBudgetWiring` + `AIChatCompactAgentBounded` ·
    `AIChatCompactAgentService` 24+ (incl. 4 new AC-23 budget tests) ·
    `AIChatContextAssembler` ×3 files 36 (incl. 3 new turn/generation tests) ·
    `AIChatQueryEngine` ×6 files (27 + 18 + historySelection incl. changed-ids test) ·
    `AIChatQueryLoop` + both chat-v2 IPC suites 82+ ·
    `ConversationToolHistoryService` + tool handler 15 (incl. fixed non-constructable mock) ·
    `AIChatHistoryI18n` 4 · `AIChatHistoricalRecall` 50/50 ·
    `AIChatArchivePerf` 4 (10k scaled fixture)
- Component suite (`test/vitest/main/components/vitest.config.mjs`): **52 files, 332 tests, all passing** (incl. new `AiChatHistoryMessage` 7 tests, drawer open-on-show test, changed-chip test)
- Utility-code suite (`vite.utilityCode.config.mjs`): `AIChatHistorySelections` 17 passed (trim→fail expectations updated)
- Pre-existing failures NOT caused by this round (verified identical on stashed HEAD): `ScheduledAiMessageRunner.chatLoop` 13 (non-constructable `vi.fn()` module mock), plus the same Vitest-4 mock pattern fixed where it touched this feature (`conversationToolHistoryTool`, `ai-chat-v2-compact-ipc`)
- NOT run here: Electron E2E (`yarn test:e2e`), 100k reference-machine p95 measurement, live-model recall scoring

---

## P0 — Defects in committed code (all fixed this round)

- [x] **Do not report a paused compaction run as failed.** FIXED: `AIChatCompactSummaryStatus` gains `paused|joined|cancelled`; `runFullCompact` preserves them (auto hook fires on `completed` only); compact IPC emits `running` at start and maps the final state 1:1 (paused resolves, not denied); renderer resets the badge/notice on `active` only and refreshes status otherwise. Tests: `AIChatCompactAgentBounded` paused/joined/cancelled mapping, compact-IPC paused-resolves test.
  - Reason: After the batch limit the coordinator correctly returns `paused`, but `runFullCompact()` maps any non-`completed` state to `failed`. Manual compact IPC then broadcasts `failed`. A long conversation looks like a failure after the first three sections.
  - Evidence: `src/service/AIChatCompactAgentService.ts:575` and `:583`; `src/main-process/communication/ai-chat-v2-ipc.ts` `handleCompactConversation` (awaits the compact call, then emits `completed` vs `failed` from `summary.status`).
  - Work: Preserve `paused` / `joined` / `cancelled` through the legacy compact view and progress event. Use the start/status/progress flow from design §13.1 so the renderer does not wait on one indefinite IPC call.
  - Done when: A history that needs more than three sections shows paused/in-progress, not failed; retry/resume continues from the checkpoint.
  - Requirements: FR-07, FR-09, FR-10; AC-04, AC-07; design §§11.2, 13.1.

- [x] **Materialize recent turns from the turn start, not conversation start.** FIXED: `ReadPageForwardInput` gains inclusive `startTimestampMs/startRowId`; `getRecentTurns` keysets per turn from first→last (no head scan, no post-filter); `computeSnapshotEnd` reads turn projections directly (no excerpt decoding, no dynamic import). New `readTurnRows`/`readRowsAfter` module methods. Tests: assembler turn-retention suite; engine suites green.
  - Reason: `getRecentTurns()` calls `readPageForward()` with only an end snapshot. With no start cursor that query reads the first 64 rows of the conversation. In a long chat the retained suffix is never in that page, excerpts are empty, and `computeSnapshotEnd()` falls back to high-water — compacting through the latest message, including “continue” context.
  - Evidence: `src/modules/AIChatArchiveModule.ts:344–394`; `src/model/AIChatMessageArchive.model.ts` `readPageForward`; `src/service/AIChatCompactionCoordinator.ts` `computeSnapshotEnd`.
  - Work: Keyset from each retained turn’s `(firstTimestampMs, firstRowId)` through `(lastTimestampMs, lastRowId)`. Do not approximate the snapshot from decoded excerpt source IDs. Keep the live turn excluded.
  - Done when: A conversation with well over 64 earlier rows still retains the latest two complete turns after compaction (AC-03).
  - Requirements: FR-05, FR-09; AC-03, AC-09; design §§4.3, 11–12.

- [x] **Preserve exact source offsets on selection resolution.** FIXED: both `resolveSelections` branches use `toExcerptWithSpan` with the requested span (field preserved). Tests: double round-trip test (resolve → returned id → resolve again, same text + same nonzero span).
  - Reason: Search uses `toExcerptWithSpan()` with the real `[start, end)` interval. `resolveSelections()` slices correctly, then `toExcerpt()` re-encodes the slice as `startCodePoint: 0` / `endCodePoint = slice length`. First-send `excerpt.text` is right; a later resolve of the **returned** source id reads the message prefix. Tests assert text only, not the re-encoded id.
  - Evidence: `src/modules/AIChatArchiveModule.ts:499`, `:519`, `:536` (`toExcerpt`) vs `:569` (`toExcerptWithSpan`); `test/vitest/main/AIChatHistoryRetrievalService.test.ts` “preserves nonzero offsets…”.
  - Work: Use `toExcerptWithSpan` for every resolved slice. Assert returned `sourceId` still has the original nonzero span after search → read → select, and after a second `resolveSelections` of that returned id.
  - Done when: A mid-message hit round-trips twice without becoming the prefix.
  - Requirements: FR-01–03, FR-10; AC-01, AC-18; design §§4, 7, 13.3.

- [x] **Reject changed-source selections instead of reapplying stale offsets.** FIXED: revision mismatch rejects the stale id and returns it in a new `refreshed[]` list (excerpt at current revision, never quoted); retrieval passes it through and reports `SOURCE_CHANGED`; engine emits `historySelectionChangedIds` on `start` and excludes stale text from the provider message; renderer flags surviving chips `refreshed` for explicit re-confirmation. Tests: stale-revision unit test, engine changed-ids test, renderer changed-chip test.
  - Reason: On revision mismatch `resolveSelections()` still slices with the old offsets, pushes the result as resolved, and does not set `SOURCE_CHANGED` unless some ids were rejected. Design requires a refreshed reference and user confirmation, not silent reuse of stale intervals.
  - Evidence: `src/modules/AIChatArchiveModule.ts` revision-mismatch branch around `:487–511`.
  - Work: Return `SOURCE_CHANGED` with a refreshed source id; do not accept the turn until the user confirms. Keep draft selections.
  - Done when: An edited/replaced source cannot be quoted under the old offsets without an explicit new selection.
  - Requirements: FR-10–11; AC-18; design §§4.2, 13.3.

- [x] **Replace dynamic `import()` in the compaction/history path.** FIXED: all three sites are static imports now (`ConversationToolHistoryService`→`AIChatArchiveModule`, coordinator→`AIChatArchiveTurnModel`, retrieval→`encodeCursor`; the snapshot rewrite also removed the codec dynamic import). Verified: no `await import(` remains in those files (only pre-existing `import("electron")` in assembler env-context).
  - Reason: Project rule forbids dynamic imports (packaging / tree-shaking). Three production sites were added in this feature.
  - Evidence:
    - `src/service/ConversationToolHistoryService.ts:506`
    - `src/service/AIChatCompactionCoordinator.ts:630`
    - `src/service/AIChatHistoryRetrievalService.ts:701`
  - Work: Convert to static top-level imports. If there is a cycle, break it with a shared types/util module, not a lazy import.
  - Done when: `rg "await import\\(" src/service src/modules` has no compaction/history hits.
  - Requirements: G7; electron static-import rule.

- [x] **Stop silently trimming user-selected passages.** FIXED: `buildSelectedHistoryContextBlock` throws `CONTEXT_REQUIRED_CONTENT_TOO_LARGE` over budget instead of trimming/dropping. The throw lands before user-row persist, so the turn fails actionably with drafts kept (no `start`, no chip clearing). Utility-code trim tests rewritten to expect the throw.
  - Reason: `buildSelectedHistoryContextBlock()` drops excess text after the first passage once `maxTextChars` (32,000) is exhausted. PRD: if selected content does not fit, ask the user to narrow it; do not omit it.
  - Evidence: `src/service/SelectedHistoryContextBlock.ts:33–61`.
  - Work: Fail with `CONTEXT_REQUIRED_CONTENT_TOO_LARGE` (or the selection error already used by retrieval) before persist/send. Keep drafts.
  - Done when: An over-budget selection is rejected in the UI; the model never receives a silently shortened subset.
  - Requirements: FR-10; AC-16, AC-18; design §13.3.

- [x] **Align unknown-model context fallback with the budget service.** FIXED: `DEFAULT_CONTEXT_WINDOW_TOKENS` reuses `UNKNOWN_MODEL_FALLBACK_LIMITS.contextLimit` (8,192); comments updated. Tests: 128k-fallback test rewritten to assert the 8,192 fallback trips the gate (7,000 tokens) and skips below it.
  - Reason: Compact-agent auto-threshold still uses `DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000`. Design §8.1 requires a labeled 8,192-token unknown-model fallback. A 128k denominator delays auto-compact on small/unknown models.
  - Evidence: `src/service/AIChatCompactAgentService.ts:35` and `:157`.
  - Work: Reuse `AIChatRequestBudgetService` / catalog `limitSource`. Never assume 128k.
  - Done when: Unknown-model auto-compact threshold matches the dispatch budget profile.
  - Requirements: FR-08; AC-16, AC-23; design §8.1.

- [x] **Fix stale “legacy all-history path still exists” comments and flag-off behavior.** FIXED: agent dep + IPC factory comments now state fail-closed explicitly (coordinator omitted ⇒ `runFullCompact` rejects; §18 rollback, never unbounded). Compact IPC surfaces the actionable `Compaction unavailable…` message instead of a generic error. Ship posture: fail-closed by design; enabling `ai_chat_new_compaction_flag` is the documented rollout step. Test: flag-off denial asserts the actionable message.
  - Reason: `runFullCompact()` throws when no coordinator is wired. Comments on the agent deps and IPC factory still say flag-off keeps the unchanged legacy path. Flags default **off**, so production auto/manual compact currently fails closed and long chats lose compaction until operators enable `ai_chat_new_compaction_flag`.
  - Evidence: `src/service/AIChatCompactAgentService.ts:57–59`; `src/main-process/communication/ai-chat-v2-ipc.ts:258–260` and `:316–317`; `src/config/featureFlags.ts` default-off fail-closed.
  - Work: Update comments to match code. Decide the ship default: enable `newCompaction` for the release build, or document that compaction is inoperable until the flag is on. Do not restore `runFullCompact` all-history input.
  - Done when: Comments match behavior; flag-off is an explicit, tested limitation, not a surprise regression vs previous unbounded compact.
  - Requirements: FR-07; design §§18, 21.

---

## P1 — Incomplete requirements (all implemented this round)

- [x] **Assemble recent context from token-budgeted complete turns.** DONE: new `loadRetainedRows`/`loadTurnBackedRows` — live tail always + newest complete turns newest-first within `recentTurnTokenBudget` (default 6,000); oversized turns become labeled receipts with boundary message ids (pseudo system row in chronological position); bounded-row fallback keeps the text-window + full tool pairing. Tests: turn retention with tool replay, receipt test, AC-19 generation-preference test.
  - Reason: Assembler still takes the last 30 **text** messages (`DEFAULT_RECENT_MESSAGE_WINDOW = 30`), not “at least two completed turns plus the in-progress turn, chosen by token cost.” Tool exchanges can be dropped or over-retained for the wrong reason.
  - Evidence: `src/service/AIChatContextAssembler.ts:39`, `:245–258`.
  - Work: Allocate complete terminal turns by token cost (FR-05). Preserve current user content exactly once. Oversized turns get a receipt + source refs, not silent truncation.
  - Done when: “Continue” immediately after compaction still has the latest complete turns and current task (AC-03).
  - Requirements: FR-05; AC-03; design §12.

- [x] **Route session-memory and reactive overflow through the same section budgets.** DONE: session-memory direct path now runs `allocateSectionCapacity` preflight (routes to coordinator when the delta cannot fit), explicit `max_tokens` output cap + local output-cap validation, and ≤2 halving reductions + 1 repair within a 4-attempt ceiling with persisted failures (circuit breaker kept). Both coordinator adapters (agent + factory + IPC singleton) set explicit `max_tokens`. Reactive overflow: engine `failed` handler fires `requestCompactionForTurn(trigger: "reactive-overflow")` (or threshold-tripped auto-compact without a coordinator) on `CONTEXT_REQUIRED_CONTENT_TOO_LARGE`. Tests: 4 new AC-23 budget tests (route/reject/halve/no-coordinator).
  - Reason: Oversized deltas go to the coordinator, but deltas ≤64 rows / 64KB still call `completeChat` with `buildSessionMemoryUserPrompt`. That is a second unbounded-in-policy path.
  - Evidence: `src/service/AIChatCompactAgentService.ts` `runSessionMemoryUpdate` around `:388–475`.
  - Work: Same packer, checkpoints, output caps, and retry ceiling as manual/automatic compact. No unchecked secondary summarizer.
  - Done when: Captured session-memory requests on a large history stay within section budgets (AC-23).
  - Requirements: FR-07, FR-08; AC-23; design §§14–15.

- [x] **Wire compaction reader/coordinator for every engine consumer, not only flag-on IPC/factory.** DONE: engine default assembler now includes `compactionReader` + `archiveModule`; query-loop preflight is unconditional (constructor defaults the budget service — the dep only overrides it); IPC/factory assemble with reader + archive; singletons rebuild when the rollout flag flips. Recovery never dispatches outside the loop (verified: no direct provider calls in recovery/coordinator paths). Tests: wiring suite + all loop/engine suites green.
  - Reason: `AIChatQueryEngine` defaults to `new AIChatContextAssembler()` with no `compactionReader`. The engine singleton captures `isNewCompactionEnabled()` at construction. Query-loop preflight is still behind `if (this.deps.requestBudgetService)`.
  - Evidence: `src/service/AIChatQueryEngine.ts` constructor; `src/service/AIChatQueryLoop.ts` preflight guard; `src/main-process/communication/ai-chat-v2-ipc.ts` `getQueryEngine()`.
  - Work: Interactive, scheduled, AgentRuntime, and recovery paths all get budget + published-generation assembly. Re-read flags on compact/dispatch or rebuild the singleton when flags change.
  - Done when: No production `AIChatQueryLoop` dispatch skips preflight; scheduled engines cannot omit the guard.
  - Requirements: FR-04, FR-08; AC-11, AC-16; design §§8.5, 14.

- [x] **Prefer published generation over legacy compact when both exist.** DONE: composite boundary + overview win whenever a generation exists; legacy summary is appended as labeled advisory context (never trims); tool-pair filtering uses the composite boundary with rowId tiebreak (AC-09). Test: AC-19 preference test (legacy t=100 trim does not drop a t=75 row; advisory block present).
  - Reason: Assembler still lets a legacy `fullCompact` summary win and skips the generation boundary/overview. New incremental coverage can be ignored after a leftover legacy row.
  - Evidence: `src/service/AIChatContextAssembler.ts` “legacy full compact still wins” branch.
  - Work: Use published composite `(timestamp, rowId)` exclusion whenever an active generation exists. Keep legacy summaries advisory until migration publishes a replacement (AC-19).
  - Done when: A conversation with both records excludes history by the generation boundary, not a timestamp-only legacy summary.
  - Requirements: FR-07; AC-19; design §§12, 15.

- [x] **Complete history browse, passage expansion, and keyboard access.** DONE: drawer open-load watcher + per-open focus capture/restore; navigate no longer drafts selections; new `AiChatHistoryMessage` suite (7 tests: render/select/expand/navigate/no-mutation/aria-labels); six-language key-coverage suite (`AIChatHistoryI18n`, 4 tests). Component suite: 52 files / 332 tests green.
  - Reason: Drawer browse/search/select exist, but AC-24 keyboard-only / focus restoration is unproven. There is no dedicated `AiChatHistoryMessage` component test.
  - Evidence: `src/views/components/aiChatV2/AiChatHistoryDrawer.vue`; `AiChatHistoryMessage.vue`; missing `test/vitest/main/components/AiChatHistoryMessage.test.ts`.
  - Work: Paginated browse, working read-more, source navigation, focus return, six-language strings (already present for history/compaction keys). Add the component test.
  - Done when: Keyboard-only browse/select/remove works without changing model context unless the user selects a passage (AC-17, AC-24).
  - Requirements: FR-10; AC-17, AC-24; design §13.2.

- [x] **Compaction status must stay accurate across restart and long runs.** DONE: `getStatus` is DB-backed (paused run + staged checkpoints survive restart); paused runs are resumable by fresh claims instead of join-livelock; compact IPC drives the UI via running→final progress events. Tests: restart-after-pause test (fresh coordinator sees paused + resumes), pause-resume test, compact-IPC paused test.
  - Reason: Status chip/menu gained retry/cancel/view-history, but the compact IPC still waits and can stamp `failed` on pause. Joined/paused/cancelled must survive restart via persisted run state.
  - Evidence: `src/views/components/aiChatV2/AiChatCompactionStatus.vue`; compact IPC handler.
  - Work: Drive UI from `AI_CHAT_V2_COMPACTION_STATUS` / progress events, not from a single compact RPC result. Restore state after app restart (AC-07).
  - Requirements: FR-09–11; design §13.

- [x] **Preserve per-conversation drafts and stable submission identity.** DONE (verified + extended): `selectedContextDrafts` + stable `pendingSubmissionId` already in place; added `historySelectionChangedIds` end-to-end (engine → IPC → chip `refreshed` flag). Tests: existing retry/draft tests plus new changed-chip renderer test and engine changed-ids test.
  - Reason: Drafts map exists, but design §13.3 retry of an already-accepted turn (same submission id, no second selected-context message) still needs proof. Confirm conversation switch restores drafts and failed send keeps chips.
  - Evidence: `src/views/components/aiChatV2/AiChatV2.vue` `selectedContextDrafts`; engine `resolveSelectedHistory`.
  - Done when: Switch-away/back keeps drafts; transport retry does not duplicate the user message or selected block.
  - Requirements: FR-10; AC-18; design §13.3.

---

## P2 — Acceptance and release qualification (PRD completion gate)

Design §21: implementation is complete only when AC-01..AC-24 pass, original details remain retrievable after repeated compaction/restart, every model path is budget-checked, and normal compaction processes only new eligible history. No full-history fallback may remain reachable.

- [x] **AC-01** — Storage half DONE: 50/50 versioned six-language markers recoverable byte-for-byte via search→read (`AIChatHistoricalRecall`, incl. emoji + long-message edge cases). Three-compact + restart + live-model scoring remain manual.
- [ ] **AC-02** — Later explicit correction is preferred; both passages are citable. (Correction-pair markers exist in the dataset; model-side preference needs live-model scoring.)
- [x] **AC-03** — Turn-backed retention + receipt tests; “continue” keeps complete turns + live tail.
- [x] **AC-04** — Scaled-fixture DONE: 10k-message walk pages bounded end-to-end; batch-limit pause/resume tested. Full 100k reference measurement remains manual (below).
- [x] **AC-05** — Covered by coordinator incremental no-resend test.
- [x] **AC-06** — Oversized rows: byte-allowance truncation + continuation + no-stall test (perf fixture); fragment coverage in packer tests.
- [x] **AC-07** — Restart-after-pause test (fresh coordinator resumes from checkpoints; status persists).
- [x] **AC-08** — Durable-join race test (no duplicate coverage).
- [x] **AC-09** — Equal-timestamp stability DONE at read level (10k fixture seeds shared timestamps; keyset pages fully; composite boundary + rowId-tiebreak pair filter). Snapshot-excludes-later-input needs E2E timing proof.
- [x] **AC-10** — Tool receipt/pairing/lookup unit tests green; indexed `getToolPair` path (no full load).
- [x] **AC-11** — Intra-page resume cursors + bounded single/range reads tested; dispatch preflight unconditional + wiring-tested.
- [x] **AC-12** — Forged cross-conversation id test green (E2E variant still open).
- [x] **AC-13** — NEW: tombstone-mid-flight test (late AI result rejects; nothing published).
- [x] **AC-14** — Malformed-output repair + fail-closed tests green.
- [x] **AC-15** — NEW: single context-rejection → halved retry → success test (≤2 reductions, no fallback).
- [x] **AC-16** — Oversized-mandatory-input wiring test; selection over-budget rejection (no silent trim).
- [ ] **AC-17** — Component-level proof green (browse/select/navigate separation + drawer tests). Full E2E run still open.
- [x] **AC-18** — Engine provider-input assertions (exact text once + provenance) + double round-trip span test + changed-ids test.
- [x] **AC-19** — Generation-preference + advisory-legacy assembler test.
- [ ] **AC-20** — E2E exists; Electron run still open. (Browse IPC paths are AI-ungated by construction.)
- [x] **AC-21** — Merge-failure keeps prior overview (unit behavior); staged sections stay retrievable. (Additive test via coordinator suite.)
- [ ] **AC-22** — Block framing labels evidence/not-instructions (implemented); adversarial live-model proof open.
- [x] **AC-23** — 4 session-memory budget tests + reactive-overflow trigger + coordinator path.
- [x] **AC-24** — Six-language key suite green; keyboard/aria component tests green (drawer/message/status/selection).

Also required by PRD §§10–13 / design §17.4:

- [x] **Scaled (10k) performance fixture** (`AIChatArchivePerf`): bounded forward walk of 10,000 rows, bounded first-page search, single-read, oversized-row truncation + advance-past — all green. Full **100,000-message** reference measurement (machine profile, SQLite build, p95 search <1s / read <500ms) remains MANUAL on release hardware.
- [x] **Versioned 50-case six-language dataset** (`AIChatHistoricalRecall.dataset` v1) with deterministic 50/50 storage proof. Live-model scoring (≥95% source-backed, zero fabricated quotes, recorded model/window) remains MANUAL with `AIFETCHLY_RECALL_LIVE=1`.
- [x] **Run** applicable suites after the P0/P1 fixes: `tsc` clean, `vue-tsc` clean, eslint clean on touched files, component suite 52/332 green, all targeted main suites green (see verification log). **`yarn test:e2e` (Electron) NOT run here** — still open.

Current E2E file (`test/e2e/specs/ai-chat-recoverable-history.test.ts`) only attempts AC-01 (one compact), AC-17, AC-18 (metadata not provider passage), AC-20, and **post-completion** deletion. That is not the PRD suite.

---

## Already in place (do not re-implement)

Keep these; fix the defects above instead of rewriting:

- Seven archive/compaction entities registered in `SqliteDb.ts`
- Bounded keyset/substring Model reads and archive Module
- `conversation_history_search` / `conversation_history_read` tools and IPC channels (including browse)
- Request-budget service wired into interactive `createQueryLoop()`, factory, and `AgentRuntime`
- Coordinator resume/overview merge/join/yield/retry unit tests
- Removal of the all-history `runFullCompact` model call (must stay gone)
- History drawer, selected-context chips, compaction status UI, six-language `aiChatHistory` / `aiChatCompaction` keys
- Feature-flag rollout scaffolding (`AI_CHAT_RECOVERABLE_FLAGS`)

FTS is optional (LIKE fallback is allowed). A dedicated `AIChatArchiveIndexModule` is not required if `AIChatArchiveIndexer` stays on Model/Module APIs with no worker DB access.

---

## Suggested fix order (all items 1–6 completed 2026-09-17; see checkboxes above)

1. ~~P0 status mapping (paused ≠ failed) and compact IPC progress.~~ DONE
2. ~~P0 `getRecentTurns` keyset + snapshot (AC-03).~~ DONE
3. ~~P0 source-offset / SOURCE_CHANGED / selection trim.~~ DONE
4. ~~P0 static imports + 128k fallback + flag-off comments/defaults.~~ DONE
5. ~~P1 assembler complete-turn allocation and session-memory unification.~~ DONE
6. ~~P2 AC tests and qualification measurements.~~ Deterministic parts DONE; live/E2E/reference-machine parts remain (AC-02/17/20/22, full 100k p95, live recall scoring, `yarn test:e2e`).

Design §19 gate status: retrieval offsets, publication consistency, and dispatch preflight are fixed and tested; source exclusion by published composite boundary is exercised in the assembler with generation-preference tests green. Remaining release gates are the manual qualifications listed under P2 (live provider, reference hardware, Electron).
