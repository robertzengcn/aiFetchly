# Email forwarding, Trash and organization — third audit TODO

- Audit completed: 2026-11-06, Asia/Shanghai.
- Reviewed worktree: `/Users/cengjianze/project/aiFetchly-email-org`.
- Branch / implementation snapshot: `feature/email-forward-trash-organization` / `bebdbf1f4`.
- Specification: [PRD](./ai-email-forward-trash-organization-prd.md), including all FR-01–FR-20 and AC-01–AC-22.
- Previous audit: [second audit TODO](./ai-email-forward-trash-organization-audit-todo-2026-11-05-r2.md). This report supersedes its subsequently added blanket remediation claims; it does not overwrite that history.

## Verdict and scope

**The PRD is not fully implemented. Stage B and Stage C both have release blockers.** The update fixes several previous cases, but introduces incomplete connections between newly added helpers and the actual execution/UI paths. Passing existing tests does not cover those connections.

This is a report-only review: no application fixes, real-mailbox mutations, deployment or packaging. Source references below refer to the snapshot above. The feature worktree has no CodeGraph index representing this implementation; direct source reads were used. Findings are grouped by shared cause so the related paths can be repaired together. P1 denotes external-action correctness, content or recovery risk; P2 denotes a broken required workflow or missing acceptance behavior. This review cannot establish that no other bugs exist.

## Verification evidence

| Check | Result |
| --- | --- |
| Normal main-process feature run, with the configuration's TypeScript check | **12 files / 114 tests passed; TypeScript reported zero errors.** |
| Focused UI run | **4 files / 25 tests passed.** |
| Disposable MIME regression probes, entirely in memory | **2 required-behavior assertions failed:** duplicate-byte CID selection and composed-size upper bound. |
| Disposable delivery race probe, isolated fixtures and fake SMTP sender | **1 required-behavior assertion failed:** edited revision still submitted after final admission. Eighteen unrelated copied tests were skipped in this targeted run. |
| Real-provider compatibility, protocol socket fixtures, full Playwright journeys, performance and actual process-crash tests | Not performed; explicitly open below. Local Forge packaging is forbidden by project instructions and belongs to an operator/CI gate. |

Main command: `yarn vitest --config vite.main.config.mjs run` with `test/vitest/main/EmailOrganizationIpc.test.ts`; service suites `EmailForwardFlow.service`, `EmailForwardMaterializer`, `EmailMailboxAction.service`, `EmailOrganizationArtifactStore`, `EmailOrganizationCapabilityService`, `EmailOrganizationStageC.service`, `EmailOrganizationStartupService`, `EmailOrganizationToolPolicy`, `ImapEmailMailboxAdapter`; model suites `EmailMessageLocation.model`, `EmailOrganizationOperation.model` under `test/vitest/main/`.

UI command: `yarn vitest --config test/vitest/main/components/vitest.config.mjs run` with `EmailForwardReviewDialog.test.ts`, `EmailOrganizationOperationCard.test.ts`, `EmailOrganizationI18nKeys.test.ts`, `EmailReceiveDetail.test.ts` in its components directory.

Audit-only probes are not production changes. Their failure scenarios must become permanent regression tests as part of the corresponding repairs. All other findings below are source-confirmed unless expressly marked as remaining validation.

## What improved since the second audit

| Previous group | Current assessment |
| --- | --- |
| R01/R02 content and selected attachments | Ordinary plaintext fallback, original quoted Subject, selected CID reference and invalid-part rejection fixes are present. Duplicate-byte CID remains broken (T10). |
| R03 trusted intent | Gate added to the chat loop, but its approval flag is dropped; intent classification and exact-action binding remain incomplete (T01/T02). Scheduled guards are present. |
| R04 recovery | Evidence preservation and live destination UIDVALIDITY/presence checks improved. Kind separation and idempotent local repair remain broken (T04). |
| R05 sync identity | Normal destination-occurrence adoption is repaired. A delayed old-source fetch can still insert a duplicate identity before the location fence runs (T17). |
| R06 Undo/no-op | Single restore now filters successful items and checks destination folder/UID. It still lacks complete lineage; bulk restore still includes no-op provenance (T05). |
| R07 serialization | Mailbox actions share an account mutex. Reply delivery and reconciliation are not covered by that same admission boundary (T07). |
| R08 Trash resolution | Capability probe rejects ambiguity, but default action-service resolution still chooses the first Trash folder (T06). |
| R09 edit/discard race | Additional reread narrows the race but does not close it; deterministic probe still fails (T03). |
| R10 outcome honesty | Partial/all-rejected initial submissions are improved. Duplicate calls and consumer displays still misrepresent outcomes (T12). |
| R11/R12 UI journeys | Bcc editing, resume prop, history APIs, polling, picker and transcript branch added. Required callers/projection paths are incomplete (T13/T14). |
| R13 preview | Authoritative per-message preview data is present; a usable trusted bulk UI remains missing (T13). |
| R14 localization/accessibility | Row action buttons and generated header translations improved. Edit locale and raw states/errors remain incomplete (T15). |
| R15 search | Flag normalization, date postfilter and limitation reporting improved. Pagination and exact filter semantics remain incomplete (T09). |
| R16 AI entitlement | AI tools now gate before parsing/work. No residual entitlement defect identified in this pass; focused policy/IPC tests pass. |
| R17 retention | All-revision discard cleanup, periodic sweeps and temporary-file cleanup added. Send still lacks an explicit revision-expiry check (T03). |
| R18 MIME limits | Nested signed/encrypted MIME rejection added. The byte bound underestimates actual encoding and is not persisted (T11). |

## Requirement coverage

“Partial” means code exists but at least one specified acceptance condition is blocked. “Implemented; validation open” is not a release sign-off.

| Requirement | Assessment | Remaining work |
| --- | --- | --- |
| FR-01 dedicated AI tools | Implemented; validation open | Exercise real discovery and chat rendering; T01/T02/T14. |
| FR-02 exact message/account | Partial | Complete restore lineage, destination resolution and concurrent admission; T02/T05–T07. |
| FR-03 capabilities/folders | Partial | Use the same fail-closed resolver in actual actions; T06. |
| FR-04 create/edit/review | Partial | Saved draft entry point, outcome display and locale preservation; T12/T13/T15. |
| FR-05 visible original content | Partial | Duplicate-byte inline-image corruption; T10. |
| FR-06 actual approved attachments | Partial | CID ownership and actual composed-message limits; T10/T11. |
| FR-07 direct/review/draft intent | Partial | Dropped approval, classification and exact bindings; T01/T02. |
| FR-08 server Trash/local convergence | Partial | Recovery, no-op evidence, Trash resolution, concurrency and delayed sync; T04–T07/T17. |
| FR-09 recorded restore | Partial | UIDVALIDITY/version/operation lineage and persistent access; T05/T13. |
| FR-10 processing/history preservation | Partial | Reply/move admission race and duplicate sync identity; T07/T17. |
| FR-11 durable operations/restart | Partial | Incorrect SMTP reconciliation and unrecoverable already-applied location; T04; V01. |
| FR-12 exact main-process authorization | Partial | Intent action/payload binding, send revision race and restore lineage; T02/T03/T05. |
| FR-13 honest uncertainty/partial delivery | Partial | Reconciliation kind confusion and duplicate/partial display; T04/T12. |
| FR-14 chat/mailbox controls | Partial | Resume/history/bulk journeys and normal chat card projection; T13/T14. |
| FR-15 six languages | Partial | Edit locale and dynamic state/error text; T15. |
| FR-16 block unattended mutations | Implemented on advertised tool paths; validation open | Existing scheduled-origin guards/policy checks present; complete AC-19 full-access end-to-end in V01. |
| FR-17 scoped local/server search | Partial | Continuations, date semantics and attachment predicate; T09. |
| FR-18 frozen bulk targets | Partial | Detached executor throws away frozen versions; T08. |
| FR-19 bounded bulk/progress | Partial | Detached executor and missing UI; T08/T13. |
| FR-20 cancel unstarted work | Partial | Useful background execution/UI required; T08/T13/T14 and cancel/restart fault tests. |

## Remediation status (2026-11-06, updated on this branch)

| Group | Status | Notes |
| --- | --- | --- |
| T01 direct-action permission | **Resolved by design change** — the intent gate is BLOCK-ONLY (review/draft/negation refuse; send_now keeps the single permission card), so the dropped-approval path no longer exists; the third /review found the substring matcher injectable, so card-skip was deliberately removed | `19e440d2f`, `6c62ed025` |
| T02 resolver precision | **Fixed** — capability-question class + 'do not move' negation added | `6c62ed025` |
| T03 send race + expiry | **Fixed** — expiry enforced at delivery; last pre-SMTP admission moved after dispatch marking | `6c62ed025` |
| T04 reconcile | **Fixed** — kind guard (earlier) + idempotent already-applied local repair | `6c62ed025` |
| T05 restore provenance | **Fixed** — full after-locator binding incl. UIDVALIDITY; noop excluded from bulk provenance (earlier) | `6c62ed025`, `19e440d2f` |
| T06 Trash resolution | **Fixed** — fallback resolver ambiguity fail-closed; noop requires present evidence; missing config/failed probe honest | `6c62ed025` |
| T07 serialization | **Partially fixed** — reconcile under account mutex; full reply-admission coordination remains open | `19e440d2f` |
| T08 detached executor | **Fixed** (third review — real selection entity threaded) | `19e440d2f` |
| T09 search continuations | **Partially fixed** — cursor advances folders, exposed through schemas; per-folder uid offsets remain open | `6c62ed025` |
| T10 duplicate-byte CIDs | **Fixed** — sequential per-hash candidate consumption in document order preserves part identity | `6c62ed025` |
| T11 composed bound | **Fixed** — folding + header budget + 4% margin upper-bounds the encoder; persisted on create/edit | `6c62ed025` |
| T12 outcome display | **Fixed** — already_attempted warning with prior outcome; partial counts on the page | `6c62ed025` |
| T13 UI journeys | **Partially fixed** — saved-draft resume caller wired; history/bulk preview UI still minimal | `6c62ed025` |
| T14 chat cards | **Fixed** — org cards checked in the skip loop (common call/result sequence) + anchor path; Cancel uses the displayed operation | `6c62ed025` |
| T15 localization | **Fixed** — draft locale persisted/reused on edit; item_status localized with te() guards in six languages | `6c62ed025` |
| T16 Sent copy | **Open by recorded scope decision** — `not_requested` per design §9.4 initial-release allowance; AC-22 requires Sent-append support (deferred with provider validation) | — |
| T17 delayed source sync | **Fixed** — obsolete old-source observations detected via operation-authored locators and skipped | `6c62ed025` |
| V01/V02 validation gates | **Open** — operator/CI scope (wire fixtures, Playwright, perf, live mailboxes); AGENTS.md forbids local packaging | — |

## Detailed TODO — confirmed defects and incomplete implementation

### T01 — P2: direct-action permission is lost between gate and executor

Evidence: `src/service/AIChatQueryLoop.ts:4368`, `:4377`, `:6868`, `:6880`, `:6903`, `:6952`.

The new gate sets `organizationSendGateAllowed` for direct instructions and passes it to `prepareToolCallWithHooks`. Both returned `PreparedToolCall` objects omit the property. Execution destructures `undefined`, so the generic request-scoped permission path cannot recognize the approval. Explicit “forward this … now”/“delete this” still receive redundant permission rather than satisfying AC-01/FR-07.

- [ ] Preserve approval through every prepared-call return, including blocked/hook paths and asynchronous routing where applicable.
- [ ] Validate the final effective hook-adjusted arguments against the approved payload; do not just forward an unbound boolean (T02).
- [ ] Add a real query-loop → prepared call → executor test proving one direct action without a second prompt, and zero dispatch for review/draft requests.

### T02 — P1: trusted intent is a broad substring result, not exact-action authorization

Evidence: `src/service/emailOrganization/EmailOrganizationIntentResolver.ts:20`, `:80`, `:125`, `:185`; `src/service/AIChatQueryLoop.ts:4369`; `src/service/EmailOrganizationAiTools.ts:324`.

The resolver returns `send_now` for “Can you explain how to forward this email?” and “Do not move this to trash”: the first contains `forward this`; the second contains `move this to trash` and has no matching negation phrase. All send phrases are English, so straightforward Chinese/Japanese/etc. direct requests degrade to draft-only. More fundamentally, one `send_now` value covers forwarding, Trash and restore without binding the requested verb, source/account, recipients, revision or operation. The tool then issues authorization for model-selected draft arguments. A user authorizing deletion must not thereby authorize forwarding another draft. T01 currently prevents this new boolean from skipping the generic prompt; fixing T01 alone would expose the unbound fast path.

- [ ] Separate capability questions, instructions, negation/wait conditions, supported language variants and ambiguous follow-ups.
- [ ] Carry a host-owned action decision bound to the exact trusted selection and approved payload; reject unrelated verbs, drafts, accounts, recipients and hook mutations.
- [ ] Test both quoted examples, the PRD's “Can this email be forwarded?”, six-language direct/negative/review requests, and wrong-tool/wrong-payload calls after a valid direct request.

### T03 — P1: send still races edits/discard; revision expiry is not enforced at delivery

Evidence: `src/service/emailOrganization/EmailForwardDeliveryService.ts:324`, `:367`; `src/service/emailOrganization/EmailForwardDraftService.ts:296`, `:535`; AI authorization issuance at `src/service/EmailOrganizationAiTools.ts:328`.

The final draft reread is followed by an awaited `markAttemptDispatched` before SMTP. An edit/discard can commit during that gap. The deterministic probe edits the draft inside this boundary: the required zero-SMTP assertion fails with **one SMTP call**, sending the stale revision. Rereading earlier is not an atomic admission protocol. Separately, delivery never checks `revision.expiresAt`; AI can mint a fresh authorization for expired retained artifacts before the hourly purge. Preview expiry alone cannot enforce the service rule.

- [ ] Coordinate editing/discard and dispatch admission using an atomic revision-bound state transition or shared lock, with explicit behavior once dispatch has won.
- [ ] Enforce revision/artifact expiry at the trusted delivery boundary before dispatch, independently of cleanup timing and authorization TTL.
- [ ] Permanently test edit and discard during artifact loading, final admission and dispatch marking; expired revision plus fresh authorization must not call SMTP.

### T04 — P1: reconciliation mixes SMTP with MOVE and cannot finish an already-applied local move

Evidence: `src/service/emailOrganization/EmailMailboxActionService.ts:1056`, `:1062`, `:1121`, `:1165`; generic reconcile IPC at `src/main-process/communication/emailOrganization-ipc.ts:436`.

`reconcileOperation` never checks operation kind. An unknown forward whose source remains in Inbox enters the MOVE branch and becomes `failed / NETWORK_BEFORE_DISPATCH`; forwarding normally leaves the original in place, so this proves nothing about SMTP acceptance. It incorrectly resolves uncertainty and can encourage a new submission.

For a MOVE, crash after `applyMove` but before item finalization leaves the local location at version v+1. Recovery always retries `applyMove(expectedVersion=beforeLocationVersion=v)`. Even with verified destination evidence, the same CAS keeps failing as `LOCAL_COMMIT_PENDING`; repeated checking cannot complete recovery.

- [ ] Route reconciliation by kind. SMTP unknown must remain unknown without SMTP/Sent evidence; never infer non-submission from source presence.
- [ ] Accept an already-applied exact destination locator with matching operation lineage as idempotent local success; reject unrelated newer state.
- [ ] Reconcile under the same account coordination as mutations (T07), retaining append-only evidence.
- [ ] Add crash tests before/after evidence, local location commit and item completion, plus unknown SMTP with source still present. Recovery must neither repeat I/O nor invent failure.

### T05 — P1: Undo and bulk restore still accept insufficient provenance

Evidence: `src/service/emailOrganization/EmailMailboxActionService.ts:747`, `:767`; `src/model/EmailOrganizationOperation.model.ts:365`, `:374`; `src/service/emailOrganization/EmailOrganizationSelectionService.ts:148`.

Single Undo compares only current destination folder and optionally a recorded numeric UID. It ignores destination UIDVALIDITY, expected after-version and `lastOperationId`. The same UID after a validity reset, or a later operation returning to that folder/UID, can pass old intent. If no UID was recovered, the check becomes even weaker. Bulk destination lookup still includes `noop` items and chooses the newest record: clicking Trash on an already-trashed message records Trash as its before-folder and can override a genuine original Inbox destination.

- [ ] Bind Undo/restore to full after-locator, version and originating operation; require verifiable evidence if any mapping component is unavailable.
- [ ] Exclude no-op records from bulk restore provenance, matching the single-restore filtering.
- [ ] Validate provenance against current lineage when preparing and executing a restore, rather than merely finding any historical successful Trash.
- [ ] Test real Trash → repeated no-op → bulk restore; Trash → Restore → Trash → old Undo; UIDVALIDITY reset with the same UID; and missing destination mapping.

### T06 — P1: capability safety is bypassed in actual Trash execution; failed probes can report success

Evidence: `src/service/emailOrganization/EmailMailboxActionService.ts:148`, `:170`, `:1221`, `:1231`; default construction at `src/main-process/communication/emailOrganization-ipc.ts:261`, `:281` and `src/service/EmailOrganizationAiTools.ts`.

The capability service rejects multiple Trash candidates, but the default action service is constructed without it and falls back to `.find(specialUse === '\\Trash')`. Thus discovery can report ambiguous/unavailable while mutation chooses the first folder. The actual resolver also lacks the promised consistent writable/configured destination handling.

The “already in Trash” path checks for absent and UIDVALIDITY-changed only. Missing receive configuration or `checkMessagePresent` returning `failed` falls through to a successful no-op. A disconnected account therefore reports verified completion without verification.

- [ ] Use one authoritative capability/destination resolver in UI, tools and default service construction; reject ambiguity and unusable destinations consistently.
- [ ] Require explicit `present` evidence for no-op success; return actionable unavailable/unknown states on missing config or failed probes.
- [ ] Test ambiguous folders through the actual default tool/IPC path, plus read-only destination, missing configuration and failed presence checks.

### T07 — P1: account serialization does not coordinate all competing paths

Evidence: `src/service/emailOrganization/EmailMailboxActionService.ts:94`, `:102`, `:928`, `:1056`; `src/service/emailReply/EmailReplyDeliveryService.ts`.

The mailbox-action mutex covers its single/bulk/restore paths, but reply delivery does not acquire it and reconciliation does not use `runSerialized`. Reply invalidation occurs only after the server MOVE/local commit and is best-effort. A reply can pass its existing admission check while a MOVE is in flight, then submit before/after delayed invalidation. The new mailbox lock alone does not implement the PRD §12 stale reply-approval requirement or protect reconciliation from a newer move.

- [ ] Coordinate location changes, reply final admission and reconciliation using a shared boundary or version/lease protocol.
- [ ] Ensure a failed reply invalidation cannot leave an old approval usable for a new send.
- [ ] Test paused reply admission versus Trash/restore/reconcile, and paused reconcile versus a newer operation. Confirm history remains intact and stale approvals cannot dispatch.

### T08 — P1: every item in the new detached bulk executor loses its frozen version

Evidence: `src/service/emailOrganization/EmailMailboxActionService.ts:330`, `:372`, `:438`, `:451`, `:579`, `:689`.

Both prompt-start methods read a valid selection, but `executeBulkLoop` passes a fabricated selection containing `locationVersionsJson: '{}'` to `bulkOne`. `selectionFrozenVersion` requires a numeric entry and throws for every message. The new background Trash/restore path returns an operation ID then fails all items without moving anything. Existing awaited bulk tests exercise a different path.

- [ ] Carry the actual frozen selection/version map into the detached executor; do not replace it with an assertion-cast partial entity.
- [ ] Preserve expiry and per-item revalidation when execution waits for the account queue. Record a durable failure if detached setup crashes.
- [ ] Test start → immediate returned ID → progress → completion for both Trash and restore; include one stale version, cancellation and mixed outcomes.

### T09 — P2: search continuations repeat the first page; exact server filters remain incomplete

Evidence: `src/service/emailOrganization/EmailOrganizationSearchService.ts:123`, `:157`, `:203`, `:236`, `:263`, `:282`; `src/service/emailOrganization/ImapEmailMailboxAdapter.ts:279`, `:295`, `:314`.

Local search ignores the input cursor and returns the literal `local-page`. Server search parses `uidOffset` but never uses/passes it; the adapter always slices UIDs from zero. A full page emits the original folder index with offset zero. Page two repeats page one, and later folders/messages are unreachable.

Date postfilter uses the sender's envelope Date while IMAP SINCE/BEFORE prefilter uses server receipt-date semantics. Different timestamps can remove valid results before postfiltering. Only one page of candidates is fetched before exact filtering, so a short/empty page can be marked complete while later valid candidates exist. Attachment filtering returns broader rows with null presence/incomplete disclosure; it still does not implement the exact requested predicate. Without a filter, unknown attachment presence is reported as false.

- [ ] Implement stable query/account/folder-bound continuation with an advancing local key and actual per-folder UID position; validate malformed/foreign cursors.
- [ ] Define one received-time basis, request the matching server timestamp, and make coarse prefiltering a safe superset of exact UTC bounds.
- [ ] Continue scanning within the declared budget after candidates fail exact filters; preserve a resumable continuation on every bound.
- [ ] Evaluate attachment presence or explicitly refuse that exact server filter and offer sync/refinement. Keep unknown distinct from false.
- [ ] Test 3+ disjoint pages, multiple folders, final partial page, date-header/receipt disagreement, timezone boundary, unknown attachments and no false completeness.

### T10 — P1: distinct inline CIDs with identical bytes corrupt selected content

Evidence: `src/service/emailOrganization/EmailForwardMaterializer.ts:488–505`.

`relinkCidImages` maps attachment base64 bytes to one last CID. Two original inline images can have different CIDs but identical bytes. Selecting the first and excluding the second overwrites the map with the excluded part, and both image references become empty. The deterministic probe expected `cid:selected` and received `<img src=""><img src="">`. The ordinary one-CID fix does not preserve part identity.

- [ ] Preserve original CID/part association through parsing instead of treating byte equality as ownership; resolve duplicates without dropping an approved image or referencing an excluded part.
- [ ] Test identical bytes with distinct CIDs, reversed order, each selected individually, both selected, and all excluded against the final HTML and MIME attachments.

### T11 — P1: composed-size bound is not an upper bound and is discarded on persistence

Evidence: `src/service/emailOrganization/EmailForwardMaterializer.ts:252`, `:328`; `src/service/emailOrganization/EmailForwardDraftService.ts:204`, `:343`.

The estimator counts raw base64 expansion plus 8 KiB, omitting line-folding overhead and variable MIME/header encoding. A memory-only Nodemailer composition with a 15 MiB attachment produces **21,524,246 bytes**, while the estimator returns **20,979,720 bytes**, under by 544,526 bytes. Near the 25 MiB total limit this can admit an oversized message. Both draft create/update explicitly persist `composedByteCount: null`, contradicting the remediation claim that the bound is persisted.

- [ ] Enforce actual serialized MIME size or a proven upper bound including folding, encoded headers/bodies, filenames, recipients and boundaries.
- [ ] Persist the measured/bounded size in each immutable revision and expose it consistently for review/admission.
- [ ] Test actual encoder output at/below/above the cap, long Unicode metadata, large HTML/plain alternatives and multiple attachment parts; assert persistence on create and edit.

### T12 — P2: duplicate/partial outcomes still become misleading user or AI success

Evidence: `src/service/emailOrganization/EmailForwardDeliveryService.ts:153`, `:192`; `src/service/EmailOrganizationAiTools.ts:347–374`; `src/views/pages/emailreceive/detail.vue:306–322`; `src/views/components/emailOrganization/EmailOrganizationOperationCard.vue:280`.

`already_processed` is returned for an existing operation without its durable outcome. The tool falls through to `success: true`, and the detail page says “already submitted” even if the prior operation failed or is unknown. The detail page also treats every initial `submitted` as success although it can be partially accepted. The card shows recipient counts but not which addresses were accepted/rejected/unknown, preventing the per-recipient review promised by AC-18. It renders only a destination/status for mailbox items, not an identifiable source summary.

- [ ] Project the existing durable operation's actual outcome for duplicates; distinguish already attempted from accepted by SMTP.
- [ ] Display partial/unknown outcomes consistently across tool envelope, dialog, page and operation card; show exact private recipient outcomes and affected message identity.
- [ ] Test duplicate calls after failed/partial/unknown/successful operations, page-level partial handling, and address-level result rendering. Preserve the no-resend guarantee.

### T13 — P2: saved-draft resume, durable history and bulk UI have no complete user journey

Evidence: `src/views/components/emailOrganization/EmailForwardReviewDialog.vue:167`, `:237`; `src/views/pages/emailreceive/detail.vue:128`, `:332`; `src/views/api/emailorganization.ts:259`, `:268`.

The dialog accepts `existingDraftId`, but no parent passes it. The detail page ignores the saved draft ID; reopening supplies only a message ID and creates a fresh draft. User edits/recipient choices therefore cannot be resumed through the product. Operation-list and background bulk APIs exist but have no renderer callers. There is no durable history/Trash entry point after navigation/restart and no complete bounded search → select → frozen preview → execute/cancel flow. Backend APIs and optional component props are not completed FR-04/FR-14/FR-18–20 journeys.

- [ ] Persist/use saved draft IDs and provide a discoverable draft list/resume route. Test save → close → reopen/navigation/restart with the same revision and edits.
- [ ] Connect operation history to mailbox/Trash UI, including persistent Restore/reconcile and reopening unfinished work.
- [ ] Build the Stage C selection/preview UI showing account, exact messages, source/destination, coverage, expiry and changed items; connect actual background start/status/cancel APIs after T08.
- [ ] Add/update component tests with these UI changes, as required by AGENTS.md, plus Playwright coverage for the cross-component journeys.

### T14 — P2: normal chat results lose cards; restore card retries can repeat stale intent

Evidence: `src/views/components/aiChatWorkspace/AiChatWorkspaceTranscript.vue:215`, `:393`, `:430–472`; `src/views/components/emailOrganization/EmailOrganizationOperationCard.vue:266`, `:330`, `:337`, `:368`.

The transcript checks organization results only on a tool group's anchor. Normal groups begin with `tool_call`; the subsequent `tool_result` is consumed by the skip loop, which checks other card types but never organization cards. The promised progress/Undo card therefore disappears on the common call/result sequence. Forward draft creation also has no interactive forward review-card projection.

The folder picker opens for `LOCATION_STALE` as well as a missing destination, inviting a retry of an invalid old Undo. It filters Trash only, not folder writability, and does not reset a previous selection. There is also a control-target inconsistency to address when connecting live restore work: Cancel uses `props.operationId`, whereas load/reconcile/restore use `activeOperationId`. Current successful restore switching is terminal, so this inconsistency alone is not a demonstrated cancellation failure.

- [ ] Surface organization cards in grouped, subsequent and unpaired result paths; add a review/draft card with a functioning authorization journey.
- [ ] Use the displayed operation consistently for all controls. Handle stale lineage by refresh/clarification, not a destination retry; offer only valid writable replacement folders and reset selection.
- [ ] Test realistic ordered chat messages, restored chat history, review-only drafts, failed/unknown cards, replacement destinations, stale Undo, and cancellation after operation switching.

### T15 — P2: localization remains incomplete and changes language on edit

Evidence: `src/service/emailOrganization/EmailForwardDraftService.ts:139`, `:280`; `src/service/emailOrganization/EmailForwardMaterializer.ts:244`; `src/views/components/emailOrganization/EmailOrganizationOperationCard.vue:212`, `:290`, `:372`.

Create passes locale to materialization, but update omits it and does not retain the draft locale, so editing a Chinese/Japanese/etc. forward rebuilds its generated quoted headers in English. Operation labels dynamically construct keys not covered for every kind/status; `t(key) || fallback` does not handle a missing key when the translator returns the key itself. Per-item statuses, error codes and new account/picker errors still reach users untranslated. Key-existence tests alone do not exercise these states.

- [ ] Persist/reuse draft locale through every edit/materialization path.
- [ ] Translate all supported operation/item states and actionable error messages in en/zh/es/fr/de/ja; explicitly handle unknown states without exposing keys/codes as the primary message.
- [ ] Exercise each state in six-language component tests and keyboard-only dialog/card/picker journeys, including loading, failure, cancel and restore.

### T16 — P2: Sent-copy failure acceptance is deferred rather than implemented

Evidence: `src/service/emailOrganization/EmailForwardDeliveryService.ts:371` and Sent-copy status writes (`not_requested`); PRD AC-22.

The delivery path always uses `not_requested` for Sent copy. It cannot execute the specified “submission succeeds but Sent-copy storage fails” scenario or show its separate warning. The prior audit's remediation note calls this deferred; that is a PRD gap rather than completed acceptance.

- [ ] Implement the agreed Sent-copy policy and separate append outcome/warning without changing SMTP acceptance or enabling resend; test SMTP accepted + append failed.
- [ ] Alternatively obtain and record an explicit product/spec scope change before marking AC-22 complete. Do not equate `not_requested` with a tested storage failure.

### T17 — P1: delayed source sync can still create a duplicate after destination adoption

Evidence: `src/service/emailReceive/EmailReceiveSyncService.ts:265–284` and the subsequent provider-key lookup/insertion path; `src/model/EmailMessageLocation.model.ts:90–100`; received-row refresh in `src/modules/EmailReceivedMessageModule.ts:123`.

Normal destination sync now finds the exact verified location and updates the original received row's provider key. However, an older source-folder fetch may already be in flight. If it persists after destination adoption, its old provider key no longer finds the original row; it can insert a second application message for the old source occurrence. The sync-authority fence runs while recording location for that new message ID, after insertion, and only protects a preexisting locator for the same message ID. It therefore cannot prevent this duplicate. The duplicate can split processing/draft/history state from the moved original and show stale source-folder content.

- [ ] Coordinate sync persistence with moves/adoption, or retain durable occurrence lineage/tombstones so an obsolete source observation cannot become a new application identity.
- [ ] Make received-row identity changes and location fencing coherent; do not rely only on a per-message guard after insertion.
- [ ] Test: pause source persistence → Trash completes → destination sync adopts original ID → resume old source persistence. Assert one logical message, preserved relationships, and the verified destination locator. Repeat with restore and stale snapshots in reverse order.

## Remaining validation and completion gates

### V01 — acceptance, integration and fault coverage

- [ ] Add permanent tests for T01–T17 at their actual caller boundaries. Since the prior audit commit, UI tests changed only the forward dialog fixture; new transcript/card behavior lacks corresponding new regression assertions.
- [ ] Run the full required component suite after UI repairs, and Playwright flows for direct send, review-only, saved-draft resume, persistent history/Restore, ambiguous selection, bulk preview/cancel and all six languages.
- [ ] Add deterministic protocol socket fixtures for full-source retrieval, UIDVALIDITY resets, MOVE mapping/nonmapping, disconnect before/after dispatch and partial SMTP acceptance. Existing mocked adapter tests do not replace wire behavior.
- [ ] Execute crash/restart tests at every durable boundary: claim, dispatch marking, provider acknowledgement, evidence save, local location save, item save and cancellation around item 40/100. Demonstrate zero blind repeat submissions and zero wrong-message moves (AC-06–AC-12/AC-14–AC-17).
- [ ] Revalidate destination-occurrence adoption with concurrent stale sync, provider move/reset, legacy records and reply history; show no duplicate application identity or indefinitely stale location. The new sync fence is a source change, not evidence that all interleavings pass.
- [ ] Verify AI-disabled/manual-control independence and scheduled full-access denial through the real IPC/chat entry points (AC-19), not only isolated guards.
- [ ] Verify ambiguous contact/account/message requests cause clarification without side effects; email/attachment instructions cannot supply intent; displayed bulk targets match the approved immutable selection (AC-03/AC-13/AC-14).
- [ ] Confirm retention expiry, all-revision discard, app-open sweeps, crash-left temporary artifacts and encrypted storage with deterministic clock/filesystem fixtures. Expiry must deny send even before deletion (T03).
- [ ] Validate provider capabilities on approved test accounts and record OS/provider/protocol evidence. No real-mailbox mutation was performed during this audit.

### V02 — quality targets and release records

- [ ] Measure acknowledgement/progress within 1 second, local-search p95 on the specified 10,000-message fixture/hardware, bounded scan behavior, main-process materialization responsiveness, and stop-next-item cancellation within 1 second.
- [ ] Validate bulk/recipient/attachment/message limits at boundaries and aggregate local diagnostics for accepted/partial/unknown/reconciled/cancelled/unsupported outcomes, including diagnostics access through the existing explicit support workflow.
- [ ] Complete AC-01–AC-13 and AC-16–AC-22 before Stage B; add AC-14/AC-15 plus filter/pagination/bulk-limit/cancellation evidence before Stage C.
- [ ] Correct the earlier TODO's blanket “Fixed” statuses using this report and verified regression evidence. Keep missing implementation separate from unperformed operator/provider checks.
- [ ] If packaged-delivery evidence is required, run it in operator/CI infrastructure. Do not run `yarn package`, `yarn make` or equivalent Forge packaging on this developer machine.

Recommended repair order: exact authorization/admission (T01–T03), recovery/provenance/coordination and sync identity (T04–T07/T17), background execution and search (T08/T09), content/size/outcome accuracy (T10–T12), then complete the UI/localization/Sent-copy journeys (T13–T16) and release validation. Add each regression test alongside its repair rather than waiting for a final broad test pass.
