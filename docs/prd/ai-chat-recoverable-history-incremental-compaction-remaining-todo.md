# Recoverable History and Incremental Compaction — Remaining Work (post P0/P1)

Date: 2026-09-17

Worktree: `/Users/cengjianze/project/aiFetchly/.claude/worktrees/ai-chat-compaction`

Branch: `worktree-ai-chat-compaction`

HEAD: `b3a2993c` (`feat: close P0/P1 compaction defects and qualify P2 acceptance deterministically`)

Purpose: this is a **second** TODO. It does **not** replace
[`ai-chat-recoverable-history-incremental-compaction-todo.md`](ai-chat-recoverable-history-incremental-compaction-todo.md).
That file recorded the P0/P1 round and marked those items complete. This file lists
what is **still incomplete** and the **errors still in the git worktree** after an independent re-audit of HEAD
`b3a2993c` against the PRD and technical design. Errors are listed first.

References:

- [PRD](ai-chat-recoverable-history-incremental-compaction-prd.md)
- [Technical design](ai-chat-recoverable-history-incremental-compaction-technical-design.md)
- Previous TODO (P0/P1 claimed done): [ai-chat-recoverable-history-incremental-compaction-todo.md](ai-chat-recoverable-history-incremental-compaction-todo.md)

How to use this list: a checkbox is closed only when the linked behavior and a
passing test exist. Do not treat the previous TODO's `[x]` marks as proof.

Verification for this audit (2026-09-17, worktree HEAD `b3a2993c`):

- Combined targeted vitest run: **1 failed / 8 files, 1 failed / 157 tests**.
  Failure: `AIChatHistoricalRecall` `es-02` (`marker not found: RECALL-ES-NUM-3.14159`).
- Same recall file run **alone**: **50/50 passed** (~2 ms per case). The miss is
  load-sensitive, not a missing marker in the dataset.
- Electron E2E (`yarn test:e2e`), 100k p95, and live-model recall were **not** run.

---


## Errors found in the worktree (HEAD `b3a2993c`)

These are **bugs / incorrect behavior**, not missing ACs. They were observed in
the post-P0/P1 re-audit. Close each item only with a failing-then-passing test
on the listed behavior. Do not mark them done because a related P0/P1 checkbox
in the previous TODO is `[x]`.

- [ ] **Error: AC-01 storage recall is flaky under load (`es-02`).**
  - What failed: combined vitest run `Test Files 1 failed | 8 passed`,
    `Tests 1 failed | 157 passed`. Case
    `AIChatHistoricalRecall > es-02: marker not found: RECALL-ES-NUM-3.14159`.
    Isolated re-run of the same file: **50/50 passed**.
  - Reason: `scanLiteral` stops after **100 ms** (`searchMaxMsPerPage`) or 500
    fragments and returns a continuation cursor. The recall test searches once
    with `limit: 5` and asserts `hit.records.length > 0` on that **first page**.
    It never follows `nextCursor`. `SqliteDb.getInstance(tmpDir)` is a process
    singleton; neighbor archive tests steal wall-clock from the 100 ms budget,
    so a real later hit looks like “marker not found”.
  - Evidence: `test/vitest/main/AIChatHistoricalRecall.test.ts` (~line 109);
    `src/service/AIChatRecoverableDefaults.ts` `searchMaxMsPerPage: 100`;
    `src/model/AIChatArchiveSearchFragment.model.ts` `scanLiteral`;
    `src/service/AIChatHistoryRetrievalService.ts` `search()` (one `searchPage`).
  - Fix: follow `nextCursor` until `scanComplete` or a hit; isolate/reset
    SqliteDb per suite; do not map empty first page + cursor to no-match.
  - Done when: combined recall + other archive suites stay green on repeated
    runs; a marker past the first 100 ms page is found by search→read.

- [ ] **Error: complete turns are silently truncated at 64 rows.**
  - What is wrong: `readTurnRows` / `readRowsAfter` call `readPageForward`
    with `maxRows: 64` and **drop `nextCursor`**. Tool-heavy turns with more
    than 64 rows are treated as complete. Token cost is computed on the
    truncated page, so an oversized turn can look like it fits.
  - Reason: FR-05 requires the whole retained turn, or a visible receipt that
    raw content is not fully loaded. Silent tail drop is a correctness error,
    not an open AC.
  - Evidence: `src/modules/AIChatArchiveModule.ts` `readTurnRows` /
    `readRowsAfter`; `src/service/AIChatContextAssembler.ts` `loadTurnBackedRows`.
  - Fix: page until the turn end bound / decoded-text allowance, or emit the
    receipt path. Never cost a truncated page as a complete turn.
  - Done when: a >64-row fixture turn is fully retained or replaced by a
    receipt; a test fails if the assembler drops the tail.

- [ ] **Error: `readRowsAfter` wastes a page slot on the inclusive anchor.**
  - What is wrong: `readPageForward` start bound is inclusive. `readRowsAfter`
    then filters out the last completed row. Live tail is capped at **63**
    rows in that page; the first slot is always thrown away.
  - Reason: live/in-progress tail after the last complete turn must be bounded
    by the documented row cap, not cap-minus-one.
  - Evidence: `src/modules/AIChatArchiveModule.ts` `readRowsAfter` (“Start
    bound is inclusive; drop the anchor row…”).
  - Fix: keyset strictly after `(afterTimestampMs, afterRowId)`, or request
    65 then filter, or follow `nextCursor` after the filter.
  - Done when: a 64-row live tail is fully returned (or visibly continued).

- [ ] **Error: SOURCE_CHANGED confirmation preview reuses stale offsets as exact.**
  - What is wrong: stale source ids are correctly **not** quoted into the
    model, but `refreshed[].excerpt` is still sliced with the **old**
    `[start, end)` on the **new** text, with `exact: true`. If the message
    changed, the UI chip can preview the wrong span and claim it is exact.
  - Reason: design §4.2 / AC-18 require a refreshed reference for explicit
    re-selection, not reuse of stale intervals.
  - Evidence: `src/modules/AIChatArchiveModule.ts` `resolveSelections`
    (`sliceByCodePoints` with payload offsets, then `toExcerptWithSpan(..., true)`
    **before** the revision check).
  - Fix: on revision mismatch, return whole-message/field excerpt with
    `exact: false`, or identity + “source changed — reselect”. Never set
    `exact: true` for a stale interval.
  - Done when: tests assert `exact !== true` (or span reset) on `refreshed[]`
    after an edit.

- [ ] **Error: oversized-turn receipts are injected as privileged system messages.**
  - What is wrong: `oversizedTurnReceiptRow` builds a fake
    `AIChatMessageEntity` with `role: "system"` via `as AIChatMessageEntity`.
    That can be replayed as a system instruction instead of labeled historical
    evidence.
  - Reason: AC-22 — historical content is evidence, not instructions. A
    receipt that looks like `system` can outrank the live user turn.
  - Evidence: `src/service/AIChatContextAssembler.ts` `oversizedTurnReceiptRow`.
  - Fix: emit a labeled history/receipt block (same framing as selected
    context), not `role: "system"`. Keep message ids for
    `conversation_history_read`.
  - Done when: assembler tests show the receipt is not a system-role
    instruction.

- [ ] **Error: SqliteDb process singleton races the 100 ms search budget.**
  - What is wrong: recall and other archive tests share
    `SqliteDb.getInstance(...)`. Combined runs interfere; that is why `es-02`
    failed only in the multi-file run. This is a test-harness error that
    produces a false “no match” and hides real misses.
  - Reason: design §5.6 page budget is per scan; a stolen clock makes the
    first page empty even when the index contains the marker.
  - Evidence: `test/vitest/main/AIChatHistoricalRecall.test.ts` and
    `AIChatArchivePerf.test.ts` both call `SqliteDb.getInstance(tmpDir)`.
  - Fix: unique DB path / reset singleton per file; do not keep one
    connection across unrelated suites.
  - Done when: combined archive vitest is stable without raising the 100 ms
    budget to paper over contention.

- [ ] **Error: retrieval search consumes only one 100 ms fragment page per call.**
  - What is wrong: `AIChatHistoryRetrievalService.search()` calls
    `archive.searchPage` **once**. Design §7.1.5 allows several backend pages
    within the call’s time/output budget, otherwise a cursor. Tools/UI that
    do not loop `nextCursor` miss matches later in the archive (same root
    cause as the recall flake for assistant/tool callers).
  - Reason: FR-02 — retrieval may consume several backend pages; empty first
    page is not “not in history”.
  - Evidence: `src/service/AIChatHistoryRetrievalService.ts` `search()`
    (single `searchPage`, then intra-page resume or `page.nextCursor`).
  - Fix: consume additional backend pages while time/token budget remains,
    or document that every caller (tools, drawer, tests) must follow
    `nextCursor` and enforce that in tests.
  - Done when: a hit on page 2 of a 100 ms scan is returned in one tool call
    **or** every caller is proven to follow the cursor.

- [ ] **Error: manual compact IPC still blocks on the whole batch.**
  - What is wrong: `handleCompactConversation` emits `running` and no longer
    maps pause to `failed`, but it still `await`s `runFullCompact()` for up
    to three sections + model calls on one IPC invoke. The renderer still
    waits on a single RPC.
  - Reason: design §13.1 is start / status / progress, not one indefinite
    handler. Long conversations freeze the compact UI until the batch ends.
  - Evidence: `src/main-process/communication/ai-chat-v2-ipc.ts`
    `handleCompactConversation` (~1406).
  - Fix: start the coordinator, return `runId`, drive the badge from
    progress/status; resume is a separate call.
  - Done when: compact IPC returns while a run is `running`.

The P0 items below are the same defects written as implementation tasks (reason / evidence / work / done-when). Prefer closing the **Errors** checkboxes; the P0 list is the engineering breakdown of those errors.

## P0 — Defects still in committed code

These are correctness problems that remain after `b3a2993c`. They are not
covered by the previous TODO's closed checkboxes.

- [ ] **Search callers must not treat a timed-out first page as “no match”.**
  - Reason: `scanLiteral` stops after 500 fragments or **100 ms**
    (`AI_CHAT_RECOVERABLE_DEFAULTS.searchMaxMsPerPage`) and returns
    `hasMore` + a continuation cursor. `AIChatHistoryRetrievalService.search()`
    consumes **one** `archive.searchPage()` per call (design §7.1.5 allows
    several backend pages within the call budget, otherwise a cursor). The
    AC-01 storage suite (`AIChatHistoricalRecall`) asserts
    `hit.records.length > 0` on that first page and never follows
    `nextCursor`. Under a contended `SqliteDb` singleton the first 100 ms can
    return zero hits for a marker that exists later in the fragment walk.
    Combined-run failure of `es-02` is this behavior, not a flaky assertion
    with no production cause.
  - Evidence:
    - `src/service/AIChatRecoverableDefaults.ts` `searchMaxMsPerPage: 100`
    - `src/model/AIChatArchiveSearchFragment.model.ts` `scanLiteral`
    - `src/modules/AIChatArchiveModule.ts` `searchPage` (one scan, then cursor)
    - `src/service/AIChatHistoryRetrievalService.ts` `search()` — one
      `searchPage`, then intra-page resume or `page.nextCursor`
    - `test/vitest/main/AIChatHistoricalRecall.test.ts` (~line 109) — no cursor loop
    - `SqliteDb.getInstance(tmpDir)` shared across archive tests in-process
  - Work: (1) Follow `nextCursor` in the recall test until `scanComplete` or
    a hit. (2) Isolate archive DBs per suite (or reset the singleton) so
    100 ms is not stolen by neighbor tests. (3) Decide whether
    `search()` should consume additional backend pages inside one tool call
    when time/token budget remains (FR-02 / design §7.1.5). Empty first page
    + `nextCursor` must never be mapped to `HISTORY_NO_MATCH` (already true
    in retrieval; keep it that way for tools/UI).
  - Done when: combined vitest of recall + other archive suites is green on
    repeated runs; a marker past the first 100 ms page is found by search→read.
  - Requirements: FR-02, FR-04; AC-01; design §§5.6, 7.1.5, 17.4.

- [ ] **Materialize a complete turn even when it has more than 64 rows.**
  - Reason: `readTurnRows` / `readRowsAfter` call `readPageForward` with
    `maxRows: 64` and **ignore `nextCursor`**. A tool-heavy turn with more
    than 64 rows is treated as the whole turn. Token cost is computed on that
    truncated page, so an oversized turn can look like it fits. FR-05 requires
    the whole retained turn, or a visible receipt that the raw content is not
    fully loaded.
  - Evidence: `src/modules/AIChatArchiveModule.ts` `readTurnRows` / `readRowsAfter`
    (`maxRows: 64`, return `page.records` only);
    `src/service/AIChatContextAssembler.ts` `loadTurnBackedRows` (no follow-up page).
  - Work: Page until the turn end bound, the decoded-text allowance, or an
    explicit receipt. If the turn cannot be loaded fully, emit the receipt
    path and do not cost the truncated page as if it were complete.
  - Done when: a fixture turn with >64 rows (including tool pairs) is either
    fully retained or replaced by a receipt; tests fail if the assembler
    silently drops the tail.
  - Requirements: FR-05, FR-09; AC-03, AC-09, AC-10; design §§4.3, 12.

- [ ] **`readRowsAfter` must not spend the page on the inclusive anchor row.**
  - Reason: `readPageForward` start bound is inclusive. `readRowsAfter` then
    filters out the last completed row. The live tail is capped at 63 rows
    in that page, and the first slot is wasted on a row that is always dropped.
  - Evidence: `src/modules/AIChatArchiveModule.ts` `readRowsAfter` comment
    “Start bound is inclusive; drop the anchor row…”.
  - Work: Keyset strictly after `(afterTimestampMs, afterRowId)`, or request
    `maxRows: 65` and then filter, or follow `nextCursor` after the filter.
  - Done when: a 64-row live tail after the last complete turn is fully
    returned in one bounded read (or visibly continued).
  - Requirements: FR-05; AC-03; design §4.3.

- [ ] **Do not slice stale offsets into the SOURCE_CHANGED confirmation preview.**
  - Reason: On revision mismatch the stale id is correctly rejected and is
    not quoted into the model. The `refreshed[]` excerpt is still built with
    the **old** `[start, end)` on the **new** text, and `exact: true`. If the
    message changed, the UI confirmation chip can preview the wrong span
    while claiming it is exact. Design §4.2 / AC-18: refreshed reference for
    explicit re-selection, not reuse of stale intervals.
  - Evidence: `src/modules/AIChatArchiveModule.ts` `resolveSelections`
    (`sliceByCodePoints` with `payload.startCodePoint`/`endCodePoint`, then
    `toExcerptWithSpan(..., true)` before the revision check).
  - Work: On revision mismatch, return a whole-message (or field-level)
    refreshed excerpt at the current revision with `exact: false`, or omit
    the sliced text and only return identity + “source changed — reselect”.
    Never advertise `exact: true` for a stale interval.
  - Done when: an edited source yields a confirmation preview that is either
    the current full text or an explicit reselect prompt; tests assert
    `exact !== true` (or span reset) on `refreshed[]`.
  - Requirements: FR-10–11; AC-18; design §§4.2, 13.3.

- [ ] **Oversized-turn receipts must not enter the stream as privileged system messages.**
  - Reason: `oversizedTurnReceiptRow` builds a fake `AIChatMessageEntity`
    with `role: "system"` and `as AIChatMessageEntity`. That can be replayed
    as a privileged system instruction instead of labeled historical
    evidence (AC-22: historical content is evidence, not instructions).
  - Evidence: `src/service/AIChatContextAssembler.ts` `oversizedTurnReceiptRow`.
  - Work: Emit a labeled history/receipt block (same framing as selected
    context / archive evidence), not `role: "system"`. Keep message ids for
    `conversation_history_read`.
  - Done when: assembler tests show the receipt is not a system-role
    instruction; adversarial copy inside an omitted turn cannot outrank the
    live user turn.
  - Requirements: FR-05; AC-22; design §12.

- [ ] **Manual compact must not be one blocking RPC for the whole batch.**
  - Reason: `handleCompactConversation` now emits `running` first and maps
    `paused`/`joined`/`cancelled` instead of `failed` (previous P0 is fixed).
    It still `await`s `runFullCompact()` for the entire batch (up to three
    sections + model calls) on a single IPC invoke. Design §13.1 is
    start / status / progress, not one indefinite handler.
  - Evidence: `src/main-process/communication/ai-chat-v2-ipc.ts`
    `handleCompactConversation` (~1406 `await getCompactAgent().runFullCompact`).
  - Work: Start the coordinator, return immediately with `runId`, drive the
    badge from progress/status events, and expose resume as a separate call.
  - Done when: the compact IPC returns while a run is `running`; renderer
    status stays accurate if the user navigates away mid-batch.
  - Requirements: FR-07, FR-09; AC-04, AC-07; design §13.1.

---

## P1 — Requirement slices still not met

- [ ] **Session memory still uses a second summarizer for small deltas.**
  - Reason: The previous TODO marked AC-23 done because session-memory gained
    request-budget preflight, output caps, and coordinator handoff when the
    delta cannot fit. Small deltas still go through
    `buildSessionMemoryUserPrompt` + `completeChat`, not the section packer,
    checkpoints, or CAS publication. FR-07 / design: one bounded incremental
    algorithm; session memory is not a second full-history (or ad-hoc) path.
  - Evidence: `src/service/AIChatCompactAgentService.ts` session-memory loop
    (~519–558 `completeChat`); coordinator is used only via
    `routeOversizedDeltaToCoordinator`.
  - Work: Route all session-memory updates through the same packer +
    coordinator (or document an explicit, tested exception if product keeps
    a tiny-delta fast path). Shared token numbers alone are not unification.
  - Done when: there is no `completeChat` session-summary path that bypasses
    section packing; tests cover both tiny and oversized deltas on the
    coordinator.
  - Requirements: FR-07; AC-23; design §§8, 11, 16.

- [ ] **Feature flags still default off (fail-closed).**
  - Reason: This matches design §18 rollout, so it is not a logic bug. It is
    still an incomplete **product** gate: with flags unset, new compaction
    throws “Compaction unavailable…” and history tools/UI stay dark. Release
    is not “requirements implemented for users” until staged enablement is
    decided and documented after P2 qualification.
  - Evidence: `src/config/featureFlags.ts` all four
    `=== "true"` checks, catch → `false`; Token keys in
    `AI_CHAT_RECOVERABLE_FLAGS`.
  - Work: Keep fail-closed until AC qualification. Then enable in order
    (archiveReads → newCompaction → historyTools + historyUi) on the intended
    channel, with an operator note. Do not flip defaults on to hide missing P2.
  - Done when: rollout plan names who enables which flag, after which tests;
    default-off remains until that gate.
  - Requirements: design §§18, 21.

---

## P2 — Acceptance and release qualification (still open)

Design §21: implementation is complete only when AC-01..AC-24 pass, original
details remain retrievable after repeated compaction/restart, every model path
is budget-checked, and normal compaction processes only new eligible history.

Deterministic storage/unit coverage from the previous round is **not** repeated
here. These are the remaining completion gates.

- [ ] **AC-01 live half** — Three incremental compacts + app restart, then
  recover the original wording (not only the 50/50 search→read storage suite).
  Reason: storage markers prove the archive, not the compact→restart product
  path. E2E currently attempts **one** compact + controlled restart and has
  not been run (`yarn test:e2e`).
- [ ] **AC-02** — Later explicit correction is preferred; both passages remain
  citable. Reason: correction-pair markers exist in the dataset; model-side
  preference needs live scoring (`AIFETCHLY_RECALL_LIVE=1`), not storage hits.
- [ ] **AC-09 E2E timing** — Snapshot must exclude input that arrives after
  compaction starts. Reason: equal-timestamp stability is proven at read
  level; live overlapping send vs compact is not.
- [ ] **AC-12 E2E** — Forged cross-conversation ids fail closed in the running
  app. Reason: unit test exists; Electron variant is still open.
- [ ] **AC-17 E2E run** — Browse/select/navigate without growing model context.
  Reason: component tests exist; `test/e2e/specs/ai-chat-recoverable-history.test.ts`
  covers this but **has not been executed** in this worktree audit.
- [ ] **AC-20 E2E run** — History remains readable with AI disabled; no
  provider call. Same E2E file; not run.
- [ ] **AC-22 live** — Adversarial historical instructions do not outrank the
  current user turn. Reason: block framing labels evidence in prompts;
  adversarial live-model proof is open.
- [ ] **100,000-message p95** — Search p95 < 1s, single-id read p95 < 500 ms
  on a named reference machine / SQLite build. Reason: `AIChatArchivePerf`
  is a **10k** fixture only (PRD §§10–13 / design §17.4).
- [ ] **Live 50-case recall scoring** — ≥95% source-backed, zero fabricated
  quotes, recorded model and window. Reason: dataset v1 is deterministic
  storage; live path is `AIFETCHLY_RECALL_LIVE=1` and was not run.
- [ ] **Run Electron E2E** — `yarn test:e2e` (or the recoverable-history spec
  alone) on this branch. Reason: the spec file exists
  (`test/e2e/specs/ai-chat-recoverable-history.test.ts`) covering AC-01 (one
  compact), AC-17, AC-18 (metadata, not provider passage), AC-20, and
  post-completion deletion. That is not the full PRD suite, and it has no
  recorded pass on this HEAD.

---

## Suggested fix order

1. Recall search: follow `nextCursor` + isolate SqliteDb (unblocks AC-01 storage
   as a reliable gate; also the only currently observed test failure).
2. `readTurnRows` / `readRowsAfter`: follow pages past 64 rows; fix inclusive
   anchor waste.
3. SOURCE_CHANGED refreshed excerpt: do not reuse stale offsets with `exact: true`.
4. Receipt framing: drop fake `role: "system"` entities.
5. Session-memory: one algorithm (or a documented, tested exception).
6. Compact IPC: start/status instead of blocking `runFullCompact`.
7. P2: Electron E2E, then live recall + AC-02/22, then 100k p95, then flag
   rollout.

Do not re-implement the archive entities, bounded Model reads, coordinator,
history tools/UI, or request-budget wiring. Those are in place. Close the
gaps above.

---

## Out of scope for this file

Already closed in the previous TODO and **verified still present** at
`b3a2993c` (do not reopen unless a regression appears):

- Paused/joined/cancelled no longer mapped to `failed`
- `getRecentTurns` / turn reads keyset from the turn start
- Selection resolution uses `toExcerptWithSpan` for accepted ids
- Stale revision is not quoted into the provider message
- Dynamic `import()` removed from compaction/history (assembler still has
  pre-existing `await import("electron")` for app version)
- Over-budget selected passages throw instead of silent trim
- Unknown-model fallback is 8,192 / 1,024, not 128k
- Assembler prefers published generation; production wires `archiveModule`
- Query-loop preflight is unconditional
