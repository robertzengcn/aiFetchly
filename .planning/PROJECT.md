# AiFetchly — AI-Powered Marketing Automation

## What This Is

An Electron desktop application (Vue 3 + TypeScript) that combines AI-powered chat, web scraping, social media automation, and email marketing for digital marketers and lead generation teams.

## Core Value

Users can discover, contact, and market to prospects across platforms using AI-assisted workflows — from finding businesses on Google Maps to generating and sending personalized email campaigns.

## Current Milestone: v1.2 Yandex Maps Business Scraper

**Goal:** Add a built-in Yandex Maps scraping capability with AI skill entry and manual UI page, using a shared YandexMapsModule and child process Puppeteer worker.

**Target features:**
- TypeScript type contracts (input, output, progress, error types) for Yandex Maps
- AI built-in skill `search_yandex_maps_businesses` in skillsRegistry
- ToolExecutor dispatch with validation and rate limiting
- YandexMapsModule orchestration layer (shared by AI and UI)
- Puppeteer child process worker for Yandex Maps scraping
- IPC handlers and frontend API wrappers
- Manual UI page with form, progress, results display, and export
- 6-language translations (en, zh, es, fr, de, ja)

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
- Google Maps Business Scraper — full feature with AI skill, UI page, and persistence (v1.0)
- File Operation Recording — tracker, ToolExecutor integration, frontend badges, translations (v1.1)
- Yandex Maps Business Scraper — AI skill, Puppeteer worker, UI page, 6-language i18n (v1.2)

### Active

<!-- Current scope. Building toward these. -->

_No active requirements — awaiting next milestone._

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Scraping arbitrary Yandex web search results — different page structure and purpose than Maps
- Marketplace/plugin installation for this capability — built-in feature, not extension
- Automatic email sending to scraped contacts — separate workflow
- Bulk review text scraping — different use case, defer to future
- Bypassing captchas or access controls — not supported
- Official Yandex Business API integration as default data source — browser scraping first, API later
- Guaranteed coverage for every Yandex Maps locale — v1 focuses on core Russian/CIS markets
- Database persistence of search results in v1.2 — results returned directly, defer persistence
- Sharing utilities with Google Maps scraper in v1 — stay separate until duplication is proven

## Context

aiFetchly is an Electron desktop app (Vue 3 + TypeScript) with an AI chat interface. The skill system supports:

- **skillsRegistry.ts**: Static registration of built-in skills with JSON Schema parameters
- **SkillExecutor.ts**: Validates input, checks permissions, executes, and audits
- **ToolExecutor.ts**: Dispatches skill execution with validation and rate limiting
- **StreamEventProcessor**: Routes AI tool calls through the skill pipeline
- **FileToolService.ts**: Handles file read/write/edit/glob/grep operations for AI tools
- **FileOperationTracker**: Records AI file mutations and emits to renderer via IPC (v1.1)
- **Child process pattern**: Workers in `src/childprocess/` perform browser automation
- **IPC pattern**: Handlers in `src/main-process/communication/` use Modules (never direct DB access)
- **Three-layer DB**: Entity → Model → Module; IPC handlers never access DB directly
- **Worker constraint**: Workers never access TypeORM, SqliteDb, or app database paths
- **i18n**: 6 languages supported via `src/views/lang/{en,zh,es,fr,de,ja}.ts`
- **Google Maps Scraper**: Established pattern for business scraping with shared module, child process worker, AI skill, and UI page (v1.0)

Permission categories: `pure`, `network`, `filesystem`, `automation`.

For Yandex Maps scraping, the architecture mirrors the Google Maps scraper pattern: YandexMapsModule serves as the shared orchestration layer, with AI skill entry via skillsRegistry → ToolExecutor, and UI entry via IPC handler → YandexMapsModule. The Puppeteer worker runs in a child process under `src/childprocess/yandex-maps/`. This is NOT an extension of the existing Yandex web search scraper — Yandex Maps has different page structure, result model, localized data format, detail panel behavior, and anti-bot profile.

## Constraints

- **Tech stack**: TypeScript 5.x, Electron main process, Vue 3 + Vuetify frontend
- **No database persistence in v1.2**: Results returned directly, no new entities
- **No direct DB writes in IPC handlers**: Follow Model/Module architecture if persistence added later
- **Worker never accesses database**: Child process communicates via IPC messages only
- **Separate from Yandex web search**: Different page structure, selectors, anti-bot profile
- **Puppeteer browser scraping only in v1**: Official Yandex API deferred
- **Translations**: All 6 languages required for any user-facing text
- **Same hard cap (50) for AI and UI**: Consistent limits, avoids user confusion

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Interception at ToolExecutor level | Central dispatch point for all AI tool calls; single place to emit records | ✓ Good |
| No database persistence in v1.1 | Reduces complexity; in-memory tracking sufficient for initial UX validation | ✓ Good |
| FileOperationTracker as static service | Matches existing service patterns (RateLimiterManager); easy to call from ToolExecutor | ✓ Good |
| Read-only operations excluded | No mutation = no user confusion; reduces noise in the operation feed | ✓ Good |
| Emit on both success and failure | Users need to know when AI attempted but failed to change a file | ✓ Good |
| Shared GoogleMapsModule for AI and UI | One orchestration layer, two entry points. Avoids duplication, ensures consistent behavior | ✓ Good |
| `automation` permission category (not new category) | Google Maps scraping fits existing automation risk profile; no new permission flow needed | ✓ Good |
| Puppeteer browser scraping only in v1 | Fastest to integrate with existing patterns; Places API can be added later | ✓ Good |
| Same hard cap (50) for AI and UI | Simpler reasoning, consistent limits, avoids user confusion | ✓ Good |
| Save results to local history | Users expect to recover results later; entity + model + module pattern | ✓ Good |
| CSV + JSON export only | Covers most marketing workflow needs; XLSX deferred | ✓ Good |
| Worker never accesses database | Follows established architecture; main process handles all persistence | ✓ Good |
| Shared YandexMapsModule for AI and UI | Mirrors Google Maps pattern; one orchestration layer, two entry points | ✓ Good |
| Separate from Yandex web search scraper | Different page structure, result model, anti-bot profile; reuse would add complexity | ✓ Good |
| `automation` permission for Yandex Maps skill | Same category as Google Maps; consistent permission model | ✓ Good |
| No persistence in v1.2 | Results returned directly; reduces scope; persistence deferred | ✓ Good |

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
*Last updated: 2026-05-26 after milestone v1.2 completion*
