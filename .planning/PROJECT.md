# Google Maps Business Scraper for aiFetchly

## What This Is

A built-in Google Maps scraping capability for aiFetchly that extracts structured business data by keyword and location. Users can trigger scraping through AI chat (built-in skill) or a dedicated UI page — both powered by a shared `GoogleMapsModule` and Puppeteer-based child process worker.

## Core Value

Users can find local businesses on Google Maps and get structured data (name, phone, website, rating, address) for marketing and lead generation — whether they ask AI or use the UI directly.

## Current Milestone: v1.0 Google Maps Business Scraper

**Goal:** Add a built-in Google Maps scraping capability that extracts structured business data by keyword and location, with both AI skill and manual UI entry points.

**Target features:**
- Shared GoogleMapsModule powering both AI skill and UI page
- AI built-in skill `search_google_maps_businesses`
- Manual UI page for running Google Maps scraping without AI chat
- Puppeteer-based child process worker for scraping
- IPC handlers for UI execution, progress, and cancellation
- Structured results display with name, category, rating, address, phone, website, etc.
- Export in CSV and JSON formats
- Save scraped results to local history (new entity + model)
- All 6-language translations for UI text

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- The skill system (SkillExecutor, SkillPermissionService, skillsRegistry) is operational
- File tools (read, write, edit, glob, grep) are working with permission prompts
- StreamEventProcessor handles tool calls from AI chat
- ToolExecutor dispatches AI skill execution
- Child process pattern established (contact-extraction, yellowPagesScraper workers)
- IPC handler pattern established (contactExtraction-ipc, etc.)
- Vue 3 + Vuetify UI page pattern established
- i18n with 6 languages (en, zh, es, fr, de, ja)

### Active

<!-- Current scope. Building toward these. -->

- [ ] Create shared TypeScript types for Google Maps search input/output/progress
- [ ] Register `search_google_maps_businesses` as a built-in skill in skillsRegistry
- [ ] Add ToolExecutor dispatch for Google Maps skill with validation and rate limiting
- [ ] Implement GoogleMapsModule as orchestration layer shared by AI and UI
- [ ] Implement Puppeteer-based child process worker for Google Maps scraping
- [ ] Add IPC handlers for UI execution, progress monitoring, and cancellation
- [ ] Add frontend API wrapper for Google Maps IPC calls
- [ ] Add Vue UI page with search form, progress display, and results table
- [ ] Add navigation entry for Google Maps scraper page
- [ ] Save scraped results to local history (entity + model + module)
- [ ] Export results in CSV and JSON formats
- [ ] Add translations for all 6 supported languages

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Google Places API integration — deferred entirely; browser scraping is v1 path
- Campaign import — direct import of scraped results into campaigns deferred to later milestone
- Marketplace/plugin installation for this capability — not a plugin, it's built-in
- Generic arbitrary browser automation exposed to AI — scraping is scoped to Google Maps only
- Automatic email sending to scraped contacts — separate feature, not part of scraping
- Scraping review text at scale — v1 focuses on business listing data only
- Higher hard cap for UI (100+) — same 50 cap for both AI and UI in v1

## Context

aiFetchly is an Electron desktop app (Vue 3 + TypeScript) with an AI chat interface. The skill system supports:

- **skillsRegistry.ts**: Static registration of built-in skills with JSON Schema parameters
- **SkillExecutor.ts**: Validates input, checks permissions, executes, and audits
- **ToolExecutor.ts**: Dispatches skill execution with validation and rate limiting
- **StreamEventProcessor**: Routes AI tool calls through the skill pipeline
- **Child process pattern**: Workers in `src/childprocess/` perform browser automation, communicate results to main process via IPC
- **IPC pattern**: Handlers in `src/main-process/communication/` use Modules (never direct DB access)
- **Three-layer DB**: Entity → Model → Module; IPC handlers never access DB directly
- **Worker constraint**: Workers never access TypeORM, SqliteDb, or app database paths
- **i18n**: 6 languages supported via `src/views/lang/{en,zh,es,fr,de,ja}.ts`

Permission categories: `pure`, `network`, `filesystem`, `automation`. Google Maps skill uses `automation`.

## Constraints

- **Tech stack**: TypeScript 5.x, Electron main process, Vue 3 + Vuetify frontend, Puppeteer for scraping
- **Worker placement**: All worker code in `src/childprocess/google-maps/`
- **Database access**: Workers never access DB; main process handles persistence via Model/Module
- **IPC architecture**: Handlers call Modules, never direct DB access
- **Hard cap**: 50 results max for both AI and UI entry points
- **Concurrency**: Default 1 for scraping; delay between detail panel visits
- **Export**: CSV and JSON only in v1
- **Translations**: All 6 languages required for any user-facing text

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Shared GoogleMapsModule for AI and UI | One orchestration layer, two entry points. Avoids duplication, ensures consistent behavior | — Pending |
| `automation` permission category (not new category) | Google Maps scraping fits existing automation risk profile; no new permission flow needed | — Pending |
| Puppeteer browser scraping only in v1 | Fastest to integrate with existing patterns; Places API can be added later | — Pending |
| Same hard cap (50) for AI and UI | Simpler reasoning, consistent limits, avoids user confusion | — Pending |
| Save results to local history | Users expect to recover results later; entity + model + module pattern | — Pending |
| CSV + JSON export only | Covers most marketing workflow needs; XLSX deferred | — Pending |
| Worker never accesses database | Follows established architecture; main process handles all persistence | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-23 after milestone v1.0 initialization*
