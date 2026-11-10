# AI Email Forwarding, Trash, and Organization — Technical Design

- Version: 1.0
- Status: Proposed implementation design; new names/contracts below are not existing APIs
- Created: 2026-09-30
- Implements: [Product requirements](./ai-email-forward-trash-organization-prd.md)
- Baseline: repository working tree inspected on the date above

## 1. Design summary

Add dedicated forward and mailbox-action services behind the existing AI tool registry and renderer IPC boundary. Keep all database access in main-process Modules and Models. Add verified folder-aware message locations before enabling remote mutations. Treat an authorized action as a durable operation whose exact payload is frozen before external I/O.

SMTP submission and SQLite persistence cannot share an atomic transaction. IMAP moves and SQLite persistence cannot either. The design therefore records intent first, conditionally claims each action once, and reconciles ambiguous outcomes instead of blindly replaying commands.

The first release includes single-message forwarding with selected attachments and single-message Trash/restore. The later organization release adds bounded local/server search and bulk Trash/restore using the same operation records.

## 2. Existing implementation and reuse boundary

| Existing source | Observed behavior | Proposed treatment |
| --- | --- | --- |
| [EmailReceiveAiTools.ts](../../src/service/EmailReceiveAiTools.ts) | Inbox reads, local processed state, reply drafting and sending | Add a separate organization tool facade; keep current names and semantics. |
| [skillsRegistry.ts](../../src/config/skillsRegistry.ts) | Registers email tools and confirmation metadata | Register new tools and request-scoped mutation policy. |
| [EmailReceiveClient.ts](../../src/service/emailReceive/EmailReceiveClient.ts) | Connection test and bounded fetch; attachment metadata only | Keep receive interface; add a separate mailbox-action adapter. |
| [ImapEmailReceiveClient.ts](../../src/service/emailReceive/ImapEmailReceiveClient.ts) | Opens configured folder, fetches raw source, persists parsed values with string UID | Extend receive DTOs to capture folder and UID validity. |
| [EmailReceiveSyncService.ts](../../src/service/emailReceive/EmailReceiveSyncService.ts) | Runs in main process; current sync cap is 50 | Replace account/UID lookup with location lookup and share account serialization. |
| [EmailReceivedMessage.model.ts](../../src/model/EmailReceivedMessage.model.ts) | Upserts by account/provider UID; preserves processing state | Move provider identity lookup to the location model; preserve message IDs. |
| [EmailReplyApprovalService.ts](../../src/service/emailReply/EmailReplyApprovalService.ts) | Immutable revision approval, hashed token and envelope checks | Reuse approach and pure helpers where appropriate; do not reuse reply-only policy. |
| [EmailReplyDeliveryService.ts](../../src/service/emailReply/EmailReplyDeliveryService.ts) | Conditional send claim and explicit uncertain outcomes | Mirror reliability invariants with forward-specific entities. |
| [OutboundEmailIntentResolver.ts](../../src/service/outboundEmail/OutboundEmailIntentResolver.ts) | Resolves trusted user intent for outbound delivery | Add an organization-specific intent resolver; share provenance rules, not campaign semantics. |
| [smtpTransport.ts](../../src/modules/lib/smtpTransport.ts) | Existing SMTP transport infrastructure | Reuse validated transport configuration and error handling after adapter tests. |
| [ScheduledAiToolPolicy.ts](../../src/service/ScheduledAiToolPolicy.ts) | Full-access fast path follows a hard-block set | Add new external side effects to the hard-block set. |
| [SqliteDb.ts](../../src/config/SqliteDb.ts) | Entity registration, `synchronize: true`, empty migrations list | Introduce a versioned upgrade sequence for this identity change; do not assume migrations already run. |

Installed `imapflow` declarations expose `messageMove`, capabilities, special-use folder metadata, UID validity, and an optional destination UID map. These local declarations informed the design; they do not prove particular server behavior. Provider compatibility and library fallback behavior must be verified before release. No external provider compatibility claims are made here.

## 3. Architecture and process ownership

```text
Chat/tool execution                 Email list/detail/review UI
        |                                      |
Organization AI tools                   preload + validated IPC
        |                                      |
        +---------- Organization services -----+
                           |
              authorization + materialization
                           |
                   Modules -> Models -> SQLite
                           |
                 durable claim before I/O
                           |
                IMAP adapter / SMTP transport
                           |
                 result + reconciliation
                           |
                  Modules -> Models -> SQLite
                           |
                    sanitized DTO/event
```

### 3.1 Layer responsibilities

- IPC: AI-enable gate where applicable, schema validation, caller ownership checks, sanitized DTOs, Module/service calls. No TypeORM repositories or SQL.
- Tool facade: parse `unknown`, load trusted execution context, route to services, return typed results. A tool argument cannot supply an authorization token or trusted origin.
- Services: intent, capability checks, rendering, network orchestration, and recovery coordination. Persistent state changes go through Modules.
- Modules: transaction orchestration and business rules using Models; extend `BaseModule` where appropriate.
- Models: repositories, queries, conditional claims, uniqueness, and transaction implementation; follow `BaseDb`.
- Adapters: protocol I/O and typed results; no database access.

Resolve database paths through `Token` and `USERSDBPATH`. New code uses explicit return types, typed interfaces, and `unknown` catches; never add `any`.

### 3.2 Worker boundary

Initial bounded network operations remain asynchronous in the main process, consistent with current receive sync. Do not call synchronous network or parsing APIs on the UI path. Profile MIME parsing and attachment materialization at the configured limits. If offloading is needed, place all entry points and worker-only code under `src/childprocess/email-organization/`, register them in `forge.config.js`, and exchange typed operation messages. Workers never import Models/Modules for persistence or resolve Electron database paths. Main-process services claim operations and persist worker results.

Any worker lifecycle, timeout, or crash must feed the same unknown-outcome recovery path. A worker restart is not permission to resend.

## 4. Invariants

1. Every remote action refers to one account and a verified provider location; sequence numbers are never used as persistent identity.
2. The application never equates “row hidden locally” with “moved remotely.”
3. Approved recipients, sender identity, bodies, attachments, and action targets are immutable within a revision.
4. No database transaction is held open across network I/O.
5. A conditional persisted claim precedes each possible external side effect.
6. Unknown external outcomes block automatic replay until reconciled.
7. A duplicate invocation returns the existing operation; it does not create a fresh send attempt.
8. Message content is data, not instructions or authorization.
9. Trash/restore never issues broad mailbox expunge or permanent-delete commands.
10. Existing reply state, conversation associations, and audit history survive folder moves.
11. Source identity, recipient scope, or sending-account changes invalidate approval.
12. Authorization applies equally to tool calls and manual IPC execution.

## 5. Provider capabilities and message identity

### 5.1 Capabilities

Return an account capability DTO with independent booleans and reason codes:

| Capability | Meaning |
| --- | --- |
| `canFetchFullSource` | Can retrieve a complete verified source for forwarding. |
| `canSendForward` | Full-source retrieval plus a valid selected SMTP identity are available. |
| `canMoveToTrash` | Writable source/destination and verified safe native move behavior are available. |
| `canRestore` | Can move the selected Trash item to the chosen valid folder. |
| `canSearchRemote` | Adapter supports the requested bounded filters without silent broadening. |

Cache discovery briefly (proposed 5 minutes), but revalidate capability, selected folder, and access immediately before mutation. Capability changes invalidate pending operations when relevant. Folder listing uses provider special-use metadata where available. If Trash is absent or ambiguous, require a stored user-selected folder for that account. Do not guess an English folder name or create folders automatically.

For the first release, require native IMAP MOVE and reliable destination mapping support as demonstrated by adapter tests. Inspect library behavior to ensure `messageMove` cannot silently fall back to broad COPY/delete/expunge when capability checks fail. If reliable destination mapping is absent after a successful move, record remote completion with unresolved local location and reconcile; do not resend the move. Servers failing this compatibility contract are read-only for organization actions.

POP3 Trash and restore are unsupported. POP3 forwarding also remains unsupported until full-source retrieval with verified POP3 identity is implemented; cached normalized bodies are not a substitute.

### 5.2 New location entity

Keep `EmailReceivedMessageEntity.id` as the stable application message ID. Add `EmailMessageLocationEntity`:

| Field | Type/constraint | Purpose |
| --- | --- | --- |
| `id` | Integer primary key | Internal locator identity |
| `messageId` | Foreign key to received message | Preserve existing draft/history references |
| `emailServiceId` | Integer account ID | Explicit account boundary |
| `protocol` | `imap` or `pop3` | Interpretation of provider identity |
| `folderPath` | Exact provider path; nullable for POP3/unverified legacy | Case/Unicode preserved except protocol-defined Inbox handling |
| `uidValidity` | Decimal string; nullable only if unverified/non-IMAP | Avoid serializing bigint through JSON |
| `providerUid` | String | IMAP UID or POP3 UIDL |
| `state` | `verified`, `legacy_unverified`, `stale`, `missing` | Mutation eligibility |
| `version` | Integer incremented on location updates | Reject stale selections |
| `lastVerifiedAt` | Nullable timestamp | Freshness evidence |
| `lastOperationId` | Nullable operation ID | Causal link to moves |

Create a unique index on verified IMAP `(emailServiceId, folderPath, uidValidity, providerUid)` via a deliberate migration; retain a separate protocol-aware key for POP3. Enforce one active location per message in this release. An independent copy in another folder is a separate received-message occurrence. Do not merge occurrences solely because RFC Message-ID matches: headers can be absent, repeated, or forged.

A verified move updates the existing message's location and increments its version; it does not create a new logical message. If sync has independently imported the destination occurrence, reconcile only using authoritative move mapping, preserving existing references in a controlled transaction. If either record has conflicting user history, flag an explicit conflict rather than cascading deletes or guessing. Tests must cover this collision.

Remove the old unique account/provider-UID constraint after all receive lookup callers use the location model. Keep the existing `providerUid` column temporarily as a compatibility/display field, never as mutation authority. Update all entity write schemas and DTOs alongside the migration.

### 5.3 Migration and startup ordering

Current automatic schema synchronization cannot be trusted to backfill identity. Implement an explicit versioned initialization path:

1. Quiesce receive sync and organization operations; take a recoverable database backup through the existing database lifecycle.
2. Open the database with automatic synchronization disabled for the upgrade transaction; verify supported prior schema/version.
3. Register/create additive location and operation tables through TypeORM migration code. Record a schema version marker.
4. Backfill a `legacy_unverified` location for existing messages. Do not assume the account's current receive folder is historically correct, and do not invent UID validity.
5. Install new indexes and remove the old uniqueness constraint using a controlled SQLite table/index migration as required. Check counts, foreign keys, and preserved reply/draft relationships before commit.
6. Deploy new receive upsert logic in the same application version. Resume sync only after migration passes integrity checks.
7. Resolve old locations through a re-fetch plus corroborating source evidence. Message-ID alone is insufficient. If provenance is ambiguous, leave the old row readable but ineligible for remote actions; newly fetched verified occurrences remain distinct.
8. Only then enable organization feature flags. A failed migration leaves organization disabled and offers recovery; it must not start with a half-upgraded schema.

Previously overwritten records caused by account/UID collisions cannot be reconstructed reliably from local data. Do not claim migration can recover them. Back up before upgrade; rollback means restoring the backup with a compatible binary, not blindly downgrading a live database. Remote actions already performed are not reversed by database rollback.

## 6. Persistence model for actions

### 6.1 Forward drafts and revisions

Add `EmailForwardDraftEntity` with source message ID, source location/version, sending account, current revision ID, status, conversation ID, creation provenance, and timestamps. Draft status: `draft`, `ready`, `submitted`, `discarded`.

Add append-only `EmailForwardRevisionEntity` with:

- Draft ID and monotonically increasing revision number.
- Verified source locator snapshot and full-source hash.
- Resolved From display name/address, Reply-To, sending-account configuration version.
- Normalized To/Cc/Bcc lists and unique envelope recipient list.
- Subject, optional commentary, rendered plain/HTML body references and hashes.
- Attachment manifest: opaque part ID, sanitized display name, MIME type, decoded size, content hash, disposition, and CID where applicable.
- Encrypted content-artifact IDs, complete composed-message hash, composed byte count, generated Message-ID.
- Validation result, renderer/materializer version, creation time, and expiry.

Do not add arbitrary filesystem paths or attachment URLs to tool inputs. Revisions refer only to artifacts produced by the source materializer. Editing produces a new revision and invalidates prior approval.

### 6.2 Operation, authorization, and item records

| Proposed entity | Required fields and constraints |
| --- | --- |
| `EmailOrganizationOperationEntity` | UUID, kind (`forward`, `trash`, `restore`), account ID, conversation/user-turn/tool-call provenance, payload hash, idempotency key (unique), status, counts, timestamps, cancellation time, policy version |
| `EmailOrganizationAuthorizationEntity` | Operation/revision or selection hash, trusted origin (`direct_request`, `ui_review`, `ui_action`), user-turn/event ID, expiry, consumed time, revocation time; optional hashed opaque handle |
| `EmailOrganizationOperationItemEntity` | Operation ID, source message ID, before locator/version, intended destination, after locator, per-item status, attempt ID, accepted/rejected recipient summary for forward, structured error, timestamps; unique operation/message pairing |
| `EmailOrganizationAttemptEntity` | Item ID, attempt number, claim token, phase, lease metadata, protocol result evidence, deterministic outbound Message-ID where relevant; unique item/attempt |
| `EmailOrganizationAuditEntity` | Append-only event ID, operation/item IDs, actor type, action, status, reason code, timestamp; no raw body/secret fields |
| `EmailOrganizationSelectionEntity` (Stage C) | Opaque ID, account, exact message IDs and location versions, filters/coverage summary, hash, owner context, created/expiry timestamps |

Use restrictive foreign keys or account deletion checks to prevent removing records needed for pending recovery. Account deletion is blocked while operations are executing or unresolved; user must reconcile/cancel safe pending work first. Terminal records follow retention policy, not accidental cascade deletion.

An aggregate status is derived from item states. Operation values: `prepared`, `awaiting_approval`, `authorized`, `running`, `succeeded`, `partially_succeeded`, `failed`, `cancelled`, `needs_reconciliation`. Item values: `pending`, `claimed`, `succeeded`, `partially_succeeded`, `noop`, `failed`, `cancelled`, `outcome_unknown`. A forward with definitive mixed recipient acceptance uses `partially_succeeded`; a forward with any uncertain recipient outcome uses `outcome_unknown` until reconciled.

`noop` requires proof, such as the operation already having moved the same item. A missing source alone does not prove success. `needs_reconciliation` takes precedence while any item is unknown; once resolved, derive the terminal aggregate. Cancellation leaves completed items intact.

### 6.3 Claims and retry keys

The trusted main process generates an action ID from the persisted user turn/UI event and frozen action payload. A unique operation key binds that action ID, kind, and payload hash. Re-delivery of a tool call or UI click resolves to the same key. Cross-tool-call duplicates for the same turn and same frozen payload attach to the existing operation unless the user explicitly requests a separate action. A later intentional repeat gets a fresh trusted action ID.

Within a transaction, validate authorization and location/revision versions, conditionally change an item from `pending` to `claimed`, and persist the attempt before network I/O. Only the winner proceeds. Claim expiry initiates reconciliation, not automatic reassignment of a potentially submitted request. Database constraints remain authoritative across multiple app windows/processes.

## 7. Tool contracts

All names here are proposed new tools. Numeric local IDs must be positive integers; opaque handles are generated by the main process and bound to ownership/expiry. Schemas reject unknown keys. No input has `approved`, `skip_review`, `force`, raw IMAP commands, raw UIDs, or authorization tokens.

| Tool | Inputs | Output/data | Policy |
| --- | --- | --- | --- |
| `list_email_folders` | `email_service_id` | Folder IDs/paths, special-use roles, capabilities, reason codes | Read-only |
| `create_email_forward_draft` | `message_id`, `to[]`, optional `cc[]`, `bcc[]`, `sender_service_id`, `note`, attachment selection (`all`, `none`, or source part IDs) | Draft/revision IDs, full preview, validation, attachment manifest | Draft only; does not imply send |
| `update_email_forward_draft` | `draft_id`, `expected_revision_id`, permitted recipient/note/subject/attachment changes | New revision and preview | Draft only; invalidate approval |
| `send_email_forward` | `draft_id`, `revision_id` | Operation ID and submission status | Request-scoped external action |
| `move_email_to_trash` | B: `message_id`; C: exactly one of `message_id`, `selection_id` | Operation ID and per-item outcomes | Request-scoped external action |
| `restore_email` | B: prior `operation_id` and optional valid `destination_folder_id`; C: optional `selection_id` identifying items of that prior operation | Operation ID and per-item outcomes | Request-scoped external action |
| `get_email_operation` | `operation_id` | Aggregate/item status, safe errors, allowed next actions | Read-only ownership checked |
| `cancel_email_operation` | `operation_id` | Updated status and counts | Authorized owner; only stops pending work |
| `search_emails` (C) | Account, folder IDs, sender, subject, date range, unread/attachment filters, `source` (`local`, `server`), page size, cursor | Metadata summaries, coverage, continuation cursor, completeness | Read-only |
| `prepare_email_selection` (C) | Exact `message_ids[]` from owned results/context and intended action | Frozen selection ID/hash, preview, count, expiry | Local preparation only |

Search cursors are opaque and bound to the filters/account/context; do not accept client-authored SQL or IMAP expressions. Selection preparation resolves current locations and deduplicates message IDs. A model cannot turn a search query string directly into an authorized bulk action.

Example result contract (proposed, not an existing exported interface):

```typescript
type EmailActionStatus =
  | "awaiting_approval"
  | "running"
  | "succeeded"
  | "partially_succeeded"
  | "failed"
  | "cancelled"
  | "needs_reconciliation";

interface EmailActionResult {
  readonly success: boolean;
  readonly operationId: string;
  readonly status: EmailActionStatus;
  readonly completed: number;
  readonly failed: number;
  readonly unresolved: number;
  readonly pending: number;
  readonly cancelled: number;
  readonly errorCode?: string;
  readonly retryable: boolean;
}
```

`success: true` means the requested action completed with verified results for all items, including proven no-ops. It is false for pending, partial, or unknown states. For forwarding, completed means SMTP accepted all envelope recipients; UI wording says “Submitted,” not “Delivered.” Sanitized item details carry accepted/rejected/unknown recipient sets.

Update registry descriptions, `BuiltInToolCapabilitiesPromptSection.ts`, `ToolLoadPolicyService.ts`, permission previews, chat execution labels, and discovery tests together. Forwarding must not be advertised as a reply or marketing campaign.

## 8. Authorization and IPC

### 8.1 Trusted intent

Implement `EmailOrganizationIntentResolver` using persisted user-authored messages and trusted UI selection context. Return action kind, direct/review/draft mode, permitted account/source/recipient constraints, and provenance. Use an explicit intent corpus, including multilingual negation and quoted email instructions. Ambiguity produces review/clarification; the content-generation model cannot upgrade intent.

`send_email_forward`, `move_email_to_trash`, and `restore_email` use `confirmationPolicy: "request_scoped_action"`. Extend the actual executor/query-loop gate for these tools; registry metadata alone is insufficient. Generic `skipPermissionCheck` and chat `full_access` do not substitute for operation authorization.

A direct request produces an authorization only after the service resolves and freezes a payload satisfying that request. An explicit review click authorizes only the displayed revision/selection. The application checks trusted sender/recipient scope against the payload before issuing the authorization. Expiry is 15 minutes from issuance; changing a payload or relevant configuration revokes it. Starting a long bulk operation consumes the authorization for its frozen set; expiry does not interrupt already-authorized execution, while cancellation/revocation prevents unstarted items.

No token is sent through the model. Prefer a server-held authorization reference in trusted executor state. Renderer handles, if needed, are opaque, expiring, owner-bound, single-use, and never accepted as evidence without loading their persisted record.

### 8.2 IPC surface

Add proposed channels through the existing channel/preload conventions:

- `EMAIL_ORGANIZATION_CAPABILITIES`, `EMAIL_ORGANIZATION_FOLDERS`, `EMAIL_ORGANIZATION_SEARCH`.
- `EMAIL_FORWARD_DRAFT_CREATE`, `EMAIL_FORWARD_DRAFT_UPDATE`, `EMAIL_FORWARD_DRAFT_DETAIL`.
- `EMAIL_ORGANIZATION_PREVIEW`, `EMAIL_ORGANIZATION_APPROVE`, `EMAIL_ORGANIZATION_EXECUTE`.
- `EMAIL_ORGANIZATION_OPERATION_GET`, `EMAIL_ORGANIZATION_OPERATION_CANCEL`, `EMAIL_ORGANIZATION_PROGRESS`.

An execute request references a prepared operation; it cannot override recipients or targets. Progress events contain monotonically increasing operation versions so stale renderer events cannot roll back displayed state. On reconnect, query persisted status instead of relying only on events.

Use `registerAiValidatedHandler` for handlers serving AI functions. The inspected helper calls `ensureHostedAiEnabled()` before schema parsing; preserve that order and test it rather than creating a parse-first wrapper. `Token` comes from `@/modules/token`; `USER_AI_ENABLED` comes from `@/config/usersetting`. Return `{ status: false, msg: 'AI is disabled', data: null }` immediately when disabled. Recheck entitlement at AI action execution to cover revocation between preparation and execution.

Manual mailbox actions use ordinary validated handlers and trusted UI provenance; they need no AI entitlement. Keep manual and AI entry points explicit so a renderer cannot label an AI request “manual” to bypass the gate. Both paths share account ownership, authorization, validation, and operation claims.

### 8.3 Scheduled tools

Add forward send, Trash, and restore to `SCHEDULED_LOOP_ALWAYS_BLOCKED_TOOLS`, before full-access evaluation. Enforce scheduled-origin denial again in the organization execution service. Read-only folder/search/status tools can follow curated read-only policy. Draft creation is not classified read-only automatically: it materializes content and writes state, so apply explicit scheduled-tool policy or keep it unavailable in the initial release.

## 9. Forward content and delivery

### 9.1 Materialization

1. Load source/account/location through Modules; validate a verified location and unchanged version.
2. Fetch the full source using the adapter without changing Seen/Answered flags. Check UID validity in the opened mailbox before addressing the UID.
3. Enforce source-byte and MIME-part limits during retrieval/parsing, not just after allocating the payload.
4. Produce plain text and sanitized HTML representations. Exclude active elements and remote-image loading. HTML-only sources receive a readable plain-text alternative.
5. Render optional commentary separately, then a translated “Forwarded message” separator and original From/Date/Subject/To headers. Preserve the complete supported body. Do not copy hidden Bcc data or introduce reply headers.
6. Extract selected regular attachments and referenced inline CID assets. Preserve supported CID relationships using unique content IDs; include every asset in the frozen manifest and size accounting.
7. Sanitize filenames for display/storage; never use the sender's filename as a filesystem path. Detect duplicate names and provide distinct safe display names.
8. Reject unsupported encrypted/signed MIME or content that cannot be represented fully. Do not silently degrade a signed message into a claim of verified content.
9. Compose one immutable MIME artifact with stable Date/Message-ID, selected envelope, and hashes. Validate final encoded size before approval.

Proposed limits: raw source 30 MiB, total decoded attachments 15 MiB, 20 attachments, 20 recipients, MIME nesting 20, and a bounded total part count (proposed 200). Enforce the lower of application and known server size limits, including base64/headers overhead. A server rejection remains possible when its limit is unknown; report it accurately.

### 9.2 Artifact storage and retention

Use a main-process `EmailOrganizationArtifactStore` under the configured application-managed data area, keyed by random operation/revision IDs. Database paths still come from Token; this is not permission to resolve a second database elsewhere. Never expose raw paths to the model or accept path input from the renderer.

Encrypt stored MIME/body/attachment artifacts with a per-install key protected by the existing secure-storage mechanism; do not store the key alongside ciphertext. Restrict filesystem permissions where supported and use authenticated encryption, random nonces, and atomic writes. If secure storage is unavailable, allow preparation in bounded memory only and refuse a durable send until an appropriate secure path is available.

Proposed retention: unapproved artifact expiry 24 hours; terminal operation artifacts purged within 24 hours; unresolved operations retain encrypted evidence for up to 7 days with a visible recovery warning. Keep hashes and metadata after bytes are purged. Expired artifacts require re-materialization and fresh approval, never transparent replacement of approved bytes. A cleanup failure logs metadata-only diagnostics and retries. Terminal audit retention defaults to 90 days; account removal/privacy purge must preserve or explicitly resolve outstanding operations first.

### 9.3 Delivery sequence

```text
Trusted request / review gesture
  -> resolve and freeze forward revision
  -> validate sender/recipients/content/limits
  -> persist authorization and operation
  -> transaction: consume authorization + claim item + record attempt
  -> recheck config revision and frozen artifact hash
  -> SMTP submit once
  -> persist accepted/rejected/unknown recipient outcome
  -> independently record/reconcile Sent copy
  -> emit operation result
```

Resolve SMTP login, From, and Reply-To through existing identity logic. Default to source account but allow an explicit validated alternative sender; that choice is part of approval. A credentials rotation can be permitted if identity and policy remain unchanged; a From/Reply-To/account change invalidates approval.

Do not reuse `send_email_reply`: forwarding creates new recipients and a new Message-ID, does not use `In-Reply-To`/`References` to pretend to be a reply, and must not update source `replyStatus` or `isAnswered`. Store the source linkage in forward history.

If SMTP reports partial recipient acceptance, preserve each recipient's state. Do not retry the entire recipient set. A retry for proven rejected recipients requires a new explicitly authorized operation targeting that subset. Ambiguous recipients remain unresolved until reconciled or the user explicitly authorizes a new send after seeing the duplicate risk.

### 9.4 Sent copy and uncertainty

A stable Message-ID and content hash are correlation aids, not proof of exactly-once delivery. Search available Sent folders for strong matching evidence after ambiguous submission. Lack of a match does not prove non-delivery. Do not treat an AiFetchly-created Sent copy as independent proof the server accepted SMTP.

Track `sentCopyStatus` separately from submission: `not_requested`, `pending`, `saved`, `failed`, `unknown`. Use an explicit per-account Sent-copy strategy validated in compatibility tests; avoid appending blindly when a provider already saves sent mail. A failed/unknown append never triggers another SMTP send. Initial release may report “Submitted; Sent copy unavailable” when reliable Sent handling is unsupported.

## 10. Trash, restore, sync, and reconciliation

### 10.1 Trash execution

1. Persist a prepared operation/selection and trusted authorization.
2. Serialize with receive sync and other mutations for that account. Database claims also protect against another app process.
3. Re-fetch capabilities and open the exact source folder; verify UID validity, UID existence, and selected location version.
4. Resolve the configured/special-use Trash folder and validate it is writable and different from source.
5. Claim the item transactionally and persist the before locator and destination.
6. Issue one UID-based native move.
7. Persist returned destination mapping, update the location/version, and write the audit event in one local transaction.
8. Emit success and refresh the affected folder views.

If already in Trash, return a verified no-op; do not invent an original folder for a later restore. Restore is guaranteed only for a successful AiFetchly move with retained provenance. Messages externally placed in Trash need an explicit destination and verified current location; supporting that UI can follow separately.

### 10.2 Restore execution

Load a successful prior Trash operation and its current destination locator. The user-visible Undo action names that operation. Validate the message is still at the expected location and no intervening location change occurred. Use the recorded source folder as destination or a newly approved valid replacement. Execute the same move mechanism, updating the stable application message ID and recording a new operation.

### 10.3 Reconciliation matrix

| Evidence after interruption | Interpretation | Action |
| --- | --- | --- |
| Verified command success plus destination UID mapping | Remote move complete | Repair local location and mark success. |
| Durable proof request never reached dispatch | No remote action | Eligible for retry under valid authorization. |
| Source absent, one strongly verified mapped destination | Move can be reconciled | Record destination, success, and evidence. |
| Source absent, destination unknown or ambiguous | Outcome unknown | Do not repeat move or choose a header-only match. |
| Source still present after dispatch with no definitive outcome | Insufficient proof of failure | Reconcile; command may still be completing. |
| UID validity changed | Old location invalid | Mark stale; re-discover or request selection. |
| Source and destination both present | Copy/concurrent change conflict | Preserve both; stop and investigate, no cleanup expunge. |
| SMTP acceptance persisted, local/Sent-copy update incomplete | Submitted | Repair metadata independently, never resubmit. |
| SMTP dispatch may have happened but no durable result | Delivery unknown | Use evidence/manual reconciliation, never timer-driven resend. |

Persist terminal local updates and audit in one transaction. If it fails after a remote success, leave the claimed attempt recoverable; startup reconciliation repairs it. Absence of a durable network result must be displayed as uncertainty, not converted to a failure eligible for automatic retry.

### 10.4 Synchronization and existing replies

- Receive sync joins message locations; an account/UID alone cannot select an existing row.
- Reconcile pending moves before importing a conflicting destination occurrence. Share an account queue for receive/move operations within the process.
- External folder changes mark locations stale or missing; do not reinterpret a missing message as user-authorized deletion.
- Retain received message bodies, reply drafts, conversation links, and audits after Trash.
- Trash/move invalidates any pending reply approval bound to a location that is no longer current. Already submitted replies remain unchanged. Coordinate with the reply claim path so no stale approval can race a move.
- A forward does not set Seen, Answered, processed, or replied state. Add tests for adapter fetch behavior to verify this invariant.

## 11. Stage C search and bulk execution

Local search uses parameterized TypeORM queries against account/message/location fields, with indexed account/date and account/folder lookups. Define literal case-insensitive subject matching and normalized sender-address matching. Avoid passing free-form `where` SQL from tools. A missing local index is not grounds to silently change filter semantics.

Server search discovers matching UIDs with bounded work and fetches metadata only. Proposed per-request scan bound: 1,000 candidates or 30 seconds, whichever comes first; return `complete: false` and a resumable cursor when reached. Invalidate cursors if folder UID validity or query/account binding changes. Post-filter dates to exact UTC bounds where provider search is coarser. If attachment filtering needs additional inspection, disclose the partial scan instead of presenting an exact total.

`prepare_email_selection` persists exact IDs, verified location versions, destinations, and a canonical payload hash. Search results themselves are not an authorization. The UI approves the hash-backed preview; newly arrived messages cannot enter the operation.

Execute one move at a time per account initially. Preflight each item before dispatch, reporting stale/missing items individually. Persist progress after each item. For Trash/restore, aggregate counts must sum to the frozen selection count; `completed` includes proven no-ops. Forward recipient counts are a separate breakdown and must not be mixed with message-item counts. Retry proven failed items under a new bounded action after revalidation; preserve completed items and exclude unknown items.

Cancellation atomically sets `cancelRequestedAt`. The dispatcher checks it before each claim. Stop unclaimed items; let already-dispatched work report/reconcile. Never implement “cancel” by automatically restoring already-trashed messages, because that is a separate user action.

## 12. UI, localization, and accessibility

Extend [emailreceive/list.vue](../../src/views/pages/emailreceive/list.vue) and [detail.vue](../../src/views/pages/emailreceive/detail.vue), using proposed components:

- `EmailForwardReviewDialog.vue`: original preview, sending identity, recipient chips, note, attachment manifest, validation, Send/Save draft/Cancel.
- `EmailOrganizationPreviewDialog.vue`: exact account, selected rows, destinations, counts, expiry, confirm action.
- `EmailOrganizationOperationCard.vue`: progress, per-item outcome, retry eligibility, Undo/Restore, and reconciliation state in chat/history.

Reuse these components in chat instead of creating independent confirmation behavior. Controls disable on stale revisions, pending claims, unavailable capabilities, and expired content. Refresh on persisted operation events and query status on mount/reconnect. Undo remains discoverable in history after any temporary snackbar disappears.

Add `emailOrganization.*` translation keys in all six language files: en, zh, es, fr, de, ja. Components use `t('key') || 'English fallback'`. Include all error, partial, unknown, expiry, unsupported, and cancellation states. Backend returns stable reason codes; UI maps them to localized messages.

Use keyboard focus trapping/restoration in dialogs, accessible recipient/attachment labels, visible focus states, and polite live progress announcements. Do not render unsanitized source HTML in either the review dialog or operation card.

## 13. Error contracts, observability, and recovery startup

| Error code | Meaning | Automatic retry |
| --- | --- | --- |
| `AI_DISABLED` | AI entitlement absent | No |
| `ACTION_NOT_AUTHORIZED` | Missing/mismatched trusted request or approval | No |
| `APPROVAL_EXPIRED` / `REVISION_CHANGED` | Payload authorization stale | No; prepare/approve again |
| `ACCOUNT_NOT_AVAILABLE` | Deleted, disabled, or inaccessible account | No until resolved |
| `CAPABILITY_UNSUPPORTED` / `TRASH_NOT_CONFIGURED` | Provider/account cannot perform action | No |
| `LOCATION_STALE` / `UID_VALIDITY_CHANGED` | Message identity cannot be trusted | Re-discover only |
| `SOURCE_NOT_FOUND` | Source cannot be verified | No mutation retry |
| `SOURCE_TOO_LARGE` / `ATTACHMENT_UNAVAILABLE` / `MIME_UNSUPPORTED` | Materialization failed | No send; revise selection |
| `AUTHENTICATION_FAILED` / `NETWORK_BEFORE_DISPATCH` | Proven failure before side effect | Bounded retry after correction and authorization validation |
| `PROVIDER_REJECTED` | Definitive protocol rejection | Only where outcome is proven and policy permits |
| `OUTCOME_UNKNOWN` | Action may have occurred | Reconciliation only |
| `PARTIAL_RECIPIENT_ACCEPTANCE` | Some envelope recipients accepted | Never resend the whole set |
| `LOCAL_COMMIT_PENDING` | Remote result needs local repair | Local reconciliation only |

Timeout defaults should be explicit configuration: proposed 15-second connection timeout and 60-second command/submission timeout, with a progress UI. Timing out a promise does not prove the underlying socket stopped. Close/abort the connection as supported and conservatively record unknown if dispatch could have happened.

At startup, find nonterminal attempts, resolve claims whose owner exited, reconcile protocol evidence, rebuild progress, and restart only work proven not dispatched and still authorized. Never resume automatic sending solely because a lease expired.

Log operation/item IDs, protocol phase, duration, reason codes, capability outcomes, and reconciliation decisions. Redact SMTP/IMAP errors before logs/tool results because server strings may contain addresses or credentials. Do not emit MIME bodies, attachment bytes, auth tokens, or full recipient lists to generic telemetry.

## 14. Proposed file map

All names below are implementation targets; they do not exist merely because this document lists them.

| Area | Proposed additions/changes |
| --- | --- |
| Types/schemas | `src/entityTypes/emailOrganizationTypes.ts`, `src/entityTypes/emailOrganizationAiTypes.ts`, `src/schemas/ipc/emailOrganization.ts`, entity-write schemas |
| Entities | Location, forward draft/revision, operation/item/attempt/authorization/audit, Stage C selection entities under `src/entity/` |
| Persistence | Matching Models in `src/model/` and Modules in `src/modules/`; conditional claims and migration logic |
| Protocol | `src/service/emailOrganization/EmailMailboxAdapter.ts`, `ImapEmailMailboxAdapter.ts`, capability resolver |
| Forwarding | Forward materializer, artifact store, draft service, authorization service, delivery service |
| Operations | Intent resolver, operation coordinator, recovery service, startup initialization, Stage C search/selection services |
| Tools | `src/service/EmailOrganizationAiTools.ts`; registry, discovery prompt, load policy, executor/request-scope gate |
| IPC | `src/main-process/communication/emailOrganization-ipc.ts`; channel definitions, preload allowlist, handler registration |
| Renderer | `src/views/api/emailorganization.ts`; new components, existing receive pages, chat cards/projection labels |
| Existing sync | Receive DTO, IMAP client, sync service, received-message model/entity/schema |
| Existing policy | Scheduled tool hard-block list and reply approval/location invalidation integration |
| Database startup | `src/config/SqliteDb.ts` entity registration and explicit versioned upgrade ordering |

Avoid generalizing the entire reply/campaign stack in this feature. Extract only pure identity/hash/error helpers with tests; forward-specific state and policy remain separate.

## 15. Test plan and requirement traceability

### 15.1 Test layers

| Layer | Cases | Location |
| --- | --- | --- |
| Pure unit | Schema bounds, addresses, intent/negation/provenance, revision hashing, canonical selection, MIME limits, aggregate status | `test/vitest/utilitycode/` |
| Service/IPC | AI gate before parsing, manual/AI origin separation, ownership, authorization, capabilities, tool discovery, scheduled hard block | `test/vitest/main/` |
| SQLite integration | Migration, duplicate UID across folders, conditional claims, concurrent windows, restart claims, destination collision, preserved reply links | `test/vitest/main/modules/` following existing real-DB tests |
| Protocol fixtures | Native move/mapping, missing capabilities, flags unchanged, UID validity reset, partial SMTP acceptance, disconnect at each phase | Main/service test suites with deterministic local fake IMAP/SMTP servers |
| Components | Draft/review, attachment errors, ambiguous selection, disabled controls, double click, unknown/partial results, Undo, cancellation, six-language keys | `test/vitest/main/components/<ComponentName>.test.ts` |
| End-to-end | Chat forward review/direct send, mailbox Trash/restore, restart reconciliation, bulk preview/cancel | `test/e2e/specs/*.test.ts` |

Fault injection must include crashes before claim, after claim before dispatch, during dispatch, after provider response before local commit, and during recovery. Assert external command counts and resulting mailbox state, not just mocked function calls. A claim-only crash may still need conservative reconciliation if dispatch cannot be excluded by durable evidence.

### 15.2 Requirement coverage

| Requirements | Primary verification |
| --- | --- |
| FR-01–03 | Registry/load-policy tests, capability fixtures, ambiguous-selection components |
| FR-04–07 | Forward materializer/MIME fixtures, intent corpus, immutable approval tests, review/direct-send E2E |
| FR-08–10 | IMAP move/restore fixtures, SQLite location/history integrity, reply race tests |
| FR-11–13 | Concurrent claim integration, phase fault injection, partial/unknown result UI |
| FR-14–15 | Component suite, keyboard E2E, all-six-language key checks |
| FR-16 | Scheduled hard-floor tests including full-access and direct service invocation |
| FR-17–18 | Search filter/cursor/coverage tests, frozen selection and stale UID tests |
| FR-19–20 | 100-item execution, cancel/restart, individual retry and counts integration/E2E |

### 15.3 Existing commands for implementation verification

```bash
yarn typecheck
yarn vue-typecheck
yarn testmain
yarn test:components
yarn test:e2e
```

Run relevant utility tests through the existing Vitest configuration as well. Components and critical flow E2E tests are required in the same implementation change. Use isolated test accounts/fake servers; never run deletion or forwarding tests against a user's real mailbox. This documentation-only change does not claim these application suites were run.

## 16. Implementation sequence and rollout

| Milestone | Deliverable | Completion gate |
| --- | --- | --- |
| M1 | Location schema, versioned migration, receive lookup update, provider capabilities | Existing reply/receive regressions pass; legacy rows cannot mutate until verified. |
| M2 | Operation/authorization/attempt records, claims, startup recovery | Real SQLite concurrency and crash tests prove safe claims/uncertainty. |
| M3 | Full-source forward materialization, attachment handling, SMTP submission and Sent status | Content fixtures, explicit intent, partial/unknown submission tests pass. |
| M4 | Single-message native move and restore, reply coordination | Remote state, destination mapping, and reconciliation tests pass. |
| M5 | Tool/IPC/UI integration, localization and Stage B release | PRD Stage B acceptance set and component/E2E gates pass. |
| M6 | Search, frozen selection, bounded bulk execution/cancel | Stage C acceptance, limits, search coverage, and bulk fault tests pass. |

Proposed feature flags: `emailOrganizationForwardEnabled`, `emailOrganizationTrashEnabled`, and `emailOrganizationBulkEnabled`, default off until the corresponding milestone validates. Add a shared execution kill switch that prevents new claims while allowing status queries, cancellation, and reconciliation. In-flight outcomes must still be recorded. Enabling flags does not override provider capability or authorization checks.

Roll out against local protocol fixtures, then explicitly configured test mailboxes, then opt-in users. Record the tested server/library versions and capabilities. Never advertise universal IMAP support based solely on a successful happy-path test.

## 17. Alternatives and trade-offs

| Decision | Rationale | Cost/limit |
| --- | --- | --- |
| Trash instead of permanent delete | Matches common organization intent and provides recovery | Restore depends on provider retention. |
| Separate location table | Preserves existing message IDs and exposes folder/UID validity explicitly | Requires migration and sync changes. |
| Dedicated forward domain | Avoids reply threading/state mistakes and campaign-specific policy | Some reliability patterns are shared rather than one unified model. |
| Native MOVE only initially | Avoids risky delete/expunge fallbacks and multi-step copy cleanup | Fewer servers supported initially. |
| Durable claims plus reconciliation | Handles external I/O boundaries honestly | Unknown outcomes sometimes need user resolution. |
| Freeze a bulk selection | Makes approval match actual affected messages | New arrivals require another action. |
| Block scheduled mutations initially | Keeps interactive intent authoritative until rule-level authorization exists | No autonomous cleanup/forwarding schedules yet. |
| Full-source materialization | Prevents silent body/attachment loss | Additional network, bounded storage, and provider dependencies. |

## 18. Validation items before implementation release

1. Verify installed ImapFlow native-MOVE behavior, UID mapping, special-use discovery, and source fetch flag behavior against executable protocol fixtures.
2. Confirm the exact database initialization hook that can run the upgrade before automatic synchronization; implement and test backup/restore and version markers.
3. Validate SMTP transport supports immutable MIME artifacts and per-recipient outcomes without campaign/reply side effects.
4. Choose per-account Sent-copy strategies based on observed provider behavior, with unsupported/unknown states visible.
5. Profile the proposed byte/part limits and decide whether a worker is required for parsing; any worker remains database-free.
6. Validate artifact encryption/retention integration with current secure storage, including unavailable-key and disk-full behavior.
7. Review the initial UI labels/limits with Product; all stated defaults remain proposed until release validation.

These items refine implementation details. Core requirements remain fixed for this proposal: exact message targeting, trusted action authorization, complete selected forward content, reversible deletion, and truthful uncertain outcomes.
