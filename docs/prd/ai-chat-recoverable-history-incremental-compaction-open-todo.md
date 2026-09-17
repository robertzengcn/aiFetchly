# Recoverable History and Incremental Compaction — Open TODO

Date: 2026-09-17

Worktree: `/Users/cengjianze/project/aiFetchly/.claude/worktrees/ai-chat-compaction`

Branch: `worktree-ai-chat-compaction`

HEAD: `abe7aa7f` (`feat: close remaining-todo errors — paging, refresh, receipts, delegation, start/status`)

Purpose: current open work **after** the P0/P1 error-fix round. Earlier TODO files
recorded defects that this HEAD already closed. This file lists only:

1. **Errors still present** in the worktree
2. **Requirements still not complete** (PRD / design §21)

Do not treat closed `[x]` items in the older TODOs as “nothing left”:

- [ai-chat-recoverable-history-incremental-compaction-todo.md](ai-chat-recoverable-history-incremental-compaction-todo.md)
- [ai-chat-recoverable-history-incremental-compaction-remaining-todo.md](ai-chat-recoverable-history-incremental-compaction-remaining-todo.md)

References:

- [PRD](ai-chat-recoverable-history-incremental-compaction-prd.md)
- [Technical design](ai-chat-recoverable-history-incremental-compaction-technical-design.md)

Verification for this list (2026-09-17, HEAD `abe7aa7f`):

- Combined vitest (recall + turn reads + retrieval + perf + compact IPC +
  compact agent + assembler + budget wiring + bounded agent):
  **9 files, 155 tests, all passed** (includes the old `es-02` combined-run case).
- Electron E2E, 100k p95, and live-model recall were **not** run.

Fix round (same date, on top of `abe7aa7f` — see verification log at the
bottom): all 8 Errors/P0 items, both P1 code items, the 100k reference
measurement (search p95=32 ms, read p95=1 ms — both PRD targets asserted),
and the Electron E2E spec (**6/6 passing**: AC-01, AC-12, AC-17, AC-18,
AC-20, §17.2 deletion) are closed with tests. Remaining open: live-model
scoring (AC-02/AC-22 model halves, no provider key here) and the operator
flag rollout gate.

Already closed on this HEAD (do not re-open unless they regress): first-page
search miss / recall flake, 64-row silent turn truncation, inclusive
`readRowsAfter` slot waste, SOURCE_CHANGED stale offsets with `exact: true`,
system-role turn receipts, one-page-per-call search, session-memory
`completeChat` summarizer, renderer blocking on compact start.

---

## Errors still in the worktree

These are leftover defects found in the post-`abe7aa7f` re-audit. They are
smaller than the previous P0 list, but they are still incorrect behavior.

- [x] **Error: blocking compact IPC is still a live channel.** FIXED: `AI_CHAT_V2_COMPACT_CONVERSATION` channel, `handleCompactConversation`, renderer `compactChatV2Conversation` API, and all preload references deleted; START is the only compact contract (START IPC test + api channel test + preload allowlist test green).
  - What is wrong: `AI_CHAT_V2_COMPACTION_START` is the non-blocking path and
    `AiChatV2.vue` calls `startCompaction`. The old
    `AI_CHAT_V2_COMPACT_CONVERSATION` handler still `await`s
    `runFullCompact()` for the whole batch, and `compactConversation()` is
    still exported from `src/views/api/aiChatV2.ts`. Any caller of that API
    (tests, leftover UI, future code) blocks again on one RPC (design §13.1).
  - Reason: a second entry point that keeps the old blocking contract can
    reintroduce the compact-UI freeze the START channel was meant to remove.
  - Evidence:
    - `src/main-process/communication/ai-chat-v2-ipc.ts`
      `handleCompactConversation` (~1408) + `ipcMain.handle(AI_CHAT_V2_COMPACT_CONVERSATION)`
    - `src/views/api/aiChatV2.ts` `compactConversation()` still invokes
      `AI_CHAT_V2_COMPACT_CONVERSATION`
  - Fix: make the old channel start-and-return (or delete it after tests move
    to START). Do not leave a blocking compact RPC on the renderer API.
  - Done when: no production or renderer API awaits the full batch; compact
    IPC tests cover START as the only user-facing contract.
  - Requirements: FR-07, FR-09; AC-04, AC-07; design §13.1.

- [x] **Error: `getRecentTurns` still treats a truncated turn as complete.** FIXED by deletion: zero callers/tests worktree-wide, so the lying helper was removed (noted in code) instead of maintained; live paths are the paged `readTurnRows`/`readRowsAfter` + assembler receipts.
  - What is wrong: `readTurnRows` now returns `{ rows, complete }`. The
    assembler receipts `complete === false`. `getRecentTurns` still does
    `const { rows } = await this.readTurnRows(...)` and emits those rows as
    `exact: true` excerpts. A tool-heavy turn over the 16-page / 1,024-row
    cap is silently shortened on this API.
  - Reason: FR-05 requires the whole turn or a visible receipt. The assembler
    path is fixed; this helper is not. It is unused by other `src/` callers
    today, but it is a public Module method and will lie if anything uses it.
  - Evidence: `src/modules/AIChatArchiveModule.ts` `getRecentTurns` (~518).
  - Fix: honor `complete`; if false, omit raw rows and return a receipt-style
    excerpt (or throw / empty + warning). Add a test that a >1024-row turn is
    not returned as a full exact page.
  - Done when: a >1024-row fixture cannot come out of `getRecentTurns` as a
    silently truncated exact history.
  - Requirements: FR-05; AC-03; design §§4.3, 12.

- [x] **Error: omitted-turn receipts are dropped when the current user message has no text part.** FIXED: image-only turns gain a receipt text part; covered by a new assembler test.
  - What is wrong: receipts are folded only into `type === "text"` content
    parts (or into `currentUserMessage` string). If the user sends images /
    files only (`currentUserContentParts` with no text part), `receiptBlock`
    is computed and then discarded. The model never sees that a retained turn
    was omitted, and there is no retrievable-id hint (FR-05).
  - Reason: FR-05 / AC-22 require a visible labeled receipt, not silence,
    when raw turn content is not loaded.
  - Evidence: `src/service/AIChatContextAssembler.ts` assemble path
    (`currentUserContentParts.map` only mutates `part.type === "text"`).
  - Fix: if there is no text part, prepend/append a text part containing the
    receipt block (still user-role evidence, never `system`). Test an
    image-only current turn with an oversized retained turn.
  - Done when: image-only send still carries the omitted-turn receipt in the
    user message.
  - Requirements: FR-05; AC-22; design §12.

- [x] **Error: compaction/history assembler still uses a dynamic `import()`.** FIXED: static `import { app } from "electron"` (established pattern, guarded for tests); no `await import(` remains in the assembler.
  - What is wrong: `buildEnvironmentContext()` does `await import("electron")`
    for `app.getVersion()`. Project rule forbids dynamic imports in this
    codebase (packaging / tree-shaking). Compaction/history dynamic imports
    were removed earlier; this site remains.
  - Reason: Electron Forge main-process CJS bundling has repeatedly broken on
    lazy `import()`. This is on the context-assembly path for every chat turn.
  - Evidence: `src/service/AIChatContextAssembler.ts` (~829).
  - Fix: static `import { app } from "electron"` (guard `app.getVersion` for
    tests), or inject version through an existing dep. No `import()`.
  - Done when: `rg 'await import\(' src/service/AIChatContextAssembler.ts`
    is empty.
  - Requirements: G7; electron static-import rule.

---

## Tasks not complete (PRD / design §21)

Implementation of the bounded archive, coordinator, retrieval, UI, and
request budget is in place. Design §21 still requires these acceptance
gates. None of them have a recorded pass on this HEAD.

- [x] **AC-01 live half (one-compact variant)** — Compact + app restart, then
  recover the original wording. PASSING in Electron (5-turn fixture so FR-05
  retention leaves eligible history; START + STATUS with generation-aware
  terminal detection; session-2 search finds the exact marker AND a published
  generation survives the restart). The full three-compact variant remains
  aspirational.
  - Requirements: FR-01, FR-07, FR-09; AC-01; design §§17.2, 21.

- [x] **AC-02 storage half** — Both passages remain citable with source links
  and the correction orders strictly later (deterministic basis for FR-04
  "prefer later corrections"). PASSING (`AIChatHistoricalRecall` correction-pair
  test, en + zh). Model-side preference still needs live scoring
  (`AIFETCHLY_RECALL_LIVE=1`, no provider key here).
  - Requirements: FR-03; AC-02; design §17.4.

- [x] **AC-09 read level** — Equal-timestamp keyset stability proven (10k
  fixture seeds shared timestamps; composite boundary + rowId-tiebreak pair
  filter tested). Live overlapping send-vs-compact timing still open.
  - Requirements: FR-08; AC-09; design §§11–12.

- [x] **AC-12 E2E** — PASSING in Electron: a real source id from conversation
  A resolved/read against conversation B returns empty with a scope error and
  zero leaked content (epoch binding rejects first; conversation-scoped row
  read is the second layer, unit-covered).
  - Requirements: FR-11; AC-12; design §7.

- [x] **AC-17 E2E run** — PASSING in Electron (browse without selecting;
  model request stays bounded; required drawer search-tab navigation after the
  tabbed rewrite).
  - Requirements: FR-10; AC-17; design §13.2.

- [x] **AC-20 E2E run** — PASSING in Electron (history readable with AI
  disabled; zero provider calls).
  - Requirements: FR-10–11; AC-20.

- [x] **AC-22 framing enforced (storage half)** — New assembler tests seed
  adversarial history into every evidence path (session block, legacy block,
  verbatim replay, omitted-turn receipt) and assert no *unframed* system
  message carries it, and receipts quote nothing at all. Adversarial
  live-model proof (does the model obey framing?) still needs a keyed
  provider run.
  - Requirements: FR-11; AC-22.

- [x] **100,000-message p95** — MEASURED on Apple M1 arm64 / 16 GB / Node
  v22.19.0 / better-sqlite3 13.0.2 (SQLite 3.53.4), 2026-09-17, via
  `AIChatArchivePerf100k` (`AIFETCHLY_PERF_100K=1`): search single-call
  **p50=7 ms / p95=32 ms / max=36 ms** (target p95 < 1 s) and single-id read
  **p50=0 ms / p95=1 ms / max=3 ms** (target < 500 ms), n=30 each; deep-marker
  recovery via cursor protocol proven. PRD targets asserted in-suite.
  - Requirements: FR-01, FR-02; design §17.4.

- [ ] **Live 50-case recall scoring** — ≥95% source-backed, zero fabricated
  quotes, recorded model and window.
  - Reason: dataset v1 is deterministic storage; live path is
    `AIFETCHLY_RECALL_LIVE=1` and was not run.
  - Requirements: FR-03; AC-01, AC-02; design §17.4.

- [x] **Run Electron E2E (recoverable-history spec)** —
  `test/e2e/specs/ai-chat-recoverable-history.test.ts`: **6/6 passing**
  (`AC-01`, `AC-17`, `AC-18` metadata + chip clearing, `AC-20`, `§17.2`
  deletion, `AC-12` cross-conversation forgery) in ~38 s on this worktree
  (build `yarn build:e2e` ~25 s). Full `yarn test:e2e` (all specs) not run.
  - Requirements: design §§17.2, 21.

- [ ] **Feature-flag rollout after qualification** — flags still default off
  (`archiveReads`, `newCompaction`, `historyTools`, `historyUi`).
  - Reason: fail-closed matches design §18, so this is not a logic bug. It is
    still an incomplete **product** gate: with flags unset, compaction throws
    “Compaction unavailable…” and history tools/UI stay dark. Do not flip
    defaults on to hide missing P2.
  - Evidence: `src/config/featureFlags.ts` all four `=== "true"` checks,
    catch → `false`.
  - Done when: operators enable in order (archiveReads → newCompaction →
    historyTools + historyUi) after the gates above pass.
  - Requirements: design §§18, 21.

---

## Suggested order (all code items completed 2026-09-17; E2E spec 6/6 green;
only live-model scoring + operator rollout remain)

1. ~~Drop or convert the blocking `COMPACT_CONVERSATION` channel / renderer API.~~ DONE (channel/handler/API deleted; START-only; tests moved)
2. ~~Honor `complete` in `getRecentTurns`; keep image-only receipts; static-import Electron.~~ DONE (`getRecentTurns` deleted as dead code; image-only text part; static import)
3. ~~Run E2E on the recoverable-history spec.~~ DONE (6/6 in ~38 s)
4. Remaining (need keyed provider / operator): live recall + AC-02/AC-22 scoring, then flag rollout per the plan in the previous TODO.

Do not re-implement archive entities, bounded Model reads, coordinator,
history drawer, or request-budget wiring. Those are in place on this HEAD.

---

## Verification log for this fix round (2026-09-17 worktree)

- `npx tsc --noEmit -p tsconfig.json`: clean · `npx vue-tsc --noEmit`: clean
- `npx eslint --no-fix` on every touched src/test file: clean
- Unit suites, all passing:
  - retrieval 32 (page-2-in-one-call, empty-page≠NO_MATCH, refreshed
    exact:false) · coordinator 13 (reduction, in-flight deletion, restart) ·
    compact-agent 24+ (delegation) · assembler 27 (turn/receipt/generation +
    image-only + AC-22 framing) · engine/loop/IPC/API/tool-history suites ·
    recall 51 (50 markers + AC-02 storage) · i18n 4 · perf 10k 4 + 100k 3
    (PRD targets asserted) · utility-code selections 17
- Component suite: **52 files / 332 passed**
- Electron E2E recoverable-history spec: **6/6 passed** (~38 s) after migrating
  AC-01 to START+STATUS, adding search-tab navigation (AC-17/18), fixing the
  Playwright-vs-eslint fixtures signature, and adding AC-12 cross-conversation
  forgery. Notable E2E-driven findings fixed in passing: FR-05 retention makes
  ≤3-turn fixtures a correct compaction no-op (5-turn fixture now), and
  post-completion STATUS reads `queued`+generation (terminal detection is
  generation-aware).
- Pre-existing failures confirmed identical on stashed HEAD (not regressions):
  `ScheduledAiMessageRunner.chatLoop` mock pattern.
- Still open (external resources): live-model scoring (no provider key),
  operator flag rollout.
