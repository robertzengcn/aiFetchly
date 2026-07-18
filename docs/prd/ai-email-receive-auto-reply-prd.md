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

This feature adds first-class inbound email infrastructure and built-in AI tools for email receive and reply workflows. The recommended first release is assisted reply, not fully autonomous auto-reply. The user connects an inbox, the app fetches unread messages, the LLM drafts a response using the built-in knowledge library, and the user approves before sending. After the assisted flow is stable, the product can add rule-based auto-reply with strict limits, thread tracking, loop prevention, and audit logs.

The feature should be built as core product functionality through the existing built-in skill registry, not as an imported third-party skill. It needs access to private mailbox credentials, message storage, knowledge-library retrieval, audit records, send confirmation, and AI permission policy. Those are main-process responsibilities in AiFetchly's architecture.

## 2. Background And Current State

### 2.1 Existing outbound email support

AiFetchly already has outbound email marketing concepts:

- `EmailServiceEntity` stores SMTP sender configuration. It currently has SMTP `host`, `port`, and `ssl` fields, but it does not yet have POP3 or IMAP receive settings.
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

### 2.2 Existing knowledge library support

AiFetchly already has a built-in knowledge library backed by RAG documents, chunks, embeddings, and vector search. `src/service/VectorSearchService.ts` provides:

- The built-in AI tool `knowledge_library_search`, registered in `SkillRegistry`.
- `RagSearchModule.searchKnowledgeForTool()` for the tool execution pipeline.
- `VectorSearchService.search(query, options)` for vector retrieval over embedded documents.
- `VectorSearchService.searchCandidates(query, options)` for hybrid vector and keyword retrieval.
- `searchWithFilters(query, filters, options)` for filtered retrieval.

Email reply generation must use the existing `knowledge_library_search` tool contract before asking the LLM to write a reply. The retrieved snippets become factual context for the reply, while the inbound email body remains untrusted customer content.

### 2.3 Existing AI tool architecture

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

### 2.4 Missing capability

The app does not yet have:

- Inbound mailbox account configuration.
- IMAP or provider API receive support.
- Stored received email messages and thread state.
- POP3 and IMAP receive settings on the email service configuration.
- AI tools for reading inbox messages.
- Knowledge-library retrieval for reply generation.
- Reply draft records.
- Reply send audit logs tied to inbound messages.
- Auto-reply audit logs that show every AI auto-reply decision and send attempt.
- Owner-like reply style controls that make the reply sound like the real email account owner rather than an AI assistant.
- Auto-reply rules and safety policy.
- UI for reviewing unread emails, drafts, and AI auto-reply history.

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
  -> retrieve relevant knowledge-library context
  -> summarize message
  -> draft reply in the owner's natural voice
  -> approve or auto-send by policy
  -> record outcome
```

## 4. Goals

1. Let users connect inbound email mailboxes for receiving messages.
2. Fetch unread or recent inbox messages through a controlled main-process path.
3. Store normalized email message metadata and body content locally.
4. Expose built-in AI tools for listing inboxes, fetching unread messages, reading message details, drafting replies, and sending replies.
5. Require user confirmation before any reply is sent in the first release.
6. Extend the existing email service configuration with POP3 and IMAP receive settings while preserving SMTP send settings.
7. Link receive settings and outbound SMTP settings under the same email service record where practical.
8. Prevent direct database access from worker processes.
9. Keep AI feature IPC handlers gated by `USER_AI_ENABLED`.
10. Use the built-in `knowledge_library_search` tool and knowledge library to ground AI-generated replies.
11. Make generated replies sound like the actual mailbox owner, not like an AI system.
12. Add audit logs for message reads, knowledge retrieval, draft generation, auto-reply decisions, reply sends, skipped auto-replies, and policy blocks.
13. Provide a UI where users can view AI-created drafts, AI-sent replies, skipped replies, blocked replies, and the reason for each decision.
14. Provide a safe path to future rule-based auto-reply.
15. Support all required UI translations when UI is added.

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
11. No replies that identify themselves as AI-generated unless the email owner explicitly configures that behavior.

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

- Extended email service receive settings plus new inbound message modules, models, entities, and services.
- New built-in AI tools registered in `SkillRegistry`.
- New UI pages or tabs for receive-enabled email services, received messages, reply drafts, and automation settings.
- Reuse and extend the existing email service configuration for SMTP sending, IMAP receiving, and optional POP3 receiving.
- Use the existing `knowledge_library_search` built-in tool to ground replies in business-specific facts.

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

Add receive settings to the email service setup surface under email service, email marketing, or AI tools settings.

Required fields for IMAP MVP:

- Display name.
- Email address.
- SMTP host, port, and SSL/TLS settings for sending.
- IMAP host.
- IMAP port.
- IMAP SSL/TLS enabled.
- POP3 host.
- POP3 port.
- POP3 SSL/TLS enabled.
- Receive protocol, default `imap`.
- Username.
- Password or app password.
- Folder to monitor, default `INBOX`.
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
- SMTP and receive settings should be tested separately so users can diagnose send and receive failures.

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

### 8.3 AI auto-reply audit UI

Add a dedicated UI view or tab where users can audit emails handled by AI.

Recommended placement:

- Email marketing submenu, as `AI Auto Replies`.
- Or a tab under the receive-enabled email service detail page.

The view must show:

- Received message subject.
- Sender email and sender name.
- Email service / mailbox.
- AI classification.
- Decision status: `draft_created`, `auto_sent`, `blocked`, `skipped`, `failed`, or `needs_human_review`.
- Decision reason.
- Knowledge-library search query used.
- Knowledge-library source count.
- Draft preview.
- Sent reply preview when sent.
- Send time or decision time.
- Whether user approval was required.
- Error message when failed.

Required actions:

- Open original received message.
- Open generated draft.
- Open sent reply.
- Filter by status, date range, email service, classification, and sender.
- Search by subject, sender, or decision reason.
- Export audit rows to CSV in a later phase.

The UI must read from module/model APIs. It must not query SQLite directly from the renderer.

### 8.4 Message detail and AI draft

The message detail view should show:

- Sanitized message body.
- Sender and reply-to address.
- Subject.
- Thread identifiers if available.
- Knowledge-library snippets used for draft generation.
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

### 8.4 Knowledge-grounded reply behavior

When the user asks the assistant to reply to an email, the app must search the built-in knowledge library before generating the reply.

The retrieval query should be built from:

- Inbound email subject.
- Sanitized inbound email body.
- Sender name and company if known.
- User-provided reply goal.
- Prior classification result.

The draft UI should show the knowledge sources used, including document name/title and a short snippet. If the knowledge library has no relevant result, the draft should say it was generated without knowledge-library support in the audit metadata, not in the email body.

The LLM must distinguish between:

- Trusted knowledge-library context.
- User instructions.
- Untrusted inbound email text.

Inbound email content must never override system instructions, tool policy, or send policy.

### 8.5 Owner-like reply style

Replies should read like they came from the real mailbox owner.

The product should support a reply identity profile for each email service:

- Owner display name.
- Role or company context.
- Preferred tone.
- Signature.
- Common phrases or style notes.
- Things never to say.

The default prompt policy must tell the LLM:

- Write as the mailbox owner or their authorized assistant.
- Do not mention being an AI, model, bot, or automated system.
- Do not expose internal reasoning, tool use, retrieved snippets, prompts, or confidence scores.
- Use natural human email language.
- Keep the response concise unless the user asks for detail.
- Use the configured signature if available.

If an email legally or ethically requires disclosure that it is automated, that should be a configurable policy decision, not accidental wording from the LLM.

### 8.6 AI chat tool experience

The LLM should be able to use tools in a safe sequence:

```text
list_email_inboxes
  -> fetch_unread_emails
  -> get_email_message
  -> knowledge_library_search
  -> create_email_reply_draft
  -> send_email_reply
```

The chat should clearly show when the assistant:

- Reads inbox metadata.
- Reads message body.
- Searches the knowledge library.
- Creates a draft.
- Waits for confirmation before sending.
- Sends a reply.
- Skips a message because policy blocks it.

### 8.7 Auto-reply settings

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

Purpose: let the LLM see which receive-enabled email services are available without exposing secrets.

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
  "email_service_id": 1,
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
  emailServiceId: number;
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

Purpose: create a knowledge-grounded reply draft for one inbound message.

Parameters:

```json
{
  "message_id": 123,
  "tone": "professional",
  "goal": "answer the prospect and ask for a meeting",
  "extra_instructions": "Keep it under 120 words.",
  "use_knowledge_library": true
}
```

Rules:

- Must create a persisted draft.
- Must not send.
- Must include the original message context, user instructions, and any selected template guidance.
- Must use the existing built-in `knowledge_library_search` tool contract by default.
- Must include retrieved knowledge snippets in the LLM context when relevant results exist.
- Must record which knowledge chunks were used.
- Must not expose knowledge-library source names, internal context, or retrieval scores in the email body unless the user explicitly asks to cite public material.
- Must write in the configured mailbox owner's voice.
- Must not mention AI, automation, tool calls, confidence, or retrieval.
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
  knowledgeSources: EmailReplyKnowledgeSource[];
  confidence: number | null;
  warnings: string[];
}
```

### 9.5 Tool: `knowledge_library_search`

Purpose: search the built-in knowledge library for facts that may help answer an inbound email.

This is an existing built-in skill and should be reused. Do not create a duplicate email-specific search tool unless a later technical design proves a wrapper is necessary.

Parameters:

```json
{
  "query": "pricing and onboarding questions from prospect",
  "limit": 5,
  "documentIds": [1, 2],
  "documentTypes": ["pdf", "txt"],
  "tags": ["sales", "support"],
  "includeNeighborChunks": true
}
```

Rules:

- Registered in `SkillRegistry` as `knowledge_library_search`.
- Executes through `RagSearchModule.searchKnowledgeForTool()`.
- Uses the knowledge library search pipeline, including hybrid retrieval and citations.
- `limit` must be capped, recommended max 10.
- Returns snippets, document identity, and scores suitable for user review and LLM context.
- Does not return full documents unless a later feature explicitly allows it.
- Email reply generation must store the tool query and returned source IDs in the reply audit log or draft metadata.

Returns:

```typescript
interface EmailReplyKnowledgeSource {
  chunkId: number;
  documentId: number;
  documentName: string;
  documentTitle?: string;
  content: string;
  score: number;
}
```

### 9.6 Tool: `send_email_reply`

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

### 9.7 Tool: `mark_email_processed`

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

### 10.1 `EmailServiceEntity` receive settings

The existing `EmailServiceEntity` must be extended so one configured email service can support both sending and receiving.

Current send fields:

```typescript
interface ExistingEmailServiceFields {
  id: number;
  name: string;
  from: string;
  password: string;
  host: string;
  port: string;
  ssl: number;
  status: number;
}
```

Required new receive fields:

```typescript
interface EmailServiceReceiveFields {
  receiveProtocol: "imap" | "pop3";
  imapHost: string | null;
  imapPort: string | null;
  imapSsl: number;
  pop3Host: string | null;
  pop3Port: string | null;
  pop3Ssl: number;
  receiveUsername: string | null;
  receivePassword: string | null;
  receiveFolder: string;
  receiveEnabled: number;
  lastReceiveSyncAt: string | null;
  lastReceiveSyncError: string | null;
}
```

Rules:

- Existing SMTP `host`, `port`, and `ssl` fields remain the send configuration.
- IMAP and POP3 fields are receive configuration.
- `receivePassword` may reuse the same stored secret value as SMTP only if the implementation deliberately supports that; otherwise it must be stored and protected separately.
- The list and AI tool summaries must never expose `password` or `receivePassword`.
- Schema changes must update TypeORM entity, SQL init files, model validation, API schemas, UI forms, and tests.
- The implementation should prefer IMAP for receive workflows; POP3 is supported for providers that do not offer IMAP.

### 10.2 `EmailInboxAccount`

Represents the receive-facing account view. In the MVP, this can be a separate entity only if implementation needs a normalized inbox abstraction. If a separate entity is used, it must reference `EmailServiceEntity` through `emailServiceId` rather than duplicating SMTP send settings.

Recommended fields:

```typescript
interface EmailInboxAccount {
  id: number;
  emailServiceId: number;
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
  pop3Host: string | null;
  pop3Port: string | null;
  pop3Ssl: number;
  receiveProtocol: "imap" | "pop3";
  folder: string;
  status: number;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### 10.3 `EmailReceivedMessage`

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
  emailServiceId: number;
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

- `(emailServiceId, providerUid)` should be unique.

### 10.4 `EmailReplyDraft`

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
  knowledgeSourcesJson: string | null;
  ownerStyleProfileJson: string | null;
  warningsJson: string | null;
  sentAt: string | null;
  sendError: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### 10.5 `EmailReplyIdentityProfile`

Stores the voice and identity rules used to make replies sound like the real mailbox owner.

Recommended fields:

```typescript
interface EmailReplyIdentityProfile {
  id: number;
  emailServiceId: number;
  ownerName: string;
  ownerRole: string | null;
  companyName: string | null;
  preferredTone: string | null;
  signature: string | null;
  styleNotes: string | null;
  forbiddenPhrasesJson: string | null;
  discloseAutomation: number;
  createdAt: string;
  updatedAt: string;
}
```

Rules:

- `discloseAutomation` defaults to `0`.
- If no profile exists, use the email service sender name/address and a neutral professional tone.
- The profile affects generated content only. It must not bypass send confirmation or safety policy.

### 10.6 `EmailAutoReplyRule`

Stores later-phase automation rules.

Recommended fields:

```typescript
interface EmailAutoReplyRule {
  id: number;
  emailServiceId: number;
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
  createdAt: string;
  updatedAt: string;
}
```

### 10.7 `EmailReplyAuditLog`

Stores decisions and send outcomes.

Recommended fields:

```typescript
interface EmailReplyAuditLog {
  id: number;
  emailServiceId: number;
  messageId: number | null;
  draftId: number | null;
  action:
    | "message_fetched"
    | "message_read_by_ai"
    | "knowledge_retrieved"
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

### 10.8 `EmailAutoReplyAuditLog`

Stores the audit trail for the AI auto-reply function. This is the data source for the user-facing AI auto-reply audit UI.

Recommended fields:

```typescript
type EmailAutoReplyDecisionStatus =
  | "draft_created"
  | "approval_required"
  | "auto_sent"
  | "blocked"
  | "skipped"
  | "failed"
  | "needs_human_review";

interface EmailAutoReplyAuditLog {
  id: number;
  emailServiceId: number;
  messageId: number;
  draftId: number | null;
  ruleId: number | null;
  action:
    | "auto_reply_evaluated"
    | "knowledge_library_searched"
    | "draft_created"
    | "approval_required"
    | "auto_reply_sent"
    | "auto_reply_blocked"
    | "auto_reply_skipped"
    | "auto_reply_failed";
  decisionStatus: EmailAutoReplyDecisionStatus;
  classification: EmailMessageClassification | null;
  confidence: number | null;
  reason: string | null;
  knowledgeQuery: string | null;
  knowledgeSourcesJson: string | null;
  generatedSubject: string | null;
  generatedBodyPreview: string | null;
  sentSubject: string | null;
  sentBodyPreview: string | null;
  requiresUserApproval: number;
  approvedByUser: number;
  errorMessage: string | null;
  metadataJson: string | null;
  createdAt: string;
}
```

Rules:

- Every AI auto-reply evaluation must create at least one audit log row.
- Every `knowledge_library_search` call used for reply generation must be represented in the audit metadata or its own `knowledge_library_searched` row.
- Every AI-created draft, user-approved send, auto-send, block, skip, and failure must be logged.
- Body previews must be truncated and sanitized. Full message bodies should remain in message/draft tables, not duplicated in audit logs.
- Audit rows must not store secrets, raw prompts, raw credentials, access tokens, or full internal chain-of-thought.

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

- `EmailServiceModule` updates for receive fields
- `EmailReceivedMessageModule`
- `EmailReplyDraftModule`
- `EmailReplyIdentityProfileModule`
- `EmailAutoReplyRuleModule`
- `EmailReplyAuditLogModule`
- `EmailAutoReplyAuditLogModule`
- `EmailReceiveAiTools` service, equivalent in shape to `EmailMarketingAiTools`
- `EmailReplyKnowledgeService` for `knowledge_library_search` integration

Required models:

- `EmailService.model.ts` updates for receive fields
- `EmailReceivedMessage.model.ts`
- `EmailReplyDraft.model.ts`
- `EmailReplyIdentityProfile.model.ts`
- `EmailAutoReplyRule.model.ts`
- `EmailReplyAuditLog.model.ts`
- `EmailAutoReplyAuditLog.model.ts`

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

### 11.4 Knowledge-library integration

Reply generation must retrieve business-specific context from the built-in knowledge library.

Recommended flow:

```text
create_email_reply_draft
  -> EmailReceiveAiTools validates input
  -> EmailReceivedMessageModule loads message
  -> EmailReplyKnowledgeService builds retrieval query
  -> calls existing built-in `knowledge_library_search` tool contract
  -> top snippets are sanitized and ranked
  -> LLM prompt receives trusted knowledge context + untrusted email content
  -> EmailReplyDraftModule stores draft and knowledgeSourcesJson
  -> EmailAutoReplyAuditLogModule stores search and decision audit rows
```

Rules:

- Retrieval runs before draft generation unless `use_knowledge_library` is explicitly false and the user initiated that choice.
- Default limit should be small, recommended 5 snippets.
- Retrieved snippets must be trimmed before prompt insertion.
- The draft record must store source IDs and document names for auditability.
- The auto-reply audit log must store the retrieval query and source summary.
- The email body must not reveal internal document names or source snippets unless explicitly requested.
- If retrieval fails, draft generation may continue only with a warning and an audit record.

### 11.5 Mail receiving technology

Recommended MVP technology:

- Use IMAP for receiving.
- Include POP3 settings in the email service configuration for provider compatibility.
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
- Mention that it was written by AI, generated by a model, or assembled with retrieval tools.
- Expose knowledge-library snippets, document names, confidence scores, or internal classification labels.
- Send attachments in the MVP.
- Change unsubscribe or opt-out handling without explicit policy.

### 12.5 Owner voice policy

The generated reply must:

- Use the reply identity profile for the selected email service.
- Sound like a normal email from the mailbox owner.
- Match the owner's role, company context, and signature.
- Avoid robotic phrases such as "as an AI", "I am unable", "based on the provided context", or "the knowledge base says".
- Avoid over-explaining unless the recipient asked for detail.
- Preserve the owner's accountability. The reply can say "I" or "we" according to the configured profile.
- Escalate to human review when the draft would need unsupported facts, commitments, refunds, legal advice, or sensitive account information.

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

Users can create, edit, disable, and delete receive settings for email services.

Acceptance criteria:

- Account list excludes passwords and tokens.
- Account detail never returns raw secrets to renderer.
- Existing SMTP send fields continue to work.
- IMAP and POP3 receive fields can be saved and validated.
- SMTP send test and receive connection test report separate success or error states.
- Delete is blocked or soft-deletes when messages exist, unless product chooses cascading delete explicitly.

### FR-002 Manual message sync

Users can manually fetch unread or recent messages for one inbox.

Acceptance criteria:

- Sync uses a bounded limit.
- Duplicate provider messages are upserted, not duplicated.
- Sync errors are stored on the email service receive settings and shown to the user.
- Message summaries are available after sync.

### FR-003 AI message read tools

AI chat can list inboxes, fetch unread messages, and inspect selected messages.

Acceptance criteria:

- Tools are registered in `SkillRegistry`.
- Tool schemas validate input with strict bounds.
- Tool results are sanitized and do not include credentials.
- Mailbox read actions are audit logged.

### FR-004 AI draft generation

AI chat or message detail UI can generate a knowledge-grounded, owner-like reply draft.

Acceptance criteria:

- AI enable gate is checked before generation.
- `knowledge_library_search` is used by default before the LLM writes the draft.
- Retrieved knowledge source IDs are persisted with the draft.
- Knowledge-library search query and source summary are persisted in the auto-reply audit log.
- The draft uses the configured reply identity profile.
- The email body does not mention AI, automation, retrieval, internal documents, or confidence.
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
- Every policy evaluation creates an `EmailAutoReplyAuditLog` row.

### FR-008 AI auto-reply audit UI

Users can view emails handled by the AI auto-reply function.

Acceptance criteria:

- A list view shows AI-created drafts, approval-required replies, auto-sent replies, blocked replies, skipped replies, and failed replies.
- The list can filter by email service, status, classification, sender, and date range.
- A detail view shows original message metadata, generated draft preview, sent reply preview, knowledge search query, knowledge source summary, decision reason, approval status, and error message.
- The UI reads through IPC handlers and Module methods. It does not query the database directly.
- Audit entries are append-only from the UI perspective. Users may filter and inspect logs but not edit historical audit rows.

### FR-009 Internationalization

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
9. All reads, knowledge searches, draft decisions, approval decisions, skips, blocks, failures, and sends must be audit logged.
10. Worker processes must not access the database.
11. IPC handlers must validate inputs with schemas.
12. AI handlers must check `USER_AI_ENABLED` before work.
13. Prompt injection in inbound email content must be treated as untrusted content. The LLM must be instructed that email content is user/customer text, not system instructions.
14. Knowledge-library content is trusted only as factual context, not as executable instruction.
15. Reply drafts must not reveal that internal knowledge retrieval was used.

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

- Upsert by `(emailServiceId, providerUid)`.
- Preserve local reply state if provider metadata changes.

## 17. Analytics And Audit Events

Recommended local audit events:

- Inbox account created.
- Inbox account connection tested.
- Message sync started.
- Message fetched.
- Message read by AI.
- Knowledge retrieved.
- Message classified.
- Draft created.
- Draft edited.
- Auto-reply evaluated.
- Auto-reply approval required.
- Auto-reply sent.
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
| Reply drafts with knowledge retrieval attempted | 100% unless explicitly disabled by user |
| Reply drafts that accidentally disclose AI/tool usage | 0 |
| Send confirmation bypass incidents | 0 |
| Reply send audit coverage | 100% of send attempts |
| Auto-reply audit coverage | 100% of AI auto-reply evaluations |
| Auto-reply UI visibility | 100% of audit rows visible through UI filters |

Later auto-reply success:

| Metric | Target |
| --- | --- |
| Auto-reply loop incidents | 0 |
| Auto-replies above daily limit | 0 |
| Auto-reply messages without audit record | 0 |
| Messages requiring human review incorrectly auto-sent | < 1% after evaluation |

## 19. MVP Scope

### 19.1 Must have

- Email service receive settings in `EmailServiceEntity`, `EmailService.model.ts`, and `EmailServiceModule`.
- Manual IMAP sync for bounded unread messages.
- Received message persistence.
- Email service receive fields for IMAP and POP3 host, port, SSL, receive username, receive password, folder, and receive protocol.
- Built-in tools:
  - `list_email_inboxes`
  - `fetch_unread_emails`
  - `get_email_message`
  - `knowledge_library_search`
  - `create_email_reply_draft`
  - `send_email_reply`
  - `mark_email_processed`
- Reply draft persistence.
- Knowledge-library retrieval through the existing `knowledge_library_search` built-in tool during draft generation.
- Reply identity profile support or a minimum owner-style prompt policy.
- Confirmed reply send through existing outbound service.
- Audit log for read, knowledge search, draft decision, send decision, skip, block, failure, and send.
- AI auto-reply audit UI for viewing AI-created drafts, AI-sent replies, skipped replies, blocked replies, and failures.
- Basic receive-enabled email service and message UI.
- AI enable gate for draft generation.
- i18n updates for new UI text.

### 19.2 Should have

- Connection test.
- Message classification.
- HTML sanitization.
- Thread key storage.
- Reply headers.
- User-editable reply identity profile.
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

1. Should the MVP support OAuth2 for Gmail/Outlook immediately, or start with IMAP app passwords?
2. Should read messages be marked as read on the provider mailbox, or only marked processed locally?
3. Should reply drafts use existing email templates, new reply templates, or both?
4. Should auto-reply rules be global, per inbox, per campaign, or all three?
5. Should inbound replies be linked to original outbound send logs in MVP?
6. What is the default maximum number of messages the AI can inspect per chat turn?
7. Which knowledge-library collections or documents should be eligible for email reply generation by default?
8. Should users be able to disable knowledge-library retrieval per draft, or only per inbox/email service?

## 21. Suggested Implementation Milestones

### Milestone 1: Data and receive foundation

- Extend `EmailServiceEntity`, SQL init files, models, schemas, and UI contracts with IMAP and POP3 receive fields.
- Add entities, models, modules, and tests for received messages.
- Add IMAP receive service or worker.
- Add manual sync.
- Add connection test.

### Milestone 2: AI tool surface

- Add inbound email schemas and `EmailReceiveAiTools`.
- Register built-in tools in `SkillRegistry`.
- Add `EmailReplyKnowledgeService` backed by the existing `knowledge_library_search` tool contract.
- Reuse the existing `knowledge_library_search` tool rather than registering a duplicate email-specific search tool.
- Add permission, validation, and audit logging.
- Add tests for tool contracts and failure paths.

### Milestone 3: Draft and send flow

- Add reply draft entity/model/module.
- Add reply identity profile support.
- Add knowledge-grounded draft generation with AI enable gate.
- Add confirmed reply send using outbound email service.
- Preserve reply headers where possible.
- Add send audit log.

### Milestone 4: UI and i18n

- Add receive settings UI for email services.
- Add received message list/detail UI.
- Add draft review/edit/send UI.
- Add AI auto-reply audit UI with filters and detail view.
- Add all translations.

### Milestone 5: Auto-reply policy foundation

- Add rule entity/module.
- Add policy evaluator.
- Add dry-run mode.
- Add blocked/skipped reason reporting.
- Keep auto-send disabled unless separately approved.

## 22. Acceptance Checklist

- [ ] Inbound mailbox credentials are never returned to renderer or AI tools.
- [ ] Existing email service configuration supports SMTP send fields plus IMAP and POP3 receive fields.
- [ ] Worker processes do not access SQLite directly.
- [ ] All database logic lives in Model and Module classes.
- [ ] AI-serving IPC handlers check `USER_AI_ENABLED` first.
- [ ] Reply draft generation uses `knowledge_library_search` by default.
- [ ] Draft records store knowledge source IDs used for generation.
- [ ] Auto-reply audit records are created for every AI auto-reply evaluation.
- [ ] Users can view AI auto-reply audit records in the UI.
- [ ] Replies do not disclose AI, tool, prompt, confidence, or retrieval details.
- [ ] Replies follow the configured email owner identity and style.
- [ ] `send_email_reply` requires confirmation in Phase 1.
- [ ] Repeated sync does not duplicate messages.
- [ ] Message body is sanitized before UI display or LLM use.
- [ ] Prompt injection guidance treats email content as untrusted.
- [ ] Reply send failures do not mark messages as sent.
- [ ] All new UI text has translations in all supported languages.
- [ ] Tests cover models, modules, AI tool validation, send policy, and IPC handlers.
