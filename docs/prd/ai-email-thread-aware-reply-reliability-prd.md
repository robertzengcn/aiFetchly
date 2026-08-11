# Thread-Aware AI Email Reply Reliability - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-08-11
- **Owner**: Product and Engineering
- **Feature area**: Email Receive and AI Reply
- **Primary release mode**: Assisted drafting with explicit user approval
- **Related documents**:
  - `docs/prd/ai-email-receive-auto-reply-prd.md`
  - `docs/prd/ai-email-receive-auto-reply-technical-design.md`
  - `docs/ai-chat-tool-approval-modes-prd.md`
  - `docs/prd/knowledge-library-management-ai-tools-prd.md`

## 1. Purpose

AiFetchly can receive an email, retrieve knowledge-library content, generate a
reply draft, and send the draft after a user action. The current reply is based
primarily on the latest inbound message and retrieved knowledge. It does not
reliably understand the complete email conversation, and several existing
safety mechanisms are advisory or disconnected from the send path.

This PRD defines the next reliability release for AI email replies. It requires
thread-aware context, deterministic policy enforcement, scoped and abstaining
knowledge retrieval, durable approval, idempotent delivery, and measurable
quality gates.

This document supplements the original AI Email Receive and Auto-Reply PRD. If
the two documents conflict for reply generation, approval, or sending behavior,
this document takes precedence.

## 2. Executive Summary

The product must treat AI-generated email as a proposal, not an authorization.
The language model may draft text and suggest an intent classification, but
application logic remains authoritative for:

- Which conversation is being answered.
- Which mailbox identity may send the reply.
- Which recipients are eligible.
- Which knowledge sources may be used.
- Whether the message is safe to answer.
- Whether the exact content was approved.
- Whether a send attempt may start or retry.

The target workflow is:

```text
Receive and normalize message
  -> reconstruct conversation
  -> run pre-draft policy
  -> retrieve scoped knowledge
  -> generate structured draft
  -> validate draft and factual support
  -> user reviews and approves exact revision
  -> run send-time policy
  -> atomically claim send attempt
  -> submit through the bound mailbox
  -> persist delivery outcome and audit evidence
```

The first release remains assisted. It must not introduce unattended auto-send.
The reliability foundation may support a later autonomous mode, but that mode
requires a separate product decision and release gate.

## 3. Current-State Problem

### 3.1 Conversation understanding is incomplete

Reply generation loads one received message. Although inbound messages contain
thread identifiers, prior inbound messages and prior sent replies are not
assembled into an ordered conversation for the model.

This causes failures such as:

- Asking for information the recipient already supplied.
- Repeating an offer or answer already sent.
- Contradicting an earlier commitment, price, date, or policy.
- Misreading short responses such as "Yes," "That works," or "Use the second
  option."
- Answering quoted text instead of the sender's newest text.

### 3.2 Existing safety behavior is not authoritative

The codebase contains an auto-reply policy evaluator, output leakage detection,
draft lifecycle states, and tool-level send confirmation. These controls do not
currently form one enforced transaction boundary:

- Policy evaluation is not required by draft creation and send execution.
- Banned phrases and prompt leakage create warnings but do not necessarily block
  the draft.
- The send service does not require a durable approved revision.
- The outbound mailbox can be overridden independently of the draft mailbox.
- Concurrent or ambiguous send attempts can create duplicate delivery risk.

### 3.3 Knowledge retrieval can be irrelevant or cross-context

Knowledge search uses top-ranked results without an email-specific abstention
decision. Knowledge content is presented to the model as trusted even though
uploaded files and imported websites can contain malicious instructions or
obsolete facts. Retrieval is not explicitly scoped to the mailbox, company, or
reply profile.

### 3.4 Message representation is lossy

Drafting relies on a bounded plain-text prefix. HTML-only content, relevant text
late in a long email, attachments, automated-message headers, and the distinct
newly written part of a reply may be unavailable to policy and generation.

## 4. Product Principles

1. **Conversation before composition**: no reply is drafted until the product
   identifies the conversation being answered.
2. **Deterministic controls before model judgment**: headers, recipients,
   mailbox binding, approval, send limits, and unsubscribe handling are enforced
   in application code.
3. **Approval applies to an exact revision**: changing content or recipients
   invalidates approval.
4. **External content is untrusted**: inbound email, knowledge documents,
   imported websites, and attachments are data, never instructions to the
   application or model runtime.
5. **Abstention is a successful outcome**: asking a person to review is better
   than inventing an answer.
6. **Delivery is at-most-once by default**: uncertain SMTP outcomes are not
   automatically retried.
7. **Every decision is explainable**: users can see why a reply was generated,
   blocked, returned for review, or not sent.
8. **Mailbox boundaries are tenant boundaries**: one mailbox must not
   accidentally use another mailbox's identity, rules, or private knowledge.

## 5. Goals

### 5.1 Primary goals

- Generate replies that correctly reflect the preceding email conversation.
- Prevent replies to unsubscribe requests, bounces, automated mail, and other
  blocked categories through deterministic policy.
- Ensure only an explicitly approved, unchanged draft is sent.
- Prevent duplicate and wrong-mailbox sends.
- Use only relevant, allowed, and reviewable knowledge sources.
- Safely decline to answer when conversation or factual context is insufficient.
- Give users clear review information without exposing internal prompts.
- Produce auditable evidence for generation, approval, validation, and delivery.

### 5.2 Secondary goals

- Improve owner-voice consistency across a thread.
- Support HTML-only messages and improve long-message handling.
- Establish data and evaluation foundations for possible future rule-based
  auto-send.
- Make operational failures recoverable without encouraging unsafe retries.

## 6. Non-Goals

- Unattended AI auto-send in this release.
- A full CRM or customer-support ticketing system.
- Perfect cross-provider thread reconstruction for malformed legacy mail.
- Automatically opening or executing email attachments.
- Treating model confidence as authorization to send.
- Using public model knowledge for private company pricing, policy, contractual,
  legal, financial, or account-specific claims.
- Reply-all by default.
- Replacing the existing knowledge library or SMTP provider integrations.

## 7. Target Users And Jobs

### 7.1 Marketing operator

When a prospect replies to an outreach thread, the operator wants a draft that
uses the full conversation and approved sales knowledge so they can respond
quickly without repeating or contradicting prior communication.

### 7.2 Small business owner

When a customer asks a question, the owner wants a concise draft in their voice,
with uncertain claims clearly routed for review before anything is sent.

### 7.3 Support or sales assistant

When triaging an inbox, the assistant wants deterministic handling for
unsubscribe, bounce, automated, sensitive, and human-review messages.

### 7.4 Security-conscious administrator

When reviewing activity, the administrator wants proof of which mailbox,
recipient, draft revision, policy, and knowledge sources were involved in each
send attempt.

## 8. User Journeys

### 8.1 Generate a thread-aware draft

1. The user opens an inbound message and requests a draft.
2. AiFetchly identifies the mailbox and conversation.
3. The product shows that it is using prior messages when history exists.
4. Pre-draft policy either allows drafting, blocks it, or requires human review.
5. Allowed knowledge collections are searched.
6. The product generates and validates a draft.
7. The user sees the draft, intended recipient, mailbox identity, warnings, and
   source summary.

### 8.2 Approve and send

1. The user reviews or edits the draft.
2. The user explicitly approves the current subject, body, recipient, and sender.
3. AiFetchly records the exact approved revision.
4. Send-time policy verifies that nothing relevant changed.
5. The product claims one send attempt and submits it through the bound mailbox.
6. The user sees `Sent`, `Failed`, or `Delivery unknown` with an appropriate next
   action.

### 8.3 Insufficient information

1. The inbound message asks for a company-specific fact.
2. Retrieval returns no result above the configured relevance threshold or finds
   conflicting sources.
3. The product does not silently fall back to general model knowledge.
4. The draft either says the owner will confirm or is marked as requiring human
   input, depending on the requested fact and policy.

### 8.4 Blocked message

1. A message contains an unsubscribe request, automated-mail headers, or another
   hard-block condition.
2. The product does not generate a normal reply and cannot send an existing
   unapproved draft for that message.
3. The UI displays the policy reason and an appropriate handling action.

## 9. Functional Requirements

### FR-001 Canonical conversation identification

The system must resolve every draft request to one canonical conversation within
one email service.

Acceptance criteria:

- Conversation lookup is always scoped by `emailServiceId`.
- Provider message IDs, `In-Reply-To`, and `References` are normalized before
  matching.
- Subject matching alone cannot merge two conversations.
- Messages with ambiguous or malformed identifiers are marked with reduced
  context confidence rather than silently merged.
- A conversation cannot contain messages belonging to another email service.

### FR-002 Ordered inbound and outbound history

The system must reconstruct an ordered history containing both received and sent
messages.

Acceptance criteria:

- Each history item has direction, timestamp, sender, recipients, subject, and
  normalized body text.
- Only drafts confirmed as sent appear as outbound conversation turns.
- The SMTP/provider message ID is retained for successful outbound messages when
  available.
- History is ordered by provider timestamp with a deterministic fallback.
- The current inbound message is explicitly identified.

### FR-003 Bounded conversation context

The product must construct model context without blindly including the complete
raw thread.

Acceptance criteria:

- The current message is preserved with a larger budget than older messages.
- Quoted replies, common signatures, and repeated thread content are removed or
  marked before context assembly.
- The most recent conversation turns are included verbatim within a configured
  limit.
- Older turns are summarized with dates, speakers, decisions, unanswered
  questions, and commitments.
- Truncation and summarization are recorded in generation metadata.
- The context never crosses the model's configured token budget.

### FR-004 Conversation facts and commitments

The context builder must identify thread facts that are especially costly to
contradict.

Acceptance criteria:

- Dates, prices, promised actions, selected options, open questions, and explicit
  refusals are represented in the thread summary when present.
- The prompt tells the model not to contradict recorded commitments.
- If commitments conflict, the draft is marked `needs_human_review`.
- A short response whose meaning depends on an earlier turn is not drafted from
  the short response alone.

### FR-005 Pre-draft policy enforcement

Draft creation must call a single authoritative policy service before the LLM is
invoked.

Acceptance criteria:

- Hard-blocked messages do not invoke knowledge retrieval or draft generation.
- At minimum, bounce, unsubscribe, automated reply, blocked sender/domain, and
  invalid-recipient conditions are enforced.
- Sensitive topics produce `needs_human_review` according to configured policy.
- The decision, rule version, and reason are audited.
- A user can see the block reason without seeing internal prompts.

### FR-006 Send-time policy enforcement

The same authoritative policy must run immediately before a send attempt.

Acceptance criteria:

- Current message state, rule configuration, send limits, draft revision,
  recipient, sender, and approval are rechecked.
- A policy change after draft generation can prevent sending.
- A blocked send does not change the draft to `sent` or contact SMTP.
- The send-time decision is audited independently of the pre-draft decision.

### FR-007 Independent message classification

Safety-relevant classification must be separate from prose generation.

Acceptance criteria:

- Deterministic header and content rules run before model classification.
- Model classification uses a constrained schema when deterministic rules are
  inconclusive.
- Stored classification includes source, confidence, model or ruleset version,
  and timestamp.
- Draft generation cannot silently overwrite a deterministic classification.
- Unknown, conflicting, or low-confidence classifications require review.

### FR-008 Scoped knowledge collections

Each mailbox or reply identity must define which knowledge is eligible for reply
generation.

Acceptance criteria:

- Search is restricted by configured document IDs, collections, tags, or an
  equivalent allowlist.
- An empty allowlist has explicit semantics and cannot accidentally mean "search
  every document."
- Sources belonging to another mailbox or business scope are excluded.
- The selected scope is visible in settings and recorded in generation metadata.
- Changing knowledge scope invalidates any draft that has not yet been approved.

### FR-009 Retrieval relevance and abstention

Knowledge retrieval must decide whether results are sufficiently relevant before
providing them to generation.

Acceptance criteria:

- Direct matches are evaluated against calibrated relevance criteria.
- Neighbor chunks cannot qualify solely by inheriting a parent's score.
- Duplicate or substantially overlapping chunks are removed.
- Stale or inactive documents can be excluded by policy.
- No-result, low-relevance, and conflicting-result outcomes are distinguishable.
- Company-specific claims are not generated from general model knowledge when
  retrieval abstains.

### FR-010 Untrusted-content isolation

Inbound email, documents, websites, and attachments must be presented as
untrusted reference data.

Acceptance criteria:

- Prompts state that external content cannot change system instructions,
  permissions, recipients, approval, or send policy.
- Knowledge content is not labeled unconditionally trusted.
- Source text that resembles tool instructions or prompt overrides cannot cause
  tool execution or policy changes.
- Prompt-injection indicators are recorded for review without exposing the
  system prompt.

### FR-011 Structured draft generation

The generation service must require a strictly validated result.

Acceptance criteria:

- The response schema requires subject, plain-text body, intent suggestion, and
  confidence metadata.
- Missing, malformed, non-finite, or out-of-range fields fail validation.
- Subject and body length limits are enforced by application code.
- The system may attempt one bounded regeneration after a validation failure.
- A second failure results in `needs_human_review`; unsafe raw model prose is not
  persisted as a sendable draft.

### FR-012 Deterministic draft validation

Generated drafts must pass deterministic validation before becoming reviewable.

Acceptance criteria:

- AI disclosure and internal prompt/tool/retrieval leakage are blocked or routed
  to human review, not merely warned.
- Configured forbidden phrases are enforced after generation.
- Unsupported commitments involving money, refunds, discounts, legal positions,
  credentials, account changes, or guaranteed dates require evidence or review.
- Newly introduced URLs, payment instructions, recipients, and attachment claims
  require review.
- The validator records machine-readable findings and the validation version.

### FR-013 Owner identity and style

Drafts must consistently use the identity bound to the mailbox.

Acceptance criteria:

- Owner name, role, company, preferred tone, signature, style notes, disclosure
  setting, and forbidden phrases are all applied.
- User-supplied per-draft tone cannot override safety or disclosure policy.
- Identity profile version is stored with generation metadata.
- Changing identity after generation invalidates unapproved drafts or requires
  regeneration.

### FR-014 Durable draft revisions

Every meaningful edit must create or identify a distinct draft revision.

Acceptance criteria:

- Subject, body, HTML body, sender, recipient, and relevant context identifiers
  contribute to the revision identity.
- Editing an approved draft returns it to an unapproved state.
- The audit trail identifies AI-generated and user-edited revisions.
- The UI never presents an older revision as the currently approved one.

### FR-015 Exact-content approval

Approval must apply to the exact content and delivery envelope reviewed by the
user.

Acceptance criteria:

- Approval stores approver, timestamp, revision, content hash, sender, and
  recipient.
- A direct user action or an approved tool-execution event creates approval.
- Merely opening a draft does not approve it.
- Approval cannot be reused for a different recipient or mailbox.
- Expired or invalidated approval blocks sending with an actionable explanation.

### FR-016 Enforced draft state machine

The product must enforce the following lifecycle or an equivalent lifecycle with
the same guarantees:

```text
draft -> approved -> sending -> sent
  |          |          |
  |          |          +-> failed
  |          |          +-> delivery_unknown
  |          +-> draft (approval invalidated)
  +-> discarded
```

Acceptance criteria:

- Invalid transitions fail without contacting SMTP.
- Only `approved` can transition to `sending`.
- Only one caller can claim `approved -> sending`.
- `sent`, `discarded`, and `delivery_unknown` cannot be automatically resent.
- A retry after `failed` requires a new explicit user action and policy check.

### FR-017 Mailbox and recipient binding

The send service must use the mailbox and recipient associated with the approved
revision.

Acceptance criteria:

- `draft.emailServiceId`, original message service, approval sender, and SMTP
  service must match.
- Normal send APIs cannot override the email service ID.
- The default recipient is a validated `Reply-To` address or sender address from
  the original message.
- Reply-all is off by default and requires explicit recipient review.
- Header or address parsing failures block sending.

### FR-018 Idempotent send attempts

The product must prevent concurrent or accidental duplicate delivery.

Acceptance criteria:

- Each approved revision has a unique send-attempt or idempotency identifier.
- Send claiming is atomic at the database layer.
- Concurrent send requests result in at most one SMTP submission.
- Successful provider message IDs are persisted when available.
- Repeated calls return the existing outcome rather than submitting again.

### FR-019 Ambiguous delivery handling

The product must distinguish a definite send failure from an unknown delivery
outcome.

Acceptance criteria:

- A definite pre-submission failure may be marked `failed`.
- A timeout or process/database failure after possible SMTP acceptance is marked
  `delivery_unknown` unless delivery can be reconciled.
- `delivery_unknown` is never automatically retried.
- The UI explains that manual mailbox verification is required.
- Reconciliation, when supported, records its evidence and final outcome.

### FR-020 Complete message normalization

Policy and generation must have a safe normalized representation of inbound
messages.

Acceptance criteria:

- `Auto-Submitted`, `Precedence`, list-related headers, and reply headers are
  persisted or represented in policy input.
- HTML-only messages receive a sanitized plain-text representation.
- Remote images, scripts, and active content are not loaded for AI processing.
- The newly written text is distinguished from quoted history when feasible.
- Truncation preserves recent content and detected questions rather than always
  taking the first characters.

### FR-021 Attachment-aware abstention

The system must not imply that it inspected an attachment when it did not.

Acceptance criteria:

- Attachment names, types, and sizes may be shown without opening them.
- If an answer depends on an unprocessed attachment, the draft requires review
  or asks for manual confirmation.
- Attachment content is never executed.
- Future extraction must use isolated processing and label extracted content as
  untrusted.

### FR-022 Thread-correct reply headers

Sent replies must preserve provider-compatible thread headers.

Acceptance criteria:

- `In-Reply-To` references the immediate parent message ID when available.
- `References` contains the valid prior chain plus the parent message ID without
  duplicate identifiers.
- Subject prefixes do not stack duplicate `Re:` values.
- Header values are normalized and validated before submission.

### FR-023 User review surface

The review UI must present the information needed for an informed send decision.

Acceptance criteria:

- The user sees sender mailbox, recipient, subject, body, and approval status.
- The user can inspect the relevant conversation history.
- The user sees whether knowledge was used, absent, weak, stale, or conflicting.
- Policy blocks and validation findings have actionable explanations.
- Editing immediately invalidates visible approval state.
- All new user-facing text is translated into English, Chinese, Spanish, French,
  German, and Japanese.

### FR-024 Audit completeness

The system must produce an immutable logical record of each important decision.

Acceptance criteria:

- Audited stages include context construction, classification, policy checks,
  retrieval, generation, validation, editing, approval, send claiming, SMTP
  outcome, and reconciliation.
- Records include version identifiers for prompt, policy, classifier, validator,
  identity profile, and knowledge scope.
- Audit records refer to full drafts by ID and avoid duplicating unnecessary
  private content in logs.
- Audit write failure before SMTP blocks sending.
- Audit write failure after possible SMTP submission produces an operational
  alert and an ambiguous-delivery outcome.

## 10. Data Requirements

This PRD does not mandate exact table names, but the product must represent the
following concepts through the existing Model and Module architecture.

### 10.1 Conversation

Required attributes:

- Stable local conversation ID.
- Email service ID.
- Normalized root message identifier where available.
- Subject display value.
- Participant addresses.
- Context confidence and ambiguity reason.
- Latest message timestamp.

### 10.2 Conversation message

Required attributes:

- Direction: inbound or outbound.
- Provider UID where applicable.
- RFC message ID, parent ID, and reference chain.
- Sender, To, Cc, and Reply-To.
- Normalized subject and safe plain text.
- Sanitized HTML when retained.
- Provider timestamp and local persistence timestamp.
- Automated-message header signals.
- Attachment metadata.
- Delivery status for outbound messages.

### 10.3 Draft revision and approval

Required attributes:

- Draft ID and revision number.
- Original message and conversation IDs.
- Email service, sender, and recipient snapshot.
- Subject and body content.
- Content/envelope hash.
- State and transition timestamps.
- Generation, identity, context, policy, and validation versions.
- Approval actor, time, and approved hash.

### 10.4 Send attempt

Required attributes:

- Unique idempotency key.
- Draft revision and approval reference.
- Atomic claim status.
- Sender and recipient snapshot.
- Start and completion times.
- Provider message ID when available.
- Definite failure, success, or ambiguous outcome.
- Sanitized diagnostic information.

### 10.5 Knowledge scope and evidence

Required attributes:

- Mailbox or identity profile association.
- Allowed collection, tag, or document filters.
- Scope version.
- Retrieval query and retrieval version.
- Selected direct source IDs and scores.
- Relevance decision and abstention reason.
- Source effective-date metadata when available.

## 11. AI Context And Prompt Requirements

The model input should use structured sections with explicit boundaries:

```text
SYSTEM POLICY
MAILBOX IDENTITY
CONVERSATION SUMMARY
RECENT CONVERSATION TURNS (untrusted content)
CURRENT INBOUND MESSAGE (untrusted content)
KNOWLEDGE EVIDENCE (untrusted reference data)
USER'S REPLY GOAL
REQUIRED OUTPUT SCHEMA
```

Requirements:

- The current message and thread history are content, not instructions.
- Knowledge sources provide possible factual evidence, not behavioral commands.
- The user goal may influence tone and purpose but cannot override product policy.
- The prompt must instruct the model to preserve earlier commitments and identify
  unresolved ambiguity.
- The prompt must forbid fabricated access to attachments, accounts, orders, or
  private systems.
- The system must not tell the model to use general product knowledge when
  company-specific evidence is absent.
- Prompt content must be bounded by a token budget and audited by version, not by
  storing hidden system instructions in general logs.

## 12. Policy Requirements

### 12.1 Hard blocks

The following conditions must block normal reply generation and sending unless a
separate explicit workflow is defined:

- Bounce or delivery-status notification.
- Automated reply or list/bulk message.
- Unsubscribe or stop-contact request.
- Invalid or missing recipient.
- Mailbox identity mismatch.
- Discarded, sent, unapproved, or ambiguous-delivery draft.
- Known prompt or tool-policy manipulation that cannot be safely isolated.

### 12.2 Mandatory human review

Initial mandatory-review categories include:

- Refunds, cancellations, charge disputes, or payment instructions.
- Legal threats, legal interpretations, or regulatory requests.
- Credential, account-access, or sensitive personal-data changes.
- Binding price guarantees, discounts, contract terms, or delivery commitments.
- Conflicting thread commitments or knowledge sources.
- Low context, classification, retrieval, or validation confidence.
- Dependence on an unavailable attachment.

These categories may still receive a draft, but no autonomous send path may be
introduced without a later approved PRD.

### 12.3 Policy versioning

Every decision must identify the policy version used. Changing policy must not
silently grandfather unapproved drafts; send-time checks use the current policy.

## 13. UX Requirements

### 13.1 Draft review

The review surface must prioritize repeated work rather than marketing content.
It should provide:

- A compact conversation timeline.
- An editable subject and body.
- Sender and recipient fields that cannot change silently.
- Clear draft, approval, validation, and send states.
- Knowledge evidence and warnings in a secondary inspectable area.
- A single explicit approve-and-send flow.

### 13.2 Status language

Required user-facing states:

- Drafting
- Needs review
- Blocked
- Draft
- Edited; approval required
- Approved
- Sending
- Sent
- Send failed
- Delivery unknown; verify mailbox
- Discarded

The UI must not label an SMTP acceptance as recipient delivery unless the
provider supplies delivery confirmation.

### 13.3 Error recovery

- Validation failures explain what needs review without revealing hidden
  prompts.
- Definite send failures allow a reviewed retry.
- Ambiguous outcomes direct the user to verify the Sent folder.
- Policy blocks link to the relevant mailbox rule when appropriate.
- Missing knowledge offers manual editing or escalation, not a fabricated answer.

## 14. Security And Privacy Requirements

- AI enablement must be checked before parsing or executing AI draft requests at
  the IPC boundary.
- Database access must remain in Model and Module classes, never IPC handlers.
- Worker processes must not access SQLite directly.
- Renderer responses must not contain mailbox passwords, provider tokens, hidden
  prompts, or unrelated message bodies.
- Conversation and knowledge lookup must be mailbox-scoped before content is
  loaded.
- Logs must minimize email content and avoid credentials or raw provider errors.
- HTML must be sanitized before display or plain-text conversion.
- Address and header values must be validated before SMTP submission.
- Imported knowledge and email content must not authorize tools or change
  permissions.
- Retention and deletion of conversation, draft, approval, and audit data must be
  consistent with mailbox deletion behavior.

## 15. Non-Functional Requirements

### NFR-001 Reliability

- Concurrent requests must produce no more than one SMTP submission per approved
  draft revision.
- A successful local `sent` state must always reference a completed send attempt.
- A send may not begin if required audit persistence is unavailable.

### NFR-002 Performance

- Thread context construction should complete within 500 ms at p95 for locally
  stored threads of up to 100 messages, excluding optional model summarization.
- Policy evaluation should complete within 100 ms at p95.
- Knowledge retrieval and generation latency must be measured separately.
- The UI must show progress for draft operations lasting longer than one second.

### NFR-003 Bounded resource use

- Conversation history, retrieval results, and prompt size must have configurable
  hard caps.
- Very large threads must not block the Electron main event loop.
- Attachment processing, if later introduced, must have file-size, type, time,
  and memory limits.

### NFR-004 Observability

- Operators can distinguish policy, retrieval, generation, validation, approval,
  SMTP, database, and reconciliation failures.
- Metrics must not contain full email bodies or secrets.
- Correlation IDs must connect one draft request to its policy, retrieval,
  generation, approval, and send events.

### NFR-005 Compatibility

- Existing received messages and drafts remain readable after migration.
- Existing SMTP and receive configuration continues to work.
- Missing historical outbound metadata results in partial-history labeling rather
  than migration failure.

## 16. Success Metrics

Initial release targets measured on the controlled evaluation suite and internal
dogfooding:

- **Wrong-mailbox sends**: 0.
- **Unapproved sends**: 0.
- **Duplicate SMTP submissions caused by concurrent requests**: 0.
- **Hard-block recall** for unsubscribe, bounce, and automated-mail fixtures:
  100%.
- **Thread-dependent answer correctness**: at least 95% on approved fixtures.
- **Contradiction rate** for explicit prior commitments: below 1%.
- **Unsupported company-specific factual claims**: below 1%.
- **Knowledge-scope violations**: 0.
- **Prompt/tool leakage in sendable drafts**: 0.
- **Ambiguous SMTP outcomes automatically retried**: 0.
- **Human draft acceptance without substantive edit**: tracked as a quality
  indicator, with a baseline established before setting a target.

Production metrics must be segmented by provider, model, prompt version, policy
version, and language without logging private message content.

## 17. Evaluation And Test Requirements

### 17.1 Thread understanding suite

Fixtures must cover:

- "Yes" or "No" answers that depend on a prior question.
- Date and time selection across multiple turns.
- Previously quoted price or discount.
- A prior promise to follow up or provide a document.
- Changed requirements later in the thread.
- Repeated quoted history and signatures.
- Multiple unrelated messages with the same subject.
- Missing or malformed message IDs and references.
- Cross-mailbox messages with similar identifiers.

### 17.2 Policy suite

Fixtures must cover:

- Unsubscribe language in every supported UI language where practical.
- Bounce and delivery-status messages.
- `Auto-Submitted`, bulk, list, and no-reply signals.
- Sensitive financial, legal, credential, and account requests.
- Blocked sender and domain rules.
- Rule changes between draft and send.
- Low-confidence and conflicting classifications.

### 17.3 Retrieval suite

Fixtures must cover:

- Relevant and irrelevant top-ranked chunks.
- Conflicting prices or policies.
- Expired and current documents.
- Neighbor chunks with irrelevant content.
- Cross-mailbox/private-collection isolation.
- Prompt injection inside uploaded documents and imported websites.
- No-result and low-score abstention.

### 17.4 Approval and delivery suite

Tests must cover:

- Approval followed by body, subject, recipient, or sender edit.
- Direct send attempt from `draft`, `failed`, `sent`, and `discarded` states.
- Two concurrent send requests.
- SMTP rejection before acceptance.
- SMTP timeout after possible acceptance.
- SMTP success followed by database-write failure.
- Process restart while a draft is `sending`.
- Reconciliation to `sent`, `failed`, or `delivery_unknown`.

### 17.5 Content suite

Tests must cover:

- HTML-only email.
- Very long latest message.
- Attachment-dependent question.
- Multilingual AI disclosure and prompt leakage.
- Obfuscated forbidden phrases.
- Unsupported URLs, payment instructions, and commitments.
- Correct use of identity style notes and signature.

## 18. Rollout Plan

### Phase 0: Immediate send-safety remediation

Scope:

- Enforce mailbox binding.
- Require approved draft revision.
- Connect policy to drafting and sending.
- Make leakage findings blocking.
- Add atomic `approved -> sending` transition.
- Introduce explicit ambiguous-delivery handling.

Exit criteria:

- Wrong-mailbox, unapproved-send, and concurrent-send tests pass.
- Existing send flows remain functional through explicit approval.
- No new autonomous send behavior exists.

### Phase 1: Conversation correctness

Scope:

- Canonical conversation resolution.
- Ordered inbound/outbound history.
- Outbound message ID persistence.
- Quoted-text reduction and bounded context.
- Thread summary and commitment representation.

Exit criteria:

- Thread-dependent evaluation target is met.
- Ambiguous threads are visibly degraded or reviewed, never silently merged.

### Phase 2: Knowledge and generation reliability

Scope:

- Mailbox-scoped knowledge.
- Relevance calibration and abstention.
- Untrusted document isolation.
- Strict generation schema and deterministic validation.
- Complete identity-style application.

Exit criteria:

- Knowledge-scope and prompt-injection tests pass.
- No unsupported company-specific claim is sendable in the blocking test suite.

### Phase 3: Message completeness and operations

Scope:

- HTML-only normalization.
- Automated-message header persistence.
- Attachment-aware abstention.
- Delivery reconciliation and operational dashboards.
- Retention and deletion completion.

Exit criteria:

- Provider failure scenarios and restart recovery tests pass.
- Support staff can diagnose an attempt without accessing raw credentials.

## 19. Migration Requirements

- Existing drafts default to unapproved and cannot be sent until reviewed under
  the new policy.
- Existing `sent` drafts remain sent and are not eligible for resend.
- Existing failed drafts require a new reviewed revision or explicit retry flow.
- Historical inbound messages may be backfilled into conversations using strict
  message-header matching.
- Ambiguous historical messages remain ungrouped or are marked partial; subject
  matching alone is prohibited.
- Historical sent drafts without provider message IDs may appear in context as
  locally recorded outbound messages with reduced confidence.
- Migration must be restartable and must not run in a worker process with direct
  database access.

## 20. Risks And Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Incorrect thread merge | Private or irrelevant content enters a reply | Scope by mailbox; use normalized RFC identifiers; mark ambiguity instead of subject-only merging |
| Thread prompt becomes too large | Slow or incomplete generation | Deduplicate quotes, cap recent turns, summarize older history, enforce token budgets |
| Knowledge result is semantically weak | Hallucinated or irrelevant factual reply | Calibrated abstention, source scope, conflict and staleness checks |
| Knowledge document contains instructions | Prompt injection or policy bypass | Treat all source content as untrusted data; validate output; never grant tool authority from content |
| Approval becomes stale | User sends content they did not review | Revision and envelope hash; invalidate on every relevant change |
| SMTP accepted but local write failed | Duplicate resend | `delivery_unknown`, persisted attempt identity, no automatic retry, reconciliation |
| Strict controls reduce convenience | More drafts require review | Explain reasons clearly; tune thresholds using measured false-positive data |
| Multilingual policy misses unsafe intent | Unsubscribe or leakage is answered | Multilingual fixtures, header signals, constrained classifier, human-review fallback |
| Audit records expose private content | Privacy and compliance risk | Reference draft IDs, minimize previews, sanitize diagnostics, enforce retention |

## 21. Dependencies

- Reliable storage and normalization of inbound message headers.
- Model and Module support for thread queries and atomic state transitions.
- SMTP send result handling that exposes provider message IDs when available.
- Knowledge-library metadata filters and explicit empty-filter semantics.
- AI structured-output support or strict local schema validation.
- Renderer support for revision-aware approval and delivery-unknown states.
- Translation updates for all supported languages.

## 22. Open Product Decisions

The following decisions must be resolved during technical design without
weakening the requirements above:

1. Whether to introduce unified conversation/message entities or compose history
   from received messages, sent drafts, and send attempts.
2. How long approval remains valid when no content or policy changes occur.
3. Whether a manual UI send action performs approval and send as one transaction
   or as two visible steps.
4. Which knowledge scoping model users understand best: collections, tags,
   document allowlists, or profile-owned libraries.
5. Which provider reconciliation mechanisms are available for ambiguous sends.
6. Whether human-edited drafts receive reduced validation or the same validation
   with override reasons.
7. Retention periods for full message bodies, normalized history, and audit
   metadata.
8. Whether multilingual deterministic classifiers are shipped together or
   released incrementally with mandatory review for unsupported languages.

## 23. Release Gates

The feature is ready for general availability only when:

- All Phase 0 requirements are implemented and tested.
- Conversation context cannot cross an email-service boundary.
- Send execution requires a current approved revision.
- Atomic send claiming passes concurrency tests.
- Ambiguous SMTP outcomes cannot be automatically retried.
- Unsubscribe, bounce, and automated-mail hard-block fixtures achieve 100% recall.
- Knowledge access is explicitly scoped and cross-scope tests pass.
- Prompt and retrieval leakage findings cannot produce a sendable draft.
- Thread-dependent quality and unsupported-claim targets are met.
- UI behavior is verified in all supported languages.
- Audit and privacy review passes.
- Rollback preserves already-sent status and does not make existing drafts
  implicitly sendable.

## 24. Future Considerations

Potential future work, explicitly excluded from this release:

- Rule-based autonomous sending for a small allowlist of low-risk intents.
- Provider APIs that offer stronger delivery reconciliation than SMTP.
- Safe attachment extraction in isolated worker processes.
- User-managed reusable thread summaries.
- Campaign and CRM state updates based on verified reply intent.
- Reply-all workflows with explicit participant policy.
- Learning owner style from approved historical replies with consent and privacy
  controls.

Any autonomous send phase must have a separate PRD defining eligible intents,
rollback, kill switches, monitoring, rate limits, incident response, and a staged
customer rollout.
