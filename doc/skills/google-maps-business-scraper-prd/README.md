# PRD: Google Maps Business Scraper Built-In Skill and UI

**Version:** 1.0 | **Date:** 2026-05-23 | **Status:** Draft

---

## 1. Overview

### 1.1 Problem Statement

aiFetchly users need a way to collect structured local business information
from Google Maps for marketing and lead generation workflows. Today, this
capability does not exist as either an AI-callable skill or a direct user-facing
workflow.

Users should be able to start the same Google Maps scraping function in two
ways:

- by asking AI to run a built-in skill
- by opening a UI page and starting the scrape manually without chatting with AI

### 1.2 Product Goal

Add a built-in Google Maps scraping capability that extracts structured business
data by keyword and location, with a dedicated UI page for manual operation.

### 1.3 Core Principle

The scraping engine should be shared. AI chat and the UI page are two entry
points into the same typed `GoogleMapsModule` workflow.

---

## 2. Scope

### In Scope

- AI-callable built-in skill: `search_google_maps_businesses`
- manual UI page for users to run Google Maps scraping without AI
- Puppeteer-based Google Maps scraper running in a child process
- strict TypeScript input and result contracts
- progress, timeout, and cancellation handling
- conservative rate limits and result caps
- structured result display in the UI
- optional export of results from the UI

### Out of Scope (v1)

- marketplace/plugin installation for this capability
- generic arbitrary browser automation exposed to AI
- automatic email sending to scraped contacts
- scraping review text at scale
- new persistent database tables unless required by the UI implementation
- Google Places API integration as the default data source

---

## 3. Users and Use Cases

### 3.1 Primary Users

- marketing users researching local businesses
- sales users building lead lists
- operators validating Google Maps scraping behavior
- AI chat users asking aiFetchly to find businesses by category and location

### 3.2 User Stories

1. As a user, I want to enter a business keyword and location in a UI page so I
   can scrape Google Maps without using AI chat.
2. As a user, I want to ask AI to find businesses in Google Maps and receive
   structured results in chat.
3. As a user, I want to see scraping progress, errors, and completion status so
   I understand whether the task is still running.
4. As a user, I want to export scraped businesses so I can use them in marketing
   workflows.
5. As a product owner, I want browser automation gated by a dedicated permission
   category and conservative limits.

---

## 4. Functional Requirements

### FR-1: Shared Google Maps Workflow

Create a shared `GoogleMapsModule` that powers both the AI skill and the UI page.

Acceptance criteria:

- accepts a typed search request
- validates query, location, and result limits
- starts a child process worker for Puppeteer scraping
- returns structured results using a stable output contract
- does not put scraping logic in `skillsRegistry.ts` or UI components

### FR-2: AI Built-In Skill

Register `search_google_maps_businesses` as a built-in skill.

Acceptance criteria:

- defined in `src/config/skillsRegistry.ts`
- uses `permissionCategory: "automation"`
- delegates execution to `ToolExecutor`
- uses strict JSON Schema parameters
- returns clean JSON results, not raw HTML

Recommended metadata:

```typescript
{
  name: "search_google_maps_businesses",
  tier: "main",
  permissionCategory: "automation",
  source: "built-in",
  requiresConfirmation: false
}
```

### FR-3: ToolExecutor Dispatch

Add `search_google_maps_businesses` dispatch in `ToolExecutor`.

Acceptance criteria:

- validates normalized input before invoking the module
- enforces default and maximum result limits
- applies Google Maps specific rate limiting
- returns typed success and error payloads
- does not directly access UI state

### FR-4: Manual UI Page

Add a UI page where users can start Google Maps scraping without AI chat.

Acceptance criteria:

- page is discoverable from navigation or the relevant marketing/search section
- form fields include `query`, `location`, `max_results`, and optional toggles
- user can choose whether to show the browser for debugging
- page displays running progress and final results
- page handles empty results, validation errors, scraper failures, and timeout
- page can run without an active AI conversation

Suggested UI route:

```text
src/views/pages/google-maps-scraper/
```

Suggested UI fields:

- business keyword or category
- target location
- maximum results
- include website
- include reviews summary, if supported
- show browser

### FR-5: IPC for UI Execution

Expose a secure IPC path for the UI page to start, monitor, cancel, and receive
Google Maps scraping results.

Acceptance criteria:

- IPC handler lives under `src/main-process/communication/`
- handler calls `GoogleMapsModule`, not the database or scraper directly
- frontend API wrapper lives under `src/views/api/`
- progress events include a request ID
- cancellation and timeout clean up child processes

### FR-6: Worker-Based Scraping

Run Puppeteer work in a child process under `src/childprocess/`.

Acceptance criteria:

- worker performs browser automation only
- worker never accesses TypeORM, `SqliteDb`, or app database paths
- worker sends progress and final results to the main process
- main process owns persistence if persistence is added later

### FR-7: Results Display and Export

Display structured business results in the UI.

Acceptance criteria:

- results table includes name, category, rating, review count, address, phone,
  website, hours, and Google Maps URL when available
- user can copy or export results
- duplicates are normalized before display
- export preserves typed fields rather than human-only formatted text

### FR-8: Optional Persistence

For v1, the workflow may return results directly without new database tables.
Add persistence only if required for history, export recovery, or campaign
handoff.

Acceptance criteria if persistence is added:

- database logic lives in Model and Module classes
- IPC handlers do not use TypeORM repositories directly
- worker process does not write to the database

---

## 5. Input and Output Contracts

### 5.1 Input

```typescript
type GoogleMapsSearchInput = {
  query: string;
  location: string;
  max_results?: number;
  include_website?: boolean;
  include_reviews?: boolean;
  show_browser?: boolean;
};
```

Validation rules:

- `query` is required and must not be blank
- `location` is required and must not be blank
- default `max_results` is 20
- AI-invoked hard cap is 50
- UI hard cap should default to 50 unless product policy raises it later
- `show_browser` defaults to false

### 5.2 Output

```typescript
type GoogleMapsBusinessResult = {
  name: string;
  rating?: string;
  review_count?: number;
  category?: string;
  address?: string;
  phone?: string;
  website?: string;
  maps_url?: string;
  place_id?: string;
  hours?: string;
  latitude?: number;
  longitude?: number;
};

type GoogleMapsSearchResult = {
  success: boolean;
  query: string;
  location: string;
  totalResults: number;
  summary: string;
  results: GoogleMapsBusinessResult[];
};
```

---

## 6. User Experience Requirements

### 6.1 Manual UI Flow

1. User opens the Google Maps scraper page.
2. User enters keyword and location.
3. User sets maximum results and optional flags.
4. User clicks start.
5. UI shows running status and progress.
6. UI displays results as cards or a table.
7. User copies or exports results.

### 6.2 AI Chat Flow

1. User asks AI to search Google Maps for businesses.
2. AI invokes `search_google_maps_businesses`.
3. Skill execution runs through `SkillExecutor` and `ToolExecutor`.
4. AI receives structured results.
5. AI summarizes and presents the data to the user.

### 6.3 Progress States

The UI should support these states:

- idle
- validating input
- launching browser worker
- loading Google Maps results
- extracting business cards
- extracting detail panel data
- completed
- cancelled
- failed
- timed out

---

## 7. Technical Architecture

Recommended execution flow:

```text
AI entry:
skillsRegistry.ts
  -> SkillExecutor
  -> ToolExecutor
  -> GoogleMapsModule
  -> childprocess Google Maps worker
  -> structured result

UI entry:
Vue page
  -> views/api wrapper
  -> IPC handler
  -> GoogleMapsModule
  -> childprocess Google Maps worker
  -> progress events + structured result
```

Recommended file placement:

- `src/entityTypes/googleMapsTypes.ts`: shared input, output, progress, and error types.
- `src/config/skillsRegistry.ts`: AI built-in skill metadata and delegation.
- `src/config/aiTools.config.ts`: AI tool definition if required by the active tool list.
- `src/service/ToolExecutor.ts`: skill dispatch, validation, result caps, and rate limiting.
- `src/modules/GoogleMapsModule.ts`: orchestration layer shared by AI and UI.
- `src/childprocess/google-maps/GoogleMapsWorker.ts`: Puppeteer worker.
- `src/main-process/communication/googleMaps-ipc.ts`: UI IPC handlers.
- `src/views/api/googleMaps.ts`: frontend API wrapper.
- `src/views/pages/google-maps-scraper/`: Vue UI page and local components.
- `src/views/router`: add route if the app uses explicit route registration.
- `src/views/lang/{en,zh,es,fr,de,ja}.ts`: translations for all user-facing text.

---

## 8. Scraping Behavior

Basic scraping flow:

1. Open `https://www.google.com/maps/search/{query}+{location}`.
2. Wait for the Maps result feed.
3. Scroll the feed until `max_results` is reached or no new cards appear.
4. Open each business card detail panel.
5. Extract business fields.
6. Normalize and deduplicate records.
7. Return structured JSON.

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

### Reliability

- concurrency defaults to 1
- add delay between detail panel visits
- support cancellation and timeout
- return typed error codes for common failures
- clean up browser and child process resources

### Performance

- default result limit is 20
- hard cap is 50 for v1
- UI should remain responsive during scraping
- progress events should be lightweight

### Maintainability

- share one module between AI and UI entry points
- keep `ToolExecutor` thin where practical
- keep scraper selectors isolated in the worker
- design `GoogleMapsModule` so a future Places API source can be added

---

## 10. Future Data Source Option

The module should allow a future official API implementation:

```typescript
type GoogleMapsDataSource = "browser_scrape" | "places_api";
```

Browser scraping is the v1 path because it is fastest to integrate with existing
Puppeteer patterns. Google Places API is a future option for stability,
compliance, and production-critical workloads.

---

## 11. Test Strategy

### Unit Tests

- input validation
- result normalization and deduplication
- `ToolExecutor` dispatch
- IPC request validation
- progress event mapping

### Integration Tests

- UI API wrapper to IPC handler
- `GoogleMapsModule` worker lifecycle
- cancellation and timeout handling

### Manual QA

- run a simple query such as `dentist` in `New York`
- verify result count cap
- verify browser cleanup after completion
- verify cancelled job does not keep a worker alive
- verify AI and UI entry points return the same result shape

---

## 12. Milestones

### Milestone 1: Contracts and Skill Registration

- create `googleMapsTypes.ts`
- add built-in skill registration
- add AI tool definition if needed
- add `ToolExecutor` dispatch stub

### Milestone 2: Module and Worker

- implement `GoogleMapsModule`
- implement child process worker
- implement progress, timeout, and cancellation
- normalize output

### Milestone 3: UI Page

- add frontend API wrapper
- add IPC handlers
- add Vue page and navigation
- add translations for all supported languages

### Milestone 4: Validation and Polish

- add unit/integration tests
- verify manual UI flow
- verify AI chat flow
- tune limits and error messages

---

## 13. Open Questions

1. Should scraped results be saved to local history in v1, or only returned for
   immediate export?
2. Which export formats should ship first: CSV, JSON, or both?
3. Should UI-triggered scraping use the same hard cap as AI-triggered scraping?
4. Should users be able to import results directly into an existing campaign in
   v1, or should that be a later milestone?
5. Should Google Places API support be planned immediately behind a config flag,
   or deferred until scraping reliability becomes a production issue?

