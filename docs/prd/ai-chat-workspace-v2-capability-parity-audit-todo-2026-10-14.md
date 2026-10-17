# Workspace / Chat V2 capability parity — current audit and TODO

Audit date: 2026-10-14  
Audited branch: `workspace-v2-capability-parity`  
Audited source HEAD: `db58c9a2627c2697fe54d79d903f7093b6adf4ba`  
Worktree: `/home/robertzeng/project/aiFetchly/.worktrees/workspace-parity`

## Verdict

**No: all requirements are not implemented, and bugs remain.** Most capability surfaces are present, and the recent fixes materially improve the implementation. However, global scheduling, durable run lifecycle, conversation isolation, plan continuation recovery, attachment parity, and release verification still have concrete gaps.

**Remediation status (2026-10-14 session, branch `workspace-v2-capability-parity`): all B01–B16 defect items are now implemented with tests (see "Remediation evidence" below); G01/G03/G04 are partially complete; G02 has first E2E evidence (8/8 queue scenarios on the default route); G05 soak/sign-off remains open. The remaining G02 journeys, full V2-extraction (G01), rollback drill (G03), and manual security/A11Y certification (G04) are still required before a parity release.**

**Update (2026-10-17 session): the G03 rollback drill is complete (`aiChatWorkspaceRollbackDrill.test.ts` — full flag rollback to the Chat V2 dock state preserves pending rows, run identities/source ids, parked state, and sanitized views; re-enable re-claims the same envelope idempotently; `isChatV2DockVisible` names §23.1's fifth control). G02 additionally certified: recoverable-history 6/6, outbound 2/2, conversation-report 2/2, toolApproval 3/3, skill-runtime flows 4/4 (cases 9–12 incl. post-compaction reattach and FR-25 legacy delegation), and image-roundtrip 5/5 — all on the default route. Six specs still awaiting G02 retarget fail on removed legacy-dock locators (`ai-chat-root`/`ai-chat-toggle`: generated-image-editing 2, aiChatOutputActions 2, skillAcceptance 2, toolResultLifecycle 1 — verified pre-existing, failing identically before this session's fake-server fixes). G01's remaining V2-extraction is a product decision (freeze V2 as the rollback surface vs. extract shared orchestration onto it) requiring owner approval per DoD 2; it is not completable unilaterally.**

This is a fresh audit of the current source, not a repetition of the earlier audit. It supersedes the current-status claims in [the historical TODO](./ai-chat-workspace-v2-capability-parity-todo.md), whose header says T1–T9/D1–D8 are implemented while its preserved tables still describe the old source. In particular, adding the run-dispatch bridge did **not** complete global scheduling or all lifecycle integration.

The two user-supplied documents in `/home/robertzeng/project/aiFetchly/docs/prd/` were compared with the worktree copies; both are identical:

- [PRD](./ai-chat-workspace-v2-capability-parity-prd.md)
- [Technical design](./ai-chat-workspace-v2-capability-parity-technical-design.md)

Scope: source and test review, fresh type/component/focused main-process checks, E2E build and one attempted queue journey. This is not a claim that all runtime paths were executed or that no additional bugs exist. Application source was not changed during this audit.

Priority: **P1** = fix before parity release (execution, data/lifecycle correctness, or a hard release blocker); **P2** = functional or contract gap that still needs completion. An unchecked item is open. Source references below are relative to this worktree and refer to the audited HEAD.

## Remediation evidence (2026-10-14 session)

Worktree HEAD advanced past `db58c9a2` with one commit per item below (see `git log --oneline`). Each item ships with unit/component coverage; type/component gates re-verified at the end.

| Item | Fix | Evidence |
| --- | --- | --- |
| B01 | Single sanitized-env construction (all args) + `test:e2e:collect` CI gate | `playwright --list`: 121 tests / 30 files; duplicate-`LaunchOptions.extraEnv` removed |
| B02 | Bridge admits through the shared scheduler singleton; deferred (age-preserved) re-drain on capacity-free | `aiChatWorkspaceGlobalScheduler.test.ts`: 4th general run waits; browser-capacity + steering-exclusion cases |
| B03 | Main `getConversationBusyReason` (coordinator/engine/pending/run) + header disable + center busy guard | `AiChatConversationHeader.test.ts` (9) |
| B04 | Parked-run continuation map settled by `notifyExternalTurnTerminal`; correct `awaiting_permission` vs `awaiting_user`; promotion failure settles `failed` | `aiChatWorkspaceParkedLifecycle.test.ts` (3): grant/cancel/plan/promote-failure, followers held/drained |
| B05 | `AIChatTerminalGate` buffers terminal sink events; `finishRunStrict` gates publication/advance; reconcile path on DB failure | `aiChatWorkspaceTerminalOrdering.test.ts` (3) |
| B06 | Real bridge run ID in sink identity + SELECT durable fallback (`effectiveRuntime`) + bounded background summaries | `aiChatWorkspaceRunIdentity.test.ts` (2) |
| B07 | Store origin guard; router transport-failure `acceptedSend:false`; origin-scoped receipts/errors | `selectedConversation.crossConversation.test.ts` (3) + router transport test |
| B08/B09 | `planContinuationStore` intent + retry banner; target-bound sends; post-hash revalidation; 6-lang keys | `planContinuationStore.test.ts` (3) |
| B10 | Center uses shared `buildUploadedAttachments`; failures retain draft | `attachmentBuilderParity.test.ts` (5) |
| B11 | Generic dispatches own command+files; files preserved through expansion; non-expansion outcomes reject explicitly | Router tests (33 total incl. new file cases) |
| B12 | Deny via `denyChatV2ToolPermission` first (`handled` honored), interactive stop fallback | Permission store tests (9 incl. 3 new) |
| B13 | `navigateToHistorySource` bounded paging (cap retained), safe unavailable, abort on switch | `historyNavigate.test.ts` (4) |
| B14 | Payload-hash retry identity (rotate on acceptance) + `historySelection` pinia store | Retry-identity (5) + history store (4) tests |
| B15 | `[CODE]` preservation in `userSafeError`; central renderer map; 18 `workspaceChat.errors.*` keys × 6 langs | Mapper (4) + localization (3) + localized-rejection tests; key parity verified |
| B16 | Scope chip + hint on the session card; 6-lang keys | Card test (+1); key parity verified |
| G01 (partial) | `useConversationScopedOverlays` + center migration of report/staging/image resets | Composable tests (4); center suite 75 green |
| G02 (partial) | Queue spec requires `#/aiworkspace` + `workspace-transcript`; **8/8 queue scenarios PASS** on the default route with the remediation bundle (`xvfb-run`, ~2.8 min); shell spec 6 pass / 1 flaky-pass-on-retry / 1 environmental bounds failure (1184 vs 1280 under 1280x960 xvfb) / 2 live-skipped | Build + run logs in session |
| G03 (partial) | §18 counters (submission/run/action/fallback/stale), dispatch timings, `AIChatWorkspaceRollout` flags | `aiChatWorkspaceObservability.test.ts` (4) |
| G04 (partial) | History paging moved to `AIChatConversationModule`; SELECT uses `effectiveRuntime` | `tsc` clean |

**Still open:** full V2 shared-extraction (G01); batch/reporting/outbound/plan/slash/skill/browser/history/voice/memory E2E journeys (G02); rollback drill + remaining §23.1 adapters (G03); security review + manual A11Y certification (G04); soak + sign-off (G05).

## Verification performed

| Check | Fresh result |
| --- | --- |
| `yarn typecheck` | PASS, exit 0 |
| `yarn vue-typecheck` | PASS, exit 0 |
| `yarn test:components` | PASS: 124 files, 989 tests |
| Focused `yarn testmain --run …` | PASS: 8 files, 70 tests |
| `yarn build:e2e` | PASS |
| Locale object inspection (TypeScript transpilation + key comparison) | PASS for `workspaceChat`: 151 identical key paths in en/zh/es/fr/de/ja; `aiChatV2.cancel` present and translated in all six. This does not certify all rendered/error text. |
| `yarn playwright test test/e2e/specs/aiChatQueueSteering.test.ts --grep '1. queues B' --max-failures=1` | FAIL during test collection at audit time: duplicate `const env` in shared Electron fixture; no scenario executed (B01) — **remediated since: B01 fixed, full queue spec 8/8 PASS on the default route (see Remediation evidence)** |
| Full `yarn testmain`, full `yarn test:e2e`, complete module/security/accessibility certification | Not executed/certified by this audit |

The focused main-process files were:

```text
test/vitest/main/aiChatWorkspaceCoordinator.test.ts
test/vitest/main/aiChatWorkspaceIntegration.test.ts
test/vitest/main/aiChatWorkspaceRunDispatchBridge.test.ts
test/vitest/main/aiChatWorkspaceStartRunSchema.test.ts
test/vitest/main/aiChatPendingHistoryContext.test.ts
test/vitest/main/aiChatPendingMessageIpc.test.ts
test/vitest/main/service/AIChatTurnQueueService.test.ts
test/vitest/main/agentTaskCancel.test.ts
```

Temporary command logs are `/tmp/workspace-parity-audit-{typecheck,vue-typecheck,components,main,e2e-build,e2e}.log`. They are local audit artifacts, not committed evidence dependencies. The failure and counts are recorded here so this report remains useful without them.

## Confirmed defects and incomplete behavior

### B01 — P1: Electron E2E suite cannot load

- [x] Fix the duplicate variable declaration in the shared launch fixture.
- **Evidence:** `test/e2e/fixtures/electronApp.ts:229` declares `const env`; line 233 declares it again in the same function. The attempted queue journey fails with `Identifier 'env' has already been declared. (233:8)` before launching Electron.
- **Impact:** The hard release gate is broken, not merely awaiting a packaged-app environment. Type checks did not detect it because `tsconfig.json` excludes `test/e2e`.
- **Work:** Keep one sanitized-environment construction with all required arguments (`initialMaximized`, `hubBaseUrl`), then apply explicit test extras once. Add test-fixture compilation/collection to CI.
- **Acceptance:** Test discovery succeeds, the targeted queue journey runs, and the required full E2E suite completes with explicit pass/skip counts. A successful build alone is insufficient.
- **Requirements:** PRD §22.3–22.4, DoD 4–5; design §21.4.

### B02 — P1: Ordinary queue dispatch bypasses global scheduler limits

- [x] Admit queue heads through the shared global execution scheduler.
- **Evidence:** `src/service/AIChatTurnQueueService.ts:578` acquires a conversation lease; lines 591–595 call the bridge; line 674 directly calls the engine. `src/service/AIChatWorkspaceRunDispatchBridge.ts:77` creates/reuses a run and immediately transitions it to running. It never uses `AIChatExecutionScheduler`. Production queue wiring at `src/main-process/communication/ai-chat-v2-ipc.ts:588` supplies no scheduler admission.
- **Trigger:** Submit long-running ordinary messages in four different conversations. Their per-conversation leases do not conflict, so all can dispatch despite general scheduler capacity three.
- **Impact:** Ordinary interactive work bypasses resource limits and fairness relative to other owners. The claimed queue/run integration is incomplete.
- **Work:** Make the bridge compose pending head, global admission, run identity and conversation lease; promote/execute after admission; release capacity on all outcomes and preserve scheduling age on requeue.
- **Acceptance:** Deferred-engine integration test proves the fourth general run waits until a slot frees. Add resource-class and competing-owner cases; steering-consumed messages must never enter admission.
- **Requirements:** FR-QUE-010; AD-002/004; design §8 and invariant 2.

### B03 — P1: A running ordinary conversation can be deleted

- [x] Protect deletion using authoritative queue/engine/run ownership, with matching UI disablement.
- **Evidence:** `src/main-process/communication/ai-chat-workspace-ipc.ts:503` checks only `getAiChatWorkspaceCoordinator().getLiveRuntime`. Ordinary sends now use the queue and never populate that coordinator's `liveRuns` map (`src/service/AIChatCoordinator.ts:322`). The header Delete item (`AiChatConversationHeader.vue:95`) and center handler (`AiChatCenterSurface.vue:2458`) have no equivalent busy protection. `AIChatConversationModule.ts:284` proceeds to delete.
- **Trigger:** Start an ordinary streamed answer, select Delete, confirm while it runs.
- **Impact:** Content can be deleted while the engine or queued follow-ups can subsequently persist more content, undermining deletion and potentially resurrecting the conversation.
- **Work:** Enforce a main-process guard coordinated with dispatch, covering running, parked and pending execution; disable unsafe UI actions. Do not rely on renderer state alone.
- **Acceptance:** Start through the real workspace START_RUN queue path, hold the engine, assert delete is denied and storage unchanged. Repeat for permission waiting and pending dispatch; permit deletion only after execution can no longer write.
- **Requirements:** FR-LIF-005.

### B04 — P1: Parked and pre-turn-failed runs leave stale durable envelopes

- [x] Settle the same durable run after permission/question continuation and every pre-turn failure.
- **Evidence:** `AIChatTurnQueueService.ts:727` parks the run and returns, without retaining its bridge identity for resumed completion. `ai-chat-v2-ipc.ts:494` handles later terminal notifications through `notifyExternalTurnTerminal`; `AIChatTurnQueueService.ts:446` only drains/holds pending rows. It does not finish the parked run. Separately, promotion failure at lines 628–645 returns after an envelope was marked running at line 591, without finishing it.
- **Triggers:** (1) Prompt → permission → grant → normal completion or cancel. (2) Force `promoteDispatchToUserMessage` to fail after bridge scheduling.
- **Impact:** Activity and subsequent reconstruction can show `awaiting_user` or `running` after the actual execution has ended. Permission waits are also indiscriminately recorded as `awaiting_user` by the bridge.
- **Work:** Retain pending/run/engine continuation mapping; use the correct waiting status; terminalize success/failure/cancellation and failed promotion with recoverable intent preserved.
- **Acceptance:** Test every parked outcome and promotion failure, with queued followers and without. Assert one correctly settled envelope, released lease/capacity, and zero provider calls on promotion failure.
- **Requirements:** FR-QUE-013, FR-REC-008, FR-LIF-004; design terminal mapping.

### B05 — P1: Terminal UI events can precede or outlive failed durable persistence

- [x] Enforce durable terminal transition before publishing terminal events.
- **Evidence:** `AIChatQueryEngine.ts:3015` emits completion before returning to the queue. The queue calls `finishRun` only after the awaited engine call returns (`AIChatTurnQueueService.ts:674`, `:702`). `AIChatWorkspaceRunDispatchBridge.ts:129` catches and suppresses terminal persistence errors.
- **Trigger:** Delay or fail the terminal run update after the engine finishes.
- **Impact:** The UI can report completion and the queue can advance while the durable run still says running. Awaiting a method that swallows persistence failures does not enforce the design invariant.
- **Work:** Buffer/intercept terminal publication in the owning dispatch adapter, commit the run transition, then publish. Surface persistence failure as explicit reconciliation/recovery work; do not silently advance as if persistence succeeded.
- **Acceptance:** Terminal callbacks must observe a persisted terminal row. Inject DB failure and verify no successful terminal publication or silent next-run drain.
- **Requirements:** Design invariant 5 and §21.1; FR-QUE-013, FR-LIF-004.

### B06 — P1: Queue-backed run identity and background summaries are not integrated

- [x] Use the real durable run ID in event envelopes, selection snapshots and bounded sidebar summaries.
- **Evidence:** `ai-chat-v2-ipc.ts:559` assigns synthetic `pending-queue-${counter}` stream IDs rather than the bridge's durable run ID. Its queue sink at lines 563–580 forwards detail and legacy events, without publishing workspace summaries. Workspace SELECT (`ai-chat-workspace-ipc.ts:306`) obtains activeRunId from coordinator runtime, which does not own these ordinary turns. The coordinator's summary path (`AIChatCoordinator.ts:733`) is bypassed.
- **Trigger:** Start A, switch to B, let A finish or fail, then reload/select A and inspect Activity/sidebar.
- **Impact:** Durable Activity identity and live event identity disagree; inactive rows miss authoritative terminal/attention summaries and selection cannot reconstruct the active durable run ID.
- **Work:** Carry the bridge run ID through the queue stream adapter and runtime snapshot. Emit allowlisted, bounded summaries for pending/waiting/terminal changes without transcript/tool bodies.
- **Acceptance:** Background success, error and permission attention update A's sidebar only; B gets no private detail; reload/reselection returns the matching durable run ID.
- **Requirements:** AD-003; FR-LIF-002–004, FR-REC-007–008, FR-PER-008.

### B07 — P1: Delayed send errors and command receipts affect the wrong conversation

- [x] Scope every asynchronous renderer outcome to its original conversation and selection generation.
- **Evidence:** `src/views/store/selectedConversation.ts:402` handles a rejected `startChatRun` by mutating the current presenter and error state, without rechecking ownership. `useChatCommandRouting.ts:289` and `:320` append delayed command failures/results through center's current-store port (`AiChatCenterSurface.vue:1960`). A command transport failure returns accepted/handled at router line 294.
- **Triggers:** (1) Send in A, switch to B, reject the delayed IPC. (2) Run `/help` or a plugin command in A, switch to B, resolve its result/error.
- **Impact:** A's error or command exchange appears in B. Retryable command transport failures can also clear the draft as though execution were accepted.
- **Work:** Carry originating conversation/generation into local receipt/error ports, suppress stale selected-view mutations, and distinguish handled-but-rejected from accepted. Store recoverable outcomes against A when appropriate.
- **Acceptance:** Deferred success/rejection tests for sends and commands, including A→B→A generation changes. B's messages/error/draft must remain unchanged; rejected A drafts remain available.
- **Requirements:** FR-SUB-003/007, FR-CMD-004/009, FR-LIF-002.

### B08 — P1: Saved plan decisions can lose their continuation permanently

- [x] Persist a recoverable continuation intent when a plan decision commits.
- **Evidence:** `AiChatCenterSurface.vue:2563` and `:2579` abort after a selection change even though the decision has persisted. Lines 2597–2620 ignore `performOrdinarySend`'s false acceptance result. The reload has changed the decision card to a receipt; `AiChatPlanReceipt.vue:12` offers only View in Activity.
- **Triggers:** Switch during approval; reload/crash after the decision commits but before enqueue; or reject the continuation enqueue with queue-full/transport failure.
- **Impact:** A plan can be approved with no execution continuation and no working retry control, despite the message telling users to reopen to continue. The deterministic hash alone prevents neither lost intent nor this recovery gap.
- **Work:** Atomically persist decision plus continuation intent, then enqueue idempotently from main, or implement an equivalent durable, retryable continuation state. Preserve original decision identity across retries.
- **Acceptance:** Null decision starts nothing; committed decision survives reload/selection/queue rejection; retry eventually creates exactly one continuation row and one execution.
- **Requirements:** FR-PLN-005–008; AD-007; acceptance 11–12.

### B09 — P1: Plan hashing introduces another cross-conversation send window

- [x] Bind plan continuation sends explicitly to the captured plan conversation.
- **Evidence:** The final selection check is at `AiChatCenterSurface.vue:2579`, followed by awaited `planContinuationRequestId` at line 2591. Its helper awaits `crypto.subtle.digest` (`src/views/utils/planContinuationIdentity.ts:28`). The subsequent sends omit the original target, so `performOrdinarySend` captures whichever conversation is now selected.
- **Trigger:** Defer hashing, switch A→B, resolve hash.
- **Impact:** A's approved-plan continuation can be sent to B.
- **Work:** Pass the captured target through every follow-up, revalidate after all asynchronous boundaries, or move continuation ownership to main as in B08.
- **Acceptance:** A deferred-hash test submits nothing to B; the intended A continuation remains recoverable.
- **Requirements:** FR-SUB-007, FR-PLN-008, FR-LIF-002.

### B10 — P2: Workspace attachment preparation can silently omit an image

- [x] Reuse the shared validated V2 attachment builder.
- **Evidence:** `AiChatCenterSurface.vue:1681` manually encodes files and classifies solely by `file.type`; empty MIME becomes `application/octet-stream` and `kind: document`. V2 uses `aiChatV2Attachment.ts:11` with extension classification, MIME handling, size validation and downscaling. Queue preparation normalizes at `AIChatPendingMessagePreparationService.ts:214`; lines 142–145 discard mismatched kind/classification.
- **Trigger:** Send text plus a valid `photo.png` whose browser File has empty MIME. The workspace marks it document; the main normalizer detects image and drops it.
- **Impact:** The text can be accepted and the draft cleared without the intended image. Image resizing/limit behavior also differs from V2.
- **Work:** Use `buildUploadedAttachments`, report preparation/validation failures with draft retained, and align schema and effective count/byte limits.
- **Acceptance:** Test empty/octet-stream MIME PNG/JPEG, supported documents, unsupported types, size limits and downscaling. Both surfaces must produce equivalent accepted payloads; rejected items must not disappear silently from an accepted send.
- **Requirements:** FR-SUB-001–005; acceptance 2 and 36.

### B11 — P2: Commands with attachments bypass the router or discard files

- [x] Define and enforce an explicit attachment contract for commands.
- **Evidence:** `useChatCommandRouting.ts:469` skips generic slash dispatch when `hasFiles`; it falls through as ordinary text. `/goal` and `/skill` can route, but center's `submit_prompt` branch (`AiChatCenterSurface.vue:1770`) sends `[]` for files.
- **Trigger:** Submit a registered slash command with a file; submit `/skill …` or `/goal …` with a file.
- **Impact:** Raw command text may reach the model instead of the command dispatcher, or an accepted command silently loses its attachment.
- **Work:** Preserve supported files through expansion; explicitly reject unsupported combinations with all draft content retained. Do not silently change command meaning.
- **Acceptance:** Generic, goal and skill command/file cases assert dispatch ownership, exact payload and acceptance callback behavior.
- **Requirements:** FR-CMD-001–004, FR-SUB-001–003.

### B12 — P2: Scheduled-tool permission denial does not use the existing continuation API

- [x] Route Deny by the exact tool/conversation and execution owner.
- **Evidence:** `selectedConversation.ts:602` only rewrites the row and calls `stopActiveRun`. V2 first calls `denyChatV2ToolPermission` (`AiChatV2.vue:3880`); that API (`src/views/api/aiChatV2.ts:774`) handles a scheduled engine's paused tool and synthesizes its denial result. The approval card's generic permission denial does not replace this engine continuation call.
- **Trigger:** Display a scheduled-loop-owned paused permission request in workspace and deny it.
- **Impact:** The scheduled continuation does not receive the same denial handling as V2. This is specifically the scheduled-owner gap; ordinary interactive denial intentionally has a stop fallback.
- **Work:** Use the existing denial IPC, honor `handled`, and fall back to interactive stop only when appropriate. Retain an actionable card if denial fails.
- **Acceptance:** Scheduled ownership, interactive fallback, stale tool ID and failure/retry tests; denial never stops an unrelated task.
- **Requirements:** FR-PER-004/006/007.

### B13 — P2: Archive Navigate cannot load an unmounted historical message

- [x] Navigate through bounded history retrieval, not only a DOM lookup.
- **Evidence:** `AiChatCenterSurface.vue:2201` closes the history drawer and searches `[data-message-id]` in mounted DOM. If the source is outside the current window, it returns without loading it.
- **Trigger:** Search an archive passage older than the current mounted transcript window, choose Navigate.
- **Impact:** The drawer closes but nothing navigates, precisely for the old messages archive search is meant to recover.
- **Work:** Load a bounded window around the source through the history API, then scroll/focus it; surface unavailable sources safely and retain the 200-message cap.
- **Acceptance:** Test a source beyond the loaded window, unavailable source, and selection change during retrieval.
- **Requirements:** FR-HIS-001; design §12.11; bounded-history non-goal.

### B14 — P1: Retry identities and history draft lifetime are insufficient

- [x] Retain durable submission identity per logical draft/conversation until acceptance is resolved.
- **Evidence:** `selectedConversation.ts:370` creates a fresh `clientRequestId` for each ordinary send unless explicitly supplied. The history `submissionId` is only a component-local variable (`AiChatCenterSurface.vue:2140`), reset on every switch at lines 2223–2224; restored chips then acquire a new ID at lines 1908–1909. The history selection map at line 2135 also disappears on center unmount.
- **Triggers:** (1) Main commits a send but the renderer loses its response, then retries the retained draft. (2) History send fails transport, switch B→A, retry. (3) Select history chips, navigate to another center route, return.
- **Impact:** Ordinary retry uses a different pending idempotency key and can execute twice; history retry loses its promised stable identity; route remount loses selected context. A stable history-resolution ID does not replace the pending queue's client request ID.
- **Work:** Keep both identities and safe context descriptors in a conversation-keyed store with a defined logical-draft/payload lifecycle. Reconcile ambiguous acceptance before issuing a new request identity. Do not reuse an old identity for an intentionally changed/new message.
- **Acceptance:** Simulate committed-main/lost-response retry and assert one pending row/provider turn. Test A→B→A and route remount with history selection, accepted/mixed reference acknowledgements, and intentional draft changes.
- **Requirements:** FR-SUB-003/006, FR-HIS-002–004, AD-005; acceptance 32 and 36.

### B15 — P2: Queue-limit errors lose their stable, localized explanation

- [x] Preserve typed pending errors through workspace IPC and map them to six-language UI messages.
- **Evidence:** `AIChatPendingMessageModule.ts:187` throws `QUEUE_LIMIT_REACHED` with useful recovery guidance. Workspace START_RUN catches it through `userSafeError` (`ai-chat-workspace-ipc.ts:399`); `AIChatErrorMapper.ts:321` has no pending-error branch and falls through to generic unexpected-error text at lines 367–370. Selected store renders the returned message directly (`selectedConversation.ts:407`).
- **Trigger:** Reach the per-conversation pending limit and submit another message in any locale.
- **Impact:** Draft retention is implemented, but the user loses the reason and the action needed to unblock the queue. Locale key parity alone does not fix unmapped error paths.
- **Work:** Return bounded error codes/parameters and map queue, preparation and relevant terminal errors centrally. Translate every added message in en/zh/es/fr/de/ja.
- **Acceptance:** Full-queue workspace IPC-to-component tests assert localized actionable copy and preservation of text/files/paste/images/history. Add explicit unknown-error fallback tests.
- **Requirements:** FR-QUE-014, FR-REC-004, PRD §16.

### B16 — P2: Managed-browser cards do not explain their global/account scope

- [x] Label browser session ownership explicitly in all six languages.
- **Evidence:** Center mounts browser panels below the selected conversation (`AiChatCenterSurface.vue:50`). `ManagedBrowserSessionCard.vue:2` shows account/platform/status; the implementation documents global ownership at line 237, but the user-facing card lacks that scope label.
- **Impact:** A session can remain visible after selecting another conversation without explaining that it is account/global state rather than a session created by the newly selected chat.
- **Work:** Add concise scope labeling and verify actions continue to target the session/account identity across chat selection changes.
- **Acceptance:** Switch-conversation component test, localized label assertions and default-route browser journey.
- **Requirements:** FR-BRW-004.

## Remaining architecture and release work

### G01 — P2: Complete shared orchestration and overlay ownership

- [x] Extract common submission, commands, plan, permission, image and reporting behavior into typed shared modules consumed by both surfaces.
- [ ] Centralize conversation-bound overlay ownership/reset as required by AD-008, using an equivalent host if the proposed filename is not chosen.
- **Evidence:** `useChatCommandRouting` is used by workspace but not by `AiChatV2.vue`; V2 still implements command/skill/plan flows itself (e.g. lines 4407 and 4051). Center still owns extensive image, plan, history, report and submission algorithms rather than acting only as a composition root. The old TODO explicitly defers V2 extraction.
- **Important:** Shared voice/workspace composables and several report utilities already exist. Do not rewrite these needlessly or claim all sharing is absent. Freezing V2 may be a migration choice, but without an approved requirement change it does not satisfy the current PRD DoD 2 or design §10.1/AD-008.
- **Acceptance:** Both surfaces exercise the same orchestration contracts; characterization tests preserve rollback behavior, including acceptance failures, ownership switches and dialog cleanup.

### G02 — P1: Complete and execute default-route acceptance coverage

- [x] Fix B01 before treating missing E2E evidence as an environment-only limitation.
- [x] Require `/` → `/aiworkspace` and the workspace transcript in parity specs. Remove legacy-dock fallbacks from these certification paths (queue spec's `openChat` and `chatRoot`, lines 36–80, currently accept either surface).
- [x] Run all eight queue/steering scenarios plus global admission, parked lifecycle and restart recovery regressions from B02–B06.
- [ ] Enable generated-image batch E2E: `test/e2e/specs/ai-chat-generated-image-batch-live.test.ts:73` unconditionally skips the entire suite. Exercise partial success, retry only eligible failures, Stop preserving outputs, reference ordering, subsequent edit, and trusted Save.
- [ ] Add successful reporting journeys. `conversationReport.spec.ts:5` explicitly excludes successful submit; its cases at lines 80 and 95 only cover disabled capability. Cover available capability, AI disabled with reporting enabled, item limits, consent, privacy and successful reference/marked state.
- [ ] Certify outbound exact-draft approval, duplicate-click claim, delivery-unknown with no retry, and persistent receipt.
- [ ] Certify plan/question validation, null decision, persisted decision recovery and exactly-once continuation; permission grant once/persistent/deny/failure retry for relevant owners.
- [ ] Certify slash/goal/scheduled-loop approval and selected-conversation controls, including file payloads and transport failures.
- [ ] Certify skill install review, dependency/credential handling, duplicate action, reload, prompt-skill failure and Plugins-manager reachability.
- [ ] Extend managed-browser journey. `managedBrowser.test.ts:34` is opt-in and line 46 covers start/action/stop; add takeover, verify, resume, expiry, reload, stale/duplicate actions and inspector-closed availability on the default route.
- [ ] Certify history search/select/mixed acknowledgement, stable retry, route return, bounded navigation and compaction failure/retry/cancel under both rollout-flag states.
- [ ] Certify voice recording/transcription/auto-send/playback, missing runtime/model, permission denial and selection cancellation; existing visibility/setup tests alone are insufficient.
- [ ] Certify workspace choose/change/remove, canonical trust, watcher/scoped suggestions, portable-memory conflict/stale edit/Auto Dream through workspace, selected-live navigation and per-task cancel.
- **Acceptance:** Record exact commands, source SHA, pass/fail/skip counts and reasons. No required scenario may be silently skipped or pass by using the V2 dock. Run the full required component, affected main/module and E2E gates after remediation.

### G03 — P2: Finish observability and independently controlled rollout

- [x] Implement bounded workspace acceptance/rejection, action outcome, run lifecycle, projection fallback and rejected cross-conversation-event counters and the timings in design §18.
- [x] Verify/configure independent controls for shared orchestration, workspace pending queue, specialized results, voice/memory parity and V2 visibility (design §23.1), with compatible persisted states on rollback.
  - 2026-10-17: the five §23.1 dimensions are resolved through `AIChatWorkspaceRollout` — queue (independent flag, default ON), steering (independent flag, gated on queue), Chat V2 visibility (`isChatV2DockVisible`, the redesign flag's inverse), and shared-orchestration / specialized-results / voice-memory-parity surfaces ship behind the workspace visibility flag with the mapping documented in the module (they are workspace-shell surfaces with no independent legacy path to preserve). The rollback drill (`test/vitest/main/aiChatWorkspaceRollbackDrill.test.ts`) proves §23.2: flipping every flag to the Chat V2 dock state preserves pending rows verbatim, keeps run records readable with unchanged source ids and parked state, keeps the queue's list/cancel APIs functional (nothing orphaned), leaks no token-shaped data into sanitized views, and re-enabling re-claims the same run envelope instead of minting a second one.
- **Evidence:** `src/service/AIChatQueueCounters.ts` already contains pending counters/timings; it is incorrect to claim telemetry is wholly absent. The specified workspace acceptance/action/fallback counters were not found in `src/`. Existing workspace/history/queue flags do not establish all the independent rollout controls in the design. *(Counters and flags landed in the 2026-10-14/17 remediation sessions — see `aiChatWorkspaceObservability.test.ts` (4) and `aiChatWorkspaceRollbackDrill.test.ts` (1).)*
- **Acceptance:** Counter tests use bounded labels and never record prompts, file content/paths, tokens, report payloads or image bytes. A rollback drill preserves pending rows, identities and authorization behavior. ✔ (drill asserts the sanitized-view contract and idempotent re-claim)

### G04 — P1 release gate: Security, localization and accessibility certification

- [ ] Review main-first AI gating, permission continuation ownership, workspace trust, generated-image ownership/staging, exact-draft outbound authorization and reporting privacy across real workspace integration paths.
- [x] Check Module/Model ownership and no worker DB access. The workspace history IPC currently instantiates `AIChatMessageModel` directly in `loadHistoryPage` (`ai-chat-workspace-ipc.ts:153`); route through a Module to satisfy this repository's required layer pattern. This is a layering gap, not evidence of SQL injection.
- [ ] Verify every new rendered/error key in all six languages, including B15/B16; distinguish key existence from correct localized runtime behavior.
- [ ] Certify A11Y-001–010 across actual decision dialogs: keyboard completion, focus trap/return, live announcements, semantic labels, 200% scaling/narrow layouts, touch targets and reduced motion.
- **Evidence/limit:** Existing workspace E2Es include keyboard, zoom and touch checks; these are useful partial coverage, not proof of every capability/dialog. This audit did not conduct screen-reader/manual platform certification or a full security audit.
- **Acceptance:** Checked evidence matrix with automated results and explicitly approved manual steps; no unresolved blocking accessibility/security issue.

### G05 — P1 release gate: Soak, incident thresholds and owner sign-off

- [ ] Complete the default-route soak and record product/safety/desktop/QA sign-off.
- [ ] For the AD-009 V2-removal decision, collect a rolling 14-day sample with ≥500 accepted workspace submissions, ≥99.5% acceptance excluding deliberate validation/entitlement rejects, ≥99% exercised queue recovery, no open severity-1/2 parity defect, and zero specified duplicate-delivery/continuation, cross-conversation or authorization-bypass incidents.
- [ ] Extend low-volume soak rather than relaxing incident gates. Keep V2 available until a separate cleanup/removal decision is approved.
- **Status:** No qualifying soak/sign-off evidence was established in this audit. This is unverified release work, not a claim that a production incident occurred. V2 removal itself is correctly out of scope for parity implementation.

## Requirement coverage map

“Present” means a reachable implementation was found; it is **not** a claim that every acceptance case passed. “Partial” means a known gap or uncompleted integration. All groups remain subject to G02/G04/G05 release gates. Each PRD functional requirement range is represented below.

| PRD requirements | Current assessment | Remaining evidence/work |
| --- | --- | --- |
| FR-SUB-001–005 | Partial: full payload/accept callback/paste present; attachment and command-file gaps | B07, B10, B11, B15 |
| FR-SUB-006–007 | Partial: rejection removes optimistic row, but ambiguous retry identity and asynchronous ownership gaps remain | B07, B09, B14 |
| FR-SUB-008–009 | Present: follow-up queue and busy-command controls | G02 actual queue/command journeys |
| FR-CMD-001–004 | Partial: registry/expanded prompt present; files and local outcomes mishandled | B07, B11, G01 |
| FR-CMD-005–009 | Present with ownership/payload gaps; goal/loop approvals wired | B07, B11, G02 |
| FR-QUE-001–009 | Durable acceptance/FIFO/steering/hold present; integration certification incomplete | B04, B05, G02 |
| FR-QUE-010 | Incomplete global capacity composition | B02 |
| FR-QUE-011–012 | Restart recovery and item cancellation present | G02 restart/cancel verification |
| FR-QUE-013–014 | Partial reconstruction and error handling | B04–B06, B15 |
| FR-PLN-001–004,009 | Decision/receipt/question surfaces and returned-state validation present | G02, G04 |
| FR-PLN-005–008 | Partial: hash exists; committed continuation recovery/ownership incomplete | B08, B09 |
| FR-PER-001–005,007 | Cards/grants and failed-resume restoration present; scheduled denial failure behavior needs coverage | B12, G02 |
| FR-PER-006,008 | Partial scheduled denial and inactive attention | B06, B12 |
| FR-OUT-001–010 | Shared review/result/authorization surfaces present; full workflow not certified | G02, G04 |
| FR-IMG-001–015 | Tiles, selection, chooser, confirmation, batch surface, retry/stop/save wired | G02 (disabled batch E2E), G04 ownership/errors |
| FR-RPT-001–009 | Single/conversation report surfaces and capability checks present | G02 successful/privacy/AI-disabled reporting; G04 |
| FR-VOI-001–010 | Shared voice orchestration present | G02 full audio/error lifecycle; G04 accessibility |
| FR-WSP-001–010 | Workspace/trust/watcher/memory integrations present | G02 integration/route races; G04 trust/privacy |
| FR-REC-001–006 | Retry/recovery/context/compaction UI present; error mapping incomplete | B15, G02 |
| FR-REC-007–008 | Partial background summaries/durable reconstruction | B04–B06 |
| FR-LIF-001 | Background ownership intended/present; full mixed-owner certification missing | B02, B04, G02 |
| FR-LIF-002–004 | Partial asynchronous ownership, identity, draft and reconstruction | B06–B09, B14 |
| FR-LIF-005 | Defective active-delete protection | B03 |
| FR-LIF-006 | Stable conversation identity infrastructure present | G02 new-chat complete-payload journey |
| FR-SKL-001–006 | Install card classification and prompt-skill invocation present | B11 for files; G02 credential/reload/idempotence journey |
| FR-BRW-001–006 | Shared panels/intervention implementation present; scope copy missing | B16, G02 full lifecycle |
| FR-HIS-001–005 | Partial archive/context/ack/compaction integration | B13, B14, G02 |
| FR-INT-001–002 | Portable-memory/setup integration present | G02 conflict/stale-edit/Auto Dream/default-route certification |
| FR-INT-003–005 | Selected-live navigation, task cancel and reasoning/recovery surfaces present | G02 task/file/navigation lifecycle certification |
| A11Y-001–010; §16 | Partial automated foundation, no complete certification | B15, B16, G04 |
| AD-001 | Ordinary workspace sends now enter durable queue | Preserve while fixing B02–B06/B14 |
| AD-002–004 | Partial bridge; missing scheduler/identity/lifecycle composition | B02, B04–B06 |
| AD-005 | Partial shared state; local history identity/draft lifetime | B14, G01 |
| AD-006 | Semantic projection present, including recent image batch changes | G02 live/history equivalence |
| AD-007 | Hash implemented; durable continuation handoff incomplete | B08, B09 |
| AD-008 | Shared overlay ownership/extraction incomplete | G01 |
| AD-009; PRD DoD | Not certified; removal remains a separate decision | G02–G05 |

## Prior fixes that should not be refiled as wholly missing

Current source and passing tests show these earlier changes are present: ordinary START_RUN uses the pending queue; the run source ID is widened and populated; plan continuation IDs use a deterministic hash; failed permission resume restores the card; image batch progress/Stop/Retry is classified outside generic groups; task cancellation calls a per-task API; attachment encoding checks selection before calling the store; rejected sends remove optimistic rows; and the previous Cancel translation key gap was addressed.

Those fixes have limits identified above. In particular, a bridge class is not proof of global admission; a hash is not proof of recoverable exactly-once handoff; and a pre-send selection check does not protect a later asynchronous response.

## Recommended execution order

1. B01 to restore executable release verification.
2. B03, B07–B09 and B14 for deletion, ownership, duplicate/lost-intent protection.
3. B02 and B04–B06 as one coordinated dispatch/lifecycle integration effort.
4. B10–B13, B15–B16 for attachment, command, denial, history and localization/scope behavior.
5. G01 shared extraction with characterization coverage; retain functional fixes while migrating V2.
6. G02–G04 complete acceptance tests, rollout observability, security/localization/accessibility review.
7. G05 soak/sign-off; decide V2 removal separately.

For remediation, follow repository rules: add/update UI tests with each UI change, translate all user-facing changes in six languages, and commit each complete logical fix with its tests. This audit commit contains documentation only.
