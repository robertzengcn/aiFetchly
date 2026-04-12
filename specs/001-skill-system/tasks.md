# Tasks: CSV & Excel Upload Support for AI Chat and Knowledge Library

**Input**: Design documents from `/specs/001-skill-system/`
**Prerequisites**: plan.md (required)

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Install dependency required by all subsequent tasks

- [X] T001 Install `xlsx` (SheetJS) dependency via `yarn add xlsx` — pure JS library, no native rebuild needed for Electron

---

## Phase 2: Foundational (Backend Conversion Pipeline)

**Purpose**: Core conversion logic that MUST be complete before any UI work. Both user stories (Chat + Knowledge Library) depend on this pipeline.

**CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 Add `convertXlsxBufferToMarkdown()` private method in `src/service/DocumentService.ts` — parse buffer with `xlsx.read()`, iterate sheets via `sheet_to_html()` → `HtmlConversionService.convertHtmlToMarkdown()`, prepend `## Sheet: {name}` headers, cap at 100 rows/sheet for chat context safety
- [X] T003 Improve `convertCsvBufferToMarkdown()` in `src/service/DocumentService.ts` — replace naive `line.split(',')` with `papaparse.parse()` for proper handling of quoted values, escaped commas, multi-line fields, and BOM markers
- [X] T004 Update `resolveSupportedExtension()` and `convertUploadedAttachmentToMarkdown()` in `src/service/DocumentService.ts` — add `.xlsx`/`.xls` extension detection, remove the explicit "Excel attachments are not supported" error throw, add `.xlsx` case calling `convertXlsxBufferToMarkdown()`
- [X] T005 [P] Add `.csv` case to `extractDocumentContent()` switch in `src/service/ChunkingService.ts` — read file as UTF-8 string, parse with papaparse, convert rows to markdown table, return `DocumentContent { contentType: 'markdown', originalFormat: 'csv' }`
- [X] T006 [P] Add `.xlsx`/`.xls` case to `extractDocumentContent()` switch in `src/service/ChunkingService.ts` — read file as Buffer, parse with `xlsx.read()`, iterate sheets via `sheet_to_html()` → `HtmlConversionService.convertHtmlToMarkdown()`, prepend sheet name headers, return `DocumentContent { contentType: 'markdown', originalFormat: 'xlsx' }`

**Checkpoint**: Backend can convert CSV and Excel files to markdown. Unit-testable independently of UI.

---

## Phase 3: User Story 1 — AI Chat CSV/Excel Attachments (Priority: P1) 🎯 MVP

**Goal**: Users can attach `.csv`, `.xlsx`, `.xls` files to AI chat messages; backend converts them to markdown for LLM context.

**Independent Test**: Attach a CSV or Excel file in AI chat, send a message, verify the AI can see and discuss the file contents. Verify 100-row cap is enforced for large files.

- [X] T007 Add `.xlsx`/`.xls` validation to `isSupportedUploadedFile()` in `src/main-process/communication/ai-chat-ipc.ts` — check MIME `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and extension `.xlsx`/`.xls`
- [X] T008 Update `fileAccept`, `isSupportedAttachmentFile()`, and `resolveAttachmentMimeType()` in `src/views/components/aiChat/AiChatBox.vue` — add `.xlsx,.xls` to file picker accept, add extension checks in validation, add MIME mappings (`.xlsx` → `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `.xls` → `application/vnd.ms-excel`)

**Checkpoint**: User can attach and send CSV/Excel files in AI chat. The AI receives the content as markdown. MVP complete.

---

## Phase 4: User Story 2 — Knowledge Library CSV/Excel Upload (Priority: P1)

**Goal**: Users can upload `.csv`, `.xlsx`, `.xls` files to the Knowledge Library for RAG (text extraction → chunking → embedding).

**Independent Test**: Upload a CSV or Excel file to Knowledge Library, verify it appears in the document list, perform a RAG search query that matches content from the uploaded file, verify search returns relevant results.

- [X] T009 Add `.csv`, `.xlsx`, `.xls` to `supportedFileTypes` array in `src/modules/RAGDocumentModule.ts` — extend the existing array at line 33-36 from `['.txt', '.md', '.pdf', '.doc', '.docx', '.rtf', '.html', '.htm', '.xml', '.json']` to include the new types
- [X] T010 Update file input `accept` attribute and supported types hint text in `src/views/pages/knowledge/KnowledgeLibrary.vue` — change accept to `'.pdf,.txt,.doc,.docx,.md,.html,.htm,.csv,.xlsx,.xls'` and hint to "PDF, TXT, DOC, DOCX, MD, HTML, CSV, Excel files supported"

**Checkpoint**: User can upload CSV/Excel files to Knowledge Library. Files are processed through the RAG pipeline (extract → chunk → embed) and are searchable.

---

## Phase 5: i18n & Cross-Cutting

**Purpose**: Internationalization and consistency updates across all supported languages

- [X] T011 [P] Update file type hint strings in all 6 language files `src/views/lang/{en,zh,es,fr,de,ja}.ts` — update any translation strings that list supported file types to include CSV and Excel

---

## Phase 6: Tests

**Purpose**: Verify conversion correctness and row capping behavior

- [X] T012 Unit test: CSV to markdown conversion (papaparse-based) in `test/modules/` — test basic CSV, quoted fields, escaped commas, multi-line fields, BOM marker handling
- [X] T013 Unit test: Excel to markdown conversion (xlsx + turndown pipeline) in `test/modules/` — test single sheet, multiple sheets, sheet name headers, empty sheets
- [X] T014 Unit test: Row capping for chat attachments (100 rows/sheet limit) in `test/modules/` — verify convertXlsxBufferToMarkdown caps at 100 rows, verify full conversion for RAG path has no cap

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (xlsx must be installed) — BLOCKS all user stories
- **US1 - AI Chat (Phase 3)**: Depends on Phase 2 (DocumentService conversion methods)
- **US2 - Knowledge Library (Phase 4)**: Depends on Phase 2 (ChunkingService extraction methods)
- **i18n (Phase 5)**: Can run in parallel with Phase 3 and Phase 4 (different files)
- **Tests (Phase 6)**: Depends on Phase 2 (testing the conversion pipeline)

### User Story Dependencies

- **US1 (AI Chat)**: Can start after Phase 2 — No dependency on US2
- **US2 (Knowledge Library)**: Can start after Phase 2 — No dependency on US1
- **US1 and US2 are independent** — can be implemented in parallel

### Within Foundational Phase (Phase 2)

- T002, T003, T004 are sequential (same file: DocumentService.ts)
- T005, T006 are parallel (same file: ChunkingService.ts but independent cases)
- T005/T006 can run in parallel with T002-T004

### Parallel Opportunities

- T002 + T003 + T004 (DocumentService) can overlap with T005 + T006 (ChunkingService) — different files
- T007 (ai-chat-ipc.ts) can run in parallel with T009 (RAGDocumentModule.ts) — different files, different stories
- T008 (AiChatBox.vue) can run in parallel with T010 (KnowledgeLibrary.vue) — different files, different stories
- T011 (i18n) can run in parallel with any Phase 3/4 task — different files
- T012, T013, T014 (tests) can run in parallel with each other — different test focuses

---

## Parallel Example: Foundational Phase

```
# Agent A: DocumentService (sequential within same file)
Task: "Add convertXlsxBufferToMarkdown() in src/service/DocumentService.ts"
Task: "Improve convertCsvBufferToMarkdown() with papaparse in src/service/DocumentService.ts"
Task: "Update resolveSupportedExtension() and convertUploadedAttachmentToMarkdown() in src/service/DocumentService.ts"

# Agent B: ChunkingService (parallel with Agent A)
Task: "Add .csv case to extractDocumentContent() in src/service/ChunkingService.ts"
Task: "Add .xlsx/.xls case to extractDocumentContent() in src/service/ChunkingService.ts"
```

## Parallel Example: User Stories

```
# After Foundational phase completes, launch in parallel:
Agent A: "US1 - AI Chat: T007 + T008 (IPC validation + Vue file picker)"
Agent B: "US2 - Knowledge Library: T009 + T010 (file type registration + Vue upload)"
Agent C: "i18n: T011 (all 6 language files)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Install xlsx
2. Complete Phase 2: Backend conversion pipeline
3. Complete Phase 3: AI Chat attachments (US1)
4. **STOP and VALIDATE**: Attach CSV/Excel in chat, verify AI sees content
5. MVP delivered — users can discuss spreadsheet data in chat

### Incremental Delivery

1. Phase 1 + Phase 2 → Backend pipeline ready
2. Phase 3 (US1) → Chat attachments work → **MVP!**
3. Phase 4 (US2) → Knowledge Library uploads work
4. Phase 5 + Phase 6 → i18n + tests → **Full feature complete**

### Parallel Team Strategy

1. Complete Setup + Foundational together
2. Once Foundational is done:
   - Developer A: US1 (AI Chat) — T007, T008
   - Developer B: US2 (Knowledge Library) — T009, T010
   - Developer C: i18n — T011
3. All stories complete independently, then run tests (T012-T014)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Row cap (100 rows/sheet) applies ONLY to chat attachments, NOT to RAG pipeline
- `papaparse` and `turndown` are already installed; only `xlsx` needs adding
