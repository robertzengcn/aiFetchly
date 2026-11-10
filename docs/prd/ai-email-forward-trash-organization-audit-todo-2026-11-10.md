# Email forwarding, Trash and organization — fifth audit TODO

- Audit date: 2026-11-10 (Asia/Shanghai).
- Reviewed implementation: `/Users/cengjianze/project/aiFetchly-email-org`, branch `feature/email-forward-trash-organization`, commit **`8471f39c8`**.
- Requirements: [PRD](./ai-email-forward-trash-organization-prd.md), [technical design](./ai-email-forward-trash-organization-technical-design.md).
- Previous report: [fourth audit TODO](./ai-email-forward-trash-organization-audit-todo-2026-11-06-r4.md). That file’s “Remediation status” table was updated by later commits on this branch. This report re-reads the code at `8471f39c8` and does not treat those “Fixed” rows as evidence.

## Remediation status

**Remediated on this branch (commits `75070452b`, `062ded391`, `6aa651c0b`), re-read at the production callers — not at the helpers' unit tests.** Every fix landed at the call site the audit flagged; each carries regression tests that construct the production objects (`new EmailMailboxActionService()` without an injected capability service, the real sender factory against a loopback SMTP server, `EmailOrganizationSearchService.search` with cursors).

| Item | Status | Evidence on the production path |
| --- | --- | --- |
| R5-01 dispatch fence exits | **Fixed** | Every fence win pairs with a terminal draft transition: all-rejected → editable `failed` (model + service + draft-service edit gate), accepted/partial/unknown → `submitted` (CAS loss forced out of `dispatching` + audit); the attempt is marked dispatched only after the fence wins and immediately before the socket write. Tests: `EmailForwardFlow.service.test.ts` (failed release + re-edit, submitted-after-throw, no dispatch evidence on a pre-fence refusal). |
| R5-02 Sent-copy capture | **Fixed** | Stream plugin installs on BOTH TLS transporters via `createTransporter`, resets per send; the production factory returns `session.capturedRawMessage()` (loopback SMTP test proves the socket received exactly the returned bytes); append targets `revision.sendingAccountId`; missing bytes → `unknown`; `sentCopyStatus` persists on the item row, projects through `projectOperation` into the card DTO and the tool envelope; per-account strategy hook (`resolveSentCopyStrategy`, default append, provider-managed entries only with evidence); `reconcileForwardOperation` resolves unknowns from a Sent-folder Message-ID search, never SMTP. |
| R5-03 restore lineage | **Fixed** | Single restore requires uid + UIDVALIDITY + `lastOperationId === prior.operationId` (missing evidence fails closed); `findSucceededTrashDestinations` now returns the Trash-side folder and both prepare and bulk execution re-bind the CURRENT occurrence to it; a move without a verified uid map is `outcome_unknown` with a stale location, never `succeeded`. Tests: missing-locator refusal, two-cycle stale-Undo refusal, no-uid-map unknown. |
| R5-04 failure-after-side-effect | **Fixed** | Reply invalidation failure persists a durable `EmailReplyInvalidationObligation`, the item ends `outcome_unknown/REPLY_INVALIDATION_PENDING` (never a clean success), and reply admission refuses (`reply_invalidation_pending`) until the obligation resolves; a `messageMove` issued without proof is `OUTCOME_UNKNOWN`; reconcile treats "still present after dispatched" as unknown via the new durable `dispatchedAt` column and only fails proven non-dispatch; the orphan sweeper requires a stale heartbeat (`orphanSettleThresholdMs`, refreshed by `recomputeAggregate`) AND no live claims — just-queued bulk work is never cancelled. Tests cover all four paths. |
| R5-05 writable-Trash policy | **Fixed** | The action service ALWAYS constructs the capability service (sharing the injected adapter, so tests exercise the real wiring); the second Trash resolver is deleted; restore destinations must exist and be writable at execution (`resolveUnwritableRestoreDestinations` on single and bulk). Tests run through the production constructor with a read-only Trash, two Trash folders, and the happy path. |
| R5-06 CID identity | **Fixed** | The source parses with mailparser `skipImageLinks: true`, so relinking resolves each `src="cid:…"` to its own parsed part — no byte-equality, no occurrence modulo. Tests: reversed document order, repeated references, each-part-alone/both/neither. |
| R5-07 direct send | **Implemented** (PRD AC-01 honored; the recorded deviation is closed) | A trusted current-turn `send_now` skips the card ONLY when the host validates the payload as unambiguous (`isUnambiguousDirectSendPayload` — one exact draft revision / message / operation; bulk selections refuse); quoted/pasted content is stripped before intent matching (`prepareTrustedIntentText`); send/review/draft/negation/question phrases cover en/zh/es/fr/de/ja. Review/draft/negation keep blocking; ambiguous payloads degrade to the review path. |
| R5-08 user journeys | **Implemented + E2E-proven** | Open drafts resolve durably via `EMAIL_FORWARD_DRAFT_FOR_MESSAGE` (page-local Map removed; sent/discarded frees the message); `EmailOrganizationOperationHistory` renders persisted operations with a durable Undo entry (survives navigation/restart); `EmailOrganizationBulkDialog` implements search → frozen preview (count/destination/expiry) → execute with live progress and durable cancel. Component tests cover resume/remount, send→new-forward, history restore, and the bulk journey. `test/e2e/specs/emailOrganizationJourneys.test.ts` drives the PRODUCTION renderer over a real loopback IMAP server (native UID MOVE + RFC 4315 COPYUID): Trash → Undo AFTER navigation, keyboard-only Trash, and the bulk search → frozen preview → execute journey — 3/3 passing. |
| R5-09 search cursors | **Fixed** | Local cursors feed the model's `keysetBefore` and are bound to account+query (foreign cursors rejected); server cursors advance by the UIDs actually consumed (date-filtered included) and resume mid-folder; negative/out-of-range/foreign fields rejected; an exact attachment filter on server source is refused instead of silently broadened; attachment presence reports unknown. Tests: three-page keyset, cross-folder page, filtered-consumption, hostile cursors. |
| R5-10 startup gate | **Narrowed to the shipping design (audit's second option)** | `ensureLocationBackfill` flips a process-wide readiness gate ONLY on success; the six mutating IPC channels and AI tools fail closed with `ORGANIZATION_BACKFILL_PENDING` until it opens (checked before the AI entitlement gate). Tests: gate closed on failure path, tool refusal, opens on success. |

**Closed on 2026-11-11 (commit `8a9078deb`):**
- **PRD timing measurements** — `EmailOrganizationPerformance.test.ts` measures the deterministic local targets on the production stack: single Trash acknowledgement < 1 s (§5), local search pagination p95 < 500 ms over a 1200-message mailbox (§7), and durable cancel-before-next-item through the real prompt-start bulk loop (FR-20) — all passing.
- **Fault injection** — a crash AFTER the location commit but BEFORE item finalization repairs idempotently (never loops on LOCAL_COMMIT_PENDING, never re-moves); an attempt-evidence write failure never breaks the honest move outcome.
- **Playwright journeys** — `emailOrganizationJourneys.test.ts` (3/3 passing) covers Trash → Undo after navigation, keyboard-only Trash, and the bulk search → frozen preview → execute journey over a real loopback IMAP server speaking native UID MOVE (RFC 4315 COPYUID parsed by imapflow) and BODY[] source fetches.

**Still open (operator/CI, unchanged):** live test-mailbox validation, Forge packaged proof in CI (`yarn package` stays off developer machines per AGENTS.md), and IMAP wire-fixture hardening beyond the loopback server (no IDLE/APPEND/concurrent-session scenarios).

## Verdict

**The PRD is not fully implemented. Stage B and Stage C both still have blockers.** The branch contains a real feature (drafts, MIME materialization, mailbox moves, operation records, review UI, six-language keys). Several earlier defects were repaired on the path that runs. A repeated failure remains: a later commit added a helper, a stored field, or a comment, and the production caller never uses it. The fourth audit’s status table marks several of those helpers “Fixed”.

This was a source audit. Application code was not changed. The feature unit suite was not re-run; the defects below are visible from the call graph (a helper with no caller, or a caller that ignores the field the helper computed). Existing tests can still pass when they inject a buffer, call the helper directly, or never construct the production object. No live mailbox, Playwright journey, crash injection, performance run, or Forge package was executed.

## The repeated error

A repair lands beside the path that ships, and the path that ships keeps the old behavior.

| What was added | What production actually does |
| --- | --- |
| `releaseDispatching()` | No caller. A rejected or thrown send leaves the draft in `dispatching`. |
| `OutboundSmtpSession.capturedRawMessage()` | No caller. The sender factory returns nodemailer’s `info.message`, which the SMTP transport does not set. |
| `sentCopyStatus` inside attempt JSON | No DTO, tool, or Vue reader. Missing bytes are stored as `not_requested`. |
| `searchForOrganization({ keysetBefore })` | `searchLocal` never reads `input.cursor` and never passes `keysetBefore`. |
| Server cursor comment “resume exactly where this page stopped” | The next cursor keeps the **starting** folder index and adds `rows.length`. |
| `findSucceededTrashDestinations()` returns uid, UIDVALIDITY, resulting version, origin operation | Bulk prepare keeps only `.folder`. |
| Single-restore comment “fail closed without a full mapping” | `afterUid === null` and `afterUidValidity === null` still count as a match. |
| `invalidateRepliesForMove()` records `reply_invalidation_failed` | The move is still finalized `succeeded`. The ordinary move path does not even call the helper; it logs and continues. |
| Orphan-settle comment “older than the settle threshold” | No age check. Every pending item on every nonterminal operation is cancelled. |
| Comment “capability service revalidates” on trash | `new EmailMailboxActionService()` leaves `capabilityService` null, so execution uses the fallback that does not check `writable`. |
| Fourth-audit rows R4-01, R4-03, R4-06, R4-08, R4-09, R4-11, R4-13, R4-15, R4-17 marked Fixed | The production gaps above are still in `8471f39c8`. |

Fix the caller and the helper together. A unit test of the helper alone is not a fix.

## What is in place

These paths do what the requirement says, on the code that runs:

- Append-only forward revisions, hash binding, and a `ready → dispatching` compare-and-set that blocks edit/discard while that status is set.
- Reply-To is copied onto the submitted MIME. Body `textEncoding` is forced to `base64`.
- The reply sender acquires the shared account lock before its final admission and SMTP call.
- Native `MOVE` is refused when the server does not advertise `MOVE`. There is no COPY+EXPUNGE fallback on that path.
- A duplicate trash call returns an open operation instead of creating a second one whose claim refusal would overwrite an unknown item.
- Sync suppression of a moved-away occurrence uses the recorded source folder, UID, and UIDVALIDITY, and the store runs under the account lock. A sync location write refuses to roll an operation-authored tuple back to the old folder.
- Scheduled-loop policy lists `send_email_forward`, `move_email_to_trash`, `restore_email`, `create_email_forward_draft`, and `prepare_email_selection`.
- The review dialog sends the active UI locale. The operation card can render per-address recipient rows and localized `error_code.*` keys when the card is mounted.
- Capability discovery (the capability service, not the action-service fallback) keeps a Trash folder only when exactly one writable `\Trash` exists.

## Requirement scorecard

“Partial” means at least one acceptance behavior is still missing. “Validation open” means the code path exists and this audit did not re-run it.

| FR | Assessment | Still open |
| --- | --- | --- |
| 01 tools/discovery | Partial | Direct-send gate never allows the call (R5-07). Real chat journey not exercised. |
| 02 exact source/account | Partial | Restore and bulk restore do not bind the current occurrence (R5-03). |
| 03 capabilities/folders | Partial | Execution resolves Trash without the capability service (R5-05). |
| 04 create/edit/review | Partial | Draft stuck in `dispatching` after failure (R5-01). Resume is in-memory (R5-08). |
| 05 original content | Partial | Identical-byte inline parts still follow HTML occurrence order (R5-06). |
| 06 approved attachment bytes | Partial | Same CID mapping. Composed-size forcing to base64 was not re-measured here. |
| 07 direct/review/draft intent | Partial | `send_now` still shows the permission card. Non-English send phrases are mostly absent (R5-07). |
| 08 server Trash/convergence | Partial | Read-only Trash can be selected on the action path. Post-dispatch empty `messageMove` is stored as failed (R5-04). |
| 09 recorded restore | Partial | Null mapping is a wildcard; bulk restore can move a message that is no longer the Trash result (R5-03). |
| 10 processing/history | Partial | Reply invalidation failure still ends as a successful move (R5-04). |
| 11 durable operations/restart | Partial | Sweeper cancels live queued work. Forward uncertainty is never reconciled (R5-02, R5-04). |
| 12 exact authorization | Partial | Direct path is not payload-bound. Queued bulk is rechecked, then the sweeper can cancel it (R5-04, R5-07). |
| 13 uncertainty/partial results | Partial | Sent-copy status is not visible. Empty post-dispatch move becomes `failed` (R5-02, R5-04). |
| 14 chat/mailbox controls | Partial | No history, search, bulk preview, or progress UI. Undo id dies with the page (R5-08). |
| 15 six languages | Partial | Card keys exist. Detail-page errors and intent phrases do not (R5-07, R5-08). |
| 16 unattended blocking | Implemented on the advertised tool list; validation open | Full scheduled journey was not re-run. |
| 17 scoped search | Partial | Local cursor ignored. Server cursor, exact filter, and attachment presence still wrong (R5-09). |
| 18 frozen targets | Partial | Frozen version is checked. Bulk restore destination is not the current Trash lineage (R5-03). |
| 19 bounded bulk/progress | Partial | Backend loop exists. No renderer progress. Sweeper can cancel the loop before it claims (R5-04, R5-08). |
| 20 cancel unstarted work | Partial | Cancel of pending items exists. The periodic sweeper also cancels work that is only waiting for the account lock (R5-04). |

## Recheck of the fourth audit’s “Fixed” rows

| R4 row | At `8471f39c8` |
| --- | --- |
| R4-01 dispatch fence | CAS exists. Failure and all-rejected exits never leave `dispatching`. See R5-01. |
| R4-02 reply admission | Lock wraps the reply’s final gate and SMTP. Invalidation on the move path still fails open. See R5-04. |
| R4-03 restore provenance | Null uid / UIDVALIDITY still pass. Bulk prepare ignores the returned locator. See R5-03. |
| R4-04 duplicate outcomes | Open-operation short-circuit is real for trash. Post-dispatch “not an object” is still a definitive failure. See R5-04. |
| R4-05 identity heuristic | Exact before-locator lookup replaced the Message-ID heuristic, and the store is under the account lock. Not re-opened. |
| R4-06 CID order | Occurrence modulo is still the mapper. See R5-06. |
| R4-07 composed size | `textEncoding: "base64"` is set on the MIME options. Not re-measured against a serialized message. Leave as validation, not a confirmed overflow. |
| R4-08 Sent bytes | Capture buffer is never returned. See R5-02. |
| R4-09 search | Local keyset is unused. Server cursor math is still wrong. See R5-09. |
| R4-10 queued expiry | Awaited and detached bulk call `readValidSelection` after the account lock. Not re-opened. The sweeper is a separate cancel bug (R5-04). |
| R4-11 orphan pending | Sweeper and detached `catch` call `cancelPending`. The sweeper has no age or liveness check. See R5-04. |
| R4-12 direct-send | Still hard-blocked. PRD AC-01 was not edited. See R5-07. |
| R4-13 draft lifecycle | Dialog can load `existingDraftId`. The id lives in a page-local `Map` and is not cleared on send. See R5-08. |
| R4-14 history/bulk UI | APIs exist. No Vue caller for search, prepare, bulk start, or operation list. See R5-08. |
| R4-15 destination capability | Discovery filters writable Trash. Action execution does not, because the capability service is not constructed. See R5-05. |
| R4-16 localization | Dialog locale and card recipient/error keys exist. Detail-page action text still prints raw codes. Sent-copy has no string because it has no projection. |
| R4-17 sender identity | Reply-To is on the MIME. Sent append still uses the source message’s account. See R5-02. |

## Detailed TODO

P1 is external-action correctness, content, identity, or recovery. P2 is a required product path that a user cannot complete. Each item lists the variants that share one boundary. Repair that boundary once.

### R5-01 — P1: the dispatch fence is not cleared on every exit

Evidence: `src/service/emailOrganization/EmailForwardDeliveryService.ts` (`markAttemptDispatched` then `markDispatching`, then `sendMail`); `src/model/EmailForwardDraft.model.ts` `releaseDispatching`; `src/modules/EmailForwardDraftModule.ts` `releaseDispatching`.

`markDispatching` is a real `ready → dispatching` update. `releaseDispatching` has no caller. After the fence wins:

- All recipients rejected (`outcome === "failed"`) does not call `markSubmitted` and does not release. Status stays `dispatching`.
- A throw from SMTP marks the item `outcome_unknown` and does not change the draft.
- `markSubmitted`’s boolean is ignored when it does run.

Edit and discard only allow `draft` or `ready`. A second send only accepts `ready`. The user cannot revise, discard, or send that draft again. A definitive SMTP rejection is stuck the same way as an uncertain send.

The attempt is marked `dispatched` **before** the fence. If the fence loses, `failNoDispatch` records `failed` and says the old content was not sent, while the attempt phase is already `dispatched`.

- [ ] Pair every fence win with a terminal draft transition: `submitted` when SMTP may have happened (accepted, partial, unknown), `ready` only when it is proven that SMTP did not start, and a distinct failed-and-released state when every recipient was rejected.
- [ ] Mark the attempt dispatched only after the fence wins, and only immediately before the socket write.
- [ ] Treat a failed `markSubmitted` as a durable error on an already-sent message. Do not leave `dispatching` in place.
- [ ] Test all-rejected SMTP, a throw after the fence, a lost fence, and a failed submitted-state write. The draft must be editable or explicitly submitted, never stranded.

### R5-02 — P1: Sent-copy bytes are captured and then discarded; the warning cannot be shown

Evidence: `src/modules/lib/smtpTransport.ts` stream plugin and `capturedRawMessage`; `src/service/emailOrganization/EmailForwardDeliveryService.ts` `createOutboundSenderFactory` and the `sentCopyStatus` block. A repository search shows `sentCopyStatus` and `capturedRawMessage` have no other readers.

The stream plugin copies the compiled MIME onto the session. The factory returns `(info as { message?: Buffer }).message`. Nodemailer’s SMTP result does not populate that field, so production `info.raw` is missing and the append branch returns `not_requested`. That is the same outcome as “the user did not ask for a copy”, so AC-22’s separate warning cannot appear.

Related variants of the same unwired capture:

- TLS retry builds a new transporter with `createOutboundSmtpTransporter` and does not install the stream plugin. Even a future call to `capturedRawMessage()` would miss the successful attempt.
- The plugin’s `error` handler calls `callback()` and continues the send with no bytes and no error.
- Append uses `readByMessageId(draft.messageId).emailServiceId` (the source message’s account), not `revision.sendingAccountId`.
- There is no per-account “this provider already stores Sent mail” strategy. Design §9.4 says not to append blindly. The adapter appends whenever a `\Sent` folder exists and bytes were supplied.
- `reconcileOperation` refuses `kind === "forward"`. Design §9.4 / §10.3 (search Sent, never resend, never treat a missing copy as proof of non-delivery) has no implementation. An unknown SMTP result stays unknown until a person edits the database.

- [ ] Return the bytes the successful SMTP attempt actually submitted, including the TLS-retry transporter.
- [ ] Persist `sentCopyStatus` on the operation projection the card and tool already render. Missing bytes are `failed` or `unknown`, not `not_requested`.
- [ ] Resolve the Sent folder from the sending account. Skip append only when that account’s tested strategy says the provider saved the message.
- [ ] Add a forward reconciliation path that repairs metadata from durable SMTP/Sent evidence and never calls SMTP again.
- [ ] Test the production factory against a loopback SMTP server: accepted recipients, append failure, alternate sending account, TLS-retry success. The UI must show the submission and the copy warning separately.

### R5-03 — P1: restore still accepts a historical Trash row that is not the current occurrence

Evidence: `EmailMailboxActionService.restoreFromOperationInternal` lineage check (`afterUid === null || …`, `afterUidValidity === null || …`); `EmailOrganizationOperation.model.ts` `findSucceededTrashDestinations`; `EmailOrganizationSelectionService.prepareSelection` uses `recorded[id].folder` only; `bulkOne` checks the frozen version and then moves whatever folder the message is in now.

Single restore compares the current folder with the prior item’s destination folder. If the attempt JSON has no uid or UIDVALIDITY, those comparisons pass. Evidence writes in `persistMoveOutcome` are `.catch`’d, so a missing mapping is a normal path, not a rare crash. `lastOperationId` is not part of the check. A later message that still sits in that Trash folder path can be moved by the old Undo.

Bulk restore is wider. `findSucceededTrashDestinations` computes destination uid, UIDVALIDITY, `resultingVersion`, and `originOperationId`, then `prepareSelection` throws those away and stores the historical **before** folder. It freezes the message’s **current** version. Execution moves the current folder to that historical folder whenever the version still matches. Trash → restore → a later archive move → prepare bulk restore therefore moves the archived message, not a Trash result.

A move that returns no uid map is still stored as `succeeded` with location state `stale` (`destinationUid !== null ? "verified" : "stale"`). The null-uid restore check then treats that success as lineage.

- [ ] Require uid, UIDVALIDITY, and `lastOperationId` on both single and bulk restore. A missing field fails closed.
- [ ] Bind prepare and execution to the current locator: the message must still be the recorded result of that Trash operation. Do not move it just because an older successful Trash row exists.
- [ ] If the server move succeeded but the uid map is missing, leave the item `outcome_unknown` or `needs_reconciliation`, not `succeeded`.
- [ ] Test missing evidence, UIDVALIDITY reset, Trash → restore → archive → bulk restore, and two Trash/restore cycles with distinct action ids.

### R5-04 — P1: after a side effect, failure is logged and the item is still marked successful or definitively failed

These are one class: the code records that something is uncertain or failed, then chooses a terminal status that hides it.

1. **Reply invalidation.** `persistMoveOutcome` catches `invalidateUnsentDraftsForMessage` and then `finalizeItem(..., "succeeded")`. `invalidateRepliesForMove` writes a `reply_invalidation_failed` audit and returns. Both reconcile success branches call it and then record `reconciled_move` / `succeeded`. After the account lock is released, the pending reply can still send. Design §10.4.
2. **Post-dispatch move with no object result.** `ImapEmailMailboxAdapter.moveMessage` has already called `messageMove`. A falsy or non-object result returns `failed` / `PROVIDER_REJECTED`. Design §10.3: after dispatch, lack of proof stays unknown. A retry can move the message again.
3. **Reconcile treats “still in the source folder” as proof the command never ran.** `reconcileOperationInternal` finalizes `failed` / `NETWORK_BEFORE_DISPATCH` whenever presence is `present`, including when the attempt phase is `dispatched`. The command may still be completing.
4. **Orphan sweeper cancels live queued work.** `settleOrphanedPendingOperations` loads every nonterminal operation and `cancelPending`s every pending item. The comment says “older than the settle threshold”; there is no timestamp check. `startTrashSelection` / `startRestoreSelection` insert those pending rows **before** `runWithAccountLock`. The 5-minute timer in `src/background.ts` can take the lock first and cancel a bulk operation that is only waiting to start. Startup cancellation of crashed pending work is the right policy; applying it to a just-created operation is not.

- [ ] If reply invalidation fails, do not report the move as a clean success. Persist a retryable invalidation obligation and refuse a later reply send until it lands.
- [ ] Any `messageMove` that was issued and did not return a verified uid map stays `outcome_unknown`.
- [ ] Reconciliation may mark `failed` only with proof the command did not reach the server. Source still present after `dispatched` stays unknown until a later observation.
- [ ] Settle only operations with no live executor and no queued account-lock callback, or only rows older than a real threshold. Do not cancel an operation created in the same process that has not claimed yet.
- [ ] Test invalidation throw after a successful MOVE, empty `messageMove` result, reconcile while the source is still present, and start-bulk racing the 5-minute sweeper. The sweeper must not be the thing that stops a job the user just started.

### R5-05 — P1: Trash execution does not use the writable-folder policy

Evidence: `EmailMailboxActionService` constructor sets `capabilityService` to null unless a test passes one. Every production site uses `new EmailMailboxActionService()` (`emailOrganization-ipc.ts`, `EmailOrganizationAiTools.ts`, `background.ts`). `resolveTrashFolder` then uses the fallback: one `\Trash` folder, no `writable` check. The comment above the call says the capability service revalidates.

`EmailOrganizationCapabilityService` does filter `specialUse === "\\Trash" && folder.writable`. The UI folder picker uses that service. Single-message Trash, AI Trash, and the no-capability-service fallback do not. A read-only Trash folder is offered as the destination on the path that moves mail. `canRestore` is true for any IMAP account with `MOVE`, with no writable destination.

- [ ] Construct the action service with the capability service on every IPC, tool, and startup path.
- [ ] Delete the second Trash resolver, or make it call the same writable-and-unambiguous rule.
- [ ] Disable Trash/restore in the UI and the tool when that policy fails, including POP3 and a read-only Trash.
- [ ] Test one read-only `\Trash`, two Trash folders, and POP3 through the production constructor, not a test that injects `capabilityService`.

### R5-06 — P1: identical-byte inline images are still assigned by occurrence order

Evidence: `EmailForwardMaterializer.relinkCidImages`. Candidates are grouped by SHA-256 in attachment order. The Nth data-URI of that hash uses `candidates[consumed % candidates.length]`.

Equal bytes cannot be told apart by hashing the data URI. The modulo wrap makes it worse when one part is referenced more times than the attachment list. With parts `[logo1 selected, logo2 not selected]` and the same bytes:

- Reversed HTML order keeps the first image (logo2’s place in the document) and drops the second.
- A repeated reference to logo1 is assigned to logo2 on the second occurrence and removed when logo2 is not selected.

The comment in that function says identical bytes make the swap acceptable. The PRD requires the selected part to stay attached to its own reference, and the excluded part to be visible as excluded before send. Selection is per part, not per hash.

- [ ] Preserve the CID-to-part link from the parsed MIME part. Do not rebuild it from byte equality or from HTML order.
- [ ] Test reversed order, a repeated CID, each part selected alone, both, and neither. The surviving `cid:` values and the attached parts must name the same parts the user selected.

### R5-07 — P2: direct send is still a second confirmation, and ordinary non-English instructions do not count

Evidence: `AIChatQueryLoop.ts` sets `organizationSendGateAllowed = false` even when `resolveEmailOrganizationIntent` returns `send_now`. `EmailOrganizationIntentResolver.ts` send phrases are English. Topic markers include a few Chinese, German, French, Spanish, and Japanese words; the phrases that actually return `send_now` do not.

PRD §5.1 and AC-01 still require one submission and no redundant review gate for an unambiguous “forward this to finance@example.com now” and for “delete this email” on one selected message. The fourth audit recorded a product deviation. The PRD text was not changed, so the requirement is still unmet. “Send it now” is classified `send_now` and then blocked by the gate anyway.

A review, draft, or negation must keep blocking. The safe design is a host-owned authorization bound to the frozen draft or message, not a boolean the model can set.

- [ ] For a trusted current-turn `send_now` whose resolved message, account, recipients, and attachments are unambiguous, authorize that frozen payload once and do not show a second card.
- [ ] Cover the same instructions in en, zh, es, fr, de, and ja, including negation, “show me first”, and “can this be forwarded?”.
- [ ] If the product decision is “always show the card”, change PRD §5.1 and AC-01 in the same change. Do not mark AC-01 done while the PRD still forbids the card.

### R5-08 — P2: the user still cannot finish the history, bulk, or durable-draft journeys

Evidence: `src/views/pages/emailreceive/detail.vue` `savedDraftIds` is a component `ref(new Map())`. `onForwardSent` closes the dialog and does not delete the map entry. `src/views/api/emailorganization.ts` exports `searchEmailsOrganization`, `prepareEmailSelection`, and `startTrashSelection`. Those names appear nowhere else under `src/views`.

What the user can do: open a message, forward it in a dialog, trash it, and undo while that page is still mounted. The operation card can show recipient rows for an operation id the page already has.

What the user cannot do, and the PRD requires:

- Reopen a saved draft after leaving the page or restarting the app.
- Start a new forward after sending, because the old draft id is still in the map.
- Browse operation history or Trash and restore from there.
- Search, freeze a selection, preview the exact messages, watch per-item progress, and cancel.
- See a Sent-copy warning (R5-02). The detail page’s failure line still interpolates `result.errorCode` and `result.code` as raw strings.

- [ ] Load the open draft from the database for that message. Clear it on sent, discarded, and expired.
- [ ] Add history and Trash views that call the existing operation-list and restore APIs, and keep the Undo id across navigation.
- [ ] Add the search → frozen preview → execute/cancel flow, with count, folders, expiry, and per-item status visible.
- [ ] Component tests for save → remount → resume, save → send → new forward, and a bulk preview. Playwright for the same journeys. A passing card test is not this flow.

### R5-09 — P2: search pages repeat, skip, or report the wrong completeness

Evidence: `EmailOrganizationSearchService.searchLocal` builds a cursor and never reads `input.cursor`. The model’s `keysetBefore` is unused by that service. `searchServer` decodes `{folderIndex, uidOffset}` with only a `typeof === "number"` check.

Server defects that share one cursor/filter bug:

- The next cursor stores `cursorState.folderIndex` (the folder where the page **started**) and `uidOffset + rows.length`. A page that takes the last message of INBOX and the first of Archive is continued as “skip two UIDs in INBOX”, so Archive’s first message is returned again.
- `metadataLimit` is the number of free slots in the page, and the date filter runs after that fetch. Rejected candidates are not replaced from later UIDs in the folder. The scan can finish `complete: true` with matches left behind.
- `uidOffset: -3` is accepted. `Array.prototype.slice` treats a negative start as “from the end”. `folderIndex: 999` runs the loop zero times and can return an empty complete result.
- The cursor is not bound to account, folders, or the normalized query. A different search can replay an old cursor.
- With no attachment filter, every server row sets `hasAttachments: false`. With a filter, rows are still returned, presence is `null`, and `complete` is false. Unknown is not false, and an unsupported exact filter must not be a silent broader hit list (PRD §7).

- [ ] Pass the local cursor into `keysetBefore` and reject a cursor that does not match this account and query.
- [ ] Advance the server cursor by the folder and UID actually consumed, including UIDs dropped by the exact filter. Scan further in the folder until the page fills or the budget stops, and then leave `complete: false` with a resumable cursor.
- [ ] Reject non-integer, negative, and out-of-range cursor fields.
- [ ] Report attachment presence as unknown unless it was evaluated. If the user asked for an exact true/false filter the server cannot apply, refuse that filter or post-filter for real. Do not return the unfiltered page as the answer.
- [ ] Test three local pages, a page that crosses two folders, a date filter that rejects the first candidates, a negative cursor, and attachment true/false/unknown.

### R5-10 — P2: startup is not the migration in design §5.3

Evidence: `src/background.ts` fire-and-forget `ensureLocationBackfill`. There is no organization feature flag, no schema-version marker, and no quiesce of receive sync before backfill. Design §5.3 requires a backup, synchronization disabled for the upgrade transaction, integrity checks, and organization staying disabled until that succeeds.

The backfill of `legacy_unverified` rows is useful and those rows stay ineligible for mutation. It is not the release migration. A failed backfill is logged and the rest of the app continues.

- [ ] Implement the versioned upgrade as specified, or narrow the design to the backfill that actually ships and keep remote actions disabled until it succeeds.
- [ ] Do not enable organization moves on a database whose location backfill failed.

## Acceptance scenarios still open

| AC | Why it is still open |
| --- | --- |
| 01 direct forward | Gate never skips the card (R5-07). |
| 02 draft/review only | Dialog exists. No chat review card, and a saved draft is not durable (R5-08). |
| 03 two Alices | Not re-tested end to end. Resolver does not itself pick an address; the chat journey is still open. |
| 04 PDF and inline image | Identical-byte CID mapping (R5-06). |
| 05 oversized or missing attachment | Block-before-send exists. Composed-size bound was not re-measured after `textEncoding: "base64"`. |
| 06 same UID in two folders | Move uses the verified locator. Restore/bulk lineage does not (R5-03). |
| 07 UIDVALIDITY reset | Move checks it. Restore skips the check when evidence is null (R5-03). |
| 08 Trash then Undo | Happy path exists. Lineage and a durable Restore entry do not (R5-03, R5-08). |
| 09 POP3 / no safe move | Discovery can explain it. Execution Trash resolver does not share that policy (R5-05). |
| 10 disconnect after submit | Unknown is stored for a thrown SMTP or move. Empty `messageMove` becomes failed. Forward reconcile does nothing (R5-02, R5-04). |
| 11 double submit | Open trash operation is reused. Draft fence can stick, and a lost fence leaves a dispatched attempt (R5-01). |
| 12 change after approval | Revision CAS exists. A stranded `dispatching` draft cannot be edited to prove the new revision is required (R5-01). |
| 13 hostile body text | Gate blocks `send_now` as well as hostile text. The payload-bound allow path is still missing (R5-07). |
| 14 bulk set changed after preview | Frozen version is checked. Restore selection is not bound to current Trash lineage (R5-03). No preview UI (R5-08). |
| 15 cancel at item 40 | Pending cancel exists. Sweeper can cancel the operation before item 1 (R5-04). No progress UI (R5-08). |
| 16 removed restore folder | Card picker filters writable non-Trash. Page Undo and the action-service Trash policy do not share it (R5-05, R5-08). |
| 17 remote success, local failure | Idempotent location repair exists. Reply invalidation failure is still a success (R5-04). |
| 18 partial recipients | Card can show addresses. A retry of only the rejected set, with a new authorization, was not found as a user flow. |
| 19 AI disabled / scheduled full access | Tool block list is present. This audit did not re-run the scheduled journey. |
| 20 six languages and keyboard | Card keys exist. Intent phrases and several detail-page errors do not (R5-07, R5-08). Keyboard journeys were not run. |
| 21 legacy unverified row | Mutation rejects `state !== "verified"`. The §5.3 upgrade around that backfill is not what startup does (R5-10). |
| 22 SMTP success, Sent copy fails | Production never supplies the bytes, and nothing renders the status (R5-02). |

## Verification still required before either release

- [ ] Add regression tests that construct the production sender factory, `new EmailMailboxActionService()` with no injected capability service, and `EmailOrganizationSearchService.search` with a cursor. Do not only test the unused helper.
- [ ] Stage B needs AC-01–AC-13 and AC-16–AC-22 on deterministic local servers. Stage C also needs AC-14, AC-15, pagination, and the 100-message cancel test.
- [ ] Fault-inject crashes around the dispatch fence, `messageMove` return, evidence write, location commit, and reply invalidation.
- [ ] Playwright: direct forward, review-only forward, draft save across remount, Trash/Undo after navigation, bulk preview/progress/cancel, keyboard-only restore.
- [ ] Measure the PRD timing targets (acknowledgement, local search p95, cancel-before-next-item). None were measured here.
- [ ] Keep `yarn package` / `yarn make` off developer machines. Packaged proof stays in CI.

Suggested order: wire the helpers that already exist (R5-01, R5-02, R5-05, R5-09), then close restore lineage and the success-after-failure exits (R5-03, R5-04), then CID identity (R5-06), then the product journeys and the PRD decision on direct send (R5-07, R5-08, R5-10). Re-read the production constructor and the caller, not the helper’s unit test, before marking a row done.
