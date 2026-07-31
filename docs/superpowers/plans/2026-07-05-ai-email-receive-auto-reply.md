# AI Email Receive And Auto-Reply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class inbound email infrastructure (IMAP-first receive, persisted messages, knowledge-grounded owner-like reply drafts, confirmed reply send, AI auto-reply audit UI) as a built-in core feature, following AiFetchly's existing Entity→Model→Module→Controller→IPC→Vue architecture.

**Architecture:** Extend the existing `EmailServiceEntity` with receive fields and add 6 new entities (`EmailReceivedMessage`, `EmailReplyDraft`, `EmailReplyIdentityProfile`, `EmailAutoReplyRule`, `EmailReplyAuditLog`, `EmailAutoReplyAuditLog`). Receive runs through a pluggable `EmailReceiveClient` (ImapFlow default, POP3 later). Reply generation reuses the existing `knowledge_library_search` contract via `RagSearchModule.searchKnowledgeForTool()`. New built-in AI tools are registered in `SkillRegistry` Shape-2 style (typed service fn → `{success, result}` envelope). No worker process in MVP — IMAP fetch is bounded and runs main-process; a worker slot is reserved behind the same interface for later. TypeORM `synchronize:true` handles schema (no migration runner).

**Tech Stack:** TypeScript 5.x, Electron, TypeORM + better-sqlite3, Vue 3 + Vuetify + Pinia, vue-i18n, zod, nodemailer (existing). **New deps:** `imapflow`, `mailparser`, `sanitize-html`, `html-to-text`.

**Source docs:** `docs/prd/ai-email-receive-auto-reply-prd.md`, `docs/prd/ai-email-receive-auto-reply-technical-design.md`.

---

## Validated Codebase Patterns (mirror these — do not re-derive)

These were verified by direct exploration. Every task below assumes them.

**Entity** (`src/entity/EmailMarketingSendLog.entity.ts` is the audit template):
- `@Entity("<table_name>")`, `extends AuditableEntity` (from `@/entity/Auditable.entity`) → gets `createdAt?/updatedAt?`. Add `@PrimaryGeneratedColumn() id` + `@Column(...)` fields. `@Index([...], { unique: true })` for composite unique.

**Entity registration** (`src/config/SqliteDb.ts`):
- Add import near top, then append `XEntity,` to the inline `entities: [...]` array (lines ~417-499). `synchronize: true` (line 500) creates tables at boot — NO migration runner, NO `ALTER TABLE` needed. `src/sql/scraperdb/*.sql` files are reference-only (still create them for convention).

**Model** (`src/model/EmailService.model.ts`, `src/model/emailMarketingSendLog.model.ts`):
- `class XModel extends BaseDb` (`src/model/Basedb.ts`). Constructor: `super(filepath); this.repository = this.sqliteDb.connection.getRepository(XEntity);`. Methods: `create/read/update/delete/list.../count.../findBy...`. Use `repository.createQueryBuilder("alias")` with `.skip(offset).take(limit)` for pagination (note: `skip()` takes the already-computed offset). Sort allow-list keys/orders.

**Module** (`src/modules/emailServiceModule.ts`, `src/modules/emailMarketingSendLogModule.ts`):
- `class XModule extends BaseModule` (`src/modules/baseModule.ts`). Constructor: `super(); this.xModel = new XModel(this.dbpath);` (`this.dbpath` comes from `Token(USERSDBPATH)`). Each method: `try { ... } catch (e) { console.error(...); throw e; }`. List methods return `ListData<T>` = `{ records, num }`. Optionally define interface in `src/modules/interface/`.

**Service AI tool** (`src/service/EmailMarketingAiTools.ts`):
- `export async function f(args: unknown): Promise<EmailMarketingAiToolResult<T>>` → `try { const input = schema.parse(args); const module = new XModule(); await module.ensureConnection(); ...; return { success: true, ... }; } catch (e) { return e instanceof ZodError ? validationFailure(e) : failure(e); }`. **Never expose `password`/`receivePassword`/tokens** — sanitize outputs. Schemas + result types in `src/entityTypes/emailMarketingAiTypes.ts` (add `src/entityTypes/emailReceiveAiTypes.ts`).

**Skill registration** (`src/config/skillsRegistry.ts`):
- Import service fns at top (lines ~25-44). Add `SkillDefinition` to `BUILT_IN_SKILLS` array (Shape 2): `{ name, description, parameters: {type:"object",properties:{...},required:[...]}, tier: "main", requiresConfirmation, permissionCategory: "automation"|"pure", source: "built-in", execute: async (args) => { const r = await fn(args); return { success: r.success, result: r as unknown as Record<string, unknown> }; } }`. Read-only tools: `requiresConfirmation: false`. Send/reply mutations: `requiresConfirmation: true`.

**Knowledge integration** (call directly, no skill recursion):
- `import { RagSearchModule } from "@/modules/RagSearchModule"; const mod = new RagSearchModule(); const res = await mod.searchKnowledgeForTool({ query, limit, documentIds?, documentTypes?, tags?, includeNeighborChunks: true });` → `res.results: KnowledgeSearchResultItem[]` where each item = `{citation, documentId, documentName, title?, fileType, chunkId, chunkIndex, score, rerankScore?, content, matchType}`. Limit clamped to `[1,10]`, default 5.

**AI-enable gate** — 3 forms:
- IPC handler: use `registerAiValidatedHandler` (`src/main-process/communication/_shared/registerValidatedHandler.ts`) — auto-checks `USER_AI_ENABLED` before parse.
- Service inline: `const aiEnabled = new Token().getValue(USER_AI_ENABLED) === "true"; if (!aiEnabled) throw new Error("emailReply.ai_not_enabled");` at the top of any LLM-backed service method.
- The CLAUDE.md mandate: draft generation, classification, auto-reply decisioning must be gated; plain mailbox setup/manual fetch need not be.

**IPC handler** (`src/main-process/communication/emailMarketingIpc.ts`, `buckEmail-ipc.ts`):
- Export `registerX IpcHandlers()`. Use `registerValidatedHandler(CHANNEL, schema, async (input) => { ...; return rawData; })` (wrapper adds `{status, msg, data}` envelope). On failure `throw new Error("i18n.key")`. Register in `src/main-process/communication/index.ts` (import + call inside the try block near the other email registrars).

**Channels** (`src/config/channellist.ts`):
- `export const X = "domain:verb:sub";` UPPER_SNAKE const = colon string. Add to preload.ts whitelists: request/response → `invoke` whitelist; main→renderer push → `receive` + `removeListener`.

**Renderer API** (`src/views/api/emailservice.ts`, `buckemail.ts`):
- `windowInvoke(CHANNEL, params)` JSON-stringifies, unwraps `CommonMessage`, throws on `!status`, returns `.data`. List endpoints translate `{records, num}` → `{data, total}` (`SearchResult<T>`).

**Schemas** (`src/schemas/ipc/_shared/pagination.ts`, `src/schemas/ipc/emailTemplate.ts`):
- `lazySchema(() => z.strictObject({...}))`. Reuse `itemSearchParamSchema` for lists. Entity write-schemas in `src/schemas/entity/`.

**Vue page** (`src/views/pages/emailSendTaskLog/list.vue` + `widgets/EmailSendTaskLogTable.vue`):
- `list.vue` = thin shell rendering `<Widget/>` in `<div class="tables_page">`. Widget: `<v-data-table-server>` + `FakeAPI.fetch({page, itemsPerPage, sortBy, search})` computing `fpage = (page-1)*itemsPerPage`.

**Router** (`src/views/router/index.ts`): add child to `/emailmarketing` section `children:[]` (lines 477-644), unique `name`, `meta.title` under `route.*`, lazy `component: () => import("@/views/pages/...")`, `visible: true/false`.

**i18n** (`src/views/lang/{en,zh,es,fr,de,ja}.ts`): nested namespaces (`emailReceive.*`, `emailReply.*`, `emailAutoReplyAudit.*`, `route.*`). Every user-facing string in ALL 6 files.

---

## Phase 1 — Data And Receive Foundation

### Task 1.1: Install dependencies

**Files:** `package.json`

- [ ] Run `yarn add imapflow mailparser sanitize-html html-to-text && yarn add -D @types/sanitize-html`
- [ ] Verify `package.json` now lists the four runtime deps and the dev dep.
- [ ] Commit: `chore: add imapflow, mailparser, sanitize-html, html-to-text for email receive`

### Task 1.2: Extend `EmailServiceEntity` with receive fields

**Files:**
- Modify: `src/entity/EmailService.entity.ts`
- Modify: `src/entityTypes/emailmarketingType.ts` (extend `EmailServiceEntitydata`)

- [ ] Add the receive columns to `EmailServiceEntity` exactly per tech-design §5.1: `receiveProtocol: EmailReceiveProtocol` (default "imap"), `imapHost`, `imapPort`, `imapSsl` (default 1), `pop3Host`, `pop3Port`, `pop3Ssl` (default 1), `receiveUsername`, `receivePassword`, `receiveFolder` (default "INBOX"), `receiveEnabled` (default 0), `lastReceiveSyncAt`, `lastReceiveSyncError`. Define `export type EmailReceiveProtocol = "imap" | "pop3";` in `src/entityTypes/emailmarketingType.ts`.
- [ ] Extend `EmailServiceEntitydata` with the same receive fields (all optional except where defaulted). Keep SMTP `host/port/ssl` unchanged.
- [ ] Add a sanitized `EmailServiceReceiveSummary` type (no `password`, no `receivePassword`).
- [ ] Commit: `feat: add IMAP/POP3 receive fields to EmailService entity and types`

### Task 1.3: Update SQL reference + model + module for receive fields

**Files:**
- Modify: `src/sql/scraperdb/email_service.sql` (reference-only — add new columns to the `CREATE TABLE IF NOT EXISTS`)
- Modify: `src/model/EmailService.model.ts` (no logic change needed — repository already persists all entity columns; verify `update` uses `Object.assign` so new fields flow through)
- Modify: `src/modules/emailServiceModule.ts` — extend `validateEmailService` to validate receive fields when `receiveEnabled === 1` (require `receiveProtocol`, the matching host/port, `receiveUsername`, `receivePassword`). Add `getEmailServiceReceiveConfig(id)` returning connection config (with password) for internal use by the receive service (never returned to renderer).
- Modify: `src/controller/emailMarketingController.ts` — ensure `getEmailServiceDetail` mapping includes receive fields, and that the list DTO still excludes secrets.
- [ ] Commit: `feat: validate email service receive settings in module/controller`

### Task 1.4: New entity — `EmailReceivedMessage`

**Files:**
- Create: `src/entity/EmailReceivedMessage.entity.ts`
- Create: `src/sql/scraperdb/email_received_message.sql`
- Modify: `src/config/SqliteDb.ts` (import + add to `entities: [...]`)

- [ ] Define shared types in a new `src/entityTypes/emailReceiveTypes.ts`:
  ```ts
  export type EmailMessageClassification =
    | "interested" | "not_interested" | "unsubscribe" | "bounce"
    | "auto_reply" | "support_request" | "needs_human_review" | "unknown";
  export type EmailReplyStatus =
    | "not_started" | "draft_created" | "sent" | "skipped" | "blocked" | "failed";
  ```
- [ ] Create the entity (`@Entity("email_received_message")`) extending `AuditableEntity` with `@Index(["emailServiceId","providerUid"],{unique:true})`, `@Index(["emailServiceId","receivedAt"])`, `@Index(["messageId"])`, `@Index(["threadKey"])`, columns per tech-design §5.3 (`providerUid`, `messageId?`, `threadKey?`, `inReplyTo?`, `referencesHeader?`, `fromAddress`, `fromName?`, `replyToAddress?`, `toAddressesJson`, `ccAddressesJson?`, `subject`, `bodyText?`, `bodyHtmlSanitized?`, `snippet?`, `receivedAt`, `isUnread` default 1, `classification?`, `classificationConfidence?`, `replyStatus` default "not_started", `processedAt?`).
- [ ] Register in `SqliteDb.ts`.
- [ ] Create the reference SQL file (`CREATE TABLE IF NOT EXISTS email_received_message(...)`).
- [ ] Commit: `feat: add EmailReceivedMessage entity`

### Task 1.5: New entity — `EmailReplyDraft`

**Files:**
- Create: `src/entity/EmailReplyDraft.entity.ts` + SQL + register in `SqliteDb.ts`
- Define `EmailReplyDraftStatus = "draft"|"approved"|"sent"|"discarded"|"failed"` and `EmailReplyGenerationSource = "ai"|"manual"` in `emailReceiveTypes.ts`.
- Columns per tech-design §5.4. Index `["messageId"]`.
- [ ] Commit: `feat: add EmailReplyDraft entity`

### Task 1.6: New entity — `EmailReplyIdentityProfile`

**Files:**
- Create: `src/entity/EmailReplyIdentityProfile.entity.ts` + SQL + register.
- `@Index(["emailServiceId"],{unique:true})`. Columns per tech-design §5.5. `discloseAutomation` default 0.
- [ ] Commit: `feat: add EmailReplyIdentityProfile entity`

### Task 1.7: New entity — `EmailAutoReplyRule`

**Files:**
- Create: `src/entity/EmailAutoReplyRule.entity.ts` + SQL + register.
- Columns per tech-design §5.6 (stored now, auto-send disabled in MVP).
- [ ] Commit: `feat: add EmailAutoReplyRule entity`

### Task 1.8: New entity — `EmailReplyAuditLog`

**Files:**
- Create: `src/entity/EmailReplyAuditLog.entity.ts` + SQL + register.
- Define `EmailReplyAuditAction` and `actor` unions in `emailReceiveTypes.ts`. Columns per tech-design §5.7. Index `["emailServiceId","createdAt"]`.
- [ ] Commit: `feat: add EmailReplyAuditLog entity`

### Task 1.9: New entity — `EmailAutoReplyAuditLog`

**Files:**
- Create: `src/entity/EmailAutoReplyAuditLog.entity.ts` + SQL + register.
- Define `EmailAutoReplyDecisionStatus` and `EmailAutoReplyAuditAction` unions in `emailReceiveTypes.ts`. Columns + indexes per tech-design §5.8.
- [ ] Commit: `feat: add EmailAutoReplyAuditLog entity`

### Task 1.10: Models for the 6 new entities

**Files:** Create `src/model/EmailReceivedMessage.model.ts`, `EmailReplyDraft.model.ts`, `EmailReplyIdentityProfile.model.ts`, `EmailAutoReplyRule.model.ts`, `EmailReplyAuditLog.model.ts`, `EmailAutoReplyAuditLog.model.ts`. Mirror `emailMarketingSendLog.model.ts`.

- [ ] `EmailReceivedMessageModel`: `upsertByProviderUid(entity)` (find by unique `(emailServiceId,providerUid)`, merge non-secret local state like `replyStatus`/`classification` on existing, else insert), `read(id)`, `listByEmailService({emailServiceId, page, size, where?, sortby?, unreadOnly?, replyStatus?, classification?})` + count, `updateReplyStatus(id, status, processedAt?)`, `updateClassification(id, classification, confidence)`, `markRead(id)`.
- [ ] `EmailReplyDraftModel`: `create`, `read`, `updateStatus(id, status, error?)`, `updateBody(id, bodyText, bodyHtml?)`, `listByMessage(messageId)`, `listByEmailService` paginated.
- [ ] `EmailReplyIdentityProfileModel`: `getByEmailServiceId(id)`, `upsertForEmailService(entity)`.
- [ ] `EmailAutoReplyRuleModel`: `listByEmailService`, `read`, `create`, `update`.
- [ ] `EmailReplyAuditLogModel`: `create`, `list(input)` paginated.
- [ ] `EmailAutoReplyAuditLogModel`: `create`, `list(input)` paginated with filters `{emailServiceId?, decisionStatus?, classification?, senderSearch?, dateStart?, dateEnd?, search?, page, size, sortby}`, `readWithRelations(id)` (joins message + draft previews), plus `countSendsToday(emailServiceId)` and `countByThread(emailServiceId, threadKey)` for policy.
- [ ] Create one zod write-schema per entity under `src/schemas/entity/` (`emailReceivedMessage.ts`, `emailReplyDraft.ts`, `emailReplyIdentityProfile.ts`, `emailAutoReplyRule.ts`, `emailReplyAuditLog.ts`, `emailAutoReplyAuditLog.ts`).
- [ ] Commit per logical group (e.g. one commit per 2-3 models with their schemas).

### Task 1.11: Modules for the 6 new entities

**Files:** Create `src/modules/EmailReceivedMessageModule.ts`, `EmailReplyDraftModule.ts`, `EmailReplyIdentityProfileModule.ts`, `EmailAutoReplyRuleModule.ts`, `EmailReplyAuditLogModule.ts`, `src/modules/EmailAutoReplyAuditLogModule.ts`. Mirror `emailMarketingSendLogModule.ts`.

- [ ] Each `extends BaseModule`, constructor binds its model(s) with `this.dbpath`, thin try/catch wrappers returning `ListData<T>` for lists. Define interfaces in `src/modules/interface/`.
- [ ] Commit per logical group.

### Task 1.12: Receive client service — interface + factory + IMAP

**Files:**
- Create: `src/service/emailReceive/EmailReceiveTypes.ts` (`EmailReceiveConnectionConfig`, `EmailReceiveFetchOptions`, `ParsedInboundEmail` per tech-design §7.2)
- Create: `src/service/emailReceive/EmailReceiveClient.ts` (interface)
- Create: `src/service/emailReceive/ImapEmailReceiveClient.ts` (ImapFlow impl)
- Create: `src/service/emailReceive/Pop3EmailReceiveClient.ts` (stub — throws "POP3 not supported in MVP" but compiles; honours interface)
- Create: `src/service/emailReceive/EmailReceiveClientFactory.ts` (`createClient(protocol)`)

- [ ] `ImapEmailReceiveClient`:
  - `testConnection(config)`: open+close a `ImapFlow` client in a `try/finally`; throw on auth/connect failure.
  - `fetchMessages(config, options)`: connect, `mailbox.open(config.folder)`, search (unreadOnly → `UNSEEN`, else bounded recent), cap at `limit` (max 50), fetch envelopes + source, parse each with `mailparser.simpleParser`, build `ParsedInboundEmail` (providerUid from UID, messageId from `Message-ID`, threadKey from `References`/first `In-Reply-To`/`messageId`, sanitize HTML via `EmailHtmlSanitizer`, snippet = first 280 chars of text). Close in `finally`.
  - Never imports entities/models/TypeORM. Pure network+parse.
- [ ] Commit: `feat: add IMAP receive client (ImapFlow) with connection test and bounded fetch`

### Task 1.13: HTML sanitizer + message parser helpers

**Files:**
- Create: `src/service/emailReceive/EmailHtmlSanitizer.ts` — `sanitizeEmailHtml(html): string` using `sanitize-html` with disabled scripts/forms/event handlers, stripped tracking pixels (`img` with `width/height=1` or known pixel domains), remote images allowed but flagged; `htmlToPlainText(html): string` via `html-to-text`.
- Create: `src/service/emailReceive/EmailMessageParser.ts` — `extractThreadKey(messageId, inReplyTo, references)`, `buildSnippet(text, max=280)`, `extractRecipients(headers)`.
- [ ] Commit: `feat: add email HTML sanitizer and message parsing helpers`

### Task 1.14: Receive sync service + connection test + IPC

**Files:**
- Create: `src/service/emailReceive/EmailReceiveSyncService.ts`
- Modify: `src/config/channellist.ts` (add channels below)
- Modify: `src/preload.ts` (add to `invoke` whitelist)
- Create: `src/schemas/ipc/emailReceive.ts`
- Create: `src/main-process/communication/emailReceive-ipc.ts`
- Modify: `src/main-process/communication/index.ts` (register)

- [ ] Channels: `EMAIL_RECEIVE_SYNC="email:receive:sync"`, `EMAIL_RECEIVE_CONNECTION_TEST="email:receive:connection:test"`, `EMAIL_RECEIVE_MESSAGE_LIST="email:receive:message:list"`, `EMAIL_RECEIVE_MESSAGE_DETAIL="email:receive:message:detail"`, `EMAIL_REPLY_MARK_PROCESSED="email:reply:mark:processed"`, `EMAIL_REPLY_IDENTITY_GET="email:reply:identity:get"`, `EMAIL_REPLY_IDENTITY_UPDATE="email:reply:identity:update"`, `EMAIL_REPLY_DRAFT_DETAIL="email:reply:draft:detail"`, `EMAIL_REPLY_DRAFT_UPDATE="email:reply:draft:update"`, `EMAIL_REPLY_SEND="email:reply:send"`, `EMAIL_AUTO_REPLY_AUDIT_LIST="email:autoreply:audit:list"`, `EMAIL_AUTO_REPLY_AUDIT_DETAIL="email:autoreply:audit:detail"`, `EMAIL_REPLY_DRAFT_CREATE="email:reply:draft:create"` (AI-gated).
- [ ] `EmailReceiveSyncService.syncUnread(emailServiceId, options)`:
  1. Load receive config via `EmailServiceModule.getEmailServiceReceiveConfig(id)` (main-only; credentials never leave main).
  2. `const client = EmailReceiveClientFactory.createClient(config.receiveProtocol)`.
  3. `const parsed = await client.fetchMessages(config, {limit: clamp(limit,1,50), unreadOnly, since})`.
  4. For each, `EmailReceivedMessageModule.upsertByProviderUid(...)` (dedupe by `(emailServiceId, providerUid)`).
  5. `EmailServiceModule` update `lastReceiveSyncAt`; on error set `lastReceiveSyncError` (sanitized) and rethrow.
  6. Write `EmailReplyAuditLog` rows (`message_fetched`, actor `system`) — no body, just metadata.
  7. Return `{emailServiceId, fetched, stored, messageIds}`.
- [ ] `EmailReceiveSyncService.testConnection(emailServiceId)` → `client.testConnection(config)`; return `{success, error?}`; do NOT mutate stored error on test.
- [ ] IPC: `EMAIL_RECEIVE_SYNC` (validated, NOT AI-gated — plain fetch), `EMAIL_RECEIVE_CONNECTION_TEST` (validated, not AI-gated), `EMAIL_RECEIVE_MESSAGE_LIST` (validated, paginated, sanitized — no body by default), `EMAIL_RECEIVE_MESSAGE_DETAIL` (validated, returns sanitized body), `EMAIL_REPLY_MARK_PROCESSED` (validated), `EMAIL_REPLY_IDENTITY_GET/UPDATE` (validated). All call modules, never repositories.
- [ ] Commit: `feat: add email receive sync service and IPC handlers`

### Task 1.15: Phase 1 tests

**Files:** `test/vitest/main/` + `test/vitest/utilitycode/` per CLAUDE.md test placement.

- [ ] Model test: `EmailReceivedMessageModel.upsertByProviderUid` dedupes by `(emailServiceId, providerUid)` (mocked repository or in-memory better-sqlite3).
- [ ] Module test: `EmailReceiveSyncService` stores parsed messages without duplicates; connection error updates `lastReceiveSyncError`.
- [ ] Service test: `EmailHtmlSanitizer` strips `<script>`, event handlers, and 1x1 pixel `<img>`; `htmlToPlainText` returns text.
- [ ] Service test: `ImapEmailReceiveClient.fetchMessages` maps parsed messages correctly using a mocked ImapFlow client.
- [ ] Commit: `test: cover email receive model, sync service, sanitizer, and IMAP client`

---

## Phase 2 — AI Tool Surface And Knowledge Integration

### Task 2.1: `EmailReceiveAiTypes` — schemas + result DTOs

**Files:** Create `src/entityTypes/emailReceiveAiTypes.ts`.

- [ ] Define zod input schemas (mirror `emailMarketingAiTypes.ts`): `listEmailInboxesSchema` (page/size/search), `fetchUnreadEmailsSchema` (`email_service_id` int positive, `folder?`, `limit?` 1-50 default 10, `unread_only?` default true, `since?` ISO string), `getEmailMessageSchema` (`message_id` int, `include_body?`), `createEmailReplyDraftSchema` (`message_id`, `tone?`, `goal?`, `extra_instructions?`, `use_knowledge_library?` default true), `sendEmailReplySchema` (`draft_id`, `email_service_id?`), `markEmailProcessedSchema` (`message_id`, `status` enum, `reason?`).
- [ ] Define result interfaces (`AiEmailInboxSummary`, `AiEmailMessageSummary`, `AiEmailMessageDetail`, `AiEmailReplyDraftResult`, `EmailReplyKnowledgeSource`) per PRD §9. Reuse `EmailMarketingAiToolResult<T>` envelope.
- [ ] Commit: `feat: add email receive AI tool schemas and result types`

### Task 2.2: `EmailReceiveAiTools` service — read tools

**Files:** Create `src/service/EmailReceiveAiTools.ts`.

- [ ] `listEmailInboxes(args)`: list email services where `receiveEnabled === 1`, map to `AiEmailInboxSummary` (no secrets). AI gate NOT required (read-only metadata).
- [ ] `fetchUnreadEmails(args)`: call `EmailReceiveSyncService.syncUnread` then return stored `AiEmailMessageSummary[]` (no bodies). Log `message_read_by_ai` audit. NOT AI-gated (fetch itself isn't LLM work), but mailbox read is audit-logged.
- [ ] `getEmailMessage(args)`: load message, return `AiEmailMessageDetail` with sanitized body (strip scripts/pixels), no attachments. Audit `message_read_by_ai`.
- [ ] `markEmailProcessed(args)`: update `replyStatus`, write audit row.
- [ ] Each follows the standard envelope + `validationFailure`/`failure` pattern.
- [ ] Commit: `feat: add EmailReceiveAiTools read tools (inboxes, messages, processed)`

### Task 2.3: `EmailReplyKnowledgeService`

**Files:** Create `src/service/emailReply/EmailReplyKnowledgeService.ts`.

- [ ] `retrieveReplyKnowledge({message, goal?, classification?, limit=5, useKnowledgeLibrary})`:
  - If `useKnowledgeLibrary === false` → return `{sources:[], warning:"disabled-by-caller"}`.
  - Build query string from `subject + sanitized bodyText (first ~500 chars) + senderName + goal`.
  - `const mod = new RagSearchModule(); const res = await mod.searchKnowledgeForTool({query, limit: clamp(limit,1,10), includeNeighborChunks: true})`.
  - Map `res.results` → `EmailReplyKnowledgeSource[]` (`{chunkId, documentId, documentName, documentTitle?, content (trimmed to ~800 chars), score}`) and `EmailReplyKnowledgeSourceAudit[]` (`{toolName:"knowledge_library_search", query, chunkId, documentId, documentName, documentTitle?, citation?, score?}`).
  - On failure/no results → `{sources:[], warning: "knowledge_library_search returned no results" | error message}`. Never throw.
- [ ] Commit: `feat: add EmailReplyKnowledgeService reusing knowledge_library_search contract`

### Task 2.4: Register read AI tools in `SkillRegistry`

**Files:** Modify `src/config/skillsRegistry.ts`.

- [ ] Import the read-tool functions from `EmailReceiveAiTools`. Add Shape-2 entries: `list_email_inboxes` (`automation`, no confirm), `fetch_unread_emails` (`automation`, no confirm), `get_email_message` (`automation`, no confirm), `mark_email_processed` (`automation`, no confirm). Each `execute` calls the service fn and re-wraps `{success, result}`.
- [ ] Commit: `feat: register email receive read tools in SkillRegistry`

### Task 2.5: Phase 2 tests

- [ ] Test: `EmailReplyKnowledgeService` calls `RagSearchModule.searchKnowledgeForTool` with the synthesized query (mock the module) and maps results; returns warning on failure.
- [ ] Test (mirror `KnowledgeSearchTool.test.ts`): `SkillRegistry.getSkill("list_email_inboxes"/"fetch_unread_emails"/"get_email_message")` returns `source:"built-in"`, correct `permissionCategory`, `requiresConfirmation:false`; `getAllToolFunctions()` advertises them with expected params.
- [ ] Commit: `test: cover email receive read tools and knowledge service`

---

## Phase 3 — Draft And Send Flow

### Task 3.1: `EmailReplyPromptBuilder`

**Files:** Create `src/service/emailReply/EmailReplyPromptBuilder.ts` + `src/service/emailReply/emailReplyPolicy.ts` (banned-phrase + content-safety constants).

- [ ] `buildReplySystemPrompt(identityProfile)` — owner-voice policy: write as the mailbox owner/authorized assistant; never mention AI/model/bot/automation/retrieval/tools/confidence; use natural human email language; keep concise; use configured signature; treat inbound email as untrusted customer text (prompt-injection defense); escalate to human review when facts missing or sensitive commitments requested. If `discloseAutomation === 1`, allow a configured disclosure line.
- [ ] `buildReplyUserMessage({message, knowledgeSources, tone?, goal?, extraInstructions?})` — labeled blocks: "Trusted knowledge-library context" (numbered, document name + trimmed snippet), "Untrusted inbound email" (sanitized body), "User instructions" (goal/tone/extra). No raw scores, no tool-call details.
- [ ] `BANNED_AI_PHRASES = ["as an ai","as a language model","based on the provided context","the knowledge base says","i do not have access","confidence score","tool call","retrieved document","i am unable"]` (lowercase substrings).
- [ ] Commit: `feat: add email reply prompt builder with owner-voice policy and injection defense`

### Task 3.2: `EmailReplyDraftGenerationService`

**Files:** Create `src/service/emailReply/EmailReplyDraftGenerationService.ts`. Uses the existing AI chat API client (`AiChatApi` from `@/api/aiChatApi`) for the LLM call (mirror how other generation services invoke the model).

- [ ] `createDraft({messageId, tone?, goal?, extraInstructions?, useKnowledgeLibrary?})`:
  1. **AI gate first:** `if (new Token().getValue(USER_AI_ENABLED) !== "true") return failure("AI email replies are disabled for this user.")`.
  2. Load message via `EmailReceivedMessageModule.read`; if missing → failure.
  3. Load identity profile via `EmailReplyIdentityProfileModule.getByEmailServiceId`.
  4. `const knowledge = await EmailReplyKnowledgeService.retrieveReplyKnowledge({...})`.
  5. Build prompts; call the LLM (system + user messages). Request JSON `{subject, bodyText, confidence?, classification?}`.
  6. **Validate output:** subject non-empty & ≤200 chars; body non-empty; `containsBannedPhrase(body)` → either strip/regenerate or set `warnings`; recipient valid.
  7. Persist `EmailReplyDraft` (`generationSource:"ai"`, `status:"draft"`, `modelName`, `promptVersion`, `confidence`, `knowledgeSourcesJson`, `ownerStyleProfileJson`, `warningsJson`).
  8. Update `EmailReceivedMessage.replyStatus = "draft_created"` + `classification/confidence` if returned.
  9. Write `EmailReplyAuditLog` (`draft_created`, actor `ai`) and `EmailAutoReplyAuditLog` rows (`draft_created` decisionStatus, `knowledgeQuery`, `knowledgeSourcesJson` summary, `generatedSubject`, `generatedBodyPreview` truncated, `requiresUserApproval:1`).
  10. Return `AiEmailReplyDraftResult` (NO knowledge source names in the *email body* — they only appear in the result DTO for UI/audit).
- [ ] Commit: `feat: add knowledge-grounded reply draft generation with AI gate and validation`

### Task 3.3: `ReplyEmailService` (nodemailer reply send)

**Files:** Modify: `src/modules/lib/emailService.ts` (add `sendReplyEmail`) OR create `src/modules/lib/replyEmailService.ts`.

- [ ] `sendReplyEmail(serviceConfig: EmailServiceEntitydata, data: ReplyEmailRequestData): Promise<EmailSendResult>` where `ReplyEmailRequestData = {receiver, subject, text, html?, inReplyTo?, references?}`. Uses `nodemailer` with `from`, `to`, `subject`, `text`, `html`, `inReplyTo`, `references`. Reply subject prefixed `Re:` if not already. Receiver from `replyToAddress` or `fromAddress`.
- [ ] Commit: `feat: add reply email send with In-Reply-To/References headers`

### Task 3.4: `create_email_reply_draft` + `send_email_reply` tools

**Files:** Modify `src/service/EmailReceiveAiTools.ts`; modify `src/config/skillsRegistry.ts`.

- [ ] `createEmailReplyDraft(args)` in service → delegates to `EmailReplyDraftGenerationService` (which has the AI gate). Returns `AiEmailReplyDraftResult`.
- [ ] `sendEmailReply(args)` in service:
  1. Load draft; verify it belongs to a received message and `status ∈ {draft, approved, failed}`.
  2. Resolve `email_service_id` (from args or draft); load service config; verify `status === 1` (active).
  3. Resolve recipient (draft.message.replyToAddress || fromAddress).
  4. `ReplyEmailService.sendReplyEmail(...)` with `inReplyTo/references` from stored message.
  5. On success: `draft.status="sent"`, `draft.sentAt=now`; `message.replyStatus="sent"`, `message.processedAt=now`; write `EmailReplyAuditLog` (`reply_sent`, actor per caller) + `EmailAutoReplyAuditLog` (`auto_reply_sent` or approval send, `sentSubject`, `sentBodyPreview`, `approvedByUser:1`).
  6. On failure: `draft.status="failed"`, `draft.sendError=sanitized`; `message.replyStatus="failed"`; write `send_failed`/`auto_reply_failed` audit. Do NOT mark message sent.
- [ ] Register `create_email_reply_draft` (`automation`, **no confirm** — only creates draft) and `send_email_reply` (`automation`, **`requiresConfirmation: true`** — Phase 1 mandate).
- [ ] Commit: `feat: add create_email_reply_draft and send_email_reply AI tools`

### Task 3.5: Draft + send IPC handlers + AI gate

**Files:** Modify `src/main-process/communication/emailReceive-ipc.ts`; schemas in `src/schemas/ipc/emailReceive.ts` + `src/schemas/ipc/emailReply.ts`.

- [ ] `EMAIL_REPLY_DRAFT_CREATE` → **use `registerAiValidatedHandler`** (AI gate at the IPC boundary, double safety). Delegates to controller/module → generation service.
- [ ] `EMAIL_REPLY_DRAFT_DETAIL` (validated), `EMAIL_REPLY_DRAFT_UPDATE` (validated — user edits draft body), `EMAIL_REPLY_SEND` (validated — UI send button).
- [ ] Commit: `feat: add AI-gated draft create + reply send IPC handlers`

### Task 3.6: Phase 3 tests

- [ ] Test: prompt builder output contains no banned phrases and labels email as untrusted.
- [ ] Test: `EmailReplyDraftGenerationService` checks AI gate (returns failure when `USER_AI_ENABLED !== "true"`), writes draft + audit rows (mocked modules + mocked LLM), rejects banned-phrase body with a warning.
- [ ] Test (skill): `send_email_reply` has `requiresConfirmation: true`; `create_email_reply_draft` has `requiresConfirmation: false`. Unknown message/draft IDs return structured failures.
- [ ] Commit: `test: cover draft generation, prompt builder, and reply send skill flags`

---

## Phase 4 — UI And i18n

### Task 4.1: Renderer APIs

**Files:** Create `src/views/api/emailreceive.ts`, `src/views/api/emailreply.ts`.

- [ ] Functions per tech-design §15.1: `listReceiveEnabledEmailServices`, `testEmailReceiveConnection`, `syncUnreadEmails`, `listReceivedMessages`, `getReceivedMessage`, `createEmailReplyDraft`, `getEmailReplyDraft`, `updateEmailReplyDraft`, `sendEmailReply`, `markEmailProcessed`, `getReplyIdentityProfile`, `updateReplyIdentityProfile`, `listAutoReplyAuditLogs`, `getAutoReplyAuditLog`. All via `windowInvoke`; lists translate `{records,num}`→`{data,total}`.
- [ ] Commit: `feat: add renderer APIs for email receive and reply`

### Task 4.2: Receive settings UI in service detail

**Files:** Modify `src/views/pages/emailservice/servicedetail.vue`.

- [ ] Add a "Receive Settings" section (collapsible): receive protocol toggle (IMAP/POP3), IMAP host/port/SSL, POP3 host/port/SSL, receive username/password (show/hide), folder (default INBOX), `receiveEnabled` toggle, fetch options (unread only, max per sync, lookback window). "Test Receive Connection" button calling `testEmailReceiveConnection`. Persisted via existing `createupdateEmailService` (now carrying receive fields).
- [ ] Commit: `feat: add receive settings section to email service detail UI`

### Task 4.3: Received message list + detail pages

**Files:** Create `src/views/pages/emailreceive/list.vue` + `widgets/ReceivedMessageTable.vue` + `detail.vue`. Add routes.

- [ ] `ReceivedMessageTable.vue`: `v-data-table-server`, columns inbox/from/subject/receivedAt/read/AI classification/reply status/last action; filters unread/needs reply/draft/sent/skipped/blocked/human review; "Sync" button → `syncUnreadEmails`.
- [ ] `detail.vue`: sanitized body (remote images disabled), sender/reply-to, subject, thread ids, knowledge snippets used, AI summary, classification, draft preview, buttons Generate/Regenerate/Edit draft/Send/Mark processed/Skip.
- [ ] Routes under `/emailmarketing`: `emailreceive/list` (visible), `emailreceive/detail/:id(\d+)` (hidden).
- [ ] Commit: `feat: add received message list and detail UI`

### Task 4.4: Draft review/edit page

**Files:** Create `src/views/pages/emailreply/draftdetail.vue` + `widgets/ReplyDraftEditor.vue` + `widgets/ReplyIdentityProfileForm.vue`.

- [ ] `ReplyDraftEditor.vue`: editable subject + body (text + optional HTML), knowledge sources panel, warnings, Send button (confirmation dialog), Regenerate.
- [ ] `ReplyIdentityProfileForm.vue`: owner name/role/company/tone/signature/style notes/forbidden phrases/disclose automation.
- [ ] Route `emailreply/draft/:id(\d+)` (hidden).
- [ ] Commit: `feat: add reply draft editor and identity profile form`

### Task 4.5: AI auto-reply audit list + detail

**Files:** Create `src/views/pages/emailreply/auditlist.vue` + `widgets/AutoReplyAuditTable.vue` + `auditdetail.vue`.

- [ ] `AutoReplyAuditTable.vue`: columns createdAt/decisionStatus/emailService/fromAddress/subject/classification/confidence/reason/requiresUserApproval/approvedByUser/errorMessage. Filters: emailServiceId, decisionStatus, classification, sender, date range, search. `v-data-table-server` + `FakeAPI.fetch` adapter.
- [ ] `auditdetail.vue`: original message metadata + sanitized body preview, generated draft preview, sent reply preview, knowledge query + source summary, decision reason, approval status, error.
- [ ] Routes `emailreply/audit/list` (visible — "AI Auto Replies") + `emailreply/audit/detail/:id(\d+)` (hidden).
- [ ] Commit: `feat: add AI auto-reply audit list and detail UI`

### Task 4.6: i18n — all 6 languages

**Files:** Modify `src/views/lang/{en,zh,es,fr,de,ja}.ts`.

- [ ] Add namespaces `emailReceive.*`, `emailReply.*`, `emailAutoReplyAudit.*`, and `route.email_receive`, `route.email_receive_detail`, `route.ai_auto_replies`, `route.ai_auto_reply_detail`. English first; then translate zh/es/fr/de/ja. All keys present in all 6 files.
- [ ] Commit: `feat: add i18n entries for email receive/reply in all six languages`

### Task 4.7: Phase 4 tests

- [ ] Test: all new translation keys exist in all 6 locale files (a vitest that imports each locale and asserts the key paths).
- [ ] Test: `AutoReplyAuditTable` filters call API with correct params (component test, mocked API).
- [ ] Commit: `test: cover email receive/reply i18n completeness and audit table`

---

## Phase 5 — Auto-Reply Policy Foundation (disabled-by-default)

### Task 5.1: `EmailAutoReplyPolicyService`

**Files:** Create `src/service/emailReply/EmailAutoReplyPolicyService.ts`.

- [ ] `evaluate({message, classification, confidence, rule, sendCounts})` → `EmailAutoReplyPolicyDecision {status, reason, canSendAutomatically}`.
- [ ] Hard blocks per tech-design §13.3: no-reply/mailer-daemon/postmaster/do-not-reply senders; `Auto-Submitted != "no"`, `Precedence ∈ {bulk,junk,list}`, DSN, bounce classification; confidence < threshold; daily/per-thread limits; sensitive-request keywords.
- [ ] MVP: `canSendAutomatically` is always `false` (Phase 1 mandates confirmation). Every evaluation writes an `EmailAutoReplyAuditLog` row (`auto_reply_evaluated` + decision status + reason).
- [ ] Commit: `feat: add auto-reply policy evaluator (auto-send disabled in MVP)`

### Task 5.2: Loop-prevention guards + rule module wiring

- [ ] `EmailAutoReplyRuleModule` CRUD + `getEffectiveRule(emailServiceId)` (first enabled rule).
- [ ] Send counters from `EmailAutoReplyAuditLogModel` (`countSendsToday`, `countByThread`).
- [ ] Wire `evaluate()` into the draft-generation flow as dry-run only: it records a `blocked`/`skipped`/`approval_required` audit row when policy would block, but never sends. Auto-send stays off.
- [ ] Commit: `feat: wire auto-reply policy dry-run into draft flow`

### Task 5.3: Phase 5 tests

- [ ] Test: policy blocks no-reply senders, automated headers, bounce classification, low confidence; produces correct `reason`; MVP `canSendAutomatically` always false.
- [ ] Commit: `test: cover auto-reply policy evaluator hard blocks`

---

## Cross-Cutting Verification (run before declaring done)

- [ ] `yarn vue-check` passes (renderer types).
- [ ] `yarn tsc` passes (main types).
- [ ] `yarn testmain` passes; new tests green. (If type errors, fix — do not commit `AIFETCHLY_SKIP_TSC`.)
- [ ] No `any` introduced (grep new files).
- [ ] No secrets in any DTO / AI tool result / audit row (grep for `password`/`receivePassword`/`token` in new model→DTO mapping).
- [ ] `send_email_reply` requires confirmation; `create_email_reply_draft` does not (test asserts).
- [ ] Every AI-serving IPC handler uses `registerAiValidatedHandler` or the service checks the gate.
- [ ] All 6 locale files contain every new key.
- [ ] New entities registered in `SqliteDb.ts` `entities: []`.

## Notes On Worker Process

The MVP runs IMAP fetch in the main process (bounded limit ≤50, `try/finally` connection close). The `EmailReceiveClient` interface is the seam: if sync is ever shown to block the UI, a `src/childprocess/emailReceiveWorker.ts` will be added later that calls the same client and posts `ParsedInboundEmail[]` to main, which persists through modules. The worker will import NOTHING from `src/model`/`src/entity`/`src/modules` (per CLAUDE.md worker rule). This is deferred — not needed for MVP bounded fetch.
