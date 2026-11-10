# Workspace capability parity — re-audit R7 and remaining TODO

Audit date: 2026-10-22. Reviewed HEAD: `0b6c04836`, branch `workspace-v2-capability-parity`, worktree `workspace-parity`.

Authorities: [PRD](./ai-chat-workspace-v2-capability-parity-prd.md), [technical design](./ai-chat-workspace-v2-capability-parity-technical-design.md), and [R6 report with fix/certification addenda](./ai-chat-workspace-v2-capability-parity-audit-todo-2026-10-21-r6.md).

**Verdict: not complete.** The original R6-01/02/03 cases are addressed and the deterministic voice journey now passes. This review reproduced **two additional code defects through three focused checks** and rechecked the already-open reload-preservation issue. Remaining real-runtime, accessibility/browser and soak evidence is listed separately. This is an incremental audit of the updated implementation and adjacent failure paths, not an exhaustive security review of the entire application.

No application fixes were applied at audit time. Only this report was intended for that commit. (**Superseded:** the follow-up fix round committed `442d3197d`, `e185d7801` and `4d6347963` on this same worktree, then the R7-04 projection fix committed `110519323` with the doc addendum `c5eb0b617` — see the final-revision addendum at the end.) The earlier untracked `...audit-todo-2026-10-20.md` remained untouched.

**Verdict update (2026-10-22): every agent-completable defect in this report (R7-01, R7-02, R7-03 and R7-04) is fixed, tested and committed.** The R7-04 projection fix landed as `110519323` and this document's R7-04 fix record is part of the follow-up docs commit ("docs: R7-04 fix record" — see git log for the hash). All remaining work is the release certification the codebase cannot self-supply: V01 real speech-runtime models, V02 manual AT/platform/browser evidence, V03 soak/sign-off. Definition of Done is not met until those are recorded.

## Fresh verification

| Check | Result |
| --- | --- |
| `yarn test:components` | **162 files / 1,352 tests passed** before adding temporary audit checks. |
| Targeted main-process tests, command below | **17 files / 160 tests passed**. |
| `yarn typecheck` | Passed, 61.38 seconds. |
| `yarn vue-typecheck` | Passed, 76.00 seconds. |
| `yarn test:components auditR7 -t AUDIT_R7` | **Three assertion failures**: stale selection success, stale selection failure, and content accumulator reset. 15 inherited tests were filtered out. |
| Targeted Electron E2E, command below | **2 passed / 1 failed** (55.6 seconds). Both deterministic voice cases passed; reload timed out waiting for the page load event. See R7-03 for the isolated check. |
| Isolated deterministic reload E2E | **1 failed** at transcript restoration after the shell reloaded; matches the known R6-04 defect. |
| Full Electron/main/module suites, real speech models, live authenticated browser, manual accessibility, soak | Not rerun/performed here. The previous report records a full-suite 178-pass/3-skip run; those results are historical and include the known skip-placement defect. |

Targeted main command:

```sh
AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run \
  test/vitest/main/aiChatWorkspace \
  test/vitest/main/browserVoiceRecorder.test.ts \
  test/vitest/main/aiChatPlanDecisionIpc.test.ts \
  test/vitest/main/aiChatRendererMetricsIpc.test.ts \
  test/vitest/main/model/AIChatPendingMessage.model.test.ts \
  test/vitest/main/modules/AIChatPendingMessageModule.test.ts
```

The duplicate internal typecheck was skipped; standalone checks are recorded above. Targeted Electron command (fresh E2E build included):

```sh
AIFETCHLY_E2E_LIVE_AI=1 xvfb-run -a yarn test:e2e \
  test/e2e/specs/workspace-shell.test.ts \
  test/e2e/specs/aiChatVoiceJourney.test.ts \
  --grep 'deterministic in-flight|voice journey' \
  --output /tmp/parity-r7-e2e-results
```

The LIVE_AI flag only bypasses the misplaced skip for the selected deterministic reload test; the grep excludes the actual live-provider scenario. Both selected voice cases use the explicit runtime stand-in and local fake provider. This run is not real-model or live-provider certification.

Logs: `/tmp/parity-r7-{components,main,typecheck,vue,repro,e2e,reload}.log`. Focused store checks were copied from `selectedConversation.r6ActiveAnswer.test.ts`; the temporary file was removed from the worktree and retained at `/tmp/auditR7.test.ts`. To reproduce, copy it under `test/vitest/main/components/store/` and run the focused command. They exercise the actual store/presenter with controlled IPC responses and events, and wait past the 50 ms token flush. These are content/state assertion failures, not type or harness setup failures. Add permanent regressions with the fixes; temporary artifacts are not portable release evidence.

## Previous fixes and progress

| Area | Current disposition |
| --- | --- |
| R6-01: authoritative runtime hydration | Presenter now receives the runtime snapshot and events are deferred/replayed. Original quiet-running/waiting cases pass. The new shared buffer is not protected against an older request settling: R7-01. |
| R6-02: hydrated active rows not protected | Existing rows are adopted and pinned independently of append deduplication. Original resumed-row case passes. |
| R6-03: long tool-heavy turn loses active text | Multi-pass trimming and a logical accumulator preserve the original 100-tool-pair case. The fallback for eviction of content-bearing rows still resets the saved accumulator: R7-02. |
| R6-04: mid-run renderer reload loses selection | Still open in the latest addendum; retained here as R7-03 with fresh targeted E2E evidence. |
| V04: protocol guard/font serving | Trusted generated-image scheme handling, decoded-image checks and scoped font serving are implemented. Historical full-suite reruns are recorded in R6; no new failure in these specific paths was established here. |
| V01: deterministic successful voice journey | Implemented and **both targeted voice E2E tests pass freshly**: successful transcription/auto-send/playback and rejected-send draft preservation. Real runtime/models remain a separate open check. |
| Earlier queue/identity/voice/telemetry fixes | Retained; relevant normal regression suites pass. No new regression established in those contracts in this pass. |

## Remaining code defects

### R7-01 — P1: an older selection request clears the newer selection's buffered completion

- [x] Give the deferred detail-event buffer and its cleanup immutable selection ownership; a superseded request must never clear or disable the current selection's buffer. (**Fixed — addendum R7-01 record.**)
- **Requirements:** FR-LIF-002/004, FR-REC-008; technical design §9.3 reconstruction and selected-generation isolation.
- **Location:** `src/views/store/selectedConversation.ts:1060–1063` detects a superseded snapshot but then calls `clearDeferredDetailEvents()` on the shared current buffer. The catch block at :1109–1112 also clears that buffer and disables deferral **before** checking generation. Current-generation replay uses the same variables at :1095–1099.
- **Reproduce:** Start loading A and hold its reply. Start loading B and hold its reply. Deliver B's `complete` detail event with final content while B is loading. Resolve **or reject** A's old request, then resolve B's snapshot containing earlier partial text and `runtimeStatus: 'running'`.
- **Observed:** Both focused variants produce **`{ content: 'partial', status: 'running' }`**, expected **`{ content: 'B completed while loading', status: 'idle' }`**. B's valid terminal was buffered, then discarded by A's cleanup. The generation check successfully excludes A's snapshot itself, but does not protect B's buffer.
- **Impact:** Quickly switching between chats during slow IPC can leave the selected chat showing stale text and running state after its actual completion. Disabling deferral also allows subsequent current-chat events to apply before its snapshot and be overwritten by the seed. This reproduces lost renderer projection, not loss of the durable database message or cancellation of the main-process run.
- **Fix detail:** Store a buffer per selection token, or guard every cleanup/enable/disable/replay operation with the owning token. Treat stale success and stale rejection identically. Do not solve this only by removing the success-path cleanup while leaving the catch unconditional. Keep teardown and null selection explicit.
- **Done when:** Permanent tests cover stale success/rejection, A→B→A, three overlapping loads, buffered terminal/token/permission events, and teardown. Only the current generation may mutate its buffer; each current event is replayed once after the correct snapshot and the final content/runtime state is accurate.

### R7-02 — P2: recreating an evicted content row overwrites the logical accumulator

- [x] Reuse an existing active-turn accumulator when a row is absent; initialize empty content only for a genuinely new logical message. (**Fixed — addendum R7-02 record.**)
- **Requirements:** FR-HIS-001/005, PRD §19, technical design §17; the R6 content-preserving overflow contract.
- **Location:** `src/views/utils/workspaceStreamPresenter.ts:400–421` preserves the accumulator for an existing mounted row. But when the row is absent, :424–431 unconditionally executes `activeTurnAccumulator.set(messageId, { content: '', reasoning: '' })` before appending. The last-pass eviction at :1157–1160 deliberately permits content-bearing rows to leave the mounted window on the premise that the accumulator survives.
- **Reproduce:** Start answer-0 and stream `prefix `; verify it rendered. Stream 200 additional distinct content-bearing answer IDs within that same run, reaching the protected-content overflow case. Flush and verify answer-0 is evicted while mounted rows remain ≤200. Resume answer-0 with `suffix`.
- **Observed:** The reconstructed answer contains **`suffix`**, expected **`prefix suffix`**. The saved accumulator is erased in `ensureAssistantView()` before the next delta or `materializeFromAccumulator()` can recover it.
- **Scope:** This is a renderer stress/contract reproduction for more protected content rows than the mount limit. It does not establish that typical providers emit 201 answer IDs per turn or that this workload occurs frequently. It specifically exercises the fallback that the new implementation documents as supported; the original 100 tool-pair case evicts lower-priority tool receipts and therefore misses it.
- **Fix detail:** Materialize from the existing logical content before resuming, preserving reasoning as well as text. Keep the logical accumulator bounded/lifetime-scoped independently of the rendered row limit, and define overflow behavior if logical content itself exceeds policy. Do not trade the failure for an unlimited mounted transcript.
- **Done when:** Preserve text and reasoning across content-bearing overflow in both paging directions, then continue with more deltas, completion, error and cancellation. Include hydrated and new rows; assert row bounds throughout. Tests should exercise actual protected-content eviction, not just append many discardable tool receipts.

### R7-03 — P1: reload does not restore the active conversation; its deterministic test is hidden by a live-provider skip

- [x] Restore the selected conversation and reconnect its surviving run after renderer reload/crash recovery. (**Fixed — addendum R7-03 record.**)
- [x] Move the LIVE_AI skip into the actual live-provider test so the deterministic reload test runs in every ordinary gate invocation. (**Fixed — addendum R7-03 record.**)
- **Status:** Carried forward from the newly recorded **R6-04**, not claimed as a newly introduced regression. The latest commits document it but do not fix it.
- **Evidence:** `test/e2e/specs/workspace-shell.test.ts:203–248` sends a deterministic delayed stream, reloads while Stop/Streaming is visible, and expects the selected transcript to reconnect. The describe-level `test.skip(!LIVE_AI, ...)` at :251–254 applies to the entire describe, unintentionally skipping this test too. `src/views/store/chatWorkspace.ts:91` starts selected conversation as null; the current restore path does not satisfy this scenario.
- **Fresh result:** The combined run first timed out at `page.reload()` waiting for the load event. A fresh isolated rerun using the same built assets (`AIFETCHLY_E2E_LIVE_AI=1 xvfb-run -a yarn playwright test test/e2e/specs/workspace-shell.test.ts --grep 'deterministic in-flight' --output /tmp/parity-r7-reload-results`) then **failed at :242**: `workspace-transcript` was absent for 30 seconds. The shell/tree checks passed; the error-context snapshot shows heading **New chat** and “Ask anything, or pick a conversation on the left.” This independently confirms the documented selection-restore failure. Log: `/tmp/parity-r7-reload.log`; screenshot/trace/error context: `/tmp/parity-r7-reload-results/specs-workspace-shell-run--e56e7-derer-reload-and-reconnects/`. The earlier load timeout is recorded separately, not asserted to have this same root cause.
- **Impact:** A reload loses visible conversation context and live continuation until manual navigation. This is a presentation/reattachment failure; do not infer that the main-process run or database content was deleted. R6's addendum records this failure on earlier revisions as well.
- **Fix detail:** Persist/restore a validated selected-conversation pointer, request its authoritative runtime snapshot and re-establish detail subscriptions after reload. Handle deleted/unavailable conversations safely, preserve drafts and do not start a duplicate run. Fix R7-01 so restore races cannot discard its events.
- **Done when:** The deterministic test passes with LIVE_AI unset in the standard suite, including header/run-strip continuity, final delivery, draft retention and crash-restore. Verify an idle restore, a running restore, a waiting decision and missing/deleted selection. The live-provider case alone remains gated.
- **Requirements:** Capability-parity FR-LIF-004 and design §9.3 reconstruction; the inherited workspace shell scenario is labelled FR-SHELL-009 in the existing test/addendum.

## Remaining acceptance and release tasks

### V01 — Real speech-runtime certification (deterministic automation complete)

- [x] Deterministic runtime stand-in journey and rejected-auto-send draft preservation: fresh targeted E2E passes both cases.
- [ ] Separately run/record the journey with installed native speech runtime and real Whisper/Piper models, including recording, transcription, auto-send, spoken response and cancellation.
- **Boundary:** The new fixture runs production recorder/conversion/worker/settings/transport/playback paths, but replaces inference/model bytes. A stand-in pass must not be labelled as actual model quality or physical-device certification. Preserve the passing negative-path voice tests too.

### V02 — Remaining accessibility/browser and final regression evidence

- [ ] Complete focus traps/return, one-time screen-reader announcements, inactive-conversation focus isolation, narrow/200% layout and reduced-motion verification on the declared platforms/assistive technology. Record the evidence and any approved manual scope.
- [ ] Complete authenticated managed-browser handoff/approval → verify → resume → stop, plus expiry, stale actions and route return, clearly separating deterministic fixtures from live-account checks.
- [ ] After code fixes, run both typechecks, components, affected main/module suites and the full Electron suite. Report exact skipped scenarios/reasons; do not count the accidentally gated deterministic reload test as acceptable live-only coverage. Confirm six-language parity for any new UI text.
- **Existing evidence retained:** R6's addendum records the keyboard-only path, chooser/voice keyboard access, landmark/new-chat focus and layout automation. Those are useful completed subsets; they do not close the remaining AT/platform/live-account checks. This audit's fresh subset is listed above, not presented as a full-suite rerun.

### V03 — Soak and release sign-off

- [ ] Provide design AD-009's rolling 14-day default-route soak: ≥500 accepted submissions, acceptance ≥99.5% excluding deliberate validation/entitlement rejections, and restart recovery ≥99% for exercised cases.
- [ ] Close severity-1/2 parity defects and document zero confirmed duplicate delivery, duplicate continuation, cross-conversation event or authorization-bypass incidents. Obtain product, safety, desktop and QA sign-off.
- [ ] Keep Chat V2 as a functioning rollback until the separate removal decision; extend low-volume soak rather than weakening the gate.
- **Evidence:** Latest changes document these outstanding artifacts but do not supply the actual production soak or approvals. PRD §21/24/28 and design AD-009.

## Requirement coverage disposition

All functional families are accounted for below. “Retained” means the previously mapped implementation remains; it does not claim a new exhaustive manual/security certification. The owner-approved worktree extraction deferral remains valid.

| Requirement family | Current assessment / remaining work |
| --- | --- |
| FR-SUB-001–009 | Payload/acceptance/retry identity retained; normal suites pass; restore/event ownership still affects visible completion (R7-01/03). |
| FR-CMD-001–009 | Shared command/goal/loop/skill routing retained; final integration gate after fixes. |
| FR-QUE-001–014 | Durable queue/source identity retained; targeted main tests pass; restore must not restart surviving execution. |
| FR-PLN-001–009 | Strict decision/continuation retained; include buffered and restored decisions in R7-01/03 verification. |
| FR-PER-001–008 | Permission/parked continuation retained; remaining accessibility and restored-action certification. |
| FR-OUT-001–010 | Frozen authorization and dedicated review retained; final safety/runtime certification pending. |
| FR-IMG-001–015 | Reference resolution retained; V04 local-protocol/font repairs and decoded-image assertions implemented. No new image defect reproduced. |
| FR-RPT-001–009 | Per-output/conversation reporting retained; no new reporting defect reproduced. |
| FR-VOI-001–010 | Deterministic success/failure E2E now passes; real-runtime V01 remains. |
| FR-WSP-001–010 | Workspace/trust/watcher/memory retained; remaining platform/runtime verification. |
| FR-REC-001–008 | Runtime hydration fixed; event-buffer ownership fixed in the fix round (addendum R7-01); soak remains. |
| FR-LIF-001–006 | Reload/restore rebuilt in the fix round (addendum R7-03); durable sidebar projection closed in the fix round (`110519323`, addendum R7-04 fix record). |
| FR-SKL-001–006 | Installation/approval/invocation retained; final integration/accessibility checks remain. |
| FR-BRW-001–006 | Managed-browser surfaces retained; authenticated V02 lifecycle evidence remains. |
| FR-HIS-001–005 | Row/adoption/eviction cases fixed; protected-content overflow fallback fixed in the fix round (addendum R7-02); soak remains. |
| FR-INT-001–005 | Shared integrations retained; final cross-feature regression pending. |
| PRD §14/18/19 security/failure/resources | No fresh full security certification; findings prove renderer state/content failures, not a DB-loss or authorization-bypass claim. |
| A11Y-001–010 / localization | Existing automated subset retained; V02 evidence and final locale checks still required. |
| PRD §20 observability | Earlier timing/count fixes retained; targeted tests pass; no new telemetry defect reproduced. |
| PRD §21–28 / design exit gates | V01 real runtime, V02 residual certification, V03 soak/sign-off and code defects remain; Definition of Done is not met. |

## Suggested order

1. Fix R7-01 event-buffer ownership and R7-03 reload/skip placement. (**Done** — `442d3197d`, `4d6347963`.)
2. Fix R7-02 accumulator reuse without weakening the mounted bound. (**Done** — `e185d7801`.)
3. Add permanent regressions for all focused failures, repeat affected gates and complete V01/V02 on the final revision. (**Regressions + gates done**; V01 real models and V02 AT/platform checks remain open.)
4. Collect V03 before declaring parity complete or removing rollback. (**Still open.**)

## Final-revision addendum — fix round 2026-10-22 (agent)

All three code defects of this audit are fixed on this worktree, each with permanent regressions, and every agent-runnable gate was rerun on the final revision. The audit checkboxes above are marked done; historical evidence text is preserved unchanged.

### R7-01 — fixed (`442d3197d`)

`src/views/store/selectedConversation.ts`: the deferred detail-event buffer now has **immutable selection ownership** via a generation token (`deferredDetailEventsOwner`). New guarded `clearDeferredDetailEventsOwned(generation)` mutates the buffer only if the caller still owns it. `loadSelection` takes ownership before its snapshot await; the superseded-success path and the catch path use the guarded clear; teardown stays an unconditional `clearDeferredDetailEvents()` (explicit teardown may drop everything); null selection is explicit. Stale success and stale rejection now behave identically — both are no-ops — so a superseded request can never clear or disable the current selection's buffer, and every current-generation event replays exactly once after the snapshot.

Regression: `test/vitest/main/components/store/selectedConversation.r7SelectionBufferOwnership.test.ts` (5 tests): stale-success clearing, stale-rejection followed by late A events surviving on B, A→B→A with dual stale settle, three overlapping loads replaying buffered token/permission/terminal events exactly once, and teardown no-resurrection. 4/5 fail on the pre-fix code (teardown case pins a preserved contract, not the regression). Pre-fix verification used a `/tmp` copy + `git checkout --` swap; post-fix all 14 store suites (122 tests) pass.

### R7-02 — fixed (`e185d7801`)

`src/views/utils/workspaceStreamPresenter.ts`: `ensureAssistantView()`'s absent-row path now **materializes from the existing turn accumulator** (text + reasoning) before appending; the empty initialization only happens for genuinely new message ids. The logical accumulator stays lifetime-scoped (cleared on seed/dispose/terminal); the mounted bound is unchanged (`MAX_MOUNTED_MESSAGES = 200`) and multi-pass trimming retains its ordering. Additional contract surfaced by the tests and implemented in the same commit: per-entry `syncFromPresenter` during batched flush/terminal materialization loops caused procession churn (each re-mount evicted its predecessor, dropping the earliest content), so `flushNow`'s entry loop and the error/cancel terminal `materializeFromAccumulator` loops run with `suppressSync` and a single tail notify; `appendMessage` gained `{ silentSync }` (pin semantics independent of sync suppression) and `materializeFromAccumulator` gained `{ silentSync }`.

Regression: `test/vitest/main/components/store/selectedConversation.r7OverflowAccumulator.test.ts` (6 tests): 200-distinct-id forward overflow resuming `prefix suffix`, reasoning preservation across overflow, backward paging during overflow, hydrated running answer with `saved ` baseline, error terminal, cancellation. All 6 fail on the pre-fix code (verified by the same swap technique). Real protected-content eviction is exercised in the forward direction; backward paging pins retain-oldest trim.

### R7-03 — fixed (`4d6347963`)

**Restore.** `src/views/store/chatWorkspace.ts` persists a lightweight selection pointer (`localStorage["aiChatWorkspace.selectedConversation"]`) on every selection; explicit deselection drops it. New `consumeRestorableSelectionPointer()` is a pure breadcrumb read: null when nothing stored or a selection is already active (deep link / notification entry wins). Validity is deliberately **not** decided against the boot-time sidebar projection (see R7-04 below) — the authoritative validator is the selection handshake itself: `loadSelection` is read-only, never starts a run, hydrates the runtime snapshot, re-establishes the detail subscription before the snapshot await (so the surviving run's events replay via the R6-01/R7-01 machinery), and for an unknown/deleted conversation hydrates an empty transcript instead of resurrecting anything. `AuthenticatedWorkspaceLayout.vue` runs `restoreWorkspaceSession()` on mount: bootstrap → pointer → `openConversation(pointer)` through the ordinary coordinator (routing-first, changed-selection check), non-fatal on failure.

**Skip placement.** The describe-level `test.skip(!LIVE_AI, ...)` was moved inside the live-provider test only; the deterministic mid-run reload test now runs in every ordinary gate invocation.

**Evidence.** Deterministic reload test: `1 passed (16.9s)` isolated, then part of the full-suite run below (the ordinary gate runs it LIVE_AI-unset). Shell spec full run: **9 passed / 1 skipped** (the live-provider case owning its gate). Regressions: `test/vitest/main/components/store/chatWorkspaceSelectionRestore.test.ts` (6 tests: pointer lifecycle/drop, restore without/with bootstrap failure, overwrite semantics, already-active selection wins) and an added layout contract test asserting mount restores the pointer via the handshake (detail subscription re-established) **without starting a run**; the original mount-ownership test is preserved with the no-pointer invariant plus pointer isolation (`localStorage.clear()` per test).

### R7-04 — NEW P2 finding (from the R7-03 investigation): durable sidebar projection lags turns until backfill

- **What the E2E investigation established (instrumented, then reverted):** a deterministic turn created through the durable queue persists `ai_chat_messages` (2 rows) and `ai_chat_runs` (1 row) but **no `ai_chat_conversations` projection row**. `AIChatCoordinator.recordMessagePersisted` (`AIChatCoordinator.ts:285/:926`) never executes on the queue path — the queue dispatches through `AIChatWorkspaceRunDispatchBridge` → `AIChatQueryEngine`, and nothing in `AIChatV2Module.saveUserMessage/saveAssistantMessage` couples a projection upsert. The boot-time `getWorkspaceSidebar()` therefore legitimately returns **0/0 rows** (verified from the renderer twice and in-process once), and the once-per-process `backfillProjections()` (`AIChatConversationModule.ts:396`, bootstrapped at `ai-chat-workspace-ipc.ts:317`) only repairs rows at the next process start. During a session the sidebar is fed by `upsertLocalConversation` + summary events; after a reload those are gone until the next summary event.
- **Why R7-03 was NOT built on it:** the selected-conversation restore is independent of the projection — the snapshot/run/subscription machinery is authoritative — which is why the deterministic reload test passes despite the empty boot projection. Sidebar rows for prior-session conversations reappear via summary events on load, so the reload scenario does not strand the choice.
- **Impact / follow-up:** sidebar *persistence fidelity* — a reload can leave the sidebar temporarily empty of prior-session rows, and any restore scheme that validates against the boot projection would drop valid pointers (this is precisely what a first R7-03 draft did; the pointer-based semantics above replaced it). A dedicated fix should couple projection upserts into the durable turn path (e.g. `AIChatV2Module` persist paths or the bridge terminal mapping) and make the boot backfill idempotent-safe under concurrent backfills; needs its own audit + evidence cycle. Not fixed in this round.
- **Requires:** PRD §10 sidebar durability, design §8.6 projection precedence; regression should assert durably persisted conversations appear in the boot projection after a reload that was preceded by a full turn.

#### R7-04 fix record (fix round, commit `110519323`)

**Design (mirrors the coordinator's direct-send projection semantics; no double counting):**

1. **User moment — promote coupling** (`AIChatPendingMessageModule.ts`): `promoteDispatchToUserMessage` and `promoteSteeringToUserMessage` now call `AIChatConversationModule.recordMessagePersisted({ isResult: false, previewText: saved.content, generatedTitle: saved.content, timestamp: saved.timestamp })` after the promote resolves. Promotion is exactly-once (`pendingModel.promoteDispatchToUserMessage` status CAS; steering leaves `applied`), so retries cannot double-count; only the queue service and `createSteeringPromoter` reach these methods, so there is no overlap with the coordinator path. Best effort — a projection failure logs and never fails the turn.
2. **Result moment — terminal coupling** (`AIChatTurnQueueService.ts`): new optional dep `conversationModule` + `recordTurnResult({ conversationId, assistantMessageId, status })` on `AIChatConversationModule` — reads the turn's durable assistant row (`assistant-pending-<pendingId>`, the row the engine persisted), skips when the row is absent (failed turns with no partial content) or the content is empty, projects otherwise with `isResult: status === "completed"` (cancelled/failed never mark unread — parity with the coordinator's terminal projection). Called after `persistTerminal` success in the completed **and** cancelled/failed branches and in `settleParkedRunContinuation` after the gate flush; try/catch warn-only so the queue advance is never blocked.
3. **IPC wiring** (`ai-chat-v2-ipc.ts` `getQueueService()`): passes `conversationModule: new AIChatConversationModule()`.
4. **Backfill race resilience** (`AIChatConversationModule.ts` `backfillProjections`): the per-row path now isolates failures — a row materialized concurrently by a live coupling adds `(+1)` on the unique index instead of aborting the pass (previously the exact unique-constraint hit from my race probe crashed the whole backfill); skipped rows are logged and reconciled by the next pass.
5. **Circular imports checked:** `AIChatPendingMessageModule → AIChatConversationModule → AIChatV2Module` and queue service → conversation module; nothing imports back into the queue service.

**Tests (TDD: written first, red-verified, then greened):**

- `test/vitest/main/service/AIChatTurnQueueService.test.ts` — new describe "AIChatTurnQueueService conversation projection parity (audit R7-04)" (4 tests): a completed drain materializes the projection (preview = assistant answer, generated title = first user content, unread, sidebar membership via `getWorkspaceSidebar`); a cancelled drain projects the partial assistant content but **never** sets unread/lastResultAt; a failed drain with no assistant row still registers the user message; steering promotion advances only the preview (title pinned to turn A). Red-verified before implementation (projection absent / unique-constraint crash), green after.
- `test/vitest/main/aiChatWorkspaceProjectionBackfillRace.test.ts` — new file (2 tests): the unique-index race simulation through the REAL module ⇒ `backfillProjections` returns `changed: 0` and the concurrently materialized row survives intact (previously: the pass crashed); plus an idempotency pin asserting rows the live couplings created are not re-written by backfill.

**Gates after the R7-04 fix (HEAD `110519323`):**

| Check | Result |
| --- | --- |
| R7-04 targeted files (2 files, real sqlite) | **28 passed** (was 6 red pre-fix). |
| Full `yarn testmain` | **8,642 tests passed**; the only 2 failures (`PortableMemoryPrivacyReview`, `SkillInstallationLifecycle`) reproduce identically on the pre-R7-04-HEAD baseline — pre-existing, unrelated to this change (their full-suite flakes in other files rebased away on rerun). |
| `yarn test:components` | **165 files / 1,370 tests passed.** |
| `yarn typecheck` / `yarn vue-typecheck` | Passed (26.17 s / 46.57 s). |
| E2E after `yarn build:e2e` | **179 passed / 2 skipped, 0 failures (29.1 min).** |

### Decision on restore validation (recorded)

The first implementation validated the pointer against the boot-time sidebar projection and was shown to **drop valid pointers** exactly because of R7-04 (instrumented evidence: `[absence check 0 [] null]`). The committed design therefore treats the snapshot as the validator. Deleted conversations: `loadHistoryPage` returns an empty page for unknown ids, so a deleted selection hydrates as an empty idle transcript; it does not error and does not start a run. Durable summary rows reconcile at the next process start (`backfillProjections`). This is an honest limitation recorded under R7-04 instead of a hidden failure.

### Final-revision gates

| Check | Result (final revision, HEAD `4d6347963`) |
| --- | --- |
| `yarn test:components` | **165 files / 1,370 tests passed** (adds 6 restore-pointer tests + 1 layout restore-contract test). |
| Targeted main suite | **17 files / 160 tests passed**. |
| `yarn typecheck` | Passed (26.19 s; hook rerun 28.75 s). |
| `yarn vue-typecheck` | Passed (41.63 s; hook rerun 45.02 s). |
| Full Electron E2E (`xvfb-run -a yarn test:e2e`) | **179 passed / 2 skipped, 0 failures (26.6 min)**. Skips: the live-provider case inside the reload describe (owns its LIVE_AI gate) and one other standing live-gate; the deterministic mid-run reload test ran in the ordinary gate. |
| Workspace-shell spec targeted (`xvfb-run … yarn playwright test test/e2e/specs/workspace-shell.test.ts`) | **9 passed / 1 skipped (44.4 s)**. |

Log: `/tmp/opencode/parity-r7-final-e2e.log`. Debug instrumentation used during the R7-04 investigation was reverted before the gates (`git diff` on `src/modules/AIChatConversationModule.ts` and `src/model/AIChatConversation.model.ts` is empty at HEAD). E2E bundle rebuilt from clean sources before the full run (`yarn build:e2e`). The untracked `...audit-todo-2026-10-20.md` remains preserved, uncommitted.

### Remaining work (unchanged from the audit body)

V01 real speech-runtime certification, V02 manual AT/platform/browser/accessibility evidence (the final gate rerun part of V02 is now supplied above) and V03 soak/sign-off remain open **as the only remaining items — R7-04 is fixed (see its fix record and the addendum)**. Six-language parity: no user-facing text was added in this fix round (pointer persistence is invisible; restore reuses existing surfaces; the R7-04 projection coupling is renderer-invisible), so no `src/views/lang/` change is required.
