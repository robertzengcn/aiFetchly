# Combined Map Scraper Page Design

## Goal

Combine the separate Google Maps and Yandex Maps scraper pages into one visible Map Scraper route with a provider switch, while preserving existing Google and Yandex deep links.

## Scope

The combined page will live as the primary `/map-scraper` UI. It will support Google Maps and Yandex Maps searches from the same search, results, and history experience. The existing `/map-scraper/google` and `/map-scraper/yandex` routes will remain hidden from the menu and load the combined page with the matching provider selected.

No backend scraper behavior, IPC channel names, database entities, or worker process contracts will change.

## User Experience

The page header will present the feature as "Map Scraper" and describe searching local businesses across map providers. A segmented provider control will let the user switch between Google Maps and Yandex Maps.

Shared controls:

- Business keyword
- Location
- Maximum results
- Include website
- Include reviews
- Show browser
- Provider account
- Proxies

Yandex-only controls:

- Language
- Region

The Search and History tabs remain. The selected provider controls which API wrapper is used, which account type is loaded, which history records are shown, and which provider name appears in results/export text.

## Routing

The visible menu entry will be `/map-scraper`. It will render the combined page and default to Google Maps.

The hidden child routes will continue to work:

- `/map-scraper/google` renders the same page with Google Maps selected.
- `/map-scraper/yandex` renders the same page with Yandex Maps selected.

## Architecture

Create `src/views/pages/map-scraper/index.vue` as the combined implementation. It will import both existing API wrappers and dispatch through provider-aware helper functions. It will use provider-specific types only at API boundaries and normalize display data enough for a shared result table.

Routing in `src/views/router/index.ts` will point the visible parent route to the combined page, hide provider children, and pass the initial provider as route props.

Existing separate page files may remain in the repository, but the router should no longer expose them in the visible menu.

## Internationalization

Add a new `mapScraper` translation group in all supported language files:

- `src/views/lang/en.ts`
- `src/views/lang/zh.ts`
- `src/views/lang/es.ts`
- `src/views/lang/fr.ts`
- `src/views/lang/de.ts`
- `src/views/lang/ja.ts`

The combined page must use these translations for all new user-facing strings. Existing `googleMaps` and `yandexMaps` strings can remain for backward compatibility.

## Testing

Verification will include:

- TypeScript/Vue checking for the edited page and route wiring.
- A focused runtime smoke check if the dev server can be started.
- Manual route inspection for `/map-scraper`, `/map-scraper/google`, and `/map-scraper/yandex` if browser tooling is available.

The implementation must not introduce direct database access in IPC handlers or worker processes.
