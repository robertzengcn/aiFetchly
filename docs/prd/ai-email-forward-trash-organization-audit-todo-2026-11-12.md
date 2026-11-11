# Email forwarding, Trash and organization — seventh audit TODO

- Audit date: 2026-11-12 (Asia/Shanghai).
- Reviewed implementation: `/Users/cengjianze/project/aiFetchly-email-org`, branch `feature/email-forward-trash-organization`, commit **`da10a1464`**. `da10a1464` only moves a comment and rewrites the scan-limitation condition with the same predicate. It does not change the holes below.
- Requirements: [PRD](./ai-email-forward-trash-organization-prd.md), [technical design](./ai-email-forward-trash-organization-technical-design.md).
- Previous report: [sixth audit TODO](./ai-email-forward-trash-organization-audit-todo-2026-11-11.md). Commit `c7968391f` appended a “Remediation status” table to that file. This report re-reads the production callers. That table is not evidence.

## Verdict

**The PRD is not fully implemented. Stage B direct send is still blocked. Stage C server search is still blocked.**

The sixth-audit repairs that this pass can confirm on the shipping path:

- The direct-send flag is set only after `resolveDirectSendPayloadBinding` loads durable state and `isDirectSendPayloadBound` accepts the verb. A forward sentence no longer skips the card for Trash or restore. A read failure returns false.
- Local cursors hash the effective folder list, including the Trash exclusion. The adapter `capped` bit is “the window ended before the SEARCH list,” and the service does not OR that bit into the 1000-candidate ceiling. A failed envelope fetch keeps the UID in the candidate list.
- A failed reply-invalidation insert is recorded, and reply admission also checks a `REPLY_INVALIDATION_PENDING` item on a `needs_reconciliation` operation. `deriveOperationStatus` maps an `outcome_unknown` item to `needs_reconciliation`, which is in that status list.
- A throw before `sendMailEntered` finalizes the forward as `failed` / `NETWORK_BEFORE_DISPATCH` and releases the draft to editable `failed`. A throw after that flag stays `outcome_unknown` and `submitted`.
- The unknown delivery return includes `sentCopyStatus`. The detail page warns for `submitted` and `outcome_unknown`, with `sent_copy_status.*` in en, zh, es, fr, de, and ja. The receive list keeps the trash operation id and shows an Undo button. List errors go through `emailOrganization.error_code.*`.
- Design §5.3 now records the readiness gate as the shipped upgrade and defers backup, sync pause, and a schema-version marker until a destructive schema change. That matches the code. It is a recorded deferral, not a hidden hole in the gate.

Two production holes remain, and they are the same class as the earlier audits: the new check describes a safe identity or a safe resume point, and the caller that runs uses a smaller identity or a resume point that disagrees with the rows already returned.

This was a source audit. Application code was not changed. The Vitest files, the Playwright spec, and a live mailbox were not re-run. The “4/4 Playwright” note is the implementer’s claim.

## The repeated error

The helper answers a narrower question than the requirement, and the caller treats that answer as the whole authorization or the whole page.

| What the new code appears to do | What the shipping caller does |
| --- | --- |
| Direct send is “bound to the trusted payload” | A forward is bound to the set of email addresses in the sentence. The source message, the sending account, and the attachments are not part of the check. Trash is bound to “the sender address appears somewhere in the sentence,” so any message from that sender qualifies. |
| “Undo that” is direct only when exactly one Trash operation exists | The count is `listRecentOperations({ limit: 50 })` with no account filter, and only `status === "succeeded"`. A second Trash outside that window, on another account, or in `partially_succeeded` is invisible, so the gate treats several restorable operations as one. |
| A failed folder’s cursor “points back at it so the next page retries it” | The loop still scans the folders after the failure and returns their rows. The cursor either stays on the failed folder (the next page repeats those rows) or is overwritten when a later folder fills the page (the failed folder is never retried). |

## Recheck of the sixth-audit items

| Item | This pass | What is still open |
| --- | --- | --- |
| R6-01 verb and address binding | The verb must be the tool. Mixed verbs stay on review. A forward envelope must equal the addresses extracted from the sentence. The host loads the revision, the message, or the operation list, and a thrown read stays on review. | **R7-01.** That binding is not the selected message, the named person, or the single Trash operation in the account. |
| R6-02 cursors | Local scope is hashed. Window `capped` is not the 1000-candidate flag. Dropped fetches keep their UID. | **R7-02.** A failed folder is both consumed and resumed. Server `totalMatched` is still the page length. |
| R6-03 obligation insert | The insert failure is logged and the reply gate reads the item marker. The aggregate status for that item is `needs_reconciliation`, which the query includes. | Not re-opened. A database that cannot write the item row either still has nothing for the gate to read. That is the outage itself, not a swallowed write. |
| R6-04 pre-socket throw | `sendMailEntered` is set immediately before `sender.sendMail`. The catch before that flag releases the draft. | Not re-opened. A throw inside `sendMail` before the socket is still treated as unknown. The session’s transporter is built earlier, so the library call is the socket boundary this code can see. |
| R6-05 warning and list Undo | Detail warning, list Undo, localized list errors, and the six `sent_copy_status` maps are on the callers. | **R7-03.** The operation card and the chat transcript do not render `sentCopyStatus`. The bulk result line names `{selected}` and the caller does not pass it. |
| R6-06 §5.3 | The design records the deferral. The gate is still the mutation check. | Closed as a recorded decision. Re-open it only when a change overwrites existing identity rows. |

## Open work

### R7-01 — P1 — Direct send still authorizes a different message than the one the sentence names

PRD §5.1 and design §8.1: “Forward this to finance@example.com now” sends that message, from the resolved account, to that address, with the unambiguous attachment choice. “Forward this customer inquiry to Alice” resolves Alice and asks when several contacts match. “Delete this email” with one selected message moves that message. “Move these 12 selected messages to Trash now” runs when trusted UI context identifies all 12. “Undo that” with more than one possible operation asks which one. Model arguments are not authorization (FR-02, FR-07, FR-12, AC-01, AC-03).

`isDirectSendPayloadBound` and `resolveDirectSendPayloadBinding` (`EmailOrganizationIntentResolver.ts`, `AIChatQueryLoop.ts`) do the following, and `sendEmailForward` still calls `authorizationModule.issue` for whatever revision ids the gate already allowed.

**Forward checks the recipient set and nothing else.** `extractSentenceAddresses` collects every email address in the user turn. `sentenceAddressesBindEnvelope` requires that set to equal the revision’s To, Cc, and Bcc. There is no comparison to the open message id, the draft’s `messageId`, the sending account, or the attachment selection.

- “Forward this to finance@example.com now” skips the card for any ready draft whose envelope is exactly `finance@example.com`, including a draft of a different message.
- “Forward the invoice from alice@vendor.com to finance@example.com now” refuses a draft addressed only to finance (the sets differ). It accepts a draft addressed to both alice and finance. Alice was named as the source, and the gate treats her as an authorized recipient.
- “Send it now” after a review contains no address, so the binding returns false. The comment on `resolveDirectSendVerb` says that phrase authorizes the forward the user just reviewed. The payload check then blocks it. The reviewed draft is not identified, and the go-ahead does not send.

**Trash checks that the sender address occurs in the sentence.** `move_email_to_trash` loads `message.fromAddress` and uses `sentenceAddresses.includes(...)`. Any message from that sender passes. Two messages from bob@example.com plus “delete the email from bob@example.com” skips the card for whichever id the model passes. A bare “delete this email,” which is the PRD row for one selected message, has no address, so it stays on review. `AIChatQueryLoop` has no trusted UI selection. The 12-message row is also unmet: a tool call that includes `selection_id` fails `isUnambiguousDirectSendPayload`, so a frozen UI selection cannot take the direct path either.

**Restore counts a window, not the account.** The binding loads `listRecentOperations({ limit: 50 })` with no `emailServiceId`. It keeps rows with `kind === "trash"` and `status === "succeeded"`. Direct undo runs only when that filtered list has length 1 and the model’s `operation_id` is that row.

- A second succeeded Trash older than the 50 most recent operations of any kind is invisible. “Undo that” then restores the one row inside the window.
- A succeeded Trash on another account counts. The user’s mailbox is not a constraint.
- `partially_succeeded` is excluded, so a bulk Trash that finished some items and a later single Trash can look like one candidate.

Repair: resolve the payload from the trusted UI selection when the user says “this” or “these 12,” and from a contact lookup when they name a person. A forward card-skip requires the source message id, the sending account, the attachment set, and the recipient set to be that payload. Addresses that only identify the source are not recipients. “Send it now” after a review authorizes the revision the review showed, and no other. Trash direct-send requires exactly one matching message, or the selected row. Restore direct-send counts every restorable Trash operation for that account, with no 50-row cap and including partial successes that still have items to restore.

### R7-02 — P1 — A failed server folder is both returned past and pointed at by the cursor

PRD §7 and FR-17: the continuation belongs to the same query, reports the folders that were searched, and does not present a partial page as a finished total. A folder that could not be searched is disclosed and can be retried without repeating rows the client already has.

In `EmailOrganizationSearchService.searchServer`, a non-`listed` result pushes the folder onto `failedFolders`, sets `resumePosition` to that folder’s current offset, sets `foldersExhausted = false`, and then `continue`s the outer loop. Later folders still append rows.

- If a later folder fills the page, `resumePosition` is replaced with that later folder. `nextCursor` starts after the failure. The failed folder is named on this page and is never the resume point. The retry the comment describes does not happen.
- If later folders finish without filling the page, `resumePosition` stays on the failed folder and `foldersExhausted` stays false, so `nextCursor` is set. The response already includes the later folders’ rows. The next call starts again at the failed folder and walks forward through those same folders. A client that appends pages shows the later folders twice. `searchedFolders` on the first page already lists them.

`totalMatched` on this path is still `rows.length` (the page). The limitation string “rows is the current page, not a matched total” is appended when the scan is incomplete. `EmailOrganizationBulkDialog.vue` reads `result.totalMatched` into `searchTotal` and renders `bulk_result_line` as “{count} of {total} shown.” The dialog’s own search uses `source: "local"`, whose model count is a real `getCount()`, so that screen is not the server bug. Any server-search caller that displays `totalMatched` still shows the page length as the total. The local bulk line also omits `{selected}`, which the English (and the other language) template includes, so the literal `{selected}` remains in the sentence.

The server offset is still an index into a fresh IMAP SEARCH. Mail that arrives between pages shifts that index. That residual is unchanged.

Repair: on a folder failure, stop the scan, return only the rows from folders before that failure, and point `nextCursor` at the failed folder. Do not scan past a hole and then resume before the hole. Set server `totalMatched` only when `complete` is true; otherwise omit it or return null. Pass `selected` into `bulk_result_line`, or remove the placeholder. A resume UID, rather than an index, is what keeps a page stable when the mailbox changes.

### R7-03 — P2 — The Sent-copy warning still exists only on the send toast

AC-22: a failed or unverified Sent copy shows a warning and does not cause a resend.

`EmailForwardDeliveryService` now puts `sentCopyStatus` on the `outcome_unknown` return, the success return, and the post-`sendMail` catch row. `detail.vue` `onForwardSent` shows the translated warning. `EmailOrganizationOperationCard.vue` does not read the field. No chat view reads it either. A forward started from chat, or a user who leaves the detail toast, has the status on the operation item and no surface that shows it. The list Undo button and the detail history are separate and are in place for Trash.

Repair: render `sentCopyStatus` from the operation projection on the operation card, and surface the same warning from the chat tool result when the status is `failed` or `unknown`.

## Requirement scorecard

| ID | Stage | This pass |
| --- | --- | --- |
| FR-01 | B | Tools and the mutation set are unchanged. Not re-tested against the live catalog. |
| FR-02 | B | **Open (R7-01).** Several messages from one sender, and “this” with a selection, do not produce clarification. |
| FR-03 | B | Not re-opened. The capability service is constructed by the action service. |
| FR-04 | B | Not re-opened. Editable `failed` drafts remain. |
| FR-05, FR-06 | B | Not re-opened this pass. |
| FR-07 | B | **Open (R7-01).** Review and draft phrases still block. A direct sentence skips the card for a different message with the same recipient set. “Send it now” after a review does not send the reviewed draft. |
| FR-08 | B | Not re-opened. Trash uses IMAP MOVE. |
| FR-09 | B | Lineage checks were not re-opened. Direct undo can still pick the wrong operation (R7-01). |
| FR-10 | B | Not re-opened. |
| FR-11 | B | Detail history and the list Undo button persist the operation id. The list button is page memory; the detail history reloads from the operation list. |
| FR-12 | B | **Open (R7-01).** The gate’s payload is the address set or the sender address, then the tool issues an authorization for the model’s ids. |
| FR-13 | B | Statuses are distinct. The Sent-copy warning is missing on the card and in chat (R7-03). |
| FR-14 | B | List Undo, detail history, and the bulk dialog are mounted. Keyboard behavior was not re-run. |
| FR-15 | B | `sent_copy_status` exists in all six languages. `bulk_result_line` still contains `{selected}` and the dialog does not pass it (R7-02). |
| FR-16 | B | Not re-opened. `assertInteractive` remains in front of send, Trash, and restore. |
| FR-17 | C | **Open (R7-02).** |
| FR-18 | C | A `selection_id` cannot take the direct-send skip. The trusted 12-message selection in the PRD is not wired (R7-01). |
| FR-19, FR-20 | C | Not re-run. |

### Acceptance scenarios this pass can already fail

| ID | Result |
| --- | --- |
| AC-01 | Fails when the draft’s recipients match the sentence and the source message does not. |
| AC-02 | Holds in the resolver: review and draft phrases return before `send_now`. |
| AC-03 | Fails for “Alice” with no address (no contact resolution; the turn stays on review, so it does not guess) and fails open when the sentence already contains two addresses and the model puts both on the envelope. |
| AC-08 | Holds for Trash and Undo from the list button and from the detail history of that message. Direct “undo that” in chat can restore a different account’s Trash when the 50-row window hides the other one (R7-01). |
| AC-13 | Holds when the instruction is only in the stored message. An unquoted paste that contains a send phrase and an address is still the trusted text; the new check then binds whatever draft matches that address. |
| AC-22 | Holds on the detail send toast. Fails for chat and for the operation card (R7-03). |

AC-04 through AC-07, AC-09 through AC-12, and AC-14 through AC-21 were not re-executed.

## Verification still required

- A unit test that builds `resolveDirectSendPayloadBinding` with “forward the invoice from alice@vendor.com to finance@example.com now” and a revision whose envelope is both addresses. It must refuse. The same sentence with a revision of a different `messageId` and envelope `finance@example.com` only must also refuse once source identity is required.
- A server-search test with folders `[failing, inbox, archive]` where inbox and archive each return a few rows. The first page must not include inbox and archive while `nextCursor` points at the failing folder. The following page must not repeat inbox.
- Re-run the organization Vitest files and `test/e2e/specs/emailOrganizationJourneys.test.ts` at `da10a1464`. Live mailbox and Forge packaging were not run. `yarn package` stays off developer machines.

## Suggested repair order

1. **R7-01** — bind direct send to the source message, account, attachments, and the single restorable operation in that account. Stop treating every address in the sentence as a recipient, and stop counting Trash inside a 50-row global window.
2. **R7-02** — stop scanning folders past a search failure; resume at the hole without repeating rows. Stop publishing the page length as `totalMatched`.
3. **R7-03** — show the Sent-copy status on the operation card and in chat, from the field the delivery return already carries.
