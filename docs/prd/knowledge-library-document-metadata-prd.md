# Knowledge Library Document Metadata - Product Requirements Document

## Document Information

- **Version**: 1.0
- **Status**: Proposed
- **Created**: 2026-09-23
- **Owner**: Engineering Team
- **Related systems**: Knowledge Library UI, RAG upload, chunking, embeddings, `knowledge_library_search`, `knowledge_library_list_documents`, `knowledge_library_import_attachment`, website import
- **Related PRDs**:
  - `docs/prd/knowledge-library-management-ai-tools-prd.md`
  - `docs/prd/knowledge-library-website-import-ai-tool-prd.md`
  - `docs/rag-tool-call-rerank-prd.md`
- **Related files**:
  - `src/views/pages/knowledge/KnowledgeLibrary.vue`
  - `src/views/pages/knowledge/DocumentManagement.vue`
  - `src/views/pages/knowledge/WebsiteImportDialog.vue`
  - `src/views/api/rag.ts`
  - `src/entity/RAGDocument.entity.ts`
  - `src/entity/RAGChunk.entity.ts`
  - `src/modules/RAGDocumentModule.ts`
  - `src/modules/RagSearchModule.ts`
  - `src/model/RAGDocument.model.ts`
  - `src/service/VectorSearchService.ts`
  - `src/service/RagSearchTypes.ts`
  - `src/service/KnowledgeLibraryAiTools.ts`
  - `src/config/skillsRegistry.ts`
  - `src/entityTypes/metadataType.ts`
  - `src/main-process/communication/rag-ipc.ts`
  - `src/views/lang/{en,zh,es,fr,de,ja}.ts`

## 1. Summary

Users import files into the local knowledge library and then ask AI Chat questions about those files. They need to attach metadata at import time — at minimum **author**, **tags**, and **description** — and they need AI search to use that metadata.

The database, the upload API, the AI attachment-import tool, and the website-import dialog already store `title`, `description`, `tags`, and `author`. The dialog users actually open, **Upload document** on the Knowledge Library page, does not. It writes fixed defaults and never asks for those fields. Embeddings are built from chunk body text only, so a question such as "what did Alice write about refunds" misses when Alice's name is not inside the file.

This PRD specifies:

1. Collect author, tags, and description on the file upload dialog, and save them on every file in that upload.
2. Make those fields usable by AI search in two ways: exact filters applied before vector search, and a short metadata header included in the embedded text.
3. Return author, tags, and description on search hits so answers can cite them.
4. Add a small second wave of fields (`language`, `documentDate`, and a fixed set of custom keys) after the first three fields work end to end.

## 2. Problem Statement

A marketing or support user uploads a pricing PDF, a refund policy, or a partner brief and expects to ask later:

```text
What did Alice write about refunds?
Find documents tagged pricing.
Use the enterprise pricing notes from Chen.
```

Today that fails for three separate reasons.

1. **The upload dialog does not collect the fields.** `KnowledgeLibrary.vue` hardcodes `description` to `Uploaded document: ${file.name}` and `tags` to `["uploaded", "knowledge"]`. It does not send `author`. The main process then defaults `author` to `"User"`.
2. **The values that do get stored are not part of retrieval.** `embedAndStoreChunks()` embeds `chunk.content` only. Vector metadata is `chunkIndex` and `pageNumber`. Author and tags never enter the vector.
3. **Search results hide the metadata from the model.** `knowledge_library_search` can filter by `author` and `tags` when the model passes those arguments, but each hit returns title, filename, and passage text. The answering model cannot see author or tags on the passage it cites.

There is a second, unused dialog in `DocumentManagement.vue` that already has title, description, and tags, and omits author. Its open button is commented out. The page-level **Upload document** button opens `KnowledgeLibrary.vue`, and that dialog is the one this PRD changes.

Website import already collects tags, author, and description. AI attachment import already accepts the same fields. File upload should match those flows.

## 3. Goals

1. Let the user type author, tags, and description in the Knowledge Library file upload dialog before upload starts.
2. Apply that metadata to every file in the same upload.
3. Persist the values on `rag_documents` through the existing upload path (`copyFileToTemp` / `RAGDocumentModule.uploadDocument`).
4. Keep current defaults when a field is left blank, so existing uploads do not change behavior.
5. Make author, tags, and description searchable by AI:
   - exact filter before vector search when the question names a field;
   - semantic match when the question only implies the field, by embedding a short metadata header with each chunk.
6. Include author, tags, and description on each `knowledge_library_search` result.
7. Show author and tags on the document list.
8. Translate every new label in en, zh, es, fr, de, and ja.
9. Cover the dialog and the metadata mapping with component tests.

## 4. Non-Goals

1. Do not add a free-form metadata schema where users invent arbitrary keys that AI search must discover on its own.
2. Do not create a second document store or a second embedding index.
3. Do not redesign website import. It already collects these fields.
4. Do not change `knowledge_library_import_attachment` parameter names. That tool already accepts `title`, `description`, `tags`, and `author`.
5. Do not auto-summarize a description with an LLM in this release.
6. Do not extract PDF or Office author/title properties in the first phase. Manual entry is the requirement. Extraction can follow later as a prefill.
7. Do not re-embed the whole library until the metadata header is implemented. Phase 1 is persistence and dialog only.
8. Do not put database access in the Vue page or in IPC handlers.

## 5. Target Users

### 5.1 Marketing operator

Uploads campaign briefs, pricing sheets, and partner docs, and later asks the assistant to answer from a specific author's notes or a tag such as `pricing` or `enterprise`.

### 5.2 Support user

Uploads refund, shipping, and product policies and wants replies grounded in the document that was tagged `refund-policy`, not in every uploaded file.

### 5.3 Library maintainer

Needs the document list to show who wrote a file and which tags it has, so outdated documents can be found and removed.

## 6. User Stories

1. As a user, I open **Upload document**, choose one or more files, type an author, add tags, type a description, and upload. Every file in that batch is saved with those values.
2. As a user, I leave author, tags, and description blank. The upload still succeeds and uses the current defaults: author `User`, tags `uploaded` and `knowledge`, description `Uploaded document: {filename}`.
3. As a user, I ask AI Chat "what did Alice Chen write about refunds?" and the assistant can find Alice's refund document even when the PDF body never says her name.
4. As a user, I ask "show documents tagged pricing" and the search is limited to documents that have that tag.
5. As a user, I look at the document list and see author and tags for each file.
6. As a user, I import a website or a chat attachment with author and tags, and those values remain searchable in the same way as file-upload metadata.

## 7. Current Architecture Findings

These findings are the baseline. Phase 1 must fill the dialog gap. Later phases must fill the retrieval gap. Do not add duplicate columns for fields that already exist.

### 7.1 Fields that already exist

`RAGDocumentEntity` (`rag_documents`) already has:

| Column | Type | Notes |
| --- | --- | --- |
| `title` | varchar 500, nullable | Display title |
| `description` | text, nullable | Free text |
| `tags` | text, nullable | JSON string array, not a join table |
| `author` | varchar 255, nullable | Single string |

`DocumentUploadOptions` in `RAGDocumentModule` already accepts `title`, `description`, `tags: string[]`, and `author`. Tags are stored with `JSON.stringify`.

`DocumentMetadata` in `src/entityTypes/metadataType.ts` already has the same four fields. `SAVE_TEMP_FILE` in `rag-ipc.ts` reads them and defaults missing author to `"User"`, missing tags to `["uploaded", "knowledge"]`, and missing description to `Uploaded document: {filename}`.

### 7.2 Upload dialogs

| Surface | Collects today | Used by the Upload document button |
| --- | --- | --- |
| `KnowledgeLibrary.vue` upload dialog | File drop, browse, native dialog. No author, tags, or description inputs. | Yes |
| `DocumentManagement.vue` upload dialog | Title, description, tags. No author. Open button is commented out. | No |
| `WebsiteImportDialog.vue` | Tags, author, description | Website import only |
| `knowledge_library_import_attachment` | title, description, tags, author | AI Chat attachments |

`KnowledgeLibrary.vue` `doUpload()` passes this metadata into `copyFileToTemp` only when the file object has no `path`:

```text
title: filename without extension
description: "Uploaded document: {filename}"
tags: ["uploaded", "knowledge"]
author: omitted
```

When the file object has a `path` (the native file dialog returns path-bearing objects), `doUpload()` returns an in-memory document and does not call the upload API. Phase 1 must persist user metadata on every upload path that actually saves a document, including the native-dialog path.

The renderer is sandboxed (`sandbox: true` in `background.ts`). The HTML file input and drag-and-drop path do not receive a usable `File.path`, so they go through `copyFileToTemp`. That is the path the new fields must feed first.

### 7.3 How AI search uses metadata today

`knowledge_library_search` already accepts `tags`, `author`, `documentIds`, `documentTypes`, and `dateRange`. `RagSearchModule.resolveAllowedDocumentIds()` filters completed active documents in memory:

- tags: parse the JSON array and require at least one exact tag match;
- author: case-insensitive substring match on `document.author`.

`knowledge_library_list_documents` already returns `author` and `tags` in the compact summary.

Gaps that this PRD closes:

1. `KnowledgeSearchResultItem` does not include `author`, `tags`, or `description`. The model sees the filter arguments it chose, not the metadata of the passage it retrieved.
2. Embeddings do not contain author, tags, title, or description. Semantic questions fail unless the body text happens to contain those words.
3. `VectorSearchService.searchWithFilters()` accepts `authors` and then ignores them (`return true`). The library Search tab uses that method. The Search tab is currently hidden (`v-if="false"`). AI search must not depend on that stub. It must keep using `searchKnowledgeForTool` / `resolveAllowedDocumentIds`, and that filter must move into the document query instead of loading every completed document into memory.
4. `RAGDocument.model.ts` tag filtering uses `LIKE '%tag%'`, which false-matches tags that share a substring. AI search tag matching must stay exact-token after normalize, and the model query used by the tool must match that rule.

## 8. Product Requirements

### 8.1 Phase 1 — Upload dialog

The Knowledge Library **Upload document** dialog (`KnowledgeLibrary.vue`) gains three inputs, placed after the selected-file list and before the error alert:

| Field | Control | Label key | Required |
| --- | --- | --- | --- |
| Author | single-line text | `knowledge.author` | No |
| Tags | chip combobox, multiple values, Enter adds a chip | `knowledge.tags` | No |
| Description | textarea, about 2 rows | `knowledge.description` | No |

A one-line hint above the fields uses `knowledge.upload_metadata_hint`: the values apply to every file in this upload.

Behavior:

1. One set of values applies to every file in the current upload, including files uploaded after a duplicate-skip or upload-anyway choice. Do not ask for per-file metadata in this phase.
2. Title stays derived from the filename stem, as it is today. A title input is out of scope for the dialog unless added later. The stored `title` column continues to receive that stem.
3. Blank author stores the existing default `User`.
4. Blank tags store the existing default `["uploaded", "knowledge"]`.
5. Blank description stores the existing default `Uploaded document: {filename}` per file, because the default includes the filename.
6. Non-blank description is stored as typed, for every file in the batch. It does not get the filename appended.
7. Tags are trimmed. Empty chips are dropped. Matching is case-sensitive for storage and case-insensitive for later search. Duplicate tags in one entry are removed case-insensitively, keeping the first spelling. Maximum 20 tags. Maximum 64 characters per tag.
8. Author is trimmed and limited to 255 characters.
9. Description is trimmed and limited to 2000 characters.
10. Cancel and a successful upload clear author, tags, and description so the next upload does not reuse them.
11. Closing the dialog on a validation or upload error keeps the typed values so the user can retry.
12. Both the drag/drop/browse path (`copyFileToTemp`) and the native-dialog path must persist these fields on the saved `rag_documents` row. A native-dialog upload that only returns an in-memory object does not satisfy this requirement.
13. The upload still runs the existing embedding-runtime gate before any save.

`DocumentManagement.vue` is not the primary dialog. If that dialog remains in the tree, add the same author field and pass it to `uploadDocument` so the two forms cannot diverge. Do not re-enable its commented button as part of this work.

### 8.2 Phase 2 — AI search can use the fields

Phase 2 starts after Phase 1 values are actually stored. It has three parts that ship together. Shipping filters without the embedding header leaves "what did Alice write about refunds?" broken. Shipping the header without result fields leaves the model unable to cite the author.

#### 8.2.1 Exact filters, before vector search

When `knowledge_library_search` receives `author` and/or `tags`:

1. Resolve allowed document IDs with a document query, not by loading every completed document and filtering in JavaScript.
2. Author match is case-insensitive substring on the `author` column, consistent with today's tool behavior.
3. Tag match is exact after trim and case-fold. A request for `pricing` matches a document tagged `Pricing`. It does not match a document tagged only `pricing-old`.
4. Multiple requested tags are OR within the tags filter (any requested tag), AND across different filters (author and tags must both match). This matches `resolveAllowedDocumentIds()` today.
5. Vector search runs only inside the allowed document IDs.
6. An author or tag filter that matches no documents returns an empty result with `success: true`, not an error.

The tool description for `knowledge_library_search` must tell the model to pass `author` and `tags` when the user names a person or a label, and to put the topical words in `query`.

#### 8.2.2 Metadata header inside the embedding

Before a chunk is embedded, prefix a short header built from the parent document. Embed the header plus the chunk body as one string. Keep the stored `rag_chunks.content` as the body only, so the library UI still shows the passage without a repeated header. The string sent to the embedding provider is:

```text
Title: Q3 refund policy
Author: Alice Chen
Tags: refund-policy, enterprise
Description: Refund rules for enterprise plans

{chunk body}
```

Rules:

1. Omit a line when that field is empty or still the generic default. Omit `Author: User`. Omit tags when the only tags are `uploaded` and `knowledge`. Omit description when it equals `Uploaded document: {filename}`. Always include `Title` when a title exists.
2. The header is plain text, a few lines, not a JSON blob.
3. The same header is rebuilt for every chunk of that document.
4. Changing author, tags, title, or description after import requires re-embedding that document's chunks. Phase 2 does not add an edit-metadata UI. It does require the embed path to include the header for new imports, and a one-time re-embed note for documents imported after Phase 1 but before the header exists.
5. Search hits return the chunk body, not the header, as `content`. Metadata is returned in structured fields (section 8.2.3).

#### 8.2.3 Search results include metadata

Each `KnowledgeSearchResultItem` gains:

| Field | Type | Source |
| --- | --- | --- |
| `author` | string, optional | `rag_documents.author` |
| `tags` | string array | parsed `rag_documents.tags` |
| `description` | string, optional | `rag_documents.description` |

`knowledge_library_list_documents` already returns author and tags. Its tool description must mention author as well as tags, so the model knows it can filter the list by author. Add an optional `author` filter to that tool if it is not already applied. Today the list tool filters by query, status, processing status, file type, and tags, and returns author without filtering on it.

The document table on the Knowledge Library page shows author and tags columns. Tags render as chips. Empty author shows nothing, not the word `User`, when the stored value is the default `User`. Stored default tags `uploaded` and `knowledge` may be hidden in the table for the same reason; they remain stored.

### 8.3 Phase 3 — Additional fields

Add these only after Phase 1 and Phase 2 are in use. They follow the same two-layer rule.

**Columns** (filterable, shown in the dialog as optional fields):

| Field | Type | Purpose |
| --- | --- | --- |
| `language` | varchar, nullable | `en`, `zh`, and other language codes |
| `documentDate` | datetime, nullable | When the content was written. Distinct from `uploadedAt`. |

**`customMetadata` JSON object** on `rag_documents`, Zod-validated, fixed keys only:

| Key | Purpose |
| --- | --- |
| `product` | Product or offer the document describes |
| `customer` | Customer or account the document belongs to |
| `campaign` | Campaign name |
| `category` | Library folder such as policy, pricing, brief |

Limits: at most 8 keys, each value a string of at most 200 characters. Unknown keys are rejected at the upload boundary. The allowed key list is written into the `knowledge_library_search` and `knowledge_library_list_documents` tool descriptions. The model can filter only keys it has been told exist.

`language`, `documentDate`, and the custom keys are filter-first. They are included in the embedding header only when present. Changing a custom key that is part of the header requires re-embed; keys that are filter-only do not.

The upload dialog exposes custom keys as an optional "More fields" row with the four suggested keys, not as a blank key/value editor.

## 9. Validation

Validate at the UI before submit and again on the main-process upload boundary with Zod (`zod/v4`). The renderer must not be the only check.

| Field | Rule |
| --- | --- |
| `author` | optional string, trim, max 255 |
| `tags` | optional array, max 20 items, each trim, min 1, max 64, unique case-insensitively |
| `description` | optional string, trim, max 2000 |
| `title` | optional string, trim, max 500 (still set from filename in Phase 1) |
| `language` | Phase 3, optional, max 16 |
| `documentDate` | Phase 3, optional ISO date |
| `customMetadata` | Phase 3, object whose keys are in the allowlist |

Reject the upload with a translated message when a limit is exceeded. Do not silently truncate tags below the cap in a way that drops user input without telling them. Truncating author and description to the max with the field's existing `maxlength` / counter is acceptable if the control prevents typing past the limit.

## 10. Storage Model

Phase 1 uses the existing columns. No migration.

```text
rag_documents.title
rag_documents.description
rag_documents.tags          -- JSON string array
rag_documents.author
```

Phase 3 adds nullable `language`, nullable `documentDate`, and nullable `customMetadata` text (JSON object). Existing rows stay null and keep searching as they do today.

Chunks stay body-only in `rag_chunks.content`. The embedding provider receives header + body. Vector-store metadata may also store `documentId` (already stored) and does not need a copy of author/tags if search joins the document row.

Tag JSON remains a string column. Do not add a tags join table in this work.

## 11. Search Behavior Examples

| User question | Tool arguments | Retrieval |
| --- | --- | --- |
| What did Alice Chen write about refunds? | `query: "refunds"`, `author: "Alice Chen"` | Filter documents whose author contains "alice chen", then vector-search those chunks. The header also lets a query-only search match if the model forgets the filter. |
| Documents tagged pricing | `query: "pricing"`, `tags: ["pricing"]` | Exact tag filter, then vector search. |
| Enterprise refund policy | `query: "enterprise refund policy"` | No structured filter. The header line `Tags: enterprise` and the body both contribute to the embedding. |
| Who wrote the pricing memo? | `query: "pricing memo"` | Hits include `author`, so the answer can name the author even when the question did not pass an author filter. |

## 12. Architecture Requirements

1. The Vue page collects strings and calls the existing renderer API (`copyFileToTemp` / upload). It does not write SQL.
2. `RAGDocumentModule.uploadDocument` remains the only writer of these columns.
3. IPC handlers validate with the existing Zod upload schema and pass the fields through. They do not query repositories.
4. Child processes do not read or write document metadata.
5. AI tool wrappers call `RagSearchModule` / `KnowledgeLibraryAiTools`. They do not embed metadata themselves.
6. Static imports only.
7. No `any`. Catch blocks use `unknown`.

## 13. Security

1. Metadata is user-controlled text. Do not interpolate it into SQL. Parameterized queries only.
2. Do not render description or tags as HTML. The document table and chat citations show plain text.
3. The embedding header is data, not instructions. Keep it to the fixed labels `Title`, `Author`, `Tags`, `Description`. Do not let a description smuggle extra header lines by stripping newlines or collapsing them to spaces before the header is built.
4. Length limits in section 9 bound how much untrusted text enters the embedding and the tool result.
5. Search results continue to omit `filePath`.

## 14. UX Requirements

1. Fields are visible without a second dialog step. The user can fill them before or after choosing files.
2. The Upload button stays disabled until at least one file is selected. Metadata alone does not enable upload.
3. Tags use the same chip entry pattern as the unused `DocumentManagement.vue` dialog: Enter adds a tag, chips can be removed.
4. Hint text states that the values apply to every selected file.
5. After success, the dialog closes and the document list refreshes, showing the new author and tags.
6. Duplicate-file handling is unchanged. Metadata entered before the duplicate prompt is the metadata used if the user continues.

## 15. Internationalization

Add or reuse keys in all six language files: `src/views/lang/en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts`.

| Key | English |
| --- | --- |
| `knowledge.author` | Author |
| `knowledge.tags` | Tags (already present) |
| `knowledge.tags_hint` | Press Enter to add tags (already present) |
| `knowledge.description` | Description (already present) |
| `knowledge.upload_metadata_hint` | Optional. Applied to every file in this upload. |

Do not reuse `knowledge.website_import_author` for the file dialog. That key belongs to website import. Phase 3 adds keys for language, document date, and the more-fields row in the same six files.

Vue templates use `t('knowledge.author')` with an English fallback.

## 16. Testing Requirements

### 16.1 Component test

Add `test/vitest/main/components/KnowledgeLibraryUploadDialog.test.ts`.

1. The upload dialog renders author, tags, and description.
2. Choosing a file and submitting with author `Alice Chen`, tags `pricing` and `enterprise`, and a description calls `copyFileToTemp` with those values and the filename-stem title.
3. Submitting with all three fields blank calls `copyFileToTemp` with author `User`, tags `["uploaded", "knowledge"]`, and description `Uploaded document: {filename}`.
4. Tags are trimmed, empties dropped, and case-insensitive duplicates removed.
5. Cancel clears the three fields.

Run with `yarn test:components` for this file.

### 16.2 Search tests

Extend `test/vitest/main/service/KnowledgeSearchTool.test.ts` (or the closest existing knowledge-search test):

1. An author filter excludes documents by other authors.
2. A tag filter matches case-insensitively and does not match a longer tag that merely contains the text.
3. A search hit includes `author`, `tags`, and `description`.
4. The text sent to the embedding function for a new chunk starts with the metadata header and still returns body-only content to the tool result.

### 16.3 What this PRD does not require

No Playwright flow is required for Phase 1. The dialog is a single form with no cross-page state beyond the document list refresh. A component test that asserts the API payload is the gate.

## 17. Phased Delivery

### Phase 1 — Dialog and persistence

Ship the upload fields, validation, i18n, native-dialog persistence, and the component test. Documents saved in this phase are filterable by the existing `knowledge_library_search` author and tags arguments as soon as they are stored, because `resolveAllowedDocumentIds()` already reads those columns. They are not yet in the embedding.

### Phase 2 — Retrieval

Header-on-embed, result fields, SQL filter, document-list columns, and search tests. Re-embed documents that were imported with real author, tags, or description in Phase 1 so the header exists. Documents that only have the defaults do not need a re-embed.

### Phase 3 — More fields

`language`, `documentDate`, and the four custom keys, with the same filter and header rules.

## 18. Acceptance Criteria

Phase 1 is done when:

1. The Knowledge Library upload dialog shows author, tags, and description in all six languages.
2. A file uploaded with those fields stores them on `rag_documents`.
3. A file uploaded with the fields left blank stores the current defaults.
4. Every file in a multi-file upload receives the same author, tags, and description.
5. Native-dialog upload persists the same fields.
6. The component test in section 16.1 passes.

Phase 2 is done when:

1. "Documents tagged {tag} by {author}" limits vector search to those documents.
2. A chunk embedding for a document with a real author or custom tags includes the metadata header.
3. `knowledge_library_search` results include author, tags, and description.
4. The document list shows author and tags.
5. The search tests in section 16.2 pass.

## 19. Recommended Implementation Order

1. Add the three fields and hint to `KnowledgeLibrary.vue`, and pass them into `copyFileToTemp` and the native-dialog save path.
2. Add `knowledge.author` and `knowledge.upload_metadata_hint` to all six language files.
3. Add the component test and run `yarn test:components` on that file.
4. In Phase 2, prefix the header inside `embedAndStoreChunks`, extend `KnowledgeSearchResultItem`, and replace the in-memory author/tag scan with a document query.
5. In Phase 3, add columns and `customMetadata` with a Zod allowlist, then extend the tool descriptions.

## 20. Future Enhancements

1. Prefill author and title from PDF or Office document properties, and let the user overwrite them.
2. Edit author, tags, and description on an existing document, then re-embed that document.
3. Per-file metadata when a batch mixes unrelated documents.
4. Hide default tags `uploaded` and `knowledge` from AI filter suggestions so the model prefers user tags.
