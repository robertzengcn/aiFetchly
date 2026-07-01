# Implementation Plan: CSV & Excel Upload Support for AI Chat and Knowledge Library

**Branch**: `001-skill-system` | **Date**: 2026-04-12 | **Spec**: inline
**Input**: User request + referenced strategy docs in `docs/RAG Excel Support Strategies.md` and `docs/Convert Excel to Markdown All Sheets.md`

## Summary

Enable CSV and Excel (.xlsx/.xls) file uploads in two UI surfaces:
1. **AI Chat Box** -- users attach .csv/.xlsx files to chat messages; backend converts to markdown for LLM context
2. **Knowledge Library** -- users upload .csv/.xlsx files for RAG (text extraction -> chunking -> embedding)

**Technical approach**: Use `xlsx` (SheetJS) for Excel parsing with `sheet_to_html()` piped through the existing `HtmlConversionService` (turndown) for clean markdown conversion. Use `papaparse` for robust CSV parsing. Both libraries are already installed except `xlsx`.

**RAG strategy** (per `docs/RAG Excel Support Strategies.md`): Use **Markdown Chunking** pattern for initial implementation -- convert sheets to markdown, then let `ChunkingService` handle splitting. Row-as-a-Document pattern is a future optimization for record-heavy files.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js (Electron)
**Primary Dependencies**: xlsx (to add), papaparse (existing), turndown (existing), HtmlConversionService (existing)
**Storage**: SQLite (TypeORM) for documents/chunks; sqlite-vec for vector embeddings
**Testing**: Mocha + Vitest
**Target Platform**: Electron desktop app (Windows/macOS/Linux)
**Project Type**: Desktop application (Electron main process + Vue renderer)
**Performance Goals**: Conversion < 5s for files up to 50MB; chat attachments limited to 100 rows/sheet for LLM safety
**Constraints**: Chat file limit 5MB; Knowledge Library limit 50MB; row cap for LLM context safety
**Scale/Scope**: Single-user desktop app; typical files < 10k rows

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| File organization (many small files < 800 lines) | PASS | Extending existing focused service/module files |
| Error handling (explicit at every level) | PASS | Conversion errors surfaced to user via existing error channels |
| Input validation (at system boundaries) | PASS | File type + size validation already exists; extending to new types |
| No mutation (immutable patterns) | PASS | Following existing patterns |
| No `any` type (TypeScript rules) | PASS | Will use proper types for xlsx workbook/sheet interfaces |

No violations. All gates pass.

## Current State Analysis

| Layer | File | CSV | Excel (.xlsx) |
|-------|------|-----|---------------|
| **Frontend - Chat** | `AiChatBox.vue` `fileAccept` | Supported | NOT listed |
| **Frontend - Library** | `KnowledgeLibrary.vue` upload `accept` | NOT listed | NOT listed |
| **Frontend - Chat** | `AiChatBox.vue` `isSupportedAttachmentFile()` | Supported | NOT listed |
| **Backend - Chat IPC** | `ai-chat-ipc.ts` `isSupportedUploadedFile()` | Supported | NOT listed |
| **Backend - Chat Attach** | `DocumentService.ts` `resolveSupportedExtension()` | Supported | **Throws error** |
| **Backend - Chat Attach** | `DocumentService.ts` `convertUploadedAttachmentToMarkdown()` | Supported | **Throws error** |
| **Backend - RAG File Types** | `RAGDocumentModule.ts` `supportedFileTypes` | NOT listed | NOT listed |
| **Backend - RAG Chunking** | `ChunkingService.ts` `extractDocumentContent()` | NOT handled | NOT handled |

**Key gaps**:
- CSV: supported in chat attachments but NOT in RAG pipeline (file type list, text extraction, chunking)
- Excel: NOT supported anywhere; DocumentService explicitly throws "Excel attachments are not supported"

## Conversion Pipeline Design

Per `docs/Convert Excel to Markdown All Sheets.md`:

```
.xlsx file
  -> xlsx.readFile() / xlsx.read(buffer)
  -> for each sheet: xlsx.utils.sheet_to_html(worksheet)
  -> HtmlConversionService.convertHtmlToMarkdown(htmlTable)   [already exists]
  -> Concatenate with "## Sheet: {name}" headers
  -> Final markdown string
```

For **chat attachments**: Cap at 100 rows/sheet (per doc recommendation for LLM context safety).
For **RAG/knowledge library**: No row cap; full conversion then standard markdown chunking.

For **CSV**: Use `papaparse` (already installed) instead of naive comma-splitting to handle quoted values, escaped commas, and multi-line fields.

## Project Structure

```text
src/
├── service/
│   ├── ChunkingService.ts          # MODIFY: add .csv/.xlsx/.xls cases to extractDocumentContent()
│   └── DocumentService.ts          # MODIFY: add Excel support, improve CSV with papaparse
├── modules/
│   └── RAGDocumentModule.ts        # MODIFY: add .csv/.xlsx/.xls to supportedFileTypes[]
├── main-process/communication/
│   └── ai-chat-ipc.ts             # MODIFY: add .xlsx to isSupportedUploadedFile()
├── views/
│   ├── components/aiChat/
│   │   └── AiChatBox.vue          # MODIFY: add .xlsx/.xls to fileAccept + validation
│   ├── pages/knowledge/
│   │   └── KnowledgeLibrary.vue   # MODIFY: add .csv/.xlsx/.xls to upload accept
│   └── lang/{en,zh,es,fr,de,ja}.ts  # MODIFY: update file type hint strings
```

**Structure Decision**: Extending existing layers. No new files or directories required. All changes fit within existing service/module/IPC/view architecture.

## Implementation Tasks

### Task 1: Add `xlsx` dependency
- `yarn add xlsx`
- Verify compilation with Electron's Node.js version
- No native binaries -- pure JS, should work in Electron without rebuild

### Task 2: ChunkingService -- CSV/Excel text extraction
File: `src/service/ChunkingService.ts` (currently ~950 lines)

Add two new cases to `extractDocumentContent()` switch statement:

**`.csv` case**:
- Read file as UTF-8 string
- Parse with `papaparse` (handles quoted fields, escaped commas, line breaks in cells)
- Convert parsed rows to markdown table
- Return `DocumentContent { contentType: 'markdown', originalFormat: 'csv' }`

**`.xlsx` / `.xls` case**:
- Read file as Buffer
- Parse with `xlsx.read(buffer)`
- For each sheet: `xlsx.utils.sheet_to_html(worksheet)` -> `HtmlConversionService.convertHtmlToMarkdown()`
- Prepend `## Sheet: {sheetName}` header for each sheet
- Return `DocumentContent { contentType: 'markdown', originalFormat: 'xlsx' }`

### Task 3: DocumentService -- Excel conversion for chat attachments
File: `src/service/DocumentService.ts` (currently ~380 lines)

**Update `resolveSupportedExtension()`**:
- Change return type union to include `'.xlsx'`
- Add `.xlsx` / `.xls` detection returning `'.xlsx'`
- Remove the explicit "Excel attachments are not supported" error throw

**Add `convertXlsxBufferToMarkdown()` private method**:
- Parse buffer with `xlsx.read(buffer, { type: 'buffer' })`
- For each sheet: `sheet_to_html()` -> `HtmlConversionService.convertHtmlToMarkdown()`
- Include sheet name headers (`## Sheet: {name}`)
- Cap at 100 rows/sheet for chat context safety (per `docs/Convert Excel to Markdown All Sheets.md`)

**Improve `convertCsvBufferToMarkdown()`**:
- Replace naive `line.split(',')` with `papaparse.parse()` for proper CSV handling
- Handles: quoted values, escaped commas, multi-line fields, BOM markers

**Update `convertUploadedAttachmentToMarkdown()`**:
- Add `.xlsx` case calling `convertXlsxBufferToMarkdown()`

### Task 4: RAGDocumentModule -- file type registration
File: `src/modules/RAGDocumentModule.ts`

- Add `.csv`, `.xlsx`, `.xls` to `supportedFileTypes` array (line 33-36)
- Currently: `['.txt', '.md', '.pdf', '.doc', '.docx', '.rtf', '.html', '.htm', '.xml', '.json']`
- New: `['.txt', '.md', '.pdf', '.doc', '.docx', '.rtf', '.html', '.htm', '.xml', '.json', '.csv', '.xlsx', '.xls']`

### Task 5: AI Chat IPC -- file validation
File: `src/main-process/communication/ai-chat-ipc.ts`

In `isSupportedUploadedFile()` (line 70-101), add:
```typescript
if (
    lowerMime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    lowerName.endsWith('.xlsx')
) {
    return true;
}
if (lowerName.endsWith('.xls')) {
    return true;
}
```

### Task 6: Frontend -- AiChatBox.vue file picker
File: `src/views/components/aiChat/AiChatBox.vue`

**Update `fileAccept`** (line 815):
- Currently: `'image/*,.png,.jpg,.jpeg,.webp,.gif,.csv,.pdf,.docx'`
- New: `'image/*,.png,.jpg,.jpeg,.webp,.gif,.csv,.pdf,.docx,.xlsx,.xls'`

**Update `isSupportedAttachmentFile()`** (line 855-877):
- Add `.xlsx` / `.xls` extension checks

**Update `resolveAttachmentMimeType()`** (line 879-899):
- Add `.xlsx` -> `'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'`
- Add `.xls` -> `'application/vnd.ms-excel'`

### Task 7: Frontend -- KnowledgeLibrary.vue upload dialog
File: `src/views/pages/knowledge/KnowledgeLibrary.vue`

**Update file input `accept`** (line 148):
- Currently: `'.pdf,.txt,.doc,.docx,.md,.html,.htm'`
- New: `'.pdf,.txt,.doc,.docx,.md,.html,.htm,.csv,.xlsx,.xls'`

**Update supported types hint text** (line 119-121):
- Currently: `"PDF, TXT, DOC, DOCX, MD, HTML files supported"`
- New: `"PDF, TXT, DOC, DOCX, MD, HTML, CSV, Excel files supported"`

### Task 8: i18n -- Update all 6 language files
Files: `src/views/lang/{en,zh,es,fr,de,ja}.ts`

- Update any translation strings that list supported file types
- No new keys needed -- existing error/upload messages cover the new types

### Task 9: Tests
- Unit test: CSV to markdown conversion (papaparse-based)
- Unit test: Excel to markdown conversion (xlsx + turndown pipeline)
- Unit test: Row capping for chat attachments (100 rows/sheet limit)
- Verify existing chunking strategies work on spreadsheet-derived markdown

## Complexity Tracking

No violations to justify.
