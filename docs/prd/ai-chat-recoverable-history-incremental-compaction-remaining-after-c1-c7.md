# Recoverable History — Remaining After C-1–C-7

**Date:** 2026-09-18  
**Worktree:** `/Users/cengjianze/project/aiFetchly/.claude/worktrees/ai-chat-compaction`  
**Branch:** `worktree-ai-chat-compaction`  
**HEAD at this list:** `d1e2a2be` (`fix: complete recoverable-history leftovers C-1–C-7 with tests and re-qualification`)  
**Prior remaining list (C-1–C-7 now closed):** [ai-chat-recoverable-history-incremental-compaction-remaining-after-completion-round.md](ai-chat-recoverable-history-incremental-compaction-remaining-after-completion-round.md)  
**PRD:** [ai-chat-recoverable-history-incremental-compaction-prd.md](ai-chat-recoverable-history-incremental-compaction-prd.md)  
**Technical design:** [ai-chat-recoverable-history-incremental-compaction-technical-design.md](ai-chat-recoverable-history-incremental-compaction-technical-design.md)

This file lists **only what is still not complete** after independent re-check of HEAD `d1e2a2be`. Do not re-implement C-1–C-7 or earlier P0/P1/M/P2 items unless they regress.

Independent verification this round: assembler/packer/coordinator/flags 64 passed; `AIChatV2ModuleClearCascade` 4 passed; history UI component tests 24 passed. Electron E2E and 100k p95 were **not** re-run by the auditor.

**Update 2026-09-18 (follow-up round):** R-1 implemented and tested; Q-1
re-run 6/6 and Q-2 re-run (search p95 35 ms / read p95 1 ms, Apple M1 /
16 GB / Node 22.19.0 / better-sqlite3 13.0.2) independently confirmed on the
current HEAD; Q-3 storage halves 52/52, live-model half still external
(no provider key); Q-4 partial — Q-1/Q-2 signed off here, Q-3 live pending.

---

## Verdict

**PRD functional code is implemented** in the worktree (archive, retrieval, bounded compaction, UI, concurrency, budget, selection overflow) behind **fail-closed flags**.

**Design §21 is not met.** Remaining work is qualification, rollout, and one small UI fail-open residual — not another engine rewrite.

---

## Already closed on this HEAD — do not re-open

C-1 unprivileged compact evidence block; C-2 composite/advisory legacy boundary; C-3 abort clear when tombstone/invalidate fails; C-4 `claimRunWithSnapshot` inside the claim transaction; C-5 static `AIChatCompactionModule` import; C-6 history UI IPC + `v-if="historyUiEnabled"` (see residual R-1); C-7 no `exclusionBoundary` without confirmed completed turns.

All earlier P0/P1/M/P2 items from the audit and remaining-after-p0 lists stay closed.

---

## Residual code (small)

### R-1. History UI fails open when the renderer API helper is missing

- [x] **Task: default `historyUiEnabled` to `false` when `isHistoryUiEnabled` is not a function.**
  **Done 2026-09-18:** the `typeof fn !== "function" → true` branch now sets
  `false` (same as transport errors). All 8 `AiChatV2`-mounting suites stub
  `isHistoryUiEnabled: true`; new `AiChatV2.historyUiFlagMissing.test.ts`
  proves a mock without the export hides the drawer toggle. Components
  54 files / 339 passed; eslint clean.

  **What is incomplete.** Production preload exports `isHistoryUiEnabled` and IPC returns `isHistoryUiEnabled() === "true"`. On mount, if the helper is **absent** from the renderer API object, the UI sets enabled:

  ```
  if (typeof fn !== "function") {
    historyUiEnabled.value = true;   // older test mocks
  } else {
    void fn().then((enabled) => { historyUiEnabled.value = enabled === true; })
      .catch(() => { historyUiEnabled.value = false; });
  }
  ```

  Transport errors correctly go to `false`. Missing export goes to `true`.

  **Why it is not done.** Design §18 and the other three flags are fail-closed (`=== "true"`, catch → false). This branch is fail-**open** for incomplete mocks or a preload that forgot the new export. In that case users see the drawer and “use in next reply” even when `historyUi` Token is unset. Archive/tools may still be off, so chips can resolve empty — the exact mismatch C-6 was meant to prevent.

  **Evidence.** `src/views/components/aiChatV2/AiChatV2.vue` `onMounted` history-UI flag load (~5138–5147). `src/config/featureFlags.ts` `isHistoryUiEnabled` (Token `=== "true"`). Preload does export the channel in this HEAD.

  **Fix.** Treat a missing function like a transport error: `historyUiEnabled.value = false`. Update component tests that relied on the missing-export default to stub `isHistoryUiEnabled: async () => true`.

  **Done when.** No `fn !== "function" → true` path. Tests that need the drawer stub the helper. Default Token store → drawer hidden.

  **Requirements:** design §18; FR-10; AC-17, AC-20.

---

## Qualification and rollout (required by design §21)

These are not “rewrite compaction.” They are the remaining **completion definition**. The `d1e2a2be` commit message claims Q-1 and Q-2 passed; this audit **did not re-run them**, so they stay open until independently confirmed on this HEAD.

### Q-1. Re-run Electron recoverable-history E2E on this HEAD

- [x] **Task: run `test/e2e/specs/ai-chat-recoverable-history.test.ts` after `yarn build:e2e` on `d1e2a2be` (or later) and record the result.**
  **Done 2026-09-18:** fresh `yarn build:e2e` + spec on the current HEAD
  (C-1–C-7 + R-1): **6/6 passed** (~1.1 m). The spec seeds all four rollout
  flags including `ai_chat_history_ui_flag: "true"`, so the C-6 drawer gate
  does not affect it. AC-17 (browse-without-select) and AC-20 (AI-disabled
  browse, zero provider calls) pass.

  **Why it is not done.** C-1 changed how compact context is assembled (system interpreter + assistant evidence). C-6 hides the history drawer unless the UI flag is on. E2E may need `historyUi` Token seeded (same pattern as `tokenOverrides` / archive flags). A 6/6 result from **before** `d1e2a2be` does not prove AC-01/12/17/18/20 still pass. The auditor did not run Playwright this round.

  **Commit claim (unverified here):** 6/6 on this commit.

  **Done when.** Fresh `yarn build:e2e` + spec 6/6 (or documented failures) on the current HEAD, with flag seeding noted. AC-17 still proves browse-without-select does not grow model context; AC-20 still proves AI-disabled browse with zero provider calls.

  **Requirements:** AC-01, AC-12, AC-17, AC-18, AC-20; design §17.2.

---

### Q-2. Re-run 100k-message p95 on documented hardware

- [x] **Task: run `AIFETCHLY_PERF_100K=1` `AIChatArchivePerf100k` and record machine + numbers.**
  **Done 2026-09-18:** 3/3 passed on Apple M1 / 16 GB / Node 22.19.0 /
  better-sqlite3 13.0.2, n=30: search p50 5 ms / **p95 35 ms** / max 52 ms
  (budget 1 s); single-read p50 0 ms / **p95 1 ms** / max 1 ms (budget
  500 ms). PRD targets met in-suite.

  **Why it is not done.** PRD §10: search first-page p95 &lt; 1 s and source read p95 &lt; 500 ms on a 100,000-message local fixture. C-3/C-4 did not change the hot read path much, but index/search fallback (M-3) did. The auditor did not run the 100k suite. Prior claims (26–32 ms search, ~1 ms read on Apple M1 / 16 GB / Node 22.19.0) are **stale relative to this HEAD** until re-measured.

  **Commit claim (unverified here):** search p95 29 ms / read 1 ms.

  **Done when.** Log hardware, SQLite/better-sqlite3 versions, n, p50/p95/max for search and read; assert PRD targets in-suite.

  **Requirements:** FR-01, FR-02; design §17.4.

---

### Q-3. Live 50-case multilingual recall scoring

- [ ] **Task: run `AIFETCHLY_RECALL_LIVE=1` against the release model/provider; record scores separately from storage tests.**
  **Status 2026-09-18:** storage halves re-run on this HEAD —
  `AIChatHistoricalRecall.test.ts` **52/52 passed** (no key needed). The
  live-model half still cannot run here: no provider key exists in this
  environment, and the dataset notes require a live provider. **External**:
  needs model + provider + flags logged per the dataset runner notes.

  **Why it is not done.** PRD §10 / design §17.4: ≥50 long-conversation cases, all six languages, ≥95% correct source-backed answers on explicit historical-recall questions, **zero fabricated exact quotes**. Deterministic storage tests (markers, AC-02 correction-pair order, AC-22 framing in assembler) **do not** prove the model retrieves before quoting or obeys evidence-not-instructions after C-1 moved summaries to an `assistant` block. No provider key was available in audit sessions. The commit itself says Q-3 stays external.

  **Done when.** Versioned dataset run logged (model, provider, feature flags). Unsupported claims counted separately from retrieval misses. Human review for ambiguous answers. Do not treat schema-valid summaries as proof of faithful recall.

  **Requirements:** FR-03, FR-04; AC-01, AC-02, AC-22; design §17.4.

---

### Q-4. Operator enablement only after Q-1–Q-3

- [ ] **Task: keep Token flags fail-closed; enable with `enableRecoverableHistoryFlags()` only after Q-1–Q-3 sign-off.**
  **Status 2026-09-18 (partial sign-off):** Q-1 pass and Q-2 under budget
  confirmed above; Q-3 live-model scoring still pending (external). Defaults
  unchanged (`=== "true"`, fail-closed); no source defaults flipped in this
  branch. Do not enable until Q-3 is recorded or explicitly deferred by
  product.

  **Why it is not done.** Design §18/§21: expand only after deterministic acceptance tests and recall targets pass. Defaults are `=== "true"` else false — **correct**. Flipping defaults in this branch would ship the feature without independent E2E/100k/live proof. `enableRecoverableHistoryFlags()` already writes all four keys; that is the opt-in, not a remaining code task.

  **Done when.** Written sign-off: Q-1 pass, Q-2 under budget, Q-3 meets recall targets (or an explicit product deferral of Q-3). Then operators call the helper (or set Tokens) per environment. Do not change fail-closed defaults in source.

  **Requirements:** design §18 / §21.

---

## Suggested order

1. **R-1** fail-closed missing `isHistoryUiEnabled` (small, before E2E so the spec cannot depend on fail-open).
2. **Q-1** E2E on this HEAD (seed `historyUi` + archive/compaction flags as needed).
3. **Q-2** 100k p95.
4. **Q-3** live recall when a key exists.
5. **Q-4** enable flags only after the above.

Do **not** re-implement archive entities, coordinator, packer checkpoint rules, history tools, QueryLoop preflight, C-1 evidence framing, C-3 abort-on-failed-tombstone, or `claimRunWithSnapshot`.

---

## Design §21 (still not met)

> Complete when the PRD’s 24 acceptance criteria pass, original details remain retrievable after repeated compaction/restart, every model path is budget-checked, and normal compaction processes only new eligible history in bounded resumable sections.

Remaining to call this complete: **Q-3 live-model scoring** (external — needs
a provider key) and the **Q-4** enablement decision after it (or an explicit
product deferral). R-1, Q-1, Q-2 are closed. Feature-flag defaults stay
fail-closed until then.
