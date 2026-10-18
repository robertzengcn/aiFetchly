# Workspace capability parity — implementation audit and TODO

Audit date: 2026-10-17. Worktree: `workspace-parity`.
Reviewed source: `1dbfd29dbd0279face4963705538455e5b0f6831` (clean worktree before audit).

Authorities: [PRD](./ai-chat-workspace-v2-capability-parity-prd.md) and [technical design](./ai-chat-workspace-v2-capability-parity-technical-design.md).

**Verdict: not all requirements are complete.** Most capability surfaces exist, but current code still has scheduler, lifecycle, draft and conversation-isolation defects. Shared orchestration and independent rollout controls remain incomplete. Passing unit/component tests do not establish the required Electron, accessibility, security or soak certification.

This is a documentation-only audit; no application fixes were applied. Checkboxes below represent remaining work. P1 means a blocking correctness/safety issue or release gate; P2 means a functional or architecture gap. Source-confirmed findings are distinguished from executed reproductions and unverified release evidence. Line references refer to the reviewed SHA.

## Verification performed

| Command/check | Result |
| --- | --- |
| `yarn typecheck` | Passed, exit 0 |
| `yarn vue-typecheck` | Passed, exit 0 |
| `yarn test:components` | 134 files, 1,037 tests passed |
| `yarn vitest --config vite.main.config.mjs run test/vitest/main/aiChatWorkspace` | 11 files, 55 tests passed, including its TypeScript gate |
| `yarn vitest --config vite.utilityCode.config.mjs run test/vitest/utilitycode/useChatCommandRouting.test.ts test/vitest/utilitycode/workspaceChatKeyParity.test.ts test/vitest/utilitycode/planContinuationIdentity.test.ts test/vitest/utilitycode/workspaceProjections.test.ts` | 4 files, 51 tests passed, including its TypeScript gate |
| `yarn test:e2e:collect` | Collection passed: 121 tests in 30 files. Collection is not execution. |
| Isolated actual bridge + scheduler reproduction, capacity 1, in-memory run-module substitute | Reproduced R01. A deferred run consumes capacity but never dispatches. |

Local logs are `/tmp/workspace-parity-audit-{components,typecheck,vue-typecheck,main,utility,e2e-collect}.log`. The scheduler reproducer used during this audit is `/tmp/aifetchly-workspace-scheduler-repro.cjs`, run with `node /tmp/aifetchly-workspace-scheduler-repro.cjs`; these temporary files are not committed release artifacts.

**Limits:** Full `yarn test:e2e`, all main/domain suites, live provider/audio/browser workflows, cross-platform desktop behavior and manual accessibility certification were not executed in this audit. No claim is made that those tests fail merely because they were not run. The executable R01 reproduction substitutes persistence; it is not a real-database integration test.

## Current bugs to fix

### R01 — P1: Global scheduler can admit a run that nobody dispatches

- [ ] Route every scheduler admission to its actual pending owner; preserve deferred admissions until consumed.
- **Evidence:** `src/service/AIChatWorkspaceRunDispatchBridge.ts:317–331` calls the global `scheduler.pump`, but its callback only recognizes the requested `runId`. `AIChatTurnQueueService` does not invoke the bridge's `admitDeferred` path.
- **Reproduction:** Capacity 1. Run A occupies capacity; B and C defer. Make C the selected/high-priority conversation. Complete A, then retry B. Pump admits C, but B's callback ignores it. Retry C: submission sees it already active and pump emits no new admission. C remains durably `queued` while occupying scheduler capacity. Reproducer output: B admitted=false; C admitted=false; C durable status=queued; C scheduler active=true.
- **Impact:** Accepted work stalls indefinitely and can block other conversations. Existing global-scheduler tests do not cover this deferred cross-candidate admission sequence.
- **Fix:** One admission dispatcher must deliver every pump result to the corresponding pending claim, or record consumable admitted ownership. Do not use a local boolean that discards other admissions.
- **Regression:** Real scheduler with multiple deferred conversations, selected-priority changes, FIFO within each conversation and capacity release. Assert every admitted run executes once and reaches a durable terminal state.
- **Requirements:** FR-QUE-002/010/013; AD-002/004; design §8.3.

### R02 — P1: Cancelling deferred work leaves its scheduler/run envelope alive

- [ ] Cancel and reconcile deferred envelopes when their pending message is cancelled or conversation queue is cleared.
- **Evidence:** `src/service/AIChatTurnQueueService.ts:563–569` cancels the pending row and emits its view without cancelling the deferred scheduler entry. `clearConversation` at `667–683` removes pending state without settling that envelope. The bridge exposes deferred-cancellation functionality, but these paths do not call it.
- **Trigger:** Fill capacity, enqueue a message in another conversation so it acquires a deferred envelope, then cancel it before admission. Release capacity and pump another candidate.
- **Impact:** A cancelled intent can leave a nonterminal run and orphaned capacity. Combined with R01, the scheduler can admit an entry whose pending owner no longer exists; Activity/deletion checks can also retain stale queued execution.
- **Fix:** Reconcile pending cancellation, durable run cancellation, scheduler removal and waiter bookkeeping using the same pending/run identity; make races with admission idempotent.
- **Regression:** Cancel before admission, cancel concurrent with admission, clear a deferred queue, then prove unrelated runnable work proceeds and no provider call occurs for the cancelled intent.
- **Requirements:** FR-QUE-012/013, FR-LIF-005; AD-002/004; design §8/13.

### R03 — P1: Resumed parked turns lose terminal stream publication

- [ ] Retain and flush the terminal gate for permission/question continuations after durable settlement.
- **Evidence:** `src/service/AIChatTurnQueueService.ts:918` constructs `AIChatTerminalGate` as the engine sink. The parked branch at `1045–1083` retains only run/pending IDs, holds the queue and returns. `notifyExternalTurnTerminal` at `600–625` settles the parked run but has no gate reference to flush. The resumed engine continuation retains the original sink.
- **Trigger:** Queue-backed tool turn pauses for permission or a plan question; grant/answer and allow its continuation to complete, fail or cancel.
- **Impact:** Terminal chunks remain buffered, so renderer completion/error/cancellation can fail to settle even though the resumed work has ended. The external-terminal path also uses best-effort `finishRun`, unlike the strict persistence-before-publication path.
- **Fix:** Retain the gate with parked identity, settle durably, flush once, then clean up. Preserve retry/recovery information on persistence failure. Coordinate resumed admission/capacity ownership with R01/R02.
- **Regression:** Use the actual queue, gated sink and resumed engine path, not only a bridge mock. Assert one terminal event after persistence for success/cancel/failure and none before failed persistence recovers.
- **Requirements:** FR-PER-005/006, FR-PLN-002, FR-REC-008, FR-LIF-004; design §8.4/9.3/13.3.

### R04 — P1: A late approval-mode response can change another chat's policy

- [ ] Scope approval-mode loading to selection generation and reset/block policy selection while the current conversation loads.
- **Evidence:** `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue:1646–1649` awaits `getChatV2ToolApprovalMode(id)` and assigns the result without checking the current conversation or generation. The watcher at `1690–1694` starts overlapping loads; ordinary send passes `toolApprovalMode.value` into its request at `1990`.
- **Trigger:** A uses auto-approve, B uses ask-for-approval. Delay A's response, switch to B, resolve B then A, and send in B.
- **Impact:** B's next request carries A's approval preference. This is a policy-selection defect; it does not establish that all backend permission checks can be bypassed.
- **Fix:** Capture generation/owner and ignore stale replies, including A→B→A. Hydrate correctly on mount and use a conservative pending state.
- **Regression:** Reversed promise completion, same-ID/new-generation, load rejection and send-before-load cases. Assert B never submits A's preference.
- **Requirements:** FR-SUB-007, FR-LIF-002, FR-PER-004; PRD §14.

### R05 — P1: Image completion clears references from a newer or rejected draft

- [ ] Clear only the accepted submission's reference snapshot, with matching conversation/request identity.
- **Evidence:** `AiChatCenterSurface.vue:1966–1967` sets `pendingDraftClearKey` before acceptance. The stream-status watcher at `1471–1479` clears every reference under that key on any selected-store `streaming`→`idle` transition; it does not match a run or reference snapshot.
- **Trigger:** Send image references, select a different image for the next draft while the run continues, then let the first run finish. Also exercise a rejected image follow-up while another turn is streaming, followed by a switch to an idle conversation.
- **Impact:** Unsent/new references can disappear. A selection transition can be mistaken for the submitted turn's completion.
- **Fix:** Tie removal to authoritative acceptance/acknowledgement and the submitted snapshot, preserving references added afterward. Retain selections on pre-acceptance failure and isolate selection changes.
- **Regression:** Edit tray during run; rejected queued send; A streaming→B idle; delayed completion after A→B→A; multiple accepted image submissions.
- **Requirements:** FR-SUB-002/003, FR-IMG-002/015, FR-LIF-002.

### R06 — P2: History chips do not restore on a route remount

- [ ] Initialize the center's history working copy from the store on mount as well as selection changes.
- **Evidence:** `AiChatCenterSurface.vue:2243` initializes `selectedContextItems` to `[]`; its restoration watcher at `2357–2377` is not immediate. `performOrdinarySend` reads this local array when building `historySelectionIds`.
- **Trigger:** Select archive passages in A, navigate to another center page, then return without changing the selected conversation.
- **Impact:** The Pinia draft still exists, but chips are invisible and the next send omits them. Store persistence alone does not satisfy route restoration.
- **Fix:** Initialize through a shared store-derived/computed value or an immediate owner-safe restoration path, retaining the existing submission ID.
- **Regression:** Mount with pre-existing store selections; route away/back; send and inspect opaque IDs and unchanged retry identity; mixed acknowledgement still removes only accepted chips.
- **Requirements:** FR-HIS-002/004/005; AD-005; acceptance 32/36.

### R07 — P2: Changing conversation or stopping text generation does not cancel speech

- [ ] Explicitly cancel selected-conversation speech on selection changes and Stop.
- **Evidence:** `AiChatCenterSurface.vue:957` handles Stop without `voice.stopSpeaking`; the voice watchers at `1704–1745` feed or complete speech, and non-streaming state calls `completeAssistantResponse`. The only direct stop-speaking binding is the explicit speech control at `294`; unmount disposal is separate. `useAiChatVoice.ts` has no conversation-selection subscription.
- **Trigger:** While A has playing/queued spoken output, switch to B without unmounting the center, or Stop A's text run.
- **Impact:** A's speech can continue in B; completing the response flushes text rather than cancelling it.
- **Fix:** Cancel playback and invalidate stale speech feed identities on selection/Stop, while preserving background text execution on selection changes.
- **Regression:** Real controller/queue spies prove active audio and queued utterances stop, late A deltas cannot restart speech in B, and B's new response still follows its policy.
- **Requirements:** FR-VOI-008/009, FR-LIF-001.

### R08 — P2: A late image-export response opens workspace setup in the wrong chat

- [ ] Scope export notices and setup actions to the captured export owner.
- **Evidence:** `AiChatCenterSurface.vue:1525–1544` awaits export for `conversation`, then calls `onRequestWorkspaceSetup()` and writes global notices. That setup method at `837–843` reads the currently selected conversation.
- **Trigger:** Save an image in A, switch to B before A returns `workspace_required`.
- **Impact:** B's setup dialog opens for A's pending export, and B can receive A's export outcome/filename notice. The export request itself remains addressed to A; this is incorrect follow-up UI ownership.
- **Fix:** Queue setup/notice against A and show it only when A is selected; retain pending export across appropriate route lifetimes.
- **Regression:** Delayed success, workspace-required and failure after A→B, then return to A and finish setup/export exactly once.
- **Requirements:** FR-IMG-013/015, FR-SUB-007, FR-LIF-002, FR-INT-002.

### R09 — P2: Loop commands silently discard attachments and hide control failures

- [ ] Reject unsupported loop payloads before staging/execution, and return failed command disposition for failed controls.
- **Evidence:** `src/views/composables/aiChatWorkspace/useChatCommandRouting.ts:407–439` handles loop commands without checking `options.files` or preserving pasted bodies in staged work. `runScheduledLoopControl` at `273–283` ignores null responses and catches exceptions, then returns `completed`. The center at `1835–1865` accepts staged/completed dispositions, clearing the full composer draft.
- **Trigger:** Attach a file to `/loop 2` or a valid scheduled `/loop` command. Separately, return null/throw for `/loop pause`, `/loop resume` or `/loop stop`.
- **Impact:** Attachments can disappear without entering any request; failed controls appear accepted and erase retryable input. In particular, a failed stop may leave the schedule running without an actionable error.
- **Fix:** Explicitly reject payloads unsupported by the loop contract, or define/persist their supported channel. Validate control responses, show localized errors and retain draft on failure. Do not treat opening approval as durable persistence.
- **Regression:** Loop variants with files/pasted blocks; failed control retains draft and shows error; successful control updates only its owner; cancelled/failed approval has a defined draft recovery path.
- **Requirements:** FR-SUB-001–005, FR-CMD-004/007/008; PRD §18.

### R10 — P2: Some command error and reload paths still target the current selection

- [ ] Finish owner/generation checks after asynchronous command operations.
- **Evidence:** Prompt-skill failure calls `ports.setError(message)` without origin at `useChatCommandRouting.ts:510–517`; goal-loop start failure does likewise around `258–266`. The center's port only filters when an origin is supplied. `/clear` checks selection before awaiting, then unconditionally reloads `targetConversationId` after clear/bootstrap (`AiChatCenterSurface.vue:2130–2145`). It also ignores a null clear response and swallows exceptions; the router reports it accepted.
- **Trigger:** In A, start a delayed failed `/skill` invocation or goal-loop start; switch to B before resolution. For `/clear`, switch while the clear IPC is pending.
- **Impact:** B can show A's command error. A late clear refresh can load A into the selected store after B was selected. Failed clear can consume the command without useful retry feedback.
- **Fix:** Pass captured owner and selection generation through all callbacks, recheck after every await before presentation changes, and propagate a typed success/rejection result from clear.
- **Regression:** Failed skill/loop after switch; clear resolving after B selection; null/throw clear; A→B→A generation changes. Assert no stale errors, snapshots or acceptance callbacks affect B.
- **Requirements:** FR-CMD-004/008/009, FR-SUB-003/007, FR-LIF-002.

### R11 — P2: Rollback Chat V2 still clears drafts before validation/acceptance

- [ ] Move Chat V2 onto the same accepted-send contract and retain failed drafts.
- **Evidence:** `src/views/components/aiChatV2/AiChatV2.vue:4375` calls `options?.onAccepted?.()` before `/goal` validation, skill acknowledgement, attachment preparation or durable send. Later failure returns do not restore the composer draft. The shared composer actually clears text/files/paste in that callback (`AiChatV2Composer.vue:1396–1407`).
- **Trigger:** On rollback surface send `/goal` without an objective, a missing `/skill`, an invalid attachment or a request rejected by IPC.
- **Impact:** Retryable user input is lost. This was identified as an unacceptable reference behavior in the PRD baseline and remains present.
- **Fix:** Acceptance must follow successful command acceptance or durable enqueue; unify with the workspace submission contract rather than preserving this reference bug.
- **Regression:** Both surfaces retain text/files/paste/images/history on validation/transport/queue rejection and clear exactly once on acceptance.
- **Requirements:** Acceptance 36; PRD §3.4, §10.5, DoD 2; FR-SUB-002/003.

### R12 — P1: Plan continuation recovery still has a commit-to-response crash gap

- [ ] Persist or reconstruct continuation intent authoritatively with the plan decision.
- **Evidence:** `AiChatCenterSurface.vue:2707–2749` awaits the decision response before saving the continuation intent in localStorage. Recovery at `2668–2683` reads that saved intent. `src/main-process/communication/ai-chat-v2-ipc.ts:1806–1812` persists and returns the approved plan without creating the continuation intent in the same durable operation.
- **Trigger:** Main commits approval, but its reply is lost or the renderer crashes before `savePlanContinuationIntent`. Reopen the conversation.
- **Impact:** The plan is approved, but no queued continuation and no renderer retry intent exist. Deterministic continuation IDs prevent duplicate accepted intents; they do not recover an intent that was never recorded.
- **Fix:** Store decision plus continuation intent atomically in main, or reconcile persisted transitions against their deterministic pending IDs on restart/reselection. Preserve rejected/change-request feedback and never execute uncommitted decisions.
- **Regression:** Fault injection after decision commit but before IPC reply and before renderer storage write. Reopen and prove one recoverable/executable continuation, no duplicate decision and no duplicate provider turn. This crash boundary was source-inspected, not fault-injected during this audit.
- **Requirements:** FR-PLN-005–008; AD-007; acceptance 12.

### R13 — P2: Background history acknowledgements do not reconcile stored chips

- [ ] Reconcile history acknowledgements against conversation-keyed state outside the selected center's lifetime.
- **Evidence:** `AiChatCenterSurface.vue:2385–2430` resolves submission identity but skips chip changes when the acknowledged conversation is not selected; its acknowledgement listener is center-mounted near `2975`. The selected store drops foreign detail events at `selectedConversation.ts:263–266`. No corresponding background chip update is performed by this path.
- **Trigger:** Queue a history-context message in A, switch to B or leave the center before A dispatches and acknowledges accepted/changed/rejected IDs, then return to A.
- **Impact:** Already-consumed chips can reappear, changed/rejected flags are missed, and a later message can resend stale context. Fixing R06 alone makes restoration visible but does not resolve the missed acknowledgement.
- **Fix:** Apply acknowledgement results to the originating conversation's store at application lifetime, without exposing private background detail to B, or fetch authoritative acknowledgement state when restoring A.
- **Regression:** Background queued start, route-unmounted start and mixed acknowledgement; returning to A restores only the appropriate remaining chips and submission identity. Source-confirmed lifecycle gap; full queued Electron reproduction remains to be added.
- **Requirements:** FR-HIS-003/004; FR-LIF-004; AD-005.

## Architecture work still incomplete

### A01 — P2: Shared orchestration is not complete despite the older checked G01

- [ ] Complete shared ownership for submission, commands, plans, image preflight and reporting where behavior is duplicated, or obtain an explicit revision to the requirements.
- **Evidence:** Workspace uses `useChatCommandRouting`; `AiChatV2.vue` still imports/parses goal/loop itself (`832–835`, `4356`, `4422`) and owns a separate `onSend`. The center still implements `performOrdinarySend`, image preflight and plan continuation itself. Shared voice/workspace, permission helpers and overlay registration are real progress and should be retained.
- **Consequence:** R09–R11 illustrate actual behavior drift, not merely a filename/style disagreement. A shared overlay reset registry is not evidence that all capability orchestration is shared.
- **Acceptance:** Both surfaces consume the same typed behavioral contracts and run failure/ownership characterization tests. Do not copy the center wholesale into V2.
- **Requirements:** PRD §10.5/11.2/28.2; design §10.1; AD-005/008.

### A02 — P2: Required independent rollout controls are coupled

- [x] Implement independently controllable shared-orchestration, specialized-result, voice/memory and V2 visibility adapters, or explicitly revise design §23.1. **DONE (2026-10-18):** commit 24386459 implements three presentation/dispatch adapters (`shared_orchestration`, `specialized_results`, `voice_memory`) as one independently togglable flag each, default ON, riding the existing workspace flag IPC channel (`GET_FLAG` returns `{enabled, explicit, adapters}`; `SET_FLAG` routes a `feature` name to its own Token key). V2 visibility stays the documented inverse-of-redesign control (`isChatV2DockVisible()`), revised explicitly per the audit's second option. Renderer rollback drill: commit a546beaa (six Electron E2E scenarios through the real renderer→preload→ipcMain channel, `test/e2e/specs/workspaceRolloutDrill.test.ts`); adapter gating in `useWorkspaceRolloutAdapters` (AiChatCenterSurface send path skips command routing when shared orchestration is off; profiled plan decision/approval cards remain deliberately ungated; artifacts panel falls back to a localized notice — caught a raw-key i18n leak, fixed in six languages).
- **Evidence:** `src/service/AIChatWorkspaceRollout.ts:26–32` explicitly says these surfaces share the workspace-visibility flag and separately flaggable adapters are follow-up. Its enum only defines Queue, Steering and WorkspaceRedesign. `isChatV2DockVisible()` is the inverse of redesign rather than an independent control.
- **Additional integration risk:** `AuthenticatedWorkspaceLayout.vue:187–194` writes redesign=true on mount, whereas the shell boundary is controlled by the separate localStorage `innerPageShellV3` flag. A main-process flag-only rollback drill does not verify the actual renderer rollback sequence. Test both settings and ensure an operator's rollback choice is not overwritten by mounting the workspace. **RESOLVED:** 5607302e (mount never overwrites explicit) + a546beaa E2E proves reload/remount preserves an explicit rollback and the legacy dock stays reachable via the shell-boundary toggle.
- **Acceptance:** Toggle each specified capability independently through the actual renderer; preserve pending/run identities, tokens and queue cancellation; restore workspace without duplicate work. Verify the real V2 entry remains reachable. **MET:** drill scenario 4 rolls back shared orchestration while a pending queue carries work — pending identity, stop, single clean resume and no duplicate dispatch after re-assert; scenario 3 restores the workspace without duplicate DEFAULT writes; scenario 2 opens `ai-chat-root` after the rollback.
- **Requirements:** Technical design §23.1–23.3; PRD §21; AD-009.

### A03 — P2: Reconcile stale audit completion claims

- [ ] Update the earlier TODOs after implementing/verifying this follow-up.
- The Oct 14 audit now checks G01/G03 as complete while its prose still describes unfinished extraction and coupled flags. Its coverage table also retains descriptions of bugs subsequently fixed. The older parity TODO has the same historical-baseline problem.
- Treat those files as historical remediation records, not current acceptance evidence. This audit reopens specific remaining requirements; it does not refile all old B01–B16 issues as unfixed.

## Release and verification TODOs

### V01 — P1 release gate: Complete default-route Electron acceptance

- [ ] Enable and execute generated-image batch scenarios. `test/e2e/specs/ai-chat-generated-image-batch-live.test.ts:73` still unconditionally calls `test.skip(true, ...)` with an obsolete claim that the batch surface is absent. Cover ordered confirmation, partial success, retry failed only, Stop, trusted Save and subsequent reference use.
- [ ] Add successful reporting and AI-disabled-but-reporting-enabled journeys. `conversationReport.spec.ts:1–14,80,95` explicitly limits coverage to disabled capability. Its helpers at `33–69` still accept the V2 dock. Prove consent, exact eligible evidence, limits, privacy and marked report reference through the workspace.
- [ ] Certify plans/questions and permissions across grant-once, persistent grant, deny, stale/null/failed decisions, reload, parked continuation and exactly-once execution. Include R03/R04.
- [ ] Certify slash/goal/scheduled-loop/skill flows with attachments, failed IPC, duplicate clicks, scope changes and approval cancellation. Include R09/R10.
- [ ] Certify managed-browser takeover/login verification/resume/expiry/stale actions/reload with inspector closed. `managedBrowser.test.ts:34` remains opt-in and its single journey at `46` is start/action/stop, not the full parity contract.
- [ ] Certify voice recording/transcription/policy/playback and missing runtime/model/permission-denied paths; explicitly test R07.
- [ ] Extend history coverage for mixed accepted/changed/rejected IDs, stable retry, route restoration, bounded navigation and failed/cancelled compaction under both flag states. Existing recoverable-history specs are useful partial coverage, not proof of these cases.
- [ ] Execute outbound review→exact-draft approval→claim→terminal tests and add duplicate-click/expired authorization/persistent receipt cases where absent. Existing `outbound-email-review.test.ts:218,242` already covers review visibility and delivery-unknown; do not label the feature unimplemented.
- [ ] Execute all eight queue/steering cases and add R01–R03 real integration cases. Existing queue helpers correctly require `workspace-transcript`, but navigate directly to `/aiworkspace`; separately assert `/` redirects there.
- [ ] Certify workspace choose/change/remove, canonical trust, scoped suggestions/watchers, portable-memory conflicts/stale edit/Auto Dream, selected-live navigation and exact task cancellation through the default surface.
- **Exit evidence:** Source SHA, exact commands/environment, passed/failed/skipped counts, artifacts and any explicitly approved manual alternative for every PRD acceptance criterion. A collected test or passing legacy-dock fallback is not workspace certification.

### V02 — P1 release gate: Security, localization and accessibility

- [ ] Complete integration security verification for AI-first gating, strict IPC input, permission owner, trust/path validation, exact outbound revision, image ownership/staging, report privacy and bounded background summaries. R04 is a specific blocking policy-isolation defect; this audit is not an exhaustive security certification.
- [ ] Run six-language runtime/error checks for all touched capability states. The current workspace key-parity test passed, but key presence does not establish accurate translations or mapped error behavior in every path.
- [ ] Certify A11Y-001–010: keyboard completion, focus entry/return/traps, one-time announcements, non-color states, reduced motion, touch targets, narrow/200% layouts, and hidden reasoning excluded from accessibility output. Existing shell keyboard tests are partial evidence.
- [ ] Run all affected domain/main suites and the full required E2E gate after fixes. Keep the already passing type/component gates green.

### V03 — P1 release gate: Soak and explicit owner sign-off

- [ ] Record default-route soak and product/safety/desktop/QA approval; no qualifying evidence was established by this audit.
- [ ] Before any separate V2 removal: rolling 14 days, at least 500 accepted workspace submissions, acceptance ≥99.5% excluding deliberate validation/entitlement rejects, exercised queue recovery ≥99%, no open severity-1/2 parity defects and zero specified duplicate delivery/continuation, cross-conversation or authorization-bypass incidents.
- [ ] Extend low-volume soak rather than weakening incident gates; keep rollback available. This is missing certification evidence, not a claim that production incidents occurred.

## Requirement coverage matrix

Every functional requirement range in the PRD is represented below. **Present** means reachable code exists, not that all acceptance cases passed. **Partial** identifies a current defect or incomplete required integration. **Unverified** means certification evidence is outstanding, not necessarily missing implementation. All groups remain subject to V01–V03.

| Requirement range | Assessment and evidence | Remaining work |
| --- | --- | --- |
| FR-SUB-001–009 | Partial: full workspace payload, shared attachment builder, durable enqueue, busy ordinary sends and command routing present | R04/R05/R09/R10/R11; A01; V01 |
| FR-CMD-001–009 | Partial: registry, goal, skill and schedule approval wired; loop payload/failure and callback ownership gaps | R09/R10; A01 |
| FR-QUE-001–014 | Partial: durable acceptance, FIFO, steering, hold/recovery and localized limits present; deferred scheduling/cancellation breaks completion | R01–R03; V01 |
| FR-PLN-001–009 | Partial: decision/question/receipt and deterministic continuation/recovery code present; question terminal publication and committed-decision recovery gap remain | R03/R12; A01; V01 |
| FR-PER-001–008 | Partial: actionable shared grant/deny/persistent path present; resumed terminal and loaded policy isolation defective | R03/R04; V01/V02 |
| FR-OUT-001–010 | Present: dedicated batch surface, shared review/authorization/delivery path and delivery-unknown E2E specification | V01/V02 full certification |
| FR-IMG-001–015 | Partial: tiles/tray/inference/chooser/confirmation/batch retry/stop/save wired; draft clearing/export ownership defective | R05/R08; A01; skipped batch E2E in V01 |
| FR-RPT-001–009 | Present: per-output and conversation dialogs, capability checks and session marking; successful default-route end-to-end proof missing | A01; V01/V02 |
| FR-VOI-001–010 | Partial: shared `useAiChatVoice`, composer readiness/install/transcription/policy controls present; switch/Stop cancellation missing | R07; V01 |
| FR-WSP-001–010 | Present shared workspace/trust/watcher/memory surfaces, with export-triggered setup ownership gap | R08; V01/V02 |
| FR-REC-001–008 | Partial: retry/recovery detail, compaction/context and bounded summaries present; parked terminal reconstruction broken | R03; V01 |
| FR-LIF-001–006 | Partial: store generation filtering and background ownership present; async preference/command/image and parked/deferred lifecycle gaps | R01–R10 as applicable |
| FR-SKL-001–006 | Present installation card/manager and prompt-skill path; failed invocation error ownership incomplete | R10; V01 credential/stale/duplicate/reload tests |
| FR-BRW-001–006 | Present start/session/handoff shared UI and explicit global/account scope | V01 full intervention lifecycle |
| FR-HIS-001–005 | Partial: drawer/opaque IDs/acknowledgement/store/compaction present; route restoration and background acknowledgement gaps | R06/R13; V01 mixed-ack/retry/flags |
| FR-INT-001–005 | Present portable memory, composer workspace setup, live navigation guard, task cancel, reasoning/recovery controls | R08; V01 integration certification |
| A11Y-001–010; PRD §16 | Partial automated foundation and passing workspace key-parity test | V02 manual/runtime completeness |
| AD-001–004 | Partial durable identity/bridge/scheduler exists, but capacity/cancellation/parked terminal composition fails | R01–R03 |
| AD-005 | Partial store ownership; history restoration and image draft lifecycle gaps | R05/R06; A01 |
| AD-006 | Pure specialized history/live projections and tests present | V01 equivalence/reload certification |
| AD-007 | Deterministic plan identity and recovery store present; identity tests pass, commit-to-response recovery remains incomplete | R12; V01 exactly-once full journey |
| AD-008 | Shared selection-bound overlay registry is used on both surfaces; remaining behavior extraction incomplete | A01; V02 focus/ownership certification |
| AD-009/010; design §23 | Soak unverified; shipped integrations largely wired; independent rollout adapters incomplete | A02; V01–V03 |
| PRD §19/20; design §17/18 | Bounded history, summary routing, batching, counters and performance tests exist; this audit did not certify every metric/resource limit | R01/R02 capacity; V01/V02 performance/privacy evidence |
| PRD §28 / design §26 Definition of Done | Not met despite passing static/component/selected unit gates | Resolve bugs, A01/A02 and V01–V03 before declaring parity |

## Remediation addendum (2026-10-18 session)

- R01–R06, R08, R12 were remediated in earlier commits on this branch
  (dd38eb9d, 2a76291f, a26d20b6, 0aeee490, 212e3519/89588306/de912e48,
  6a04807a/f9b066b6, 076b910d, d62ab9de).
- R07 (speech cancellation on switch/Stop): c10e44cd.
- R09 (loop attachments + control failures): e3fb90bc.
- R10 (command error//clear ownership): a71a9f2c.
- R11 (V2 accepted-send contract): 8d50cd25-era commit series — see
  `AiChatV2.acceptedSendContract.test.ts`.
- R13 (background acknowledgement reconciliation): 46e613d3.
- A02 partial: mount-time shell enforcement never overwrites an explicit
  rollback (5607302e). The remaining §23.1 independent adapters stay open.
  **DONE (2026-10-18):** independent adapters + renderer drill shipped in
  24386459 (adapters, Token keys, flag IPC `{enabled, explicit, adapters}`,
  composable + gating) and a546beaa (six-scenario renderer rollout drill
  E2E + six-language artifacts fallback notice). A02 P2 is closed.
- Verified review fixes landed alongside: preload invoke-allowlist gaps
  (AGENT_TASK_CANCEL + platform/social/login/paste channels) with a
  source-scan parity guard, the (owner, sourceId) run index, the
  AgentRuntime abort-map leak,   static guidance for PREPARATION_FAILED/
  DISPATCH_PROMOTE_FAILED, and the shared image-URL allowlist.
- Still open: A01 (full shared orchestration / V2 extraction — owner
  decision, dev's generator-streaming `dispatchQueuedTurn` seam stays
  dormant in the queue service pending the choice), V01/V02/V03
  release gates.

## Suggested execution order

1. Fix R01–R04 and R12 with real scheduler/parked-continuation/selection/crash tests; they can stall work or select the wrong approval policy.
2. Fix R05–R11 and R13 with focused renderer regressions, six-language error strings where needed, and per-logical-unit commits.
3. Complete A01/A02 without regressing shared voice/workspace/permission infrastructure; reconcile historical TODOs (A03).
4. Execute V01/V02, publish requirement-by-requirement evidence, then complete V03. V2 removal remains a separate decision.
