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
