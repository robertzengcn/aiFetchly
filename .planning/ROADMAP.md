# Roadmap: v1.0 Google Maps Business Scraper

**Milestone:** v1.0 | **Status:** Draft | **Date:** 2026-05-23

---

## Phase 1: Type Contracts and Skill Registration

**Goal:** Establish typed contracts and register the AI skill so the system recognizes `search_google_maps_businesses`.

**Requirements:** FR-1, FR-2, FR-3

**Files changed:**
- `src/entityTypes/googleMapsTypes.ts` — NEW: shared types (input, output, progress, error)
- `src/config/skillsRegistry.ts` — MODIFY: add built-in skill definition
- `src/service/ToolExecutor.ts` — MODIFY: add dispatch case (stub calling GoogleMapsModule)

**Exit criteria:**
- [ ] `googleMapsTypes.ts` compiles with all types defined
- [ ] `search_google_maps_businesses` appears in `SkillRegistry.getAllToolFunctions()`
- [ ] `ToolExecutor.execute('search_google_maps_businesses', ...)` returns error "not yet implemented" (stub)
- [ ] No runtime errors from registry changes

**Risk:** Low — purely additive, no existing behavior changed.

---

## Phase 2: Module and Worker Implementation

**Goal:** Implement the scraping engine — `GoogleMapsModule` orchestrates a child process worker that scrapes Google Maps via Puppeteer.

**Requirements:** FR-4, FR-5, FR-12

**Files changed:**
- `src/modules/GoogleMapsModule.ts` — NEW: orchestration layer (extends BaseModule)
- `src/childprocess/google-maps/GoogleMapsWorker.ts` — NEW: Puppeteer worker entry point
- `forge.config.js` — MODIFY: add worker build entry

**Exit criteria:**
- [ ] `GoogleMapsModule.executeSearch()` spawns worker, receives structured results
- [ ] Worker scrapes Google Maps and returns `GoogleMapsBusinessResult[]`
- [ ] Progress events sent from worker to module
- [ ] Cancellation kills worker process and cleans up
- [ ] Timeout (10 min) kills worker process and returns error
- [ ] `ToolExecutor` dispatch now returns real results instead of stub
- [ ] AI chat can invoke `search_google_maps_businesses` and receive structured data

**Risk:** Medium — Puppeteer scraping depends on Google Maps DOM structure; selectors may break. Mitigation: isolate selectors in worker, add fallback selectors.

---

## Phase 3: UI Page and Integration

**Goal:** Add manual UI page, IPC handlers, frontend API, and translations — the complete user-facing experience.

**Requirements:** FR-6, FR-7, FR-8, FR-11

**Files changed:**
- `src/main-process/communication/googleMaps-ipc.ts` — NEW: IPC handlers
- `src/views/api/googleMaps.ts` — NEW: frontend API wrapper
- `src/views/pages/google-maps-scraper/` — NEW: Vue page + components
- `src/views/lang/en.ts` — MODIFY: add googleMaps namespace
- `src/views/lang/zh.ts` — MODIFY: add googleMaps namespace
- `src/views/lang/es.ts` — MODIFY: add googleMaps namespace
- `src/views/lang/fr.ts` — MODIFY: add googleMaps namespace
- `src/views/lang/de.ts` — MODIFY: add googleMaps namespace
- `src/views/lang/ja.ts` — MODIFY: add googleMaps namespace
- `src/views/router/` — MODIFY: add route if needed
- `src/preload.ts` — MODIFY: expose IPC channels if needed

**Exit criteria:**
- [ ] UI page renders with search form
- [ ] User can start scraping from UI, see progress, and view results table
- [ ] User can cancel a running search
- [ ] Results table shows all fields (name, category, rating, address, phone, website, etc.)
- [ ] All 6 language translations present and rendering
- [ ] Navigation entry leads to Google Maps scraper page
- [ ] Empty results, validation errors, and failures handled gracefully

**Risk:** Medium — UI integration touches preload, router, and navigation. Follow existing patterns to minimize risk.

---

## Phase 4: Persistence, Export, and Validation

**Goal:** Add result persistence, CSV/JSON export, and final validation/testing.

**Requirements:** FR-9, FR-10

**Files changed:**
- `src/entity/GoogleMapsSearchRecord.ts` — NEW: TypeORM entity
- `src/model/GoogleMapsSearchRecord.model.ts` — NEW: data access (extends BaseDb)
- `src/modules/GoogleMapsModule.ts` — MODIFY: add save/history/delete methods
- `src/main-process/communication/googleMaps-ipc.ts` — MODIFY: add history IPC handlers
- `src/views/pages/google-maps-scraper/` — MODIFY: add export buttons, history view

**Exit criteria:**
- [ ] Scraped results saved to local SQLite database
- [ ] User can view search history
- [ ] User can export results as CSV and JSON
- [ ] User can delete history records
- [ ] Unit tests for input validation, result normalization, deduplication
- [ ] Integration test for ToolExecutor dispatch
- [ ] Manual QA: search "dentist" in "New York" returns structured results

**Risk:** Low — follows established entity/model/module pattern.

---

## Dependency Graph

```
Phase 1 (types + registration)
    ↓
Phase 2 (module + worker)
    ↓
Phase 3 (UI + IPC + i18n)
    ↓
Phase 4 (persistence + export + tests)
```

Phases are strictly sequential. No parallel execution possible since each builds on the previous.

---

## Estimated Effort

| Phase | Scope | Risk |
|-------|-------|------|
| Phase 1 | 3 files, ~200 lines new | Low |
| Phase 2 | 2 files new, 1 modify, ~500 lines new | Medium |
| Phase 3 | 6+ files modify, ~600 lines new | Medium |
| Phase 4 | 3 files new, 2 modify, ~300 lines new | Low |
