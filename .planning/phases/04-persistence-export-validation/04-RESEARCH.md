# Phase 4 Research: Persistence, Export, and Validation

## Entity Pattern

All entities extend `AuditableEntity` (provides `createdAt`, `updatedAt` with auto timestamps).
- Use `@PrimaryGeneratedColumn()` for `id: number`
- Use `@Column()` with explicit types and nullable flags
- Use `@Order(N)` decorator for column ordering
- Use `@Entity('table_name')` decorator
- Import from `@/entity/Auditable.entity`

Reference: `src/entity/AIChatMessage.entity.ts`, `src/entity/ExtraModule.entity.ts`

## Model Pattern

All models extend `BaseDb` from `@/model/Basedb.ts`.
- Constructor takes `filepath: string`
- Calls `super(filepath)` which creates `SqliteDb.getInstance(filepath)`
- Must call `await this.ensureConnection()` before any DB operation
- Access repository via `this.sqliteDb.connection.getRepository(Entity)`
- Standard CRUD: create, findById, find, update, delete

Reference: `src/model/AIChatMessage.model.ts`, `src/model/DependencyAudit.model.ts`

## Module Pattern

All modules extend `BaseModule` from `src/modules/baseModule.ts`.
- Constructor calls `super()` which gets dbpath from `Token` + `USERSDBPATH`
- Instantiates model(s) as `this.model = new SomeModel(this.dbpath)`
- Business logic methods delegate to model
- Never accesses repository directly — always through model

Reference: `src/modules/EmailFilterTaskRelationModule.ts`, `src/modules/EmailSearchTaskProxyModule.ts`

## IPC Handler Pattern

Already established in Phase 3 for Google Maps. Phase 4 adds:
- New channel constants in `channellist.ts`
- New handlers in `googleMaps-ipc.ts` that call module methods
- New functions in `src/views/api/googleMaps.ts`

## Export Pattern

CSV/JSON export already implemented in the Vue page (Phase 3):
- Uses `papaparse.unparse()` for CSV
- Uses `JSON.stringify()` for JSON
- Downloads via Blob URL

Phase 4 may add server-side export via Electron dialog for saved history records.

## Key Decisions

1. **Entity design**: Store `results` as JSON text column (simple, avoids relational complexity for variable-length array of business data)
2. **Module methods**: `saveSearchResult()`, `getSearchHistory()`, `deleteSearchRecord()`, `getSearchRecordById()`
3. **IPC channels**: Add `GOOGLE_MAPS_HISTORY_LIST`, `GOOGLE_MAPS_HISTORY_DELETE`, `GOOGLE_MAPS_HISTORY_DETAIL`
4. **Frontend**: Add history tab/section to existing Vue page, load from DB on mount
5. **No new page**: Add history as a tab or section within the existing `index.vue`
