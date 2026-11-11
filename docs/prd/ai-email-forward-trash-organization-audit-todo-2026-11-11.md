# Email forwarding, Trash and organization — sixth audit TODO

- Audit date: 2026-11-11 (Asia/Shanghai).
- Reviewed implementation: `/Users/cengjianze/project/aiFetchly-email-org`, branch `feature/email-forward-trash-organization`, commit **`9f99b1813`**.
- Requirements: [PRD](./ai-email-forward-trash-organization-prd.md), [technical design](./ai-email-forward-trash-organization-technical-design.md).
- Previous report: [fifth audit TODO](./ai-email-forward-trash-organization-audit-todo-2026-11-10.md). Later commits edited that file’s “Remediation status” table and added a “Closed on 2026-11-11” note. This report re-reads the production callers at `9f99b1813`. Those status rows are not evidence.

## Verdict

**The PRD is not fully implemented. Stage B is still blocked. Stage C search is still blocked.**

The branch now wires several repairs at the callers that ship: the dispatch fence runs before the SMTP attempt marker, a fully rejected forward returns the draft to editable `failed`, Sent-copy append uses the captured MIME and the sending account, single and bulk restore require the current row to sit on the recorded Trash locator, the mailbox action service constructs its capability service, reply invalidation failure marks the move `outcome_unknown`, and the detail page mounts durable operation history. Those paths are real.

Four production holes remain, and they are the same class of mistake as the earlier audits: a check, a stored field, or a comment describes the safe behavior, and the caller that actually runs passes a weaker input or swallows the safety write.

This was a source audit. Application code was not changed. The feature unit suite, the Playwright spec, a live mailbox, crash injection, and the performance tests were not re-run for this report. The “3/3 Playwright” note in the fifth audit file is the implementer’s claim, not a result from this pass.

## The repeated error

A later commit adds the safe helper, then the shipping caller feeds it an empty scope, a shape-only payload, or a swallowed write.

| What the new code appears to do | What the shipping caller does |
| --- | --- |
| `isUnambiguousDirectSendPayload` “binds” a direct send to one exact message | It accepts any positive integer the model put in `message_id`, `draft_id`, or `operation_id`. The user sentence is not compared to that id, to the address, or to the verb. |
| `searchQueryHash` binds a cursor to folder scope | Local search calls it with `folders: null`, so Inbox and Archive cursors hash the same. |
| The adapter reports `capped` when a scan hits its ceiling | `capped` is `uids.length >= windowSize`. A folder with 200 or more hits is reported as an incomplete 1000-candidate stop even after every UID was returned. |
| A failed reply invalidation persists an obligation that blocks the next reply | The insert is `.catch(() => undefined)`. A missing row means the reply gate allows the send. |
| Every fence win ends in a terminal draft state | A throw from the local attempt-row update, before `sendMail`, marks the draft `submitted`. |

## Recheck of the fifth-audit items

| Item | This pass | What is still open |
| --- | --- | --- |
| R5-01 dispatch fence | The fence CAS runs before `markAttemptDispatched`, all-rejected mail returns to editable `failed`, and accepted mail calls `markSubmitted`. | **R6-04.** The `catch` after `fenceHeld` marks the draft `submitted` for a throw that is still before the socket. |
| R5-02 Sent copy | The stream plugin is installed on every transporter the session builds, the factory returns `capturedRawMessage()`, append uses `revision.sendingAccountId`, missing bytes are `unknown`, and forward reconcile searches Sent and does not call SMTP. | **R6-05.** The `outcome_unknown` return omits `sentCopyStatus`, and the detail warning runs only when the result status is `submitted`. |
| R5-03 restore lineage | Single restore requires uid, UIDVALIDITY, and `lastOperationId`. Bulk prepare and `bulkOne` require the current folder, uid, and UIDVALIDITY to match the Trash-side locator. A move with no uid map is `outcome_unknown`. | Not re-opened. |
| R5-04 failure after a side effect | A failed invalidation finalizes the item as `outcome_unknown` / `REPLY_INVALIDATION_PENDING`. Reply admission checks `hasOpenInvalidationObligation` before SMTP. An unparseable `messageMove` result is `OUTCOME_UNKNOWN`. The orphan sweeper requires a stale heartbeat and no live claim. | **R6-03.** The obligation insert can fail and the caller ignores that failure, so the reply gate sees no row. |
| R5-05 writable Trash | `new EmailMailboxActionService()` builds `EmailOrganizationCapabilityService`, and restore checks writable destinations before the move. | Not re-opened. |
| R5-06 CID identity | `relinkCidImages` matches `src="cid:…"` after `skipImageLinks: true`. | Not re-opened. |
| R5-07 direct send | Quoted lines and localized forward separators are stripped. Review, draft, and negation still block. Non-English send phrases exist for the six UI languages. | **R6-01.** The skip is shape-only and shared by forward, Trash, and restore. |
| R5-08 journeys | `EmailOrganizationOperationHistory` is mounted on the message detail page and reloads from the operation list. `EmailOrganizationBulkDialog` is mounted on the receive list. | **R6-05.** Trash from the list shows “Moved to Trash.” and stores no operation id, so that surface has no Undo. |
| R5-09 cursors | Local cursors feed `keysetBefore`. Server cursors reject negative and out-of-range fields. An exact `hasAttachments` filter on a server search is refused. Server rows report `hasAttachments: null`. | **R6-02.** Folder scope is hashed as null, and the server `capped` flag is the window size. |
| R5-10 startup | Mutating AI tools and the organization IPC handlers call the readiness gate and return `ORGANIZATION_BACKFILL_PENDING` until backfill succeeds. | Design §5.3’s backup, sync pause, and schema-version upgrade is still absent. The gate is the shipping substitute. Recorded as **R6-06**, not as a new functional hole in the gate itself. |

## Open work

### R6-01 — P1 — Direct send authorizes whatever single id the model supplies

PRD §5.1 and design §8.1: the current user request is the authorization. A direct forward sends only when the message, account, address, and attachment choice are unambiguous. “Delete this email” moves the selected message. “Undo that” with more than one possible operation asks which one. The service checks trusted sender and recipient scope against the payload before it issues an authorization. Model arguments are not authorization (FR-12, AC-01, AC-03, AC-13).

What runs today:

1. `resolveEmailOrganizationIntent` classifies the whole turn as `send_now` when any send phrase matches. “send it now”, “delete this”, and “undo that” are all in `SEND_PHRASES` (`EmailOrganizationIntentResolver.ts`).
2. One flag, `organizationSendGateAllowed`, is then set for every tool in `ORGANIZATION_EMAIL_MUTATION_TOOLS`: `send_email_forward`, `move_email_to_trash`, and `restore_email` (`AIChatQueryLoop.ts`).
3. `isUnambiguousDirectSendPayload` returns true when the JSON has one positive `message_id`, one `draft_id` plus `revision_id`, or an `operation_id` string of length at least 8. It returns false when `selection_id` is present. It does not read the user sentence, the open message, the account, or the address.
4. `sendEmailForward` then calls `authorizationModule.issue(...)` with `origin: "tool_confirmation"` for the revision ids the model passed, and sends that revision (`EmailOrganizationAiTools.ts`). The hash stored on that authorization is the revision’s own `composedHash`. Nothing compares it to the address in the user sentence.
5. `moveEmailToTrash` moves `input.message_id`. `restore_email` restores `input.operation_id` through the same flag.

Consequences, same boundary on all three tools:

- “Forward this to finance@example.com now” skips the card for a `send_email_forward` of any ready draft, including a draft addressed to someone else, or a draft of a different message.
- “Delete this email” skips the card for a `move_email_to_trash` of any positive message id. The open row is not a constraint.
- “Undo that” skips the card for any `operation_id` of length ≥ 8. The PRD rule that several possible operations must be disambiguated is not applied.
- “send it now” also skips the card if the model calls Trash or restore instead of forward. The verb in the sentence is not part of the check.
- An unquoted paste that contains “send it now” is still the trusted text. `prepareTrustedIntentText` removes `>` lines and a few forward-separator blocks. A paste without those markers still selects `send_now`, and the shape check then accepts the model’s id (AC-13).

`create_email_forward_draft` is outside the mutation set, so creating a draft can still show the generic card. The send that follows does not have to be that draft.

Repair: resolve the payload in the host from the trusted turn and the trusted UI selection (open message id, named addresses, the operation the user just performed). Issue the authorization only when the tool name, ids, account, and recipients are that payload. A `send_now` sentence whose verb is Trash must not skip the card for `send_email_forward`. “Undo that” with more than one succeeded Trash operation for the account stays on the review path.

### R6-02 — P1 — Search cursors still describe a different query than the one that runs

PRD §7 and FR-17: a continuation belongs to the same account, folders, and filters. A bounded server scan says so, and it does not report a finished exact total when it stopped early.

**Local folder scope is hashed as null.** `searchLocal` excludes Trash when `folderPaths` is omitted, and it filters to `input.folderPaths` when the caller passes them. Both the decode and the encoded cursor call `searchQueryHash(input, null)` (`EmailOrganizationSearchService.ts`). `searchQueryHash` puts the `folders` argument into the hash and does not read `input.folderPaths`. A cursor minted for Inbox is accepted for Archive, and a cursor minted before the Trash folder was known is accepted after that exclusion changes. The keyset `(receivedAt, id)` is then applied to the other folder set, which skips or repeats rows. The server path passes the real folder list into the same function. Local search is the caller that drops the scope.

**The server `capped` flag is the page window.** `ImapEmailMailboxAdapter.searchUids` sets `capped = uids.length >= input.cap` and then slices `uids.slice(offset, offset + input.cap)`. The service passes `cap: windowCap` with `SERVER_SCAN_WINDOW = 200`. Any folder that contains at least 200 matching UIDs sets `capped` on every call, including the last short page. The service does `capped = capped || result.capped` and, when `capped` is true, adds the sentence that the scan stopped at the 1000-candidate bound. After the folder is actually exhausted, `foldersExhausted` stays true, `nextCursor` is null, and `complete` is false because `capped` is true. A finished 250-message folder is reported as an incomplete scan the user cannot continue. The 1000-candidate ceiling is a different counter (`candidatesSeen >= SERVER_SCAN_CANDIDATE_CAP`) and is not what `capped` measures.

**A dropped envelope fetch shortens the cursor.** The adapter omits a UID when `fetchOne` returns nothing (`if (!message) continue`). The service advances `uidOffset` by `result.candidates.length`, which is the shortened list, not the slice length. The next page starts one index early, repeats the last returned UID, and never returns the UID whose fetch failed.

**The offset is an index into a new SEARCH.** Each call runs IMAP SEARCH again and slices by index. Mail that arrives between pages shifts the UID list. The cursor is not a UID high-water mark.

**A failed folder cannot be resumed.** On `result.status !== "listed"` the loop `continue`s to the next folder without a resume point. If the remaining folders then finish, `nextCursor` is null while `complete` is false. The failed folder is named in `failedFolders` and is not retried by “next page”.

**`totalMatched` on the server path is `rows.length`.** That is the current page, including a full page that has a continuation. The limitation string says the scan is not an exact total. The numeric field still reads as a total.

Repair: hash `folderPaths` and the excluded Trash folder on the local cursor. Set the adapter `capped` bit only when the returned window was cut before the end of that SEARCH (or when `candidatesSeen` hits 1000). Advance `uidOffset` by the slice length, and keep a UID in the candidate list when its envelope fetch fails so the index stays aligned. Prefer a resume UID over an index if the mailbox can change. Keep `totalMatched` absent or label it as the page count when the scan is incomplete.

### R6-03 — P1 — A failed obligation write leaves reply sending open

Design §10.4: after a move, pending reply approvals for that message are invalid. If invalidation does not land, reply admission refuses until a durable obligation is resolved.

`invalidateRepliesForMove` catches the invalidation error, then:

```ts
await this.replyDraftModule
  .recordInvalidationObligation({ messageId, emailServiceId, destinationFolder })
  .catch(() => undefined);
return false;
```

The move item is finalized `outcome_unknown` / `REPLY_INVALIDATION_PENDING`. That part is honest. The reply gate in `EmailReplyDeliveryService` blocks only when `hasOpenInvalidationObligation` is true. The read path fails closed if the query throws. A successful read of zero rows returns false. The swallowed insert is exactly that case: the same database failure that broke invalidation also breaks the insert, the catch drops it, and the next reply send proceeds with the old approval.

`resolveInvalidationObligations(...).catch(() => undefined)` on the success path is the other direction and stays safe: a failed clear leaves the row open and the reply stays blocked.

Repair: if the obligation row is not durable, do not return from the move path as though the guard exists. Surface the insert failure on the item, and make reply admission fail closed when the obligation table cannot be read or when this move’s invalidation is still `REPLY_INVALIDATION_PENDING` without a row. The same `.catch(() => undefined)` on a safety write should be removed everywhere it protects a later allow/deny decision.

### R6-04 — P1 — A local error before SMTP marks the forward draft submitted

Design §5.4 and AC-10: a failure before execution is retryable and must not claim success. A failure after the bytes may have left the machine stays unknown and is not replayed.

`EmailForwardDeliveryService` sets `fenceHeld = true` after the `ready → dispatching` CAS, then calls `markAttemptDispatched`, then `sender.sendMail`. The `catch` runs for all of those. When `fenceHeld` is set it calls `markSubmitted`, and if that CAS loses it calls `forceTerminalFromDispatching(draft, "submitted")`. The operation becomes `outcome_unknown`.

`markAttemptDispatched` is a local row update. If it throws, SMTP has not started, and the draft is already `submitted`. The user cannot edit or resend that revision. A `sendMail` throw that happens inside nodemailer before the socket (bad options, transporter construction) takes the same path. The comment on the catch says SMTP may have happened. That is true only after `sendMail` has begun the network attempt.

The all-rejected path is in better shape: `markSendFailed` moves the draft to `failed`, and `appendRevision` accepts `draft`, `ready`, and `failed`.

Repair: split the catch. A throw before `sendMail` is invoked releases the fence back to an editable state (`failed` or `ready`) and finalizes the operation `failed` with a pre-dispatch code. A throw after `sendMail` has been entered stays `outcome_unknown` and `submitted`. Record that split in the attempt row so reconciliation can see whether the socket was attempted.

### R6-05 — P2 — The result the user sees drops the warning and the Undo the row already has

AC-22: a failed or unverified Sent copy shows a warning and does not cause a resend. PRD §5.3 step 5: Trash shows “Moved to Trash” with Undo, and Restore stays available from history.

- After SMTP, `sentCopyStatus` is written into the item `resultJson` for every outcome, including `outcome_unknown` when some recipients were accepted and the copy was attempted. The early return is `{ status: "outcome_unknown", operationId, requestCorrelationId }` with no `sentCopyStatus`. `detail.vue` warns only when `result.status === "submitted"`. The chat tool result spreads that return object, so the warning is absent on the path the user is looking at. The catch’s `finalizeItem` also writes no `resultJson`, so a throw after a successful append drops the status from the row as well.
- `list.vue` `trashRow` sets `rowActionMessage` to the translated “Moved to Trash.” string and does not keep `operationId`. There is no Undo control on that row. Undo exists only inside `EmailOrganizationOperationHistory` on the detail page, which loads after the user opens that message. The list error line interpolates `result.errorCode` raw (`Action failed: LOCATION_STALE`). The operation card translates `emailOrganization.error_code.*`. The list is the sibling that still shows the code.
- The Sent-copy toast interpolates the raw token `failed` or `unknown` into every language string (`sent_copy_warning`). The six language files have the sentence; the status word stays English.

Repair: put `sentCopyStatus` on every delivery return the UI and the tool envelope display, including `outcome_unknown`, and show the warning whenever the status is `failed` or `unknown`. On the list, keep the new operation id and offer Undo next to the success text. Translate the list error through the same `error_code` keys the card uses, and translate the Sent-copy status word.

### R6-06 — P2 — Startup still does not run the design §5.3 upgrade

The readiness gate is present: mutating organization IPC handlers call `assertOrganizationReady()`, and the AI tools call `gateOrganizationReadiness()` before entitlement. A failed backfill stays closed with `ORGANIZATION_BACKFILL_PENDING`.

Design §5.3 still asks for a backup, a paused sync, and a schema-versioned upgrade transaction before organization mutations run. The shipping path flips a process-wide flag after a location backfill. There is no backup and no schema-version marker. Treat that as unfinished design work, separate from the gate bug that used to let mutations run during a failed backfill.

## Remediation status

**Remediated on this branch (commit `c249d18ae` + the E2E commit), re-read at the production callers.** Every fix landed at the caller the audit flagged and carries a regression test that exercises the real path.

| Item | Status | Evidence on the production path |
| --- | --- | --- |
| R6-01 shape-only direct send | **Fixed** | The gate now binds the VERB and the PAYLOAD: `resolveDirectSendVerb` classifies which action the sentence names (mixed verbs → review), and `isDirectSendPayloadBound` requires (a) forward — the frozen revision's envelope EQUALS the addresses the sentence names (host loads the revision), (b) Trash — the target message's sender is named in the sentence (host loads the message; a bare "delete this email" stays on review), (c) restore — exactly ONE succeeded Trash operation exists and it is the referenced id (host queries the operation list). The loop's `resolveDirectSendPayloadBinding` resolves all three from durable state; any read failure fails closed. Tests: 26 resolver cases incl. the audit's exact "forward to finance@example.com now vs a draft addressed to someone else" scenario, verb-mismatch refusals in both directions, and the multi-undo refusal. |
| R6-02 cursor/query mismatch | **Fixed** | Local cursors hash the EFFECTIVE folder scope (explicit folders, or ALL-LOCAL + the resolved Trash exclusion) — an Inbox cursor is refused for an Archive query (test). The adapter's `capped` bit means "window cut before the SEARCH end" and the service no longer ORs it into the 1000-candidate ceiling (test: a 250-match folder pages to `complete: true, nextCursor: null` with no phantom 1000-stop); a dropped envelope fetch keeps the UID in the candidate list so offsets stay aligned (test: no repeats, no gaps across pages); a failed folder emits a resumable cursor pointing back at it (test); an incomplete scan labels `rows` as the current page, not a total. |
| R6-03 swallowed obligation insert | **Fixed** | The insert failure is no longer swallowed: the audit row records `obligationDurable: false`, and reply admission falls back to the item's durable `REPLY_INVALIDATION_PENDING` marker via `hasUnresolvedInvalidationPendingItem` (nonterminal operation + outcome_unknown item), failing closed when unreadable. Tests: both the invalidation AND the insert fail → the item marker keeps the gate closed; the marker clears when the repair resolves the item. |
| R6-04 pre-sendMail throw marks submitted | **Fixed** | The delivery catch splits on `sendMailEntered`: a throw before the socket attempt (attempt-row update, transport build) finalizes the item `failed` / `NETWORK_BEFORE_DISPATCH`, releases the draft to the EDITABLE `failed` state, and records a pre-dispatch audit; only a throw after `sendMail` keeps unknown + submitted. Test: the attempt-row update rejects after the fence wins → failed outcome, editable draft (revision append works). |
| R6-05 dropped warning / list Undo | **Fixed** | `sentCopyStatus` rides the `outcome_unknown` return and the catch's durable row (a throw after a successful append no longer drops it); the detail page warns on unknown too; the list Trash keeps the operation id and offers an inline Undo (`org-row-undo`) through the same durable restore path; list error codes localize through the `error_code.*` keys; the Sent-copy status word is translated (`sent_copy_status.*`, six languages). E2E: the new journey trashes from a LIST ROW, leaves the list, and still finds Undo through the detail history — 4/4 Playwright journeys passing. |
| R6-06 §5.3 upgrade | **Decision recorded** | The technical design §5.3 now documents the shipped substitute (readiness gate + additive-only backfill + verify-before-mutate), why the backup/sync-pause/schema-version steps do not apply to a non-destructive additive path, and the condition that re-opens them (any future destructive schema work). |

**Verification run on this branch:** `yarn typecheck` 0 errors; `yarn vue-typecheck` 0 errors; component suite 184 files / 1614 tests; main suite green; utility suite green except the pre-existing live-network `googleScrape` flake; Playwright `emailOrganizationJourneys.test.ts` 4/4 (incl. the new list-row Undo journey).

**Still open (operator/CI, unchanged):** live test-mailbox validation, Forge packaged proof in CI (`yarn package` stays off developer machines per AGENTS.md), and the design §5.3 full upgrade if destructive schema work ever lands.

## Requirement scorecard

| ID | Stage | This pass |
| --- | --- | --- |
| FR-01 | B | Tools are registered and the mutation set is explicit. Not re-tested against the live tool catalog. |
| FR-02 | B | **Open (R6-01).** An ambiguous or substituted message id is executed when the sentence matched `send_now`. |
| FR-03 | B | Capability service is on the action-service constructor. Not re-tested against a live server. |
| FR-04 | B | Draft create/update and the editable `failed` state are wired. |
| FR-05, FR-06 | B | Not re-opened. CID relink is by content id. Attachment limit behavior was not re-read in this pass. |
| FR-07 | B | **Open (R6-01).** Review and draft still block. Direct send skips the card for a payload the model composed. |
| FR-08 | B | Trash issues IMAP MOVE and refuses COPY+EXPUNGE when MOVE is absent. |
| FR-09 | B | Restore lineage checks are on the single path and on bulk prepare/execute. A missing writable folder fails the item. |
| FR-10 | B | Not re-opened. Reply invalidation is attempted; the obligation hole is R6-03. |
| FR-11 | B | Operations, items, and detail history persist. List Undo does not (R6-05). |
| FR-12 | B | **Open (R6-01).** The send tool issues a fresh authorization from the model’s draft and revision ids. |
| FR-13 | B | Unknown, failed, and partial SMTP outcomes use different statuses. The Sent-copy warning is missing on the unknown return (R6-05). |
| FR-14 | B | Detail history, the review dialog, and the bulk dialog exist. List Trash has no Undo control (R6-05). Keyboard behavior was not re-run. |
| FR-15 | B | The new history and bulk keys exist in en, zh, es, fr, de, and ja. Raw error codes and the Sent-copy status token are still shown (R6-05). |
| FR-16 | B | `assertInteractive` rejects `scheduledOrigin` before Trash, restore, and send. `search_emails` stays readable. Not re-run inside a scheduled loop. |
| FR-17 | C | **Open (R6-02).** |
| FR-18 | B/C | Bulk prepare freezes ids, versions, and destinations. A selection id cannot take the direct-send skip. |
| FR-19 | C | Bulk execution reports per item. Not re-run. |
| FR-20 | C | Not re-run. The sweeper’s heartbeat gate is present in `settleOrphanedPendingOperations`. |

### Acceptance scenarios that this pass can already fail

| ID | Result |
| --- | --- |
| AC-01 | Fails. One explicit recipient in the sentence does not constrain the revision that `send_email_forward` submits. |
| AC-02 | Holds in the resolver: review and draft phrases return before `send_now`. |
| AC-03 | Fails on the direct path. Several matches for “Alice” are not resolved by the host; any single address in the draft is enough. |
| AC-08 | Holds for Trash and Undo started from the message detail history, including after leaving and reopening that message. The list Trash control does not offer Undo. |
| AC-10 | Holds after `sendMail` has started. Fails for a throw before `sendMail`: the draft is `submitted` and the operation is `outcome_unknown` (R6-04). |
| AC-13 | Holds when the instruction is only inside the stored message and the user sentence has no send phrase. Fails when that sentence is pasted into the user turn without quote markers (R6-01). |
| AC-18 | The operation row stores accepted and rejected recipients. The immediate unknown return can hide the Sent-copy warning (R6-05). |
| AC-22 | Fails on the `outcome_unknown` return and on the detail page unless status is `submitted`. |

AC-04 through AC-07, AC-09, AC-11, AC-12, and AC-14 through AC-21 were not re-executed. Do not treat the fifth audit’s “Fixed” cells as a pass for them.

## Verification still required

- Re-run the organization Vitest files against `9f99b1813`, including a test that builds the production chat gate with a user sentence “forward this to finance@example.com now” and a tool call whose draft recipients are different.
- Re-run `test/e2e/specs/emailOrganizationJourneys.test.ts`. Add a list-row Trash case that leaves the list and still finds Undo, and a server-search case whose folder has more than 200 matches and whose last page must report `complete: true` with `nextCursor: null`.
- Live mailbox, packaged Forge proof, and the PRD timing targets were not run here. `yarn package` stays off developer machines.

## Suggested repair order

1. **R6-01** — bind direct send to the trusted message, account, addresses, and verb before any card skip or `authorizationModule.issue`.
2. **R6-03** — stop swallowing the obligation insert; reply admission stays closed until the row exists.
3. **R6-04** — release the draft when the failure is still before `sendMail`.
4. **R6-02** — hash the real folder scope, and stop treating the 200-UID window as the 1000-candidate cap.
5. **R6-05** — surface `sentCopyStatus` and list Undo from the values the operation row already stores.
6. **R6-06** — decide whether design §5.3’s backup and schema version still ship, and record that decision in the design if the readiness gate is the final upgrade behavior.
