# AI Email Reply Validation And Duplicate-Reply Guard - Technical Design

## 1. Purpose

This document specifies the implementation for the two defects and one new
capability defined in
`ai-email-reply-validation-and-duplicate-guard-prd.md`:

1. Fix the `create_email_reply_draft` validation regression (field-name
   mismatch, no JSON mode, token-budget truncation).
2. Add server-side guards so an already-replied message cannot be re-drafted
   or re-sent — covering in-app replies and mailbox-`\Answered` replies.
3. Add a `check_email_replied` AI tool that probes the Sent folder for a
   manual reply when `\Answered` is not set.

It is a delta on the existing receive-and-reply architecture; it does not
restate it. See `ai-email-receive-auto-reply-technical-design.md` and
`ai-email-thread-aware-reply-reliability-technical-design.md` for the
foundational layers.

## 2. Current System Summary

### 2.1 Draft generation pipeline

`EmailReplyDraftGenerationService.createDraft`
(`src/service/emailReply/EmailReplyDraftGenerationService.ts:77`) runs:

1. AI-enable gate (`ensureHostedAiEnabled`).
2. Load message (`EmailReceivedMessageModule.read`).
3. Optional model classification refinement.
4. Pre-draft policy gate (`EmailReplyPolicyOrchestrator.evaluate` with
   `stage: "pre_draft"`).
5. Load owner-voice profile + knowledge-library context + conversation context.
6. Build prompt (`buildReplySystemMessage` + `buildReplyUserMessage`).
7. LLM call (`callLlmRaw`) + strict parse (`parseStrictGeneratedReply`); one
   bounded correction round; two failures → `needs_human_review`, no draft.
8. Post-validation (banned phrase, leakage, empty body).
9. Persist draft + materialize revision 1 + write audit rows.

The validation gate is at step 7. The error under fix is at lines 262-274.

### 2.2 Send path

`sendEmailReply` (`src/service/EmailReceiveAiTools.ts:261`) reads the draft,
approves it via `EmailReplyApprovalService.approveDraft`, and calls
`EmailReplyDeliveryService.sendApprovedReply`. On `outcome === "sent"`,
`finalizeSendOutcome` (`src/model/EmailReplyDraft.model.ts:402`) updates the
received-message `replyStatus` to `"sent"` in the same transaction as the
attempt/draft/approval/audit finalize (lines 445-450).

### 2.3 Receive sync path

`EmailReceiveSyncService.syncUnread`
(`src/service/emailReceive/EmailReceiveSyncService.ts`) calls
`ImapEmailReceiveClient.fetchMessages`, which returns `ParsedInboundEmail[]`.
`ParsedInboundEmail.isAnswered` is already declared
(`src/service/emailReceive/EmailReceiveClient.ts:28`) and already parsed from
the `\Answered` flag (`ImapEmailReceiveClient.ts:170`). The sync upserts
parsed messages into `EmailReceivedMessageEntity`, which has no `isAnswered`
column today — the value is dropped.

### 2.4 Policy gate

`EmailReplyPolicyOrchestrator.evaluatePreDraft`
(`src/service/emailReply/EmailReplyPolicyOrchestrator.ts:56`) reads
classification, confidence, and the effective rule. It does not read
`replyStatus`. `evaluatePreSend` (line 80) does enforce the draft state
machine (terminal states denied) but that is draft-state, not message-state.

## 3. Target Architecture

No new top-level component. The changes are additive:

- **Entity extension:** `EmailReceivedMessageEntity` gains `isAnswered`,
  `manualReplyDetectedAt`, `manualReplyCheckAt`.
- **Sync extension:** `EmailReceiveSyncService` persists `isAnswered`.
- **Generation service guard:** `createDraft` checks `replyStatus` and
  `isAnswered` before any model call.
- **Policy guard:** `evaluatePreDraft` denies `replyStatus === "sent"`.
- **New service:** `EmailReplyDetectionService` performs the Sent-folder
  search and caches the result.
- **New AI tool:** `check_email_replied` wraps the detection service.
- **Prompt + call-shape fixes:** prompt field name, `response_format`, token
  budget.

### 3.1 Layering and ownership

```
AI tool (EmailReceiveAiTools.ts)
   │
   ├── create_email_reply_draft
   │       └── EmailReplyDraftGenerationService.createDraft
   │             ├── GUARD: replyStatus / isAnswered  (NEW)
   │             ├── EmailReplyPolicyOrchestrator.evaluatePreDraft
   │             │     └── GUARD: replyStatus === "sent"  (NEW)
   │             ├── buildReplySystemMessage  (FIX: field name)
   │             ├── callLlmRaw  (FIX: response_format, max_tokens)
   │             └── parseStrictGeneratedReply  (unchanged)
   │
   └── check_email_replied  (NEW)
           └── EmailReplyDetectionService.checkReplied
                 ├── ImapEmailReceiveClient.searchSentForReply  (NEW method)
                 └── cache on EmailReceivedMessageEntity
```

All guards run in the main process. Workers never touch the database
(existing mandate). The new Sent-folder search is network I/O only in
`ImapEmailReceiveClient`; the detection service coordinates caching.

## 4. Dependencies

No new runtime dependencies.

- `imapflow` — already used by `ImapEmailReceiveClient`; supports
  `mailboxOpen`, `search`, `fetchOne` with header source. Used for the
  Sent-folder search.
- `zod/v4` — already used for the generation schema and tool input schemas.
- No new MCP or AI-provider dependencies. `response_format` is an
  OpenAI-compatible field forwarded by the existing hosted path.

## 5. Data Model

### 5.1 Extend `EmailReceivedMessageEntity`

File: `src/entity/EmailReceivedMessage.entity.ts`

Add three columns:

```typescript
  // ---- Duplicate-reply detection (validation-and-duplicate-guard PRD) ----

  /** Boolean-as-int mirror of the IMAP \Answered system flag. Set by sync
   *  only; never written by the send path. POP3 rows are 0 (no flags). */
  @Column("integer", { default: 0 })
  isAnswered: number;

  /** Most recent Sent-folder search timestamp, regardless of outcome.
   *  Set only by the check_email_replied tool path. Null until first check. */
  @Column("datetime", { nullable: true })
  manualReplyCheckAt: Date | null;

  /** Timestamp of the most recent Sent-folder search that FOUND a matching
   *  reply. Null when never checked or when the last check found no reply. */
  @Column("datetime", { nullable: true })
  manualReplyDetectedAt: Date | null;
```

No index is required for these columns; lookups are by primary key after the
message is loaded. `isAnswered` mirrors the `isUnread` storage convention
(boolean-as-int) for consistency with the existing row.

### 5.2 Update SQL init

The migration adds the three columns with defaults. Existing rows get
`isAnswered = 0` and null timestamps. The schema sync (TypeORM `synchronize`
in dev, explicit migration in `yarn init`) handles this; no data backfill is
performed.

### 5.3 No other entity changes

`EmailReplyDraftEntity`, `EmailReplyAuditLogEntity`, and
`EmailAutoReplyAuditLogEntity` are unchanged. The `reply_skipped` audit
action already exists in the `EmailReplyAuditAction` union
(`src/entityTypes/emailReceiveTypes.ts:157`). The new refusal codes
(`already_replied`, `mailbox_answered`) reuse the existing `reason` text
field on the audit row; no schema change to the audit entity.

## 6. Models And Modules

### 6.1 Model changes

`src/model/EmailReceivedMessage.model.ts`:

- `upsertMessage` (or the existing insert/update path) writes `isAnswered`
  from the parsed input. The field is read-only here for the sync path.
- New method `setManualReplyCheck(messageId, { detected }): Promise<void>`
  writes `manualReplyCheckAt = now` and, when `detected`, also
  `manualReplyDetectedAt = now`. Uses `manager.update` directly; no
  transaction needed (single-row update).

### 6.2 Module changes

`src/modules/EmailReceivedMessageModule.ts`:

- `upsertFromParsed` (or the existing sync entry) forwards `isAnswered`.
- New method `setManualReplyCheck(messageId, detected)` delegates to the
  model.

No changes to `EmailReplyDraftModule` or `EmailReplyDraftModel`; the send
path's `finalizeSendOutcome` already sets `replyStatus`.

## 7. Receive Service Changes

### 7.1 Sync path

`EmailReceiveSyncService.syncUnread` already calls
`client.fetchMessages(...)` and maps `ParsedInboundEmail[]` to entity rows.
The only change is forwarding `isAnswered`:

```typescript
// In the upsert mapping (existing code, add one field):
entity.isAnswered = parsed.isAnswered ? 1 : 0;
```

The upsert must not overwrite `replyStatus` or `processedAt` (those are owned
by the send path). The existing upsert already preserves `replyStatus` on
re-sync; `isAnswered` follows the same pattern — it is refreshed from the
server each sync, which is correct (the flag can be set after the initial
fetch if the user replies between syncs).

### 7.2 POP3

`Pop3EmailReceiveClient.fetchMessages` returns `ParsedInboundEmail` with
`isAnswered: false` (POP3 does not expose system flags). The sync upsert
writes `0`. No special-casing; the field is simply always false for POP3
rows. Documented as a known limitation in the PRD.

## 8. Reply Generation Changes

### 8.1 Prompt field-name fix (FR-025)

`src/service/emailReply/EmailReplyPromptBuilder.ts:88` — change the example
JSON and field list to use `intentSuggestion`:

```typescript
// Before:
'Reply with valid JSON only: {"subject": string, "bodyText": string, "classification": string, "confidence": number}.'

// After:
'Reply with valid JSON only: {"subject": string, "bodyText": string, "intentSuggestion": string, "confidence": number}.',
```

Line 91 already lists the enum values for `classification`; relabel that line
to `intentSuggestion` and keep the same value list (it matches the schema's
`CLASSIFICATIONS` constant). No change to the enum values themselves.

### 8.2 JSON response mode (FR-026)

`src/api/aiChatApi.ts`:

- Extend `OpenAIChatCompletionRequest` with
  `response_format?: { type: "json_object" | "text" }`.
- In `openAIChatCompletionHosted`, forward `response_format` when set:
  ```typescript
  if (request.response_format) {
    data.response_format = request.response_format;
  }
  ```
  The local-client path (`localClient(...).complete`) should also forward it;
  if a local provider rejects the field, the existing retry/error path
  applies.

`src/service/emailReply/EmailReplyDraftGenerationService.ts:431-442`
(`callLlmRaw`):

```typescript
const resp = await api.openAIChatCompletion({
  messages: [systemMsg, userMsg],
  temperature: 0.4,
  max_tokens: 1500,
  response_format: { type: "json_object" },
});
```

The strict local parser (`parseStrictGeneratedReply`) stays authoritative.
`response_format` reduces `no_json_object` failures; it does not replace
validation (the comment at `EmailReplyGenerationSchema.ts:6-9` holds).

### 8.3 Token budget (FR-027)

Raise `max_tokens` from `700` to `1500` in the same call (shown above). 1500
tokens comfortably fits a 400-word body (~500-600 tokens) plus subject,
classification, confidence, and the JSON envelope. The prompt's "under 400
words" cap (line 90) is retained; it is below the budget.

### 8.4 In-app reply guard (FR-028)

`EmailReplyDraftGenerationService.createDraft`, after loading the message
(after line 92), before the classification refinement:

```typescript
// 2c. Duplicate-reply guard (validation-and-duplicate-guard PRD FR-028/FR-031).
//     Refuse before any model call; write a reply_skipped audit row.
if (message.replyStatus === "sent") {
  await this.recordReplySkipped(
    message.emailServiceId,
    message.id,
    "already_replied",
    "Message already replied to (replyStatus=sent); no new draft created"
  );
  return {
    success: false,
    error:
      "Message already replied to (replyStatus=sent); no new draft created",
  };
}
if (message.replyStatus === "draft_created") {
  // Surface the existing draft rather than creating a second one.
  const existing = await this.draftModule.listByMessageId(message.id);
  if (existing && existing.length > 0) {
    return {
      success: false,
      error: `A draft already exists for this message (draft id ${existing[0].id}); edit or approve it instead of creating a new one`,
    };
  }
  // Status says draft_created but no draft row exists (data drift); fall
  // through and let generation proceed.
}
if (message.isAnswered === 1) {
  await this.recordReplySkipped(
    message.emailServiceId,
    message.id,
    "mailbox_answered",
    "Message was already answered in the mailbox"
  );
  return {
    success: false,
    error: "Message was already answered in the mailbox",
  };
}
```

`recordReplySkipped` is a new private method that writes an
`EmailReplyAuditLogEntity` with `action: "reply_skipped"`, `actor: "ai"`,
`reason: "[<code>] <message>"`, and the correlation id. It is a thin variant
of the existing `recordFailure` (line 509) using the `reply_skipped` action
instead of `send_failed`.

`listByMessageId` is a new `EmailReplyDraftModule` method that returns drafts
by `messageId` (the `messageId` index already exists on the entity,
`EmailReplyDraft.entity.ts:14`). It is a simple repository find.

### 8.5 Policy guard (FR-029)

`EmailReplyPolicyOrchestrator.evaluatePreDraft`, at the top of the method
(after line 62, before the rule lookup), add:

```typescript
if (message.replyStatus === "sent") {
  return deny("already_replied", "Message already has a sent reply");
}
```

`message.replyStatus` must be added to the inline message type signature on
`evaluatePreDraft` (it currently omits it). The `deny` helper and the
audit-on-deny path already exist upstream (`createDraft` lines 155-177 write
the pre-draft audit from `policyDecision`), so the `already_replied` code
flows through to the audit row without further changes.

This is defense in depth behind FR-028. If `createDraft` is called from
another path that bypasses the in-method guard, the policy gate still blocks.

## 9. Sent-Folder Reply Detection

### 9.1 New service

`src/service/emailReply/EmailReplyDetectionService.ts`:

```typescript
export interface CheckRepliedResult {
  replied: boolean;
  matchedMessageId: string | null;
  checkedAt: string;
  /** "flag" when the \Answered guard already settled it; "sent_search" when
   *  the Sent-folder search ran. */
  source: "flag" | "sent_search";
}

export class EmailReplyDetectionService {
  async checkReplied(messageId: number): Promise<CheckRepliedResult> {
    // 1. AI-enable gate (CLAUDE.md mandate for AI tools).
    if (!(await ensureHostedAiEnabled())) {
      throw new Error("AI email reply detection is disabled for this user.");
    }

    // 2. Load message + email service config.
    const messageModule = new EmailReceivedMessageModule();
    await messageModule.ensureConnection();
    const message = await messageModule.read(messageId);
    if (!message) throw new Error("Message not found");
    if (!message.messageId) {
      // No RFC Message-ID to match against; cannot search Sent folder.
      return { replied: false, matchedMessageId: null, checkedAt: new Date().toISOString(), source: "sent_search" };
    }
    if (message.replyStatus === "sent" || message.isAnswered === 1) {
      return { replied: true, matchedMessageId: null, checkedAt: new Date().toISOString(), source: "flag" };
    }

    // 3. Load email service connection config (main-process only).
    const serviceModule = new EmailServiceModule();
    await serviceModule.ensureConnection();
    const service = await serviceModule.getEmailService(message.emailServiceId);
    const connConfig = buildReceiveConnectionConfig(service); // existing helper
    if (!connConfig) throw new Error("Email service receive config unavailable");

    // 4. Search the Sent folder.
    const client = new ImapEmailReceiveClient();
    const matched = await client.searchSentForReply(connConfig, message.messageId);

    // 5. Cache the result on the message row.
    await messageModule.setManualReplyCheck(message.id, matched !== null);

    return {
      replied: matched !== null,
      matchedMessageId: matched,
      checkedAt: new Date().toISOString(),
      source: "sent_search",
    };
  }
}
```

### 9.2 IMAP Sent-folder search

`src/service/emailReceive/ImapEmailReceiveClient.ts` — add a method:

```typescript
/** Search the mailbox's Sent folder for a reply to the given RFC Message-ID.
 *  Returns the matched reply's Message-ID, or null if no match. */
async searchSentForReply(
  config: EmailReceiveConnectionConfig,
  originalMessageId: string
): Promise<string | null> {
  const sentFolders = candidateSentFolders(config.folder); // see 9.3
  let client = this.createClient(config);
  try {
    await client.connect();
    for (const folder of sentFolders) {
      try {
        await client.mailboxOpen(folder);
      } catch {
        continue; // folder not present on this provider
      }
      // Search headers for In-Reply-To / References containing the original
      // Message-ID. ImapFlow supports a header search criterion.
      const uids = await client.search({ header: ["in-reply-to", originalMessageId] }, { uid: true });
      if (uids.length === 0) {
        // also try References
        const uids2 = await client.search({ header: ["references", originalMessageId] }, { uid: true });
        if (uids2.length === 0) continue;
      }
      // Fetch one matched message's Message-ID header.
      const firstUid = (uids[0] ?? (await client.search({ header: ["references", originalMessageId] }, { uid: true }))[0]);
      if (!firstUid) continue;
      const msg = await client.fetchOne(firstUid, { headers: true, envelope: true }, { uid: true });
      return extractMessageIdHeader(msg);
    }
    return null;
  } finally {
    await closeClient(client);
  }
}
```

The exact ImapFlow search-criteria shape should be verified against the
installed version; the existing `fetchFromConnectedClient` (line 103) already
uses `client.search` and `client.fetchOne` with `{ source: true, flags: true,
internalDate: true }`, so the patterns are established. For the header search,
ImapFlow accepts a `search` object with `header: [name, value]`.

### 9.3 Candidate Sent folders

```typescript
function candidateSentFolders(inboxFolder: string): string[] {
  // Common Sent-folder names. Ordered by likelihood; first match wins.
  const defaults = ["Sent", "[Gmail]/Sent Mail", "Sent Items", "INBOX/Sent"];
  // De-duplicate and put an inbox-derived guess first if it looks like a
  // Gmail-style "[Gmail]/..." prefix.
  return Array.from(new Set(defaults));
}
```

A per-service `sentFolder` override is desirable for v2 but not required for
v1. The candidate list covers the common providers (Gmail, Outlook, generic
cPanel, Fastmail). The `for` loop tries each and `continue`s on
mailbox-open failure, so a provider with a non-standard name simply yields no
match (the system fails closed only when the AI explicitly asks; the default
draft path does not call this).

### 9.4 AI tool wrapper

`src/service/EmailReceiveAiTools.ts` — add:

```typescript
// ---- check_email_replied ----

export async function checkEmailReplied(args: unknown): Promise<
  EmailReceiveAiToolResult<{
    message_id: number;
    replied: boolean;
    matched_message_id: string | null;
    checked_at: string;
    source: "flag" | "sent_search";
  }>
> {
  try {
    const input = checkEmailRepliedSchema.parse(args);
    const service = new EmailReplyDetectionService();
    const result = await service.checkReplied(input.message_id);
    return {
      success: true,
      message_id: input.message_id,
      replied: result.replied,
      matched_message_id: result.matchedMessageId,
      checked_at: result.checkedAt,
      source: result.source,
    };
  } catch (error) {
    return error instanceof ZodError ? validationFailure(error) : failure(error);
  }
}
```

`checkEmailRepliedSchema` is added to
`src/entityTypes/emailReceiveAiTypes.ts`:

```typescript
export const checkEmailRepliedSchema = z.object({
  message_id: z.number().int().positive(),
});
```

## 10. AI Tool Catalog Changes

### 10.1 New tool entry

`src/config/skillsRegistry.ts` — add `check_email_replied` alongside the
existing email-receive tools:

```javascript
{
  name: "check_email_replied",
  description:
    "Check whether an inbound message has already been replied to — in-app, " +
    "via the mailbox \\Answered flag, or by a reply found in the Sent folder. " +
    "Call this BEFORE create_email_reply_draft when replyStatus is not 'sent' " +
    "and you are unsure if the user already answered. Read-only; does not " +
    "send or modify anything. AI must be enabled.",
  parameters: {
    type: "object",
    properties: {
      message_id: {
        type: "number",
        description: "Stored received message id to check.",
      },
    },
    required: ["message_id"],
  },
  tier: "main",
  requiresConfirmation: false,
  permissionCategory: "automation",
  source: "built-in",
  execute: async (args) => {
    const result = await checkEmailReplied(args);
    return result;
  },
}
```

Import `checkEmailReplied` from `@/service/EmailReceiveAiTools` at the top of
`skillsRegistry.ts`.

### 10.2 Update `create_email_reply_draft` description

`src/config/skillsRegistry.ts:2423` — extend the description:

```javascript
description:
  "Create a knowledge-grounded reply draft for one inbound message. Searches the " +
  "knowledge library by default, then writes the draft in the mailbox owner's voice. " +
  "Does NOT send the reply and does NOT mention AI, retrieval, or confidence in the body. " +
  "Do NOT call this if the message replyStatus is 'sent' or 'draft_created' — the server " +
  "will refuse and no draft will be created. When unsure whether the user already answered " +
  "manually, call check_email_replied first. AI must be enabled. Returns the persisted " +
  "draft for human review.",
```

### 10.3 IPC wiring

`src/main-process/communication/emailReceive-ipc.ts` — register the new
channel `EMAIL_REPLY_CHECK_REPLIED`. Add the channel constant to
`src/config/channellist.ts`:

```typescript
export const EMAIL_REPLY_CHECK_REPLIED = "email:reply:check:replied";
```

Wire it in the IPC handler alongside the existing reply handlers, validating
input with `checkEmailRepliedSchema` and calling `checkEmailReplied`. Add it
to `src/preload.ts` and `src/views/api/emailreply.ts` for UI access. The
handler is AI-gated (the service checks AI enable internally; the handler
also checks `USER_AI_ENABLED` first per the CLAUDE.md mandate).

## 11. Validation Logic (Unchanged)

`parseStrictGeneratedReply` and `generatedEmailReplySchema` are unchanged.
The two-strike `needs_human_review` policy (FR-011 in the reliability PRD)
is preserved. The fixes make the first attempt succeed on well-formed
output; genuinely malformed output still routes to human review after the
correction round. No safety property is relaxed.

## 12. Audit

### 12.1 Refused-draft audit

`recordReplySkipped` (new private method on
`EmailReplyDraftGenerationService`) writes:

```typescript
const log = new EmailReplyAuditLogEntity();
log.emailServiceId = emailServiceId;
log.messageId = messageId;
log.action = "reply_skipped";
log.actor = "ai";
log.reason = `[${code}] ${message}`; // e.g. "[already_replied] Message already..."
log.metadataJson = JSON.stringify({ correlationId: correlationIdForMessage(messageId) });
await this.replyAuditModule.create(log);
```

The `reply_skipped` action already exists in the union
(`src/entityTypes/emailReceiveTypes.ts:157`), so no type change is needed.
The audit list/detail UI already renders `reply_skipped` (it is in the
existing action set); the new `already_replied` and `mailbox_answered`
codes appear inside the `reason` text and need no separate mapping. If the UI
should localize them, the i18n patch script
(`scripts/i18n-patch-email-receive.cjs`) can be extended in a follow-up; v1
surfaces the English reason string.

### 12.2 Policy denial audit

`createDraft` already writes a pre-draft audit row when
`!policyDecision.allowed` (lines 155-177). The `already_replied` code from
FR-029 flows through this path unchanged.

## 13. Test Plan

### 13.1 Validation fixes

- `test/vitest/utilitycode/EmailReplyPromptBuilder.test.ts`: assert the
  system prompt contains `intentSuggestion` in the example JSON and that
  `classification` is no longer the example field name.
- `test/vitest/utilitycode/EmailReplyGenerationSchema.test.ts`: assert a
  well-formed `{ subject, bodyText, intentSuggestion, confidence }` object
  parses successfully on the first attempt.
- `test/vitest/main/EmailReplyDraftGeneration.test.ts`: mock the LLM to
  return a well-formed object; assert `createDraft` persists a draft with
  `max_tokens: 1500` and `response_format: { type: "json_object" }` on the
  call. Assert a genuinely malformed return (no JSON) still routes to
  `needs_human_review` after two failures.

### 13.2 In-app reply guard

- `test/vitest/main/EmailReceiveAiTools.test.ts`: seed a message with
  `replyStatus: "sent"`; call `createEmailReplyDraft`; assert it returns the
  structured refusal, writes a `reply_skipped` audit row, and makes zero
  LLM calls (mock the chat API and assert it is not called).
- Same for `replyStatus: "draft_created"` with an existing draft row; assert
  the existing draft id is referenced.
- Same for `isAnswered: 1` with `replyStatus: "not_started"`; assert the
  mailbox-answered refusal.
- `test/vitest/utilitycode/EmailReplyPolicyOrchestrator.test.ts`: seed a
  message with `replyStatus: "sent"`; assert `evaluatePreDraft` returns
  `code: "already_replied"`.

### 13.3 Sync persistence

- `test/vitest/main/EmailReceiveSyncService.test.ts` (new or extended): mock
  the IMAP client to return a `ParsedInboundEmail` with `isAnswered: true`;
  assert the upserted row has `isAnswered: 1`. Re-sync with `isAnswered:
  false` (flag cleared); assert the row updates to `0` without touching
  `replyStatus`.
- POP3 path: assert `isAnswered` is `0` on the upserted row.

### 13.4 Sent-folder detection

- `test/vitest/main/EmailReplyDetectionService.test.ts` (new): mock
  `ImapEmailReceiveClient.searchSentForReply` to return a matched Message-ID;
  assert `checkReplied` returns `replied: true`, caches
  `manualReplyDetectedAt` and `manualReplyCheckAt` on the message row.
- Mock returns null; assert `replied: false`, only `manualReplyCheckAt` set.
- Assert the AI-enable gate throws when AI is disabled.
- Assert a message with `replyStatus: "sent"` short-circuits to
  `replied: true, source: "flag"` without a Sent-folder round-trip.

### 13.5 Tool catalog and IPC

- `test/vitest/main/service/ToolCatalogService.test.ts`: assert
  `check_email_replied` is in the catalog with the correct parameter schema.
- `test/vitest/main/EmailReceiveAiTools.test.ts`: assert the
  `create_email_reply_draft` tool description contains the do-not-redraft
  instruction.

### 13.6 Type-check gate

All new and changed files must pass `yarn tsc` / `npx tsc --noEmit` clean
(the vitest `globalSetup` runs it). No `as any` casts on untrusted input;
`checkEmailRepliedSchema.parse(args)` is the boundary.

## 14. Rollout

- The entity change is additive (new columns with defaults). The TypeORM
  schema sync adds them on next app start; `yarn init` is not required for
  existing installs in dev, but the release migration includes the columns.
- The prompt and call-shape fixes take effect on the next draft generation;
  no migration of existing drafts is needed.
- The new `check_email_replied` tool appears in the AI tool catalog on next
  app start. The model can call it immediately; no user configuration is
  required.
- The `isAnswered` sync takes effect on the next inbox sync per service.
  Existing rows remain `0` until the next sync for that mailbox.

## 15. Out Of Scope

- Per-service Sent-folder name override (v2; the candidate list covers v1).
- Retroactive backfill of `isAnswered` for historical rows (next sync
  populates forward-only).
- Inline auto-call of `check_email_replied` inside `create_email_reply_draft`
  (v1 leaves it as an explicit AI tool call to keep network I/O opt-in).
- Localized UI strings for the new refusal codes (v1 surfaces the English
  reason; i18n patch is a follow-up).
