# Roadmap: AiFetchly

## Milestones

- [x] **v1.0 Google Maps Business Scraper** - Phases 1-4 (shipped 2026-05-23)
- [x] **v1.1 AI Chat File Operation Recording** - Phases 5-8 (shipped 2026-05-25)
- [ ] **v1.2 Yandex Maps Business Scraper** - Phases 9-12 (in progress)

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

<details>
<summary>v1.1 AI Chat File Operation Recording (Phases 5-8) - SHIPPED 2026-05-25</summary>

- [x] Phase 5: Types and Tracker Foundation (1/1 plans) - completed 2026-05-25
- [x] Phase 6: Backend Integration (2/2 plans) - completed 2026-05-25
- [x] Phase 7: Frontend Badges and UI (2/2 plans) - completed 2026-05-25
- [x] Phase 8: Translations and Polish (1/1 plan) - completed 2026-05-25

</details>

### v1.2 Yandex Maps Business Scraper (In Progress)

**Milestone Goal:** Users can discover businesses on Yandex Maps via AI chat skill or manual UI page, with Puppeteer-based scraping, progress reporting, and export.

- [ ] **Phase 9: Type Contracts and Skill Registration** - Typed contracts for Yandex Maps input/output/progress/error, plus AI skill registration and dispatch
- [ ] **Phase 10: Module and Worker Implementation** - YandexMapsModule orchestration layer and Puppeteer child process worker
- [ ] **Phase 11: UI Page and Integration** - IPC handlers, frontend API, manual UI page with form/progress/results/export, navigation route (1/2 complete)
- [ ] **Phase 12: Translations and Validation** - 6-language i18n for all Yandex Maps UI text

## Phase Details

### Phase 9: Type Contracts and Skill Registration
**Goal**: The AI system recognizes `search_yandex_maps_businesses` as a built-in skill with typed input/output contracts, and ToolExecutor can validate and dispatch calls with rate limiting and result caps.
**Depends on**: Phase 8 (v1.1 shipped)
**Requirements**: TYPE-01, TYPE-02, TYPE-03, TYPE-04, TYPE-05, SKILL-01, SKILL-02
**Success Criteria** (what must be TRUE):
  1. YandexMapsSearchInput type compiles with all fields (query, location, max_results, include_website, include_reviews, language, region, show_browser) and TypeScript enforces the shape
  2. YandexMapsBusinessResult type compiles with all business fields (name, rating, review_count, category, address, phone, website, maps_url, yandex_id, hours, lat/lng)
  3. Progress event types cover all scraping states (idle, validating, launching, loading, extracting, completed, cancelled, failed, captcha, timeout) and error codes cover captcha, timeout, no results, network failure, layout change, cancelled
  4. `search_yandex_maps_businesses` appears in the skillsRegistry with `automation` permission category and valid JSON Schema parameters
  5. ToolExecutor dispatches the skill with input validation, enforces rate limiting, and rejects requests exceeding the 50-result hard cap
**Plans**: 2 plans

Plans:
- [ ] 11-01-PLAN.md -- IPC handlers, channel constants, preload whitelist, module progress callback adaptation
- [ ] 11-02-PLAN.md -- Frontend API wrapper, Vue UI page with form/progress/results/export, navigation route

Plans:
- [x] 09-01-PLAN.md -- Type contracts (input/output/progress/error types and constants)
- [ ] 09-02-PLAN.md -- Skill registration and ToolExecutor dispatch with validation and rate limiting

### Phase 10: Module and Worker Implementation
**Goal**: YandexMapsModule orchestrates a Puppeteer child process worker that scrapes Yandex Maps business listings, reports progress, handles cancellation/timeout, detects captcha states, and returns deduplicated results with Cyrillic text preserved.
**Depends on**: Phase 9
**Requirements**: MOD-01, MOD-02, MOD-03, MOD-04, MOD-05
**Success Criteria** (what must be TRUE):
  1. YandexMapsModule exposes methods to start a search, monitor progress, and cancel an in-progress scrape, usable from both AI skill and UI entry points
  2. Puppeteer child process worker opens Yandex Maps search, scrolls through result listings, extracts detail panel data (name, rating, phone, address, website, hours, coordinates), and returns structured results
  3. Progress events are emitted at each scraping stage (validating, launching, loading, extracting) and the worker responds to cancellation signals from the main process
  4. When Yandex presents a captcha or access challenge, the worker detects it and returns a typed error with captcha error code instead of hanging or producing garbage data
  5. Returned results are normalized (trimmed whitespace, consistent field casing) and deduplicated by yandex_id, with Cyrillic text preserved without corruption
**Plans**: 3 plans

Plans:
- [ ] 10-01-PLAN.md -- YandexMapsModule orchestration layer and build infrastructure (forge config, vite config)
- [ ] 10-02-PLAN.md -- YandexMapsWorker child process with Puppeteer scraping loop, captcha detection, progress, deduplication
- [ ] 10-03-PLAN.md -- Wire ToolExecutor to real YandexMapsModule, replace Phase 9 stub

### Phase 11: UI Page and Integration
**Goal**: Users can search for Yandex Maps businesses through a manual UI page, see real-time scraping progress, view results in a table, and copy or export them.
**Depends on**: Phase 10
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-06
**Success Criteria** (what must be TRUE):
  1. IPC handlers for start, monitor, cancel, and get-results are registered under src/main-process/communication/ and call YandexMapsModule methods
  2. Frontend API wrapper in src/views/api/ exposes typed methods for all Yandex Maps IPC operations
  3. User can fill a form with query, location, max_results, and toggles (include_website, include_reviews, show_browser), submit it, and see real-time progress updates during scraping
  4. Completed search results appear in a table showing business name, rating, category, address, phone, and website, with working copy and export buttons (CSV and JSON)
  5. Yandex Maps scraper page is accessible from the application navigation menu
**Plans**: 2 plans

Plans:
- [x] 11-01-PLAN.md -- IPC handlers, channel constants, preload whitelist, module progress callback adaptation
- [ ] 11-02-PLAN.md -- Frontend API wrapper, Vue UI page with form/progress/results/export, navigation route
**UI hint**: yes

### Phase 12: Translations and Validation
**Goal**: All Yandex Maps UI text is translated and displayed correctly in all 6 supported languages, and the full feature works end-to-end.
**Depends on**: Phase 11
**Requirements**: UI-05
**Success Criteria** (what must be TRUE):
  1. English translation keys exist under a `yandexMaps` namespace in en.ts covering all form labels, button text, progress states, error messages, column headers, and export labels
  2. Matching translations exist in all 5 other language files (zh, es, fr, de, ja) with the same key structure
  3. All user-facing text in the Yandex Maps UI uses `t('yandexMaps.key')` with English fallback
**Plans**: 2 plans

Plans:
- [ ] 11-01-PLAN.md -- IPC handlers, channel constants, preload whitelist, module progress callback adaptation
- [ ] 11-02-PLAN.md -- Frontend API wrapper, Vue UI page with form/progress/results/export, navigation route
**UI hint**: yes

## Backlog

### Phase 999.1: Follow-up — Phase 6 incomplete plans (BACKLOG)

**Goal:** Resolve plans that ran without producing summaries during Phase 6 execution
**Source phase:** 6
**Deferred at:** 2026-05-25 during /gsd-next advancement to Phase 8
**Plans:**
- [ ] 06-01: Thread conversationId through ToolExecutor (ran, no SUMMARY.md)
- [ ] 06-02: Add AI_FILE_OPERATION to preload whitelist, init tracker (ran, no SUMMARY.md)

## Progress

**Execution Order:**
Phases execute in numeric order: 9 -> 10 -> 11 -> 12

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Type Contracts and Skill Registration | v1.0 | 3/3 | Complete | 2026-05-23 |
| 2. Module and Worker Implementation | v1.0 | 2/2 | Complete | 2026-05-23 |
| 3. UI Page and Integration | v1.0 | 2/2 | Complete | 2026-05-23 |
| 4. Persistence, Export, and Validation | v1.0 | 1/1 | Complete | 2026-05-23 |
| 5. Types and Tracker Foundation | v1.1 | 1/1 | Complete | 2026-05-25 |
| 6. Backend Integration | v1.1 | 2/2 | Complete | 2026-05-25 |
| 7. Frontend Badges and UI | v1.1 | 2/2 | Complete | 2026-05-25 |
| 8. Translations and Polish | v1.1 | 1/1 | Complete | 2026-05-25 |
| 9. Type Contracts and Skill Registration | v1.2 | 1/2 | In progress | - |
| 10. Module and Worker Implementation | v1.2 | 0/3 | Not started | - |
| 11. UI Page and Integration | v1.2 | 1/2 | In progress | - |
| 12. Translations and Validation | v1.2 | 0/? | Not started | - |
