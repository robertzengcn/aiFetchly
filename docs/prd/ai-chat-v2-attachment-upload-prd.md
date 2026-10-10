# AiChatV2 Attachment Upload - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-07-01
- **Owner**: Engineering Team
- **Related Systems**: AiChatV2, AIChatQueryEngine, AIChatContextAssembler, DocumentService, RAG, AI server OpenAI-compatible API

## Executive Summary

AiChatV2 should support user-uploaded attachments in chat. Users should be able to attach documents and images to a message and ask questions about them without leaving the chat panel.

The desktop app should package attachments and preserve local chat history, but it should not own model capability decisions. Images should be sent to the AI server as OpenAI-style image content parts. The AI server will decide whether to use a multimodal model or a server-side fallback.

Documents should keep the existing text/RAG-oriented approach. Small one-off documents can be converted to text or markdown and staged for the current conversation. Large documents should be parsed, chunked, embedded, stored in the vector database, and retrieved by relevance when the user asks questions.

## Background And Problem Statement

AiChatV2 currently sends text-only OpenAI-compatible chat requests. Users cannot attach PDFs, DOCX files, spreadsheets, CSV files, or images directly in the v2 chat panel.

The legacy chat stack already has partial attachment infrastructure:

- It accepts uploaded files in the renderer.
- It stores uploaded file metadata and bytes locally.
- It converts supported documents to markdown.
- It stages converted document content behind an `attachment_ref`.
- It exposes a `read_attachment_content` tool so the model can load staged content on demand.

AiChatV2 should reuse the proven parts of this design while adding an image path that fits the OpenAI-compatible API boundary.

## Goals

1. Let users attach supported files to AiChatV2 messages.
2. Keep the desktop app responsible for file selection, validation, local persistence, and packaging.
3. Keep server-side model routing and multimodal fallback policy inside the AI server.
4. Support small document Q&A through text extraction and staged attachment references.
5. Support large document Q&A through parse, chunk, embed, vector storage, retrieval, and prompt injection.
6. Send image attachments as OpenAI-style `image_url` content parts to the server.
7. Preserve all existing AiChatV2 local-history behavior and tool-calling behavior.
8. Add complete i18n coverage for all user-facing text.

## Non-Goals

1. Do not send raw PDF, DOCX, XLSX, or CSV files directly to a text LLM.
2. Do not make the renderer call the AI server directly.
3. Do not make the desktop app decide whether a server-side multimodal model is available.
4. Do not implement full video understanding in the first release.
5. Do not remove legacy AiChatBox attachment support during this work.
6. Do not allow worker processes to access the local database directly.

## Users And Use Cases

### Primary Users

- Users who want to ask questions about campaign documents, lead lists, reports, screenshots, and marketing assets.
- Users who need the AI assistant to compare or summarize uploaded documents.
- Users who want to ask a question about an image without configuring model details manually.

### Core Use Cases

1. A user attaches a PDF and asks for a summary.
2. A user attaches a large PDF manual and asks specific follow-up questions.
3. A user attaches an XLSX lead list and asks for patterns in the rows.
4. A user attaches a CSV export and asks the AI to find useful segments.
5. A user attaches an image or screenshot and asks what it shows.
6. A user switches away and returns to the conversation, still seeing attachment metadata in the message history.

## Product Behavior

### Supported File Types

Initial support:

- PDF: `.pdf`, `application/pdf`
- DOCX: `.docx`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- CSV: `.csv`, `text/csv`, `application/csv`
- XLSX/XLS: `.xlsx`, `.xls`, spreadsheet MIME types
- Images: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `image/*`

Video files are deferred. The expected future model is keyframe extraction plus transcript extraction, then derived image/text context.

### Attachment Size Policy

The first release should retain conservative limits:

- Maximum files per message: 3
- Maximum raw file size per attachment: 5 MB
- Maximum total image base64 payload sent to the server: 10 MB

Large-document handling should not mean larger chat payloads. Large documents should enter the RAG ingestion path, not the direct prompt path.

### User Experience

AiChatV2 composer should add:

- Attach button with file picker.
- Selected attachment chips or compact rows.
- Remove button for each pending file.
- Upload/processing state.
- Per-file validation errors.
- Message-level attachment preview after send.
- Clear distinction between direct chat attachment and large document ingestion.

For documents that are ingested into the knowledge base, the UI should show that the file is being processed before it is available for retrieval.

### Image Behavior

The desktop app should package images as OpenAI-style content parts and send them to the AI server. It should not check model capability.

Target content shape:

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "What is in this image?" },
    {
      "type": "image_url",
      "image_url": {
        "url": "data:image/png;base64,...",
        "detail": "auto"
      }
    }
  ]
}
```

The app should use data URLs for initial implementation. Remote image URLs are out of scope because server-side URL fetch creates security risk.

### Small Document Behavior

For small one-off documents, the app should:

1. Validate file type and size.
2. Persist attachment metadata and bytes locally.
3. Convert the file to markdown/text.
4. Stage the converted content under a conversation-scoped `attachment_ref`.
5. Add an instruction block to the user message telling the model which `attachment_ref` to use.
6. Expose the existing `read_attachment_content` tool to the model.

This preserves the legacy chat behavior while making it available in AiChatV2.

### Large Document Behavior

For large documents, the app should route through RAG:

1. Parse or extract text from the file.
2. Chunk extracted text.
3. Generate embeddings.
4. Store chunks and embeddings in the local vector database.
5. When the user asks a question, retrieve relevant chunks.
6. Send retrieved chunks plus the user question to the LLM.

The user should not have to understand this pipeline. The UI should show processing status and then allow questions once indexing is complete.

## Functional Requirements

### FR1: Attachment Selection

AiChatV2 composer must support selecting supported files through a native file picker or browser file input.

Acceptance criteria:

- The user can select up to 3 files.
- Unsupported file types are rejected before send.
- Oversized files are rejected before send.
- The same file can be selected again after removal.
- All validation messages use i18n keys in all supported languages.

### FR2: Attachment Request Type

`ChatV2StreamRequest` must support attachment payloads.

Required fields:

- `uploadedFiles?: UploadedFilePayload[]`
- `imageContentParts?: OpenAI-style image content parts` or equivalent internal type
- Optional attachment metadata for local display

Acceptance criteria:

- Existing text-only requests remain valid.
- Renderer types do not use `any`.
- Payloads are validated again in the main process before use.

### FR3: Local Attachment Persistence

The main process must persist attachment metadata and original bytes using the existing model/module architecture.

Acceptance criteria:

- IPC handler does not access TypeORM repositories directly.
- Metadata appears in chat history for user messages.
- Clearing a conversation clears associated attachment bytes.
- Attachment persistence errors fail gracefully and do not corrupt chat history.

### FR4: Small Document Staging

The main process must convert supported documents to markdown and stage them behind `attachment_ref`.

Acceptance criteria:

- PDF, DOCX, CSV, and XLSX/XLS convert to text or markdown.
- The current user message is augmented with staged attachment references before context assembly.
- The model can call `read_attachment_content` with the staged reference.
- Staged references are scoped to the conversation.
- Invalid or missing references return safe tool errors.

### FR5: Large Document RAG

Large documents must be processed through the RAG pipeline.

Acceptance criteria:

- Extracted text is chunked before embedding.
- Embeddings are stored in the vector database.
- Retrieval happens when the user asks document-related questions.
- Retrieved chunks include source metadata.
- The chat answer can cite or name the retrieved source document.
- The system handles partially failed ingestion with clear status.

### FR6: Image Packaging

Image attachments must be sent to the AI server as OpenAI-style `image_url` content parts.

Acceptance criteria:

- The app uses `data:image/...;base64,...` URLs.
- The app does not perform server model capability checks.
- The main process validates MIME type and payload size before sending.
- Images are not also converted to document text locally in the first release.

### FR7: Streaming Compatibility

Attachment support must not break AiChatV2 streaming.

Acceptance criteria:

- Text tokens still stream normally.
- Stop-stream still aborts the active turn.
- Tool calls still work after attachment-related context is added.
- Errors from server image routing are displayed in the existing error UI.

### FR8: i18n

All new user-facing text must be translated in:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

Acceptance criteria:

- No hard-coded user-facing strings in Vue templates or interaction code.
- English fallback is present where existing patterns require it.

## Technical Requirements

### Target App Files

Expected files to update:

- `src/entityTypes/aiChatV2Types.ts`
- `src/views/components/aiChatV2/AiChatV2.vue`
- `src/views/api/aiChatV2.ts`
- `src/main-process/communication/ai-chat-v2-ipc.ts`
- `src/service/AIChatQueryEngine.ts`
- `src/service/AIChatContextAssembler.ts`
- `src/service/DocumentService.ts` only if additional conversion hooks are needed
- `src/modules/AIChatAttachmentModule.ts` only if V2 needs API additions
- `src/views/lang/*.ts`

### Architecture Rules

- Renderer talks to preload-safe API wrappers only.
- Renderer API wrapper sends IPC request to main process.
- Main process validates uploaded file payloads.
- Main process calls modules/services for persistence and conversion.
- IPC handlers must check `USER_AI_ENABLED` before parsing or doing AI work.
- Database work must stay in Model/Module classes.

### Context Assembly

The attachment-enriched message must be available before `AIChatContextAssembler` builds the OpenAI messages array. For documents, this means the current user message may become:

```text
Summarize this file.

Attached documents are staged locally.
Use the suggested tool for each file (pass the exact attachment_ref value shown).
1. file_name="report.pdf" attachment_ref="..." -> call `read_attachment_content` with attachment_ref="..." to load this file
```

For images, the current OpenAI message should use content parts instead of plain string content.

## Success Metrics

- 95% of valid supported attachments are accepted and processed without UI errors.
- P95 attachment validation time under 200 ms for local checks.
- P95 small document conversion under 5 seconds for files under 5 MB.
- Large document ingestion exposes progress states and does not block the UI.
- Image messages reach the AI server with valid OpenAI-style image content parts.
- Existing AiChatV2 text-only chat regression tests continue to pass.

## Error Handling

The app must show clear errors for:

- Unsupported file type.
- File too large.
- Too many files.
- Document conversion failure.
- RAG ingestion failure.
- Server rejection of image content.
- Network failure while streaming.

Errors must not leave the composer stuck in a loading state.

## Security And Privacy

- Do not allow remote image URLs in the first release.
- Do not expose local absolute paths in prompts or server payloads.
- Do not write attachment bytes outside controlled app storage or temp directories.
- Delete temp files after conversion.
- Scope staged document references to the conversation.
- Treat attachment content as user-provided untrusted data.
- Keep database access in main process modules only.

## Open Questions

1. What threshold should promote a document from small-document staging to RAG ingestion?
2. Should users be able to force "index into knowledge base" from the chat attachment UI?
3. Should image attachments be persisted as original bytes in local chat history or only metadata?
4. Should GIFs use first-frame extraction, be rejected, or be sent as-is to the server?

## Milestones

### Milestone 1: Text And Document Attachments In AiChatV2

- Composer upload UI.
- Attachment validation.
- V2 request type additions.
- Local metadata and byte persistence.
- Small document conversion and `attachment_ref` staging.
- `read_attachment_content` tool path verified from V2.

### Milestone 2: Large Document RAG Path

- Route large documents to parse/chunk/embed/store.
- Add processing progress UI.
- Retrieve relevant chunks during chat.
- Add source metadata in answers.

### Milestone 3: Image Content Parts

- Send images as OpenAI-style `image_url` content parts.
- Handle server multimodal or fallback results.
- Add image-specific error states.

### Milestone 4: QA And Polish

- Add focused unit tests for payload validation and context assembly.
- Add renderer tests where practical.
- Verify i18n coverage.
- Regression-test normal text chat, tool calls, stop-stream, and conversation switching.

