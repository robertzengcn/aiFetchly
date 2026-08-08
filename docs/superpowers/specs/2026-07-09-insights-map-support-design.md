# Contact Profile Insights — Google Map / Yandex Map Insight Types

**Date:** 2026-07-09
**Status:** Approved
**Scope:** Add `google map` and `yandex map` as new "Insight Type" options on the Contact Profile Insights page (email extraction). When chosen, the user selects an existing Google/Yandex Maps scraper record, and the system extracts business `website` URLs from that record to feed the contact-profile-insights pipeline.

---

## 1. Background & Current Behavior

The "Contact Profile Insights" page is `src/views/pages/emailextraction/index.vue` (i18n confirms: `extraction_type: "Insight Type"`, `create_task: "Create Contact Profile Insights Task"`).

The "Insight Type" dropdown (`emailtype`) is populated from the `EmailExtractionTypes` enum via `ToArray()`:

```ts
// src/config/emailextraction.ts
export enum EmailExtractionTypes {
  ManualInputUrl = 1, // dropdown index 0 — textarea of URLs
  SearchResult = 2,   // dropdown index 1 — pick a search task
}
```

`ToArray()` returns the enum **name** strings: `["ManualInputUrl", "SearchResult"]`. Each dropdown option carries `{ name, key: <enum name>, index }`. The selected `key` is sent to the backend as `extratype`.

### Existing data flow (SearchResult type)

1. **Frontend** (`emailextraction/index.vue`): user picks a search task via `SearchResultSelectTable`; `searchtaskId` holds the task id. On submit, builds `EmailscFormdata { extratype: "SearchResult", searchTaskId, ... }`.
2. **Backend** (`src/main-process/communication/emailextraction-ipc.ts`, `EMAILEXTRACTIONAPI` handler): for `"SearchResult"`, calls `new SearchResultModule().getAllSearchResultsByTaskId(searchTaskId)` then `resolveSearchResultUrls(results)` (in `emailExtractionSearchResultUrls.ts`) to obtain website URLs. Builds `EmailsControldata { searchResultId, validUrls, type: EmailExtractionTypes.SearchResult, ... }` and calls `EmailextractionController.searchEmail(datas)`.
3. **Persistence** (`EmailSearchTaskModule`): stores `task.search_result_id = data.searchResultId` and `task.type_id = data.type`. `getEmailSearchTask` returns `searchResultId` and `type_id`, so edit mode round-trips.
4. **Edit mode** (`loadTaskData`): currently maps `type_id` to dropdown index via `task.type_id === EmailExtractionTypes.SearchResult ? 1 : 0`.

### Maps data already available

- `GoogleMapsModule.getSearchRecord(id)` / `YandexMapsModule.getSearchRecord(id)` return the full record entity, including `results` — a JSON string of `GoogleMapsBusinessResult[]` / `YandexMapsBusinessResult[]`. Each business result has an optional `website?: string` field.
- `src/views/pages/google-maps-scraper/widgets/GoogleMapsSelectTable.vue` and `src/views/pages/yandex-maps-scraper/widgets/YandexMapsSelectTable.vue` **already exist**. They are single-select, server-paginated tables listing maps history records; they emit `change` with the selected record and accept a `selectedValue` prop — the same component contract as `SearchResultSelectTable`.

---

## 2. Approach

**Reuse `search_result_id` + `type_id`, mirror the `SearchResult` flow.** Add `GoogleMaps=3` / `YandexMaps=4` to the enum. The selected maps record id is stored in the existing `search_result_id` column, discriminated by `type_id` (exactly how the search-task id is stored today). No DB migration, no entity or SQL changes.

Rejected alternative: a dedicated `maps_record_id` column — requires a migration and parallel plumbing for no real benefit, since `type_id` already disambiguates the source.

---

## 3. Design

### 3.1 Enum

`src/config/emailextraction.ts`:

```ts
export enum EmailExtractionTypes {
  ManualInputUrl = 1,
  SearchResult = 2,
  GoogleMaps = 3,
  YandexMaps = 4,
}
```

`ToArray()` then yields `["ManualInputUrl", "SearchResult", "GoogleMaps", "YandexMaps"]` → dropdown indices 0, 1, 2, 3 automatically. No change to `EmailscFormdata`, `EmailsControldata`, or `EmailSearchTaskDetail` is required — the maps record id rides in the existing `searchTaskId` / `searchResultId` fields.

### 3.2 Frontend — `src/views/pages/emailextraction/index.vue`

- **Imports**: add `GoogleMapsSelectTable` and `YandexMapsSelectTable`.
- **Template**: add two `v-if` blocks mirroring the `index==1` SearchResult block:
  - `emailtype?.index==2` → `<GoogleMapsSelectTable @change="handleMapsRecordChanged" :selected-value="searchtaskId" />`
  - `emailtype?.index==3` → `<YandexMapsSelectTable @change="handleMapsRecordChanged" :selected-value="searchtaskId" />`
  - Both reuse the existing `searchtaskId` ref to hold the selected maps record id. `handleMapsRecordChanged` sets `searchtaskId` from the selected record's `id` (mirroring `handleSearchtaskChanged`).
- **`onSubmit`**: when `emailtype.index` is 2 or 3, validate that a maps record is selected (else alert `emailextraction.choose_maps_record`); set `extratype = emailtype.value.key`; pass `searchTaskId = searchtaskId`. No URL textarea / URL validation for these types.
- **`loadTaskData`** (edit mode): replace the binary `type_id === SearchResult ? 1 : 0` with a `type_id → index` lookup over all four enum values (e.g. find the option whose enum value matches `task.type_id`). Restore `searchtaskId` from `task.searchResultId` so the select-table re-selects the maps record.

### 3.3 Backend — `src/main-process/communication/emailextraction-ipc.ts`

- **`EMAILEXTRACTIONAPI` handler**: add `else if (qdata.extratype === "GoogleMaps")` and `else if (qdata.extratype === "YandexMaps")` branches. Each:
  1. Validates `qdata.searchTaskId` (the maps record id) is present — else emit the existing-style error event with `emailscrape.searchTaskId_empty`.
  2. Calls `new GoogleMapsModule().getSearchRecord(id)` / `new YandexMapsModule().getSearchRecord(id)`.
  3. Resolves website URLs via the new resolver (§3.4). Empty result → emit error event with `emailscrape.mapsResult_empty`.
  4. Sets `extraType = EmailExtractionTypes.GoogleMaps` / `YandexMaps` so `type_id` persists correctly.
  - The shared tail (build `EmailsControldata`, call `searchEmail`) is unchanged.
- **`UPDATEEMAILSEARCHTASK` handler**: mirror — for the maps types, resolve URLs from the selected maps record (so editing works), and map `extratype` → the correct `EmailExtractionTypes` value for `type`. The existing `formData.extratype === "SearchResult" ? SearchResult : ManualInputUrl` ternary becomes a small `extratype → enum` helper covering all four types.

### 3.4 New resolver — `src/main-process/communication/emailExtractionMapsUrls.ts`

Two pure functions mirroring `resolveSearchResultUrls`:

```ts
import type { GoogleMapsSearchRecordEntity } from "@/entity/GoogleMapsSearchRecord.entity";
import type { YandexMapsSearchRecordEntity } from "@/entity/YandexMapsSearchRecord.entity";
import type { GoogleMapsBusinessResult } from "@/entityTypes/googleMapsTypes";
import type { YandexMapsBusinessResult } from "@/entityTypes/yandexMapsTypes";
import { isValidUrl } from "@/views/utils/function";

export function resolveGoogleMapsUrls(
  record: GoogleMapsSearchRecordEntity | null
): string[] {
  if (!record?.results) return [];
  let businesses: GoogleMapsBusinessResult[] = [];
  try {
    businesses = JSON.parse(record.results) as GoogleMapsBusinessResult[];
  } catch {
    return [];
  }
  return businesses
    .map((b) => (b.website ?? "").trim())
    .filter((url) => isValidUrl(url));
}

export function resolveYandexMapsUrls(
  record: YandexMapsSearchRecordEntity | null
): string[] {
  if (!record?.results) return [];
  let businesses: YandexMapsBusinessResult[] = [];
  try {
    businesses = JSON.parse(record.results) as YandexMapsBusinessResult[];
  } catch {
    return [];
  }
  return businesses
    .map((b) => (b.website ?? "").trim())
    .filter((url) => isValidUrl(url));
}
```

Handles null record, missing `results`, malformed JSON, empty/invalid `website` values — all return `[]`.

### 3.5 Type-name display — `src/model/emailsearchTaskdb.ts`

`convertType` currently falls through to `"Unknown"` for anything but the first two values. Add cases:

```ts
case EmailExtractionTypes.GoogleMaps:
  return "GoogleMaps";
case EmailExtractionTypes.YandexMaps:
  return "YandexMaps";
```

so the task list shows the correct type name.

### 3.6 i18n — all 6 languages (`en`, `zh`, `es`, `fr`, `de`, `ja`)

- `emailextraction.googlemaps` → "Google Map"
- `emailextraction.yandexmaps` → "Yandex Map"
- `emailextraction.choose_maps_record` → "choose a maps scraper record"
- `emailscrape.mapsResult_empty` → "No website URLs found in the selected maps record"

(Translations provided per language; English is the fallback.)

### 3.7 Testing

- **Unit** (resolver): `resolveGoogleMapsUrls` / `resolveYandexMapsUrls` — null record, missing `results`, malformed JSON, normal case with several businesses, businesses missing `website`, invalid URLs filtered out. Location mirrors the existing `resolveSearchResultUrls` test.
- **Unit** (`convertType`): returns `"GoogleMaps"` / `"YandexMaps"` for the new enum values.
- **Vitest** (IPC branch logic): mock `GoogleMapsModule` / `YandexMapsModule`; verify the `EMAILEXTRACTIONAPI` and `UPDATEEMAILSEARCHTASK` handlers resolve URLs and emit the correct error events for missing id / empty results, per repo test conventions (`test/vitest/main/`).

---

## 4. Out of Scope

- Per-business selection within a maps record (whole-record extraction only).
- Multi-record selection.
- New database columns / migrations.
- Changes to the Google/Yandex Maps scrapers themselves.
- The combined `map-scraper` page (`src/views/pages/map-scraper/index.vue`) — not part of the email-extraction insight flow.
