# Intent-Aware AI Outbound Email Delivery - Technical Design

## Document Information

| Field | Value |
| --- | --- |
| Status | Proposed |
| Owner | AiFetchly Engineering |
| Product specification | [Intent-Aware AI Outbound Email Delivery PRD](./ai-outbound-email-intent-aware-delivery-prd.md) |
| Target application | AiFetchly Electron application |
| Primary stack | TypeScript, Electron, Vue 3, TypeORM, SQLite, Electron utility process |
| Security model | Request-scoped authorization, immutable content binding, main-process enforcement |

## 1. Purpose

This document defines the implementation architecture for reliable AI-assisted
outbound email delivery. It translates the product requirements into concrete
services, entities, state machines, tool contracts, IPC boundaries, worker
payloads, tests, migration steps, and operational controls.

The central technical rule is:

> The model may propose an action, but only trusted application code may decide
> whether the current user request authorizes sending.

The design supports two deliberate user experiences without adding an
email-specific automatic-send setting:

1. When the user clearly asks to send now, the request itself authorizes one
   exact batch after drafting and preflight succeed.
2. When the user asks to review, approve, check, or show drafts first, the
   application persists drafts and waits for an exact-content approval.

Ambiguous or conflicting requests never receive direct-send authorization.

## 2. Scope

### 2.1 In scope

- Resolve `send_now`, `review_first`, or `draft_only` from trusted user input.
- Bind the decision to the current conversation and user message.
- Create durable per-recipient drafts and immutable revisions.
- Generate personalized content with traceable evidence.
- Run complete-batch preflight before authorization.
- Create request-scoped direct-send authorization without a global setting.
- Create exact-content authorization after review.
- Enforce authorization at both the AI tool boundary and delivery boundary.
- Send the exact authorized sender, recipient, subject, and body.
- Prevent duplicate execution through atomic claims and idempotency keys.
- Record per-recipient outcomes and audit events.
- Recover safely after app, worker, or provider failures.
- Provide a review UI and localized status/error messages.

### 2.2 Out of scope

- A global or email-specific “Allow automatic sending” preference.
- Scheduled recurring campaigns authorized by a single chat request.
- Approval of future content that has not yet been generated.
- Automatic re-sending after ambiguous SMTP outcomes.
- Bypassing existing account permissions, suppression rules, or AI entitlement.
- Moving database access into utility or child processes.
- Redesigning the unrelated inbound email reply system.

## 3. Existing-System Findings

### 3.1 Current outbound path

The current AI tool `start_email_send_task` is registered in
`src/config/skillsRegistry.ts`. It accepts recipient-source identifiers, email
service identifiers, and either templates or one inline subject/body. It then
calls `startBulkEmailSendTask()` in
`src/service/EmailMarketingAiTools.ts`.

`BuckEmailTaskModule` persists campaign data, loads recipients, filters,
templates, and SMTP services in the main process, then starts
`src/taskCode.ts` as an Electron utility process. The utility process calls
`src/childprocess/emailSend.ts`.

The current worker selects a random email service and a random template for each
recipient. If inline content is supplied, that same content is used for every
recipient. Template variables are substituted inside the worker immediately
before SMTP submission.

### 3.2 Gaps this design must close

1. The model can currently reach the send tool without a domain-specific intent
   decision bound to the current user message.
2. Generic AI approval modes can skip permission checks without proving a
   request-scoped outbound-email authorization.
3. The current payload cannot represent a unique, frozen revision per recipient.
4. Random sender/template choice occurs after the user would have authorized the
   action, so the exact delivery envelope is not known at authorization time.
5. Existing send callbacks identify recipients by address but do not carry a
   durable draft revision or send-attempt identity.
6. The legacy path does not provide an atomic one-time claim for the authorized
   batch.

### 3.3 Existing reliability components to reuse

The inbound reply implementation already demonstrates several required
patterns:

- immutable draft revisions;
- canonical content hashing;
- one-time approval-token hashing;
- sender and recipient binding;
- atomic send-attempt claims;
- `delivery_unknown` handling;
- audit logging; and
- SMTP outside database transactions.

The outbound implementation should reuse the design concepts and small shared
utilities where their semantics are identical. It should not force bulk
outbound campaigns into inbound reply entities because their lifecycles,
recipient cardinality, and user interfaces differ.

## 4. Architectural Decisions

### AD-001: User instructions are request-scoped authorization

An explicit user instruction such as “send these emails now” may authorize one
action. It does not grant persistent permission to future messages, future
campaigns, changed content, or other recipients.

No email-specific automatic-send setting is introduced.

### AD-002: Review and negation win

Any effective instruction to review, show, approve, check, or not send before a
later step prevents direct-send authorization, even if a send verb also appears.

Examples:

- “Write and send after I approve” resolves to `review_first`.
- “Do not send; show me drafts” resolves to `review_first`.
- “Prepare emails for sending” resolves to `draft_only` unless the surrounding
  request clearly commands immediate delivery.

### AD-003: Authorization is computed outside the model

The LLM never supplies an authoritative `delivery_mode`, `authorization_id`,
`approved`, or `skip_confirmation` value. Trusted main-process services derive
and persist those values from the current user turn and application state.

### AD-004: Tool permission and action authorization are separate

`SkillPermissionService` continues to decide whether the AI may use email
automation tools. `OutboundEmailAuthorizationService` separately decides whether
one exact outbound batch may be sent.

Both checks must pass. Generic AI modes such as `approve_for_me` or
`full_access` may satisfy tool permission policy, but they must never fabricate
outbound-email action authorization.

### AD-005: Authorization binds to immutable envelopes

Authorization covers the ordered set of final delivery envelopes. Every
envelope contains the final sender service, sender address, recipient address,
subject, text body, and HTML body. The canonical batch hash changes when any of
those fields change.

### AD-006: Final personalization happens before authorization

Template selection, sender selection, variable replacement, recipient-specific
personalization, link insertion, signatures, and content filters must complete
before preflight and hashing. The authorized worker path performs no content
mutation.

### AD-007: The main process owns policy and persistence

Models perform database access. Modules/services perform business logic. IPC
handlers validate transport input and call modules. Utility and child processes
never read or write the database.

### AD-008: The worker receives an immutable, typed payload

The main process builds a versioned worker payload containing exact envelopes
and the SMTP service records needed to submit them. The worker may submit only
those envelopes and must echo their identifiers and hashes in progress events.

### AD-009: One authorization produces at most one send attempt

An authorization is consumed by an atomic database claim. Repeated tool calls,
double clicks, retries, and stream replays return the existing attempt instead
of creating another delivery.

### AD-010: Unknown delivery is never retried automatically

If SMTP submission may have occurred but acknowledgement is unavailable, the
recipient outcome becomes `delivery_unknown`. A new explicit user instruction is
required before another attempt.

## 5. Target Architecture

```text
Renderer user message
  -> AI chat IPC (AI entitlement gate first)
  -> AIChatQueryEngine persists user message
  -> OutboundEmailIntentResolver
       -> OutboundEmailIntentModule / Model
  -> AI query loop with trusted sourceUserMessageId + intentDecisionId
  -> draft_outbound_email_batch tool
       -> OutboundEmailDraftService
       -> OutboundEmailPreflightService
       -> OutboundEmailAuthorizationService
            send_now    -> direct instruction authorization
            review_first -> wait for review UI approval
            draft_only   -> no send authorization
  -> start_email_send_task tool
       -> OutboundEmailToolGate
       -> OutboundEmailDeliveryService
       -> atomic authorization claim + send attempt
       -> BuckEmailTaskModule adapter
       -> taskCode utility process
       -> EmailSend authorized-envelope mode
       -> SMTP provider
  <- typed progress events
  -> main-process module persists per-recipient outcomes
  -> renderer status updates and audit UI
```

### 5.1 Trust boundaries

| Boundary | Trusted responsibilities | Untrusted or advisory input |
| --- | --- | --- |
| Renderer to main IPC | Schema validation, conversation ownership | Renderer payload |
| User-turn persistence | Message identity, role, conversation binding | User text itself |
| Intent resolver | Precedence, evidence validation, decision version | Semantic classifier result |
| LLM tool call | Proposes draft/send action | Tool name and arguments |
| Tool gate | Context binding and authorization lookup | Claimed batch identifiers |
| Delivery service | Hash verification, atomic claim, idempotency | Caller retry timing |
| Worker | Submit exact prepared envelopes | SMTP/provider response |
| Main process result handler | Persist outcomes and finalize batch | Worker event payload, validated and correlated |

## 6. Domain Types

Create `src/entityTypes/outboundEmailDeliveryTypes.ts` with explicit, reusable
types and Zod schemas. Do not use `any`.

```typescript
export type OutboundEmailDeliveryMode =
  | "send_now"
  | "review_first"
  | "draft_only";

export type OutboundEmailIntentReasonCode =
  | "explicit_send_instruction"
  | "explicit_review_instruction"
  | "explicit_do_not_send"
  | "conflicting_instruction"
  | "ambiguous_instruction"
  | "contextual_affirmation"
  | "resolver_failure";

export type OutboundEmailBatchStatus =
  | "drafting"
  | "draft_ready"
  | "preflight_failed"
  | "awaiting_review"
  | "direct_authorized"
  | "review_authorized"
  | "queued"
  | "sending"
  | "partially_sent"
  | "sent"
  | "delivery_unknown"
  | "failed"
  | "discarded";

export type OutboundEmailDraftStatus =
  | "draft"
  | "invalid"
  | "authorized"
  | "queued"
  | "submitted"
  | "sent"
  | "delivery_unknown"
  | "failed"
  | "discarded";

export type OutboundEmailAuthorizationType =
  | "explicit_user_instruction"
  | "exact_draft_approval";

export type OutboundEmailSendAttemptStatus =
  | "claimed"
  | "worker_starting"
  | "sending"
  | "completed"
  | "partially_completed"
  | "delivery_unknown"
  | "failed";

export type OutboundEmailRecipientOutcomeStatus =
  | "pending"
  | "submitted"
  | "sent"
  | "suppressed"
  | "failed"
  | "delivery_unknown";
```

### 6.1 Intent decision

```typescript
export interface OutboundEmailIntentDecision {
  id: number;
  conversationId: string;
  sourceUserMessageId: string;
  mode: OutboundEmailDeliveryMode;
  reasonCode: OutboundEmailIntentReasonCode;
  confidence: number;
  evidence: OutboundEmailIntentEvidence[];
  resolverVersion: string;
  sourceTextHash: string;
  createdAt: string;
}

export interface OutboundEmailIntentEvidence {
  start: number;
  end: number;
  normalizedPhrase: string;
  category: "send" | "review" | "negation" | "affirmation";
}
```

Evidence offsets refer to user-authored text only. They must never refer to
system prompts, tool results, attachment text, generated summaries, or assistant
messages, except that a contextual affirmation may link to the immediately
preceding assistant question through a separate context field.

### 6.2 Canonical envelope

```typescript
export interface AuthorizedOutboundEnvelope {
  draftId: number;
  revisionId: number;
  revisionNumber: number;
  recipientAddress: string;
  emailServiceId: number;
  senderAddress: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  envelopeHash: string;
}
```

### 6.3 Versioned worker payload

Add a discriminated union so the legacy campaign format remains compatible.

```typescript
export interface AuthorizedEmailWorkerPayloadV2 {
  version: 2;
  mode: "authorized_envelopes";
  batchId: number;
  sendAttemptId: number;
  batchHash: string;
  envelopes: AuthorizedOutboundEnvelope[];
  emailServices: EmailServiceEntitydata[];
}

export type EmailWorkerPayload =
  | Buckemailremotedata
  | AuthorizedEmailWorkerPayloadV2;
```

The authorized mode excludes templates and content filters. Those transformations
must already be reflected in each immutable revision.

### 6.4 Typed worker events

```typescript
export type AuthorizedEmailWorkerEvent =
  | {
      type: "authorized-email-submitted";
      batchId: number;
      sendAttemptId: number;
      draftId: number;
      revisionId: number;
      envelopeHash: string;
      providerMessageId: string | null;
    }
  | {
      type: "authorized-email-failed";
      batchId: number;
      sendAttemptId: number;
      draftId: number;
      revisionId: number;
      envelopeHash: string;
      errorCode: string;
      retrySafety: "safe" | "unknown";
    }
  | {
      type: "authorized-email-worker-complete";
      batchId: number;
      sendAttemptId: number;
    };
```

Error events contain sanitized codes, not SMTP credentials or complete provider
error objects.

## 7. Persistence Model

All new entities are registered in `src/config/SqliteDb.ts`. Models extend the
project data-access base and enforce the existing worker-process database guard.
Modules resolve the user database path through `Token` and `USERSDBPATH`.

### 7.1 `OutboundEmailIntentEntity`

Table: `outbound_email_intent`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer PK | Generated |
| `conversationId` | varchar(100) | Indexed |
| `sourceUserMessageId` | varchar(100) | Unique with conversation |
| `mode` | varchar(30) | Delivery mode |
| `reasonCode` | varchar(50) | Stable machine reason |
| `confidence` | real | `0..1` |
| `evidenceJson` | text | Validated evidence array |
| `sourceTextHash` | varchar(64) | SHA-256 of canonical user-authored text |
| `resolverVersion` | varchar(50) | Evaluation/audit version |
| `previousAssistantMessageId` | varchar(100), nullable | Only for contextual affirmation |
| audit fields | datetime | Existing `AuditableEntity` fields |

Indexes:

- unique `(conversationId, sourceUserMessageId)`;
- `(mode, createdAt)` for metrics.

The AI query engine resolves and persists this row once per user message.
Repeated stream processing loads the existing decision.

### 7.2 `OutboundEmailDraftBatchEntity`

Table: `outbound_email_draft_batch`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer PK | Generated |
| `conversationId` | varchar(100) | Owning conversation |
| `sourceUserMessageId` | varchar(100) | User turn that requested work |
| `intentDecisionId` | integer | Resolved intent |
| `status` | varchar(40) | Batch lifecycle |
| `recipientSourceType` | varchar(40) | Search result, list, explicit, etc. |
| `recipientSourceId` | integer, nullable | Existing source identifier |
| `recipientCount` | integer | Materialized recipient count |
| `validRecipientCount` | integer | Latest preflight count |
| `emailServiceIdsJson` | text | Requested service IDs |
| `batchHash` | varchar(64), nullable | Current envelope-set hash |
| `policyVersion` | varchar(50), nullable | Latest policy version |
| `validationVersion` | varchar(50), nullable | Latest validator version |
| `authorizationId` | integer, nullable | Current authorization |
| `legacyTaskId` | integer, nullable | Existing bulk-email task link |
| `sendAttemptId` | integer, nullable | Current attempt |
| `lastErrorCode` | varchar(100), nullable | Sanitized reason |
| `authorizedAt` | datetime, nullable | State transition time |
| `queuedAt` | datetime, nullable | State transition time |
| `completedAt` | datetime, nullable | Terminal time |
| audit fields | datetime | Existing base fields |

Indexes:

- `(conversationId, createdAt)`;
- `(sourceUserMessageId)`;
- `(status, updatedAt)`;
- unique nullable `sendAttemptId` when supported by the migration strategy.

### 7.3 `OutboundEmailDraftEntity`

Table: `outbound_email_draft`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer PK | Generated |
| `batchId` | integer | Indexed |
| `recipientAddress` | varchar(320) | Canonicalized |
| `recipientDisplayName` | varchar(320), nullable | UI only |
| `recipientSourceRef` | varchar(200), nullable | Traceability without raw source dump |
| `status` | varchar(30) | Per-recipient lifecycle |
| `currentRevisionId` | integer, nullable | Immutable revision pointer |
| `revisionNumber` | integer | Monotonic |
| `contentHash` | varchar(64), nullable | Current envelope hash |
| `lastErrorCode` | varchar(100), nullable | Sanitized |
| audit fields | datetime | Existing base fields |

Indexes:

- unique `(batchId, recipientAddress)`;
- `(batchId, status)`;
- `(currentRevisionId)`.

### 7.4 `OutboundEmailDraftRevisionEntity`

Table: `outbound_email_draft_revision`

Revision rows are append-only.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer PK | Generated |
| `draftId` | integer | Indexed |
| `revisionNumber` | integer | Unique with draft |
| `actor` | varchar(20) | `ai` or `user` |
| `emailServiceId` | integer | Frozen sender service |
| `senderAddress` | varchar(320) | Frozen envelope sender |
| `recipientAddress` | varchar(320) | Frozen envelope recipient |
| `subject` | varchar(500) | Final rendered subject |
| `bodyText` | text | Final rendered text |
| `bodyHtml` | text, nullable | Final sanitized HTML |
| `contentHash` | varchar(64) | Canonical envelope hash |
| `personalizationEvidenceJson` | text, nullable | Field-level evidence |
| `knowledgeSourcesJson` | text, nullable | Source identifiers, not secrets |
| `generationMetadataJson` | text, nullable | Model/prompt/version metadata |
| `validationFindingsJson` | text, nullable | Deterministic preflight results |
| audit fields | datetime | Creation time is material |

Indexes:

- unique `(draftId, revisionNumber)`;
- `(contentHash)`;
- `(emailServiceId)`.

### 7.5 `OutboundEmailAuthorizationEntity`

Table: `outbound_email_authorization`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer PK | Generated |
| `batchId` | integer | Indexed |
| `type` | varchar(40) | Instruction or review approval |
| `sourceUserMessageId` | varchar(100) | Authorization source |
| `intentDecisionId` | integer, nullable | Required for direct send |
| `batchHash` | varchar(64) | Exact authorized envelope set |
| `tokenHash` | varchar(64), nullable | Review approval only |
| `status` | varchar(20) | `active`, `consumed`, `invalidated`, `expired` |
| `expiresAt` | datetime | Required |
| `consumedAt` | datetime, nullable | Atomic claim time |
| `invalidatedAt` | datetime, nullable | Edit/policy change |
| `invalidationReason` | varchar(100), nullable | Stable reason code |
| audit fields | datetime | Existing base fields |

Rules:

- direct-send authorization expires after 15 minutes;
- review approval expires after 30 minutes;
- only one active authorization may exist for a batch;
- raw review tokens are returned once and never stored;
- the model never receives the raw token;
- any envelope-affecting edit invalidates the authorization.

### 7.6 `OutboundEmailSendAttemptEntity`

Table: `outbound_email_send_attempt`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer PK | Generated |
| `batchId` | integer | Indexed |
| `authorizationId` | integer | One-time authorization |
| `batchHash` | varchar(64) | Verified at claim |
| `idempotencyKey` | varchar(128) | Unique |
| `status` | varchar(40) | Attempt lifecycle |
| `legacyTaskId` | integer, nullable | Existing campaign task |
| `workerPid` | integer, nullable | Diagnostic only |
| `claimedAt` | datetime | Atomic claim time |
| `workerStartedAt` | datetime, nullable | Start acknowledgement |
| `completedAt` | datetime, nullable | Terminal time |
| `lastErrorCode` | varchar(100), nullable | Sanitized |
| audit fields | datetime | Existing base fields |

The idempotency key is:

```text
outbound-email:v1:<batchId>:<authorizationId>:<batchHash>
```

It is generated by trusted code and protected by a unique index.

### 7.7 `OutboundEmailDeliveryOutcomeEntity`

Table: `outbound_email_delivery_outcome`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer PK | Generated |
| `sendAttemptId` | integer | Indexed |
| `batchId` | integer | Indexed |
| `draftId` | integer | Unique with attempt |
| `revisionId` | integer | Exact revision |
| `envelopeHash` | varchar(64) | Correlation check |
| `recipientAddress` | varchar(320) | Canonical recipient |
| `status` | varchar(30) | Recipient outcome |
| `providerMessageId` | varchar(500), nullable | When available |
| `errorCode` | varchar(100), nullable | Sanitized |
| `submittedAt` | datetime, nullable | Provider accepted request |
| `completedAt` | datetime, nullable | Terminal local status |
| audit fields | datetime | Existing base fields |

Indexes:

- unique `(sendAttemptId, draftId)`;
- `(batchId, status)`;
- `(providerMessageId)` where supported.

### 7.8 `OutboundEmailAuditLogEntity`

Table: `outbound_email_audit_log`

Audit events include:

- intent resolved;
- batch created;
- draft generated or edited;
- preflight passed or failed;
- direct authorization created;
- review approval created;
- authorization invalidated, expired, or consumed;
- send claim accepted or deduplicated;
- worker started or failed to start;
- recipient submitted, sent, failed, suppressed, or unknown;
- batch finalized;
- manual recovery action.

The record stores actor type, stable reason code, entity identifiers, policy
versions, and sanitized metadata. It must not store SMTP passwords, access
tokens, complete prompts, or unredacted customer data beyond addresses already
necessary for email operation.

## 8. State Machines

### 8.1 Batch lifecycle

```text
drafting
  -> draft_ready
       -> preflight_failed
       -> awaiting_review
       -> direct_authorized
       -> discarded

awaiting_review
  -> review_authorized
  -> draft_ready        (after edit; approval invalidated)
  -> discarded

direct_authorized | review_authorized
  -> queued
  -> draft_ready        (authorization expires or invalidates)

queued
  -> sending
  -> failed             (worker definitely did not start)

sending
  -> sent
  -> partially_sent
  -> delivery_unknown
  -> failed             (all failures are known safe failures)
```

Terminal states are `sent`, `partially_sent`, `delivery_unknown`, `failed`, and
`discarded`. A new send requires a new authorization after any terminal state
other than the idempotent lookup of the same attempt.

### 8.2 Authorization lifecycle

```text
active -> consumed
active -> invalidated
active -> expired
```

No transition returns an authorization to `active`.

### 8.3 Recipient lifecycle

```text
draft -> invalid
draft -> authorized -> queued -> submitted -> sent
                                  |            -> delivery_unknown
                                  -> failed
draft -> discarded
```

A suppressed recipient is recorded as `suppressed` during preflight and is not
included in the authorized envelope set. If product policy requires all selected
recipients to be eligible, any suppression blocks the entire batch; the initial
implementation follows that stricter complete-batch rule.

## 9. Trusted Intent Resolution

### 9.1 Integration point

`AIChatQueryEngine` already persists the current user message and receives the
resulting message ID. Immediately after persistence and before starting the AI
query loop, it calls `OutboundEmailIntentResolver` with:

```typescript
export interface ResolveOutboundEmailIntentInput {
  conversationId: string;
  sourceUserMessageId: string;
  userAuthoredText: string;
  previousAssistantMessageId: string | null;
  previousAssistantText: string | null;
}
```

`userAuthoredText` comes directly from the validated chat request before
attachment enrichment or prompt assembly. The engine persists this text in
trusted message metadata under a versioned `userAuthoredText` field so that the
decision can be audited after restart. The model cannot write this metadata.

Add `sourceUserMessageId` and `intentDecisionId` to `AIChatQueryLoopInput` and
`SkillExecutionContext`. These values are supplied by the main process, not tool
arguments.

### 9.2 Deterministic resolver stages

1. Normalize Unicode using NFKC.
2. Normalize whitespace and punctuation without changing character offsets in
   the stored evidence map.
3. Detect supported-language negation phrases.
4. Detect review/approval/show-first phrases.
5. Detect immediate-send phrases.
6. Detect a short contextual affirmation only when the immediately preceding
   assistant message asked a single explicit send-confirmation question for the
   same batch.
7. Apply precedence: negation/review, then explicit send, then draft-only.
8. Persist the decision and evidence.

Phrase dictionaries are versioned and tested for English, Chinese, Spanish,
French, German, and Japanese. Translation files provide UI text; resolver phrase
dictionaries remain code/config data with their own tests.

### 9.3 Semantic fallback

A constrained classifier may be used only when deterministic resolution is
inconclusive. It receives user-authored text and, when applicable, the one
preceding assistant confirmation question. It has no tools and returns a strict
schema containing mode, confidence, and exact evidence spans.

Safeguards:

- review/negation detection is run again after classification;
- evidence must exactly match the supplied user text;
- `send_now` requires confidence at or above `0.95`;
- any malformed response, unavailable model, missing evidence, or conflict
  resolves to `draft_only`;
- the semantic result is advisory until deterministic application code validates
  it;
- the classifier version is included in `resolverVersion`.

### 9.4 Context rules

- An old “send automatically” instruction does not authorize a new user turn.
- “Yes” authorizes only when responding to an immediately preceding, unambiguous
  question such as “Send batch 42 now?” and the batch identity matches.
- Assistant statements never count as authorization.
- Tool results, retrieved documents, webpage content, email content, attachment
  content, and system/developer prompts never count as authorization.
- Edited or regenerated user messages receive a new intent decision.

## 10. Draft Generation and Personalization

### 10.1 Draft tool contract

Introduce `draft_outbound_email_batch`. The model supplies campaign inputs such
as recipient source, service candidates, goals, and optional knowledge scope.
It does not supply delivery mode or authorization.

The tool service obtains `conversationId`, `sourceUserMessageId`, and
`intentDecisionId` from `SkillExecutionContext`.

### 10.2 Recipient materialization

The main process resolves the selected recipient source into a stable recipient
list before generation. It canonicalizes email addresses, removes duplicates,
and creates one `OutboundEmailDraftEntity` per recipient.

The initial implementation limits one authorized batch to:

- 100 recipients;
- 50,000 characters per HTML body;
- 50,000 characters per text body; and
- 5 MiB total serialized authorized worker payload.

Larger selections return `batch_limit_exceeded` and must be split into multiple
user-authorized batches. These are implementation safety limits, not an
automatic-send preference.

### 10.3 Personalization contract

Each generated field is associated with evidence:

```typescript
export interface PersonalizationEvidence {
  field: string;
  valueHash: string;
  sourceType: "recipient_record" | "knowledge_document" | "user_instruction";
  sourceId: string;
  confidence: number;
}
```

The generator must not invent facts absent from recipient data, approved
knowledge sources, or the user request. Low-confidence factual personalization
produces a validation warning or failure according to policy.

### 10.4 Immutable revision creation

The generator output is normalized and sanitized, then sender assignment,
variable substitution, signatures, and links are applied. The service computes
the envelope hash and inserts an immutable revision. The draft projection is
updated to reference that revision in the same transaction.

Editing creates a new revision, updates the projection, recomputes the batch
hash, and invalidates any active authorization.

## 11. Canonical Hashing

Create `OutboundEmailEnvelopeHasher` using SHA-256 over canonical UTF-8 JSON.

Envelope canonicalization:

```typescript
interface CanonicalOutboundEnvelopeV1 {
  version: 1;
  emailServiceId: number;
  senderAddress: string;
  recipientAddress: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
}
```

Rules:

- normalize addresses to trimmed lowercase form for hashing;
- preserve subject/body content exactly after newline normalization to `\n`;
- represent missing HTML as `null`, not an empty string;
- serialize fields in the declared order;
- include a schema version;
- never include timestamps or database IDs in the envelope hash.

Batch hashing sorts envelopes by `(recipientAddress, draftId)` and hashes:

```text
SHA256("outbound-batch:v1\n" + envelopeHash1 + "\n" + ...)
```

The worker re-computes each envelope hash and the batch hash before sending. A
mismatch stops the entire batch before SMTP submission and reports
`worker_payload_hash_mismatch`.

## 12. Complete-Batch Preflight

`OutboundEmailPreflightService` validates every current revision before any
authorization is created.

Checks include:

1. Batch is non-empty and within size limits.
2. Every selected recipient has exactly one draft and current revision.
3. Recipient addresses are syntactically valid and unique.
4. Suppression, unsubscribe, blocklist, and email-filter rules pass.
5. Every selected email service exists, is enabled, and has usable credentials.
6. Each revision is bound to one allowed service and matching sender address.
7. Subject and bodies meet length and non-empty requirements.
8. HTML is sanitized and contains no prohibited executable content.
9. Required legal/footer content is present when policy requires it.
10. Personalization evidence is present for asserted customer-specific facts.
11. Knowledge sources remain accessible and permitted.
12. No template variables or unresolved placeholders remain.
13. All envelope hashes and the batch hash recompute correctly.
14. Policy and validation versions are current.

The operation is all-or-nothing. Any blocking finding prevents authorization
and returns structured findings grouped by recipient.

```typescript
export interface OutboundEmailPreflightResult {
  passed: boolean;
  batchHash: string | null;
  policyVersion: string;
  validationVersion: string;
  findings: OutboundEmailPreflightFinding[];
}
```

## 13. Authorization

### 13.1 Direct-send authorization

After preflight passes, `OutboundEmailAuthorizationService` may create an
`explicit_user_instruction` authorization only when all conditions hold:

- intent decision mode is `send_now`;
- decision conversation and source message match the batch;
- the source user message is the current turn in the execution context;
- decision has not already authorized another batch unless the request clearly
  described multiple separately materialized batches;
- decision resolver version is supported;
- preflight passed against the current batch hash;
- no existing attempt or consumed authorization exists;
- tool permission remains granted.

The authorization is created by application code automatically. There is no
additional confirmation dialog and no global setting.

### 13.2 Review approval

For `review_first`, preflight moves the batch to `awaiting_review`. The renderer
loads all final drafts. When the user clicks Send, the main process reruns
preflight and creates an `exact_draft_approval` authorization bound to the new
batch hash.

The approval endpoint may internally generate a random 256-bit token, store only
its SHA-256 hash, and consume it in the same main-process workflow. The raw token
must not appear in model context, logs, audit metadata, URLs, or renderer local
storage.

### 13.3 Invalidation

An active authorization is invalidated when:

- any revision changes;
- a recipient is added, removed, or changed;
- sender or service assignment changes;
- suppression/policy state changes materially;
- the authorization expires;
- the batch is discarded; or
- the app detects hash or ownership inconsistency.

## 14. AI Tool Policy Enforcement

### 14.1 Skill metadata

Extend `SkillDefinition` with an optional policy classification:

```typescript
export type ToolConfirmationPolicy =
  | "standard_permission"
  | "request_scoped_action";

export interface SkillDefinition {
  // existing fields...
  confirmationPolicy?: ToolConfirmationPolicy;
}
```

`start_email_send_task` is configured as `request_scoped_action`. The default is
`standard_permission`, preserving existing tools.

### 14.2 Generic approval modes

Update `AIChatToolApprovalPolicyService` so it never auto-approves a
`request_scoped_action` solely because the conversation is in
`approve_for_me` or `full_access` mode.

For the outbound send tool, `OutboundEmailToolGate` must return an explicit
one-call decision:

```typescript
export type OutboundEmailToolGateResult =
  | { allowed: true; batchId: number; authorizationId: number }
  | {
      allowed: false;
      code:
        | "draft_required"
        | "review_required"
        | "authorization_missing"
        | "authorization_expired"
        | "authorization_invalidated"
        | "batch_hash_mismatch"
        | "permission_denied";
      batchId: number | null;
    };
```

Only an `allowed: true` result permits the query loop to skip the generic
confirmation prompt for that exact tool call. The delivery service repeats all
critical checks so alternate callers cannot bypass policy.

### 14.3 Updated send tool contract

The preferred send tool accepts only a durable batch reference:

```typescript
const startOutboundEmailSendSchema = z.object({
  batch_id: z.number().int().positive(),
});
```

Recipient lists, subjects, bodies, sender service IDs, delivery mode, and
authorization values are not accepted by the send tool. They come from the
persisted batch and trusted execution context.

Legacy `start_email_send_task` arguments remain temporarily available behind a
compatibility adapter, but calls from AI chat are routed through draft creation
first. Direct legacy submission is removed after migration.

## 15. Authoritative Delivery Service

Create `src/service/outboundEmail/OutboundEmailDeliveryService.ts`.

### 15.1 Claim transaction

In one database transaction:

1. Load batch, current revisions, authorization, and any existing attempt.
2. Confirm conversation and user-message ownership.
3. Confirm batch status is `direct_authorized` or `review_authorized`.
4. Confirm authorization is active and not expired.
5. Recompute envelope hashes and batch hash.
6. Confirm authorization hash equals current batch hash.
7. Confirm preflight policy and validation versions remain current.
8. Insert the send attempt using the unique idempotency key.
9. Insert one pending delivery outcome per draft.
10. Mark authorization consumed.
11. Mark batch and drafts queued.

If the idempotency key already exists, return the existing attempt as a
successful deduplicated result. Do not start another worker.

### 15.2 Worker preparation

After the transaction commits, the service asks a narrow adapter in
`BuckEmailTaskModule` to:

- create/link the legacy campaign task needed by existing task UI;
- load SMTP service credentials in the main process;
- verify the credentials correspond to the frozen service IDs;
- construct `AuthorizedEmailWorkerPayloadV2` from immutable revisions;
- start the utility process; and
- register typed event handlers.

No SMTP call occurs inside a database transaction.

### 15.3 Worker-start failure

If the utility process definitely fails before accepting the payload:

- mark the attempt `failed` with `worker_start_failed`;
- mark pending outcomes `failed` with retry safety `safe`;
- mark the batch `failed`;
- preserve the consumed authorization and audit trail.

A retry requires a new explicit user request or a new review approval. This is
slightly conservative but avoids silent duplicate paths.

### 15.4 Progress correlation

The main process accepts a worker event only when all of these match an active
attempt:

- `batchId`;
- `sendAttemptId`;
- `draftId`;
- `revisionId`; and
- `envelopeHash`.

Mismatched events are rejected and audited as `worker_event_correlation_failed`.

## 16. Worker Implementation

### 16.1 `taskCode.ts`

Add a new message type such as `sendAuthorizedEmails`. Validate the payload with
the shared schema before passing it to `EmailSend`.

### 16.2 `EmailSend`

Keep the existing `send(Buckemailremotedata)` method for legacy campaigns. Add a
separate method:

```typescript
public async sendAuthorizedEnvelopes(
  payload: AuthorizedEmailWorkerPayloadV2,
  eventCallback: (event: AuthorizedEmailWorkerEvent) => void
): Promise<void>;
```

The authorized method:

1. validates size limits and hashes before sending anything;
2. creates a service map by service ID;
3. rejects missing or duplicate service records;
4. uses the exact service assigned to each envelope;
5. uses the exact subject/body in the envelope;
6. does not call `convertVariableInTemplate`;
7. does not choose random templates or services;
8. reports typed per-envelope results;
9. limits concurrency to five SMTP submissions; and
10. zeroes credential references and releases transport objects after completion.

The worker performs no database access and does not make authorization
decisions.

### 16.3 Chunking and backpressure

The main process sends at most 25 envelopes concurrently to the worker. The
worker concurrency limit is five. All envelopes belong to one attempt and retain
their unique delivery outcome rows.

If the serialized payload exceeds 5 MiB, preflight fails rather than silently
splitting an authorization into independently retryable jobs. A later milestone
may add a manifest-based chunk protocol with per-chunk idempotency.

## 17. IPC and Renderer APIs

Add channels to `src/config/channellist.ts` and expose them through the existing
preload/contextBridge pattern.

| Channel | Direction | Purpose |
| --- | --- | --- |
| `OUTBOUND_EMAIL_BATCH_GET` | invoke | Load batch, drafts, findings, and status |
| `OUTBOUND_EMAIL_DRAFT_UPDATE` | invoke | Create a new user revision |
| `OUTBOUND_EMAIL_BATCH_APPROVE` | invoke | Rerun preflight and approve exact batch |
| `OUTBOUND_EMAIL_BATCH_SEND` | invoke | Claim and start authorized delivery |
| `OUTBOUND_EMAIL_BATCH_DISCARD` | invoke | Discard unsent batch |
| `OUTBOUND_EMAIL_BATCH_STATUS` | invoke | Refresh attempt and outcomes |
| `OUTBOUND_EMAIL_BATCH_PROGRESS` | event | Push status/outcome changes |

### 17.1 IPC handler rules

- AI-dependent draft generation handlers check `USER_AI_ENABLED` through
  `Token` before parsing or doing work.
- Every input is validated by a Zod schema.
- The handler validates conversation/batch ownership.
- Handlers call modules/services; they never access TypeORM repositories.
- Error responses use stable codes plus localized renderer messages.
- Raw approval tokens and SMTP credentials never cross to the renderer.

### 17.2 Renderer API

Create `src/views/api/outboundEmailDelivery.ts` with typed functions for the
channels above and an unsubscribe-safe progress listener.

## 18. Review User Interface

Create an outbound batch review component/page reachable from the AI chat result.

Required behavior:

- show batch mode and why review is required;
- show recipient count and preflight summary;
- list every recipient with sender, subject, body preview, evidence, warnings,
  and status;
- allow editing subject and body by creating a new revision;
- clearly indicate that edits invalidate prior approval;
- provide Send and Discard actions;
- disable Send while preflight has blocking findings;
- show progress and per-recipient outcomes;
- distinguish `failed` from `delivery_unknown`;
- never offer one-click retry for `delivery_unknown`;
- show a direct-send completion summary in chat without requiring a review page.

All user-facing text must use translation keys in `en.ts`, `zh.ts`, `es.ts`,
`fr.ts`, `de.ts`, and `ja.ts`, with English fallbacks.

Suggested components:

- `OutboundEmailBatchCard.vue` for chat summaries;
- `OutboundEmailReviewDialog.vue` for review/edit/approve;
- `OutboundEmailRecipientDraft.vue` for one recipient;
- `OutboundEmailDeliveryProgress.vue` for results.

## 19. Prompt and Tool Guidance

System/tool guidance must describe the enforced semantics, but prompts are not a
security control.

The AI should be instructed to:

- create a durable draft batch before requesting delivery;
- never infer authorization from its own text;
- never claim emails were sent until the tool reports an attempt/outcome;
- stop after drafting when the tool reports `review_required`;
- explain blocking preflight findings without retry loops;
- reference the batch ID rather than resending content through tool arguments;
- avoid repeatedly calling the send tool after a structured rejection.

## 20. Error Contract

Services return stable machine codes.

| Code | Meaning | Retry behavior |
| --- | --- | --- |
| `intent_not_send_now` | Current request does not authorize direct send | Show drafts or ask user |
| `review_required` | Review instruction is active | Open review UI |
| `draft_required` | No durable batch exists | Create draft batch |
| `preflight_failed` | One or more blocking findings | Fix drafts/configuration |
| `authorization_missing` | No active authorization | New instruction or approval |
| `authorization_expired` | Authorization timed out | New instruction or approval |
| `authorization_invalidated` | Content/policy changed | Review/authorize current content |
| `batch_hash_mismatch` | Stored content differs from authorization | Stop and audit |
| `send_already_claimed` | Idempotent attempt already exists | Return existing status |
| `worker_start_failed` | No SMTP submission began | New authorization required |
| `delivery_unknown` | Submission may have occurred | Never automatic retry |
| `worker_event_correlation_failed` | Event does not match attempt | Reject event and investigate |
| `batch_limit_exceeded` | Batch or payload exceeds limits | Split into new batches |
| `ai_disabled` | AI entitlement disabled | Do not generate drafts |

## 21. Recovery and Reconciliation

Create `OutboundEmailRecoveryService`, invoked at application startup after the
database connection is ready.

Recovery rules:

1. Expire active authorizations past `expiresAt`.
2. For `claimed` attempts with no worker-start timestamp after two minutes, mark
   failed only when process/task evidence proves the worker never started.
3. For `sending` attempts with a dead worker and pending/submitted outcomes,
   mark uncertain recipients `delivery_unknown`.
4. Recompute batch status from recipient outcomes.
5. Never create a new attempt during recovery.
6. Emit audit events for every recovery transition.

Provider reconciliation may update `delivery_unknown` only when the configured
provider exposes a reliable message ID/status API. SMTP transports without such
an API remain unknown until a human decides what to do.

## 22. Security and Privacy

### 22.1 Authorization controls

- Authorization comes only from the current trusted user turn or explicit UI
  approval.
- Generic AI tool modes cannot satisfy action authorization.
- The delivery service repeats checks made by the tool gate.
- Authorization binds to exact immutable envelopes and expires.
- The send attempt is atomically claimed and idempotent.

### 22.2 Prompt-injection controls

- Retrieved content, webpages, attachments, customer records, and email bodies
  are data, never authorization sources.
- The intent resolver sees only user-authored text plus a narrowly permitted
  previous confirmation question.
- LLM-provided authorization fields are absent from schemas and ignored if
  present.
- Semantic classification output is validated against exact evidence spans.

### 22.3 Data handling

- SMTP credentials remain main/worker-process secrets and never enter renderer
  state, model context, audit metadata, or logs.
- Audit records use stable codes and hashes where possible.
- Personalization evidence stores source references and value hashes rather than
  copying complete sensitive source documents.
- HTML is sanitized before revision creation.
- Progress events contain only identifiers, recipient address, state, and
  sanitized error codes.

### 22.4 Denial and suppression

Explicit deny lists, unsubscribe records, filters, invalid addresses, disabled
services, and applicable sending policy always override user send intent.

## 23. Observability

### 23.1 Metrics

- intent decisions by mode and resolver version;
- deterministic versus semantic classification rate;
- semantic `send_now` promotion rate;
- review/negation override rate;
- draft generation success and latency;
- preflight failure rate by code;
- direct versus reviewed authorization rate;
- authorization expiration/invalidation rate;
- send-tool policy rejection rate;
- idempotent duplicate suppression count;
- worker-start failure rate;
- per-recipient sent/failed/unknown rate;
- time from user request to authorization and completion.

### 23.2 Structured logs

Logs correlate by:

- `conversationId`;
- `sourceUserMessageId`;
- `intentDecisionId`;
- `batchId`;
- `authorizationId`;
- `sendAttemptId`;
- `draftId` and `revisionId`.

Logs must not include bodies, credentials, raw approval tokens, or complete
customer profiles.

### 23.3 Alerts

Operational alerts should fire for:

- any direct send without a matching authorization record;
- any batch-hash mismatch;
- duplicate SMTP submissions for one idempotency key;
- elevated `delivery_unknown` rate;
- worker correlation failures; and
- semantic resolver drift above the evaluated false-positive threshold.

## 24. Testing Strategy

### 24.1 Intent resolver unit tests

Create table-driven tests for all supported languages covering:

- explicit immediate-send requests;
- explicit review-first requests;
- “do not send” variants;
- mixed send and review wording;
- ambiguous draft wording;
- quoted instructions and attachment content that must be ignored;
- contextual “yes” after a valid confirmation question;
- “yes” without a valid immediately preceding question;
- semantic classifier malformed output and low confidence;
- resolver restart/idempotency behavior.

Maintain a versioned evaluation corpus. Release requires zero false
`send_now` decisions for the deny/review subset.

### 24.2 Hash and revision tests

- Same canonical envelope produces the same hash.
- Any sender, recipient, subject, text, or HTML change changes the hash.
- Newline normalization is stable across platforms.
- Editing appends a revision and invalidates authorization.
- Batch ordering is deterministic.
- Worker rejects a modified payload before SMTP.

### 24.3 Authorization tests

- `send_now` creates one direct authorization after preflight.
- `review_first` never creates direct authorization.
- UI approval binds to exact current batch hash.
- Expired, consumed, invalidated, and mismatched authorization is rejected.
- One intent decision cannot silently authorize a later unrelated batch.
- Generic `approve_for_me` and `full_access` do not bypass action authorization.
- Explicit tool permission denial blocks an otherwise authorized batch.

### 24.4 Model and module tests

- Entity constraints and indexes enforce uniqueness.
- Atomic claim allows only one concurrent attempt.
- Duplicate calls return the existing attempt.
- Worker process database guards reject model access.
- Recovery transitions stale attempts conservatively.
- Outcome aggregation produces correct batch states.

### 24.5 Worker tests

- Authorized mode pins service per envelope.
- No random template/service path is called.
- No variable conversion occurs after authorization.
- Concurrency limit is enforced.
- Typed progress carries correct IDs/hashes.
- Missing services, hash mismatch, and oversized payload stop before SMTP.
- Mixed success/failure creates correct events.

### 24.6 IPC tests

- AI entitlement is checked first for AI-generation handlers.
- Malformed input is rejected.
- Renderer cannot supply authorization or delivery mode.
- Batch ownership is enforced.
- IPC handlers do not access repositories directly.
- Progress listener cleanup prevents duplicate subscriptions.

### 24.7 Vue component tests

Under `test/vitest/main/components/`, cover:

- draft list rendering;
- blocking finding display;
- edit creates new revision and invalidates approval state;
- Send disabled before passing preflight;
- approval and send interaction;
- direct-send summary;
- partial failure and `delivery_unknown` presentation;
- all six locale keys present.

Run `yarn test:components` as a hard gate.

### 24.8 End-to-end tests

Under `test/e2e/specs/`, use a fake SMTP transport and deterministic AI fixtures:

1. “Draft ten personalized emails and send them directly” sends exactly ten
   unique authorized envelopes without a review dialog.
2. “Draft ten emails and show me before sending” opens review and sends nothing.
3. Editing one reviewed draft invalidates prior approval and requires approval
   of the new hash.
4. A repeated send tool call creates no duplicate delivery.
5. “Send after I approve” cannot send in a generic auto-approval mode.
6. Worker crash after an uncertain provider submission produces
   `delivery_unknown` and no automatic retry.

## 25. Performance and Limits

Initial service-level targets:

- deterministic intent resolution: p95 below 25 ms;
- persisted intent decision: p95 below 100 ms excluding database startup;
- preflight for 100 recipients: p95 below 2 seconds excluding remote knowledge
  retrieval;
- atomic claim transaction: p95 below 250 ms;
- review page first render: below 1 second for 100 drafts from local SQLite;
- progress event propagation: p95 below 500 ms.

Database transactions must not include AI calls, knowledge retrieval, SMTP,
utility-process startup, or renderer IPC.

## 26. Feature Flags and Kill Switches

Use application-owned rollout flags, not user-facing automatic-send settings:

- `outboundIntentResolutionEnabled`;
- `outboundDurableDraftsEnabled`;
- `outboundAuthorizedEnvelopeWorkerEnabled`;
- `outboundDirectSendEnabled`;
- `outboundReviewUiEnabled`.

These are deployment controls. They are not presented as personal authorization
preferences.

If `outboundDirectSendEnabled` is off, `send_now` requests still create complete
drafts but resolve operationally to review-required with a clear product message.
The emergency kill switch must never fall back to the legacy unguarded send path.

## 27. Migration and Backward Compatibility

### 27.1 Database migration

1. Add and register the eight outbound entities.
2. Create indexes and uniqueness constraints.
3. Leave existing bulk-email tables unchanged.
4. Permit nullable links from new batches/attempts to legacy task IDs.
5. Do not migrate historical bulk campaigns into authorization records; label
   them as legacy in UI/audit views.

Although the current development datasource uses TypeORM synchronization, the
release build should include an explicit, idempotent schema migration or startup
schema guard for user databases.

### 27.2 Tool migration

1. Add the draft tool and new batch-only send contract.
2. Route AI chat sends through the domain gate.
3. Keep the legacy call shape for non-AI/manual campaign flows.
4. Emit deprecation telemetry for AI calls using legacy content arguments.
5. Remove the AI legacy adapter after the rollout acceptance window.

### 27.3 Worker migration

`EmailSend.send()` remains unchanged for manual legacy campaigns during rollout.
`sendAuthorizedEnvelopes()` is additive and selected only by the versioned
payload discriminator.

## 28. Implementation Plan

### Phase 1: Intent decision and hard tool gate

Files/components:

- outbound intent types, entity, model, module, and resolver;
- trusted context fields in `AIChatQueryEngine`, `AIChatQueryLoopInput`, and
  `SkillExecutionContext`;
- confirmation policy metadata in `SkillDefinition`;
- outbound tool gate and generic approval-policy update;
- resolver and policy tests.

Exit criteria:

- review/negation requests cannot reach the send implementation;
- generic approval modes cannot authorize outbound delivery;
- intent decisions survive restart.

### Phase 2: Durable drafts, revisions, preflight, and hashing

Files/components:

- batch, draft, revision, and audit entities/models/modules;
- draft-generation service;
- envelope hasher;
- preflight service;
- `draft_outbound_email_batch` tool;
- model/module/hash/preflight tests.

Exit criteria:

- every recipient has a final immutable envelope;
- no authorization exists before complete-batch preflight passes.

### Phase 3: Authorization and idempotent delivery

Files/components:

- authorization, send-attempt, and outcome entities/models/modules;
- authorization and delivery services;
- narrow `BuckEmailTaskModule` adapter;
- versioned task/worker payload;
- authorized worker path and progress handling;
- concurrency, crash, and idempotency tests.

Exit criteria:

- explicit send-now produces one attempt without review;
- reviewed drafts require exact-content approval;
- duplicate requests cannot duplicate SMTP submission.

### Phase 4: Review UI and localization

Files/components:

- renderer API;
- review dialog, draft editor, batch card, and progress UI;
- all six translation files;
- component and E2E tests.

Exit criteria:

- users can inspect/edit/approve all drafts;
- edits invalidate approval;
- direct-send status is visible without review friction.

### Phase 5: Recovery, telemetry, and legacy retirement

Files/components:

- recovery service;
- startup reconciliation;
- structured metrics and alerts;
- legacy AI-path deprecation and removal;
- full regression/evaluation corpus.

Exit criteria:

- restart and worker-failure behavior is conservative and auditable;
- no AI outbound path bypasses the authoritative delivery service.

## 29. File-Level Change Map

### New files

- `src/entityTypes/outboundEmailDeliveryTypes.ts`
- `src/entity/OutboundEmailIntent.entity.ts`
- `src/entity/OutboundEmailDraftBatch.entity.ts`
- `src/entity/OutboundEmailDraft.entity.ts`
- `src/entity/OutboundEmailDraftRevision.entity.ts`
- `src/entity/OutboundEmailAuthorization.entity.ts`
- `src/entity/OutboundEmailSendAttempt.entity.ts`
- `src/entity/OutboundEmailDeliveryOutcome.entity.ts`
- `src/entity/OutboundEmailAuditLog.entity.ts`
- `src/model/OutboundEmailIntent.model.ts`
- `src/model/OutboundEmailDraft.model.ts`
- `src/model/OutboundEmailAuthorization.model.ts`
- `src/model/OutboundEmailDelivery.model.ts`
- `src/modules/OutboundEmailIntentModule.ts`
- `src/modules/OutboundEmailDraftModule.ts`
- `src/modules/OutboundEmailDeliveryModule.ts`
- `src/service/outboundEmail/OutboundEmailIntentResolver.ts`
- `src/service/outboundEmail/OutboundEmailDraftService.ts`
- `src/service/outboundEmail/OutboundEmailPreflightService.ts`
- `src/service/outboundEmail/OutboundEmailEnvelopeHasher.ts`
- `src/service/outboundEmail/OutboundEmailAuthorizationService.ts`
- `src/service/outboundEmail/OutboundEmailToolGate.ts`
- `src/service/outboundEmail/OutboundEmailDeliveryService.ts`
- `src/service/outboundEmail/OutboundEmailRecoveryService.ts`
- `src/views/api/outboundEmailDelivery.ts`
- renderer components listed in Section 18;
- corresponding module, main-process, component, and E2E tests.

### Modified files

- `src/config/SqliteDb.ts` for entity registration;
- `src/config/channellist.ts` for IPC channels;
- `src/config/skillsRegistry.ts` for draft/send tool contracts and policy class;
- `src/entityTypes/skillTypes.ts` for trusted execution context and confirmation
  policy;
- `src/service/AIChatQueryEngine.ts` for current-turn intent resolution;
- `src/service/AIChatQueryEvents.ts` for trusted context fields;
- `src/service/AIChatQueryLoop.ts` for domain gate integration;
- `src/service/AIChatToolApprovalPolicyService.ts` for request-scoped actions;
- `src/service/EmailMarketingAiTools.ts` for compatibility routing;
- `src/modules/buckEmailTaskModule.ts` for the authorized worker adapter;
- `src/taskCode.ts` for the versioned message;
- `src/childprocess/emailSend.ts` for exact-envelope sending;
- preload/main-process registration files;
- six language files.

## 30. Definition of Done

Implementation is complete only when:

1. No email-specific automatic-send setting exists.
2. Explicit send-now requests can send directly after successful complete-batch
   preflight.
3. Review, approval, check, show-first, or do-not-send wording prevents direct
   sending.
4. Ambiguous wording produces drafts only.
5. Authorization is derived from trusted current-turn context, not tool args.
6. Every sent email matches an immutable authorized revision and batch hash.
7. Tool permission and action authorization are independently enforced.
8. Generic AI approval modes cannot bypass the outbound action gate.
9. The delivery service is the only AI-accessible send entry point.
10. Atomic claims and unique idempotency keys prevent duplicate attempts.
11. Workers perform no database access and no content mutation.
12. Per-recipient outcomes and all policy transitions are durable and auditable.
13. Unknown outcomes are not retried automatically.
14. Review UI edits invalidate authorization and create new revisions.
15. All new UI text exists in all six supported languages.
16. Unit, module, IPC, worker, component, and E2E suites pass.
17. Intent evaluation shows zero false direct sends on the deny/review corpus.
18. The legacy AI send path is disabled before general availability.

## 31. Requirements Traceability

| PRD requirement | Technical design sections |
| --- | --- |
| FR-001 Trusted request-scoped intent resolution | 6.1, 9 |
| FR-002 Review and negation take precedence | AD-002, 9.2 |
| FR-003 Explicit send request is one-time action authorization | AD-001, 13.1 |
| FR-004 Permission and authorization separation | AD-004, 14 |
| FR-005 Outbound draft batches | 7.2, 10 |
| FR-006 Per-recipient draft revisions | 7.3, 7.4, 10.4 |
| FR-007 Personalized content generation | 10.3 |
| FR-008 Knowledge and customer-data grounding | 10.3, 12, 22.3 |
| FR-009 Complete batch preflight | 12 |
| FR-010 Exact-content review approval | 11, 13.2 |
| FR-011 Direct-send authorization envelope | 11, 13.1 |
| FR-012 Authoritative outbound send entry point | 15 |
| FR-013 Tool-call policy enforcement | 14 |
| FR-014 Enforced outbound lifecycle | 8 |
| FR-015 Duplicate prevention and idempotency | AD-009, 15.1 |
| FR-016 Recipient and sender binding | AD-005, 6.2, 11 |
| FR-017 Suppression and policy enforcement | 12, 22.4 |
| FR-018 Prompt and tool guidance | 19 |
| FR-019 Review user interface | 17, 18 |
| FR-020 Direct-send user feedback | 18 |
| FR-021 Audit trail | 7.8, 23 |
| FR-022 Recovery and ambiguous delivery | AD-010, 21 |
| FR-023 AI feature entitlement gate | 17.1 |

## 32. Final Engineering Decisions

1. The product will not add an “Allow automatic sending” system setting.
2. Clear send-now language authorizes one exact batch, not a persistent mode.
3. Review and negation language always blocks direct sending.
4. The current user message identity travels through trusted execution context.
5. The model cannot choose or manufacture authorization state.
6. Final per-recipient envelopes are generated, rendered, validated, and hashed
   before authorization.
7. The authorized worker path uses no random template/service selection and no
   post-authorization content transformation.
8. The main process owns database access, authorization, idempotency, and result
   persistence.
9. Workers only submit exact prepared envelopes and return correlated events.
10. Ambiguous provider outcomes require a new human decision and are never
    retried automatically.
