# Email forwarding, Trash and organization — second audit TODO

- Audit date: 2026-11-05 (Asia/Shanghai).
- Reviewed implementation: `/Users/cengjianze/project/aiFetchly-email-org`, branch `feature/email-forward-trash-organization`, commit `307f79d41`.
- Specification: [PRD](./ai-email-forward-trash-organization-prd.md); [technical design](./ai-email-forward-trash-organization-technical-design.md).
- Previous branch checklist: [reconciled TODO](./ai-email-forward-trash-organization-todo.md). This new report preserves that document rather than overwriting it.

## Verdict

**Not all requirements are complete. Neither Stage B nor Stage C is ready for release.** The branch now has substantial implementation: dedicated tools, entities/modules, native MOVE adapter, forwarding, encrypted artifacts, frozen selections, bulk actions, cancellation and mailbox components. The previous five baseline defects have code fixes and regression coverage. The earlier environment failures are not reproduced by this branch's focused tests.

However, passing the present suites does not establish the PRD's acceptance conditions. There are incorrect MIME results, stale authorization/location races, unsafe restore provenance, broken crash recovery, inaccurate search and missing user journeys. The reconciled checklist's blanket “Done” claims for FR-02–15 and FR-17–20 need qualification against the issues below.

Scope: source review of organization implementation and its receive/reply/chat integration; existing targeted tests; temporary deterministic regression probes. No production mailbox actions, deployment, packaging or application fixes were performed. The feature worktree has no CodeGraph index; structural discovery in the original worktree does not represent the feature implementation, so this audit used direct reads in the implementation worktree. This is not a guarantee that no other defects exist.

## Verification performed

| Check | Result |
| --- | --- |
| Normal main-process run with global TypeScript setup, 12 feature suites | **12 files / 114 tests passed**; TypeScript reported zero errors. No typecheck bypass flags. |
| Focused component run: forward dialog, operation card, i18n keys, received-message detail | **4 files / 25 tests passed**. |
| Audit-only MIME probes using in-memory source/artifact fixtures | **4 required-behavior assertions failed**: plaintext missing from HTML, selected inline CID image reference removed, nonexistent selected attachment silently omitted, quoted original Subject rewritten. |
| Audit-only saved-draft reopening component probe | **1 required-behavior assertion failed**: reopen called create twice rather than resuming the saved draft; 6 existing copied tests passed. |
| Real-provider, wire-level protocol, full UI/Playwright, performance and crash-process validation | Not run; still open. Local packaging is forbidden by AGENTS.md. |

Main command: `yarn vitest --config vite.main.config.mjs run` with `EmailOrganizationIpc.test.ts`; service suites `EmailForwardFlow`, `EmailMailboxAction`, `EmailOrganizationArtifactStore`, `EmailOrganizationCapabilityService`, `EmailOrganizationStageC`, `EmailOrganizationStartupService`, `EmailOrganizationToolPolicy`, `ImapEmailMailboxAdapter`; model suites `EmailMessageLocation.model`, `EmailOrganizationOperation.model`, `EmailReceivedMessageSearch`. Service/model tests are under `test/vitest/main/{service,modules}/`.

UI command: `yarn vitest --config test/vitest/main/components/vitest.config.mjs run` with `EmailForwardReviewDialog.test.ts`, `EmailOrganizationOperationCard.test.ts`, `EmailOrganizationI18nKeys.test.ts`, `EmailReceiveDetail.test.ts`.

Temporary regression probes were removed after execution. Their exact failure scenarios are retained below as permanent-test tasks. Existing passing tests were not changed to suppress failures.

## Requirement-by-requirement coverage

“Partial” means implementation exists but acceptance is blocked by a concrete issue or an absent required flow. “Implemented / validation open” does not mean verified release-ready.

| FR | Status | Blocking issues / remaining acceptance |
| --- | --- | --- |
| 01 tool discovery | Implemented / validation open | Dedicated tools registered and policy tests pass; real chat journeys and review-card routing absent (R12). |
| 02 exact message/account | Partial | Post-move identity/sync races, stale restores and ambiguous Trash selection (R05–R08). |
| 03 capabilities/folders | Partial | Ambiguous/read-only Trash and capability presentation/configuration gaps (R08/R12). |
| 04 editable, inspectable forward | Partial | Original content defects, invisible Bcc, saved draft cannot reopen, limited preview (R01/R10/R11). |
| 05 complete original | Partial | Plaintext/CID corruption; unsupported-content coverage still needs protocol fixtures (R01/R15). |
| 06 actual approved attachments | Partial | Unknown part silently omitted and source-wide limit applied before selection (R02). |
| 07 direct/review/draft intent | Partial | Trusted intent resolver is unwired; unconditional fresh confirmation fails no-redundant-confirmation cases (R03). |
| 08 server Trash/local convergence | Partial | MOVE exists; recovery, sync identity and no-op evidence fail acceptance (R04–R08). |
| 09 restore | Partial | Stale/no-op provenance and missing alternate-destination/persistent restore controls (R06/R12). |
| 10 preserve history/processing | Partial | Duplicate occurrence identity and reply/move races (R05/R07). |
| 11 durable operations/restart | Partial | Evidence erased, invalid recovered locator, startup lease gap, stale send reservation (R04/R07/R09). |
| 12 trusted exact authorization | Partial | Revision/discard race and old-operation restore race; bulk set not inspectable (R06/R09/R13). |
| 13 uncertainty/partial delivery | Partial | MOVE reconciliation misapplied to SMTP, false success envelopes and partial-result UI (R04/R10). |
| 14 chat/mailbox controls | Partial | Persistent history/restore, chat cards, bulk controls, progress and keyboard gaps (R11–R14). |
| 15 six-language UI | Partial | Keys exist in six languages; raw operation states/errors and generated header text remain (R14). |
| 16 unattended side effects | Partial | Scheduled hard-block tools tested; service-level trusted scheduled-origin enforcement still required (R03). |
| 17 scoped local/server search | Partial | Exact filters, dates, flags, completeness and pagination problems (R15). |
| 18 frozen targets | Partial | Frozen IDs/versions exist; preview omits actual rows and destinations (R13). |
| 19 bounded bulk | Partial | Limits/loop exist; cross-operation account serialization and usable bulk UI/progress missing (R07/R12/R13). |
| 20 cancellation | Partial | Durable flag exists; operation ID/progress unavailable until synchronous completion and restart recovery incomplete (R04/R12). |

## Bugs and incomplete work — grouped by shared failure pattern

P1 blocks release because it can affect external action correctness, content, or recovery. P2 blocks the corresponding promised workflow or usability acceptance. Related variants are collected together to avoid fixing only one occurrence.

### R01 — P1: forwarding corrupts original visible content and headers

Evidence: `src/service/emailOrganization/EmailForwardMaterializer.ts:175–192`, `:292–305`, `:325–352`; shared `src/service/emailReceive/EmailHtmlSanitizer.ts` scheme filtering.

- Plaintext-only source: `originalHtml` is null, `stripRemoteImages` converts it to an empty string, and `buildHtmlBody` uses nullish fallback. Empty HTML wins over escaped original text. Delivery sends both text and HTML, so HTML-preferring recipients see quoted headers but lose the original body.
- Selected inline CID image: shared sanitizer strips `cid:` from the original image's `src`, while the selected image remains attached. The forwarded HTML no longer references its actual image.
- Quoted `Subject:` uses the outgoing edited/Fwd-prefixed subject rather than `parsed.subject`. An edited outgoing subject falsifies the quoted original header.
- All three families were reproduced by fixture-only assertions; four failures include the attachment-reference case in R02.

Tasks:
- [ ] Preserve null/no-HTML semantics or explicitly fall back on empty HTML; ensure both MIME alternatives contain the original supported body.
- [ ] Use forward-specific HTML sanitization that retains only verified selected CID references and blocks remote images/active content. Do not loosen general incoming HTML sanitization blindly.
- [ ] Build original From/Date/Subject/To headers from original parsed headers; keep outgoing subject separate.
- [ ] Add permanent tests for plaintext, multipart alternative, selected/unselected inline image, remote tracking image, edited subject and original header integrity. Inspect composed MIME, not just draft text/manifest. FR-04–06; AC-04.

### R02 — P1/P2: attachment selection can silently lose required files or reject valid text-only forwards

Evidence: `EmailForwardMaterializer.ts:120–157`.

- Syntax-valid but nonexistent selected ID (for example `part-99`) passes validation and materialization returns zero selected files. Reproduced: expected refusal, received a successful empty attachment selection.
- Total attachment count/decoded bytes are checked over every source part before applying `none` or a subset. A message containing >20 parts or >15 MiB of excluded attachments cannot be explicitly forwarded text-only or with a valid small subset (within the separate raw-source bound).

Tasks:
- [ ] Resolve every approved part ID against the fresh complete source; missing or changed selected parts must refuse, never silently disappear.
- [ ] Apply outgoing count/decoded-byte limits to selected parts. Keep independently documented bounded source/parsing limits and enforce composed/provider limits separately.
- [ ] Test all/none/subset with excluded oversized attachments, unknown IDs, changed part contents/order, exact byte/hash correspondence and composed size. FR-06; AC-04/05/12.

### R03 — P2 correctness gap: trusted direct-action intent is not wired end to end

Evidence: `EmailOrganizationIntentResolver.ts` has no execution integration; `SkillPermissionService.ts:127` always prompts for `request_scoped_action`; `AIChatToolApprovalPolicyService.ts:67` always refuses generic auto-approval. Registry descriptions and prompts instruct the model when to send, but do not establish trusted current-turn intent.

Tasks:
- [ ] Bind exact selected account/message/recipient/content to trusted user-turn intent and issue authorization in the main process. Explicit unambiguous “forward now” and selected-message “delete” must execute without an unnecessary second confirmation; review/draft/negation must override send language.
- [ ] Keep generic full-access insufficient for unrelated mutations. Test all PRD §5.1 examples through actual executor/query-loop flows, including changed payload and ambiguous Alice.
- [ ] Thread trusted scheduled origin into organization execution services and deny it there before any dispatch. Current tool denylist coverage is useful but is not the second service-level guard required by FR-16/design §8.3. Do not trust a model-supplied origin or rely only on a TypeScript string union. AC-01/02/03/13/19.

### R04 — P1: recovery loses evidence, creates invalid locations and can falsely resolve SMTP uncertainty

Evidence: `EmailMailboxActionService.ts:806–925`, `EmailOrganizationOperation.model.ts:335–343`, `background.ts:1868–1882`.

- Expired-claim recovery calls `finalizeItem` without result evidence. Model defaults absent `resultJson` to null, erasing the destination mapping previously saved by `recordAttemptEvidence` after successful remote MOVE.
- Recovery reads only destination UID, ignores saved destination UIDVALIDITY, and writes `uidValidity: null` with `state: "verified"`. It checks source absence without proving destination presence/current validity. A “successful” recovered message subsequently fails forward/restore location validation.
- `reconcileOperation` has no kind guard. Passing an unknown forward operation through the shared reconcile IPC uses MOVE logic; the normally still-present original email can cause an uncertain SMTP submission to be marked `NETWORK_BEFORE_DISPATCH`/failed. Source presence does not prove SMTP did not accept the forward.
- Startup only sweeps claims already expired at that moment. Restart before lease expiry can leave an operation running indefinitely; there is no later expiry sweep or automatic evidence reconciliation.

Tasks:
- [ ] Preserve append-only remote attempt evidence; omitted result fields must not overwrite known evidence with null.
- [ ] Reconcile MOVE using full before/after locator tuples with current server observations; persist real UIDVALIDITY and remain unknown on ambiguous evidence.
- [ ] Dispatch reconciliation by operation kind. SMTP unknown must remain unknown unless SMTP/Sent/provider evidence resolves it; never infer non-submission from the original source mailbox.
- [ ] Schedule startup and ongoing lease recovery/reconciliation, including future expiries and pending items. Reload durable status; never replay uncertain actions blindly.
- [ ] Fault-inject after remote MOVE/mapping persistence and before local commit, restart before/after expiry, then restore after recovery. Test forward disconnect followed by Check status; prohibit false failure or repeat submission. FR-11/13; AC-07/10/15/17.

### R05 — P1: move and receive sync split one email into duplicate local identities

Evidence: `EmailMailboxActionService.ts:678–686`; `EmailReceivedMessage.model.ts:77–81`; `EmailReceiveSyncService.ts:218–221,295,348–354`; `EmailMessageLocation.model.ts:65–100`.

MOVE changes `email_message_location`, but leaves the received row's folder-scoped `providerUid` on the old location. Syncing the destination upserts a second received-message ID and encounters the existing verified location tuple. History/conversation links split instead of converging to the stable original ID. An in-flight old-source sync can also overwrite the newly moved locator because sync upsert has no expected-location-version/operation fence.

- [ ] Maintain stable message occurrence identity atomically across received row, locator and operation evidence. Adopt exact verified destination occurrences before inserting; do not merge unrelated copies by RFC Message-ID.
- [ ] Fence sync observations against newer move/location versions and preserve operation provenance.
- [ ] Integration tests: Trash→sync Trash→restore→sync original folder yields one stable ID/history; pause old-source sync across a move and verify it cannot revert the locator. FR-08/10; AC-06/08/17.

### R06 — P1: stale Undo and no-op Trash invent or overwrite restore provenance

Evidence: `EmailMailboxActionService.ts:120–162,529–546,585–638`; `EmailOrganizationOperation.model.ts:374`.

- Restore uses an old Trash record's original folder but moves whatever verified location the message currently has. It never binds current locator/version/`lastOperationId` to that prior operation's actual after-location.
- Example: Trash A→restore→later move/Trash B→Undo A can mutate the newer state with obsolete intent.
- Already-in-Trash returns a no-op from cached location without a live presence/UIDVALIDITY check. Both single restore and the bulk provenance query accept no-op as successful origin history. A repeated Trash no-op records Trash itself as the “original” folder and can mask the genuine move for later restore.

- [ ] Require the referenced successful genuine move and its exact after-locator/current operation lineage. Reject stale Undo after intervening location change; carry causal operation IDs per bulk item.
- [ ] Live-verify no-ops. A no-op must never create or replace original-folder provenance. Preserve the latest genuine still-applicable Trash move.
- [ ] Tests: old Undo after restore/re-trash, repeated Trash then bulk restore, source externally removed, and stale UIDVALIDITY. FR-09/12/18; AC-08/12/14/16.

### R07 — P1: account/message writes and reply admission are not serialized across operations

Evidence: `EmailMailboxActionService.ts:349–375,703–720`; `EmailOrganizationOperation.model.ts:214–286`.

Only each bulk loop is sequential. Independent operations claim different operation-item rows and can concurrently mutate the same account/message. The version fence comes after remote side effects. Reply approval invalidation happens after MOVE; failures are swallowed, with no shared reservation against reply final admission.

- [ ] Add a shared account dispatcher and exact message/location reservation spanning preflight→claim→external I/O→result persistence. Coordinate with reply admission using a consistent lock/transaction order.
- [ ] Invalidate stale pending reply authorizations under the coordinated admission rules, while preserving submitted history. Surface invalidation/repair failures durably.
- [ ] Test overlapping bulk sets, single vs bulk, two same-message actions, reply vs MOVE and sync vs MOVE. Assert serialized remote dispatch and zero wrong-target/repeated effects. FR-10/11; AC-11/17; PRD §8/12.

### R08 — P1/P2: Trash resolution guesses the first special-use folder

Evidence: `EmailOrganizationCapabilityService.ts:84–85`; `EmailMailboxActionService.ts:981`; adapter folder writable derivation.

`.find(specialUse === "\\Trash")` silently chooses the first of multiple advertised Trash folders. Resolution does not require the advertised folder to be writable; `!\\Noselect` is not ACL write evidence. There is no persistent user-selected Trash fallback for absent/ambiguous special-use metadata. Detail/list actions also ignore capability results and enable unsupported actions until a backend error.

- [ ] Fail closed on ambiguity; offer valid folder selection and persist account-specific choice. Validate actual writable destination and native MOVE/mapping eligibility before dispatch.
- [ ] Reflect separate source-fetch/SMTP/Trash/restore capabilities and actionable reasons in UI. POP3 and unsupported accounts must preserve source content.
- [ ] Fixtures: two special-use Trash folders, absent Trash, read-only folder, capability changes and POP3. FR-03; AC-09.

### R09 — P1: edit/discard can win while a consumed approval still sends old content

Evidence: `EmailForwardDeliveryService.ts:141–154,199,347–348,385`; `EmailForwardDraftService.updateDraft` and `discardDraft`; `EmailForwardDraft.model.ts:appendRevision`.

Delivery checks revision/status once, consumes authorization, then awaits audits, claim, account/locator and artifact reads. An edit can append a new revision or discard can change state during these awaits. Delivery has no atomic revision/status reservation or final coordinated recheck before SMTP. Its later failed conditional `markSubmitted` is ignored.

- [ ] Atomically reserve current draft/revision/status with the operation claim; coordinate edits/discard with this reservation. Old authorization must not send after a winning edit/discard.
- [ ] Final admission must verify the frozen revision and handle conditional submit projection failure as a durable consistency issue.
- [ ] Pause artifact read after approval, edit/discard, release, and assert zero old-content SMTP dispatch; test the inverse ordering without duplicate submission. FR-07/11/12; AC-11/12.

### R10 — P1/P2: partial, failed and duplicate outcomes are reported as success

Evidence: `EmailForwardDeliveryService.ts:351–420`; `EmailOrganizationAiTools.ts:sendEmailForward`, `moveEmailToTrash`, `restoreEmail`; `src/views/pages/emailreceive/detail.vue:306–327`.

Delivery persists partial/failed recipient states but returns `status: "submitted"` for every non-unknown result after SMTP, including all-rejected. The detail page turns submitted into generic success without showing accepted/rejected recipients. `already_processed` also says already submitted even when the prior operation failed or is unresolved. AI tool wrappers unconditionally return `success: true` after a returned failed/partial/unknown action, contradicting the PRD result contract.

- [ ] Distinguish full acceptance, partial acceptance, definitive failure, unknown and duplicate-existing-state in DTOs and tool envelopes. Return top-level success only for verified complete success.
- [ ] Show individual recipient results and retry eligibility; accepted recipients must never be included in a blind retry.
- [ ] Mount the forward operation card on results and retain its operation ID. Test mixed, zero accepted, unknown, duplicate failed and duplicate running outcomes through service→tool→UI. FR-13; AC-10/11/18/22.

### R11 — P2: “Save draft” has no resume path; review omits approved recipients/content

Evidence: `EmailForwardReviewDialog.vue:200–228,277–284`; `detail.vue:332–335`; `EmailForwardDraftService.ts:ForwardDraftPreview,toPreview`; renderer `ForwardDraftPreviewDto`.

Reopening Forward always calls `createForwardDraft`. The emitted saved ID is ignored by the parent; no draft-ID prop/resume journey exists. The message says reopen to review/send, but a new draft is created and the saved recipients/note are not resumed. Reproduced by saving and reopening: create called twice. The preview DTO excludes Bcc even though AI/tools can populate it; private review cannot inspect all approved recipients. The body preview is silently sliced to 4,000 characters with no way to inspect the remainder, and the dialog does not display validation findings.

- [ ] Add saved-draft discovery and explicit draft-ID reopening; load persisted current revision and initialize To/Cc/Bcc/note/selection correctly. Never replace saved user edits with a new draft silently.
- [ ] Include Bcc in private review, with edit controls or a clear complete recipient summary; keep it out of visible forwarded headers.
- [ ] Provide full reviewable content or an explicit expandable/full preview, and show validation/excluded-content findings. Do not imply the truncated preview is the whole email.
- [ ] Add save→close→reopen→send, restart→resume, Bcc and long-source tests. FR-04/14; AC-02/12/20.

### R12 — P1/P2: durable storage has no persistent history/restore journey, chat cards or usable bulk progress/cancel UI

Evidence: both organization components are imported only by `src/views/pages/emailreceive/detail.vue`; `detail.vue` keeps active/last-Trash operation IDs only in `ref`s; `EmailOrganizationOperationCard.vue:load,onUndo`; `emailOrganization-ipc.ts` exposes operation-get by known ID but no history listing. Mailbox actions await service completion before returning operation IDs.

- Navigating away/restarting loses the Undo reference. Row Trash discards the returned operation ID and does not offer Undo/history. There is no Trash/history view that discovers persisted operations for Restore.
- Chat has generic tool output but no integration of the promised forward review/organization operation controls. Review-first lacks the dedicated inspectable send flow in chat.
- Bulk search/selection/restore/cancel APIs are not connected to mailbox selection/preview controls. The operation card has no Cancel control, no polling/subscription and no intermediate-progress update.
- Mutation IPC/tools wait for the entire bulk loop before returning its operation ID. Without an early ID, the originating UI/chat cannot monitor or cancel that operation while it runs.
- Undo in the operation card reloads the original Trash operation after restore, leaving stale “Moved to Trash” and Undo rather than switching to the restore outcome.
- Removed original restore folder can be overridden through APIs, but no UI lets the user choose a replacement valid destination.

Tasks:
- [ ] Add persistent account/message operation history and Trash/Restore discovery after navigation/restart, with recorded original destination and retention explanation. Preserve IDs/results for row actions and forwards.
- [ ] Wire chat review and status cards, plus mailbox bulk selection/preview, restore destination picker and keyboard controls.
- [ ] Return a durable operation ID promptly, execute through a managed asynchronous dispatcher, publish per-item progress and enable cancellation of unstarted work. Keep cancellation distinct from undoing completed items.
- [ ] Update cards to the actual restored operation; prevent stale Undo; expose resolved unknown outcomes. Add route/history/restart/bulk-cancel E2E tests and component action-wiring tests. FR-09/11/14/19/20; AC-02/08/15/16/20.

### R13 — P1: frozen-selection “preview” does not show the actual approved message set

Evidence: `EmailOrganizationSelectionService.ts:228–241`; `SelectionPreviewDto` and `prepare_email_selection`.

The selection stores IDs/versions/destinations, but returns only selection ID, count, account, hash, expiry and caller-authored filters summary. It omits authoritative message IDs, subjects, senders, current folders and per-item restore destinations. A count/hash is not an inspectable resolved-set preview. Prior search output cannot prove the exact stored selection or restore destinations.

- [ ] Return typed authoritative per-item preview from the persisted selection and verified message/location records. Include inferred-classification and scope/coverage limitations with clear provenance.
- [ ] Bind user approval to this exact displayed payload/version and expiry; a changed set/account/destination requires new review. Render it in chat/mailbox before predicate-based bulk execution.
- [ ] Test preview→new arrivals excluded, stale versions individually rejected, changed payload cannot reuse approval, mixed original restore destinations, and trusted explicit selection bypassing unnecessary predicate review. FR-18/19; AC-12/14.

### R14 — P2: keyboard accessibility and complete state localization remain unfinished

Evidence: `src/views/pages/emailreceive/list.vue:103–125` uses clickable `v-icon` for new actions without button semantics/tabindex/keyboard handlers; `EmailOrganizationOperationCard.vue:itemSummary,statusLabel`; materializer forwarded-header generation.

- New row Forward/Trash actions are mouse handlers on icons, not keyboard-operable controls. Existing tests stub Vuetify and do not prove actual focus behavior.
- Per-item statuses and error codes are displayed raw; the card can say “Moved to <destination>” for failed/pending items merely because intended destination is populated. User-facing server messages/limitation text are English.
- `t(key) || fallback` does not handle missing vue-i18n keys (a missing key is a nonempty string); dynamic operation states need complete keys or explicit existence checks.
- Forwarded separator/header generation is hardcoded English, despite translated separator requirement in the design. Six-language key parity alone does not prove all visible text/states are translated.

- [ ] Replace icons with labeled semantic buttons; verify Tab/Enter/Space, dialog focus and screen-reader labels in actual Vuetify components.
- [ ] Translate all visible state/error/limitation text and generated separator where required in en/zh/es/fr/de/ja. Describe intended destination separately from a verified completed move.
- [ ] Test pending/claimed/partial/cancelled/unknown/failure states and all six languages, plus keyboard-only row→review→send/cancel→restore. FR-14/15; AC-20.

### R15 — P1/P2: server search broadens requested filters, misreports coverage and cannot paginate

Evidence: `EmailOrganizationSearchService.ts:206–240,257–275`; `ImapEmailMailboxAdapter.ts:278–279,311`; search input/result contracts.

- Server path ignores `hasAttachments` and hardcodes returned `hasAttachments: false`. A successful result can include messages that fail the requested attachment predicate.
- UTC timestamp bounds are forwarded to day-granularity IMAP SINCE/BEFORE without exact local timestamp filtering. Timezone/non-midnight requests can include/exclude the wrong dates.
- Filling a page exits before later selected folders are searched, while `complete` can still be true. `totalMatched` is the returned page length; candidate accounting tracks materialized candidates rather than actual server matches.
- Adapter checks `flags.has("\\seen")`, but real standard system flags are `\\Seen`; read messages can be presented as unread.
- There is no cursor/page offset in input/output. Repeating a request retrieves the same first page; “more results” cannot be followed through the API.
- Local unscoped search relies on live capability resolution to know Trash, so cached-mail browsing can fail offline. A missing/ambiguous Trash capability also cannot establish that unscoped results exclude every Trash folder.

Tasks:
- [ ] Implement exact filters over verified metadata or explicitly reject unsupported combinations before returning actionable candidates. Report unsupported attachment knowledge as unknown, not false.
- [ ] Apply inclusive-start/exclusive-end UTC filtering after any coarse provider search; define timestamp provenance. Normalize flags before testing membership.
- [ ] Add stable pagination/continuation and honest searched/unsearched/failed-folder, examined-count, has-more and total-known/unknown reporting. Never call unsearched folders complete.
- [ ] Keep local search useful with cached account/folder metadata and disclose coverage/staleness. Default Trash exclusion must be explicit and reliable.
- [ ] Test >one page, multiple folders, failed folder, exact cap boundary, read flags, attachments true/false, timezone boundaries, daylight-saving intervals and offline local search. FR-17; Stage C filter/pagination release gate.

### R16 — P1 boundary gap: AI tool functions perform work without a pre-parse entitlement gate

Evidence: `src/service/EmailOrganizationAiTools.ts` entry points parse arguments and instantiate services directly; registry wrappers call them without the `USER_AI_ENABLED` check used by AI receive/reply paths. Generic runtime tool enablement is not an AI entitlement check.

- [ ] Gate every AI-serving organization tool before parsing, materialization, network or state writes. Keep manual mailbox IPC independent of AI entitlement as the PRD requires.
- [ ] Test AI-disabled direct tool/executor invocations with malformed input and spies proving zero service/network/database work, including read/search/draft and mutation tools. Test an entitlement change during a conversation. This is a missing boundary defense; ordinary chat may have additional entry gates. FR-12/16; AC-19.

### R17 — P2 privacy: retention and explicit discard do not cover all materialized content

Evidence: `EmailForwardDraftService.ts:384–407` purges current revision artifacts only; startup-only `background.ts:1883–1884`; `EmailOrganizationArtifactStore.ts:126` sweeps only `.enc` files.

Editing produces prior revision artifacts. Explicit discard leaves those artifacts behind. An app kept open beyond the configured 24-hour TTL never runs another retention sweep. Interrupted temporary files (`.tmp-*`) are outside the sweep. Encryption is implemented, but does not satisfy timely deletion/bounded temporary storage by itself.

- [ ] Purge artifacts for all revisions on explicit discard with safe shared-reference handling; clean partial materialization/orphan artifacts on failure.
- [ ] Add periodic bounded retention cleanup and interrupted-temp handling; document/validate retention and disk budget, including active/submitted revisions.
- [ ] Test edit→discard across all revisions, app uptime beyond TTL, failed write/rename and failed draft persistence. PRD §9.

### R18 — P1/P2 validation gaps: unsupported MIME and actual composed/provider limits

Evidence: `EmailForwardMaterializer.ts:215–226` rejects only top-level multipart/signed or multipart/encrypted; `EmailForwardDraftService` persists `composedByteCount: null`; delivery constructs `SendMailOptions` without measuring composed MIME bytes.

Source inspection shows no complete rejection of nested signed/encrypted MIME or S/MIME `application/pkcs7-mime`, and no composed-size/provider-limit validation. These are unverified acceptance gaps, not scenarios claimed as executed in this audit. Declaring a nesting limit constant does not prove it is enforced by the parser.

- [ ] Add nested signed/encrypted, S/MIME, malformed/truncated MIME and parser-resource fixtures. Refuse unsupported content before materialization/send rather than degrading it silently.
- [ ] Measure the actual composed message (encoding/header expansion included), enforce the lower provider limit, and bind relevant result/manifest to the approved revision.
- [ ] Verify full-source fetch bounds apply before unbounded buffering/parsing; profile main-process parse/encryption/filesystem work and offload if required. FR-05/06; AC-04/05; PRD §8/12.

## Release work and acceptance evidence still open

- [ ] Fix R01/R02/R04–R10/R13/R15/R16 before exposing external actions broadly; add the regression families to permanent tests together with the fix.
- [ ] Finish R03/R11/R12/R14/R17/R18 before claiming the associated FRs complete. Revise the reconciled TODO to distinguish code present from passing acceptance.
- [ ] Run AC-01–13 and AC-16–22 through real integration boundaries for Stage B; AC-14/15 plus filter/pagination/bulk limits for Stage C. Current unit citations do not prove no-redundant-confirmation, contact ambiguity, retained source history, crash recovery or keyboard journeys.
- [ ] Add deterministic socket-level IMAP/SMTP fixtures and process-level fault injection for disconnects, MOVE mappings, SMTP acceptance and local persistence failure. No tests may act on the user's real mailbox.
- [ ] Add feature Playwright E2E scenarios for chat review/direct action, mailbox Trash/restore, persisted draft/history after restart, removed restore folder and bulk cancellation.
- [ ] Record actual one-second acknowledgment/progress, cancellation scheduling latency, p95 local search on the documented 10,000-message fixture and zero wrong-target/duplicate-submission outcomes in fault tests.
- [ ] Validate provider compatibility, attachment defaults, restore retention explanations and Sent-copy behavior on approved test accounts. Sent-copy is currently `not_requested`; AC-22's storage-failure scenario is not exercised by merely storing that enum.
- [ ] Add/verify local aggregate operation diagnostics specified by PRD §11; export only through the existing explicit support workflow. Per-operation count fields alone are not aggregate measurement evidence.
- [ ] Keep packaged-delivery testing an operator/CI gate; **do not run local `yarn package` or `yarn make`**.

## Recommended repair order

1. Preserve MIME/approved attachment correctness; repair authorization and restore lineage admission.
2. Establish per-account/message coordination and stable move/sync identity; repair durable evidence and kind-aware recovery.
3. Correct result semantics and exact search/selection previews.
4. Complete persistent/chat/bulk UI, keyboard/localization, retention and validation coverage.
5. Run the acceptance matrix and record provider/performance/fault-test evidence before marking release stages complete.

This report intentionally records related defects together. Fix acceptance includes the sibling cases named in each section, rather than only the first observed failing path.
