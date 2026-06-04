# Codebase Structure

> Auto-generated codebase map. Last updated: 2026-04-22

## Summary

The project root contains 708 TypeScript/Vue source files under `src/`, organized by architectural role (entity, model, module, service, controller, IPC handlers) and frontend feature directories. The backend follows a strict layered architecture with a single SQLite database managed by TypeORM. Testing is split between Mocha (module tests) and Vitest (main/utility/task tests).

## Directory Layout

```
aiFetchly/                          # Project root
├── src/                            # All source code (708 .ts/.vue files)
│   ├── background.ts               # Electron main process entry (1156 lines)
│   ├── preload.ts                  # Context bridge / IPC bridge (654 lines)
│   ├── taskCode.ts                 # Task runner entry point
│   ├── utilityCode.ts              # Utility code entry point
│   ├── buckEmail.ts                # Bulk email entry point
│   ├── api/                        # HTTP API clients (remote server)
│   ├── assets/                     # Static assets (images, webgl, device)
│   ├── childprocess/               # Worker process files (~28 .ts files)
│   ├── config/                     # Configuration files
│   ├── controller/                 # Request coordinators (17 .ts files)
│   ├── entity/                     # TypeORM entities (51 .ts files)
│   ├── entityTypes/                # TypeScript type definitions (35 .ts files)
│   ├── main-process/               # Electron main process modules
│   ├── mocks/                      # Test mock data
│   ├── model/                      # Data access layer (~68 .ts files)
│   ├── modules/                    # Business logic layer (~160 .ts files)
│   ├── scripts/                    # Build/setup scripts
│   ├── service/                    # Infrastructure services (33 .ts files)
│   ├── shims/                      # TypeScript shims
│   ├── sql/                        # SQL schema files (legacy)
│   ├── test/                       # Source-level test utilities
│   ├── types/                      # Global TypeScript types
│   ├── utils/                      # Shared utilities
│   └── views/                      # Vue 3 frontend (129 .vue files)
├── test/                           # Test files (~123 .ts files)
│   ├── modules/                    # Mocha tests for controllers/services
│   ├── vitest/                     # Vitest tests
│   │   ├── main/                   # Main process tests
│   │   ├── modules/                # Module tests
│   │   ├── utilitycode/            # Utility code tests
│   │   └── taskCode/               # Task code tests
│   ├── rag/                        # RAG-specific tests
│   ├── fixtures/                   # Test data
│   ├── mocks/                      # Test mocks
│   └── utils/                      # Test utilities
├── specs/                          # Feature specifications
│   ├── 001-ai-contact-extraction/
│   ├── 001-ai-email-template/
│   ├── 001-ai-file-tools/
│   ├── 001-dashboard-statistics/
│   ├── 001-install-system-dependency/
│   └── 001-skill-system/
├── doc/                            # Design documents
├── dist/                           # Build output
├── out/                            # Electron Forge package output
├── logs/                           # Application logs
├── forge.config.js                 # Electron Forge configuration
├── package.json                    # Dependencies and scripts
├── tsconfig.json                   # TypeScript configuration
├── vite.config.mjs                 # Vite build configuration
├── .env                            # Environment variables (DO NOT READ)
└── .env.example                    # Example env vars
```

## Directory Purposes

### `src/entity/` (51 files)
TypeORM entity definitions -- database schema.
- Each file defines one database table with columns, types, and relations
- Base class: `AuditableEntity` with `createdAt`/`updatedAt`
- Custom `@Order` decorator for column ordering
- All entities registered in `src/config/SqliteDb.ts` DataSource

### `src/entityTypes/` (35 files)
TypeScript type definitions and interfaces for data shapes.
- Domain types: `scrapeType.ts`, `emailmarketingType.ts`, `schedule-type.ts`, `proxyType.ts`
- Feature types: `skillTypes.ts`, `fileToolTypes.ts`, `systemDependencyTypes.ts`
- Shared types: `commonType.ts`, `processMessage-type.ts`

### `src/model/` (68 files)
Data access layer -- TypeORM repository wrappers.
- Base class: `BaseDb` at `Basedb.ts`
- **Two naming patterns**:
  - `PascalCase.model.ts` -- newer repository pattern (e.g., `ContactInfo.model.ts`, `SearchResult.model.ts`)
  - `camelCasedb.ts` -- legacy pattern (e.g., `searchResultdb.ts`, `taskResultdb.ts`)
- Some files export repository classes (e.g., `contactInfoRepository` singleton in `ContactInfo.model.ts`)
- All models require `filepath` (database path) in constructor

### `src/modules/` (160 files, 6 subdirectories)
Business logic layer -- the core of the application.
- Base class: `BaseModule` at `baseModule.ts`
- Subdirectory organization:
  - `adapters/` (2 files) -- Vector database implementations
  - `factories/` (2 files) -- Factory pattern for vector databases
  - `platforms/` (17+ files) -- Yellow pages platform adapters (per-country)
  - `interface/` (30+ files) -- Contracts and interfaces
  - `lib/` (5 files) -- Shared utility functions
  - `rag/` (1 file) -- RAG (Retrieval-Augmented Generation) module

### `src/service/` (33 files)
Infrastructure and integration services.
- AI tool pipeline: `StreamEventProcessor.ts`, `ToolExecutor.ts`, `ToolExecutionService.ts`
- Skill system: `SkillExecutor.ts`, `SkillImportService.ts`, `SkillDiagnosticsService.ts`, `SkillPermissionService.ts`
- Document processing: `ChunkingService.ts`, `DocumentService.ts`, `HtmlConversionService.ts`, `SpreadsheetConversionService.ts`
- Vector operations: `VectorStoreService.ts`, `VectorSearchService.ts`
- System deps: `SystemDependencyInstaller.ts`, `SystemDependencyResolver.ts`, `SystemDependencyCatalog.ts`
- Security: `FilePathGuard.ts`, `ValidationUtils.ts`, `RateLimiter.ts`

### `src/controller/` (17 files)
Request coordinators for complex multi-module workflows.
- `SearchController.ts` (34692 bytes) -- search workflow
- `YellowPagesController.ts` (27369 bytes) -- yellow pages orchestration
- `ScheduleController.ts` (22872 bytes) -- schedule management
- `UserController.ts` (17069 bytes) -- user authentication
- `proxy-controller.ts` (23336 bytes) -- proxy management
- Naming: mix of `PascalCaseController.ts` and `kebab-case-controller.ts`

### `src/main-process/` (2 subdirectories)
Electron main process modules.
- `communication/` (29 files) -- IPC handlers, one file per feature domain
- `menu/` -- Application menu configuration (`MenuManager`)
- Central registration: `communication/index.ts` calls all `registerXxxIpcHandlers()` functions

### `src/childprocess/` (28 files, 2 subdirectories)
Worker/child process entry points and scraper implementations.
- `contact-extraction/` (3 files) -- `ContactExtractionWorker.ts`, `ExtractionQueue.ts`, `ContactDiscovery.ts`
- `utils/` (7 files) -- Shared worker utilities: AIRecoveryBridge, ObserveExecuteExecutor, PageStateCapture, logger
- Root-level scrapers: `YellowPagesScraper.ts`, `googleScraper.ts`, `bingScraper.ts`, `baiduScraper.ts`, `yandexScraper.ts`, `searchScraper.ts`, `scrapeManager.ts`
- Email workers: `emailScraper.ts`, `emailSearch.ts`, `emailSend.ts`, `emailCluster.ts`
- Other: `googleProxyCheck.ts`, `websiteContentScraper.ts`, `SkillWorker.ts`, `PythonRuntimeWorker.ts`

### `src/config/` (22 files)
Configuration and constants.
- `SqliteDb.ts` (24092 bytes) -- Database singleton and sqlite-vec setup
- `channellist.ts` (15971 bytes) -- All IPC channel name constants
- `skillsRegistry.ts` (36598 bytes) -- Static skill/tool definitions
- `usersetting.ts` -- Token store key names
- `aiTools.config.ts` -- AI tool configuration
- `fileToolConfig.ts` -- File tool security configuration
- `dependency-catalog.json` -- System dependency definitions
- Platform configs: `puppeteerconfig.ts`, `videosetting.ts`, `generate.ts`

### `src/views/` (17 subdirectories, 129 .vue files)
Vue 3 frontend application.
- `pages/` (20 feature directories) -- One directory per feature
- `components/` (9 subdirectories) -- Reusable UI components
- `api/` (34 files) -- Frontend API wrappers calling IPC
- `store/` -- Vuex store with modules (`app`, `user`, `error-log`, `permission`, `settings`)
- `router/` -- Vue Router configuration with i18n
- `lang/` (7 files) -- i18n translations (en, zh, es, fr, de, ja + index)
- `plugins/` (2 files) -- Vuetify and webfont loader
- `layout/` -- App shell layout (`layout.vue`)
- `styles/` -- Global CSS
- `services/` -- Frontend-only services (`notificationManager.ts`)
- `utils/` -- Frontend utilities (`apirequest.ts`, cookies, etc.)
- `dashboard/` -- Dashboard home page with charts
- `graphics/` -- SVG/graphics assets
- `feedback/` -- User feedback components

### `src/api/` (9 files)
HTTP API clients for remote server communication.
- `aiChatApi.ts` -- AI chat server API
- `deviceApi.ts` -- Device registration API
- `proxyApi.ts` -- Proxy service API
- `ragConfigApi.ts` -- RAG configuration API
- `socialAccountApi.ts` -- Social account API
- `emailMarketing*.ts` -- Email marketing API clients

## Key File Locations

### Entry Points
- `src/background.ts` -- Electron main process
- `src/preload.ts` -- Context bridge
- `index.html` -- Vite HTML entry for renderer

### Database
- `src/config/SqliteDb.ts` -- DataSource singleton
- `src/entity/*.ts` -- All entity definitions
- `src/model/Basedb.ts` -- Model base class
- `src/modules/baseModule.ts` -- Module base class

### IPC Communication
- `src/main-process/communication/index.ts` -- Handler registration hub
- `src/config/channellist.ts` -- Channel name constants
- `src/views/utils/apirequest.ts` -- Frontend IPC wrappers

### Configuration
- `src/config/usersetting.ts` -- Token key names
- `src/config/skillsRegistry.ts` -- Skill definitions
- `src/config/aiTools.config.ts` -- AI tool config
- `src/config/puppeteerconfig.ts` -- Browser automation config

### Frontend
- `src/views/router/index.ts` -- Route definitions
- `src/views/lang/index.ts` -- i18n setup
- `src/views/plugins/vuetify.ts` -- UI framework
- `src/views/store/index.ts` -- Vuex store root

### Build
- `forge.config.js` -- Electron Forge (packaging, entry points)
- `package.json` -- Scripts and dependencies
- `tsconfig.json` -- TypeScript configuration

## Naming Patterns

### Files
- **Entities**: `PascalCase.entity.ts` (e.g., `SearchTask.entity.ts`, `ContactInfo.entity.ts`)
- **Entity types**: `camelCase-type.ts` or `camelCaseType.ts` (inconsistent -- e.g., `scrapeType.ts`, `schedule-type.ts`)
- **Models (newer)**: `PascalCase.model.ts` (e.g., `ContactInfo.model.ts`, `SearchResult.model.ts`)
- **Models (legacy)**: `camelCasedb.ts` (e.g., `searchResultdb.ts`, `taskResultdb.ts`)
- **Modules**: `PascalCaseModule.ts` or `PascalCase.ts` (e.g., `ContactInfoModule.ts`, `Logger.ts`)
- **Controllers**: `PascalCaseController.ts` or `kebab-case-controller.ts` (mixed convention)
- **IPC handlers**: `kebab-case-ipc.ts` (e.g., `contactExtraction-ipc.ts`, `ai-chat-ipc.ts`)
- **Frontend API**: `camelCase.ts` (e.g., `search.ts`, `emailextraction.ts`)
- **Vue components**: `PascalCase.vue` (e.g., `AiChatBox.vue`, `DashboardSummaryCards.vue`)
- **Worker files**: `PascalCase.ts` (e.g., `ContactExtractionWorker.ts`, `SkillWorker.ts`)

### Directories
- **Frontend pages**: lowercase (e.g., `search/`, `emailextraction/`, `yellowpages/`)
- **Frontend components**: kebab-case or lowercase (e.g., `aiChat/`, `bubble-charts/`)
- **Source code**: camelCase or lowercase (e.g., `childprocess/`, `main-process/`)

## Where to Add New Code

### New Feature (full stack)
1. **Entity**: `src/entity/Feature.entity.ts` -- TypeORM table definition
2. **Entity type**: `src/entityTypes/featureType.ts` -- TypeScript interfaces
3. **Model**: `src/model/Feature.model.ts` -- Data access (extend `BaseDb` or create Repository)
4. **Module**: `src/modules/FeatureModule.ts` -- Business logic (extend `BaseModule`)
5. **IPC handler**: `src/main-process/communication/feature-ipc.ts` -- Register with `registerFeatureIpcHandlers()`
6. **Channel constants**: Add to `src/config/channellist.ts`
7. **Preload**: Add channel constants and API exposure in `src/preload.ts`
8. **Frontend API**: `src/views/api/feature.ts` -- IPC wrapper functions
9. **Frontend page**: `src/views/pages/feature/` -- Vue components
10. **i18n**: Add translations to all 6 language files in `src/views/lang/`
11. **Register entity**: Add to `entities` array in `src/config/SqliteDb.ts`
12. **Register IPC**: Import and call in `src/main-process/communication/index.ts`

### New Module Only
- Create `src/modules/FeatureModule.ts` extending `BaseModule`
- Use models via `new SomeModel(this.dbpath)`
- Call `await this.ensureConnection()` before database operations

### New Worker/Child Process
1. **Entry point**: `src/childprocess/worker-name.ts`
2. **Register in forge.config.js**: Add entry under `build` section with Vite config
3. **Spawn from IPC handler**: Use `child_process.spawn()` with compiled JS path
4. **NEVER access DB directly**: Send results to main process via `process.send()`

### New Test
- **Mocha**: `test/modules/feature.test.ts` for controller/service/module tests
- **Vitest**: `test/vitest/main/feature.test.ts` for main process tests
- **Utility tests**: `test/vitest/utilitycode/feature.test.ts`

## File Counts by Directory

| Directory | Files (.ts/.vue) | Purpose |
|-----------|-------------------|---------|
| `src/` total | 708 | All source code |
| `src/entity/` | 51 | TypeORM entities |
| `src/entityTypes/` | 35 | TypeScript types |
| `src/model/` | 68 | Data access layer |
| `src/modules/` | 160 | Business logic |
| `src/modules/platforms/` | 17+ | Yellow pages adapters |
| `src/modules/interface/` | 30+ | Interfaces/contracts |
| `src/service/` | 33 | Infrastructure services |
| `src/controller/` | 17 | Request coordinators |
| `src/main-process/communication/` | 29 | IPC handlers |
| `src/childprocess/` | 28 | Worker processes |
| `src/config/` | 22 | Configuration |
| `src/views/` (Vue) | 129 .vue | Frontend pages/components |
| `src/views/api/` | 34 | Frontend API wrappers |
| `src/api/` | 9 | Remote HTTP API clients |
| `test/` total | ~123 | All test files |

## Special Directories

### `.planning/`
- Purpose: GSD codebase analysis documents
- Generated: Yes (by GSD map commands)
- Committed: Yes

### `specs/`
- Purpose: Feature specifications with contracts, checklists, and implementation plans
- Generated: Yes (by GSD workflow)
- Committed: Yes

### `doc/`
- Purpose: Design documents, technology research, PRD files
- Generated: Partially
- Committed: Yes

### `.vite/build/`
- Purpose: Compiled output for Electron Forge entry points
- Generated: Yes (by Vite build)
- Committed: No (in .gitignore)

### `out/`
- Purpose: Electron Forge packaged application output
- Generated: Yes (by `yarn make`)
- Committed: No

### `dist/`
- Purpose: Vite build output for renderer
- Generated: Yes
- Committed: No

## Gaps & Unknowns

- File count for `.vue` files in `src/views/componets/` (typo directory) not verified
- Exact Pinia store location and usage pattern not fully mapped (coexists with Vuex)
- Some legacy `*db.ts` files in `src/model/` may be unused or superseded by `*.model.ts` counterparts
- `src/sql/` directory appears to contain legacy SQL schemas that may no longer be in use
