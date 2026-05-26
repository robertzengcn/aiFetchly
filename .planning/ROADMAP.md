# Roadmap: AiFetchly

## Milestones

- [x] **v1.0 Google Maps Business Scraper** - Phases 1-4 (shipped 2026-05-23)
- [x] **v1.1 AI Chat File Operation Recording** - Phases 5-8 (shipped 2026-05-25)
- [x] **v1.2 Yandex Maps Business Scraper** - Phases 9-12 (shipped 2026-05-26) — [Archive](.planning/milestones/v1.2-REQUIREMENTS.md)

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

<details>
<summary>v1.2 Yandex Maps Business Scraper (Phases 9-12) - SHIPPED 2026-05-26</summary>

- [x] Phase 9: Type Contracts and Skill Registration (2/2 plans) - completed 2026-05-26
- [x] Phase 10: Module and Worker Implementation (3/3 plans) - completed 2026-05-26
- [x] Phase 11: UI Page and Integration (2/2 plans) - completed 2026-05-26
- [x] Phase 12: Translations and Validation (1/1 plan) - completed 2026-05-26

</details>

## Backlog

### Phase 999.1: Follow-up — Phase 6 incomplete plans (BACKLOG)

**Goal:** Resolve plans that ran without producing summaries during Phase 6 execution
**Source phase:** 6
**Deferred at:** 2026-05-25 during /gsd-next advancement to Phase 8
**Plans:**
- [ ] 06-01: Thread conversationId through ToolExecutor (ran, no SUMMARY.md)
- [ ] 06-02: Add AI_FILE_OPERATION to preload whitelist, init tracker (ran, no SUMMARY.md)

## Progress

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
| 9. Type Contracts and Skill Registration | v1.2 | 2/2 | Complete | 2026-05-26 |
| 10. Module and Worker Implementation | v1.2 | 3/3 | Complete | 2026-05-26 |
| 11. UI Page and Integration | v1.2 | 2/2 | Complete | 2026-05-26 |
| 12. Translations and Validation | v1.2 | 1/1 | Complete | 2026-05-26 |
