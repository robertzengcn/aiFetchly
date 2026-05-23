---
wave: 1
depends_on: []
files_modified:
  - src/entityTypes/googleMapsTypes.ts
  - src/config/skillsRegistry.ts
  - src/service/ToolExecutor.ts
autonomous: true
requirements:
  - FR-1
  - FR-2
  - FR-3
---

# Plan 1: Type Contracts, Skill Registration, and ToolExecutor Dispatch

## Goal

Establish the complete type system and skill registration for Google Maps business scraping. After this plan, `search_google_maps_businesses` appears as a registered skill and ToolExecutor routes it (stub returning "not yet implemented").

## Tasks

### Task 1: Create Google Maps Type Contracts

<read_first>
- src/entityTypes/googleMapsTypes.ts (does not exist yet — create)
- src/entityTypes/scrapeType.ts (existing type file pattern reference)
- src/entityTypes/skillTypes.ts (SkillDefinition interface)
</read_first>

<action>
Create `src/entityTypes/googleMapsTypes.ts` with the following exported types:

1. `GoogleMapsSearchInput` — interface with fields:
   - `query: string` (required)
   - `location: string` (required)
   - `max_results?: number` (optional, default 20)
   - `include_website?: boolean` (optional, default true)
   - `include_reviews?: boolean` (optional, default false)
   - `show_browser?: boolean` (optional, default false)

2. `GoogleMapsBusinessResult` — interface with fields:
   - `name: string`
   - `rating?: string`
   - `review_count?: number`
   - `category?: string`
   - `address?: string`
   - `phone?: string`
   - `website?: string`
   - `maps_url?: string`
   - `place_id?: string`
   - `hours?: string`
   - `latitude?: number`
   - `longitude?: number`

3. `GoogleMapsSearchResult` — interface with fields:
   - `success: boolean`
   - `query: string`
   - `location: string`
   - `totalResults: number`
   - `summary: string`
   - `results: GoogleMapsBusinessResult[]`

4. `GoogleMapsProgressStatus` — type union:
   `"idle" | "validating" | "launching" | "loading" | "extracting" | "completed" | "cancelled" | "failed" | "timed_out"`

5. `GoogleMapsProgressEvent` — interface with fields:
   - `requestId: string`
   - `status: GoogleMapsProgressStatus`
   - `current: number`
   - `total: number`
   - `message: string`

6. `GoogleMapsErrorCode` — type union:
   `"INVALID_INPUT" | "TIMEOUT" | "CANCELLED" | "SCRAPE_FAILED" | "NO_RESULTS" | "UNKNOWN"`

7. `GoogleMapsErrorResponse` — interface with fields:
   - `code: GoogleMapsErrorCode`
   - `message: string`

8. `GOOGLE_MAPS_DEFAULT_MAX_RESULTS = 20` — exported const
9. `GOOGLE_MAPS_HARD_CAP = 50` — exported const

All fields must have JSDoc comments. Use `export` on every type/interface/const.
</action>

<acceptance_criteria>
- `src/entityTypes/googleMapsTypes.ts` exists and exports: `GoogleMapsSearchInput`, `GoogleMapsBusinessResult`, `GoogleMapsSearchResult`, `GoogleMapsProgressStatus`, `GoogleMapsProgressEvent`, `GoogleMapsErrorCode`, `GoogleMapsErrorResponse`, `GOOGLE_MAPS_DEFAULT_MAX_RESULTS`, `GOOGLE_MAPS_HARD_CAP`
- File compiles with `npx tsc --noEmit` (no type errors)
- `GOOGLE_MAPS_DEFAULT_MAX_RESULTS` equals 20
- `GOOGLE_MAPS_HARD_CAP` equals 50
- All exported types have JSDoc comments
</acceptance_criteria>

---

### Task 2: Register search_google_maps_businesses Built-In Skill

<read_first>
- src/config/skillsRegistry.ts (BUILT_IN_SKILLS array — find insertion point near search_yellow_pages)
- src/entityTypes/skillTypes.ts (SkillDefinition interface)
- src/entityTypes/googleMapsTypes.ts (just created — types for parameters schema)
</read_first>

<action>
Add a new skill definition object to the `BUILT_IN_SKILLS` array in `src/config/skillsRegistry.ts`. Insert it after the `search_yellow_pages` entry (they are related scraping tools).

The new entry must be:

```typescript
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

Do NOT modify any existing skill definitions. Only add the new entry.
</action>

<acceptance_criteria>
- `skillsRegistry.ts` contains string `search_google_maps_businesses` in the BUILT_IN_SKILLS array
- The new entry has `permissionCategory: "automation"`
- The new entry has `source: "built-in"`
- The new entry has `tier: "main"`
- The new entry has `required: ["query", "location"]` in parameters
- The execute function delegates to `ToolExecutor.execute("search_google_maps_businesses", args, context.conversationId)`
- `npx tsc --noEmit` passes with no errors
- All existing skill definitions unchanged (git diff shows only additive changes)
</acceptance_criteria>

---

### Task 3: Add ToolExecutor Dispatch Case

<read_first>
- src/service/ToolExecutor.ts (full file — find the switch statement in executeInternal and the executeYellowPagesSearch method as pattern reference)
- src/entityTypes/googleMapsTypes.ts (types for validation)
</read_first>

<action>
Add a new case in the `executeInternal` switch statement in `src/service/ToolExecutor.ts`:

1. Add the import at the top of the file (near other imports from entityTypes):
```typescript
import {
  GOOGLE_MAPS_DEFAULT_MAX_RESULTS,
  GOOGLE_MAPS_HARD_CAP,
  type GoogleMapsSearchInput,
  type GoogleMapsSearchResult,
  type GoogleMapsErrorResponse,
} from "@/entityTypes/googleMapsTypes";
```

2. Add a new case in the switch statement in `executeInternal()`, after the `extract_contact_info` case:
```typescript
case "search_google_maps_businesses":
  return await this.executeGoogleMapsSearch(toolParams);
```

3. Add a new private static method `executeGoogleMapsSearch` following the same pattern as `executeYellowPagesSearch`:

```typescript
/**
 * Execute Google Maps business search (stub — module not yet implemented)
 */
private static async executeGoogleMapsSearch(
  toolParams: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const query = typeof toolParams.query === "string" ? toolParams.query : "";
  const location = typeof toolParams.location === "string" ? toolParams.location : "";
  const maxResults = typeof toolParams.max_results === "number" ? toolParams.max_results : GOOGLE_MAPS_DEFAULT_MAX_RESULTS;

  if (!query.trim()) {
    return {
      success: false,
      error: "query is required and must not be blank",
    } as Record<string, unknown>;
  }

  if (!location.trim()) {
    return {
      success: false,
      error: "location is required and must not be blank",
    } as Record<string, unknown>;
  }

  // Clamp max_results to hard cap
  const clampedMaxResults = Math.min(Math.max(1, maxResults), GOOGLE_MAPS_HARD_CAP);

  // Phase 1 stub — GoogleMapsModule will be implemented in Phase 2
  return {
    success: false,
    error: "Google Maps scraping is not yet implemented. This skill is registered but the scraping module has not been built.",
    query,
    location,
    max_results: clampedMaxResults,
  };
}
```

Do NOT modify any existing switch cases or methods.
</action>

<acceptance_criteria>
- `ToolExecutor.ts` imports from `@/entityTypes/googleMapsTypes` (at least `GOOGLE_MAPS_DEFAULT_MAX_RESULTS`, `GOOGLE_MAPS_HARD_CAP`)
- `executeInternal` switch has case `"search_google_maps_businesses"`
- Case delegates to `this.executeGoogleMapsSearch(toolParams)`
- `executeGoogleMapsSearch` method exists and is `private static async`
- Method validates `query` is non-blank string, returns `{ success: false, error: "query is required..." }` if blank
- Method validates `location` is non-blank string, returns `{ success: false, error: "location is required..." }` if blank
- Method clamps `max_results` between 1 and `GOOGLE_MAPS_HARD_CAP` (50)
- Method returns `{ success: false, error: "Google Maps scraping is not yet implemented..." }` as stub
- `npx tsc --noEmit` passes with no errors
- All existing switch cases unchanged
</acceptance_criteria>

---

## Verification

After all tasks complete:

1. Run `npx tsc --noEmit` — must pass with zero errors
2. Grep for `search_google_maps_businesses` in `src/config/skillsRegistry.ts` — must find the new entry
3. Grep for `search_google_maps_businesses` in `src/service/ToolExecutor.ts` — must find the switch case
4. Grep for `GoogleMapsSearchInput` in `src/entityTypes/googleMapsTypes.ts` — must find the type export
5. Verify `GOOGLE_MAPS_HARD_CAP` equals 50 in the types file

## Must-Haves

- [ ] `googleMapsTypes.ts` exports all 7 types + 2 constants
- [ ] `search_google_maps_businesses` appears in `BUILT_IN_SKILLS` array with `automation` permission
- [ ] `ToolExecutor.executeInternal` routes `search_google_maps_businesses` to a handler method
- [ ] Handler validates input and returns stub error for Phase 2
- [ ] TypeScript compilation passes with no errors
- [ ] No existing functionality is broken (only additive changes)
