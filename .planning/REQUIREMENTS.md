# Requirements: AiFetchly — Yandex Maps Business Scraper

**Defined:** 2026-05-25
**Core Value:** Users can discover, contact, and market to prospects across platforms using AI-assisted workflows.

## v1.2 Requirements

### Type Contracts

- [ ] **TYPE-01**: Define YandexMapsSearchInput type with query, location, max_results, include_website, include_reviews, language, region, show_browser
- [ ] **TYPE-02**: Define YandexMapsBusinessResult type with name, rating, review_count, category, address, phone, website, maps_url, yandex_id, hours, lat/lng
- [ ] **TYPE-03**: Define YandexMapsSearchResult type with success, query, location, totalResults, summary, results array
- [ ] **TYPE-04**: Define progress event types for scraping states (idle, validating, launching, loading, extracting, completed, cancelled, failed, captcha, timeout)
- [ ] **TYPE-05**: Define typed error codes for captcha, timeout, no results, network failure, layout change, cancelled

### Skill & Dispatch

- [ ] **SKILL-01**: Register search_yandex_maps_businesses in skillsRegistry with automation permission and JSON Schema parameters
- [ ] **SKILL-02**: Add ToolExecutor dispatch with input validation, rate limiting, and 50-result hard cap

### Module & Worker

- [ ] **MOD-01**: Implement YandexMapsModule as shared orchestration layer for AI and UI entry points
- [ ] **MOD-02**: Build Puppeteer child process worker for Yandex Maps scraping (open search, scroll results, extract detail panels)
- [ ] **MOD-03**: Implement progress reporting, cancellation, and timeout handling in worker
- [ ] **MOD-04**: Detect captcha/access challenge states and fail with clear typed error
- [ ] **MOD-05**: Normalize and deduplicate results, preserve localized text (Cyrillic support)

### UI & Integration

- [ ] **UI-01**: Add IPC handlers for start, monitor, cancel, and results under src/main-process/communication/
- [ ] **UI-02**: Add frontend API wrapper in src/views/api/ for Yandex Maps IPC
- [ ] **UI-03**: Build manual UI page with form (query, location, max_results, toggles), progress display, and results table
- [ ] **UI-04**: Add copy and export results from UI page (CSV + JSON)
- [ ] **UI-05**: Add translations for all 6 supported languages (en, zh, es, fr, de, ja)
- [ ] **UI-06**: Add navigation route for Yandex Maps scraper page

## Future Requirements

### Persistence

- **PERS-01**: Save Yandex Maps search results to local history with entity, model, and module
- **PERS-02**: Campaign handoff for importing scraped results into marketing campaigns
- **PERS-03**: Result recovery after app restart

### Enhanced Scraping

- **SCRP-01**: Official Yandex Business API integration as alternative data source
- **SCRP-02**: Bulk review text scraping
- **SCRP-03**: Shared utilities with Google Maps scraper (if duplication proven)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Scraping arbitrary Yandex web search results | Different page structure and purpose than Maps |
| Marketplace/plugin installation | Built-in feature, not an extension |
| Automatic email sending to scraped contacts | Separate workflow |
| Bypassing captchas or access controls | Not supported |
| Guaranteed coverage for every Yandex Maps locale | v1 focuses on core Russian/CIS markets |
| XLSX export | CSV + JSON covers most needs |
| Database persistence in v1.2 | Results returned directly, defer to future |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TYPE-01 | — | Pending |
| TYPE-02 | — | Pending |
| TYPE-03 | — | Pending |
| TYPE-04 | — | Pending |
| TYPE-05 | — | Pending |
| SKILL-01 | — | Pending |
| SKILL-02 | — | Pending |
| MOD-01 | — | Pending |
| MOD-02 | — | Pending |
| MOD-03 | — | Pending |
| MOD-04 | — | Pending |
| MOD-05 | — | Pending |
| UI-01 | — | Pending |
| UI-02 | — | Pending |
| UI-03 | — | Pending |
| UI-04 | — | Pending |
| UI-05 | — | Pending |
| UI-06 | — | Pending |

**Coverage:**
- v1.2 requirements: 20 total
- Mapped to phases: 0
- Unmapped: 20 ⚠️

---
*Requirements defined: 2026-05-25*
*Last updated: 2026-05-25 after initial definition*
