# Workspace capability parity — requirement audit and TODO

Audit date: 2026-10-21. Reviewed HEAD: `adfa0169d` on `workspace-v2-capability-parity` (worktree `workspace-parity`).

Authorities used for this review:

- Worktree [PRD](./ai-chat-workspace-v2-capability-parity-prd.md) and [technical design](./ai-chat-workspace-v2-capability-parity-technical-design.md). These copies differ from the copies in the primary checkout. This branch's owner exception (2026-10-18, reconciled 2026-10-20) is in the worktree documents and is the authority for this tree.
- Previous findings: [2026-10-21 audit](./ai-chat-workspace-v2-capability-parity-audit-todo-2026-10-21.md), which reviewed `4deff51e3` and was later checkbox-ticked by `adfa0169d`.

**Verdict: not complete.** The capability surfaces and the durable pending-to-run pipeline are implemented, and the R01–R06 fixes from the previous audit are present in source. This review found **two remaining correctness defects** (one user-visible image/queue identity bug, one observability contract bug) plus the still-open release gates V01–V03. Definition of Done is not met.

This is a source review. No production code was changed. The defects below were traced through the current source; they were **not** re-executed as a failing test in this pass, and the full component, main, and Electron suites were **not** rerun on `adfa0169d`.

## What the previous audit's fixes look like now

| Previous item | Current source | Assessment |
| --- | --- | --- |
| R01 voice acceptance used the live session owner | `stillOwnsComposition` compares the captured owner to `props.draftKey` (`AiChatV2Composer.vue` around 704 and 986) | Present. Not re-executed. |
| R02 dispose during `getUserMedia` | `BrowserVoiceRecorder` bumps `acquisitionSeq` in `start` and `dispose`, and stops a late stream (`BrowserVoiceRecorder.ts` around 96–145 and 205–208) | Present. Not re-executed. |
| R03 FIFO run binding | Exact `sourceRunId` match exists, plus an early-fact buffer (`selectedConversation.ts` `reconcileRunStartedIdentity`) | Partial. Summary events carry `sourceRunId`. Detail events do not. The legacy FIFO branch is still the live path for detail `start`, and unresolved steered/cancelled rows poison it. See D01. |
| R04 image clear required a mounted center | `composerDrafts.ts` watches `lastResolvedReferenceRun` for the life of the store | Present for a single resolution. D01 can publish the wrong ordinal into that watcher. |
| R05 content digest | `computeRequestDigestSha256` hashes normalized text, options, file bytes, and image-reference sets (`AIChatPendingMessageModule.ts`) | Present. Not re-executed. |
| R06 cumulative metric merge | `mergeRealmPush` converts cumulative renderer snapshots into per-realm deltas and drops stale sequence numbers (`aiChatRendererMetricsIpc.ts`) | Present. Not re-executed. |
| G01 click-to-acceptance | A `submit_click_to_acceptance_ms` sample exists | The sample does **not** start at the submit click. See D02. The design requirement is still open. |
| V01–V03 | No new soak, successful-voice, or manual accessibility evidence on this HEAD | Still open. |

## Bugs to fix

### D01 — P1: a steered or cancelled queued send leaves an unresolved ledger row, and the next detail `start` binds the following run to that row

- [ ] Resolve or drop a pending acceptance when that pending row is steered or cancelled, and bind detail `start` / terminal events by the same durable source identity the summary channel already carries.
- **Requirements:** FR-QUE-006, FR-QUE-012, FR-IMG-002, FR-IMG-004, FR-IMG-015, FR-LIF-004; AD-003; design §8.5 and §11.
- **Why it happens:**
  1. Every accepted workspace send appends a ledger row (`selectedConversation.ts` `registerAcceptedRun`, around line 380). A queued send is stored as `pending-<pendingMessageId>`, not as a real run id.
  2. On acceptance, image references are armed against that row's ordinal (`AiChatCenterSurface.vue` around line 2265, `composerDrafts.storeReferenceClear`). The tray is removed only when a **complete** resolution publishes that ordinal (`composerDrafts.ts` around line 197).
  3. Steering is allowed for generated-image selections. `claimForSteering` rejects file attachments only (`AIChatPendingMessageModule.ts` around line 477, `canSteer` around line 638). The steering instruction copies `displayContent` and `modelContent` (`AIChatTurnQueueService.ts` around line 660). It does not carry `generatedImageReferences`. The trusted image channel is applied later, on a normal dispatch (`AIChatQueryEngine.ts` around line 1946), which a steered row never gets.
  4. Cancel of a not-yet-claimed queued row also creates no run envelope (AD-002: the envelope is created at scheduling claim). Neither path marks the ledger row resolved. Nothing in `selectedConversation.ts` listens for pending `steering` / `cancelled` and retires the row.
  5. Detail events are wrapped without `sourceRunId` (`AIChatRunEventAdapter.wrap`, around line 21). `applyDetailEvent` therefore calls `reconcileRunStartedIdentity` with an empty source (`selectedConversation.ts` around line 706). The legacy branch binds the real run id to the **oldest unresolved, unbound** row (around line 445).
  6. The duplicate-start guard returns as soon as any row is already bound to that real run id (around line 428), **before** the exact `sourceRunId` match. A wrong FIFO bind cannot be corrected by the later summary that does carry `sourceRunId`.
  7. `recordTerminalRun` (around line 633) resolves the detail terminal with the real run id only. It follows `boundRunId`, so it publishes the orphan row's ordinal. The app-scoped watcher then treats that ordinal as a successful completion and removes those image references from the tray.
- **Reproduce:**
  1. Start turn A.
  2. While A is running, select a generated image and send follow-up B. B is accepted into the pending queue. The tray clear is armed on B's ordinal. The images stay visible, which is correct until B's own run completes.
  3. Either steer B, or cancel B before it is claimed.
  4. Let a later ordinary run C start and complete.
- **Expected:** Steering either applies B's trusted image references inside A, or it is rejected the way file attachments are rejected. Cancel leaves B's selected images in the tray. C's completion clears only C's own snapshot.
- **Actual (source trace):** B never receives a run, so its ledger row stays unbound. C's detail `start` has no `sourceRunId` and binds C's run id onto B. C's detail terminal publishes B's ordinal with kind `complete`. The watcher removes B's images. C's own ordinal stays unresolved, so C's images are not the ones cleared. The steered turn also never received the trusted image-reference channel.
- **Impact:** A cancelled image edit loses its selection when a later run finishes. A steered image edit does not edit those images, and the same later run can strip them from the tray. The next send can then attach a different conversation of references than the user still sees, or attach none of the images the user thought were consumed.
- **Done when:** Add a component or store test for steer and cancel of a queued generated-image send, then a later run in the same conversation. Assert the tray after cancel, the model request after steer, and that C's terminal ordinal is C's. Cover detail-before-summary and summary-before-detail. Put `sourceRunId` on the detail envelope in `AIChatRunEventAdapter.wrap`, and pass it through `recordTerminalRun`. Do not let the "already bound" guard hide a source mismatch.

### D02 — P2: `submit_click_to_acceptance_ms` starts after attachment encoding, not at the submit click

- [ ] Stamp the click in the composer send handler, before command routing, image preflight, new-chat creation, and `buildUploadedAttachments`, and close the sample at the durable acceptance receipt.
- **Requirements:** design §18.2 "submit click to durable acceptance"; PRD §20. The previous audit's G01 item was ticked in `adfa0169d` without this boundary.
- **Evidence:** `performOrdinarySend` awaits `buildUploadedAttachments` (`AiChatCenterSurface.vue` around lines 2169–2172) and only then calls `selectedStore.sendMessage` (around line 2218). `sendMessage` stamps `clickAtEpochMs = Date.now()` as its first timing line (`selectedConversation.ts` around line 878). The IPC comment (`ai-chat-workspace-ipc.ts` around lines 562–568) says attachment encoding, IPC, validation, and image normalization are included because the renderer stamped the click. Encoding and preflight have already finished before that stamp. Image preflight and `onNewChat` in the same function are also outside the sample.
- **What the current tests show:** `aiChatPlanDecisionIpc.test.ts` feeds a caller-supplied `clickAtEpochMs` straight into the IPC handler. `selectedConversation.identity.test.ts` only checks that the store's stamp is recent. Neither test places a delay in `buildUploadedAttachments` and asserts that the sample includes it.
- **Impact:** Soak dashboards will under-count submit latency whenever the user attaches files or the send path creates a conversation first. Quiet text sends happen to be close to the real click. The queue-only metric `queue_submit_to_acceptance_ms` is still a valid narrower measurement and should stay.
- **Done when:** A test delays attachment encoding (and, separately, the IPC accept call) and shows `submit_click_to_acceptance_ms` includes both, while `queue_submit_to_acceptance_ms` includes only the queue call. Implausible stamps must still be dropped. The IPC comment must match the stamp site.

## Release and certification tasks still open

These are not new code defects. They are unmet PRD and design exit gates. Prior audit notes already left them open, and this HEAD does not add evidence for them.

### V01 — P1 release gate: successful voice journey is not certified

- [ ] Run the default-route record → successful transcription → auto-send → spoken-response journey with a deterministic stand-in for the speech runtime, and record one real-runtime check separately.
- **Requirements:** FR-VOI-001–010; PRD §22.3 item 8 and §23 acceptance 21–22; design §21.4 item 8.
- **Evidence:** `test/e2e/specs/aiChatVoiceParity.test.ts` states that a real transcription or synthesis result is impossible in that environment because sherpa-onnx and the models are absent. The spec covers missing runtime, missing model, settings, and cancel. Component suites cover composer and `useAiChatVoice`. That is the failure and setup path, not the success path in §17.8.
- **Done when:** The default route shows a transcript merged into the existing draft, one accepted send when auto-send is on, spoken output only under the configured policy, and the draft still present after a transcription failure. Name the stand-in versus the real runtime.

### V02 — P1 release gate: accessibility, authenticated browser, and a final-state regression run

- [ ] Record keyboard completion of queue, steer, plan, permission, email review, report, image, workspace, and voice controls, including focus move into the dialog and return to the invoking control.
- [ ] Record narrow width and 200% scaling with the primary action still visible, and reduced-motion with nonessential animation off.
- [ ] Record one-time announcements for permission, question, outbound review, and terminal error without moving focus in an inactive conversation.
- [ ] Record an authenticated managed-browser start → takeover or approval → verify login → resume → stop, including an expired handoff, a stale session action, and a route change that must not stop the session.
- [ ] On the final commit, run `yarn typecheck`, `yarn vue-typecheck`, `yarn test:components`, the affected main-process suites, and `yarn test:e2e`. Write down any remaining skips and unrelated failures.
- **Requirements:** A11Y-001–010; FR-BRW-001–006; PRD §22.3, §23.26–28, §28; design §16 and §21.
- **Evidence:** `test/vitest/main/components/aiChatWorkspace.a11y.test.ts` calls itself an automated subset (names, non-color status, 36px strip minimum, native buttons, hidden reasoning). It records Vuetify dialog behavior and global reduced-motion tokens as assumptions rather than observed focus traps, Escape behavior, or 200% layout. `test/e2e/specs/managedBrowser.test.ts` has a deterministic start / login-gate / stop case. It is not an authenticated account handoff on the live browser. This review did not rerun the suites, so a previous green E2E log is not evidence for `adfa0169d`.
- **Done when:** The notes name the platform, assistive technology, viewport, and what was actually operated. Reconcile the design's 44px target with the 36px strip rule in that note instead of treating them as the same requirement.

### V03 — P1 release gate: soak and owner sign-off

- [ ] Collect a rolling 14-day default-route soak: at least 500 accepted submissions, acceptance at least 99.5% excluding deliberate validation and entitlement rejections, exercised restart recovery at least 99%, and no open severity-1 or severity-2 parity defect.
- [ ] Record zero confirmed duplicate delivery, duplicate plan continuation, cross-conversation event, or authorization bypass, plus product, safety, desktop, and QA sign-off.
- [ ] Keep Chat V2 as a working rollback until a separate removal decision. Fix D01 before counting image or steering incidents, and fix D02 before reading `submit_click_to_acceptance_ms` as click latency.
- **Requirements:** AD-009; PRD §21 phase 5, §24, §28; design §19.5, §23, §26.
- **Done when:** The soak note is attached to this branch. Automated test counts do not substitute for it.

## Accepted deferral (not an unnoticed miss)

The worktree PRD §10 item 5 and §11.2, and design §26 item 4, record an owner decision: remaining submission, image-preflight, and plan-continuation logic may stay inside `AiChatV2.vue` until after V03 and a separate cleanup decision. The workspace is required to keep using the extracted seams it already has (`AiChatV2Composer.vue`, `useChatCommandRouting.ts`, `useAiChatVoice.ts`, `useConversationWorkspace.ts`, the pending queue, and the run-dispatch bridge).

The design §5 diagram still names `useChatSubmission`, `usePlanActions`, `useToolPermissionActions`, `useGeneratedImageWorkflow`, `useContentReporting`, `AiChatOverlayHost.vue`, and `AIChatWorkspaceEventRouter.ts`. Those files are not in the tree. `AIChatEventRouter.ts` is the router that exists. Do not treat the missing filenames as a parity failure while the owner exception stands. Do not copy new Chat V2 orchestration into `AiChatCenterSurface.vue`.

The primary checkout's PRD and technical design do **not** contain this exception. Anyone reviewing those copies will still see full extraction as required. This todo follows the worktree documents.

## Requirement coverage

"Present" means a reachable workspace path and existing tests were identified in this tree. It does not mean every acceptance case was rerun on `adfa0169d`.

| Requirements | Assessment | Remaining work |
| --- | --- | --- |
| FR-SUB-001–009 | Present. Full payload, paste map, voice origin, attachment helper, accepted-send clear, file-only localized rejection, origin captured before encoding | D02 measures this path late. No new submission-loss defect traced |
| FR-CMD-001–009 | Present. `useChatCommandRouting`, goal, loop, schedule approval, `/skill` | Final-state regression only (V02) |
| FR-QUE-001–014 | Present for FIFO, pause, resume, restart hold, and steer of text | D01: steered and cancelled rows are not retired in the renderer ledger |
| FR-PLN-001–009 | Present. Decision surfaces, strict IPC schemas, deterministic continuation id | No new plan defect traced. V02 regression |
| FR-PER-001–008 | Present. `SkillApprovalCard` persists once versus persistent through `skill:grant-permission` before emit; the center resumes the parked tool | V02 regression. The center ignoring `payload.persistent` matches the card, which already saved it |
| FR-OUT-001–010 | Present. Dedicated batch card and shared review dialog | V02 / historical E2E is not a new run on this HEAD |
| FR-IMG-001–015 | Present for tray, chooser, batch confirm, retry, stop, and save | D01 breaks reference lifetime across steer, cancel, and the next run |
| FR-RPT-001–009 | Present. Per-output and conversation dialogs, reported-id set | V02 regression |
| FR-VOI-001–010 | Present for shared orchestration, setup, missing runtime, and owner-scoped transcription | V01 success journey. R01/R02 fixes are in source and were not re-run here |
| FR-WSP-001–010 | Present. Badge, setup, trust card, shared memory panel, watcher | V02 platform and lifecycle regression |
| FR-REC-001–008 | Present. Run strip, retry and recovery detail, compaction status | V02 regression |
| FR-LIF-001–006 | Present for selection filtering, summaries, and busy delete | D01 cross-run identity |
| FR-SKL-001–006 | Present. Install card in the transcript, prompt-skill dispatch, Plugins page left as the manager | V02 regression |
| FR-BRW-001–006 | Present. Start panel, session card, handoff and approval dialogs mounted from the center | V02 authenticated lifecycle |
| FR-HIS-001–005 | Present. History drawer, opaque ids, submission id, compaction controls | No new archive defect traced |
| FR-INT-001–005 | Present. Portable memory, workspace setup event, navigation handler, agent-task cancel, reasoning control | D01 is the image-side integration hole |
| A11Y-001–010 | Partial automated subset | V02 |
| PRD §16 localization | Present for keys touched so far, including `aiChatV2.attachments.text_required` in en, zh, es, fr, de, ja | Any D01/D02 user-visible copy must land in all six files |
| PRD §19 performance | Bounded 200-message window and summary routing exist | Not re-measured here |
| PRD §20 / design §18 | Counters and the §18.2 timing keys exist as names | D02: the click sample's start boundary is wrong |
| PRD §21–28 / design §26 | Architecture and tests exist for the capability set | DoD items 1, 8, 9, and 10 are open because of D01, D02, and V01–V03 |

## Suggested order

1. Fix D01 and add the steer, cancel, and following-run regression before any further image or queue soak numbers.
2. Move the D02 stamp to the composer click and correct the IPC comment.
3. Run V01 and V02 on that commit, including the full typecheck and E2E gates.
4. Collect V03 only after D01 and D02 are closed. Chat V2 stays until the separate removal decision.
