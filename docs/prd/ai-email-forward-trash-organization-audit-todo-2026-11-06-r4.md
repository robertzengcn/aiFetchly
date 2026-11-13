# Email forwarding, Trash and organization — fourth audit TODO

- Audit date: 2026-11-06 (Asia/Shanghai).
- Reviewed implementation: `/Users/cengjianze/project/aiFetchly-email-org`, branch `feature/email-forward-trash-organization`, commit **`bb61f6dd1`**.
- Changes reviewed since the preceding report commit: `db6f25c5e..bb61f6dd1`.
- Requirements: [PRD](./ai-email-forward-trash-organization-prd.md), [technical design](./ai-email-forward-trash-organization-technical-design.md).
- Previous report: [third audit TODO](./ai-email-forward-trash-organization-audit-todo-2026-11-06-r3.md). R4 identifiers below are new; T identifiers refer to that report.

## Verdict

**The PRD is not fully implemented. Both Stage B and Stage C still have blockers.** Several previous defects have real fixes, but important boundary cases remain, and some remediation notes describe broader completion than the running paths support. There are **17 grouped findings** below, including missing product journeys and related variants of the same failure pattern.

This was a report-only audit. Application code was not changed. Tests used temporary databases, fake adapters and in-memory composition; one sender probe used a deterministic loopback SMTP fixture, not a real mailbox. No deployment, remote mailbox mutation or local Forge packaging was performed. The feature worktree's CodeGraph tool returned “not initialized”; source and diffs in this worktree were read directly. This report records concrete evidence and remaining validation, not a guarantee that no other defects exist.

## Verification performed

| Check | Observed result |
| --- | --- |
| Main-process feature suites with normal global TypeScript setup | **14 files / 139 tests passed; TypeScript reported zero errors.** |
| Focused renderer suites, including transcript | **5 files / 61 tests passed.** |
| Additional required-behavior regression probes | **19 assertions failed:** forwarding 6, mailbox/recovery/identity 6, search 5, draft lifecycle UI 2. These are reproduced defects, not failures of the existing 200 passing tests. |
| Protocol/provider compatibility, full Playwright journeys, actual process crashes, performance targets | Not established by this audit; open validation tasks below. |

Main command: `yarn vitest --config vite.main.config.mjs run`, selecting `EmailOrganizationIpc.test.ts`; service suites `EmailForwardFlow.service`, `EmailForwardMaterializer`, `EmailMailboxAction.service`, `EmailOrganizationArtifactStore`, `EmailOrganizationCapabilityService`, `EmailOrganizationStageC.service`, `EmailOrganizationStartupService`, `EmailOrganizationToolPolicy`, `EmailOrganizationAiTools`, `ImapEmailMailboxAdapter`; model suites `EmailMessageLocation.model`, `EmailOrganizationOperation.model`, `EmailReceivedMessageSearch` under `test/vitest/main/`.

UI command: `yarn vitest --config test/vitest/main/components/vitest.config.mjs run`, selecting `EmailForwardReviewDialog`, `EmailOrganizationOperationCard`, `EmailOrganizationI18nKeys`, `EmailReceiveDetail`, `AiChatWorkspaceTranscript` tests. The full component suite was not run because this change is documentation only; it remains required when repairing the UI.

Disposable probes were removed after execution. Service probes skipped duplicate global checks where needed; the primary 139-test run used the normal checker. Logs for this session: `/tmp/email-org-r4-main.log`, `/tmp/email-org-r4-ui.log`, `/tmp/email-org-r4-draft-ui-probes.log`, `/tmp/aifetchly-r4-search-probes.txt`, `/tmp/aifetchly-r4-mailbox-probe.json`, `/tmp/aifetchly-r4-mailbox-probe2.json`, and `/tmp/aifetchly-email-forward-{r4,mime-r4,size-r4,sent-r4}-probe-20261106.log`. Temporary log retention is not a release-evidence archive; reproduction scenarios are retained below for permanent tests.

## Recheck of the previous 17 groups

| Previous item | Current assessment |
| --- | --- |
| T01 direct-action permission | Deliberately changed to always retain the permission card. Unsafe shortcut mitigated, but the PRD's no-redundant-confirmation behavior remains unimplemented (R4-12). |
| T02 intent precision/binding | Earlier capability-question and “do not move” examples improved. Contextual follow-ups and supported languages remain incomplete; no trusted exact-payload direct path exists (R4-12). |
| T03 admission/expiry | Revision expiry is now checked at delivery. Edit/discard admission still races; two new probes reproduce failures (R4-01). |
| T04 reconciliation | Operation-kind separation and idempotent already-applied repair added. Recovery does not invalidate pending reply approval (R4-02). |
| T05 restore lineage | No-op exclusion and available UIDVALIDITY comparison added. Missing evidence still fails open, and bulk provenance does not bind current state (R4-03). |
| T06 Trash resolution | Multiple Trash candidates and failed no-op presence checks now fail closed. Writability and capability-aware UI remain incomplete (R4-15). |
| T07 shared coordination | Shared mutex added, but reply admission runs before it is acquired (R4-02). |
| T08 detached bulk | Actual frozen selection now reaches the executor; the fabricated empty version map is fixed. Duplicate outcomes, queue expiry and interrupted pending work remain (R4-04/R4-10/R4-11). |
| T09 search | Single-folder UID offsets added. Local continuation, cross-folder offsets, exact-filter exhaustion and cursor validation still fail (R4-09). |
| T10 duplicate-byte CID | Per-hash occurrence cycling replaces last-entry overwrite; different/repeated HTML order remains wrong (R4-06). |
| T11 composed size | Byte count now persisted and folding allowance added. Actual quoted-printable composition still exceeds the bound (R4-07). |
| T12 outcome honesty | Duplicate-forward prior outcome and initial partial-warning handling improved. Address-level UI detail and Sent-copy warning remain incomplete (R4-08/R4-16). |
| T13 UI journeys | Same-mounted-page saved-draft caller now connected. Navigation/restart recovery and draft retirement are broken; history/bulk journeys absent (R4-13/R4-14). |
| T14 chat/cards | Normal grouped call/result projection now includes operation cards; Cancel uses the active ID. Draft-review/unpaired result and restore-picker paths remain incomplete (R4-14/R4-15). |
| T15 localization | Backend persists locale and localized item-status keys added. Manual create cannot supply locale; several UI keys/messages remain missing/raw (R4-16). |
| T16 Sent-copy | Append API/branch added. Real SMTP sender supplies no raw bytes, so production append is skipped; outcome warning cannot reach UI (R4-08). |
| T17 sync identity | New Message-ID heuristic suppresses legitimate distinct occurrences and does not close all delayed-source races (R4-05). |

## PRD requirement coverage

“Partial” indicates at least one missing acceptance behavior, even when the nominal service exists. “Implemented; validation open” is not release approval.

| FR | Assessment | Blockers / acceptance still needed |
| --- | --- | --- |
| 01 tools/discovery | Implemented; validation open | Real conversational discovery, clarification and review journey; R4-12/R4-14. |
| 02 exact source/account | Partial | Historical restore and occurrence identity; R4-03/R4-05; sender fields R4-17. |
| 03 capabilities/folders | Partial | Writable destination and capability-aware controls; R4-15. |
| 04 create/edit/review | Partial | Dispatch/edit coordination, durable resume, complete review journey; R4-01/R4-13/R4-14. |
| 05 original content | Partial | Reordered/repeated inline references still corrupted; R4-06. |
| 06 approved attachment bytes | Partial | Part/reference ownership and actual encoded-size limit; R4-06/R4-07. |
| 07 direct/review/draft intent | Partial | Redundant confirmation and blocked contextual/localized commands; R4-12. |
| 08 server Trash/convergence | Partial | Replay uncertainty, sync identity and interrupted work; R4-04/R4-05/R4-11. |
| 09 recorded restore | Partial | Current lineage, writable replacement and persistent access; R4-03/R4-14/R4-15. |
| 10 processing/history | Partial | Reply invalidation/coordination and distinct-occurrence loss; R4-02/R4-05. |
| 11 durable operations/restart | Partial | Replay outcome corruption, orphan pending work and missing history UI; R4-04/R4-11/R4-14. |
| 12 exact authorization | Partial | Send admission, restore lineage, queued expiry, trusted direct path; R4-01/R4-03/R4-10/R4-12. |
| 13 uncertainty/partial results | Partial | Unknown MOVE downgraded, absent recipient/Sent-copy detail; R4-04/R4-08/R4-16. |
| 14 chat/mailbox controls | Partial | Durable resume/history/bulk/review and usable destination selection; R4-13–R4-16. |
| 15 six languages | Partial | Manual locale and missing/raw keys/states; R4-16. |
| 16 unattended blocking | Implemented on advertised paths; validation open | Existing entitlement/scheduled guard suites pass; real scheduled full-access journey still needs evidence. |
| 17 scoped search | Partial | Continuations, exact dates/attachments, completeness and cursor ownership; R4-09. |
| 18 frozen targets | Partial | Frozen IDs/versions repaired; expired queued selection can execute and usable review UI absent; R4-10/R4-14. |
| 19 bounded bulk/progress | Partial | Duplicate/restart semantics and renderer flow; R4-04/R4-11/R4-14. |
| 20 cancel unstarted work | Partial | Restart/exception settlement and reachable live controls; R4-11/R4-14. |

## Remediation status (2026-11-07, updated on this branch)

| Group | Status | Notes |
| --- | --- | --- |
| R4-01 dispatch race | **Fixed** — atomic ready→dispatching fence; edits/discard refuse during SMTP; submitted CAS loss recorded as durable audit; probe scenarios covered | `b0011f465` |
| R4-02 reply admission | **Fixed** — account lock spans final admission AND SMTP; reconcile paths invalidate pending replies via surfaced helper | `b0011f465` |
| R4-03 restore provenance | **Fixed** — fail closed without full mapping (uid + uidValidity); lineage binds resulting version + originating op; bulk prepare validates current lineage | `b0011f465` |
| R4-04 duplicate outcomes | **Fixed** — open-operation resolution before preflight; only still-pending items finalize failed on claim refusal | `b0011f465` |
| R4-05 identity heuristic | **Fixed** — replaced Message-ID heuristic with exact moved-away occurrence lookup by before-folder/uid/uidValidity; sync persistence under the account lock | `b0011f465` |
| R4-06 CID order | **Verified fixed by 19e440d2f hash map** (prefers selected; identical bytes render identically) + regression tests for both-selected/single-selected/repeated cases | `19e440d2f` |
| R4-07 composed size | **Fixed** — textEncoding forced to base64, making the persisted bound a true upper bound | `b0011f465` |
| R4-08 Sent bytes | **Fixed** — raw MIME captured via nodemailer's stream plugin on the SMTP session; append sends the submitted bytes; sentCopyStatus projected on the attempt | `b0011f465` |
| R4-09 search | **Fixed** — local keyset continuation with validation; server cursor numeric/range validated; all fetched candidates post-filtered before page fill; timestamps basis disclosed | `b0011f465` |
| R4-10 queued expiry | **Fixed** — selection revalidated after acquiring the account lock (awaited + detached) | `b0011f465` |
| R4-11 orphan pending | **Fixed** — startup + periodic settlement cancels orphaned pending items; detached failures persisted via cancelPending | `b0011f465` |
| R4-12 direct-send | **Recorded PRD deviation** — block-only gate retained deliberately (substring matcher injectable); resolver go-ahead phrases fixed; PRD/AC-01 text update is a product decision for the owner | `b0011f465` |
| R4-13 draft lifecycle | **Partially fixed** — durable resume wired via resumable-draft query; retirement on sent/discarded open | `6c62ed025` |
| R4-14 history/bulk UI | **Partially fixed** — transcript skip-loop cards, history/bulk APIs present; full search→preview→execute journey and Playwright coverage remain open | `6c62ed025` |
| R4-15 destination capability | **Fixed** — writable-only Trash in discovery + fallback; picker filters writable non-Trash, resets selection, LOCATION_STALE not routed to picker | `b0011f465` |
| R4-16 localization | **Fixed** — manual create carries locale; pick/restore, item_status, recipient_outcome and error_code keys localized in six languages; the operation card shows address-level recipient outcomes with te() fallbacks | `b0011f465`, `8bc74a622` |
| R4-17 sender identity | **Fixed** — Reply-To applied to emitted MIME; Sent append resolves from the sending account | `b0011f465` |
| V01/V02 validation | **Open** — operator/CI scope (wire fixtures, Playwright, crash injection, perf, live mailboxes, packaging) | — |

## Detailed grouped TODO

P1 concerns external-action correctness, content, identity or durable recovery. P2 concerns broken required behavior or missing product workflows. Related variants are listed together; repair their shared boundary rather than one fixture alone.

### R4-01 — P1: forward admission still races discard/edit, including during SMTP

Evidence: `src/service/emailOrganization/EmailForwardDeliveryService.ts:387`, `:402`, `:462`; `src/model/EmailForwardDraft.model.ts:83`, `:100`, `:141`.

Moving the last reread after dispatch marking narrows the earlier window but does not make admission atomic. Draft state remains `ready` while SMTP runs. Two deterministic assertions fail: discard commits after the final read obtains its snapshot, yet SMTP runs once and the draft remains discarded; edit commits while SMTP is in flight, SMTP succeeds, then `markSubmitted(oldRevision)` loses its compare-and-set and its boolean is ignored, leaving a newer revision ready to send. A sent payload and an independently sendable draft can coexist.

- [ ] Introduce a revision-bound dispatch admission coordinated with edit/discard; define which operations are permitted after dispatch wins.
- [ ] Treat failed final-state persistence explicitly; do not ignore a rejected submitted-state transition.
- [ ] Permanently test discard/edit around the final snapshot, inside dispatch preparation and during in-flight SMTP, including durable final state and a later send attempt. Old authorization must never authorize revised content.

### R4-02 — P1: reply admission occurs before the shared lock; recovery skips reply invalidation

Evidence: `src/service/emailReply/EmailReplyDeliveryService.ts:992–1002`, `:1020–1028`, `:1053`; `src/service/emailOrganization/EmailMailboxActionService.ts:946–963`, `:1171–1226`.

The reply path performs its final ownership check, then waits for the account lock, whose callback only calls SMTP. Trash can hold that lock, complete a MOVE and invalidate approval before releasing it; the queued reply then sends without rereading approval, draft or location. A large bulk action extends this stale-admission interval. Reply outcome persistence also occurs outside the lock.

Separately, both successful reconciliation repair branches finalize the move without invalidating pending replies. A fault-injection probe reconciled a verified moved message to success while its approved reply's `invalidatedAt` stayed null. The ordinary MOVE invalidation therefore does not cover recovery.

- [ ] Acquire coordination before final reply admission, revalidate after acquiring it, and maintain the necessary boundary through outcome persistence.
- [ ] Perform idempotent reply invalidation on every successful repair path; handle invalidation failure durably.
- [ ] Test paused reply admission versus Trash/restore/reconcile, plus crashes before/after location commit and invalidation. A move that wins must prevent a stale approved send.

### R4-03 — P1: restore fails open without mapping and bulk restore accepts unrelated current state

Evidence: `src/service/emailOrganization/EmailMailboxActionService.ts:759–789`, `:900–915`, `:584–675`; `src/service/emailOrganization/EmailOrganizationSelectionService.ts:145–157`; `src/model/EmailOrganizationOperation.model.ts:365–386`.

Single restore now compares UIDVALIDITY if evidence exists, but null UID/UIDVALIDITY act as wildcards; neither resulting version nor `lastOperationId` is bound. Evidence-write errors are swallowed, making missing evidence a real path. Probe: Trash A → missing A mapping → restore → Trash B → Undo A with a distinct action ID; the old Undo succeeds against B's newer state instead of rejecting stale lineage.

Bulk prepare chooses a historical succeeded Trash's before-folder, then freezes the message's current version without proving it is still that Trash's result. Probe: Trash → restore → later Archive move → prepare bulk restore; preparation succeeds for the Archive message. Comparing the newly frozen version with itself does not validate historical consent.

- [ ] Bind both prepare and execution to the exact current operation lineage, resulting locator and version; fail closed when required mapping is unavailable.
- [ ] Cover single/bulk, consumed history, missing/malformed evidence, external moves, repeated Trash/restore and UIDVALIDITY resets.
- [ ] Assert stale operations cannot move a message simply because an old successful Trash exists.

### R4-04 — P1: duplicate mailbox calls destroy unknown outcomes without new evidence

Evidence: `src/service/emailOrganization/EmailMailboxActionService.ts:214–247`, `:416–459`, `:645–654`; `src/model/EmailOrganizationOperation.model.ts:304–309`. Compare the awaited bulk early return at action service `:553–554`.

Single and detached operation creation discard whether the durable operation was newly created or already existed. Detached start always schedules its loop. A duplicate after an uncertain MOVE reaches an item claim refusal, then finalizes the existing unknown item as failed; the model permits unknown → failed. Two probes each issued exactly one MOVE, initially returned `needs_reconciliation`, then returned failed after the duplicate. No evidence established failure.

- [ ] Return the existing durable outcome before preflight/claim or loop scheduling; distinguish existing operations across every entry point.
- [ ] Allow only appropriate evidence-based resolution of unknown states; claim refusal is not proof of non-dispatch.
- [ ] Test duplicate claimed/unknown/failed/succeeded operations for single and detached Trash/restore. Preserve uncertainty and avoid repeating external work.

### R4-05 — P1: Message-ID heuristic suppresses legitimate mail and leaves delayed identity races

Evidence: `src/model/EmailReceivedMessage.model.ts:555–574`; `src/service/emailReceive/EmailReceiveSyncService.ts:287–303`.

The new obsolete-source lookup treats a same-account RFC Message-ID at an operation-authored verified location in a different folder as proof that another observation is obsolete. It checks no recorded source folder/UID/UIDVALIDITY. A probe moved a message to Trash and observed the same Message-ID in an unrelated `SeparateArchive`: the model returned the moved row instead of recognizing a legitimate independent occurrence. Distinct provider copies can be suppressed.

Missing/unusable Message-ID bypasses the heuristic. An old observation can also finish its lookup before a MOVE, pause, and insert after destination adoption changes the provider key. Persistence is outside account coordination, so the original delayed-source duplicate race is not closed by this precheck.

- [ ] Use exact durable occurrence lineage/tombstones and coherent adoption/insertion coordination rather than RFC Message-ID equality alone.
- [ ] Test legitimate same-ID copies, absent Message-ID, and pauses before/after obsolete lookup and insertion while Trash/restore and destination sync finish.
- [ ] Assert stable logical identity and preserved relationships for actual moves without hiding independent occurrences.

### R4-06 — P1: inline-image selection still depends on reference order

Evidence: `src/service/emailOrganization/EmailForwardMaterializer.ts:515`, `:545`, `:547`.

Per-hash cycling assumes HTML reference order equals MIME attachment order. With identical-byte parts `[logo1, logo2]`, only logo1 selected, reversed HTML order attaches selected bytes to logo2's reference and drops logo1. Repeated logo1 also loses its second reference while excluded logo2 receives selected bytes. Both required-behavior assertions fail. Cycling duplicates does not preserve CID ownership.

- [ ] Preserve original CID-to-part association through parsing; do not reconstruct identity from equal bytes or occurrence count.
- [ ] Test reversed order, repeated references, each individual selection, both/neither, and final MIME/HTML consistency.

### R4-07 — P1: quoted-printable bodies bypass the composed-message size limit

Evidence: `src/service/emailOrganization/EmailForwardMaterializer.ts:340`, `:355`, `:362`; delivery MIME options at `src/service/emailOrganization/EmailForwardDeliveryService.ts:374`.

The improved bound still assumes base64 body expansion. Nodemailer can choose quoted-printable, which expands mixed Latin/Unicode text much more. An actual in-memory composition probe materialized an **8,000,124-byte** UTF-8 source containing repeated `abé`: estimate **22,779,747 bytes**, accepted; actual MIME **33,334,202 bytes**, above the **26,214,400-byte** cap. Persisting the estimate does not make it an upper bound.

- [ ] Measure serialized approved MIME and send those same bytes, or force a validated encoding and prove its full bound.
- [ ] Cover encoding choice, both body alternatives, Unicode metadata, folding, boundaries and selected attachments near/beyond the cap.
- [ ] Assert actual emitted bytes stay within policy and the persisted count matches the admitted composition.

### R4-08 — P2: production SMTP never supplies Sent-copy bytes; warning is not projected

Evidence: `src/service/emailOrganization/EmailForwardDeliveryService.ts:410`, `:455`, `:609`; `src/service/EmailOrganizationAiTools.ts:550`, `:591` and operation DTO/projection.

The sender reads `info.message`, which is available on stream composition but absent from the real SMTP result. A loopback SMTP fixture using the production factory accepted a recipient and returned `raw: undefined`. Consequently the new append branch returns `not_requested`; the passing append test injects bytes production does not provide.

Even with injected bytes, `sentCopyStatus` is stored only in attempt JSON and is absent from delivery/operation DTOs and UI. AC-22's separate warning cannot be shown. See R4-17 for the alternate-sender account mismatch in this branch.

- [ ] Capture/compose real MIME for submission and append under an explicit Sent strategy.
- [ ] Project saved/failed/unknown copy status separately from SMTP acceptance through operation APIs and UI; do not trigger resend.
- [ ] Test production sender factory → loopback SMTP → append failure → visible warning with preserved accepted-recipient state.

### R4-09 — P2: search pagination and exact-filter coverage remain incorrect

Evidence: `src/service/emailOrganization/EmailOrganizationSearchService.ts:123`, `:157`, `:207–214`, `:247`, `:269`, `:279`, `:291`, `:327`; `src/service/emailOrganization/ImapEmailMailboxAdapter.ts:321`, `:340`, `:344`, `:359`; `src/model/EmailReceivedMessage.model.ts:583`.

Five required-behavior assertions fail:

1. Local search ignores cursors and now always returns `nextCursor:null`; a truncated first page cannot be continued.
2. Cross-folder server continuation retains the incoming folder index and increments offset by total returned rows. INBOX `[I1]`, Archive `[A1,A2,A3]`, page size 2 returns `[I1,A1]`, then `[A1,A2]`, rather than `[A2,A3]`.
3. Metadata is fetched only for available page slots before exact filtering. Two rejected date candidates followed by a matching third produce **empty rows, complete:true, cursor:null**. Disappearing/fetch-failed candidates share the omission pattern.
4. Numeric cursor fields lack integer/range/ownership validation. `{folderIndex:999,uidOffset:-3}` is accepted as complete with no searched folders; cursors are not bound to account/query/folder scope.
5. Unknown attachment presence is reported false without a predicate; with a predicate, presence remains null and the requested true/false filtering is unevaluated. A limitation is disclosed, but exact filtering is still missing.

Date prefilter also uses IMAP internal receipt date while returned/postfiltered date uses envelope Date and local display uses parsed Date. One timestamp can exclude a message before the other's exact filter sees it. This is a timestamp-basis mismatch; the installed ImapFlow already widens non-midnight BEFORE, so a simple BEFORE rounding claim would be inaccurate.

- [ ] Implement local keyset continuation with a stable tie-breaker and server cursor tracking the actual folder plus consumed UID position.
- [ ] Bind/validate cursors against source, account, folders and normalized filters; reject invalid state rather than reporting an empty complete search.
- [ ] Scan beyond rejected/missing candidates within budget; preserve resumable incomplete coverage at every bound.
- [ ] Define one received-time basis and make coarse server filtering a safe superset of exact UTC bounds.
- [ ] Evaluate attachment presence or explicitly refuse unsupported exact filtering and offer bounded sync/refinement; keep unknown distinct from false.
- [ ] Test three disjoint pages, cross-folder boundaries, empty/failed folders, exact-filter gaps, changed queries and attachment true/false/unknown.

### R4-10 — P2: queued bulk work can start after selection/approval expiry

Evidence: `src/service/emailOrganization/EmailMailboxActionService.ts:337`, `:364`, `:379`, `:453–459`, `:470`, `:508`; `bulkOne`.

Selection validity is checked before waiting for account serialization. Neither detached nor awaited execution rechecks expiry after queue admission. A selection valid when requested can wait behind account work past its 15-minute expiry and still begin moving messages. This concerns unstarted queued work, not merely a legitimate in-flight operation exceeding TTL.

- [ ] Revalidate selection/authorization at the trusted first-dispatch admission after acquiring coordination; require fresh approval if expired.
- [ ] Test a held account mutex, enqueue near expiry, advance clock beyond TTL, release: zero MOVE calls without fresh authorization.

### R4-11 — P2: interrupted bulk operations can retain permanently pending items

Evidence: `src/background.ts:1870–1895`; `src/service/emailOrganization/EmailMailboxActionService.ts:366–368`, `:410–412`, `:1049–1065`; unused nonterminal-operation recovery query.

Startup sweeps expired attempts, but unclaimed bulk items have no attempts. Detached exceptions only log. Crash before the first claim or between items can therefore leave pending work indefinitely without a live executor. Existing durable pending rows alone do not implement cancel/restart reporting or AC-15.

- [ ] Define and implement restart semantics for nonterminal operations: stop/settle unstarted work or resume only under a valid explicit policy, while reconciling in-flight items without blind replay.
- [ ] Persist detached execution failures as recoverable operation state, not only logs.
- [ ] Test crash before first claim, between items 40/41, during a claim and after cancellation; preserve completed outcomes and leave no unexplained pending work.

### R4-12 — P2: direct-send behavior remains a PRD deviation; ordinary go-aheads/languages are blocked

Evidence: `src/service/AIChatQueryLoop.ts:4372–4383`; `src/service/SkillPermissionService.ts:127`; `src/service/emailOrganization/EmailOrganizationIntentResolver.ts:20`, `:167`, `:215`.

The new block-only design explicitly keeps `organizationSendGateAllowed=false` for direct instructions. Request-scoped tools therefore still ask for confirmation, contrary to PRD §5.1 and AC-01. This is a deliberate safety tradeoff, not completed direct intent.

The resolver also reads only the latest user text. “Send it now” appears in send phrases but fails the earlier topic check because send is not a topic marker, blocking the explicit go-ahead after review. Positive phrases remain English, so ordinary Chinese/Japanese/French/German/Spanish instructions degrade to draft-only. Fixing two English substring examples is not complete intent support.

- [ ] Implement host-owned action/payload-bound authorization with contextual follow-ups and supported languages; do not reintroduce the unsafe unbound boolean shortcut.
- [ ] Test direct commands, capability questions, negation/wait, draft/review, follow-up approval and wrong-tool/wrong-payload calls across supported languages.
- [ ] If retaining mandatory review is the desired product behavior, explicitly change the PRD and acceptance criteria instead of marking AC-01 implemented.

### R4-13 — P2: saved-draft lifecycle is temporary and retains retired draft IDs

Evidence: `src/views/pages/emailreceive/detail.vue:128–133`, `:162`, `:309`, `:350`; `src/views/components/emailOrganization/EmailForwardReviewDialog.vue:237`, `:335`.

Resume now works within the mounted page, but saved IDs live only in a component-local Map. A probe saved draft 77, unmounted/remounted and reopened: `existingDraftId` was null, losing the resume path. Another probe saved 77, submitted it and reopened: `existingDraftId` was still 77 instead of allowing a new forward. Cancellation discards the resumed draft without clearing the page's reference either. Users can be directed back to submitted/discarded content until navigation resets the Map.

- [ ] Discover saved drafts from durable storage after navigation/restart, not an in-memory ID map alone.
- [ ] Retire/reset references on sent/discarded/expired drafts and provide explicit resume-versus-new-forward behavior.
- [ ] Add save → remount/restart → resume, save → send → new forward, save → cancel/discard → reopen and expiry recovery tests with real parent/child event wiring.

### R4-14 — P2: persistent history, bulk selection and chat draft review journeys remain absent

Evidence: definition-only renderer APIs `src/views/api/emailorganization.ts:262`, `:271`; detail page operation refs at `:167–169`; `src/views/components/aiChatWorkspace/AiChatWorkspaceTranscript.vue:216–233`, `:493–540`.

Operation-list and background-start APIs still have no renderer consumers. Users cannot browse durable operation history/Trash to restore after navigation/restart or complete a search → exact frozen selection → preview → execute/cancel flow. Backend selection previews are now authoritative, but no complete product flow displays/approves them.

The normal grouped operation card is fixed; however the unpaired-result branch lacks organization-card projection, and create-forward-draft results have no interactive forward review card. Mailbox forwarding only exposes a truncated text preview with no full-body inspection route. These remain required review/access journeys rather than protocol-validation tasks.

- [ ] Connect durable history/Trash, ongoing-operation recovery and persistent Restore/reconcile controls.
- [ ] Implement scoped search/selection/preview/bulk progress/cancel with exact affected messages, folders, versions, coverage and expiry visible.
- [ ] Render forward review cards and unpaired/historical organization results; provide access to the complete approved content beyond preview truncation.
- [ ] Add corresponding component tests and Playwright journeys. None of the detail/card/transcript behavior changes since the previous report added tests to those component files; only the locale-key suite changed.

### R4-15 — P2: destination capability and replacement-folder controls still accept unusable choices

Evidence: `src/service/emailOrganization/EmailOrganizationCapabilityService.ts:86–90`; `src/service/emailOrganization/EmailMailboxActionService.ts:1304–1307`; `src/views/pages/emailreceive/detail.vue:171`; `src/views/components/emailOrganization/EmailOrganizationOperationCard.vue:346–351`, `:377–388`.

Capability discovery and the default action resolver select a single Trash folder without checking `writable`. Mailbox action availability is merely “message loaded,” so unsupported accounts still offer actions. The replacement picker removes Trash only, ignores writable destinations, retains previous selection, and opens for `LOCATION_STALE` as though changing destination could cure invalid Undo lineage. The detail-page shortcut also replaces the active operation with a failed restore result rather than routing missing-destination handling through the card.

- [ ] Apply a common capability/writability policy to discovery, preview and execution; show actionable disabled states for unsupported operations.
- [ ] Offer only valid writable replacement destinations, reset stale picker state, and distinguish missing destination from stale operation lineage.
- [ ] Exercise both page and card Undo paths for removed/read-only folders, POP3, ambiguous Trash, stale operation and keyboard-only selection.

### R4-16 — P2: localization and result detail remain incomplete

Evidence: `src/views/api/emailorganization.ts:95–105`; `src/schemas/ipc/emailOrganization.ts` create schema; `src/views/components/emailOrganization/EmailForwardReviewDialog.vue:176`, `:249`, `:108`; operation card `:212–216`, `:289–306`, `:381`; detail page `:314`, `:333`; six locale files.

Backend draft locale persistence is fixed, but manual create has no locale in the renderer payload/schema/IPC path and the dialog sends none, so generated content defaults to English. `pick_restore_folder` and `restore_button` are used but absent in all six language files. Partial recipient sentences, prior-outcome enums, validation findings/error codes and picker errors remain raw English/internal values. `te()` fallback was added for item status but not the dynamic operation title, so uncovered states still show keys.

The operation card displays only recipient counts, not the accepted/rejected/unknown addresses needed for AC-18; mailbox item rows lack identifiable message summaries. Users cannot inspect which recipient/item failed from those counts alone.

- [ ] Carry the active locale through manual creation, schema and IPC; retain it on edits.
- [ ] Supply all missing keys and localize dynamic states/findings/errors in en/zh/es/fr/de/ja; exercise runtime states rather than key presence alone.
- [ ] Show private address-level recipient results and identifiable affected-message rows, preserving Bcc privacy.
- [ ] Add multilingual rendering and keyboard/error-state tests for partial/unknown/failed outcomes and replacement-folder UI.

### R4-17 — P2: configured sender identity is not fully applied to MIME and Sent copy

Evidence: `src/service/emailOrganization/EmailForwardDeliveryService.ts:366–379`, `:411–418`; technical design §9.3.

The frozen Reply-To is hashed/rechecked, but `mailOptions` never sets `replyTo`, so a sending account with a Reply-To different from From loses that identity in the forwarded MIME. The new Sent append branch also resolves receive settings from the source message's account, although a revision may use another `sendingAccountId`; once raw bytes are available, the copy can be stored in the wrong account.

- [ ] Apply the approved Reply-To to the emitted MIME and resolve Sent strategy from the sending account with explicit capability handling.
- [ ] Test different From/Reply-To values and source account A → sending account B; inspect actual headers and append target.

## Acceptance scenarios still requiring completion

| AC | Current blocker or unperformed evidence |
| --- | --- |
| 01 direct forward | Redundant gate/context handling, R4-12; full chat submission evidence open. |
| 02 draft/review only | No forward review-card journey, R4-14; verify no SMTP through real UI flow. |
| 03 ambiguous contacts | Real conversation clarification/no guessed address still needs end-to-end evidence. |
| 04 PDF + inline image | Reordered/repeated CID failure, R4-06. |
| 05 missing/oversized attachments/content | Actual composed-size cap fails, R4-07; wire fixtures open. |
| 06 same UID across folders/accounts | Exact-locator mechanisms exist; concurrency/provider fixtures and identity repair R4-03/R4-05 remain. |
| 07 UIDVALIDITY reset | Ordinary comparison improved; missing restore evidence still fails open, R4-03. |
| 08 Trash then Undo | Nominal path exists; lineage and durable access R4-03/R4-14 remain. |
| 09 unsupported provider/POP3 | Capability-aware UI/writability R4-15; approved-provider fixtures open. |
| 10 post-dispatch disconnect | Unknown MOVE can be downgraded by duplicate call, R4-04. |
| 11 duplicates/concurrent calls | Forward admission and mailbox replay defects, R4-01/R4-04. |
| 12 changes after approval | Revision/edit admission and queued expiry, R4-01/R4-10. |
| 13 hostile email content | Mandatory prompt mitigates old direct bypass; contextual trusted authorization acceptance still open, R4-12. |
| 14 changed bulk search | Frozen executor repaired; provenance/search/queued expiry/UI gaps, R4-03/R4-09/R4-10/R4-14. |
| 15 cancel/restart at item 40 | Orphan pending work and UI, R4-11/R4-14. |
| 16 removed restore folder | Both page/card paths and valid replacement choices incomplete, R4-15. |
| 17 remote success/local failure | Idempotent location repair added; reply invalidation recovery still fails, R4-02. |
| 18 partial recipient acceptance | Backend envelopes improved; per-address localized results and safe new authorization journey incomplete, R4-16. |
| 19 disabled/scheduled full-access | Focused guards pass; full real entry-point evidence remains open. |
| 20 languages/keyboard | Missing keys/messages and untested changed interactions, R4-15/R4-16. |
| 21 uncertain legacy provenance | Baseline guards exist; execute migrated/provider-reset fixtures before release. |
| 22 SMTP success/Sent append failure | Production bytes and separate warning missing, R4-08/R4-17. |

## Verification and release TODO

- [ ] Turn the 19 reproduced assertions and source-confirmed competing-path scenarios into permanent regression tests in the same commits as their repairs. Test real caller boundaries, not only isolated helpers or fake properties production never returns.
- [ ] Run the full required component suite after UI changes and add Playwright coverage for direct/review forwarding, durable draft resume, history/Restore, bulk preview/progress/cancel and localized keyboard operation.
- [ ] Add deterministic protocol fixtures for complete source/MIME retrieval, safe MOVE mapping, disconnect before/after dispatch, UIDVALIDITY reset, partial SMTP acceptance and Sent append. Record approved test-account compatibility separately.
- [ ] Fault-inject crashes at claim/dispatch/provider result/evidence/location/item/invalidation boundaries and before/between bulk claims. Demonstrate zero wrong-message moves and blind duplicate submissions in the defined suite.
- [ ] Measure acknowledgement/progress under 1 second, local-search p95 on the 10,000-message fixture/hardware, bounded scan/materialization responsiveness and stop-next-item cancellation within 1 second. No performance claim was verified here.
- [ ] Verify privacy/retention with deterministic clocks and filesystems: all-revision discard, expiry before cleanup, app-open sweep, crash-left artifacts and encrypted content. Confirm diagnostics counts/export through the explicit support workflow; a renderer API definition alone is not a support integration.
- [ ] Correct earlier blanket “Fixed” claims against the current callers and regression results. Record any deliberate product changes, especially mandatory confirmation, in the PRD before marking its conflicting acceptance conditions complete.
- [ ] Stage B requires AC-01–AC-13 and AC-16–AC-22; Stage C additionally requires AC-14/AC-15 plus pagination/filter/limit/cancellation evidence. Passing the current 200 tests is not those release gates.
- [ ] Keep packaged-delivery validation in operator/CI infrastructure. Project instructions forbid local `yarn package`, `yarn make` and equivalent Forge packaging.

Suggested repair order: admission/coordination/lineage and replay (R4-01–R4-05), MIME correctness/limits (R4-06/R4-07), queued/restarted bulk safety (R4-10/R4-11), then search/Sent/identity and complete renderer journeys (R4-08/R4-09/R4-12–R4-17). Recheck related single/bulk/recovery/UI paths together before marking each group complete.
