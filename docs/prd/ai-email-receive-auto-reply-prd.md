# AI Email Receive And Auto-Reply - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-07-05
- **Owner**: Engineering Team
- **Related docs**:
  - `docs/skills/PRD_AI_Skills_System.md`
  - `docs/ai-chat-tool-approval-modes-prd.md`
  - `docs/contact-profile-ai-enrichment-prd.md`
  - `docs/ai-email-template-creation-advice.md`
  - `docs/ai-email-template-tech-stack-architecture.md`

## 1. Executive Summary

AiFetchly can already use AI tools to find customer information, generate email content, and start outbound email tasks. The missing capability is inbound email handling: the assistant should be able to read received emails, understand intent, draft replies, and eventually auto-reply when rules allow it.

This feature adds first-class inbound email infrastructure and built-in AI tools for email receive and reply workflows. The recommended first release is assisted reply, not fully autonomous auto-reply. The user connects an inbox, the app fetches unread messages, the LLM drafts a response, and the user approves before sending. After the assisted flow is stable, the product can add rule-based auto-reply with strict limits, thread tracking, loop prevention, and audit logs.

The feature should be built as core product functionality through the existing built-in skill registry, not as an imported third-party skill. It needs access to private mailbox credentials, message storage, audit records, send confirmation, and AI permission policy. Those are main-process responsibilities in AiFetchly's architecture.

## 2. Background And Current State

### 2.1 Existing outbound email support

AiFetchly already has outbound email marketing concepts:

- `EmailServiceEntity` stores SMTP sender configuration.
- `EmailService` uses `nodemailer` to send messages through SMTP.
- `EmailMarketingAiTools` exposes AI-facing helpers for templates, filters, services, search tasks, recipient resolution, and bulk send task creation.
- `SkillRegistry` exposes built-in email tools:
  - `list_email_templates`
  - `list_email_filters`
  - `list_email_services`
  - `get_email_service_config`
  - `list_email_search_tasks`
  - `get_email_search_task_emails`
  - `start_bulk_email_send_task`

The outbound task tool already requires confirmation before sending. That safety model should be reused for reply sending.

### 2.2 Existing AI tool architecture

AiFetchly has a built-in skill registry and execution path:

```text
LLM tool call
  -> SkillRegistry definition
  -> SkillExecutor validation and permission checks
  -> service/module method
  -> Model layer for database work
  -> result returned to LLM
```

This feature should follow the same shape. Inbound email tools should be built-in skills with typed parameters and explicit permission categories.

### 2.3 Missing capability

The app does not yet have:

- Inbound mailbox account configuration.
- IMAP or provider API receive support.
- Stored received email messages and thread state.
- AI tools for reading inbox messages.
- Reply draft records.
- Reply send audit logs tied to inbound messages.
- Auto-reply rules and safety policy.
- UI for reviewing unread emails, drafts, and auto-reply decisions.

## 3. Problem Statement

Marketing users receive replies from prospects, customers, partners, and bounced or automated systems. Today AiFetchly helps initiate outbound contact, but it cannot close the loop by reading inbound replies and helping the user respond.

Without receive and reply support:

- Users must leave AiFetchly to check inboxes.
- The LLM cannot reason over customer replies.
- Follow-up responses are manual and inconsistent.
- Campaign state is disconnected from real prospect responses.
- Auto-reply workflows cannot be safely implemented because there is no message, thread, or audit foundation.

The product needs a controlled inbound email loop:

```text
Receive email
  -> classify intent
  -> summarize message
  -> draft reply
  -> approve or auto-send by policy
  -> record outcome
```

## 4. Goals

1. Let users connect inbound email mailboxes for receiving messages.
2. Fetch unread or recent inbox messages through a controlled main-process path.
3. Store normalized email message metadata and body content locally.
4. Expose built-in AI tools for listing inboxes, fetching unread messages, reading message details, drafting replies, and sending replies.
5. Require user confirmation before any reply is sent in the first release.
6. Preserve clear separation between inbound accounts and outbound SMTP services.
7. Link inbound mailbox accounts to outbound email services for reply sending.
8. Prevent direct database access from worker processes.
9. Keep AI feature IPC handlers gated by `USER_AI_ENABLED`.
10. Add audit logs for message reads, draft generation, reply sends, skipped auto-replies, and policy blocks.
11. Provide a safe path to future rule-based auto-reply.
12. Support all required UI translations when UI is added.

## 5. Non-Goals

1. No fully autonomous auto-send in the MVP.
2. No replacement of existing bulk email send tasks.
3. No direct database access from IMAP workers or polling workers.
4. No renderer access to mailbox credentials or raw provider tokens.
5. No broad mailbox indexing in the first release. Fetch only selected folders, unread messages, or bounded recent windows.
6. No CRM-grade sales pipeline redesign in this feature.
7. No attachment processing in the MVP unless required for message display safety.
8. No external email gateway dependency as a required part of MVP.
9. No imported third-party skill as the core implementation path.
10. No silent reply sending without audit trail and policy evaluation.

## 6. Target Users

### 6.1 Marketing Operator

Runs campaigns and wants AiFetchly to help answer prospect replies quickly.

### 6.2 Small Business Owner

Uses one mailbox for outreach and customer follow-up. Wants draft replies that can be reviewed before sending.

### 6.3 Sales Assistant User

Needs to triage inbound messages by intent: interested, not interested, unsubscribe, bounce, support request, or needs human review.

### 6.4 Power User

Wants rule-based auto-reply after trust is established, with strict limits and logs.

### 6.5 Security-Conscious User

Wants clear control over which inboxes the AI can read, which replies it can send, and what was sent.

## 7. Product Approach

### 7.1 Recommended implementation strategy

Build this as a core built-in email receive and reply feature:

- New inbound email modules, models, entities, and services.
- New built-in AI tools registered in `SkillRegistry`.
- New UI pages or tabs for inbox accounts, received messages, reply drafts, and automation settings.
- Reuse existing outbound email service for sending replies where possible.

Do not implement the main capability as an imported external skill. Imported skills are useful for optional workflows, but inbound mail needs first-party security, data storage, permissions, and audit behavior.

### 7.2 Phased release model

| Phase | Name | Description |
| --- | --- | --- |
| Phase 1 | Assisted Receive And Draft | Connect inbox, fetch messages, summarize, draft replies, send only after user approval. |
| Phase 2 | Reply Workflow Integration | Link replies to outbound service, store thread state, show message history, add draft editing UI. |
| Phase 3 | Rule-Based Auto-Reply | Enable auto-send only for configured rules with limits, confidence thresholds, and loop prevention. |
| Phase 4 | Provider Enhancements | Add OAuth/provider-specific APIs, webhook-like sync, better folder support, and optional attachment handling. |

## 8. User Experience Requirements

### 8.1 Inbox account setup

Add an inbox account setup surface under email service, email marketing, or AI tools settings.

Required fields for IMAP MVP:

- Display name.
- Email address.
- IMAP host.
- IMAP port.
- TLS/SSL enabled.
- Username.
- Password or app password.
- Folder to monitor, default `INBOX`.
- Linked outbound email service ID for replies.
- Status enabled or disabled.

Recommended optional fields:

- Fetch unread only.
- Maximum messages per sync.
- Sync lookback window.
- Mark as read after processing.
- Auto-create drafts for unread messages.

User-facing validation:

- Required fields must be validated before save.
- Email address format must be validated.
- Connection test should be available before enabling.
- Password must never be shown after save.
- Linked outbound service must match or clearly warn if sender address differs.

### 8.2 Inbox message list

Provide a message list view with:

- Inbox account.
- Sender.
- Subject.
- Received time.
- Read/unread state.
- AI classification.
- Reply status.
- Last action.

Recommended filters:

- Unread.
- Needs reply.
- Draft created.
- Sent.
- Skipped.
- Blocked.
- Human review.

### 8.3 Message detail and AI draft

The message detail view should show:

- Sanitized message body.
- Sender and reply-to address.
- Subject.
- Thread identifiers if available.
- AI summary.
- AI classification.
- Suggested reply draft.
- Buttons:
  - Generate draft.
  - Regenerate draft.
  - Edit draft.
  - Send reply.
  - Mark processed.
  - Skip.

Sending a reply in Phase 1 must require explicit user action.

### 8.4 AI chat tool experience

The LLM should be able to use tools in a safe sequence:

```text
list_email_inboxes
  -> fetch_unread_emails
  -> get_email_message
  -> create_email_reply_draft
  -> send_email_reply
```

The chat should clearly show when the assistant:

- Reads inbox metadata.
- Reads message body.
- Creates a draft.
- Waits for confirmation before sending.
- Sends a reply.
- Skips a message because policy blocks it.

### 8.5 Auto-reply settings

Auto-reply settings should be disabled until the assisted reply path is working.

When enabled in a later phase, settings should include:

- Enable auto-reply for this inbox.
- Allowed classifications.
- Blocked sender/domain patterns.
- Daily send limit.
- Per-thread reply limit.
- Confidence threshold.
- Quiet hours.
- Require draft approval below confidence threshold.
- Never auto-reply to automated messages.

## 9. AI Tool Requirements

### 9.1 Tool: `list_email_inboxes`

Purpose: let the LLM see which inboxes are available without exposing secrets.

Parameters:

```json
{
  "page": 0,
  "size": 20,
  "search": "optional text"
}
```

Returns:

```typescript
interface AiEmailInboxSummary {
  id: number;
  name: string;
  emailAddress: string;
  host: string;
  folder: string;
  status: number;
  linkedEmailServiceId: number | null;
  lastSyncAt: string | null;
}
```

Permissions:

- `permissionCategory: "automation"`
- `requiresConfirmation: false`
- Does not expose passwords, tokens, or raw connection strings.

### 9.2 Tool: `fetch_unread_emails`

Purpose: fetch a bounded set of unread or recent messages from an inbox.

Parameters:

```json
{
  "inbox_id": 1,
  "folder": "INBOX",
  "limit": 10,
  "unread_only": true,
  "since": "2026-07-01T00:00:00.000Z"
}
```

Rules:

- `limit` must be capped, recommended max 50.
- Default `unread_only` should be true.
- Fetching should go through a main-process module or worker-to-main bridge.
- Worker processes may fetch/parse messages but must send results to main process for storage.

Returns message summaries only:

```typescript
interface AiEmailMessageSummary {
  id: number;
  inboxId: number;
  providerUid: string;
  messageId: string | null;
  threadKey: string | null;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  receivedAt: string;
  isUnread: boolean;
  classification: EmailMessageClassification | null;
  replyStatus: EmailReplyStatus;
}
```

Permissions:

- `permissionCategory: "automation"`
- Reading private mail should require mailbox permission in the permission service.
- The first mailbox read in a conversation should be visible in the chat tool UI.

### 9.3 Tool: `get_email_message`

Purpose: let the LLM inspect one stored message in detail.

Parameters:

```json
{
  "message_id": 123,
  "include_body": true
}
```

Rules:

- Return sanitized body text and sanitized HTML only if needed.
- Strip scripts, remote tracking pixels, and unsafe HTML.
- Redact obvious secrets from the body before returning to the LLM if redaction rules are available.
- Do not return attachments in MVP.

### 9.4 Tool: `create_email_reply_draft`

Purpose: create a reply draft for one inbound message.

Parameters:

```json
{
  "message_id": 123,
  "tone": "professional",
  "goal": "answer the prospect and ask for a meeting",
  "extra_instructions": "Keep it under 120 words."
}
```

Rules:

- Must create a persisted draft.
- Must not send.
- Must include the original message context, user instructions, and any selected template guidance.
- Must run only when AI is enabled.
- Must record prompt version or generation metadata where practical.

Returns:

```typescript
interface AiEmailReplyDraftResult {
  draftId: number;
  messageId: number;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  classification: EmailMessageClassification;
  confidence: number | null;
  warnings: string[];
}
```

### 9.5 Tool: `send_email_reply`

Purpose: send a persisted draft as a reply.

Parameters:

```json
{
  "draft_id": 456,
  "email_service_id": 7
}
```

Rules:

- Must require confirmation in Phase 1.
- Must verify the draft exists and belongs to a received message.
- Must verify the outbound service exists and is active.
- Must preserve reply headers when possible:
  - `In-Reply-To`
  - `References`
  - subject prefix rules
- Must update draft and message reply status after send.
- Must write a send audit record.

Permissions:

- `permissionCategory: "automation"`
- `requiresConfirmation: true`

### 9.6 Tool: `mark_email_processed`

Purpose: let the assistant mark a message as handled without replying.

Parameters:

```json
{
  "message_id": 123,
  "status": "skipped",
  "reason": "No reply needed"
}
```

Rules:

- Does not delete mail.
- Does not mark provider mailbox state unless explicitly configured.
- Writes local processing state and audit log.

## 10. Data Model Requirements

### 10.1 `EmailInboxAccount`

Stores inbound mailbox settings.

Recommended fields:

```typescript
interface EmailInboxAccount {
  id: number;
  name: string;
  emailAddress: string;
  username: string;
  authType: "password" | "oauth2";
  encryptedPassword?: string | null;
  encryptedAccessToken?: string | null;
  encryptedRefreshToken?: string | null;
  imapHost: string;
  imapPort: string;
  imapSsl: number;
  folder: string;
  linkedEmailServiceId: number | null;
  status: number;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### 10.2 `EmailReceivedMessage`

Stores normalized inbound messages.

Recommended fields:

```typescript
type EmailMessageClassification =
  | "interested"
  | "not_interested"
  | "unsubscribe"
  | "bounce"
  | "auto_reply"
  | "support_request"
  | "needs_human_review"
  | "unknown";

type EmailReplyStatus =
  | "not_started"
  | "draft_created"
  | "sent"
  | "skipped"
  | "blocked"
  | "failed";

interface EmailReceivedMessage {
  id: number;
  inboxId: number;
  providerUid: string;
  messageId: string | null;
  threadKey: string | null;
  inReplyTo: string | null;
  referencesHeader: string | null;
  fromAddress: string;
  fromName: string | null;
  replyToAddress: string | null;
  toAddressesJson: string;
  ccAddressesJson: string | null;
  subject: string;
  bodyText: string | null;
  bodyHtmlSanitized: string | null;
  snippet: string | null;
  receivedAt: string;
  isUnread: boolean;
  classification: EmailMessageClassification | null;
  classificationConfidence: number | null;
  replyStatus: EmailReplyStatus;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Unique constraint:

- `(inboxId, providerUid)` should be unique.

### 10.3 `EmailReplyDraft`

Stores generated and edited reply drafts.

Recommended fields:

```typescript
interface EmailReplyDraft {
  id: number;
  messageId: number;
  emailServiceId: number | null;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  status: "draft" | "approved" | "sent" | "discarded" | "failed";
  generationSource: "ai" | "manual";
  modelName: string | null;
  promptVersion: string | null;
  confidence: number | null;
  warningsJson: string | null;
  sentAt: string | null;
  sendError: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### 10.4 `EmailAutoReplyRule`

Stores later-phase automation rules.

Recommended fields:

```typescript
interface EmailAutoReplyRule {
  id: number;
  inboxId: number;
  name: string;
  enabled: number;
  allowedClassificationsJson: string;
  blockedSenderPatternsJson: string | null;
  blockedDomainPatternsJson: string | null;
  dailySendLimit: number;
  perThreadReplyLimit: number;
  confidenceThreshold: number;
  quietHoursJson: string | null;
  requireApprovalBelowThreshold: number;
  linkedEmailServiceId: number;
  createdAt: string;
  updatedAt: string;
}
```

### 10.5 `EmailReplyAuditLog`

Stores decisions and send outcomes.

Recommended fields:

```typescript
interface EmailReplyAuditLog {
  id: number;
  inboxId: number;
  messageId: number | null;
  draftId: number | null;
  action:
    | "message_fetched"
    | "message_read_by_ai"
    | "classified"
    | "draft_created"
    | "reply_sent"
    | "reply_skipped"
    | "auto_reply_blocked"
    | "send_failed";
  actor: "user" | "ai" | "system";
  reason: string | null;
  metadataJson: string | null;
  createdAt: string;
}
```

## 11. Architecture Requirements

### 11.1 Layering

Follow the existing three-layer architecture:

```text
IPC handler or SkillRegistry tool
  -> Module
  -> Model
  -> TypeORM entity
```

Required modules:

- `EmailInboxAccountModule`
- `EmailReceivedMessageModule`
- `EmailReplyDraftModule`
- `EmailAutoReplyRuleModule`
- `EmailReplyAuditLogModule`
- `EmailReceiveAiTools` service, equivalent in shape to `EmailMarketingAiTools`

Required models:

- `EmailInboxAccount.model.ts`
- `EmailReceivedMessage.model.ts`
- `EmailReplyDraft.model.ts`
- `EmailAutoReplyRule.model.ts`
- `EmailReplyAuditLog.model.ts`

### 11.2 Worker boundary

If message polling or IMAP fetching runs in a child process:

- Place worker entry points in `src/childprocess/`.
- Worker may connect to IMAP and parse messages.
- Worker must not write to SQLite.
- Worker sends fetched message payloads to the main process.
- Main process validates and persists through modules.

Recommended worker:

```text
src/childprocess/emailReceiveWorker.ts
```

Data flow:

```text
Scheduler or user action
  -> main process starts receive worker
  -> worker connects to IMAP
  -> worker fetches bounded messages
  -> worker sends EMAIL_RECEIVE_MESSAGES to main
  -> main process module upserts messages
  -> renderer and AI tools read stored records
```

### 11.3 AI enable gate

Any IPC handler that serves AI functions must check AI enable first:

```text
Token + USER_AI_ENABLED
  -> if not enabled, return { status: false, msg, data: null }
```

This applies to:

- Draft generation.
- AI classification.
- AI chat tool handlers if implemented through IPC.
- Auto-reply decisioning.

Plain mailbox setup and manual fetch can exist without AI, but any LLM-backed action must be gated.

### 11.4 Mail receiving technology

Recommended MVP technology:

- Use IMAP for receiving.
- Use an established Node.js IMAP client such as ImapFlow.
- Continue using `nodemailer` or the existing `EmailService` wrapper for SMTP sending.

Provider-specific APIs can be added later for Gmail and Outlook if needed. OAuth2 support should be designed into the account model but does not need to block password/app-password IMAP MVP.

## 12. Auto-Reply Safety Policy

Auto-reply must be designed as a policy layer above receive, classify, draft, and send.

### 12.1 Phase 1 policy

- No automatic sending.
- Draft generation allowed.
- User must click send or approve the `send_email_reply` tool.

### 12.2 Later auto-send policy

Auto-send is allowed only when all conditions pass:

1. Auto-reply is enabled for the inbox.
2. A matching enabled rule exists.
3. The message classification is allowed by the rule.
4. The confidence score is at or above the rule threshold.
5. The sender is not blocked.
6. The sender is not a no-reply address.
7. The message is not a bounce, delivery failure, mailing list, or automated reply.
8. The thread has not already received the maximum allowed replies.
9. The daily send limit has not been reached.
10. The current time is outside quiet hours or the rule allows quiet-hour drafts only.
11. A valid linked outbound email service exists.
12. The generated draft passes content checks.

If any condition fails, create or keep a draft and mark the message as `blocked`, `skipped`, or `needs_human_review`.

### 12.3 Loop prevention

Never auto-reply when headers or content indicate:

- `Auto-Submitted` is not `no`.
- `Precedence` is `bulk`, `junk`, or `list`.
- Message is a delivery status notification.
- Sender contains `no-reply`, `noreply`, `do-not-reply`, `mailer-daemon`, or `postmaster`.
- The same thread already received an AiFetchly auto-reply.
- The same sender received an auto-reply within the configured cooldown.

### 12.4 Content safety

The generated reply must not:

- Promise actions the user did not authorize.
- Include credentials, tokens, or internal logs.
- Include unverified pricing, legal claims, or policy commitments.
- Send attachments in the MVP.
- Change unsubscribe or opt-out handling without explicit policy.

## 13. Classification Requirements

The AI classifier should return:

```typescript
interface EmailMessageClassificationResult {
  classification: EmailMessageClassification;
  confidence: number;
  summary: string;
  recommendedAction:
    | "draft_reply"
    | "skip"
    | "mark_unsubscribe"
    | "needs_human_review";
  reasons: string[];
}
```

Required classifications:

- `interested`
- `not_interested`
- `unsubscribe`
- `bounce`
- `auto_reply`
- `support_request`
- `needs_human_review`
- `unknown`

Unsubscribe and bounce messages should not receive normal sales replies.

## 14. Functional Requirements

### FR-001 Inbound account CRUD

Users can create, edit, disable, and delete inbound inbox accounts.

Acceptance criteria:

- Account list excludes passwords and tokens.
- Account detail never returns raw secrets to renderer.
- Delete is blocked or soft-deletes when messages exist, unless product chooses cascading delete explicitly.
- Connection test reports success or a clear error.

### FR-002 Manual message sync

Users can manually fetch unread or recent messages for one inbox.

Acceptance criteria:

- Sync uses a bounded limit.
- Duplicate provider messages are upserted, not duplicated.
- Sync errors are stored on the inbox account and shown to the user.
- Message summaries are available after sync.

### FR-003 AI message read tools

AI chat can list inboxes, fetch unread messages, and inspect selected messages.

Acceptance criteria:

- Tools are registered in `SkillRegistry`.
- Tool schemas validate input with strict bounds.
- Tool results are sanitized and do not include credentials.
- Mailbox read actions are audit logged.

### FR-004 AI draft generation

AI chat or message detail UI can generate a reply draft.

Acceptance criteria:

- AI enable gate is checked before generation.
- Draft is persisted before being returned.
- Draft references the original message.
- Draft status is `draft`.
- Generated content is visible to the user before sending.

### FR-005 Confirmed reply send

User or confirmed AI tool call can send a draft reply.

Acceptance criteria:

- `send_email_reply` requires confirmation in AI chat.
- The outbound service is active.
- The reply uses correct recipient from `replyToAddress` or sender fallback.
- Send result updates draft and message state.
- Send failure records a clear error and does not mark the message as sent.

### FR-006 Processing state

Users and AI tools can mark messages as processed, skipped, blocked, or failed.

Acceptance criteria:

- State changes are persisted.
- State changes are audit logged.
- Marking processed does not delete provider mail.

### FR-007 Rule-based auto-reply foundation

The data model and service boundaries support future auto-reply rules even if the MVP UI does not expose full automation.

Acceptance criteria:

- Auto-reply rules can be represented without schema redesign.
- Send policy can be evaluated independently of the LLM.
- Policy failures produce user-readable reasons.

### FR-008 Internationalization

All user-facing UI text added by this feature must be translated.

Acceptance criteria:

- Update `src/views/lang/en.ts`.
- Update `src/views/lang/zh.ts`.
- Update `src/views/lang/es.ts`.
- Update `src/views/lang/fr.ts`.
- Update `src/views/lang/de.ts`.
- Update `src/views/lang/ja.ts`.

## 15. Security And Privacy Requirements

1. Mailbox credentials must never be exposed to renderer or LLM tools.
2. AI tools must return sanitized mailbox data only.
3. Message body returned to LLM should be limited and sanitized.
4. HTML email must be sanitized before display.
5. Remote images should be disabled by default to avoid tracking pixels.
6. Attachment parsing is out of MVP unless explicitly scoped.
7. Reply sending must require confirmation in Phase 1.
8. Auto-reply must have per-inbox and global limits before release.
9. All reads and sends must be audit logged.
10. Worker processes must not access the database.
11. IPC handlers must validate inputs with schemas.
12. AI handlers must check `USER_AI_ENABLED` before work.
13. Prompt injection in inbound email content must be treated as untrusted content. The LLM must be instructed that email content is user/customer text, not system instructions.

## 16. Error Handling Requirements

Mailbox connection errors:

- Store `lastSyncError`.
- Show user-readable error.
- Do not disable the inbox automatically unless repeated failures exceed a future threshold.

Message parsing errors:

- Store metadata where possible.
- Mark body parse failure.
- Continue with other messages.

AI draft errors:

- Keep message state unchanged.
- Record audit log action `send_failed` or draft failure equivalent.
- Let user retry.

Send errors:

- Keep draft status `failed`.
- Store provider error message.
- Do not mark original message as replied.

Duplicate messages:

- Upsert by `(inboxId, providerUid)`.
- Preserve local reply state if provider metadata changes.

## 17. Analytics And Audit Events

Recommended local audit events:

- Inbox account created.
- Inbox account connection tested.
- Message sync started.
- Message fetched.
- Message read by AI.
- Message classified.
- Draft created.
- Draft edited.
- Reply sent.
- Reply skipped.
- Auto-reply blocked.
- Send failed.

Do not log secrets or full message bodies in audit metadata.

## 18. Success Metrics

Phase 1 success:

| Metric | Target |
| --- | --- |
| Manual inbox connection success rate | > 90% for correctly configured IMAP accounts |
| Duplicate message rate after repeated sync | 0 duplicate local records for same provider UID |
| Draft creation success rate | > 95% when AI is enabled and message has readable body |
| Send confirmation bypass incidents | 0 |
| Reply send audit coverage | 100% of send attempts |

Later auto-reply success:

| Metric | Target |
| --- | --- |
| Auto-reply loop incidents | 0 |
| Auto-replies above daily limit | 0 |
| Auto-reply messages without audit record | 0 |
| Messages requiring human review incorrectly auto-sent | < 1% after evaluation |

## 19. MVP Scope

### 19.1 Must have

- Inbound inbox account entity/model/module.
- Manual IMAP sync for bounded unread messages.
- Received message persistence.
- Built-in tools:
  - `list_email_inboxes`
  - `fetch_unread_emails`
  - `get_email_message`
  - `create_email_reply_draft`
  - `send_email_reply`
  - `mark_email_processed`
- Reply draft persistence.
- Confirmed reply send through existing outbound service.
- Audit log for read/draft/send.
- Basic inbox and message UI.
- AI enable gate for draft generation.
- i18n updates for new UI text.

### 19.2 Should have

- Connection test.
- Message classification.
- HTML sanitization.
- Thread key storage.
- Reply headers.
- Draft regeneration.
- Filters for reply status.

### 19.3 Could have

- OAuth2 account support.
- Scheduled polling.
- Basic auto-reply rules disabled by default.
- Template-assisted reply generation.
- Campaign/contact linking.

### 19.4 Won't have in MVP

- Unattended auto-send.
- Attachment extraction.
- Provider webhooks.
- Full Gmail or Microsoft Graph API integration.
- Multi-user shared inbox management.

## 20. Open Questions

1. Should inbound accounts reuse `EmailServiceEntity` credentials when SMTP and IMAP username/password are the same, or always store separate inbound credentials?
2. Should the MVP support OAuth2 for Gmail/Outlook immediately, or start with IMAP app passwords?
3. Should read messages be marked as read on the provider mailbox, or only marked processed locally?
4. Should reply drafts use existing email templates, new reply templates, or both?
5. Should auto-reply rules be global, per inbox, per campaign, or all three?
6. Should inbound replies be linked to original outbound send logs in MVP?
7. What is the default maximum number of messages the AI can inspect per chat turn?

## 21. Suggested Implementation Milestones

### Milestone 1: Data and receive foundation

- Add entities, models, modules, and tests for inbox accounts and received messages.
- Add IMAP receive service or worker.
- Add manual sync.
- Add connection test.

### Milestone 2: AI tool surface

- Add inbound email schemas and `EmailReceiveAiTools`.
- Register built-in tools in `SkillRegistry`.
- Add permission, validation, and audit logging.
- Add tests for tool contracts and failure paths.

### Milestone 3: Draft and send flow

- Add reply draft entity/model/module.
- Add draft generation with AI enable gate.
- Add confirmed reply send using outbound email service.
- Preserve reply headers where possible.
- Add send audit log.

### Milestone 4: UI and i18n

- Add inbox account UI.
- Add received message list/detail UI.
- Add draft review/edit/send UI.
- Add all translations.

### Milestone 5: Auto-reply policy foundation

- Add rule entity/module.
- Add policy evaluator.
- Add dry-run mode.
- Add blocked/skipped reason reporting.
- Keep auto-send disabled unless separately approved.

## 22. Acceptance Checklist

- [ ] Inbound mailbox credentials are never returned to renderer or AI tools.
- [ ] Worker processes do not access SQLite directly.
- [ ] All database logic lives in Model and Module classes.
- [ ] AI-serving IPC handlers check `USER_AI_ENABLED` first.
- [ ] `send_email_reply` requires confirmation in Phase 1.
- [ ] Repeated sync does not duplicate messages.
- [ ] Message body is sanitized before UI display or LLM use.
- [ ] Prompt injection guidance treats email content as untrusted.
- [ ] Reply send failures do not mark messages as sent.
- [ ] All new UI text has translations in all supported languages.
- [ ] Tests cover models, modules, AI tool validation, send policy, and IPC handlers.

