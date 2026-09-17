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

Already closed on this HEAD (do not re-open unless they regress): first-page
search miss / recall flake, 64-row silent turn truncation, inclusive
`readRowsAfter` slot waste, SOURCE_CHANGED stale offsets with `exact: true`,
system-role turn receipts, one-page-per-call search, session-memory
`completeChat` summarizer, renderer blocking on compact start.

---

## Errors still in the worktree

These are leftover defects found in the post-`abe7aa7f` re-audit. They are
smaller than the previous P0 list, but they are still incorrect behavior.

- [ ] **Error: blocking compact IPC is still a live channel.**
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

- [ ] **Error: `getRecentTurns` still treats a truncated turn as complete.**
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

- [ ] **Error: omitted-turn receipts are dropped when the current user message has no text part.**
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

- [ ] **Error: compaction/history assembler still uses a dynamic `import()`.**
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

- [ ] **AC-01 live half** — Three incremental compacts + app restart, then
  recover the original wording.
  - Reason: 50/50 search→read proves the archive, not compact → restart →
    retrieve in the running app. The E2E spec attempts **one** compact +
    restart and has not been executed.
  - Done when: Electron run shows the early wording after three bounded
    compacts and a restart.
  - Requirements: FR-01, FR-07, FR-09; AC-01; design §§17.2, 21.

- [ ] **AC-02** — Later explicit correction is preferred; both passages remain
  citable.
  - Reason: correction-pair markers exist in the dataset; model-side
    preference needs live scoring (`AIFETCHLY_RECALL_LIVE=1`), not storage hits.
  - Requirements: FR-03; AC-02; design §17.4.

- [ ] **AC-09 E2E timing** — Snapshot must exclude input that arrives after
  compaction starts.
  - Reason: equal-timestamp stability is proven at read level; overlapping
    live send vs compact is not.
  - Requirements: FR-08; AC-09; design §§11–12.

- [ ] **AC-12 E2E** — Forged cross-conversation ids fail closed in the running
  app.
  - Reason: unit test exists; Electron variant is still open.
  - Requirements: FR-11; AC-12; design §7.

- [ ] **AC-17 E2E run** — Browse/select/navigate without growing model context.
  - Reason: component tests exist;
    `test/e2e/specs/ai-chat-recoverable-history.test.ts` covers this but
    **`yarn test:e2e` has not been run** on this HEAD.
  - Requirements: FR-10; AC-17; design §13.2.

- [ ] **AC-20 E2E run** — History remains readable with AI disabled; no
  provider call.
  - Reason: same E2E file; not run.
  - Requirements: FR-10–11; AC-20.

- [ ] **AC-22 live** — Adversarial historical instructions do not outrank the
  current user turn.
  - Reason: receipts/blocks are labeled evidence in prompts; adversarial
    live-model proof is open.
  - Requirements: FR-11; AC-22.

- [ ] **100,000-message p95** — Search p95 < 1s, single-id read p95 < 500 ms
  on a named reference machine / SQLite build.
  - Reason: `AIChatArchivePerf` is a **10k** fixture only (PRD §§10–13 /
    design §17.4).
  - Requirements: FR-01, FR-02; design §17.4.

- [ ] **Live 50-case recall scoring** — ≥95% source-backed, zero fabricated
  quotes, recorded model and window.
  - Reason: dataset v1 is deterministic storage; live path is
    `AIFETCHLY_RECALL_LIVE=1` and was not run.
  - Requirements: FR-03; AC-01, AC-02; design §17.4.

- [ ] **Run Electron E2E** — `yarn test:e2e` (or the recoverable-history spec
  alone) on this branch, with a recorded pass.
  - Reason: spec file exists covering AC-01 (one compact), AC-17, AC-18
    (metadata, not provider passage), AC-20, and post-completion deletion.
    That is not the full PRD suite, and it has no recorded pass on `abe7aa7f`.
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

## Suggested order

1. Drop or convert the blocking `COMPACT_CONVERSATION` channel / renderer API.
2. Honor `complete` in `getRecentTurns`; keep image-only receipts; static-import
   Electron in the assembler.
3. Run `yarn test:e2e` on `test/e2e/specs/ai-chat-recoverable-history.test.ts`.
4. Live recall + AC-02/AC-22, then 100k p95, then flag rollout.

Do not re-implement archive entities, bounded Model reads, coordinator,
history drawer, or request-budget wiring. Those are in place on this HEAD.
