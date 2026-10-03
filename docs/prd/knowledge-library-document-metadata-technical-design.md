# Knowledge Library Document Metadata - Technical Design

| Field | Value |
| --- | --- |
| Document version | v1.0 |
| Created date | 2026-09-23 |
| Status | Draft |
| Owner | AiFetchly engineering |
| Source PRD | `docs/prd/knowledge-library-document-metadata-prd.md` |
| Primary code paths | `src/views/pages/knowledge/KnowledgeLibrary.vue`, `src/views/pages/knowledge/fileUploadMetadata.ts`, `src/views/api/rag.ts`, `src/main-process/communication/rag-ipc.ts`, `src/modules/RAGDocumentModule.ts`, `src/modules/RagSearchModule.ts`, `src/model/RAGDocument.model.ts`, `src/service/VectorSearchService.ts`, `src/service/knowledgeMetadataHeader.ts`, `src/service/RagSearchTypes.ts`, `src/config/skillsRegistry.ts` |

## 1. Purpose

This document translates `docs/prd/knowledge-library-document-metadata-prd.md` into an implementation-facing design.

The feature lets a user type author, tags, and description while uploading files into the knowledge library, then lets AI search use those fields.

```text
User fills author / tags / description on the Upload document dialog
  -> KnowledgeLibrary.vue builds one metadata object for the batch
  -> copyFileToTemp or RAG_UPLOAD_DOCUMENT persists it on rag_documents
  -> RagSearchModule.uploadDocument chunks the file
  -> embedAndStoreChunks embeds header + chunk body, stores body only
  -> knowledge_library_search filters document ids, then searches those indexes
  -> tool_result includes author, tags, and description on each hit
```

Phase 1 is the dialog and persistence. Phase 2 is retrieval. Phase 3 adds `language`, `documentDate`, and a fixed `customMetadata` object. Do not start Phase 3 in the same change as Phase 1.

## 2. Current System Summary

### 2.1 Columns already exist

`RAGDocumentEntity` already stores the Phase 1 fields. No migration is required for Phase 1.

| Column | Storage | Writer |
| --- | --- | --- |
| `title` | varchar 500 | `RAGDocumentModule.uploadDocument` |
| `description` | text | same |
| `tags` | text, `JSON.stringify(string[])` | same |
| `author` | varchar 255 | same |

`DocumentUploadOptions` and `DocumentMetadata` already include these four fields. `SAVE_TEMP_FILE` in `rag-ipc.ts` reads them and applies defaults when they are missing:

| Field | Default when missing |
| --- | --- |
| `title` | filename stem |
| `description` | `Uploaded document: {filename}` |
| `tags` | `["uploaded", "knowledge"]` |
| `author` | `"User"` |

SQLite uses `synchronize: true` in `src/config/SqliteDb.ts`. Phase 3 columns can be added on the entity and will be created on the next connection. Existing rows stay null.

### 2.2 The dialog that users open does not collect the fields

The **Upload document** button in `KnowledgeLibrary.vue` opens that page's dialog. `doUpload()` passes hardcoded metadata into `copyFileToTemp` only when the file has no `path`:

```text
title: filename stem
description: "Uploaded document: {filename}"
tags: ["uploaded", "knowledge"]
author: omitted, so the IPC default "User" is stored
```

The renderer is sandboxed, so the HTML file input and drag-and-drop path have no usable `File.path` and do go through `copyFileToTemp`. That is the path Phase 1 must feed.

The native dialog (`selectFilesNative`) returns plain objects with `path`. `SHOW_OPEN_DIALOG` issues a one-shot `rag-upload` grant for those paths. `doUpload()` then returns an in-memory document and never calls an upload API. Phase 1 must send that path through `RAG_UPLOAD_DOCUMENT`, which already consumes the grant.

`DocumentManagement.vue` has a second dialog with title, description, and tags, and no author. Its open button is commented out. Add author there and pass it through `uploadDocument` so the form cannot drift, and leave the button commented out.

Website import and `knowledge_library_import_attachment` already accept author, tags, and description. They keep working. Phase 2 retrieval applies to documents they create as well.

### 2.3 Retrieval does not use the stored fields

`knowledge_library_search` accepts `author` and `tags`. `RagSearchModule.searchKnowledgeForTool` calls `resolveAllowedDocumentIds()`, which loads every active completed document and filters in memory.

Two defects make that filter ineffective:

1. An empty match set is treated as "no filter". `searchKnowledgeForTool` passes `documentIds` only when `allowedDocIds.length > 0`. `resolveAllowedDocumentIds()` returns `[]` when filters match nothing, and `undefined` when no filters were set. The length check collapses `[]` into `undefined`, so a miss searches the whole library.
2. Vector search ignores the id list. `VectorSearchService.searchCandidates` passes `documentIds` only to `searchChunksByKeywords`. `search()` loads every document index. Keyword hits are filtered. Vector hits are not. Merged candidates therefore include documents the filter rejected.

`KnowledgeSearchResultItem` and `RagSearchCandidate.document` carry `id`, `name`, `title`, and `fileType`. They do not carry `author`, `tags`, or `description`. `candidateToResultItem` cannot return fields it never loaded.

`embedAndStoreChunks` embeds `chunk.content` and stores the same string. Vector metadata is `chunkIndex` and `pageNumber`. Author and tags never enter the embedding.

`VectorSearchService.searchWithFilters` accepts `authors` and then returns every row. The Search tab that calls it is hidden. Do not build Phase 2 on that method. Fix `searchKnowledgeForTool`.

`RAGDocumentModel.getDocuments` filters tags with `LIKE '%tag1,tag2%'` and author with exact equality. The AI tool must not use that query. Tag substring matches `pricing-old`. Author equality misses `"Alice Chen"` when the tool argument is `"alice"`.

## 3. Target Architecture

```text
KnowledgeLibrary.vue
  -> buildFileUploadMetadata()          renderer, pure
  -> copyFileToTemp / uploadDocument    existing IPC

rag-ipc.ts
  -> zod parse of author, tags, description
  -> RagSearchModule.uploadDocument

RAGDocumentModule
  -> writes the existing columns

RagSearchModule.embedAndStoreChunks
  -> buildEmbeddingInput(document, chunk.content)
  -> embed the combined string
  -> store chunk.content unchanged

RagSearchModule.searchKnowledgeForTool
  -> RAGDocumentModel.findSearchableDocumentIds()
  -> VectorSearchService.searchCandidates({ documentIds })
  -> candidateToResultItem copies author, tags, description
```

No new IPC channel. No repository access from the Vue page or from `rag-ipc.ts`. No worker writes.

### 3.1 New files

```text
src/views/pages/knowledge/fileUploadMetadata.ts
src/service/knowledgeMetadataHeader.ts
test/vitest/main/components/KnowledgeLibraryUploadDialog.test.ts
test/vitest/utilitycode/knowledgeMetadataHeader.test.ts
```

Phase 2 also extends:

```text
test/vitest/main/service/KnowledgeSearchTool.test.ts
src/service/RagSearchTypes.ts
src/service/VectorSearchService.ts
src/modules/RagSearchModule.ts
src/model/RAGDocument.model.ts
src/views/pages/knowledge/DocumentManagement.vue
src/config/skillsRegistry.ts
```

## 4. Phase 1 — Upload Metadata

### 4.1 Pure builder

Add `src/views/pages/knowledge/fileUploadMetadata.ts`. The Vue page must not inline the defaulting rules.

```typescript
export interface FileUploadMetadataInput {
  author: string;
  description: string;
  tags: readonly string[];
}

export interface FileUploadMetadata {
  title: string;
  description: string;
  tags: string[];
  author: string;
}

export function buildFileUploadMetadata(
  fileName: string,
  input: FileUploadMetadataInput
): FileUploadMetadata;
```

Rules, matching the PRD and the existing IPC defaults:

| Input | Output |
| --- | --- |
| author blank after trim | `"User"` |
| author longer than 255 | reject before upload; do not truncate silently |
| tags empty after normalize | `["uploaded", "knowledge"]` |
| description blank after trim | `` `Uploaded document: ${fileName}` `` |
| description longer than 2000 | reject before upload |
| title | `fileName` with the last extension removed; if that is empty, use `fileName` |

`normalizeUploadTags`:

1. Coerce each entry with `String`, then trim.
2. Drop empty entries.
3. Drop a later entry whose case-folded value was already kept.
4. Keep the first spelling.
5. Cap at 20 tags and 64 characters each. If the user entered more, the dialog shows a translated error and does not upload.

The same limits are enforced again in the main process. The renderer check is only so the user sees the message next to the field.

### 4.2 Dialog state

In `KnowledgeLibrary.vue`, next to `uploadFiles`:

```typescript
const uploadAuthor = ref("");
const uploadDescription = ref("");
const uploadTags = ref<string[]>([]);
```

Template, after the selected-file list and before the upload error alert:

- `v-text-field` bound to `uploadAuthor`, label `t('knowledge.author')`, `maxlength` 255.
- `v-combobox` bound to `uploadTags`, `multiple`, `chips`, `closable-chips`, hint `t('knowledge.tags_hint')`.
- `v-textarea` bound to `uploadDescription`, label `t('knowledge.description')`, `maxlength` 2000, two rows.
- A caption `t('knowledge.upload_metadata_hint')`.

`cancelUpload()` clears the three refs. A failed upload leaves them in place. `doUpload` calls `buildFileUploadMetadata(file.name, ...)` once per file so the default description still contains that file's name. Author and tags are identical across the batch.

### 4.3 Browse and drag-and-drop path

Replace the hardcoded object passed to `copyFileToTemp` with the builder result:

```typescript
const metadata = buildFileUploadMetadata(file.name, {
  author: uploadAuthor.value,
  description: uploadDescription.value,
  tags: uploadTags.value,
});

await copyFileToTempAPI(file, {
  title: metadata.title,
  description: metadata.description,
  tags: metadata.tags,
  author: metadata.author,
});
```

`copyFileToTemp` in `src/views/api/rag.ts` already forwards `metadata.author`. `SAVE_TEMP_FILE` already writes it. Do not add a second default in the Vue file and a third in the IPC handler. The builder is the single place that fills defaults. The IPC defaults remain as a backstop for older callers that omit the fields.

### 4.4 Native-dialog path

When the selected object has a string `path` and is not a `File` (the native dialog shape), call the existing `uploadDocument` API instead of returning a fake row:

```typescript
await uploadDocumentAPI({
  filePath: nativePath,
  name: file.name,
  modelName: currentModel.value || "text-embedding-3-small",
  title: metadata.title,
  description: metadata.description,
  tags: metadata.tags,
  author: metadata.author,
});
```

`ragUploadDocumentInputSchema` requires `modelName` even though `RagSearchModule.uploadDocument` ignores the argument and loads the default embedding model from settings. Pass the current model so Zod accepts the payload. The grant issued by `SHOW_OPEN_DIALOG` is consumed by this call. One native file, one grant, one upload.

`windowInvoke` returns the unwrapped `data`, which is `DocumentUploadResponse` (`documentId`, `chunksCreated`, `processingTime`, `document`). The declared return type on `uploadDocument()` says `RAGResponse`. Read `document` off the unwrapped value with a type guard. Use that `document` as the `UploadedDocument` passed to `handleUploadSuccess`.

If `uploadDocument` throws, surface `knowledge.upload_failed` and keep the dialog open.

A real `File` that also has `path` stays on `copyFileToTemp`. Sandboxed file inputs do not have `path`. Do not switch them to `RAG_UPLOAD_DOCUMENT`; that channel rejects paths that were not granted by the native dialog and are not under the app uploads directory.

### 4.5 IPC validation

Extend `ragUploadDocumentInputSchema` so the optional fields are typed instead of only riding on `.passthrough()`:

```typescript
z.object({
  filePath: z.string().min(1),
  name: z.string().min(1),
  modelName: z.string().min(1),
  title: z.string().trim().max(500).optional(),
  description: z.string().trim().max(2000).optional(),
  author: z.string().trim().max(255).optional(),
  tags: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
}).passthrough()
```

Keep `.passthrough()` so existing extra fields do not start failing. Apply the same author, description, and tags limits to the `SAVE_TEMP_FILE` metadata object before `uploadDocument` is called. Reject over-long values with a Zod error. Do not clip them in the handler.

`RAGDocumentModule.uploadDocument` already assigns the four fields. No module change is required for Phase 1 unless a test shows tags being double-encoded. The module must keep receiving `tags` as `string[]` and calling `JSON.stringify` once.

### 4.6 DocumentManagement dialog

Add one author `v-text-field` under the existing tags combobox. Include `author` in the `uploadDocumentAPI` payload and in the form reset. Leave the open button commented out.

### 4.7 i18n

Add `knowledge.author` and `knowledge.upload_metadata_hint` to `en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, and `ja.ts`. Reuse `knowledge.tags`, `knowledge.tags_hint`, and `knowledge.description`.

| Key | English |
| --- | --- |
| `knowledge.author` | Author |
| `knowledge.upload_metadata_hint` | Optional. Applied to every file in this upload. |

## 5. Phase 2 — Retrieval

### 5.1 Document id query

Add `RAGDocumentModel.findSearchableDocumentIds`:

```typescript
findSearchableDocumentIds(filters: {
  documentIds?: number[];
  fileTypes?: string[];
  author?: string;
  tags?: string[];
  uploadedFrom?: Date;
  uploadedTo?: Date;
}): Promise<number[]>
```

The query is parameterized.

| Filter | SQL |
| --- | --- |
| status | `document.status = 'active'` |
| processing | `document.processingStatus = 'completed'` |
| author | `LOWER(document.author) LIKE :author` after escaping `%` and `_` in the user text, wrapped as `%value%` |
| one tag | `LOWER(document.tags) LIKE :tag` where the bound value is `%"tag"%` |
| several tags | OR of those LIKE clauses |
| file type | `document.fileType IN (:...fileTypes)` |
| date | `document.uploadedAt` between the two bounds |
| document ids | `document.id IN (:...documentIds)` |

The quoted form `%"pricing"%` matches a JSON string element `"pricing"` and does not match `"pricing-old"`. Escape `%`, `_`, and `"` in the tag before binding. SQLite `LIKE` is case-insensitive for ASCII, which covers the PRD rule that `pricing` matches `Pricing`.

Replace the in-memory scan in `resolveAllowedDocumentIds` with this method. Keep the early return:

| Filters present | Return |
| --- | --- |
| none | `undefined` (search all documents) |
| some, and the query returns ids | that id list |
| some, and the query returns no ids | `[]` |

In `searchKnowledgeForTool`, treat `[]` as an immediate empty success. Do not call `searchCandidates`.

```typescript
if (allowedDocIds && allowedDocIds.length === 0) {
  return emptySuccess(request.query);
}
```

### 5.2 Vector search honors the id list

`VectorSearchService.search` currently calls `getAllDocumentsWithEmbeddings()` and searches every index. Add optional `documentIds?: number[]` to `SearchOptions`. When it is set, drop documents whose id is not in the set before `groupDocumentsByModel`, so those indexes are never opened.

`searchCandidates` must pass the same `documentIds` into `search()`, not only into `searchChunksByKeywords`. After the merge, drop any candidate whose `documentId` is outside the set. That second check covers a keyword row that slipped through.

`searchWithFilters` stays as it is. The hidden Search tab is out of scope.

### 5.3 Embedding header

Add `src/service/knowledgeMetadataHeader.ts`:

```typescript
export interface EmbeddingHeaderSource {
  fileName: string;
  title?: string;
  author?: string;
  tags?: string[];
  description?: string;
}

export function buildEmbeddingInput(
  source: EmbeddingHeaderSource,
  chunkContent: string
): string;
```

The function returns `chunkContent` unchanged when every header line would be omitted. Otherwise it returns:

```text
Title: {title}
Author: {author}
Tags: {tag1}, {tag2}
Description: {description}

{chunkContent}
```

Omit a line when:

| Field | Omit when |
| --- | --- |
| title | missing or blank |
| author | missing, blank, or `User` |
| tags | missing, empty, or exactly the set `uploaded` + `knowledge` in any order |
| description | missing, blank, or equal to `Uploaded document: {fileName}` |

Collapse newlines inside each field to spaces before joining, so a description cannot add extra header lines. Do not JSON-stringify the header.

`embedAndStoreChunks` needs the parent document fields. Change its signature to take the header source, or load the document once in `uploadDocument` / the re-embed path and pass it in. Inside the batch loop:

```typescript
const texts = batch.map((chunk) =>
  buildEmbeddingInput(headerSource, chunk.content)
);
```

`storeEmbedding` keeps `content: chunk.content`. The vector index text that is later shown to the model is the body. The embedding itself was computed on header + body. Keyword search stays on `rag_chunks.content`, so it does not match author unless the body contains that word. Author and tag lookup is the SQL filter plus the vector similarity of the header. That split is intentional.

Call sites of `embedAndStoreChunks` are the initial upload path and the re-embed path in `RagSearchModule`. Both must pass the header source. A re-embed of a document whose only metadata is the defaults produces the same embedding text as today.

### 5.4 Result payload

Extend `RagSearchCandidate.document` and the document object inside `VectorSearchService.SearchResult`:

```typescript
document: {
  id: number;
  name: string;
  title?: string;
  fileType: string;
  author?: string;
  description?: string;
  tags?: string[];
};
```

`getDetailedResults` already loads the chunk with its document. Parse `document.tags` with the same helper `KnowledgeLibraryAiTools` uses (`JSON.parse`, keep only strings). Copy author and description through.

`candidateToResultItem` adds:

```typescript
author: candidate.document.author,
tags: candidate.document.tags ?? [],
description: candidate.document.description,
```

Citation text stays `[doc:{id} chunk:{index} {name}]`. The structured fields are what the model reads.

### 5.5 Tool descriptions

In `src/config/skillsRegistry.ts`, update `knowledge_library_search`:

- Tell the model to put a person's name in `author` and labels in `tags`, and to put the topic in `query`.
- State that results include `author`, `tags`, and `description`.

Update `knowledge_library_list_documents`:

- The description already says results include tags. Add author.
- Add an optional `author` string parameter. Implement it with `findSearchableDocumentIds` or the existing list query using the same case-insensitive substring rule. Do not use `getDocuments`' exact `author =` match for this tool.

### 5.6 Document table

`DocumentManagement.vue` headers gain:

| key | label |
| --- | --- |
| `author` | `knowledge.author` |
| `tags` | `knowledge.tags` |

Author cell: blank when the value is missing or `User`. Tags cell: chips, hiding `uploaded` and `knowledge` when those are the only tags. Other tags render as plain text chips, not HTML.

`getDocuments` IPC already returns `author` and parsed `tags` on each document. Confirm `DocumentInfo` in `src/views/api/rag.ts` is what the table reads, and bind those fields. No new IPC.

### 5.7 Re-embed

Documents imported in Phase 1 with a real author, custom tags, or a custom description need one re-embed after Phase 2 ships, or their vectors will not contain the header. Do not add a background migration. The existing per-document re-embed action in the document table is the mechanism. Phase 2 does not add an edit-metadata form. Changing metadata later is a future enhancement, and that future change must call the same re-embed path because the header is part of the vector.

## 6. Phase 3 — Extra Fields

Do this only after Phase 2 tests pass.

### 6.1 Entity

On `RAGDocumentEntity`:

```typescript
@Column("varchar", { length: 16, nullable: true })
language?: string;

@Column("datetime", { nullable: true })
documentDate?: Date;

@Column("text", { nullable: true })
customMetadata?: string;
```

`synchronize: true` adds the columns. Null on old rows.

### 6.2 Allowlist

```typescript
export const KNOWLEDGE_CUSTOM_METADATA_KEYS = [
  "product",
  "customer",
  "campaign",
  "category",
] as const;

export const knowledgeCustomMetadataSchema = z
  .object({
    product: z.string().trim().min(1).max(200).optional(),
    customer: z.string().trim().min(1).max(200).optional(),
    campaign: z.string().trim().min(1).max(200).optional(),
    category: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
```

`.strict()` rejects unknown keys. Store `JSON.stringify` of the parsed object. Empty object stores `undefined`, not `"{}"`.

`buildEmbeddingInput` gains optional lines `Language`, `Document date`, and one line per present custom key, using the key name as the label (`Product: ...`). Omit empty keys.

`findSearchableDocumentIds` gains optional `language`, `documentDate` range, and `customMetadata` equality filters. Custom values use the same quoted-token `LIKE` as tags, against the JSON text, so `product = "Acme"` matches `"product":"Acme"` and not a longer value. Bind each key separately. Do not concatenate user keys into SQL identifiers; the allowlist is a fixed set of columns inside the JSON, selected in code with a switch, and the value is a bound parameter.

The upload dialog's "More fields" control only offers these four keys. The tool descriptions list the same four keys.

## 7. Security

1. Author, tags, description, and custom values are bound parameters. Never concatenate them into SQL.
2. Escape `%` and `_` before wrapping a `LIKE` pattern.
3. Header labels are fixed constants. User text is collapsed to one line.
4. The document table and tool results render metadata as text. No `v-html`.
5. Tool results still omit `filePath`.
6. Length limits in the Zod schemas cap how much text enters the embedding request.

## 8. Testing Plan

### 8.1 Phase 1 component test

`test/vitest/main/components/KnowledgeLibraryUploadDialog.test.ts`

Mock `@/views/api/rag` and `@/views/api/localAiRuntime`. Stub `DocumentManagement`, `SearchInterface`, and `WebsiteImportDialog`. `getRAGStats` returns a non-local embedding model so the runtime gate returns ready.

| Case | Expectation |
| --- | --- |
| Dialog renders author, tags, and description | labels from i18n are present |
| File plus Alice Chen / pricing, enterprise / a description | `copyFileToTemp` metadata equals the builder output, title is the filename stem |
| File and blank fields | author `User`, tags `["uploaded", "knowledge"]`, description `Uploaded document: {name}` |
| Duplicate tags differing only by case | one tag, first spelling kept |
| Cancel | the three fields reset |

Also unit-test `buildFileUploadMetadata` in that file or beside it: 21st tag rejected by the normalizer's caller, 65-character tag rejected, description default includes the specific filename.

Run `yarn test:components` on this file.

### 8.2 Header unit test

`test/vitest/utilitycode/knowledgeMetadataHeader.test.ts`

| Case | Expectation |
| --- | --- |
| Defaults only | output equals the chunk body |
| Real author and tags | output starts with `Title:`, `Author:`, `Tags:` and ends with the body |
| Description containing a newline | newline becomes a space; only one `Description:` line |
| Author `User` and tags `uploaded`, `knowledge` | those lines omitted |

### 8.3 Search test

Extend `test/vitest/main/service/KnowledgeSearchTool.test.ts`.

| Case | Expectation |
| --- | --- |
| author filter | documents by other authors are not opened by vector search |
| tag `pricing` | document tagged `pricing-old` is excluded; document tagged `Pricing` is included |
| filters match nothing | empty `results`, `success: true`, vector search not called |
| hit mapping | `author`, `tags`, and `description` are present; `content` does not start with `Title:` |
| embed call | the string passed to the embedding function starts with the header; stored chunk content does not |

## 9. Rollout

1. Phase 1: builder, dialog, native-dialog upload, Zod limits, i18n, component test. Ship this alone. Existing `resolveAllowedDocumentIds` will already filter newly stored author and tags, with the defects in section 2.3 still present.
2. Phase 2: id query, vector id filter, embedding header, result fields, table columns, tool description text, search tests.
3. After Phase 2, re-embed documents that have a non-default author, tags, or description. Default-only documents do not need it.
4. Phase 3: entity columns, allowlist, dialog row, tool description update.

## 10. Implementation Checklist

Phase 1:

- [ ] `fileUploadMetadata.ts` with defaults and tag normalization
- [ ] `KnowledgeLibrary.vue` fields, hint, clear-on-cancel, pass metadata into `copyFileToTemp`
- [ ] Native-dialog path calls `uploadDocument` with `modelName` and the same metadata
- [ ] Zod limits on `RAG_UPLOAD_DOCUMENT` and `SAVE_TEMP_FILE` metadata
- [ ] Author field on the unused `DocumentManagement.vue` dialog
- [ ] `knowledge.author` and `knowledge.upload_metadata_hint` in six language files
- [ ] Component test

Phase 2:

- [ ] `findSearchableDocumentIds`
- [ ] Empty id list returns an empty tool result
- [ ] `search` / `searchCandidates` skip documents outside `documentIds`
- [ ] `buildEmbeddingInput` used by every `embedAndStoreChunks` call site
- [ ] Stored chunk content remains the body
- [ ] Search hits and candidate documents include author, tags, description
- [ ] Tool descriptions updated
- [ ] Document table columns
- [ ] Header and search tests

Phase 3:

- [ ] `language`, `documentDate`, `customMetadata` columns
- [ ] Strict Zod allowlist
- [ ] Header lines and id-query filters for the new fields
- [ ] More-fields control limited to the four keys

## 11. Related Documents

- `docs/prd/knowledge-library-document-metadata-prd.md`
- `docs/prd/knowledge-library-management-ai-tools-technical-design.md`
- `docs/prd/knowledge-library-website-import-ai-tool-technical-design.md`
- `docs/rag-tool-call-rerank-prd.md`
