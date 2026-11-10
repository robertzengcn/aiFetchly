# Workspace capability parity — re-audit R5 and remaining TODO

Audit date: 2026-10-21. Reviewed HEAD: `810b3c0ea`, branch `workspace-v2-capability-parity`, worktree `workspace-parity`.

Authorities: [PRD](./ai-chat-workspace-v2-capability-parity-prd.md), [technical design](./ai-chat-workspace-v2-capability-parity-technical-design.md), and [previous R4 report](./ai-chat-workspace-v2-capability-parity-audit-todo-2026-10-21-r4.md).

**Verdict: R5 code fixes complete; release certification V01–V03 still open.** The three findings below were reproduced by the audit and are now fixed and committed on this branch: `8bd84ae5f` (R5-01), `f583dc36d` (R5-02), `a2e2550e1` (R5-03), plus coverage `e6eb8cf23`. Fresh gates on the fixed HEAD: 161 files / 1,337 component tests, targeted main 17 files / 160 tests, and both typechecks pass (see "Verification after the R5 fixes"). Definition of Done is not met until V01–V03 evidence is recorded. The original audit observations below are retained verbatim as the record of what was reproduced.

This was an incremental source and test audit. No application code was changed. Only this new report is intended for commit; the pre-existing untracked `...audit-todo-2026-10-20.md` was left untouched.

## Verification on the reviewed revision

| Check | Result |
| --- | --- |
| `yarn test:components` | **161 files / 1,326 tests passed** before temporary audit fixtures were added. |
| Targeted main-process tests, command below | **17 files / 160 tests passed**. |
| `yarn typecheck` | Passed, 24.34 seconds. |
| `yarn vue-typecheck` | Passed, 37.89 seconds. |
| Focused `AUDIT_R5` checks | **Four assertions failed**, reproducing the three findings below; nine inherited tests filtered out. |
| Full Electron E2E, full module/main suite, live speech/browser, manual accessibility, production soak | Not run in this audit. Prior results are historical, not certification of this HEAD. |

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

The internal duplicate typecheck was explicitly skipped; standalone typechecks are recorded above. Logs: `/tmp/parity-r5-{components,main,typecheck,vue,repro}.log`.

The focused checks use the real selected store and presenter with controlled IPC responses and detail events, based on `selectedConversation.historyWindow.test.ts`. The temporary file was removed from the repository and retained locally at `/tmp/auditR5.test.ts`. To reproduce, copy it to `test/vitest/main/components/store/auditR5.test.ts` and run `yarn test:components auditR5 -t AUDIT_R5`. These are assertion failures, not compilation/setup failures. The final token tests wait past the presenter's 50 ms flush window; an initial shorter wait was corrected before recording these results. Temporary files are not permanent regression coverage or portable release evidence.

## Verification after the R5 fixes (2026-10-21)

| Check | Result |
| --- | --- |
| `yarn test:components` | **161 files / 1,337 tests passed** (11 new regressions added by the R5 fixes). Log: `/tmp/parity-r5-fix-components.log`. |
| Targeted main command above | **17 files / 160 tests passed.** Log: `/tmp/parity-r5-main.log`. |
| `yarn typecheck` | Passed, 24.14 seconds. Log: `/tmp/parity-r5-fix-typecheck.log`. |
| `yarn vue-typecheck` | Passed, 40.54 seconds. Log: `/tmp/parity-r5-fix-vue-typecheck.log`. |
| Focused `AUDIT_R5` checks | No longer reproduce on the fixed HEAD; all four formerly failing assertions are covered by the permanent tests named in the fix reconciliation. The audit fixture remains local at `/tmp/auditR5.test.ts` (not committed). |
| Full Electron E2E, full module/main suite, live speech/browser, manual accessibility, production soak | Still not run; these belong to V01–V03 below. |

## R5 fix reconciliation

| R5 item | What is now implemented | Assessment |
| --- | --- | --- |
| R5-01: paging evicts the active answer | `8bd84ae5f`: presenter pins the active projection (`pinnedRowIds`) — rows pin while `streamStatus === "streaming"` (optimistic user rows never pin), pin-aware `trimToWindow` retain-oldest skips pinned rows, pins clear at complete/error/cancelled terminals and on `seedHistory`/`dispose`, and the `complete` handler materializes an absent row from `fullContent` (including generated images) before updating | Both audit reproductions pass as permanent store tests. The component flow pages through the real Load-older control mid-stream and lands `prefix suffix` then the authoritative full answer. Reasoning, tool and action rows share the same pinning path; the 200-row bound is preserved rather than disabled. |
| R5-02: live appends bypass the bound | `f583dc36d`: `syncFromPresenter` centralizes the bound — when messages exceed `MAX_MOUNTED_MESSAGES` (200) it calls `presenter.trimToWindow(200, {retain: "newest"})`, re-arms `nextBeforeCursor` from the new front row and sets `hasOlder = true`, so rows evicted by live growth stay reachable via Load older (dedup guards refetch; availability self-corrects on exhaustion) | Live start/tokens/complete stay bounded with the active answer and tool rows retained; evicted history recovers through the re-armed cursor. Regressions assert bound + tool-heavy output + final-response content, not just row counts. |
| R5-03: new selection inherits the old cursor | `a2e2550e1`: `loadSelection` resets `nextBeforeCursor = null` and `hasOlder = false` at selection start (including null selections; the snapshot re-establishes both) and `loadOlder` refuses to page while `loading` | No request with a foreign cursor across delayed, failed, null and A→B→A flows; each switch pages only with the live selection's own cursor; visible disabled/loading state covered by the component test. |

## R4 fix reconciliation

| R4 item | What is now implemented | Assessment |
| --- | --- | --- |
| R4-01: stale A page applied in B | `olderLoadSeq` and selection-generation checks discard stale responses and isolate loading flags | Original in-flight-A-response case addressed; permanent tests pass. Starting a new page while B's snapshot is loading still uses A's cursor: R5-03. |
| R4-02: microphone leak on recorder setup failure | `start()` wraps post-acquisition setup and rolls back tracks, callbacks, timer and state on error | Original failure cases addressed; recorder regression suite passes. No new microphone defect established in this pass. |
| R4-03: batched image cleanup loses resolutions | App-scoped synchronous listener receives each resolution; replay history is bounded | Original burst case addressed; resolution/component tests pass. |
| R4-04: backward paging throws away fetched rows | Backward paging retains oldest rows and preserves server exhaustion | Original page-retention/exhaustion case addressed. Evicting the live response corrupts its projection (R5-01), while live appends still exceed the bound (R5-02). |
| Earlier R01–R06 / D01–D02 fixes | Voice owner, source identities, retry digests, telemetry deltas and click timing remain present | Existing relevant suites pass. No new regression established for those contracts here. |

## Bugs and required tasks

### R5-01 — P1: backward paging evicts the active answer and loses its streamed content

- [x] Preserve active response state independently of history-window eviction and ensure final response events can still materialize the answer. **FIXED (2026-10-21), commits `8bd84ae5f` + coverage `e6eb8cf23`:** presenter pinning + pin-aware trimming + `fullContent` materialization (see reconciliation table). Permanent tests: "does not lose the response prefix when history paging evicts the active row", "retains a completed answer evicted during history paging"; component flow "streaming answer survives paging (audit R5-01)".
- **Requirements:** FR-HIS-001/005; PRD §19 and technical design §17 bounded transcript/paging; selected live-response correctness.
- **Location:** `src/views/store/selectedConversation.ts:1096–1118` prepends history then retains the oldest 200 rows. `src/views/utils/workspaceStreamPresenter.ts:867–879` can remove the newest active assistant row while leaving its run/message state active. `ensureAssistantView()` at :289–305 recreates a missing row with **empty** content. The `complete` handler at :629–656 only updates a row if it already exists.
- **Reproduction A — prefix loss:** Seed 199 historical rows; start `live-answer`; send token `prefix ` and wait for projection. Load one older row so the active answer is evicted. Send token `suffix` and flush.
- **Observed A:** The recreated response contains **`suffix`**, expected **`prefix suffix`**. The prefix assertion succeeds before paging; the failure is after eviction and the next token.
- **Reproduction B — missing final answer:** Seed 199 rows; start `live-answer`; load one older row; deliver `complete` with `fullContent: 'complete authoritative answer'`, without an intervening token that recreates the row.
- **Observed B:** The answer is **absent** (`undefined`) even after an authoritative full-content completion. The run settles but there is no row to update.
- **Impact:** Loading older history during a response can truncate the displayed answer or hide the completed answer entirely. This is a renderer projection defect; the reproduction does not establish loss of the durable database message. Reselection can reload persisted content, but should not be necessary to recover a live answer.
- **Why current tests miss it:** The new R4 history test starts a new response **after** eviction. It does not evict an already-streaming response and then deliver further tokens or completion. Its return-to-tail check manually switches away and back.
- **Fix detail:** Pin the active projection or retain complete run content outside the mounted history window. Paging direction and live-tail state need explicit ownership; evicting a rendered row must not erase the accumulator used by future deltas. Handle final content even if its row is off-window, and provide an intentional way back to the current answer. Do not solve this by disabling the size bound.
- **Done when:** Both reproductions pass, including reasoning, tool/action rows and complete/error/cancel paths. Preserve fetched older content, stable scroll/navigation, full response text and the 200-row bound together. Add a component/E2E flow that pages while a response is in progress and returns to its final answer.

### R5-02 — P2: the 200-message bound is not enforced on live appends

- [x] Apply a bounded window policy to all growth paths, including live assistant/user/tool rows, while preserving the active response state described in R5-01. **FIXED (2026-10-21), commit `f583dc36d` + coverage `e6eb8cf23`:** centralized bound in `syncFromPresenter` with cursor/availability re-arming. Permanent tests: "a live response start enforces the 200-row bound synchronously", "rows evicted by live growth stay reachable through a re-armed cursor and availability", "tool-heavy live output stays bounded while the active response and final answer survive" (asserts the final-response content, not just row counts), plus the refined R4-04 live-eviction test.
- **Requirements:** FR-HIS-001/005, PRD §19, technical design §17: selected transcript bounded at 200 mounted messages.
- **Location:** `workspaceStreamPresenter.ts:246–250` appends without trimming. Store `evictBeyondWindow()` is called by `loadOlder()` only. `AiChatCenterSurface.vue:87` passes the full store message list to `AiChatWorkspaceTranscript.vue`, whose projection iterates that list without an ordinary-message window cap.
- **Reproduce:** Seed 200 ordinary user messages through the selection snapshot; deliver one real `start` detail event for a new assistant response.
- **Observed:** Store message count becomes **201**, expected ≤200. Ordinary user rows plus the assistant row are not collapsed tool groups. Further distinct live messages keep accumulating until another explicit paging operation or reselection.
- **Impact:** Long selected conversations progressively expand the mounted transcript and immutable message-update cost. The newest R4 test explicitly verifies the appended live row, but never checks the count after that append. No performance benchmark was run; the established failure is the violated size contract, not a measured latency number.
- **Fix detail:** Centralize window management for history, optimistic sends and streamed appends. If live growth evicts older rows, retain a valid cursor/availability state for loading those rows again. Simply slicing the renderer array is insufficient if the underlying presenter still grows or active/decision state is discarded.
- **Done when:** Stream/send beyond 200 messages without reselection and assert bounded store and mounted ordinary rows. Test tool-heavy output, paging mode, recovery/plan/permission cards, retained active content and access to evicted history. Include a final-response check, not only a row-count assertion.

### R5-03 — P2: loading a new conversation exposes the previous conversation's history cursor

- [x] Clear/invalidate paging state at selection start and refuse Load older until the current selection snapshot has established its own cursor. **FIXED (2026-10-21), commit `a2e2550e1` + coverage `e6eb8cf23`:** `loadSelection` nulls the cursor/availability up front and `loadOlder` refuses while loading. Permanent tests: "loadOlder refuses to page with the previous selection's cursor while a snapshot is pending", "a failed selection leaves no usable cursor behind", "deselection immediately invalidates paging and nothing can fire afterwards", "A→B→A recovers each switch against the live selection's own paging state"; component: "load-older visible states (audit R5-03)".
- **Requirements:** FR-HIS-001 and FR-LIF-002 selection isolation; PRD lifecycle/paging contracts.
- **Location:** `selectedConversation.ts:969–1006` resets the paging operation token/flag, but keeps `nextBeforeCursor` and `hasOlder` for a non-null selection until the awaited snapshot returns. `loadOlder()` at :1074–1085 checks neither `loading` nor whether the cursor belongs to this selection. `AiChatCenterSurface.vue:115–122` renders Load older independently of the loading paragraph and disables it only for `loadingOlder`.
- **Reproduce:** Select A with `cursor-a` and `hasOlder: true`. Begin selecting B and defer its snapshot. Invoke the still-available Load older action before B's snapshot completes.
- **Observed:** The actual API call is **`loadHistoryPage('conv-b', 50, cursor-a)`**. The focused assertion expects no history request before B is ready and fails with that call.
- **Impact:** B's history is requested using A's timestamp/message boundary. Results can skip the intended range or race with B's snapshot and corrupt its cursor/availability. The new generation guard accepts this page because it was started in B's generation. This is not the old stale-A-response bug and does not prove A's content is returned by main: main still queries the requested conversation.
- **Fix detail:** Reset cursor and availability immediately on selection change; bind each cursor to its conversation and generation. Reject paging during loading/error/uninitialized state and disable/hide its control accordingly. Ensure a snapshot failure does not leave a usable cursor from the prior selection.
- **Done when:** Test delayed and rejected B snapshots, A→B→A, null selection, and a page racing the snapshot. Assert no request uses an old cursor, current availability/loading flags are correct, and B can page with its own cursor after initialization. Add the visible disabled/loading-state component test.

## Remaining certification tasks

### V01 — Successful voice journey

- [ ] Run default-route record → successful transcription → draft merge → auto-send → spoken response with a deterministic runtime stand-in, plus a separately documented configured real-runtime check.
- **Evidence:** `test/e2e/specs/aiChatVoiceParity.test.ts:7–13` still explicitly covers absent speech runtime/models. Positive worker/component tests are useful but do not establish the complete successful default-route journey. No E2E specs changed in the R4 fixes.
- **Done when:** Verify one accepted send, correct draft/file ownership, configured playback policy, safe selection/stop behavior and preserved draft after failure. State which parts used mocks versus real audio. FR-VOI-001–010; PRD §17.8/22/23.

### V02 — Accessibility, authenticated browser, final regression and locale gates

- [ ] Certify critical keyboard paths, focus entry/trap/return, one-time announcements and inactive-conversation focus isolation.
- [ ] Record narrow-width and 200% operation, reduced motion, platform and assistive technology. Automated accessibility checks remain a subset.
- [ ] Exercise authenticated managed-browser start → handoff/approval → verify → resume → stop, plus expiry, stale actions and route return; distinguish fixture coverage from live-account evidence.
- [ ] After fixes, run both typechecks, components, affected main/module suites and full Electron E2E. Record failures/skips explicitly and verify six-language parity for any new UI text.
- **Evidence:** These release gaps were already open in R4; reviewed commits add code/unit fixes and checked boxes, not the missing runtime/manual evidence. This audit's normal unit gates are fresh, but its E2E/manual gates were not executed. Requirements: A11Y-001–010, FR-BRW-001–006, PRD §22/28.

### V03 — Soak, incident evidence and sign-off

- [ ] Attach technical design AD-009's rolling 14-day default-route soak with ≥500 accepted submissions, acceptance ≥99.5% excluding deliberate validation/entitlement rejects, and restart recovery ≥99% for exercised cases.
- [ ] Close severity-1/2 parity defects and record zero confirmed duplicate delivery, duplicate continuation, cross-conversation event or authorization-bypass incidents. Obtain required product, safety, desktop and QA sign-offs.
- [ ] Retain working Chat V2 rollback until the separate removal decision; low sample volume extends the soak.
- **Evidence:** No new soak/sign-off artifacts appear in the reviewed changes. Passing unit tests and ticking earlier findings do not satisfy these exit gates. PRD §21/24/28 and design AD-009.

## Requirement coverage disposition

This incremental review rechecked the changed implementation and adjacent failure paths. The remaining capability families retain their previously mapped implementations; that is not a fresh manual/security certification of every acceptance case. The worktree's owner-approved extraction deferral remains valid, so missing proposed filenames alone are not new blockers.

| Requirement family | Current disposition |
| --- | --- |
| FR-SUB-001–009 | Payload, acceptance and retry identity present; normal suites pass. Live appends honor the bound (R5-02 fix). |
| FR-CMD-001–009 | Shared command/goal/loop/skill routing retained; final E2E pending. |
| FR-QUE-001–014 | Durable pending/run source identity, cancellation and steering fixes retained; targeted suites pass. |
| FR-PLN-001–009 | Strict decision/continuation paths retained; targeted IPC tests pass. Plan/permission cards ride the same pinned projection (R5-01/02 fixes). |
| FR-PER-001–008 | Permission and parked continuation surfaces retained; final runtime/accessibility certification pending. |
| FR-OUT-001–010 | Frozen authorization and dedicated review retained; final delivery/safety certification pending. |
| FR-IMG-001–015 | Synchronous app-scoped resolution now fixes R4 bursts; normal image/component tests pass. |
| FR-RPT-001–009 | Per-output and conversation reporting retained; no new reporting defect reproduced. |
| FR-VOI-001–010 | Setup rollback and earlier owner fixes present; recorder/component tests pass; V01 remains. |
| FR-WSP-001–010 | Workspace/trust/watcher/memory paths retained; platform/runtime certification pending. |
| FR-REC-001–008 | Recovery/retry/compaction surfaces retained; active/final response state survives paging (R5-01 fix). |
| FR-LIF-001–006 | Old-page generation guards work; paging state now resets per selection and refuses stale actions (R5-03 fix). |
| FR-SKL-001–006 | Skill installation/approval/invocation paths retained; final integration gates pending. |
| FR-BRW-001–006 | Managed-browser surfaces retained; authenticated V02 journey pending. |
| FR-HIS-001–005 | Backward retention/exhaustion, active-answer pinning, live-growth bound and cursor isolation all fixed (R5-01–03 fixes); fresh suites pass. |
| FR-INT-001–005 | Shared integrations retained; final cross-feature regression pending. |
| PRD §14/18/19 security, failure and resources | No full security certification performed; live window/cursor defects fixed (R5-01–03 fixes). Recorder rollback tests pass. |
| A11Y-001–010 and localization | Normal automated suite passes; V02 manual and final locale evidence remain. |
| PRD §20 observability | Prior click-boundary and cumulative-count fixes retained; targeted tests pass. No new telemetry defect reproduced. |
| PRD §21–28 / design exit gates | V01–V03 remain; Definition of Done is not met. |

## Suggested order

1. Resolve R5-01 and R5-02 together through one coherent history/live-window policy. — **Done (2026-10-21, `8bd84ae5f` + `f583dc36d`).**
2. Fix R5-03's initialization guard and corresponding UI state. — **Done (2026-10-21, `a2e2550e1`).**
3. Add permanent regressions for all four focused failures, then complete V01/V02 on the final revision. — **Regressions done (`e6eb8cf23`); V01/V02 next on this HEAD.**
4. Collect V03 before declaring parity complete or removing Chat V2 rollback. — **Open.**
