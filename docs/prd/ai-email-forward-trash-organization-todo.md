# AI email forwarding, Trash, and organization — implementation audit TODO

Audit date: 2026-11-04 (Asia/Shanghai). Baseline: `b4cceb576`.
Source: [PRD](./ai-email-forward-trash-organization-prd.md), with the [technical design](./ai-email-forward-trash-organization-technical-design.md) used to identify intended integration points.

## Verdict and scope

**The PRD is not fully implemented. Neither Stage B nor Stage C is release-ready. Stage A has reusable prerequisites but is incomplete.** The PRD itself is explicitly marked “Proposed; documentation only.” This audit does not treat the technical design as executable implementation.

The repository contains receive/reply tools, IMAP/POP3 receiving, attachment metadata, namespaced IMAP identifiers, and reply-specific approval/delivery recovery. It does not contain the dedicated forward/Trash/restore tools, organization operation entities/services, or corresponding controls and tests. Exact tool-name searches across `src/` and `test/` returned no implementations for `create_email_forward_draft`, `send_email_forward`, `move_email_to_trash`, or `restore_email`. Existing reply or marketing send paths do not satisfy these requirements.

This is a source and focused automated-test audit. No real mail was forwarded, moved, or deleted. Live-provider compatibility, keyboard interaction, crash recovery, and performance were not demonstrated. Missing-feature risks below are not claims of currently exploitable remote mutations.

## Requirement coverage

“Partial” means reusable baseline code exists, not that the acceptance condition passes. No FR is verified end to end for this new feature.

| Requirement | Status | Remaining work |
| --- | --- | --- |
| FR-01 discovery | Missing | Dedicated forward, Trash, restore registration, discovery routing, descriptions and execution labels. |
| FR-02 exact message/account | Partial | Account/message selection exists; add verified current locations, ambiguity handling and version-bound organization targeting. |
| FR-03 capabilities/folders | Partial | Sent-folder discovery exists for reply detection; add general folder discovery and separate full-source, SMTP, Trash and restore capabilities. |
| FR-04 forward drafts | Missing | Dedicated editable/reviewable draft and immutable revisions with all envelope/content fields. |
| FR-05 complete original | Missing | Verified on-demand full-source retrieval, completeness validation and unsupported MIME blocking. |
| FR-06 attachments | Partial | Names/types/sizes exist; no approved-part byte retrieval, hashes or forward materialization. |
| FR-07 action intent | Missing | Organization-specific direct-send, draft-only, review-first and changed-payload authorization. |
| FR-08 server Trash | Missing | Native safe move, destination mapping and local convergence. |
| FR-09 restore | Missing | Prior-operation-based restore, exact original destination and alternate-folder selection. |
| FR-10 history preservation | Partial | Existing reply/history records exist; no move/restore preservation or stale-reply-approval coordination. |
| FR-11 durable operations | Missing | Organization operation/item/attempt persistence, conditional claims, restart reconciliation and idempotency. |
| FR-12 trusted authorization | Missing | Main-process enforcement for exact forward/move payloads; generic chat approval is insufficient. |
| FR-13 uncertainty/partial results | Partial | Reply delivery has reusable patterns; organization-specific outcomes and recipient results absent. |
| FR-14 UI controls | Missing | Forward review, Trash, Undo/Restore, progress and history controls; keyboard tests. |
| FR-15 localization | Missing | Six-language coverage for new controls and operation states; fix baseline strings below. |
| FR-16 unattended blocking | Missing | Add future organization side-effect tools to hard deny set and execution-service origin checks. |
| FR-17 scoped search | Partial | Local text listing and bounded receive exist; explicit local/server folder/filter/coverage contract absent. |
| FR-18 frozen targets | Missing | Expiring immutable selections binding exact IDs/versions and account. |
| FR-19 bounded bulk | Missing | Serialized per-account moves, per-item results, progress, safe retry. |
| FR-20 cancellation | Missing | Durable cancel flag, stop unclaimed work, retain completed and reconcile in-flight items. |

Baseline evidence: `src/config/skillsRegistry.ts:2376` and `:2490` register receive/reply tools; `src/service/emailReceive/EmailReceiveClient.ts:12` defines normalized inbound data and attachment metadata; `src/entity/EmailReceivedMessage.entity.ts:189` stores folder UID validity; `src/service/emailReceive/ImapEmailReceiveClient.ts:600` records folder/validity during sync. Receive IPC is in `src/main-process/communication/emailReceive-ipc.ts`; mailbox UI is in `src/views/pages/emailreceive/{list,detail}.vue`.

## Existing defects to fix

These are source-confirmed behaviors. Reproduction recipes describe deterministic tests to add; they were not all executed as interactive reproductions.

### BUG-01 — P1: advertised folder argument is silently ignored

- Evidence: `src/config/skillsRegistry.ts:2389` advertises `folder`; `src/entityTypes/emailReceiveAiTypes.ts:56` accepts it. `src/service/EmailReceiveAiTools.ts:204` passes only limit/unread/since. `src/service/emailReceive/EmailReceiveSyncService.ts:154` has no folder option and loads the account's configured folder.
- Reproduce: configure INBOX, call `fetch_unread_emails` with `folder: "Receipts"`. Observe the client reading configured INBOX instead.
- Impact: AI can present mail from the wrong scope as the requested folder; unsafe foundation for organization selection.
- [ ] Pass an explicit validated folder through sync and report the actual scope, or reject unsupported overrides clearly until implemented. Constrain account/folder access.
- [ ] Regression: distinguish fixtures in INBOX and Receipts; assert requested folder is used or explicitly refused, never silently substituted.

### BUG-02 — P1: fetched summaries are not restricted to the fetched IDs

- Evidence: `src/service/EmailReceiveAiTools.ts:210–219` reloads the newest account messages rather than `result.messageIds`; when none were fetched it uses `input.limit`. The query does not carry the requested date or folder. Sync returns exact saved IDs at `src/service/emailReceive/EmailReceiveSyncService.ts:197–221`.
- Reproduce: retain cached unread rows; server fetch returns zero for a recent `since` date. Tool can return `fetched: 0, stored: 0` alongside old cached `messages`. With multiple folder occurrences cached, the same account query can return a different folder's rows.
- Impact: stale or out-of-scope messages appear to be fresh results and can be selected incorrectly.
- [ ] Load only IDs from the sync result, preserve scope, and return an empty fetched list on zero fetches. Expose cached browsing separately with explicit provenance.
- [ ] Regression: zero-result sync with populated cache, date-excluded rows and cross-folder rows; assert returned IDs are exactly the fetched set.

### BUG-03 — P2: local search treats literal characters as wildcards

- Evidence: `src/model/EmailReceivedMessage.model.ts:634–637` and `:686–689` wrap raw text in SQL LIKE without escaping `%` or `_`. This is a matching semantics bug, not SQL injection (values are parameterized).
- Reproduce: search for `100%` or `invoice_1`; unrelated matching wildcard patterns are returned. Searching `%` broadly matches populated text.
- Impact: violates PRD §7 literal subject semantics if reused for organization; can broaden a prospective deletion preview.
- [ ] Escape LIKE metacharacters with an explicit escape convention in list/count, or use a literal matching operator. Keep case-insensitive behavior consistent.
- [ ] Regression: `%`, `_`, escape character, case differences, list/count agreement. Never feed broader results directly into deletion.

### BUG-04 — P2: message load failures have no actionable UI

- Evidence: `src/views/pages/emailreceive/detail.vue:67–80` catches errors with console logging only and clears loading. The template renders content only when a message exists, with no error/retry or not-found state.
- Reproduce: reject `getReceivedMessage`, open a missing message ID, or use an invalid route ID. The user gets no explanation or retry control.
- [ ] Add localized load-error, not-found and invalid-selection states with retry/back controls. Preserve account context.
- [ ] Component tests: rejection, missing message, invalid ID and successful retry; verify keyboard operation.

### BUG-05 — P2: detail view contains untranslated text

- Evidence: `src/views/pages/emailreceive/detail.vue:24` hardcodes `Thread:` and `:64` inserts `[image hidden]`. Classification and reply status are displayed as raw stored values at lines 22–23.
- Reproduce: switch to Chinese/Japanese and open an HTML message with an image and thread key; English text remains visible.
- [ ] Translate labels, image placeholders and displayed enum states through keys in en/zh/es/fr/de/ja. Keep remote images blocked.
- [ ] Component/localization tests cover all six languages and enum states.

## Implementation tasks in dependency order

### A — Complete foundation (release blocker)

- [ ] A01: Add verified current-location records and location versions, explicit legacy-unverified state, one active location per message and migration/backup recovery tests. Existing folder/UIDVALIDITY namespacing is useful; do not replace it with bare UID or merge copies by RFC Message-ID. Test identical UIDs across folders/accounts, UIDVALIDITY changes and uncertain legacy provenance. FR-02/10; AC-06/07/21.
- [ ] A02: Implement capability/folder discovery with writable special-use/configured Trash resolution, native MOVE eligibility and reliable UID destination mapping. Revalidate before mutation; unsupported POP3 is read-only for these actions. FR-03; AC-09.
- [ ] A03: Persist operation/item/attempt records and trusted authorizations with payload hashes, unique idempotency keys, atomic claims, expiry and audited state transitions. No authorization token in model output. FR-11/12; AC-11/12/13.
- [ ] A04: Reconcile unknown remote outcomes and repair local persistence after server success without repeating remote execution. Startup reloads status rather than blindly resubmitting. FR-11/13; AC-10/17.
- [ ] A05: Hard-block `send_email_forward`, `move_email_to_trash`, `restore_email` before scheduled full-access approval and again in the service. Current deny set at `src/service/ScheduledAiToolPolicy.ts:47` contains only shell and mark-processed. This is a future integration gap, not evidence those nonexistent tools can currently execute. FR-16; AC-19.

### B — Single-message user release (release blocker)

- [ ] B01: Add dedicated tool schemas/executors, load policy, prompt capabilities and IPC/API contracts. Keep manual controls independent of AI entitlement; AI-serving boundaries check entitlement before parsing/work. FR-01/12; AC-19.
- [ ] B02: Resolve source/account/sender and contacts without guessing. Ambiguity asks clarification; local-only results disclose limits and offer bounded sync. FR-02; AC-03.
- [ ] B03: Build forward drafts/revisions with inspectable source, sender, To/Cc/Bcc, subject, note, original headers/body and attachment manifest. Default `Fwd:` once; no unrequested commentary. Distinguish draft/review/direct-send and invalidate approval after any payload change. FR-04/07; AC-01/02/12.
- [ ] B04: Fetch and validate complete MIME, preserve supported visible content and inline references, block encrypted/signed/unsupported or incomplete source. Retrieve selected actual attachment bytes and hashes; default ordinary attachments, support none/selected. Enforce 20 files/15 MiB plus composed/provider limits and 20 unique envelope recipients. Required missing/oversized files block sending. FR-05/06; AC-04/05.
- [ ] B05: Add bounded encrypted temporary artifact storage and purge on discard/retention expiry; sanitize HTML and block remote content. Keep Bcc private; do not log bodies, credentials or attachment contents or expose bytes to prompts. PRD §9.
- [ ] B06: Submit a new outgoing message identity once; preserve source flags/reply status and conversation history. Persist accepted/rejected/unknown recipient outcomes and separate Sent-copy failure from submission success. A retry must not resend to accepted recipients. FR-07/10/11/13; AC-01/10/11/18/22.
- [ ] B07: Implement verified native move to Trash with preflight and safe destination mapping; no permanent delete/expunge fallback. Update local location only from remote evidence; serialize with sync/reply claims and invalidate stale pending reply approvals. FR-08/10; AC-06/07/17.
- [ ] B08: Implement Undo as a new durable restore operation bound to original Trash provenance; retain audit history. Missing/unwritable original folder requires user-selected replacement, never silent Inbox fallback. Explain provider retention limitations. FR-09; AC-08/16.
- [ ] B09: Add mailbox/chat forward review, attachment selection, Trash, Undo/Restore and persistent operation/history cards with progress, unknown/partial states and actionable errors. Add six-language strings and keyboard/focus behavior. FR-14/15; AC-20.

### C — Organization release (after B reliability)

- [ ] C01: Add explicit local/server account/folder search with sender, literal subject, timezone-aware date interval, unread and attachment filters. Default excludes Trash; report actual folders, provenance, last sync, completeness/truncation and pagination (25 default/100 max). Reject unsupported exact filters rather than broadening. FR-17.
- [ ] C02: Freeze up to 100 IDs/versions per account in expiring (15-minute) selections. Predicate-based requests require a visible preview; trusted explicit selections authorize only their exact set. Split larger requests visibly; disclose inferred newsletter classification. FR-18; AC-14.
- [ ] C03: Serialize bulk Trash/restore per account, preflight each target, show recorded restore destinations, persist individual outcomes and progress. Partial completion cannot be aggregate success. Retry only freshly authorized proven failures, excluding unknown/completed items. FR-19.
- [ ] C04: Persist cancellation, check before the next claim, stop unstarted work within one second, retain completed outcomes and reconcile in-flight work through restart. Cancellation must not restore completed moves automatically. FR-20; AC-15.

## Validation and release evidence still required

- [ ] Map and implement every AC-01–AC-22 test. Existing receive/reply tests are not forward/organization acceptance evidence. Stage B requires AC-01–13 and AC-16–22; Stage C additionally requires AC-14/15 and search/bulk tests.
- [ ] Add deterministic IMAP/SMTP fixtures for capabilities, MOVE mapping, truncated/full MIME, partial recipient acceptance, disconnects and Sent-copy failure. Include failures between remote success and local commit and concurrent/double-click/restart fault injection.
- [ ] Add component tests alongside new UI, run `yarn test:components`, and add critical chat/mailbox/restart/bulk Playwright flows. Verify six-language keys and keyboard use.
- [ ] Record initial progress within one second, local search p95 <500 ms on documented 10,000-message CI fixture, cancellation latency, and zero duplicate/wrong-target outcomes in defined fault tests. These are targets, not measured results.
- [ ] Validate provider compatibility, attachment defaults and temporary retention using approved test mailboxes. Add local aggregate diagnostic counts from PRD §11 without new remote telemetry.
- [ ] Local packaging is forbidden by AGENTS.md. Any packaged crash/restart validation belongs to operator/CI evidence; do not run `yarn package` or `yarn make` locally.

## Audit execution results

Command: `yarn vitest --config vite.main.config.mjs run test/vitest/main/EmailReceiveAiTools.test.ts test/vitest/main/modules/ImapProbeExtensions.test.ts test/vitest/main/ScheduledAiToolPolicy.test.ts test/vitest/main/modules/EmailReceivedMessageDto.test.ts`.

Normal execution failed in global setup: repository-wide `tsc --noEmit` exited 2, before tests executed. Representative errors include missing `js-yaml`/`user-agents` declarations, Zod `ZodTypeDef` incompatibility in `src/main-process/communication/_shared/registerValidatedHandler.ts:3`, and unknown-input type failures across IPC handlers. These predate this documentation-only change; their root causes were not repaired or fully diagnosed here.

Diagnostic rerun with `AIFETCHLY_SKIP_TSC=1 AIFETCHLY_SKIP_VITE_CHECKER=1`: **2 test files passed, 2 failed to load; 41 tests passed**. The passing files were `ImapProbeExtensions.test.ts` and `ScheduledAiToolPolicy.test.ts`. `EmailReceiveAiTools.test.ts` could not load `validator` from `src/service/contact-verification/EmailVerifier.ts:12`; `EmailReceivedMessageDto.test.ts` could not load `@modelcontextprotocol/sdk/client/index.js` from `src/modules/MCPClient.ts:14`. A bypassed typecheck is not a passing normal validation gate. No new organization tests exist to prove PRD completion.

- [ ] ENV-01 (P1 validation blocker): Restore a reproducible dependency installation and resolve the TypeScript setup errors. Check declared versions versus installed/locked packages before changing APIs; do not assume all errors share one cause. Acceptance: normal typecheck and the focused command above pass without bypass flags.
- [ ] ENV-02 (P1 validation blocker): Resolve `validator` and MCP SDK module loading in the two suites, then rerun and record actual results. Acceptance: all four suites load and execute; no missing-package failures.

`git diff --check` passed before staging. No application implementation changes were made. Source-confirmed defect recipes above remain regression tests to implement; passing baseline tests do not invalidate the identified missing cases.

Commit attempt: `docs: audit email organization PRD gaps and defects` was blocked by `.husky/pre-commit` because `yarn typecheck` exited 2 with the existing repository errors described above. Full-project lint completed with 0 errors and 88 warnings. The audit document remains staged; hooks were not bypassed.
