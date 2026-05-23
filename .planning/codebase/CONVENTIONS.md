# Coding Conventions

> Auto-generated codebase map. Last updated: 2026-04-22

## Summary

AiFetchly uses TypeScript 5.x with strict mode enabled (with `noImplicitAny: false`), Vue 3 Composition API with `<script setup>`, and a three-layer database architecture (Model/Module/IPC). The codebase follows an Electron main/renderer split with IPC channels for cross-process communication. Naming and formatting conventions are partially enforced through ESLint, though many formatting rules are disabled and no Prettier configuration file exists.

## Details

### Naming Patterns

**Files:**
- Entity files: PascalCase with `.entity.ts` suffix -- `src/entity/ContactInfo.entity.ts`
- Model files: PascalCase with `.model.ts` suffix -- `src/model/ContactInfo.model.ts`
- Module files: PascalCase with `Module.ts` suffix -- `src/modules/ContactInfoModule.ts`
- Service files: PascalCase with `Service.ts` suffix -- `src/service/FileToolService.ts`
- IPC handler files: kebab-case with `-ipc.ts` suffix -- `src/main-process/communication/contactExtraction-ipc.ts`
- Type definition files: kebab-case with `-type.ts` suffix in `src/entityTypes/` -- `src/entityTypes/commonType.ts`
- Vue components: PascalCase for reusable components -- `SearchResultTable.vue`, kebab-case for sub-components
- Vue pages: lowercase `index.vue` for main pages, lowercase for sub-pages -- `src/views/pages/search/index.vue`
- Test files: `.test.ts` suffix matching the source file name -- `test/vitest/main/FileToolService.test.ts`
- Language files: two-letter code -- `src/views/lang/en.ts`, `src/views/lang/zh.ts`
- Vite config files: kebab-case with `vite.*.config.mjs` -- `vite.main.config.mjs`

**Inconsistency note:** Some IPC files use camelCase (e.g., `emailMarketingIpc.ts`, `scheduleIpc.ts`) while newer files use kebab-case (`contactExtraction-ipc.ts`, `ai-chat-ipc.ts`). Follow kebab-case for new files.

**Classes:**
- PascalCase everywhere: `ContactInfoModule`, `FileToolService`, `StreamEventProcessor`
- Entity classes suffixed with `Entity`: `ContactInfoEntity`, `SearchResultEntity`
- Abstract base classes prefixed with `Base` or `Auditable`: `BaseDb`, `BaseModule`, `AuditableEntity`

**Variables and Functions:**
- camelCase: `contactExtractionWorker`, `handleWorkerProgress`, `ensureConnection`
- Constants: UPPER_SNAKE_CASE for IPC channels and config values: `START_CONTACT_EXTRACTION`, `USERSDBPATH`, `USER_AI_ENABLED`

**Enums:**
- PascalCase names, UPPER_SNAKE_CASE values: `LanguageName.ENGLISH`, `LanguageCode.EN`

### Code Style

**Formatting:**
- ESLint configured in `.eslintrc.json` with many formatting rules explicitly turned off:
  - `indent: "off"`, `vue/html-indent: "off"`, `vue/max-attributes-per-line: "off"`
  - `vue/singleline-html-element-content-newline: "off"`, `vue/html-self-closing: "off"`
- No `.prettierrc` file exists; `prettier` is listed as a devDependency but unconfigured
- `lint-staged` runs `npx eslint --fix` via Husky pre-commit hook
- Inconsistent indentation observed: 2-space and 4-space used in different files

**Quotes:**
- Both single and double quotes used inconsistently across the codebase
- Newer files tend to use double quotes for strings

**Semicolons:**
- Semicolons are used consistently

**Trailing Commas:**
- Not enforced; inconsistent usage

### TypeScript Patterns

**Configuration (from `tsconfig.json`):**
- `strict: true` but `noImplicitAny: false` and `noImplicitThis: false`
- `strictPropertyInitialization: false`
- Target: ES6, Module: ESNext
- Decorators enabled: `experimentalDecorators: true`, `emitDecoratorMetadata: true`
- Path alias: `@/*` maps to `./src/*`
- Electron modules aliased to test mocks for test builds

**Type Definitions:**
- Interfaces preferred for data shapes: `CommonResponse<Type>`, `ContactExtractionRequest`, `SearchResultData`
- Type aliases for simple unions and shapes: `type PageSearch = { page: number; size: number }`
- Enums for fixed value sets: `LanguageName`, `LanguageCode`, `MessageType`
- Generic types used for API response envelope: `CommonResponse<Type>`, `ListData<Type>`

**Inconsistency note:** Despite `noImplicitAny: false`, the CLAUDE.md instructs "NEVER use `any` type." New code should use `unknown` instead. Existing code has many `as any` casts, especially in TypeORM repository queries (e.g., `where: { resultId } as any` in `src/model/ContactInfo.model.ts`).

**Error Handling in Catch Blocks:**
- Use `unknown` for catch parameter: `catch (error: unknown)` or `catch (err: unknown)`
- Some older files use `catch (error)` without type annotation

### Vue Component Patterns

**Script Setup:**
- All newer components use `<script setup lang="ts">`
- Composition API with `ref`, `computed`, `reactive`, `watch`, `onMounted`, `onUnmounted`

**Props Pattern:**
```typescript
// From src/views/pages/search/widgets/SearchResultTable.vue
const props = defineProps<{
    search?: string
}>();
```

**i18n Usage:**
- Components import `useI18n` from `vue-i18n`:
```typescript
import { useI18n } from "vue-i18n";
const { t } = useI18n({ inheritLocale: true });
```
- In templates: `{{ t('search.input_keywords_hint') }}` or `{{ $t('search.edit_task') }}`
- Two patterns used: `t()` in script, `$t()` in templates (inconsistency)

**Vuetify:**
- All UI uses Vuetify 3 components: `v-data-table-server`, `v-btn`, `v-select`, `v-dialog`
- Some components use `mdi-*` icons directly: `<v-icon>mdi-pencil</v-icon>`

### Error Handling Patterns

**IPC Handlers:**
```typescript
// From src/main-process/communication/contactExtraction-ipc.ts
ipcMain.handle(START_CONTACT_EXTRACTION, async (event, request: unknown) => {
    try {
        // ... business logic
        return { success: true, data: result };
    } catch (error) {
        console.error('Error starting contact extraction:', error);
        return { success: false, message: `Failed to start extraction: ${error}` };
    }
});
```
- All IPC handlers wrap logic in try/catch
- Return `{ success: boolean, message?: string, data?: T }` envelope
- Never throw to the renderer; always return error info in the response shape

**Frontend API Layer:**
```typescript
// From src/views/utils/apirequest.ts
export const windowInvoke = async (channel: string, data?: object) => {
    const result = await window.api.invoke(channel, JSON.stringify(data));
    if (!result) throw new Error("unknow error");
    if (!result.status) throw new Error(result.msg);
    return result.data;
};
```
- Frontend throws on failed IPC responses
- Data is always `JSON.stringify`'d before sending via IPC

### Database Patterns

**TypeORM Entity Pattern:**
```typescript
// From src/entity/ContactInfo.entity.ts
@Entity('contact_info')
@Index(['resultId'])
export class ContactInfoEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'result_id', type: 'integer' })
    resultId: number;

    @Column({ name: 'email', nullable: true, type: 'text' })
    email: string | null;
}
```
- Table names: snake_case in `@Entity('table_name')` decorator
- Column names: `name:` property uses snake_case, TypeScript property uses camelCase
- Nullable columns typed as `string | null`
- JSON columns typed inline: `socialLinks: string[] | null`

**Auditable Entity Base Class:**
- `src/entity/Auditable.entity.ts` extends `BaseEntity` with `createdAt`/`updatedAt` columns
- Not all entities extend this; many define their own timestamp columns

**Three-Layer Database Access:**
1. **Model Layer** (`src/model/`): Extends `BaseDb`, takes `filepath` in constructor, direct repository access
2. **Module Layer** (`src/modules/`): Extends `BaseModule`, calls Models, business logic
3. **IPC Layer** (`src/main-process/communication/`): Calls Modules only, never accesses database directly

**Connection Management:**
- `BaseDb.ensureConnection()` must be called before database operations
- `BaseModule.ensureConnection()` delegates to `SqliteDb` singleton
- `SqliteDb` uses singleton pattern: `SqliteDb.getInstance(dbPath)`

### IPC Patterns

**Channel Naming:**
- Defined in `src/config/channellist.ts` as UPPER_SNAKE_CASE constants
- Format: `domain:action` or `domain:subdomain:action`
- Examples: `"search:scraper"`, `"email:extraction:api"`, `"contact-extraction:start"`

**Request/Response Shape:**
- Frontend sends: `JSON.stringify(data)` via `window.api.invoke(channel, data)`
- Backend receives: `typeof request === 'string' ? JSON.parse(request) : request` (defensive parse)
- Backend returns: `{ success: boolean, message?: string, data?: T }` or `{ status: boolean, msg?: string, data?: T }`

**Inconsistency note:** Two response envelope shapes exist:
- `success`/`message`/`data` (newer IPC handlers like contactExtraction)
- `status`/`msg`/`data` (older IPC handlers and frontend `CommonResponse` interface)

**AI Feature Guard:**
```typescript
// Required at start of any AI-related IPC handler
const tokenService = new Token();
const aiEnabled = tokenService.getValue(USER_AI_ENABLED);
if (aiEnabled !== 'true') {
    return { status: false, msg: 'AI features not enabled', data: null };
}
```

### Import Conventions

**Path Aliases:**
- `@/` maps to `./src/` in all configs (tsconfig, vite configs)
- Used extensively: `import { Token } from "@/modules/token"`
- Relative imports used for same-directory or closely related files

**Electron Mocks for Tests:**
- `tsconfig.json` maps `electron`, `electron-log`, `electron-store` to test mock files:
```json
"electron": ["./test/mocks/electron.ts"],
"electron-log": ["./test/mocks/electron-log.ts"],
"electron-store": ["./test/mocks/electron-store.ts"]
```

**Import Order (observed):**
1. External packages (`electron`, `child_process`, `path`)
2. Internal modules via `@/` alias
3. Relative imports for same-feature files

### Module Pattern

**BaseModule (`src/modules/baseModule.ts`):**
```typescript
export abstract class BaseModule {
    protected dbpath: string;
    protected sqliteDb: SqliteDb;
    constructor() {
        const tokenService = new Token();
        const dbpath = tokenService.getValue(USERSDBPATH);
        // Falls back to temp directory for test environments
    }
    public async ensureConnection(): Promise<void> {
        if (!this.sqliteDb.connection.isInitialized) {
            await this.sqliteDb.connection.initialize();
        }
    }
}
```
- Extending classes call `await this.ensureConnection()` at the start of every async method
- Constructor automatically resolves database path via `Token` service
- Test environments fall back to `os.tmpdir()/aifetchly-test`

### Model Pattern

**BaseDb (`src/model/Basedb.ts`):**
```typescript
export abstract class BaseDb {
    protected db: Database;
    protected sqliteDb: SqliteDb;
    constructor(filepath: string) {
        this.sqliteDb = SqliteDb.getInstance(filepath);
    }
    public async ensureConnection(): Promise<void> { ... }
}
```
- Extending classes take `filepath: string` in constructor
- Instantiated by Modules: `new SearchResultModel(this.dbpath)`

**Repository Pattern (newer style):**
- `src/model/ContactInfo.model.ts` exports a standalone `ContactInfoRepository` class
- Does NOT extend `BaseDb`; manages its own connection via `Token` service
- Singleton instance exported: `export const contactInfoRepository = new ContactInfoRepository()`

### Async Patterns

- `async/await` used universally; no raw Promise chains observed
- Worker processes use `process.send()` / `process.on('message')` callback pattern for IPC
- Timeouts handled with `setTimeout` and manual cleanup (e.g., `URL_EXTRACTION_TIMEOUT_MS`)

### Internationalization

**Key Structure:**
- Nested object in language files: `common.more`, `search.input_keywords_hint`, `validation.required`
- Language files: `src/views/lang/en.ts` (default), `zh.ts`, `es.ts`, `fr.ts`, `de.ts`, `ja.ts`
- Configuration: `src/views/lang/index.ts`

**Translation Pattern:**
```typescript
// In language file (en.ts):
export default {
  common: { more: "More", actions: "Actions" },
  search: { input_keywords_hint: "Enter keywords" }
};

// In component:
const { t } = useI18n();
t('search.input_keywords_hint') || 'Fallback text'
```

### Environment/Config

**Environment Variables:**
- `VITE_REMOTEADD` -- Backend API URL
- `VITE_LOGIN_URL` -- Login page URL (embedded at build time)
- `UPDATESERVER` -- Update server URL
- `NODE_ENV` -- Environment mode
- Config constants in `src/config/usersetting.ts`: `USERSDBPATH`, `TOKENNAME`, `USER_AI_ENABLED`, etc.

**Config Access:**
- User settings via `Token` service: `new Token().getValue(USERSDBPATH)`
- Platform configs in `src/config/` directory as TypeScript files
- Dependency catalog as JSON: `src/config/dependency-catalog.json`

## Key Files

- `src/model/Basedb.ts` - Base class for Model layer, manages DB connection
- `src/modules/baseModule.ts` - Base class for Module layer, auto-resolves DB path
- `src/config/channellist.ts` - All IPC channel name constants
- `src/config/usersetting.ts` - User setting key constants
- `src/config/SqliteDb.ts` - SQLite database singleton with all entity registrations
- `src/views/utils/apirequest.ts` - Frontend IPC communication utilities
- `src/modules/Logger.ts` - Logging singleton with worker-aware proxy
- `src/entityTypes/commonType.ts` - Shared TypeScript interfaces and types
- `src/main-process/communication/index.ts` - Central IPC handler registration
- `.eslintrc.json` - ESLint rules (many formatting rules disabled)
- `tsconfig.json` - TypeScript configuration with `@/` path alias

## Gaps & Unknowns

- No Prettier config file exists despite `prettier` being a devDependency; formatting enforcement relies solely on ESLint with most formatting rules off
- Response envelope shape inconsistency (`success`/`message` vs `status`/`msg`) across IPC handlers has no documented standard
- Two Model patterns coexist (extending `BaseDb` vs standalone repository); transition path is unclear
- `noImplicitAny: false` in tsconfig contradicts the "NEVER use any" rule in CLAUDE.md
- Vue components use both `t()` and `$t()` for translations without documented preference
- No barrel/index files in most directories; imports reference specific files directly
