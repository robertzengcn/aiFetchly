# AiFetchly AI Chat Conversation Reporting - Technical Design

**Companion to:** `ai-chat-conversation-reporting-prd.md`

**Parent design:** `ai-content-reporting-technical-design.md`

**Status:** Draft v1.0

**Created:** 2026-08-30

## 1. Purpose

This document translates the approved conversation-reporting PRD into an implementation design for the AiFetchly desktop application and its marketing backend. It extends the existing single-output reporting path without changing schema-version-1 behavior.

The implementation adds:

- an always-visible **Report conversation** action in supported chat headers;
- deterministic, immutable snapshots of eligible AI outputs;
- selection of 1 to 10 AI outputs from one conversation;
- an explicit opt-in for directly related user messages;
- a strict schema-version-2 request on the existing report endpoint;
- a backend-capability probe so clients fail closed when version 2 is unavailable;
- ordered multi-item rendering in the backend review queue; and
- component, schema, service, integration, accessibility, and end-to-end tests.

The implementation does not upload the complete chat object, query the desktop database from the report handler, call an AI model, or relax the schema-version-1 boundary.

## 2. Current Implementation

The existing feature has a complete single-output path:

```text
AIContentReportButton.vue
        |
        v
AIContentReportDialog.vue
        |
        v
createAIContentReport(request: schemaVersion 1)
        |
        v
AI_CONTENT_REPORT_CREATE
        |
        v
registerValidatedHandler(createAIContentReportSchema)
        |
        v
AIContentReportService.submitReport()
        |
        v
POST /api/ai/content-reports
```

Current guarantees that must remain true:

1. `AI_CONTENT_REPORT_CREATE` is registered with `registerValidatedHandler`, not `registerAiValidatedHandler`.
2. The service does not use TypeORM or desktop SQLite.
3. Renderer input is validated with a strict, lazy Zod schema before submission.
4. `clientReportId` is stable across manual retries.
5. App version, platform, and install identifier are overwritten by the main process.
6. Generated images are re-encoded to bounded display previews in the renderer.
7. Logs and analytics contain metadata only.
8. Schema version 1 accepts one output and rejects prompts, neighboring messages, and unknown fields.

### 2.1 Existing ownership issue in Chat V2

`AiChatV2Messages.vue` currently owns the single-output dialog and its session-only `reportedMessageIds`. The new header action belongs in `AiChatV2.vue`, one level above the message list. Keeping two independent reported-ID sets would produce inconsistent labels after a header submission.

The design therefore lifts report orchestration and reported-ID state to `AiChatV2.vue`. Message rendering remains in `AiChatV2Messages.vue`, which emits report requests upward.

### 2.2 Existing legacy-chat discoverability issue

The legacy `AiChatBox.vue` places per-message actions in a container that becomes visible on pointer hover. The header action must not reuse that behavior. It is always visible or, on compact layouts, rendered as a stable labeled icon with a tooltip and 44 x 44 CSS-pixel target.

## 3. Design Decisions

### D1. One endpoint, two strict request schemas

Both request versions use `POST /api/ai/content-reports`. The backend dispatches by `schemaVersion`.

- Version 1 remains the single-output contract.
- Version 2 is the conversation multi-item contract.
- Each version has its own strict Zod schema.
- A union of two literal-version strict schemas is used only at the IPC and service dispatch boundary.

This avoids a second review queue while preventing version-2 fields from weakening version-1 validation.

### D2. Separate conversation dialog

Add `AIConversationReportDialog.vue` instead of turning `AIContentReportDialog.vue` into a large mode-driven component.

The existing dialog assumes one descriptor, one preview, and one message identifier. A separate component isolates multi-selection, related-message consent, aggregate limits, and long-list rendering. Both dialogs reuse types, categories, image encoding, frontend API, error codes, and success-response handling.

### D3. Snapshot at dialog open

The chat surface passes its currently visible message array into a pure snapshot builder when the header action is selected. The dialog receives plain immutable snapshot data, not Vue refs or message-store objects.

This ensures:

- new streaming tokens do not change report evidence;
- changing selections cannot read newly added messages;
- hidden metadata cannot leak through object spreading; and
- cancellation discards all evidence state.

### D4. Related user context is derived, not freely selectable

When the user enables related context, the builder includes at most one directly related user message per selected AI output. The user cannot select arbitrary user messages in v1. This keeps the consent model understandable and prevents the header flow from becoming a general transcript exporter.

### D5. Capability-gated rollout

The desktop reads backend report capabilities through a new non-AI-gated IPC channel. Version-2 UI remains visible but unavailable with a safe explanation when support is unknown or absent. Per-output version-1 reporting remains functional.

### D6. No new desktop database entity

Conversation report drafts and results are not persisted locally. The renderer uses already-loaded visible messages; the backend remains the report source of truth.

## 4. Architecture

```text
RENDERER

AiChatV2.vue / AiChatBox.vue / ChatInterface.vue
  |-- header: AIConversationReportButton.vue
  |-- on open: buildConversationReportSnapshot(visible messages)
  |-- dialog: AIConversationReportDialog.vue
  |     |-- selection state
  |     |-- related-user-context opt-in
  |     |-- category + comment
  |     |-- image selection and encoding
  |     `-- buildCreateAIConversationReportRequest()
  |
  |-- getAIContentReportCapabilities()
  `-- createAIContentReport(version 1 | version 2)
            |
            v
PRELOAD ALLOWLIST
  AI_CONTENT_REPORT_CAPABILITIES
  AI_CONTENT_REPORT_CREATE
            |
            v
MAIN PROCESS

ai-content-report-ipc.ts
  |-- GET capabilities: registerValidatedHandler
  `-- POST report: registerValidatedHandler(createAnyAIContentReportSchema)
            |
            v
AIContentReportService
  |-- getCapabilities() with bounded in-memory cache
  |-- normalize version 1
  |-- normalize version 2 items + context
  |-- metadata-only logs and analytics
  `-- HttpClient
            |
            v
MARKETING BACKEND

GET  /api/ai/content-reports/capabilities
POST /api/ai/content-reports
  |-- schema-version dispatch
  |-- idempotency by clientReportId + reporter identity
  |-- base report row
  |-- ordered report-item rows
  `-- existing admin review queue with multi-item evidence view
```

## 5. File Layout

### 5.1 New desktop files

```text
src/views/components/aiContentReport/
├── AIConversationReportButton.vue
├── AIConversationReportDialog.vue
├── AIConversationReportItemList.vue
├── conversationReportSnapshot.ts
├── conversationReportRequest.ts
└── conversationReportText.ts

src/schemas/api/
└── aiContentReport.ts

test/vitest/main/components/
├── AIConversationReportButton.test.ts
├── AIConversationReportDialog.test.ts
├── AiChatV2ConversationReport.test.ts
├── AiChatBoxConversationReport.test.ts
└── KnowledgeChatConversationReport.test.ts

test/vitest/utilitycode/
├── aiConversationReportSchema.test.ts
├── aiContentReportCapabilitiesSchema.test.ts
├── conversationReportSnapshot.test.ts
├── conversationReportRequest.test.ts
└── conversationReportText.test.ts

test/e2e/specs/
└── ai-conversation-reporting.test.ts
```

### 5.2 Modified desktop files

```text
src/entityTypes/aiContentReportTypes.ts
src/schemas/ipc/aiContentReport.ts
src/service/AIContentReportService.ts
src/modules/lib/httpclient.ts
src/main-process/communication/ai-content-report-ipc.ts
src/config/channellist.ts
src/preload.ts
src/views/api/aiContentReport.ts
src/views/components/aiChatV2/AiChatV2.vue
src/views/components/aiChatV2/AiChatV2Messages.vue
src/views/components/aiChat/AiChatBox.vue
src/views/pages/knowledge/ChatInterface.vue
src/views/lang/en.ts
src/views/lang/zh.ts
src/views/lang/es.ts
src/views/lang/fr.ts
src/views/lang/de.ts
src/views/lang/ja.ts
test/vitest/main/aiContentReportIpc.test.ts
test/vitest/main/aiContentReportService.test.ts
test/vitest/main/httpclient.test.ts
test/vitest/utilitycode/aiContentReportI18nParity.test.ts
```

No file is added under `src/entity/`, `src/model/`, or `src/childprocess/`.

## 6. Shared Data Types

Extend `src/entityTypes/aiContentReportTypes.ts` without changing existing version-1 interfaces.

```typescript
export const AI_CONVERSATION_REPORT_SCOPES = [
  "selected_ai_outputs",
  "selected_ai_outputs_with_related_user_context",
] as const;

export type AIConversationReportScope =
  (typeof AI_CONVERSATION_REPORT_SCOPES)[number];

export const AI_CONVERSATION_REPORT_SURFACES = [
  "chat_v2",
  "legacy_chat",
  "knowledge_chat",
] as const;

export type AIConversationReportSurface =
  (typeof AI_CONVERSATION_REPORT_SURFACES)[number];

export interface AIConversationReportItem {
  itemId: string;
  messageId: string;
  sequence: number;
  role: "assistant" | "user";
  contentType: AIContentType;
  text?: string;
  textTruncated?: boolean;
  imagePreviews?: AIContentReportImagePreview[];
  evidenceUnavailable?: boolean;
  generatedAt?: string;
  model?: string;
  consentSource?: "related_user_context_toggle";
}

export interface AIConversationReportContext {
  conversationId: string;
  selectedAIItemCount: number;
  includedUserItemCount: number;
  aggregateTextTruncated?: boolean;
  appVersion: string;
  platform: "win32" | "darwin" | "linux";
  locale: string;
  installId?: string;
}

export interface CreateAIConversationReportRequest {
  schemaVersion: 2;
  clientReportId: string;
  surface: AIConversationReportSurface;
  reportScope: AIConversationReportScope;
  category: AIContentReportCategory;
  comment?: string;
  items: AIConversationReportItem[];
  context: AIConversationReportContext;
}

export type CreateAnyAIContentReportRequest =
  | CreateAIContentReportRequest
  | CreateAIConversationReportRequest;

export interface AIContentReportCapabilities {
  acceptedSchemaVersions: readonly number[];
  conversationReporting: {
    enabled: boolean;
    maxAIItems: number;
    maxUserItems: number;
    maxTotalItems: number;
    maxItemTextChars: number;
    maxAggregateTextChars: number;
    maxImages: number;
  };
}
```

`sequence` is a zero-based contiguous integer assigned after all selected AI and related user items are merged in chronological order. It makes ordering validation explicit even when two messages have the same timestamp.

## 7. Renderer Snapshot Model

Wire types contain encoded evidence. Snapshot types contain only renderer-local immutable candidates and must live in `conversationReportSnapshot.ts`.

```typescript
export interface ConversationReportImageCandidate {
  readonly sourceId: string;
  readonly dataBase64?: string;
  readonly mimeType?: string;
}

export interface ConversationReportCandidate {
  readonly itemId: string;
  readonly messageId: string;
  readonly sourceIndex: number;
  readonly role: "assistant";
  readonly contentType: AIContentType;
  readonly text?: string;
  readonly images: readonly ConversationReportImageCandidate[];
  readonly evidenceUnavailable: boolean;
  readonly generatedAt?: string;
  readonly model?: string;
  readonly relatedUser?: ConversationReportRelatedUser;
}

export interface ConversationReportRelatedUser {
  readonly itemId: string;
  readonly messageId: string;
  readonly sourceIndex: number;
  readonly role: "user";
  readonly contentType: "text";
  readonly text: string;
  readonly omittedAttachmentContent: boolean;
  readonly generatedAt?: string;
}

export interface ConversationReportSnapshot {
  readonly snapshotId: string;
  readonly conversationId: string;
  readonly surface: AIConversationReportSurface;
  readonly createdAt: string;
  readonly candidates: readonly ConversationReportCandidate[];
}
```

The builder copies only primitive allowlisted values. It does not retain `ChatV2MessageView`, `ChatMessage`, knowledge-chat message objects, Vue refs, metadata objects, or URLs.

### 7.1 Adapter functions

```typescript
export function buildChatV2ConversationSnapshot(input: {
  conversationId: string;
  messages: readonly ChatV2MessageView[];
  activeAssistantMessageId: string | null;
  streamStatus: "idle" | "streaming" | "cancelled" | "error";
}): ConversationReportSnapshot;

export function buildLegacyConversationSnapshot(input: {
  conversationId: string;
  messages: readonly ChatMessage[];
  streamingAssistantMessageId?: string;
}): ConversationReportSnapshot;

export function buildKnowledgeConversationSnapshot(input: {
  conversationId: string;
  messages: readonly KnowledgeChatMessage[];
}): ConversationReportSnapshot;
```

Knowledge chat currently uses untyped component-local message objects. Before adding its adapter, define a local explicit `KnowledgeChatMessage` interface and convert the component to `script setup lang="ts"` or a typed `defineComponent` setup. Do not introduce `any` to bridge the adapter.

### 7.2 AI-output eligibility

#### Chat V2

A candidate is eligible when:

- `message.conversationId === active conversationId`;
- `message.role === "assistant"`, or a visible artifact card can be represented as an assistant-owned bounded artifact summary;
- the message is not the active streaming placeholder unless its effective status is `idle`;
- `messageType` is not `TOOL_CALL` or raw `TOOL_RESULT`;
- it has non-empty text, safe generated-image bytes, plan text, or a bounded artifact summary; and
- it is present in the same `visibleMessages` array rendered to the user.

Plan candidates reuse the title, objective, and latest plan Markdown assembly rules from `buildPlanDescriptor`. Artifact candidates use title and description only, never HTML.

Generated images are candidates only when `b64_json` exists. A displayed external or local image without raw generated bytes may set `evidenceUnavailable: true`; its URL or path is never copied into the snapshot.

#### Legacy chat

An eligible message has role `assistant`, a reportable message type, non-empty visible content, and is not the active streaming placeholder. Tool, system, permission, and error rows remain excluded.

#### Knowledge chat

An eligible message has `type === "ai"` and non-empty visible content. Knowledge sources are not evidence and are not copied into the snapshot.

### 7.3 Related-user resolution

For each eligible assistant candidate at source index `i`:

1. Scan backward from `i - 1`.
2. Skip tool-call, tool-result, permission, system, local-only, and empty display rows.
3. Stop and return the first visible user message in the same conversation.
4. Stop with no relation if another completed assistant output is encountered before a user message.
5. Deduplicate related users by `messageId` when several selected outputs map to the same request.

The related-user snapshot reads the visible `content` string only. It never expands:

- `metadata.attachments`;
- `metadata.atMentions`;
- `metadata.pastedBlocks`;
- upload payloads;
- document IDs;
- paste-cache contents; or
- workspace paths.

When excluded metadata is present, the snapshot sets `omittedAttachmentContent: true`. The dialog renders the localized omission notice. Literal text the user typed remains visible and is included only after opt-in.

### 7.4 Immutability and lifecycle

- Generate `snapshotId` with `crypto.randomUUID()` when the header action opens.
- Copy arrays with new objects and freeze the top-level snapshot in development builds.
- Do not watch the source messages while the dialog is open.
- Watch the active conversation ID at the surface root. If it changes, close the dialog and discard the snapshot.
- New messages in the same conversation do not alter the open snapshot.

## 8. Text Normalization

`conversationReportText.ts` contains pure runtime-neutral functions used by request construction and mirrored defensively in the main-process service.

```typescript
export const MAX_CONVERSATION_ITEM_TEXT = 8_000;
export const MAX_CONVERSATION_AGGREGATE_TEXT = 32_000;

export interface NormalizedConversationText {
  readonly texts: readonly {
    itemId: string;
    text: string;
    truncated: boolean;
  }[];
  readonly aggregateTruncated: boolean;
}

export function normalizeConversationTexts(
  inputs: readonly { itemId: string; text: string }[]
): NormalizedConversationText;
```

Algorithm:

1. Clamp every item to 8,000 characters using the existing head-marker-tail strategy.
2. If the aggregate is at most 32,000 characters, return the per-item results.
3. If the aggregate exceeds 32,000, allocate `floor(32,000 / textItemCount)` characters to each text item, capped at its actual length and at 8,000.
4. Redistribute unused budget in chronological order to items that still need capacity.
5. Truncate affected items with the same head-marker-tail helper.
6. Set per-item and aggregate truncation flags.

With at most 20 text items, every non-empty selected item retains at least 1,600 characters before marker overhead. No selected item is silently dropped to satisfy the aggregate limit.

The renderer normalizes before IPC because the strict schema rejects oversized input. The main service repeats normalization as defense in depth before HTTP submission.

## 9. Request Construction

`conversationReportRequest.ts` converts the snapshot and UI selection into the version-2 wire request.

```typescript
export interface BuildConversationReportRequestInput {
  readonly snapshot: ConversationReportSnapshot;
  readonly selectedAIItemIds: ReadonlySet<string>;
  readonly selectedImageIds: ReadonlySet<string>;
  readonly includeRelatedUserContext: boolean;
  readonly category: AIContentReportCategory;
  readonly comment?: string;
  readonly locale: string;
  readonly clientReportId: string;
}

export async function buildCreateAIConversationReportRequest(
  input: BuildConversationReportRequestInput
): Promise<CreateAIConversationReportRequest>;
```

Construction order:

1. Resolve selected candidates from `selectedAIItemIds`; reject zero or more than 10.
2. Sort selected candidates by `sourceIndex`.
3. If related context is enabled, merge deduplicated related users by `sourceIndex`.
4. Normalize all text with `normalizeConversationTexts`.
5. Encode selected generated images in chronological order with `encodeReportImagePreview`.
6. Stop after three successful previews. The UI prevents a fourth selection, and the builder enforces the limit again.
7. Represent an image conversion failure with `evidenceUnavailable: true` on the owning assistant item. Never add the source URL or path.
8. Assign contiguous `sequence` values after the final merge.
9. Set `reportScope` from the user-context toggle.
10. Count actual assistant and user items for context fields.
11. Use placeholders for `appVersion`, `platform`, and `installId`; the main service overwrites them.

The builder throws typed local validation errors. It never calls IPC itself, which keeps it independently testable.

## 10. Vue Components

### 10.1 `AIConversationReportButton.vue`

Props:

```typescript
interface Props {
  enabled: boolean;
  loading?: boolean;
  disabledReason?: string;
  compact?: boolean;
}
```

Behavior:

- Normal width: text button with `mdi-flag-outline` and **Report conversation**.
- Compact width: icon button with tooltip and `aria-label="Report this conversation"`.
- Minimum target: 44 x 44 CSS pixels.
- Emits `open` only when enabled.
- Uses `aria-disabled` and tooltip copy when unavailable.
- Has `data-testid="report-conversation"`.

The button receives capability and eligibility state from its surface. It does not inspect messages or call the backend.

### 10.2 `AIConversationReportItemList.vue`

Responsibilities:

- render chronological assistant candidates;
- expose checkbox selection;
- show type, timestamp, escaped text preview, image count, and truncation/evidence warning;
- enforce the 10-assistant-item selection limit in the UI;
- render related user previews only when the opt-in is enabled; and
- emit selected AI and image ID sets.

It receives a snapshot and selection sets as props. It contains no submission logic.

For up to 100 eligible candidates, render the full list. Above 100, use `v-virtual-scroll` with stable item heights or a measured item wrapper. The initial render never decodes image bytes; image thumbnails are generated only for expanded selected items or represented by metadata placeholders.

### 10.3 `AIConversationReportDialog.vue`

Props:

```typescript
interface Props {
  modelValue: boolean;
  snapshot: ConversationReportSnapshot | null;
  privacyPolicyUrl?: string;
  activatorEl?: HTMLElement | null;
}
```

Emits:

```typescript
interface Emits {
  (event: "update:modelValue", value: boolean): void;
  (event: "submitted", value: {
    reportId: string;
    selectedMessageIds: readonly string[];
  }): void;
}
```

Internal state:

- `clientReportId`, created once per open;
- `selectedAIItemIds`, initially empty;
- `selectedImageIds`, initially empty;
- `includeRelatedUserContext`, initially false;
- category and comment;
- selection, image, category, truncation, and submission errors;
- submission loading state; and
- successful `reportId`.

Submission flow:

1. Validate selection and category.
2. Build the version-2 request from the immutable snapshot.
3. Show a truncation warning before the first submission if normalization shortened evidence. The user confirms by selecting Submit again or an explicit **Continue and submit** action.
4. Call `createAIContentReport(request)`.
5. Preserve all state on retryable failure.
6. Emit selected source message IDs on success.
7. Keep the dialog open so the reference can be copied.

The component resets all state on every fresh open. Related-user consent is never persisted.

### 10.4 Reuse versus duplication

The conversation dialog reuses:

- `AI_CONTENT_REPORT_CATEGORIES`;
- `encodeReportImagePreview`;
- `createAIContentReport`;
- `CreateAIContentReportResponse`;
- error codes and localized error keys;
- privacy-policy URL; and
- visual tokens from the existing report dialog.

Do not extract a generic mega-dialog. Small pure helpers for client ID creation, error-code resolution, and copy-reference behavior may be moved to `aiContentReportUi.ts` only if both components use them with identical behavior.

## 11. Surface Integration

### 11.1 AI Chat V2

`AiChatV2.vue` becomes the reporting orchestration owner.

Add state:

```typescript
const singleReportDialogOpen = ref(false);
const activeSingleDescriptor = ref<ReportableOutputDescriptor | null>(null);
const conversationReportDialogOpen = ref(false);
const conversationReportSnapshot = ref<ConversationReportSnapshot | null>(null);
const reportedMessageIds = ref<Set<string>>(new Set());
const reportCapabilities = ref<AIContentReportCapabilities | null>(null);
const reportCapabilitiesLoading = ref(false);
```

Changes:

1. Add `AIConversationReportButton` to `.v2-shell__header-actions` before destructive actions.
2. Pass `reportedMessageIds` into `AiChatV2Messages.vue`.
3. Change `AiChatV2Messages.vue` to emit `report` upward instead of mounting `AIContentReportDialog`.
4. Mount one single-output dialog and one conversation dialog at the `AiChatV2.vue` root.
5. On single-output success, add the active message ID.
6. On conversation-report success, add all selected assistant message IDs.
7. On header open, call `buildChatV2ConversationSnapshot` with `visibleMessages`, not the unfiltered backing array.
8. Watch `activeConversationId`; when it changes, close and clear the conversation dialog.

`reportedMessageIds` remains session-only and is cleared when the component is destroyed. It may contain IDs from several conversations while the chat dock remains mounted; message IDs are globally stable.

### 11.2 Legacy AI chat

`AiChatBox.vue` already owns the message array, conversation ID, single-output dialog, and reported IDs.

Changes:

1. Add the header button near conversation history, before clear and close actions.
2. Create the snapshot from `visibleMessages` and the current `conversationId`.
3. Mount `AIConversationReportDialog` beside the existing single-output dialog.
4. Merge submitted assistant IDs into `reportedMessageIds`.
5. Keep the action independent of `isLoading`, except that an active streaming placeholder is excluded from the snapshot.
6. Add visible/focusable per-message report behavior so hover is not the only entry on pointerless devices.

### 11.3 Knowledge chat

`ChatInterface.vue` needs a stable conversation ID because current messages use array indices for report identity.

Changes:

1. Generate `knowledgeConversationId` when the component initializes or when Clear starts a new conversation.
2. Assign a stable UUID `id` to every user and AI message when created.
3. Define `KnowledgeChatMessage` explicitly.
4. Add the header button before Clear and Export.
5. Build snapshots from typed visible messages.
6. Mount the conversation dialog and merge successful AI message IDs into the reported set.
7. Do not include source document contents or relevance metadata.

Array indexes must not be used as version-2 message IDs because deletion or insertion changes their meaning.

## 12. Zod Validation

Keep the existing `createAIContentReportSchema` export as the version-1 schema so current imports and tests remain valid.

Add:

```typescript
export const createAIConversationReportSchema = lazySchema(() =>
  createAIConversationReportV2Schema
);

export const createAnyAIContentReportSchema = lazySchema(() =>
  z.union([
    createAIContentReportV1Schema,
    createAIConversationReportV2Schema,
  ])
);
```

Implementation detail: define the inner strict objects once, then wrap exported factories with `lazySchema`. Do not invoke one lazy factory while constructing another schema because that creates separate instances and weakens schema-cache reuse. This repository uses Zod 3.25. Both version schemas require `superRefine`, which produces `ZodEffects`; Zod 3 `discriminatedUnion` does not accept effect-wrapped branches. A normal `z.union` is therefore required. The literal `schemaVersion` field still rejects cross-version payloads, and application code narrows the inferred TypeScript union with `request.schemaVersion`.

### 12.1 Version-2 item schema

Each item uses `z.strictObject` and enforces:

- ID lengths from 1 to 128;
- `sequence` is a non-negative integer;
- known role and content type;
- item text at most 8,000 characters;
- at most three images on an individual item;
- existing image MIME, dimension, and decoded-byte limits;
- RFC3339 timestamp when present;
- model length at most 128;
- at least one of text, image preview, or `evidenceUnavailable` for assistant items; and
- user items use `contentType: "text"`, contain non-empty text, have no images, no model, no `evidenceUnavailable`, and set `consentSource` exactly.

### 12.2 Version-2 root `superRefine`

Validate:

1. `items.length` is 1 to 20.
2. Assistant count is 1 to 10.
3. User count is 0 to 10.
4. Declared context counts equal actual counts.
5. `selected_ai_outputs` contains no user items.
6. `selected_ai_outputs_with_related_user_context` contains at least one consented user item.
7. Item IDs and message IDs are unique per role; an assistant and related user cannot share a message ID.
8. Sequences are exactly `0..items.length - 1` in array order.
9. Aggregate text length is at most 32,000 characters.
10. Image-preview count across all items is at most three.
11. Surface is one of the three chat surfaces.
12. Context conversation ID is non-empty and at most 128 characters.
13. If every assistant item has only `evidenceUnavailable: true`, the root comment must be non-empty.

The schema cannot prove a user item was historically adjacent to an assistant item because the main process intentionally does not read chat storage. That property is enforced by the pure renderer builder and covered by builder tests. The backend treats role and consent fields as evidence metadata, not proof of user identity.

## 13. IPC and Preload

### 13.1 Channels

```typescript
export const AI_CONTENT_REPORT_CREATE = "ai:content:report:create";
export const AI_CONTENT_REPORT_CAPABILITIES =
  "ai:content:report:capabilities";
```

Keep the existing create-channel wire value. Add the capabilities channel to the preload invoke allowlist. Do not expose a general HTTP bridge.

### 13.2 Capability request schema

The capabilities request has no user data:

```typescript
export const getAIContentReportCapabilitiesSchema = lazySchema(() =>
  z.strictObject({ schemaVersion: z.literal(1) })
);
```

### 13.3 IPC registration

```typescript
export function registerAIContentReportIpcHandlers(): void {
  registerValidatedHandler(
    AI_CONTENT_REPORT_CAPABILITIES,
    getAIContentReportCapabilitiesSchema,
    async () => new AIContentReportService().getCapabilities()
  );

  registerValidatedHandler(
    AI_CONTENT_REPORT_CREATE,
    createAnyAIContentReportSchema,
    async (input) => new AIContentReportService().submitReport(input)
  );
}
```

Both handlers remain outside the AI feature gate. Capabilities and reporting must work when `USER_AI_ENABLED !== "true"`.

Malformed JSON currently throws before `safeParse` inside `registerValidatedHandler`. Implementation should harden the shared wrapper with a JSON parse try/catch or add an IPC test documenting the current envelope behavior. If the shared wrapper is changed, run all validated-handler tests because many features use it.

## 14. Frontend API

Extend `src/views/api/aiContentReport.ts`:

```typescript
export async function createAIContentReport(
  request: CreateAnyAIContentReportRequest
): Promise<CreateAIContentReportResponse> {
  return await windowInvoke(AI_CONTENT_REPORT_CREATE, request);
}

export async function getAIContentReportCapabilities():
  Promise<AIContentReportCapabilities> {
  return await windowInvoke(AI_CONTENT_REPORT_CAPABILITIES, {
    schemaVersion: 1,
  });
}
```

No raw token, URL, or HTTP client is exposed to the renderer.

## 15. Main-Process Service

### 15.1 Service options

Extend the injectable HTTP client type from `Pick<HttpClient, "postJson">` to `Pick<HttpClient, "postJson" | "get">`.

### 15.2 Capability cache

```typescript
interface CapabilityCacheEntry {
  value: AIContentReportCapabilities;
  expiresAt: number;
}

const CAPABILITY_TTL_MS = 5 * 60 * 1000;
```

Use a module-level in-memory cache because each IPC call creates a service instance. Behavior:

1. Return a non-expired cached value.
2. Otherwise call `GET /api/ai/content-reports/capabilities`.
3. Validate the backend response with a response schema before caching.
4. Clamp server-advertised limits to desktop hard maximums. The server may lower a limit but cannot raise the client above the PRD limits.
5. On network or invalid response, return a fail-closed capability object with `conversationReporting.enabled: false` and accepted schema versions `[1]`.
6. Never log response bodies.

Version-1 reporting does not depend on this cache.

The response schema lives in `src/schemas/api/aiContentReport.ts`, follows the strict-object pattern, and validates the `CommonApiresp<AIContentReportCapabilities>` envelope plus every numeric limit. It rejects negative, fractional, missing, and unknown values before the service clamps accepted limits.

### 15.3 Version dispatch

```typescript
async submitReport(
  request: CreateAnyAIContentReportRequest
): Promise<CreateAIContentReportResponse> {
  return request.schemaVersion === 1
    ? this.submitVersion1(request)
    : this.submitVersion2(request);
}
```

`submitVersion1` preserves current logic. `submitVersion2`:

1. Re-normalizes item text and aggregate limits.
2. Overwrites app version, platform, and install ID.
3. Recomputes declared counts and truncation flags rather than trusting renderer count fields.
4. Preserves item order and sequences.
5. Posts to the same endpoint.
6. Treats `duplicate: true` as success.
7. Logs only metadata from section 19.

Do not call the capabilities endpoint for every submission. The backend remains authoritative and may reject an unsupported version; map that response to `service_disabled` or a new safe `unsupported_schema` code if the backend contract provides a distinct status.

### 15.4 Context assembly

Create overloads or separate functions:

```typescript
assembleVersion1Context(
  partial: AIContentReportContext
): AIContentReportContext;

assembleVersion2Context(
  partial: AIConversationReportContext,
  items: readonly AIConversationReportItem[]
): AIConversationReportContext;
```

The version-2 function recomputes:

- `selectedAIItemCount`;
- `includedUserItemCount`;
- `aggregateTextTruncated`;
- `appVersion`;
- `platform`; and
- `installId`.

Locale and conversation ID remain renderer supplied after strict validation.

### 15.5 HTTP status preservation

`HttpClient._fetchJSON` currently throws `Error(res.statusText)` for non-2xx responses, which discards the numeric HTTP status. `AIContentReportErrorMapper` expects a `status` property, so 413, 422, 429, and 503 cannot be mapped reliably through the current implementation.

Add an exported error without changing the existing message shape:

```typescript
export class HttpResponseError extends Error {
  readonly status: number;
  readonly statusText: string;

  constructor(status: number, statusText: string) {
    super(statusText || `HTTP ${status}`);
    this.name = "HttpResponseError";
    this.status = status;
    this.statusText = statusText;
  }
}
```

After the existing 401/403 refresh handling, replace the generic non-OK throw with `HttpResponseError`. Preserve the message so legacy callers that display or match `statusText` do not change behavior. Add focused tests for 400, 413, 422, 429, 500, and 503, plus a regression test for 401/403 refresh flow. This correction benefits version 1 and version 2 error mapping but must land as its own verified logical unit because `HttpClient` is shared across the application.

## 16. Backend Contract

The marketing backend owns ingestion, persistence, reviewer access, retention, and operator action. The desktop release must not enable header reporting until these changes are deployed.

### 16.1 Capabilities endpoint

```http
GET /api/ai/content-reports/capabilities
```

Response:

```json
{
  "status": true,
  "code": 0,
  "msg": "ok",
  "data": {
    "acceptedSchemaVersions": [1, 2],
    "conversationReporting": {
      "enabled": true,
      "maxAIItems": 10,
      "maxUserItems": 10,
      "maxTotalItems": 20,
      "maxItemTextChars": 8000,
      "maxAggregateTextChars": 32000,
      "maxImages": 3
    }
  }
}
```

The endpoint requires no AI entitlement. Authentication may be optional using the same anonymous-reporting rules as create-report.

### 16.2 Create endpoint dispatch

```http
POST /api/ai/content-reports
Content-Type: application/json
```

Dispatch on `schemaVersion` before decoding version-specific fields. Reject unknown versions with HTTP 422 and a stable backend error code such as `unsupported_schema_version`.

### 16.3 Persistence model

Preserve the existing base report record. Add ordered child items for version 2:

```text
ai_content_reports
  id
  report_id
  schema_version
  client_report_id
  reporter_identity / install identity according to backend policy
  surface
  report_scope nullable for version 1
  category
  comment
  app_version
  platform
  locale
  conversation_id protected according to current policy
  selected_ai_item_count
  included_user_item_count
  aggregate_text_truncated
  status
  received_at
  retention timestamps

ai_content_report_items
  id
  report_id foreign key
  sequence
  source_item_id
  source_message_id protected according to current policy
  role
  content_type
  text evidence encrypted or protected according to current policy
  text_truncated
  evidence_unavailable
  generated_at
  model nullable
  consent_source nullable

ai_content_report_images
  id
  report_item_id foreign key
  sequence
  mime_type
  bounded image storage reference
  width
  height
  sha256
```

Use one transaction for the base report, items, and image metadata. If any item fails validation or persistence, roll back the entire report.

The exact table names may follow the marketing repository convention, but the one-to-many ordering and consent fields are required.

### 16.4 Idempotency

The backend uniqueness key remains the normalized reporter identity plus `clientReportId`. Repeating a version-2 request returns the original report ID and `duplicate: true` without inserting new child items.

If the same idempotency key is reused with a different body hash, return a safe conflict response rather than mutating the original report.

### 16.5 Admin review UI

The review detail page shows:

1. Category, scope, surface, app version, platform, locale, and report reference.
2. A privacy badge when related user context is present.
3. Ordered evidence cards with role, content type, timestamp, model when allowed, and truncation state.
4. User messages visually distinct from AI outputs.
5. Bounded generated-image previews attached to their owning item.
6. Existing triage status, audit trail, and operator-action controls.

The list page displays counts and scope metadata only. It must not put report text in analytics, browser console, URLs, or searchable logs.

## 17. Capability and Failure State Machine

```text
unknown
  | fetch start
  v
loading
  | success supports v2 ------> enabled
  | success no v2 ------------> unsupported
  | network/invalid response -> unavailable

enabled + eligible candidates ----> button enabled
enabled + no candidates ----------> button disabled: no completed AI responses
unsupported ----------------------> button disabled: update/service unavailable
unavailable ----------------------> button disabled: reporting temporarily unavailable
```

The header action remains rendered in every state. The per-output version-1 action remains usable when capability status is `unsupported` or `unavailable`.

Capability fetch retries when:

- the chat surface remounts after cache expiry;
- the user explicitly retries from the disabled tooltip or dialog notice; or
- a version-2 submit receives an unsupported-version response and invalidates the cache.

Do not poll continuously.

## 18. Privacy and Security Enforcement

### 18.1 Allowlist boundaries

| Boundary | Allowed | Explicitly excluded |
| --- | --- | --- |
| Chat adapter to snapshot | IDs, role, content type, visible content, safe generated bytes, timestamp, model, omission boolean | Full metadata objects, attachments, paste cache, tool data, reasoning, URLs, paths |
| Snapshot to request | Selected items, opted-in related users, encoded previews, category, comment, locale | Unselected candidates, reactive state, source objects |
| Renderer to main IPC | Strict version-1 or version-2 request | Unknown keys, functions, paths, URLs, arbitrary roles |
| Main to backend | Revalidated normalized request plus main-owned context | Renderer app version/platform/install ID, tokens in body, logs |
| Backend to admin | Authorized report evidence and audit metadata | Public URLs, client analytics, application logs |

### 18.2 Threat cases

| Threat | Control |
| --- | --- |
| Renderer accidentally spreads the full message object | Snapshot builder creates each field explicitly; strict schema rejects unknown keys. |
| User-context toggle state leaks across reports | Dialog resets the boolean on every open and does not store it. |
| Conversation changes during selection | Surface watches conversation ID and closes the dialog without submission. |
| Image source is a local path or signed URL | Snapshot accepts raw generated bytes only; encoder accepts bytes/base64 only. |
| Oversized payload causes memory or service abuse | Client limits, Zod limits, HTTP body limit, and backend validation all apply. |
| Malicious report text executes in UI | Renderer previews use interpolation; admin UI escapes text and never treats evidence as HTML. |
| Retry duplicates a report | Stable client report ID and backend uniqueness constraint. |
| Worker submits directly | Channels exist only in renderer preload/main IPC; service is not called from child processes. |
| Reporting becomes paywalled | Both handlers use the normal validated wrapper and never check `USER_AI_ENABLED`. |

### 18.3 Logging prohibition

Never log:

- `items`;
- report comment;
- text or images;
- conversation or message identifiers;
- model names;
- report scope consent details tied to an identifier;
- auth headers; or
- backend response bodies.

Validation logging currently formats Zod errors with field paths. Confirm that `formatZodValidationError` does not include rejected values. Add a regression test using secret marker strings.

## 19. Analytics and Operational Logs

### 19.1 Renderer analytics

Allowed open/scope events contain:

- surface;
- eligible item count bucket;
- user-context-enabled boolean; and
- app version only when obtained through an approved analytics source.

Do not use `console.info` for report analytics in production. Route through the existing approved analytics sink when available. Until then, omit the event rather than writing report-related identifiers or content to the console.

### 19.2 Main-process logs

Allowed submission properties:

```text
clientReportId
reportId on success
surface
reportScope
selectedAIItemCount
includedUserItemCount
category
appVersion
httpStatus
durationMs or duration bucket
safe error code
```

Counts sent to analytics use buckets `1`, `2-3`, `4-6`, and `7-10`. Operational logs may use exact bounded counts but never identifiers for messages or conversations.

## 20. Localization

Add `aiConversationReport` blocks to all six language files. Keep single-output keys under `aiContentReport`.

Required key groups:

```typescript
aiConversationReport: {
  action: string;
  actionAriaLabel: string;
  unavailable: string;
  noEligibleOutputs: string;
  dialogTitle: string;
  selectionInstruction: string;
  selectionCount: string;
  selectAll: string;
  includeRelatedUserContext: string;
  userMessageWillBeSent: string;
  attachmentOmitted: string;
  consentDefault: string;
  consentWithUserContext: string;
  truncationWarning: string;
  continueAndSubmit: string;
  conversationChanged: string;
  itemTypes: {
    text: string;
    image: string;
    mixed: string;
    plan: string;
    artifact: string;
  };
  errors: {
    selectionRequired: string;
    selectionLimit: string;
    imageLimit: string;
    relatedMessageUnavailable: string;
    unsupportedSchema: string;
  };
}
```

All components use `t()` plus an English fallback. Extend `aiContentReportI18nParity.test.ts` to compare recursive key sets for both blocks across `en`, `zh`, `es`, `fr`, `de`, and `ja`.

## 21. Accessibility

1. Header action is in normal tab order and does not require hover.
2. Dialog uses `aria-labelledby` pointing to its heading.
3. Opening focuses the heading or selection instruction; closing restores the originating header button.
4. Every candidate has a native checkbox with an accessible label containing item position, type, and timestamp when available.
5. Selection counts, selection-limit errors, image-limit errors, truncation warnings, context additions, submission errors, and success use `aria-live` regions.
6. Related user evidence has textual role labels, not color alone.
7. The item list supports keyboard scrolling without trapping focus.
8. Submit remains reachable at 1,366 x 768 and 200% scaling by using a scrollable body and sticky card actions.
9. Escape closes only when submission is not in progress.
10. Compact header icon has a 44 x 44 target, tooltip, title, and accessible name.

Component tests cover focus restoration. Playwright covers keyboard-only selection and submission.

## 22. Performance

### 22.1 Snapshot construction

Snapshot building is one pass over visible messages plus bounded backward relation lookup.

To avoid quadratic behavior on long conversations, compute related-user associations in one forward pass:

```text
lastVisibleUser = null
for each visible row in order:
  if row is eligible user: lastVisibleUser = sanitized snapshot
  if row is eligible assistant:
    attach lastVisibleUser
    lastVisibleUser = null after completing the request-response pair
  if row is a completed assistant before any user:
    do not reuse an earlier user
```

Tool and permission rows do not reset `lastVisibleUser`. A new visible user replaces it. This produces O(n) time and O(k) snapshot memory, where `k` is eligible candidates plus at most one bounded related-user snapshot per candidate.

### 22.2 Image handling

- Do not decode base64 images when opening the dialog.
- Do not place full data URLs into DOM attributes for every list row.
- Encode only selected images at submission.
- Process images sequentially to limit peak memory, with a maximum of three.
- Release `ImageBitmap` objects in `finally`, as the existing encoder does.

### 22.3 Capability cache

Five-minute main-process caching prevents repeated GET requests as users open and close chat panels. Cache only bounded capability metadata.

## 23. Error Handling

Reuse existing safe report error codes. Add `unsupported_schema` only if the backend returns a distinct stable code that survives the `CommonApiresp` and IPC envelopes. Otherwise map it to `service_disabled` and use conversation-report-specific localized copy.

Local construction errors never cross IPC:

```typescript
type AIConversationReportLocalErrorCode =
  | "selection_required"
  | "selection_limit"
  | "image_limit"
  | "related_message_unavailable"
  | "conversation_changed"
  | "evidence_unavailable";
```

On network or server failure, preserve:

- snapshot;
- selected item IDs;
- selected image IDs;
- user-context toggle;
- category;
- comment;
- `clientReportId`; and
- truncation confirmation.

On active conversation change, discard all state and do not permit retry from the old dialog.

## 24. Testing

### 24.1 Pure utility tests

`conversationReportSnapshot.test.ts`:

- includes completed visible assistant messages;
- excludes user, system, tool, permission, empty, and active streaming rows;
- includes plan text and bounded artifact summaries;
- includes safe generated bytes but no URLs or local paths;
- resolves only directly related visible user messages;
- does not expand attachments, mentions, pasted blocks, or sources;
- deduplicates a related user where required;
- produces stable chronological candidates; and
- handles 500-message histories in linear time.

`conversationReportText.test.ts`:

- enforces per-item and aggregate limits;
- distributes aggregate budget across all items;
- preserves head and tail;
- preserves item order;
- marks every truncated item; and
- is deterministic for identical input.

`conversationReportRequest.test.ts`:

- builds assistant-only and opted-in requests;
- creates contiguous sequences;
- counts actual roles;
- encodes at most three images;
- represents conversion failures safely;
- excludes unselected candidates; and
- never includes source objects or metadata.

### 24.2 Schema tests

Add exhaustive version-2 valid and invalid cases from section 12. Keep all existing version-1 tests unchanged. Add union-schema tests proving version-1 objects cannot contain version-2 keys and vice versa.

### 24.3 Component tests

The project rule requires UI tests in the same change as UI code.

Cover:

- visible and compact header buttons;
- disabled reasons;
- initial empty selection;
- selection and image limits;
- user-context reset on every open;
- exact related-message preview;
- consent-copy switching;
- truncation confirmation;
- cancel sends nothing;
- failed submit preserves state;
- successful submit returns selected IDs;
- focus entry and restoration; and
- sticky actions at constrained viewport sizes.

### 24.4 IPC tests

- both channels register;
- capability request validates;
- create union accepts versions 1 and 2;
- invalid version-2 request never calls service;
- neither handler imports or consults the AI feature gate;
- malformed JSON returns a safe envelope after shared-wrapper hardening; and
- validation messages do not include secret input values.

### 24.5 Service tests

- capability success, clamping, invalid response, cache hit, and cache expiry;
- version dispatch;
- version-1 behavior unchanged;
- version-2 normalization and count recomputation;
- main-owned context overwrite;
- duplicate response success;
- unsupported version mapping;
- metadata-only logs for success and failure; and
- no database/model imports.

### 24.6 End-to-end tests

Use `test/e2e/specs/ai-conversation-reporting.test.ts` to cover:

1. Header action discovery without hover.
2. Two selected AI responses, no user context.
3. Same selection with related context enabled.
4. Exact stub-backend payload exclusions.
5. Network failure and manual retry with one report ID.
6. Historical report with hosted AI disabled.
7. Active conversation change cancelling the dialog.
8. Keyboard-only flow.
9. Compact width and 200% scaling checks.

Run:

```bash
yarn test:components
yarn testmain
yarn test:e2e
yarn vue-check
```

Add targeted Vitest scripts only if existing test commands cannot select the new utility suites.

## 25. Implementation Sequence

### Phase 1: Contract and pure logic

1. Add version-2 types and capability types.
2. Add version-2 Zod schema and discriminated union.
3. Add snapshot, text-normalization, and request-construction utilities with tests.
4. Keep the UI disabled until the backend is ready.

### Phase 2: Main process and backend

1. Add capability channel, preload entry, and frontend API.
2. Extend the service for capabilities and version dispatch.
3. Deploy backend capability and version-2 create support.
4. Add backend persistence, admin rendering, idempotency-body-hash check, and tests.

### Phase 3: Chat V2 UI

1. Add header button, item list, and conversation dialog.
2. Lift report orchestration to `AiChatV2.vue`.
3. Add all six translations and component tests.
4. Add Chat V2 end-to-end coverage.

### Phase 4: Legacy and knowledge chat

1. Add header integration to legacy chat.
2. Add stable typed knowledge-chat message IDs and header integration.
3. Remove hover-only dependency for per-output report discovery.
4. Add parity tests.

### Phase 5: Certification and rollout

1. Publish privacy-policy changes.
2. Execute production-like backend smoke tests.
3. Capture Store screenshots and certification steps.
4. Enable version-2 capability in the Store environment.

Each phase is a separate logical commit group. UI changes and their component tests land together.

## 26. Migration and Compatibility

### 26.1 Desktop compatibility

- Existing clients continue sending version 1.
- New clients continue using version 1 for per-output reports.
- New clients use version 2 only after the capability endpoint advertises support.
- No desktop database migration is required.
- No child-process or Forge worker entry changes are required.

### 26.2 Backend deployment order

1. Deploy schema-version-2 storage and create-path support with capability disabled.
2. Deploy admin multi-item rendering.
3. Verify idempotency, retention, and operator audit flow.
4. Deploy desktop code.
5. Enable `conversationReporting.enabled` for staged users.
6. Enable for Store certification and production.

### 26.3 Rollback

Disable conversation reporting in the capability response. The header action becomes visibly unavailable, while per-output version-1 reporting continues to work. No desktop rollback or local migration is required.

Existing submitted version-2 reports remain reviewable in the backend.

## 27. PRD Requirement Traceability

| PRD area | Technical design section |
| --- | --- |
| Always-visible header action | Sections 10.1, 11, 17, 21 |
| Multi-output selection | Sections 7, 9, 10.2, 12 |
| Optional related user context | Sections 7.3, 9, 10.3, 18 |
| Evidence limits | Sections 8, 9, 12 |
| Immutable snapshot | Sections 7.4, 11 |
| Versioned contract | Sections 6, 12, 13, 15, 16 |
| AI-entitlement independence | Sections 13.3, 18.2 |
| Backend capability gate | Sections 15.2, 16.1, 17, 26 |
| Stable report reference and retry | Sections 10.3, 15.3, 16.4, 23 |
| Privacy and security | Sections 7.3, 12, 18, 19 |
| Localization | Section 20 |
| Accessibility | Section 21 |
| Performance | Section 22 |
| Tests and Store flow | Sections 24, 25 |

## 28. Rejected Alternatives

### Upload the entire conversation on header click

Rejected because it submits before meaningful consent, includes unrelated private content, and conflicts with the bounded-evidence contract.

### Concatenate selected messages into version-1 `output.text`

Rejected because the backend loses ordering, roles, message identity, per-item truncation, image ownership, and related-user consent. It also bypasses strict contract evolution.

### Replace the per-output button with the header action

Rejected because isolated concerns become slower to report and Store compliance still benefits from an action attached to the exact generated output.

### Read the conversation again from SQLite in the IPC handler

Rejected because renderer-visible state may differ from stored state, the reporting IPC layer must not access the database directly, and it would retrieve content the user did not select.

### Persist report drafts locally

Rejected because v1 explicitly avoids an offline queue and local report storage. The open dialog preserves retry state in memory.

### Use one mode-driven report dialog for versions 1 and 2

Rejected because it couples stable single-output behavior to multi-selection, long-list, consent, and aggregate-limit state. Separate components share small primitives without sharing incompatible state machines.

## 29. Final Technical Decision

AiFetchly will implement header-based conversation reporting as a separate renderer flow that produces a strict schema-version-2 request on the existing AI-content-report endpoint. Each chat surface creates an immutable allowlisted snapshot from currently visible messages. Users select 1 to 10 AI outputs; directly related user messages enter the request only after a fresh explicit opt-in and visible preview.

The existing version-1 request, per-output dialog, non-AI-gated IPC channel, image encoder, response type, and backend review queue remain in place. A new capability-read channel gates version-2 rollout. Main-process validation and normalization provide defense in depth without querying desktop SQLite. Backend child records preserve ordered evidence and consent metadata. The feature ships only with matching UI tests, backend support, privacy disclosure, accessibility coverage, localization parity, and Store certification evidence.
