# Recoverable History and Incremental Compaction — Remaining TODO

Date: 2026-09-17

Worktree: `/Users/cengjianze/project/aiFetchly/.claude/worktrees/ai-chat-compaction`

Branch: `worktree-ai-chat-compaction`

HEAD: `7cf8956f` (`feat: bounded incremental compaction with recoverable history retrieval`)

Status: **Not complete.** Archive retrieval, bounded coordinator, budget preflight, and history UI exist, but PRD/design acceptance is not met. Several committed defects must be fixed before this can be treated as done.

References:

- [PRD](ai-chat-recoverable-history-incremental-compaction-prd.md)
- [Technical design](ai-chat-recoverable-history-incremental-compaction-technical-design.md)

How to use this list: P0 items are correctness/regression defects in committed code. P1 items are missing requirement slices. P2 items are release qualification that the PRD treats as mandatory for completion (design §21). Passing existing unit tests does not close any checkbox below.

Verification baseline for this snapshot: 59 targeted unit tests passed (`AIChatCompactionCoordinator`, `AIChatHistoryRetrievalService`, `AIChatEngineBudgetWiring`, `AIChatCompactAgentBounded`, `AIChatSectionPacker`, `AIChatRequestBudgetService`). Electron E2E, lint, and `yarn typecheck` were not run in the 2026-09-17 review.

---

## P0 — Defects in committed code (must fix)

- [ ] **Do not report a paused compaction run as failed.**
  - Reason: After the batch limit the coordinator correctly returns `paused`, but `runFullCompact()` maps any non-`completed` state to `failed`. Manual compact IPC then broadcasts `failed`. A long conversation looks like a failure after the first three sections.
  - Evidence: `src/service/AIChatCompactAgentService.ts:575` and `:583`; `src/main-process/communication/ai-chat-v2-ipc.ts` `handleCompactConversation` (awaits the compact call, then emits `completed` vs `failed` from `summary.status`).
  - Work: Preserve `paused` / `joined` / `cancelled` through the legacy compact view and progress event. Use the start/status/progress flow from design §13.1 so the renderer does not wait on one indefinite IPC call.
  - Done when: A history that needs more than three sections shows paused/in-progress, not failed; retry/resume continues from the checkpoint.
  - Requirements: FR-07, FR-09, FR-10; AC-04, AC-07; design §§11.2, 13.1.

- [ ] **Materialize recent turns from the turn start, not conversation start.**
  - Reason: `getRecentTurns()` calls `readPageForward()` with only an end snapshot. With no start cursor that query reads the first 64 rows of the conversation. In a long chat the retained suffix is never in that page, excerpts are empty, and `computeSnapshotEnd()` falls back to high-water — compacting through the latest message, including “continue” context.
  - Evidence: `src/modules/AIChatArchiveModule.ts:344–394`; `src/model/AIChatMessageArchive.model.ts` `readPageForward`; `src/service/AIChatCompactionCoordinator.ts` `computeSnapshotEnd`.
  - Work: Keyset from each retained turn’s `(firstTimestampMs, firstRowId)` through `(lastTimestampMs, lastRowId)`. Do not approximate the snapshot from decoded excerpt source IDs. Keep the live turn excluded.
  - Done when: A conversation with well over 64 earlier rows still retains the latest two complete turns after compaction (AC-03).
  - Requirements: FR-05, FR-09; AC-03, AC-09; design §§4.3, 11–12.

- [ ] **Preserve exact source offsets on selection resolution.**
  - Reason: Search uses `toExcerptWithSpan()` with the real `[start, end)` interval. `resolveSelections()` slices correctly, then `toExcerpt()` re-encodes the slice as `startCodePoint: 0` / `endCodePoint = slice length`. First-send `excerpt.text` is right; a later resolve of the **returned** source id reads the message prefix. Tests assert text only, not the re-encoded id.
  - Evidence: `src/modules/AIChatArchiveModule.ts:499`, `:519`, `:536` (`toExcerpt`) vs `:569` (`toExcerptWithSpan`); `test/vitest/main/AIChatHistoryRetrievalService.test.ts` “preserves nonzero offsets…”.
  - Work: Use `toExcerptWithSpan` for every resolved slice. Assert returned `sourceId` still has the original nonzero span after search → read → select, and after a second `resolveSelections` of that returned id.
  - Done when: A mid-message hit round-trips twice without becoming the prefix.
  - Requirements: FR-01–03, FR-10; AC-01, AC-18; design §§4, 7, 13.3.

- [ ] **Reject changed-source selections instead of reapplying stale offsets.**
  - Reason: On revision mismatch `resolveSelections()` still slices with the old offsets, pushes the result as resolved, and does not set `SOURCE_CHANGED` unless some ids were rejected. Design requires a refreshed reference and user confirmation, not silent reuse of stale intervals.
  - Evidence: `src/modules/AIChatArchiveModule.ts` revision-mismatch branch around `:487–511`.
  - Work: Return `SOURCE_CHANGED` with a refreshed source id; do not accept the turn until the user confirms. Keep draft selections.
  - Done when: An edited/replaced source cannot be quoted under the old offsets without an explicit new selection.
  - Requirements: FR-10–11; AC-18; design §§4.2, 13.3.

- [ ] **Replace dynamic `import()` in the compaction/history path.**
  - Reason: Project rule forbids dynamic imports (packaging / tree-shaking). Three production sites were added in this feature.
  - Evidence:
    - `src/service/ConversationToolHistoryService.ts:506`
    - `src/service/AIChatCompactionCoordinator.ts:630`
    - `src/service/AIChatHistoryRetrievalService.ts:701`
  - Work: Convert to static top-level imports. If there is a cycle, break it with a shared types/util module, not a lazy import.
  - Done when: `rg "await import\\(" src/service src/modules` has no compaction/history hits.
  - Requirements: G7; electron static-import rule.

- [ ] **Stop silently trimming user-selected passages.**
  - Reason: `buildSelectedHistoryContextBlock()` drops excess text after the first passage once `maxTextChars` (32,000) is exhausted. PRD: if selected content does not fit, ask the user to narrow it; do not omit it.
  - Evidence: `src/service/SelectedHistoryContextBlock.ts:33–61`.
  - Work: Fail with `CONTEXT_REQUIRED_CONTENT_TOO_LARGE` (or the selection error already used by retrieval) before persist/send. Keep drafts.
  - Done when: An over-budget selection is rejected in the UI; the model never receives a silently shortened subset.
  - Requirements: FR-10; AC-16, AC-18; design §13.3.

- [ ] **Align unknown-model context fallback with the budget service.**
  - Reason: Compact-agent auto-threshold still uses `DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000`. Design §8.1 requires a labeled 8,192-token unknown-model fallback. A 128k denominator delays auto-compact on small/unknown models.
  - Evidence: `src/service/AIChatCompactAgentService.ts:35` and `:157`.
  - Work: Reuse `AIChatRequestBudgetService` / catalog `limitSource`. Never assume 128k.
  - Done when: Unknown-model auto-compact threshold matches the dispatch budget profile.
  - Requirements: FR-08; AC-16, AC-23; design §8.1.

- [ ] **Fix stale “legacy all-history path still exists” comments and flag-off behavior.**
  - Reason: `runFullCompact()` throws when no coordinator is wired. Comments on the agent deps and IPC factory still say flag-off keeps the unchanged legacy path. Flags default **off**, so production auto/manual compact currently fails closed and long chats lose compaction until operators enable `ai_chat_new_compaction_flag`.
  - Evidence: `src/service/AIChatCompactAgentService.ts:57–59`; `src/main-process/communication/ai-chat-v2-ipc.ts:258–260` and `:316–317`; `src/config/featureFlags.ts` default-off fail-closed.
  - Work: Update comments to match code. Decide the ship default: enable `newCompaction` for the release build, or document that compaction is inoperable until the flag is on. Do not restore `runFullCompact` all-history input.
  - Done when: Comments match behavior; flag-off is an explicit, tested limitation, not a surprise regression vs previous unbounded compact.
  - Requirements: FR-07; design §§18, 21.

---

## P1 — Incomplete requirements

- [ ] **Assemble recent context from token-budgeted complete turns.**
  - Reason: Assembler still takes the last 30 **text** messages (`DEFAULT_RECENT_MESSAGE_WINDOW = 30`), not “at least two completed turns plus the in-progress turn, chosen by token cost.” Tool exchanges can be dropped or over-retained for the wrong reason.
  - Evidence: `src/service/AIChatContextAssembler.ts:39`, `:245–258`.
  - Work: Allocate complete terminal turns by token cost (FR-05). Preserve current user content exactly once. Oversized turns get a receipt + source refs, not silent truncation.
  - Done when: “Continue” immediately after compaction still has the latest complete turns and current task (AC-03).
  - Requirements: FR-05; AC-03; design §12.

- [ ] **Route session-memory and reactive overflow through the same section budgets.**
  - Reason: Oversized deltas go to the coordinator, but deltas ≤64 rows / 64KB still call `completeChat` with `buildSessionMemoryUserPrompt`. That is a second unbounded-in-policy path.
  - Evidence: `src/service/AIChatCompactAgentService.ts` `runSessionMemoryUpdate` around `:388–475`.
  - Work: Same packer, checkpoints, output caps, and retry ceiling as manual/automatic compact. No unchecked secondary summarizer.
  - Done when: Captured session-memory requests on a large history stay within section budgets (AC-23).
  - Requirements: FR-07, FR-08; AC-23; design §§14–15.

- [ ] **Wire compaction reader/coordinator for every engine consumer, not only flag-on IPC/factory.**
  - Reason: `AIChatQueryEngine` defaults to `new AIChatContextAssembler()` with no `compactionReader`. The engine singleton captures `isNewCompactionEnabled()` at construction. Query-loop preflight is still behind `if (this.deps.requestBudgetService)`.
  - Evidence: `src/service/AIChatQueryEngine.ts` constructor; `src/service/AIChatQueryLoop.ts` preflight guard; `src/main-process/communication/ai-chat-v2-ipc.ts` `getQueryEngine()`.
  - Work: Interactive, scheduled, AgentRuntime, and recovery paths all get budget + published-generation assembly. Re-read flags on compact/dispatch or rebuild the singleton when flags change.
  - Done when: No production `AIChatQueryLoop` dispatch skips preflight; scheduled engines cannot omit the guard.
  - Requirements: FR-04, FR-08; AC-11, AC-16; design §§8.5, 14.

- [ ] **Prefer published generation over legacy compact when both exist.**
  - Reason: Assembler still lets a legacy `fullCompact` summary win and skips the generation boundary/overview. New incremental coverage can be ignored after a leftover legacy row.
  - Evidence: `src/service/AIChatContextAssembler.ts` “legacy full compact still wins” branch.
  - Work: Use published composite `(timestamp, rowId)` exclusion whenever an active generation exists. Keep legacy summaries advisory until migration publishes a replacement (AC-19).
  - Done when: A conversation with both records excludes history by the generation boundary, not a timestamp-only legacy summary.
  - Requirements: FR-07; AC-19; design §§12, 15.

- [ ] **Complete history browse, passage expansion, and keyboard access.**
  - Reason: Drawer browse/search/select exist, but AC-24 keyboard-only / focus restoration is unproven. There is no dedicated `AiChatHistoryMessage` component test.
  - Evidence: `src/views/components/aiChatV2/AiChatHistoryDrawer.vue`; `AiChatHistoryMessage.vue`; missing `test/vitest/main/components/AiChatHistoryMessage.test.ts`.
  - Work: Paginated browse, working read-more, source navigation, focus return, six-language strings (already present for history/compaction keys). Add the component test.
  - Done when: Keyboard-only browse/select/remove works without changing model context unless the user selects a passage (AC-17, AC-24).
  - Requirements: FR-10; AC-17, AC-24; design §13.2.

- [ ] **Compaction status must stay accurate across restart and long runs.**
  - Reason: Status chip/menu gained retry/cancel/view-history, but the compact IPC still waits and can stamp `failed` on pause. Joined/paused/cancelled must survive restart via persisted run state.
  - Evidence: `src/views/components/aiChatV2/AiChatCompactionStatus.vue`; compact IPC handler.
  - Work: Drive UI from `AI_CHAT_V2_COMPACTION_STATUS` / progress events, not from a single compact RPC result. Restore state after app restart (AC-07).
  - Requirements: FR-09–11; design §13.

- [ ] **Preserve per-conversation drafts and stable submission identity.**
  - Reason: Drafts map exists, but design §13.3 retry of an already-accepted turn (same submission id, no second selected-context message) still needs proof. Confirm conversation switch restores drafts and failed send keeps chips.
  - Evidence: `src/views/components/aiChatV2/AiChatV2.vue` `selectedContextDrafts`; engine `resolveSelectedHistory`.
  - Done when: Switch-away/back keeps drafts; transport retry does not duplicate the user message or selected block.
  - Requirements: FR-10; AC-18; design §13.3.

---

## P2 — Acceptance and release qualification (PRD completion gate)

Design §21: implementation is complete only when AC-01..AC-24 pass, original details remain retrievable after repeated compaction/restart, every model path is budget-checked, and normal compaction processes only new eligible history. No full-history fallback may remain reachable.

- [ ] **AC-01** — Exact early wording survives **three** compacts and a restart; search/read return it with a valid source link.
- [ ] **AC-02** — Later explicit correction is preferred; both passages are citable.
- [ ] **AC-03** — “Continue” after compaction keeps recent complete turns and current task.
- [ ] **AC-04** — History larger than ten model windows: every summarization request fits budget; run finishes or pauses resumably. No 100k fixture/measurement yet.
- [ ] **AC-05** — One new eligible turn after a large compact: only new source is sent.
- [ ] **AC-06** — Oversized source message: fragments cover the full message before coverage advances (production Model/Module, not only packer unit tests).
- [ ] **AC-07** — Kill app after section save, before overview publication: restart reuses the section; active generation stays consistent.
- [ ] **AC-08** — Manual and automatic triggers race: no duplicate active coverage.
- [ ] **AC-09** — Messages during compaction, including equal timestamps: snapshot excludes later input; no skip by timestamp collision.
- [ ] **AC-10** — Old tool output: receipt identifies the tool; lookup returns persisted result without execution.
- [ ] **AC-11** — Oversized search/read: truncation + continuation; downstream request stays bounded.
- [ ] **AC-12** — Foreign conversation id/cursor: reject with no leak (keep existing unit tests; add E2E).
- [ ] **AC-13** — Clear conversation **while** a summary request is in flight (not after completion): late result cannot restore derived state.
- [ ] **AC-14** — Malformed summary / nonexistent source ids: not published; coverage does not advance.
- [ ] **AC-15** — Provider context rejection: at most two reductions; never all-history fallback.
- [ ] **AC-16** — Current input alone cannot fit: actionable failure; no silent truncation.
- [ ] **AC-17** — Browse older messages without selecting: UI shows history; model context does not grow. E2E exists; run it.
- [ ] **AC-18** — Select a passage: exact stored text once, in budget, with provenance on the **provider input** (not only persisted metadata).
- [ ] **AC-19** — Legacy conversation with old compact summary: retrieval works; bounded migration keeps old valid state until replacement.
- [ ] **AC-20** — AI disabled: local history readable; no unauthorized AI call. E2E exists; run it.
- [ ] **AC-21** — Overview omits an old detail: independent section/original source still retrievable.
- [ ] **AC-22** — Retrieved old text telling the model to ignore current rules stays historical evidence.
- [ ] **AC-23** — Session-memory / reactive overflow use the same section budgets.
- [ ] **AC-24** — All six languages + keyboard-only controls, focus, accessible names.

Also required by PRD §§10–13 / design §17.4, still missing:

- [ ] **100,000-message performance fixture** with recorded machine, SQLite build, p95 search (<1s) and read (<500ms).
- [ ] **Versioned 50-case six-language historical-recall dataset**, ≥95% source-backed answers, zero fabricated exact quotes, under the release model.
- [ ] **Run** applicable `yarn test:e2e`, `yarn test:components`, lint, `yarn typecheck`, and `yarn vue-check` after the P0/P1 fixes. Document results on this file.

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

## Suggested fix order

1. P0 status mapping (paused ≠ failed) and compact IPC progress.
2. P0 `getRecentTurns` keyset + snapshot (AC-03).
3. P0 source-offset / SOURCE_CHANGED / selection trim.
4. P0 static imports + 128k fallback + flag-off comments/defaults.
5. P1 assembler complete-turn allocation and session-memory unification.
6. P2 AC tests and qualification measurements.

Do not enable source exclusion in production until retrieval offsets, publication consistency, and dispatch preflight are fixed (design §19).
