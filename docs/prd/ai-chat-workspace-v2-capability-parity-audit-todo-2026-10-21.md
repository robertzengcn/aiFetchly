# Workspace capability parity — implementation re-audit and TODO

Audit date: 2026-10-21. Reviewed HEAD: `4deff51e3` (`workspace-v2-capability-parity`, worktree `workspace-parity`).

Authorities: [PRD](./ai-chat-workspace-v2-capability-parity-prd.md) and [technical design](./ai-chat-workspace-v2-capability-parity-technical-design.md). Previous findings: [2026-10-20 R2 audit](./ai-chat-workspace-v2-capability-parity-audit-todo-2026-10-20-r2.md).

**Verdict: not complete.** The latest commits implement fixes for the earlier R2 findings, but several fixes still fail at lifecycle and event-order boundaries. This audit identifies **six remaining correctness issues, reproduced by seven focused failing checks**, plus an observability contract gap and outstanding release evidence. The normal test suites passing does not cover these additional cases.

This is a documentation-only audit. No production fixes were applied. P1 denotes high-priority privacy/ownership risk; P2 denotes functional or measurement correctness. Source line references refer to the reviewed HEAD. “Present” in the coverage matrix means reachable code and identified coverage, not certification of every acceptance case.

## Verification and scope

| Check | Result |
| --- | --- |
| `yarn typecheck` | Passed on the reviewed application baseline, 25.39 seconds. |
| `yarn test:components` | **158 files, 1,290 tests passed** before adding temporary audit cases. |
| Targeted main tests: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/aiChatWorkspace test/vitest/main/browserVoiceRecorder.test.ts test/vitest/main/aiChatPlanDecisionIpc.test.ts test/vitest/main/aiChatRendererMetricsIpc.test.ts` | **15 files, 115 tests passed**. Separate typecheck passed; duplicate internal typechecking was explicitly skipped. |
| Focused component reproductions: `yarn test:components audit3 -t AUDIT3` | **5 assertions failed**, covering R01, both R03 cases, R04 and R05. |
| Focused main reproductions: `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/audit3Recorder.test.ts test/vitest/main/audit3Metrics.test.ts -t AUDIT3` | **2 assertions failed**, covering R02 and R06. |
| `yarn vue-typecheck` | Passed after removing temporary audit fixtures, 41.54 seconds. An earlier overlapping run caught an invalid type in an audit fixture; this was corrected and was not an application defect. |
| Full main/module suite, full Electron E2E, live microphone/browser, cross-platform and manual accessibility | Not rerun in this audit. The R2 outcome record reports 176 passed / 3 skipped Electron tests and explains main-suite failures; those are historical results, not a new result here. |

The worktree had no source modifications or merge conflicts on entry. The earlier `...audit-todo-2026-10-20.md` was already untracked and was left untouched. Only this new report is intended for commit.

Logs: `/tmp/workspace-parity-audit-2026-10-21-{components,typecheck,vue-final,main,repro-components,repro-main}.log`.
Reproduction fixtures were removed from the worktree and retained as `/tmp/audit3{Voice,Center,Identity,Recorder,Metrics}.test.ts`. The first two belong under `test/vitest/main/components/`, Identity under its `store/` subdirectory, and Recorder/Metrics under `test/vitest/main/`. Copy them there temporarily to run the commands above. These assertions intentionally fail until the defects are fixed. They use actual component/store/recorder/counter logic with mocked transport and media dependencies; they are not physical-microphone or real-provider demonstrations. Preserve permanent regression tests in the fixes; temporary files are not release evidence.

## Reconciliation of the R2 fixes

| R2 item | Updated implementation | Assessment |
| --- | --- | --- |
| N01: recording owner captured too late | Voice session owner is now captured before `start()` | Original start-in-A/stop-in-B case is fixed. Acceptance still reads a mutable session owner: R01. |
| N02/N03: background voice acceptance and transcription-time typing | Origin-store consumption and immediate pre-append text baseline added | Earlier exact reproductions are addressed. R01 exposes a later overlapping-session window. |
| N04: image cleanup based on independent counters | Accepted-run ledger, summary subscription, app-scoped reference-clear registry added | Happy-path background resolution works, but event ordering/idempotence and unmounted consumption remain incomplete: R03/R04. |
| N05: recording cap drops result | `onAutoStop` now enters the shared transcription path | Present; prior cap result-routing defect addressed. |
| N06: microphone lifetime | Composer now invokes recorder `dispose()` on unmount | Active capture cleanup exists; disposal during pending microphone acquisition still fails: R02. |
| N07: strict plan IPC | Bounded strict decision schemas and safe parse responses added | Present; targeted plan IPC tests pass. No new plan-schema defect established. |
| G01: observation endpoints/consumer | Real continuation-acceptance timing, workspace selection timing and metrics bridge added; queue-only latency renamed | Improved. Cumulative aggregation is incorrect: R06. Full click-to-acceptance measurement remains a scope gap: G01 below. |
| G02: inert orchestration flag | Flag now hides goal/loop presentation while command interception remains active | Defined safe presentation effect exists. Do not restore raw command submission. |
| V01–V03 | Updated R2 record still explicitly leaves successful voice, manual accessibility/browser and soak evidence open | Remain open; engineering gate history alone does not close them. |

## Remaining bugs

### R01 — P1: a new voice session changes the owner used by an older acceptance callback

- [ ] Capture immutable session identity in every voice callback; compare selection against that callback's owner, not the latest session's global owner.
- **Requirements:** FR-SUB-002/007, FR-VOI-010, FR-LIF-002; PRD §14 conversation privacy.
- **Evidence:** `src/views/components/aiChatV2/AiChatV2Composer.vue:708–712` defines `stillOwnsComposition()` against mutable `voiceSessionOwnerDraftKey`. `onMicClick` changes it for every Start at :1068. The acceptance closure at :978–1001 calls that global predicate even though it has a captured `voiceOwnerDraftKey` available.
- **Reproduce:** Auto-send voice text `same words` in A; defer acceptance. Switch to B, type `same words`, and start another recording. Resolve A's acceptance while B's session is current.
- **Actual:** B's typed draft is cleared. The focused test expects `same words`, receives `''`. The closure considers B the owner because B is the latest voice session; with matching draft text it restores A's earlier baseline into B. Matching text is required for the demonstrated visible overwrite; even without a match, the incorrect branch can skip A's stored-draft consumption.
- **Impact:** Cross-conversation draft loss or substitution; already-submitted A content may remain in its stored draft.
- **Done when:** Test overlapping sessions and delayed acceptance across A→B and A→B→A, including identical text/files, differing drafts, unmount and duplicate callbacks. Use an immutable owner/session token for both store and visible mutations.

### R02 — P1: a disposed recorder can acquire the microphone and start recording later

- [ ] Invalidate pending acquisition on dispose and stop any stream returned to a stale/disposed session before creating or starting a recorder.
- **Requirements:** FR-VOI-003/010, FR-LIF-002; PRD §14 privacy and §19 resource ownership; prior R2 N06.
- **Evidence:** `src/views/components/aiChatV2/voice/BrowserVoiceRecorder.ts:123–132` awaits `getUserMedia`, then unconditionally assigns its stream and constructs a recorder. `dispose()` at :190–198 clears only currently assigned resources; there is no disposed/acquisition-generation check after the await. Composer unmount calls `dispose()` at `AiChatV2Composer.vue:1205–1207`, but that cannot stop a stream that has not arrived yet.
- **Reproduce:** Start with deferred `getUserMedia`; dispose the recorder; resolve acquisition with an injected media stream.
- **Actual:** `recordingState` becomes `recording`, not `idle`; capture starts after disposal. The focused test uses the real recorder with a fake media factory and cleans it up afterward.
- **Impact:** Navigating away during the browser permission prompt can start microphone capture after the owning composer is gone, potentially continuing until the duration timer.
- **Done when:** Test disposal before/during acquisition, active recording, pending Stop and rapid duplicate Starts. Stale streams have their tracks stopped, timers are not armed, and callbacks cannot revive an obsolete session. Handle acquisition failure and cancelled Stop promises deliberately.

### R03 — P2: the “durable identity” image ledger still binds runs by FIFO guesses and drops early events

- [ ] Carry the authoritative pending/source identity into the run fact or reconcile it from main; buffer early facts and make binding/resolution idempotent by actual identity.
- **Requirements:** FR-SUB-006, FR-QUE-006/012/013, FR-IMG-002/015, FR-LIF-004; AD-002/003/005.
- **Evidence:** `src/views/store/selectedConversation.ts:404–417` binds `run_started` to the first unresolved/unbound entry, without checking whether that run ID is already bound. `registerAcceptedRun` is called only after `await startChatRun` at :767. `handleSummaryFact` has no early-event buffer. Every ordinary workspace receipt is a pending marker, so matching the pending identity to the real run matters on idle as well as busy sends.
- **Reproduction A — ordering:** Hold the submission reply, deliver `run_started(real-1)`, then resolve the reply as `pending-p1` and deliver `run_completed(real-1)`. **Actual:** no resolution is published; expected ordinal 1 is undefined. The queue's `scheduleDrain()` is asynchronous and does not define a renderer receipt-before-event ordering contract.
- **Reproduction B — replay:** Accept p1 and p2; deliver `run_started(real-1)` twice. Both entries become bound to real-1. Deliver its terminal twice. **Actual:** the second resolution consumes ordinal 2 even though p2 has not completed. The focused test expects the resolution to remain ordinal 1 and receives 2.
- **Impact:** The next image draft can be cleared by another run, or completed references can remain indefinitely. Cancelled/steered pending entries and starts belonging to other execution owners are additional reasons FIFO order cannot stand in for an identity mapping; those cases still need tests.
- **Done when:** Test early start/terminal, repeated start, summary+detail terminal replay, reversed acceptance replies, cancelled/steered pending rows and non-user execution owners. One run resolves only its own pending entry, once, regardless of selection or arrival order.

### R04 — P2: image cleanup is still lost when completion occurs while the center is unmounted

- [ ] Move reference-clear consumption to app-scoped orchestration, or durably queue every resolution and drain it safely when the center returns.
- **Requirements:** FR-IMG-002/015, FR-LIF-001/004; AD-005 and design §10 lifecycle ownership.
- **Evidence:** The registry now survives remount in `src/views/store/composerDrafts.ts`, but consumption remains in the component watcher at `AiChatCenterSurface.vue:1552–1578`. That watcher is destroyed on unmount and is not immediate on remount. The selected store exposes only `lastResolvedReferenceRun`, so merely making the watcher immediate would still lose multiple resolutions while away.
- **Reproduce:** With the same Pinia instance, submit image m1, unmount the center, deliver its successful summary terminal, then remount. Assert the store resolved the correct run before remount.
- **Actual:** The store has resolved `run-1`, but the tray still contains m1. The focused test expects an empty reference list and receives m1. Existing remount coverage delivers the terminal **after** remount and therefore misses this case.
- **Done when:** Test one and multiple completions while unmounted, across conversations, successful and failed runs, newer draft references and immediate completion around acceptance. Preserve failed references intentionally; consume successful snapshots exactly once without requiring a mounted transcript.

### R05 — P2: attachment bytes are excluded from retry identity

- [ ] Use a digest of normalized attachment content as part of the logical submission identity; keep bytes out of logs, but do not omit them from equality.
- **Requirements:** FR-SUB-001/003/005/006; stable submission/retry identity in design §6/§10/§25.
- **Evidence:** `selectedConversation.ts:234–255` fingerprints file name, MIME, size and kind, but omits `contentBase64`. A failed/ambiguous attempt retains that fingerprint and request ID. Main pending model deduplication at `src/model/AIChatPendingMessage.model.ts:80–94` compares conversation and displayed content, not a complete attachment/request digest despite its comment mentioning content/options.
- **Reproduce:** Send a document containing `AAA`; simulate a lost reply. Replace it with `BBB`, keeping name/type/length and prompt identical, then retry. The mock ID generator can return two different IDs.
- **Actual:** Both requests carry `req-original`; the second fresh ID is never requested. This is reproduced against the actual selected store with valid `document` attachments.
- **Impact:** A modified attachment is misclassified as a retry of the previous payload. Depending on prepared display content and whether the original committed, main may return the old intent or an idempotency conflict rather than submit the edited attachment. The reproduction proves the client collision, not a real-provider stale-document delivery.
- **Done when:** Byte-identical retry keeps identity; same-metadata/different-bytes submission rotates it. Add module/integration tests for already-committed originals, documents and images, request options, and cleanup of redundant prepared attachments.

### R06 — P2: periodic renderer snapshots count the same telemetry repeatedly

- [ ] Choose a consistent cumulative-snapshot or delta protocol with renderer/session identity, ordering and retry semantics; do not add full lifetime aggregates on every push.
- **Requirements:** PRD §20/24; design §18 observability and reliable soak evidence.
- **Evidence:** `src/views/api/aiChatRendererMetricsBridge.ts:23–29` pushes `aiChatRendererMetricsSnapshot()` every 30 seconds without resetting it or recording an acknowledgement watermark. `src/main-process/communication/aiChatRendererMetricsIpc.ts:78–95` adds each received aggregate/count into main. The renderer snapshot is cumulative for the life of its realm.
- **Reproduce:** Push the same legitimate snapshot twice: 4 timing samples, mean 12 ms, plus 9 projected-chunk counts.
- **Actual:** The main timing sample count becomes 8 instead of 4; counter merging uses the same additive approach. The focused test invokes the real registered IPC handler with mocked Electron.
- **Impact:** Quiet periods continue inflating sample counts, old observations receive repeated weight, and duplicate/unload/retry pushes distort diagnostics. This invalidates these measurements as accurate event totals; it does not imply every production metric is wrong.
- **Done when:** Test repeated snapshots, additional events, lost acknowledgements, out-of-order delivery, renderer restart and multiple windows. Totals must equal unique observations while retaining safe bounded payloads and labels.

## Remaining implementation and release tasks

### G01 — Observability contract: retain a real click-to-acceptance measure or revise the authority

- [ ] Implement the design's full submit-click → durable acceptance observation, or explicitly amend the authoritative measurement requirement to the narrower supported scope.
- **Evidence:** The latest code honestly renamed `submit_to_acceptance_ms` to `queue_submit_to_acceptance_ms` (`ai-chat-workspace-ipc.ts:535–555`), measured immediately around queue submission. Technical design §18.2 still requires “submit click to durable acceptance.” Attachment encoding, IPC and validation before that call are excluded, and no renderer-origin start measurement was found for the full journey.
- **Assessment:** The misleading name is fixed. This is a remaining scope mismatch, not a request to rename the narrower metric back. Preserve the useful queue metric and the new continuation/selection measurements.
- **Done when:** A delayed-attachment/IPC test proves the full measure includes those stages, or the PRD/design and soak dashboards agree explicitly on the reduced scope.

### V01 — Successful voice journey and newly identified failure boundaries

- [ ] Run the default-route record → successful transcription → auto-send → spoken-response journey with deterministic controlled audio/runtime services, plus a separately configured real-runtime check.
- [ ] Add permanent regression tests for R01/R02 and the image, retry and telemetry cases R03–R06 alongside the fixes; use actual integration boundaries where mocks previously hid sequencing.
- **Evidence:** `test/e2e/specs/aiChatVoiceParity.test.ts` still covers missing runtime/model and failure handling. The updated R2 outcome record explicitly leaves successful voice evidence open. This is not closed by general Electron suite pass counts.
- **Requirements:** FR-VOI-001–010; PRD §22/23; design §21.4 item 8.

### V02 — Accessibility, authenticated browser and final-state regression evidence

- [ ] Record default-route keyboard completion, focus/traps/return, one-time announcements, reduced motion, narrow/200% layouts and platform/assistive-technology scope.
- [ ] Record authenticated managed-browser start → handoff → verify → resume → stop, including expiry, stale approval and route return; distinguish deterministic fixtures from live-account checks.
- [ ] After fixes, run both typechecks, components, affected domain tests, full main suite and critical/full Electron E2E; explain remaining baseline failures and skips explicitly.
- **Evidence:** R2's 2026-10-21 outcome record still leaves manual accessibility and authenticated browser lifecycle evidence open. Existing automated subsets and past passing E2E runs are useful but do not certify these missing cases.
- **Requirements:** A11Y-001–010, FR-BRW-001–006; PRD §22/23/28 and design §16/21/26.

### V03 — Soak, incident record and owner sign-off

- [ ] Collect a rolling 14-day default-route soak with at least 500 accepted submissions, acceptance ≥99.5% excluding deliberate validation/entitlement rejects, exercised restart recovery ≥99%, and no open severity-1/2 parity defect.
- [ ] Record zero confirmed duplicate delivery, duplicate continuation, cross-conversation event or authorization-bypass incidents, plus product/safety/desktop/QA sign-off.
- [ ] Extend low-volume soak and retain functional V2 rollback until a separate removal decision. Correct R06 before interpreting the affected telemetry as valid counts.
- **Requirements:** AD-009; PRD §21/24/28; design §19/23/26. No new production-soak evidence was found; this remains a release gate rather than a code-only task.

## Requirement coverage matrix

Every functional range is included. “Present” identifies reachable code and existing tests; it does not certify all edge cases or imply an exhaustive security audit. The owner-approved workspace-authoritative/frozen-V2 exception remains valid and is not reopened.

| Requirement range / area | Assessment and current evidence | Remaining work |
| --- | --- | --- |
| FR-SUB-001–009 | Full payload, shared normalization, typed acceptance, file-only explanation and durable queue path present | R01/R05 ownership and payload identity; R03 event/receipt order |
| FR-CMD-001–009 | Registry/scope, goals, loops, approval, single expanded acceptance and origin-scoped errors present | Final-state regression; no new command defect established |
| FR-QUE-001–014 | FIFO, steering, pause/resume/recovery, run bridge and scheduler present; targeted tests pass | R03 renderer mapping must handle cancellation/steering without inferring identity from FIFO |
| FR-PLN-001–009 | Plan/question surfaces, strict decision schemas, deterministic continuation and recovery present | No new plan defect established; final-state verification |
| FR-PER-001–008 | Actionable grant/deny/persistent choice and parked continuation present | Regression gates; no bypass established here |
| FR-OUT-001–010 | Dedicated review, frozen authorization, preflight, idempotent delivery and outcomes present | Final-state delivery regression; past E2E evidence is historical |
| FR-IMG-001–015 | Tray, chooser, confirmed batch, progress/retry/stop/save present | R03/R04 stable cleanup across ordering and route lifetime |
| FR-RPT-001–009 | Single-output/conversation dialogs, capability/exclusion rules and markings present | Final-state reporting verification |
| FR-VOI-001–010 | Shared readiness/setup/playback and auto-cap transcription present | R01/R02 session/lifetime boundaries; V01 success journey |
| FR-WSP-001–010 | Workspace/trust/watcher/memory shared flows present | Final lifecycle/platform regression |
| FR-REC-001–008 | Retry/recovery/context/compaction and detail reconstruction present | Final-state checks; no new provider-recovery defect established |
| FR-LIF-001–006 | Selected detail filtering, summaries, stable conversation IDs and busy-delete protection present | R01–R04 ownership, event order and unmounted consumption |
| FR-SKL-001–006 | Install card and approvals, prompt-skill invocation and manager entry present | Final-state integration checks |
| FR-BRW-001–006 | Start/session/handoff/approval surfaces, global/account scope and hydration present | V02 authenticated lifecycle evidence |
| FR-HIS-001–005 | Opaque references, selected-context drafts, retry identity, acknowledgements and compaction present | No new archive defect established; final regression |
| FR-INT-001–005 | Portable memory/Auto Dream, workspace setup, selected-live navigation, tasks/files and reasoning present | Final integration checks |
| AD-001–004/007/010 | Durable main-process pending/run mapping and deterministic plan identity present | R03 must use that mapping correctly in renderer; preserve main invariants |
| AD-005/006/008; PRD §13 | Shared stores, semantic projections and scoped overlays present | R04 consumption still depends on mounted center; V02 focus/announcements |
| PRD §14 / design §14/25 security | Gate-first handlers, strict plan schemas and trusted authorization services present | R01 cross-conversation draft mutation; R02 stale microphone ownership; not full security certification |
| A11Y-001–010 / PRD §15 | Existing automated subset, keyboard coverage and framework integration | V02 runtime/manual completeness |
| PRD §16 localization | Six locale files and parity tests present | Translate any new fix text in all six languages; no linguistic certification performed |
| PRD §17/18/23 journeys/failures/acceptance | Broad pre-existing suites pass; seven new checks fail | R01–R06 and V01/V02 block blanket acceptance |
| PRD §19 / design §17 resources/performance | Bounded transcript, batching and summary routing present | R02 resource ownership; final performance evidence |
| PRD §20/24 / design §18 metrics | New endpoint observations and renderer bridge present | R06 counting; G01 full latency contract |
| PRD §10/11 / design §26.4 architecture | Workspace-authoritative exception reconciled in both authorities | Remaining extraction intentionally deferred, not a current blocker |
| PRD §21/22 / design §19/21/23 rollout/testing | Safe presentation rollback and test infrastructure present | V01–V03; retain command interception during rollback |
| PRD §25–28 / design §24–26 risks/invariants/DoD | Substantial implementation, but reproducible defects and missing evidence remain | **Definition of Done is not met** |

## Suggested order

1. Fix R01/R02 privacy and lifecycle ownership.
2. Replace R03 FIFO rebinding with durable source identity; move R04 consumption to app lifetime.
3. Correct R05 content identity and R06 cumulative metrics, with permanent regression tests.
4. Resolve G01's measurement scope and run V01/V02 against the final commit.
5. Collect V03 evidence before any V2 removal or full parity declaration.
