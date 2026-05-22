# AI Skills Technical Advice

This directory contains planning and technical guidance for aiFetchly's AI
skills system.

## Google Maps Scraping Built-In Skill

For a Google Maps scraping capability that AI can invoke, prefer a **built-in
skill** instead of an installable plugin. Google Maps scraping needs browser
automation, proxy/session control, rate limiting, structured extraction, and
risk-aware permissions. Those concerns fit better inside aiFetchly's built-in
skill infrastructure than inside a user-installed marketplace skill.

Recommended AI-facing skill name:

```text
search_google_maps_businesses
```

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

Use `automation` rather than only `network`, because the skill controls a
browser and scrapes an interactive site.

Suggested input contract:

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

Suggested result contract:

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

Recommended execution flow:

```text
skillsRegistry.ts
  -> SkillExecutor
  -> ToolExecutor
  -> GoogleMapsModule
  -> childprocess Google Maps scraper
  -> structured JSON result
```

Recommended file placement:

- `src/config/skillsRegistry.ts`: register the built-in skill metadata.
- `src/config/aiTools.config.ts`: expose the same function definition to the AI tool list if required by the current AI flow.
- `src/service/ToolExecutor.ts`: add dispatch, validation, rate limiting, and result formatting.
- `src/modules/GoogleMapsModule.ts`: orchestrate the scraping workflow.
- `src/childprocess/google-maps/GoogleMapsWorker.ts`: run Puppeteer scraping outside the main process.
- `src/entityTypes/googleMapsTypes.ts`: define strict TypeScript input and output types.

Keep real scraping logic out of `skillsRegistry.ts`. The registry should
describe the skill and delegate execution through `ToolExecutor`, similar to
existing built-in skills.

The built-in skill `execute` function should delegate:

```typescript
execute: async (args, context) => {
  const result = await ToolExecutor.execute(
    "search_google_maps_businesses",
    args,
    context.conversationId
  );

  return { success: true, result };
}
```

Create a dedicated Google Maps scraper instead of extending the normal Google
search scraper directly. Google Maps has a different page structure, scroll
model, detail panel, and anti-bot profile than standard Google search results.

Basic scraping flow:

1. Open `https://www.google.com/maps/search/{query}+{location}`.
2. Wait for the Maps result feed.
3. Scroll the feed until `max_results` is reached or no new cards appear.
4. Open each business card detail panel.
5. Extract name, rating, reviews, category, address, phone, website, hours, and Maps URL.
6. Normalize and deduplicate records.
7. Return structured JSON.

Do not ask the AI model to parse HTML. The scraper should produce clean, typed
data before returning anything to the AI.

Use a child process or worker for Puppeteer work. The worker should perform
browser automation only. Keep database operations in the main process; workers
should not access TypeORM, `SqliteDb`, or app database paths directly. If
persistence is needed, send results back to the main process and save them
through a Module/Model layer.

For a first version, prefer returning results directly to the AI without adding
new database tables. Add task history or persistence later only if the UI needs
it.

Use conservative safety defaults:

- Default `max_results`: 20.
- Hard cap: 50 for AI-invoked calls.
- Concurrency: 1 for Google Maps.
- Add a delay between detail page/card visits.
- Add a Maps-specific rate limiter in `ToolExecutor`.
- Support `show_browser` for debugging, defaulting to hidden browser mode.

If this becomes production-critical, design `GoogleMapsModule` so it can support
both browser scraping and the official Google Places API:

```typescript
type GoogleMapsDataSource = "browser_scrape" | "places_api";
```

Browser scraping is useful for quick implementation and richer visible-page
data. Google Places API is more stable, compliant, and production-friendly, but
requires API keys and paid usage. The best long-term design is a shared
`GoogleMapsModule` result interface with the data source selected internally by
configuration.

Implementation order:

1. Define strict input/output types in `src/entityTypes/googleMapsTypes.ts`.
2. Add the built-in skill in `src/config/skillsRegistry.ts`.
3. Add the AI tool function in `src/config/aiTools.config.ts` if needed.
4. Add `search_google_maps_businesses` dispatch in `ToolExecutor`.
5. Build `GoogleMapsModule` as the orchestration layer.
6. Build the child process scraper with Puppeteer.
7. Add rate limiting, result caps, and timeout handling.
8. Add tests around argument validation, result normalization, and `ToolExecutor` dispatch.

Final recommended shape:

```text
search_google_maps_businesses
  -> ToolExecutor
  -> GoogleMapsModule
  -> Google Maps worker scraper
  -> structured business results
```
