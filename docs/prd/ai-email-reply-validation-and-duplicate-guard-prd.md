# AI Email Reply Validation And Duplicate-Reply Guard - Product Requirements Document

## Document Information

- **Status:** Draft
- **Owner:** Engineering
- **Related PRDs:**
  - `ai-email-receive-auto-reply-prd.md` (original receive + reply lifecycle)
  - `ai-email-thread-aware-reply-reliability-prd.md` (FR-011/FR-012 generation + validation)
  - `ai-outbound-email-intent-aware-delivery-prd.md` (send reliability)
- **Related Technical Design:** `ai-email-reply-validation-and-duplicate-guard-technical-design.md`
- **Scope:** Two production defects in the AI auto-reply email feature plus a manual-reply detection capability.

## 1. Purpose

This PRD specifies the fix for two defects reported against the AI auto-reply
email feature, and introduces a new capability that lets the system recognize
when a message has already been answered — including answers written manually
outside the application.

1. **Validation regression:** `create_email_reply_draft` frequently returns
   `[needs_human_review] Generation failed validation twice (2 codes); no draft
   persisted`, blocking draft creation even when the model output is usable.
2. **Duplicate replies:** The AI drafts and sends replies to the same inbound
   message more than once because nothing in the draft-generation path checks
   whether the message was already replied to — by the app or by a human in
   their mailbox.

## 2. Executive Summary

The validation defect has three compounding causes: the system prompt asks the
model for a JSON field named `classification` while the strict schema requires
`intentSuggestion`; the LLM call sets no JSON response mode so the model wraps
output in prose; and `max_tokens: 700` can truncate a 400-word reply mid-JSON.
All three are fixed with a small, surgical change to the prompt, the token
budget, and the API call shape.

The duplicate-reply defect is a missing guard: `EmailReplyDraftGenerationService`
and the `pre_draft` policy gate never inspect `replyStatus`. The send path
already flips `replyStatus` to `sent` on success, so the state exists — it is
just not consulted. A server-side guard in both layers blocks re-drafting and
re-sending.

Manual replies (written in Gmail, Outlook, Apple Mail, or any IMAP client)
cannot be detected from `replyStatus`, which the app never updated. The IMAP
`\Answered` system flag is the cheapest signal, and the receive client already
parses it — it is just not persisted or consulted. For servers that do not set
`\Answered`, a Sent-folder reply search by `In-Reply-To` / `References`
provides a precise per-message second signal. Together these three layers
catch replies made in-app, replies made via IMAP clients that flag, and replies
made via clients/providers that do not flag.

## 3. Current-State Problem

### 3.1 Draft generation fails validation twice

`EmailReplyDraftGenerationService.createDraft` calls the LLM, runs
`parseStrictGeneratedReply`, and on failure sends a bounded correction prompt
and parses again. Two failures produce the error:

```text
[needs_human_review] Generation failed validation twice (2 codes); no draft persisted
```

The error is assembled at `src/service/emailReply/EmailReplyDraftGenerationService.ts:262-275`.
Three independent causes make the failure common rather than rare:

1. **Field-name mismatch.** The system prompt at
   `src/service/emailReply/EmailReplyPromptBuilder.ts:88` asks for:
   `{"subject", "bodyText", "classification", "confidence"}`.
   The strict schema at
   `src/service/emailReply/EmailReplyGenerationSchema.ts:36` requires the field
   `intentSuggestion` (an enum), not `classification`. A model that obeys the
   prompt returns `classification`, then fails validation with a code like
   `intentSuggestion:invalid_enum_value`. The correction prompt
   (`buildCorrectionPrompt`) only echoes the failure codes — it never tells the
   model the correct field name — so the second attempt repeats the same shape.
2. **No JSON response mode.** `callLlmRaw`
   (`EmailReplyDraftGenerationService.ts:431-442`) calls
   `api.openAIChatCompletion(...)` without `response_format`.
   `openAIChatCompletionHosted` (`src/api/aiChatApi.ts:2145-2179`) never
   forwards a `response_format` field. The model is free to wrap output in
   prose or code fences, and `extractJson` then returns `no_json_object`.
3. **Token budget can truncate the body.** The prompt allows "under 400 words"
   (`EmailReplyPromptBuilder.ts:90`) but `max_tokens: 700`
   (`EmailReplyDraftGenerationService.ts:439`) is tight for a 400-word reply
   plus the surrounding JSON envelope and subject. A truncated JSON string
   fails with `malformed_json` or `body_empty`.

### 3.2 Nothing blocks re-drafting an already-replied message

`EmailReplyDraftGenerationService.createDraft` loads the message
(`EmailReplyDraftGenerationService.ts:77-92`) and proceeds straight to
classification, policy, and generation. It never reads `message.replyStatus`.
The `pre_draft` policy gate `evaluatePreDraft`
(`src/service/emailReply/EmailReplyPolicyOrchestrator.ts:56-78`) only inspects
`classification`, `classificationConfidence`, and the effective rule. So a
message with `replyStatus === "sent"` passes the gate and gets a brand-new
draft, which can then be sent again.

The send path does eventually flip `replyStatus` to `"sent"`
(`src/model/EmailReplyDraft.model.ts:445-450`, called from
`src/service/emailReply/EmailReplyDeliveryService.ts:355-368`). The state is
tracked — it is simply not consulted on the way back in.

### 3.3 Manual replies are invisible to the application

`replyStatus` only reflects replies sent through the application. A user who
replies manually in Gmail, Outlook, or Apple Mail leaves `replyStatus` at
`not_started`, so the server-side guard in 3.2 does not catch it and the AI
drafts a duplicate.

Two signals are available to close this gap:

1. **IMAP `\Answered` flag.** The receive client already parses this:
   `ImapEmailReceiveClient.ts:170` reads `normalizedFlags.has("\\answered")`
   and `ParsedInboundEmail.isAnswered` is declared at
   `src/service/emailReceive/EmailReceiveClient.ts:28`. But the field is not
   persisted — `EmailReceivedMessageEntity` has no `isAnswered` column — and
   the sync path drops it. Nothing downstream consults it.
2. **Sent-folder reply search.** The entity already stores `messageId` (RFC
   Message-ID, `EmailReceivedMessage.entity.ts:33`), `inReplyTo`, and
   `referencesHeader` (lines 40, 43). A scan of the mailbox's Sent folder for a
   reply whose `In-Reply-To`/`References` contains the original Message-ID
   detects a manual reply with per-message precision. This catches replies
   from any client on a provider that syncs the Sent folder over IMAP.

## 4. Product Principles

- **Fail closed on duplicate replies.** A duplicate reply is worse than a
  missed draft. When the system cannot prove a message is unanswered, it
  refuses to draft rather than risk sending twice.
- **Server authority.** The server's reply-state is authoritative; the model
  is told the state and asked not to redraft, but the server enforces the guard
  regardless of model behavior.
- **Defense in depth.** No single signal is complete (`\Answered` is not set
  by every provider; Sent-folder sync is not available on every mailbox). The
  product layers three cheap signals so each catches what the one above
  misses.
- **Surgical fixes.** The validation defect is fixed at its three root causes;
  no relaxation of the strict schema or the two-strike `needs_human_review`
  policy. Safety properties are preserved.

## 5. Goals

### 5.1 Primary goals

- G1: `create_email_reply_draft` produces a persisted draft on well-formed
  model output. The `Generation failed validation twice` error is reserved for
  genuinely malformed output, not for prompt/schema field-name disagreement.
- G2: The system refuses to create a new draft for a message whose
  `replyStatus` is `sent` or `draft_created`, returning a clear structured
  error instead.
- G3: The system detects manual replies via the IMAP `\Answered` flag at sync
  time and refuses to draft against a flagged message.
- G4: A new AI tool lets the model (or the UI) probe whether a message has a
  reply in the Sent folder when `\Answered` is not set, so the model can avoid
  drafting on ambiguity.

### 5.2 Secondary goals

- G5: The `create_email_reply_draft` tool description instructs the model to
  consult `replyStatus` and call the reply-check tool before drafting, so the
  model behaves correctly without relying solely on the server guard.
- G6: Audit rows are written for every refused-draft decision so operators
  can see why a draft was not created.
- G7: The manual-reply detection is cached on the message row so the AI does
  not trigger a Sent-folder round-trip on every check.

## 6. Non-Goals

- Changing the strict generation schema's field set beyond the minimum needed
  to align prompt and schema. The schema remains the authority.
- Relaxing the two-strike `needs_human_review` policy (FR-011 in the
  reliability PRD stays authoritative).
- Detecting manual replies for POP3 mailboxes beyond the Sent-folder search,
  where the Sent folder is not IMAP-synced. This is documented as a known
  limitation.
- Surfacing the new reply-state signals in the audit UI beyond the existing
  audit list/detail pages. UI changes are limited to surfacing the new tool
  and the new refusal reason.
- Automatically reconciling `replyStatus` from `\Answered` retroactively for
  historical rows. Sync-time capture is forward-only; a one-time backfill is
  out of scope.

## 7. Target Users And Jobs

### 7.1 Marketing operator

Wants AI-assisted drafting that does not embarrass them by replying twice to
the same customer. The duplicate-reply defect directly damages their credibility
with the recipient.

### 7.2 Small business owner

Replies from their phone or webmail and expects the AI assistant to notice.
They do not want to have to mark messages as "already handled" manually in two
places.

### 7.3 Support or sales assistant

Needs the AI to produce a usable draft on the first try. The validation
regression makes the tool unreliable, forcing manual fallback.

## 8. User Journeys

### 8.1 Successful draft creation (fixed validation)

The user asks the AI to reply to an inbound message. The AI calls
`create_email_reply_draft`. The model returns JSON with the schema-aligned
field name and a body under the token budget. The system validates on the first
attempt, persists the draft, and returns it for review. The user sees the
draft in the audit list and approves it.

### 8.2 Already-replied in-app

The user previously approved and sent a reply through the app. They ask the AI
to "reply to this email" again. The AI calls `create_email_reply_draft`. The
server sees `replyStatus === "sent"`, refuses, and returns a structured error:
"Message already replied to (replyStatus=sent); no new draft created." The AI
reports this to the user. No duplicate is sent.

### 8.3 Already-replied manually (flag detected at sync)

The user replied from their phone's mail app. The provider set `\Answered` on
the original message. On the next inbox sync, the app persists
`isAnswered = 1`. When the AI later tries to draft, the server refuses with
"Message was already answered in the mailbox." The AI reports this. No
duplicate is sent.

### 8.4 Already-replied manually (flag not set, Sent-folder check)

The user replied from a webmail client whose provider does not set `\Answered`.
`\Answered` is absent. The AI, before drafting, calls `check_email_replied`
(or the server calls it inline). The Sent-folder search finds a reply whose
`In-Reply-To` matches the original Message-ID. The server refuses and surfaces
the same structured error. No duplicate is sent.

### 8.5 Genuinely malformed output still routes to human review

A model return that is genuinely malformed (no JSON object, missing required
fields after correction) still fails validation twice and still routes to
`needs_human_review` with no persisted draft. The safety property is intact.

## 9. Functional Requirements

### FR-025 Prompt-schema field alignment

The reply-generation system prompt must request the exact JSON field names
the strict schema enforces.

Acceptance criteria:

- The prompt's example JSON object uses `intentSuggestion` (not
  `classification`), matching `generatedEmailReplySchema`.
- The prompt lists the valid enum values for `intentSuggestion` verbatim from
  the schema's `CLASSIFICATIONS` constant.
- The correction prompt (`buildCorrectionPrompt`) may carry only validation
  codes; it must not contradict the schema field names.

### FR-026 JSON response mode

The LLM call for draft generation must request JSON-shaped output when the
provider supports it, with the strict local parser remaining authoritative.

Acceptance criteria:

- `callLlmRaw` sets `response_format: { type: "json_object" }` (or the
  equivalent in the chat API request shape).
- When the provider rejects or ignores `response_format`, the strict local
  parser (`parseStrictGeneratedReply`) still validates; no raw model prose is
  persisted as a draft.
- The comment at `EmailReplyGenerationSchema.ts:6-9` (local validation is
  authoritative) is preserved.

### FR-027 Sufficient token budget

The LLM call must allow enough tokens for a maximum-length reply plus its JSON
envelope, so output is not truncated mid-JSON.

Acceptance criteria:

- `max_tokens` is raised from `700` to a value that fits a 400-word body plus
  subject, classification, confidence, and JSON envelope (nominally `1500`).
- The body length cap in the prompt ("under 400 words") is reconciled with the
  token budget so the model cannot be invited to produce more than the budget
  allows.

### FR-028 In-app reply guard in draft generation

`createDraft` must refuse to create a new draft for a message already in a
replied or draft-exists state.

Acceptance criteria:

- After loading the message, `createDraft` checks `message.replyStatus`.
- `replyStatus === "sent"` returns `{ success: false, error: "Message already
  replied to (replyStatus=sent); no new draft created" }` and writes a
  `reply_skipped` audit row.
- `replyStatus === "draft_created"` returns a structured error pointing the
  model to the existing draft rather than creating a second one.
- The guard runs before the policy gate, knowledge retrieval, and the LLM
  call — no model call is spent on an already-replied message.

### FR-029 In-app reply guard in pre-draft policy

The `pre_draft` policy gate must deny messages with a terminal reply status,
as defense in depth behind FR-028.

Acceptance criteria:

- `evaluatePreDraft` reads `message.replyStatus`.
- `replyStatus === "sent"` denies with code `already_replied`.
- The denial is audited through the existing pre-draft audit path.

### FR-030 Persist IMAP `\Answered` flag

The receive client must persist the `\Answered` flag on the received-message
row so downstream guards can consult it.

Acceptance criteria:

- `EmailReceivedMessageEntity` gains an `isAnswered: number` column
  (boolean-as-int, default `0`, mirroring `isUnread`).
- `EmailReceiveSyncService` writes `isAnswered` from
  `ParsedInboundEmail.isAnswered` during upsert.
- The sync upsert is idempotent on the column; re-syncing a message does not
  clobber a newer `replyStatus` set by the send path.
- POP3 sync sets `isAnswered = 0` (POP3 does not expose flags) without error.

### FR-031 Mailbox-flag reply guard

`createDraft` must refuse to create a draft for a message flagged
`\Answered` in the mailbox, even when `replyStatus` is not `sent`.

Acceptance criteria:

- After loading the message, `createDraft` checks `message.isAnswered`.
- `isAnswered === 1` returns `{ success: false, error: "Message was already
  answered in the mailbox" }` and writes a `reply_skipped` audit row.
- The guard runs before the LLM call.

### FR-032 Sent-folder reply detection tool

A new AI tool must probe the mailbox's Sent folder for a reply to a given
inbound message, for the case where `\Answered` is not set.

Acceptance criteria:

- The tool takes a `message_id` and returns `{ replied: boolean,
  matched_message_id: string | null, checked_at: string }`.
- The search matches the original message's RFC `Message-ID` against the
  `In-Reply-To` and `References` headers of messages in the configured Sent
  folder.
- The result is cached on the received-message row
  (`manualReplyDetectedAt: datetime | null`,
  `manualReplyCheckAt: datetime | null`) so repeated checks do not re-scan.
- The tool is AI-gated (AI enable checked first), runs in the main process,
  and performs network I/O only through `ImapEmailReceiveClient`.
- The tool's `requiresConfirmation` is `false` (read-only mailbox probe).

### FR-033 Tool catalog and description updates

The AI tool catalog must tell the model how to avoid duplicate replies.

Acceptance criteria:

- `create_email_reply_draft`'s description states: do not call for a message
  whose `replyStatus` is `sent` or `draft_created`; call `check_email_replied`
  first when unsure.
- `fetch_unread_emails` and `get_email_message` summaries continue to surface
  `replyStatus`; their descriptions note that the model should not draft for
  messages in a replied state.
- `check_email_replied` is registered in `skillsRegistry.ts` with accurate
  parameters and description.

### FR-034 Audit for refused drafts

Every refused-draft decision must be auditable.

Acceptance criteria:

- A refused draft under FR-028, FR-029, or FR-031 writes a `reply_skipped`
  audit row with the refusal reason and the correlation id.
- The existing audit list/detail UI surfaces the refusal reason without code
  changes beyond mapping the new `already_replied` and
  `mailbox_answered` codes to translated strings.

## 10. Data Requirements

### 10.1 Received message extensions

Required attributes (additions to `EmailReceivedMessageEntity`):

- `isAnswered: number` — boolean-as-int, default `0`. Set by sync from the
  IMAP `\Answered` flag.
- `manualReplyDetectedAt: Date | null` — timestamp of the most recent
  Sent-folder search that found a matching reply. Null when never checked or
  when the last check found no reply.
- `manualReplyCheckAt: Date | null` — timestamp of the most recent
  Sent-folder search, regardless of outcome. Used to decide whether to
  re-check on a subsequent `check_email_replied` call.

### 10.2 No new entities

No new top-level entity is introduced. The Sent-folder search is a service
method over `ImapEmailReceiveClient`; its result is cached on the
received-message row per 10.1.

### 10.3 Idempotency and ordering

- `isAnswered` is updated only by sync, never by the send path. The send path
  continues to own `replyStatus`.
- `manualReplyDetectedAt` / `manualReplyCheckAt` are updated only by the
  `check_email_replied` tool path, never by sync.
- A message with `replyStatus === "sent"` is never re-checked for manual
  replies; the in-app state wins.

## 11. Acceptance And Test Plan

### 11.1 Validation fixes (FR-025, FR-026, FR-027)

- Unit: `EmailReplyPromptBuilder.test.ts` asserts the prompt's example JSON
  uses `intentSuggestion` and lists the enum values.
- Unit: `EmailReplyGenerationSchema.test.ts` asserts a model return with
  `intentSuggestion` passes on the first attempt (no correction round).
- Unit: `EmailReplyDraftGeneration.test.ts` asserts a well-formed reply
  produces a persisted draft with `max_tokens` raised and `response_format`
  set.
- Regression: a genuinely malformed return still routes to
  `needs_human_review` after two failures.

### 11.2 In-app reply guard (FR-028, FR-029)

- Unit: `EmailReceiveAiTools.test.ts` asserts `createEmailReplyDraft` on a
  `replyStatus === "sent"` message returns the structured refusal and writes a
  `reply_skipped` audit row, with no LLM call made.
- Unit: same for `replyStatus === "draft_created"`, asserting the existing
  draft is referenced.
- Unit: `EmailReplyPolicyOrchestrator.test.ts` asserts `evaluatePreDraft`
  denies `replyStatus === "sent"` with code `already_replied`.

### 11.3 Mailbox-flag guard (FR-030, FR-031)

- Unit: `EmailReceiveSyncService` test (new) asserts `isAnswered` is
  persisted from `ParsedInboundEmail.isAnswered` on insert and update.
- Unit: `EmailReceiveAiTools.test.ts` asserts `createEmailReplyDraft` on an
  `isAnswered === 1` message returns the mailbox-answered refusal and writes
  a `reply_skipped` audit row, with no LLM call made.
- Unit: POP3 sync sets `isAnswered = 0` without error.

### 11.4 Sent-folder detection tool (FR-032)

- Unit: `EmailReplyDetectionService.test.ts` (new) asserts a Sent-folder
  search with a matching `In-Reply-To` returns `replied: true` and caches
  `manualReplyDetectedAt`.
- Unit: a search with no match returns `replied: false` and caches only
  `manualReplyCheckAt`.
- Unit: the tool is AI-gated (returns the disabled error when AI is off).
- Integration (existing E2E harness): a manual reply seeded in the Sent
  folder blocks `create_email_reply_draft`.

### 11.5 Tool catalog (FR-033)

- Unit: `ToolCatalogService.test.ts` asserts `check_email_replied` appears in
  the catalog with the correct parameter schema.
- Unit: `EmailReceiveAiTools.test.ts` asserts the
  `create_email_reply_draft` description contains the do-not-redraft
  instruction.

### 11.6 Audit (FR-034)

- Unit: every refusal path in 11.2 and 11.3 writes exactly one `reply_skipped`
  audit row with the correct reason and correlation id.

## 12. Risks And Open Questions

- **Provider-specific `\Answered` behavior.** Gmail sets it reliably for IMAP
  and web replies. Some providers do not. The Sent-folder search (FR-032) is
  the backstop; where neither signal is available, the system fails closed
  (no draft) only when the model calls `check_email_replied` and finds a
  match, never by default.
- **Sent folder naming.** Defaults must cover common names (`Sent`,
  `[Gmail]/Sent Mail`, `Sent Items`). A per-service override is desirable but
  not required for v1; the tool can try a short list of common names.
- **Backfill.** Existing rows have `isAnswered = 0` and null
  `manualReplyCheckAt`. The next sync and the next `check_email_replied` call
  populate them. No offline backfill job is in scope.
- **Open question:** should `check_email_replied` run inline inside
  `create_email_reply_draft` automatically when `\Answered` is absent? v1
  leaves it as an explicit AI tool call to keep network I/O opt-in and
  cacheable. Revisit based on observed duplicate rates.
