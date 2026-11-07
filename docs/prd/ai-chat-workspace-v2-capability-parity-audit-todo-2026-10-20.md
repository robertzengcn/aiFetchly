# AI chat workspace capability parity — current audit and TODO

Date: 2026-10-20. Worktree: `workspace-parity`.

Authorities: [PRD](./ai-chat-workspace-v2-capability-parity-prd.md) and [technical design](./ai-chat-workspace-v2-capability-parity-technical-design.md).

**Verdict: not complete.** Most capability surfaces and the durable dispatch architecture exist. This review found **eight correctness issues (five reproduced with component checks, three confirmed by source tracing)**, incomplete observability, an unresolved authority mismatch concerning shared orchestration, and remaining release evidence. The previous audit's statement that production soak is the only remaining work is too strong.

## Scope and changing worktree

- Review started on clean HEAD `4afb7abeff1ed127de1690e2b932259c317a9e2b`. Source line references below refer to that baseline unless stated otherwise.
- During verification, another operation began merging `261022e115b68a647720dec0aff86ee852ef9d3a` into this worktree. HEAD remained unchanged, but the index and working files changed substantially. The three unresolved paths are listed under M01. This audit did not initiate, resolve, abort, or commit that merge.
- The center surface, composer, selected-conversation store and two authoritative documents were not modified by that merge at the point checked. The focused reproductions therefore still describe those files, but the baseline's passing suites do **not** certify the merged worktree.
- This is a source review plus focused automated verification, not a guarantee that every runtime bug has been found. “Present” below means reachable implementation and identified coverage; it does not mean every acceptance case has been independently certified.
- Application code was not fixed. Temporary reproduction tests were removed from the worktree and retained under `/tmp`; only this TODO document is the intended deliverable.

## Verification performed in this audit

| Check | Result and limits |
| --- | --- |
| `yarn typecheck` | Passed before the concurrent merge; 31.28 seconds. |
| `yarn test:components` | Passed before the merge: 145 files, 1,142 tests. These pre-existing tests omit the cases below. |
| `yarn test:components audit20261020 -t AUDIT` | Five focused assertions failed against the actual composer/center, reproducing B01–B05. Center APIs were mocked; the file-only check supplied a successfully normalized attachment to isolate the send contract. No real provider or microphone was used. |
| `AIFETCHLY_SKIP_TSC=1 yarn vitest --config vite.main.config.mjs run test/vitest/main/aiChatWorkspace` | 12 files, 87 tests passed. Separate baseline TypeScript check had passed. The first combined main/typecheck attempt and first Vue check were stopped due to host resource contention; this rerun explicitly skipped the duplicate type gate. |
| `yarn vue-typecheck` rerun | Failed, exit 2, on `TS1185: Merge conflict marker encountered` after the concurrent merge began. This is a current worktree failure, not evidence that the clean baseline had those errors. |
| Full `yarn testmain`, module suite, full Electron E2E, live audio/browser, cross-platform and manual accessibility | Not rerun in this audit. The older audit records a 159 passed / 3 skipped E2E run; that is historical evidence, not a new result or proof of all PRD cases. |

Local evidence: `/tmp/workspace-parity-audit-2026-10-20-{components,typecheck,repro,main-rerun,vue-rerun}.log`. Reproduction fixtures: `/tmp/audit20261020Composer.test.ts` and `/tmp/audit20261020Center.test.ts`. To rerun, temporarily copy those fixtures into `test/vitest/main/components/` and run the focused command above. They intentionally assert required behavior and fail until fixed. These temporary artifacts are not durable release evidence; retain permanent regression tests in the fixes.

## Bugs to fix

### B01 — P1: Late transcription can submit A's recording into conversation B

- [ ] Capture the recording/transcription owner and generation before asynchronous work; route the result to that owner's draft or safely reject auto-send after selection changes.
- **Requirements:** FR-SUB-007, FR-VOI-005/010, FR-LIF-002; PRD §14 conversation privacy; design §15 selection-change handling.
- **Evidence:** `src/views/components/aiChatV2/AiChatV2Composer.vue:784–868`: `onMicClick` awaits recorder stop, audio conversion and transcription, then reads the current draft/files and emits `send` without an originating conversation. `AiChatCenterSurface.vue:269` reuses the composer without a conversation key; `onComposerSend` at :1981 captures the conversation only when that late event arrives.
- **Reproduce:** Start/stop recording in A; hold the transcription promise; switch to B; resolve it with A's speech while auto-send is enabled.
- **Observed:** The composer emits `send('A private recording', ..., {fromVoice:true})` after selection has become B. The parent will treat it as B's request. With auto-send disabled, the same missing owner check can append A's speech to B's draft instead.
- **Impact:** Private recording content can enter the wrong conversation and its model request. B's selected attachments can also be collected at the late completion point.
- **Done when:** Deferred stop, conversion and transcription all preserve owner identity; test A→B and A→B→A, route unmount, auto-send on/off, and unrelated files/drafts. Add a default-route E2E with a delayed deterministic transcription result.

### B02 — P1: Voice acceptance overwrites the newly selected conversation's draft

- [ ] Make voice acceptance update only the originating draft and submitted attachment snapshot.
- **Requirements:** FR-SUB-002/007, FR-VOI-010, FR-LIF-002.
- **Evidence:** `AiChatV2Composer.vue:857–867` saves `draftBeforeVoiceSend`, but its acceptance closure unconditionally assigns `draft.value = draftBeforeVoiceSend` and clears `selectedFiles`. It lacks even the originating-key check used by typed sends at :1393–1409.
- **Reproduce:** In A type `A typed draft`, auto-send voice, defer queue acceptance, switch to B and type `B private draft`, then accept A's send.
- **Observed:** B's visible draft becomes `A typed draft`. The composer draft watcher at :643–655 can persist that overwritten state under B's key.
- **Impact:** Cross-conversation draft disclosure and loss of B's unsent text/files.
- **Done when:** A's acceptance never changes B; A's own unsent typed/pasted text and newer attachments survive. Also test acceptance after route unmount and after returning to A.

### B03 — P2: Delayed typed acceptance deletes a newer unsent draft

- [ ] Version or snapshot the submitted draft and clear only content belonging to that accepted submission; make acceptance idempotent.
- **Requirements:** FR-SUB-002/003/008; technical design §25 invariant 12 and draft ownership contracts.
- **Evidence:** `AiChatV2Composer.vue:1393–1410` checks only the conversation draft key, then clears its entire store entry, text, files and pasted state. There is no draft revision or submitted-content comparison.
- **Reproduce:** Send `first request`; while acceptance is pending, replace the composer with `new unsent draft`; resolve the first send.
- **Observed:** The newer draft becomes an empty string. The same mechanism clears newly added files/pasted blocks. Switching away/back to the same chat does not protect a newer draft either.
- **Done when:** Acceptance consumes the submitted snapshot once without clearing edits made during normalization/IPC/approval. Test multiple outstanding sends, same-chat edits, selection round trips, files and pasted blocks.

### B04 — P2: Registry-expanded commands invoke acceptance twice

- [ ] Give acceptance a single owner for expanded commands, including image-dialog continuations.
- **Requirements:** FR-SUB-002, FR-CMD-003; design §6 submission callback contract.
- **Evidence:** `useChatCommandRouting.ts:385–400` forwards `onAccepted` into `onSlashPromptExpand`; `AiChatCenterSurface.vue:2354–2379` forwards it to `performOrdinarySend`, which invokes it at :2254. The router then returns `completed, acceptedSend:true`, and `applyCommandDisposition` invokes it again at :2086–2088.
- **Reproduce:** Registry resolves `/expand` to `submit_prompt`; return a successful durable pending receipt; count provider submission and acceptance callbacks.
- **Observed:** One `startChatRun` call but **two** acceptance callbacks. This is not evidence of two provider turns; it is duplicate draft-clear/callback side effects.
- **Done when:** Ordinary, local-command, expanded-prompt, rejected and image-dialog replay paths call acceptance exactly once on success and zero times before acceptance.

### B05 — P2: File-only send silently does nothing

- [ ] Normalize attachment-only messages into an accepted nonempty request, or explicitly reject them with a localized explanation and consistent composer affordance.
- **Requirements:** FR-SUB-001/003/005 and PRD §18 visible validation failure behavior.
- **Evidence:** `AiChatV2Composer.vue:1359–1365` deliberately allows a send with files and no text. `AiChatCenterSurface.vue:2165–2171` supplies a fallback prompt only for generated-image references/batches, not uploaded files. `src/views/store/selectedConversation.ts:475–476` returns false for empty text before enqueue or error presentation.
- **Reproduce:** Select a supported file, leave text blank and press Send.
- **Observed:** Even with successful attachment normalization, zero calls reach `startChatRun`. Draft remains, but there is no explanation.
- **Done when:** Test a supported document and image with empty/whitespace text, normalization errors, and the visible error or durable acceptance. Keep behavior consistent with the shared composer contract.

### B06 — P2: Composer Stop bypasses speech cancellation

- [ ] Route all user Stop affordances through a shared cancellation action that also cancels speech for the stopped response.
- **Requirements:** FR-VOI-009; FR-INT-005; PRD §13 single-primary-stop behavior.
- **Evidence (source-confirmed):** `AiChatCenterSurface.vue:288` binds composer `stop` directly to `selectedStore.stopActiveRun()`. The run-strip handler at :988–1011 additionally calls `resetSpeechFeed()` and `voice.stopSpeaking()`. Store `stopActiveRun` at `selectedConversation.ts:602–611` only calls `cancelChatRun`; it does not cancel a voice job. Selection changes cancel speech separately, but this path does not change selection.
- **Trigger/impact:** During a response with queued/playing speech, press the composer's Stop. Text cancellation is requested while existing speech can continue; the strip's Stop behaves differently. Batch Stop at center :1743–1745 also uses the direct store path and merits the same policy review.
- **Done when:** Test the actual composer Stop event with an active speech job, not only strip Stop or the separate Stop speaking control. Verify queued utterances and active playback cancel without losing pending messages; retain appropriate goal/loop semantics.

### B07 — P1: Orchestration rollback submits raw slash commands to the model

- [ ] Preserve command interception during rollback, explicitly reject unsupported commands, or route users to the functioning rollback command surface.
- **Requirements:** FR-CMD-001/003, FR-SUB-009; PRD §2.3 prohibition on raw command fallback; design §23.1–23.2.
- **Evidence (source-confirmed):** `AiChatCenterSurface.vue:1982–1987` calls `performOrdinarySend(text, files, ...)` immediately when `sharedOrchestrationEnabled` is false, bypassing `routeCommand`. `useWorkspaceRolloutAdapters.ts` obtains this independently configurable flag from main process.
- **Trigger:** Disable `shared_orchestration`, reload, enter `/clear`, `/goal ...`, `/skill ...` or `/loop stop`.
- **Impact:** Commands become ordinary model text. A stop/control command can appear accepted without performing its control action; raw command text may trigger unintended model/tool behavior. Busy-command rejection is bypassed too. This does not establish bypass of main-process tool authorization.
- **Done when:** Rollback tests submit actual commands while idle and busy and assert no raw-command provider call. Preserve ordinary durable queue identity and acceptance semantics.

### B08 — P2: Late errors still appear in the wrong conversation

- [ ] Apply captured owner/generation checks to every post-await error mutation, not only successful reloads.
- **Requirements:** FR-SUB-007, FR-CMD-004, FR-REC-007, FR-LIF-002.
- **Evidence (source-confirmed):** `AiChatCenterSurface.vue:2182–2187` writes attachment-preparation exceptions to the current `commandErrorNotice` before its owner check. The `/clear` port at :2382–2418 checks ownership before IPC and after successful refresh, but its null-response and catch branches write the same unscoped notice after the await. Stale-command branches at :2030 and :2366 also deliberately set a notice on the newly selected surface.
- **Trigger:** Begin attachment encoding or `/clear` in A, switch to B, then reject/return null from the pending operation.
- **Impact:** B displays A's failure; the attachment helper includes A's filename in its error text. The earlier R10 fix did not cover these branches.
- **Done when:** Delay and fail each operation across A→B and A→B→A; B's notice/draft remain unchanged, and any retained failure is scoped to A with bounded localized text.

## Incomplete implementation and requirement reconciliation

### G01 — P2: Observability is narrower than the design contract

- [ ] Implement the missing capability action counters and timing observations, or explicitly amend design §18 with the approved reduced scope.
- **Evidence:** `src/service/AIChatQueueCounters.ts:66–74` defines queue/claim/admission/provider timings, but no submit-click-to-acceptance, permission-to-resume, plan-to-continuation, selection-reconstruction or renderer-projection timings. Source search finds `ai_chat_workspace_action_total` incremented only for conversation deletion in `ai-chat-workspace-ipc.ts:659/673`, not the specified permission/plan/email/image/report/voice actions. The projection fallback counter's call at `AIChatContextAssembler.ts:935` records `lookup_error`, not specialized-result fallback by tool.
- **Requirements:** Technical design §18.1–18.3; PRD §19/20/24.
- **Done when:** Exercise success/failure/retry paths and assert bounded labels and durations; no prompts, filenames, tool arguments, credentials or content in metrics. Document where the soak consumes these observations.

### G02 — P2: Authoritative documents and “resolved by revision” audit disagree

- [ ] Reconcile the approved architecture decision into the PRD and technical design, or complete the shared orchestration they still require.
- **Evidence:** PRD §10.5/§11.2 and design §26.4 require reusable shared capability orchestration. `AiChatCenterSurface.vue` still owns submission, image preflight and plan continuation; `AiChatV2.vue` retains its own paths. The 2026-10-17 audit A01 records an owner-approved exception on 2026-10-18: workspace is authoritative and V2 is frozen rollback behavior. That exception is not incorporated into the two documents supplied for this audit.
- **Assessment:** This is a specification/implementation mismatch, not a demand to undo an existing owner decision. Names/folder layouts alone are not gaps: the implemented command composable and overlay registry can satisfy equivalent ownership where used.
- **Done when:** The authoritative documents clearly define which behavior is shared, frozen or deferred, V2 compatibility obligations, independently controlled flags and the removal gate. Add characterization for the duplicated failure paths above; update the prior audit's “only V03 remains” claim with this report's findings while preserving historical results.

## Outstanding verification and release work

### V01 — P1 release evidence: Successful voice journey is not established by the missing-runtime E2E

- [ ] Add/run the required default-route record → transcribe → auto-send → spoken-response success journey, including switching and both Stop affordances.
- **Evidence:** `test/e2e/specs/aiChatVoiceParity.test.ts:96–180` explicitly exercises missing runtime/model and expects transcription failure. That is valuable negative-path coverage, but cannot certify PRD §22.3/§23 and design §21.4 item 8. Component mocks do not establish the complete Electron success path either.
- **Done when:** Use deterministic controlled audio/runtime services for CI; retain a separately configured real audio/runtime check. Assert conversation ownership and cancellation through authoritative job state, not just button presence.

### V02 — P1 release evidence: Complete accessibility and managed-browser certification

- [ ] Verify focus entry/return/trapping and keyboard completion for each actionable dialog/card on the real default route, one-time announcements, reduced motion, and usable narrow/200% layout.
- [ ] Record the managed-browser authenticated start → handoff → verification → resume → stop journey, including timeout, stale approval and route return; separate deterministic service fixtures from live account checks.
- **Evidence:** `test/vitest/main/components/aiChatWorkspace.a11y.test.ts:15–37` labels itself an automated subset and relies on Vuetify defaults for some dialog behavior. The earlier audit's V02 explicitly leaves manual zoom unclaimed and its matrix leaves authenticated browser lifecycle partially unit-certified. These are residual certification tasks, not proof that accessibility or browser features are absent.
- **Requirements:** A11Y-001–010, FR-BRW-001–006, PRD §23.4/§28, design §16/§21.5/§26.
- **Done when:** Attach actual observations, tested platforms/assistive technologies and limitations. Reconcile the design's practical 44×44 target with the 36px strip minimum rather than claiming identical sizing contracts.

### V03 — P1 release gate: Production soak and owner sign-off remain open

- [ ] Record a rolling 14-day default-route soak with at least 500 accepted submissions, acceptance ≥99.5% excluding deliberate entitlement/validation rejections, exercised restart recovery ≥99%, and no open severity-1/2 parity defects.
- [ ] Record zero confirmed duplicate-delivery, duplicate-plan-continuation, cross-conversation-event or authorization-bypass incidents, plus product/safety/desktop/QA sign-off.
- [ ] Extend low-volume soak and preserve functional V2 rollback until a separate removal decision.
- **Requirements:** AD-009; PRD §21/24/28; design §19.5/§23/§26. Automated test counts are not soak or sign-off. This review's newly reproduced defects also preclude declaring that gate satisfied.

### M01 — P1 current worktree blocker: Concurrent merge has unresolved conflicts

- [ ] Have the merge owner resolve and verify the in-progress merge before treating the current worktree as buildable.
- **Observed state:** HEAD `4afb7abe...`, MERGE_HEAD `261022e...`; unresolved paths:
  - `src/service/toolResult/ToolResultPreviewService.ts` (markers around :59–77).
  - `test/e2e/fixtures/fakeOpenAiServer.ts` (markers around :364–385).
  - `test/vitest/main/service/StreamEventProcessorToolResults.test.ts` (markers around :173–202 and :329–349).
- **Executed failure:** Vue typechecking reported TS1185 on production and test conflict markers. These conflicts appeared after baseline checks and were not introduced by this audit.
- [ ] After merge resolution and fixes, run `yarn typecheck`, `yarn vue-typecheck`, `yarn test:components`, affected domain tests, `yarn testmain`, and `yarn test:e2e`; reconcile known unrelated failures/skips explicitly. Preserve the five reproductions as permanent regression tests alongside their fixes.

## Requirement coverage matrix

All 16 functional groups and all nonfunctional/release sections are represented. “Present” is bounded source/coverage evidence, **not** blanket completion of every requirement in that range. All rows remain subject to post-merge verification and V03.

| Requirements | Current implementation evidence | Assessment / remaining work |
| --- | --- | --- |
| FR-SUB-001–009 | Shared composer payload, attachment helper, selected store, strict start-run schema and durable queue submission | Partial: B01–B05, B07–B08. |
| FR-CMD-001–009 | `useChatCommandRouting`, center goal/skill/loop ports and schedule approval | Partial: B04/B07/B08; G02 ownership revision. |
| FR-QUE-001–014 | Start-run IPC submits through durable queue; run bridge, global scheduler, terminal gate, pending controls | Present; 87 targeted workspace tests pass, including existing bridge/scheduler/recovery coverage. No new queue defect established here; rerun after merge. |
| FR-PLN-001–009 | Decision/question/Activity surfaces; deterministic continuation identity and persisted-decision recovery | Present; prior R12 fix exists. Do not reopen it merely from the old PRD baseline. G02 and post-merge checks remain. |
| FR-PER-001–008 | Shared permission helpers, persistent grant flag, selected-store resume/deny and restored cards | Present; lifecycle/parked tests exist. No new permission bypass established. |
| FR-OUT-001–010 | Dedicated outbound review projection/card and shared authorization/delivery dialog/services | Present; prior E2E delivery/claim evidence is historical. Reverify after merge; do not infer safety from card visibility alone. |
| FR-IMG-001–015 | Center reference selection, chooser, confirmed batch, retry/stop/save; semantic image projections | Present with shared callback/draft and Stop risks B03/B04/B06; new errors can violate owner isolation B08. |
| FR-RPT-001–009 | Single-output/conversation dialogs, entitlement-independent capability checks and reported IDs | Present; existing reporting tests passed in component baseline. G02 and post-merge regression remain. |
| FR-VOI-001–010 | Shared `useAiChatVoice`, composer readiness/install/recording and output controls | Partial: B01/B02/B06; missing success-path certification V01. |
| FR-WSP-001–010 | `useConversationWorkspace`, workspace badge/setup/trust and shared memory/watch flows | Present; existing portable-memory tests passed. Reverify merged lifecycle; source-presence is not all-platform filesystem certification. |
| FR-REC-001–008 | Retry/recovery strip detail, context usage, compaction status and reconstructed runtime | Present with B08 inactive-error isolation defect. |
| FR-LIF-001–006 | Generation-filtered selected detail events, bounded summaries, stable conversation IDs and main busy-delete guard | Partial: B01/B02/B08 and draft revision issue B03. |
| FR-SKL-001–006 | Shared install card, prompt-skill invocation and Plugins manager entry | Present; rollback must not submit raw `/skill` (B07). |
| FR-BRW-001–006 | Shared start/session/handoff/approval surfaces, global/account scope and hydration | Present; full lifecycle evidence still needs V02. |
| FR-HIS-001–005 | Archive drawer, conversation-keyed selection store, opaque IDs/stable submission, acknowledgement and compaction | Present; earlier route restoration/background acknowledgement fixes exist. Post-merge checks remain. |
| FR-INT-001–005 | Portable memory/Auto Dream, workspace setup event, selected-live navigation, agent tasks/file details, reasoning control | Present; shared draft/voice/error seams remain defective as above. |
| PRD §13 presentation; AD-005/006/008 | Semantic projections, bounded transcript, dedicated cards, scoped overlay reset registry | Largely present; G02 ownership agreement and V02 focus/announcement verification. |
| PRD §14 security/privacy; design §14/25 | Main AI gate before start-run parsing, schemas, Model/Module separation, trusted image/permission/email services | Partial due to demonstrated voice isolation B01/B02 and error ownership B08; not a full repository security certification. |
| A11Y-001–010; PRD §15 | Existing keyboard/accessibility subset and Vuetify integration | Partial certification: V02. |
| PRD §16 localization; design §16.2 | Six language files, localized workspace errors and parity coverage | Present baseline; any new fix text must update all six locales. No full linguistic review claimed. |
| PRD §17 journeys / §18 failures / §23 acceptance | Existing default-route suites and newly reproduced negative cases | Incomplete: B01–B08, V01/V02, M01. |
| PRD §19 performance; design §17 | `MAX_MOUNTED_MESSAGES = 200`, event routing, batching and performance suites | Present foundation; no fresh cross-platform performance certification. |
| PRD §20/24 metrics; design §18 | Queue counters, run outcomes and partial duration observations | Partial implementation: G01. |
| AD-001–004/007/010; design §8/13 | Durable intent → claimed run mapping, source-ID identity, terminal ordering, deterministic plan continuation | Present architecture with targeted tests; no new violation established by this audit. |
| PRD §10/11 shared ownership; design §10/26.4 | Shared voice/workspace/commands/permission seams, duplicated center/V2 orchestration | G02: recorded exception versus unchanged authoritative requirements. |
| PRD §21–22 rollout/testing; design §19/21/23 | Independent adapter flags and rollback drill; existing regression suites | Partial: B07; V01–V03; current merge invalidates final-state certification. |
| PRD §25–28 / design §24–26 risks, invariants, DoD | Most mitigations implemented, but review and runtime evidence still have gaps | Definition of Done **not satisfied**. |

## Suggested order

1. Coordinate M01 with the ongoing merge owner; preserve their changes.
2. Fix B01/B02 privacy and draft ownership, then B03/B04 acceptance ownership.
3. Fix B05–B08 and add the missing negative-path tests.
4. Complete G01 and reconcile G02 without silently overriding the recorded owner decision.
5. Run post-merge gates and V01/V02, then collect V03 evidence before any V2 removal.
