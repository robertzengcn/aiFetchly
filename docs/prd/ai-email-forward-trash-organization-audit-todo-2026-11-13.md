# Email forwarding, Trash and organization — eighth audit TODO

- Audit date: 2026-11-13 (Asia/Shanghai).
- Reviewed implementation: `/Users/cengjianze/project/aiFetchly-email-org`, branch `feature/email-forward-trash-organization`, commit **`952e7632d`**.
- Requirements: [PRD](./ai-email-forward-trash-organization-prd.md), [technical design](./ai-email-forward-trash-organization-technical-design.md).
- Previous report: [seventh audit TODO](./ai-email-forward-trash-organization-audit-todo-2026-11-12.md). Later commits appended a remediation note to that file. This report re-reads the production callers. That note is not evidence.

## Verdict

**The PRD is not fully implemented. Stage B direct send is still blocked.** Stage C’s failed-folder scan and the Sent-copy card are in place.

What this pass can confirm on the shipping path:

- A forward whose envelope contains the source sender is refused. Addresses in the sentence that equal the source sender are removed before the recipient comparison. The sending account must equal the source message’s account. A draft whose `conversationId` is null or belongs to another conversation stays on review.
- A failed server folder stops the scan (`break outer`). Rows already returned come from folders before the hole, and `nextCursor` points at the failed folder. `totalMatched` is `rows.length` only when the scan finished, and `null` otherwise. The bulk dialog passes `{selected}` and renders a dash when the total is null.
- The operation card renders `sentCopyStatus` of `failed` or `unknown` with the translated `sent_copy_warning` string. A submitted forward whose copy is `failed` or `unknown` adds `warning` and `SENT_COPY_UNVERIFIED` on the tool result.

What is still wrong is the same class of mistake: the pure check is tested with a flag the production caller does not set, and the forward path that does run treats “a draft in this conversation” as “the revision the user just reviewed.”

This was a source audit. Application code was not changed. The Vitest files, the Playwright spec, and a live mailbox were not re-run.

## The repeated error

A helper is correct when the test passes the missing input, and the caller that ships never passes it. The branch that does run then binds a wider set than the sentence.

| What the tests and comments describe | What `resolveDirectSendPayloadBinding` does |
| --- | --- |
| Trash is direct when the named sender has exactly one message. Restore is direct when the account has exactly one restorable Trash operation. | `draftBelongsToConversation` starts false and is set true only inside the `send_email_forward` branch. `isDirectSendPayloadBound` returns false for every tool when that flag is not true. The sender count and the restore count are computed and then discarded. |
| “Send it now” authorizes the revision the review showed. | With no addresses in the sentence, any revision in this conversation whose envelope is non-empty skips the card. There is no “exactly one open draft” check and no attachment check. |
| Uniqueness of a sender is one person. | `countBySender` uses SQLite `=` on `fromAddress`. The sentence comparison lowercases. `Bob@x.com` and `bob@x.com` are two people in the count and one person in the sentence. |

## Recheck of the seventh-audit items

| Item | This pass | What is still open |
| --- | --- | --- |
| R7-01 message, account, undo scope | Source-as-recipient is refused. Sending account must match the source account. The restore count is account-wide and includes partial success. The sender count exists. | **R8-01.** Trash and restore never reach those checks. “Send it now” binds any conversation draft. Attachments are still outside the check. The sender count is case-sensitive. |
| R7-02 failed folder and total | The scan stops at the hole. `totalMatched` is null unless the scan finished. The bulk line passes `selected`. | **R8-02.** The server resume position is still an index into a fresh IMAP SEARCH. |
| R7-03 Sent-copy warning | The operation card shows it. The submitted tool result carries `warning`. | **R8-03.** The `outcome_unknown` tool return is built before that warning, and the chat string is English with the raw status token. |

## Open work

### R8-01 — P1 — Direct Trash and Undo never run, and “send it now” can send a different draft in the same conversation

PRD §5.1: “Delete the email from bob@example.com” moves that message when it is the only one. “Undo that” restores the only restorable Trash operation and asks when several exist. “Send it now” after a review sends the revision that was shown. A changed recipient, account, body, or attachment selection invalidates the prior approval (FR-02, FR-07, FR-12, AC-01, AC-12).

`isDirectSendPayloadBound` refuses every call unless `draftBelongsToConversation === true` (`EmailOrganizationIntentResolver.ts`, before the `switch`). `resolveDirectSendPayloadBinding` (`AIChatQueryLoop.ts`) sets that flag only while handling `send_email_forward`. The Trash branch sets `senderMessageCount` and leaves the flag false. The restore branch sets `singleRestoreCandidateId` and leaves the flag false. Both then call `isDirectSendPayloadBound`, which returns false before the Trash and restore cases.

The unit tests pass `draftBelongsToConversation: true` on the Trash and restore cases that expect a skip (`EmailOrganizationIntentResolver.test.ts`, “trash binds only when the sentence names the target message's sender” and “restore is direct only with exactly one restorable candidate”). Production never supplies that true value for those tools. The unique-sender and account-wide undo behavior is covered in the pure function and is not what chat runs. Chat Trash and chat Undo stay on the review card even when the account has exactly one match.

The forward path does set the flag, and then:

- When the sentence contains no email address, the function returns true if the envelope is non-empty. “Send it now” therefore skips the card for every ready revision in this conversation, not only the revision the review showed. A second draft in the same conversation, including one created earlier to a different address, is an allowed target. The model chooses `revision_id`.
- The attachment set on that revision is not compared to anything. A draft that dropped the original PDF still passes when the recipients match, or when the sentence has no addresses.

Two siblings sit in the helpers the flag currently hides. They become live as soon as Trash and restore set the flag, so they belong in the same fix:

- `EmailReceivedMessage.model.ts` `countBySender` counts `where: { emailServiceId, fromAddress }` with SQLite’s case-sensitive `=`. The sentence check lowercases. Two messages from `Bob@x.com` and `bob@x.com` make `senderMessageCount === 1` for the row the model picked, and the lowercase sentence still contains that sender. Direct Trash would move one and leave the other.
- Restore sets `singleRestoreCandidateId` to the operation id the model passed, after `countRestorableTrashOperations` returns 1. The count is not required to be that id. A failed Trash id on an account that has one other restorable operation would skip the card; `restoreFromOperation` then refuses the failed id. The card skip and the operation that can actually be restored are not the same row.

Repair: set the conversation flag only for forward. For Trash, require `senderMessageCount === 1` after counting with a case-insensitive address, and keep the named-sender check. For restore, load the single restorable operation id from the count query and require the model’s id to be that id. For “send it now”, require exactly one open draft in the conversation, and require the tool’s revision to be that draft’s current revision. Compare the attachment selection to the source’s ordinary attachments unless the sentence names a different set.

### R8-02 — P2 — A server search page is still an index into a list that can change

FR-17: the continuation is the same query. Mail that arrives between pages must not duplicate or skip rows.

`ImapEmailMailboxAdapter.searchUids` runs IMAP SEARCH again and slices `uids.slice(offset, offset + cap)`. `EmailOrganizationSearchService` stores that index in the cursor. The failed-folder stop no longer walks past the hole. The index itself still moves when the SEARCH result grows or shrinks. A resume UID, or a UID high-water mark, is what keeps the next page aligned.

### R8-03 — P2 — The chat warning covers the submitted return and not the unknown return

AC-22: a failed or unverified Sent copy shows a warning on the surface the user is looking at.

`sendEmailForward` returns the `outcome_unknown` envelope first, with `code: "OUTCOME_UNKNOWN"` and no `warning` field. The `SENT_COPY_UNVERIFIED` branch runs only for `status === "submitted"`. An unknown SMTP result whose copy is `failed` or `unknown` still carries `sentCopyStatus` inside `result`, and the transcript sentence is the generic unknown error. The submitted warning is an English string that interpolates the raw token `failed` or `unknown`. The operation card translates the same status. The chat string does not.

Repair: add the translated warning on the unknown return when `sentCopyStatus` is `failed` or `unknown`, and use `sent_copy_status.*` for the status word in the tool string the same way the card does.

## Remediation status

**Remediated on this branch (commit `07ef412f9`), re-read at the production callers.** The audit's own verification tests are implemented, including the production-method requirement.

| Item | Status | Evidence on the production path |
| --- | --- | --- |
| R8-01 direct Trash/Undo dead + loose "send it now" | **Fixed** | The conversation flag is FORWARD-scoped (`isDirectSendPayloadBound` reads it only in the send_email_forward case), so chat direct Trash and direct Undo run when their durable checks pass. "Send it now" binds the review-shown revision: the conversation must contain exactly ONE open draft, the referenced draft must be it, and the revision must be its CURRENT one — two open drafts refuse both revision ids (test), a superseded revision refuses (test). Attachments joined the binding: every deselected manifest entry must be named in the sentence (full name or stem — "without the logo" matches logo.png), or the send takes review (tests: silent drop refuses, named drop runs). `countBySender` is case-insensitive (LOWER(); test: Bob@x.com + bob@x.com → count 2 → refuse). The restore candidate is `findRestorableTrashOperationIds`'s id — never the model's id (test: a failed id on an account with one OTHER restorable operation refuses). |
| R8-01 architecture | **Fixed** | The binding resolution moved to `EmailOrganizationDirectSendBinding.ts` — the production function (durable reads + pure check) is called by the loop AND by the new test file, satisfying the audit's "the production method, not the pure check with the flag forced true" requirement (tests: Trash single sender, restore single candidate, both through the production resolution with in-memory durable fakes). |
| R8-02 resume index | **Fixed** | `ServerSearchInput.resumeUid` replaces the index: the adapter filters matched UIDs strictly greater than the high-water mark, the cursor payload carries `{folderIndex, resumeUid}`, and the consumed-UID mark advances over every consumed candidate (date-filtered included). Pre-R8-02 index cursors fail validation to a fresh search. Stage C + adapter fakes migrated; the full Stage C + adapter suites pass (39 tests). |
| R8-03 unknown-return warning | **Fixed** | The OUTCOME_UNKNOWN return carries `warning` (and the failure variant type gains the field) when the Sent copy is failed/unknown; both chat warning sentences use the shared `sent_copy_status.*` map (the same source the card renders) instead of the raw token. |

**Verification run on this branch:** `yarn typecheck` 0 errors; `yarn vue-typecheck` 0 errors; binding tests 7/7; resolver 30/30; Stage C + adapter 39/39; component suite 184/1616; `emailOrganizationJourneys.test.ts` 4/4 re-run at the remediation commit.

**Still open (operator/CI, unchanged):** live test-mailbox validation and Forge packaged proof (`yarn package` stays off developer machines per AGENTS.md).

## Requirement scorecard

| ID | Stage | This pass |
| --- | --- | --- |
| FR-01 | B | Not re-tested against the live catalog. |
| FR-02 | B | **Open (R8-01).** Chat cannot direct-delete the single matching message, and “send it now” does not require a single draft. |
| FR-03 | B | Not re-opened. |
| FR-04 | B | Not re-opened. |
| FR-05, FR-06 | B | Attachment choice is still outside the direct-send binding (R8-01). The materializer was not re-read. |
| FR-07 | B | **Open (R8-01).** Review and draft phrases still block. Direct Trash and direct Undo do not run. “Send it now” can submit a different draft from the same conversation. |
| FR-08 | B | The list Trash button still moves the row the user clicked. Chat direct Trash does not. |
| FR-09 | B | Detail history and the list Undo button restore a recorded operation. Chat “undo that” does not skip the card (R8-01). |
| FR-10, FR-11 | B | Not re-opened. |
| FR-12 | B | **Open (R8-01).** |
| FR-13 | B | Statuses stay distinct. The unknown chat return omits the Sent-copy sentence (R8-03). |
| FR-14 | B | List Undo, detail history, the bulk dialog, and the operation card warning are mounted. Keyboard behavior was not re-run. |
| FR-15 | B | The card uses the translated status word. The chat tool warning is English (R8-03). |
| FR-16 | B | Not re-opened. |
| FR-17 | C | The failed-folder hole is closed. The resume index can still drift (R8-02). |
| FR-18 | C | A `selection_id` still cannot take the chat direct path. The bulk dialog freezes the set before execute. |
| FR-19, FR-20 | C | Not re-run. |

### Acceptance scenarios this pass can already fail

| ID | Result |
| --- | --- |
| AC-01 | Holds for one conversation draft whose envelope is exactly the address in the sentence and whose sending account is the source account. Fails when a second draft in that conversation is the revision the model names, and when that revision dropped attachments. |
| AC-02 | Holds in the resolver: review and draft phrases return before `send_now`. |
| AC-03 | “Alice” with no address stays on review. Two stored messages that differ only by address case are not treated as ambiguous by `countBySender` (R8-01). |
| AC-08 | Holds for the list Undo button and the detail history. Chat “undo that” with one restorable operation stays on the review card. |
| AC-12 | A recipient change that makes the envelope differ from the sentence stays on review. “Send it now”, which names no address, does not notice a different draft’s recipients (R8-01). |
| AC-13 | Holds when the instruction is only in the stored message. An unquoted paste that contains a send phrase is still the trusted text. |
| AC-22 | Holds on the detail toast and the operation card. The chat unknown return does not add the warning sentence (R8-03). |

AC-04 through AC-07, AC-09 through AC-11, and AC-14 through AC-21 were not re-executed.

## Verification still required

- A test that calls `resolveDirectSendPayloadBinding` (the production method, not `isDirectSendPayloadBound` with the flag forced true) for Trash with one matching sender, and for restore with one restorable operation. Both must be allowed only after the production caller sets the inputs the pure function actually reads.
- A test that “send it now” with two open drafts in the conversation refuses both revision ids.
- Re-run the organization Vitest files and `test/e2e/specs/emailOrganizationJourneys.test.ts` at `952e7632d`. Live mailbox and Forge packaging were not run. `yarn package` stays off developer machines.

## Suggested repair order

1. **R8-01** — stop applying the conversation-draft flag to Trash and restore; bind “send it now” to the single current revision in the conversation; count senders case-insensitively; take the restore candidate from the count, not from the model id.
2. **R8-03** — put the translated Sent-copy warning on the unknown tool return as well as the submitted one.
3. **R8-02** — resume a server page by UID rather than by index into a new SEARCH.
