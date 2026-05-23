---
wave: 1
depends_on: []
files_modified:
  - src/entity/GoogleMapsSearchRecord.entity.ts
  - src/model/GoogleMapsSearchRecord.model.ts
  - src/modules/GoogleMapsModule.ts
  - src/config/channellist.ts
  - src/main-process/communication/googleMaps-ipc.ts
  - src/views/api/googleMaps.ts
  - src/views/pages/google-maps-scraper/index.vue
autonomous: true
requirements:
  - FR-9
  - FR-10
---

# Plan 1: Result Persistence, History UI, and Export Refinements

## Goal

Add TypeORM entity + model for saving search results to SQLite, module persistence methods, IPC channels for history CRUD, frontend API functions, and a history section in the Vue page. Export (CSV/JSON) is already partially implemented client-side; this plan adds server-side export from saved history records.

## Tasks

### Task 1: Create TypeORM Entity

<read_first>
- src/entity/AIChatMessage.entity.ts (entity pattern reference)
- src/entity/Auditable.entity.ts (base class)
- src/entityTypes/googleMapsTypes.ts (GoogleMapsBusinessResult type)
</read_first>

<action>
Create `src/entity/GoogleMapsSearchRecord.entity.ts`:

```typescript
import { Entity, PrimaryGeneratedColumn, Column, Order } from "typeorm";
import AuditableEntity from "@/entity/Auditable.entity";

@Entity("google_maps_search_records")
export class GoogleMapsSearchRecordEntity extends AuditableEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Order(1)
  @Column("varchar", { length: 255, nullable: false })
  query: string;

  @Order(2)
  @Column("varchar", { length: 255, nullable: false })
  location: string;

  @Order(3)
  @Column("varchar", { length: 20, nullable: false, default: "completed" })
  status: string; // "completed" | "cancelled" | "failed"

  @Order(4)
  @Column("int", { nullable: false, default: 0 })
  totalResults: number;

  @Order(5)
  @Column("text", { nullable: true })
  summary: string;

  @Order(6)
  @Column("text", { nullable: false })
  results: string; // JSON stringified GoogleMapsBusinessResult[]
}
```

Note: `results` is stored as a JSON text column containing the serialized `GoogleMapsBusinessResult[]` array. This avoids a separate detail table and keeps the entity simple.
</action>

<acceptance_criteria>
- `src/entity/GoogleMapsSearchRecord.entity.ts` exists
- Extends `AuditableEntity`
- Has columns: id, query, location, status, totalResults, summary, results
- TypeScript compiles with no errors
</acceptance_criteria>

---

### Task 2: Create Model for Data Access

<read_first>
- src/model/AIChatMessage.model.ts (model pattern reference)
- src/model/Basedb.ts (base class)
- src/entity/GoogleMapsSearchRecord.entity.ts (just created)
</read_first>

<action>
Create `src/model/GoogleMapsSearchRecord.model.ts`:

```typescript
import { BaseDb } from "@/model/Basedb";
import { GoogleMapsSearchRecordEntity } from "@/entity/GoogleMapsSearchRecord.entity";
import type { Repository } from "typeorm";

export class GoogleMapsSearchRecordModel extends BaseDb {
  private getRepository(): Repository<GoogleMapsSearchRecordEntity> {
    return this.sqliteDb.connection.getRepository(GoogleMapsSearchRecordEntity);
  }

  async create(record: Partial<GoogleMapsSearchRecordEntity>): Promise<GoogleMapsSearchRecordEntity> {
    const repo = this.getRepository();
    const entity = repo.create(record);
    return await repo.save(entity);
  }

  async findById(id: number): Promise<GoogleMapsSearchRecordEntity | null> {
    const repo = this.getRepository();
    return await repo.findOne({ where: { id } });
  }

  async findAll(limit = 50, offset = 0): Promise<[GoogleMapsSearchRecordEntity[], number]> {
    const repo = this.getRepository();
    return await repo.findAndCount({
      order: { createdAt: "DESC" as const },
      take: limit,
      skip: offset,
    });
  }

  async deleteById(id: number): Promise<boolean> {
    const repo = this.getRepository();
    const result = await repo.delete(id);
    return (result.affected ?? 0) > 0;
  }

  async deleteAll(): Promise<number> {
    const repo = this.getRepository();
    const result = await repo.clear();
    return result ? 0 : 0; // clear() returns void via truncation
  }
}
```
</action>

<acceptance_criteria>
- `src/model/GoogleMapsSearchRecord.model.ts` exists
- Extends `BaseDb`
- Has methods: create, findById, findAll, deleteById
- TypeScript compiles with no errors
</acceptance_criteria>

---

### Task 3: Add Persistence Methods to GoogleMapsModule

<read_first>
- src/modules/GoogleMapsModule.ts (current module)
- src/model/GoogleMapsSearchRecord.model.ts (just created)
</read_first>

<action>
Modify `src/modules/GoogleMapsModule.ts`:

1. Import the model and entity:
```typescript
import { GoogleMapsSearchRecordModel } from "@/model/GoogleMapsSearchRecord.model";
import type { GoogleMapsSearchRecordEntity } from "@/entity/GoogleMapsSearchRecord.entity";
```

2. Add a `recordModel` property and instantiate in constructor:
```typescript
private recordModel: GoogleMapsSearchRecordModel;

constructor() {
    super();
    this.recordModel = new GoogleMapsSearchRecordModel(this.dbpath);
}
```

3. Add methods:
```typescript
async saveSearchResult(
    query: string,
    location: string,
    status: string,
    totalResults: number,
    summary: string,
    results: GoogleMapsBusinessResult[]
): Promise<GoogleMapsSearchRecordEntity> {
    await this.ensureConnection();
    return await this.recordModel.create({
        query,
        location,
        status,
        totalResults,
        summary,
        results: JSON.stringify(results),
    });
}

async getSearchHistory(limit = 50, offset = 0): Promise<[GoogleMapsSearchRecordEntity[], number]> {
    await this.ensureConnection();
    return await this.recordModel.findAll(limit, offset);
}

async getSearchRecord(id: number): Promise<GoogleMapsSearchRecordEntity | null> {
    await this.ensureConnection();
    return await this.recordModel.findById(id);
}

async deleteSearchRecord(id: number): Promise<boolean> {
    await this.ensureConnection();
    return await this.recordModel.deleteById(id);
}
```

4. Modify the `executeSearch()` method to auto-save results after completion. After the `resolve(result)` call in the worker message handler, add a save call:
```typescript
// Auto-save completed searches
module.saveSearchResult(
    input.query,
    input.location,
    result.success ? "completed" : "failed",
    result.totalResults,
    result.summary,
    result.results
).catch((saveErr) => {
    console.error("[GoogleMaps] Failed to save search result:", saveErr);
});
```
This should be fire-and-forget (non-blocking) so it doesn't delay the response to the renderer.
</action>

<acceptance_criteria>
- `GoogleMapsModule` has `saveSearchResult`, `getSearchHistory`, `getSearchRecord`, `deleteSearchRecord` methods
- `executeSearch()` auto-saves results on completion
- Save is non-blocking (fire-and-forget)
- TypeScript compiles with no errors
</acceptance_criteria>

---

### Task 4: Add IPC Channels and History Handlers

<read_first>
- src/config/channellist.ts (existing channels)
- src/main-process/communication/googleMaps-ipc.ts (existing handlers)
</read_first>

<action>
1. Add channel constants to `src/config/channellist.ts` (after existing Google Maps channels):

```typescript
export const GOOGLE_MAPS_HISTORY_LIST = "google_maps:history_list";
export const GOOGLE_MAPS_HISTORY_DETAIL = "google_maps:history_detail";
export const GOOGLE_MAPS_HISTORY_DELETE = "google_maps:history_delete";
```

2. Add handlers to `src/main-process/communication/googleMaps-ipc.ts`:

```typescript
import {
  // ... existing imports
  GOOGLE_MAPS_HISTORY_LIST,
  GOOGLE_MAPS_HISTORY_DETAIL,
  GOOGLE_MAPS_HISTORY_DELETE,
} from "@/config/channellist";

// Inside registerGoogleMapsHandlers():

// History list
ipcMain.handle(GOOGLE_MAPS_HISTORY_LIST, async (_event, data: Record<string, unknown>) => {
    const limit = typeof data.limit === "number" ? data.limit : 50;
    const offset = typeof data.offset === "number" ? data.offset : 0;
    const module = new GoogleMapsModule();
    const [records, total] = await module.getSearchHistory(limit, offset);
    return { status: true, msg: "OK", data: { records, total } };
});

// History detail
ipcMain.handle(GOOGLE_MAPS_HISTORY_DETAIL, async (_event, data: Record<string, unknown>) => {
    const id = typeof data.id === "number" ? data.id : 0;
    if (!id) return { status: false, msg: "id is required", data: null };
    const module = new GoogleMapsModule();
    const record = await module.getSearchRecord(id);
    if (!record) return { status: false, msg: "Record not found", data: null };
    return { status: true, msg: "OK", data: record };
});

// History delete
ipcMain.handle(GOOGLE_MAPS_HISTORY_DELETE, async (_event, data: Record<string, unknown>) => {
    const id = typeof data.id === "number" ? data.id : 0;
    if (!id) return { status: false, msg: "id is required", data: null };
    const module = new GoogleMapsModule();
    const deleted = await module.deleteSearchRecord(id);
    return { status: true, msg: deleted ? "Deleted" : "Not found", data: null };
});
```

3. Add frontend API functions to `src/views/api/googleMaps.ts`:

```typescript
import {
  // ... existing imports
  GOOGLE_MAPS_HISTORY_LIST,
  GOOGLE_MAPS_HISTORY_DETAIL,
  GOOGLE_MAPS_HISTORY_DELETE,
} from "@/config/channellist";

export interface GoogleMapsHistoryRecord {
  id: number;
  query: string;
  location: string;
  status: string;
  totalResults: number;
  summary: string;
  results: string; // JSON string
  createdAt?: Date;
}

export async function getGoogleMapsHistory(
  limit = 50,
  offset = 0
): Promise<{ records: GoogleMapsHistoryRecord[]; total: number }> {
  const resp = await windowInvoke(GOOGLE_MAPS_HISTORY_LIST, { limit, offset });
  if (!resp) throw new Error("Failed to load history");
  return resp as { records: GoogleMapsHistoryRecord[]; total: number };
}

export async function getGoogleMapsHistoryDetail(
  id: number
): Promise<GoogleMapsHistoryRecord> {
  const resp = await windowInvoke(GOOGLE_MAPS_HISTORY_DETAIL, { id });
  if (!resp) throw new Error("Failed to load record");
  return resp as GoogleMapsHistoryRecord;
}

export async function deleteGoogleMapsHistoryRecord(id: number): Promise<void> {
  await windowInvoke(GOOGLE_MAPS_HISTORY_DELETE, { id });
}
```
</action>

<acceptance_criteria>
- `channellist.ts` exports `GOOGLE_MAPS_HISTORY_LIST`, `GOOGLE_MAPS_HISTORY_DETAIL`, `GOOGLE_MAPS_HISTORY_DELETE`
- `googleMaps-ipc.ts` has handlers for all 3 channels
- `googleMaps.ts` API exports `getGoogleMapsHistory`, `getGoogleMapsHistoryDetail`, `deleteGoogleMapsHistoryRecord`
- TypeScript compiles with no errors
</acceptance_criteria>

---

### Task 5: Add History Section to Vue UI Page

<read_first>
- src/views/pages/google-maps-scraper/index.vue (current page)
- src/views/api/googleMaps.ts (just updated)
</read_first>

<action>
Modify `src/views/pages/google-maps-scraper/index.vue` to add a history section below the results.

1. Import the new API functions:
```typescript
import {
  startGoogleMapsSearch,
  cancelGoogleMapsSearch,
  onGoogleMapsResult,
  getGoogleMapsHistory,
  getGoogleMapsHistoryDetail,
  deleteGoogleMapsHistoryRecord,
  type GoogleMapsResultEvent,
} from "@/views/api/googleMaps";
```

2. Add state refs:
```typescript
const historyRecords = ref<Array<{ id: number; query: string; location: string; status: string; totalResults: number; createdAt?: Date }>>([]);
const historyLoading = ref(false);
const activeTab = ref<"search" | "history">("search");
```

3. Add a `loadHistory()` function:
```typescript
async function loadHistory(): Promise<void> {
  historyLoading.value = true;
  try {
    const data = await getGoogleMapsHistory(50, 0);
    historyRecords.value = data.records;
  } catch (err) {
    console.error("Failed to load history:", err);
  } finally {
    historyLoading.value = false;
  }
}
```

4. Add a `deleteRecord(id: number)` function:
```typescript
async function deleteRecord(id: number): Promise<void> {
  await deleteGoogleMapsHistoryRecord(id);
  historyRecords.value = historyRecords.value.filter((r) => r.id !== id);
}
```

5. Add a `loadHistoryResults(id: number)` function to load a history record's results into the results table:
```typescript
async function loadHistoryResults(id: number): Promise<void> {
  const record = await getGoogleMapsHistoryDetail(id);
  if (record.results) {
    results.value = JSON.parse(record.results);
    lastQuery.value = record.query;
    lastLocation.value = record.location;
    searchState.value = "completed";
    activeTab.value = "search";
  }
}
```

6. In the template, wrap the search form and results in a `v-tabs` component with "Search" and "History" tabs:

Add `v-tabs` at the top after the header:
```html
<v-tabs v-model="activeTab" class="mb-4">
  <v-tab value="search">{{ t('googleMaps.start_search') || 'Search' }}</v-tab>
  <v-tab value="history" @click="loadHistory">{{ t('googleMaps.history_tab') || 'History' }}</v-tab>
</v-tabs>
```

Wrap existing content in `<v-window v-model="activeTab">` with `<v-window-item value="search">` and add a new `<v-window-item value="history">` containing a `v-data-table` of history records with columns: Query, Location, Results, Date, Actions (view/delete).

Add these i18n keys to the googleMaps namespace in all 6 lang files:
- `history_tab`: "History" / "历史" / "Historial" / "Historique" / "Verlauf" / "履歴"
- `history_empty`: "No search history yet" / "暂无搜索历史" / etc.
- `col_date`: "Date" / "日期" / etc.
- `col_actions`: "Actions" / "操作" / etc.
- `view_results`: "View Results" / "查看结果" / etc.
- `delete_confirm`: "Delete this record?" / "确定删除此记录？" / etc.

7. Call `loadHistory()` when switching to history tab (already in `@click`).
</action>

<acceptance_criteria>
- Vue page has Search/History tabs
- History tab shows list of saved searches with date, query, location, result count
- User can click a history record to load its results into the results table
- User can delete a history record
- New i18n keys added to all 6 language files
- TypeScript compiles with no errors
</acceptance_criteria>

---

## Verification

1. `npx tsc --noEmit` — must pass with zero errors
2. Grep for `GoogleMapsSearchRecordEntity` in entity file — must exist
3. Grep for `GoogleMapsSearchRecordModel` in model file — must exist
4. Grep for `saveSearchResult` in module — must exist
5. Grep for `GOOGLE_MAPS_HISTORY_LIST` in channellist — must exist
6. Grep for `getGoogleMapsHistory` in API wrapper — must exist
7. Grep for `history_tab` in all 6 lang files — must find translations

## Must-Haves

- [ ] TypeORM entity with proper column types
- [ ] Model extends BaseDb with CRUD operations
- [ ] Module auto-saves search results on completion
- [ ] IPC handlers for history list/detail/delete
- [ ] Frontend API functions for history
- [ ] History tab in Vue page with view/delete actions
- [ ] All 6 languages updated with new i18n keys
- [ ] TypeScript compiles cleanly
