# Roadmap: AiFetchly

## Milestones

- [x] **v1.0 Google Maps Business Scraper** - Phases 1-4 (shipped 2026-05-23)
- [ ] **v1.1 AI Chat File Operation Recording** - Phases 5-8 (in progress)

## Phases

<details>
<summary>v1.0 Google Maps Business Scraper (Phases 1-4) - SHIPPED 2026-05-23</summary>

### Phase 1: Type Contracts and Skill Registration
**Goal:** Establish typed contracts and register the AI skill so the system recognizes `search_google_maps_businesses`.
**Plans:** Complete

### Phase 2: Module and Worker Implementation
**Goal:** Implement the scraping engine -- GoogleMapsModule orchestrates a child process worker.
**Plans:** Complete

### Phase 3: UI Page and Integration
**Goal:** Add manual UI page, IPC handlers, frontend API, and translations.
**Plans:** Complete

### Phase 4: Persistence, Export, and Validation
**Goal:** Add result persistence, CSV/JSON export, and final validation/testing.
**Plans:** Complete

</details>

### v1.1 AI Chat File Operation Recording (In Progress)

**Milestone Goal:** Record every file mutation performed by AI chat skills and display those records as inline badges in the AI chat box, giving users real-time visibility into what the AI changed.

- [x] **Phase 5: Types and Tracker Foundation** - Shared types, tracker service, IPC channel constant
- [ ] **Phase 6: Backend Integration** - ToolExecutor interception, preload whitelist, background init
- [ ] **Phase 7: Frontend Badges and UI** - Subscription API, in-chat badges, diff preview, click-to-open
- [ ] **Phase 8: Translations and Polish** - 6-language i18n for all file operation UI text

## Phase Details

### Phase 5: Types and Tracker Foundation
**Goal**: The FileOperationRecord type and FileOperationTracker service exist and can emit typed records without crashing, forming the foundation every downstream layer depends on.
**Depends on**: Phase 4 (v1.0 shipped)
**Requirements**: TYPE-01, TYPE-02, TYPE-03, TRAK-01, TRAK-02, TRAK-03, TRAK-04, TRAK-05, IPC-01
**Success Criteria** (what must be TRUE):
  1. FileOperationRecord interface compiles with all readonly fields (id, type, filePath, timestamp, success, conversationId, and optional metadata)
  2. FileOperationType union type ("create" | "overwrite" | "edit") is defined and importable
  3. FileOperationTracker.emit() sends a record via webContents.send() without throwing, even when webContents is destroyed
  4. Tracker caps in-memory storage at 500 records per conversation, evicting oldest first
  5. AI_FILE_OPERATION channel constant ("ai-chat:file-operation") is defined in channellist.ts
**Plans:** 1 plan

Plans:
- [x] 05-01-PLAN.md -- Create FileOperationRecord types, AI_FILE_OPERATION channel constant, FileOperationTracker service with tests

### Phase 6: Backend Integration
**Goal**: Every file_write and file_edit executed by the AI automatically emits a FileOperationRecord through the IPC channel, with zero impact on existing tool behavior.
**Depends on**: Phase 5
**Requirements**: EXEC-01, EXEC-02, EXEC-03, EXEC-04, EXEC-05, EXEC-06, PREL-01, INIT-01, INIT-02
**Success Criteria** (what must be TRUE):
  1. When AI performs file_write, a FileOperationRecord with type "create" or "overwrite" is emitted to the renderer
  2. When AI performs file_edit, a FileOperationRecord with type "edit" and linesChanged is emitted to the renderer
  3. Failed file operations still emit records containing the error message
  4. Read-only tools (file_read, glob_files, grep_files) produce no records
  5. Existing tool execution behavior (return values, error handling, streaming) is unchanged
**Plans:** TBD

### Phase 7: Frontend Badges and UI
**Goal**: Users see color-coded inline badges in the AI chat for every file mutation, can expand diffs for edits, and can click badges to open files.
**Depends on**: Phase 6
**Requirements**: SUB-01, SUB-02, SUB-03, BADGE-01, BADGE-02, BADGE-03, BADGE-04, BADGE-05, DIFF-01, DIFF-02, DIFF-03, OPEN-01, OPEN-02, OPEN-03
**Success Criteria** (what must be TRUE):
  1. Color-coded badges appear inline in the AI chat for each file write/edit operation (green=create, yellow=overwrite, blue=edit, red=failed)
  2. Each badge shows the operation type icon, file basename, and success/failure indicator
  3. Failed operation badges display the error message
  4. Edit operation badges have an expandable section showing unified diff lines (green additions, red deletions)
  5. Clicking a badge opens the file in the system default editor
**Plans:** TBD
**UI hint**: yes

### Phase 8: Translations and Polish
**Goal**: All file operation UI text is translated and displayed correctly in all 6 supported languages.
**Depends on**: Phase 7
**Requirements**: I18N-01, I18N-02, I18N-03, I18N-04, I18N-05, I18N-06, I18N-07
**Success Criteria** (what must be TRUE):
  1. English translation keys exist under `fileOperations` namespace in en.ts covering all operation labels, status text, error messages, and tooltip text
  2. Matching translations exist in all 5 other language files (zh, es, fr, de, ja) with the same key structure
  3. All user-facing text in the file operation badges uses `t('fileOperations.key')` with English fallback
**Plans:** TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 5 -> 6 -> 7 -> 8

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Type Contracts and Skill Registration | v1.0 | 3/3 | Complete | 2026-05-23 |
| 2. Module and Worker Implementation | v1.0 | 2/2 | Complete | 2026-05-23 |
| 3. UI Page and Integration | v1.0 | 2/2 | Complete | 2026-05-23 |
| 4. Persistence, Export, and Validation | v1.0 | 1/1 | Complete | 2026-05-23 |
| 5. Types and Tracker Foundation | v1.1 | 1/1 | Complete | 2026-05-25 |
| 6. Backend Integration | v1.1 | 0/? | Not started | - |
| 7. Frontend Badges and UI | v1.1 | 0/? | Not started | - |
| 8. Translations and Polish | v1.1 | 0/? | Not started | - |
