# Phase 11: UI Page and Integration - Research

**Researched:** 2026-05-26
**Domain:** Electron IPC, Vue 3 UI, Vuetify components, route registration
**Confidence:** HIGH

## Summary

Phase 11 wires the Yandex Maps scraper into the application's UI layer. The implementation mirrors the existing Google Maps scraper pattern almost exactly, with four key differences: (1) no cookies/proxy/account form fields (Yandex worker does not accept them), (2) no history tab or persistence (v1.2 defers database persistence), (3) language and region form fields added for Yandex-specific localization, and (4) real-time progress events must be wired through IPC (Google Maps defined a progress channel but never used it -- Yandex Maps success criteria explicitly require "see real-time progress updates during scraping").

The research examined the full data flow: IPC handler registration in `communication/index.ts`, channel constant naming in `channellist.ts`, preload whitelist arrays in `preload.ts`, frontend API wrapper in `views/api/`, and the complete Vue SFC page in `views/pages/google-maps-scraper/index.vue`. Every layer has a clear, battle-tested pattern to follow.

**Primary recommendation:** Clone the Google Maps implementation across all six files (IPC handler, channel list, preload, API wrapper, Vue page, router entry), strip the Google-specific features (cookies, proxies, history), add Yandex-specific features (language/region fields, progress channel wiring), and use the existing type contracts from Phase 9.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | Add IPC handlers for start, monitor, cancel, and results under src/main-process/communication/ | googleMaps-ipc.ts pattern verified: registerXxxHandlers() function, ipcMain.handle() with activeModules Map, async executeSearch with webContents.send push |
| UI-02 | Add frontend API wrapper in src/views/api/ for Yandex Maps IPC | googleMaps.ts pattern verified: windowInvoke/windowReceive/windowRemoveAllListeners, typed response interfaces |
| UI-03 | Build manual UI page with form, progress display, and results table | google-maps-scraper/index.vue pattern verified: 667-line SFC with Vuetify components, v-data-table, Papa.unparse for CSV export |
| UI-04 | Add copy and export results from UI page (CSV + JSON) | exportCSV/exportJSON functions verified using papaparse, Blob + URL.createObjectURL download |
| UI-06 | Add navigation route for Yandex Maps scraper page | Router pattern verified: constantRoutes in router/index.ts with Layout wrapper, meta.visible for sidebar |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| IPC channel registration | API / Backend | -- | Main process registers ipcMain.handle listeners |
| Channel constant definition | API / Backend | -- | channellist.ts is imported by both preload and IPC handlers |
| Preload whitelist | Frontend Server (SSR) | -- | preload.ts bridges main/renderer with channel security |
| Frontend API wrapper | Browser / Client | -- | views/api/ uses window.api.invoke/receive from preload bridge |
| Form UI and state management | Browser / Client | -- | Vue 3 SFC with Composition API reactive state |
| Results table rendering | Browser / Client | -- | Vuetify v-data-table component |
| CSV/JSON export | Browser / Client | -- | papaparse + Blob download, no server round-trip |
| Route registration | Browser / Client | -- | Vue Router constantRoutes array |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vue 3 | ^3.x | Frontend framework | Project standard, Composition API with `<script setup>` |
| Vuetify | ^3.x | UI components | Project standard, all existing pages use Vuetify |
| vue-i18n | ^9.x | Internationalization | Project standard, all pages use `t()` with fallback pattern |
| papaparse | ^5.4.1 | CSV export | Already used in google-maps-scraper/index.vue for CSV export [VERIFIED: package.json] |
| vue-router | ^4.x | Client-side routing | Project standard, hash-based routing |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| uuid (v4) | ^9.x | Request ID generation | Used in IPC handlers for tracking active searches |
| @types/papaparse | ^5.5.2 | TypeScript types for papaparse | Already in devDependencies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| papaparse | Manual CSV string building | papaparse handles edge cases (quotes, commas in values) -- use papaparse |

**Installation:**
No new packages needed -- all dependencies already installed.

**Version verification:**
```
papaparse: ^5.4.1 [VERIFIED: package.json line 135]
@types/papaparse: ^5.5.2 [VERIFIED: package.json line 87]
```

## Architecture Patterns

### System Architecture Diagram

```
User Input (Vue Form)
       |
       v
views/api/yandexMaps.ts (windowInvoke)
       |
       v
preload.ts (whitelist check) ---> ipcRenderer.invoke()
       |
       v
yandexMaps-ipc.ts (ipcMain.handle)
       |
       v
YandexMapsModule.executeSearch()
       |
       v
Child Process Worker (YandexMapsWorker.ts)
       |
       |-- progress events --> worker.send() --> module.on('message') --> webContents.send(YANDEX_MAPS_SEARCH_PROGRESS)
       |-- result event   --> worker.send() --> module.on('message') --> webContents.send(YANDEX_MAPS_SEARCH_RESULT)
       |
       v
preload.ts (receive whitelist) --> ipcRenderer.on()
       |
       v
views/api/yandexMaps.ts (windowReceive callback)
       |
       v
Vue SFC (reactive state update --> template re-render)
```

### Recommended Project Structure
```
src/
├── config/channellist.ts                    # ADD: 4 Yandex Maps channel constants
├── main-process/communication/
│   ├── index.ts                             # MODIFY: import + call registerYandexMapsHandlers()
│   └── yandexMaps-ipc.ts                    # ADD: IPC handlers for start/cancel with progress wiring
├── preload.ts                               # MODIFY: add Yandex channels to send/receive/invoke/removeAllListeners whitelists
├── views/
│   ├── api/yandexMaps.ts                    # ADD: frontend API wrapper with progress subscription
│   ├── pages/yandex-maps-scraper/index.vue  # ADD: main UI page (form + progress + results + export)
│   └── router/index.ts                      # MODIFY: add route entry for /yandex-maps-scraper
```

### Pattern 1: IPC Handler Registration (from googleMaps-ipc.ts)
**What:** Exported function registers ipcMain.handle() listeners. Active searches tracked in Map for cancellation.
**When to use:** Every feature that needs main-process communication.
**Example:**
```typescript
// src/main-process/communication/yandexMaps-ipc.ts
export function registerYandexMapsHandlers(): void {
  ipcMain.handle(YANDEX_MAPS_SEARCH_START, async (event, ...args: unknown[]) => {
    // Parse and validate input
    // Create YandexMapsModule instance
    // Set up progress callback via webContents.send
    // Execute search async, push result via webContents.send
    // Return { status: true, msg: "...", data: { requestId } }
  });

  ipcMain.handle(YANDEX_MAPS_SEARCH_CANCEL, async (_event, ...args) => {
    // Cancel active search by requestId
  });
}
```
[VERIFIED: src/main-process/communication/googleMaps-ipc.ts lines 41-303]

### Pattern 2: Frontend API Wrapper (from googleMaps.ts)
**What:** Typed functions wrapping windowInvoke/windowReceive for IPC communication.
**When to use:** Every Vue component that needs to call main process.
**Example:**
```typescript
// src/views/api/yandexMaps.ts
export async function startYandexMapsSearch(params: {
  query: string;
  location: string;
  max_results?: number;
  // ...
}): Promise<YandexMapsSearchStartResponse> {
  const resp = await windowInvoke(YANDEX_MAPS_SEARCH_START, params);
  return resp as YandexMapsSearchStartResponse;
}

export function onYandexMapsResult(
  callback: (event: YandexMapsResultEvent) => void
): () => void {
  windowReceive(YANDEX_MAPS_SEARCH_RESULT, handler);
  return () => { windowRemoveAllListeners(YANDEX_MAPS_SEARCH_RESULT); };
}
```
[VERIFIED: src/views/api/googleMaps.ts lines 1-123]

### Pattern 3: Vue SFC Page with Progress Tracking (from google-maps-scraper/index.vue)
**What:** Single-file Vue component with `<script setup>`, reactive state, and Vuetify layout.
**When to use:** All scraper UI pages.
**Example structure:**
- Form section: v-text-field (query, location), v-slider (max_results), v-switch (toggles), v-btn (start/cancel)
- Progress section: v-progress-circular + v-progress-linear with status text
- Results section: v-data-table with custom #item.xxx slots
- Export section: CSV (papaparse) and JSON (JSON.stringify) via Blob download
- Lifecycle: onMounted (setup listeners), onUnmounted (cleanup listeners + cancel running search)
[VERIFIED: src/views/pages/google-maps-scraper/index.vue, 667 lines]

### Pattern 4: Route Registration (from router/index.ts)
**What:** Add route entry to constantRoutes array with Layout wrapper.
**When to use:** Adding new top-level navigation pages.
**Example:**
```typescript
{
  path: "/yandex-maps-scraper",
  name: "Yandex_Maps_Scraper",
  meta: {
    visible: true,
    title: "route.yandex_maps_scraper",
    icon: "mdi-map-search",
  },
  component: Layout,
  children: [
    {
      path: "",
      component: () => import("@/views/pages/yandex-maps-scraper/index.vue"),
      name: "YandexMapsScraper",
      meta: {
        visible: true,
        title: "route.yandex_maps_scraper",
        icon: "mdi-map-search",
      },
    },
  ],
},
```
[VERIFIED: src/views/router/index.ts lines 578-599 (Google Maps entry)]

### Pattern 5: Channel Constant Naming Convention
**What:** Consistent `platform:action` string format for IPC channels.
**When to use:** Adding new channels to channellist.ts.
**Example:**
```typescript
export const YANDEX_MAPS_SEARCH_START = "yandex_maps:search_start";
export const YANDEX_MAPS_SEARCH_CANCEL = "yandex_maps:search_cancel";
export const YANDEX_MAPS_SEARCH_PROGRESS = "yandex_maps:search_progress";
export const YANDEX_MAPS_SEARCH_RESULT = "yandex_maps:search_result";
```
[VERIFIED: src/config/channellist.ts Google Maps pattern at lines 325-331]

### Anti-Patterns to Avoid
- **Placing database logic in IPC handlers:** Must use Module layer only. The YandexMapsModule already handles orchestration. [VERIFIED: CLAUDE.md "Database Access Architecture" section]
- **Accessing database from worker process:** Workers send IPC messages; main process handles DB. Not applicable for v1.2 (no DB persistence) but important for future. [VERIFIED: CLAUDE.md "Child/Worker Process Database Access" section]
- **Forgetting preload whitelist:** Every new channel must appear in ALL FOUR preload arrays (send, receive, invoke, removeAllListeners) or IPC calls silently fail. [VERIFIED: src/preload.ts has 4 separate whitelists]
- **Mutating reactive state objects directly:** Use immutable patterns -- create new arrays/objects when updating. [VERIFIED: ~/.claude/rules/common/coding-style.md]
- **Hardcoding UI text:** Must use `t('key') || 'fallback'` pattern for all user-facing strings. Translations are Phase 12 but the keys must exist in Phase 11. [VERIFIED: CLAUDE.md "Internationalization" section]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSV generation | String concatenation with comma separators | papaparse `Papa.unparse()` | Handles quoting, escaping, special characters |
| File download | Custom fetch/upload endpoint | `Blob` + `URL.createObjectURL` + `<a>` click | Client-side only, no server round-trip needed |
| IPC channel security | Manual channel validation | preload.ts whitelist arrays | Electron's contextBridge pattern prevents channel spoofing |
| Input validation in IPC | Trust raw args | Parse + type-check each field from `unknown` | IPC data arrives as `unknown[]`, not typed |
| UUID generation | Custom ID generation | `uuid v4` | Already in project, cryptographically random |

**Key insight:** The Google Maps implementation already solved all these problems. Mirroring it is faster and safer than building alternatives.

## Common Pitfalls

### Pitfall 1: Missing Preload Whitelist Entry
**What goes wrong:** IPC call silently fails -- `window.api.invoke()` returns undefined because the channel is not in the whitelist.
**Why it happens:** preload.ts has FOUR separate whitelist arrays (send, receive, invoke, removeAllListeners) and forgetting any one produces different symptoms.
**How to avoid:** Add each new channel constant to the correct arrays: START/CANCEL go in `invoke`, PROGRESS goes in `receive` and `removeAllListeners`, RESULT goes in `receive` and `removeAllListeners`.
**Warning signs:** IPC call returns undefined; no error thrown; channel string is correct but still blocked.

### Pitfall 2: Progress Event Not Wired
**What goes wrong:** UI shows generic "Searching..." spinner but no real-time progress updates.
**Why it happens:** Google Maps defined `GOOGLE_MAPS_SEARCH_PROGRESS` in channellist.ts but never wired it in the IPC handler or UI. Copying that pattern verbatim means Yandex Maps progress won't work either.
**How to avoid:** In the Yandex Maps IPC handler, pass a progress callback to YandexMapsModule that forwards events via `webContents.send(YANDEX_MAPS_SEARCH_PROGRESS, progress)`. In the UI, subscribe using `windowReceive(YANDEX_MAPS_SEARCH_PROGRESS, callback)`. Add the progress channel to preload.ts `receive` and `removeAllListeners` arrays.
**Warning signs:** Progress bar stays at 0% or shows indeterminate spinner only.

### Pitfall 3: IPC Handler Not Registered
**What goes wrong:** IPC calls return "unknown error" because the handler was never registered.
**Why it happens:** The `registerYandexMapsHandlers()` function must be imported and called in `communication/index.ts`.
**How to avoid:** Add import at top of index.ts and add call inside `registerCommunicationIpcHandlers()`. Note the HMR guard (`__aifetchlyIpcHandlersRegistered`) prevents double registration.
**Warning signs:** `windowInvoke` throws "unknown error" immediately.

### Pitfall 4: Forgetting onUnmounted Cleanup
**What goes wrong:** Stale event listeners accumulate, causing memory leaks or callbacks firing for destroyed components.
**Why it happens:** Vue components can be destroyed while a search is still running.
**How to avoid:** In `onUnmounted`, call unsubscribe function and cancel any running search (exact pattern from Google Maps: `cancelYandexMapsSearch(requestId.value).catch(() => {})`).
**Warning signs:** Multiple result callbacks firing for a single search; errors about destroyed webContents.

### Pitfall 5: Using Google Maps Translation Keys for Yandex Maps
**What goes wrong:** UI shows "Google Maps" in the Yandex Maps page.
**Why it happens:** Copy-pasting the Vue template without updating all `t('googleMaps.xxx')` references to `t('yandexMaps.xxx')`.
**How to avoid:** Use a separate `yandexMaps` translation namespace. Phase 12 will fill all 6 language files, but Phase 11 must use the correct key prefix.
**Warning signs:** UI displays "Google Maps" branding on the Yandex page.

### Pitfall 6: webContents.isDestroyed() Check Missing
**What goes wrong:** Error "Object has been destroyed" when pushing results to a closed window.
**Why it happens:** The user navigates away or closes the window while the worker is still running.
**How to avoid:** Check `senderWebContents.isDestroyed()` before calling `webContents.send()`. Pattern from googleMaps-ipc.ts line 147-152.
**Warning signs:** Uncaught exception in main process after window close.

## Code Examples

### IPC Handler with Progress Wiring (Yandex Maps specific -- must actually use progress)
```typescript
// src/main-process/communication/yandexMaps-ipc.ts
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { v4 as uuidv4 } from "uuid";
import { YandexMapsModule } from "@/modules/YandexMapsModule";
import {
  YANDEX_MAPS_SEARCH_START,
  YANDEX_MAPS_SEARCH_CANCEL,
  YANDEX_MAPS_SEARCH_PROGRESS,
  YANDEX_MAPS_SEARCH_RESULT,
} from "@/config/channellist";
import type { YandexMapsSearchInput, YandexMapsSearchResult } from "@/entityTypes/yandexMapsTypes";

const activeModules = new Map<string, YandexMapsModule>();

export function registerYandexMapsHandlers(): void {
  ipcMain.handle(YANDEX_MAPS_SEARCH_START, async (event, ...args: unknown[]) => {
    const raw = args[0];
    const data = (typeof raw === "string" ? JSON.parse(raw) : raw ?? {}) as Record<string, unknown>;
    // ... validate input ...
    const requestId = uuidv4();
    const module = new YandexMapsModule();
    activeModules.set(requestId, module);
    const senderWebContents = event.sender;

    // Wire progress callback -- THIS IS THE KEY DIFFERENCE FROM GOOGLE MAPS
    // YandexMapsModule needs a way to accept progress callback per-request
    // Option A: pass in executeSearch options
    // Option B: call a setProgressCallback method

    module.executeSearch(input)
      .then((result) => {
        if (!senderWebContents.isDestroyed()) {
          senderWebContents.send(YANDEX_MAPS_SEARCH_RESULT, { requestId, result });
        }
        activeModules.delete(requestId);
      })
      .catch((err) => { /* error handling */ });

    return { status: true, msg: "Search started", data: { requestId } };
  });
}
```
[VERIFIED: Pattern from src/main-process/communication/googleMaps-ipc.ts, adapted with progress wiring]

### Frontend API with Progress Subscription
```typescript
// src/views/api/yandexMaps.ts
import { windowInvoke, windowReceive, windowRemoveAllListeners } from "@/views/utils/apirequest";
import {
  YANDEX_MAPS_SEARCH_START,
  YANDEX_MAPS_SEARCH_CANCEL,
  YANDEX_MAPS_SEARCH_PROGRESS,
  YANDEX_MAPS_SEARCH_RESULT,
} from "@/config/channellist";
import type { YandexMapsSearchResult, YandexMapsProgressEvent } from "@/entityTypes/yandexMapsTypes";

export interface YandexMapsSearchStartResponse { requestId: string; }
export interface YandexMapsResultEvent { requestId: string; result: YandexMapsSearchResult; }

export async function startYandexMapsSearch(params: { /* ... */ }): Promise<YandexMapsSearchStartResponse> {
  const resp = await windowInvoke(YANDEX_MAPS_SEARCH_START, params);
  return resp as YandexMapsSearchStartResponse;
}

export async function cancelYandexMapsSearch(requestId: string): Promise<void> {
  await windowInvoke(YANDEX_MAPS_SEARCH_CANCEL, { requestId });
}

export function onYandexMapsProgress(
  callback: (event: YandexMapsProgressEvent) => void
): () => void {
  windowReceive(YANDEX_MAPS_SEARCH_PROGRESS, callback);
  return () => { windowRemoveAllListeners(YANDEX_MAPS_SEARCH_PROGRESS); };
}

export function onYandexMapsResult(
  callback: (event: YandexMapsResultEvent) => void
): () => void {
  windowReceive(YANDEX_MAPS_SEARCH_RESULT, callback);
  return () => { windowRemoveAllListeners(YANDEX_MAPS_SEARCH_RESULT); };
}
```
[VERIFIED: Pattern from src/views/api/googleMaps.ts, extended with progress subscription]

### Export Functions (from google-maps-scraper/index.vue)
```typescript
function exportCSV(): void {
  const data = results.value.map((r) => ({
    name: r.name,
    category: r.category ?? "",
    rating: r.rating ?? "",
    review_count: r.review_count ?? "",
    address: r.address ?? "",
    phone: r.phone ?? "",
    website: r.website ?? "",
    hours: r.hours ?? "",
    maps_url: r.maps_url ?? "",
  }));
  const csv = Papa.unparse(data);
  downloadFile(csv, `yandex-maps-${sanitizeFilename(lastQuery.value)}-${sanitizeFilename(lastLocation.value)}.csv`, "text/csv");
}

function exportJSON(): void {
  const json = JSON.stringify(results.value, null, 2);
  downloadFile(json, `yandex-maps-${sanitizeFilename(lastQuery.value)}-${sanitizeFilename(lastLocation.value)}.json`, "application/json");
}
```
[VERIFIED: src/views/pages/google-maps-scraper/index.vue lines 610-648]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ipcRenderer.sendSync | ipcMain.handle / ipcRenderer.invoke | Project-wide | Non-blocking async IPC |
| Direct preload globals | contextBridge.exposeInMainWorld | Electron security model | Prevents renderer privilege escalation |
| Vuetify 2 data tables | Vuetify 3 v-data-table | Project-wide | New API, no `header-text` slot |
| vue-i18n `tc()` | `t()` with fallback pattern | Project-wide | Simpler, consistent fallbacks |

**Deprecated/outdated:**
- `ipcRenderer.sendSync`: Use invoke/handle pattern [ASSUMED]
- Vuetify 2 table API: Use Vuetify 3 syntax verified in google-maps-scraper/index.vue

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | YandexMapsModule does not currently expose a public method to set progressCallback -- it may need one added for the IPC handler to wire progress events | Architecture Patterns | Need to add method to YandexMapsModule or pass callback via executeSearch options |
| A2 | The Yandex Maps UI page "copy" functionality means copy-all-results-to-clipboard as JSON text (success criteria says "working copy and export buttons") | Code Examples | May need to also support per-row or per-cell copy |
| A3 | Phase 11 will use hardcoded English strings with `t('yandexMaps.key') \|\| 'English fallback'` pattern, and Phase 12 will fill the actual translations in all 6 language files | Anti-Patterns | No actual risk -- this is the established project pattern |

## Open Questions

1. **Progress callback API on YandexMapsModule**
   - What we know: YandexMapsModule has a private `progressCallback` field on the ActiveSearch interface, but no public method to set it from outside.
   - What's unclear: Whether the IPC handler can access the progressCallback field directly or needs a setter method added to the module.
   - Recommendation: Add a `setProgressCallback(requestId, callback)` method to YandexMapsModule. This is a minor addition that preserves encapsulation. Alternatively, pass the callback as an option to `executeSearch()`.

2. **"Copy" functionality in success criteria**
   - What we know: Success criteria say "working copy and export buttons." Export is clearly CSV/JSON download.
   - What's unclear: Whether "copy" means copy a single cell value, copy selected rows, or copy all results to clipboard.
   - Recommendation: Implement "Copy All" as a button that copies the full results as JSON to clipboard using `navigator.clipboard.writeText()`. This mirrors what users expect from "copy results."

## Environment Availability

Step 2.6: SKIPPED (no external dependencies identified -- all changes are code/config-only using existing packages)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^1.2.2 |
| Config file | vite.main.config.mjs (for main process tests) |
| Quick run command | `vitest --config vite.main.config.mjs --reporter=verbose test/vitest/main/ipc/yandexMaps-ipc.test.ts` |
| Full suite command | `yarn testmain` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | IPC handlers validate input and return error for missing query/location | unit | `vitest --config vite.main.config.mjs -t "yandex-maps-ipc"` | Needs Wave 0 |
| UI-01 | IPC start handler creates module and returns requestId | unit | `vitest --config vite.main.config.mjs -t "yandex-maps-ipc"` | Needs Wave 0 |
| UI-01 | IPC cancel handler cancels active search | unit | `vitest --config vite.main.config.mjs -t "yandex-maps-ipc"` | Needs Wave 0 |
| UI-01 | IPC handler forwards progress via webContents.send | unit | `vitest --config vite.main.config.mjs -t "yandex-maps-ipc"` | Needs Wave 0 |
| UI-02 | Frontend API wrapper calls correct IPC channels | unit | `vitest --config vite.main.config.mjs -t "yandex-maps-api"` | Needs Wave 0 |
| UI-06 | Route entry exists for /yandex-maps-scraper | unit | `vitest --config vite.main.config.mjs -t "yandex-maps-route"` | Needs Wave 0 |

### Sampling Rate
- **Per task commit:** `vitest --config vite.main.config.mjs -t "yandex-maps"`
- **Per wave merge:** `yarn testmain`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/vitest/main/ipc/yandexMaps-ipc.test.ts` -- covers UI-01 (IPC handler validation, start/cancel/progress forwarding)
- [ ] `test/vitest/utilitycode/yandexMapsApi.test.ts` -- covers UI-02 (frontend API wrapper channel calls)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth required for scraper UI |
| V3 Session Management | no | No session management in this phase |
| V4 Access Control | no | No role-based access for scraper |
| V5 Input Validation | yes | IPC handler validates query/location strings, max_results range, boolean toggles |
| V6 Cryptography | no | No crypto operations |

### Known Threat Patterns for Electron + IPC

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IPC channel spoofing | Tampering | preload.ts whitelist arrays prevent unregistered channels |
| XSS via injected search results | Tampering | Vue's template auto-escapes; use `v-text` not `v-html` for business data |
| Input length abuse | Denial of Service | Trim and slice input strings to 255 chars (pattern from googleMaps-ipc.ts line 75-76) |
| Concurrent search abuse | Denial of Service | Enforce MAX_CONCURRENT_SEARCHES limit (pattern from googleMaps-ipc.ts line 35) |

## Sources

### Primary (HIGH confidence)
- src/main-process/communication/googleMaps-ipc.ts -- Full IPC handler pattern (303 lines, read in full)
- src/views/api/googleMaps.ts -- Frontend API wrapper pattern (123 lines, read in full)
- src/views/pages/google-maps-scraper/index.vue -- Complete UI page (667 lines, read in full)
- src/views/router/index.ts -- Route registration pattern (876 lines, read in full)
- src/config/channellist.ts -- Channel constant naming convention (332 lines, read in full)
- src/preload.ts -- IPC whitelist arrays (679 lines, read in full)
- src/modules/YandexMapsModule.ts -- Module API surface (322 lines, read in full)
- src/entityTypes/yandexMapsTypes.ts -- Type contracts from Phase 9 (180 lines, read in full)
- src/views/utils/apirequest.ts -- windowInvoke/windowReceive utilities (54 lines, read in full)
- src/main-process/communication/index.ts -- Handler registration orchestration (79 lines, read in full)

### Secondary (MEDIUM confidence)
- package.json -- Dependency version verification (papaparse ^5.4.1)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in project, verified in package.json
- Architecture: HIGH - Complete reference implementation (Google Maps) exists and was read in full
- Pitfalls: HIGH - Derived from direct observation of the codebase patterns

**Research date:** 2026-05-26
**Valid until:** 2026-06-25 (stable -- mirrors existing codebase patterns)
