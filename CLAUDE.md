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

### Specialized Commands
- `yarn login -c <campaignId>` - Login to social platform for specific campaign
- `yarn task -t <taskDetails>` - Run specific task
- `yarn init` - Initialize SQL database
- `yarn rebuild-sqlite3` - Rebuild SQLite3 native module
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
└── worker.ts                 # Worker process
```

### Key Components

#### Database & Storage (Three-Layer Architecture)
- **SQLite with TypeORM** for local data persistence
- **sqlite-vec** integration for vector operations (in progress on current branch)
- Database configuration in `src/config/SqliteDb.ts`
- Entities in `src/entity/` following TypeORM patterns
- **Models** in `src/model/` for data access (extend `BaseDb`)
- **Modules** in `src/modules/` for business logic (extend `BaseModule`)
- **IPC Handlers** in `src/main-process/communication/` use Modules (never direct database access)

#### IPC Communication
- Main process handlers in `src/main-process/communication/`
- Frontend API layer in `src/views/api/`
- Uses contextBridge for secure renderer-main communication

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

### Key Dependencies
- **Puppeteer** - Web automation and scraping
- **TypeORM** - Database ORM
- **better-sqlite3** - SQLite database driver
- **node-cron** - Task scheduling
- **openai** - AI integration

## Development Patterns

### TypeScript Rules
- **NEVER use `any` type** - use proper types or `unknown` instead
- Define explicit interfaces for complex data structures
- All functions must have explicit return types
- Use proper error handling with `unknown` instead of `any` for catch blocks

### Code Organization
- Use PascalCase for classes/components, camelCase for variables/functions
- Modular architecture with clear separation of concerns
- IPC handlers should sanitize all data passed between processes
- Database operations must use TypeORM entities

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

## Active Technologies
- TypeScript 5.x (001-ai-contact-extraction)

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
