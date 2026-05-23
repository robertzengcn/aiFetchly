# Architecture

> Auto-generated codebase map. Last updated: 2026-04-22

## Summary

AiFetchly is an Electron desktop application with a three-process architecture: main process, renderer process (Vue 3 SPA), and child/worker processes. Data flows through a strict four-layer backend hierarchy (IPC Handler -> Module -> Model -> TypeORM Entity) backed by SQLite with sqlite-vec for vector operations. The frontend communicates with the main process exclusively through Electron's IPC bridge.

## Process Architecture

### Main Process (Electron)
- **Entry point**: `src/background.ts` (1156 lines)
- **Responsibilities**: Window lifecycle, IPC handler registration, database initialization, child process spawning, tray/menu management, protocol handling
- **Initialization flow**:
  1. `app.whenReady()` -> create `BrowserWindow`
  2. `registerCommunicationIpcHandlers(win)` registers all 25+ IPC handler modules
  3. Database path resolved via `Token` service + `USERSDBPATH`
  4. `SqliteDb.getInstance(dbpath)` initializes singleton DataSource
  5. Boot-up tasks via `runafterbootup()`

### Renderer Process (Vue 3 SPA)
- **Entry point**: Served by Vite dev server into `BrowserWindow`
- **Communication**: All main-process calls go through `contextBridge` API exposed in `src/preload.ts` (654 lines)
- **Frontend API layer**: `src/views/api/*.ts` -- thin wrappers that call `windowInvoke(channel, data)` / `windowSend(channel, data)` / `windowReceive(channel, callback)`
- **State management**: Vuex store in `src/views/store/` (legacy) plus Pinia; modules in `src/views/store/modules/`

### Child/Worker Processes
- **Directory**: `src/childprocess/`
- **Purpose**: CPU-intensive and long-running tasks (web scraping, contact extraction, AI processing)
- **Key constraint**: Workers NEVER access the database directly; they send results back to main process via `process.send()` IPC messages
- **Main process**: receives worker messages in IPC handlers and uses Modules for database writes
- **Worker process types**:
  - Contact extraction: `src/childprocess/contact-extraction/ContactExtractionWorker.ts`
  - Yellow pages scraper: `src/childprocess/YellowPagesScraper.ts` (7761 lines)
  - Search engine scrapers: `src/childprocess/googleScraper.ts`, `bingScraper.ts`, `baiduScraper.ts`, `yandexScraper.ts`
  - Skill worker: `src/childprocess/SkillWorker.ts`
  - Python runtime worker: `src/childprocess/PythonRuntimeWorker.ts`
- **Worker utilities** (shared): `src/childprocess/utils/` -- AIRecoveryBridge, ObserveExecuteExecutor, PageStateCapture

## Layer Architecture (Backend)

The application enforces a strict four-layer pattern for backend data flow:

### Layer 1: IPC Handlers (`src/main-process/communication/`)
- **Purpose**: Handle IPC communication, validate input, delegate to Modules/Controllers
- **Pattern**: Each feature registers handlers via `registerXxxIpcHandlers()` function
- **Registration**: All handlers registered in `src/main-process/communication/index.ts`
- **29 IPC handler files** covering: search, email, proxies, schedules, social accounts, yellow pages, RAG, AI chat, skills, system settings, dashboards, etc.
- **Channel names**: Defined as string constants in `src/config/channellist.ts`
- **AI feature gate**: Handlers for AI features check `USER_AI_ENABLED` from `src/config/usersetting.ts` before proceeding
- **Key rule**: IPC handlers NEVER access the database directly

### Layer 2: Modules (`src/modules/`)
- **Purpose**: Business logic, data transformation, coordination between models
- **Base class**: `BaseModule` (`src/modules/baseModule.ts`) -- auto-resolves database path via `Token` + `USERSDBPATH`
- **Pattern**: Extend `BaseModule`, call `this.ensureConnection()` before database operations
- **~160 TypeScript files** covering all business domains
- **Key modules**: `SearchModule.ts`, `AIChatModule.ts`, `ContactInfoModule.ts`, `YellowPagesModule.ts`, `RagSearchModule.ts`, `ScheduleManager.ts`, `VectorModule.ts`
- **Subdirectories**:
  - `adapters/` -- Vector database adapters (`FaissVectorDatabase.ts`, `SqliteVecDatabase.ts`)
  - `factories/` -- `VectorDatabaseFactory.ts`, `VectorDatabasePool.ts`
  - `platforms/` -- Yellow pages platform adapters (17 adapters for different countries)
  - `interface/` -- TypeScript interfaces and contracts
  - `lib/` -- Shared utility functions (`function.ts`, `httpclient.ts`, `databaseinit.ts`)
  - `rag/` -- RAG module (`RAGModule.ts`)

### Layer 3: Models (`src/model/`)
- **Purpose**: Data access layer using TypeORM repositories
- **Base class**: `BaseDb` (`src/model/Basedb.ts`) -- wraps `SqliteDb` singleton
- **~68 TypeScript files** with one model per entity
- **Two patterns coexist**:
  - Class-based models extending `BaseDb` (legacy, e.g., `searchResultdb.ts`)
  - Repository pattern (newer, e.g., `ContactInfo.model.ts` exports `ContactInfoRepository` class)
- **Worker process guard**: Repository classes check `process.env.DATABASE_PATH` and throw if accessed from worker

### Layer 4: Entities (`src/entity/`)
- **Purpose**: TypeORM entity definitions (database schema)
- **Base class**: `AuditableEntity` (`src/entity/Auditable.entity.ts`) provides `createdAt`, `updatedAt` with custom column ordering via `@Order` decorator
- **51 entity files** covering all database tables
- **Synchronized to DB**: TypeORM `synchronize: true` in `SqliteDb` -- no migration files

### Supporting Layer: Controllers (`src/controller/`)
- **Purpose**: Coordinate multiple modules, handle complex workflows
- **17 controller files**: `SearchController.ts`, `YellowPagesController.ts`, `ScheduleController.ts`, `UserController.ts`, etc.
- **Used by**: IPC handlers call controllers for complex operations involving multiple modules

### Supporting Layer: Services (`src/service/`)
- **Purpose**: Infrastructure services, AI integration, tool execution
- **33 service files** providing specialized functionality
- **Key services**:
  - `StreamEventProcessor.ts` (1909 lines) -- processes SSE streams from AI server
  - `ToolExecutor.ts` -- executes AI tool functions
  - `SkillImportService.ts` -- imports skill packages
  - `VectorStoreService.ts` / `VectorSearchService.ts` -- vector operations
  - `SkillExecutor.ts` -- runs skills in sandboxed environment
  - `SystemDependencyInstaller.ts` / `SystemDependencyResolver.ts` -- manage system dependencies
  - `ChunkingService.ts` -- document chunking for RAG
  - `FilePathGuard.ts` / `ValidationUtils.ts` -- security validation
  - `ToolExecutionService.ts` -- tool execution persistence

## Database Architecture

### Connection Management
- **Singleton**: `SqliteDb` class in `src/config/SqliteDb.ts` -- single `DataSource` instance per database path
- **Database file**: `{USERSDBPATH}/scraper.db` (SQLite via better-sqlite3)
- **Path resolution**: `Token` service reads `USERSDBPATH` from encrypted ElectronStore
- **Auto-sync**: TypeORM `synchronize: true` -- schema changes auto-applied on startup
- **Extension loading**: sqlite-vec native extension loaded in `prepareDatabase` hook for vector operations

### Entity System
- **Base class**: `AuditableEntity` extends `BaseEntity` with `createdAt`/`updatedAt` timestamps
- **Custom ordering**: `@Order` decorator + `order.decorator.ts` controls column order in schema
- **All 51 entities registered** in `SqliteDb` constructor's `entities` array

### Vector Operations
- **sqlite-vec**: Native SQLite extension for vector similarity search
- **Path resolution**: Complex multi-strategy path finding for development vs packaged Electron apps (`getSqliteVecExtensionPath()`)
- **Abstraction**: `IVectorDatabase` interface (`src/modules/interface/IVectorDatabase.ts`)
- **Implementations**:
  - `SqliteVecDatabase` (`src/modules/adapters/SqliteVecDatabase.ts`) -- primary
  - `FaissVectorDatabase` (`src/modules/adapters/FaissVectorDatabase.ts`) -- alternative
- **Factory**: `VectorDatabaseFactory` + `VectorDatabasePool` for managing instances
- **Modules**: `VectorModule.ts`, `VectorMetadataModule.ts` for vector CRUD operations

## Frontend Architecture

### Vue 3 SPA Structure
- **Framework**: Vue 3 with Composition API
- **UI library**: Vuetify (configured in `src/views/plugins/vuetify.ts`)
- **Routing**: `src/views/router/index.ts` with i18n-aware translated routes (`translatedRoutes.ts`)
- **State**: Vuex (legacy, in `src/views/store/`) + Pinia
- **i18n**: vue-i18n with 6 languages (en, zh, es, fr, de, ja) in `src/views/lang/`

### Component Organization
- **Pages**: `src/views/pages/{feature}/` -- 20 feature directories (search, emailextraction, emailmarketing, socialaccount, yellowpages, etc.)
- **Shared components**: `src/views/components/` -- aiChat, breadcrumbs, bubble-charts, icons, player, select, widgets
- **Layout**: `src/views/layout/layout.vue` -- main app shell
- **Dashboard**: `src/views/dashboard/` -- home page with summary cards and charts

### IPC Communication Bridge
```
Renderer (Vue)                    Main Process
     |                                |
     |-- window.api.invoke() ------->|  ipcMain.handle()
     |   (src/views/api/*.ts)        |  (src/main-process/communication/*.ts)
     |                                |       |
     |   window.api.receive() <------|  webContents.send()
     |                                |
```
- **Preload**: `src/preload.ts` maps channel constants to `ipcRenderer.invoke()`/`ipcRenderer.on()`
- **Frontend API**: `src/views/api/*.ts` wraps calls in typed functions (e.g., `submitScraper()`, `listSearchresult()`)
- **Utility**: `src/views/utils/apirequest.ts` provides `windowInvoke()`, `windowSend()`, `windowReceive()` helpers
- **Response envelope**: All IPC responses use `{ status: boolean, msg: string, data?: any }`

## Skill / AI Tool System

### Skill Registry
- **Static registry**: `src/config/skillsRegistry.ts` -- maps skill names to `SkillDefinition` objects
- **Built-in skills**: Scrape URLs from Google, scrape website content, contact extraction, etc.
- **Dynamic skills**: Imported skills registered at runtime, MCP tools merged dynamically

### Tool Execution Pipeline
1. AI server sends tool call via SSE stream
2. `StreamEventProcessor` (`src/service/StreamEventProcessor.ts`) parses events
3. `ToolExecutor` (`src/service/ToolExecutor.ts`) routes to appropriate handler
4. `FileToolService` handles file operations
5. Results returned to AI server for continuation

### AI Feature Integration
- **Chat**: `AIChatModule` + `AIChatMessageModel` for message persistence
- **RAG**: `RagSearchModule` + `RAGModule` + vector database for retrieval-augmented generation
- **Email template**: AI-generated email templates via `ai-email-template-ipc.ts`
- **Feature gate**: All AI IPC handlers check `USER_AI_ENABLED` flag

## Module System

### BaseModule Pattern
```typescript
// src/modules/baseModule.ts
export abstract class BaseModule {
    protected dbpath: string;
    protected sqliteDb: SqliteDb;

    constructor() {
        // Auto-resolve DB path from Token service
        const tokenService = new Token();
        this.dbpath = tokenService.getValue(USERSDBPATH);
        this.sqliteDb = SqliteDb.getInstance(this.dbpath);
    }

    public async ensureConnection(): Promise<void> {
        if (!this.sqliteDb.connection.isInitialized) {
            await this.sqliteDb.connection.initialize();
        }
    }
}
```
- All modules extend `BaseModule`
- Call `await this.ensureConnection()` before every database operation
- Instantiate models with `new SomeModel(this.dbpath)`

### BaseDb Pattern (Model Layer)
```typescript
// src/model/Basedb.ts
export abstract class BaseDb {
    protected sqliteDb: SqliteDb;

    constructor(filepath: string) {
        this.sqliteDb = SqliteDb.getInstance(filepath);
    }

    public async ensureConnection(): Promise<void> { /* ... */ }
}
```
- Models receive `dbpath` from the Module that creates them
- Access TypeORM repositories via `this.sqliteDb.connection.getRepository(Entity)`

## Data Flow

### Typical User Action Flow
```
User clicks button in Vue component
  -> src/views/api/search.ts: submitScraper(data)
    -> windowSend('search:scraper', data)
      -> src/preload.ts: ipcRenderer.send()
        -> src/main-process/communication/search-ipc.ts: handler
          -> src/controller/SearchController.ts or src/modules/SearchModule.ts
            -> src/model/SearchTask.model.ts: data access
              -> TypeORM -> SQLite (src/config/SqliteDb.ts)
```

### Worker Process Data Flow
```
Main process IPC handler spawns child process
  -> src/childprocess/contact-extraction/ContactExtractionWorker.ts
    -> Scrapes website, extracts contacts
    -> process.send({ type: 'extraction-progress', data })
      -> Main process receives message
        -> ContactInfoModule.saveContactExtractionResult()
          -> ContactInfo.model.ts -> TypeORM -> SQLite
        -> webContents.send() -> Renderer update
```

## Error Handling

- **Main process**: `process.on('uncaughtException')` in `background.ts` shows error dialog and logs
- **Logging**: Custom `Logger` module at `src/modules/Logger.ts` with file-based logging
- **Worker errors**: Workers send error messages via IPC; main process logs and updates UI
- **IPC errors**: Handlers wrap logic in try/catch, return `{ status: false, msg: error.message }`

## Cross-Cutting Concerns

### Security
- **Context isolation**: Enabled in BrowserWindow, Node.js integration disabled in renderer
- **Token storage**: `Token` service (`src/modules/token.ts`) encrypts values via `CryptoSource` and stores in `ElectronStoreService`
- **File path validation**: `FilePathGuard` (`src/service/FilePathGuard.ts`) validates file operations
- **Skill sandboxing**: `SandboxedSkillExecutor` (`src/service/SandboxedSkillExecutor.ts`) isolates skill execution

### Configuration
- **Settings**: `src/config/usersetting.ts` defines keys for Token store (USERSDBPATH, TOKENNAME, USER_AI_ENABLED, etc.)
- **Channel list**: `src/config/channellist.ts` -- all IPC channel name constants
- **AI tools config**: `src/config/aiTools.config.ts` -- AI tool definitions
- **Skills registry**: `src/config/skillsRegistry.ts` -- static skill definitions
- **Dependency catalog**: `src/config/dependency-catalog.json` -- system dependency definitions

### Internationalization
- **6 languages**: en, zh, es, fr, de, ja
- **Translation files**: `src/views/lang/{en,zh,es,fr,de,ja}.ts`
- **Routing**: i18n-integrated routes in `src/views/router/translatedRoutes.ts`

## Key Files

- `src/background.ts` - Main Electron process entry point
- `src/preload.ts` - Context bridge API for renderer-main communication
- `src/config/SqliteDb.ts` - Database singleton, TypeORM DataSource, sqlite-vec loading
- `src/modules/baseModule.ts` - Base class for all business logic modules
- `src/model/Basedb.ts` - Base class for all data access models
- `src/main-process/communication/index.ts` - Central IPC handler registration
- `src/config/channellist.ts` - All IPC channel name constants
- `src/config/usersetting.ts` - Token store keys (USERSDBPATH, TOKENNAME, etc.)
- `src/config/skillsRegistry.ts` - Static skill definitions for AI tool system
- `src/modules/token.ts` - Encrypted key-value store for user settings
- `src/views/utils/apirequest.ts` - Frontend IPC call wrappers
- `src/service/StreamEventProcessor.ts` - SSE stream parsing for AI features
- `src/service/ToolExecutor.ts` - AI tool function execution routing

## Gaps & Unknowns

- The relationship between Vuex (legacy `src/views/store/`) and Pinia is unclear -- both appear to coexist
- Some controllers (`src/controller/`) appear to overlap with modules (`src/modules/`) in responsibility
- The `src/views/componets/` directory (typo) exists alongside `src/views/components/` -- unclear if intentional
- Worker process auth token injection pattern (reading from Token in main process and passing via env vars) is implemented for contact extraction but consistency across all workers is not verified
- The `src/model/` directory mixes two patterns (BaseDb class extension and standalone Repository classes) without clear migration path
