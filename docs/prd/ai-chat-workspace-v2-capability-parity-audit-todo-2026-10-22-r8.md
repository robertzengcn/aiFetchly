# Workspace capability parity — audit R8 TODO

**Date:** 2026-10-22
**Worktree:** `/home/robertzeng/project/aiFetchly/.worktrees/workspace-parity`
**Branch:** `workspace-v2-capability-parity`
**HEAD:** `f6a153d31` (docs commit on top of the R7-04 code fix `110519323`)
**Requirements compared:** worktree copies of

- `docs/prd/ai-chat-workspace-v2-capability-parity-prd.md`
- `docs/prd/ai-chat-workspace-v2-capability-parity-technical-design.md`

The copies cited from the main checkout differ only by the owner-exception paragraphs the worktree added on 2026-10-18 / 2026-10-20 (PRD §10 item 5 and §11.2) and one design note. Functional requirement IDs are the same. This audit treats the worktree PRD, including that exception, as the requirement baseline for this branch.

**Verdict: not complete.** The default `/aiworkspace` route implements most capability families, and the R7 code defects (selection-buffer ownership, overflow accumulator, reload pointer, queue-path sidebar projection) are present in this HEAD. Definition of Done in PRD §28 and design §26 is not met. This pass found additional product defects that R7 marked as closed families. Full Electron, component, and typecheck gates were **not** re-run in this audit; the last recorded full E2E in the R7 addendum was 179 passed / 2 skipped on the R7-04 code commit.

---

## Remediation status (2026-10-23 session, branch `workspace-v2-capability-parity`)

Every §3 confirmed defect is fixed with its named regressions, the localization lock is in place, every §2 observability counter is incremented, and the §2 acceptance-journey gaps are closed except where noted. Commits, oldest first:

| Audit item | Commit |
| --- | --- |
| P1-1 Clear-while-parked | `38e0b7e44` |
| P1-2 batch-confirm conversation guard | `fc1077f44` |
| P1-3 image rows steerable | `9b5e8ab84` |
| P1-4 skill-card refresh / Approve snapshot | `2fa25b4b1` |
| P1-5 Plugins-page skill manager | `c0168340c` |
| P1-6 outbound frozen draft | `2d3c6b696` |
| P1-7 queued-accept idle overwrite | `2d70af7d9` |
| P2 failed-slash draft | `1f53550fa` |
| P2 paste/attachments while busy | `211ca6bd2` |
| P2 plan approval mode return | `c51b19665` |
| P2 interactive deny = stop (contract alignment) | `f9375988c` |
| P2 grant lock drop on benign resume | `8783053c0` |
| P2 stale managed-browser status | `0d4a74e69` |
| P2 failure attention, recovery copy, speech stop, workspace rebind, context %, Reported state | `15ccdfd48`, `6260aea9d`, `cff0e4f51`, `0e44df0a7` + `31da8fd98`, `8254fe22d`, `2021eff19` |
| P2 projection-fallback metric | `d65e9e2ac` |
| P3 model-list gate | `54d039f80` |
| P3 duplicate generic execution body | `9f9fd5429` |
| Localization lock (`outboundEmail`, `aiConversationReport`, `workspaceMemory`, full `aiChatV2` tree) | `bf53b5140` |
| Observability: pending scheduled/steered aliases | `50b7c86ae` |
| Observability: bounded renderer action-count IPC | `59aae81ff` |
| Observability: report/image/voice renderer counts | `250826118` |
| Observability: parity-fallback + rollback counts | `82dd95058` |
| AC 3 / 17 / 19-20 / 36 Electron journeys | `858344708` |
| AC 28 inactive-conversation summary-only journey | `dcd6af352` |
| Legacy-dock send blocker found by the AC 36 journey (pending-create schema rejected `submissionId`/`historySelectionIds`) | `f598f4f7e` |

**Verification:** the AC-journeys spec's three failures were fixed and re-certified — AC 19-20 via seeded conversation+message rows, AC 28 via the collapsed-group expansion and the bounded terminal-state contract (the completion event is `unread:false` by design; the row's Running indicator settles), and AC 36 via the legacy-send schema fix, which required rebuilding the E2E main bundle (`.vite/e2e/build/e2e-main.js`) for the fix to reach the launched app. Final full-spec run green on this tree (5/5 passed, 1.3m). Session HEAD: `44d88793c` (33 commits since the audit baseline `f6a153d31`: 22 fix, 5 feat, 4 test, 2 docs).

**Still open (unchanged from this audit):**

- AC 11–12 E2E (plan-approval continuation counting): the fake provider has no scripted plan-document scenario, so a continuation-count journey is not writable without new fake-server plumbing. Owner decision recorded here rather than silently skipped.
- V01 (real speech-runtime certification), V02 (A11Y/platform evidence incl. `AIFETCHLY_MB_E2E=1` managed-browser run, full gate reruns), V03 (14-day soak and sign-off), and the shared-extraction deferral remain release work.

Each fix commit passed the husky pre-commit `vue-tsc --noEmit` gate; the counter/IPC changes carry the main and component tests named in the audit items.

---

## 1. What is already in place

These families have a real workspace surface and the main safety path matches the PRD. “In place” does not mean every bullet below is free of the defects in §3.

| Family | Assessment |
| --- | --- |
| FR-SUB-001–005, 007 | Composer payload, accept-before-clear, rejection keeps the draft, pasted-content resolution, shared attachment limits, origin conversation captured before await. |
| FR-CMD-001–003, 005–009 | Slash routing before ordinary send, registry scope, one-shot prompt expansion, `/goal`, scheduled-loop approval before persist, loop controls scoped to the selected conversation. |
| FR-QUE-001–004, 006–014 | Durable pending row before acceptance, FIFO, pending bubbles, steer-once for plain text, synthetic skipped tool results, stop pauses the queue, provider failure holds the queue, per-conversation drain, restart does not call the provider, single-item cancel, queue-limit keeps the draft. |
| FR-PLN-001, 003–005, 007–009 | One plan surface, in-flight disable, continuation only after a non-null plan, idempotent continuation id, full plan stays in Activity. |
| FR-PER-001–004, 008 | Actionable grant/deny card, tool/category/preview/workspace context, once vs persistent vs deny, tokens stay off the DOM, inactive chats get bounded permission attention. |
| FR-OUT-001, 003–006, 008–010 | Dedicated outbound card and shared review dialog, send disabled until a token exists, preflight on approve, idempotent delivery claim, delivery-unknown is not auto-retried, dialog close leaves the transcript card, both surfaces use the same claim path. |
| FR-IMG-001–010, 012–013 | Open / use / edit / save, conversation-scoped tray, reorder, request fields, inference, chooser, fusion cap, batch confirm, batch progress card, stop, save through the trusted workspace. |
| FR-RPT-001–008 | Per-output report dialog, conversation report control, reporting IPC is not behind the AI entitlement gate, fail-closed capability, evidence filters, dialog closes on selection change. |
| FR-VOI-001–008, 010 | Shared `useAiChatVoice`, composer voice props, install/settings path stays visible, transcription merges, record-start stops speech without stopping the text run, playback follows the selected conversation, voice failure keeps the typed draft. |
| FR-WSP-001–005, 008–009 | Bound workspace near the composer, choose/change/remove, required-workspace card, trust card, canonical trust identity, memory panel including Auto Dream, watch follows selection without stopping the run. |
| FR-REC-001–002, 005 (composer badge) | Run strip stays high-level; retry line shows attempt, max, and delay; composer context badge uses the selected model window. |
| FR-LIF-001–004, 006 | Selection change does not cancel the other run, detail events are selection-scoped, summary events are status metadata, reload restores via the selection handshake, new chat uses one id. |
| FR-SKL-001, 005 | Workspace transcript mounts `SkillInstallCard` for live and historical `skill_install_*` rows. `/skill` invokes once and does not fall through to model text on ack failure. |
| FR-BRW-001–005 | Start panel, session card, rehydrate via `listActiveSessions`, intervention actions, shared-browser label, center column stays available with the inspector closed. |
| FR-HIS-001–005 | Flag-gated history drawer, opaque selection ids, main-process re-resolve, per-conversation submission id, compaction does not clear chips, mounted window stays at 200. |
| FR-INT-001–005 | Memory panel, composer workspace setup, live selected-conversation navigation only, agent-task dialog, local reasoning toggle that is not sent as authorization. |
| Design AD-001–003 | Pending row is created before the composer clears. The run envelope is created at scheduling claim. `sourceId` is the pending id. Steering does not create an independent run. |
| R7-01–R7-04 | `clearDeferredDetailEventsOwned`, `consumeRestorableSelectionPointer`, `recordTurnResult`, and promote-path `recordMessagePersisted` are in the tree. |

Design §3.3 is stale. It still says skill-install cards, managed browser, and recoverable history are absent from the workspace center. At this HEAD they are mounted from `AiChatWorkspaceTranscript.vue` and `AiChatCenterSurface.vue`.

---

## 2. Release work that is still incomplete

These items are not code defects. PRD §21 phase 5, §24, and §28 cannot close without them. R7 already listed them; they are still open.

### V01 — Real speech-runtime certification

- [ ] Run and record the voice journey with the installed native speech runtime and real Whisper/Piper (or sherpa) models: recording, transcription, auto-send, spoken response, and cancellation.
- [ ] Keep the deterministic stand-in in `test/e2e/specs/aiChatVoiceJourney.test.ts` as a regression, and do not describe that stand-in as model-quality or physical-device certification.
- **Why it blocks FR-VOI and acceptance criteria 21–22 as a release claim.** The production recorder, worker, settings, and playback paths are exercised. Inference bytes are replaced.

### V02 — Accessibility, platform, and authenticated browser evidence

- [ ] Record focus trap and focus return for plan, permission, outbound-review, report, image chooser, and batch-confirm dialogs (A11Y-004, A11Y-006, acceptance criterion 26). `test/e2e/specs/workspace-shell-keyboard.test.ts` covers shell navigation, composer, drawer, Escape, and voice controls. It does not walk those decision dialogs.
- [ ] Record one-time screen-reader announcements for new permission, question, outbound-review, and terminal-error states, including the rule that an inactive conversation must not steal focus (A11Y-005).
- [ ] Record 200% zoom and a narrow width with a decision dialog open, and confirm the primary action stays visible without horizontal page scroll (A11Y-009, acceptance criterion 27). `workspace-shell-gaps.test.ts` checks the composer at 200%, not an open decision.
- [ ] Record reduced-motion for queue, retry, progress, and speaking animation (A11Y-008).
- [ ] Run authenticated managed-browser handoff, approval, verify-login, resume, extend, stop, expiry, and stale-action checks on a machine with a display. `test/e2e/specs/managedBrowser.test.ts` skips unless `AIFETCHLY_MB_E2E=1` (acceptance criterion 31, FR-BRW).
- [ ] Re-run `yarn typecheck`, `yarn vue-typecheck`, `yarn test:components`, affected main/module suites, and `yarn test:e2e` on the revision that fixes the defects in §3. Report the exact skips. Do not treat the previous R7 log as evidence for code that changes after this audit.

### V03 — Soak and sign-off

- [ ] Collect design AD-009’s rolling 14-day default-route soak: at least 500 accepted submissions, acceptance at least 99.5% excluding deliberate validation and entitlement rejections, and restart recovery at least 99% for the cases exercised.
- [ ] Record zero confirmed duplicate delivery, duplicate plan continuation, cross-conversation event application, or authorization bypass during that window. Close any severity-1 or severity-2 parity defect first, including the items in §3.
- [ ] Obtain product, safety, desktop, and QA sign-off (PRD §28 items 10–11).
- [ ] Leave Chat V2 in place until a separate removal decision. It is still present (`src/views/components/aiChatV2/AiChatV2.vue`) and the root route still redirects to `/aiworkspace`. That part is correct.

### Shared-extraction deferral (owner exception, not a surprise gap)

- [ ] After V03 and the separate cleanup decision, extract the remaining Chat V2 submission, image-preflight, and plan-continuation logic into the shared composables. The worktree PRD §10 item 5 and §11.2 explicitly defer this. The main-checkout PRD copy does **not** contain that exception. If the main-checkout wording is the one that should govern, this deferral is itself an open requirement (PRD §28 item 2, design §26 item 4).

### Localization test lock (keys exist; several namespaces are unlocked)

String-stripped key trees match across `en`, `zh`, `es`, `fr`, `de`, and `ja` for `workspaceChat`, `aiChatV2` (including voice and tool output), `aiConversationReport`, `aiContentReport`, `outboundEmail`, `portableMemory`, `workspaceMemory`, `workspaceTrust`, `aiChatV2Plan`, `aiChatHistory`, `aiChatCompaction`, `managedBrowser`, and `workspace`. `skillInstall` identifier counts match.

- [x] Add parity tests for namespaces that are present but not locked: `outboundEmail`, `aiConversationReport`, `workspaceMemory`, and the whole `aiChatV2` tree. Existing tests lock `workspaceChat`, `aiChatV2.voice`, `aiChatV2.toolOutput`, portable memory, workspace trust, content-report top keys, history, and managed browser (PRD §16 item 7). **Done: `bf53b5140` adds `workspaceReleaseNamespaces.i18n.parity.test.ts` (12 tests).**

### Observability names the PRD asks for and the code does not increment

Design §18.1 / PRD §20. Existing counters cover submission accepted/rejected, pending created/dispatched/paused, steering requested/applied, run created/terminal, and several action labels.

- [x] `ai_chat_pending_scheduled_total` is absent. The live name is `ai_chat_pending_dispatched_total`. **Done: `50b7c86ae` — alias key added and incremented alongside every dispatch.**
- [x] `ai_chat_pending_steered_total` is absent. The live names are `ai_chat_steering_applied_total` and `ai_chat_steering_requested_total`. **Done: `50b7c86ae` — alias incremented at the promoter's applied site.**
- [x] Reporting dialog **opened** is not counted. `ai-content-report-ipc.ts` counts submit and capabilities only. **Done: `59aae81ff` + `250826118` — new bounded `ai-chat-v2:workspace-action-count` IPC; both report dialogs record `report/dialog_open`.**
- [x] Generated-image chooser, batch confirmation, retry, and stop counts are absent. Image export is counted. **Done: `250826118` — chooser open, batch confirm/declined, batch stop, batch retry recorded in both surfaces.**
- [x] Voice recording, transcription, playback, install, and capability-state counts are absent from the workspace action counter. **Done: `250826118` — record start ok/error, record complete, transcribe error, playback start, install model/runtime offer/runtime ok+error, capability state ready/setup/error.**
- [x] Parity-fallback activation and workspace-to-Chat-V2 rollback counts are absent. **Done: `82dd95058` — the SET_FLAG handler counts redesign enabled/rollback and adapter enable/disable; layout mount counts `workspace/parity_fallback/activated`.**
- [x] Fix the projection-fallback counter bug in §3 before using that series as soak evidence. **Done: `d65e9e2ac` (P2 projection-fallback metric).**

### Acceptance criteria whose automation stops short of the journey

| AC | What exists | What is still missing |
| --- | --- | --- |
| 3 | Component test sends `/review` through the router | ~~No default-route E2E that the model never sees the raw command~~ **Done: `858344708` — `/help` journey, request count unchanged.** |
| 11–12 | Component tests for null approval and exactly one continuation | No E2E that counts the continuation turn — requires a scripted plan-document scenario on the fake provider (owner decision: stays open, see remediation addendum) |
| 17 | Component test: ambiguous image edit submits nothing | ~~No E2E~~ **Done: `858344708` — seeded-2-images journey, no request until choice; cancel keeps the draft.** |
| 19–20 | Single-output dialog component test; report spec shows the control | ~~No E2E that submits a report while AI generation is disabled and an eligible output exists~~ **Done: seeded assistant output on the hosted-disabled surface, submit resolves the server reference.** |
| 26–27 | Shell keyboard and 200% composer checks | Decision-dialog keyboard and 200% checks (same as V02) |
| 28 | Unit test that the event router drops detail with no subscriber | ~~No E2E that an inactive conversation's payload is summary-only~~ **Done: `dcd6af352` — live tool run in A, selection on B: A's row shows only the bounded Running indicator that settles at the terminal, never the tool name or args.** |
| 31 | Component tests for the session card | E2E skipped unless `AIFETCHLY_MB_E2E=1` — release-infra item (V02) |
| 36 | Component tests on both surfaces | ~~No Electron journey~~ **Done: `858344708` — shell turn, real SET_FLAG rollback, legacy dock turn (the legacy-send blocker found by this journey is fixed in `f598f4f7e`).** |

---

## 3. Confirmed defects

Each item was read in the worktree at `f6a153d31`. Line numbers are from that tree and will drift if the files change.

### P1 — Clear is available while a parked run can still write

**Requirements:** FR-LIF-005. Failure row “conversation switched” is separate; this one is the clear control.

**What happens:** Delete is disabled in the header while status is `running`, `queued`, `awaiting_permission`, or `awaiting_user`, and the delete IPC refuses those durable runs. Clear has no disabled binding. `onClear` returns early only when `selectedStore.isBusy` is true. `isBusy` is running, queued, or streaming. A permission or question park hydrates `runtimeStatus` to `awaiting_*` and `streamStatus` to idle, so `isBusy` is false. The header Clear item still emits. `handleClearConversation` does not consult the delete busy guard. It calls `AIChatTurnQueueService.clearConversation`, which stops the turn, cancels parked envelopes, deletes pending rows, and then wipes messages.

**Where:**

- `src/views/components/aiChatWorkspace/AiChatConversationHeader.vue` — Clear list item has no `:disabled`; `isDeleteDisabled` covers the parked states.
- `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue` `onClear` — guard is `selectedStore.isBusy` only.
- `src/views/store/selectedConversation.ts` `isBusy` — omits `awaiting_permission` and `awaiting_user`.
- `src/main-process/communication/ai-chat-v2-ipc.ts` `handleClearConversation` — no active-run refusal.
- `src/service/AIChatTurnQueueService.ts` `clearConversation` — stops and deletes.

**Required fix:** Disable Clear for the same states as Delete. Refuse in the clear IPC when a non-terminal run or pending row exists, using the same predicate as delete. Add a component test that Clear does not call the IPC while a permission or question card is parked, and a main-process test that the IPC returns denied.

### P1 — Image batch confirm can submit into the conversation that is selected now

**Requirements:** FR-IMG-015. Acceptance criterion 17 is the chooser; this is the batch-confirm sibling.

**What happens:** `chooseAmbiguityCandidate` drops the pending send when `pending.conversationKey` no longer matches the composer draft key. `confirmGeneratedImageBatch` does not. It clears the dialog and calls `performOrdinarySend` with the confirmed references and no captured conversation target. A confirm click after the user has switched chats sends that batch into the new chat.

**Where:** `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue` `confirmGeneratedImageBatch` (immediately after `chooseAmbiguityCandidate`, which has the guard).

**Required fix:** Apply the same conversation-key guard. Pass the captured conversation id into the send the way plan continuation already captures `targetConversationId`. Test: open confirm on conversation A, switch to B, confirm, and assert B’s composer and queue are unchanged.

### P1 — Generated-image rows can be steered, and steering drops their references

**Requirements:** FR-QUE-005.

**What happens:** `AIChatPendingMessageModule.toView` sets `canSteer` false when the row has attachments **or** `generatedImageReferences`. The pending bubble ignores `view.canSteer`. `showSteer` is true for any queued row with zero attachment chips while runtime is `running`. Image references are not attachment chips, so Steer is shown. `AIChatTurnQueueService.steer` checks queue flags, runtime, ownership, and `queued` status. It does not reject image-reference metadata. The steering instruction carries display and model text only, so the reference channel is dropped and the row will not later dispatch normally.

**Where:**

- `src/modules/AIChatPendingMessageModule.ts` `toView` `canSteer`
- `src/views/components/aiChatV2/AiChatV2PendingMessage.vue` `showSteer`
- `src/service/AIChatTurnQueueService.ts` `steer`

**Required fix:** Gate the button on `view.canSteer`. Reject the same rows in `steer` with the existing not-steerable error so a stale renderer cannot bypass the UI. Test both the bubble and the service.

### P1 — Historical skill-install cards do not refresh, and Approve stays bound to the old snapshot

**Requirements:** FR-SKL-002, FR-SKL-003, FR-SKL-004. Acceptance criterion 29.

**What happens:**

1. `AiChatV2Message` builds `installSnapshot` from the tool result and omits `safePlan`. The first paint, including a reopened historical row, has state and `safeSummary` only.
2. `SkillInstallCard` refreshes on `SKILL_INSTALL_PROGRESS` only. Mount does not call `getSkillInstallStatus`.
3. The Approve block is `v-if="snapshot?.state === 'awaiting_approval'"`. In the template, `snapshot` is the prop. `refreshSnapshot` writes `localSnapshot`, which feeds `snapshotView` and `safePlan`, not that prop. After the session moves on, Approve can stay visible. The server returns the current snapshot when the state is no longer `awaiting_approval` (`SkillInstallationModule`), so a second install does not start. A card that is still `awaiting_approval` can be approved from history without a fresh status read and without the structured plan on screen. The PRD says a reopened historical card must re-fetch and must not replay an approval.

**Where:**

- `src/views/components/aiChatV2/AiChatV2Message.vue` `installSnapshot`
- `src/views/components/aiChatV2/SkillInstallCard.vue` review block and `onMounted` / `refreshSnapshot`

**Required fix:** Pass `safePlan` through. On mount, fetch authoritative status and render from that snapshot, including the Approve gate. A historical card that is no longer awaiting approval shows the outcome and no Approve button. Add a component test with a persisted `awaiting_approval` tool row whose live status is already `ready`.

### P1 — Skill installation management is not on the Plugins page

**Requirements:** FR-SKL-006.

**What happens:** `src/views/components/aiChatV2/SkillInstallManager.vue` exists and has no importer under `src/`. `src/views/pages/systemsetting/plugins.vue` mounts `PluginManager` only. `PluginManager.vue` does not reference skill installation. The per-conversation card is correctly not a copy of the manager, and the manager itself is unreachable.

**Required fix:** Mount the existing manager from the Plugins settings page (or the surface the skill-install PRD already names, if that page is a different route). Add a component or E2E assertion that the page lists installed prompt skills. Do not embed a second manager in the transcript.

### P1 — Outbound transcript card never leaves the frozen draft

**Requirements:** FR-OUT-002, FR-OUT-007. Acceptance criteria 13 and 15 are covered inside the dialog; the transcript receipt after send is not.

**What happens:** `AiChatOutboundBatchReviewCard` derives status only from the tool-result message (`deriveOutboundBatchCardModel`). Send emits `sent` and closes the dialog (`OutboundEmailReviewDialog.vue`). Nothing writes `sent`, `partially_sent`, `failed`, `delivery_unknown`, or `cancelled` back onto that message, and there is no live progress subscription on the card. After a successful send the dialog unmounts, Review stays available, and the terminal summary never replaces the draft. `reasonCode` and `sentCount` are props of `OutboundEmailBatchCard.vue` and are not rendered. `cancelled` is not in `showReviewAction`’s terminal set.

**Where:**

- `src/views/components/aiChatWorkspace/AiChatOutboundBatchReviewCard.vue`
- `src/views/components/outboundEmail/OutboundEmailBatchCard.vue` props vs template, `showReviewAction`
- `src/views/components/outboundEmail/OutboundEmailReviewDialog.vue` send success path

**Required fix:** On send, discard, and terminal delivery events, update the card’s displayed status from the authoritative batch read, including sent count and reason code. Keep delivery-unknown copy distinct from success. Hide Review for every terminal status, including cancelled. Add a component test that a `sent` outcome removes Review and shows the sent summary without the dialog staying open.

### P1 — Queued accept is immediately overwritten back to idle

**Requirements:** FR-SUB-009, and it widens the Clear hole in FR-LIF-005.

**What happens:** On accept, the store sets `runtimeStatus` from the queue response, then calls `syncFromPresenter()`. That function assigns `runtimeStatus` from the presenter. A first send returns a pending id with status `queued` before any stream event, and the presenter is still `idle`, so the assignment sticks. `isBusy` becomes false until the first stream chunk. `routeCommand` only blocks slash, goal, loop, and skill input while `isBusy()` is true, so a command can be accepted in that window against a conversation that already has a durable turn. Clear uses the same flag.

The R6 hydration fix addressed the reload path (`hydrateRuntime`). It did not update this accept path. The presenter’s own comment describes the old bug: store refs were overwritten by the default idle state.

**Where:**

- `src/views/store/selectedConversation.ts` accept path around the `response.status === "queued"` branch, and `syncFromPresenter`
- `src/views/composables/aiChatWorkspace/useChatCommandRouting.ts` `routeCommand` busy check
- `src/views/utils/workspaceStreamPresenter.ts` `hydrateRuntime` comment

**Required fix:** After a queued accept, hydrate the presenter to `queued` (or stop `syncFromPresenter` from clobbering a newer store status). Add a store test: accept returns `pending-…` / `queued`, and `isBusy` stays true with no stream event. Add a command-routing test that `/goal` is rejected in that state.

### P2 — Failed slash commands clear the draft

**Requirements:** FR-CMD-004. Invariant 12 (rejected submission never clears draft state) for this path.

**What happens:** A transport failure returns `acceptedSend: false`, and the comment says returning true cleared the draft. A registry result with `status: false` (unknown command, disabled command, unsupported skill) appends a local exchange and returns `acceptedSend: true`. `AiChatCenterSurface` calls `onAccepted` when `acceptedSend !== false` and acceptance was not delegated. The composer then clears text, files, and pasted state even though nothing was queued.

**Where:**

- `src/views/composables/aiChatWorkspace/useChatCommandRouting.ts` `dispatchGenericSlash`, the `if (!result.status)` return
- `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue` disposition handler that calls `onAccepted`

**Required fix:** Return `acceptedSend: false` for `status: false`. Keep the local error exchange. Test that an unknown `/nope` leaves the composer text in place.

### P2 — Follow-up paste and attachments are blocked for the whole busy period

**Requirements:** FR-SUB-008. Design invariant 11.

**What happens:** The send button stays enabled while streaming, so typed follow-ups queue. `onPaste` returns immediately when `isStreaming` or `isProcessing` is true, and the workspace binds `is-streaming` to `selectedStore.isBusy`. The attach control is `v-if="!isStreaming && !isProcessing"`. A user cannot paste or attach the follow-up the PRD says the composer must accept while a turn runs.

**Where:** `src/views/components/aiChatV2/AiChatV2Composer.vue` `onPaste` and the attach `v-if`. Binding: `AiChatCenterSurface.vue` `:is-streaming="selectedStore.isBusy"`.

**Required fix:** Allow paste and attach while a turn is running, and send those with the follow-up through the pending queue. Keep rejecting paste only for states that truly cannot accept input (no conversation, recording if that contract says so). This is shared with Chat V2; change it once and cover both surfaces.

### P2 — Plan approval does not return the composer to chat mode

**Requirements:** FR-PLN-006. Journey 17.3 step 5.

**What happens:** `mode` is a local ref defaulting to `"chat"`. Approval sends the continuation with `modeOverride: "chat"`. Nothing assigns `mode` back to `"chat"`. If the user had switched the selector to plan, the next manual send stays in plan mode after a successful approval.

**Where:** `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue` `const mode = ref<ChatV2Mode>("chat")` and `onLegacyPlanAction` (`modeOverride: "chat"` only).

**Required fix:** On a successful approve, set `mode` to `"chat"` when the decision’s conversation is still selected. Test the selector value, not only the continuation payload.

### P2 — Interactive permission deny stops the turn instead of returning a tool result

**Requirements:** FR-PER-006.

**What happens:** If `denyChatV2ToolPermission` returns `handled: true` (scheduled-loop owner), the row becomes a denial receipt and the run continues. If it returns `handled: false`, the store rewrites the row and calls `stopActiveRun()`. The model does not receive the denial and continue. The function comment says the interactive stop is deliberate. The PRD text says denial produces the existing safe tool result and lets the AI explain or recover. Those two contracts disagree for interactive chat.

**Where:** `src/views/store/selectedConversation.ts` `denyToolPermission`.

**Required fix:** Decide with the permission design which contract is authoritative. If the PRD wins, interactive deny must resume with the synthetic denial result and must not cancel the turn. If stop-on-deny is the product choice, amend FR-PER-006 so the workspace requirement matches. Do not leave the comment and the PRD in conflict.

### P2 — Grant lock drops as soon as the resume IPC returns

**Requirements:** FR-PER-005, FR-PER-007.

**What happens:** `grantToolPermission` adds `toolId` to `permissionResumeInFlightToolIds` and deletes it in `finally` when the IPC promise settles. A successful resume leaves the card in the executing rewrite until a later tool-result event. A second click is no longer locked. If that second call returns `ok: false` because the pending permission is already gone, `restorePermissionPromptAfterFailure` puts Grant and Deny back while the tool is already running.

**Where:** `src/views/store/selectedConversation.ts` `grantToolPermission` `finally`.

**Required fix:** Keep the in-flight lock until the tool-result event replaces the row, or treat “already resumed / already claimed” as success and do not restore the card. Test a second grant click after `ok: true`.

### P2 — Stale managed-browser status can bring a stopped session back

**Requirements:** FR-BRW-006.

**What happens:** `applyStatus` stores any non-terminal status and clears the card only for null or terminal states. It does not compare session id or a generation token. The status subscription calls `applyStatus` for every event. Take over, verify, resume, and extend apply whatever the awaited call returns, with no check that the user has stopped that session in the meantime. A late non-terminal event after Stop sets `status` again and the card reappears.

**Where:** `src/views/components/aiChatV2/ManagedBrowserSessionCard.vue` `applyStatus`, `onMounted` status listener, and the action handlers that call `applyStatus`.

**Required fix:** Ignore events whose session id is not the card’s current session, and ignore any result older than the latest Stop. A stopped card stays empty until `listActiveSessions` or a new start says otherwise. Test a terminal local stop followed by a late `running` event.

### P2 — Inactive interactive failure does not mark the sidebar

**Requirements:** FR-REC-007, FR-LIF-003’s attention half. Acceptance criterion 28 is about payload privacy; this is the attention bit.

**What happens:** `AIChatCoordinator.finalizeAfterTerminal` deletes `liveRuns` before `broadcastRunSummary`. The summary then reads no live run, so runtime is `idle` and attention is `none` for `run_failed` as well as for success. Queue-path summaries set failure attention. An interactive failure in a background conversation does not.

**Where:** `src/service/AIChatCoordinator.ts` `finalizeAfterTerminal` and `broadcastRunSummary`.

**Required fix:** Set attention to the failure label before deleting the live entry, or pass the terminal status into the summary. Do not put transcript text in that event. Test an unselected conversation’s sidebar row after `run_failed`.

### P2 — Recovery detail drops attempt and message, and hides recovery when retry exists

**Requirements:** FR-REC-003, FR-REC-004.

**What happens:** The recovery string interpolates `layer` and `reason` only. The presenter also stores attempt, max attempts, and a safe message, and those fields are not rendered. The template prints `retryDetailText ?? recoveryDetailText`, so a live retry hides recovery. Provider, context-window, generated-image, permission, and outbound errors are not in `workspaceErrorLocalization.ts`. The transcript banner uses the presenter’s raw `errorMessage`. Chat V2 maps stable codes through `mapStreamErrorMessage`.

**Where:**

- `src/views/components/aiChatWorkspace/AiChatCenterSurface.vue` recovery template and `recoveryDetailText`
- `src/views/utils/workspaceStreamPresenter.ts` error assignment
- `src/views/utils/workspaceErrorLocalization.ts`

**Required fix:** Show recovery attempt and safe message. Show retry and recovery together when both exist. Map the stable error codes on the workspace banner the same way Chat V2 does. Test a context-window code and a combined retry-plus-recovery snapshot.

### P2 — Context inspector usage ignores the selected model window

**Requirements:** FR-REC-005.

**What happens:** The composer badge builds `modelContextWindows` from the loaded model list. `AiChatContextPanel.vue` calls `computeContextPercent` with `new Map()`. The util’s empty-map fallback is not the selected model’s window, so the inspector percent and the composer percent can disagree for the same token count.

**Where:** `src/views/components/aiChatWorkspace/AiChatContextPanel.vue` `contextPercent`.

**Required fix:** Pass the same window map the composer uses. Test a model whose window is not the util default.

### P2 — “Reported” is not visible on per-output report buttons

**Requirements:** FR-RPT-009, A11Y-001.

**What happens:** Session-reported ids are stored and passed into the transcript. The per-message control uses the compact variant. Compact mode renders only the flag icon. The “Reported” text is `v-if="!compact"`. `aria-label` stays “Report this AI-generated output” when `reported` is true. The only state change is `disabled`.

**Where:** `src/views/components/aiContentReport/AIContentReportButton.vue`.

**Required fix:** When `reported` is true, set the accessible name to the reported label even in the compact variant, and give the icon a visually distinct state that is not color-only. Test the accessible name.

### P2 — Turning spoken responses off does not stop audio already queued

**Requirements:** FR-VOI-009.

**What happens:** Selection change, Stop, and record-start call `stopSpeaking`. `toggleSpokenResponse` persists `ttsMode: "disabled"` through `applySettings` / `updateOptions` and does not call `stopSpeaking`. Speech already queued for the selected conversation keeps playing after the user turns the control off.

**Where:** `src/views/composables/useAiChatVoice.ts` `toggleSpokenResponse`.

**Required fix:** Call `stopSpeaking` when the saved mode is disabled. Test that a playing utterance is cancelled.

### P2 — Same-conversation workspace rebind does not refresh slash or mention scope

**Requirements:** FR-WSP-006, FR-WSP-007.

**What happens:** Memory count, watch, and trust refresh inside `useConversationWorkspace` when the workspace changes. The composer refreshes slash suggestions when `conversationId` changes or an AiFetchly config event fires, and only if a slash draft is already open. Rebinding a different directory on the same conversation does not by itself refresh slash or mention scope. The Context inspector has no memory entry point; the count and open action live on the workspace badge only. FR-WSP-007 names the Context inspector.

**Where:**

- `src/views/components/aiChatV2/AiChatV2Composer.vue` conversationId watch and `onAifetchlyConfigChanged`
- `src/views/components/aiChatWorkspace/AiChatContextPanel.vue` (no memory control)

**Required fix:** Refresh command and mention catalogs when the bound workspace id changes. Add the existing memory entry point and count to the Context inspector. Test a same-conversation rebind.

### P2 — Projection-fallback metric counts ordinary messages

**Requirements:** PRD §20, design §18.1. This will poison soak numbers if that counter is used.

**What happens:** `countProjectionFallbackForTool` documents that it counts tool-result rows only. The first branch increments `ai_chat_workspace_projection_fallback_total` with reason `non_tool_row` for every other row. An empty tool lookup therefore counts user and assistant messages as projection fallbacks.

**Where:** `src/service/AIChatContextAssembler.ts` `countProjectionFallbackForTool`.

**Required fix:** Return without incrementing when the row is not a tool result. Adjust the observability test so a normal message does not move the counter.

### P3 — Model list handler does not check AI enablement

**Requirements:** PRD §14 item 1, for handlers that do AI work.

**What happens:** `handleModels` in `ai-chat-v2-ipc.ts` constructs `AiChatApi` and calls `listOpenAIModels()` with no `canUseChat()` and no schema parse. Workspace start-run does check `canUseChat()` before `safeParse`. Voice IPC parses first by an explicit local-runtime exception; that one is documented. The model list is not.

**Where:** `src/main-process/communication/ai-chat-v2-ipc.ts` `handleModels`.

**Required fix:** Gate with `canUseChat()` before the provider call, and return the same denied envelope as the other chat handlers. This is a metadata call, not a generation bypass.

### P3 — Duplicate generic execution body beside specialized cards

**Requirements:** PRD §13.3.

**What happens:** A skill-install result is pushed as its own card and also remains inside the execution group, which still renders `SemanticToolResult`. Outbound batches are a transcript kind and are not a `ToolOutputKind`, so the generic group body is not replaced. File results render the label “Files changed — see Activity” without a file-change receipt. The semantic permission line is a label next to the real grant/deny card.

**Where:**

- `src/views/components/aiChatWorkspace/AiChatWorkspaceTranscript.vue` skill-install branch
- `src/views/components/aiChatWorkspace/toolExecutionProjection.ts` `ToolOutputKind`
- `src/views/components/aiChatWorkspace/SemanticToolResult.vue` files and permission templates

**Required fix:** For a specialized result, suppress the generic body and keep the execution identity and Activity detail. File rows should expose the Activity detail from the transcript, or the projection should carry the file receipt the design table describes.

---

## 4. Suggested order

1. Fix the P1 behavior bugs: Clear-while-parked, batch-confirm conversation guard, image-reference steering, skill-card refresh and Approve gate, Plugins-page manager, outbound terminal receipt, queued-accept idle overwrite.
2. Add the regressions named on each item, then run typecheck, component tests, the affected main suites, and the workspace E2E specs those fixes touch.
3. Fix the P2 contract bugs (draft clear, paste-while-busy, plan mode, deny continuation, grant lock, browser stale status, failure attention, recovery copy, context percent, reported state, speech stop, workspace refresh, fallback counter).
4. Close P3 (model-list gate, duplicate semantic bodies) in the same release if the soak has not started.
5. Complete V02 on that revision, then start V03. Do not remove Chat V2 from this branch.

## 5. What this audit did not do

- Did not re-run `yarn test:e2e`, `yarn test:components`, or the typechecks. The R7 addendum’s green gates predate this finding list.
- Did not perform a full security review of outbound authorization, reporting payload construction, or workspace path canonicalization. Spot checks did not show a new token log or a worker opening SQLite on the queue path.
- Did not execute the app in a browser. The defects above are from reading the current source, not from a live click-through.
