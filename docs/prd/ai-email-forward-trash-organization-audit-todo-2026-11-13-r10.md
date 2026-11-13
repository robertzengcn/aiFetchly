# Email forwarding, Trash and organization — tenth audit TODO

- Audit date: 2026-11-13 (Asia/Shanghai), third pass the same day.
- Reviewed implementation: `/Users/cengjianze/project/aiFetchly-email-org`, branch `feature/email-forward-trash-organization`, commit **`5fdb1bb41`**.
- Requirements: [PRD](./ai-email-forward-trash-organization-prd.md), [technical design](./ai-email-forward-trash-organization-technical-design.md).
- Previous report: [ninth audit TODO](./ai-email-forward-trash-organization-audit-todo-2026-11-13-r9.md). Commit `5fdb1bb41` appended a remediation note to that file. This report re-reads `sentenceExcludesAttachment` and the tool returns. That note is not evidence.

## Verdict

**The PRD is not fully implemented. Stage B direct send is still blocked on one attachment case.** The single-draft rule, the whole-word stem check, and the Sent-copy field on every fresh send return are in place.

What this pass can confirm on the shipping path:

- `resolveDirectSendPayloadBinding` runs the single-open-draft and current-revision checks for every `send_email_forward`, including “forward this to finance@example.com now”. Two open drafts return false before the pure check. A stale `revision_id` returns false.
- `sentenceExcludesAttachment` refuses a bare filename (“forward this invoice …”), refuses “keep the logo”, and refuses a one-letter stem inside “forward”. An exclusion phrase and the stem both have to match as whole words (CJK phrases as substrings). The tests cover those sentences.
- Partial acceptance, all-rejected failure, unknown outcome, and a fully submitted forward each attach `warning` when `sentCopyStatus` is `failed` or `unknown`. The all-rejected delivery return now includes `sentCopyStatus`. The status word comes from the active UI locale’s `sent_copy_status` table (`getLanguagePreference`, then `locale.slice(0, 2)`).

What is still wrong is the same class of mistake: the comment describes one relationship, and the code checks the two sides independently.

This was a source audit. Application code was not changed. The Vitest files, the Playwright spec, and a live mailbox were not re-run.

## The repeated error

The new test proves the two halves of the rule on separate sentences. The production function never requires those two halves to be about the same file.

| What the comment says | What `sentenceExcludesAttachment` does |
| --- | --- |
| An exclusion phrase applies to the dropped file’s stem. “Without the logo” allows `logo.png`. “Forward this invoice” does not allow dropping `invoice.pdf`. | `hasExclusion` is true when any phrase in `DROP_EXCLUSION_PHRASES` occurs anywhere in the sentence. The stem test then runs on the whole sentence. The two matches are not required to be next to each other, and one phrase covers every dropped file whose stem appears anywhere. |
| The chat warning is the active locale’s sentence, the same way the card uses `sent_copy_warning`. | The status word is localized. The three sentence frames in `sentCopyWarningSentence` are English string literals. `sent_copy_warning` already exists in en, zh, es, fr, de, and ja, and this function does not read it. |

## Recheck of the ninth-audit items

| Item | This pass | What is still open |
| --- | --- | --- |
| R9-01 single draft on addressed forwards, and a stem substring authorizing a drop | The single-draft and current-revision checks are unconditional for forward. “Forward this invoice” with `invoice.pdf` deselected refuses. “Keep the logo” refuses. `a.pdf` inside “forward” refuses. | **R10-01.** “Forward this invoice to finance@example.com now without delay” still authorizes dropping `invoice.pdf`, because `without` and `invoice` each match somewhere. |
| R9-02 warning on partial and all-rejected, in the active locale | Those returns set `warning`. The parenthetical status word follows the UI language. | **R10-02.** The sentence around that word is English on every locale. |

## Open work

### R10-01 — P1 — An exclusion phrase anywhere authorizes every filename mentioned anywhere

PRD §5.2: include the original ordinary attachments, and never omit one silently. §5.1: a changed attachment selection invalidates the prior approval unless the user named that change (FR-06, FR-07, FR-12, AC-01, AC-12).

`sentenceExcludesAttachment` (`EmailOrganizationIntentResolver.ts`) returns true when both of these are true, with no link between them:

1. Some entry in `DROP_EXCLUSION_PHRASES` matches the sentence (`without`, `except`, `drop`, `omit`, `ohne`, `außer`, `sauf`, `除了`, and the rest).
2. The dropped file’s stem or full name matches somewhere else as a whole word.

`isDirectSendPayloadBound` calls that function once per deselected manifest entry. Each call sees the same sentence. One `without` therefore satisfies the phrase half for every file.

These sentences skip the card and send the revision with the file deselected:

- “Forward this invoice to finance@example.com now without delay”, `invoice.pdf` deselected. `without` is the phrase. `invoice` is the stem. The phrase modifies “delay”. The file the user named as the thing to forward is omitted.
- “Forward this invoice to finance@example.com now without the logo”, both `invoice.pdf` and `logo.png` deselected. The phrase is about the logo. `invoice` still matches, so the invoice is omitted too.
- “Forward this invoice to finance@example.com now except don’t cc anyone”, `invoice.pdf` deselected. `except` is about the cc list. The invoice is omitted.

The new tests never combine an exclusion that points at something else with the filename of a file that should stay. “Forward this invoice to a@b.test now” has no exclusion phrase, so it refuses. “Without the logo” names the file that was dropped. Both pass while the sentences above return true.

Repair: the stem has to be the object of that exclusion phrase, not a second match elsewhere in the sentence. A practical rule is a short window after the phrase (`without the logo`, `except the invoice`, `除了logo`) and the same shape in the six languages. A phrase that does not name a file (`without delay`, `text only`, `except don’t cc`) does not authorize a drop. When several files are deselected, each file needs its own phrase. Anything else stays on the review card.

### R10-02 — P2 — The chat warning localizes the status word and leaves the sentence in English

AC-22: the user sees a warning on the surface they are looking at. FR-15: that sentence follows the user’s language.

`sentCopyWarningSentence` loads the locale and then returns one of three English templates:

- “The forward was submitted, but the Sent copy could not be verified (${label}).”
- “The forward outcome is unknown, and the Sent copy could not be verified (${label}).”
- “The forward was rejected by the server, and the Sent copy could not be verified (${label}).”

`label` is the only localized piece (`copy failed`, `复制失败`, and the other tables). A Chinese UI still reads an English sentence. The operation card already uses `emailOrganization.sent_copy_warning`, which is translated in all six language files. The chat function does not.

The replay return is the remaining path with no warning at all. `sendApprovedForward` answers `already_processed` with `priorOutcome` and no `sentCopyStatus`, and `sendEmailForward` returns that envelope before the warning branches. A retry of a send whose copy was unverified does not repeat the sentence. The operation card still has it.

Repair: build the chat sentence from the active locale, including a translated frame for the submitted, unknown, and rejected cases. On `already_processed`, copy `sentCopyStatus` from the stored item and attach the same warning when it is `failed` or `unknown`.

## Remediation status

**Remediated on this branch (commit `435143d8a`), re-read at the production binding.** The audit's verification scenarios are implemented as tests — through the pure check AND the production binding.

| Item | Status | Evidence on the production path |
| --- | --- | --- |
| R10-01 unbound exclusion phrase | **Fixed** | `sentenceExcludesAttachment` binds each exclusion phrase occurrence to the stem that FOLLOWS it within a 48-char window (`without the logo`, `except the invoice`, `除了logo`): the stem must be the object of THAT phrase, whole-word. The audit's exact scenarios pass: `"forward this invoice to finance@example.com now without delay"` + invoice.pdf → **false** (the window after `without` is `delay`, and the stem occurs only BEFORE the phrase, which latin phrases never scan); both invoice.pdf and logo.png deselected with `...without the logo` → logo.png true, invoice.pdf false (one phrase per file); `"except don't cc anyone"` → false. Japanese object-before-particle survives: CJK phrases also scan a short window BEFORE the phrase (`logo.pngを除いて` matches, `invoice.pdfを除いて` does not authorize logo.png) — a before-window on latin would reopen the without-delay hole, so it is CJK-only. |
| R10-02 English frame + replay omission | **Fixed** | `sentCopyWarningSentence` now renders the ACTIVE locale's `sent_copy_warning` template (the same translated frame the card renders through `t()`, all six language files) with the locale's `sent_copy_status` word interpolated — the three English literals are gone. The replay path repeats the sentence: both `already_processed` returns in `sendApprovedForward` (the idempotency-key short-circuit and the create-race return) carry `sentCopyStatus` read from the prior operation's stored item `resultJson`, and the tool attaches the warning on the ALREADY_ATTEMPTED failure envelope and on the succeeded replay (`code: "SENT_COPY_UNVERIFIED"` on the success shape) — no re-send. |

**Verification run on this branch:** `yarn typecheck` 0 errors; `yarn vue-typecheck` 0 errors; binding tests 14/14 (incl. the audit's without-delay and two-file scenarios through the production function); resolver 38/38 (incl. the pure exclusion scenarios); main org suites 11 files / 121 tests; component suite 184/1616; `emailOrganizationJourneys.test.ts` 4/4 re-run at the remediation commit.

**Still open (operator/CI, unchanged):** live test-mailbox validation and Forge packaged proof (`yarn package` stays off developer machines per AGENTS.md).

## Requirement scorecard

| ID | Stage | This pass |
| --- | --- | --- |
| FR-01 | B | Not re-tested against the live catalog. |
| FR-02 | B | One open draft and its current revision are required for every direct forward. The attachment choice is still wrong when an unrelated exclusion phrase shares the sentence with the filename (R10-01). |
| FR-03 | B | Not re-opened. |
| FR-04 | B | Not re-opened. |
| FR-05, FR-06 | B | **Open (R10-01).** |
| FR-07 | B | Review, draft, and negation still block. Direct Trash of one uniquely named sender and direct Undo of one restorable operation still reach the pure check. An addressed forward of the only current draft still skips the card when the attachment exclusion is unbound (R10-01). |
| FR-08 | B | The list Trash button moves the row the user clicked. Chat “delete this” with no sender address stays on review. |
| FR-09 | B | One restorable Trash operation can skip the card, and the id has to be the one the count returned. |
| FR-10, FR-11 | B | Not re-opened. |
| FR-12 | B | **Open (R10-01).** |
| FR-13 | B | Statuses stay distinct. A replay does not repeat the Sent-copy sentence (R10-02). |
| FR-14 | B | List Undo, detail history, the bulk dialog, and the operation card warning are mounted. Keyboard behavior was not re-run. |
| FR-15 | B | The card and the status word follow the locale. The chat sentence frame does not (R10-02). |
| FR-16 | B | Not re-opened. |
| FR-17 | C | Not re-opened. The server page resumes by UID. |
| FR-18 | C | A `selection_id` still cannot take the chat direct path. |
| FR-19, FR-20 | C | Not re-run. |

### Acceptance scenarios this pass can already fail

| ID | Result |
| --- | --- |
| AC-01 | Holds for one open draft, an envelope equal to the named address, every attachment selected, and the sending account equal to the source account. Fails when `invoice.pdf` is deselected on “forward this invoice to finance@example.com now without delay”. |
| AC-02 | Holds in the resolver: review and draft phrases return before `send_now`. |
| AC-03 | “Alice” with no address stays on review. |
| AC-08 | Holds for one restorable Trash operation. |
| AC-12 | A recipient that is not in the sentence stays on review. An unrelated `without` / `except` / `drop` plus the filename does not (R10-01). |
| AC-13 | Holds when the instruction is only in the stored message. An unquoted paste that contains a send phrase is still the trusted text. |
| AC-22 | Holds on the detail toast, the operation card, and the fresh submitted, partial, unknown, and all-rejected tool results. The sentence is English outside the status word, and a replay omits it (R10-02). |

AC-04 through AC-07, AC-09 through AC-11, and AC-14 through AC-21 were not re-executed.

## Verification still required

- `sentenceExcludesAttachment("forward this invoice to finance@example.com now without delay", "invoice.pdf")` must be false.
- The same function with both `invoice.pdf` and `logo.png` deselected, and the text “forward this invoice to finance@example.com now without the logo”, must accept only `logo.png`.
- Re-run the organization Vitest files and `test/e2e/specs/emailOrganizationJourneys.test.ts` at `5fdb1bb41`. Live mailbox and Forge packaging were not run. `yarn package` stays off developer machines.

## Suggested repair order

1. **R10-01** — bind each exclusion phrase to the stem that follows it, and require that link once per dropped file.
2. **R10-02** — use the locale’s full warning sentence, and repeat it on the replay return when the stored copy is unverified.
