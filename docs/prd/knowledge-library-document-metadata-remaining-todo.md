# Knowledge Library Document Metadata Remaining TODO

Source requirements:

- `docs/prd/knowledge-library-document-metadata-prd.md`
- `docs/prd/knowledge-library-document-metadata-technical-design.md`

Audit basis:

- Worktree: `.worktrees/feat-knowledge-library-document-metadata`
- Branch: `feat/knowledge-library-document-metadata` at `6acc9762`
- Phases 1 and 2 are implemented. The metadata tests in that worktree passed (6 component, 4 header, 10 search). The project typecheck gate was skipped for that run.
- The items below are still missing or only partially implemented.

## Completion Target

The feature is complete when the Phase 1 and Phase 2 gaps below are closed and Phase 3 (`language`, `documentDate`, and the four custom metadata keys) is implemented with the same filter and embedding-header rules as author, tags, and description.

## TODO Items

### 1. Show upload metadata before a file is chosen

Requirement coverage:

- PRD §14.1: fields are visible in the same dialog, and the user can fill them before or after choosing files.
- PRD §14.2: the Upload button stays disabled until at least one file is selected.

Current state:

- `KnowledgeLibrary.vue` renders author, tags, description, and the hint only when `uploadFiles.length > 0`.
- The Upload button is already disabled until a file is selected.

TODO:

- Render the metadata fields and hint whenever the Upload document dialog is open, including when the file list is empty.
- Keep the Upload button disabled until at least one file is selected.

Acceptance:

- A user can type author, tags, and description, then choose files, and those values are the ones saved.
- Metadata alone does not enable Upload.

### 2. Translate tag-limit validation errors

Requirement coverage:

- PRD §9: reject the upload with a translated message when a limit is exceeded. Do not drop tags past the cap without telling the user.
- Technical design §4.1: the dialog shows a translated error and does not upload.

Current state:

- Author (255) and description (2000) are limited by `maxlength` on the controls.
- A tag longer than 64 characters, or a 21st tag, throws an English `Error` from `buildFileUploadMetadata`. The dialog shows that English text after the translated "Upload failed" prefix.
- Keys are missing in `src/views/lang/{en,zh,es,fr,de,ja}.ts`.

TODO:

- Add translation keys for "tag exceeds 64 characters" and "at most 20 tags" in all six language files.
- Show those translated messages in the upload dialog and do not start the upload.
- Keep the typed author, tags, and description so the user can correct them and retry.

Acceptance:

- Entering a 65-character tag or 21 tags shows a message in the active UI language and does not call `copyFileToTemp` or `uploadDocument`.

### 3. Assert blank-field upload through the dialog

Requirement coverage:

- PRD §16.1 item 3: submitting with author, tags, and description blank calls `copyFileToTemp` with author `User`, tags `["uploaded", "knowledge"]`, and description `Uploaded document: {filename}`.

Current state:

- `KnowledgeLibraryUploadDialog.test.ts` covers that payload on `buildFileUploadMetadata` directly.
- The dialog submit test covers only the typed-metadata path.

TODO:

- Add a component test that submits the Upload document dialog with all three fields blank and asserts the `copyFileToTemp` metadata.

Acceptance:

- `yarn test:components` for `KnowledgeLibraryUploadDialog.test.ts` includes this case and passes.

### 4. Reject duplicate tags on the main-process boundary

Requirement coverage:

- PRD §9: tags are unique case-insensitively, validated in the UI and again with Zod on the upload boundary.

Current state:

- `normalizeUploadTags` in `fileUploadMetadata.ts` drops a later tag whose case-folded value was already kept.
- `ragUploadDocumentInputSchema` and `saveTempFileMetadataSchema` enforce count and length. They accept `["Pricing", "pricing"]`.

TODO:

- Add a Zod check on both schemas that rejects case-insensitive duplicate tags instead of storing both.
- Return the existing invalid-metadata error path. Do not silently drop the duplicate in the IPC handler.

Acceptance:

- A payload with two tags that differ only by case fails validation on `RAG_UPLOAD_DOCUMENT` and `SAVE_TEMP_FILE`.
- A payload whose tags are already normalized by the dialog still succeeds.

### 5. Test that the embedder receives the header and storage keeps the body

Requirement coverage:

- PRD §16.2 item 4: the text sent to the embedding function for a new chunk starts with the metadata header, and the tool result content stays body-only.
- Technical design §8.3 "embed call": the string passed to the embedding function starts with the header; stored chunk content does not.

Current state:

- `embedAndStoreChunks` builds the header with `buildEmbeddingInput` and stores `chunk.content`.
- `KnowledgeSearchTool.test.ts` calls `buildEmbeddingInput` and checks a fixture candidate. It does not spy on the embedding function or `storeEmbedding`.
- `knowledgeMetadataHeader.test.ts` covers the header string itself.

TODO:

- Extend the search test so a new chunk's embed call receives a string that starts with the metadata header, and the stored chunk content does not start with `Title:`.

Acceptance:

- The test fails if `embedAndStoreChunks` embeds `chunk.content` alone or stores the header in chunk content.

### 6. Phase 3 — language, document date, and custom metadata

Requirement coverage:

- PRD §8.3 and §10.
- Technical design §6 and the Phase 3 checklist in §10.

Current state:

- Not started. `RAGDocumentEntity` has no `language`, `documentDate`, or `customMetadata` columns. The upload dialog has no More fields row. Search and list tool descriptions do not mention the four custom keys.

TODO:

- Add nullable `language` (varchar 16), `documentDate` (datetime), and `customMetadata` (text JSON) on `rag_documents`. Existing rows stay null.
- Add a strict Zod allowlist with keys `product`, `customer`, `campaign`, and `category`. Each value is a trimmed string of 1 to 200 characters. Unknown keys are rejected. An empty object is stored as null, not `"{}"`. At most 8 keys.
- Validate `language` (max 16) and `documentDate` (ISO date) on the upload boundary.
- Extend `buildEmbeddingInput` with `Language`, `Document date`, and one line per present custom key (`Product: ...`). Omit empty values. Collapse newlines the same way as description.
- Extend `findSearchableDocumentIds` with optional `language`, a `documentDate` range, and equality filters for the four custom keys. Custom values use a bound quoted-token `LIKE` against the JSON text. Do not concatenate user keys into SQL identifiers.
- Add an optional More fields row on the Upload document dialog that offers only those four keys.
- Add the new labels to all six language files. Do not reuse website-import keys.
- List the same four keys in the `knowledge_library_search` and `knowledge_library_list_documents` tool descriptions.
- Include the new fields in the embedding header only when present. Changing a header field still requires re-embed through the existing per-document re-embed action.

Acceptance:

- A file uploaded with language, document date, and one or more of the four keys stores them on `rag_documents`.
- An unknown custom key is rejected with a translated message and is not stored.
- A search filter for `product = "Acme"` matches that JSON value and does not match a longer value.
- A chunk embedded for that document includes the new header lines, and the stored chunk body does not.
- Documents that leave the new fields empty keep searching as they do today.
