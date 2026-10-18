# AI Chat Workspace V2 Capability Parity — Incomplete Work and Defects

> **HISTORICAL REMEDIATION RECORD (A03, audit 2026-10-17).** This file and
> the 2026-10-14 audit todo are point-in-time remediation records, NOT
> current acceptance evidence. The current authority for remaining work is
> [the 2026-10-17 audit](./ai-chat-workspace-v2-capability-parity-audit-todo-2026-10-17.md):
> its R01–R13 findings, A01–A03 architecture items and V01–V03 release
> gates supersede the checked/unchecked tables preserved below. Do not
> re-litigate closed B01–B16/T1–T9 items from here without checking that
> audit first — several of its descriptions of then-current bugs are
> already fixed on this branch.

Audit date: 2026-10-12
Remediation update: 2026-10-14 — T1–T9 and D1–D8 are implemented on this
branch (see the git log from 2026-10-12 onward); this file's original
audit text is preserved below. T6 (V2 onto shared composables) remains
deliberately deferred — V2 is the frozen rollback surface; T10 (default-
route E2E certification), T11 (a11y/security review + soak), and T12
(history Electron journey) require packaged-app environments and are
still open. See docs/superpowers/plans/2026-10-11-workspace-v2-capability-parity.md.

| Field | Value |
| --- | --- |
| Worktree | `/home/robertzeng/project/aiFetchly/.worktrees/workspace-parity` |
| Branch | `workspace-v2-capability-parity` |
| HEAD | `4e7437bc` — `fix: close review round-3 findings (real source-id schema, execution-time staging, multimodal history, capacity errors)` |
| PRD | `docs/prd/ai-chat-workspace-v2-capability-parity-prd.md` (v1.1) |
| Technical design | `docs/prd/ai-chat-workspace-v2-capability-parity-technical-design.md` |
| Implementation plan | `docs/superpowers/plans/2026-10-11-workspace-v2-capability-parity.md` (marks tasks 1–14 complete and explicitly defers the queue bridge, default-route E2E, soak, accessibility review, and security review) |
| Verdict | **Not complete.** Renderer parity for commands, plans, skill-install cards, managed browser, history, reporting, and voice is largely wired. The PRD definition of done is not met. Several claimed-complete paths are unreachable or incorrect. |

This file is an audit of the worktree source. It is not a runtime certification and it does not cover the main checkout (`dev` at `c357b527`), which does not contain these parity commits.

## Verification run during this audit

| Check | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | Exit 0, no diagnostics |
| `npx vue-tsc --noEmit --incremental false` | Exit 0, no diagnostics |
| `AiChatCenterSurface.test.ts` + `AiChatWorkspaceTranscript.test.ts` | 2 files, 91 tests passed |
| `useChatCommandRouting.test.ts` + `workspaceStreamPresenter.test.ts` | 2 files, 41 tests passed |
| `yarn test:components` (full) | Not run |
| `yarn testmain` | Not run |
| `yarn test:e2e` | Not run |
| Keyboard, screen reader, 200% layout, six-language UI pass | Not run |
| Security review and 14-day soak | Not run |

The plan file records an earlier `yarn test:components` 979/979 and a `testmain` run with 16 failures described as pre-existing on base `dev`. That `testmain` result was **not** reproduced in this audit. Do not treat it as the current failure list.

Component-test i18n warnings (`aiChatV2.voice.runtime_install_preparing`, `generatedImageRefs.*`) come from the component-test locale stub. Those keys exist in `src/views/lang/en.ts`. `aiChatV2.cancel` does **not** exist. See defect D4.

## What is implemented in this worktree

These paths exist and were not re-listed as missing product work:

- Composer acceptance callback, pasted-content map, attachment normalization on the idle coordinator path, confirmed image-batch field, and opaque `historySelectionIds` / `submissionId` (`AiChatCenterSurface.performOrdinarySend`, `selectedConversation.sendMessage`, `AIChatCoordinator.buildEngineRequest`).
- Slash, `/goal`, `/loop`, and `/skill` routing in `src/views/composables/aiChatWorkspace/useChatCommandRouting.ts`, including scheduled-loop approval staging.
- Plan approve / reject / request-changes validation, in-flight click guard, and a single continuation send when the returned plan state is non-null (`onLegacyPlanAction`).
- Permission grant/deny cards outside generic receipts; resume IPC uses tool id + conversation id. Persistent grant is stored by `SkillApprovalCard` before the parent resumes.
- Outbound-email review card (`AiChatOutboundBatchReviewCard`) outside collapsed groups.
- Skill-install results classified to `SkillInstallCard` via `AiChatV2Message` for live and historical tool results.
- `ManagedBrowserStartPanel` and `ManagedBrowserSessionCard` mounted in the center, not inside the inspector.
- Single-output report dialog, conversation report button, session reported-id set.
- Generated-image Use / Edit / Save on assistant messages that carry `metadata.generatedImages`, plus inference, chooser, and batch-confirm dialogs before send.
- Shared `useAiChatVoice`, workspace trust/setup, and `WorkspaceMemoryPanel` (portable memory and Auto Dream are the existing panel).
- Recoverable-history drawer, per-conversation context chips, compaction progress/retry/cancel, behind `isHistoryUiEnabled()` (hidden until the flag resolves true).
- Reasoning visibility toggle, retry/recovery detail strip, trusted navigation on the selected conversation's live tool-result sink.
- `workspaceChat` locale object: 143 keys, same key names in `en`, `zh`, `es`, `fr`, `de`, and `ja`.

---

## Incomplete requirements

### T1 — Queue and run identity are still two dispatchers (P0)

**Requirements:** FR-QUE-001, FR-QUE-006, FR-QUE-013; design AD-001, AD-002, AD-003, AD-004; PRD §3.4 and §10 decisions 7–8; definition of done items 2 and 3.

**Current behavior:** `AIChatCoordinator.startRun` sends an idle conversation straight into `runModule.createRun` and `scheduler.submit`. Only a second send, while `liveRuns` or the engine is busy, calls `busySubmit` and becomes a durable pending row. `createRun` is called without `sourceId`. There is no `AIChatWorkspaceRunDispatchBridge.ts` and no `AIChatWorkspaceEventRouter.ts`.

**Why it is incomplete:** FR-QUE-001 requires every accepted ordinary message to become a durable pending record before it is considered queued or sent. AD-007 and the design migration say the pending queue owns dispatch and the run envelope is created at scheduling claim, linked by `sourceId`. The plan explicitly deferred this bridge. Busy-path steer / cancel / resume / pending bubbles already exist and must be preserved; this task is the ownership migration, not a second queue UI.

**Work:**

1. Make idle and busy sends both create one pending row first.
2. Widen `AIChatRunEntity.sourceId` from `varchar(64)` to the design length (100) and set it to the pending id when the scheduler claims the row. Today: `src/entity/AIChatRun.entity.ts` column length 64.
3. One dispatch authority. The coordinator must not call the engine for a message the queue will also drain.
4. Map `pendingMessageId`, `clientRequestId`, `runId`, user `messageId`, and assistant `messageId` in one document and one test.
5. Restart still shows recoverable pending rows and does not contact the provider until the existing explicit recovery rule.

**Tests to add:** coordinator test that an idle send creates a pending row and no independent engine submit; restart test that no provider call happens; identity mapping test that one user message cannot produce two jobs.

### T2 — Plan continuation is not idempotent across reload (P0)

**Requirements:** FR-PLN-008; design AD-007; acceptance criteria 11–12; invariant “a plan transition creates at most one continuation pending row.”

**Current behavior:** `onLegacyPlanAction` in `AiChatCenterSurface.vue` (around the `planDecisionInFlight` ref) checks the IPC result, then calls `performOrdinarySend`. `selectedConversation.sendMessage` always allocates `createClientRequestId()` (random). The in-flight guard is a renderer `ref`. Idle continuations do not go through the pending queue. The design id is:

```text
plan-cont-<first 48 hex chars of SHA-256(planId + ":" + version + ":" + decision)>
```

**Gap:** A renderer reload or a replayed successful decision can submit a second continuation. A failed continuation after a persisted approval cannot safely retry, because a second click sees a new version and the null-result branch refuses to send.

**Work:**

1. Derive the continuation `clientRequestId` with the AD-007 hash.
2. Submit that continuation through the pending queue (after T1, or through the current queue API if T1 is still open — do not create a third path).
3. Main process treats a repeated id as the same pending row.
4. Tests: null approval starts nothing; successful approval starts one row; reload and a second click do not create a second row.

### T3 — Generated-image batch progress, stop, and retry never render (P0 / P1)

**Requirements:** FR-IMG-010, FR-IMG-011, FR-IMG-012; presentation §13.2 “Generated-image batch”; journey 17.6.

**Current behavior:** Batch progress, Stop, and Retry live on `AiChatV2Message` when `messageType` is `tool_call` or `tool_result` and `toolName` is the batch tool (`isBatchToolCard` in `AiChatV2Message.vue`). The workspace transcript folds those messages into `AiChatExecutionGroup`. The group renders `AiChatExecutionRow` only. It does not mount `AiChatV2Message` and does not emit `stop-batch` or `retry-generated-image-batch`.

The center handlers (`onRetryGeneratedImageBatch`, stop via `stopActiveRun`) exist, and component tests emit those events on the transcript stub. The live grouped transcript never produces them.

`SemanticToolResult.vue` for `outputKind === "images"` renders the label “Images generated” and no thumbnail, Open, Use, Edit, Save, progress, retry, or stop. Use / Edit / Save still work when `metadata.generatedImages` is on the assistant message, because that message is rendered with `AiChatV2Message`.

**Work:**

1. When a tool message is a generated-image batch card, surface it outside the collapsed group the same way outbound email and skill install are surfaced, or teach the execution row to render the batch progress view and emit stop/retry.
2. Keep successful outputs. Retry sends only `retryableReferences` with the original instruction (the center handler already does this once the event fires).
3. Stop cancels remaining batch work and keeps completed files.
4. Replace the image-count label with thumbnails and the allowed actions (§13.2), or document that the assistant-message tile is the only action surface and still show batch progress somewhere visible.
5. Add a transcript test that mounts a real batch `tool_result` and finds Stop / Retry in the DOM. Do not only `emit()` the event from the test.

### T4 — Permission resume failure removes the decision card (P0)

**Requirements:** FR-PER-007; failure-state table “Permission decision failure — keep the decision actionable.”

**Current behavior:** `grantToolPermission` in `src/views/store/selectedConversation.ts` calls `markPermissionPromptExecuting`, which sets `needsPermissionPrompt: false`. On `{ ok: false }` it replaces `toolResult` with `{ error, success: false }` and does not restore `needsPermissionPrompt`. The transcript predicate `isPermissionPrompt` requires `needsPermissionPrompt === true`, so the card unmounts.

`AiChatCenterSurface.test.ts` (“keeps the decision actionable and retries after a failed resume”) re-emits the **original** message object. That proves the in-flight set was cleared. It does not prove the card is still on screen.

The `catch` path sets `errorMessage` and also leaves `needsPermissionPrompt` false.

**Work:**

1. On resume failure, restore `needsPermissionPrompt: true`, clear `executionPending`, keep the safe error visible, and leave Grant / Deny mounted.
2. Assert against the rendered card, not a second synthetic emit of the pre-failure message.
3. Announce the error once (A11Y-005) without moving focus away from the card.

### T5 — Agent-task cancel is a stub (P1)

**Requirements:** FR-INT-004.

**Current behavior:** `handleAgentTaskCancel` in `AiChatCenterSurface.vue` ignores `agentTaskId`. Comment: “Agent task cancellation is wired in a later milestone.” `AiChatV2.vue` has the same stub plus a `console.log`. The dialog is mounted; cancel does nothing. File results in the semantic row are the string “Files changed — see Activity”. `AiChatExecutionDetail.vue` shows summary text, not a file list.

**Work:**

1. Call the existing agent-task cancel API with the emitted id only. Never cancel the conversation run or another task.
2. Show status for that task id in Activity or the shared dialog.
3. Show file-operation paths or diffs through the existing activity/artifact surface, bounded and workspace-scoped.
4. Remove the `console.log` on the V2 stub when the shared handler exists.

### T6 — Shared orchestration is only partial (definition of done item 2)

**Requirements:** PRD §10 decision 5; §11.2; definition of done item 2.

**Current behavior:** `useChatCommandRouting.ts` exists. `AiChatV2.vue` does not import it and still owns its own `onSend` command sequence. There is no `usePlanActions.ts`, no `AiChatOverlayHost.vue`, no `chatPendingMessages.ts`, and no `chatGeneratedImageSelection.ts`. Plan, permission, image, report, and submission rules are implemented inside `AiChatCenterSurface.vue` (about 2,700 lines) rather than a shared composable both surfaces call.

**Work:** Extract the behaviors both surfaces must share, then switch Chat V2 onto those modules without changing V2 outcomes. Do this after T2–T4 so the extracted code includes the idempotent continuation and the restored permission card. Proposed names are in design §20.2; equivalent names are fine.

### T7 — Ordinary send can attach to the wrong conversation (P0)

**Requirements:** FR-SUB-007; FR-LIF-002.

**Current behavior:** `performOrdinarySend` awaits `encodeFile` for every attachment **before** `sendMessage`. `sendMessage` reads `workspaceStore.selectedConversationId` at call time. The command path captures `commandConversationId` and aborts on a mismatch. The ordinary file path does not.

**Work:** Capture the conversation id before any await. Pass that id into `sendMessage`. If the selection changed, do not send, do not clear the draft, and show the same localized stale-selection notice used for commands (`workspaceChat.command.staleAborted`).

### T8 — Rejected send keeps both the draft and an optimistic transcript row (P1)

**Requirements:** FR-SUB-003; FR-SUB-006.

**Current behavior:** `sendMessage` appends `local-user-${Date.now()}` before `startChatRun`. On failure it leaves that row in place and returns false, so the composer does not call `onAccepted`. The user sees the text in the composer and again in the transcript. The optimistic id is not the durable request id. The pending path removes the optimistic row only when `runId` starts with `pending-`.

**Work:** On rejection, remove the optimistic row (or never insert it until acceptance). Reconcile an accepted optimistic row to the durable user message by `clientRequestId`, including the idle-run path, with no duplicate bubble.

### T9 — Localization key `aiChatV2.cancel` is missing (P1)

**Requirements:** §16 items 1–2; acceptance criterion 25.

**Current behavior:** `GeneratedImageChooserDialog.vue` and `GeneratedImageBatchConfirmDialog.vue` call `t("aiChatV2.cancel")`. The `aiChatV2` object in `src/views/lang/en.ts` has no `cancel` key (the only “cancel” line inside that object is `stop_hint`). The `|| "Cancel"` fallback shows English in every language.

**Work:** Add `cancel` under `aiChatV2` in `en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, and `ja.ts`, or point both dialogs at an existing shared cancel key that is already translated (`common` / the key at the existing Cancel entries). Add a parity assertion so a new `t("aiChatV2.*")` key in these dialogs fails when any language file lacks it.

### T10 — Default-route acceptance suites are not certified (release gate)

**Requirements:** §22.3 items 1–10; §21 phase exit gates; success metrics 1–2; definition of done items 4 and 5.

**Current behavior:** E2E specs for queue, outbound email, and conversation report accept either `[data-testid="workspace-transcript"]` or `[data-testid="ai-chat-root"]`. That allows a pass on the legacy dock. This audit did not run `yarn test:e2e`. The plan lists this certification as remaining backlog.

**Work:** Run, on `/aiworkspace` only, and fix failures:

1. Eight queue and steering scenarios.
2. Outbound draft, review, approval, one delivery claim on double-click, delivery-unknown with no auto-retry.
3. Generated-image edit, batch, partial failure, retry, stop, save (will fail until T3).
4. Conversation report: capability on, capability off, AI disabled, selection limit.
5. Plan approve-to-execute and null decision (will stay weak until T2).
6. Permission grant and deny, including failed resume still showing the card (T4).
7. Slash, goal, scheduled-loop approval, loop pause/resume/stop.
8. Voice ready, missing runtime, missing model, mic denial, transcription merge, spoken response.
9. Workspace select, trust review, memory, scoped slash and mention refresh.
10. Two conversations executing with no event leakage.

### T11 — Accessibility, security, soak, and rollback decision (definition of done 7–12)

**Requirements:** A11Y-001..010; §14; §20; AD-009; definition of done items 7–12.

**Not done:**

- No component test was found for 200% scaling, reduced motion, or focus return for the new chooser, batch confirm, history drawer, or skill-install card in the workspace.
- No security review record for this branch covering AI gating, permission tokens, outbound authorization, report privacy, image ownership, and the new history-reference IPC.
- No parity/rollback telemetry (design §18). A search for those counters in `src/` returned nothing.
- Chat V2 removal is correctly not started. AD-009 soak (14 days, sample and incident gates) has no evidence.

**Work:** After T1–T10, run the accessibility and security reviews, add the bounded counters, then hold the soak. Do not delete Chat V2 in this task.

### T12 — History and compaction need an end-to-end proof (P1, flag-gated)

**Requirements:** FR-HIS-001..005; acceptance criteria 32–33.

**Current behavior:** Drawer, chips, submission id, ack handling, and compaction controls are in `AiChatCenterSurface.vue` and stay hidden while `historyUiEnabled` is false (`isHistoryUiEnabled()` fail-closed). That matches “under the existing history rollout flag.” There is no Electron journey in this audit that selects an archive passage, sends, and checks accepted vs rejected chips.

**Work:** With the flag on in the test harness: search, select, send opaque ids only, clear only accepted chips, reuse `submissionId` on transport retry, cancel compaction without clearing chips, and confirm the mounted window stays at 200 messages. With the flag off, the drawer and new reference fields must not be submitted.

---

## Defects (incorrect behavior, not just missing scope)

### D1 — Failed permission resume drops the card

Same as T4. User cannot retry from the UI. Test coverage gives a false pass.

### D2 — Batch Stop and Retry are dead in the default transcript

Same as T3. Handlers and tests exist; the grouped transcript does not emit the events.

### D3 — Attachment send follows a conversation switch

Same as T7. Command sends are guarded. File encoding is not.

### D4 — `aiChatV2.cancel` missing in all six locale files

Same as T9. Chooser and batch-confirm Cancel buttons always use the English fallback.

### D5 — Rejected send duplicates the draft into the transcript

Same as T8. Optimistic row id is `local-user-${Date.now()}`, not `clientRequestId`.

### D6 — Plan continuation id is random

Same as T2. Does not match AD-007. Idle continuation bypasses the pending queue.

### D7 — `handleAgentTaskCancel` discards the task id

Same as T5. V2 logs the id and also does not cancel.

### D8 — Image semantic row is a count label

`SemanticToolResult.vue` `outputKind === "images"` has no actions. This violates §13.2 even when the assistant bubble shows thumbnails separately.

---

## Requirement checklist

Status values: **Done** (reachable workspace path, not a full E2E certificate), **Partial**, **Open**.

| ID | Status | Note |
| --- | --- | --- |
| FR-SUB-001..005 | Done | Payload, acceptance clear, paste map, shared MIME/size normalize |
| FR-SUB-006 | Partial | T8 optimistic identity |
| FR-SUB-007 | Open | T7 / D3 |
| FR-SUB-008..009 | Done | Busy composer queues; command-like input rejected while busy |
| FR-CMD-001..009 | Done | Workspace router only; V2 still has a private copy (T6) |
| FR-QUE-001 | Open | T1 idle send is not a pending row |
| FR-QUE-002..012 | Partial | True for busy-queue rows; not for the idle run path |
| FR-QUE-013..014 | Partial | Pending rows reconstruct; run/pending identity is not one model. Queue-limit copy exists on the queue service |
| FR-PLN-001..007 | Done | One decision surface; null result does not continue |
| FR-PLN-008 | Open | T2 / D6 |
| FR-PLN-009 | Done | Receipt in transcript; full plan in Activity |
| FR-PER-001..006 | Done | Card, preview, grant once, persistent via card IPC, deny text |
| FR-PER-007 | Open | T4 / D1 |
| FR-PER-008 | Done | Sidebar group attention already present |
| FR-OUT-001..010 | Done | Card mounted; delivery E2E not re-run (T10) |
| FR-IMG-001..009 | Done | Assistant-message actions, tray, inference, chooser, confirm |
| FR-IMG-010..012 | Open | T3 / D2 |
| FR-IMG-013..015 | Partial | Save handler exists; switching clears the chooser. Batch retry depends on T3 |
| FR-RPT-001..009 | Done | Per-output and conversation dialogs; entitlement-independent capability check |
| FR-VOI-001..010 | Done | Shared composable wired; no new E2E certificate (T10) |
| FR-WSP-001..010 | Done | Existing composable, trust card, memory dialog, `request-workspace` |
| FR-REC-001..008 | Partial | Retry/recovery strip added. Stable mapping for every error class was not re-proven |
| FR-LIF-001..006 | Partial | Selection guards exist for commands and plan continuation; ordinary file send does not (T7) |
| FR-SKL-001..006 | Done | Card outside the group; `/skill` does not fall through on ack failure |
| FR-BRW-001..006 | Done | Existing panels composed in the center; intervention E2E not re-run (T10) |
| FR-HIS-001..005 | Partial | UI wired, flag-gated; journey not executed (T12) |
| FR-INT-001..003 | Done | Memory panel, setup event, selected-only navigation sink |
| FR-INT-004 | Open | T5 / D7 |
| FR-INT-005 | Done | Reasoning toggle and recovery strip; preference does not change main-process auth |
| A11Y-001..010 | Open | T11 |
| §16 localization | Partial | `workspaceChat` parity holds; D4 |
| §22 / DoD gates | Open | T10, T11 |
| AD-001..004, AD-007, AD-008, AD-009 | Open | T1, T2, T6, T11 |

## Suggested order

1. D1 / T4 permission card restore (small, safety).
2. D3 / T7 conversation capture before file encode (small, privacy).
3. D2 / T3 batch progress surface (user-visible hole).
4. D4 missing cancel key.
5. D5 optimistic row on rejection.
6. T2 deterministic plan continuation.
7. T1 pending/run bridge (largest; do not start until 1–6 are stable, per PRD §3.4).
8. T5 agent-task cancel and file details.
9. T6 extract shared composables and point Chat V2 at them.
10. T10 then T12 then T11.
