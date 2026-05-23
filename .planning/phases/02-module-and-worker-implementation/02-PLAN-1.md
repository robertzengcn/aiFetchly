---
wave: 1
depends_on: []
files_modified:
  - src/modules/GoogleMapsModule.ts
  - src/childprocess/google-maps/GoogleMapsWorker.ts
  - src/service/ToolExecutor.ts
  - forge.config.js
  - vite.googleMapsWorker.config.mjs
autonomous: true
requirements:
  - FR-4
  - FR-5
  - FR-12
---

# Plan 1: GoogleMapsModule, Worker, and ToolExecutor Integration

## Goal

Implement the full scraping pipeline: GoogleMapsModule orchestrates a Puppeteer child process worker that scrapes Google Maps business data, and ToolExecutor dispatches to the real module instead of the Phase 1 stub.

## Tasks

### Task 1: Create GoogleMapsWorker — Puppeteer Child Process

<read_first>
- src/childprocess/google-maps/GoogleMapsWorker.ts (does not exist — create)
- src/childprocess/contact-extraction/ContactExtractionWorker.ts (worker pattern reference)
- src/childprocess/worker.ts (WorkerProcess, isWorkerProcess, getParentPort utilities)
- src/entityTypes/googleMapsTypes.ts (all types from Phase 1)
</read_first>

<action>
Create `src/childprocess/google-maps/GoogleMapsWorker.ts` — a child process worker that scrapes Google Maps using Puppeteer.

Structure:

1. Import types from `@/entityTypes/googleMapsTypes`
2. Import `Browser, Page, launch` from `puppeteer`
3. Define message types as interfaces (not exported — internal to worker):
   - `StartMessage`: `{ type: 'start', requestId: string, query: string, location: string, maxResults: number, includeWebsite: boolean, includeReviews: boolean, showBrowser: boolean }`
   - `CancelMessage`: `{ type: 'cancel', requestId: string }`
   - `ProgressMessage`: `{ type: 'progress', requestId: string, status: GoogleMapsProgressStatus, current: number, total: number, message: string }`
   - `ResultMessage`: `{ type: 'result', requestId: string, success: boolean, data?: GoogleMapsSearchResult, error?: string }`

4. State variables at module level:
   - `let browser: Browser | null = null`
   - `let isCancelled = false`

5. Helper function `send(msg)` — wraps `process.send!(msg)`

6. Main scraping function `async function scrapeGoogleMaps(msg: StartMessage)`:
   a. Set `isCancelled = false`
   b. Send progress: `{ status: 'launching', current: 0, total: msg.maxResults, message: 'Launching browser...' }`
   c. Launch Puppeteer: `browser = await launch({ headless: !msg.showBrowser, args: ['--no-sandbox', '--disable-setuid-sandbox'] })`
   d. Create page, set viewport to 1280x800
   e. Send progress: `{ status: 'loading', ... }`
   f. Navigate to `https://www.google.com/maps/search/${encodeURIComponent(msg.query)}+${encodeURIComponent(msg.location)}`
   g. Wait for results feed to load: `await page.waitForSelector('[role="feed"]', { timeout: 30000 })`
   h. Send progress: `{ status: 'extracting', current: 0, total: msg.maxResults, message: 'Loading results...' }`
   i. Scroll the feed to load more results until maxResults reached or no new cards appear:
      - Get cards: `await page.$$('div.Nv2PK')` (primary selector), fallback `await page.$$('div[role="feed"] > div > div')`
      - Scroll the feed container: `await page.evaluate(() => { const feed = document.querySelector('[role="feed"]'); if (feed) feed.scrollTop = feed.scrollHeight; })`
      - Wait 1 second between scrolls
      - Repeat until card count >= maxResults or no new cards after 3 consecutive scrolls
   j. For each card up to maxResults:
      - Check `isCancelled` before each extraction — if true, stop
      - Click the card to open detail panel
      - Wait for detail panel: `await page.waitForSelector('[role="main"]', { timeout: 10000 })`
      - Wait 1-2 seconds between detail visits (randomized delay)
      - Extract fields using these selectors (with fallbacks):
        - name: `h1.DUwDvf` or `h1`
        - rating: `div.F7nice span[aria-label*="star"]` → extract number from aria-label
        - review_count: `button[aria-label*="review"]` → extract number from aria-label
        - category: `button[jsaction*="category"]` or `div.DkEaL`
        - address: `button[data-item-id*="address"]` → extract from aria-label or text
        - phone: `button[data-item-id*="phone"]` → extract from aria-label or text
        - website: `a[data-item-id*="authority"]` → href attribute
        - hours: `div[aria-label*="Hours"]` → aria-label or text
        - maps_url: current page URL
        - place_id: extract from URL parameter `0x...:0x...` or `data cid` attribute
        - latitude/longitude: extract from URL or page
      - Send progress: `{ status: 'extracting', current: i+1, total: msg.maxResults }`
      - Go back to search results
   k. Deduplicate results by `place_id` or `name + address`
   l. Build `GoogleMapsSearchResult` object
   m. Send progress: `{ status: 'completed', ... }`
   n. Send result: `{ type: 'result', success: true, data: result }`
   o. Close browser
   p. Wrap entire function in try/catch:
      - On error: send `{ type: 'result', success: false, error: error.message }`
      - Finally: close browser if open

7. Message handler:
```typescript
process.on('message', (msg: StartMessage | CancelMessage) => {
  if (msg.type === 'start') {
    scrapeGoogleMaps(msg).catch((err) => {
      send({ type: 'result', requestId: msg.requestId, success: false, error: err.message });
    });
  } else if (msg.type === 'cancel') {
    isCancelled = true;
    send({ type: 'progress', requestId: msg.requestId, status: 'cancelled', current: 0, total: 0, message: 'Search cancelled' });
    send({ type: 'result', requestId: msg.requestId, success: false, error: 'Search cancelled by user' });
  }
});
```

8. Exit handler:
```typescript
process.on('SIGTERM', () => {
  isCancelled = true;
  if (browser) browser.close().catch(() => {});
  process.exit(0);
});
```

NEVER import or access TypeORM, SqliteDb, or any database module.
</action>

<acceptance_criteria>
- `src/childprocess/google-maps/GoogleMapsWorker.ts` exists
- File imports from `puppeteer` and `@/entityTypes/googleMapsTypes`
- File does NOT import `typeorm`, `SqliteDb`, or any database module
- `process.on('message', ...)` handler exists for 'start' and 'cancel' message types
- `scrapeGoogleMaps` function exists and is async
- Navigates to `https://www.google.com/maps/search/` URL
- Sends progress messages via `process.send`
- Sends result messages via `process.send`
- Handles cancellation via `isCancelled` flag
- Handles SIGTERM for cleanup
- Closes browser in finally block
- TypeScript compiles with no errors
</acceptance_criteria>

---

### Task 2: Create GoogleMapsModule — Orchestration Layer

<read_first>
- src/modules/GoogleMapsModule.ts (does not exist — create)
- src/modules/baseModule.ts (BaseModule class to extend)
- src/entityTypes/googleMapsTypes.ts (all types from Phase 1)
- src/service/ToolExecutor.ts (current stub to be updated in Task 3)
</read_first>

<action>
Create `src/modules/GoogleMapsModule.ts` — the orchestration layer that spawns the worker and manages the lifecycle.

```typescript
import { fork, ChildProcess } from "child_process";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { BaseModule } from "@/modules/baseModule";
import {
  type GoogleMapsSearchInput,
  type GoogleMapsSearchResult,
  type GoogleMapsProgressEvent,
  type GoogleMapsProgressStatus,
  GOOGLE_MAPS_DEFAULT_MAX_RESULTS,
  GOOGLE_MAPS_HARD_CAP,
} from "@/entityTypes/googleMapsTypes";

/** Active search sessions keyed by requestId */
interface ActiveSearch {
  worker: ChildProcess;
  resolve: (result: GoogleMapsSearchResult) => void;
  reject: (error: Error) => void;
  timeoutTimer: ReturnType<typeof setTimeout>;
  progressCallback?: (event: GoogleMapsProgressEvent) => void;
}

export class GoogleMapsModule extends BaseModule {
  private activeSearches = new Map<string, ActiveSearch>();
  private static readonly DEFAULT_TIMEOUT_MS = 600000; // 10 minutes

  /**
   * Execute a Google Maps search synchronously (blocks until complete or timeout).
   * Used by ToolExecutor for AI skill invocation.
   */
  async executeSearch(input: GoogleMapsSearchInput): Promise<GoogleMapsSearchResult> {
    const maxResults = Math.min(
      Math.max(1, input.max_results ?? GOOGLE_MAPS_DEFAULT_MAX_RESULTS),
      GOOGLE_MAPS_HARD_CAP
    );

    return new Promise((resolve, reject) => {
      const requestId = uuidv4();
      const workerPath = this.getWorkerPath();

      let worker: ChildProcess;
      try {
        worker = fork(workerPath, [], { stdio: ["inherit", "inherit", "inherit", "ipc"] });
      } catch (err) {
        reject(new Error(`Failed to spawn Google Maps worker: ${err instanceof Error ? err.message : String(err)}`));
        return;
      }

      const timeoutTimer = setTimeout(() => {
        worker.kill();
        this.activeSearches.delete(requestId);
        reject(new Error("Google Maps search timed out after 10 minutes"));
      }, GoogleMapsModule.DEFAULT_TIMEOUT_MS);

      const search: ActiveSearch = { worker, resolve, reject, timeoutTimer };
      this.activeSearches.set(requestId, search);

      worker.on("message", (msg: Record<string, unknown>) => {
        if (msg.type === "result" && msg.requestId === requestId) {
          clearTimeout(timeoutTimer);
          this.activeSearches.delete(requestId);
          worker.kill();

          if (msg.success && msg.data) {
            resolve(msg.data as GoogleMapsSearchResult);
          } else {
            resolve({
              success: false,
              query: input.query,
              location: input.location,
              totalResults: 0,
              summary: `Search failed: ${msg.error ?? "Unknown error"}`,
              results: [],
            });
          }
        }
      });

      worker.on("error", (err) => {
        clearTimeout(timeoutTimer);
        this.activeSearches.delete(requestId);
        reject(new Error(`Worker error: ${err.message}`));
      });

      worker.on("exit", (code) => {
        if (this.activeSearches.has(requestId)) {
          clearTimeout(timeoutTimer);
          this.activeSearches.delete(requestId);
          reject(new Error(`Worker exited unexpectedly with code ${code}`));
        }
      });

      // Send start command to worker
      worker.send({
        type: "start",
        requestId,
        query: input.query.trim(),
        location: input.location.trim(),
        maxResults,
        includeWebsite: input.include_website ?? true,
        includeReviews: input.include_reviews ?? false,
        showBrowser: input.show_browser ?? false,
      });
    });
  }

  /**
   * Cancel an active search by requestId.
   */
  async cancelSearch(requestId: string): Promise<void> {
    const search = this.activeSearches.get(requestId);
    if (!search) return;
    clearTimeout(search.timeoutTimer);
    search.worker.send({ type: "cancel", requestId });
    // Give worker 2 seconds to handle cancellation gracefully
    setTimeout(() => {
      search.worker.kill();
      this.activeSearches.delete(requestId);
    }, 2000);
  }

  /**
   * Get the path to the Google Maps worker entry point.
   */
  private getWorkerPath(): string {
    // In production, the worker is built to the output directory.
    // In development, point to the source file via ts-node or the Vite dev server.
    return path.join(__dirname, "google-maps", "GoogleMapsWorker.js");
  }
}
```

Key points:
- Extends `BaseModule` (ready for Phase 4 persistence)
- `executeSearch()` returns a Promise that resolves when worker sends results
- Uses `child_process.fork()` to spawn the worker
- Handles timeout (10 min), errors, and unexpected exits
- `cancelSearch()` sends cancel message then kills after grace period
- Worker path resolves to `GoogleMapsWorker.js` (built output)
</action>

<acceptance_criteria>
- `src/modules/GoogleMapsModule.ts` exists
- Class `GoogleMapsModule extends BaseModule`
- `executeSearch(input: GoogleMapsSearchInput): Promise<GoogleMapsSearchResult>` method exists
- Uses `child_process.fork()` to spawn worker
- Handles 'result', 'error', and 'exit' events from worker
- Has timeout (DEFAULT_TIMEOUT_MS = 600000)
- `cancelSearch(requestId: string)` method exists
- Imports types from `@/entityTypes/googleMapsTypes`
- Does NOT import `puppeteer` directly (delegates to worker)
- TypeScript compiles with no errors
</acceptance_criteria>

---

### Task 3: Update ToolExecutor to Use GoogleMapsModule

<read_first>
- src/service/ToolExecutor.ts (current stub — find executeGoogleMapsSearch method)
- src/modules/GoogleMapsModule.ts (just created)
- src/entityTypes/googleMapsTypes.ts (types)
</read_first>

<action>
Replace the Phase 1 stub in `src/service/ToolExecutor.ts` with the real implementation.

1. Add import at the top (near other module imports):
```typescript
import { GoogleMapsModule } from "@/modules/GoogleMapsModule";
```

2. Replace the entire `executeGoogleMapsSearch` method body. The current stub returns `{ success: false, error: "Google Maps scraping is not yet implemented..." }`. Replace it with:

```typescript
private static async executeGoogleMapsSearch(
  toolParams: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const query =
    typeof toolParams.query === "string" ? toolParams.query : "";
  const location =
    typeof toolParams.location === "string" ? toolParams.location : "";
  const maxResults =
    typeof toolParams.max_results === "number"
      ? toolParams.max_results
      : GOOGLE_MAPS_DEFAULT_MAX_RESULTS;

  if (!query.trim()) {
    return {
      success: false,
      error: "query is required and must not be blank",
    };
  }

  if (!location.trim()) {
    return {
      success: false,
      error: "location is required and must not be blank",
    };
  }

  const clampedMaxResults = Math.min(
    Math.max(1, maxResults),
    GOOGLE_MAPS_HARD_CAP
  );

  try {
    const module = new GoogleMapsModule();
    const result = await module.executeSearch({
      query: query.trim(),
      location: location.trim(),
      max_results: clampedMaxResults,
      include_website:
        typeof toolParams.include_website === "boolean"
          ? toolParams.include_website
          : true,
      include_reviews:
        typeof toolParams.include_reviews === "boolean"
          ? toolParams.include_reviews
          : false,
      show_browser:
        typeof toolParams.show_browser === "boolean"
          ? toolParams.show_browser
          : false,
    });

    return result as unknown as Record<string, unknown>;
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error executing Google Maps search",
    };
  }
}
```

Keep the existing input validation logic. Only change: replace the stub return with the real module call.
</action>

<acceptance_criteria>
- `ToolExecutor.ts` imports `GoogleMapsModule` from `@/modules/GoogleMapsModule`
- `executeGoogleMapsSearch` creates `new GoogleMapsModule()` and calls `module.executeSearch()`
- Input validation (query, location non-blank) still works
- max_results clamping still works
- try/catch wraps module call with error return
- No longer returns "not yet implemented" stub
- TypeScript compiles with no errors
</acceptance_criteria>

---

### Task 4: Add Forge Build Configuration

<read_first>
- forge.config.js (find the build entries array near line 400)
- vite.yellowPages.config.mjs (pattern reference for the new vite config)
</read_first>

<action>
1. Add a new entry to the `build` array in `forge.config.js`, after the `contactExtractionWorker` entry:

```javascript
{
  entry: "src/childprocess/google-maps/GoogleMapsWorker.ts",
  config: "vite.googleMapsWorker.config.mjs",
},
```

2. Create `vite.googleMapsWorker.config.mjs` following the same pattern as `vite.yellowPages.config.mjs`:
   - Import `defineConfig, loadEnv` from 'vite'
   - Import `alias` from `@rollup/plugin-alias`
   - Import `ClosePlugin` from `./vite-plugin-close.js`
   - Import `nodeResolve` from `@rollup/plugin-node-resolve`
   - Import `sourcemaps` from `rollup-plugin-sourcemaps`
   - Define `emptyModulesPlugin()` with the same empty modules list
   - Export config with same plugins, resolve alias `@`, build external: `['sqlite3', 'better-sqlite3', 'bindings', 'typeorm']`
   - Set `sourcemap: true`, `ssr: true`
</action>

<acceptance_criteria>
- `forge.config.js` contains entry for `src/childprocess/google-maps/GoogleMapsWorker.ts`
- `vite.googleMapsWorker.config.mjs` exists in project root
- Config has `@` alias pointing to `./src`
- Config externalizes `sqlite3`, `better-sqlite3`, `bindings`, `typeorm`
- Config has `ssr: true` and `sourcemap: true`
</acceptance_criteria>

---

## Verification

1. Run `npx tsc --noEmit` — must pass with zero errors
2. Grep for `GoogleMapsModule` in `src/service/ToolExecutor.ts` — must find the import and usage
3. Grep for `scrapeGoogleMaps` in `src/childprocess/google-maps/GoogleMapsWorker.ts` — must find the function
4. Grep for `extends BaseModule` in `src/modules/GoogleMapsModule.ts` — must find it
5. Grep for `GoogleMapsWorker.ts` in `forge.config.js` — must find the entry
6. Verify `vite.googleMapsWorker.config.mjs` exists

## Must-Haves

- [ ] `GoogleMapsWorker.ts` scrapes Google Maps via Puppeteer and sends structured results
- [ ] `GoogleMapsModule.ts` extends BaseModule, spawns worker via fork(), collects results
- [ ] `ToolExecutor.executeGoogleMapsSearch()` calls real module instead of stub
- [ ] Worker never imports TypeORM or database modules
- [ ] Worker handles cancellation and cleanup
- [ ] Module handles timeout (10 min) and error cases
- [ ] Forge config and vite config properly registered
- [ ] TypeScript compiles cleanly
