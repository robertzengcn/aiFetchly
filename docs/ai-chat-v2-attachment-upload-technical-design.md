# AiChatV2 Attachment Upload - Technical Design

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-07-01
- **Related PRD**: `docs/ai-chat-v2-attachment-upload-prd.md`
- **Related server design**: `aifetchserver/docs/multimodal-attachment-api-technical-design.md`
- **Primary files**: `AiChatV2.vue`, `aiChatV2Types.ts`, `AIChatQueryEngine.ts`, `AIChatContextAssembler.ts`, `DocumentService.ts`

## Purpose

AiChatV2 needs first-class attachment support while keeping the current OpenAI-compatible chat architecture. The desktop app should handle file selection, validation, local persistence, document extraction, and RAG ingestion. The AI server should handle image model routing and multimodal fallback.

The desktop app must not ask the AI server which model can see images. It should send image attachments as OpenAI-style `image_url` content parts and let the server route to qwen, another multimodal model, OCR, or a clear error.

## Current Architecture Summary

AiChatV2 currently sends text-only requests:

```ts
export interface ChatV2StreamRequest {
  conversationId?: string;
  message: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  mode?: ChatV2Mode;
}
```

`AiChatV2.vue` calls `streamChatV2Message()` with `message`, `mode`, and `model`. The main process handles the request in `ai-chat-v2-ipc.ts`, then `AIChatQueryEngine.submitMessage()` saves the user message and calls `AIChatContextAssembler.assemble()`. The assembler builds `OpenAIChatMessage[]`, and `AIChatQueryLoop` streams through `AiChatApi.openAIChatCompletionStream()`.

Legacy chat already has reusable attachment pieces:

- `UploadedFilePayload` and `LLMImageAttachmentPayload` in `commonType.ts`.
- Attachment validation and base64 conversion in `AiChatBox.vue`.
- Document conversion and staging in `DocumentService`.
- Original attachment byte storage in `AIChatAttachmentModule`.
- `read_attachment_content` tool in `ToolExecutor`.

The V2 design should port these concepts without copying the old component wholesale.

## Target Architecture

```text
Renderer AiChatV2
  - file picker
  - selected file state
  - file to UploadedFilePayload conversion
  - local optimistic message metadata
        |
        v
views/api/aiChatV2.ts
  - ChatV2StreamRequest with attachments
        |
        v
main-process/communication/ai-chat-v2-ipc.ts
  - AI enabled gate
  - JSON parse
  - validate request
        |
        v
AIChatQueryEngine
  - create/reuse conversation
  - normalize attachments
  - save user message with attachment metadata
  - small docs: convert and stage markdown
  - large docs: start RAG ingestion path
  - images: build content parts
        |
        v
AIChatContextAssembler
  - build OpenAI messages
  - current message may be string or content parts
        |
        v
AiChatApi.openAIChatCompletionStream()
  - POST /api/ai/v1/chat/completions
```

## Data Model

### Renderer Upload Payload

Reuse the existing type:

```ts
export type UploadedFilePayload = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
};
```

Add V2-specific types instead of overloading strings:

```ts
export type ChatV2AttachmentKind = "document" | "image";

export interface ChatV2UploadedAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentBase64: string;
  kind: ChatV2AttachmentKind;
}

export interface ChatV2AttachmentMetadata {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: ChatV2AttachmentKind;
  processingMode?: "staged_markdown" | "rag_ingestion" | "image_url";
  documentId?: number;
}
```

Update the stream request:

```ts
export interface ChatV2StreamRequest {
  conversationId?: string;
  message: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  mode?: ChatV2Mode;
  uploadedFiles?: ChatV2UploadedAttachment[];
}
```

### OpenAI Content Parts

Update `OpenAIChatMessage.content` in `aiChatApi.ts` from string-only to:

```ts
export type OpenAITextContentPart = {
  type: "text";
  text: string;
};

export type OpenAIImageUrlContentPart = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type OpenAIMessageContent =
  | string
  | Array<OpenAITextContentPart | OpenAIImageUrlContentPart>;

export interface OpenAIChatMessage {
  role: OpenAIMessageRole;
  content?: OpenAIMessageContent;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}
```

This keeps text messages compatible and allows image messages.

## Attachment Classification

Classification should happen in both renderer and main process. Renderer validation is UX. Main-process validation is enforcement.

```ts
function classifyAttachment(fileName: string, mimeType: string): ChatV2AttachmentKind | null {
  const name = fileName.toLowerCase();
  const mime = mimeType.toLowerCase();

  if (mime.startsWith("image/")) return "image";
  if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image";
  if (name.endsWith(".webp") || name.endsWith(".gif")) return "image";

  if (mime === "application/pdf" || name.endsWith(".pdf")) return "document";
  if (mime === "text/csv" || mime === "application/csv" || name.endsWith(".csv")) return "document";
  if (name.endsWith(".docx") || mime.includes("wordprocessingml.document")) return "document";
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || mime.includes("spreadsheetml.sheet")) return "document";

  return null;
}
```

## Limits

Recommended initial constants:

```ts
const MAX_UPLOAD_FILES = 3;
const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BASE64_BYTES = 10 * 1024 * 1024;
const SMALL_DOCUMENT_DIRECT_MAX_BYTES = 1 * 1024 * 1024;
```

Use 5 MB as the hard per-file transport limit. Use a smaller direct-document threshold to choose between staged markdown and RAG ingestion. Exact threshold can be tuned after conversion benchmarks.

## UI Design

### Composer State

Add state to `AiChatV2.vue`:

```ts
const selectedUploadFiles = ref<File[]>([]);
const isPreparingAttachments = ref(false);
const attachmentError = ref<string | null>(null);
```

The composer should show:

- icon button for file picker,
- selected file rows with file name and size,
- remove icon button,
- spinner while files are converted to payloads,
- compact validation messages above the composer.

Do not place explanatory product text in the UI. Use status labels only.

### Optimistic User Message

When sending, add attachment metadata to the optimistic user message:

```ts
const tempUser: ChatV2MessageView = {
  id: `temp-user-${Date.now()}`,
  conversationId: activeConversationId.value ?? "",
  role: "user",
  content: text,
  timestamp: nowIso,
  messageType: "message" as MessageType,
  metadata: {
    source: "chat-v2",
    attachments: attachmentMetadata,
  },
};
```

`ChatV2MessageMetadata` should gain:

```ts
attachments?: ChatV2AttachmentMetadata[];
```

The history renderer should show attachment chips for user messages.

## Request Building

Add a helper in `AiChatV2.vue` or a small renderer utility:

```ts
async function buildUploadedAttachments(files: File[]): Promise<ChatV2UploadedAttachment[]> {
  const out: ChatV2UploadedAttachment[] = [];
  for (const file of files) {
    const kind = classifyAttachment(file.name, file.type);
    if (!kind) throw new Error("Unsupported file type");
    if (file.size > MAX_UPLOAD_FILE_BYTES) throw new Error("File too large");

    const buffer = await file.arrayBuffer();
    out.push({
      fileName: file.name,
      mimeType: resolveMimeType(file),
      sizeBytes: file.size,
      contentBase64: arrayBufferToBase64(buffer),
      kind,
    });
  }
  return out;
}
```

Send:

```ts
await streamChatV2Message(
  {
    conversationId: activeConversationId.value ?? undefined,
    message: text || defaultPromptForAttachments(files),
    mode: mode.value,
    model: resolveModelForRequest(),
    uploadedFiles,
  },
  onChunk,
  onComplete,
  onError
);
```

## Main Process Validation

Add a validation helper close to `ai-chat-v2-ipc.ts` or in a shared service:

```ts
function normalizeChatV2UploadedFiles(input: unknown): ChatV2UploadedAttachment[] {
  if (!Array.isArray(input)) return [];
  // Validate object shape, name, mime, base64 length, decoded byte length, kind.
}
```

Rules:

- Reject or drop unsupported files with clear error.
- Compare declared `sizeBytes` with decoded byte length.
- Enforce per-file and total image payload limits.
- Never trust renderer MIME type alone.

## Engine Changes

`AIChatQueryEngine.submitMessage()` should process attachments before saving the user message and before calling `AIChatContextAssembler`.

Recommended internal object:

```ts
interface PreparedChatV2Attachments {
  displayMetadata: ChatV2AttachmentMetadata[];
  currentUserMessage: string;
  currentUserContentParts?: Array<OpenAITextContentPart | OpenAIImageUrlContentPart>;
}
```

Processing order:

1. Normalize files from request.
2. Create final `conversationId`.
3. Persist original attachment bytes through `AIChatAttachmentModule`.
4. Prepare documents:
   - small docs: convert to markdown and stage `attachment_ref`;
   - large docs: copy to RAG upload path and trigger ingestion.
5. Prepare images:
   - build data URL image content parts.
6. Save user message with original text and metadata.
7. Assemble OpenAI context using enriched current message.

Important: the saved local message should remain readable as user text. Do not save base64 content in `AIChatMessageEntity.content`. Store only metadata in message metadata and original bytes in the attachment table.

## Small Document Flow

```text
uploaded PDF/DOCX/XLSX/CSV <= threshold
  -> DocumentService.convertUploadedAttachmentToMarkdown()
  -> DocumentService.stageAttachmentMarkdown()
  -> append attachment_ref block to current user message
  -> model can call read_attachment_content
```

Attachment block:

```text
Attached documents are staged locally.
Use the suggested tool for each file.
1. file_name="report.pdf" attachment_ref="..." -> call `read_attachment_content` with attachment_ref="..." to load this file
```

This mirrors legacy chat and avoids putting full document text in the prompt unless the model needs it.

## Large Document RAG Flow

```text
uploaded document > direct threshold
  -> save original bytes
  -> create temp file or controlled upload file
  -> RAG uploadDocument()
  -> chunkAndEmbedDocument()
  -> store documentId in message metadata
  -> current turn uses an indexing-status prompt if ingestion is not ready
  -> future turns use knowledge_library_search / local RAG retrieval
```

Large document ingestion must not block the renderer indefinitely. The first implementation can process synchronously for modest files, but the design should allow background progress events.

Recommended metadata:

```ts
{
  fileName: "manual.pdf",
  mimeType: "application/pdf",
  sizeBytes: 4200000,
  kind: "document",
  processingMode: "rag_ingestion",
  documentId: 123
}
```

When retrieval is used, source names should appear in the answer if the AI server or local RAG tool provides source metadata.

## Image Flow

```text
uploaded image
  -> validate locally
  -> persist metadata/original bytes locally
  -> build data:image/...;base64,... URL
  -> current user OpenAI message content becomes:
       [{ type: "text", text: question }, { type: "image_url", image_url: { url, detail: "auto" } }]
  -> AI server decides multimodal model or fallback
```

The desktop app does not call a "check multimodal support" endpoint.

## Context Assembler Changes

`AIChatContextAssembler` currently appends:

```ts
messages.push({ role: "user", content: input.currentUserMessage });
```

Update input:

```ts
export interface AIChatContextAssembleInput {
  readonly currentUserMessage: string;
  readonly currentUserContent?: OpenAIMessageContent;
  // existing fields...
}
```

Then:

```ts
messages.push({
  role: "user",
  content: input.currentUserContent ?? input.currentUserMessage,
});
```

For history rows, keep string content. Only the active current turn needs image parts. Persisting historical image parts in `content` would bloat local DB and expose base64 to logs. Historical image metadata stays in message metadata.

## AiChatApi Changes

`OpenAIChatCompletionRequest` and debug redaction must support content arrays.

Redaction rule:

```ts
if (key === "url" && typeof value === "string" && value.startsWith("data:image/")) {
  redacted[key] = `<image data url len=${value.length}>`;
}
```

Keep current request path:

```text
POST /api/ai/v1/chat/completions
```

No new app endpoint is required for image chat.

## i18n Keys

Add keys under `aiChatV2.attachments` in all language files:

```ts
attachments: {
  add: "Attach file",
  remove: "Remove attachment",
  too_many: "Maximum {max} files allowed.",
  too_large: "{name} exceeds the {maxSize} limit.",
  unsupported: "{name} is not a supported file type.",
  preparing: "Preparing attachment...",
  document_indexing: "Indexing document...",
  document_ready: "Document ready",
  document_failed: "Document processing failed",
}
```

Avoid hard-coded fallback strings in templates unless the existing component pattern requires them.

## Security

- Do not expose local file paths to the AI server.
- Do not persist base64 in chat message text.
- Redact base64 from debug logs.
- Validate attachments in main process even after renderer validation.
- Keep staged attachment refs conversation-scoped.
- Delete temp files after conversion or ingestion.
- Treat extracted document text as untrusted context.
- Keep DB work in Model/Module classes, never direct in IPC handlers.

## Tests

### Unit Tests

Add tests for:

- `classifyAttachment()`
- base64 conversion helper
- `normalizeChatV2UploadedFiles()`
- image content part construction
- small document attachment block generation
- context assembler with `currentUserContent`
- debug redaction for data URLs

### Integration Tests

Add tests for:

- AiChatV2 stream request with image payload reaches `AiChatApi.openAIChatCompletionStream()`.
- AiChatV2 stream request with small PDF produces a staged `attachment_ref`.
- Large document creates RAG document and metadata.
- Stop-stream still cancels a turn with attachments.
- Tool calls still execute after an attachment message.

### Manual QA

1. Send text-only message.
2. Send image-only message with default prompt.
3. Send text plus image.
4. Send small PDF and ask for summary.
5. Send XLSX and ask for sheet summary.
6. Send large PDF and verify indexing state.
7. Switch conversations and verify attachment metadata renders.
8. Clear conversation and verify attachment bytes are deleted.

## Implementation Plan

### Phase 1: Types And UI

1. Add V2 attachment types.
2. Add composer file picker and selected-file UI.
3. Add i18n keys.
4. Add renderer file validation and payload building.

### Phase 2: Main Process Preparation

1. Add main-process normalization.
2. Persist original attachment bytes.
3. Save metadata on user message.
4. Add debug redaction.

### Phase 3: Documents

1. Port small-document staging into V2.
2. Add RAG-ingestion path for large documents.
3. Add status metadata and UI states.

### Phase 4: Images

1. Add `OpenAIMessageContent` union.
2. Add `currentUserContent` to context assembler.
3. Build image data URL content parts.
4. Verify server receives `image_url` parts.

### Phase 5: Verification

1. Add unit tests.
2. Add focused integration tests.
3. Run `yarn vue-check` and relevant TypeScript checks.
4. Run chat manual QA.

## Open Decisions

1. Final byte threshold between staged markdown and RAG ingestion.
2. Whether RAG ingestion from chat should be automatic or user-confirmed.
3. Whether historical image messages should allow "resend with image" by reading original bytes from attachment storage.
4. Whether GIFs should be sent as data URLs, reduced to the first frame, or rejected.

## References

- Product requirements: `docs/ai-chat-v2-attachment-upload-prd.md`
- OpenAI-compatible chat v2 PRD: `docs/openai-compatible-chat-v2-prd.md`
- Existing document conversion: `src/service/DocumentService.ts`
- Existing legacy attachment flow: `src/main-process/communication/ai-chat-ipc.ts`
- Existing RAG renderer API: `src/views/api/rag.ts`

