# Technical Design: Safe AI Email Variable Resolution

**Date:** 2026-09-04

**Status:** Proposed

**PRD:** [2026-09-03-ai-email-placeholder-resolution-prd.md](2026-09-03-ai-email-placeholder-resolution-prd.md)

**Primary runtime:** Electron main process, AI Chat V2, email worker

**Primary tool:** `start_email_send_task`

## 1. Design Summary

Add deterministic email preflight and rendering around AI-initiated outbound email. The model receives safe sender context and instructions, but the main process remains authoritative. A send cannot proceed unless every supported variable resolves for every possible sender, template, and recipient combination and no unknown or legacy placeholder remains.

The implementation has five layers:

1. A shared variable registry and pure parser/renderer.
2. A main-process preflight Module that loads trusted data through existing Modules.
3. A read-only skill preflight hook that builds the final permission preview before confirmation.
4. A second preflight and fingerprint comparison after approval, immediately before task creation.
5. An immutable render snapshot passed to the worker so the worker never reads the database and never sends content different from the confirmed preview.

The design extends AiFetchly's existing `{$variable_name}` syntax. It does not add a competing placeholder language.

## 2. Documentation Scope

This document combines two forms of technical documentation:

- **Reference:** proposed types, service interfaces, error contracts, data fields, and file ownership.
- **Explanation:** execution flow, trust boundaries, design decisions, failure handling, compatibility, and trade-offs.

It does not serve as an implementation task list. A separate implementation plan should divide this design into atomic, test-driven changes after review.

## 3. Current Architecture

### 3.1 AI tool registration

`src/config/skillsRegistry.ts` registers `start_email_send_task` as a built-in tool with:

- `requiresConfirmation: true`
- `permissionCategory: "automation"`
- `timeoutClass: "fast"`
- Inline content fields `email_subject` and `email_html_content`
- Saved template selection through `template_ids`
- Direct recipients through `emails`
- Search-task recipients through `email_search_task_id`

The tool delegates to `startBulkEmailSendTask()` in `src/service/EmailMarketingAiTools.ts`.

### 3.2 Current tool permission flow

`SkillExecutor.execute()` currently performs these steps:

```text
Resolve registered skill
  -> validate generic arguments
  -> check permission
  -> if permission is missing, return needsPermissionPrompt
  -> after approval, run the tool again with skipPermissionCheck=true
  -> execute the tool
```

`AIChatQueryEngine` keeps the pending tool name and original arguments in memory. `ai-chat-v2-ipc.ts` resumes the pending tool after the renderer invokes `AI_CHAT_V2_RESUME_TOOL_AFTER_PERMISSION`.

The current optional `buildPermissionPreview()` hook is synchronous and display-only. Its `PermissionPreview` type supports only `kind: "file_transfer"`. It cannot load templates, sender profiles, services, or search-task recipients before showing confirmation.

### 3.3 Current outbound email service flow

`startBulkEmailSendTask()` currently:

1. Parses `bulkEmailTaskInputSchema`.
2. Resolves direct or search-task recipients.
3. Creates `BuckEmailTaskModule`.
4. Converts the input to `Buckemailstruct`.
5. Calls `startBuckEmailCampaign()`.
6. Returns as soon as the background worker starts.

The schema verifies input shape and length but does not inspect placeholders.

### 3.4 Current task and worker flow

`BuckEmailTaskModule` persists an email task, template relations, service relations, and filter relations. `prepareData()` later reloads recipients, templates, filters, and SMTP services and passes them to `src/childprocess/emailSend.ts`.

The worker randomly selects a sender and template for each recipient. It calls `convertVariableInTemplate()` from `src/views/utils/emailFun.ts`, then sends through `EmailService`.

This creates four gaps:

1. Shared worker logic lives under `src/views/`, even though it is not renderer-only code.
2. The registry lists more variables than `convertVariableInTemplate()` replaces.
3. Missing values such as `Url` and `Description` currently become empty strings.
4. The worker can load template or recipient data after confirmation, so later edits could change what is sent.

### 3.5 Current sender identity storage

`EmailReplyIdentityProfileEntity` already stores one identity profile per email service:

- `ownerName`
- `ownerRole`
- `companyName`
- `preferredTone`
- `signature`
- `styleNotes`
- `forbiddenPhrasesJson`
- `discloseAutomation`

`EmailReplyIdentityProfileModel` and `EmailReplyIdentityProfileModule` already enforce the Model/Module database boundary. IPC schemas, a renderer API, and translated labels also exist. The current email-service editor does not render an identity-profile form.

The SMTP service remains the authoritative source for the From address.

## 4. Requirements Traceability

| PRD area                    | Technical mechanism                                          |
| --------------------------- | ------------------------------------------------------------ |
| Trusted sender data         | Existing per-service identity profile plus SMTP From address |
| Canonical variables         | Expanded `EMAIL_TEMPLATE_VARIABLES` registry                 |
| Prompt behavior             | Dedicated outbound email prompt policy section               |
| Deterministic enforcement   | Pure parser/renderer plus main-process preflight Module      |
| Missing values              | Typed blocking result with variable and recipient details    |
| Legacy placeholders         | Markdown-aware and HTML-aware detector                       |
| Final confirmation          | New email permission-preview variant                         |
| Stale confirmation          | SHA-256 fingerprint checked after approval                   |
| Worker database prohibition | Immutable render snapshot supplied by main process           |
| Saved templates             | Snapshot selected template title/body during preflight       |
| Bulk recipient validation   | Set-based completeness analysis over all recipients          |
| UI translations and tests   | Six locale files plus component and E2E coverage             |

## 5. Approaches Considered

### 5.1 Prompt instructions only

Add stronger wording to the system prompt and tool description.

**Advantages**

- Small change.
- Helps the model avoid obvious placeholders.

**Rejected because**

- A model can still ignore or misunderstand the instruction.
- Saved templates bypass model generation.
- Scheduled or resumed tool calls can reach the same send path.
- There is no deterministic proof that content is complete.

Completeness: 3/10.

### 5.2 Validate only inside `startBulkEmailSendTask()`

Run placeholder validation after approval, immediately before task creation.

**Advantages**

- Blocks unsafe sends.
- Keeps the change localized to email tooling.

**Rejected as the complete solution because**

- The confirmation card still displays raw arguments rather than resolved content.
- The user approves without seeing the final sender identity or personalization.
- Template and recipient data must still be loaded again later.

Completeness: 7/10.

### 5.3 Read-only skill preflight plus immutable render snapshot

Run email-specific preflight after generic input validation but before the permission decision. Return a typed email preview with the permission request. After approval, re-run preflight, compare a confirmation fingerprint, then persist the exact render sources used for the approved task.

**Advantages**

- The user sees resolved content before approval.
- The main process blocks prompt failures.
- Stale profile, template, or recipient data cannot silently change the send.
- The worker remains database-free.
- The same preflight can serve inline content and saved templates.

**Trade-off**

- Adds a generic asynchronous preflight extension to the skill runtime.
- Requires a render snapshot in the email task.

Completeness: 10/10. This is the selected design.

## 6. Target Architecture

```text
User request
  |
  v
AI Chat V2 prompt assembly
  |  safe identity summary + canonical variable policy
  v
Model calls start_email_send_task
  |
  v
SkillExecutor
  |  generic schema/argument validation
  v
SkillDefinition.preflight()
  |
  v
EmailSendPreflightModule -------------------------------+
  |                                                     |
  +--> EmailServiceModule --------------------------+   |
  +--> EmailReplyIdentityProfileModule ------------+|   |
  +--> EmailTemplateModule ------------------------+|   |
  +--> EmailSearchTaskModule ----------------------+|   |
  |                                                ||   |
  v                                                ||   |
EmailVariableResolver (pure) <---------------------++   |
  |                                                     |
  +--> blocked result -> model asks user                 |
  |                                                     |
  +--> success -> EmailSendPermissionPreview             |
                       |                                 |
                       v                                 |
                 User confirmation                       |
                       |                                 |
                       v                                 |
                 Re-run preflight                        |
                       |                                 |
                 Compare fingerprint                     |
                       |                                 |
                       v                                 |
                 BuckEmailTaskModule                     |
                       |  persist immutable render plan  |
                       v                                 |
                 utility worker payload <----------------+
                       |
                       v
                 EmailVariableResolver (pure)
                       |
                 final unresolved assertion
                       |
                       v
                 SMTP send
```

## 7. Trust Boundaries

### 7.1 Trusted data

- Sender email from the selected `EmailServiceEntity.from`.
- Sender name, role, company, phone, website, and signature from the identity profile for that service.
- Recipient email, title/name, and source from the normalized recipient record.
- Saved template title and content loaded through `EmailTemplateModule`.
- Campaign metadata loaded through main-process Modules.
- A literal commercial value explicitly supplied by the user and included in final content.

### 7.2 Untrusted data

- Model-generated subject and body.
- Saved template text until parsed and validated.
- Recipient names, company names, and source text imported from scraping.
- Legacy placeholder-like text.
- Tool arguments produced by the model.

Untrusted means the data may be used as content after validation. It must never become an instruction that bypasses policy.

### 7.3 Secrets

The following values must never enter model context, permission previews, validation results, fingerprints, or logs:

- SMTP passwords
- Receive passwords
- Access and refresh tokens
- Encryption keys
- Database paths
- Full unrelated profile records

The worker may receive the SMTP credentials it already needs for delivery. Those credentials remain outside the render plan and outside all UI/model-facing structures.

## 8. Variable Registry

### 8.1 Registry expansion

Extend `src/config/emailTemplateVariables.ts` with:

```ts
export const EMAIL_TEMPLATE_VARIABLES = {
  SEND_TIME: "{$send_time}",
  SENDER: "{$sender}",
  SENDER_NAME: "{$sender_name}",
  SENDER_ROLE: "{$sender_role}",
  SENDER_COMPANY: "{$sender_company}",
  SENDER_EMAIL: "{$sender_email}",
  SENDER_PHONE: "{$sender_phone}",
  SENDER_WEBSITE: "{$sender_website}",
  SENDER_SIGNATURE: "{$sender_signature}",
  RECEIVER_EMAIL: "{$receiver_email}",
  RECEIVER_NAME: "{$receiver_name}",
  URL: "{$url}",
  DESCRIPTION: "{$description}",
  COMPANY_NAME: "{$company_name}",
  CAMPAIGN_NAME: "{$campaign_name}",
} as const;
```

Keep the existing exports `EmailTemplateVariable`, `EMAIL_TEMPLATE_VARIABLE_LIST`, `VARIABLE_DESCRIPTIONS`, and `VARIABLE_CATEGORIES` as the single source of truth.

### 8.2 Exact resolution rules

| Variable              | Exact value                                                                 |
| --------------------- | --------------------------------------------------------------------------- |
| `{$sender}`           | `EmailServiceEntity.from`, preserving current behavior                      |
| `{$sender_email}`     | `EmailServiceEntity.from`                                                   |
| `{$sender_name}`      | Trimmed `EmailReplyIdentityProfileEntity.ownerName`                         |
| `{$sender_role}`      | Trimmed `ownerRole`                                                         |
| `{$sender_company}`   | Trimmed `companyName`                                                       |
| `{$sender_phone}`     | Trimmed new `phone` field                                                   |
| `{$sender_website}`   | Normalized new `website` field                                              |
| `{$sender_signature}` | `signature` with original internal line breaks preserved                    |
| `{$receiver_email}`   | Trimmed normalized recipient address                                        |
| `{$receiver_name}`    | Trimmed recipient `title`                                                   |
| `{$company_name}`     | Structured recipient company when available; no fallback to recipient title |
| `{$url}`              | Recipient `source` only when it is a valid URL or approved campaign URL     |
| `{$description}`      | Explicit campaign/recipient description                                     |
| `{$campaign_name}`    | Explicit campaign name                                                      |
| `{$send_time}`        | One timestamp frozen when the user confirms the task                        |

No variable falls back to an empty string. No sender variable falls back to recipient data. No recipient variable falls back to sender data.

### 8.3 Registry version

Export a constant such as:

```ts
export const EMAIL_TEMPLATE_VARIABLE_REGISTRY_VERSION = 2;
```

Store this version in the render snapshot and fingerprint. It makes later resolution changes visible and prevents an old confirmation from being interpreted under new rules.

## 9. Shared Types

Create `src/entityTypes/emailVariableTypes.ts` for cross-layer contracts.

### 9.1 Context types

```ts
export interface EmailSenderVariableContext {
  readonly serviceId: number;
  readonly sender: string;
  readonly senderName: string | null;
  readonly senderRole: string | null;
  readonly senderCompany: string | null;
  readonly senderEmail: string;
  readonly senderPhone: string | null;
  readonly senderWebsite: string | null;
  readonly senderSignature: string | null;
}

export interface EmailRecipientVariableContext {
  readonly recipientKey: string;
  readonly receiverEmail: string;
  readonly receiverName: string | null;
  readonly companyName: string | null;
  readonly url: string | null;
  readonly description: string | null;
}

export interface EmailCampaignVariableContext {
  readonly campaignName: string | null;
  readonly sendTime: string;
}
```

`recipientKey` is an internal opaque identifier used for aggregation. User-facing failures expose masked addresses only.

### 9.2 Content source

```ts
export interface EmailContentSource {
  readonly sourceType: "inline" | "saved_template";
  readonly templateId: number | null;
  readonly subject: string;
  readonly htmlContent: string;
}
```

### 9.3 Render result

```ts
export interface EmailRenderedContent {
  readonly subject: string;
  readonly htmlContent: string;
  readonly variablesUsed: readonly EmailTemplateVariable[];
}

export type EmailVariableField = "subject" | "body";

export interface EmailVariableIssue {
  readonly kind:
    | "missing_value"
    | "unknown_variable"
    | "legacy_placeholder"
    | "invalid_value";
  readonly marker: string;
  readonly field: EmailVariableField;
  readonly templateId: number | null;
  readonly start: number;
  readonly end: number;
}
```

Offsets refer to the original subject or body string and use JavaScript UTF-16 string indexes.

### 9.4 Preflight result

```ts
export interface EmailPreflightSuccess {
  readonly success: true;
  readonly fingerprint: string;
  readonly renderPlan: EmailRenderPlanSnapshot;
  readonly permissionPreview: EmailSendPermissionPreview;
}

export interface EmailPreflightFailure {
  readonly success: false;
  readonly code:
    | "UNRESOLVED_EMAIL_VARIABLES"
    | "UNKNOWN_EMAIL_VARIABLES"
    | "LEGACY_EMAIL_PLACEHOLDERS"
    | "INVALID_EMAIL_VARIABLE_VALUE"
    | "EMAIL_SERVICE_NOT_FOUND"
    | "EMAIL_TEMPLATE_NOT_FOUND"
    | "EMAIL_RECIPIENTS_EMPTY"
    | "EMAIL_PREFLIGHT_STALE"
    | "EMAIL_PREFLIGHT_FAILED";
  readonly error: string;
  readonly missingVariables: readonly string[];
  readonly unknownVariables: readonly string[];
  readonly legacyPlaceholders: readonly string[];
  readonly affectedFields: readonly EmailVariableField[];
  readonly affectedRecipientCount: number;
  readonly sampleRecipients: readonly string[];
  readonly retryable: boolean;
}

export type EmailPreflightResult =
  | EmailPreflightSuccess
  | EmailPreflightFailure;
```

Tool-facing adapters convert camelCase internal fields to the repository's current snake_case tool-result convention where appropriate.

## 10. Pure Parser and Renderer

### 10.1 New module

Create:

```text
src/modules/email/EmailVariableResolver.ts
```

This file contains pure functions only. It has no TypeORM, Electron, Node process, renderer, IPC, or network dependency. Both the main process and email worker can import it.

Move or replace `convertVariableInTemplate()` from `src/views/utils/emailFun.ts`. Keep a short compatibility wrapper only if existing renderer imports still require that function.

### 10.2 Public interface

```ts
export interface EmailVariableResolver {
  analyze(content: EmailContentSource): EmailContentAnalysis;
  validate(
    analysis: EmailContentAnalysis,
    context: EmailCombinedVariableContext
  ): readonly EmailVariableIssue[];
  render(
    content: EmailContentSource,
    context: EmailCombinedVariableContext
  ): EmailRenderedContent;
  assertResolved(rendered: EmailRenderedContent): void;
}
```

The implementation may export functions instead of a class. The contract must remain pure and explicit.

### 10.3 Canonical variable parser

Use a bounded parser for `{$name}` tokens:

```text
opening sequence: {$
name: lowercase ASCII letters, digits, and underscore
maximum name length: 64
closing sequence: }
```

The parser must report unknown canonical tokens rather than ignore them. It must scan both subject and body, including visible text and HTML attribute values.

### 10.4 Legacy placeholder detector

The detector runs in this order:

1. Record Markdown link spans matching `[label](destination)` and image-link spans matching `![label](destination)`.
2. Scan bracketed legacy candidates outside those spans.
3. Scan double-brace candidates such as `{{name}}`.
4. Scan angle-bracket candidates such as `<YOUR_NAME>` only when the token is not a valid HTML tag.
5. Scan bounded value-marker phrases such as `TBD`, `TO BE FILLED`, and `INSERT ... HERE` outside HTML tag names and attributes where they are ordinary values.

Do not use a rule that rejects every `[text]` sequence. That would block legitimate Markdown links and bracketed prose.

The first release should use an explicit allowlist of legacy patterns, not a broad natural-language classifier. This keeps false positives deterministic and testable.

### 10.5 HTML handling

The validator must not execute HTML. It treats the source as text and distinguishes tag syntax from visible or attribute values.

Required behavior:

- Canonical variables inside an attribute value are resolved.
- `<YOUR_NAME>` is a placeholder.
- `<p>` and `<a href="...">` are HTML, not placeholders.
- Visible `[Your Name]` inside a paragraph is a placeholder.
- Script and event-handler content is not introduced by this feature.

Email HTML sanitization remains a separate existing concern. The confirmation UI must never use unsanitized `v-html`.

### 10.6 Missing values

`render()` must not accept a missing referenced value. Callers must run `validate()` first, and `render()` must still throw a typed `EmailVariableResolutionError` if the invariant is violated.

This double check prevents a caller from accidentally bypassing validation.

## 11. Sender Identity Data Changes

### 11.1 Entity

Extend `EmailReplyIdentityProfileEntity` with nullable fields:

```ts
@Column("varchar", { length: 50, nullable: true })
phone: string | null;

@Column("varchar", { length: 2048, nullable: true })
website: string | null;
```

The project currently uses TypeORM `synchronize: true`, so no explicit migration file is required under the current database strategy. The fields remain nullable for compatibility with existing rows.

### 11.2 Write validation

Update both:

- `src/schemas/entity/emailReplyIdentityProfile.ts`
- `src/schemas/ipc/emailReply.ts`

Rules:

- Trim every optional string.
- Convert an empty optional field to `null` at the Module boundary.
- Phone length: 3 to 50 characters after trimming.
- Phone characters: digits, spaces, `+`, `-`, `(`, `)`, and extension markers.
- Website maximum: 2048 characters.
- Website schemes: `https:` or `http:` only.
- Owner name remains required.

The phone rule validates shape, not global telephone numbering semantics.

### 11.3 Model and Module

Update `EmailReplyIdentityProfileModel.upsertForEmailService()` to copy the two new fields on an existing row. Keep all repository access in the Model.

Add a Module method that returns a safe outbound context rather than returning the full entity to email preflight:

```ts
async getOutboundIdentityContext(
  emailServiceId: number
): Promise<EmailSenderIdentityRecord | null>
```

This method excludes `forbiddenPhrasesJson`, disclosure policy, timestamps, and other fields that outbound variable rendering does not need.

### 11.4 DTO and renderer API

Add `phone` and `website` to:

- `ReplyIdentityProfileDto`
- `toIdentityProfileDto()`
- `getReplyIdentityProfile()` response
- `updateReplyIdentityProfile()` input

The existing email-reply feature remains compatible and may ignore these fields.

## 12. Identity Profile UI

### 12.1 Component

Create:

```text
src/views/pages/emailservice/widgets/EmailSenderIdentityProfileForm.vue
```

Embed it in `src/views/pages/emailservice/servicedetail.vue` when the email service has a positive saved ID.

The component owns:

- Loading the profile for `emailServiceId`.
- Editing owner name, role, company, phone, website, and signature.
- Saving through the existing email-reply identity IPC/API.
- Showing validation and save state.
- Explaining that these values may appear in AI-generated outgoing email.

Do not merge identity fields into the SMTP credential payload. Identity and transport remain separate forms and separate writes.

### 12.2 New service flow

For a new email service:

1. Save SMTP settings first.
2. Receive the created service ID.
3. Keep the user on the page.
4. Reveal the identity profile form.
5. Let the user save identity independently.

The current page redirects to the list shortly after service save. Remove that automatic redirect or delay navigation until the user explicitly leaves so the identity can be completed.

### 12.3 Translation keys

Add matching keys to `en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, and `ja.ts` for:

- AI sender identity heading and explanation
- Phone and website labels/hints
- Missing identity warning
- Open identity settings action
- Email preflight failure summaries
- Recipient-specific variable notice
- Confirmation preview labels
- Stale confirmation message

Every template must retain an English fallback in the component.

## 13. Main-Process Preflight Module

### 13.1 New Module

Create:

```text
src/modules/EmailSendPreflightModule.ts
```

It extends `BaseModule` and is the only orchestration boundary for trusted database-backed preflight data.

### 13.2 Dependencies

- `EmailServiceModule`
- `EmailReplyIdentityProfileModule`
- `EmailTemplateModule`
- `EmailSearchTaskModule`
- Pure `EmailVariableResolver`

No IPC handler or worker may access repositories directly.

### 13.3 Public methods

```ts
export class EmailSendPreflightModule extends BaseModule {
  async preflight(
    input: BulkEmailTaskInput,
    options?: {
      readonly expectedConfirmationState?: EmailConfirmationState;
    }
  ): Promise<EmailPreflightResult>;
}
```

The Module performs its own `ensureConnection()` before calling database-backed dependencies.

### 13.4 Preflight algorithm

1. Parse and normalize input at the tool schema boundary.
2. Resolve and deduplicate recipients using current `not_duplicate` semantics.
3. Load every selected email service by ID.
4. Reject missing, disabled, or unusable services.
5. Load one safe identity context per selected service.
6. Build inline content or load every selected saved template.
7. Analyze every content source once and cache the result in the method scope.
8. Collect required sender, recipient, and campaign variables.
9. Validate sender requirements across every service.
10. Validate recipient requirements across every recipient.
11. Validate campaign requirements once.
12. Collect unknown and legacy placeholder issues from every content source.
13. If any issue exists, aggregate and return a sanitized blocking result.
14. Create or reuse the opaque confirmation state, including the frozen `confirmedAt` and `sendTime` values.
15. Build an immutable render plan.
16. Render representative previews.
17. Compute the confirmation fingerprint.
18. If an expected confirmation state exists and its fingerprint differs, return `EMAIL_PREFLIGHT_STALE`.
19. Return success with the render plan, fingerprint, and permission preview.

### 13.5 Avoiding a Cartesian rendering loop

The worker may choose among multiple senders and templates for each recipient. Preflight must prove that every possible combination is safe, but it does not need to render every combination.

Use set-based validation:

- Parse each template once.
- Union required sender variables across templates, then validate those fields for each selected service.
- Union required recipient variables across templates, then validate those fields for each recipient.
- Validate shared campaign variables once.
- Render only bounded representative previews after completeness succeeds.

With `S` services, `T` templates, and `R` recipients, validation cost becomes approximately `O(T + S*Vs + R*Vr)` rather than `O(S*T*R)`, where `Vs` and `Vr` are small variable counts.

### 13.6 Recipient error aggregation

Do not return every failing address. Aggregate by variable:

```ts
interface MissingRecipientVariableSummary {
  readonly variable: EmailTemplateVariable;
  readonly affectedCount: number;
  readonly sampleRecipients: readonly string[];
}
```

Return at most five masked samples per variable. Example: `b***@example.com`.

## 14. Immutable Render Plan

### 14.1 Purpose

The user approves specific content derived from specific templates, profiles, services, and recipients. The running task must not reload mutable text or identity values and silently send something else.

### 14.2 Snapshot contract

```ts
export interface EmailRenderPlanSnapshot {
  readonly version: 1;
  readonly registryVersion: number;
  readonly confirmedAt: string;
  readonly sendTime: string;
  readonly fingerprint: string;
  readonly recipientSource: "direct" | "email_search_task";
  readonly recipients: readonly EmailRecipientVariableContext[];
  readonly senders: readonly EmailSenderVariableContext[];
  readonly contents: readonly EmailContentSource[];
  readonly campaign: EmailCampaignVariableContext;
}
```

The snapshot contains no SMTP password. It contains only values required to render the approved message.

### 14.3 Persistence

Add nullable columns to `BuckemailTaskEntity`:

```ts
@Column("text", { nullable: true })
render_plan_json: string | null;

@Column("varchar", { length: 64, nullable: true })
preflight_fingerprint: string | null;
```

For AI-started tasks:

- Store the render snapshot in `render_plan_json`.
- Store the fingerprint separately for indexing/debugging without parsing JSON.
- Store a normalized recipient snapshot in the render plan even when the source was an email search task.
- Keep `emailtaskentityId` for provenance.

Legacy tasks without `render_plan_json` continue through the existing preparation path.

### 14.4 Size guard

The input schema already limits inline body content to 50,000 characters. Add serialized snapshot limits:

- Maximum 5 content sources per AI-started task in the first release.
- Maximum 10 selected sender services.
- Maximum 10,000 recipients.
- Maximum serialized render plan size: 10 MiB.

Return a typed validation failure before task creation when a snapshot exceeds the limit.

## 15. Confirmation Fingerprint

### 15.1 Construction

Compute SHA-256 over canonical JSON containing:

- Preflight contract version
- Variable registry version
- Normalized content sources with template IDs, subjects, and bodies
- Safe sender contexts
- Normalized recipient contexts
- Campaign context except volatile UI-only fields
- Deduplication setting
- Selected filter IDs

Never include passwords or tokens.

Sort arrays where order has no product meaning. Preserve content and recipient order where it affects preview or send behavior.

### 15.2 Canonical JSON

Use a small stable serializer that recursively sorts object keys. Do not rely on incidental insertion order.

### 15.3 Stale approval rule

The first preflight freezes `confirmedAt` and `sendTime`, then returns `fingerprint=A` plus an opaque, non-secret confirmation state. `AIChatQueryEngine` stores that state only in the pending permission record. The resume path passes it back to preflight, which reuses the frozen timestamps while reloading all mutable services, profiles, templates, and recipients. The second preflight computes `fingerprint=B`.

- If `A === B`, execution may create the task.
- If `A !== B`, return `EMAIL_PREFLIGHT_STALE` and do not create the task.
- The model must issue a new tool call, causing a new preview and confirmation.

This handles profile edits, template edits, recipient changes, service changes, and registry-version changes.

## 16. Skill Runtime Integration

### 16.1 New optional preflight hook

Extend `SkillDefinition` in `src/entityTypes/skillTypes.ts`:

```ts
export interface SkillPreflightSuccess {
  readonly success: true;
  readonly permissionPreview?: PermissionPreview;
  readonly confirmationState?: Record<string, unknown>;
  readonly preparedExecutionData?: Record<string, unknown>;
}

export interface SkillPreflightFailure {
  readonly success: false;
  readonly result: Record<string, unknown>;
}

export type SkillPreflightResult =
  | SkillPreflightSuccess
  | SkillPreflightFailure;

export interface SkillDefinition {
  // existing fields
  readonly preflight?: (
    args: Record<string, unknown>,
    context: SkillExecutionContext
  ) => Promise<SkillPreflightResult>;
}
```

Extend `SkillExecutionContext` with:

```ts
readonly expectedConfirmationState?: Record<string, unknown>;
readonly preparedExecutionData?: Record<string, unknown>;
```

`confirmationState` is small, non-secret data that may survive only for the lifetime of a pending approval. `preparedExecutionData` is ephemeral output from the current successful preflight; `SkillExecutor` passes it to `execute()` in the same call and never exposes or stores it in the renderer.

### 16.2 Execution order

Change `SkillExecutor.execute()` ordering to:

```text
Resolve tool
  -> runtime-enabled check
  -> generic argument sanitation
  -> optional read-only preflight
  -> if preflight fails, return its safe blocking result
  -> permission check
  -> if prompt needed, attach preflight preview and retain confirmation state
  -> if permission is already satisfied, pass fresh prepared data to execute
  -> execute tool
```

The preflight hook must be read-only. It must not create a task, spawn a worker, mutate a profile, or contact SMTP.

Existing tools without `preflight` retain current behavior.

### 16.3 Pending permission state

Extend the pending permission record in `AIChatQueryEngine` with:

```ts
readonly confirmationState?: Record<string, unknown>;
```

When the loop sees `needsPermissionPrompt`, retain the state from the preflight result in the main-process pending record. Do not send the opaque state to the renderer. On resume, pass it as `expectedConfirmationState`.

The email adapter validates this state with a strict schema containing only:

```ts
interface EmailConfirmationState {
  readonly version: 1;
  readonly fingerprint: string;
  readonly confirmedAt: string;
  readonly sendTime: string;
}
```

This prevents the current time from changing the rendered `{$send_time}` value between preview and execution. The state contains no recipient content, body text, credentials, or tokens.

### 16.4 Email tool registration

Add an email preflight adapter to `start_email_send_task`:

```ts
preflight: async (args, context) => {
  const result = await new EmailSendPreflightModule().preflight(
    bulkEmailTaskInputSchema.parse(args),
    { expectedConfirmationState: context.expectedConfirmationState }
  );
  return toSkillPreflightResult(result);
},
```

On a successful preflight, `toSkillPreflightResult()` maps the safe permission preview and confirmation state, and places the validated render plan in `preparedExecutionData`. On the first call, permission is still missing, so `SkillExecutor` discards the prepared plan after producing the prompt. On resume, it reruns preflight and passes the newly prepared plan to `execute()`.

`execute()` calls `startBulkEmailSendTask(args, context.preparedExecutionData)`. The start function validates the prepared data with the strict render-plan schema and must reject calls that do not contain a successful, fresh plan. It does not run a third preflight and does not reconstruct unchecked input.

### 16.5 Existing `buildPermissionPreview`

Keep the synchronous hook for simple metadata-only previews. The new asynchronous `preflight` hook serves cases that require trusted reads and may block execution.

If both hooks exist, `preflight.permissionPreview` takes precedence.

## 17. Permission Preview Contract

### 17.1 Move to a generic type file

The current `PermissionPreview` interface lives in an image-specific type file and permits only `kind: "file_transfer"`. Move it to:

```text
src/entityTypes/permissionPreviewTypes.ts
```

Define a discriminated union and re-export it from the old location during migration if required.

### 17.2 Email preview type

```ts
export interface EmailSendPermissionPreview {
  readonly kind: "email_send";
  readonly titleKey: string;
  readonly senderServiceCount: number;
  readonly sender: {
    readonly serviceId: number;
    readonly serviceName: string;
    readonly fromAddress: string;
    readonly ownerName: string | null;
  };
  readonly recipientSource: "direct" | "email_search_task";
  readonly recipientCount: number;
  readonly sampleRecipients: readonly string[];
  readonly representativeSubject: string;
  readonly representativeHtmlContent: string;
  readonly templateCount: number;
  readonly senderVariantCount: number;
  readonly recipientSpecificVariables: readonly string[];
  readonly confirmationFingerprint: string;
}
```

The preview may contain the full representative body because the tool input already permits 50,000 characters. Do not duplicate all rendered recipient variants.

### 17.3 Approval card rendering

Update `SkillApprovalCard.vue` to render by `permissionPreview.kind`.

For `email_send`:

- Show sender name and From address.
- Show recipient count and up to five masked sample addresses.
- Show the resolved subject.
- Show the representative body in a read-only text surface.
- State which fields vary by recipient.
- State how many templates and sender services may be selected randomly.
- Keep Allow and Deny controls unchanged.

Never render AI-provided HTML with `v-html`. Display escaped source or a separately sanitized plain-text representation.

Update `AiChatV2.vue` preview narrowing so it accepts the new discriminated union rather than assuming every preview has `items` and `destinationLabel`.

## 18. AI Prompt Policy

### 18.1 Dedicated builder

Create:

```text
src/service/EmailOutboundPromptPolicy.ts
```

It returns a compact section for the AI Chat V2 system prompt only when outbound email tools are loaded or the user's intent activates that tool family.

### 18.2 Content

The policy must tell the model:

1. Use only canonical variables from the supplied registry.
2. Use verified literal values when they are provided.
3. Never invent identity, contact, quantity, price, certification, legal, or delivery claims.
4. Do not call `start_email_send_task` when a required value is missing.
5. Ask the user for missing business facts.
6. Treat a preflight failure as actionable feedback, not a transient tool error.
7. Do not retry identical failed arguments.

### 18.3 Safe identity summary

The model should not receive all identity profiles by default. After the model selects a service using `list_email_services`, expose a safe identity lookup or include a sanitized identity summary in `get_email_service_config`:

```ts
interface EmailServiceConfigSummary {
  readonly service: SanitizedEmailService;
  readonly identity: {
    readonly ownerName: string | null;
    readonly ownerRole: string | null;
    readonly companyName: string | null;
    readonly phone: string | null;
    readonly website: string | null;
    readonly signature: string | null;
  } | null;
}
```

Do not include style notes or forbidden phrases unless outbound composition explicitly adopts those policies later.

### 18.4 Tool description

Extend the `start_email_send_task` description with a short enforcement summary, not the entire policy. The dedicated prompt section carries detailed rules and keeps the tool schema readable.

## 19. Email Marketing Tool Changes

### 19.1 Input schema

Keep existing `bulkEmailTaskInputSchema` rules and limits. Add only fields required for explicit campaign values if those values already exist in product input. Do not add arbitrary `variables: Record<string, string>` in the first release.

Unknown business facts must become literal text after the user supplies them.

### 19.2 Preview function

Refactor `previewBulkEmailSendTask()` to delegate to `EmailSendPreflightModule.preflight()` and return:

- Sanitized resolved preview on success.
- The same structured failure used by the start tool.

If it remains an internal service function, its behavior must still be covered because the skill preflight adapter uses it or the same Module directly.

### 19.3 Start function

Change `startBulkEmailSendTask()` to:

1. Parse input.
2. Parse the ephemeral `preparedExecutionData` supplied by `SkillExecutor` with the strict render-plan schema.
3. Verify that the plan corresponds to the normalized input and contains the confirmed fingerprint.
4. Pass the immutable render plan into `BuckEmailTaskModule.startBuckEmailCampaign()`.
5. Return task ID, recipient count, and fingerprint.

It must not create a task before step 3 succeeds. Direct callers that need to start an AI-originated task must go through `SkillExecutor`; absence of prepared data is a blocking error.

### 19.4 Result contract

Successful start result:

```ts
interface BulkEmailStartResult {
  readonly success: true;
  readonly task_id: number;
  readonly status: "started";
  readonly recipient_source: "direct" | "email_search_task";
  readonly recipient_count: number;
  readonly confirmation_fingerprint: string;
}
```

Failure results follow `EmailPreflightFailure` with snake_case field names at the tool boundary.

## 20. Task Persistence and Worker Handoff

### 20.1 `Buckemailstruct`

Add an optional internal field:

```ts
readonly RenderPlan?: EmailRenderPlanSnapshot;
```

This field is not part of the model-facing JSON schema. It is produced only after trusted preflight.

### 20.2 Task creation

`BuckEmailTaskModule.createBuckEmailTask()` serializes `RenderPlan` into `render_plan_json` and stores its fingerprint.

For a render-plan task, save the normalized recipient snapshot even if `EmailtaskentityId` exists. This prevents later search-result changes from changing the approved send.

### 20.3 `prepareData()`

When `render_plan_json` exists:

1. Parse with a strict versioned schema.
2. Verify the stored fingerprint.
3. Use snapshot recipients and content.
4. Load current SMTP transport credentials by service ID in the main process.
5. Verify that each service still exists and its From address matches the confirmed sender context.
6. Return a worker payload containing transport services plus the safe render plan.

If the service From address changed, fail before spawning or sending. Do not silently use the new address.

When no render plan exists, preserve the legacy path.

### 20.4 Worker payload

Extend `Buckemailremotedata` with:

```ts
readonly RenderPlan?: EmailRenderPlanSnapshot;
```

The worker receives:

- SMTP transport configuration, including existing credentials.
- The immutable safe render plan.
- Filters.

The worker does not receive database access, Module instances, tokens, or profile entities.

### 20.5 Worker rendering

For render-plan tasks, `EmailSend.send()`:

1. Chooses a service from the allowed sender IDs.
2. Chooses a content source from the snapshot.
3. Finds the exact safe sender context by service ID.
4. Finds the recipient context by normalized address/key.
5. Calls the shared pure renderer.
6. Calls `assertResolved()`.
7. Sends only if the assertion passes.

If the final assertion fails, report an error for that recipient and do not contact SMTP for that message.

The worker must not call `EmailReplyIdentityProfileModel`, `EmailTemplateModel`, or any database API.

## 21. Saved Template Semantics

### 21.1 Multiple templates

Current behavior randomly selects a template for each recipient. Preflight must load and validate every selected template because any template may be chosen.

The render plan stores title/body snapshots for all selected templates. Later edits to saved templates affect future tasks, not the confirmed task.

### 21.2 Multiple sender services

Current behavior randomly selects a service for each recipient. Preflight must validate every required sender variable against every selected service profile.

If one selected service lacks `sender_phone` and any selected content uses `{$sender_phone}`, the task is blocked even when other services have phone numbers.

### 21.3 Recipient personalization

If any selected content requires `{$receiver_name}`, every recipient must have a non-empty name. The system does not send a generic fallback for only some recipients in the first release.

The user may remove the variable or repair recipient data.

## 22. Error Handling

### 22.1 Fail closed

The following failures stop before task creation:

- Preflight service exception
- Missing service
- Missing or disabled service
- Missing template
- Empty recipients
- Unknown variable
- Missing value
- Legacy placeholder
- Invalid sender email, phone, or website
- Oversized render snapshot
- Stale fingerprint

### 22.2 Model recovery message

Return a concise `error` plus structured fields. Example:

```json
{
  "success": false,
  "code": "UNRESOLVED_EMAIL_VARIABLES",
  "error": "Email cannot be sent because required values are missing.",
  "missing_variables": ["{$sender_phone}"],
  "legacy_placeholders": ["[X]"],
  "affected_fields": ["body"],
  "affected_recipient_count": 0,
  "sample_recipients": [],
  "retryable": true
}
```

The tool description instructs the model to ask for the phone number and the meaning/value of `[X]` before retrying.

### 22.3 User-facing localization

Machine-readable `code` and variable tokens remain stable English identifiers. The renderer maps codes to localized strings. The raw server error is not displayed when a known code exists.

### 22.4 Background worker failure

If the final worker assertion fails despite successful preflight:

- Mark the recipient send as failed.
- Include error code `EMAIL_RENDER_INVARIANT_FAILED` in the main-process log/result.
- Do not log the full body or secret context.
- Continue or stop the campaign according to existing per-recipient failure behavior.

This path represents a software invariant violation and should be observable in diagnostics.

## 23. Logging and Observability

### 23.1 Allowed log fields

- Tool name
- Preflight success/failure code
- Recipient count
- Affected recipient count
- Variable names
- Template count
- Service count
- Fingerprint prefix, maximum 12 characters
- Duration

### 23.2 Forbidden log fields

- SMTP passwords
- Tokens
- Full email bodies
- Full signatures
- Full recipient lists
- Database paths

### 23.3 Suggested events

```text
email_preflight_started
email_preflight_blocked
email_preflight_confirmed
email_preflight_stale
email_task_snapshot_persisted
email_render_invariant_failed
```

Use existing debug logging conventions. Product telemetry remains optional and must not be required for correctness.

## 24. Performance

### 24.1 Target

Preflight for 1,000 recipients must finish in under one second after database retrieval.

### 24.2 Techniques

- Parse each content source once.
- Use variable requirement sets.
- Batch-load services, profiles, templates, and recipients where Module APIs allow it.
- Avoid per-recipient database reads.
- Aggregate failures in one pass.
- Render only representative previews.
- Bound samples and error arrays.
- Compute one fingerprint after normalized data assembly.

### 24.3 Large tasks

Reject more than 10,000 recipients in the first release unless existing product limits are lower. This keeps confirmation, snapshot size, and worker memory bounded.

## 25. Security Analysis

### 25.1 Prompt injection

Recipient or template text may contain instructions aimed at the model. Preflight treats those strings as data. The model prompt must label recipient and template content as untrusted. Neither can alter the variable registry or send policy.

### 25.2 HTML injection

The confirmation UI must not render raw email HTML with `v-html`. Use escaped text or an existing sanitizer plus a sandboxed renderer only if the repository already has an approved component.

### 25.3 Secret leakage

Safe sender contexts are constructed in the main process from explicit allowlisted properties. Do not serialize full `EmailServiceEntitydata` into model-facing results because it includes `password`.

### 25.4 Permission bypass

Preflight is enforcement, not consent. It does not set `skipPermissionCheck`, grant a permission token, or modify approval mode. Existing permission decisions remain authoritative.

### 25.5 Time-of-check/time-of-use changes

The fingerprint plus immutable render plan prevents template, profile, recipient, and registry changes from silently changing confirmed content. SMTP transport credentials may rotate, but the From address must still match the confirmed snapshot.

## 26. Test Strategy

### 26.1 Pure resolver tests

Create `test/vitest/utilitycode/EmailVariableResolver.test.ts` covering:

- Every canonical variable
- Repeated variables
- Subject and body positions
- Unknown canonical variables
- Missing values
- Empty and whitespace-only values
- Multiline signatures
- Unicode content
- Markdown links
- Markdown image links
- Bracketed ordinary prose
- `{{variable}}`
- `<YOUR_NAME>` versus valid HTML tags
- `TBD`, `TO BE FILLED`, and `INSERT ... HERE`
- Variables in HTML attributes
- Final assertion failure
- No mutation of input objects

### 26.2 Preflight Module tests

Create `test/modules/EmailSendPreflightModule.test.ts` covering:

- Inline content and saved templates
- One and multiple services
- One and multiple templates
- Direct and search-task recipients
- Deduplication
- Missing identity profile
- Missing optional field that is not referenced
- Missing referenced sender field
- Missing recipient name for one recipient
- Aggregated masked samples
- Missing service/template
- Disabled service
- Invalid URL and phone
- Snapshot size limit
- Deterministic fingerprint
- Stale fingerprint
- Secret exclusion

### 26.3 AI tool service tests

Extend:

- `test/service/emailMarketingAiTools.test.ts`
- `test/vitest/main/service/EmailMarketingAiTools.start.test.ts`

Assert:

- Preflight failure prevents `startBuckEmailCampaign()`.
- Success passes a render plan.
- Start remains non-blocking after task creation.
- Tool failures use stable codes.
- No SMTP or worker activity occurs during preflight.

### 26.4 Skill executor tests

Extend `test/vitest/main/service/SkillExecutor.modelArtifacts.test.ts` or add a focused preflight test to cover:

- Asynchronous preflight runs before permission prompt.
- Blocking preflight returns without a permission prompt.
- Successful preflight attaches email preview and fingerprint.
- Existing synchronous file preview behavior is unchanged.
- Resume passes expected fingerprint.
- Stale fingerprint prevents execute.

### 26.5 Worker tests

Add tests around `EmailSend` with SMTP mocked:

- Worker renders from snapshot.
- Worker does not import or construct a database Model.
- Missing final value prevents SMTP invocation.
- Multiple sender/template selection uses matching context.
- Legacy task path remains compatible.

### 26.6 Component tests

Create or extend tests under `test/vitest/main/components/` for:

- Identity profile form load/save/error states
- Phone and website validation
- Email permission preview
- Escaped HTML display
- Recipient-specific variable notice
- Disabled confirmation on blocking state
- Stale confirmation message
- All required translation keys

### 26.7 End-to-end test

Add `test/e2e/specs/aiEmailPlaceholderResolution.test.ts`:

1. Configure an SMTP service with an incomplete identity profile.
2. Trigger an AI outbound email containing `{$sender_phone}`.
3. Verify that sending is blocked.
4. Complete the identity profile.
5. Trigger the send again.
6. Verify the resolved confirmation preview.
7. Approve the tool.
8. Verify the worker receives no unresolved markers.

Use a mocked delivery boundary. The test must not send a real email.

## 27. File Change Map

### 27.1 New files

| File                                                                      | Responsibility                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `src/entityTypes/emailVariableTypes.ts`                                   | Shared variable, preflight, snapshot, and error contracts   |
| `src/entityTypes/permissionPreviewTypes.ts`                               | Generic permission-preview discriminated union              |
| `src/modules/email/EmailVariableResolver.ts`                              | Pure parser, detector, validator, renderer, final assertion |
| `src/modules/EmailSendPreflightModule.ts`                                 | Main-process database-backed preflight orchestration        |
| `src/service/EmailOutboundPromptPolicy.ts`                                | Conditional outbound-email AI instructions                  |
| `src/views/pages/emailservice/widgets/EmailSenderIdentityProfileForm.vue` | Per-service sender identity editor                          |
| `test/vitest/utilitycode/EmailVariableResolver.test.ts`                   | Pure resolver coverage                                      |
| `test/modules/EmailSendPreflightModule.test.ts`                           | Module integration coverage                                 |
| `test/e2e/specs/aiEmailPlaceholderResolution.test.ts`                     | Critical user flow                                          |

### 27.2 Modified files

| File                                                  | Change                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| `src/config/emailTemplateVariables.ts`                | Add sender variables and registry version                   |
| `src/entity/EmailReplyIdentityProfile.entity.ts`      | Add nullable phone and website                              |
| `src/schemas/entity/emailReplyIdentityProfile.ts`     | Validate new persistence fields                             |
| `src/schemas/ipc/emailReply.ts`                       | Validate new IPC fields                                     |
| `src/model/EmailReplyIdentityProfile.model.ts`        | Persist phone and website                                   |
| `src/modules/EmailReplyIdentityProfileModule.ts`      | Return safe outbound identity context                       |
| `src/entityTypes/emailReceiveTypes.ts`                | Extend identity DTO                                         |
| `src/main-process/communication/emailReceive-ipc.ts`  | Map new fields; preserve thin IPC layer                     |
| `src/views/api/emailreply.ts`                         | Extend typed profile input/output                           |
| `src/views/pages/emailservice/servicedetail.vue`      | Embed identity form and remove automatic post-save redirect |
| `src/entityTypes/skillTypes.ts`                       | Add asynchronous preflight hook and expected fingerprint    |
| `src/service/SkillExecutor.ts`                        | Run preflight before permission and attach preview          |
| `src/service/AIChatQueryEngine.ts`                    | Store and replay non-secret confirmation state              |
| `src/entityTypes/aiImageAttachmentToolTypes.ts`       | Re-export moved permission type during migration            |
| `src/views/components/aiChat/SkillApprovalCard.vue`   | Render email preview variant                                |
| `src/views/components/aiChatV2/AiChatV2.vue`          | Narrow and pass email preview data                          |
| `src/entityTypes/emailMarketingAiTypes.ts`            | Extend preflight/start result contracts                     |
| `src/service/EmailMarketingAiTools.ts`                | Delegate preview/start to preflight Module                  |
| `src/config/skillsRegistry.ts`                        | Register email preflight and strengthen tool guidance       |
| `src/service/BuiltInToolCapabilitiesPromptSection.ts` | Add concise outbound completion rule                        |
| `src/entity/BuckemailTask.entity.ts`                  | Persist render plan and fingerprint                         |
| `src/entityTypes/emailmarketingType.ts`               | Add render plan to internal task/worker types               |
| `src/modules/buckEmailTaskModule.ts`                  | Persist/validate snapshot and prepare immutable worker data |
| `src/childprocess/emailSend.ts`                       | Use shared renderer and final assertion                     |
| `src/views/utils/emailFun.ts`                         | Remove old implementation or retain compatibility wrapper   |
| `src/views/lang/en.ts`                                | Add UI strings                                              |
| `src/views/lang/zh.ts`                                | Add UI strings                                              |
| `src/views/lang/es.ts`                                | Add UI strings                                              |
| `src/views/lang/fr.ts`                                | Add UI strings                                              |
| `src/views/lang/de.ts`                                | Add UI strings                                              |
| `src/views/lang/ja.ts`                                | Add UI strings                                              |

## 28. Delivery Sequence

### Phase 1: Pure resolution foundation

- Expand variable registry.
- Add shared types.
- Add pure resolver and detector.
- Add exhaustive utility tests.
- Replace empty-string substitution behavior.

This phase does not change sending until enforcement is wired.

### Phase 2: Identity and preflight

- Extend identity persistence, DTO, schema, API, and UI.
- Add `EmailSendPreflightModule`.
- Add Module tests.
- Add sanitized identity to the email-service AI context.

### Phase 3: Tool permission integration

- Add asynchronous skill preflight hook.
- Add email permission preview union and UI.
- Carry non-secret confirmation state through pending permission state.
- Update AI policy and tool descriptions.
- Add executor and component tests.

### Phase 4: Immutable task and worker enforcement

- Add render-plan persistence.
- Snapshot recipients, content, and sender contexts.
- Pass render plan to worker.
- Use shared renderer in worker.
- Add final unresolved assertion.
- Preserve legacy task path.

### Phase 5: End-to-end verification and rollout

- Add E2E test with mocked delivery.
- Run Markdown/HTML false-positive corpus.
- Measure preflight performance at 1,000 and 10,000 recipients.
- Enable enforcement for AI-started outbound tasks.

## 29. Rollback Strategy

The feature should be separable at the email tool registration boundary.

If production issues occur:

1. Disable the new email `preflight` hook while retaining the pure resolver and profile fields.
2. Keep new nullable database columns; they are backward-compatible.
3. Continue reading legacy tasks without render plans.
4. Do not remove stored render plans during rollback.
5. Keep the worker's final assertion enabled if it does not cause false positives.

Do not roll back by allowing missing variables to become empty strings.

## 30. Operational Verification

Before release, verify:

```text
1. Complete profile + canonical variables -> resolved preview -> send starts.
2. Missing sender phone -> task count unchanged -> structured block returned.
3. [Your Name] and [X] -> structured legacy block returned.
4. Markdown link -> no false positive.
5. One missing recipient name in a large list -> whole task blocked.
6. Profile edit after preview -> stale fingerprint -> no task created.
7. Template edit after preview -> stale fingerprint -> no task created.
8. Approved task snapshot -> later template edit does not change worker content.
9. Worker payload contains render plan but no database path or tokens.
10. SMTP mock is never called for unresolved content.
```

Required commands during implementation verification:

```bash
yarn test:components
yarn testmain
yarn test
yarn typecheck
yarn vue-typecheck
yarn test:e2e
```

Targeted tests should run before the full suites during development.

## 31. Design Decisions

1. Use existing `{$...}` syntax.
2. Preserve `{$sender}` as the SMTP From address for backward compatibility.
3. Reuse the email reply identity profile and extend it with phone and website.
4. Keep SMTP credentials separate from sender identity.
5. Use a pure shared resolver outside renderer-only code.
6. Validate before permission display and again after approval.
7. Retain a non-secret confirmation state so timestamps remain stable, then compare a deterministic fingerprint on resume.
8. Persist an immutable render snapshot for confirmed AI tasks.
9. Validate all selected templates and sender services, not only the representative preview.
10. Validate every recipient without rendering every possible combination.
11. Block missing values instead of substituting empty strings.
12. Detect a bounded list of legacy markers and exclude Markdown links.
13. Do not allow arbitrary custom variables in the first release.
14. Keep workers database-free.
15. Render email confirmation content as escaped text, not raw `v-html`.

## 32. Known Constraints

- Recipient `title` currently acts as the only available recipient-name field in `EmailItem`.
- Structured recipient company and description fields may require later contact-schema work; templates that reference unavailable values remain blocked.
- Random sender/template selection means all possible selected combinations must be complete.
- Full bodies up to 50,000 characters can make a confirmation card tall; the UI should use a bounded scroll region without truncating the underlying value.
- TypeORM `synchronize: true` currently handles nullable column additions. A future migration framework must migrate these fields explicitly.
- Existing legacy tasks may still contain unresolved content. This feature guarantees the new AI-started path first; a separate audit can address stored legacy tasks.

## 33. Related Code and Documents

- [Safe AI Email Variable Resolution PRD](2026-09-03-ai-email-placeholder-resolution-prd.md)
- `src/config/emailTemplateVariables.ts`
- `src/service/EmailMarketingAiTools.ts`
- `src/entityTypes/emailMarketingAiTypes.ts`
- `src/config/skillsRegistry.ts`
- `src/service/SkillExecutor.ts`
- `src/service/AIChatQueryEngine.ts`
- `src/entity/EmailReplyIdentityProfile.entity.ts`
- `src/model/EmailReplyIdentityProfile.model.ts`
- `src/modules/EmailReplyIdentityProfileModule.ts`
- `src/modules/buckEmailTaskModule.ts`
- `src/childprocess/emailSend.ts`
- `src/views/utils/emailFun.ts`
- `src/views/components/aiChat/SkillApprovalCard.vue`
- `src/views/pages/emailservice/servicedetail.vue`
- `test/service/emailMarketingAiTools.test.ts`
- `test/vitest/main/service/EmailMarketingAiTools.start.test.ts`
