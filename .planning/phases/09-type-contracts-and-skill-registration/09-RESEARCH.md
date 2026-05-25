# Phase 9: Type Contracts and Skill Registration - Research

**Researched:** 2026-05-26
**Domain:** TypeScript type contracts, skill registry integration, tool dispatch
**Confidence:** HIGH

## Summary

Phase 9 creates the type contracts and AI skill registration for the Yandex Maps business scraper. This phase mirrors Phase 1 (Google Maps) almost exactly. The codebase already has a proven, shipping pattern in `googleMapsTypes.ts`, `skillsRegistry.ts`, and `ToolExecutor.ts` that this phase must replicate for Yandex Maps.

The core deliverables are: (1) a `yandexMapsTypes.ts` file in `src/entityTypes/` with input, output, progress, and error types; (2) a skill registration entry in `skillsRegistry.ts` BUILT_IN_SKILLS array; and (3) a dispatch case in `ToolExecutor.ts` with input validation and the 50-result hard cap.

**Primary recommendation:** Copy the Google Maps pattern verbatim, substituting Yandex-specific fields (language, region, yandex_id, captcha error codes) and adding the new fields called out in the requirements. Do not invent new patterns -- the Google Maps implementation is the canonical reference.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TYPE-01 | Define YandexMapsSearchInput type with query, location, max_results, include_website, include_reviews, language, region, show_browser | GoogleMapsSearchInput in `src/entityTypes/googleMapsTypes.ts` is the exact template. Add `language` (string, optional) and `region` (string, optional) fields not present in Google variant. |
| TYPE-02 | Define YandexMapsBusinessResult type with name, rating, review_count, category, address, phone, website, maps_url, yandex_id, hours, lat/lng | GoogleMapsBusinessResult is the template. Replace `place_id` with `yandex_id` (string, optional). Use `latitude`/`longitude` (not `lat`/`lng`) to match the Google naming convention. |
| TYPE-03 | Define YandexMapsSearchResult type with success, query, location, totalResults, summary, results array | GoogleMapsSearchResult is a 1:1 template -- identical structure, just swap the result array element type. |
| TYPE-04 | Define progress event types for scraping states (idle, validating, launching, loading, extracting, completed, cancelled, failed, captcha, timeout) | GoogleMapsProgressStatus has: idle, validating, launching, navigating, loading, extracting, completed, cancelled, failed, timed_out. Add `captcha` status, consider keeping `timed_out` vs renaming to `timeout`. |
| TYPE-05 | Define typed error codes for captcha, timeout, no results, network failure, layout change, cancelled | GoogleMapsErrorCode has: INVALID_INPUT, TIMEOUT, CANCELLED, SCRAPE_FAILED, NO_RESULTS, UNKNOWN. Add CAPTCHA, NETWORK_FAILURE, LAYOUT_CHANGE. |
| SKILL-01 | Register search_yandex_maps_businesses in skillsRegistry with automation permission and JSON Schema parameters | BUILT_IN_SKILLS array in `src/config/skillsRegistry.ts`. Pattern: SkillDefinition with name, description, parameters (JSON Schema), tier: "main", permissionCategory: "automation", source: "built-in", execute wrapping ToolExecutor.execute(). |
| SKILL-02 | Add ToolExecutor dispatch with input validation, rate limiting, and 50-result hard cap | executeGoogleMapsSearch in `src/service/ToolExecutor.ts` is the template. Add a case in the switch statement, an executeYandexMapsSearch private method, a rate limit config entry, and a YANDEX_MAPS_HARD_CAP constant. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Type contracts (input/output/progress/error) | Shared (entityTypes) | -- | Types are imported by main process, worker, and UI -- must live in shared entityTypes directory |
| Skill registration | Main process (config) | -- | skillsRegistry.ts runs in main process, maps skill names to executor functions |
| Tool dispatch | Main process (service) | -- | ToolExecutor.ts runs in main process, handles validation and rate limiting before spawning worker |
| Rate limiting | Main process (service) | -- | RateLimiterManager lives inside ToolExecutor.ts, enforces per-tool limits |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.x | Type system for contracts | Project-wide standard, enforced by CLAUDE.md |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| uuid | (installed) | Generate requestId for progress tracking | Already used by Google Maps pattern |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Static type file | Zod runtime schemas | Zod adds a dependency for validation that TypeScript already provides at compile time. The existing pattern uses TypeScript interfaces + manual validation in ToolExecutor. Keep consistent. |

**Installation:**
```bash
# No new packages needed -- this phase is pure TypeScript types and wiring
```

## Architecture Patterns

### System Architecture Diagram

```
AI Chat Request (LLM tool call)
       |
       v
skillsRegistry.ts
  |-- BUILT_IN_SKILLS array contains search_yandex_maps_businesses SkillDefinition
  |-- execute() callback invokes ToolExecutor.execute()
       |
       v
ToolExecutor.ts
  |-- RateLimiterManager.getLimiter() acquires rate limit slot
  |-- executeInternal() switch statement matches "search_yandex_maps_businesses"
  |-- executeYandexMapsSearch() validates input, clamps max_results to YANDEX_MAPS_HARD_CAP
       |
       v
YandexMapsModule (Phase 10 -- not in this phase)
  |-- Spawns child process worker
  |-- Returns YandexMapsSearchResult
       |
       v
YandexMapsSearchResult typed response back to AI chat
```

### Recommended Project Structure
```
src/
+-- entityTypes/
|   +-- yandexMapsTypes.ts          # NEW: Input, output, progress, error types + constants
+-- config/
|   +-- skillsRegistry.ts           # MODIFY: Add skill entry to BUILT_IN_SKILLS
+-- service/
    +-- ToolExecutor.ts             # MODIFY: Add case + dispatch method + rate limit config
```

### Pattern 1: Type Contract File (entityTypes)
**What:** A single file in `src/entityTypes/` exporting all related interfaces, type aliases, and constants for a scraper feature.
**When to use:** Every scraper feature (Google Maps, Yellow Pages, Yandex Maps) follows this pattern.
**Example:**
```typescript
// src/entityTypes/yandexMapsTypes.ts (mirroring googleMapsTypes.ts)

/** Parameters for a Yandex Maps business search request. */
export interface YandexMapsSearchInput {
  query: string;
  location: string;
  max_results?: number;
  include_website?: boolean;
  include_reviews?: boolean;
  /** Language for Yandex Maps UI (e.g., "ru", "en", "tr"). Defaults to "ru". */
  language?: string;
  /** Region code for search context (e.g., "ru", "kz", "by"). */
  region?: string;
  show_browser?: boolean;
}

export const YANDEX_MAPS_DEFAULT_MAX_RESULTS = 20;
export const YANDEX_MAPS_HARD_CAP = 50;
```
[VERIFIED: src/entityTypes/googleMapsTypes.ts -- confirmed naming, structure, constant pattern]

### Pattern 2: Skill Registration (skillsRegistry.ts)
**What:** Add a `SkillDefinition` object to the `BUILT_IN_SKILLS` array.
**When to use:** Every built-in AI tool follows this pattern.
**Example:**
```typescript
// In BUILT_IN_SKILLS array in skillsRegistry.ts
{
  name: "search_yandex_maps_businesses",
  description: "Search Yandex Maps for local businesses...",
  parameters: {
    type: "object",
    properties: { /* JSON Schema matching the TypeScript input type */ },
    required: ["query", "location"],
  },
  tier: "main",
  requiresConfirmation: false,
  permissionCategory: "automation",
  source: "built-in",
  execute: async (args, context) => {
    const result = await ToolExecutor.execute(
      "search_yandex_maps_businesses",
      args,
      context.conversationId
    );
    return { success: true, result };
  },
}
```
[VERIFIED: src/config/skillsRegistry.ts lines 183-239 -- Google Maps skill registration]

### Pattern 3: ToolExecutor Dispatch
**What:** Add a case to the switch statement and a private static method for execution.
**When to use:** Every tool the AI can call goes through ToolExecutor.
**Example:**
```typescript
// In executeInternal() switch statement
case "search_yandex_maps_businesses":
  return await this.executeYandexMapsSearch(toolParams);

// Private static method
private static async executeYandexMapsSearch(
  toolParams: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const query = typeof toolParams.query === "string" ? toolParams.query : "";
  const location = typeof toolParams.location === "string" ? toolParams.location : "";
  const maxResults = typeof toolParams.max_results === "number"
    ? toolParams.max_results : YANDEX_MAPS_DEFAULT_MAX_RESULTS;

  if (!query.trim()) {
    return { success: false, error: "query is required and must not be blank" };
  }
  if (!location.trim()) {
    return { success: false, error: "location is required and must not be blank" };
  }

  const clampedMaxResults = Math.min(Math.max(1, maxResults), YANDEX_MAPS_HARD_CAP);

  // In Phase 10, this will call YandexMapsModule.executeSearch()
  // For Phase 9, return a stub or throw "not implemented"
  // ...
}
```
[VERIFIED: src/service/ToolExecutor.ts lines 1192-1253 -- executeGoogleMapsSearch pattern]

### Anti-Patterns to Avoid
- **Inventing new field names:** Must match the exact naming from the requirements (e.g., `yandex_id` not `yandex_place_id`, `language` not `locale`).
- **Skipping the hard cap:** The 50-result cap must be enforced identically to Google Maps. It prevents the AI from requesting unbounded scraping.
- **Putting validation in skillsRegistry:** The registry's `execute` callback only wraps `ToolExecutor.execute()`. All validation happens inside ToolExecutor, not in the registry.
- **Using `any` type:** CLAUDE.md explicitly forbids `any`. All toolParams fields must be validated with `typeof` checks.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rate limiting | Custom rate limiter per tool | Existing `RateLimiter` class + `RateLimiterManager` | Already in ToolExecutor.ts, supports per-minute, concurrent, and cooldown |
| Skill registration | Custom registration system | `BUILT_IN_SKILLS` array in skillsRegistry.ts | Proven pattern for all built-in skills |
| Tool dispatch | Custom dispatch routing | ToolExecutor.execute() + executeInternal() switch | Central dispatch with rate limiting built in |

**Key insight:** Phase 9 is purely structural (types + wiring). The actual YandexMapsModule implementation comes in Phase 10. The dispatch method should validate inputs and either call the module (if it exists) or provide a clear "not yet implemented" path that Phase 10 will complete.

## Common Pitfalls

### Pitfall 1: Forgetting to add rate limit config for Yandex Maps
**What goes wrong:** Google Maps falls through to default rate limit config because `getRateLimitConfig` has no explicit `search_google_maps_businesses` match. Yandex Maps should get its own entry.
**Why it happens:** The rate limit config uses string matching (toolName.includes(...)) rather than exact match.
**How to avoid:** Add an explicit `yandexMaps` entry in `RATE_LIMIT_CONFIG` and add a matching condition in `getRateLimitConfig` for tool names containing "yandex_maps" or "yandexmaps".
**Warning signs:** Rate limiting appears too permissive or too restrictive for Yandex Maps calls.

### Pitfall 2: Mismatch between TypeScript types and JSON Schema parameters
**What goes wrong:** The TypeScript `YandexMapsSearchInput` interface has fields that don't appear in the JSON Schema `parameters` in skillsRegistry, or vice versa.
**Why it happens:** Two separate definitions that must be kept in sync manually.
**How to avoid:** After writing both, cross-check every field name and type. The JSON Schema must be a superset (it describes what the LLM can send); the TypeScript type defines what the code expects.
**Warning signs:** AI sends a parameter that TypeScript code ignores, or TypeScript expects a field the LLM never provides.

### Pitfall 3: Using wrong error codes for Yandex-specific failures
**What goes wrong:** Yandex Maps has captcha detection and layout changes that Google Maps doesn't explicitly handle. Using `SCRAPE_FAILED` for captcha hides the real failure mode.
**Why it happens:** Copy-pasting Google Maps error codes without adding Yandex-specific ones.
**How to avoid:** Add `CAPTCHA`, `NETWORK_FAILURE`, and `LAYOUT_CHANGE` error codes per the requirements. The worker (Phase 10) will use these codes to give the AI meaningful failure information.
**Warning signs:** All Yandex failures appear as "SCRAPE_FAILED" or "UNKNOWN" in AI responses.

### Pitfall 4: Phase 10 dependency -- dispatch calling non-existent module
**What goes wrong:** The executeYandexMapsSearch method tries to import or instantiate YandexMapsModule, which doesn't exist yet in Phase 9.
**Why it happens:** Copying the Google Maps dispatch which creates `new GoogleMapsModule()`.
**How to avoid:** In Phase 9, the dispatch method should validate inputs and clamp the cap, but the actual module call should either be stubbed (return a placeholder success) or throw a clear "YandexMapsModule not yet implemented" error that Phase 10 will replace with the real call.
**Warning signs:** TypeScript compilation errors referencing non-existent YandexMapsModule.

## Code Examples

Verified patterns from the existing codebase:

### Type Contract File Structure (from googleMapsTypes.ts)
```typescript
// src/entityTypes/googleMapsTypes.ts [VERIFIED: read from codebase]

// Input interface with JSDoc comments on every field
export interface GoogleMapsSearchInput {
  query: string;
  location: string;
  max_results?: number;
  include_website?: boolean;
  include_reviews?: boolean;
  show_browser?: boolean;
  proxy_ids?: number[];
}

// Single business result
export interface GoogleMapsBusinessResult {
  name: string;
  rating?: string;          // String, not number (e.g. "4.5")
  review_count?: number;
  category?: string;
  address?: string;
  phone?: string;
  website?: string;
  maps_url?: string;
  place_id?: string;        // Google-specific ID
  hours?: string;
  latitude?: number;
  longitude?: number;
}

// Search result envelope
export interface GoogleMapsSearchResult {
  success: boolean;
  query: string;
  location: string;
  totalResults: number;
  summary: string;          // For LLM consumption
  results: GoogleMapsBusinessResult[];
}

// Progress status union type
export type GoogleMapsProgressStatus =
  | "idle" | "validating" | "launching" | "navigating"
  | "loading" | "extracting" | "completed"
  | "cancelled" | "failed" | "timed_out";

// Progress event interface
export interface GoogleMapsProgressEvent {
  requestId: string;
  status: GoogleMapsProgressStatus;
  current: number;
  total: number;
  message: string;
}

// Error codes union type
export type GoogleMapsErrorCode =
  | "INVALID_INPUT" | "TIMEOUT" | "CANCELLED"
  | "SCRAPE_FAILED" | "NO_RESULTS" | "UNKNOWN";

// Error response interface
export interface GoogleMapsErrorResponse {
  code: GoogleMapsErrorCode;
  message: string;
}

// Constants
export const GOOGLE_MAPS_DEFAULT_MAX_RESULTS = 20;
export const GOOGLE_MAPS_HARD_CAP = 50;
```

### Skill Registration (from skillsRegistry.ts)
```typescript
// src/config/skillsRegistry.ts lines 183-239 [VERIFIED: read from codebase]
{
  name: "search_google_maps_businesses",
  description:
    "Search Google Maps for local businesses by keyword and location. Returns structured business data including name, rating, review count, category, address, phone, website, and Google Maps URL. Use this for finding local businesses, lead generation, and market research.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Business keyword or category to search for (e.g., 'dentist', 'Italian restaurant', 'plumber')",
      },
      location: {
        type: "string",
        description: "Target location for the search (e.g., 'New York', 'London, UK', '90210')",
      },
      max_results: {
        type: "number",
        description: "Maximum number of business results to return (default: 20, max: 50)",
        default: 20,
      },
      include_website: {
        type: "boolean",
        description: "Whether to extract website URLs from business listings (default: true)",
        default: true,
      },
      include_reviews: {
        type: "boolean",
        description: "Whether to include review count in results (default: false)",
        default: false,
      },
      show_browser: {
        type: "boolean",
        description: "Whether to show the browser window during scraping for debugging (default: false)",
        default: false,
      },
    },
    required: ["query", "location"],
  },
  tier: "main",
  requiresConfirmation: false,
  permissionCategory: "automation",
  source: "built-in",
  execute: async (args, context) => {
    const result = await ToolExecutor.execute(
      "search_google_maps_businesses",
      args,
      context.conversationId
    );
    return { success: true, result };
  },
}
```

### ToolExecutor Dispatch Pattern (from ToolExecutor.ts)
```typescript
// src/service/ToolExecutor.ts [VERIFIED: read from codebase]

// 1. Import constants from types file
import {
  GOOGLE_MAPS_DEFAULT_MAX_RESULTS,
  GOOGLE_MAPS_HARD_CAP,
} from "@/entityTypes/googleMapsTypes";
import { GoogleMapsModule } from "@/modules/GoogleMapsModule";

// 2. Add rate limit config (note: Google Maps currently falls to default)
const RATE_LIMIT_CONFIG = {
  // ... existing entries ...
  yandexMaps: {           // NEW for Yandex
    maxPerMinute: 10,
    maxConcurrent: 2,
    cooldownMs: 2000,
  },
  default: {
    maxPerMinute: 30,
    maxConcurrent: 5,
    cooldownMs: 200,
  },
} as const;

// 3. Update getRateLimitConfig to match Yandex tool names
// In getRateLimitConfig():
//   } else if (toolName.includes("yandex_maps") || toolName.includes("yandexmaps")) {
//     return RATE_LIMIT_CONFIG.yandexMaps;
//   }

// 4. Add case in executeInternal() switch
//   case "search_yandex_maps_businesses":
//     return await this.executeYandexMapsSearch(toolParams);

// 5. Implement the dispatch method (stub for Phase 9)
private static async executeYandexMapsSearch(
  toolParams: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const query = typeof toolParams.query === "string" ? toolParams.query : "";
  const location = typeof toolParams.location === "string" ? toolParams.location : "";
  const maxResults = typeof toolParams.max_results === "number"
    ? toolParams.max_results : YANDEX_MAPS_DEFAULT_MAX_RESULTS;

  if (!query.trim()) {
    return { success: false, error: "query is required and must not be blank" };
  }
  if (!location.trim()) {
    return { success: false, error: "location is required and must not be blank" };
  }

  const clampedMaxResults = Math.min(
    Math.max(1, maxResults),
    YANDEX_MAPS_HARD_CAP
  );

  // Phase 10 will replace this with real YandexMapsModule call
  return {
    success: false,
    error: "Yandex Maps scraping not yet implemented (Phase 10)",
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tool functions in aiTools.config.ts | Skill definitions in skillsRegistry.ts | v1.0 skill system | Skills have permission categories, tiers, and sources; aiTools.config.ts still has static tools for legacy |
| No rate limiting | RateLimiterManager per tool | v1.0 ToolExecutor | All tool dispatches go through rate limiting automatically |

**Deprecated/outdated:**
- `AVAILABLE_TOOL_FUNCTIONS` in aiTools.config.ts: marked as `@deprecated`, replaced by `getAvailableToolFunctions()` which merges MCP tools.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Yandex Maps dispatch should have its own rate limit config (10/min, 2 concurrent, 2000ms cooldown) rather than falling through to default | Standard Stack / Code Examples | Too restrictive or too permissive rate limiting |
| A2 | Phase 9 dispatch should return a "not yet implemented" error rather than trying to import a non-existent YandexMapsModule | Code Examples | Compilation error or runtime crash if trying to import module that doesn't exist yet |
| A3 | `language` field defaults to "ru" (Russian) since Yandex Maps primarily serves Russian/CIS markets | Phase Requirements | Wrong default if users primarily search non-Russian markets |
| A4 | Progress status should include both `captcha` (new) and `timed_out` (from Google pattern) -- the requirements say "timeout" but existing pattern uses `timed_out` | TYPE-04 | Inconsistent naming with Google Maps pattern if we use `timeout` instead of `timed_out` |

## Open Questions

1. **Progress status naming: `timeout` vs `timed_out`?**
   - What we know: Requirements say "timeout" but Google Maps pattern uses "timed_out"
   - What's unclear: Whether to match requirements exactly or follow existing codebase convention
   - Recommendation: Use `timed_out` to match Google Maps pattern; the union type literal matters for consistency

2. **Should the Phase 9 dispatch stub be a "not implemented" error or a placeholder success?**
   - What we know: Phase 10 will implement the real module
   - What's unclear: Whether tests or AI calls during Phase 9 need to succeed
   - Recommendation: Return `{ success: false, error: "not yet implemented" }` -- this is clearer and prevents false positives

3. **Should `language` have an enum of supported values or be free-form string?**
   - What we know: Yandex Maps supports many languages; the requirement says just "language"
   - What's unclear: Whether to restrict to known Yandex-supported languages
   - Recommendation: Free-form string with JSDoc noting common values ("ru", "en", "tr", "uk") -- more flexible, avoids maintenance burden

## Environment Availability

Step 2.6: SKIPPED (no external dependencies identified -- this phase is pure TypeScript type definitions and config file modifications)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (for unit tests of types and dispatch) |
| Config file | vitest.config.* (existing) |
| Quick run command | `yarn vitest-utilitycode` or `npx vitest run test/vitest/` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TYPE-01 | YandexMapsSearchInput type compiles with all fields | unit (compile-time) | `yarn tsc` | No -- Wave 0 |
| TYPE-02 | YandexMapsBusinessResult type compiles with all fields | unit (compile-time) | `yarn tsc` | No -- Wave 0 |
| TYPE-03 | YandexMapsSearchResult type compiles | unit (compile-time) | `yarn tsc` | No -- Wave 0 |
| TYPE-04 | Progress event types cover all scraping states | unit | `npx vitest run test/vitest/utilitycode/yandexMapsTypes.test.ts` | No -- Wave 0 |
| TYPE-05 | Error codes cover all failure cases | unit | `npx vitest run test/vitest/utilitycode/yandexMapsTypes.test.ts` | No -- Wave 0 |
| SKILL-01 | Skill appears in registry with correct metadata | unit | `npx vitest run test/vitest/main/skillRegistry.test.ts` | No -- Wave 0 |
| SKILL-02 | ToolExecutor validates input, enforces cap, rate limits | unit | `npx vitest run test/vitest/main/toolExecutorYandex.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `yarn tsc` (type check) + relevant vitest file
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full type check green + all new tests green

### Wave 0 Gaps
- [ ] `test/vitest/utilitycode/yandexMapsTypes.test.ts` -- covers TYPE-01 through TYPE-05 (type shape validation, constant values, exhaustive union checks)
- [ ] `test/vitest/main/toolExecutorYandex.test.ts` -- covers SKILL-02 (input validation, hard cap, rate limiting behavior)

## Sources

### Primary (HIGH confidence)
- `src/entityTypes/googleMapsTypes.ts` -- read in full, exact template for type contracts
- `src/config/skillsRegistry.ts` lines 183-239 -- read in full, exact template for skill registration
- `src/service/ToolExecutor.ts` lines 29-132, 183-184, 1192-1253 -- read in full, exact template for dispatch
- `src/entityTypes/skillTypes.ts` lines 55-110 -- read in full, SkillDefinition interface shape
- `src/service/RateLimiter.ts` -- read in full, rate limiting API
- `src/main-process/communication/googleMaps-ipc.ts` -- read in full, IPC pattern reference

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` -- requirement definitions for TYPE-01 through SKILL-02
- `.planning/ROADMAP.md` -- phase boundaries and success criteria
- `.planning/STATE.md` -- project decisions and current position

### Tertiary (LOW confidence)
- None -- all findings verified against codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, mirroring existing codebase exactly
- Architecture: HIGH - all three target files read and patterns documented with line numbers
- Pitfalls: HIGH - based on direct observation of Google Maps pattern and known Phase 10 dependency gap

**Research date:** 2026-05-26
**Valid until:** 2026-06-25 (stable -- no external dependencies or fast-moving libraries)
