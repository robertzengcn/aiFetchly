# Email forwarding, Trash and organization — ninth audit TODO

- Audit date: 2026-11-13 (Asia/Shanghai), second pass the same day.
- Reviewed implementation: `/Users/cengjianze/project/aiFetchly-email-org`, branch `feature/email-forward-trash-organization`, commit **`2edf6ec5e`**.
- Requirements: [PRD](./ai-email-forward-trash-organization-prd.md), [technical design](./ai-email-forward-trash-organization-technical-design.md).
- Previous report: [eighth audit TODO](./ai-email-forward-trash-organization-audit-todo-2026-11-13.md). Commit `2edf6ec5e` appended a remediation note to that file. This report re-reads the production binding. That note is not evidence.

## Verdict

**The PRD is not fully implemented. Stage B direct send is still blocked.** Trash, restore, the server UID cursor, and the unknown-outcome Sent-copy sentence are in place.

What this pass can confirm on the shipping path:

- `resolveDirectSendPayloadBinding` in `EmailOrganizationDirectSendBinding.ts` is the function `AIChatQueryLoop` calls, with the live draft, message, and operation modules. The conversation flag is read only inside the forward branch of `isDirectSendPayloadBound`.
- Trash passes a case-insensitive `countBySender` (`LOWER(fromAddress)`) and refuses unless that count is 1 and the sender address is in the sentence. A `selection_id` returns false before the pure check.
- Restore sets `singleRestoreCandidateId` from `findRestorableTrashOperationIds` and requires the model’s `operation_id` to be that id. A count other than 1 leaves the candidate null.
- “Send it now” with no address in the sentence requires exactly one open draft (`draft` / `ready` / `failed`) in the conversation, that draft to be the one the revision belongs to, and the revision to be `currentRevisionId`.
- A failed server folder still stops the scan. The cursor is `{folderIndex, resumeUid}`. The adapter keeps UIDs strictly greater than `resumeUid`. ImapFlow documents the SEARCH list as ascending, so the high-water mark walks the rest of the folder. A pre-R8 index cursor fails validation.
- `outcome_unknown` and a fully submitted forward both add a `warning` sentence whose status word comes from `en.ts` `sent_copy_status`. The operation card still translates the same status through `t()`.

What is still wrong is the same class of mistake: the new guard is applied to the sentence shape the last audit named, and the sibling shape uses a weaker check. The tests cover the shape that was named.

This was a source audit. Application code was not changed. The Vitest files, the Playwright spec, and a live mailbox were not re-run.

## The repeated error

A check is added for the example in the previous report. The production function then applies it only to that example, or matches a weaker condition than the comment describes. The new test calls the production function, and it calls it with the example sentence.

| What the comment and the new tests describe | What the forward branch does for the other sentence |
| --- | --- |
| “Send it now” authorizes the single current revision in the conversation. Two open drafts refuse both revision ids. | That block runs only when `extractHasNoAddresses` is true (`EmailOrganizationDirectSendBinding.ts`). “Forward this to finance@example.com now” never enters it. Two open drafts that both envelope to finance@example.com both skip the card. |
| A dropped attachment is direct only when the sentence names the exclusion (“without the logo”). | `isDirectSendPayloadBound` accepts the drop when the normalized sentence contains the filename or its stem as a substring. There is no exclusion word. “Forward this invoice to finance@example.com now” contains `invoice`, so a revision that deselected `invoice.pdf` is direct. “Keep the logo” contains `logo`, so a deselected `logo.png` is direct. |
| The Sent-copy warning is on every chat return that carried an unverified copy. | The `partially_succeeded` return is built before that branch and has no `warning`. The all-rejected delivery return omits `sentCopyStatus` even though the item row stored it. |

## Recheck of the eighth-audit items

| Item | This pass | What is still open |
| --- | --- | --- |
| R8-01 conversation flag, sender case, restore id, single draft, attachments | The flag no longer blocks Trash or restore. The count is case-insensitive. The restore candidate is the id the query returned. The single-draft and current-revision checks run for a sentence with no address. | **R9-01.** Those two checks do not run when the sentence names an address. The attachment check treats any stem substring as permission to drop the file. |
| R8-02 server resume index | Closed on the shipping path. Resume is a UID high-water mark, and a missing `resumeUid` is a fresh search. | None in this pass. |
| R8-03 unknown-return warning | The unknown return and the fully submitted return use `sentCopyWarningSentence`. | **R9-02.** Partial acceptance returns first, without that sentence. The chat sentence is always the English map. |

## Open work

### R9-01 — P1 — An addressed forward skips the single-draft rule, and a filename stem authorizes a dropped attachment

PRD §5.1: “Forward this to finance@example.com now” sends only when the message, account, address, and attachment choice are unambiguous. §5.2: include the original ordinary attachments, and never omit one silently. A changed attachment selection invalidates the prior approval (FR-02, FR-06, FR-07, FR-12, AC-01, AC-12).

`EmailOrganizationDirectSendBinding.ts` loads the open drafts and compares `revision.id` with `draft.currentRevisionId` only inside `if (extractHasNoAddresses(input.userText))`. `extractHasNoAddresses` is false as soon as the sentence contains one email address. The production tests that refuse two drafts and a stale revision both use the text `"send it now"`. They do not call the same function with `"forward this to finance@example.com now"`.

For that sentence the pure check compares the envelope to the named recipients and then returns true. Two open drafts in the same conversation, both addressed only to finance@example.com, both belong to the conversation, and both pass. The model chooses `revision_id`. Delivery then sends that draft’s current revision, including whichever source message the draft points at. “This” was not resolved.

The attachment gate sits above the switch in `isDirectSendPayloadBound`:

```typescript
const stem = name.replace(/\.[A-Za-z0-9]{1,8}$/, "");
if (text.includes(name) || (stem !== "" && text.includes(stem))) {
  continue;
}
return false;
```

`text` is the whole normalized sentence. The test that expects a skip uses `"send it now without the logo"` against a dropped `logo.png`. The same `includes` is true for any of these, and the send is then direct:

- “Forward this invoice to finance@example.com now” with `invoice.pdf` deselected. `invoice` is the noun of the request, and it is the PRD’s own example of a file that must be included.
- “Forward this to finance@example.com now and keep the logo” with `logo.png` deselected. The sentence says to keep the file. The stem is present, so the drop is treated as named.
- A dropped `a.pdf`, `e.pdf`, or `o.pdf`. The stem is one letter, and `forward` contains `a`, `e`, and `o`.

A revision that leaves every manifest entry `selected: true` is unaffected. The hole is a deselected entry whose stem occurs anywhere in the trusted sentence, with no requirement that the sentence be an exclusion.

Repair: run the single-open-draft and current-revision checks for every direct forward, not only the address-free sentence. Treat a drop as named only when an exclusion phrase applies to that stem as a whole word (`without`, `except`, `drop`, `text only`, and the same phrases in the six UI languages). A mention of the filename, and a stem that is a substring of another word, stays on the review card.

### R9-02 — P2 — Partial acceptance still omits the Sent-copy sentence

AC-22: a failed or unverified Sent copy shows a warning on the surface the user is looking at. FR-15: that sentence follows the user’s language.

`sendEmailForward` adds `warning` for `outcome_unknown` and for `submitted` with a `failed` or `unknown` copy. The `partially_succeeded` branch returns before that second check, with `code: "PARTIAL_RECIPIENT_ACCEPTANCE"` and no `warning`. Delivery still puts `sentCopyStatus` on that submitted outcome, and the item row stores it, so the operation card can show the warning after the user opens history. The chat tool result for the turn they are in does not.

The all-rejected delivery return is the other half of the same split. `finalizeItem` writes `sentCopyStatus` into `resultJson`, then the `failed` return object leaves the field off. The tool’s failed branch has nothing to warn from.

The sentences that do exist are built from `enMessages`. `sentCopyStatusLabel` never reads `zh`, `es`, `fr`, `de`, or `ja`. A Chinese UI still gets “copy failed” inside an English sentence. The card path uses `t()` and does not have this gap.

Repair: when `sentCopyStatus` is `failed` or `unknown`, attach the warning on the partial return and on the all-rejected return as well. Build the chat sentence from the active locale’s `sent_copy_status` table, the same way the card does.

## Requirement scorecard

| ID | Stage | This pass |
| --- | --- | --- |
| FR-01 | B | Not re-tested against the live catalog. |
| FR-02 | B | **Open (R9-01).** An addressed “forward this” does not require one draft, and a dropped file whose name appears in the sentence is treated as chosen. |
| FR-03 | B | Not re-opened. |
| FR-04 | B | Not re-opened. |
| FR-05, FR-06 | B | **Open (R9-01).** A silent drop of `invoice.pdf` passes the direct-send gate when the sentence says “forward this invoice”. |
| FR-07 | B | Review, draft, and negation still block. Direct Trash of one uniquely named sender, and direct Undo of one restorable operation, now reach the pure check. The addressed forward still skips the card for a second matching draft (R9-01). |
| FR-08 | B | The list Trash button moves the row the user clicked. Chat “delete this” with no sender address stays on review, because chat still has no trusted selection. |
| FR-09 | B | One restorable Trash operation on the account can skip the card, and the id has to be the one the count returned. |
| FR-10, FR-11 | B | Not re-opened. |
| FR-12 | B | **Open (R9-01).** |
| FR-13 | B | Statuses stay distinct. Partial acceptance does not carry the Sent-copy sentence on the tool result (R9-02). |
| FR-14 | B | List Undo, detail history, the bulk dialog, and the operation card warning are mounted. Keyboard behavior was not re-run. |
| FR-15 | B | The card uses the active locale. The chat warning is the English table (R9-02). |
| FR-16 | B | Not re-opened. |
| FR-17 | C | The server page resumes by UID. The local cursor still hashes the folder scope. |
| FR-18 | C | A `selection_id` still cannot take the chat direct path. The bulk dialog freezes the set before execute. |
| FR-19, FR-20 | C | Not re-run. |

### Acceptance scenarios this pass can already fail

| ID | Result |
| --- | --- |
| AC-01 | Holds for one open conversation draft, an envelope equal to the named address, every attachment selected, and the sending account equal to the source account. Fails when a second open draft has that same envelope, and when `invoice.pdf` is deselected on “forward this invoice to finance@example.com now”. |
| AC-02 | Holds in the resolver: review and draft phrases return before `send_now`. |
| AC-03 | “Alice” with no address stays on review. `Bob@x.com` and `bob@x.com` now count as one sender. |
| AC-08 | Holds for one restorable Trash operation: the candidate is that operation’s id. A second restorable operation stays on review. |
| AC-12 | A recipient that is not in the sentence stays on review. A dropped attachment whose stem occurs in the sentence does not (R9-01). |
| AC-13 | Holds when the instruction is only in the stored message. An unquoted paste that contains a send phrase is still the trusted text. |
| AC-22 | Holds on the detail toast, the operation card, the unknown tool return, and a fully submitted tool return. The partial tool return does not add the sentence (R9-02). |

AC-04 through AC-07, AC-09 through AC-11, and AC-14 through AC-21 were not re-executed.

## Verification still required

- A production-binding test whose user text is `forward this invoice to finance@example.com now`, with `invoice.pdf` deselected. It must refuse. The same test with `keep the logo` and `logo.png` deselected must refuse.
- A production-binding test with two open drafts, both enveloped to finance@example.com, and the user text `forward this to finance@example.com now`. Both revision ids must refuse.
- Re-run the organization Vitest files and `test/e2e/specs/emailOrganizationJourneys.test.ts` at `2edf6ec5e`. Live mailbox and Forge packaging were not run. `yarn package` stays off developer machines.

## Suggested repair order

1. **R9-01** — apply the single-draft and current-revision rule to every direct forward, and require an exclusion phrase around the dropped filename rather than a stem substring.
2. **R9-02** — put the locale-aware Sent-copy warning on the partial and all-rejected tool returns.
