# Requirements: v1.1 AI Chat File Operation Recording

**Milestone:** v1.1 | **Status:** Draft | **Date:** 2026-05-25

---

## Types and Infrastructure

### TYPE-01: FileOperationRecord Shared Types

- [ ] **TYPE-01**: Define `FileOperationType` union type: `"create" | "overwrite" | "edit"`
- [ ] **TYPE-02**: Define `FileOperationRecord` interface with fields: id, type, filePath, timestamp (number), success, conversationId, skillName, toolCallId (optional), linesChanged (optional), sizeBytes (optional), error (optional)
- [ ] **TYPE-03**: All fields on `FileOperationRecord` are `readonly` (immutable pattern)

**File:** `src/entityTypes/fileOperationTypes.ts`

### TYPE-04: FileOperationTracker Service

- [ ] **TRAK-01**: Create static `FileOperationTracker` class with `setWebContents(webContents)` and `emit(record)` methods
- [ ] **TRAK-02**: `emit()` wraps IPC send in try/catch — failures never propagate to caller
- [ ] **TRAK-03**: `emit()` checks `webContents` is not destroyed before sending
- [ ] **TRAK-04**: Tracker holds an in-memory `Map<conversationId, FileOperationRecord[]>` capped at 500 records per conversation
- [ ] **TRAK-05**: Auto-generates unique `id` (UUID or crypto) and `timestamp` (Date.now()) for each record

**File:** `src/service/FileOperationTracker.ts`

## Backend Integration

### IPC Channel

- [ ] **IPC-01**: Add `AI_FILE_OPERATION` channel constant (`"ai-chat:file-operation"`) to `src/config/channellist.ts`

### ToolExecutor Integration

- [ ] **EXEC-01**: Thread `conversationId` parameter through to `executeFileTool()` (currently not passed)
- [ ] **EXEC-02**: After `FileToolService.execute()` returns for `file_write`, detect if file existed before to determine `create` vs `overwrite`
- [ ] **EXEC-03**: After `FileToolService.execute()` returns for `file_edit`, emit `FileOperationRecord` with type `"edit"` and `linesChanged` from result
- [ ] **EXEC-04**: Emit record on both success and failure branches — failed operations include error message
- [ ] **EXEC-05**: Read-only tools (`file_read`, `glob_files`, `grep_files`) do NOT emit records
- [ ] **EXEC-06**: Original tool result and error behavior preserved — tracking is additive only

**File:** `src/service/ToolExecutor.ts` (modify `executeFileTool`)

### Preload Whitelist

- [ ] **PREL-01**: Add `AI_FILE_OPERATION` to all 4 whitelist arrays in `src/preload.ts`: receive, removeListener, removeAllListeners (and send if needed)

**File:** `src/preload.ts`

### Background Initialization

- [ ] **INIT-01**: Call `FileOperationTracker.setWebContents(mainWindow.webContents)` after window creation in `src/background.ts`
- [ ] **INIT-02**: Clear/reset tracker webContents reference when window is closed or recreated

**File:** `src/background.ts`

## Frontend UI

### Subscription API

- [ ] **SUB-01**: Add `subscribeToFileOperations(handler)` wrapper using `windowReceive(AI_FILE_OPERATION, handler)` in `src/views/api/aiChat.ts`
- [ ] **SUB-02**: Add `unsubscribeFromFileOperations()` wrapper using `windowRemoveAllListeners(AI_FILE_OPERATION)`
- [ ] **SUB-03**: Handler receives typed `FileOperationRecord` (no `any` casts)

**File:** `src/views/api/aiChat.ts`

### In-Chat Operation Badges

- [ ] **BADGE-01**: Display color-coded inline badges in AiChatBox.vue for each file operation record
- [ ] **BADGE-02**: Badge shows: operation type icon (create/overwrite/edit), file path (basename), success/failure indicator
- [ ] **BADGE-03**: Failed operations show error message in badge
- [ ] **BADGE-04**: Operation type colors: green for create, yellow for overwrite, blue for edit, red for failed
- [ ] **BADGE-05**: Records are correlated to the correct assistant message via `conversationId`

**File:** `src/views/components/aiChat/AiChatBox.vue` (or relevant chat component)

### Expandable Diff Preview

- [ ] **DIFF-01**: Edit operation badges include a collapsible diff section showing unified diff lines
- [ ] **DIFF-02**: Diff lines are color-coded: green for additions, red for deletions
- [ ] **DIFF-03**: Diff data sourced from `FileEditResult.diff` already computed by `FileToolService`

### Click-to-Open File

- [ ] **OPEN-01**: Clicking an operation badge opens the file in the system default editor
- [ ] **OPEN-02**: Uses `shell.openPath(filePath)` via a new IPC handler or existing pattern
- [ ] **OPEN-03**: Badge has cursor pointer and hover state to indicate clickability

## Internationalization

### Translations

- [ ] **I18N-01**: Add `fileOperations` namespace to `src/views/lang/en.ts` with all keys: operation labels, status text, error messages, tooltip text
- [ ] **I18N-02**: Add matching translations to `src/views/lang/zh.ts`
- [ ] **I18N-03**: Add matching translations to `src/views/lang/es.ts`
- [ ] **I18N-04**: Add matching translations to `src/views/lang/fr.ts`
- [ ] **I18N-05**: Add matching translations to `src/views/lang/de.ts`
- [ ] **I18N-06**: Add matching translations to `src/views/lang/ja.ts`
- [ ] **I18N-07**: All user-facing text uses `t('fileOperations.key')` with English fallback pattern

**Files:** `src/views/lang/{en,zh,es,fr,de,ja}.ts`

---

## Future Requirements (Deferred)

### Database Persistence

- **PERS-01**: Persist FileOperationRecord to SQLite via Entity/Model/Module architecture
- **PERS-02**: Add history view showing past sessions' file operations
- **PERS-03**: Add filters by operation type, date range, success state

### Grouped Operation Display

- **GRP-01**: Group consecutive file operations under a collapsible "N file operations" summary
- **GRP-02**: Show operation count per assistant message

### Delete Tracking

- **DEL-01**: Track `file_delete` operations when a delete tool is added to FileToolService

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Database persistence | In-memory only for v1.1; reduces complexity. Add if users demand history |
| Full rollback/undo system | Requires content snapshots and reverse-apply engine; massive scope creep |
| Recording read-only operations | file_read, glob_files, grep_files are not mutations; recording them adds noise |
| Separate operation history panel | Inline badges in chat are the right UX; separate panel splits attention |
| Rate limiting record emission | Upstream rate limiter in ToolExecutor already prevents floods |
| `file_delete` tracking | No `file_delete` tool exists yet; defer until tool is added |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TYPE-01 | Phase 5 | Pending |
| TYPE-02 | Phase 5 | Pending |
| TYPE-03 | Phase 5 | Pending |
| TRAK-01 | Phase 5 | Pending |
| TRAK-02 | Phase 5 | Pending |
| TRAK-03 | Phase 5 | Pending |
| TRAK-04 | Phase 5 | Pending |
| TRAK-05 | Phase 5 | Pending |
| IPC-01 | Phase 5 | Pending |
| EXEC-01 | Phase 6 | Pending |
| EXEC-02 | Phase 6 | Pending |
| EXEC-03 | Phase 6 | Pending |
| EXEC-04 | Phase 6 | Pending |
| EXEC-05 | Phase 6 | Pending |
| EXEC-06 | Phase 6 | Pending |
| PREL-01 | Phase 6 | Pending |
| INIT-01 | Phase 6 | Pending |
| INIT-02 | Phase 6 | Pending |
| SUB-01 | Phase 7 | Pending |
| SUB-02 | Phase 7 | Pending |
| SUB-03 | Phase 7 | Pending |
| BADGE-01 | Phase 7 | Pending |
| BADGE-02 | Phase 7 | Pending |
| BADGE-03 | Phase 7 | Pending |
| BADGE-04 | Phase 7 | Pending |
| BADGE-05 | Phase 7 | Pending |
| DIFF-01 | Phase 7 | Pending |
| DIFF-02 | Phase 7 | Pending |
| DIFF-03 | Phase 7 | Pending |
| OPEN-01 | Phase 7 | Pending |
| OPEN-02 | Phase 7 | Pending |
| OPEN-03 | Phase 7 | Pending |
| I18N-01 | Phase 8 | Pending |
| I18N-02 | Phase 8 | Pending |
| I18N-03 | Phase 8 | Pending |
| I18N-04 | Phase 8 | Pending |
| I18N-05 | Phase 8 | Pending |
| I18N-06 | Phase 8 | Pending |
| I18N-07 | Phase 8 | Pending |

**Coverage:**
- v1.1 requirements: 39 total
- Mapped to phases: 39
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-25*
*Last updated: 2026-05-25 after initial definition*

**Priority:** P0 | **Phase:** 1

Create shared input, output, progress, and error types for the Google Maps scraping workflow.

- `GoogleMapsSearchInput`: query, location, max_results, include_website, include_reviews, show_browser
- `GoogleMapsBusinessResult`: name, rating, review_count, category, address, phone, website, maps_url, place_id, hours, latitude, longitude
- `GoogleMapsSearchResult`: success, query, location, totalResults, summary, results
- `GoogleMapsProgressEvent`: requestId, status (idle/validating/launching/loading/extracting/completed/cancelled/failed/timed_out), current, total, message
- `GoogleMapsErrorResponse`: code, message

**File:** `src/entityTypes/googleMapsTypes.ts`

**Validation:**
- query is required, non-blank, trimmed
- location is required, non-blank, trimmed
- max_results defaults to 20, hard cap 50
- show_browser defaults to false

---

## FR-2: Built-In Skill Registration

**Priority:** P0 | **Phase:** 1

Register `search_google_maps_businesses` as a built-in skill in the static skillsRegistry.

- Add skill definition to `BUILT_IN_SKILLS` array in `src/config/skillsRegistry.ts`
- Use `permissionCategory: "automation"`, `source: "built-in"`, `tier: "main"`
- JSON Schema parameters matching `GoogleMapsSearchInput`
- Description clearly explains the tool returns structured business data, not raw HTML

**File:** `src/config/skillsRegistry.ts`

---

## FR-3: ToolExecutor Dispatch

**Priority:** P0 | **Phase:** 1

Add `search_google_maps_businesses` dispatch case in `ToolExecutor.executeInternal()`.

- Add new case in the switch statement (follow existing `search_yellow_pages` pattern)
- Validate and normalize input parameters
- Enforce default (20) and maximum (50) result limits
- Delegate to `GoogleMapsModule.executeSearch()`
- Return typed `GoogleMapsSearchResult`
- Rate limiting handled by existing `RateLimiterManager`

**File:** `src/service/ToolExecutor.ts`

---

## FR-4: GoogleMapsModule — Orchestration Layer

**Priority:** P0 | **Phase:** 2

Implement shared module that powers both AI skill and UI page.

- Extends `BaseModule` from `src/modules/baseModule.ts`
- `executeSearch(input: GoogleMapsSearchInput): Promise<GoogleMapsSearchResult>` — spawns child process worker, collects results
- `startSearch(input): Promise<string>` — starts async search, returns requestId
- `getProgress(requestId): GoogleMapsProgressEvent | null`
- `cancelSearch(requestId): Promise<void>` — kills child process, cleans up
- Handles worker lifecycle: spawn, message handling, error, timeout, cleanup
- Never contains Puppeteer code — delegates to worker
- Uses `child_process.fork()` (follow existing contact-extraction pattern)

**File:** `src/modules/GoogleMapsModule.ts`

---

## FR-5: Child Process Worker — Puppeteer Scraping

**Priority:** P0 | **Phase:** 2

Run Puppeteer Google Maps scraping in a child process.

- Entry point: `src/childprocess/google-maps/GoogleMapsWorker.ts`
- Opens `https://www.google.com/maps/search/{query}+{location}`
- Waits for Maps result feed to load
- Scrolls the feed until max_results reached or no new cards appear
- Opens each business card detail panel
- Extracts: name, category, rating, review_count, address, phone, website, hours, maps_url, place_id, latitude, longitude
- Normalizes and deduplicates records by place_id or name+address
- Sends progress events to parent process via `process.send()`
- Sends final structured result via `process.send()`
- NEVER accesses TypeORM, SqliteDb, or any database path
- Supports headless mode (default) and visible browser mode
- Respects cancellation messages from parent

**File:** `src/childprocess/google-maps/GoogleMapsWorker.ts`
**Config:** Add entry in `forge.config.js` build section

---

## FR-6: IPC Handlers for UI Execution

**Priority:** P0 | **Phase:** 3

Expose secure IPC paths for the UI page.

- `google-maps-search-start`: Start scraping with `GoogleMapsSearchInput`, returns requestId
- `google-maps-search-progress`: Main process sends progress events to renderer
- `google-maps-search-cancel`: Cancel running search by requestId
- `google-maps-search-result`: Main process sends final result to renderer
- Handler calls `GoogleMapsModule` methods, never accesses DB or scraper directly
- Validates all IPC inputs before processing
- Cleans up child processes on cancellation and timeout

**File:** `src/main-process/communication/googleMaps-ipc.ts`

---

## FR-7: Frontend API Wrapper

**Priority:** P0 | **Phase:** 3

Create typed API wrapper for the renderer process.

- `startGoogleMapsSearch(input): Promise<{ requestId: string }>`
- `cancelGoogleMapsSearch(requestId): Promise<void>`
- `onGoogleMapsProgress(callback): () => void` — subscribe to progress events
- `onGoogleMapsResult(callback): () => void` — subscribe to result events
- Uses `window.electronAPI` via contextBridge pattern

**File:** `src/views/api/googleMaps.ts`

---

## FR-8: Manual UI Page

**Priority:** P0 | **Phase:** 3

Add a Vue 3 + Vuetify page where users can run Google Maps scraping without AI chat.

- Search form: query (business keyword), location, max_results slider (1-50), include_website toggle, include_reviews toggle, show_browser toggle
- Start/Cancel buttons
- Progress indicator with status text and current/total counts
- Results table: name, category, rating, review_count, address, phone, website, hours, maps_url
- Copy and export buttons (CSV, JSON)
- Handles: idle, running, completed, cancelled, failed, timed_out states
- Page route discoverable from navigation

**Directory:** `src/views/pages/google-maps-scraper/`

---

## FR-9: Result Persistence

**Priority:** P1 | **Phase:** 4

Save scraped results to local history for recovery and review.

- New TypeORM entity: `GoogleMapsSearchRecord` (id, query, location, created_at, results JSON, status)
- New model: `GoogleMapsSearchRecord.model.ts` extends `BaseDb`
- New module methods in `GoogleMapsModule`: `saveSearchResult()`, `getSearchHistory()`, `deleteSearchRecord()`
- IPC handler for history listing and deletion
- Worker NEVER writes to database — main process handles persistence

**Files:** `src/entity/GoogleMapsSearchRecord.ts`, `src/model/GoogleMapsSearchRecord.model.ts`

---

## FR-10: Export (CSV + JSON)

**Priority:** P1 | **Phase:** 4

Allow users to export scraped results.

- CSV export with headers matching field names
- JSON export preserving typed fields
- Download via Electron dialog or in-browser blob
- Uses existing `papaparse` dependency for CSV generation

**File:** Logic in UI page component or utility

---

## FR-11: i18n — All 6 Languages

**Priority:** P0 | **Phase:** 3

Add translations for all user-facing text in the Google Maps scraper UI.

- English keys in `src/views/lang/en.ts` under `googleMaps` namespace
- Translations in zh.ts, es.ts, fr.ts, de.ts, ja.ts
- All labels, buttons, status messages, error messages, tooltips
- Use `t('googleMaps.key')` with English fallback pattern

**Files:** `src/views/lang/{en,zh,es,fr,de,ja}.ts`

---

## FR-12: Forge Build Configuration

**Priority:** P0 | **Phase:** 2

Register the new child process entry point in the build config.

- Add entry for `src/childprocess/google-maps/GoogleMapsWorker.ts`
- Add corresponding Vite config if needed

**File:** `forge.config.js`

---

## Non-Functional Requirements

### Security
- All IPC inputs validated before processing
- Worker never accesses database APIs directly
- `automation` permission category for AI skill
- Text sanitized before display or export
- No arbitrary browser automation exposed to AI

### Reliability
- Concurrency defaults to 1
- Delay between detail panel visits (1-2s)
- Cancellation and timeout (10 min max) clean up child processes
- Typed error codes for common failures (TIMEOUT, CANCELLED, SCRAPE_FAILED, INVALID_INPUT)

### Performance
- Default result limit 20, hard cap 50
- UI remains responsive during scraping (worker runs in child process)
- Progress events are lightweight (no HTML payload)

### Maintainability
- One module shared by AI and UI entry points
- ToolExecutor dispatch is thin (validation + delegation)
- Scraper selectors isolated in worker file
- Module designed for future data source swap (Places API)

---

## Scope Boundaries

### In Scope (v1.0)
- All FR-1 through FR-12 above

### Out of Scope
- Google Places API integration
- Campaign import of scraped results
- Marketplace/plugin installation
- Review text scraping at scale
- Higher UI hard cap (100+)
- XLSX export
- Interactive terminal sessions for the worker
