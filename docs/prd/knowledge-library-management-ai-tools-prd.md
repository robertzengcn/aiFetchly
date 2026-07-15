# Knowledge Library Management AI Tools - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-07-15
- **Owner**: Engineering Team
- **Related systems**: AiChatV2, AI tool calling, SkillRegistry, RAG, DocumentService, RAGDocumentModule, RagSearchModule
- **Related PRDs**:
  - `docs/rag-tool-call-rerank-prd.md`
  - `docs/ai-chat-v2-attachment-upload-prd.md`
  - `docs/prd/ai-app-navigation-tool-prd.md`
- **Related files**:
  - `src/service/DocumentService.ts`
  - `src/modules/RAGDocumentModule.ts`
  - `src/modules/RagSearchModule.ts`
  - `src/controller/RagSearchController.ts`
  - `src/config/skillsRegistry.ts`
  - `src/service/ToolExecutor.ts`
  - `src/service/SkillExecutor.ts`
  - `src/service/SkillPermissionService.ts`
  - `src/main-process/communication/rag-ipc.ts`
  - `src/main-process/communication/ai-chat-v2-ipc.ts`
  - `src/views/components/aiChatV2/AiChatV2.vue`

## 1. Summary

AiFetchly already has a local knowledge library backed by RAG document upload, chunking, embeddings, vector search, and the `knowledge_library_search` AI tool. Users can ask questions about uploaded documents, but the AI assistant cannot yet help manage the library itself.

This feature adds AI-callable knowledge library management tools so the assistant can:

1. List and inspect documents in the knowledge library.
2. Import user-attached chat documents into the knowledge library.
3. Delete documents from the knowledge library with explicit user approval.

The implementation must reuse the existing RAG ingestion and deletion services instead of adding direct database access in IPC handlers or AI tool wrappers. Import and delete are mutating operations and must go through the existing skill permission flow before execution.

The first release should support importing documents that the user has attached to the current chat conversation via `attachment_ref`. It should not allow the model to import arbitrary local file paths.

## 2. Problem Statement

Users often attach documents in AI chat and then ask the assistant to "save this to the knowledge library", "remember this document", or "remove the old pricing PDF from knowledge". Today the assistant can read staged attachments and search the knowledge library, but it cannot perform those library-management actions.

This creates workflow friction:

1. Users must leave chat and manually use the knowledge library UI to import a document.
2. Users must know which page manages RAG documents.
3. The assistant cannot clean up outdated documents even when the user gives a clear instruction.
4. The assistant can answer from knowledge, but cannot help maintain the quality of that knowledge.
5. Any naive implementation that exposes raw file paths or direct database operations would risk local file disclosure, unsafe deletion, or architecture drift.

The product needs AI tools that make knowledge management conversational while preserving the existing app-owned upload staging, RAG processing, permission prompts, and delete safeguards.

## 3. Goals

1. Let users ask AI Chat to import an attached document into the knowledge library.
2. Let users ask AI Chat to delete a specific document from the knowledge library.
3. Let AI Chat list knowledge library documents so it can identify the correct document before deletion.
4. Reuse existing RAG upload, chunking, embedding, and delete logic.
5. Keep all database operations inside Model/Module/Service layers, never directly in AI chat IPC handlers.
6. Prevent arbitrary local-file import through AI tool parameters.
7. Require user confirmation before import and delete tools run.
8. Return concise, structured tool results that the assistant can explain to users.
9. Preserve existing `knowledge_library_search` behavior.
10. Support AiChatV2 generic tool call/result rendering without requiring custom UI for MVP.
11. Respect the AI feature gate before running AI-dependent RAG work.
12. Add focused tests for tool schemas, permissions, import flow, delete flow, and unsafe-path rejection.

## 4. Non-Goals

1. Do not allow the AI to import any arbitrary local file path in the MVP.
2. Do not let workers access the database directly.
3. Do not redesign the knowledge library UI.
4. Do not replace the existing `RAG_UPLOAD_DOCUMENT` IPC flow.
5. Do not create duplicate database access paths from AI chat IPC handlers.
6. Do not delete source files outside app-owned RAG upload storage.
7. Do not bypass the existing skill permission and tool approval mode systems.
8. Do not add a new vector database implementation.
9. Do not implement folder sync or bulk crawling in the first release.
10. Do not let retrieved documents or uploaded content override tool policy, permission requirements, or system instructions.

## 5. Target Users

### 5.1 Marketing Operator

Uses chat while building campaigns and wants to save lead sheets, product PDFs, or campaign notes into the knowledge library without switching pages.

Example:

```text
Add this lead qualification guide to the knowledge library and tag it sales.
```

### 5.2 Knowledge Library Maintainer

Keeps documents current and wants the assistant to find outdated documents and remove them.

Example:

```text
Delete the old 2024 pricing PDF from knowledge.
```

### 5.3 Power User

Uses AI Chat as a command surface for app workflows and expects tool calls to be transparent, permissioned, and reversible where possible.

Example:

```text
Show me the documents in the library, then remove the duplicate CSV.
```

## 6. Current Architecture Findings

### 6.1 Existing Document Service Boundary

`DocumentService` is already the facade for document operations. It delegates upload, validation, metadata, listing, and deletion to `RAGDocumentModule`.

Important existing behavior:

- `DocumentService.uploadDocument()` delegates to `RAGDocumentModule.uploadDocument()`.
- `DocumentService.deleteDocument()` delegates to `RAGDocumentModule.deleteDocument()`.
- Chat attachments can be converted to markdown and staged behind conversation-scoped `attachment_ref` values.
- Staged attachment metadata includes original file content when provided.

### 6.2 Existing RAG Upload Safety

`RAGDocumentModule.uploadDocument()` validates the source file, then copies it into an app-owned `rag_uploads` directory before persisting it. The persisted `document.filePath` is the staged path, not the external renderer-provided path.

This is the correct path for AI import because it prevents a model or compromised renderer from causing arbitrary local files to be embedded by known path.

### 6.3 Existing RAG Delete Safety

`RAGDocumentModule.deleteDocument()` deletes associated vectors and database rows. Physical file deletion is guarded by containment checks so only files under app-owned RAG upload staging can be unlinked. Vector index deletion is also constrained to allowed roots.

The delete tool must call this existing flow instead of implementing its own filesystem or database deletion.

### 6.4 Existing Tool Calling

Built-in AI tools are registered in `SkillRegistry`. AiChatV2 executes registered tools through `SkillExecutor` and displays generic tool call/result cards. Permission prompts are already supported for non-pure tools.

`knowledge_library_search` is already registered as a pure read-only built-in tool. The new tools should be registered adjacent to it.

### 6.5 Existing Attachment Handling Gap

Legacy chat already builds `attachment_ref` values for uploaded documents. AiChatV2 accepts uploaded files and normalizes payloads, but document attachment staging should be verified and shared before import-by-attachment is exposed in v2.

If AiChatV2 does not yet stage document attachments into `DocumentService.stageAttachmentMarkdown()` with original content, that must be added as part of this feature or as a prerequisite.

## 7. Proposed Solution

Add three built-in AI tools:

1. `knowledge_library_list_documents`
2. `knowledge_library_import_attachment`
3. `knowledge_library_delete_document`

Optional later tools:

1. `knowledge_library_get_document`
2. `knowledge_library_update_document_metadata`
3. `knowledge_library_import_selected_file`
4. `knowledge_library_bulk_delete_documents`

The MVP should focus on the first three tools.

## 8. User Experience

### 8.1 Import Attached Document

User attaches `pricing-guide.pdf` and sends:

```text
Save this to the knowledge library with tags pricing and sales.
```

Expected behavior:

1. AiChatV2 stages the attached document and injects the `attachment_ref` instruction into the conversation context.
2. The model calls `knowledge_library_import_attachment`.
3. The app shows the existing tool permission prompt because import is mutating and may trigger embedding work.
4. User approves.
5. Tool imports the staged original file through the existing RAG upload pipeline.
6. Tool result returns document ID, name, processing status, chunk count, and tags.
7. Assistant confirms the document was added.

Example assistant response:

```text
Imported `pricing-guide.pdf` into the knowledge library as document #42 with tags `pricing` and `sales`.
```

### 8.2 Delete Existing Document

User sends:

```text
Delete the old pricing guide from the knowledge library.
```

Expected behavior:

1. The model calls `knowledge_library_list_documents` to identify candidates.
2. If multiple matches exist, assistant asks the user to choose.
3. Once a specific document ID is known, the model calls `knowledge_library_delete_document`.
4. The app shows the existing permission prompt.
5. User approves.
6. Tool deletes vectors, chunks, database row, and optionally app-owned source file.
7. Assistant confirms deletion.

### 8.3 Ambiguous Delete

If there are multiple similar documents:

```text
I found 3 matching documents:
1. #18 pricing-guide-2024.pdf
2. #42 pricing-guide-2025.pdf
3. #51 pricing-guide-draft.pdf

Which one should I delete?
```

The delete tool should not be called until a specific ID is selected.

## 9. Tool Contracts

### 9.1 `knowledge_library_list_documents`

Purpose: Let the model inspect the library and find document IDs before performing targeted operations.

Permission:

- `requiresConfirmation: false`
- `permissionCategory: "pure"`

Schema:

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Optional case-insensitive name/title search."
    },
    "status": {
      "type": "string",
      "description": "Optional document status filter."
    },
    "processingStatus": {
      "type": "string",
      "description": "Optional processing status filter."
    },
    "fileType": {
      "type": "string",
      "description": "Optional file extension filter, such as .pdf or .csv."
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Optional tag filter."
    },
    "limit": {
      "type": "number",
      "default": 20,
      "description": "Maximum documents to return. Clamp to 50."
    },
    "offset": {
      "type": "number",
      "default": 0,
      "description": "Pagination offset."
    }
  },
  "required": []
}
```

Result:

```json
{
  "success": true,
  "documents": [
    {
      "id": 42,
      "name": "pricing-guide.pdf",
      "title": "Pricing Guide",
      "description": "Uploaded document: pricing-guide.pdf",
      "tags": ["pricing", "sales"],
      "author": "User",
      "fileType": ".pdf",
      "fileSize": 183920,
      "status": "active",
      "processingStatus": "completed",
      "uploadedAt": "2026-07-15T09:20:00.000Z"
    }
  ],
  "limit": 20,
  "offset": 0,
  "returned": 1
}
```

Notes:

- Do not return full file paths by default.
- Include document IDs because delete requires exact IDs.
- Clamp `limit` to avoid bloating tool results.

### 9.2 `knowledge_library_import_attachment`

Purpose: Import a document attached to the current chat conversation into the knowledge library.

Permission:

- `requiresConfirmation: true`
- `permissionCategory: "filesystem"` or `"automation"`
- Recommended MVP category: `"filesystem"` because it persists a local document and may delete staged temp data later. If product wants import grouped with RAG processing, `"automation"` is also defensible.

Schema:

```json
{
  "type": "object",
  "properties": {
    "attachment_ref": {
      "type": "string",
      "description": "Conversation-scoped attachment reference from the user's uploaded document."
    },
    "title": {
      "type": "string",
      "description": "Optional document title."
    },
    "description": {
      "type": "string",
      "description": "Optional document description."
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Optional document tags."
    },
    "author": {
      "type": "string",
      "description": "Optional document author. Defaults to User."
    },
    "duplicatePolicy": {
      "type": "string",
      "enum": ["fail", "allow", "replace"],
      "default": "fail",
      "description": "How to handle duplicate name/size or hash matches."
    }
  },
  "required": ["attachment_ref"]
}
```

MVP result:

```json
{
  "success": true,
  "documentId": 42,
  "name": "pricing-guide.pdf",
  "title": "Pricing Guide",
  "tags": ["pricing", "sales"],
  "fileType": ".pdf",
  "fileSize": 183920,
  "processingStatus": "completed",
  "chunksCreated": 37,
  "processingTimeMs": 4820,
  "summary": "Imported pricing-guide.pdf into the knowledge library as document #42."
}
```

Failure result examples:

```json
{
  "success": false,
  "error": "attachment_ref parameter is required."
}
```

```json
{
  "success": false,
  "error": "Attachment original file is no longer available. Ask the user to upload it again."
}
```

```json
{
  "success": false,
  "error": "No default embedding model configured. Please configure an embedding model before importing documents."
}
```

Rules:

- Only accept `attachment_ref`, not `filePath`, in the MVP.
- Resolve the attachment through `DocumentService` using the active `conversationId`.
- Prefer importing the staged original file path created by `stageAttachmentMarkdown(..., { originalContentBase64 })`.
- If only markdown exists and original file is unavailable, either:
  - fail with a clear message in MVP, or
  - create an app-owned `.md` import file as a later enhancement.
- Never read arbitrary paths supplied by the model.
- Run the same RAG upload pipeline used by normal UI imports.
- Return no raw vector index paths.
- Return no app `userData` paths unless explicitly needed for debugging and never in model-facing default output.

### 9.3 `knowledge_library_delete_document`

Purpose: Delete one known document from the knowledge library.

Permission:

- `requiresConfirmation: true`
- `permissionCategory: "filesystem"`

Schema:

```json
{
  "type": "object",
  "properties": {
    "document_id": {
      "type": "number",
      "description": "Exact knowledge library document ID to delete."
    },
    "delete_source_file": {
      "type": "boolean",
      "default": false,
      "description": "Whether to delete the app-owned staged source file as well as the library record, chunks, and vectors."
    },
    "expected_name": {
      "type": "string",
      "description": "Optional safety check. If provided, the document name/title must match before deletion."
    }
  },
  "required": ["document_id"]
}
```

Result:

```json
{
  "success": true,
  "documentId": 42,
  "name": "pricing-guide.pdf",
  "deletedSourceFile": false,
  "summary": "Deleted document #42 from the knowledge library."
}
```

Rules:

- Require exact `document_id`.
- If the user provided a natural language delete request and the model does not know the ID, the model should call `knowledge_library_list_documents` first.
- If `expected_name` is supplied and does not match document name or title, fail closed.
- Use existing delete logic in `DocumentService` / `RAGDocumentModule`.
- Delete vectors and chunks through the existing RAG deletion path.
- If `delete_source_file` is true, rely on `RAGDocumentModule` containment checks. Do not add a direct `fs.unlink` in the tool.

## 10. Functional Requirements

### FR1: Document Listing Tool

The system must expose a read-only tool for listing knowledge library documents.

Acceptance criteria:

- Tool is visible in `SkillRegistry.getAllToolFunctions()`.
- Tool is marked pure and does not prompt.
- Tool returns document IDs and compact metadata.
- Tool supports filtering by query/name, tags, status, processing status, file type, limit, and offset.
- Tool clamps result size to a maximum of 50 documents.
- Tool does not expose raw local file paths in default output.

### FR2: Import Attachment Tool

The system must expose a mutating tool for importing a current chat attachment into the knowledge library.

Acceptance criteria:

- Tool accepts `attachment_ref`.
- Tool requires user confirmation before execution.
- Tool resolves attachments only within the active conversation.
- Tool imports through the existing RAG upload pipeline.
- Tool rejects missing, expired, invalid, or cross-conversation attachment references.
- Tool returns document ID, status, chunk count, and compact metadata.
- Tool does not accept arbitrary local file paths.

### FR3: Delete Document Tool

The system must expose a mutating tool for deleting a document by ID.

Acceptance criteria:

- Tool requires `document_id`.
- Tool requires user confirmation before execution.
- Tool loads document metadata before deletion so it can return a meaningful result.
- Tool calls existing RAG deletion logic.
- Tool deletes vectors/chunks/database row.
- Tool only deletes source file when requested and only through existing safe deletion checks.
- Tool fails if the document does not exist.

### FR4: AiChatV2 Attachment Staging

AiChatV2 must provide document attachments in a form that import-by-reference can consume.

Acceptance criteria:

- Supported document attachments are staged with a conversation-scoped `attachment_ref`.
- Staged metadata preserves original file name and content hash.
- Staging preserves original file content or a safe app-owned import file for later RAG upload.
- The assistant receives an instruction block showing available `attachment_ref` values.
- Image-only attachments are not offered to the import-document tool unless image ingestion is explicitly supported later.

### FR5: Permission Handling

Mutating knowledge library tools must integrate with existing tool permission UI.

Acceptance criteria:

- Import and delete show the existing permission prompt in default `ask_for_approval` mode.
- Import and delete are not classified as pure tools.
- Tool approval mode behavior follows existing `AIChatToolApprovalPolicyService` rules.
- Denied tool calls do not mutate the knowledge library.
- Tool results clearly indicate permission denial when applicable.

### FR6: AI Feature Gate

AI-dependent RAG processing must respect the existing AI enable flag.

Acceptance criteria:

- Import fails before embedding work if AI is disabled.
- Error is user-readable.
- Read-only listing may remain available without AI if it only reads local metadata.
- Search remains governed by existing AI gate behavior for embedding-dependent query work.

### FR7: Duplicate Handling

The import tool must avoid accidental duplicate ingestion.

Acceptance criteria:

- MVP supports `duplicatePolicy: "fail"` by default.
- Duplicate check uses available metadata, such as name and file size, and should use content hash when available.
- If duplicate is detected, the tool returns existing document candidates.
- `duplicatePolicy: "allow"` imports anyway.
- `duplicatePolicy: "replace"` is optional for MVP and may be deferred if it requires stronger transactional handling.

## 11. Architecture Requirements

### 11.1 New Service Wrapper

Add a dedicated service:

```text
src/service/KnowledgeLibraryAiTools.ts
```

Responsibilities:

- Validate and normalize AI tool arguments.
- Resolve staged attachments by `conversationId`.
- Call `RagSearchModule`, `RAGDocumentModule`, or `DocumentService`.
- Format compact tool results.
- Avoid direct TypeORM repository access.

The service should expose functions such as:

```ts
export async function listKnowledgeLibraryDocumentsForAi(
  input: ListKnowledgeDocumentsInput
): Promise<ListKnowledgeDocumentsResult>;

export async function importKnowledgeLibraryAttachmentForAi(
  input: ImportKnowledgeAttachmentInput,
  context: SkillExecutionContext
): Promise<ImportKnowledgeAttachmentResult>;

export async function deleteKnowledgeLibraryDocumentForAi(
  input: DeleteKnowledgeDocumentInput
): Promise<DeleteKnowledgeDocumentResult>;
```

### 11.2 SkillRegistry Integration

Add built-in skill definitions in `src/config/skillsRegistry.ts` near `knowledge_library_search`.

Expected shape:

```ts
{
  name: "knowledge_library_import_attachment",
  description: "...",
  parameters: { ... },
  tier: "main",
  requiresConfirmation: true,
  permissionCategory: "filesystem",
  source: "built-in",
  timeoutClass: "network",
  execute: async (args, context) => {
    const result = await importKnowledgeLibraryAttachmentForAi(args, context);
    return { success: result.success, result };
  },
}
```

Import may require embedding calls, so its timeout class should not be the shortest default. If large imports can exceed synchronous tool timeout budgets, the implementation should use the existing async tool job architecture in a later phase.

### 11.3 DocumentService Extension

Current staged attachment read returns markdown, filename, and hash. Import needs access to a safe original file path or a safe generated markdown file.

Add one of these:

Option A, preferred:

```ts
async getStagedAttachmentImportSource(
  conversationId: string,
  refId: string
): Promise<{
  fileName: string;
  filePath: string;
  sha256?: string;
}>;
```

Rules:

- Validate `refId`.
- Scope to sanitized `conversationId`.
- Ensure source path is inside the staged attachment directory.
- Ensure source file exists and size is within import limits.
- Return original staged file path when available.

Option B:

```ts
async materializeStagedAttachmentMarkdownForImport(...): Promise<...>
```

This creates an app-owned `.md` file from staged markdown and imports that. Use this only when the original file was not staged.

### 11.4 RAG Upload Flow

Import must call:

```text
RagSearchModule.uploadDocument()
  -> DocumentService.uploadDocument()
  -> RAGDocumentModule.uploadDocument()
  -> app-owned rag_uploads staging
  -> chunking
  -> embedding
  -> metadata update
```

Do not duplicate chunking or embedding in the AI tool layer.

### 11.5 RAG Delete Flow

Delete must call:

```text
DocumentService.deleteDocument()
  -> RAGDocumentModule.deleteDocument()
  -> vector deletion
  -> safe vector index cleanup
  -> optional safe source file cleanup
  -> database delete
```

If controller-level deletion currently adds chunk deletion after document deletion, evaluate whether to call `RagSearchController.deleteDocument()` or consolidate chunk cleanup in one module path to avoid duplicate or order-sensitive cleanup.

### 11.6 IPC Boundaries

No new direct renderer IPC is required for MVP if the tools are only invoked by AI Chat. If a future UI button uses the same functionality, add validated IPC handlers that call the same service/module methods.

Any new IPC handler that serves AI functionality must check AI enable first according to project rules.

## 12. Security And Safety Requirements

### 12.1 Path Safety

- AI tool args must never accept raw local import paths in MVP.
- `attachment_ref` must be conversation-scoped.
- Staged source file paths must be verified as contained under the staged attachment root.
- RAG upload must still copy into app-owned `rag_uploads`.
- Delete must rely on existing containment checks.

### 12.2 Prompt Injection

Documents and tool results are untrusted content.

Requirements:

- Tool descriptions must not tell the model to follow instructions inside documents.
- Knowledge library import must not execute instructions found in uploaded content.
- Delete decisions must be based on user instruction and document metadata, not instructions inside retrieved document text.

### 12.3 Confirmation

Import and delete are mutating actions.

Requirements:

- Import must require confirmation.
- Delete must require confirmation.
- Delete should show enough metadata in the prompt/tool call arguments for the user to understand what is being deleted.
- `expected_name` is recommended when the model inferred a document from a list result.

### 12.4 Data Exposure

Tool results should be concise.

Requirements:

- Do not expose raw local file paths by default.
- Do not expose vector index paths.
- Do not return full document content from listing or delete tools.
- Import result may include document metadata and processing summary only.

## 13. Error Handling

Common errors:

1. Attachment reference missing or invalid.
2. Attachment expired.
3. Original staged file missing.
4. Unsupported file type.
5. File exceeds import limit.
6. Duplicate document detected.
7. No embedding model configured.
8. AI disabled.
9. Embedding billing or quota failure.
10. Document not found for deletion.
11. Permission denied.
12. Delete vector cleanup partially failed.

Tool results should be structured:

```ts
{
  success: false;
  error: string;
  code?: string;
  existingDocuments?: Array<{ id: number; name: string; fileSize: number }>;
}
```

The assistant should explain the error and next step in plain language.

## 14. Observability

Minimum logs:

- Tool name and tool call ID.
- Conversation ID.
- Attachment ref, but not full local path.
- Document ID created or deleted.
- Processing time.
- Duplicate decision.
- Permission-denied outcome.
- Import/delete failure code.

Do not log full document content.

## 15. Testing Requirements

### 15.1 Unit Tests

Add tests for:

- Argument normalization and validation.
- Document list filtering and result formatting.
- Import rejects missing `attachment_ref`.
- Import rejects arbitrary `filePath` args.
- Import rejects cross-conversation references.
- Import calls RAG upload service with safe staged source.
- Delete rejects missing or invalid document ID.
- Delete checks `expected_name` when supplied.
- Delete calls existing module/service delete method.

### 15.2 Integration Tests

Add tests for:

- Staged document attachment -> import tool -> searchable document.
- List tool returns imported document.
- Delete tool removes imported document and chunks.
- Delete with `delete_source_file: true` does not delete paths outside app-owned upload staging.

### 15.3 Permission Tests

Add tests for:

- `knowledge_library_list_documents` auto-executes as pure.
- `knowledge_library_import_attachment` prompts by default.
- `knowledge_library_delete_document` prompts by default.
- Denied import/delete does not mutate database.

### 15.4 Manual QA

Manual test prompts:

```text
I attached a PDF. Add it to the knowledge library and tag it product.
```

```text
Show me the documents in the knowledge library.
```

```text
Delete the document I just imported.
```

```text
Remove the old pricing guide, but ask me if there are multiple matches.
```

```text
Try to import /etc/passwd into the knowledge library.
```

Expected result for the last prompt: the assistant should not be able to import arbitrary paths.

## 16. Phased Delivery

### Phase 1: Safe Read And Delete Foundation

- Add `KnowledgeLibraryAiTools.ts`.
- Add `knowledge_library_list_documents`.
- Add `knowledge_library_delete_document`.
- Register tools in `SkillRegistry`.
- Add unit tests for listing, deletion, permissions, and expected-name safety.

### Phase 2: Attachment Import

- Verify or add AiChatV2 document attachment staging.
- Add `DocumentService.getStagedAttachmentImportSource()`.
- Add `knowledge_library_import_attachment`.
- Reuse `RagSearchModule.uploadDocument()`.
- Add duplicate handling.
- Add tests for import, invalid refs, expired refs, and AI-disabled behavior.

### Phase 3: UX And Reliability Hardening

- Improve permission prompt labels if generic prompts are unclear.
- Add better progress events for long imports.
- Add async job support if large documents exceed tool timeout.
- Add optional import status card or notification in AiChatV2.

### Phase 4: Future Enhancements

- Add `knowledge_library_update_document_metadata`.
- Add import from user-selected file through a one-shot file dialog grant.
- Add bulk delete with stronger confirmation UX.
- Add document replacement flow.
- Add knowledge library audit log.

## 17. Open Questions

1. Should import be permission category `"filesystem"` or `"automation"`?
   - Recommendation: `"filesystem"` for MVP because it persists local files and mutates local storage.

2. Should `duplicatePolicy: "replace"` be in MVP?
   - Recommendation: defer. Replacement should be transactional to avoid deleting a good document before a new import succeeds.

3. Should import accept markdown-only staged attachments when original file bytes are unavailable?
   - Recommendation: support original staged file first. Add markdown materialization as a fallback only if it is simple and safe.

4. Should listing expose `filePath`?
   - Recommendation: no. Keep local paths out of model-facing results unless debugging explicitly requires them.

5. Should delete source file default to true?
   - Recommendation: no. Default `delete_source_file` to false to preserve staged source unless user explicitly requests file cleanup.

## 18. Success Metrics

1. User can import an attached supported document into the knowledge library from AiChatV2.
2. User can delete a known document from AI chat with confirmation.
3. Assistant can list documents and resolve IDs before delete.
4. No direct database access is added to AI chat IPC handlers.
5. No AI tool accepts arbitrary local file paths for import.
6. Imported documents are searchable through `knowledge_library_search`.
7. Deletion removes document metadata and associated chunks/vectors.
8. Tests cover unsafe import and delete paths.

## 19. Acceptance Checklist

- [ ] `knowledge_library_list_documents` registered as built-in skill.
- [ ] `knowledge_library_import_attachment` registered as built-in skill.
- [ ] `knowledge_library_delete_document` registered as built-in skill.
- [ ] Import/delete require confirmation.
- [ ] List is pure and read-only.
- [ ] Import uses `attachment_ref`, not arbitrary `filePath`.
- [ ] Import reuses existing RAG upload pipeline.
- [ ] Delete reuses existing RAG delete pipeline.
- [ ] Tool results do not expose raw local paths by default.
- [ ] AiChatV2 document attachments are staged for import.
- [ ] AI-disabled behavior is handled before embedding work.
- [ ] Unit and integration tests pass.
