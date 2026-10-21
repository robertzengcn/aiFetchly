# Workspace capability parity — re-audit R7 and remaining TODO

Audit date: 2026-10-22. Reviewed HEAD: `0b6c04836`, branch `workspace-v2-capability-parity`, worktree `workspace-parity`.

Authorities: [PRD](./ai-chat-workspace-v2-capability-parity-prd.md), [technical design](./ai-chat-workspace-v2-capability-parity-technical-design.md), and [R6 report with fix/certification addenda](./ai-chat-workspace-v2-capability-parity-audit-todo-2026-10-21-r6.md).

**Verdict: not complete.** The original R6-01/02/03 cases are addressed and the deterministic voice journey now passes. This review reproduced **two additional code defects through three focused checks** and rechecked the already-open reload-preservation issue. Remaining real-runtime, accessibility/browser and soak evidence is listed separately. This is an incremental audit of the updated implementation and adjacent failure paths, not an exhaustive security review of the entire application.

No application fixes were applied. Only this report is intended for commit. The earlier untracked `...audit-todo-2026-10-20.md` was left untouched.

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

- [ ] Give the deferred detail-event buffer and its cleanup immutable selection ownership; a superseded request must never clear or disable the current selection's buffer.
- **Requirements:** FR-LIF-002/004, FR-REC-008; technical design §9.3 reconstruction and selected-generation isolation.
- **Location:** `src/views/store/selectedConversation.ts:1060–1063` detects a superseded snapshot but then calls `clearDeferredDetailEvents()` on the shared current buffer. The catch block at :1109–1112 also clears that buffer and disables deferral **before** checking generation. Current-generation replay uses the same variables at :1095–1099.
- **Reproduce:** Start loading A and hold its reply. Start loading B and hold its reply. Deliver B's `complete` detail event with final content while B is loading. Resolve **or reject** A's old request, then resolve B's snapshot containing earlier partial text and `runtimeStatus: 'running'`.
- **Observed:** Both focused variants produce **`{ content: 'partial', status: 'running' }`**, expected **`{ content: 'B completed while loading', status: 'idle' }`**. B's valid terminal was buffered, then discarded by A's cleanup. The generation check successfully excludes A's snapshot itself, but does not protect B's buffer.
- **Impact:** Quickly switching between chats during slow IPC can leave the selected chat showing stale text and running state after its actual completion. Disabling deferral also allows subsequent current-chat events to apply before its snapshot and be overwritten by the seed. This reproduces lost renderer projection, not loss of the durable database message or cancellation of the main-process run.
- **Fix detail:** Store a buffer per selection token, or guard every cleanup/enable/disable/replay operation with the owning token. Treat stale success and stale rejection identically. Do not solve this only by removing the success-path cleanup while leaving the catch unconditional. Keep teardown and null selection explicit.
- **Done when:** Permanent tests cover stale success/rejection, A→B→A, three overlapping loads, buffered terminal/token/permission events, and teardown. Only the current generation may mutate its buffer; each current event is replayed once after the correct snapshot and the final content/runtime state is accurate.

### R7-02 — P2: recreating an evicted content row overwrites the logical accumulator

- [ ] Reuse an existing active-turn accumulator when a row is absent; initialize empty content only for a genuinely new logical message.
- **Requirements:** FR-HIS-001/005, PRD §19, technical design §17; the R6 content-preserving overflow contract.
- **Location:** `src/views/utils/workspaceStreamPresenter.ts:400–421` preserves the accumulator for an existing mounted row. But when the row is absent, :424–431 unconditionally executes `activeTurnAccumulator.set(messageId, { content: '', reasoning: '' })` before appending. The last-pass eviction at :1157–1160 deliberately permits content-bearing rows to leave the mounted window on the premise that the accumulator survives.
- **Reproduce:** Start answer-0 and stream `prefix `; verify it rendered. Stream 200 additional distinct content-bearing answer IDs within that same run, reaching the protected-content overflow case. Flush and verify answer-0 is evicted while mounted rows remain ≤200. Resume answer-0 with `suffix`.
- **Observed:** The reconstructed answer contains **`suffix`**, expected **`prefix suffix`**. The saved accumulator is erased in `ensureAssistantView()` before the next delta or `materializeFromAccumulator()` can recover it.
- **Scope:** This is a renderer stress/contract reproduction for more protected content rows than the mount limit. It does not establish that typical providers emit 201 answer IDs per turn or that this workload occurs frequently. It specifically exercises the fallback that the new implementation documents as supported; the original 100 tool-pair case evicts lower-priority tool receipts and therefore misses it.
- **Fix detail:** Materialize from the existing logical content before resuming, preserving reasoning as well as text. Keep the logical accumulator bounded/lifetime-scoped independently of the rendered row limit, and define overflow behavior if logical content itself exceeds policy. Do not trade the failure for an unlimited mounted transcript.
- **Done when:** Preserve text and reasoning across content-bearing overflow in both paging directions, then continue with more deltas, completion, error and cancellation. Include hydrated and new rows; assert row bounds throughout. Tests should exercise actual protected-content eviction, not just append many discardable tool receipts.

### R7-03 — P1: reload does not restore the active conversation; its deterministic test is hidden by a live-provider skip

- [ ] Restore the selected conversation and reconnect its surviving run after renderer reload/crash recovery.
- [ ] Move the LIVE_AI skip into the actual live-provider test so the deterministic reload test runs in every ordinary gate invocation.
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
| FR-REC-001–008 | Original runtime hydration fixed; event-buffer ownership and reload continuation still fail (R7-01/03). |
| FR-LIF-001–006 | R7-01 current-generation buffer isolation and R7-03 renderer restore remain open. |
| FR-SKL-001–006 | Installation/approval/invocation retained; final integration/accessibility checks remain. |
| FR-BRW-001–006 | Managed-browser surfaces retained; authenticated V02 lifecycle evidence remains. |
| FR-HIS-001–005 | Original row/adoption/eviction cases fixed; protected-content overflow fallback still resets text (R7-02). |
| FR-INT-001–005 | Shared integrations retained; final cross-feature regression pending. |
| PRD §14/18/19 security/failure/resources | No fresh full security certification; findings prove renderer state/content failures, not a DB-loss or authorization-bypass claim. |
| A11Y-001–010 / localization | Existing automated subset retained; V02 evidence and final locale checks still required. |
| PRD §20 observability | Earlier timing/count fixes retained; targeted tests pass; no new telemetry defect reproduced. |
| PRD §21–28 / design exit gates | V01 real runtime, V02 residual certification, V03 soak/sign-off and code defects remain; Definition of Done is not met. |

## Suggested order

1. Fix R7-01 event-buffer ownership and R7-03 reload/skip placement.
2. Fix R7-02 accumulator reuse without weakening the mounted bound.
3. Add permanent regressions for all focused failures, repeat affected gates and complete V01/V02 on the final revision.
4. Collect V03 before declaring parity complete or removing rollback.
