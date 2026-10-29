# Workspace capability parity — updated-code re-audit and TODO (R2)

Date: 2026-10-20. Reviewed HEAD: `e3454b321ce44d30089ca6078872d4c076413910`.
Worktree: `workspace-parity`.

Authorities: [PRD](./ai-chat-workspace-v2-capability-parity-prd.md), [technical design](./ai-chat-workspace-v2-capability-parity-technical-design.md). Prior comparison: [first 2026-10-20 audit](./ai-chat-workspace-v2-capability-parity-audit-todo-2026-10-20.md).

**Verdict: not all requirements are complete.** The update fixes the previously identified command, typed-draft, file-only-send and Stop defects, and resolves the architecture authority mismatch. However, this review found **seven remaining bugs/contract defects: four reproduced with focused component checks and three established by source tracing**. Observability and an independent rollback adapter remain incomplete. Required runtime/manual/soak evidence also remains outstanding.

No production fixes were made in this audit. P1 means high-priority isolation/privacy failure; P2 means correctness, lifecycle or required-contract work. Release gates are marked separately. Source line references refer to the reviewed HEAD. “Present” in the coverage matrix means implementation was found, not blanket certification of every acceptance case.

## 1. Verification and worktree state

The earlier merge is complete; no unresolved paths were present. The old audit document was already untracked on entry and was left untouched. HEAD stayed stable during this audit.

| Executed check | Result |
| --- | --- |
| `yarn typecheck` | Passed, 24.11 seconds. |
| `yarn vue-typecheck` | Passed, 36.89 seconds. |
| `yarn test:components` | **156 files / 1,259 tests passed** before introducing temporary reproductions. |
| `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/aiChatWorkspace test/vitest/main/browserVoiceRecorder.test.ts` | **13 files / 93 tests passed**. The duplicate internal TypeScript gate was explicitly skipped; the separate typecheck above passed. |
| `yarn test:components reaudit20261020 -t REAUDIT` | **4 targeted assertions failed**, reproducing N01–N04. 130 unrelated tests in the copied fixtures were filtered out. |
| Full main/module suites, full Electron E2E, real audio/browser sessions, cross-platform and manual accessibility | Not rerun here. Previous E2E reports are historical evidence, not results for this HEAD. |

Evidence logs: `/tmp/workspace-parity-reaudit-{components,typecheck,vue,main,repro}.log`.
Temporary reproduction fixtures were removed from the worktree and retained as `/tmp/reaudit20261020Voice.test.ts` and `/tmp/reaudit20261020Center.test.ts`. They use actual Vue components and, for N04, actual selected-conversation store/presenter logic; transport/audio services are mocked. Copy them temporarily into `test/vitest/main/components/` to rerun the focused command. They intentionally assert required behavior and fail until fixed. Preserve permanent regression tests with the eventual fixes; `/tmp` is not durable release evidence.

## 2. What the update fixed

| Previous finding | Current assessment |
| --- | --- |
| B01: transcription completes after switching | Fixed for a switch **after pressing Stop**: transcript is parked under the captured draft key. Still incomplete for switching while recording: N01. |
| B02: voice acceptance overwrites another chat | The callback now avoids changing the newly selected chat. Background cleanup and edits made during transcription remain defective: N02/N03. |
| B03: typed acceptance deletes newer content | Snapshot comparisons now protect changed text/files/paste state. New `typedAcceptance` tests pass. Do not reopen the original different-content reproduction. |
| B04: double acceptance for expanded commands | `acceptanceDelegated` gives the expanded send one acceptance owner; updated tests pass. |
| B05: file-only send silently disappears | Explicit localized composer rejection now retains attachments, with all six locales updated. This satisfies the prior audit's explicit-rejection option. |
| B06: composer/batch Stop leaves speech running | Both now use `stopActiveRunWithSpeech`; strip retains its goal/loop precedence. |
| B07: rollback sends slash commands as model text | Commands now always pass through the router. This safety fix should remain; the now-unused adapter has a separate completeness issue, G02 below. |
| B08: late command/encoding errors appear in another chat | `setCommandErrorNotice` scopes and retains those errors by origin; the tested branches now pass. This is not certification of every async handler in the app. |
| G01: missing observability | Counters/timing keys and several call sites were added. Some timing endpoints and consumption are still incorrect/incomplete: G01 below. |
| G02: authoritative docs disagree with owner exception | Closed: PRD §10/§11.2 and design §26 now record the workspace-authoritative / frozen-V2 exception. Remaining extraction is explicitly deferred, not a current parity blocker. |
| M01: unresolved merge | Closed for this HEAD: merge committed and both typechecks pass. |
| V01–V03 | Remain release evidence obligations; see section 5. |

## 3. Bugs and contract defects to fix

### N01 — P1, reproduced: recording ownership is captured at Stop instead of Start

- [x] Capture the draft/conversation owner before microphone acquisition begins and preserve it until recording, transcription and acceptance finish.
- **Requirements:** FR-SUB-007, FR-VOI-005/010, FR-LIF-002; PRD §14 privacy.
- **Evidence:** `src/views/components/aiChatV2/AiChatV2Composer.vue:835` captures `voiceOwnerDraftKey` only inside the `isRecording` Stop branch. The Start branch at :948–958 sets no owner. The workspace reuses the same composer across conversations.
- **Reproduce:** In A, start recording; switch to B while still recording; press Stop in B with auto-send enabled.
- **Actual:** `send('A private recording', ..., {fromVoice:true})` is emitted in B. The updated guard considers B the rightful owner because it captures B at Stop. The component reproduction fails as expected.
- **Impact:** A's recording can be submitted to B's model context; manual transcription can also enter B's draft. The prior fix covers a different timing window and does not close this one.
- **Done when:** Tests cover switching during microphone permission acquisition, active recording, conversion and transcription, plus A→B→A and both auto-send modes. Keep files/drafts scoped to the recording owner; never silently retarget recorded content.

### N02 — P2, reproduced: accepting a voice send in the background leaves already-sent content in its draft

- [x] Consume the accepted voice snapshot in the originating stored draft even when that conversation is no longer selected; update the visible composer only when appropriate.
- **Requirements:** FR-SUB-002, FR-VOI-010, FR-LIF-004; design §6/§10 draft ownership.
- **Evidence:** `AiChatV2Composer.vue:915–920` immediately returns from voice acceptance when `stillOwnsComposition()` is false. Unlike typed acceptance at :1526–1541, it never updates the origin's `composerDrafts` entry.
- **Reproduce:** Type `A typed draft`, auto-send transcript `hello world`, defer acceptance, switch to B, accept the send, return to A.
- **Actual:** A restores `A typed draft hello world`, instead of the preserved unsent text `A typed draft`. Submitted attachments are likewise left in A's stored draft.
- **Impact:** The next ordinary send can unintentionally resend the previous voice request/files. This is stale draft state, not proof that the queue independently dispatched a duplicate turn.
- **Done when:** Background and post-unmount acceptance remove only the sent transcript/files from A's stored snapshot; newer text/paste/files survive and B remains untouched. Test acceptance exactly once, retry, and conversation round trips.

### N03 — P2, reproduced: voice acceptance rolls back typing done during transcription

- [x] Base transcript consumption on the current draft immediately before transcript insertion, or use draft revisions and a precise transcript delta; never restore an older text snapshot wholesale.
- **Requirements:** FR-SUB-002/003/008, FR-VOI-005/010.
- **Evidence:** `AiChatV2Composer.vue:836` captures `draftBeforeVoiceSend` before recorder stop/conversion/transcription. After those awaits, :911–912 appends the transcript to the **current** draft and captures `submittedDraftText`. Acceptance at :921–922 restores the **earlier** text if the post-append draft has not subsequently changed.
- **Reproduce:** Start transcription with `old typed draft`; while it is pending replace the text with `new typed draft`; resolve transcription; accept the voice send without further typing.
- **Actual:** The draft becomes `old typed draft`. The new text was never included in the voice request, yet is lost.
- **Done when:** Typing before, during and after every asynchronous voice stage survives acceptance unless that exact content was submitted. Cover pasted blocks/files and rejected sends. The existing test for edits **after** the emitted send is insufficient.

### N04 — P2, reproduced: image draft cleanup loses identity after a background completion

- [x] Match cleanup to actual pending/submission/run identity instead of pairing independent acceptance and visible-terminal counters; reconstruct cleanup across background completion and route remount.
- **Requirements:** FR-IMG-002/015, FR-SUB-006, FR-LIF-001/004; AD-005 and the technical design's stable identity contracts.
- **Evidence:** `src/views/store/selectedConversation.ts:274–300` increments one counter for accepted sends and another for consumed terminal detail events. Inactive-conversation detail events are ignored at :303–310; reselection at :354–405 restores history/runtime but does not reconcile these counters. `AiChatCenterSurface.vue:1543–1554` matches the submitted image snapshot using only `terminal.ordinal`, despite the terminal also having a real `runId`.
- **Reproduce:** In A, submit image m1; switch to B; let A complete in the background (no selected-detail terminal). Return to A's idle snapshot, clear/reselect m2, submit it and receive its terminal while A is selected.
- **Actual:** The second acceptance is ordinal 2, but its visible terminal is ordinal 1. Cleanup matches the old snapshot and leaves m2 selected. The focused test expects an empty tray and receives `[{messageId:'m2', imageIndex:0}]`.
- **Impact:** Already-used references persist and can be sent again; an unrelated terminal can also consume an old snapshot. Queue cancellation/steering, missed terminals and remounts need the same identity treatment. `pendingDraftClears` is component-local, so route destruction loses it while the draft store survives.
- **Done when:** Use durable identity and terminal reconciliation; test background success/failure, route remount, cancelled/steered queued items, multiple accepted sends and references added for a newer draft. Preserve failed-send references deliberately rather than through counter drift.

### N05 — P2, source-confirmed: maximum-duration recording stop discards the audio result

- [x] Deliver the maximum-duration stop result through the same composer transcription path as explicit Stop, exactly once.
- **Requirements:** FR-VOI-002/003/005/010; maximum-duration and recovery contracts inherited by the PRD.
- **Evidence:** `src/views/components/aiChatV2/voice/BrowserVoiceRecorder.ts:134–138` calls `void this.stop().catch(...)` from the timer and discards its resolved recording. `onstop` at :124–130 resolves the current caller, then clears the recorded chunks. Composer `isRecording` is local state, updated only by mic clicks; it has no recorder-completion subscription. Its next Stop calls `voiceRecorder.stop()` again, which throws `Not recording` at recorder :145–147.
- **Trigger/impact:** Record until the configured limit. Microphone tracks stop, but the composer still presents its recording state and does not transcribe the finished audio; a subsequent Stop produces an error after the recording data has been discarded.
- **Coverage gap:** `test/vitest/main/browserVoiceRecorder.test.ts` only checks that the timer leaves the recorder idle; it does not assert that the composer receives/transcribes the result.
- **Done when:** A real-recorder/composer integration test advances the duration timer and observes one transcription, correct UI state and preserved draft. Test a manual Stop racing the timer and no duplicate auto-send.

### N06 — P2, source-confirmed: recorder lifetime is not cleaned up with the composer

- [x] Stop/dispose microphone capture and invalidate outstanding acquisition/transcription callbacks on route unmount; preserve any retained transcript through its captured owner store.
- **Requirements:** FR-VOI-003/010, FR-LIF-001/002; design §9/§10 lifecycle ownership and PRD §19 resources.
- **Evidence:** `AiChatV2Composer.vue:666` creates a component-owned `BrowserVoiceRecorder`. Its only `onBeforeUnmount` registration at :1065–1071 unsubscribes configuration changes. No recorder cleanup or in-flight generation invalidation is registered. Recorder tracks are stopped only in its own `cleanup()` at `BrowserVoiceRecorder.ts:166–180`, reached through `onstop`.
- **Trigger/impact:** Start recording, then navigate away so the composer unmounts. Capture can continue invisibly until the duration timer; returning mounts a separate recorder. A pending `getUserMedia` result can also start capture after the original composer has gone away. This is source-confirmed lifecycle exposure, not a measurement of physical microphone activity in this audit.
- **Done when:** Verify unmount stops actual injected media tracks, clears timers and handles pending microphone permission/start/stop/transcription. No orphan recording, stale auto-send or unhandled promise remains; unrelated background text runs continue normally.

### N07 — P2, source-confirmed: plan decision IPC still bypasses the strict input contract

- [x] Apply strict bounded schemas and safe parse-error handling to approve, reject and request-changes handlers, preserving the existing AI gate before parsing.
- **Requirements:** FR-PLN-004/005; PRD §14.3/§14.4; technical design §14 and §26.6.
- **Evidence:** `src/main-process/communication/ai-chat-v2-ipc.ts:1913–2025` uses `JSON.parse` plus TypeScript casts and a few truthiness checks. The parse is outside the `try`. Unknown keys are accepted; IDs need only be truthy; version need only have type `number`; request-changes calls `feedback.trim()` before the guarded module call. The workspace invokes these shared handlers through its existing plan APIs.
- **Trigger/impact:** Malformed JSON throws an IPC transport error instead of a bounded failure envelope. A truthy non-string feedback (e.g. `{}`) also throws before safe mapping; extra properties and invalid ID/version shapes are not strictly rejected at the edge. This establishes a contract/error-handling gap, not an authorization bypass.
- **Done when:** Gate-first tests plus malformed JSON, unknown keys, null/object IDs, noninteger/out-of-range versions, wrong-type/oversized feedback and stale versions. Invalid inputs return safe bounded errors and never invoke the module; rejected UI actions remain retryable.

## 4. Incomplete implementation

### G01 — P2: timing names exist, but several required measurements are still missing or misleading

- [x] Measure plan decision → **durable continuation acceptance**, rather than just decision persistence. `ai-chat-v2-ipc.ts:2898–2906` records `plan_decision_to_continuation_ms` around `handleApprovePlan`; that function only persists the plan state and returns. The renderer sends the continuation later. A failed/missing continuation can therefore still produce a successful timing. Reject/change paths also need the specified continuation timing.
- [x] Instrument workspace selection reconstruction. `selection_request_to_transcript_ms` is observed only around `AI_CHAT_V2_HISTORY` at :2875–2884; the workspace uses `AI_CHAT_WORKSPACE_SELECT`. A timing-key definition and direct counter unit test do not establish that the default-route selection journey emits it.
- [x] Either measure submit-click → durable acceptance across renderer/IPC or rename and document the narrower metric. `ai-chat-workspace-ipc.ts:518–535` starts `submit_to_acceptance_ms` immediately before queue submission, excluding attachment encoding, validation and earlier IPC latency.
- [x] Connect renderer aggregates to a real diagnostics/soak consumer and measure through the intended projection completion boundary. `src/views/store/aiChatRendererMetrics.ts:56` exposes a snapshot, but source search found no production caller. Its comment claims it joins main structured telemetry, but no joining path exists. `selectedConversation.ts:317–320` stops timing immediately after `presenter.applyEvent`, before any deferred UI flush.
- **Requirements:** Technical design §18.2–18.3; PRD §19/20/24.
- **Done when:** Integration tests delay each stage and assert samples include the named endpoint; failed continuation produces no false accepted-continuation sample. Exercise the actual workspace channels and diagnostics export, with bounded identity/state labels and no content. Keep the valid new capability counters rather than reverting the G01 update.

### G02 — P2: `shared_orchestration` rollback flag is now inert

- [x] Define and implement a meaningful safe adapter effect, or explicitly retire/amend this flag in the rollout contract and tooling.
- **Evidence:** The flag remains stored, returned by `AI_CHAT_WORKSPACE_GET_FLAG`, and loaded into `useWorkspaceRolloutAdapters().sharedOrchestration`. Repository-wide source search finds no consumer of that value beyond its accessor/hydration. The B07 fix removed the center's binding and branch; `onComposerSend` now always runs the same routing path.
- **Requirements:** Design §23.1 independent rollout adapters; updated PRD §11.2 explicitly retains independently switchable controls.
- **Impact:** An operator can persist/read back a disabled flag without changing application behavior. Tests that only assert persistence or safe ordinary sends do not prove rollback behavior.
- **Done when:** A renderer-level rollback test demonstrates the documented behavior difference while keeping durable identities and command interception intact. **Do not restore raw slash-command fallback** to make the flag functional.

## 5. Verification and release tasks still open

### V01 — Release evidence: complete the successful voice journey and new negative paths

- [ ] Run record → successful transcription → auto-send → spoken response through `/` → `/aiworkspace`, using deterministic controlled audio/runtime services in CI and a separately configured real-runtime check.
- [x] Include N01–N06 lifecycle cases in appropriate component/integration/Electron coverage; assert actual owner, job, track and queue state, not only visible buttons.
- **Evidence:** `test/e2e/specs/aiChatVoiceParity.test.ts:97` still tests **missing runtime/model**, settings and bounded failure. It is useful negative coverage but not the successful voice journey required by design §21.4 item 8 and PRD §22/§23.

### V02 — Release evidence: manual/runtime accessibility, browser and final regression gates

- [ ] Execute/record default-route focus entry/return/traps, safe Escape, one-time announcements, reduced motion, keyboard completion, narrow and 200% layouts, with platform/assistive-technology scope documented.
- [ ] Record managed-browser authenticated start → handoff → verify → resume → stop, including expiry/stale approval/route return, separating deterministic fixtures from live-account checks.
- [x] After fixes, run both typechecks, component suite, affected modules, full main suite and critical/full Electron E2E. Explain unrelated baseline failures and skipped cases instead of treating them as passed.
- **Evidence:** Existing accessibility suite explicitly calls itself an automated subset; older audit records manual zoom and authenticated browser residuals. No fresh evidence closing those residuals was found in this update. These tasks identify missing certification, not absent UI implementation.
- **Requirements:** A11Y-001–010, FR-BRW-001–006, PRD §22/§23/§28; design §16/§21/§26.

### V03 — Release gate: production soak and explicit owner approval

- [ ] Collect rolling 14-day default-route evidence with at least 500 accepted submissions, acceptance ≥99.5% excluding deliberate validation/entitlement rejects, exercised restart recovery ≥99%, and no open severity-1/2 parity defects.
- [ ] Record zero confirmed duplicate delivery, duplicate continuation, cross-conversation event or authorization-bypass incidents and product/safety/desktop/QA sign-off.
- [ ] Extend low-volume soak and keep functional V2 rollback until a separate approved removal decision.
- **Requirements:** AD-009; PRD §21/24/28; design §19/23/26. Tests and commit messages cannot substitute for production/user-hour evidence. The earlier audit still has these tasks unchecked.

## 6. Complete requirement-group coverage

All 16 functional ranges are included. No new issue was established in a “present” row; that does not prove absence of bugs. Every row remains subject to final-state tests and the release gates above.

| Requirements | Current assessment / evidence | Remaining work |
| --- | --- | --- |
| FR-SUB-001–009 | Full composer payload, shared normalization, explicit file-only rejection, snapshot-aware typed acceptance, durable submission present | N01–N03 voice ownership/consumption; regression V01/V02 |
| FR-CMD-001–009 | Router, scope, goals, scheduled approval/control, single expanded acceptance and origin-scoped failures present | G02 rollout semantics; post-fix regressions |
| FR-QUE-001–014 | Durable queue, run bridge, FIFO, steering, pause/resume/recovery and scheduler present; targeted tests pass | No new queue defect established; N04 must not infer identity from queue order |
| FR-PLN-001–009 | Decision/question/Activity surfaces, deterministic continuation and recovery present | N07 strict IPC; G01 continuation measurement |
| FR-PER-001–008 | Actionable grants/denials, persistence, exact continuation and parked lifecycle present | Full final-state validation; no new bypass claimed |
| FR-OUT-001–010 | Dedicated review card/dialog, frozen authorization, preflight, idempotent delivery/outcome paths present | Reverify delivery gates after fixes; historical E2E is not a new run |
| FR-IMG-001–015 | Selection, chooser, batch confirmation/progress/retry/stop/save present | N04 durable cleanup identity and remount/background recovery |
| FR-RPT-001–009 | Single-output/conversation reporting, capability checks, exclusion rules and session markings present | Post-fix regression; no new reporting defect established |
| FR-VOI-001–010 | Shared voice orchestration and readiness/setup/recording/playback surfaces present | N01–N03/N05/N06; V01 success-path certification |
| FR-WSP-001–010 | Shared workspace binding/trust/watcher/memory surfaces present | Final lifecycle/platform validation; no new binding defect established |
| FR-REC-001–008 | Retry/recovery detail, context, compaction and reconstruction present | N07 bounded plan failures; final regression |
| FR-LIF-001–006 | Selected-generation filtering, bounded summaries, run ownership and busy-delete protection present | N01/N02/N04/N06 ownership and reconstruction |
| FR-SKL-001–006 | Install card, approval/dependency/credential flows, `/skill` and manager entry present | Post-fix/default-route verification; raw-command rollback regression fixed |
| FR-BRW-001–006 | Start/session/handoff controls and explicit global/account scope present | V02 authenticated lifecycle evidence |
| FR-HIS-001–005 | Drawer, opaque references, selected-context store, stable retry identity, acknowledgement and compaction present | Post-fix regression; no new history defect established |
| FR-INT-001–005 | Portable memory/Auto Dream, workspace request, selected-live navigation, task/file details and reasoning control present | V02 integration verification |
| PRD §13 presentation; AD-005/006/008 | Workspace-native semantic results, dedicated cards, bounded transcript and scoped overlays present | N04 component-local image bookkeeping; V02 focus/announcements |
| PRD §14 / design §14/§25 security and invariants | Main gates and trusted image/email/permission services present | N01 recording privacy, N06 invisible capture, N07 strict schemas; not an exhaustive security certification |
| A11Y-001–010 / PRD §15 | Automated subset, keyboard tests and Vuetify integration present | V02 manual/runtime completeness |
| PRD §16 localization | Six locales and new file-only rejection translations present | Translate every fix's new text in all six locales; linguistic review not performed |
| PRD §17/18 journeys and failure states; §23 acceptance | Broad existing regression suites; focused new failures identified | N01–N07 and V01/V02 prevent blanket completion |
| PRD §19 / design §17 performance and resources | Bounded history, batching, summary routing and performance tests present | N06 recorder lifetime; G01 meaningful timings; cross-platform evidence |
| PRD §20/24 / design §18 observability | Expanded counters, timing key definitions and partial call-site wiring present | G01 endpoint accuracy/default-route coverage/consumption |
| AD-001–004/007/010 | Durable intent/run mapping, dispatch bridge and deterministic plan identity present | Preserve these in N04; targeted suites pass |
| PRD §10/11 / design §26 shared ownership | Owner exception now explicitly incorporated | Prior G02 closed; no forced extraction before soak |
| PRD §21–22 / design §19/21/23 rollout/testing | Rollback machinery and existing tests present | G02 inert adapter; V01–V03 |
| PRD §25–28 / design §24–26 risks and DoD | Most implementation exists; explicit defects and unclosed evidence remain | **Definition of Done is not met** |

## 7. Suggested execution order

1. Fix N01 recording-owner privacy first, then N03 text loss and N02 background acceptance.
2. Fix N04 with real durable identity; cover route/background/steering/cancellation cases.
3. Complete recorder lifecycle N05/N06 and strict plan input handling N07.
4. Correct G01 measurements and give G02 a documented, safe behavior.
5. Run V01/V02, then collect V03 evidence. Do not remove V2 based only on passing unit/component counts.

## 8. R2 fix-outcome record (2026-10-21)

All fixes shipped as commits on `workspace-v2-capability-parity`:
`cd8918e2f` (N01–N03), `dd046e6e3` (N04), `f19e0eb97` (N05/N06), `8a3f71333` (N07),
`8742d57ac` (G01+G02), `ece6c3c4f` (E2E fixture `router.isReady()` settle).

**Fix gates (V02 item above):**

- One-shot `tsc --noEmit`: 0 errors (each fix run and final run).
- One-shot `vue-tsc --noEmit`: 0 errors (final run).
- Component suite: 158 files / 1,286 tests, all pass (G01/G02 included).
- Full main suite: 8,616 passed / 12 skipped. Explained baseline failures:
  - `config/SqliteDb.ensureInitialized.test.ts > calls ensureConnection before querying tasks` — documented pre-existing environment-dependent flake (unchanged by these commits).
  - `modules/SearchModule.test.ts > initializes the database before saving the search task` — same documented pre-existing flake class.
  - `SkillInstallationLifecycle.test.ts > linked mode with a REMOTE source never links staging` — same documented pre-existing flake (remote-source environment case).
  - `PortableMemoryPrivacyReview.test.ts > diagnostics use relative paths` — timing flake in this run; passes 3/3 when re-run in isolation.
  - 12 skipped cases are the pre-existing suite skips (unchanged count across runs).
- Full Electron E2E: **176 passed / 3 skipped**, no failures. First run had 4
  `emailReply*` failures: 2 were transient (pass on rerun), 2 were a real
  harness race fixed by `ece6c3c4f` — `#app` mounts before the router's
  initial navigation (async permission guard) finalizes, so a typed-hash
  navigation issued at that moment was overwritten by the boot navigation
  bouncing back to `#/aiworkspace`. The fixture now waits for
  `router.isReady()`; the affected spec families pass deterministically
  afterwards (13/13 in isolation, then the full suite clean).

**Still open (need human/production evidence — cannot be completed by code):**
V01 successful voice journey in CI (deterministic controlled audio runtime) +
real-runtime check; V02 manual accessibility/platform-AT record and
managed-browser authenticated lifecycle record; V03 production soak metrics,
incident-free record and owner sign-off.

