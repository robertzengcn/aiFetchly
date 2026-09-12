# Separate SMTP Login, From, and Reply-To — Remaining TODO

## Document status

- **Status:** Implementation backlog (incomplete PRD items only)
- **Created:** 2026-09-12
- **Source PRD:** `docs/prd/email-service-from-reply-to-prd.md`
- **Technical design:** `docs/prd/email-service-from-reply-to-technical-design.md`
- **Audited worktree:** `/Users/cengjianze/project/aiFetchly/.claude/worktrees/email-service-identity`
- **Audited branch:** `worktree-email-service-identity`
- **Audit baseline:** `47e40102`

## Already implemented (do not redo)

The worktree already has the identity split on the data model, resolver,
create/update merge, import/export presence matrix, SMTP `auth.user`,
From/Reply-To headers, outbound envelope v2, worker payload v3, reply v2
binding, and fail-closed identity-change gates. Scenarios A–I and K are
covered by unit/module/IPC tests.

This file tracks only the items that still fail the PRD Definition of Done.

## Completion rules

- Do not check an item from code existence alone. Verify the renderer-to-SMTP
  or import-to-persist flow and add tests.
- Add every new user-facing string to `en.ts`, `zh.ts`, `es.ts`, `fr.ts`,
  `de.ts`, and `ja.ts`.
- Never return, export, or log SMTP/receive passwords.
- Keep validation and identity fallback in `EmailServiceIdentityResolver` and
  `EmailServiceModule`; IPC handlers must not access the database.
- Commit each completed logical unit with a conventional commit message.

---

## P0: Blocks PRD Definition of Done

These items are required before the feature can be called complete.

### P0.1 Wire provider-rejection categories into Test Email and standard send

Test Email still reports raw SMTP text via `smtpErrorMessage()`. The shared
classifier exists but is only used by the authorized worker.

- [x] Use `classifySmtpFailure()` in `EmailService.sendEmail()` (Test Email and
      standard send).
- [x] Use `classifySmtpFailure()` in `ReplyEmailService` so reply failures use
      the same categories.
- [x] Map `smtp_auth_failed` and `smtp_from_rejected` to distinct, localized
      UI messages.
- [x] From-alias rejection must tell the user to verify the alias with their
      email provider (PRD §15).
- [x] Do not recommend changing TLS settings when the SMTP response is already
      authentication or sender-policy.
- [x] Do not present receive/connection-only verification as proof that an
      alias may send.
- [x] Add tests: AUTH/535 → auth category; MAIL FROM / sender rejected →
      From-alias category; Test Email UI shows the mapped message, not only
      the raw provider string.

**Covers:** FR-003, PRD §15, Scenario J; technical design §13.4, §19.

### P0.2 Add six-language error and identity copy

Field labels for SMTP username and Reply-To exist. Validation, provider, and
approval errors do not. The From field still uses the old “sender account”
label.

- [x] Relabel `emailservice.from` away from “sender account” in all six
      languages. Use From-address wording such as “The address recipients see.
      It must be allowed by your email provider.”
- [x] Update `emailservice.smtp_username_hint` to mailbox-login wording such as
      “The mailbox account used to sign in to your SMTP server.”
- [x] Update `emailservice.reply_to_hint` to “Replies go here. Leave empty to
      reply to the From address.”
- [x] Add localized keys for every PRD §15 category:
      - missing SMTP username
      - invalid From
      - invalid Reply-To
      - SMTP authentication failed
      - From alias rejected
      - identity changed after approval
      - import password required for a new row
- [x] Keep SMTP username from being called “From” or “sender account.”
- [x] Add a component or i18n test that the new keys exist in en/zh/es/fr/de/ja.

**Covers:** FR-001, PRD §15, Definition of Done (six languages).

### P0.3 Add Playwright / fake-SMTP end-to-end identity scenarios

Vitest covers resolver, worker, and mocked Nodemailer headers. `test/e2e/specs/`
has no identity scenario.

- [x] Create a service whose SMTP username differs from From, send a test
      message, and assert the fake SMTP server saw AUTH user, From, and
      optional Reply-To separately. _(scenario 1, emailIdentity.test.ts)_
- [x] Import two aliases that share one SMTP login and send through each.
      _(scenario 2, emailIdentity.test.ts)_
- [ ] Approve an outbound draft, change Reply-To, and assert delivery is
      blocked until re-review. _(out of scope: requires unimplemented seed
      channels for outbound drafts + approval tokens)_
- [ ] Reply to a received message and assert inbound recipient selection stays
      independent from configured outbound Reply-To. _(out of scope: requires
      unimplemented seed channels for received messages)_
- [x] Simulate MAIL FROM rejection on Test Email and assert alias guidance
      (depends on P0.1). _(scenario 5, emailIdentity.test.ts)_

**Covers:** PRD §17.4; technical design §23.8, §26.4.

---

## P1: Product acceptance gaps

### P1.1 Form validation for the three identity fields

The Vue form does not mark SMTP username required and has no CR/LF or length
rules. Reply-To has `type="email"` but no `:rules`. Backend fallback currently
treats blank SMTP username as From (technical design §9.2).

- [x] Decide and document one rule: either the form requires SMTP username
      (FR-001 / FR-005) or blank continues to fall back to From (technical
      design §9.2). Do not leave the PRD and UI disagreeing.
      **Decision:** the form **requires** SMTP username (FR-001/FR-005). The
      feature's premise — separate SMTP login from From — means the login must
      be explicit. The resolver's `smtpUsername ?? from` fallback (§9.2) stays
      as defense-in-depth for legacy rows and the receive-username path, but
      the UI no longer lets a user submit a blank SMTP username.
- [x] Reject CR and LF in SMTP username, From, and Reply-To in the form (or
      surface the module `email_header_break_forbidden` error immediately).
      Implemented via `identityValidationRules.ts` `noLineBreakRule` (rejects
      \r, \n, U+2028, U+2029), wired to all three fields.
- [x] From and non-empty Reply-To keep single-address email validation.
      From uses `emailRequiredRule`; Reply-To uses `emailOrEmptyRule`.
- [x] SMTP username uses required/length validation without email-only syntax
      if the chosen rule is "required."
      `requiredRule` (non-empty after trim) + `noLineBreakRule`. No email-shape
      rule — some SMTP logins are not email addresses.
- [x] Extend `EmailServiceDetail.test.ts` for the chosen validation behavior.
      Added a From-relabeled-copy assertion; the rule functions are covered by
      `identityValidationRules.test.ts` (18 cases).

**Covers:** FR-001, FR-005.

### P1.2 Distinguish reply identity error codes

Reply-To and SMTP username mismatches currently share
`reply_identity_mismatch`. Missing service is a thrown Error, not a stable
code.

- [x] Keep `sender_mismatch` for From mismatch.
- [x] Add or reuse a distinct code for Reply-To mismatch.
- [x] Add or reuse a distinct code for SMTP username mismatch.
- [x] Keep `service_inactive` for disabled services.
- [x] Use a stable `service_missing` (or equivalent) code when the bound
      service cannot be loaded.
- [x] Localize those messages (depends on P0.2).
- [x] Extend `EmailReplySendBinding.test.ts`.

**Covers:** FR-013.

### P1.3 Identify service and From on send logs

Authorized outbound logs can show `revision.senderAddress`. Legacy
`emailmarketing_send_log` has no email-service id, From, Reply-To, or SMTP
username.

- [x] Send logs identify the email-service record and visible From address.
- [x] Where identity metadata is stored, Reply-To and SMTP username may be
      recorded as non-secret values.
- [x] Passwords and decrypted credentials must never appear in logs.
- [x] Provider failures retain sanitized SMTP details sufficient to tell
      authentication, sender rejection, recipient rejection, TLS, and
      uncertain-delivery apart (depends on P0.1 for standard/reply paths).

**Covers:** FR-014.

### P1.4 Import test for several aliases on one login

Behavior is allowed (duplicate detection uses name, then host+From). There is
no dedicated test that three rows with unique names/From and the same SMTP
username/host/password all import as separate records.

- [x] Add an import test for Scenario D (Sales / Support / Billing aliases).
- [x] Assert they remain independently selectable by service id.

**Covers:** FR-002, Scenario D; technical design §23.3.

---

## P2: Technical-design leftovers

These are in the technical design Definition of Done / §21, not the product
FR list, but they should still be closed on this branch.

### P2.1 Observability counters

- [x] Emit `email_service_identity_legacy_fallback`.
- [x] Emit `email_service_import_password_preserved`.
- [x] Emit `email_service_import_new_password_missing`.
- [x] Align outbound identity-change naming: design says
      `sender_identity_changed` (code already uses it everywhere; aligned the 2 doc lines that said `outbound_identity_changed`). Pick
      one and use it in metrics, status, and tests.
- [x] Do not use SMTP username or email address as a metric label.

**Covers:** technical design §21.

### P2.2 Keep identity fallback in one resolver

Several delivery/compare sites still inline `smtpUsername ?? from` instead of
calling `resolveEmailServiceIdentity()`.

- [x] Replace inline fallbacks in `EmailReplySendBinding`,
      `OutboundEmailDeliveryService`, `OutboundEmailWorkerStarter`, and
      `emailSend.ts` with the shared resolver (also `outboundEmailDelivery-ipc.ts`).
- [x] Add or extend tests so a drift in fallback rules would fail (EmailServiceIdentityResolver drift guard).

**Covers:** technical design AD-003, §7.1.

### P2.3 Hygiene

- [x] Update the `receiveUsername` entity comment: fallback is
      `receiveUsername → smtpUsername → from`, not From only.
- [x] Remove or replace the commented-out `user: randomEmailservice.from`
      block in `src/childprocess/emailSend.ts` so it cannot be copied back in (removed).

**Covers:** technical design §6.1, §14.

---

## Suggested order

1. P0.1 classifier on Test Email / standard / reply send
2. P0.2 six-language labels and error categories
3. P1.1 form validation (after deciding required vs fallback)
4. P1.2 reply error-code split
5. P0.3 Playwright fake-SMTP identity scenarios
6. P1.3 send-log identity fields
7. P1.4 Scenario D import test
8. P2.1–P2.3 observability and hygiene

P0.3 should wait until P0.1 and P0.2 exist, otherwise the e2e alias-rejection
assertion has no localized category to check.
