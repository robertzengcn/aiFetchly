# Separate SMTP Login, From, and Reply-To - Technical Design

## Document Information

| Field | Value |
|---|---|
| Status | Proposed |
| Created | 2026-09-09 |
| Owner | AiFetchly Engineering |
| Product specification | [Separate SMTP Login, From, and Reply-To PRD](./email-service-from-reply-to-prd.md) |
| Target application | AiFetchly Electron application |
| Primary stack | TypeScript, Electron, Vue 3, TypeORM, SQLite, Nodemailer, Zod, Papa Parse |
| Security boundary | Main-process validation and authorization; no worker database access |

## 1. Purpose

This document translates the approved product requirements into an
implementation architecture for separating three email identities:

```text
SMTP username  = the account used to authenticate
From address   = the sender recipients see
Reply-To       = the optional address that receives responses
```

The design extends each existing `email_service` record. It does not introduce
separate mailbox and sender-identity tables. Several alias records may share one
SMTP username, host, and password while retaining distinct From and Reply-To
values.

The design covers persistence, backward compatibility, import/export, renderer
contracts, SMTP delivery, bulk workers, AI outbound authorization, inbound reply
delivery, error classification, tests, rollout, and rollback.

## 2. Scope

### 2.1 In scope

- Add nullable `smtpUsername` and `replyTo` fields to email services.
- Resolve a complete effective identity for legacy and new records.
- Validate identity fields at module and process boundaries.
- Update create, edit, Test Email, list, import, and export behavior.
- Preserve stored passwords when an existing service is imported without one.
- Apply the identity to standard, bulk, AI-authorized, and reply sends.
- Bind SMTP username, From, and Reply-To to new outbound approvals.
- Support legacy approved envelopes under explicit fail-closed rules.
- Update inbound receive-username fallback.
- Add stable error categories and localized messages.
- Add unit, component, IPC, worker, integration, and fake-SMTP tests.

### 2.2 Out of scope

- Separate mailbox-account and sender-identity entities.
- Provider APIs for alias discovery or verification.
- SPF, DKIM, DMARC, or DNS management.
- Sender display names.
- Configurable SMTP envelope sender, Return-Path, or Nodemailer `sender` header.
- Shared encrypted credential records across alias services.
- A new delivery-retry policy.
- Reply-All or recipient-selection changes.
- Replacing TypeORM `synchronize: true` with a migration framework.

## 3. Existing System Findings

### 3.1 Email-service persistence

`src/entity/EmailService.entity.ts` currently stores `from`, password, SMTP
connection settings, and optional IMAP/POP3 settings. `src/config/SqliteDb.ts`
registers the entity with TypeORM and enables `synchronize: true`; the project
does not currently register explicit TypeORM migrations.

`EmailServiceModel` owns database access. `EmailServiceModule` encrypts and
decrypts SMTP and receive passwords and provides business validation. The
controller maps renderer/import data to entities. IPC handlers must not access
the database directly.

### 3.2 Current identity conflation

`buildSmtpTransportOptions()` currently maps `param.from` to Nodemailer's
`auth.user`. `EmailService` and `ReplyEmailService` also map the same field to
the message From header. Receive configuration falls back from an empty
`receiveUsername` to `from`.

The result is one value serving authentication, visible sending, and inbound
login defaults.

### 3.3 Import and export

The merged import implementation:

- accepts CSV and JSON;
- lowercases CSV headers;
- uses a strict write whitelist;
- upserts by service name;
- validates before looking up the existing row;
- requires password during that validation;
- overwrites the SMTP password on update;
- preserves receive password and omitted receive protocol;
- imports valid rows while reporting invalid rows;
- caps displayed errors at ten; and
- hides malformed-file detail from the renderer to avoid echoing credentials.

Safe export omits passwords. CSV exports connection fields, while the current
JSON projection contains fewer fields. A password-free safe export therefore
cannot currently pass import validation even when it targets an existing row.

### 3.4 Outbound authorization

`OutboundEmailEnvelopeHasher` currently hashes a version-1 envelope containing
service ID, sender, recipient, subject, text, and HTML. The current authorized
worker payload is version 2 and carries version-1 envelope hashes plus decrypted
email-service rows.

The main process freezes and verifies envelopes before starting the utility
process. The worker validates the payload, validates service rows, recomputes
each hash and the batch hash, then sends without database access.

### 3.5 Reply authorization

Email replies use immutable revisions and `EmailReplyRevisionHasher` to bind an
approval to sender, recipient, content, mailbox, and policy versions.
`EmailReplySendBinding` confirms that the revision sender matches
`service.from`, but the revision contains no SMTP username or configured
Reply-To snapshot.

## 4. Architectural Decisions

### AD-001: One record remains one selectable sending identity

Each email-service record contains its own SMTP login, From, and Reply-To. Two
records may share authentication values. The record ID remains the stable
selection and audit identity.

This avoids a new relationship model and preserves existing campaign and reply
foreign keys. The trade-off is duplicated encrypted passwords when several
aliases use one mailbox.

### AD-002: Legacy compatibility is resolved, not eagerly migrated

The new database columns are nullable. A missing SMTP username resolves to the
stored From address. A missing Reply-To resolves to `null`.

Existing rows are not rewritten during startup. This avoids a large credential
rewrite and keeps rollback safe. A record naturally persists explicit values
when the user edits it or an import supplies them.

### AD-003: One pure resolver owns fallback and normalization

All runtime paths call one pure `EmailServiceIdentityResolver`. No controller,
worker, or mail sender may implement its own `smtpUsername || from` rule.

The resolver does not read the database, decrypt credentials, or decide whether
an identity is authorized. It accepts one service-like object and returns a
normalized identity or a typed validation failure.

### AD-004: Validation uses operation context

Password requirements differ between creation and update. Validation therefore
accepts an explicit operation context rather than inferring intent from empty
strings.

```typescript
type EmailServiceValidationMode = "create" | "update" | "send";
```

Create requires a password. Update permits the empty credential sentinel only
after the stored password has been resolved. Send requires a real decrypted
password.

### AD-005: Import preserves field presence

Import must distinguish an absent property/header from a present empty value.
The parser produces a patch plus field-presence metadata. The controller merges
that patch with an existing entity before module validation.

This is required to preserve a stored Reply-To when a legacy file omits the new
column while still allowing an explicit blank Reply-To to clear it.

### AD-006: New approvals use envelope schema version 2

New outbound and reply revisions bind SMTP username and Reply-To in addition to
the existing envelope. Stored revisions receive an `envelopeVersion` field.

Version-1 and version-2 canonicalizers remain separate. Existing hashes are
never reinterpreted with new fields.

### AD-007: Authorized worker payload version increases to 3

The existing authorized payload version 2 carries version-1 envelopes. A new
payload version 3 carries version-2 envelopes with SMTP username and Reply-To.
The utility process accepts a discriminated union and routes to the matching
verification logic.

This avoids silently changing the meaning of a deployed payload version.

### AD-008: Provider rejection is discovered by real submission

Transport connection or authentication verification does not prove that a
provider allows the selected From alias. Test Email continues to perform a real
message submission and reports the provider's sanitized sender-policy response.

### AD-009: Main process remains authoritative

The main process loads and decrypts email-service records, validates approval
bindings, builds worker payloads, and persists outcomes. The worker validates
the supplied payload and submits SMTP messages only. It never reads or writes
SQLite.

## 5. Target Architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Renderer                                                            │
│ EmailServiceDetail.vue                                              │
│ smtpUsername + from + replyTo + password sentinel                  │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ validated IPC payload
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Main process                                                        │
│ EmailMarketing IPC                                                  │
│   -> EmailMarketingController                                      │
│      -> EmailServiceModule                                          │
│         -> EmailServiceIdentityResolver                             │
│         -> EmailServiceModel -> SQLite                              │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ resolved service identity
             ┌─────────────┼────────────────────┬───────────────────┐
             ▼             ▼                    ▼                   ▼
       Test/standard   inbound receive     reply delivery     outbound draft
       message send    login fallback      + approval hash    + approval hash
             │                                  │                   │
             ▼                                  ▼                   ▼
       Nodemailer SMTP                    main-process SMTP    payload v3 build
                                                                    │
                                                                    ▼
                                                        utility process worker
                                                        validate + rehash + SMTP
```

### 5.1 Trust boundaries

| Boundary | Input trust | Required control |
|---|---|---|
| Renderer to main IPC | Untrusted | Zod schema, trimming, size and character limits |
| Import file to controller | Untrusted | Parser limits, whitelist, presence tracking, row validation |
| Database to service | Trusted storage, possibly legacy | Credential decryption and effective-identity resolution |
| Main process to worker | Untrusted cross-process serialization | Versioned Zod payload and service schemas |
| Worker to SMTP server | External | TLS policy, provider error classification, uncertain-delivery handling |
| Worker event to main process | Untrusted cross-process serialization | Existing typed event schema and correlation checks |

## 6. Data Model

### 6.1 Email service

Update `src/entity/EmailService.entity.ts`:

```typescript
@Column({ type: "varchar", length: 255, nullable: true })
smtpUsername: string | null;

@Column({ type: "varchar", length: 320, nullable: true })
replyTo: string | null;
```

Keep the existing `from` property and column unchanged. Renaming it would force
changes across historical data, UI contracts, campaign code, and approval
records without providing user value.

Column behavior:

| Column | Existing row after sync | New canonical row |
|---|---|---|
| `smtpUsername` | `NULL` | Trimmed provider login |
| `from` | Existing value | Trimmed email address |
| `replyTo` | `NULL` | Trimmed email address or `NULL` |

No unique constraint is added to SMTP username, From, or their pair. Multiple
services may intentionally share them. Existing name-based update behavior
remains the application-level import key.

### 6.2 Shared service type

Update `EmailServiceEntitydata`:

```typescript
export type EmailServiceEntitydata = {
  id?: number;
  smtpUsername?: string | null;
  from: string;
  replyTo?: string | null;
  password: string;
  host: string;
  port: string;
  name: string;
  ssl: number;
  // existing receive fields remain unchanged
};
```

The new fields stay optional in cross-version shared types because legacy rows,
fixtures, and payloads may omit them. New create schemas enforce the effective
requirements.

### 6.3 Outbound draft revision

Update `OutboundEmailDraftRevisionEntity` with:

```typescript
@Column("integer", { default: 1 })
envelopeVersion: 1 | 2;

@Column("varchar", { length: 255, nullable: true })
smtpUsername: string | null;

@Column("varchar", { length: 320, nullable: true })
replyToAddress: string | null;
```

For existing rows, `envelopeVersion = 1`, `smtpUsername = null`, and
`replyToAddress = null`. New revisions always use version 2 and store the
effective SMTP username plus explicit Reply-To snapshot.

### 6.4 Reply draft revision

Add the same three fields to `EmailReplyDraftRevisionEntity`. The reply
revision's service ID remains on the draft aggregate and approval envelope.
The immutable revision stores the identity values used to compute its hash.

### 6.5 Schema synchronization

`SqliteDb` currently uses `synchronize: true`. The implementation adds nullable
entity columns and verifies synchronization against a database created with the
old entity shape.

Required integration test:

1. Create a temporary SQLite database with the pre-feature `email_service` and
   revision tables.
2. Insert a legacy service and one legacy revision.
3. Initialize the current `SqliteDb` data source.
4. Assert the new columns exist and contain their defaults.
5. Assert the old values and foreign-key relationships remain intact.

No destructive down migration is added.

## 7. Identity Resolution

### 7.1 New resolver

Create `src/modules/lib/EmailServiceIdentityResolver.ts`:

```typescript
export interface EmailServiceIdentityInput {
  readonly smtpUsername?: string | null;
  readonly from: string;
  readonly replyTo?: string | null;
  readonly receiveUsername?: string | null;
}

export interface ResolvedEmailServiceIdentity {
  readonly smtpUsername: string;
  readonly fromAddress: string;
  readonly replyToAddress: string | null;
  readonly receiveUsername: string;
}

export function resolveEmailServiceIdentity(
  input: EmailServiceIdentityInput
): ResolvedEmailServiceIdentity;
```

Resolution rules:

```typescript
const fromAddress = input.from.trim();
const smtpUsername = input.smtpUsername?.trim() || fromAddress;
const replyToAddress = input.replyTo?.trim() || null;
const receiveUsername =
  input.receiveUsername?.trim() || smtpUsername || fromAddress;
```

The resolver returns normalized strings. It does not lowercase SMTP usernames,
because providers may treat non-email login identifiers as case-sensitive. It
does not silently repair invalid From or Reply-To addresses; validation owns
that decision.

### 7.2 Header-injection defense

Create a shared predicate:

```typescript
export function containsEmailHeaderBreak(value: string): boolean {
  return value.includes("\r") || value.includes("\n");
}
```

Validation rejects CR or LF before any value reaches Nodemailer or a hash
canonicalizer. This applies even if another email parser would later reject the
same input.

### 7.3 Email address normalization for hashing

Keep version-1 canonicalizers unchanged. Version 2 uses a shared function that:

1. trims surrounding whitespace;
2. preserves the local part exactly; and
3. lowercases only the domain part.

SMTP username normalization for hashing trims only. Text fields continue to
normalize CRLF and CR to LF. Null Reply-To uses an explicit null token so it
cannot collide with an empty string.

## 8. Validation Architecture

### 8.1 Validation input

Extend `EmailServiceModule.validateEmailService()` or replace it with a more
explicit method:

```typescript
export interface ValidateEmailServiceOptions {
  readonly mode: "create" | "update" | "send";
  readonly hasStoredPassword?: boolean;
}

validateEmailService(
  service: EmailServiceEntity,
  options: ValidateEmailServiceOptions
): Promise<{ valid: boolean; errors: EmailServiceValidationError[] }>;
```

Use stable field/error codes internally:

```typescript
type EmailServiceValidationCode =
  | "service_name_required"
  | "smtp_username_required"
  | "smtp_username_too_long"
  | "from_required"
  | "from_invalid"
  | "reply_to_invalid"
  | "email_header_break_forbidden"
  | "password_required"
  | "host_required"
  | "port_required"
  | "port_invalid"
  | "receive_config_invalid";
```

The controller can format row-level import errors, while the renderer maps
stable codes to localized messages.

### 8.2 Field rules

| Field | Rule |
|---|---|
| Name | Trimmed, non-empty, existing length constraint |
| SMTP username | Effective value non-empty, maximum 255, no CR/LF |
| From | Single valid email, maximum 255 to match the existing column, no CR/LF |
| Reply-To | Empty/null allowed; otherwise single valid email, maximum 320, no CR/LF |
| Password | Required for create/send; update may reuse stored value |
| Host | Trimmed, non-empty |
| Port | Integer from 1 through 65535 |
| SSL | Existing 0/1 behavior |

SMTP username deliberately does not require email syntax.

### 8.3 Receive validation

When receive is enabled, username resolution becomes:

```text
explicit receiveUsername
  -> effective SMTP username
  -> From address
```

Receive password behavior stays:

```text
explicit receivePassword -> SMTP password
```

IMAP/POP3 host, port, protocol, folder, and TLS validation remain unchanged.

## 9. Create and Update Flow

### 9.1 Renderer update

The renderer sends optional identity fields through the existing
`EMAILSERVICEUPDATE` channel. The Zod input schema must explicitly define and
bound `smtpUsername`, `from`, and `replyTo`; it must not depend only on
`.passthrough()` for these security-relevant fields.

### 9.2 Main-process merge

For an existing service:

```text
Validate IPC shape
  -> load raw stored entity in main process
  -> merge non-secret fields
  -> empty password means keep stored encrypted/decrypted value
  -> resolve and normalize identity
  -> validate complete entity in update mode
  -> EmailServiceModule.updateEmailService()
```

For a new service:

```text
Validate IPC shape
  -> map fields
  -> smtpUsername blank/omitted becomes From
  -> Reply-To blank becomes null
  -> validate in create mode
  -> EmailServiceModule.createEmailService()
```

### 9.3 Duplicate behavior

Import continues to upsert by name. UI create/update keeps explicit ID and name
matching. The existing host-plus-From fallback may identify an older duplicate,
but it must compare the visible From, not SMTP username. Two aliases with the
same host and login but different From values must remain separate.

## 10. Import Architecture

### 10.1 Parser output

Replace the entity-only mapper with a presence-aware internal structure:

```typescript
type EmailServiceImportField =
  | "name"
  | "smtpUsername"
  | "from"
  | "replyTo"
  | "host"
  | "port"
  | "password"
  | "ssl"
  | "receiveProtocol";

interface ParsedEmailServiceImportRow {
  readonly values: Partial<EmailServiceEntitydata>;
  readonly presentFields: ReadonlySet<EmailServiceImportField>;
}
```

This structure remains inside the main process and does not cross IPC.

### 10.2 Header aliases

Normalize keys before mapping:

| Normalized key | Accepted source keys |
|---|---|
| `smtpUsername` | `smtpUsername`, `smtpusername`, `smtp_username` |
| `replyTo` | `replyTo`, `replyto`, `reply_to` |
| `receiveProtocol` | `receiveProtocol`, `receiveprotocol`, `receive_protocol` |

CSV remains case-insensitive. JSON accepts canonical camelCase plus the listed
compatibility aliases. If two aliases for one field appear in the same row with
different non-empty values, reject the row with `duplicate_field_conflict`
instead of choosing by property order.

### 10.3 Import algorithm

```typescript
for (const parsedRow of parsedRows) {
  const name = requiredString(parsedRow, "name");
  const existing = await module.findEmailServiceByName(name);

  const candidate = existing
    ? mergeImportUpdate(existing, parsedRow)
    : buildImportCreate(parsedRow);

  const mode = existing ? "update" : "create";
  const validation = await module.validateEmailService(candidate, {
    mode,
    hasStoredPassword: Boolean(existing?.password),
  });

  if (!validation.valid) {
    recordRowError(validation.errors);
    continue;
  }

  if (existing) await module.updateEmailService(existing.id, candidate);
  else await module.createEmailService(candidate);
}
```

The existing lookup must happen before complete validation because password
requirements depend on whether the row creates or updates a service.

### 10.4 Merge matrix

| Field | New service: absent | New service: blank | Existing: absent | Existing: blank |
|---|---|---|---|---|
| SMTP username | Use From | Use From | Preserve stored/fallback | Reset to From fallback |
| Reply-To | `null` | `null` | Preserve stored | Clear to `null` |
| Password | Reject | Reject | Preserve stored | Preserve stored |
| From | Reject | Reject | Reject | Reject |
| Name | Reject | Reject | Reject | Reject |
| Host | Reject | Reject | Reject | Reject |
| Port | Reject | Reject | Reject | Reject |
| SSL | Existing default `1` | Existing default `1` | Existing behavior | Existing behavior |
| Receive protocol | Default `imap` | Default `imap` | Preserve stored | Preserve stored |

Passwords are a special case: a blank import value never means clear. Deleting
or disabling credentials requires a separate explicit product flow.

### 10.5 Error handling

Preserve current partial-import behavior. Field-count errors stay row-scoped;
malformed CSV/JSON remains file-scoped. Row errors contain a row number, stable
field code, and safe explanation. They never include raw rows, passwords,
decrypted entity values, or file paths.

## 11. Export Architecture

### 11.1 Shared projection

Create one safe projection function used by CSV and JSON:

```typescript
interface SafeEmailServiceExportRow {
  id: number;
  name: string;
  smtpUsername: string;
  from: string;
  replyTo: string | null;
  host: string;
  port: string;
  ssl: number;
  receiveProtocol: EmailReceiveProtocol;
  create_time: string;
}
```

The projection uses the effective SMTP username so legacy rows export a usable
login identifier. It never contains SMTP or receive passwords.

### 11.2 Format parity

Both formats expose the same fields and values. CSV emits `replyTo` as an empty
field when null. JSON emits `replyTo: null`. CSV escaping, trailing newline,
timestamps, and current save-dialog behavior remain unchanged.

### 11.3 Safe export is not a credential backup

An export can update services with matching names because update imports
preserve stored passwords. On a fresh installation, rows without passwords are
rejected. Import UI errors explain this without suggesting that the application
export secrets.

## 12. Renderer and IPC Design

### 12.1 Form state

Update `servicedetail.vue` with:

```typescript
const smtpUsername = ref("");
const from = ref("");
const replyTo = ref("");
```

On legacy detail load:

```typescript
smtpUsername.value = res.smtpUsername?.trim() || res.from;
from.value = res.from;
replyTo.value = res.replyTo ?? "";
```

On submit and Test Email, include the three values. Convert blank Reply-To to
`null`. Keep the edit-mode password sentinel and service ID behavior.

### 12.2 Field order and copy

The form order is SMTP Username, From Address, Reply-To Address, Password, host,
port, and TLS. This makes the distinction visible before users enter a password.

Every label, hint, validation message, import message, and provider-error
category must be translated in:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

### 12.3 List projection

Keep service ID, name, From, and creation time in the default table to avoid
adding width. The detail form is the authoritative configuration view. A later
table-column chooser may expose SMTP username and Reply-To, but it is not
required for this release.

### 12.4 IPC schemas

Update `src/schemas/ipc/emailMarketing.ts` so email-service update input has:

```typescript
smtpUsername: z.string().max(255).nullable().optional(),
from: z.string().min(1).max(255),
replyTo: z.string().max(320).nullable().optional(),
```

The module still performs semantic email validation and CR/LF rejection. The
IPC schema provides size and primitive-type bounds before controller work.

## 13. SMTP Transport and Message Construction

### 13.1 Transport authentication

Update `buildSmtpTransportOptions()`:

```typescript
const identity = resolveEmailServiceIdentity(param);

return {
  host: param.host,
  port,
  secure: useImplicitTls,
  requireTLS: requireTls,
  auth: {
    user: identity.smtpUsername,
    pass: param.password,
  },
};
```

TLS mode selection, wrong-version detection, alternate-mode retry, transporter
error listener, and session reuse remain unchanged.

### 13.2 Standard message

`EmailService` stores a resolved identity, not only `emailSender`:

```typescript
const mailOptions: nodemailer.SendMailOptions = {
  from: identity.fromAddress,
  ...(identity.replyToAddress
    ? { replyTo: identity.replyToAddress }
    : {}),
  to: request.Receiver,
  subject: request.Title,
  text: request.Content,
};
```

Nodemailer's `sender` option is not used. No custom envelope is supplied, so
Nodemailer/provider default envelope behavior remains intact.

### 13.3 Reply message

`ReplyEmailService` uses the same identity mapping while preserving HTML,
`In-Reply-To`, `References`, and `Re:` normalization.

The inbound message's `replyToAddress` still determines `data.receiver`. The
service's configured `replyTo` becomes the header on the newly sent reply.

### 13.4 Test Email

The existing test path resolves a stored password by service ID, then builds the
same transport and message options as production. Test code must not use a
separate partial mapping that can drift from production behavior.

## 14. Send-Path Inventory

| Path | Current entry | Required change |
|---|---|---|
| Form Test Email | `EmailMarketingController.sendEmail()` | Carry/resolve all identity fields |
| Standard email | `EmailService.sendEmail()` | Set From and optional Reply-To |
| Legacy bulk campaign | `EmailSend.send()` | Preserve new fields when copying selected service |
| AI authorized batch | `OutboundEmailWorkerStarter` | Build v3 envelopes and service rows |
| Authorized worker | `EmailSend.sendAuthorizedEnvelopes()` | Validate v3, rehash v2 envelope, set Reply-To |
| Email reply | `EmailReplyDeliveryService` and `ReplyEmailService` | Bind identity snapshot and set Reply-To |
| IMAP/POP3 receive | `EmailServiceModule.getEmailServiceReceiveConfig()` | Use new receive fallback order |

Every row in this inventory requires a focused test proving authentication and
headers do not reuse the wrong field.

## 15. Outbound Envelope Version 2

### 15.1 Canonical type

Keep `CanonicalOutboundEnvelopeV1` unchanged. Add:

```typescript
export interface CanonicalOutboundEnvelopeV2 {
  version: 2;
  emailServiceId: number;
  smtpUsername: string;
  senderAddress: string;
  replyToAddress: string | null;
  recipientAddress: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
}
```

### 15.2 Canonical field order

```text
version
emailServiceId
smtpUsername
sender
replyTo
recipient
subject
bodyText
bodyHtml
```

Continue using length-prefixed text values. Use distinct null tokens for
Reply-To and HTML. Do not include passwords, timestamps, draft IDs, revision
IDs, or database update times in an envelope hash.

### 15.3 Hasher API

Expose version-specific functions and a safe dispatcher:

```typescript
hashEnvelopeV1(envelope: CanonicalOutboundEnvelopeV1): string;
hashEnvelopeV2(envelope: CanonicalOutboundEnvelopeV2): string;
hashBatchV1(entries: BatchEnvelopeEntryV1[]): string;
hashBatchV2(entries: BatchEnvelopeEntryV2[]): string;
```

Batch prefixes must differ:

```text
outbound-batch:v1
outbound-batch:v2
```

Tests pin canonical strings and hashes for both versions. Version-1 fixtures
must remain byte-for-byte unchanged.

### 15.4 Revision creation

`resolveOutboundSender()` becomes an identity resolver rather than returning
only sender address:

```typescript
export interface ResolvedOutboundIdentity {
  readonly emailServiceId: number;
  readonly smtpUsername: string;
  readonly senderAddress: string;
  readonly replyToAddress: string | null;
}
```

`OutboundEmailDraftService` stores these values in each new revision, sets
`envelopeVersion = 2`, computes the v2 hash, and computes a v2 batch hash.

### 15.5 Preflight and delivery

Preflight reconstructs the envelope according to `revision.envelopeVersion`.
Delivery repeats the same reconstruction inside its transaction before
authorization consumption. A missing or unknown version blocks delivery.

Before starting a v2 worker, reload each referenced email service and compare
its resolved identity to the immutable revision:

- service ID equals revision service ID;
- SMTP username matches after trim-only normalization;
- From matches email-address normalization; and
- Reply-To matches including null.

Any mismatch returns a stable `sender_identity_changed` finding and does not
consume SMTP submission capacity.

## 16. Worker Payload Version 3

### 16.1 Schema

Add `authorizedEmailWorkerPayloadV3Schema`:

```typescript
const authorizedOutboundEnvelopeV3Schema = z.object({
  envelopeVersion: z.literal(2),
  draftId: z.number().int(),
  revisionId: z.number().int(),
  revisionNumber: z.number().int(),
  recipientAddress: z.string().max(320),
  emailServiceId: z.number().int(),
  smtpUsername: z.string().min(1).max(255),
  senderAddress: z.string().min(1).max(320),
  replyToAddress: z.string().max(320).nullable(),
  subject: z.string().max(500),
  bodyText: z.string(),
  bodyHtml: z.string().nullable(),
  envelopeHash: z.string().length(64),
});

const authorizedEmailWorkerPayloadV3Schema = z.object({
  version: z.literal(3),
  mode: z.literal("authorized_envelopes"),
  batchId: z.number().int(),
  sendAttemptId: z.number().int(),
  batchHash: z.string().length(64),
  envelopes: z.array(authorizedOutboundEnvelopeV3Schema),
  emailServices: z.array(z.unknown()),
});
```

The action name remains `sendAuthorizedEmails`. The version discriminator
selects v2 or v3 payload validation.

### 16.2 Worker service schema

Extend the worker-local service schema:

```typescript
const workerEmailServiceV3Schema = z.object({
  id: z.number().int(),
  smtpUsername: z.string().min(1).max(255),
  from: z.string().min(1).max(255),
  replyTo: z.string().max(320).nullable(),
  password: z.string().min(1),
  host: z.string().min(1),
  port: z.string(),
  name: z.string(),
  ssl: z.number(),
});
```

The main process sends effective, non-null SMTP username and normalized
Reply-To. The worker validates that each envelope identity equals its referenced
service identity before creating a transporter.

### 16.3 SMTP mail shape

Extend `AuthorizedSmtpMail`:

```typescript
export interface AuthorizedSmtpMail {
  readonly from: string;
  readonly replyTo: string | null;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string | null;
}
```

The default sender factory maps non-null Reply-To to Nodemailer. Test fakes must
capture it.

### 16.4 Worker verification order

The worker performs these checks before the first SMTP call:

1. Validate the versioned payload.
2. Validate every service row.
3. Reject missing or duplicate service IDs.
4. Validate envelope size and required fields.
5. Compare envelope identity to its service row.
6. Recompute every v2 envelope hash.
7. Recompute the v2 batch hash.
8. Abort the whole batch on any mismatch.
9. Create one SMTP sender per distinct service.
10. Submit exact envelopes with existing concurrency limits.
11. Emit sanitized outcomes and close every sender.

## 17. Legacy Authorization Compatibility

### 17.1 Version-1 outbound revisions

A legacy approved batch may use the existing payload-v2 path only when every
current revision is version 1 and every referenced service satisfies:

```text
effective From == approved sender
effective Reply-To == null
effective SMTP username == approved sender
```

The SMTP-username condition preserves the authentication identity that version
1 implicitly assumed. If any condition fails, return
`legacy_identity_requires_review` and require a new revision/approval.

Do not recompute a version-1 approval with the version-2 canonicalizer.

### 17.2 Mixed-version batches

Do not send a batch containing both version-1 and version-2 current revisions.
When a legacy batch is edited or reviewed after this release, materialize
version-2 revisions for every current draft and compute one version-2 batch
hash. This keeps one batch under one canonicalization rule.

### 17.3 New revisions

Every revision created after the feature flag is enabled uses version 2. There
is no configuration option to create new version-1 revisions.

## 18. Reply Approval Version 2

### 18.1 Approval envelope

Add a versioned reply envelope instead of changing the current type in place:

```typescript
export interface EmailReplyApprovalEnvelopeV2 {
  version: 2;
  draftId: number;
  revisionId: number;
  emailServiceId: number;
  originalMessageId: number;
  smtpUsername: string;
  senderAddress: string;
  replyToAddress: string | null;
  recipientAddress: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  policyVersion: string;
  validationVersion: string;
}
```

Keep the version-1 reply canonicalizer and pinned fixtures unchanged. Add a
version-2 prefix or explicit leading version field and include SMTP username and
Reply-To before recipient.

### 18.2 Revision and binding

New reply revisions store the resolved service identity. At send time,
`EmailReplySendBinding` compares:

- revision and approval hashes;
- draft/message/service mailbox IDs;
- revision SMTP username against the current effective login;
- revision sender against the current From;
- revision Reply-To against the current configured Reply-To; and
- revision recipient against the inbound message's Reply-To or From.

The last rule remains independent from configured outgoing Reply-To.

### 18.3 Legacy reply approvals

Version-1 reply approval may send only when the current service's effective SMTP
username equals its From and configured Reply-To is null. Otherwise, invalidate
the approval and request review.

## 19. Error Classification

### 19.1 Shared classifier

Create a pure SMTP error classifier used by standard send, reply send, and the
authorized worker:

```typescript
export type SmtpFailureCode =
  | "smtp_auth_failed"
  | "smtp_from_rejected"
  | "smtp_recipient_rejected"
  | "smtp_tls_failed"
  | "smtp_connection_failed"
  | "smtp_submission_failed"
  | "delivery_unknown";

export interface ClassifiedSmtpFailure {
  readonly code: SmtpFailureCode;
  readonly retrySafety: "safe" | "unknown";
  readonly sanitizedMessage: string;
}
```

Classification uses structured Nodemailer fields such as `code`, `command`,
and `responseCode` before falling back to known response patterns.

### 19.2 Classification precedence

```text
AUTH command / EAUTH / 535                  -> smtp_auth_failed, safe
MAIL FROM / sender rejected / policy code   -> smtp_from_rejected, safe
RCPT TO / recipient rejected                -> smtp_recipient_rejected, safe
TLS or certificate before submission        -> smtp_tls_failed, safe
DNS/refused/unreachable before submission   -> smtp_connection_failed, safe
timeout/drop after uncertain DATA handoff    -> delivery_unknown, unknown
unrecognized state                          -> delivery_unknown, unknown
```

Existing `delivery_unknown` behavior remains fail-closed and is never
automatically retried.

### 19.3 Sanitization

Sanitization removes or replaces:

- SMTP and receive passwords;
- complete imported rows;
- file paths;
- authorization and approval tokens; and
- long provider responses beyond the configured log limit.

The UI receives a stable localized code plus an optional short sanitized
provider detail.

## 20. Security Analysis

### 20.1 Threats and controls

| Threat | Control |
|---|---|
| Header injection through imported identity | Reject CR/LF before persistence and sending |
| Alias spoofing | Provider-side enforcement plus real Test Email; no claim that syntax proves authorization |
| Credential exposure through export | One safe projection with no password fields |
| Credential exposure through import errors | Stable field codes; never echo raw rows |
| Renderer requests a changed identity after approval | Main-process reload and immutable identity comparison |
| Worker payload tampering | Zod validation, service/envelope identity match, independent hash recomputation |
| Service changes between preflight and send | Delivery-time reload followed by worker-time comparison |
| Legacy approval gains a new Reply-To silently | Compatibility gate requires Reply-To null |
| Worker accesses SQLite | No database imports or model calls in worker path |

### 20.2 Credential lifecycle

SMTP password encryption and decryption remain inside `EmailServiceModule`.
The renderer continues receiving `password: ""` as the unchanged sentinel. The
main process decrypts a service only for internal send/import-update work. The
worker receives the minimum credential-bearing service set needed for its batch
and releases transporter references on completion.

## 21. Observability

Add counters or structured audit codes for:

- `email_service_identity_legacy_fallback`;
- `email_service_import_password_preserved`;
- `email_service_import_new_password_missing`;
- `smtp_auth_failed`;
- `smtp_from_rejected`;
- `smtp_recipient_rejected`;
- `outbound_identity_changed`;
- `legacy_identity_requires_review`;
- `worker_identity_mismatch`; and
- `reply_identity_mismatch`.

Do not use the SMTP username or email address as a metric label. Audit rows may
reference the email-service ID and normalized non-secret identity fields when
required for support and compliance.

## 22. File-by-File Change Map

### 22.1 Persistence and domain types

| File | Change |
|---|---|
| `src/entity/EmailService.entity.ts` | Add nullable SMTP username and Reply-To columns |
| `src/entity/OutboundEmailDraftRevision.entity.ts` | Add envelope version and identity snapshot |
| `src/entity/EmailReplyDraftRevision.entity.ts` | Add envelope version and identity snapshot |
| `src/entityTypes/emailmarketingType.ts` | Extend service and export contracts |
| `src/entityTypes/outboundEmailDeliveryTypes.ts` | Add v2 envelope and payload-v3 schemas/types |
| `src/entityTypes/emailReplyReliabilityTypes.ts` | Add versioned reply approval envelope |
| `src/schemas/entity/outboundEmailDraftRevision.ts` | Validate new revision fields |
| `src/schemas/entity/emailReplyDraftRevision.ts` | Validate new reply revision fields |

### 22.2 Model, module, and controller

| File | Change |
|---|---|
| `src/modules/lib/EmailServiceIdentityResolver.ts` | New pure resolver and normalization helpers |
| `src/model/EmailService.model.ts` | Read complete identity and retain legacy From compatibility |
| `src/modules/emailServiceModule.ts` | Context-aware validation and receive fallback |
| `src/modules/interface/EmailServiceModuleInterface.ts` | Update method contracts |
| `src/controller/emailMarketingController.ts` | Presence-aware import, safe export parity, create/update mapping |

### 22.3 IPC and renderer

| File | Change |
|---|---|
| `src/schemas/ipc/emailMarketing.ts` | Bound explicit identity fields |
| `src/main-process/communication/emailMarketingIpc.ts` | Preserve/merge new fields through controller/module |
| `src/views/api/emailservice.ts` | Carry extended shared type |
| `src/views/pages/emailservice/servicedetail.vue` | Add fields, legacy fallback, validation, test payload |
| `src/views/lang/{en,zh,es,fr,de,ja}.ts` | Add labels, hints, and errors |

No new preload channel is required because existing email-service IPC channels
remain unchanged.

### 22.4 SMTP and delivery

| File | Change |
|---|---|
| `src/modules/lib/smtpTransport.ts` | Authenticate with effective SMTP username |
| `src/modules/lib/emailService.ts` | Set visible From and optional Reply-To |
| `src/modules/lib/replyEmailService.ts` | Set visible From and optional Reply-To |
| `src/modules/lib/smtpErrorClassifier.ts` | New shared stable failure classifier |
| `src/service/outboundEmail/resolveOutboundSender.ts` | Resolve complete identity |
| `src/service/outboundEmail/OutboundEmailEnvelopeHasher.ts` | Preserve v1 and add v2 canonicalization |
| `src/service/outboundEmail/OutboundEmailDraftService.ts` | Persist v2 revisions and hashes |
| `src/service/outboundEmail/OutboundEmailPreflightService.ts` | Version-aware reconstruction and checks |
| `src/service/outboundEmail/OutboundEmailDeliveryService.ts` | Recheck current identity before claim/start |
| `src/service/outboundEmail/OutboundEmailWorkerStarter.ts` | Build payload v2 or v3 and complete service rows |
| `src/service/emailReply/EmailReplyRevisionHasher.ts` | Preserve v1 and add v2 reply hash |
| `src/service/emailReply/EmailReplySendBinding.ts` | Compare SMTP username and Reply-To |
| `src/service/emailReply/EmailReplyDeliveryService.ts` | Build version-aware envelope and sender |
| `src/childprocess/emailSend.ts` | Validate/send payload v3 and carry Reply-To in legacy bulk copies |
| `src/taskCode.ts` | Accept the v2/v3 authorized payload union |

## 23. Test Design

### 23.1 Identity resolver tests

Create `test/vitest/utilitycode/EmailServiceIdentityResolver.test.ts`:

- configured SMTP username wins;
- blank/null SMTP username falls back to From;
- configured Reply-To is trimmed;
- blank Reply-To becomes null;
- receive username follows explicit, SMTP, From order;
- SMTP username case is preserved;
- resolver does not mutate input.

### 23.2 Module and persistence tests

Extend module/model tests:

- old database gains nullable columns without data loss;
- create persists explicit values;
- legacy read returns nullable fields;
- create validation requires effective SMTP username and password;
- update accepts the password sentinel only with stored credentials;
- send validation requires decrypted credentials;
- CR/LF, invalid From, and invalid Reply-To fail;
- same login/host with different From addresses creates separate services.

### 23.3 Import/export tests

Extend `test/modules/emailMarketingController.test.ts`:

- safe CSV and JSON have identical fields;
- no password appears in either format;
- legacy CSV defaults SMTP username to From;
- all documented header aliases map correctly;
- conflicting alias columns reject one row;
- missing new fields preserve existing identity;
- blank Reply-To clears it;
- blank SMTP username resets to From fallback;
- blank/missing password preserves an existing password;
- blank/missing password rejects a new service;
- multiple alias rows with one login import separately;
- existing BOM, row mismatch, TLS coercion, partial import, and error-cap tests
  continue to pass.

### 23.4 SMTP tests

Extend `smtpTransport.test.ts` and `EmailSendCompletion.test.ts`:

- transport `auth.user` uses SMTP username;
- legacy service uses From as login;
- From and Reply-To reach Nodemailer unchanged after trimming;
- omitted Reply-To does not produce an empty header;
- TLS retry keeps the same resolved identity;
- auth and sender rejections receive distinct codes;
- uncertain submission remains non-retryable.

### 23.5 Outbound authorization tests

Extend hasher, draft, preflight, delivery, worker starter, task-code, and worker
tests:

- version-1 pinned hashes remain unchanged;
- version-2 SMTP username and Reply-To affect the hash;
- null Reply-To differs from non-null Reply-To;
- version-2 batch ordering remains deterministic;
- payload v3 schema rejects missing identity fields;
- worker service/envelope mismatch aborts before SMTP;
- main and worker compute the same hashes;
- identity change after approval blocks delivery;
- compatible all-v1 batches use payload v2;
- incompatible v1 identity requires review;
- mixed current revision versions cannot send.

### 23.6 Reply tests

Extend reply hasher, binding, delivery, and fake-SMTP tests:

- version-1 hash fixtures remain unchanged;
- version-2 hash binds SMTP username and Reply-To;
- current service mismatch blocks before claim;
- inbound Reply-To still selects the recipient;
- configured outgoing Reply-To becomes the sent header;
- legacy approval compatibility rules are enforced.

### 23.7 Component tests

Extend `EmailServiceDetail.test.ts`:

- all three fields render;
- a legacy service displays From as SMTP username;
- edit submit carries SMTP username and Reply-To;
- clearing Reply-To submits null;
- Test Email carries identity and service ID;
- edit-mode hidden password still works;
- create mode still requires a password;
- translated labels resolve in every supported locale.

Extend `EmailServiceTable.test.ts` only where export/import messages or data
projections change.

### 23.8 End-to-end fake SMTP

Use the existing fake-SMTP pattern to verify actual message headers:

1. Authenticate with `mailbox@example.test`.
2. Send From `sales@example.test`.
3. Set Reply-To `support@example.test`.
4. Assert the fake server observed the login and message headers separately.
5. Simulate a MAIL FROM rejection and assert alias guidance.
6. Repeat through authorized outbound and reply paths.

## 24. Implementation Sequence

### Phase 1: Additive identity foundation

1. Add entity/type fields and synchronization tests.
2. Add the identity resolver and validation tests.
3. Update module and controller create/update mapping.
4. Commit as one complete compatibility unit.

Exit condition: legacy services resolve exactly as before; new identities can be
stored and loaded without sending changes.

### Phase 2: Import/export and UI

1. Add safe shared export projection and format parity.
2. Refactor import to presence-aware merge-before-validation.
3. Add UI fields and six-language translations.
4. Extend controller, IPC, and component tests.

Exit condition: old files import, password-free exports update existing rows,
and alias records can be created/tested from the form.

### Phase 3: SMTP and receive behavior

1. Update transport authentication.
2. Update standard and reply message headers.
3. Update legacy bulk service copying.
4. Update receive login fallback.
5. Add shared error classification.

Exit condition: all non-authorized send paths use the resolved identity and
focused tests pass.

### Phase 4: Outbound authorization v2

1. Add revision identity fields and version-2 hasher.
2. Update draft creation and preflight.
3. Add payload version 3 and worker validation.
4. Add delivery-time identity checks and legacy compatibility.

Exit condition: v2 identity is bound main-process-to-worker and mismatches fail
before SMTP.

### Phase 5: Reply authorization v2

1. Add reply revision identity fields and v2 hasher.
2. Update draft/revision construction.
3. Extend send binding and delivery service.
4. Add legacy compatibility tests.

Exit condition: reply approvals bind both authentication and visible reply
headers without changing inbound recipient selection.

### Phase 6: Cross-layer verification

1. Run focused unit/module/component suites after each phase.
2. Run full TypeScript and Vue type checks.
3. Run the full component gate.
4. Run fake-SMTP end-to-end scenarios.
5. Run all project tests required by CI.
6. Scan logs, exports, and IPC fixtures for secrets.

## 25. Verification Commands

Use the repository's existing scripts:

```bash
yarn test
yarn testmain
yarn test:components
yarn typecheck
yarn vue-typecheck
yarn test:e2e
```

Run focused Vitest files during implementation before the broader suites. A
documentation-only change does not require these commands, but every future UI
implementation commit must include and pass its component tests.

## 26. Rollout

### 26.1 Feature activation

The database and resolver changes are backward compatible and can ship enabled.
New version-2 revision creation should activate only after all producer and
consumer paths support it in the same release.

### 26.2 Startup behavior

On first startup after upgrade, TypeORM adds nullable columns. Startup must not
iterate through all email-service rows, decrypt credentials, or write fallback
values.

### 26.3 Pending work

- Existing unapproved drafts may be regenerated as version 2 when edited.
- Existing approved version-1 drafts use the strict compatibility gate.
- Identity-changing service edits do not mutate immutable revisions.
- A blocked approval remains auditable and requires a new review action.

### 26.4 Operational verification

Before general release, verify:

- one legacy same-login sender;
- one provider-approved alias with a different login;
- one alias with a different Reply-To;
- one provider-rejected alias;
- one password-free safe-export update;
- one new-row import missing a password; and
- one approved message blocked after identity change.

## 27. Rollback

Rollback keeps the nullable columns. An older application ignores them and
continues using From for SMTP authentication. This may make alias records unable
to send correctly on the older version, so release notes must warn against
rolling back after configuring different SMTP usernames.

Do not drop the columns automatically. Do not rewrite From from SMTP username.
Do not downgrade version-2 hashes to version 1. Version-2 pending approvals are
blocked by older code and require review after upgrading again.

## 28. Requirements Traceability

| PRD requirement | Technical sections |
|---|---|
| FR-001 form fields | 12 |
| FR-002 alias records | 6, 9 |
| FR-003 Test Email | 12, 13, 19 |
| FR-004 data contract | 6, 7 |
| FR-005 create/update | 8, 9 |
| FR-006 import compatibility | 10 |
| FR-007 missing/blank import values | 10.3, 10.4 |
| FR-008 import validation | 8, 10.5 |
| FR-009 SMTP separation | 13 |
| FR-010 send-path coverage | 14 |
| FR-011 reply behavior | 13.3, 18 |
| FR-012 frozen-envelope binding | 15, 16, 17 |
| FR-013 reply approval binding | 18 |
| FR-014 audit and logs | 19, 21 |

## 29. Definition of Done

Implementation is complete only when:

- nullable identity columns synchronize without losing legacy data;
- one resolver owns all effective identity fallback;
- import preserves absent fields and stored update passwords;
- safe CSV and JSON exports have matching non-secret fields;
- every send path authenticates with SMTP username and sets From/Reply-To
  independently;
- inbound recipient Reply-To remains separate from outgoing configured
  Reply-To;
- new outbound and reply approvals use version-2 identity-bound hashes;
- payload version 3 is independently verified by the worker;
- legacy approvals follow documented fail-closed compatibility rules;
- all six language files and required component tests are updated;
- focused and full verification suites pass; and
- no password, token, raw import row, or decrypted credential appears in
  renderer output, exports, logs, or worker events.
