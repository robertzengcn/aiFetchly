# Phase 10: Module and Worker Implementation - Research

**Researched:** 2026-05-26
**Domain:** Puppeteer child process orchestration for Yandex Maps business scraping
**Confidence:** HIGH

## Summary

Phase 10 creates two tightly coupled components: (1) a `YandexMapsModule` class in `src/modules/` that orchestrates a child process worker, manages lifecycle, timeout, cancellation, and provides a shared API for both AI skill dispatch and future UI page, and (2) a `YandexMapsWorker` child process in `src/childprocess/yandex-maps/` that performs the actual Puppeteer-based scraping of Yandex Maps business listings.

The implementation pattern is a direct mirror of the existing `GoogleMapsModule` + `GoogleMapsWorker` architecture. GoogleMapsModule (383 lines) demonstrates the exact spawn pattern, IPC message protocol, progress event parsing, cancellation handshake, and timeout handling that this phase must replicate. GoogleMapsWorker (782 lines) demonstrates the Puppeteer scraping loop: launch browser, navigate to search URL, scroll the results feed, click into detail panels, extract business data fields, deduplicate, and return structured results.

**Primary recommendation:** Mirror the GoogleMapsModule/GoogleMapsWorker pattern exactly, substituting Yandex Maps URL construction, Yandex-specific CSS selectors for business listings and detail panels, and adding explicit captcha detection. Create the vite worker config by copying vite.googleMapsWorker.config.mjs.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MOD-01 | Implement YandexMapsModule as shared orchestration layer for AI and UI entry points | GoogleMapsModule.ts provides the exact pattern: spawn child process, IPC message handling, ActiveSearch tracking, cancel/timeout lifecycle |
| MOD-02 | Build Puppeteer child process worker for Yandex Maps scraping (open search, scroll results, extract detail panels) | GoogleMapsWorker.ts provides the scraping loop pattern; Yandex Maps URL format and selector research documented below |
| MOD-03 | Implement progress reporting, cancellation, and timeout handling in worker | GoogleMapsWorker demonstrates isCancelled flag, sendProgress helper, SIGTERM handler; YandexMapsProgressStatus types from Phase 9 |
| MOD-04 | Detect captcha/access challenge states and fail with clear typed error | Existing yandexScraper.ts detected() method checks for captcha/robot in HTML; YellowPagesScraper captcha detection patterns available |
| MOD-05 | Normalize and deduplicate results, preserve localized text (Cyrillic support) | GoogleMapsWorker deduplicate() function by place_id or name+address; Puppeteer textContent extraction preserves UTF-8/Cyrillic natively |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Search lifecycle orchestration | Electron Main Process | -- | YandexMapsModule manages child process spawning, timeout, cancellation, and progress routing |
| Web scraping (Yandex Maps DOM) | Child Process (Worker) | -- | Worker runs Puppeteer independently; no database or Electron API access |
| Progress event emission | Child Process | -- | Worker sends typed progress messages via IPC during scraping stages |
| Captcha detection | Child Process | -- | Worker inspects DOM content for captcha indicators; returns typed error |
| Result normalization/dedup | Child Process | -- | Worker normalizes and deduplicates before sending final result |
| Database persistence | Main Process (deferred) | -- | Not in v1.2 scope; GoogleMapsModule saves records but Yandex defers to v2 |
| AI skill dispatch | Main Process (ToolExecutor) | -- | ToolExecutor.executeYandexMapsSearch wires to YandexMapsModule.executeSearch |
| UI IPC handlers | Main Process | -- | Phase 11 responsibility; YandexMapsModule must support both call patterns |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| puppeteer (rebrowser-puppeteer) | ^24.8.1 | Headless browser automation | Already used by all child process workers; rebrowser-puppeteer is the project's puppeteer alias [VERIFIED: package.json] |
| puppeteer-extra-plugin-stealth | ^2.11.2 | Anti-detection evasion | Used by googleProxyCheck.ts; available for Yandex worker if needed [VERIFIED: package.json] |
| @lem0-packages/puppeteer-page-proxy | ^1.4.1 | Per-request proxy rotation | Used by GoogleMapsWorker and all scrapers [VERIFIED: package.json] |
| uuid | ^9.0.1 | Request ID generation | Used by GoogleMapsModule for requestId [VERIFIED: package.json] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vite (electron-forge plugin) | configured via forge.config.js | Worker build pipeline | Creates separate bundle for child process entry point |
| @rollup/plugin-alias | used in worker configs | Path alias resolution | Required for `@/` import resolution in worker process |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom Puppeteer scraping | Yandex Geosearch API | API is stable and legal, but requires API key, has usage limits, and provides different data shapes. Deferred to SCRP-01 in future requirements. [ASSUMED] |
| child_process.spawn | Electron utilityProcess.fork | utilityProcess.fork rejects piped stdin with ipc. GoogleMapsModule explicitly uses spawn for this reason. [VERIFIED: GoogleMapsModule.ts line 153] |

**Installation:**
No new packages needed. All dependencies already installed and verified in package.json.

## Architecture Patterns

### System Architecture Diagram

```
[AI Chat / ToolExecutor]           [UI Page (Phase 11)]
         |                                  |
         v                                  v
  +---------------------------------------------+
  |        YandexMapsModule (Main Process)       |
  |  - executeSearch(input) -> Promise<Result>   |
  |  - cancelSearch(requestId) -> void           |
  |  - activeSearches Map<requestId, ActiveSearch>|
  +----------------------+----------------------+
                         | spawn(process.execPath, [workerPath], {stdio: ['pipe','pipe','pipe','ipc']})
                         | env: { ELECTRON_RUN_AS_NODE: "1" }
                         v
  +---------------------------------------------+
  |    YandexMapsWorker (Child Process)           |
  |  - Launches Puppeteer browser                 |
  |  - Navigates to yandex.ru/maps/?text=...      |
  |  - Scrolls result listings                    |
  |  - Clicks into business detail panels         |
  |  - Extracts name, rating, phone, address,     |
  |    website, hours, coordinates, yandex_id     |
  |  - Detects captcha in DOM                     |
  |  - Normalizes + deduplicates results          |
  +---------------------------------------------+
           |                        ^
           | IPC: { type: 'start', requestId, query, location, ... }
           v                        | IPC: { type: 'progress', requestId, status, ... }
                                    | IPC: { type: 'result', requestId, success, data/error }
  +---------------------------------------------+
  | process.on('message') -> message handler      |
  | process.on('SIGTERM') -> graceful shutdown    |
  +---------------------------------------------+
```

### Recommended Project Structure
```
src/
  modules/
    YandexMapsModule.ts              # NEW - orchestration layer (mirrors GoogleMapsModule.ts)
  childprocess/
    yandex-maps/
      YandexMapsWorker.ts            # NEW - Puppeteer scraper (mirrors google-maps/GoogleMapsWorker.ts)
vite.yandexMapsWorker.config.mjs     # NEW - worker build config (mirrors vite.googleMapsWorker.config.mjs)
forge.config.js                      # MODIFY - add yandex-maps worker entry point
src/service/
  ToolExecutor.ts                    # MODIFY - replace stub with real YandexMapsModule call
```

### Pattern 1: Module-Worker IPC Protocol
**What:** Main process spawns worker via `child_process.spawn` with IPC channel, sends typed messages back and forth.
**When to use:** All scraper modules in this codebase.
**Example:**
```typescript
// Main process sends to worker (from GoogleMapsModule.ts)
type WorkerOutboundPayload =
  | { type: "start"; requestId: string; query: string; location: string; maxResults: number; ... }
  | { type: "cancel"; requestId: string };

// Worker sends to main process (from GoogleMapsWorker.ts)
type WorkerInboundPayload =
  | { type: "progress"; requestId: string; status: ProgressStatus; current: number; total: number; message: string }
  | { type: "result"; requestId: string; success: boolean; data?: SearchResult; error?: string };
```
[VERIFIED: GoogleMapsModule.ts lines 88-110, GoogleMapsWorker.ts lines 25-60]

### Pattern 2: Child Process Spawn with IPC
**What:** Main process spawns worker as a Node.js subprocess using `process.execPath`.
**When to use:** All worker processes in this project.
**Example:**
```typescript
// Source: GoogleMapsModule.ts line 153
worker = spawn(process.execPath, [resolvedWorkerPath], {
  stdio: ["pipe", "pipe", "pipe", "ipc"],
  env: {
    ...process.env,
    NODE_OPTIONS: "",
    ELECTRON_RUN_AS_NODE: "1",
    ELECTRON_APP_NAME: app.getName(),
    ELECTRON_USER_DATA_PATH: app.getPath("userData"),
  },
});
```
[VERIFIED: GoogleMapsModule.ts]

### Pattern 3: Worker Path Resolution
**What:** Multiple candidate paths for finding the built worker JS file.
**Example:**
```typescript
// Source: GoogleMapsModule.ts line 349, adapted for Yandex
private resolveWorkerPath(): string {
  const candidates = [
    path.join(__dirname, "../childprocess/yandex-maps/YandexMapsWorker.js"),
    path.join(process.cwd(), "dist/childprocess/yandex-maps/YandexMapsWorker.js"),
    path.join(__dirname, "YandexMapsWorker.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Yandex Maps worker file not found. Tried: ${candidates.join(", ")}`);
}
```
[VERIFIED: GoogleMapsModule.ts pattern adapted for yandex-maps path]

### Pattern 4: Active Search Tracking
**What:** Module maintains a Map of active searches with resolve/reject/timeout/progress callbacks.
**Example:**
```typescript
// Source: GoogleMapsModule.ts line 104
interface ActiveSearch {
  worker: ChildProcess;
  resolve: (result: YandexMapsSearchResult) => void;
  reject: (error: Error) => void;
  timeoutTimer: ReturnType<typeof setTimeout>;
  progressCallback?: (event: YandexMapsProgressEvent) => void;
}
private activeSearches = new Map<string, ActiveSearch>();
```
[VERIFIED: GoogleMapsModule.ts]

### Pattern 5: Cancellation Handshake
**What:** Module sends cancel message, waits 2 seconds, then force-kills worker.
**Example:**
```typescript
// Source: GoogleMapsModule.ts line 280
async cancelSearch(requestId: string): Promise<void> {
  const search = this.activeSearches.get(requestId);
  if (!search) return;
  this.activeSearches.delete(requestId);
  clearTimeout(search.timeoutTimer);
  search.reject(new Error("Search cancelled by user"));
  try { this.sendToWorker(search.worker, { type: "cancel", requestId }); } catch {}
  setTimeout(() => { try { search.worker.kill(); } catch {} }, 2000);
}
```
[VERIFIED: GoogleMapsModule.ts]

### Pattern 6: Forge Worker Registration
**What:** Each child process worker needs a build entry in forge.config.js.
**Example:**
```javascript
// Source: forge.config.js line 406
{
  entry: "src/childprocess/google-maps/GoogleMapsWorker.ts",
  config: "vite.googleMapsWorker.config.mjs",
},
// Phase 10 adds:
{
  entry: "src/childprocess/yandex-maps/YandexMapsWorker.ts",
  config: "vite.yandexMapsWorker.config.mjs",
},
```
[VERIFIED: forge.config.js]

### Anti-Patterns to Avoid
- **Worker accessing database directly:** Workers have no Electron APIs. All DB operations go through main process via IPC. [VERIFIED: CLAUDE.md mandatory rule]
- **Using utilityProcess.fork:** It rejects piped stdin with IPC. Use child_process.spawn instead. [VERIFIED: GoogleMapsModule.ts comment line 152]
- **Placing worker code in src/modules/:** Worker-specific code belongs in src/childprocess/. [VERIFIED: CLAUDE.md mandatory rule]
- **Hardcoded Yandex selectors without fallbacks:** Yandex frequently changes DOM class names. Use multiple selector strategies with `[class*="keyword"]` partial matches and aria-label attributes. [ASSUMED]
- **Skipping captcha detection after navigation:** Yandex presents captchas as full-page interstitials. Must check after every page navigation. [VERIFIED: yandexScraper.ts detected() method]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IPC message serialization | Custom serialization | process.send() / process.on('message') | Node.js IPC handles structured clone automatically |
| Process timeout management | Custom timer system | setTimeout + clearTimeout on resolve/cancel | GoogleMapsModule pattern is proven and simple |
| Proxy rotation | Custom proxy middleware | @lem0-packages/puppeteer-page-proxy | Already used by all workers, handles auth, supports per-request rotation |
| Result deduplication | Complex merge logic | Set-based key dedup by yandex_id or name+address | GoogleMapsWorker deduplicate() pattern is proven |
| Progress event validation | Loose type checking | parseWorkerMessage + typed guards | GoogleMapsModule pattern validates all fields before dispatching |

**Key insight:** The GoogleMapsModule/Worker pair is a battle-tested implementation of every concern in this phase. The safest approach is structural mirroring with Yandex-specific substitutions.

## Common Pitfalls

### Pitfall 1: Yandex Maps CSS Selector Fragility
**What goes wrong:** Yandex uses auto-generated, obfuscated class names (e.g., `_1a2b3c`) that change with every deployment. Selectors break silently, producing empty results.
**Why it happens:** Yandex Maps does not have stable CSS class names for business listing elements.
**How to avoid:** Use multiple selector strategies per field: (1) semantic selectors like `[class*="snippet"]` partial matches, (2) aria-label attributes, (3) data-* attributes when available, (4) text content matching as last resort. Log which selector matched for debugging.
**Warning signs:** Empty or partial results after a Yandex Maps deploy. [ASSUMED - selector fragility is well-known]

### Pitfall 2: Cyrillic Text Corruption
**What goes wrong:** Business names, addresses, and categories appear as mojibake (garbled text).
**Why it happens:** Incorrect string encoding when passing data through IPC or saving to storage.
**How to avoid:** Puppeteer's `textContent` extraction returns UTF-8 strings natively. Node.js IPC (process.send) uses structured clone which preserves Unicode. No encoding conversion needed anywhere in the pipeline. Verify by checking that extracted text contains Cyrillic characters before sending results.
**Warning signs:** Question marks or diamond characters in results. [VERIFIED: Node.js structured clone and Puppeteer both use UTF-8 natively]

### Pitfall 3: Yandex Captcha Not Detected
**What goes wrong:** Worker hangs indefinitely because Yandex presented a captcha page instead of search results, and the scraper keeps waiting for elements that never appear.
**Why it happens:** Yandex captcha pages can look like normal pages (same domain, same general structure) but with a form instead of results.
**How to avoid:** Check for captcha indicators immediately after every page navigation: (1) page title contains "captcha" or "robot", (2) HTML content contains "captcha" or "unusual traffic" or "bot detection", (3) search result containers are absent after timeout. Use the existing `yandexScraper.ts detected()` method as reference.
**Warning signs:** Worker runs for full timeout duration without extracting any results. [VERIFIED: yandexScraper.ts detected() method, ContactDiscovery.ts captcha check]

### Pitfall 4: Worker Process Zombie After Timeout
**What goes wrong:** After a timeout or cancellation, the worker process remains running, consuming memory and browser instances.
**Why it happens:** The timeout handler rejects the promise but the worker keeps scraping in the background.
**How to avoid:** Always call `worker.kill()` in the timeout handler, error handler, and after the 2-second cancellation grace period. The GoogleMapsModule pattern handles all three cases.
**Warning signs:** Multiple chrome.exe processes visible in task manager after failed scrapes. [VERIFIED: GoogleMapsModule.ts lines 176, 207, 299]

### Pitfall 5: Stale Card Handles After Navigation
**What goes wrong:** After clicking a card and going back, the previously captured element handles are stale and throw errors.
**Why it happens:** Puppeteer element handles become invalid when the DOM changes (navigation, dynamic updates).
**How to avoid:** Re-query fresh card handles on every iteration of the extraction loop. The GoogleMapsWorker does exactly this with `page.$$('div[role="feed"] > div > div[jsaction]')` inside the loop.
**Warning signs:** "JSHandles can be evaluated only in the context they were created" errors. [VERIFIED: GoogleMapsWorker.ts line 438]

### Pitfall 6: Yandex Maps URL Format (ll parameter order)
**What goes wrong:** Search results appear in the wrong geographic area or no results at all.
**Why it happens:** Yandex Maps uses `ll=longitude,latitude` (longitude first), unlike Google Maps which uses `lat,lng`.
**How to avoid:** If constructing URLs with coordinates, ensure `ll` parameter is `lng,lat`. For text-based search, use `https://yandex.ru/maps/?text=<encoded query>` which does not require coordinates. [ASSUMED - Yandex Maps URL format from documentation]

## Code Examples

Verified patterns from the existing codebase:

### YandexMapsModule.executeSearch (mirroring GoogleMapsModule)
```typescript
// Source: GoogleMapsModule.ts pattern, adapted for Yandex
async executeSearch(input: YandexMapsSearchInput): Promise<YandexMapsSearchResult> {
  const maxResults = Math.min(
    Math.max(1, input.max_results ?? YANDEX_MAPS_DEFAULT_MAX_RESULTS),
    YANDEX_MAPS_HARD_CAP
  );

  return new Promise((resolve, reject) => {
    const requestId = uuidv4();
    const resolvedWorkerPath = this.resolveWorkerPath();
    // ... spawn pattern identical to GoogleMapsModule ...
    worker = spawn(process.execPath, [resolvedWorkerPath], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: { ...process.env, NODE_OPTIONS: "", ELECTRON_RUN_AS_NODE: "1" },
    });
    // ... timeout, message handling, send start command ...
  });
}
```

### ToolExecutor.dispatch (replacing stub with real module call)
```typescript
// Source: ToolExecutor.ts executeGoogleMapsSearch pattern
private static async executeYandexMapsSearch(
  toolParams: Record<string, unknown>
): Promise<Record<string, unknown>> {
  // ... validation (already done) ...
  try {
    const module = new YandexMapsModule();
    const result = await module.executeSearch({
      query: query.trim(),
      location: location.trim(),
      max_results: clampedMaxResults,
      include_website: typeof toolParams.include_website === "boolean" ? toolParams.include_website : true,
      include_reviews: typeof toolParams.include_reviews === "boolean" ? toolParams.include_reviews : false,
      show_browser: typeof toolParams.show_browser === "boolean" ? toolParams.show_browser : false,
      language: typeof toolParams.language === "string" ? toolParams.language : undefined,
      region: typeof toolParams.region === "string" ? toolParams.region : undefined,
    });
    return result as unknown as Record<string, unknown>;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error executing Yandex Maps search",
    };
  }
}
```

### Yandex Maps URL Construction
```typescript
// Yandex Maps search URL format:
// Base: https://yandex.ru/maps/
// Search: ?text=<encoded query>
// The worker should construct the URL from query + location
const searchUrl = `https://yandex.ru/maps/?text=${encodeURIComponent(query + ' ' + location)}`;
// For language control, Yandex may use /maps/ (Russian) vs /maps/com/ (English) domain path
```
[ASSUMED - Yandex Maps URL format based on documentation]

### Yandex Captcha Detection (from existing yandexScraper.ts)
```typescript
// Source: yandexScraper.ts detected() method
async function detectCaptcha(page: Page): Promise<boolean> {
  const title = await page.title();
  const html = await page.content();
  return html.indexOf('captcha') !== -1 ||
         html.indexOf('robot') !== -1 ||
         title.indexOf('captcha') !== -1 ||
         html.indexOf('unusual traffic') !== -1 ||
         html.indexOf('bot detection') !== -1;
}
```
[VERIFIED: yandexScraper.ts lines 429-436, ContactDiscovery.ts line 295]

### Worker Message Handler Pattern
```typescript
// Source: GoogleMapsWorker.ts line 737
process.on("message", (msg: WorkerMessage) => {
  if (msg.type === "start") {
    scrapeYandexMaps(msg).catch((err) => {
      send({
        type: "result",
        requestId: msg.requestId,
        success: false,
        error: `Worker crashed: ${err instanceof Error ? err.message : String(err)}`,
      });
    });
  } else if (msg.type === "cancel") {
    isCancelled = true;
    sendProgress(msg.requestId, "cancelled", 0, 0, "Search cancelled");
    send({ type: "result", requestId: msg.requestId, success: false, error: "Search cancelled by user" });
  }
});
```
[VERIFIED: GoogleMapsWorker.ts]

### Vite Worker Config (copy from Google Maps worker)
```javascript
// Source: vite.googleMapsWorker.config.mjs (copy and rename)
// The config is identical for all workers - just needs the @/ alias and external modules
```
[VERIFIED: vite.googleMapsWorker.config.mjs]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| utilityProcess.fork for workers | child_process.spawn with IPC | Phase 2 of v1.0 | Fork rejects piped stdin with ipc; spawn is the only option |
| Direct DB access from workers | IPC to main process for all DB | Phase 1-4 of v1.0 | Workers are pure computation; DB access enforced at architecture level |
| Google Maps specific patterns | Shared worker pattern across all scrapers | v1.0 | All new scrapers follow the same Module+Worker structure |

**Deprecated/outdated:**
- src/childprocess/worker.ts: Legacy worker marked as deprecated in CLAUDE.md
- Direct database access from any child process: Enforced as forbidden by CLAUDE.md

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Yandex Maps search URL format is `https://yandex.ru/maps/?text=<encoded query>` | Architecture Patterns, Code Examples | Worker navigates to wrong URL; scraping fails |
| A2 | Yandex Maps uses `.search-business-snippet` class for business listings | Common Pitfalls | Selectors fail; no results extracted |
| A3 | Yandex Maps detail panel exposes business name, rating, phone, address, website, hours via DOM elements that can be queried | MOD-02 | Cannot extract required fields |
| A4 | Yandex Maps search results load dynamically (scroll to load more) similar to Google Maps | MOD-02 | Wrong pagination/scrolling strategy |
| A5 | Yandex Maps does not require JavaScript rendering differently than Google Maps (same Puppeteer launch config works) | MOD-02 | Browser config incompatibility |
| A6 | Cyrillic text preservation requires no special handling in Node.js/Puppeteer/IPC pipeline | Pitfall 2, MOD-05 | Text corruption in results |
| A7 | Yandex Maps detail panels can be accessed by clicking result snippets (similar to Google Maps click-into-detail pattern) | MOD-02 | Different interaction model needed |

**Planner action items for assumptions:**
- A1, A2, A3, A4, A7 are selector/interaction assumptions that CANNOT be verified without live testing. The plan MUST include a "selector validation" task that opens Yandex Maps in a browser and confirms selectors before writing extraction code.
- A5, A6 are LOW risk -- Puppeteer handles all modern JS rendering and Node.js handles UTF-8 natively.

## Open Questions

1. **Yandex Maps business listing selectors**
   - What we know: Existing yandexScraper.ts uses selectors for web search results (`.serp-item`, `.OrganicTitle-Link`), NOT Maps results. Yandex Maps uses different selectors.
   - What's unclear: The exact current CSS selectors for Yandex Maps business snippets, detail panels, and individual fields (name, rating, phone, etc.)
   - Recommendation: Plan should include a "selector discovery" task where the developer opens yandex.ru/maps in a browser, searches for businesses, and inspects the DOM to confirm selectors. The selectors listed in this research (`.search-business-snippet`, `.search-business-snippet-view__title`, etc.) are based on training knowledge and MUST be verified against the live site.

2. **Yandex Maps scroll/pagination behavior**
   - What we know: Google Maps uses an infinite scroll feed with `[role="feed"]` container.
   - What's unclear: Whether Yandex Maps uses infinite scroll, pagination buttons, or a different pattern for loading more business results.
   - Recommendation: Selector discovery task should also observe the scroll/pagination behavior.

3. **Yandex Maps detail panel interaction**
   - What we know: Google Maps uses click-into-detail-panel (card click opens side panel).
   - What's unclear: Whether Yandex Maps uses the same pattern or navigates to a separate page.
   - Recommendation: Selector discovery task should confirm the interaction model.

4. **Language parameter mapping**
   - What we know: YandexMapsSearchInput has `language` and `region` fields.
   - What's unclear: How these map to Yandex Maps URL parameters or domain selection (yandex.ru vs yandex.com vs yandex.kz).
   - Recommendation: Start with yandex.ru (Russian) as default. Language/region mapping can be refined later.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Worker runtime | Yes | 22.19.0 | -- |
| Puppeteer (rebrowser-puppeteer) | Browser automation | Yes | ^24.8.1 | -- |
| puppeteer-extra-plugin-stealth | Anti-detection | Yes | ^2.11.2 | Launch without stealth |
| @lem0-packages/puppeteer-page-proxy | Proxy rotation | Yes | ^1.4.1 | No proxy support |
| uuid | Request ID generation | Yes | ^9.0.1 | -- |
| vitest | Test framework | Yes | ^1.2.2 | -- |

**Missing dependencies with no fallback:**
None -- all required dependencies are already installed.

**Missing dependencies with fallback:**
None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^1.2.2 |
| Config file | vite.main.config.mjs (for ToolExecutor/module tests) |
| Quick run command | `yarn testmain --reporter=verbose` |
| Full suite command | `yarn testmain` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MOD-01 | YandexMapsModule spawns worker and returns result | unit (mocked) | `yarn testmain --reporter=verbose` | -- Wave 0 |
| MOD-01 | YandexMapsModule tracks active searches | unit | `yarn testmain --reporter=verbose` | -- Wave 0 |
| MOD-01 | YandexMapsModule cancels active search | unit (mocked) | `yarn testmain --reporter=verbose` | -- Wave 0 |
| MOD-02 | Worker sends progress events at each stage | unit (mocked IPC) | `yarn testmain --reporter=verbose` | -- Wave 0 |
| MOD-03 | Timeout fires after 10 minutes | unit (fake timers) | `yarn testmain --reporter=verbose` | -- Wave 0 |
| MOD-04 | Captcha detection returns typed error | unit | `yarn testmain --reporter=verbose` | -- Wave 0 |
| MOD-05 | Results are deduplicated by yandex_id | unit | `yarn testmain --reporter=verbose` | -- Wave 0 |
| MOD-05 | Cyrillic text preserved in results | unit | `yarn testmain --reporter=verbose` | -- Wave 0 |

### Sampling Rate
- **Per task commit:** `yarn testmain --reporter=verbose`
- **Per wave merge:** `yarn testmain`
- **Phase gate:** Full suite green + ToolExecutorYandex tests updated to verify real module wiring

### Wave 0 Gaps
- [ ] `test/vitest/main/modules/YandexMapsModule.test.ts` -- covers MOD-01, MOD-03 lifecycle tests
- [ ] `test/vitest/utilitycode/yandexMapsWorker.test.ts` -- covers MOD-02 worker scraping logic, MOD-04 captcha detection, MOD-05 dedup/normalization
- [ ] Update `test/vitest/main/service/ToolExecutorYandex.test.ts` -- update stub test to verify real module wiring

## Sources

### Primary (HIGH confidence)
- GoogleMapsModule.ts - Complete orchestration pattern (383 lines, production code)
- GoogleMapsWorker.ts - Complete worker pattern (782 lines, production code)
- forge.config.js - Worker registration pattern (lines 406-408)
- vite.googleMapsWorker.config.mjs - Worker build config
- src/entityTypes/yandexMapsTypes.ts - Phase 9 type contracts (all types and constants)
- ToolExecutor.ts - Existing stub dispatch for Phase 10 to replace (lines 1277-1313)
- baseModule.ts - Module base class pattern
- package.json - All dependency versions verified

### Secondary (MEDIUM confidence)
- yandexScraper.ts - Existing Yandex web search scraper with captcha detection pattern
- ContactDiscovery.ts - Additional captcha detection patterns
- YellowPagesScraper.ts - Comprehensive captcha detection selector list
- 09-01-SUMMARY.md - Phase 9 type contract decisions and constants
- 09-02-SUMMARY.md - Skill registration and stub dispatch decisions

### Tertiary (LOW confidence)
- Yandex Maps CSS selectors for business listings (`.search-business-snippet*`) - Based on training knowledge, MUST be verified against live site before implementation
- Yandex Maps URL format (`https://yandex.ru/maps/?text=`) - Based on training knowledge, should be verified

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all dependencies verified in package.json, no new packages needed
- Architecture: HIGH - GoogleMapsModule/Worker provides exact pattern to mirror
- Pitfalls: MEDIUM - Yandex-specific selectors are unverified; captcha detection patterns are proven
- Selectors: LOW - Yandex Maps DOM selectors are based on training data, must be verified live

**Research date:** 2026-05-26
**Valid until:** 2026-06-26 (selectors may change with Yandex deploys; architecture pattern is stable)
