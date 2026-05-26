# PRD: Yandex Maps Business Scraper Built-In Skill and UI

**Version:** 1.0 | **Date:** 2026-05-25 | **Status:** Draft

---

## 1. Overview

### 1.1 Problem Statement

aiFetchly users need a way to collect structured local business information from
Yandex Maps for marketing, sales prospecting, and regional market research.
Google Maps coverage is strong globally, but Yandex Maps is often more useful for
Russia, CIS countries, and other markets where Yandex has richer local listings.

Users should be able to start the same Yandex Maps scraping function in two
ways:

- by asking AI to run a built-in skill
- by opening a UI page and starting the scrape manually without chatting with AI

### 1.2 Product Goal

Add a built-in Yandex Maps scraping capability that extracts structured business
data by keyword and location, with a dedicated UI page for manual operation and a
shared typed workflow for AI tool execution.

### 1.3 Core Principle

The scraping engine should be shared. AI chat and the UI page are two entry
points into the same typed `YandexMapsModule` workflow.

This feature is not an extension of the existing Yandex web search scraper.
Yandex Maps has a different page structure, result model, localized data format,
detail panel behavior, and anti-bot profile.

---

## 2. Scope

### In Scope

- AI-callable built-in skill: `search_yandex_maps_businesses`
- manual UI page for users to run Yandex Maps scraping without AI
- Puppeteer-based Yandex Maps scraper running in a child process
- strict TypeScript input and result contracts
- progress, timeout, and cancellation handling
- conservative rate limits and result caps
- structured result display in the UI
- optional export of results from the UI
- optional local search history if required by UI or campaign handoff

### Out of Scope (v1)

- scraping arbitrary Yandex web search results
- marketplace/plugin installation for this capability
- generic arbitrary browser automation exposed to AI
- automatic email sending to scraped contacts
- bulk review text scraping
- bypassing captchas or access controls
- guaranteed coverage for every Yandex Maps locale
- official Yandex Business API integration as the default data source

---

## 3. Users and Use Cases

### 3.1 Primary Users

- marketing users researching local businesses in Yandex-heavy regions
- sales users building lead lists by business category and city
- operators validating Yandex Maps scraping behavior
- AI chat users asking aiFetchly to find businesses by category and location

### 3.2 User Stories

1. As a user, I want to enter a business keyword and location in a UI page so I
   can scrape Yandex Maps without using AI chat.
2. As a user, I want to ask AI to find businesses in Yandex Maps and receive
   structured results in chat.
3. As a user, I want the scraper to support localized business names, addresses,
   and categories so that Cyrillic and non-English listings remain usable.
4. As a user, I want to see scraping progress, errors, and completion status so
   I understand whether the task is still running.
5. As a user, I want to export scraped businesses so I can use them in marketing
   workflows.
6. As a product owner, I want browser automation gated by a dedicated permission
   category and conservative limits.

---

## 4. Functional Requirements

### FR-1: Shared Yandex Maps Workflow

Create a shared `YandexMapsModule` that powers both the AI skill and the UI page.

Acceptance criteria:

- accepts a typed search request
- validates query, location, language, region, and result limits
- starts a child process worker for Puppeteer scraping
- returns structured results using a stable output contract
- does not put scraping logic in `skillsRegistry.ts` or UI components
- does not reuse the existing Yandex web search scraper as the Maps scraper

### FR-2: AI Built-In Skill

Register `search_yandex_maps_businesses` as a built-in skill.

Acceptance criteria:

- defined in `src/config/skillsRegistry.ts`
- uses `permissionCategory: "automation"`
- delegates execution to `ToolExecutor`
- uses strict JSON Schema parameters
- returns clean JSON results, not raw HTML
- supports the same core fields as the Google Maps business scraper where
  Yandex data is available

Recommended metadata:

```typescript
{
  name: "search_yandex_maps_businesses",
  tier: "main",
  permissionCategory: "automation",
  source: "built-in",
  requiresConfirmation: false
}
```

### FR-3: ToolExecutor Dispatch

Add `search_yandex_maps_businesses` dispatch in `ToolExecutor`.

Acceptance criteria:

- validates normalized input before invoking the module
- enforces default and maximum result limits
- applies Yandex Maps specific rate limiting
- returns typed success and error payloads
- does not directly access UI state
- provides clear validation errors for missing `query` or `location`

### FR-4: Manual UI Page

Add a UI page where users can start Yandex Maps scraping without AI chat.

Acceptance criteria:

- page is discoverable from navigation or the relevant marketing/search section
- form fields include `query`, `location`, `max_results`, and optional toggles
- user can choose whether to show the browser for debugging
- page displays running progress and final results
- page handles empty results, validation errors, scraper failures, captchas, and
  timeout
- page can run without an active AI conversation
- all user-facing UI text has translations in all supported language files

Suggested UI route:

```text
src/views/pages/yandex-maps-scraper/
```

Suggested UI fields:

- business keyword or category
- target location
- maximum results
- include website
- include reviews summary, if supported
- language or locale, defaulting to auto
- show browser

### FR-5: IPC for UI Execution

Expose a secure IPC path for the UI page to start, monitor, cancel, and receive
Yandex Maps scraping results.

Acceptance criteria:

- IPC handler lives under `src/main-process/communication/`
- handler calls `YandexMapsModule`, not the database or scraper directly
- frontend API wrapper lives under `src/views/api/`
- progress events include a request ID
- cancellation and timeout clean up child processes
- IPC inputs are validated before execution

### FR-6: Worker-Based Scraping

Run Puppeteer work in a child process under `src/childprocess/`.

Acceptance criteria:

- worker performs browser automation only
- worker never accesses TypeORM, `SqliteDb`, or app database paths
- worker sends progress and final results to the main process
- main process owns persistence if persistence is added
- worker supports graceful shutdown on cancellation or timeout

Suggested worker route:

```text
src/childprocess/yandex-maps/YandexMapsWorker.ts
```

### FR-7: Results Display and Export

Display structured business results in the UI.

Acceptance criteria:

- results table includes name, category, rating, review count, address, phone,
  website, hours, and Yandex Maps URL when available
- user can copy or export results
- duplicates are normalized before display
- export preserves typed fields rather than human-only formatted text
- localized text is preserved as UTF-8

### FR-8: Optional Persistence

For v1, the workflow may return results directly without new database tables.
Add persistence only if required for history, export recovery, or campaign
handoff.

Acceptance criteria if persistence is added:

- database logic lives in Model and Module classes
- IPC handlers do not use TypeORM repositories directly
- worker process does not write to the database
- results are stored as structured JSON, not rendered table text

Suggested entity if persistence is needed:

```text
src/entity/YandexMapsSearchRecord.entity.ts
src/model/YandexMapsSearchRecord.model.ts
```

---

## 5. Input and Output Contracts

### 5.1 Input

```typescript
type YandexMapsSearchInput = {
  query: string;
  location: string;
  max_results?: number;
  include_website?: boolean;
  include_reviews?: boolean;
  language?: string;
  region?: string;
  show_browser?: boolean;
};
```

Validation rules:

- `query` is required and must not be blank
- `location` is required and must not be blank
- default `max_results` is 20
- AI-invoked hard cap is 50
- UI hard cap should default to 50 unless product policy raises it later
- `include_website` defaults to true
- `include_reviews` defaults to false
- `language` is optional and should default to auto-detection
- `region` is optional and should default to auto-detection from location
- `show_browser` defaults to false

### 5.2 Output

```typescript
type YandexMapsBusinessResult = {
  name: string;
  rating?: string;
  review_count?: number;
  category?: string;
  address?: string;
  phone?: string;
  website?: string;
  maps_url?: string;
  yandex_id?: string;
  hours?: string;
  latitude?: number;
  longitude?: number;
};

type YandexMapsSearchResult = {
  success: boolean;
  query: string;
  location: string;
  totalResults: number;
  summary: string;
  results: YandexMapsBusinessResult[];
};
```

Output rules:

- return structured JSON only
- preserve localized names, categories, and addresses
- normalize phone numbers where possible, but keep original text if normalization
  is unsafe
- include source URLs so users can verify listings
- avoid returning raw HTML, screenshots, or browser internals to AI

---

## 6. User Experience Requirements

### 6.1 Manual UI Flow

1. User opens the Yandex Maps scraper page.
2. User enters keyword and location.
3. User sets maximum results and optional flags.
4. User clicks start.
5. UI shows running status and progress.
6. UI displays results as cards or a table.
7. User copies or exports results.

### 6.2 AI Chat Flow

1. User asks AI to search Yandex Maps for businesses.
2. AI invokes `search_yandex_maps_businesses`.
3. Skill execution runs through `SkillExecutor` and `ToolExecutor`.
4. AI receives structured results.
5. AI summarizes and presents the data to the user.

### 6.3 Progress States

The UI should support these states:

- idle
- validating input
- launching browser worker
- loading Yandex Maps results
- extracting business cards
- extracting detail panel data
- completed
- cancelled
- failed
- blocked by captcha or access challenge
- timed out

### 6.4 Error Messages

The UI and AI result should expose clear user-facing errors:

- missing or invalid search query
- missing or invalid location
- no results found
- Yandex Maps page layout changed
- captcha or access challenge detected
- network or proxy failure
- scraper timeout
- job cancelled by user

---

## 7. Technical Architecture

Recommended execution flow:

```text
AI entry:
skillsRegistry.ts
  -> SkillExecutor
  -> ToolExecutor
  -> YandexMapsModule
  -> childprocess Yandex Maps worker
  -> structured result

UI entry:
Vue page
  -> views/api wrapper
  -> IPC handler
  -> YandexMapsModule
  -> childprocess Yandex Maps worker
  -> progress events + structured result
```

Recommended file placement:

- `src/entityTypes/yandexMapsTypes.ts`: shared input, output, progress, and error types.
- `src/config/skillsRegistry.ts`: AI built-in skill metadata and delegation.
- `src/config/aiTools.config.ts`: AI tool definition if required by the active tool list.
- `src/service/ToolExecutor.ts`: skill dispatch, validation, result caps, and rate limiting.
- `src/modules/YandexMapsModule.ts`: orchestration layer shared by AI and UI.
- `src/childprocess/yandex-maps/YandexMapsWorker.ts`: Puppeteer worker.
- `src/main-process/communication/yandexMaps-ipc.ts`: UI IPC handlers.
- `src/views/api/yandexMaps.ts`: frontend API wrapper.
- `src/views/pages/yandex-maps-scraper/`: Vue UI page and local components.
- `src/views/router`: add route if the app uses explicit route registration.
- `src/views/lang/{en,zh,es,fr,de,ja}.ts`: translations for all user-facing text.
- `forge.config.js`: add worker entry if a dedicated worker bundle is required.
- `vite.yandexMapsWorker.config.mjs`: add worker build config if required.

---

## 8. Scraping Behavior

Basic scraping flow:

1. Open Yandex Maps with a search URL derived from `query` and `location`.
2. Wait for the Maps search results list or map result panel.
3. Scroll result list until `max_results` is reached or no new cards appear.
4. Open each business card detail panel.
5. Extract business fields.
6. Normalize and deduplicate records.
7. Return structured JSON.

The exact Yandex Maps URL format and selectors must be isolated inside the worker
so UI, IPC, and AI skill contracts remain stable even if Yandex changes its DOM.

The scraper must not return raw page HTML to AI. HTML parsing and DOM extraction
should stay inside the worker/module boundary.

---

## 9. Non-Functional Requirements

### Security

- classify the AI skill as `automation`
- validate all IPC inputs
- do not expose arbitrary browser automation
- worker must not access database APIs directly
- sanitize text before displaying or exporting
- avoid storing cookies, proxy credentials, or browser session data in result
  payloads

### Reliability

- concurrency defaults to 1
- add delay between detail panel visits
- support cancellation and timeout
- return typed error codes for common failures
- clean up browser and child process resources
- detect captcha/access challenge states and fail clearly
- selectors should be centralized so Yandex DOM changes are easier to repair

### Performance

- default result limit is 20
- hard cap is 50 for v1
- UI should remain responsive during scraping
- progress events should be lightweight
- avoid opening more detail panels than needed to reach the requested result cap

### Maintainability

- share one module between AI and UI entry points
- keep `ToolExecutor` thin where practical
- keep scraper selectors isolated in the worker
- keep Yandex Maps logic separate from generic Yandex search logic
- design `YandexMapsModule` so a future official API source can be added

### Internationalization

- UI labels, route titles, validation messages, status messages, and error
  messages must be added to all supported language files:
  `en`, `zh`, `es`, `fr`, `de`, and `ja`
- extracted listing text should preserve original language and encoding
- user-facing fallback strings should remain in English

---

## 10. Future Data Source Option

The module should allow a future official API implementation:

```typescript
type YandexMapsDataSource = "browser_scrape" | "official_api";
```

Browser scraping is the v1 path because it aligns with existing Puppeteer worker
patterns and can extract visible listing data without requiring API credentials.
An official API path should be considered later for stability, compliance, and
production-critical workloads if suitable Yandex APIs and account terms are
available.

---

## 11. Test Strategy

### Unit Tests

- input validation
- result normalization and deduplication
- localized text preservation
- `ToolExecutor` dispatch
- IPC request validation
- progress event mapping

### Integration Tests

- UI API wrapper to IPC handler
- `YandexMapsModule` worker lifecycle
- cancellation and timeout handling
- worker message parsing
- optional persistence through Module/Model if enabled

### Manual QA

- run a simple query such as `restaurant` in `Moscow`
- run a Cyrillic query such as `стоматология` in `Москва`
- verify result count cap
- verify browser cleanup after completion
- verify cancelled job does not keep a worker alive
- verify captcha/access challenge is detected and reported
- verify AI and UI entry points return the same result shape
- verify export preserves localized text correctly

---

## 12. Milestones

### Milestone 1: Contracts and Skill Registration

- create `yandexMapsTypes.ts`
- add built-in skill registration
- add AI tool definition if needed
- add `ToolExecutor` dispatch stub
- define Yandex-specific error codes and progress events

### Milestone 2: Module and Worker

- implement `YandexMapsModule`
- implement child process worker
- implement progress, timeout, and cancellation
- normalize output
- add access challenge detection

### Milestone 3: UI Page

- add frontend API wrapper
- add IPC handlers
- add Vue page and navigation
- add translations for all supported languages
- add result display and export

### Milestone 4: Validation and Polish

- add unit/integration tests
- verify manual UI flow
- verify AI chat flow
- tune limits and error messages
- document known Yandex Maps scraping limitations

---

## 13. Open Questions

1. Should scraped results be saved to local history in v1, or only returned for
   immediate export?
2. Which export formats should ship first: CSV, JSON, or both?
3. Should UI-triggered scraping use the same hard cap as AI-triggered scraping?
4. Should users be able to import results directly into an existing campaign in
   v1, or should that be a later milestone?
5. Which Yandex Maps regions and languages should be considered supported for
   v1 QA?
6. Should the initial UI expose `language` and `region`, or should those remain
   internal auto-detected options until users ask for more control?
7. Should the implementation share any utilities with the Google Maps scraper,
   or should the first version stay separate until duplication is proven?

