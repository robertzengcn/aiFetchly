# Google Map / Yandex Map Insight Types — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `google map` and `yandex map` as new "Insight Type" options on the Contact Profile Insights (email extraction) page; when chosen, the user selects an existing Google/Yandex Maps scraper record and the system extracts business `website` URLs from it to feed the contact-profile-insights pipeline.

**Architecture:** Reuse the existing `SearchResult` insight-type flow end-to-end. Add `GoogleMaps=3` / `YandexMaps=4` to `EmailExtractionTypes`. The selected maps record id is stored in the existing `search_result_id` column (discriminated by `type_id`) — no DB migration. The frontend reuses the already-built `GoogleMapsSelectTable` / `YandexMapsSelectTable` widgets. The backend resolves website URLs once at submit/update time (URLs are then stored and read at run time, so the run path is unchanged).

**Tech Stack:** TypeScript, Vue 3 + Vuetify, Electron IPC, TypeORM/SQLite, Vitest.

**Design spec:** `docs/superpowers/specs/2026-07-09-insights-map-support-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/config/emailextraction.ts` | Modify | Add `GoogleMaps`/`YandexMaps` enum values + pure `emailExtractionTypeName` / `extratypeToEnum` helpers |
| `src/main-process/communication/emailExtractionMapsUrls.ts` | Create | Pure resolvers that extract `website` URLs from a maps record's `results` JSON |
| `src/model/emailsearchTaskdb.ts` | Modify | `convertType` delegates to `emailExtractionTypeName` (handles new types, no longer returns "Unknown") |
| `src/main-process/communication/emailextraction-ipc.ts` | Modify | Add `GoogleMaps`/`YandexMaps` branches to the submit (`EMAILEXTRACTIONAPI`) and update (`UPDATEEMAILSEARCHTASK`) handlers |
| `src/views/pages/emailextraction/index.vue` | Modify | Two new dropdown branches using the maps select-tables; submit validation; edit-mode type restoration |
| `src/views/lang/{en,zh,es,fr,de,ja}.ts` | Modify | New i18n keys for labels + validation messages |
| `test/vitest/main/ipc/emailExtractionMapsUrls.test.ts` | Create | Resolver unit tests |
| `test/vitest/main/config/emailExtractionConfig.test.ts` | Create | Enum/helper unit tests |
| `test/vitest/main/ipc/emailextraction-ipc.test.ts` | Modify | Replace smoke test with real maps-branch IPC tests |

---

## Task 1: Maps URL resolvers (TDD)

Pure functions that parse a maps record's `results` JSON and return valid `website` URLs. Mirrors `resolveSearchResultUrls` in `emailExtractionSearchResultUrls.ts`.

**Files:**
- Create: `src/main-process/communication/emailExtractionMapsUrls.ts`
- Test: `test/vitest/main/ipc/emailExtractionMapsUrls.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/ipc/emailExtractionMapsUrls.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  resolveGoogleMapsUrls,
  resolveYandexMapsUrls,
} from "@/main-process/communication/emailExtractionMapsUrls";
import type { GoogleMapsSearchRecordEntity } from "@/entity/GoogleMapsSearchRecord.entity";
import type { YandexMapsSearchRecordEntity } from "@/entity/YandexMapsSearchRecord.entity";

function makeGoogleRecord(results: string): GoogleMapsSearchRecordEntity {
  return {
    id: 1,
    query: "dentist",
    location: "New York",
    status: "completed",
    totalResults: 0,
    summary: "",
    results,
  } as GoogleMapsSearchRecordEntity;
}

function makeYandexRecord(results: string): YandexMapsSearchRecordEntity {
  return {
    id: 1,
    query: "dentist",
    location: "Moscow",
    status: "completed",
    totalResults: 0,
    summary: "",
    results,
  } as YandexMapsSearchRecordEntity;
}

describe("resolveGoogleMapsUrls", () => {
  test("extracts and trims valid website URLs, drops invalid/missing", () => {
    const record = makeGoogleRecord(
      JSON.stringify([
        { name: "A", website: " https://a-example.com " },
        { name: "B", website: "https://b-example.org/about" },
        { name: "C", website: "not-a-url" },
        { name: "D" },
      ])
    );
    expect(resolveGoogleMapsUrls(record)).toEqual([
      "https://a-example.com",
      "https://b-example.org/about",
    ]);
  });

  test("returns empty array when record is null", () => {
    expect(resolveGoogleMapsUrls(null)).toEqual([]);
  });

  test("returns empty array when results JSON is malformed", () => {
    expect(resolveGoogleMapsUrls(makeGoogleRecord("{not json"))).toEqual([]);
  });

  test("returns empty array when results is an empty array", () => {
    expect(resolveGoogleMapsUrls(makeGoogleRecord("[]"))).toEqual([]);
  });
});

describe("resolveYandexMapsUrls", () => {
  test("extracts valid website URLs, drops invalid/missing", () => {
    const record = makeYandexRecord(
      JSON.stringify([
        { name: "A", website: "https://a-example.com" },
        { name: "B", website: "no-protocol" },
        { name: "C" },
      ])
    );
    expect(resolveYandexMapsUrls(record)).toEqual(["https://a-example.com"]);
  });

  test("returns empty array when record is null", () => {
    expect(resolveYandexMapsUrls(null)).toEqual([]);
  });

  test("returns empty array when results JSON is malformed", () => {
    expect(resolveYandexMapsUrls(makeYandexRecord("{bad"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vite.main.config.mjs test/vitest/main/ipc/emailExtractionMapsUrls.test.ts`
Expected: FAIL — `resolveGoogleMapsUrls` / `resolveYandexMapsUrls` not exported (module does not exist). (For a tight inner loop: prefix with `AIFETCHLY_SKIP_TSC=1`.)

- [ ] **Step 3: Write minimal implementation**

Create `src/main-process/communication/emailExtractionMapsUrls.ts`:

```ts
import type { GoogleMapsSearchRecordEntity } from "@/entity/GoogleMapsSearchRecord.entity";
import type { YandexMapsSearchRecordEntity } from "@/entity/YandexMapsSearchRecord.entity";
import type { GoogleMapsBusinessResult } from "@/entityTypes/googleMapsTypes";
import type { YandexMapsBusinessResult } from "@/entityTypes/yandexMapsTypes";
import { isValidUrl } from "@/views/utils/function";

/**
 * Extract valid business `website` URLs from a Google Maps scraper record.
 * The record's `results` column is a JSON string of GoogleMapsBusinessResult[].
 * Returns [] for a null record, missing results, or malformed JSON.
 */
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

/**
 * Extract valid business `website` URLs from a Yandex Maps scraper record.
 * The record's `results` column is a JSON string of YandexMapsBusinessResult[].
 * Returns [] for a null record, missing results, or malformed JSON.
 */
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --config vite.main.config.mjs test/vitest/main/ipc/emailExtractionMapsUrls.test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main-process/communication/emailExtractionMapsUrls.ts test/vitest/main/ipc/emailExtractionMapsUrls.test.ts
git commit -m "feat: resolve website urls from google/yandex maps records"
```

---

## Task 2: Enum values + pure type helpers (TDD)

Add the two new enum values and two pure, DB-free helpers (`emailExtractionTypeName`, `extratypeToEnum`). `convertType` is refactored to delegate to `emailExtractionTypeName` so it handles the new types (currently returns "Unknown") and is testable without a database connection.

**Files:**
- Modify: `src/config/emailextraction.ts`
- Modify: `src/model/emailsearchTaskdb.ts:4` (import) and `:199-209` (`convertType`)
- Test: `test/vitest/main/config/emailExtractionConfig.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/vitest/main/config/emailExtractionConfig.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  EmailExtractionTypes,
  emailExtractionTypeName,
  extratypeToEnum,
} from "@/config/emailextraction";

describe("emailExtractionTypeName", () => {
  test("returns the name for every enum value", () => {
    expect(emailExtractionTypeName(EmailExtractionTypes.ManualInputUrl)).toBe("ManualInputUrl");
    expect(emailExtractionTypeName(EmailExtractionTypes.SearchResult)).toBe("SearchResult");
    expect(emailExtractionTypeName(EmailExtractionTypes.GoogleMaps)).toBe("GoogleMaps");
    expect(emailExtractionTypeName(EmailExtractionTypes.YandexMaps)).toBe("YandexMaps");
  });

  test("returns Unknown for an out-of-range value", () => {
    expect(emailExtractionTypeName(999 as EmailExtractionTypes)).toBe("Unknown");
  });
});

describe("extratypeToEnum", () => {
  test("maps each extratype name to its enum value", () => {
    expect(extratypeToEnum("ManualInputUrl")).toBe(EmailExtractionTypes.ManualInputUrl);
    expect(extratypeToEnum("SearchResult")).toBe(EmailExtractionTypes.SearchResult);
    expect(extratypeToEnum("GoogleMaps")).toBe(EmailExtractionTypes.GoogleMaps);
    expect(extratypeToEnum("YandexMaps")).toBe(EmailExtractionTypes.YandexMaps);
  });

  test("falls back to ManualInputUrl for an unknown name", () => {
    expect(extratypeToEnum("Nope")).toBe(EmailExtractionTypes.ManualInputUrl);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vite.main.config.mjs test/vitest/main/config/emailExtractionConfig.test.ts`
Expected: FAIL — `GoogleMaps` / `YandexMaps` do not exist on the enum; helpers not exported.

- [ ] **Step 3: Extend the enum and add helpers**

Replace the entire contents of `src/config/emailextraction.ts` with:

```ts
export enum EmailExtractionTypes {
  ManualInputUrl = 1,
  SearchResult = 2,
  GoogleMaps = 3,
  YandexMaps = 4,
}

/**
 * Human-readable name for an extraction type id (stored in emailsearch_task.type_id).
 * Uses the enum's reverse mapping; returns "Unknown" for out-of-range values.
 * Pure — safe to call without a database connection (used by emailsearchTaskdb.convertType).
 */
export function emailExtractionTypeName(type: EmailExtractionTypes): string {
  return EmailExtractionTypes[type] ?? "Unknown";
}

/**
 * Convert a frontend extratype name string (the enum key) back to its numeric value.
 * Falls back to ManualInputUrl for unknown names.
 */
export function extratypeToEnum(extratype: string): EmailExtractionTypes {
  const value = EmailExtractionTypes[extratype as keyof typeof EmailExtractionTypes];
  return typeof value === "number"
    ? (value as EmailExtractionTypes)
    : EmailExtractionTypes.ManualInputUrl;
}
```

- [ ] **Step 4: Refactor `convertType` to delegate**

In `src/model/emailsearchTaskdb.ts`, update the import (line 4):

```ts
import { EmailExtractionTypes, emailExtractionTypeName } from "@/config/emailextraction";
```

Replace the `convertType` method (the switch at lines 199-209) with:

```ts
  public convertType(type: EmailExtractionTypes): string {
    return emailExtractionTypeName(type);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run --config vite.main.config.mjs test/vitest/main/config/emailExtractionConfig.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 6: Type-check the backend**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/config/emailextraction.ts src/model/emailsearchTaskdb.ts test/vitest/main/config/emailExtractionConfig.test.ts
git commit -m "feat: add google/yandex maps email extraction types"
```

---

## Task 3: Wire maps types into the email-extraction IPC handlers

Add `GoogleMaps` / `YandexMaps` branches to the submit (`EMAILEXTRACTIONAPI`) and update (`UPDATEEMAILSEARCHTASK`) handlers so they resolve website URLs from the selected maps record and persist the right `type_id`.

**Files:**
- Modify: `src/main-process/communication/emailextraction-ipc.ts`
- Modify (replace): `test/vitest/main/ipc/emailextraction-ipc.test.ts`

- [ ] **Step 1: Write the failing IPC test**

Replace the entire contents of `test/vitest/main/ipc/emailextraction-ipc.test.ts` with:

```ts
'use strict';
import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { mockIpcMain, setupElectronMocks, resetElectronMocks } from '../../../utils/electron-mocks';
import { EMAILEXTRACTIONAPI, EMAILEXTRACTIONMESSAGE } from '@/config/channellist';
import { EmailExtractionTypes } from '@/config/emailextraction';

// Hoisted mock fns so they are available inside vi.mock factories.
const mocks = vi.hoisted(() => ({
  mockSearchEmail: vi.fn().mockResolvedValue(undefined),
  mockGetGoogleRecord: vi.fn(),
  mockGetYandexRecord: vi.fn(),
}));

// Mock electron — ipcMain routes through mockIpcMain.
vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  dialog: { showSaveDialog: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue('/tmp') },
}));

// Mock registerValidatedHandler so the 9 handle-handlers don't pull token/schemas/Logger.
vi.mock('@/main-process/communication/_shared/registerValidatedHandler', () => ({
  registerValidatedHandler: vi.fn(),
}));

// Mock the IPC schemas (only referenced inside the mocked registerValidatedHandler).
vi.mock('@/schemas/ipc/emailExtraction', () => ({
  emailExtractionListInputSchema: vi.fn(),
  emailExtractionTaskResultInputSchema: vi.fn(),
  emailExtractionByIdInputSchema: vi.fn(),
  emailExtractionUpdateInputSchema: vi.fn(),
  emailExtractionExportInputSchema: vi.fn(),
}));

vi.mock('@/controller/emailextractionController', () => ({
  EmailextractionController: vi.fn().mockImplementation(() => ({
    searchEmail: mocks.mockSearchEmail,
  })),
}));

vi.mock('@/modules/SearchResultModule', () => ({
  SearchResultModule: vi.fn().mockImplementation(() => ({
    getAllSearchResultsByTaskId: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/modules/EmailSearchTaskModule', () => ({
  EmailSearchTaskModule: vi.fn().mockImplementation(() => ({
    resetOrphanedProcessingTasks: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@/modules/GoogleMapsModule', () => ({
  GoogleMapsModule: vi.fn().mockImplementation(() => ({
    getSearchRecord: mocks.mockGetGoogleRecord,
  })),
}));

vi.mock('@/modules/YandexMapsModule', () => ({
  YandexMapsModule: vi.fn().mockImplementation(() => ({
    getSearchRecord: mocks.mockGetYandexRecord,
  })),
}));

// Import AFTER mocks are registered.
import { registerEmailextractionIpcHandlers } from '@/main-process/communication/emailextraction-ipc';

function makeEvent(): { sender: { send: ReturnType<typeof vi.fn> } } {
  return { sender: { send: vi.fn() } };
}

const baseForm = {
  concurrency: 1,
  pagelength: 10,
  notShowBrowser: true,
  proxys: [],
  processTimeout: 60,
  maxPageNumber: 100,
};

describe('Email Extraction IPC — maps insight types', () => {
  beforeEach(() => {
    setupElectronMocks();
    mocks.mockSearchEmail.mockClear();
    mocks.mockGetGoogleRecord.mockReset();
    mocks.mockGetYandexRecord.mockReset();
    registerEmailextractionIpcHandlers();
  });

  afterEach(() => {
    resetElectronMocks();
    vi.clearAllMocks();
  });

  test('GoogleMaps resolves website URLs and starts the task', async () => {
    mocks.mockGetGoogleRecord.mockResolvedValue({
      results: JSON.stringify([
        { name: 'A', website: 'https://a-example.com' },
        { name: 'B', website: 'no-protocol' },
        { name: 'C' },
      ]),
    });
    const event = makeEvent();

    await mockIpcMain.callHandler(
      EMAILEXTRACTIONAPI,
      event,
      JSON.stringify({ ...baseForm, extratype: 'GoogleMaps', searchTaskId: 5 })
    );

    expect(mocks.mockGetGoogleRecord).toHaveBeenCalledWith(5);
    expect(mocks.mockSearchEmail).toHaveBeenCalledTimes(1);
    const data = mocks.mockSearchEmail.mock.calls[0][0];
    expect(data.type).toBe(EmailExtractionTypes.GoogleMaps);
    expect(data.searchResultId).toBe(5);
    expect(data.validUrls).toEqual(['https://a-example.com']);
    const sent = JSON.parse(event.sender.send.mock.calls[0][1]);
    expect(sent.status).toBe(true);
    expect(sent.data.action).toBe('emailscrape.emailsearch_task_start');
  });

  test('GoogleMaps with missing record id emits searchTaskId_empty and does not start', async () => {
    const event = makeEvent();

    await mockIpcMain.callHandler(
      EMAILEXTRACTIONAPI,
      event,
      JSON.stringify({ ...baseForm, extratype: 'GoogleMaps', searchTaskId: 0 })
    );

    expect(mocks.mockSearchEmail).not.toHaveBeenCalled();
    const sent = JSON.parse(event.sender.send.mock.calls[0][1]);
    expect(sent.status).toBe(false);
    expect(sent.data.content).toBe('emailscrape.searchTaskId_empty');
  });

  test('GoogleMaps with no website URLs emits mapsResult_empty', async () => {
    mocks.mockGetGoogleRecord.mockResolvedValue({
      results: JSON.stringify([{ name: 'A' }, { name: 'B' }]),
    });
    const event = makeEvent();

    await mockIpcMain.callHandler(
      EMAILEXTRACTIONAPI,
      event,
      JSON.stringify({ ...baseForm, extratype: 'GoogleMaps', searchTaskId: 7 })
    );

    expect(mocks.mockSearchEmail).not.toHaveBeenCalled();
    const sent = JSON.parse(event.sender.send.mock.calls[0][1]);
    expect(sent.status).toBe(false);
    expect(sent.data.content).toBe('emailscrape.mapsResult_empty');
  });

  test('YandexMaps resolves website URLs and starts the task', async () => {
    mocks.mockGetYandexRecord.mockResolvedValue({
      results: JSON.stringify([{ name: 'Y', website: 'https://y-example.com' }]),
    });
    const event = makeEvent();

    await mockIpcMain.callHandler(
      EMAILEXTRACTIONAPI,
      event,
      JSON.stringify({ ...baseForm, extratype: 'YandexMaps', searchTaskId: 9 })
    );

    expect(mocks.mockGetYandexRecord).toHaveBeenCalledWith(9);
    const data = mocks.mockSearchEmail.mock.calls[0][0];
    expect(data.type).toBe(EmailExtractionTypes.YandexMaps);
    expect(data.validUrls).toEqual(['https://y-example.com']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vite.main.config.mjs test/vitest/main/ipc/emailextraction-ipc.test.ts`
Expected: FAIL — `GoogleMaps`/`YandexMaps` fall through to the `else` branch and emit `emailscrape.action_error`; `mockSearchEmail` not called with the expected `type`/`validUrls`.

- [ ] **Step 3: Add imports to the IPC handler**

In `src/main-process/communication/emailextraction-ipc.ts`, update the existing enum import (line 21) and add module + resolver imports. Replace:

```ts
import { EmailExtractionTypes } from "@/config/emailextraction";
```

with:

```ts
import { EmailExtractionTypes, extratypeToEnum } from "@/config/emailextraction";
import { GoogleMapsModule } from "@/modules/GoogleMapsModule";
import { YandexMapsModule } from "@/modules/YandexMapsModule";
import { resolveGoogleMapsUrls, resolveYandexMapsUrls } from "@/main-process/communication/emailExtractionMapsUrls";
```

- [ ] **Step 4: Add GoogleMaps/YandexMaps branches to the submit handler**

In the `EMAILEXTRACTIONAPI` `ipcMain.on` handler, the existing branches are `if (qdata.extratype === "ManualInputUrl") {...}` then `else if (qdata.extratype === "SearchResult") {...}` then `else { ... action_error ... return; }`. Insert the two new branches **before** the final `else`. Add:

```ts
    } else if (qdata.extratype === "GoogleMaps") {
      extraType = EmailExtractionTypes.GoogleMaps;
      if (!qdata.searchTaskId) {
        (event as { sender: { send: (c: string, m: string) => void } }).sender.send(
          EMAILEXTRACTIONMESSAGE,
          JSON.stringify({
            status: false,
            code: 20240705103811,
            data: { action: "error", title: "emailscrape.failed", content: "emailscrape.searchTaskId_empty" },
          } satisfies CommonDialogMsg),
        );
        return;
      }
      const record = await new GoogleMapsModule().getSearchRecord(qdata.searchTaskId);
      validUrls.push(...resolveGoogleMapsUrls(record));
      if (validUrls.length === 0) {
        (event as { sender: { send: (c: string, m: string) => void } }).sender.send(
          EMAILEXTRACTIONMESSAGE,
          JSON.stringify({
            status: false,
            code: 20240705103811,
            data: { action: "error", title: "emailscrape.failed", content: "emailscrape.mapsResult_empty" },
          } satisfies CommonDialogMsg),
        );
        return;
      }
    } else if (qdata.extratype === "YandexMaps") {
      extraType = EmailExtractionTypes.YandexMaps;
      if (!qdata.searchTaskId) {
        (event as { sender: { send: (c: string, m: string) => void } }).sender.send(
          EMAILEXTRACTIONMESSAGE,
          JSON.stringify({
            status: false,
            code: 20240705103811,
            data: { action: "error", title: "emailscrape.failed", content: "emailscrape.searchTaskId_empty" },
          } satisfies CommonDialogMsg),
        );
        return;
      }
      const record = await new YandexMapsModule().getSearchRecord(qdata.searchTaskId);
      validUrls.push(...resolveYandexMapsUrls(record));
      if (validUrls.length === 0) {
        (event as { sender: { send: (c: string, m: string) => void } }).sender.send(
          EMAILEXTRACTIONMESSAGE,
          JSON.stringify({
            status: false,
            code: 20240705103811,
            data: { action: "error", title: "emailscrape.failed", content: "emailscrape.mapsResult_empty" },
          } satisfies CommonDialogMsg),
        );
        return;
      }
    }
```

- [ ] **Step 5: Add maps URL resolution + `extratypeToEnum` to the update handler**

In the `UPDATEEMAILSEARCHTASK` `registerValidatedHandler` block, the existing code is:

```ts
      const validUrls: string[] = [];
      if (formData.extratype === "ManualInputUrl") {
        if (!formData.urls || formData.urls.length === 0) {
          throw new Error("URLs cannot be empty");
        }
        formData.urls.forEach((item) => {
          isValidUrl(item) ? validUrls.push(item) : null;
        });
        if (validUrls.length === 0) throw new Error("No valid URLs provided");
      }

      const updateData: EmailsControldata = {
        searchResultId: formData.searchTaskId ? formData.searchTaskId : 0,
        validUrls: validUrls,
        concurrency: formData.concurrency,
        pagelength: formData.pagelength,
        notShowBrowser: formData.notShowBrowser,
        proxys: formData.proxys,
        type:
          formData.extratype === "SearchResult"
            ? EmailExtractionTypes.SearchResult
            : EmailExtractionTypes.ManualInputUrl,
        processTimeout: Number(formData.processTimeout),
        maxPageNumber: formData.maxPageNumber,
        aiSupportEnabled: formData.aiSupportEnabled || false,
      };
```

Replace it with:

```ts
      const validUrls: string[] = [];
      if (formData.extratype === "ManualInputUrl") {
        if (!formData.urls || formData.urls.length === 0) {
          throw new Error("URLs cannot be empty");
        }
        formData.urls.forEach((item) => {
          isValidUrl(item) ? validUrls.push(item) : null;
        });
        if (validUrls.length === 0) throw new Error("No valid URLs provided");
      } else if (formData.extratype === "GoogleMaps") {
        if (!formData.searchTaskId) throw new Error("Maps record id is required");
        const record = await new GoogleMapsModule().getSearchRecord(formData.searchTaskId);
        validUrls.push(...resolveGoogleMapsUrls(record));
        if (validUrls.length === 0) throw new Error("No website URLs found in the selected maps record");
      } else if (formData.extratype === "YandexMaps") {
        if (!formData.searchTaskId) throw new Error("Maps record id is required");
        const record = await new YandexMapsModule().getSearchRecord(formData.searchTaskId);
        validUrls.push(...resolveYandexMapsUrls(record));
        if (validUrls.length === 0) throw new Error("No website URLs found in the selected maps record");
      }

      const updateData: EmailsControldata = {
        searchResultId: formData.searchTaskId ? formData.searchTaskId : 0,
        validUrls: validUrls,
        concurrency: formData.concurrency,
        pagelength: formData.pagelength,
        notShowBrowser: formData.notShowBrowser,
        proxys: formData.proxys,
        type: extratypeToEnum(formData.extratype),
        processTimeout: Number(formData.processTimeout),
        maxPageNumber: formData.maxPageNumber,
        aiSupportEnabled: formData.aiSupportEnabled || false,
      };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run --config vite.main.config.mjs test/vitest/main/ipc/emailextraction-ipc.test.ts`
Expected: PASS (all 4 tests).

- [ ] **Step 7: Type-check the backend**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/main-process/communication/emailextraction-ipc.ts test/vitest/main/ipc/emailextraction-ipc.test.ts
git commit -m "feat: wire google/yandex maps insight types into email extraction IPC"
```

---

## Task 4: i18n keys (all 6 languages)

Add the dropdown labels and validation/error messages. Anchors (verified present in all 6 files): the `manualinputurl:` and `searchresult:` lines inside the `emailextraction:` block, and the `searchResult_empty:` line inside the `emailscrape:` block.

**Files:**
- Modify: `src/views/lang/en.ts`, `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts`

- [ ] **Step 1: Add keys to English**

In `src/views/lang/en.ts`, inside the `emailextraction:` block, immediately after the `searchresult: "search result",` line, add:

```ts
    googlemaps: "Google Map",
    yandexmaps: "Yandex Map",
    choose_maps_record: "choose a maps scraper record",
```

Inside the `emailscrape:` block, immediately after the `searchResult_empty:` line, add:

```ts
    mapsResult_empty: "No website URLs found in the selected maps record",
```

- [ ] **Step 2: Add keys to Chinese (`zh.ts`)**

In the `emailextraction:` block after `searchresult:`:

```ts
    googlemaps: "Google 地图",
    yandexmaps: "Yandex 地图",
    choose_maps_record: "请选择一个地图抓取记录",
```

In the `emailscrape:` block after `searchResult_empty:`:

```ts
    mapsResult_empty: "所选地图记录中未找到网站链接",
```

- [ ] **Step 3: Add keys to Spanish (`es.ts`)**

In the `emailextraction:` block after `searchresult:`:

```ts
    googlemaps: "Google Maps",
    yandexmaps: "Yandex Maps",
    choose_maps_record: "elige un registro de scraper de mapas",
```

In the `emailscrape:` block after `searchResult_empty:`:

```ts
    mapsResult_empty: "No se encontraron URLs de sitios web en el registro de mapas seleccionado",
```

- [ ] **Step 4: Add keys to French (`fr.ts`)**

In the `emailextraction:` block after `searchresult:`:

```ts
    googlemaps: "Google Maps",
    yandexmaps: "Yandex Maps",
    choose_maps_record: "choisissez un enregistrement de scraper de cartes",
```

In the `emailscrape:` block after `searchResult_empty:`:

```ts
    mapsResult_empty: "Aucune URL de site Web trouvée dans l'enregistrement de cartes sélectionné",
```

- [ ] **Step 5: Add keys to German (`de.ts`)**

In the `emailextraction:` block after `searchresult:`:

```ts
    googlemaps: "Google Maps",
    yandexmaps: "Yandex Maps",
    choose_maps_record: "wählen Sie einen Karten-Scraper-Eintrag",
```

In the `emailscrape:` block after `searchResult_empty:`:

```ts
    mapsResult_empty: "Keine Website-URLs im ausgewählten Karten-Eintrag gefunden",
```

- [ ] **Step 6: Add keys to Japanese (`ja.ts`)**

In the `emailextraction:` block after `searchresult:`:

```ts
    googlemaps: "Google マップ",
    yandexmaps: "Yandex マップ",
    choose_maps_record: "マップスクレイパーのレコードを選択してください",
```

In the `emailscrape:` block after `searchResult_empty:`:

```ts
    mapsResult_empty: "選択したマップレコードにウェブサイトURLが見つかりません",
```

- [ ] **Step 7: Verify all 6 files have the new keys**

Run:
```bash
for f in en zh es fr de ja; do echo "=== $f ==="; grep -cE "googlemaps:|yandexmaps:|choose_maps_record:|mapsResult_empty:" src/views/lang/$f.ts; done
```
Expected: each file prints `4`.

- [ ] **Step 8: Commit**

```bash
git add src/views/lang/en.ts src/views/lang/zh.ts src/views/lang/es.ts src/views/lang/fr.ts src/views/lang/de.ts src/views/lang/ja.ts
git commit -m "feat: add google/yandex map insight type i18n keys"
```

---

## Task 5: Frontend — Contact Profile Insights page

Add the two new dropdown branches (reusing `GoogleMapsSelectTable` / `YandexMapsSelectTable`), submit validation, and edit-mode type restoration.

**Files:**
- Modify: `src/views/pages/emailextraction/index.vue`

- [ ] **Step 1: Add the two select-table imports**

In `src/views/pages/emailextraction/index.vue`, after the `SearchResultSelectTable` import (line 117):

```ts
import SearchResultSelectTable from "@/views/pages/search/widgets/SearchResultSelectTable.vue";
```

add:

```ts
import GoogleMapsSelectTable from "@/views/pages/google-maps-scraper/widgets/GoogleMapsSelectTable.vue";
import YandexMapsSelectTable from "@/views/pages/yandex-maps-scraper/widgets/YandexMapsSelectTable.vue";
```

- [ ] **Step 2: Add the two template branches**

In the template, the existing SearchResult block is:

```html
       <div v-if="emailtype?.index==1" class="mt-3">
        <SearchResultSelectTable @change="handleSearchtaskChanged" :selected-value="searchtaskId" />
      </div>
```

Immediately after that block, add:

```html

       <div v-if="emailtype?.index==2" class="mt-3">
        <GoogleMapsSelectTable @change="handleMapsRecordChanged" :selected-value="searchtaskId" />
      </div>

       <div v-if="emailtype?.index==3" class="mt-3">
        <YandexMapsSelectTable @change="handleMapsRecordChanged" :selected-value="searchtaskId" />
      </div>
```

- [ ] **Step 3: Add the `handleMapsRecordChanged` handler**

In the `<script setup>` block, immediately after the existing `handleSearchtaskChanged` function (which ends around line 355), add:

```ts
const handleMapsRecordChanged = (newValue: { id?: number } | undefined) => {
  if (newValue && newValue.id) {
    searchtaskId.value = newValue.id;
  } else {
    searchtaskId.value = 0;
  }
};
```

- [ ] **Step 4: Add maps validation to `onSubmit`**

In `onSubmit`, the existing type branches are:

```ts
    if(emailtype.value?.index==0){
      extratype=emailtype.value.key;
      ...
    }else if(emailtype.value?.index==1){
      extratype=emailtype.value.key;
      if(searchtaskId.value==0||!searchtaskId.value){
        setAlert(t('emailextraction.choose_search_task'), "Error", "error");
        return;
      }
    }
```

Add a new `else if` for the maps types immediately after the `index==1` block (before the `scraperData` construction):

```ts
    }else if(emailtype.value?.index==2 || emailtype.value?.index==3){
      extratype=emailtype.value.key;
      if(searchtaskId.value==0||!searchtaskId.value){
        setAlert(t('emailextraction.choose_maps_record'), "Error", "error");
        return;
      }
    }
```

`searchTaskId: searchtaskId.value` is already included in the `scraperData` object, so no change is needed there — the maps record id is sent as `searchTaskId`.

- [ ] **Step 5: Fix edit-mode type restoration in `loadTaskData`**

The existing code in `loadTaskData` maps `type_id` to a dropdown index with a binary ternary:

```ts
      const typeIndex = task.type_id === EmailExtractionTypes.SearchResult ? 1 : 0;
      emailtype.value = emailTypelist.value.find(item => item.index === typeIndex);
```

Replace those two lines with a lookup by enum name (handles all four types, falls back to ManualInputUrl):

```ts
      const taskTypeName =
        (EmailExtractionTypes[task.type_id as EmailExtractionTypes] as string | undefined) ??
        "ManualInputUrl";
      emailtype.value =
        emailTypelist.value.find(item => item.key === taskTypeName) ??
        emailTypelist.value.find(item => item.index === 0);
```

(The `searchtaskId.value = task.searchResultId || 0;` line already present restores the maps record id, and the select-table's `:selected-value="searchtaskId"` re-selects it.)

- [ ] **Step 6: Type-check the frontend**

Run: `npx vue-tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Run `yarn dev` and on the Contact Profile Insights (email extraction) create-task page:
1. Open the "Insight Type" dropdown — confirm "Google Map" and "Yandex Map" now appear.
2. Select "Google Map" — confirm the Google Maps history select-table appears; pick a record with businesses that have websites; submit — confirm the task is created and runs (emails are extracted from the business websites).
3. Repeat for "Yandex Map".
4. Edit an existing Google/Yandex maps task — confirm the dropdown and the selected maps record are restored correctly.

- [ ] **Step 8: Commit**

```bash
git add src/views/pages/emailextraction/index.vue
git commit -m "feat: add google/yandex map insight type UI on contact profile insights page"
```

---

## Self-Review

**Spec coverage:**
- §3.1 Enum → Task 2 Step 3. ✓
- §3.2 Frontend (imports, template, handler, onSubmit, loadTaskData) → Task 5. ✓
- §3.3 Backend submit + update branches → Task 3 Steps 4–5. ✓
- §3.4 Resolver → Task 1. ✓
- §3.5 convertType → Task 2 Step 4. ✓
- §3.6 i18n (6 languages, 4 keys) → Task 4. ✓
- §3.7 Testing (resolver, convertType/helper, IPC) → Tasks 1, 2, 3. ✓

**Placeholder scan:** None. All code blocks are complete; all run commands include expected output.

**Type consistency:** `resolveGoogleMapsUrls` / `resolveYandexMapsUrls` (Task 1) are imported and called with the same names in Task 3. `emailExtractionTypeName` / `extratypeToEnum` (Task 2) are imported and called with the same names in Task 2 (convertType) and Task 3 (update handler). Enum members `GoogleMaps` / `YandexMaps` are referenced consistently in Tasks 2, 3, 5. i18n keys `emailextraction.choose_maps_record` (Task 4) and `emailscrape.mapsResult_empty` / `emailscrape.searchTaskId_empty` (Task 4) match the strings used in Task 3 and Task 5.

**Scope:** Single focused feature; one plan; each task produces self-contained, committable changes.
