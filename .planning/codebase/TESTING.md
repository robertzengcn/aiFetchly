# Testing Patterns

> Auto-generated codebase map. Last updated: 2026-04-22

## Summary

AiFetchly uses two test frameworks: Mocha (v10) for module/controller tests and Vitest (v1.2) for main process, service, and utility tests. The project has 579 source files and 115 test files. Tests are organized by framework and feature area in the `test/` directory. The project employs Sinon for mocking in Mocha tests and `vi` (Vitest built-in) for mocking in Vitest tests. IPC handler tests currently have minimal coverage -- most are stub tests that only assert `true === true`.

## Details

### Test Frameworks

**Mocha (v10.2.0):**
- Used for: Module/controller tests, RAG integration tests
- Location: `test/modules/*.test.ts`, `test/rag/*.test.ts`
- Assertion library: Chai (v4) with `expect` style
- Mocking: Sinon (v15)
- Run command: `TS_NODE_PROJECT=tsconfig.json mocha --require tsconfig-paths/register --require tsx/cjs 'test/modules/**/*.test.ts'`
- Config: No `.mocharc.*` file; all configuration via CLI flags in `package.json`

**Vitest (v1.2.2):**
- Used for: Main process, service, utility code, and AI tool tests
- Location: `test/vitest/main/**/*.test.ts`, `test/vitest/utilitycode/*.test.ts`
- Assertion library: Vitest built-in `expect` (Chai-compatible API)
- Mocking: Vitest built-in `vi` module
- Multiple Vite configs for different test suites:
  - `vite.main.config.mjs` -- Main process tests (`test/vitest/main/**/*.test.ts`)
  - `vite.utilityCode.config.mjs` -- Utility/puppeteer tests (`test/vitest/utilitycode/*.test.ts`)
  - `vite.taskCode.config.mjs` -- Task code tests (`test/vitest/taskCode/*.test.ts`)

### Run Commands

```bash
# All Mocha tests
yarn test

# Specific Mocha test file
yarn test test/modules/AIRecoveryHandler.test.ts

# Main process Vitest tests
yarn testmain

# Utility code / puppeteer Vitest tests
yarn vitest-puppeteer

# Google scraper tests
yarn vitest-googlescraper

# Specific scraper test patterns
yarn vitest-puppeteer-stealth
yarn vitest-puppeteer-stealth-only
yarn vitest-puppeteer-cluster
```

### Test File Organization

```
test/
├── setup.ts                           # Mocha global setup (DB, env vars)
├── setup.js                           # JS setup companion
├── mocks/                             # Module-level mocks
│   ├── electron.ts                    # Electron API mock (app, ipcMain, BrowserWindow)
│   ├── electron-log.ts                # electron-log mock
│   └── electron-store.ts              # electron-store mock
├── utils/                             # Test utilities shared across frameworks
│   ├── electron-mocks.ts              # MockBrowserWindow, mockIpcMain, setup/reset functions
│   ├── entity-mocks.ts                # Factory functions: createMockTaskEntity, createMockTaskEntities
│   ├── fixtures.ts                    # Test data fixtures: taskFixtures.validCreateRequest()
│   └── model-mocks.ts                 # MockTaskModel class with in-memory storage
├── fixtures/                          # Test data files
│   └── ai-email-template-test-data.json
├── modules/                           # Mocha tests (mirrors src/modules, src/controller, src/service)
│   ├── AIRecoveryHandler.test.ts
│   ├── SystemDependencyModule.test.ts
│   ├── WebSocketClient.test.ts
│   ├── campaignController.test.ts
│   ├── searchController.test.ts
│   └── ...
├── vitest/
│   ├── main/                          # Main process Vitest tests
│   │   ├── ipc/                       # IPC handler tests (22 files)
│   │   ├── service/                   # Service tests (15 files)
│   │   ├── config/platforms/          # Platform-specific config tests
│   │   ├── modules/platforms/         # Platform-specific module tests
│   │   ├── DependencyAudit.model.test.ts
│   │   ├── FileToolService.test.ts
│   │   ├── FilePathGuard.test.ts
│   │   ├── SkillDiagnosticsService.test.ts
│   │   └── ...
│   ├── utilitycode/                   # Utility code and puppeteer tests
│   │   ├── AIRecoveryBridge.test.ts
│   │   ├── aiChatApi.test.ts
│   │   ├── googleScrape.test.ts
│   │   ├── logger.test.ts
│   │   ├── puppeteer.test.ts
│   │   ├── skillExecutor.test.ts
│   │   └── ...
│   └── taskCode/                      # Task code tests (currently empty)
├── rag/                               # RAG-specific tests
│   ├── DocumentService.test.ts
│   ├── RAGModule.test.ts
│   └── integration/
│       └── RAGIntegration.test.ts
└── output/                            # Test output directory
```

### Test Structure

**Mocha Test Pattern (from `test/modules/AIRecoveryHandler.test.ts`):**
```typescript
import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import sinon, { SinonStub } from 'sinon';

describe('AIRecoveryHandler', () => {
    let handler: AIRecoveryHandler;
    let aiChatApiStub: SinonStub;

    beforeEach(() => {
        handler = new AIRecoveryHandler({ /* config */ });
        aiChatApiStub = sinon.stub(AiChatApi.prototype, 'sendMessage');
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('handleRecoveryRequest', () => {
        it('should rate limit requests when limit is exceeded', async () => {
            // Arrange, Act, Assert
            expect(result.success).to.be.false;
            expect(result.reasoning).to.contain('Rate limit exceeded');
        });
    });
});
```

**Vitest Test Pattern (from `test/vitest/main/FilePathGuard.test.ts`):**
```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("FilePathGuard", () => {
    let guard: FilePathGuard;
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpg-test-"));
        guard = new FilePathGuard([tmpDir]);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe("valid path resolution", () => {
        it("resolves a simple relative path inside workspace root", () => {
            const result = guard.validate("src/config/app.ts");
            expect(result.safe).toBe(true);
        });
    });
});
```

**Vitest IPC Test Pattern (from `test/vitest/main/ipc/search-ipc.test.ts`):**
```typescript
import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import { MockBrowserWindow, mockIpcMain, setupElectronMocks, resetElectronMocks } from '../../../utils/electron-mocks';

describe('Search IPC Handlers', () => {
    let mockWindow: MockBrowserWindow;

    beforeEach(() => {
        setupElectronMocks();
        mockWindow = new MockBrowserWindow();
    });

    afterEach(() => {
        resetElectronMocks();
        vi.clearAllMocks();
    });

    test('should register search IPC handlers', () => {
        expect(true).toBe(true);  // Stub test
    });
});
```

### Mocking

**Mocha/Sinon Mocking:**
```typescript
// Stub a method on a class prototype
const stub = sinon.stub(AiChatApi.prototype, 'sendMessage');
stub.resolves({ status: true, data: { message: '...' } });

// Restore after each test
afterEach(() => { sinon.restore(); });
```

**Vitest Mocking:**
```typescript
// Create a mock function
const mockSend = vi.fn();

// Create mock object
mockEvent = {
    sender: { send: mockSend }
} as unknown as IpcMainEvent;

// Verify calls
expect(mockEvent.sender.send).toHaveBeenCalledWith(
    AI_CHAT_STREAM_COMPLETE,
    expect.stringContaining('"isComplete":true')
);

// Clear after each test
afterEach(() => { vi.clearAllMocks(); });
```

**Electron Mocking (`test/utils/electron-mocks.ts`):**
- `MockBrowserWindow` -- Full BrowserWindow mock with `webContents.send`
- `mockIpcMain` -- ipcMain mock with handler storage and `callHandler()` for testing
- `mockIpcRenderer` -- ipcRenderer mock
- `setupElectronMocks()` / `resetElectronMocks()` -- Lifecycle helpers

**Module-level Electron Mocks (`test/mocks/`):**
- `electron.ts` -- Module-level mock aliased in `tsconfig.json` paths
- `electron-log.ts` -- electron-log mock
- `electron-store.ts` -- electron-store mock

**Entity Mock Factories (`test/utils/entity-mocks.ts`):**
```typescript
export function createMockTaskEntity(overrides?: Partial<TaskEntity>): TaskEntity {
    const defaultTask: TaskEntity = {
        id: 1, name: 'Test Task', platform: 'youtube', status: 'pending',
        keywords: ['test'], location: 'US', numPages: 10, concurrency: 3,
        showBrowser: true, results_count: 0, error_message: undefined,
        created_at: now, updated_at: now, completed_at: undefined,
    };
    return { ...defaultTask, ...overrides } as TaskEntity;
}
```

**Mock Model Class (`test/utils/model-mocks.ts`):**
```typescript
export class MockTaskModel {
    private tasks: Map<number, TaskEntity> = new Map();
    private nextId = 1;

    async createTask(taskData: TaskCreateRequest): Promise<number> { ... }
    async getTaskById(taskId: number): Promise<TaskEntity | null> { ... }
    // Full CRUD implementation with in-memory Map storage
}
```

### Fixtures and Test Data

**Test Data Files:**
- `test/fixtures/ai-email-template-test-data.json` -- Email template test data

**Fixture Factories (`test/utils/fixtures.ts`):**
```typescript
export const taskFixtures = {
    validCreateRequest: (): TaskCreateRequest => ({
        name: 'Test Task', platform: 'youtube', keywords: ['test'],
        numPages: 10, concurrency: 3, showBrowser: true,
    }),
    minimalCreateRequest: (): TaskCreateRequest => ({
        name: 'Minimal Task', platform: 'youtube', keywords: ['test'],
        numPages: 1, concurrency: 1, showBrowser: false,
    }),
    validUpdateRequest: (id: number): TaskUpdateRequest => ({
        id, name: 'Updated Task Name', numPages: 20,
    }),
};
```

**RAG Integration Test Data:**
- Created dynamically in test `before()` hooks
- Files written to `__dirname` and cleaned up in `after()`

### Test Setup

**Mocha Setup (`test/setup.ts`):**
- Imports `reflect-metadata` for TypeORM decorators
- Sets environment variables: `VITE_LOGIN_URL`, `VITE_REMOTEADD`, `NODE_ENV=test`
- Creates global `window` mock for Electron
- Initializes SQLite database in temp directory (`os.tmpdir()/aifetchly-test`)
- Uses `SqliteDb.resetInstance()` for fresh database per test run

**Vitest Setup:**
- Each Vite config file specifies its own `test.include` glob
- Electron modules are aliased to mocks via `tsconfig.json` path mappings
- Test-specific Vite configs handle external module exclusions

### Coverage

**Coverage Requirements:** No coverage target enforced in configuration. No `--coverage` flag in any test script.

**Approximate Coverage by Area:**

| Area | Test Count | Coverage Level |
|------|-----------|---------------|
| Services (33 files) | 15 test files | Medium -- newer services well-covered |
| IPC Handlers (25+ files) | 22 test files | Very Low -- most are stubs with `expect(true).toBe(true)` |
| Modules (40+ files) | ~10 test files | Low |
| Models (30+ files) | 1 test file | Very Low |
| Controllers | ~15 test files | Medium |
| Vue Components | 0 test files | None |
| Worker Processes | 0 test files | None |
| RAG Module | 3 test files | Medium-High |

### Test Types

**Unit Tests:**
- Most tests in the project are unit tests
- Service tests mock external dependencies and test logic in isolation
- Entity mock factories provide consistent test data
- Temporary directories used for filesystem-based tests (`fs.mkdtempSync`)

**Integration Tests:**
- `test/rag/integration/RAGIntegration.test.ts` -- Full RAG pipeline test
- Some Mocha module tests connect to real SQLite database
- Test database is initialized in `test/setup.ts` with all TypeORM entities

**E2E Tests:**
- Not used in this project
- No Cypress, Playwright, or similar framework configured

### Common Patterns

**Filesystem Testing:**
```typescript
// Create temp directory for each test
beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fts-test-"));
    service = new FileToolService([tmpDir]);
});

// Clean up after each test
afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

**Database Testing:**
```typescript
// Initialize DB before tests
before(async () => {
    testDbPath = path.join(__dirname, 'test-rag-integration.db');
    db = SqliteDb.getInstance(testDbPath);
    if (!db.connection.isInitialized) {
        await db.connection.initialize();
    }
});

// Clean up after tests
after(async () => {
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
    }
});

// Clear tables between tests
beforeEach(async () => {
    const repository = db.connection.getRepository(SomeEntity);
    await repository.clear();
});
```

**Async Testing:**
```typescript
// Mocha
it('should handle async operations', async () => {
    const result = await handler.handleRecoveryRequest(request);
    expect(result.success).to.be.true;
});

// Vitest
test('should process stream events', async () => {
    streamEventProcessor.processEvent(streamEvent);
    expect(mockEvent.sender.send).toHaveBeenCalledWith(
        AI_CHAT_STREAM_CHUNK,
        expect.any(String)
    );
});
```

**Error Testing:**
```typescript
// Testing error conditions
it('rejects ../ traversal', () => {
    const result = guard.validate("../../etc/passwd");
    expect(result.safe).toBe(false);
    expect(result.error).toBeDefined();
});

// Testing that errors are properly caught and returned
test('sanitizeStderr redacts secrets before storage', () => {
    const stderr = 'Error: API key sk-abc123def456ghi789';
    const result = sanitizeStderr(stderr);
    expect(result).not.toContain("sk-abc123def456ghi789");
    expect(result).toContain("[REDACTED]");
});
```

### CI/CD

- No CI/CD pipeline configuration found (no `.github/workflows/`, `.gitlab-ci.yml`, etc.)
- Husky pre-commit hook runs `lint-staged` which executes `npx eslint --fix`
- Tests are not run as part of the pre-commit hook

## Key Files

- `test/setup.ts` - Mocha test global setup (DB init, env vars, Electron mock)
- `test/utils/electron-mocks.ts` - Electron API mocks shared across test frameworks
- `test/utils/entity-mocks.ts` - Entity factory functions for consistent test data
- `test/utils/fixtures.ts` - Test fixture data (task fixtures)
- `test/utils/model-mocks.ts` - In-memory mock model class
- `test/mocks/electron.ts` - Module-level Electron mock aliased in tsconfig
- `vite.main.config.mjs` - Vitest config for main process tests
- `vite.utilityCode.config.mjs` - Vitest config for utility/puppeteer tests
- `tsconfig.json` - Path aliases mapping Electron modules to test mocks

## Gaps & Unknowns

- **IPC handler tests are stubs:** 22 IPC test files exist but most contain only `expect(true).toBe(true)`. No actual IPC handler logic is tested.
- **No Vue component tests:** Zero test coverage for any Vue component despite having 50+ component files.
- **No worker process tests:** Worker files in `src/childprocess/` have no corresponding tests.
- **No coverage enforcement:** No coverage threshold is configured or checked in CI.
- **No E2E tests:** No end-to-end testing framework is configured.
- **Model tests sparse:** Only 1 model test file (`DependencyAudit.model.test.ts`) out of 30+ model files.
- **Controller test quality varies:** Some controller tests have meaningful assertions, others are stubs.
- **No CI/CD pipeline:** Tests must be run manually; no automated test execution on push/PR.
- **`test/vitest/taskCode/` is empty:** Directory exists but contains no test files.
- **Mixed test frameworks:** Mocha and Vitest coexist with different assertion and mocking libraries, increasing cognitive overhead for developers.
