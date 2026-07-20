# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AiFetchly is an AI-powered marketing automation Electron application for social media platforms (Facebook, Twitter, YouTube, etc.). The project combines web scraping, automation, and email marketing capabilities with a Vue 3 frontend and TypeScript backend.

## Development Commands

### Essential Commands
- `yarn dev` - Start development server with hot reload
- `yarn build` - Build for production
- `yarn start` - Start Electron app
- `yarn make` - Package application for current platform
- `yarn test` - Run test suite with Mocha
- `yarn tsc` - Type check with TypeScript (watch mode)

### Local Testing URL
- The application can be tested in a browser at `http://localhost:5173` after running `yarn dev`.

### Specialized Commands
- `yarn login -c <campaignId>` - Login to social platform for specific campaign
- `yarn task -t <taskDetails>` - Run specific task
- `yarn init` - Initialize SQL database
- `yarn rebuild-better-sqlite` - Rebuild better-sqlite3 for the installed Electron version (also runs automatically via `postinstall`)
- `yarn vue-check` - Vue TypeScript type checking

### Testing Commands
- `yarn vitest-googlescraper` - Test Google scraper functionality
- `yarn testhttpclient` - Test HTTP client
- `yarn testyoutubeupload` - Test YouTube upload functionality
- `yarn testdownload` - Test video download (bilibili)

## Architecture Overview

### Project Structure
```
src/
├── background.ts              # Main Electron process entry point
├── preload.ts                 # Preload scripts
├── main-process/             # IPC handlers and main process logic
├── controller/                # Business logic controllers
├── modules/                   # Core functionality modules
├── childprocess/              # Child/worker process entry points
│   ├── contact-extraction/   # Contact extraction worker files
│   ├── yellowPagesScraper.ts # Yellow pages scraper worker
│   ├── websiteContentScraper.ts # Website content scraper worker
│   └── googleProxyCheck.ts   # Google proxy checker worker
├── entity/                    # Database entities (TypeORM)
├── entityTypes/              # TypeScript type definitions
├── model/                    # Data models
├── service/                  # Service layer
├── views/                    # Vue 3 frontend application
│   ├── pages/               # Page components
│   ├── components/          # Reusable components
│   ├── api/                 # Frontend API layer
│   ├── store/               # Pinia state management
│   └── utils/               # Frontend utilities
├── config/                   # Configuration files
└── worker.ts                 # Legacy worker process (deprecated)
```

### Key Components

#### Database & Storage (Four-Layer Architecture)

The real layering is **four** layers, not three. IPC handlers delegate to a
**Service** (orchestration / AI / streaming) *or* a **Module** (single-domain
CRUD + rules), which use **Models** for data access over **Entities** → DB.

- **SQLite with TypeORM** for local data persistence; **sqlite-vec** for vector operations.
- Database config in `src/config/SqliteDb.ts`; entities in `src/entity/` (TypeORM `@Entity`).
- **Models** (`src/model/`, extend `BaseDb`) — data access via TypeORM repositories. Legacy raw-SQL `*db.ts` files via `Scraperdb` are being consolidated into Models (WS-3).
- **Modules** (`src/modules/`, extend `BaseModule`) — single-domain CRUD + business rules over one entity family.
- **Services** (`src/service/`) — orchestration that spans multiple Modules and owns AI / streaming / tool-call flows (e.g. `AIChatQueryLoop`, `StreamEventProcessor`, `ToolExecutor`, `AiFeatureGate`). **This layer was previously undocumented in CLAUDE.md** despite holding ~166 files — it is the application's "AI brain."
- **IPC Handlers** (`src/main-process/communication/`) — thin: validate input with Zod (`registerValidatedHandler` / `registerAiValidatedHandler`) → call a Service/Module → return the `CommonMessage<T>` `{status,msg,data}` envelope. **Never** touch TypeORM repositories directly.

**Where does new code go?**
- **Service** (`src/service/`) — if it orchestrates multiple Modules, owns a long-running/streaming flow, or invokes AI models / tools.
- **Module** (`src/modules/`) — if it is single-domain CRUD + business rules over one entity family.
- **Model** (`src/model/`) — data access only (queries, repositories).
- **Entity** (`src/entity/`) — schema only (`@Entity`, columns, indices). Add `@Index()` to FK columns (`*_id`) and frequently-filtered columns (e.g. `status`, `ai_analysis_status`) — these are the hot query paths (WS-3 R3.5).

#### IPC Communication
- Main process handlers in `src/main-process/communication/`
- Frontend API layer in `src/views/api/`
- Uses contextBridge for secure renderer-main communication
- **AI feature requests:** When handling any AI function request from the frontend (e.g. keyword generation, chat, tools), **check AI enable first** in the IPC handler before doing work. Use `Token` and `USER_AI_ENABLED` from `@/config/usersetting`; if not enabled, return `{ status: false, msg: '...', data: null }` immediately.

#### Social Platform Integration
- Platform-specific scrapers in `src/modules/`
- Browser automation using Puppeteer with stealth plugins
- Account management and cookie handling
- Support for multiple social media platforms

#### Task Management
- Scheduled tasks using cron expressions
- Background task execution with child processes
- Task state management and result tracking

## Technology Stack

### Core Technologies
- **Electron** - Desktop application framework
- **Vue 3** - Frontend framework with Composition API
- **TypeScript** - Type-safe JavaScript
- **Vite** - Build tool and dev server
- **Pinia** - State management
- **Vuetify** - UI component library
- **Zod v3** (`zod ^3.24.0`) - Full-stack type validation infrastructure

### Key Dependencies
- **Puppeteer** - Web automation and scraping
- **TypeORM** - Database ORM
- **better-sqlite3** - SQLite database driver
- **node-cron** - Task scheduling
- **openai** - AI integration
- **zod** - Schema definition and runtime validation (imported via `zod`)

## Development Patterns

### TypeScript Rules
- **NEVER use `any` type** - use proper types or `unknown` instead
- Define explicit interfaces for complex data structures
- All functions must have explicit return types
- Use proper error handling with `unknown` instead of `any` for catch blocks

### Zod Validation Infrastructure - MANDATORY RULE
**This project uses Zod** (`zod ^3.24.0`) as its full-stack type validation infrastructure. Tool definition, configuration management, cross-process communication, and setting validation all require Zod for type safety validation.

#### Import Convention
- Always import from `zod` (the standard import — 66 files use this convention):
  ```typescript
  import { z } from "zod";
  ```
- Derive TypeScript types from schemas with `z.infer<typeof schema>` rather than hand-writing interfaces that mirror the schema.

#### Where Zod Is Required
1. **Tool definitions** - AI tool parameter schemas must be declared as Zod schemas so input can be validated before execution.
2. **Configuration management** - Configuration objects (user settings, feature flags, runtime config) must be validated with Zod schemas at load boundaries.
3. **Cross-process communication** - IPC payloads between main and renderer (or main and worker processes) must be validated against Zod schemas on the receiving side before use.
4. **Setting validation** - Any persisted or externally-supplied setting must pass a Zod schema before being trusted.

#### Workflow
1. Define a `z.object({ ... })` schema at the boundary where untrusted data enters the process.
2. Call `.parse()` (throw on invalid) or `.safeParse()` (collect errors) at the entry point.
3. Export the inferred TypeScript type alongside the schema so consumers get static types for free.
4. Never `as`-cast untrusted input to a type without running it through the schema first.

### Code Organization
- Use PascalCase for classes/components, camelCase for variables/functions
- Modular architecture with clear separation of concerns
- IPC handlers should sanitize all data passed between processes
- Database operations must use TypeORM entities

### Auto-Commit After Completing Functions - MANDATORY RULE
**CRITICAL: After completing each function or logical unit of work, you MUST automatically stage and commit the changes to git.**

#### Workflow

1. **After completing a function**, immediately:
   - Stage the changed files: `git add <specific-files>`
   - Commit with a descriptive message following conventional commits format
   - Do NOT wait for the user to ask — do it automatically

2. **Commit message format**: `<type>: <description>`
   - Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`
   - Description should explain *what* and *why*, not just *what changed*

3. **What counts as a "completed function"**:
   - A new function/method that is fully implemented
   - A bug fix that resolves a specific issue
   - A refactoring of an existing function
   - A new test that covers a specific case
   - A set of related changes that form one logical unit (e.g., entity + model + module for one feature)

4. **What NOT to commit**:
   - Incomplete or broken code
   - Temporary debug code or console.log statements
   - Files with compilation errors

5. **Each fix task MUST be committed immediately upon completion**:
   - After fixing TypeScript errors, lint issues, or any code defects, stage and commit right away.
   - Do not batch multiple fixes into one commit unless they form a single logical unit.
   - The commit message must reference what was fixed (e.g., `fix: resolve TS2339 in PluginManager.vue`).

6. **Example**:
   - Implement `SystemDependencyCatalog.getDependencies()` → stage and commit
   - Implement `SystemDependencyRetryService.retry()` → stage and commit
   - Add entity `DependencyInstallAudit` → stage and commit
   - Fix TypeScript error in `PluginManager.vue` → stage and commit

### AI Feature IPC Handlers - MANDATORY RULE
**When adding or modifying IPC handlers that serve AI functions (e.g. AI chat, keyword generation, AI tools):**
- **Check AI enable first** at the start of the handler, before parsing request data or calling AI APIs.
- Use `Token` and `USER_AI_ENABLED` (from `@/config/usersetting`). If the value is not enabled (e.g. not `'true'`), return immediately with `status: false` and a clear message; do not proceed with the request.
- This ensures gated AI features respect the user's plan and avoids unnecessary work when AI is disabled.

### Child/Worker Process File Placement - MANDATORY RULE
**CRITICAL: All child/worker process entry points and worker-specific code MUST be placed in the `src/childprocess/` directory.**

#### Directory Structure

```
src/childprocess/
├── contact-extraction/        # Worker-specific code for contact extraction
│   ├── ContactExtractionWorker.ts  # Worker entry point
│   ├── ExtractionQueue.ts          # Worker queue management
│   ├── ContactDiscovery.ts         # Worker scraping logic
│   └── BrowserPool.ts              # Worker browser pool
├── yellowPagesScraper.ts      # Yellow pages scraper worker entry
├── websiteContentScraper.ts   # Website content scraper worker entry
└── googleProxyCheck.ts        # Google proxy checker worker entry
```

#### Rules for Child Process Files

1. **Entry Points**: All child process entry points must be in `src/childprocess/`
   - Each child process is a separate TypeScript file that spawns a worker
   - Entry point files are registered in `forge.config.js` under the `build` section

2. **Worker-Specific Code**: Code that only runs in worker processes should be in `src/childprocess/`
   - Queue management for worker tasks
   - Worker-specific business logic (scraping, processing, etc.)
   - Worker initialization and message handling

3. **Shared Code**: Code used by both main and worker processes should be in `src/modules/`
   - Business logic modules that can be used in any process
   - Data models and type definitions
   - Utility functions

4. **DO NOT** place worker files in `src/modules/`
   - `src/modules/` is for shared business logic only
   - Worker-specific code has no place in the modules directory

#### Example

```typescript
// ✅ CORRECT - Worker entry point in src/childprocess/
// src/childprocess/contact-extraction/ContactExtractionWorker.ts
function initializeWorker(): void {
    process.on('message', (message: WorkerMessage) => {
        if (message.type === 'extract-contact') {
            handleExtractionRequest(message);
        }
    });
}

// ✅ CORRECT - Worker-specific queue in src/childprocess/
// src/childprocess/contact-extraction/ExtractionQueue.ts
export class ContactExtractionQueue {
    async add(job: ExtractionJob): Promise<void> {
        this.queue.push(job);
        this.process();
    }
}

// ❌ WRONG - Worker code in src/modules/
// src/modules/ContactExtractionWorker.ts  // DON'T DO THIS!
```

#### Forge Configuration

When adding new worker processes, update `forge.config.js`:

```javascript
{
  entry: 'src/childprocess/myWorker.ts',  // Always use childprocess/ directory
  config: 'vite.myWorker.config.mjs'
}
```

### Database Access Architecture - MANDATORY RULE
**CRITICAL: All database logic MUST be placed in Model and Module classes, NEVER directly in IPC handlers.**

#### Three-Layer Architecture

1. **Model Layer** (`src/model/`): Data Access
   - Direct database operations using TypeORM repositories
   - Query builders and database-specific logic
   - Extends `BaseDb` or uses repositories
   - Examples: `ContactInfo.model.ts`, `SearchResult.model.ts`

2. **Module Layer** (`src/modules/`): Business Logic
   - Extends `BaseModule` for database connection management
   - Uses Models for data access
   - Implements business rules and validation
   - Coordinates multiple models if needed
   - Examples: `ContactInfoModule.ts`

3. **IPC Handler Layer** (`src/main-process/communication/`): Communication Only
   - Handles IPC communication with renderer process
   - Calls Module/Controller methods for business logic
   - Validates input and sanitizes data
   - NEVER directly accesses database or uses TypeORM repositories
   - Examples: `contactExtraction-ipc.ts`

#### Required Pattern

```typescript
// ❌ WRONG - Direct database access in IPC handler
ipcMain.handle('SOME_CHANNEL', async (event, data) => {
    const dataSource = SqliteDb.getInstance(path).connection;
    const repository = dataSource.getRepository(SomeEntity);
    return await repository.find();
});

// ✅ CORRECT - Use Module for business logic
ipcMain.handle('SOME_CHANNEL', async (event, data) => {
    const module = new SomeModule();
    return await module.getSomeData(data);
});
```

#### Database Path Resolution
- **Always use `Token` service with `USERSDBPATH`** for database path
- Never use `app.getPath('userData')` directly for database access
- Models and Modules extending `BaseModule`/`BaseDb` handle this automatically

```typescript
// ✅ CORRECT - BaseModule handles database path
export class SomeModule extends BaseModule {
    constructor() {
        super(); // Automatically gets dbpath from Token service
    }

    async someMethod() {
        await this.ensureConnection(); // Ensures connection is initialized
        const model = new SomeModel(this.dbpath);
        return await model.someQuery();
    }
}
```

#### Why This Architecture Matters
- **Separation of Concerns**: Each layer has a single responsibility
- **Reusability**: Models and Modules can be used in multiple contexts (IPC, worker processes, tests)
- **Maintainability**: Database logic is centralized and easier to update
- **Testability**: Models and Modules can be tested independently of IPC
- **Consistency**: All database operations use the same path and connection management

### Child/Worker Process Database Access - MANDATORY RULE
**CRITICAL: Child/worker processes MUST NEVER access the database directly. All database operations MUST go through the main process.**

#### Worker Process Architecture

Worker processes (spawned via `child_process.spawn` or similar) are isolated Node.js processes that:
- **DO NOT** have access to Electron's `app` object
- **DO NOT** have direct database access
- **MUST** communicate with main process via IPC messages
- **SHOULD ONLY** perform CPU-intensive or long-running tasks (web scraping, AI processing, etc.)

#### Required Pattern for Worker Processes

```typescript
// ❌ WRONG - Worker process trying to access database directly
// In worker process (ExtractionQueue.ts)
import { contactInfoRepository } from '@/model/ContactInfo.model';

async function processJob(job: Job) {
    // This will FAIL - worker doesn't have access to Electron APIs
    await contactInfoRepository.updateStatus(job.id, 'completed');
}

// ✅ CORRECT - Worker sends data to main process via IPC
// In worker process (ExtractionQueue.ts)
async function processJob(job: Job) {
    const result = await performExtraction(job);

    // Send result to main process via IPC
    process.send({
        type: 'extraction-progress',
        resultId: job.id,
        status: 'completed',
        data: result
    });
}
```

#### Main Process Handles Database Operations

```typescript
// ✅ CORRECT - Main process IPC handler handles database
// In main process (contactExtraction-ipc.ts)
worker.on('message', async (message) => {
    if (message.type === 'extraction-progress') {
        // Use Module to save to database
        const module = new ContactInfoModule();
        await module.saveContactExtractionResult(message.resultId, message.data);

        // Forward to renderer
        mainWindow.webContents.send('extraction-progress', message);
    }
});
```

#### Data Flow Architecture

```
┌──────────────────┐
│  Worker Process  │
│  (No DB Access)  │
│  - Scraping      │
│  - AI Processing │
│  - Computation   │
└────────┬─────────┘
         │ IPC Message (results + data)
         ▼
┌──────────────────────────────┐
│  Main Process (IPC Handler)   │
│  ┌────────────────────────┐  │
│  │ Module Layer           │  │
│  │  (Business Logic)      │  │
│  └────────┬───────────────┘  │
│           ▼                   │
│  ┌────────────────────────┐  │
│  │ Model Layer            │  │
│  │  (Database Access)     │  │
│  └────────┬───────────────┘  │
└───────────┼──────────────────┘
            ▼
┌───────────────────────────────┐
│  Database (SQLite/TypeORM)    │
└───────────────────────────────┘
```

#### Enforcement in Models

Models should detect and prevent database access from worker processes:

```typescript
private getRepository(): Repository<SomeEntity> {
    // Prevent access from worker process
    if (process.env.WORKER_TYPE) {
        throw new Error(
            'Direct database access from worker process is not allowed. ' +
            'Worker should send data to main process via IPC.'
        );
    }

    // Normal database access for main process
    const tokenService = new Token();
    const dbPath = tokenService.getValue(USERSDBPATH);
    return SqliteDb.getInstance(dbPath).connection.getRepository(SomeEntity);
}
```

#### Why Workers Must Not Access Database

1. **No Electron APIs**: Worker processes don't have access to `app.getPath()`, `safeStorage`, etc.
2. **Connection Management**: Database connections are managed by main process
3. **Data Integrity**: Main process ensures proper transaction handling and validation
4. **Error Handling**: Centralized error handling and logging in main process
5. **Architecture Consistency**: All database operations follow the same Model/Module pattern
6. **Concurrency Safety**: Main process serializes database access to prevent conflicts

#### Examples of Correct Worker Usage

- **Contact Extraction Worker**: Scrapes websites, sends extracted data to main process
- **AI Processing Worker**: Runs AI models, sends results to main process for storage
- **Video Processing Worker**: Processes media files, main process saves metadata

**Remember**: Worker processes are for CPU-intensive tasks only. All CRUD operations (Create, Read, Update, Delete) MUST be handled by the main process through Modules and Models.

### Security Best Practices
- Context isolation enabled, Node.js integration disabled in renderer
- All IPC communication through contextBridge
- User input validation and sanitization
- Secure token storage using Electron's safeStorage

### AI Navigation Route Metadata - MANDATORY RULE
**CRITICAL: When adding or modifying Vue routes, keep AI app navigation metadata accurate so users can ask AI Chat to open pages by natural language.**

#### Required Route Metadata Workflow

1. **For safe parameter-free application pages**, allow AI navigation by default or set `meta.aiNavigable = true`.
   - Good candidates: list pages, dashboard pages, settings pages, logs, management screens, and normal index pages.
   - Add `meta.aiAliases` when users may describe the page differently from its route title.
   - Add `meta.aiDescription` when the page purpose is not obvious from the route title.

2. **For unsafe or unsupported pages**, explicitly set `meta.aiNavigable = false`.
   - Always exclude login, auth callback, logout, error-only, internal helper, destructive workflow, and action-on-load pages.
   - Exclude detail/edit pages that require route params such as `:id` unless a safe default behavior is implemented.

3. **Use route names, not component file paths, as navigation targets.**
   - AI tools should return validated route names such as `Email_Marketing_Service_LIST`.
   - Actual `router.push(...)` calls must run in the renderer process, never directly from Electron main process.

4. **Example route metadata**:
```typescript
{
  path: "emailreply/audit/list",
  name: "AI_Auto_Reply_Audit_List",
  meta: {
    visible: true,
    title: "route.ai_auto_replies",
    icon: "mdi-robot-outline",
    aiNavigable: true,
    aiAliases: ["email reply log", "auto reply log", "reply audit", "ai replies"],
    aiDescription: "Review AI auto-reply decisions, sent replies, skipped replies, and audit logs"
  },
  component: () => import("@/views/pages/emailreply/auditlist.vue")
}
```

### Internationalization (i18n) - MANDATORY RULE
**CRITICAL: When adding or modifying any user-facing text in the UI, you MUST update translations for ALL supported languages.**

#### Supported Languages
The application supports the following languages (defined in `src/views/lang/`):
- English (en.ts) - Default/Fallback language
- Chinese (zh.ts)
- Spanish (es.ts)
- French (fr.ts)
- German (de.ts)
- Japanese (ja.ts)

#### Translation Workflow - REQUIRED
When adding or modifying UI text:

1. **Add/Update translation key in English** (`src/views/lang/en.ts`)
   - Use the `t()` function to retrieve translations in Vue components
   - Always provide English fallback: `t('key.subkey') || 'English Text'`
   - Organize translations by feature/module (e.g., `contactExtraction`, `websiteAnalysis`)

2. **Update ALL other language files** (zh.ts, es.ts, fr.ts, de.ts, ja.ts)
   - Add the same translation keys to ALL language files
   - Provide accurate translations for each language
   - Maintain consistent key structure across all files

3. **Use translations in Vue components**
   - Import `useI18n` from `vue-i18n`
   - Use `t('key.subkey')` for all user-facing text
   - Always provide English fallback for safety

4. **Example Pattern**:
```typescript
// In component
import { useI18n } from "vue-i18n";
const { t } = useI18n();

// In template
{{ t('contactExtraction.extract_contact_info') || 'Get Contact Info' }}

// In script
alert(t('contactExtraction.select_items_hint') || 'Please select at least one item');
```

5. **Language Files Location**:
   - All language files: `src/views/lang/{en,zh,es,fr,de,ja}.ts`
   - Language configuration: `src/views/lang/index.ts`

6. **Verification**:
   - Test UI in multiple languages after changes
   - Check for missing translations (will show English fallback)
   - Ensure all new features have complete translations

**FAILURE TO UPDATE ALL LANGUAGE FILES WILL RESULT IN INCOMPLETE INTERNATIONALIZATION AND USER EXPERIENCE ISSUES.**

### AI App Navigation (open_app_page tool) - MANDATORY RULE
**CRITICAL: The AI navigation catalog is driven by the route manifest, NOT the router. The manifest is the single source of truth for model-facing route discovery.**

#### Source Of Truth
- **Manifest** (`src/config/aiNavigationRouteManifest.ts`): the authoritative list of AI-navigable routes, aliases, and descriptions. The `open_app_page` tool builds its catalog from this file. It is pure data (main-process safe — no Vue / Vue Router imports).
- **Router meta** (`src/views/router/index.ts`): secondary / documentation only. The renderer re-validates every route against `router.getRoutes()` and blocks any route with `meta.aiNavigable === false`.

#### When Adding Or Modifying A Route
1. **Safe parameter-free list/index/settings pages**: add an entry to `aiNavigationRouteManifest.ts` with `aiNavigable: true`, accurate `aiAliases` (natural-language phrases users would actually say), and `aiDescription`.
2. **Aliases**: pick phrases a user would type (e.g. `"email reply log"`, `"smtp settings"`). Do NOT add bare single-word aliases for entities that have detail/edit param routes (e.g. bare `"campaign"`) — otherwise a detail request like `"campaign detail"` matches the list page instead of returning `needsRouteParams`.
3. **Unsafe routes** (login, auth callback, required-param detail/edit pages, destructive workflows, internal helper pages): do NOT add them to the manifest. Optionally set `meta.aiNavigable = false` in the router for defense-in-depth.
4. Verify the `routeName` and `path` EXACTLY match `src/views/router/index.ts` — the catalog/matcher/tool tests assert against real names.

#### Why A Manifest (not router meta) Is Authoritative
`src/views/router/index.ts` imports Vue Router, `Layout`, and lazy `.vue` components. Importing it from main-process tool code would pull renderer-only code into the main bundle. The pure manifest avoids this. See `docs/prd/ai-app-navigation-tool-technical-design.md` §7.

#### Architecture Boundary
- **Main process / tool layer** (`src/service/AIAppNavigationToolService.ts`): resolves intent to a validated navigation command. NEVER calls Vue Router, NEVER mutates data, NEVER echoes raw user input.
- **Renderer** (`src/views/utils/aiNavigationResultHandler.ts`): owns Vue Router; re-validates the route and calls `router.push`. Wired in `AiChatBox.vue` (V1) and `AiChatV2.vue` (V2) `tool_result` handlers.

#### Tests
- Catalog / matcher / renderer-helper: `test/vitest/utilitycode/aiAppNavigation*.test.ts`
- Tool service: `test/vitest/main/aiAppNavigationTool.test.ts`

Run the relevant scenario through these tests before shipping manifest changes.

### Testing Strategy

#### Test Organization
All test files are located in the `test/` directory at the project root:

```
test/
├── modules/              # Mocha tests for module functionality
│   ├── *.test.ts        # Module unit tests (controllers, services, modules)
├── vitest/              # Vitest tests for different processes
│   ├── main/            # Main process unit tests (IPC handlers, main process logic)
│   ├── utilitycode/     # Utility code tests (utility functions, helpers)
│   └── taskCode/        # Task code tests (task execution logic)
├── rag/                 # RAG-specific tests
│   ├── *.test.ts        # RAG module tests
│   └── integration/     # RAG integration tests
└── output/              # Test output directory
```

#### Test Frameworks
- **Mocha**: Used for module tests (CommonJS style) - `test/modules/*.test.ts`
- **Vitest**: Used for main process and utility code tests - `test/vitest/*/*.test.ts`
- All test files use `.test.ts` extension

#### Test Placement Guidelines
- **Controller tests**: `test/modules/` (mirrors `src/controller/`)
- **Service tests**: `test/modules/` (mirrors `src/service/`)
- **Module tests**: `test/modules/` (mirrors `src/modules/`)
- **Main process tests**: `test/vitest/main/` (mirrors `src/main-process/`)
- **IPC handler tests**: `test/vitest/main/`
- **Utility function tests**: `test/vitest/utilitycode/`
- **Task code tests**: `test/vitest/taskCode/`

#### Running Tests
- Run all Mocha tests: `yarn test`
- Run specific test: `yarn test <test-file-path>`
- Run main process tests: `yarn testmain`
- Run utility code tests: `yarn vitest-puppeteer`
- Use DEBUG flags for detailed logging: `DEBUG='module:*' yarn test`

##### TypeScript Type-Check Gate (Vitest)
Vitest's default esbuild mode strips types without checking them, so type errors silently pass. To prevent this, both `vite.main.config.mjs` and `vite.utilityCode.config.mjs` reference `test/vitest/_typecheck/globalSetup.ts`, which runs `tsc --noEmit` once at startup.

- **Behavior**: If `tsc` reports any error, the whole vitest run aborts before tests execute.
- **To bypass** (only for tight inner loops when you know types are clean): `AIFETCHLY_SKIP_TSC=1 yarn testmain`. Do not commit code that needs this.
- **To extend to other configs**: add `globalSetup: ['./test/vitest/_typecheck/globalSetup.ts']` to the config's `test` block.

## Database Schema

### Key Entities
- **Campaign** - Marketing campaigns
- **SocialAccount** - Social media platform accounts
- **SocialTask** - Automation tasks
- **EmailMarketing** - Email marketing campaigns
- **Schedule** - Task scheduling information

### Vector Operations
Current branch (`sqlite-vec-merge`) is integrating sqlite-vec for vector similarity operations. Modified files:
- `src/model/Vector.model.ts`
- `src/modules/adapters/SqliteVecDatabase.ts`

## Common Development Tasks

### Adding New Social Platform
1. Create platform-specific module in `src/modules/` (extends `BaseModule`)
2. Add entity types in `src/entityTypes/`
3. Create Model in `src/model/` if database operations needed
4. Implement scrapers following existing patterns
5. Add frontend components in `src/views/pages/`
6. Update IPC handlers to use Module methods (never database directly)

### Adding New Tasks
1. Define task schema in entity types
2. Create Model in `src/model/` for data access (if database operations needed)
3. Create Module in `src/modules/` for business logic (extends `BaseModule`)
4. Create controller in `src/controller/` (if needed for coordination)
5. Add frontend UI components
6. Register IPC handlers that call Module/Controller methods (never database directly)

### Database Changes
1. Update TypeORM entities in `src/entity/`
2. Create/update Model classes in `src/model/` for data access (extends `BaseDb`)
3. Create/update Module classes in `src/modules/` for business logic (extends `BaseModule`)
4. Update IPC handlers in `src/main-process/communication/` to use Modules
5. Run migrations with `yarn init` if structure changes
6. Update TypeScript types accordingly

**IMPORTANT**: Never add database logic directly to IPC handlers. Always create Model and Module classes first.

## Environment Configuration

### Required Environment Variables
- `VITE_REMOTEADD` - Backend API URL
- `UPDATESERVER` - Update server URL for auto-updater

### Development Setup
1. Install dependencies with `yarn`
2. Set up backend service URL in `.env` file
3. Run database initialization with `yarn init`
4. Start development with `yarn dev`

## Debugging

### Main Process Debugging
- Use Electron DevTools for main process debugging
- Logs are written to application log directory
- Use DEBUG flags for module-specific logging

### Renderer Process Debugging
- Chrome DevTools available in development
- Vue DevTools extension installed automatically
- Component state inspection through Vue DevTools

### Common Issues
- SQLite3 native module may require rebuilding after Node.js updates
- Puppeteer browser instances should be properly managed to avoid memory leaks
- IPC calls must handle both success and error cases
- **Worker processes cannot access database directly**: If you see errors like "Cannot read properties of undefined (reading 'getName')" in worker stderr, your worker is trying to access the database. Worker processes must communicate with main process via IPC for all CRUD operations.

## Gstack

- **Always use `/browse` from gstack for all web browsing** — never use `mcp__claude-in-chrome__*` tools.
- Available gstack skills: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/setup-gbrain`, `/retro`, `/investigate`, `/document-release`, `/document-generate`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`, `/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`, `/learn`.

## Active Technologies
- TypeScript 5.x (001-ai-contact-extraction)
- SQLite with TypeORM (local), Remote AI server (HTTP/SSE) (001-ai-email-template)
- TypeScript 5.x + Electron, Vue 3, Vuetify, Pinia, TypeORM, better-sqlite3, Puppeteer, papaparse, xlsx, turndown (001-skill-system)
- SQLite (TypeORM) for installed skills, documents/chunks; sqlite-vec for vector embeddings; Token service for permission grants (001-skill-system)
- TypeScript 5.x (Electron main process + Vue 3 renderer) + Electron utility process API, `child_process.spawnSync`/`spawn`, existing `SkillDiagnosticsService`, `SkillExecutor`, `SkillPermissionService`, `StreamEventProcessor` (001-install-system-dependency)
- SQLite via TypeORM (audit log entity), JSON file (local dependency catalog shipped with app) (001-install-system-dependency)
- TypeScript 5.x + fast-glob, @vscode/ripgrep, write-file-atomic, isbinaryfile, picomatch, zod, diff (001-ai-file-tools)
- No new database entities (uses existing ToolExecutionService for persistence) (001-ai-file-tools)

## Recent Changes
- 001-ai-contact-extraction: Added TypeScript 5.x
- Database architecture refactoring: Moved database logic from IPC handlers to Model/Module classes
  - Created `ContactInfoModule.ts` for business logic
  - Updated `ContactInfo.model.ts` to use proper database path resolution
  - Refactored `contactExtraction-ipc.ts` to use Module pattern
- Worker process architecture fix: Enforced proper separation between worker and main process
  - Removed direct database access from `ExtractionQueue.ts` (worker process)
  - Added `handleWorkerProgress()` in main process to handle database operations
  - Worker now sends IPC messages to main process for all CRUD operations
  - Models enforce no database access from worker processes (check `process.env.WORKER_TYPE`)
