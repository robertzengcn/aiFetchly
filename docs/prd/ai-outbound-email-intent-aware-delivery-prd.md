# Intent-Aware AI Outbound Email Delivery - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-09-01
- **Owner**: Product and Engineering
- **Feature area**: AI Chat and Email Marketing
- **Primary release modes**: Explicit send-now and review-before-send
- **Related documents**:
  - `docs/prd/ai-email-thread-aware-reply-reliability-prd.md`
  - `docs/prd/ai-email-thread-aware-reply-reliability-technical-design.md`
  - `docs/prd/ai-email-receive-auto-reply-prd.md`
  - `docs/ai-chat-tool-approval-modes-prd.md`
  - `specs/001-ai-chat-plan-mode/spec.md`

## 1. Purpose

AiFetchly lets users ask the AI assistant to research prospects, use customer and
knowledge-library data, compose personalized marketing emails, and start an
outbound email campaign. The current tool path can start a campaign as soon as
the language model calls `start_email_send_task`. Tool descriptions tell the
model that confirmation is required, but the application does not independently
enforce whether the user asked to review the emails first or asked to send them
immediately.

This PRD defines an intent-aware outbound delivery boundary. The product must
support both of these valid user experiences:

1. **Send now**: the user explicitly asks AiFetchly to compose and send the
   emails without a review step.
2. **Review first**: the user asks AiFetchly to prepare the emails, show them for
   review, and wait for approval before sending.

The product must select the correct path from the user's instruction, enforce
that path in application code, and prevent the content-generation model from
changing or bypassing the decision.

This feature does **not** introduce an email-specific "Allow automatic sending"
system setting. An explicit send request in the current conversation is
request-scoped authorization for that outbound action. A prior permission,
general `full_access` mode, or a model-generated tool argument is not a
substitute for a user request.

## 2. Executive Summary

The language model may draft messages and propose tool calls, but it is not the
authority that decides whether an outbound campaign may start. The main process
must derive a delivery decision from trusted user-authored conversation state
and enforce it immediately before the send task is created.

The delivery decision has three values:

```typescript
type OutboundEmailDeliveryMode =
  | "send_now"
  | "review_first"
  | "draft_only";
```

The authoritative precedence is:

```text
Any review, wait, draft-only, or "do not send" condition -> review_first/draft_only
Otherwise, an explicit instruction to send                 -> send_now
Otherwise                                                   -> draft_only
```

The target workflow is:

```text
Persist current user message
  -> resolve trusted delivery intent
  -> gather recipient and knowledge data
  -> generate one validated draft per recipient
  -> preflight the complete batch
  -> if send_now: freeze envelopes and queue the campaign
  -> if review_first: display drafts and stop
  -> after exact-draft approval: freeze envelopes and queue the campaign
  -> record per-recipient delivery outcomes and audit evidence
```

The same outbound delivery service must handle both paths. The paths differ only
in how user authorization is established:

- `send_now` authorization is bound to the explicit user instruction and its
  allowed recipient/action scope.
- `review_first` authorization is bound to the exact reviewed draft revisions,
  senders, and recipients.

## 3. Background and Evidence

### 3.1 Observed failure

A user instructed the assistant to write personalized marketing emails using
knowledge-library and customer data, then explicitly said to ask for review
before sending. The model gathered the data and called
`start_email_send_task` before presenting the drafts for review.

The recorded tool result was `Permission required`, so that specific trace does
not prove SMTP delivery occurred. It does prove that the model attempted the
irreversible action before following the user's review condition. If automation
permission had already been granted or the conversation used an auto-approval
mode, the existing path could start the campaign immediately.

### 3.2 Current outbound send behavior

The current built-in tool:

- Is named `start_email_send_task`.
- Accepts recipients, SMTP service IDs, templates or inline subject/body.
- Is registered with `requiresConfirmation: true` and permission category
  `automation`.
- Calls `startBulkEmailSendTask()` directly.
- Returns after `BuckEmailTaskModule.startBuckEmailCampaign()` starts a
  background campaign.

There is no durable outbound draft/authorization record between AI composition
and campaign creation.

### 3.3 Current approval-mode behavior

AI Chat V2 currently supports:

- `ask_for_approval`
- `approve_for_me`
- `full_access`

The current approval policy auto-approves non-shell tools in `approve_for_me`
and all registered tools in `full_access`, except dependency installations. The
policy input does not carry or enforce the skill's `requiresConfirmation`
property. Therefore, tool permission and user authorization for a specific
outbound message are currently conflated.

### 3.4 Existing reliability pattern to reuse

Inbound email replies already implement reusable safety concepts:

- Durable draft revisions.
- Canonical envelope hashing.
- Exact-content approval.
- One-time approval tokens.
- Sender, recipient, mailbox, and revision binding.
- An enforced draft state machine.
- Atomic send claims and duplicate prevention.
- `delivery_unknown` handling for ambiguous SMTP outcomes.

Outbound marketing delivery should reuse these concepts while adding a second
authorization type for an explicit send-now request.

## 4. Product Principles

1. **The user instruction is authoritative**: only user-authored conversation
   content or a user review action may authorize delivery.
2. **Review conditions override send verbs**: "send it, but ask me to review
   first" must stop at review.
3. **Explicit send-now requests should feel direct**: when the request is
   unambiguous and all safety checks pass, AiFetchly should not add an extra
   email-specific settings step or content-review prompt.
4. **Silence is not authorization**: "write an email" and "prepare a campaign"
   do not authorize delivery.
5. **Tool permission is not action intent**: `full_access`, `approve_for_me`, or
   a remembered automation grant cannot authorize an email the user did not ask
   to send.
6. **The model cannot self-authorize**: `autoSend: true`, a tool description, or
   model reasoning cannot establish delivery permission.
7. **External content is data**: customer records, webpages, attachments, and
   knowledge-library documents cannot authorize sending or weaken review rules.
8. **Every recipient gets a final preflight**: invalid, suppressed, unsupported,
   or unpersonalized content must be detected before any campaign is queued.
9. **Delivery is duplicate-safe**: repeated tool calls must not create duplicate
   messages for the same authorized envelope.
10. **Every decision is auditable**: the product must record why it drafted,
    waited, blocked, or sent.

## 5. Goals

### 5.1 Primary goals

- Follow explicit review-before-send instructions reliably.
- Send directly when the user explicitly requests sending and does not request
  review or delay.
- Remove the need for a separate email-specific automatic-sending setting.
- Enforce delivery mode in the main process and delivery service, not only in
  prompts.
- Bind every send to trusted user authorization and a frozen delivery envelope.
- Generate distinct, customer-specific content when the user requests
  personalization.
- Prevent accidental, duplicate, stale, wrong-recipient, or wrong-sender sends.
- Preserve the existing background email campaign architecture where it remains
  compatible with the new authorization boundary.

### 5.2 Secondary goals

- Give users a clear explanation when a request is ambiguous or blocked.
- Make the decision and send lifecycle recoverable after app restart.
- Reuse inbound reply reliability services and vocabulary where practical.
- Produce metrics that separate model instruction-following failures from
  delivery-policy blocks and provider failures.

## 6. Non-Goals

- Adding an email-specific "Allow automatic sending" setting.
- Requiring users to preview every email when they explicitly requested direct
  sending.
- Treating global AI Chat tool approval mode as outbound delivery intent.
- Guaranteeing that every SMTP provider will deliver every accepted message.
- Replacing the email template, filter, SMTP service, or bulk task systems.
- Building a full CRM campaign editor.
- Authorizing recurring or scheduled future sends from one ordinary send-now
  request. Scheduled and recurring campaigns require their own explicit scope.
- Automatically retrying an ambiguous SMTP outcome.
- Allowing the LLM to infer consent from customer data, knowledge content, or an
  assistant-authored summary.

## 7. Target Users and Jobs

### 7.1 Marketing operator

When the operator says "write and send personalized emails to these ten leads,"
they want AiFetchly to complete the job without an unnecessary review screen.

### 7.2 Careful campaign owner

When the owner says "prepare these emails and ask me to review before sending,"
they want to inspect and edit every generated message before any campaign starts.

### 7.3 Small business owner

When the owner gives a short or ambiguous composition request, they want
AiFetchly to preserve control by creating drafts rather than guessing that
delivery was authorized.

### 7.4 Security or compliance reviewer

When investigating a send, they want evidence of the authorizing user message,
delivery mode, recipients, content revisions, data sources, policy results, and
provider outcomes.

## 8. User Intent Model

### 8.1 Delivery modes

#### `send_now`

The user explicitly requests delivery in the current instruction or gives an
unambiguous affirmative answer to an immediately preceding send question.

Examples:

- "Write and send a personalized email to each customer."
- "Send these now; no review is needed."
- "Email all ten prospects directly."
- Assistant: "The ten drafts are ready. Should I send them?" User: "Yes, send
  them."

#### `review_first`

The user requests a review, preview, approval, confirmation, pause, or other
checkpoint before delivery.

Examples:

- "Ask me to review before you send."
- "Prepare the campaign and show me the emails first."
- "Do not send until I approve them."
- "Write and send them after I check the drafts."

#### `draft_only`

The user asks only for composition, preparation, rewriting, or advice and does
not explicitly request delivery.

Examples:

- "Write a marketing email for these customers."
- "Draft ten personalized variants."
- "Improve this subject line."
- "What email should I send?"

### 8.2 Precedence rules

The product must apply the following precedence in order:

1. An explicit negation such as "do not send," "don't email," or "draft only"
   results in `draft_only`.
2. A review checkpoint such as "review first," "show me before sending," or
   "wait for my approval" results in `review_first`.
3. An explicit, non-negated send instruction results in `send_now`.
4. Any unresolved, conflicting, or low-confidence instruction results in
   `draft_only`.

The rule applies even when a sentence contains both send and review language.
For example:

```text
"Write a marketing email and send it, but ask me to review before you send."
-> review_first
```

### 8.3 Conversation context rules

- The resolver must use persisted user-authored messages, not only the model's
  restatement of them.
- A later user message may replace the delivery mode for the same draft batch.
  For example, "send them now" may authorize previously reviewed drafts.
- An assistant question followed by "yes" may authorize sending only when the
  immediately preceding assistant turn presented a clear send decision and the
  target draft batch is unambiguous.
- Old send instructions from completed campaigns cannot authorize a new batch.
- A plan approval authorizes only actions within the approved plan and does not
  erase an explicit review-first condition attached to the email content.
- Text retrieved from files, webpages, knowledge documents, tool results, or
  customer records is never treated as user authorization.

### 8.4 Intent confidence

The delivery-intent resolver must return:

```typescript
interface OutboundEmailIntentDecision {
  readonly mode: OutboundEmailDeliveryMode;
  readonly confidence: "high" | "low";
  readonly sourceUserMessageId: string;
  readonly evidenceSpans: readonly string[];
  readonly reasonCode:
    | "explicit_send"
    | "explicit_review"
    | "explicit_draft_only"
    | "explicit_do_not_send"
    | "affirmative_send_answer"
    | "conflicting_instruction"
    | "ambiguous_instruction";
}
```

Only a high-confidence `explicit_send` or `affirmative_send_answer` may select
`send_now`. Low confidence must fall back to `draft_only`.

## 9. User Journeys

### 9.1 Explicit send-now campaign

1. The user asks AiFetchly to find or use a recipient list, write personalized
   emails, and send them now.
2. The main process persists the user message and resolves `send_now`.
3. The AI gathers permitted customer and knowledge-library data.
4. The product creates one draft revision per recipient.
5. The complete batch passes recipient, personalization, factual support,
   sender, policy, and duplicate checks.
6. The product freezes the delivery envelopes and atomically creates the send
   task.
7. The UI reports that the campaign started and shows per-recipient outcomes as
   they become available.

The user does not see an additional email-specific automatic-sending setting or
content-review prompt.

### 9.2 Review-before-send campaign

1. The user asks for personalized emails and requests review before sending.
2. The main process resolves `review_first`.
3. The AI creates one draft per recipient.
4. The UI displays intended sender, recipient, subject, body, personalization
   evidence, and source summary.
5. No send task exists while review is pending.
6. The user edits, approves, rejects, or requests regeneration.
7. Approval is bound to the exact current revisions and delivery envelopes.
8. The user approves the batch, and the product queues the authorized campaign.

### 9.3 Ambiguous composition request

1. The user asks AiFetchly to "prepare an outreach campaign."
2. The request does not explicitly authorize delivery.
3. The product creates drafts and explains that they are ready.
4. The user can then say "send them" or continue editing.

### 9.4 Conflicting instruction

1. The user says "send these emails, but wait until I approve them."
2. Review language takes precedence.
3. The product creates drafts and stops.
4. A model attempt to call the send tool is blocked before campaign creation.

### 9.5 Unsafe or unsupported direct send

1. The user explicitly requests immediate sending.
2. One or more recipients are invalid, suppressed, duplicated unexpectedly, or
   lack enough reliable data for the requested personalized claim.
3. The batch preflight fails before any send task starts.
4. The product reports the affected recipients and actionable reason codes.
5. The user can correct the data, narrow the batch, or request drafts for manual
   review.

## 10. Functional Requirements

### FR-001 Trusted request-scoped intent resolution

The main process must resolve an outbound delivery mode from persisted,
user-authored conversation state before any outbound campaign can start.

Acceptance criteria:

- The decision references the exact source user message ID.
- Assistant messages, model reasoning, tool arguments, and retrieved content
  cannot serve as the authorization source.
- The resolver returns a machine-readable reason code and evidence spans.
- `send_now` requires high confidence and an explicit send instruction.
- Ambiguous or conflicting instructions fall back to `draft_only`.
- The decision can be recomputed from durable conversation history after an app
  restart.

### FR-002 Review and negation take precedence

The resolver must detect review checkpoints and send negations before accepting
an explicit send verb.

Acceptance criteria:

- "Ask me to review before sending" always prevents direct send.
- "Do not send" always prevents direct send.
- "Draft only" never starts a campaign.
- A sentence containing both "send" and "review first" resolves to
  `review_first`.
- Tests cover equivalent phrasing in all supported UI languages: English,
  Chinese, Spanish, French, German, and Japanese.
- Unrecognized language or low-confidence semantics fails closed to
  `draft_only`.

### FR-003 Explicit send request is one-time action authorization

An explicit `send_now` request must authorize the associated outbound action
without requiring a separate email-specific system setting or content-review
step.

Acceptance criteria:

- No new "Allow automatic sending" setting is introduced.
- The request authorization is scoped to one conversation, one draft batch, the
  selected sender set, and the resolved recipient set.
- Authorization cannot be reused for a later campaign.
- Authorization cannot silently expand from ten requested recipients to a
  larger recipient source.
- An explicitly denied email tool permission or hard product safety policy still
  blocks delivery.
- Global `approve_for_me` or `full_access` is not required to honor an explicit
  send-now request.

### FR-004 Tool permission and action authorization remain separate

The application must distinguish permission to use email automation from the
user's intent to perform the current send.

Acceptance criteria:

- A prior "Always Allow" permission does not authorize an email absent an
  explicit send instruction or exact-draft approval.
- An explicit send-now instruction may act as allow-once authorization for the
  corresponding `start_email_send_task` execution.
- The generic permission UI is not presented as if it were draft-content
  approval.
- Explicit permission denial remains authoritative.
- Plan Mode, scheduled-loop policy, subscription entitlement, and AI feature
  gates remain independent controls.

### FR-005 Outbound draft batches

The product must materialize a durable outbound draft batch before queueing
delivery, including in `send_now` mode.

Acceptance criteria:

- Each batch records conversation ID, source user message ID, delivery mode,
  recipient source, service IDs, status, and timestamps.
- Each recipient has an independent draft and current revision.
- Draft creation does not contact SMTP.
- An app restart does not lose review state or authorization evidence.
- A send task references the durable authorized batch rather than trusting raw
  LLM tool arguments.

### FR-006 Per-recipient draft revisions

Every generated or edited recipient message must have a durable revision.

Acceptance criteria:

- Revision identity includes sender, recipient, subject, plain text, HTML,
  knowledge/source references, and validation version.
- Editing any send-relevant field creates a new revision.
- Exact approval of an older revision cannot authorize a newer revision.
- `send_now` envelopes are frozen after validation and cannot be mutated while
  queued.
- The audit trail distinguishes AI-generated and user-edited revisions.

### FR-007 Personalized content generation

When the user asks for different or personalized content, the system must
produce one independently validated message per recipient.

Acceptance criteria:

- The model receives only the customer and permitted knowledge context relevant
  to the current recipient.
- Every draft records at least one recipient-specific evidence item when such
  evidence is required by the request.
- Exact duplicate subjects and bodies across recipients fail personalization
  validation unless the user explicitly requested identical content.
- Placeholder leakage such as `{{company_name}}`, `[First Name]`, or unresolved
  template variables blocks sending.
- Unsupported customer-specific claims block auto-send and identify the
  affected recipient.
- The product does not claim personalization merely because a greeting changed.

### FR-008 Knowledge and customer-data grounding

Generated content must distinguish sourced facts from model-generated marketing
language.

Acceptance criteria:

- Draft metadata records customer fields and knowledge citations used for
  factual claims.
- Knowledge content cannot alter delivery mode, recipients, sender, or tool
  policy.
- If required product or customer information is absent, the system does not
  invent it.
- Unsupported prices, guarantees, dates, legal claims, discounts, credentials,
  or payment instructions block auto-send.
- Review UI shows a compact source summary without exposing internal prompts.

### FR-009 Complete batch preflight

The system must validate the complete outbound batch before starting any
background send task.

Acceptance criteria:

- Preflight resolves the final sender and recipient for every envelope.
- Recipient format, duplicates, suppression/unsubscribe status, service status,
  content, personalization, and policy are checked.
- If any envelope fails preflight, no campaign is queued by default.
- The response identifies every failed envelope with a stable reason code.
- Provider delivery failures after a successful preflight are tracked per
  recipient and do not rewrite the original authorization decision.

### FR-010 Exact-content review approval

In `review_first` mode, delivery requires approval of the exact current draft
revisions and delivery envelopes.

Acceptance criteria:

- Approval records approver, timestamp, batch, revision IDs, sender, recipients,
  and canonical hashes.
- Editing any approved send-relevant field invalidates approval.
- Opening or previewing a draft does not approve it.
- Approval cannot be reused for a different sender, recipient, batch, or
  conversation.
- A raw one-time approval token is never exposed to the LLM or persisted in
  plaintext.

### FR-011 Direct-send authorization envelope

In `send_now` mode, the application must create a trusted authorization record
after generation and successful preflight but before campaign creation.

Acceptance criteria:

- The record references the source user message and intent decision.
- The allowed recipient scope cannot exceed the recipients resolved from the
  request.
- Canonical hashes bind the final generated envelopes at queue time.
- The authorization record clearly indicates that the user authorized
  generation-and-send, not that the user reviewed exact content.
- A changed envelope after authorization must be revalidated and reauthorized
  from the same still-active request scope or returned for review.

### FR-012 Authoritative outbound send entry point

All AI-initiated outbound marketing delivery must pass through one authoritative
service that verifies intent, authorization, envelope binding, policy, and send
claim before calling the existing campaign starter.

Acceptance criteria:

- No built-in tool, IPC handler, controller, worker, or retry path can call
  `startBuckEmailCampaign()` for AI-generated outbound content without a valid
  authorization record.
- The public LLM tool cannot accept a self-asserted `autoSend` or trusted
  delivery-mode field.
- The service reloads trusted batch, draft, authorization, sender, and recipient
  state immediately before queueing.
- A failed check returns a structured rejection and never contacts the campaign
  worker.
- Database access follows the Model/Module architecture and is not placed
  directly in IPC handlers.

### FR-013 Tool-call policy enforcement

An attempted send tool call that conflicts with the resolved delivery mode must
be blocked before execution.

Acceptance criteria:

- `review_first` with no exact approval returns `review_required`.
- `draft_only` returns `explicit_send_required`.
- `send_now` with valid request authorization proceeds without an additional
  content-review prompt.
- `full_access` cannot bypass `review_required` or
  `explicit_send_required`.
- The blocked result is returned to the model so it can present drafts or ask
  for an explicit send decision instead of retrying blindly.

### FR-014 Enforced outbound lifecycle

The product must enforce the following batch lifecycle or an equivalent
lifecycle with the same guarantees:

```text
creating -> draft
              |-> awaiting_review -> approved -> queued
              |-> direct_authorized ----------> queued
              |-> blocked
queued -> sending -> completed
                    |-> partially_failed
                    |-> failed
                    |-> delivery_unknown
draft/awaiting_review -> discarded
```

Acceptance criteria:

- Invalid transitions fail before campaign creation.
- Only `approved` or `direct_authorized` can transition to `queued`.
- Only one caller can claim an authorized batch for queueing.
- Terminal batches cannot be automatically resent.
- A content edit moves `approved` back to `awaiting_review`.
- `delivery_unknown` is never automatically retried.

### FR-015 Duplicate prevention and send idempotency

Repeated model calls, stream recovery, double clicks, and concurrent requests
must not queue duplicate envelopes.

Acceptance criteria:

- Each authorization and envelope set produces a deterministic idempotency key.
- The database atomically claims the batch before the background worker starts.
- Concurrent calls create at most one campaign task for the authorization.
- Repeated calls return the existing task or outcome.
- A deliberate retry after a definite failure requires a new user action and a
  new authorization record.

### FR-016 Recipient and sender binding

The final campaign must use the sender and recipients represented by the
authorized envelopes.

Acceptance criteria:

- Service IDs are active and loaded from trusted database state.
- A model tool call cannot substitute another sender after authorization.
- Recipient normalization preserves valid local parts and normalizes domains
  consistently for comparison and hashing.
- A recipient-source change invalidates preflight and authorization.
- The worker receives only the frozen envelope data or a trusted batch ID from
  the main process.

### FR-017 Suppression and policy enforcement

Direct user authorization must not bypass hard delivery safety rules.

Acceptance criteria:

- Invalid addresses, explicit suppression entries, unsubscribe records,
  inactive senders, plan-mode restrictions, and configured send limits are
  checked immediately before queueing.
- Hard blocks cannot be overridden by model confidence.
- Policy reason codes are stable and renderer-safe.
- Free-form backend errors are sanitized before display.
- Policy decisions include a version for audit and later evaluation.

### FR-018 Prompt and tool guidance

System guidance must teach the model to distinguish composition, review-first,
and send-now requests while treating backend policy as authoritative.

Acceptance criteria:

- The capabilities prompt no longer maps every outbound marketing request
  directly to immediate send.
- Guidance explicitly says to stop after drafts when review is requested.
- Guidance explicitly allows direct sending after an unambiguous send-now
  request.
- The send tool description says that the server independently validates user
  authorization.
- Prompt changes are treated as defense in depth and are covered by policy tests.

### FR-019 Review user interface

`review_first` must provide a clear and scalable review experience.

Acceptance criteria:

- The UI shows batch recipient count, selected sender, and validation status.
- Each recipient row exposes subject, body, personalization evidence, and source
  summary.
- Users can approve all valid drafts, approve selected drafts, edit, regenerate,
  or discard.
- The approval action clearly says that it will send the displayed emails.
- The UI distinguishes "Automation permission" from "Approve these emails and
  send."
- All new text is translated into English, Chinese, Spanish, French, German,
  and Japanese.

### FR-020 Direct-send user feedback

`send_now` must provide clear progress without presenting a redundant review
step.

Acceptance criteria:

- The assistant states that the explicit send instruction was followed.
- The UI shows recipient count, task ID, queue/start status, and sender summary.
- It does not falsely report successful delivery when only campaign creation has
  completed.
- Per-recipient outcomes distinguish queued, submitted, sent, failed, and
  delivery unknown when the underlying worker exposes that information.
- Blocked auto-send reports what must be corrected rather than silently falling
  back to sending fewer recipients.

### FR-021 Audit trail

The product must preserve enough evidence to explain every delivery decision.

Acceptance criteria:

- Audit records include conversation ID, source user message ID, intent mode,
  reason code, evidence spans or their safe normalized form, batch ID, sender,
  recipient count, revision hashes, policy version, and timestamps.
- Review approval records the approving user action separately from generic
  tool permission.
- Direct-send records use the actor type `explicit_user_instruction`.
- Raw approval tokens, SMTP credentials, full system prompts, and hidden
  reasoning are never logged.
- Audit records can correlate a campaign task with its authorization.

### FR-022 Recovery and ambiguous delivery

The product must recover safely from process crashes and uncertain provider
outcomes.

Acceptance criteria:

- An authorized but unqueued batch can be safely resumed.
- A queued batch is not queued again after restart.
- A failure before provider submission may be retried only through an explicit
  user action.
- A failure after possible provider acceptance is marked `delivery_unknown`.
- `delivery_unknown` instructs the user to inspect the mailbox or provider log
  and cannot automatically resend.

### FR-023 AI feature entitlement gate

Any new or modified AI IPC handler must check AI enablement before parsing
request data, retrieving context, generating drafts, or calling AI services.

Acceptance criteria:

- Handlers use the existing `Token` and `USER_AI_ENABLED`/feature-gate pattern.
- Disabled AI returns `{ status: false, msg, data: null }` or the established V2
  equivalent immediately.
- No draft, authorization, or send task is created when AI is disabled.

## 11. Proposed Domain Model

The exact entity names may change during technical design, but the product
requires equivalent durable records.

### 11.1 Outbound email draft batch

```typescript
interface OutboundEmailDraftBatch {
  readonly id: number;
  readonly conversationId: string;
  readonly sourceUserMessageId: string;
  readonly deliveryMode: OutboundEmailDeliveryMode;
  readonly recipientSourceType: "direct" | "search_task";
  readonly recipientSourceId: number | null;
  readonly status:
    | "creating"
    | "draft"
    | "awaiting_review"
    | "approved"
    | "direct_authorized"
    | "queued"
    | "sending"
    | "completed"
    | "partially_failed"
    | "failed"
    | "blocked"
    | "discarded"
    | "delivery_unknown";
  readonly campaignTaskId: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
```

### 11.2 Recipient draft and revision

```typescript
interface OutboundEmailDraftRevision {
  readonly id: number;
  readonly batchId: number;
  readonly recipientAddress: string;
  readonly recipientDisplayName: string | null;
  readonly emailServiceId: number;
  readonly senderAddress: string;
  readonly subject: string;
  readonly bodyText: string;
  readonly bodyHtml: string;
  readonly contentHash: string;
  readonly personalizationEvidenceJson: string;
  readonly knowledgeCitationsJson: string;
  readonly generationSource: "ai" | "manual";
  readonly validationVersion: string;
  readonly createdAt: Date;
}
```

### 11.3 Intent decision

```typescript
interface OutboundEmailIntentRecord {
  readonly id: number;
  readonly batchId: number;
  readonly sourceUserMessageId: string;
  readonly mode: OutboundEmailDeliveryMode;
  readonly confidence: "high" | "low";
  readonly reasonCode: string;
  readonly evidenceDigest: string;
  readonly resolverVersion: string;
  readonly resolvedAt: Date;
}
```

### 11.4 Authorization record

```typescript
type OutboundEmailAuthorizationType =
  | "explicit_user_instruction"
  | "exact_draft_approval";

interface OutboundEmailAuthorization {
  readonly id: number;
  readonly batchId: number;
  readonly type: OutboundEmailAuthorizationType;
  readonly sourceUserMessageId: string;
  readonly envelopeSetHash: string;
  readonly approvalTokenHash: string | null;
  readonly authorizedAt: Date;
  readonly consumedAt: Date | null;
  readonly invalidatedAt: Date | null;
  readonly invalidationReason: string | null;
}
```

### 11.5 Send attempt

```typescript
interface OutboundEmailSendAttempt {
  readonly id: number;
  readonly batchId: number;
  readonly authorizationId: number;
  readonly campaignTaskId: number | null;
  readonly idempotencyKey: string;
  readonly status:
    | "claimed"
    | "queued"
    | "submitted"
    | "completed"
    | "partially_failed"
    | "failed"
    | "delivery_unknown";
  readonly claimedAt: Date;
  readonly completedAt: Date | null;
}
```

## 12. Authoritative Decision and Delivery Flow

### 12.1 Intent resolution boundary

The delivery-intent resolver runs in the main process after the current user
message is persisted. The content-generation model may return a suggested mode,
but that suggestion is not authoritative.

Recommended layered resolution:

1. Deterministic negation and review-condition detection runs first.
2. Explicit send detection runs only if no blocker matched.
3. A constrained semantic classifier may help with paraphrases and supported
   languages, but only a high-confidence decision with evidence from the current
   user message may authorize `send_now`.
4. Conflicts, missing evidence, parser errors, and classifier errors return
   `draft_only`.

### 12.2 Drafting boundary

The AI generates structured drafts. Drafting must not call SMTP or create the
legacy bulk campaign task. Drafts are persisted through Module and Model layers.

### 12.3 Preflight boundary

The main process loads trusted state and validates every envelope. LLM-provided
recipient counts, service configuration, authorization flags, hashes, and
policy results are not trusted.

### 12.4 Authorization boundary

For `send_now`, the system creates an `explicit_user_instruction`
authorization after preflight. For `review_first`, a user approval action creates
an `exact_draft_approval` authorization. Both authorization types bind the
frozen envelope-set hash.

### 12.5 Queue boundary

The delivery service atomically claims the authorization, creates a send
attempt, and then calls the existing campaign starter. If the claim fails, no
worker starts.

## 13. Tool Contract Requirements

### 13.1 Draft tool

Add an outbound draft capability, conceptually:

```text
create_outbound_email_draft_batch
```

The tool may accept recipient source, sender service IDs, campaign objective,
and structured draft content. It must return a batch ID and draft summaries. It
must never start delivery.

### 13.2 Send tool

`start_email_send_task` should transition from a raw content-and-recipient send
entry point to an authorized batch send entry point. The preferred public shape
is:

```typescript
interface StartAuthorizedOutboundEmailTaskInput {
  readonly batchId: number;
}
```

The main process resolves the active authorization from trusted storage. The
LLM does not receive or supply raw approval tokens.

If backward compatibility requires accepting raw recipients and content during
migration, that path must internally materialize a batch and pass through the
same intent, preflight, authorization, and claim services before campaign
creation.

### 13.3 Structured rejection

Blocked sends return stable reason codes, including:

- `explicit_send_required`
- `review_required`
- `approval_stale`
- `authorization_missing`
- `authorization_consumed`
- `intent_conflict`
- `recipient_scope_changed`
- `sender_mismatch`
- `recipient_invalid`
- `recipient_suppressed`
- `content_validation_failed`
- `personalization_failed`
- `unsupported_claim`
- `duplicate_send`
- `plan_approval_required`
- `ai_feature_disabled`

## 14. User Experience Requirements

### 14.1 Send-now response

The assistant should state that it is generating and sending because the user
requested direct delivery. It should not claim completion until provider or
campaign status supports that claim.

Recommended status language:

- "Preparing and validating 10 personalized emails."
- "The campaign has been queued for 10 recipients."
- "8 sent, 1 failed, 1 delivery status unknown."

### 14.2 Review-first response

The assistant should present the drafts and explicitly state that nothing has
been sent. The review card must make the delivery consequence of approval clear.

### 14.3 Ambiguous response

The assistant should create or offer drafts and ask whether the user wants them
sent. It should not present a generic automation permission card as the answer
to this question.

### 14.4 Blocked response

The UI should name the affected recipients and explain the corrective action.
It must not expose SMTP credentials, raw approval tokens, system prompts, or
hidden model reasoning.

## 15. Security, Privacy, and Compliance Requirements

- Treat recipient lists and customer data as local sensitive data.
- Store only hashes of one-time approval tokens.
- Never log SMTP passwords, access tokens, complete system prompts, or hidden
  reasoning.
- Sanitize HTML before review rendering.
- Prevent scripts, remote event handlers, and unsafe URLs in draft previews.
- Treat knowledge-library and scraped content as untrusted reference material.
- Do not allow retrieved content to add recipients, switch senders, or request
  tools.
- Enforce suppression, unsubscribe, and configured campaign limits regardless
  of delivery mode.
- Keep database operations in Models and Modules; IPC handlers coordinate only.
- Workers receive task data from the main process and never access the database
  directly.

## 16. Failure Handling

### 16.1 Intent resolution failure

Return `draft_only`, persist the reason, and do not invoke the send path.

### 16.2 Draft generation failure

Do not create an authorization. Report which recipients failed and why. One
bounded regeneration attempt may be used for schema or formatting errors.

### 16.3 Batch preflight failure

Queue nothing by default. Return all validation failures so the user can fix the
batch in one pass.

### 16.4 Campaign creation failure

If failure occurs before the worker starts, mark the attempt `failed`. A retry
requires a user action but may reuse unchanged drafts after revalidation.

### 16.5 Ambiguous provider outcome

Mark the affected attempt or recipient `delivery_unknown`. Never automatically
retry. Tell the user to inspect the sender mailbox or provider log.

### 16.6 App restart

Recover from durable batch, authorization, and attempt state. Do not infer state
from the last assistant message.

## 17. Observability and Metrics

### 17.1 Product metrics

- Percentage of outbound requests resolved as `send_now`, `review_first`, and
  `draft_only`.
- Percentage of direct-send requests completed without an unnecessary review
  prompt.
- Percentage of review-first requests where a model attempted premature send.
- Draft approval, edit, discard, and send conversion rates.
- Personalization validation failure rate.
- Batch preflight failure rate by reason code.

### 17.2 Reliability metrics

- Premature send attempts blocked before campaign creation.
- Duplicate queue attempts prevented.
- Stale approvals rejected.
- Wrong-recipient and wrong-sender attempts rejected.
- Campaign start failures.
- Per-recipient sent, failed, and delivery-unknown counts.

### 17.3 Quality targets

- 100% of test cases containing an explicit review condition block direct send.
- 100% of unambiguous send-now acceptance cases reach the authorized send path
  without an email-specific settings prompt.
- 0 SMTP or campaign-worker starts from `draft_only` or unapproved
  `review_first` state.
- At most one campaign task per authorization under concurrent calls.
- 100% of new user-facing strings present in all six supported languages.

## 18. Testing Strategy

### 18.1 Intent resolver unit tests

Cover at minimum:

- Explicit send-now wording.
- Explicit no-review wording.
- Review-before-send wording.
- Draft-only wording.
- Send negation.
- Mixed send and review instructions.
- Short affirmative answer after a send question.
- Short affirmative answer after an unrelated question.
- Instructions quoted inside a knowledge document or customer record.
- Low-confidence and unsupported-language fallback.
- Equivalent cases in English, Chinese, Spanish, French, German, and Japanese.

### 18.2 Policy tests

- `full_access` cannot bypass review-first.
- `approve_for_me` cannot bypass draft-only.
- Explicit send-now creates allow-once action authorization.
- Prior automation permission without explicit send does not authorize delivery.
- Explicit tool denial blocks delivery.
- Plan Mode blocks unapproved execution.

### 18.3 Draft and authorization tests

- One draft revision is created per recipient.
- Exact duplicates fail when personalization is requested.
- Unresolved placeholders fail.
- Unsupported claims fail.
- Edits invalidate exact-draft approval.
- Authorization cannot cross conversation, batch, sender, or recipient scope.
- Raw approval tokens are not persisted or returned to the model.

### 18.4 Delivery tests

- No public AI send path reaches `startBuckEmailCampaign()` without trusted
  authorization.
- Concurrent calls queue at most one task.
- Repeated calls return the existing task.
- Preflight failure queues nothing.
- Inactive sender, invalid recipient, suppression, and sender mismatch block
  before worker start.
- Restart recovery does not duplicate queueing.
- Ambiguous delivery is never automatically retried.

### 18.5 Component tests

Add or update tests under `test/vitest/main/components/` for:

- Review batch rendering.
- Per-recipient draft expansion.
- Edit and regeneration behavior.
- Approve-all and selected-approval behavior.
- Stale approval after edit.
- Direct-send progress and outcome summaries.
- Clear distinction between permission and content approval.
- Loading, empty, blocked, partial-failure, and delivery-unknown states.

Run `yarn test:components` as a required gate.

### 18.6 End-to-end tests

Add Playwright coverage for:

1. Review-first request -> drafts visible -> no send task -> approve -> one task.
2. Send-now request -> no review card -> one authorized task.
3. Conflicting request -> review card -> no task.
4. Full-access conversation -> review-first still blocks.
5. App reload while awaiting review -> state restored.
6. Duplicate approval/click -> one task.

Use a fake SMTP/campaign adapter for deterministic verification. Do not send
real external email in automated tests.

## 19. Rollout Plan

### Phase 1: Intent decision and hard gate

- Add durable intent decision types and service.
- Add a pre-send policy gate around the existing send tool.
- Block review-first and draft-only sends before campaign creation.
- Add focused regression tests for the observed failure.

### Phase 2: Durable outbound drafts and authorization

- Add batch, revision, authorization, and send-attempt Models and Modules.
- Reuse canonical hashing and one-time token patterns from email reply
  reliability.
- Route all AI outbound delivery through the authoritative service.

### Phase 3: Review experience and personalization evidence

- Add the review batch UI.
- Add edit, regenerate, approve, discard, and stale-approval behavior.
- Add all translations and component tests.

### Phase 4: Migration and enforcement

- Migrate the raw `start_email_send_task` contract toward authorized batch IDs.
- Keep a compatibility adapter only if it passes through the same policy.
- Add a source-level regression test preventing new direct campaign-start paths.
- Remove compatibility code after all callers migrate.

### Phase 5: Evaluation and tightening

- Run a multilingual intent evaluation set.
- Review blocked-attempt telemetry and false-positive draft fallbacks.
- Tune evidence and phrase rules without reducing review-condition recall.
- Confirm no duplicate sends under stream recovery and concurrency tests.

## 20. Backward Compatibility

- Existing manually configured bulk-email campaigns remain unchanged unless
  they originate from AI-generated outbound content.
- Existing SMTP services, templates, filters, and recipient search tasks remain
  reusable.
- Existing AI Chat approval modes remain available for other tools.
- Existing callers of `startBulkEmailSendTask()` must migrate or be explicitly
  identified as trusted non-AI flows.
- AI-originated raw-recipient calls must use the compatibility adapter until
  removed; they may not bypass materialization and authorization.

## 21. Risks and Mitigations

### Risk: False direct-send classification

**Impact**: An email could be sent when the user expected a draft.

**Mitigation**: Review and negation rules run first; only high-confidence
explicit send evidence allows `send_now`; everything else fails closed.

### Risk: Excessive draft fallback

**Impact**: Users asking for direct sending may see unnecessary friction.

**Mitigation**: Maintain multilingual intent test sets, evidence-based semantic
classification, and telemetry for explicit-send requests that fell back.

### Risk: Permission and intent become conflated again

**Impact**: Global access modes could reintroduce premature sends.

**Mitigation**: Keep action authorization in a separate service and require it
inside the authoritative delivery entry point.

### Risk: Partial provider delivery

**Impact**: A campaign may send to some recipients and fail for others.

**Mitigation**: Preflight the complete batch, track per-recipient provider
outcomes, never claim all messages were delivered from task creation alone, and
avoid blind retries.

### Risk: Personalization uses incorrect facts

**Impact**: Customers receive inaccurate or inappropriate messages.

**Mitigation**: Record source evidence, validate sensitive claims, block
unsupported facts, isolate recipient context, and expose sources in review mode.

### Risk: New direct-send path bypasses existing policy

**Impact**: Suppressed contacts or inactive senders may be used.

**Mitigation**: Use one authoritative delivery service for both authorization
types and rerun policy immediately before queueing.

## 22. Acceptance Test Matrix

| Request | Expected mode | May queue immediately? | Additional user action |
|---|---|---:|---|
| "Write and send these ten emails" | `send_now` | Yes, after successful preflight | None |
| "Send directly; no review needed" | `send_now` | Yes, after successful preflight | None |
| "Write ten personalized emails" | `draft_only` | No | User must request sending |
| "Show me the emails before sending" | `review_first` | No | Approve exact drafts |
| "Send them, but ask me to review first" | `review_first` | No | Approve exact drafts |
| "Do not send these" | `draft_only` | No | New explicit send request |
| Assistant asks "Send?" and user says "Yes" | `send_now` | Yes, if batch is unambiguous | None |
| User says "Yes" after an unrelated question | `draft_only` | No | Explicit send request |
| Knowledge document says "send immediately" | unchanged | No authorization effect | Depends on user message |
| `full_access` with no send request | `draft_only` | No | Explicit send request |
| Explicit send with suppressed recipient | `send_now`, then blocked | No | Correct recipient/policy issue |

## 23. Release Acceptance Criteria

The feature is ready for release only when all of the following are true:

1. The original failure scenario creates reviewable drafts and no campaign task.
2. An explicit send-now request queues exactly one authorized campaign after
   successful preflight without an email-specific settings prompt.
3. `approve_for_me` and `full_access` cannot bypass review-first or draft-only
   decisions.
4. Every AI-originated campaign start is traceable to an explicit user
   instruction or exact-draft approval.
5. No public AI send path can reach the campaign worker without trusted
   authorization.
6. Editing approved content invalidates approval.
7. Concurrent and repeated send calls do not create duplicate campaign tasks.
8. The six-language intent suite and UI translation checks pass.
9. Component and end-to-end tests cover both delivery modes and the conflicting
   instruction path.
10. Audit output contains no credentials, raw approval tokens, system prompts,
    or hidden model reasoning.

## 24. Final Product Decisions

The following decisions are fixed for this PRD:

- AiFetchly will support both direct sending and review-before-send.
- An explicit user request to send is sufficient request-scoped authorization;
  no email-specific automatic-sending setting will be added.
- Review, wait, approval, preview, draft-only, and send-negation instructions
  take precedence over send verbs.
- Ambiguous instructions default to drafting, not sending.
- Global tool approval modes do not replace outbound action authorization.
- The LLM cannot authorize itself through tool arguments or reasoning.
- Both delivery modes use durable drafts, complete preflight, frozen envelopes,
  authoritative policy, duplicate prevention, and audit records.
- Review-first approval binds to exact content. Direct-send authorization binds
  the user's instruction scope and the final validated envelope set.

