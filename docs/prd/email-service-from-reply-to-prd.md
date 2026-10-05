# Separate SMTP Login, From, and Reply-To - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-09-09
- **Owner**: Product and Engineering
- **Feature area**: Email Service, Email Import/Export, Outbound Email, and Email Reply
- **Primary use case**: One SMTP mailbox with several provider-approved sending aliases
- **Example provider**: Spaceship Email; requirements remain provider-neutral
- **Related documents**:
  - `docs/prd/email-service-from-reply-to-technical-design.md`
  - `docs/prd/ai-outbound-email-intent-aware-delivery-prd.md`
  - `docs/prd/ai-email-thread-aware-reply-reliability-prd.md`
  - `docs/prd/ai-email-receive-auto-reply-prd.md`

## 1. Purpose

AiFetchly currently uses the email service's `from` value for two different
purposes: authenticating to the SMTP server and constructing the visible From
header. That works when the login mailbox and visible sender are identical, but
it fails for providers that let one mailbox send through several approved
aliases.

For example, a user may authenticate as `mailbox@example.com` while sending as
`sales@example.com`. Replies may need to return to `support@example.com`. These
are three separate email concepts and must not share one field.

This PRD defines a backward-compatible release that adds an SMTP username and
Reply-To address while keeping the existing `from` field as the visible sender.
It also updates the recently merged email-service import/export workflow so
aliases can be moved and maintained without exposing stored passwords.

## 2. Executive Summary

Each email-service record will represent one sending identity backed by one SMTP
login:

```text
SMTP username  -> account used to authenticate with the SMTP server
From address   -> address recipients see as the sender
Reply-To       -> optional address used when recipients click Reply
```

The release adds these fields:

| Field | Required | Purpose | Legacy behavior |
|---|---:|---|---|
| `smtpUsername` | Yes, effectively | SMTP authentication identity | Falls back to `from` |
| `from` | Yes | Visible From address | Unchanged |
| `replyTo` | No | Visible Reply-To header | No header when empty |

One mailbox with several aliases is represented by several named email-service
records. The records may share `smtpUsername`, SMTP host, port, and password,
but each record has its own `from` and optional `replyTo` values.

This release does not split mailboxes and sender identities into separate
tables. That larger normalization may be considered later if credential sharing
and alias management become difficult at scale.

## 3. Current-State Evidence

The current implementation has the following behavior:

- SMTP transport authentication uses `email_service.from` as `auth.user`.
- New outbound messages use the same value as the Nodemailer `from` option.
- Reply messages also use the same value as the Nodemailer `from` option.
- The email-service form exposes one sender-account field named From.
- `EmailServiceEntity` and `EmailServiceEntitydata` have no SMTP username or
  configured Reply-To field.
- Receive configuration falls back to `from` when `receiveUsername` is empty.
- Email-service import uses a strict field whitelist and upserts by service
  name.
- Import currently requires an SMTP password and overwrites it on update.
- Safe export deliberately omits passwords, which means its output cannot be
  re-imported without manually adding a password.
- Outbound approval hashing binds the service and visible sender but does not
  bind Reply-To or the SMTP authentication identity.
- Reply delivery requires the approved sender to equal the bound service's
  `from` address.

Nodemailer already supports separate SMTP `auth.user`, message `from`, and
message `replyTo` values. The product gap is AiFetchly's data model, validation,
import contract, UI, and delivery-policy binding.

## 4. Product Principles

1. **Email identities are distinct**: authentication, visible sender, and reply
   destination must be represented separately.
2. **Legacy configurations keep working**: existing rows must send exactly as
   before unless the user changes their settings.
3. **Aliases are explicit**: each sending alias is a named service record that
   can be selected, tested, audited, and disabled independently.
4. **Provider authorization is not assumed**: a syntactically valid alias may
   still be rejected by the provider, so users need a real send test.
5. **Approval covers the complete visible envelope**: changing From or Reply-To
   after approval must prevent the stale message from being sent.
6. **Credentials remain secret**: passwords never return to the renderer, appear
   in safe exports, or leak through import errors.
7. **Imports are backward compatible**: old CSV and JSON files continue to work,
   and missing columns do not erase newer settings during an update.

## 5. Goals

### 5.1 Primary Goals

- Allow users to authenticate with one mailbox and send from a different,
  provider-approved alias.
- Allow users to configure an optional Reply-To address.
- Apply the same identity consistently to test mail, bulk mail, AI-generated
  outbound mail, and email replies.
- Extend CSV and JSON import/export with safe, predictable behavior.
- Preserve existing service records and legacy import files.
- Prevent stale approvals from sending with changed identity headers.
- Give users actionable feedback when authentication succeeds but a provider
  rejects the selected From alias.

### 5.2 Secondary Goals

- Make email-service labels understandable to users who are not familiar with
  SMTP terminology.
- Let users maintain several aliases by importing one row per identity.
- Keep inbound login defaults aligned with the actual mailbox account.
- Establish a migration path toward a future mailbox-and-identities model.

## 6. Non-Goals

- Creating separate mailbox-account and sender-identity tables in this release.
- Automatically discovering aliases from Spaceship or another provider.
- Automatically proving that a provider or domain owner authorized an alias.
- Managing SPF, DKIM, DMARC, DNS, or provider-side alias creation.
- Adding a separate display-name field such as `Sales Team <sales@example.com>`.
- Adding a configurable SMTP envelope sender or Return-Path field.
- Sharing one encrypted password row across several email-service records.
- Changing recipient selection or introducing Reply-All behavior.
- Exporting SMTP or receive passwords.

## 7. Target Users and Jobs

### 7.1 Small business with role aliases

The user owns one mailbox but sends as sales, support, or billing aliases. They
want recipients to see the correct business address without breaking SMTP
authentication.

### 7.2 Marketing operator

The operator selects a named sender identity for a campaign and wants the From
and Reply-To values shown during review and preserved during delivery.

### 7.3 Support operator

The operator replies to inbound email through the correct configured alias and
wants future customer responses routed to the configured Reply-To mailbox.

### 7.4 Administrator maintaining configurations in bulk

The administrator imports several alias records and expects existing passwords
and omitted settings to remain unchanged.

## 8. Terminology and Field Semantics

### 8.1 SMTP username

`smtpUsername` is the account identifier sent to the SMTP server during
authentication. It is not a password and is not used as the visible From header
unless the user also chooses the same address for `from`.

SMTP usernames are provider-defined. The product must require a non-empty value
but must not require email-address syntax because some SMTP providers use a
different account-name format.

### 8.2 From address

`from` is the visible email address used in the message's From header. It must be
a single valid email address. The field does not accept multiple addresses or
newline characters.

### 8.3 Reply-To address

`replyTo` is an optional single email address used in the message's Reply-To
header. When it is empty, AiFetchly must omit the Reply-To header and mail clients
normally reply to the From address.

### 8.4 Receive username

`receiveUsername` remains an optional inbound IMAP/POP3 override. Its effective
fallback order becomes:

```text
receiveUsername -> smtpUsername -> from
```

## 9. User Experience Requirements

### FR-001 Email-service form fields

The create/edit form must show three clearly separated fields in this order:

1. **SMTP username**: required, with guidance such as "The mailbox account used
   to sign in to your SMTP server."
2. **From address**: required, with guidance such as "The address recipients see.
   It must be allowed by your email provider."
3. **Reply-To address**: optional, with guidance such as "Replies go here. Leave
   empty to reply to the From address."

Acceptance criteria:

- Existing records display `from` as the effective SMTP username when no stored
  `smtpUsername` exists.
- The UI does not call SMTP username "From" or "sender account."
- From and Reply-To use email-address validation.
- SMTP username uses required and length validation without email-only syntax.
- The form rejects carriage returns and line feeds in all three fields.
- Edit mode preserves the existing password when its input remains empty.
- All user-facing labels, hints, validation messages, and provider-rejection
  messages exist in English, Chinese, Spanish, French, German, and Japanese.

### FR-002 Alias records

Users must be able to create several services with the same SMTP username and
host when the service names and From addresses identify different aliases.

Acceptance criteria:

- `Sales Alias`, `Support Alias`, and `Billing Alias` may all authenticate with
  the same SMTP username.
- Service selection continues to use the email-service record ID.
- Duplicate detection must not collapse two rows only because host and SMTP
  username match.
- A duplicate service name continues to identify an import/update target.
- The same service name cannot silently switch to a different alias without
  normal update validation and approval invalidation.

### FR-003 Test Email behavior

The existing Test action must submit the configured SMTP username, From, and
Reply-To values and send a real test message.

Acceptance criteria:

- Authentication uses SMTP username, not From.
- The received test message contains the configured From header.
- The received test message contains Reply-To only when configured.
- Test success means the provider accepted the message for submission; it does
  not promise final inbox delivery.
- Authentication failures and From-alias rejections are presented as different
  actionable categories where the SMTP response permits that distinction.
- A From rejection tells the user to verify the alias in their email provider.
- Connection-only verification is not presented as proof that an alias may send.

## 10. Data and Compatibility Requirements

### FR-004 Email-service data contract

The email-service entity and shared TypeScript contract must support:

```typescript
type EmailServiceIdentityFields = {
  smtpUsername?: string | null;
  from: string;
  replyTo?: string | null;
};
```

Acceptance criteria:

- The database migration adds nullable `smtpUsername` and `replyTo` columns.
- Existing rows are not rewritten solely to complete the migration.
- The effective SMTP username is `smtpUsername || from` at every runtime
  boundary until legacy rows have been naturally resaved.
- Empty Reply-To values are normalized to `null` for storage.
- Password encryption and empty-password edit sentinels remain unchanged.
- Email-service list/detail responses never include plaintext passwords.

### FR-005 Create and update behavior

Acceptance criteria:

- New UI-created records require SMTP username, From, password, host, and port.
- Existing legacy records can be loaded and tested without first being edited.
- Updating an existing record with an omitted SMTP username preserves the stored
  value; when no stored value exists, runtime fallback to From remains active.
- Updating an existing record with an omitted Reply-To preserves the stored
  value.
- Explicitly clearing Reply-To removes the header from future messages.
- Changing SMTP username, From, or Reply-To is treated as an identity change for
  pending-delivery validation.

## 11. Import and Export Requirements

### 11.1 Canonical safe export fields

CSV and JSON safe exports must expose the same non-secret service fields:

| Canonical field | CSV header | JSON property | Exported |
|---|---|---|---:|
| Record identifier | `id` | `id` | Yes |
| Service name | `name` | `name` | Yes |
| SMTP username | `smtpUsername` | `smtpUsername` | Yes |
| From address | `from` | `from` | Yes |
| Reply-To address | `replyTo` | `replyTo` | Yes |
| SMTP host | `host` | `host` | Yes |
| SMTP port | `port` | `port` | Yes |
| TLS/SSL setting | `ssl` | `ssl` | Yes |
| Receive protocol | `receiveProtocol` | `receiveProtocol` | Yes |
| Creation timestamp | `create_time` | `create_time` | Yes |
| SMTP password | `password` | `password` | **Never** |
| Receive password | `receivePassword` | `receivePassword` | **Never** |

For a legacy row, export must write its effective SMTP username, which is the
stored SMTP username when present or From otherwise. Empty Reply-To exports as
an empty CSV field or JSON `null`.

### FR-006 Import field compatibility

Import must continue accepting the current CSV and JSON shapes while adding the
new fields.

Acceptance criteria:

- Canonical exported names are `smtpUsername` and `replyTo`.
- CSV header matching remains case-insensitive.
- Import also accepts `smtpusername`, `smtp_username`, `replyto`, and `reply_to`
  as compatibility aliases.
- Existing `from`, `name`, `host`, `port`, `ssl`, `password`, and
  `receiveProtocol` behavior remains supported.
- Unknown columns remain ignored by the strict whitelist.
- `id` and `create_time` may be read but remain ignored for write targeting.
- Service name remains the upsert key.
- Several rows may use the same SMTP username and host when their service names
  and From addresses differ.

### FR-007 Missing, blank, and omitted import values

Import must distinguish an absent field from an explicitly blank field when the
distinction changes existing data.

| Import situation | New service | Existing service matched by name |
|---|---|---|
| `smtpUsername` absent | Default to `from` | Preserve stored value; legacy fallback remains valid |
| `smtpUsername` present but blank | Default to `from` | Reset to effective `from` behavior |
| `replyTo` absent | Default to `null` | Preserve stored value |
| `replyTo` present but blank | Store `null` | Clear stored Reply-To |
| `password` absent or blank | Reject row | Preserve stored password |
| `from` absent or blank | Reject row | Reject row; never erase sender |

Acceptance criteria:

- A safe export can be re-imported to update matching services without adding
  passwords manually.
- A safe export cannot create a usable service on a new installation until the
  user adds a password; affected rows report a clear row-level error.
- Import never replaces an existing SMTP password with an empty string.
- Import never includes raw row content or credentials in renderer-visible
  errors or logs.
- Existing partial-import behavior, row numbering, BOM handling, friendly TLS
  values, strict structural errors, and ten-error display cap remain intact.

### FR-008 Import validation and result reporting

Acceptance criteria:

- SMTP username is non-empty after fallback and no longer than the storage
  limit.
- From and non-empty Reply-To are valid single email addresses.
- Values containing CR or LF are rejected to prevent header injection.
- Invalid rows are skipped without blocking valid rows, except when the file is
  structurally malformed.
- Row errors name the invalid field but do not echo passwords or complete row
  values.
- The success, partial-success, cancel, invalid-file, and no-valid-rows UI states
  continue to behave as they do in the merged import feature.

## 12. Sending Requirements

### FR-009 SMTP transport separation

Every outbound SMTP transport must use:

```text
auth.user   = effective smtpUsername
auth.pass   = decrypted stored password
message.from = configured from
message.replyTo = configured replyTo when non-empty
```

Acceptance criteria:

- No send path uses From as `auth.user` when SMTP username is configured.
- No send path uses Nodemailer's `sender` field as a replacement for SMTP
  authentication.
- Custom Return-Path or envelope sender behavior is not added in this release.
- Existing STARTTLS/implicit-TLS selection and retry behavior remains unchanged.
- SMTP sessions and logs do not expose passwords.

### FR-010 Send-path coverage

The identity mapping must apply consistently to:

- Test Email.
- Standard single-message sending.
- Bulk email campaigns and their child process payloads.
- AI-generated outbound email, including send-now and review-first modes.
- Manual and AI-assisted replies to received email.
- Retries that are already allowed by the existing delivery policy.

No alternate or legacy send path may continue authenticating from `from`
directly after this release.

### FR-011 Reply behavior

Configured outbound Reply-To and an inbound message's Reply-To have different
roles and must remain distinct:

- The configured service `replyTo` controls where recipients reply to messages
  sent by AiFetchly.
- The received message's `replyToAddress` controls which recipient AiFetchly
  addresses when replying to that inbound message.

Acceptance criteria:

- Reply delivery continues choosing the recipient from the inbound message's
  Reply-To, falling back to its From address.
- The reply message itself uses the service's configured From and optional
  configured Reply-To headers.
- Threading headers such as `In-Reply-To` and `References` remain unchanged.
- The bound email-service ID remains authoritative for the reply's sending
  identity.

## 13. Approval, Integrity, and Audit Requirements

### FR-012 Frozen envelope binding

Outbound authorization must bind the effective sending identity, not only the
body and recipient.

Acceptance criteria:

- New frozen envelopes include email-service ID, effective SMTP username, From,
  Reply-To or explicit `null`, recipient, subject, text body, and HTML body.
- From and Reply-To use normalized email-address comparison for identity checks.
- SMTP username is normalized by trimming only unless provider-specific rules
  explicitly allow further normalization.
- Changing SMTP username, From, Reply-To, or service ID after approval causes a
  send-time mismatch and requires new review or authorization.
- The canonical envelope schema is versioned so the new fields cannot be
  silently omitted from a hash.
- A legacy frozen envelope is interpreted as having `replyTo = null`. If the
  selected service now has a non-empty Reply-To, sending is blocked until the
  draft is reviewed again.

### FR-013 Reply approval binding

Acceptance criteria:

- Approved reply sender must match the service's effective From address.
- Approved reply metadata must also match the service's current Reply-To value.
- A changed SMTP username must invalidate the service binding even when From is
  unchanged.
- Error messages distinguish sender mismatch, Reply-To mismatch, inactive
  service, and missing service.

### FR-014 Audit and logs

Acceptance criteria:

- Send logs identify the email-service record and visible From address.
- Where identity metadata is stored, Reply-To and SMTP username may be recorded
  as non-secret configuration values.
- Passwords and decrypted credentials are never logged.
- Provider failures retain sanitized SMTP response details sufficient to
  distinguish authentication, sender rejection, recipient rejection, TLS, and
  uncertain-delivery outcomes.

## 14. Security and Privacy Requirements

- Reject CR and LF characters in SMTP username, From, and Reply-To inputs.
- Do not allow multiple addresses in From or Reply-To.
- Continue encrypting SMTP and receive passwords at rest.
- Never add passwords to safe CSV or JSON exports.
- Never return decrypted credentials through IPC, AI tools, or renderer state.
- Treat imported files as untrusted data and keep the strict field whitelist.
- Do not treat successful authentication as proof that the alias is authorized.
- Preserve fail-closed behavior when an approved identity no longer matches the
  current service configuration.
- Do not allow an imported alias to bypass service status, outbound approval,
  recipient policy, suppression, or duplicate-send controls.

## 15. Error Experience

User-visible errors should use stable localized categories:

| Category | Example guidance |
|---|---|
| Missing SMTP username | Enter the mailbox username used to sign in to SMTP. |
| Invalid From | Enter one valid sender email address. |
| Invalid Reply-To | Enter one valid reply email address or leave it empty. |
| SMTP authentication failed | Check the SMTP username and password. |
| From alias rejected | Verify that this From address is an approved alias with your email provider. |
| Identity changed after approval | Review the message again because its sending identity changed. |
| Import password required for new row | Add a password for this new service; exported files intentionally omit passwords. |

Errors must not recommend changing TLS settings when the SMTP server has already
returned an authentication or sender-policy response.

## 16. Acceptance Scenarios

### Scenario A: Legacy service continues to send

Given an existing row has From `owner@example.com` and no SMTP username or
Reply-To, when it sends after the migration, then authentication and From both
use `owner@example.com`, and no Reply-To header is added.

### Scenario B: One mailbox sends through an alias

Given SMTP username `owner@example.com`, From `sales@example.com`, and an empty
Reply-To, when the user sends a test email and the provider allows the alias,
then the SMTP login is `owner@example.com`, the received From is
`sales@example.com`, and Reply targets `sales@example.com`.

### Scenario C: Replies route to another address

Given SMTP username `owner@example.com`, From `sales@example.com`, and Reply-To
`support@example.com`, when a message is sent, then recipients see From
`sales@example.com` and their mail client replies to `support@example.com`.

### Scenario D: Several aliases share one login

Given three imported rows with unique names and From addresses but the same SMTP
username, host, port, and password, when import completes, then all three records
exist and can be selected independently.

### Scenario E: Old import file remains valid

Given a legacy CSV has `from` but no `smtpUsername` or `replyTo`, when it creates
a service, then SMTP username defaults to From and Reply-To defaults to empty.

### Scenario F: Safe export updates without a password

Given a safe export omits passwords and a matching service name already exists,
when the file is re-imported, then the stored SMTP password is preserved and the
non-secret fields update normally.

### Scenario G: Safe export cannot create credentialless service

Given a safe export is imported on a new installation and its rows have no
password, when import runs, then each new row is skipped with a password-required
error and no incomplete service is created.

### Scenario H: Missing import column does not erase Reply-To

Given an existing service has Reply-To `support@example.com` and an imported row
does not contain a Reply-To column/property, when the row updates by name, then
the existing Reply-To remains unchanged.

### Scenario I: Blank import value clears Reply-To

Given an existing service has Reply-To `support@example.com` and an imported row
contains a blank `replyTo`, when the row updates by name, then Reply-To is stored
as null and future messages omit the header.

### Scenario J: Provider rejects an unapproved alias

Given authentication succeeds but the provider rejects From
`sales@example.com`, when Test Email runs, then the test fails with From-alias
guidance and the UI does not report the connection as verified for that alias.

### Scenario K: Identity changes after review

Given a draft was approved with From `sales@example.com` and no Reply-To, when
the service is changed to Reply-To `support@example.com`, then the old approval
cannot send and the user must review the updated identity.

## 17. Testing Requirements

### 17.1 Unit and module tests

- Database migration and legacy fallback behavior.
- SMTP transport uses SMTP username for `auth.user`.
- SMTP transport falls back to From for legacy rows.
- Standard sender and reply sender set From and optional Reply-To correctly.
- Receive username fallback order.
- Validation for required SMTP username, From, optional Reply-To, length, and
  header-injection characters.
- Create/update password-sentinel behavior.
- Duplicate detection permits several aliases on one login.
- Canonical envelope serialization and hash-version fixtures.
- Send-time mismatch checks for SMTP username, From, and Reply-To.

### 17.2 Import/export tests

- CSV and JSON safe exports contain the new non-secret fields and no passwords.
- CSV and JSON export field parity.
- Legacy import without new columns.
- Canonical and compatibility field names.
- Multiple alias rows sharing credentials.
- Existing-row blank password preservation.
- New-row missing password rejection.
- Missing versus blank Reply-To behavior.
- Missing versus blank SMTP username behavior.
- Partial import, row numbering, error cap, BOM, structural CSV/JSON errors, TLS
  values, and unknown-field stripping remain covered.

### 17.3 Component and IPC tests

- Create and edit forms render all three identity fields.
- Existing legacy records display the effective SMTP username.
- Test Email sends the service ID and all identity fields while preserving the
  hidden-password sentinel.
- Import success, partial success, cancel, invalid file, and no valid rows remain
  localized and correctly styled.
- IPC update merges omitted fields without erasing SMTP username or Reply-To.
- All six language files contain the new keys.

### 17.4 End-to-end tests

- Create a service whose SMTP username differs from From, send a test message,
  and inspect the received headers using a controlled fake SMTP server.
- Import two aliases sharing one SMTP login and send through each.
- Approve an outbound draft, change Reply-To, and verify delivery is blocked.
- Reply to a received message and verify inbound recipient selection remains
  independent from configured outbound Reply-To.

## 18. Rollout and Migration

### Phase 1: Schema and compatibility

- Add nullable columns and shared types.
- Add the effective SMTP username fallback.
- Keep old records and old import files operational.

### Phase 2: Import/export and UI

- Add the new form fields and translations.
- Add canonical and compatibility import mappings.
- Change update imports so absent/blank passwords preserve stored credentials.
- Align safe CSV and JSON export fields.

### Phase 3: Send paths and authorization

- Update all transport and worker payloads.
- Add From and Reply-To to standard and reply messages.
- Version frozen envelope hashing and enforce identity mismatches.

### Phase 4: Verification and release

- Run unit, component, IPC, worker, and end-to-end tests.
- Manually verify at least one provider-approved alias and one rejected alias.
- Confirm that logs, exports, and error messages contain no passwords.

Rollback must retain the new nullable columns. Older application versions can
ignore them, while a rollback migration that deletes identity values is not
required and should not run automatically.

## 19. Success Metrics

- Test Email succeeds when SMTP username and an approved From alias differ.
- No regression in send success for legacy records where SMTP username is absent.
- Zero plaintext SMTP passwords in exported files, IPC responses, or logs.
- Safe exports re-import successfully for matching services without passwords.
- New services without passwords remain blocked.
- Identity changes after approval produce deterministic re-review requirements.
- Import error rates can be separated by missing password, invalid SMTP username,
  invalid From, invalid Reply-To, and provider rejection.

## 20. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Provider does not allow the alias | Send fails after authentication | Real Test Email and alias-specific guidance |
| Legacy path still uses From for authentication | Alias support works inconsistently | Inventory and tests for every send path |
| Safe export is mistaken for a full backup | New-install imports lack credentials | Clear password-required errors and documentation |
| Omitted import fields erase identity data | Existing services change silently | Preserve-on-absence semantics and tests |
| Blank and missing values are conflated | Users cannot intentionally clear Reply-To safely | Track property/header presence during parsing |
| Reply-To changes after approval | Recipient replies route somewhere unreviewed | Versioned hash and send-time identity match |
| Several rows duplicate encrypted passwords | Credential rotation requires repeated updates | Accept for this release; evaluate normalized identities later |

## 21. Future Considerations

Consider a normalized mailbox-and-sender-identity model when one or more of
these triggers occur:

- Users commonly manage more than five aliases per mailbox.
- Credential rotation across duplicate alias rows becomes error-prone.
- Provider APIs can discover and verify aliases automatically.
- Per-alias reputation, quotas, DKIM profiles, or inbound routing are required.
- Administrators need centralized mailbox ownership with delegated identities.

That future model should migrate existing service rows without changing their
service IDs or invalidating historical send logs unnecessarily.

## 22. Definition of Done

This feature is complete when:

- The data model, form, import/export contract, and every send path represent
  SMTP username, From, and Reply-To separately.
- Existing services and legacy imports remain operational without manual
  migration.
- Safe exports update existing services without requiring passwords and cannot
  create credentialless services.
- Aliases sharing one SMTP login remain separate selectable records.
- Test Email provides actionable provider-rejection feedback.
- Outbound and reply authorization fail closed after identity changes.
- All required unit, component, IPC, worker, and end-to-end tests pass.
- All six supported languages contain the new user-facing text.
- No password is exposed through the renderer, export, logs, or errors.
