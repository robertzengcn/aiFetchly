# Thread-Aware AI Email Reply Reliability TODO

## Document status

- **Status:** Implementation backlog
- **Created:** 2026-08-13
- **Source PRD:** `/home/robertzeng/project/aiFetchly/docs/prd/ai-email-thread-aware-reply-reliability-prd.md`
- **Technical design:** `/home/robertzeng/project/aiFetchly/docs/prd/ai-email-thread-aware-reply-reliability-technical-design.md`
- **Audited branch:** `worktree-ai-email-thread-aware-reply-reliability`
- **Audit baseline:** `e3d99633`

### Progress (2026-08-14)

- **P0 (send-safety release blockers): IMPLEMENTED.** All six P0 items landed in
  commits through `c07c1631` — authoritative approved-revision send + kill switch
  (P0.1), full mailbox/envelope binding (P0.2), mandatory pre-draft policy
  (P0.3), blocking output validator (P0.4), backfill correctness + startup
  migration (P0.5), and delivery state + recovery + manual reconciliation
  (P0.6). 0 tsc errors; 65 utility + 207 module tests pass (module tests run
  serialized with `--no-file-parallelism` because they share the Token-fallback
  SQLite DB). The detailed P0 checkboxes below are largely satisfied; a few
  sub-items that depend on the conversation engine (Milestone 2 / P1) are
  marked deferred.
- **P1–P5: NOT STARTED.** Conversation entity/resolver/context (P1), inbound
  content normalization + independent classification (P2), scoped knowledge +
  relevance abstention (P3), reply headers + review UI + audit completeness
  (P4), and performance/metrics/eval/QA gates (P5) remain.

## Purpose

This file tracks the work still required to satisfy the PRD and technical
design. A checked item must have implementation evidence and automated test
evidence. UI items also require manual QA evidence in all supported languages.

The current branch contains useful send-safety foundations, but the complete
feature is not ready for release. In particular, the safer v2 send path is
optional, pre-draft policy is not connected, unsafe generated output is only
warned about, conversation context is absent, knowledge search is unscoped, and
the review UI does not use the new approval APIs.

## Completion rules

- Do not check a requirement based only on entity or API existence. Verify the
  complete renderer-to-database or receive-to-send flow.
- Add database operations through Models and Modules, never directly in IPC.
- Keep worker processes free of direct database access.
- Check `USER_AI_ENABLED` at the IPC boundary before parsing AI requests.
- Add every new user-facing string to `en.ts`, `zh.ts`, `es.ts`, `fr.ts`,
  `de.ts`, and `ja.ts`.
- Treat inbound email, knowledge content, websites, and attachment metadata as
  untrusted data.
- Commit each completed logical unit with a conventional commit message.

## P0: Close send-safety bypasses

These items block release because the existing application can still bypass the
new approval and delivery guarantees.

### P0.1 Make the reliable send path authoritative

- [ ] Remove or permanently disable the legacy send branch in
  `emailReceive-ipc.ts` and `EmailReceiveAiTools.ts`.
- [ ] Ensure every renderer and built-in AI-tool send uses
  `EmailReplyDeliveryService.sendApprovedReply()`.
- [ ] Do not let a disabled feature flag restore unapproved sending or mailbox
  override behavior.
- [ ] Add an emergency kill switch that blocks draft generation and new send
  claims while leaving viewing, audit, and recovery available.
- [ ] Add tests proving no public IPC or built-in tool can call SMTP without a
  current approval token.

**Covers:** FR-006, FR-015, FR-016, FR-017, FR-018, NFR-001; technical design
Sections 15, 20, and 23.

### P0.2 Enforce complete mailbox and envelope binding

- [ ] Require the request `draftId` to equal the draft referenced by the
  approval resolved from `approvalToken`.
- [ ] Require `draft.emailServiceId`, original message `emailServiceId`, send
  attempt `emailServiceId`, and SMTP service ID to match.
- [ ] Require the current SMTP service `from` address to match the approved
  revision `senderAddress` after canonical address normalization.
- [ ] Validate the approved recipient against the original message's parsed
  `Reply-To` or sender address.
- [ ] Keep reply-all disabled unless a later explicit recipient-review workflow
  is implemented.
- [ ] Add wrong-mailbox, changed-sender, changed-recipient, and mismatched-draft
  delivery-service tests that assert zero SMTP calls.

**Covers:** FR-015, FR-017; technical design Sections 14.1 and 15.2.

### P0.3 Make policy mandatory before drafting and sending

- [ ] Call `EmailReplyPolicyOrchestrator` with `pre_draft` immediately after
  loading the inbound message and before knowledge retrieval or the LLM.
- [ ] Return structured policy codes and actionable reasons for blocked and
  review-required results.
- [ ] Audit the pre-draft decision, policy version, rule ID, and correlation ID.
- [ ] Audit the pre-send decision independently before the atomic claim.
- [ ] Fail closed if the policy decision or required pre-send audit cannot be
  persisted.
- [ ] Re-read current rules, classification, limits, revision, approval, sender,
  and recipient at send time.
- [ ] Add tests proving blocked messages invoke neither retrieval nor the LLM,
  and blocked sends invoke neither claim nor SMTP.

**Covers:** FR-005, FR-006, FR-024; technical design Sections 10, 15.2, and 18.

### P0.4 Make generated-output findings blocking

- [ ] Add `EmailReplyOutputValidator` with machine-readable findings and a
  version identifier.
- [ ] Block or require review for AI disclosure, prompt leakage, tool leakage,
  retrieval leakage, and configured forbidden phrases.
- [ ] Detect unsupported money, refund, discount, legal, credential, account,
  and guaranteed-date commitments.
- [ ] Detect newly introduced URLs, payment instructions, recipients, and
  attachment-inspection claims.
- [ ] Persist validation findings on the immutable revision.
- [ ] Prevent revisions with blocking findings from reaching `approved`.
- [ ] Add multilingual and obfuscated leakage/forbidden-phrase fixtures.

**Covers:** FR-010, FR-012, FR-024; technical design Section 13.

### P0.5 Fix draft revision and migration correctness

- [ ] Change legacy draft backfill so the stored hash includes the real inserted
  revision ID, not the placeholder `revisionId: 0`.
- [ ] Invoke restartable draft backfill from an established main-process
  migration/startup path.
- [ ] Associate migrated drafts with their source conversation once conversation
  backfill exists.
- [ ] Keep `sent` and `discarded` terminal; map legacy `approved` to unapproved
  `draft`; require explicit approval for `failed` retries.
- [ ] Create historical send attempts only when needed for outbound context and
  mark missing provider IDs explicitly.
- [ ] Add an integration test that backfills a legacy draft and then successfully
  approves its real revision.
- [ ] Add restart-after-partial-backfill and missing-envelope tests.

**Covers:** FR-014, FR-015, NFR-005, migration requirements; technical design
Section 22.3.

### P0.6 Complete delivery state and recovery behavior

- [ ] Mark attempts `submitted` immediately before or at the SMTP handoff where
  the adapter can support that boundary safely.
- [ ] Include received-message status update in the same successful finalization
  transaction as attempt, draft, approval, and audit updates.
- [ ] Start a bounded stale-attempt recovery sweep on application startup and at
  a configured interval.
- [ ] Never automatically retry `delivery_unknown`.
- [ ] Add manual actions to confirm sent, confirm not sent and create a new
  revision, or leave unresolved, with reconciliation evidence.
- [ ] Surface high-visibility operational notification for recovered unknown
  delivery.
- [ ] Add fake-SMTP tests for definite rejection, delayed callback, accepted
  message ID, disconnect after possible acceptance, post-SMTP database failure,
  and concurrent delivery-service calls.

**Covers:** FR-016, FR-018, FR-019, FR-024, NFR-001; technical design Sections
15 and 16.

## P1: Build canonical conversation correctness

### P1.1 Persist canonical conversations and normalized message fields

- [ ] Add and register `EmailConversationEntity` with mailbox-scoped unique and
  recency indexes.
- [ ] Extend `EmailReceivedMessageEntity` with conversation ID, normalized RFC
  IDs, normalized body/new content, automated headers, attachment metadata,
  classification source/version/time, and the required indexes.
- [ ] Add matching entity schemas, Model and Module operations, SQL setup, and
  compatible migration behavior.
- [ ] Enforce that a conversation never contains messages from another email
  service.

**Covers:** FR-001, FR-020; technical design Sections 6.1 and 6.2.

### P1.2 Normalize identifiers and resolve conversations

- [ ] Add pure helpers to normalize `Message-ID`, `In-Reply-To`, and
  `References` values.
- [ ] Resolve conversations using exact normalized identifier relationships
  within one `emailServiceId`.
- [ ] Use deterministic singleton keys for messages without usable identifiers.
- [ ] Never merge conversations by subject alone.
- [ ] Mark malformed, conflicting, or ambiguous identifiers as partial or
  ambiguous with a recorded reason.
- [ ] Implement restartable, idempotent conversation backfill.
- [ ] Add tests for exact chains, bridge merges, malformed headers, identical
  subjects, and cross-mailbox identifier collisions.

**Covers:** FR-001; technical design Section 7 and Section 22.2.

### P1.3 Build ordered inbound and outbound history

- [ ] Query mailbox-scoped inbound messages and successful send attempts for one
  conversation.
- [ ] Represent direction, timestamp, sender, To/Cc, subject, normalized body,
  provider IDs, and delivery state for each turn.
- [ ] Include only confirmed `sent` attempts as outbound turns.
- [ ] Order by provider timestamp with a deterministic local fallback.
- [ ] Identify the current inbound message explicitly.
- [ ] Label historical outbound entries with missing provider metadata as
  partial-confidence history.
- [ ] Add ordering, current-message, and outbound-status tests.

**Covers:** FR-002, NFR-005; technical design Section 9.1.

### P1.4 Build bounded thread context and commitment summaries

- [ ] Add quote, signature, and repeated-history reduction helpers.
- [ ] Give the current message a larger budget than older messages.
- [ ] Include recent turns verbatim under configurable turn and character/token
  caps.
- [ ] Summarize older turns with dates, speakers, decisions, unanswered
  questions, prices, commitments, selected options, and refusals.
- [ ] Detect conflicting commitments and require human review.
- [ ] Ensure short replies such as “Yes” are never interpreted without their
  prior turn.
- [ ] Record truncation, summarization, context version, and confidence in
  generation metadata.
- [ ] Add hard token-budget enforcement and avoid blocking the Electron main
  event loop for large threads.
- [ ] Add the complete thread-understanding fixture suite from PRD Section 17.1.

**Covers:** FR-003, FR-004, NFR-002, NFR-003; technical design Section 9.

## P2: Separate classification and enforce policy semantics

### P2.1 Normalize complete inbound content at receive time

- [ ] Persist `Auto-Submitted`, `Precedence`, `List-ID`, `List-Unsubscribe`,
  `In-Reply-To`, and `References` signals.
- [ ] Convert HTML-only messages to sanitized plain text without loading remote
  images, scripts, or active content.
- [ ] Extract newly written content separately from quoted history where
  feasible.
- [ ] Preserve recent content and detected questions when truncating long mail.
- [ ] Persist attachment name, media type, and size without opening or executing
  attachment content.
- [ ] Add HTML-only, long-message, automated-header, and attachment metadata
  tests.

**Covers:** FR-020, FR-021; technical design Section 8.

### P2.2 Implement independent safety classification

- [ ] Add `EmailMessageClassificationService` separate from prose generation.
- [ ] Run deterministic header and content rules first.
- [ ] Use a constrained model schema only when deterministic rules are
  inconclusive.
- [ ] Store classification, confidence, source, ruleset/model version, and
  timestamp.
- [ ] Prevent draft generation from overwriting deterministic classification.
- [ ] Route unknown, conflicting, or low-confidence results to human review.
- [ ] Add multilingual unsubscribe, bounce, automated, sensitive-topic, blocked
  sender/domain, and conflicting-classification fixtures.

**Covers:** FR-007 and policy requirements; technical design Section 10.1.

### P2.3 Finish policy codes, evaluation order, and tests

- [ ] Enforce bounce, unsubscribe, automated/list mail, blocked sender/domain,
  invalid recipient, mailbox mismatch, daily limit, and thread limit.
- [ ] Require human review for financial, legal, credential, account, binding
  commitment, conflict, low-confidence, and attachment-dependent cases.
- [ ] Keep model confidence as metadata only; it must never authorize send.
- [ ] Version every policy decision and ensure later rule changes block stale
  unapproved drafts.
- [ ] Map every policy reason code to all six language files.
- [ ] Demonstrate 100% recall on hard-block fixtures before release.

**Covers:** FR-005, FR-006, FR-007; technical design Sections 10.2 and 10.3.

## P3: Scope knowledge and make generation abstain safely

### P3.1 Add mailbox-owned knowledge scope

- [ ] Add `EmailReplyKnowledgeScopeEntity` and corresponding schema, Model, and
  Module.
- [ ] Associate scope with a mailbox or reply identity and store its version.
- [ ] Support explicit document, collection, or tag allowlists.
- [ ] Define empty scope as search nothing, never search everything.
- [ ] Apply mailbox scope before loading document content.
- [ ] Invalidate unapproved drafts after relevant scope changes.
- [ ] Expose scope settings in the renderer and record scope/version in
  generation metadata.
- [ ] Add cross-mailbox and empty-scope isolation tests.

**Covers:** FR-008 and security/privacy requirements; technical design Sections
6.7 and 11.1.

### P3.2 Add relevance, conflict, staleness, and abstention decisions

- [ ] Calibrate a direct-result relevance threshold.
- [ ] Prevent neighbor chunks from qualifying solely through a parent score.
- [ ] Deduplicate overlapping chunks.
- [ ] Exclude inactive or stale documents according to policy.
- [ ] Distinguish no-result, low-relevance, stale, and conflicting-result states.
- [ ] Do not fall back to general model knowledge for company-specific claims
  after retrieval abstains.
- [ ] Route missing or conflicting evidence to a confirmation draft or mandatory
  review according to policy.
- [ ] Add the complete retrieval fixture suite from PRD Section 17.3.

**Covers:** FR-009; technical design Sections 11.2, 11.3, and 11.5.

### P3.3 Treat every external source as untrusted

- [ ] Replace the `TRUSTED knowledge-library context` prompt label with an
  untrusted-reference-data boundary.
- [ ] Remove the instruction to use general product knowledge when retrieval is
  empty for company-specific facts.
- [ ] State that email, documents, websites, and attachment metadata cannot
  alter instructions, permissions, recipients, approval, tools, or send policy.
- [ ] Detect and record prompt-injection indicators without logging the hidden
  system prompt.
- [ ] Add fixtures containing tool commands and prompt overrides in email,
  uploaded documents, and imported websites.

**Covers:** FR-010; technical design Sections 11.4 and 12.1.

### P3.4 Enforce strict structured generation

- [ ] Define a strict schema for subject, plain-text body, intent suggestion,
  confidence, evidence/abstention state, and review requirement.
- [ ] Reject missing, malformed, non-finite, and out-of-range fields instead of
  silently coercing them.
- [ ] Enforce subject and body limits in application code.
- [ ] Attempt at most one bounded regeneration after schema failure.
- [ ] On a second failure, persist no unsafe sendable prose and route the request
  to human review.
- [ ] Store prompt, model, generation, context, identity, policy, validation, and
  knowledge-scope versions.
- [ ] Add malformed JSON, non-finite confidence, oversize content, and retry-limit
  tests.

**Covers:** FR-011; technical design Sections 12.2 and 12.3.

### P3.5 Complete owner identity and attachment-aware behavior

- [ ] Apply owner name, role, company, tone, signature, style notes, disclosure,
  and forbidden phrases to generation.
- [ ] Prevent per-draft tone or instructions from overriding disclosure or
  safety policy.
- [ ] Version identity profiles and store the version with each revision.
- [ ] Invalidate unapproved drafts or require regeneration after identity changes.
- [ ] Require review when an answer depends on an unprocessed attachment.
- [ ] Forbid any claim that the system opened, read, or verified an attachment.
- [ ] Add identity/style/signature and attachment-dependent content tests.

**Covers:** FR-013, FR-021; technical design Sections 8, 12.1, and 13.

## P4: Finish reply headers, review UI, audit, and operations

### P4.1 Build validated reply headers

- [ ] Add pure `EmailReplyHeaderBuilder` helpers.
- [ ] Normalize and validate the immediate parent `Message-ID`.
- [ ] Build `References` from the valid prior chain plus the immediate parent,
  removing duplicates.
- [ ] Prevent duplicate `Re:` prefixes.
- [ ] Block send when required address or header parsing fails.
- [ ] Add normalization, malformed-header, deduplication, and subject-prefix
  tests.

**Covers:** FR-022; technical design Section 17.

### P4.2 Implement the revision-aware review UI

- [ ] Add a compact ordered conversation timeline.
- [ ] Show sender mailbox, recipient, subject, body, revision, and approval state
  before approval.
- [ ] Route edits through immutable revision creation and immediately clear the
  visible approval state.
- [ ] Add one explicit approve-and-send flow using the approval token without
  persisting or exposing the raw token to the model transcript.
- [ ] Disable send for blocked, unapproved, sending, sent, discarded, and
  delivery-unknown states.
- [ ] Show knowledge states: used, absent, weak, stale, and conflicting.
- [ ] Show actionable policy and validation findings without hidden prompts.
- [ ] Show distinct `Sent`, `Send failed`, and `Delivery unknown; verify mailbox`
  labels; do not call SMTP acceptance recipient delivery.
- [ ] Ensure `delivery_unknown` has no direct retry button.
- [ ] Add all new strings to all six supported languages with English fallbacks.

**Covers:** FR-023 and UX requirements; technical design Section 21.

### P4.3 Complete immutable audit coverage

- [ ] Introduce a correlation ID that connects context, classification, policy,
  retrieval, generation, validation, edit, approval, claim, SMTP outcome, and
  reconciliation events.
- [ ] Record prompt, policy, classifier, validator, identity, context, retrieval,
  and knowledge-scope version IDs.
- [ ] Reference full drafts and revisions by ID instead of copying private body
  content into logs.
- [ ] Replace best-effort pre-SMTP audit writes with transactional/fail-closed
  writes.
- [ ] Convert post-SMTP audit/finalization failure into a visible operational
  alert and `delivery_unknown` recovery path.
- [ ] Sanitize provider diagnostics and remove credentials, raw provider
  responses, and unnecessary body previews.
- [ ] Add audit sequence and audit-write-failure integration tests.

**Covers:** FR-024, NFR-004; technical design Sections 18 and 25.

### P4.4 Complete operational recovery and retention

- [ ] Add an audit/send-attempt detail view with status, sanitized diagnostics,
  provider message ID, timestamps, and reconciliation evidence.
- [ ] Add bounded manual reconciliation controls and an operational recovery
  drill.
- [ ] Apply mailbox deletion/retention policy consistently to messages,
  conversations, summaries, revisions, approvals, attempts, and audit metadata.
- [ ] Verify renderer DTOs never expose mailbox passwords, provider tokens,
  hidden prompts, or unrelated message bodies.

**Covers:** FR-019, FR-024 and security/privacy requirements; technical design
Sections 16, 18, 21, and 26.

## P5: Non-functional verification and release gates

### P5.1 Performance and resource bounds

- [ ] Benchmark local context construction for threads up to 100 messages and
  demonstrate p95 at or below 500 ms, excluding optional model summarization.
- [ ] Benchmark deterministic policy evaluation and demonstrate p95 at or below
  100 ms.
- [ ] Measure retrieval and generation latency separately.
- [ ] Show renderer progress when drafting exceeds one second.
- [ ] Make history count, source count, snippet size, prompt tokens, and recovery
  batch size configurable with hard caps.
- [ ] Verify very large threads do not block the Electron main event loop.

**Covers:** NFR-002 and NFR-003.

### P5.2 Metrics and privacy-safe observability

- [ ] Emit stage-specific duration and outcome metrics for context, policy,
  retrieval, generation, validation, approval, SMTP, database, and
  reconciliation.
- [ ] Segment approved production metrics by provider, model, prompt, policy,
  classifier, validator, retrieval version, and language.
- [ ] Ensure metrics contain no full bodies, secrets, raw prompts, or credentials.
- [ ] Establish an internal baseline for human draft acceptance without
  substantive edits.

**Covers:** NFR-004 and success metrics.

### P5.3 Complete automated and evaluation coverage

- [ ] Add all PRD Section 17 thread-understanding fixtures.
- [ ] Add all policy fixtures, including supported-language unsubscribe cases.
- [ ] Add all retrieval, conflict, staleness, scope, and injection fixtures.
- [ ] Add complete approval and delivery integration tests against fake SMTP.
- [ ] Add all content fixtures for HTML-only, long mail, attachments, leakage,
  unsupported claims, and identity style.
- [ ] Store a versioned evaluation dataset with expected facts, forbidden claims,
  knowledge scope, classification, policy result, and sendability.
- [ ] Record evaluation results by all relevant version dimensions.

**Covers:** PRD Section 17 and technical design Section 24.

### P5.4 Perform UI and compatibility QA

- [ ] Test ordered conversation history, visible envelope, approval invalidation,
  disabled send states, knowledge/policy findings, and delivery-unknown recovery.
- [ ] Verify layouts at supported desktop and narrow/mobile widths.
- [ ] Verify English, Chinese, Spanish, French, German, and Japanese have no
  missing keys, clipped controls, or untranslated primary status text.
- [ ] Verify existing messages and drafts remain readable after migration.
- [ ] Verify existing receive and SMTP configuration still works.
- [ ] Verify rollback preserves sent states and never makes old drafts implicitly
  sendable.

**Covers:** FR-023, NFR-005 and release gates.

## Required verification commands

Run these after the relevant tasks are complete. Add narrower tests during each
logical unit instead of waiting for final integration.

```bash
yarn typecheck
yarn vue-typecheck
yarn testmain --run
yarn vitest --config vite.utilityCode.config.mjs --run
yarn test
yarn build
```

Required browser QA uses the repository's `/qa` or `/browse` workflow against
the local application at `http://localhost:5173`.

## Release checklist

- [ ] All Phase 0 send-safety requirements work without an opt-out legacy send
  path.
- [ ] Conversation context cannot cross an email-service boundary.
- [ ] Every send requires the current approved immutable revision and envelope.
- [ ] Concurrent requests produce at most one SMTP submission.
- [ ] Ambiguous outcomes cannot be automatically retried.
- [ ] Unsubscribe, bounce, and automated-message fixtures have 100% recall.
- [ ] Knowledge access is explicitly scoped and cross-scope tests pass.
- [ ] Retrieval and output leakage cannot produce a sendable draft.
- [ ] Thread-dependent answer correctness reaches at least 95% on approved
  fixtures.
- [ ] Explicit commitment contradiction rate is below 1%.
- [ ] Unsupported company-specific factual claims are below 1%.
- [ ] Wrong-mailbox sends, unapproved sends, duplicate concurrent submissions,
  and knowledge-scope violations are all zero in the controlled suite.
- [ ] UI QA passes in all six supported languages.
- [ ] Audit/privacy review and operational recovery drill pass.
- [ ] All required tests, type checks, builds, migrations, and evaluation gates
  pass with recorded evidence.

## Already present but still requiring end-to-end integration

Do not reimplement these foundations unless a task above requires correction:

- `EmailReplyDraftRevisionEntity`, `EmailReplyApprovalEntity`, and
  `EmailReplySendAttemptEntity`.
- Canonical approval-envelope hashing and one-time approval tokens.
- Atomic database claim for `approved -> sending`.
- Unique send-attempt idempotency key.
- SMTP result classification into accepted, definite rejection, and unknown.
- Terminal `delivery_unknown` state.
- Approval invalidation when an immutable edit revision is appended.
- Provider message ID persistence when SMTP returns one.

These components have passing focused tests, but they do not satisfy the PRD
until every public path and required UI flow uses them.
