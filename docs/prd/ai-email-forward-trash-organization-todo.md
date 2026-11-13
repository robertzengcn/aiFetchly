<<<<<<< HEAD
# AI email forwarding, Trash, and organization — implementation TODO (reconciled)

- Original audit: 2026-11-04 (Asia/Shanghai), baseline `b4cceb576`.
- **Reconciliation: 2026-11-04, branch `feature/email-forward-trash-organization` @ `f89222d46`.**
- The original audit ran against the main repo BEFORE this branch existed, so its "Missing" verdicts describe the baseline, not the branch. This file records per-item status ON THE BRANCH with evidence. Items verified by reading code or citing tests; live-provider items remain explicitly open.

## Status summary

| Section | Status |
| --- | --- |
| Existing defects BUG-01…BUG-05 | **Fixed** on this branch (9e8e94f3e, d1b2ba6a0) with regression suites |
| A — Foundation (A01–A05) | **Done** (40eb9a138, 85bf2cf81, f4345c967, 7a6bb3afc, 97a8f22bc + review hardening cc71813d8) |
| B — Single-message release (B01–B09) | **Done** (da3f8099c, 97a8f22bc, b71fa8776, e43b06a53, 40a39a243) |
| C — Organization release (C01–C04) | **Done** (f89222d46) |
| ENV-01 / ENV-02 | **Resolved on the branch**: `yarn typecheck` exits 0; the audit's four blocked suites load and pass (107 tests) under the branch's `yarn install` dependency set |
| Validation & release evidence | **Partially done** — automated acceptance mapped below; live-provider, E2E and performance items remain open (environment-bound) |

## Requirement coverage (branch state)

| Requirement | Branch status | Evidence |
| --- | --- | --- |
| FR-01 discovery | Done | `skillsRegistry.ts` registers all 10 organization tools; `ToolLoadPolicyService` contextual promotion; `BuiltInToolCapabilitiesPromptSection` row; `EmailOrganizationToolPolicy.test.ts` |
| FR-02 exact message/account | Done | Verified locations gate mutation (`EmailMessageLocation.model.ts`); account-bound selection freeze; ambiguity asks via tool descriptions + `LOCATION_STALE`/`SOURCE_NOT_FOUND` refusals |
| FR-03 capabilities/folders | Done | `EmailOrganizationCapabilityService` (MOVE gate, special-use Trash, reason codes); `list_email_folders`; `EmailOrganizationCapabilityService.test.ts` |
| FR-04 forward drafts | Done | `EmailForwardDraftService` + write-once revisions; `EmailForwardFlow.service.test.ts` |
| FR-05 complete original | Done | Full-source PEEK fetch + UIDVALIDITY guard + 30 MiB bound; `MIME_UNSUPPORTED` for encrypted/signed; materializer tests |
| FR-06 attachments | Done | Byte artifacts + hashes + manifest; 20 files / 15 MiB; none/parts/all selection; `ATTACHMENT_UNAVAILABLE` blocks send |
| FR-07 action intent | Done | Draft-only/review/direct-send via tool design + request-scoped confirmation; `EmailOrganizationIntentResolver` (pure, tested — wiring noted open below) |
| FR-08 server Trash | Done | Native MOVE with capability gate (no COPY+EXPUNGE fallback); destination mapping evidence; `ImapEmailMailboxAdapter.test.ts` |
| FR-09 restore | Done | `restoreFromOperation` (recorded original folder) + explicit alternate folder; no silent fallback |
| FR-10 history preservation | Done | Forward never touches reply state (test); moves invalidate pending reply approvals (`invalidateUnsentDraftsForMessage`); audit trail append-only |
| FR-11 durable operations | Done | Operation/item/attempt/authorization entities; conditional claims; idempotent duplicates; startup recovery wired (40a39a243) |
| FR-12 trusted authorization | Done | Hash-bound one-time authorizations; identity recheck before dispatch; `SkillPermissionService` always prompts for request-scoped tools (40a39a243) |
| FR-13 uncertainty/partial | Done | accepted/rejected/unknown recipient outcomes; `needs_reconciliation`; honest UI states |
| FR-14 UI controls | Done | Review dialog, operation card, page/row actions, retryable error states (EmailReceiveDetail.test.ts) |
| FR-15 localization | Done | `emailOrganization.*` + detail-view keys in en/zh/es/fr/de/ja with parity test |
| FR-16 unattended blocking | Done | `SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS` + `SkillPermissionService` re-prompt; policy tests incl. full_access denial |
| FR-17 scoped search | Done (f89222d46) | `search_emails` local + bounded server; literal subject; coverage/completeness/limitation reporting |
| FR-18 frozen targets | Done (f89222d46) | `EmailOrganizationSelectionEntity` + `prepare_email_selection` (≤100, hash, 15-min expiry) |
| FR-19 bounded bulk | Done (f89222d46) | Sequential per-account execution, per-item outcomes, stale-version individual reporting |
| FR-20 cancellation | Done (f89222d46) | Durable cancel flag checked before every claim; completed preserved; in-flight reconciles |

## Existing defects (original audit) — fixed

- [x] BUG-01 — folder override honored on the wire; result reports actual scope; regression: `EmailReceiveAiTools.test.ts` ("passes an explicit folder override…").
- [x] BUG-02 — summaries restricted to fetched ids via `readByIds` (order-preserving); zero-fetch returns empty; regressions: zero-result + ordering tests.
- [x] BUG-03 — LIKE metacharacters escaped in list+count with explicit `ESCAPE '\'`; regression: `EmailReceivedMessageSearch.test.ts` (%, _, escape char, case, list/count agreement).
- [x] BUG-04 — detail page load-failure/invalid-id/retry states; regression: `EmailReceiveDetail.test.ts` (rejection+retry, invalid id, keyboard-operable button).
- [x] BUG-05 — Thread label, image placeholder, classification/reply-status enums translated (6 languages); covered in `EmailReceiveDetail.test.ts`.

## Implementation tasks

### A — Foundation
- [x] A01 … A05 — implemented as summarized above; A05 hard-block verified incl. `full_access` (`EmailOrganizationToolPolicy.test.ts`).

### B — Single-message release
- [x] B01 … B09 — implemented; B05 artifact purge on discard + retention sweep wired at startup; B09 chat/UI cards + six languages.

### C — Organization release
- [x] C01 … C04 — implemented (f89222d46); regressions: `EmailOrganizationStageC.service.test.ts` (freeze limits/dedup/destinations; bulk outcomes; cancel keeps completed; stale-version individual reporting; literal local search + coverage; bounded server search incompleteness).

## Validation and release evidence

- [x] AC mapping (automated subset, by citation):
  - AC-01/02 (direct vs review/draft): `EmailForwardFlow.service.test.ts` (submit, duplicate), review dialog tests (send gated on recipients; save-draft path).
  - AC-03 (ambiguous recipients): tool descriptions require explicit addresses; `VALIDATION_FAILED` for invalid — model-side clarification contract.
  - AC-04/05 (attachments): materializer manifest/inline/tracking-pixel tests; oversize/`TOO_MANY_ATTACHMENTS`; `ATTACHMENT_UNAVAILABLE` blocks send.
  - AC-06/07 (same UID two folders; UIDVALIDITY change): `EmailMessageLocation.model.test.ts` tuple-conflict + version tests; adapter UIDVALIDITY tests.
  - AC-08 (Trash→Undo→restore): `EmailMailboxAction.service.test.ts` restore-from-prior-operation.
  - AC-09 (no MOVE/POP3): adapter `no_move_capability`; capability POP3 read-only matrix.
  - AC-10/11/12/13: interrupted-submission unknown; duplicate → existing operation; identity-changed refusal; content treated as data (intent resolver test) + prompt hard-block.
  - AC-14/15 (Stage C): stale-version individual reporting; cancel mid-bulk keeps completed.
  - AC-16 (removed restore folder): restore uses recorded folder or explicit user choice; `DESTINATION_INVALID` without one.
  - AC-17 (server success, local failure): reconcile-with-mapping test; attempt-evidence persistence.
  - AC-18 (partial recipients): partial-acceptance test (no resend to accepted).
  - AC-19 (AI disabled/scheduled): IPC gate-before-parse (now manual-only channels by design — D3) + scheduled hard-block tests.
  - AC-20 (six languages): `EmailOrganizationI18nKeys.test.ts` parity + detail/dialog/card tests.
  - AC-21 (legacy provenance): `legacy_unverified` ineligible for mutation (location model tests, startup service tests).
  - AC-22 (Sent copy): sentCopyStatus tracked separately (`not_requested` Stage B/C default; submission never resends).
- [ ] Deterministic IMAP/SMTP wire-level fixtures (fake-connection suites cover the adapter contract; a live socket-level server fixture remains open for CI hardening).
- [ ] Playwright E2E flows (chat forward, mailbox trash/restore, restart, bulk) — open.
- [ ] Performance measurements (1 s ack, p95 <500 ms @10k, cancel latency) — open; targets only.
- [ ] Live-provider compatibility, attachment defaults and retention validation on approved test mailboxes — open (operator/CI; never against a user mailbox).
- [x] Local packaging stays forbidden (AGENTS.md) — not run.

## Environment (original audit blockers)

- [x] ENV-01 — `yarn typecheck` exits 0 on this branch (the audit's repo-wide `tsc` failures were the main repo's mid-flight zod-v4 dependency state; the branch pins a consistent set via its own `yarn install`).
- [x] ENV-02 — `EmailReceiveAiTools.test.ts`, `ImapProbeExtensions.test.ts`, `ScheduledAiToolPolicy.test.ts`, `EmailReceivedMessageDto.test.ts`: 4 files / 107 tests passing (module resolution fixed by a complete dependency install incl. `validator` and `@modelcontextprotocol/sdk`).

## Open items (environment-bound or follow-up)

- Wire `EmailOrganizationIntentResolver` into tool promotion or delete it (currently tested but unwired; the load-policy regex is the active promoter).
- Playwright E2E suite + wire-level IMAP/SMTP fixtures + performance runs + live test-mailbox compatibility (operator/CI evidence).
- Component test for the `detail.vue` action-button wiring beyond the load-state suite.
=======
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
>>>>>>> dev
