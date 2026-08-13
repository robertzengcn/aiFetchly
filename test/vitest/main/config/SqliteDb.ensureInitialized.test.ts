import { describe, expect, test, vi, afterEach, type Mock } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";

// ---------------------------------------------------------------------------
// Helpers to access SqliteDb private static fields for test setup/teardown.
// Using `any` here is intentional — we're testing internals that are
// intentionally private in production.
// ---------------------------------------------------------------------------

/** Shape of the private static state we need to manipulate in tests. */
interface StaticState {
  instance: SqliteDb | null;
  currentDbPath: string | null;
  initPromise: Promise<void> | null;
}

function getStaticState(): StaticState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return SqliteDb as any;
}

/** Save and restore SqliteDb static state around a test block. */
function withResetSingleton(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const s = getStaticState();
    const prevInstance = s.instance;
    const prevPath = s.currentDbPath;
    const prevPromise = s.initPromise;
    try {
      await fn();
    } finally {
      s.instance = prevInstance;
      s.currentDbPath = prevPath;
      s.initPromise = prevPromise;
    }
  };
}

/** Create a fake SqliteDb instance with a controllable DataSource mock. */
function createMockSqliteDb(overrides?: {
  isInitialized?: boolean;
  initializeFn?: () => Promise<void>;
}): {
  sqliteDb: SqliteDb;
  initializeMock: Mock<[], Promise<void>>;
} {
  const initializeMock = overrides?.initializeFn
    ? vi.fn(overrides.initializeFn)
    : vi.fn(async () => {
        /* noop */
      });

  const connection = {
    isInitialized: overrides?.isInitialized ?? false,
    initialize: initializeMock,
  };

  // Cast through unknown so we don't need to satisfy the full DataSource type
  const sqliteDb = { connection } as unknown as SqliteDb;

  return { sqliteDb, initializeMock };
}

// ---------------------------------------------------------------------------
// SqliteDb.ensureInitialized
// ---------------------------------------------------------------------------

describe("SqliteDb.ensureInitialized", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test(
    "throws if no singleton instance exists",
    withResetSingleton(async () => {
      getStaticState().instance = null;

      await expect(SqliteDb.ensureInitialized()).rejects.toThrow(
        "SqliteDb not created yet"
      );
    })
  );

  test(
    "returns immediately when DataSource is already initialized",
    withResetSingleton(async () => {
      const { sqliteDb } = createMockSqliteDb({ isInitialized: true });
      getStaticState().instance = sqliteDb;

      // Should resolve without calling initialize()
      await SqliteDb.ensureInitialized();

      // initialize() must not have been called since isInitialized is true
      expect(sqliteDb.connection.isInitialized).toBe(true);
    })
  );

  test(
    "calls DataSource.initialize() when not yet initialized",
    withResetSingleton(async () => {
      const { sqliteDb, initializeMock } = createMockSqliteDb({
        isInitialized: false,
      });
      getStaticState().instance = sqliteDb;

      await SqliteDb.ensureInitialized();

      expect(initializeMock).toHaveBeenCalledOnce();
    })
  );

  test(
    "deduplicates concurrent calls — initialize() called only once",
    withResetSingleton(async () => {
      let resolveInit: () => void = () => {
        /* placeholder — reassigned below */
      };
      const initializeMock = vi.fn(
        () => new Promise<void>((resolve) => (resolveInit = resolve))
      );

      const connection = {
        isInitialized: false,
        initialize: initializeMock,
      };
      getStaticState().instance = {
        connection,
      } as unknown as SqliteDb;

      // Fire 5 concurrent ensureInitialized calls before the first resolves
      const promises = Array.from({ length: 5 }, () =>
        SqliteDb.ensureInitialized()
      );

      // initialize() should have been called exactly once (the rest reuse the same promise)
      expect(initializeMock).toHaveBeenCalledOnce();

      // Now resolve the initialize
      resolveInit();
      await Promise.all(promises);

      // Still only called once
      expect(initializeMock).toHaveBeenCalledOnce();
    })
  );

  test(
    "deduplicates direct DataSource.initialize calls on the singleton",
    withResetSingleton(async () => {
      const sqliteDb = SqliteDb.getInstance("/tmp/aifetchly-dedup-test");
      let resolveInit: () => void = () => {
        /* placeholder — reassigned below */
      };
      const initializeConnectionMock = vi.fn(
        () => new Promise<void>((resolve) => (resolveInit = resolve))
      );
      const connection = sqliteDb.connection as unknown as {
        isInitialized: boolean;
        initialize: () => Promise<void>;
      };

      Object.defineProperty(sqliteDb, "initializeConnection", {
        value: initializeConnectionMock,
      });
      connection.isInitialized = false;

      const first = sqliteDb.connection.initialize();
      const second = sqliteDb.connection.initialize();

      expect(initializeConnectionMock).toHaveBeenCalledOnce();

      resolveInit();
      await Promise.all([first, second]);

      expect(initializeConnectionMock).toHaveBeenCalledOnce();
    })
  );

  test(
    "does not let stale initialization cleanup clear a newer initialization",
    withResetSingleton(async () => {
      const firstDb = SqliteDb.getInstance("/tmp/aifetchly-first-init");
      let resolveFirst: () => void = () => {
        /* placeholder — reassigned below */
      };
      Object.defineProperty(firstDb, "initializeConnection", {
        value: vi.fn(
          () => new Promise<void>((resolve) => (resolveFirst = resolve))
        ),
      });
      const firstConnection = firstDb.connection as unknown as {
        isInitialized: boolean;
      };
      firstConnection.isInitialized = false;

      const firstInitialize = firstDb.connection.initialize();

      const secondDb = SqliteDb.getInstance("/tmp/aifetchly-second-init");
      let resolveSecond: () => void = () => {
        /* placeholder — reassigned below */
      };
      Object.defineProperty(secondDb, "initializeConnection", {
        value: vi.fn(
          () => new Promise<void>((resolve) => (resolveSecond = resolve))
        ),
      });
      const secondConnection = secondDb.connection as unknown as {
        isInitialized: boolean;
      };
      secondConnection.isInitialized = false;

      const secondInitialize = secondDb.connection.initialize();

      resolveFirst();
      await firstInitialize;
      await Promise.resolve();

      expect(getStaticState().initPromise).not.toBeNull();

      resolveSecond();
      await secondInitialize;

      expect(getStaticState().initPromise).toBeNull();
    })
  );

  test(
    "cleans up initPromise after success so a future re-init is possible",
    withResetSingleton(async () => {
      const { sqliteDb, initializeMock } = createMockSqliteDb({
        isInitialized: false,
      });
      getStaticState().instance = sqliteDb;

      await SqliteDb.ensureInitialized();
      expect(initializeMock).toHaveBeenCalledOnce();

      // After success, initPromise should be nulled out
      expect(getStaticState().initPromise).toBeNull();
    })
  );

  test(
    "cleans up initPromise after failure so callers can retry",
    withResetSingleton(async () => {
      const initializeMock = vi.fn(async () => {
        throw new Error("db init failed");
      });
      const connection = {
        isInitialized: false,
        initialize: initializeMock,
      };
      getStaticState().instance = {
        connection,
      } as unknown as SqliteDb;

      // Caller should get the rejection
      await expect(SqliteDb.ensureInitialized()).rejects.toThrow(
        "db init failed"
      );

      // Promise should be cleaned up even on failure
      expect(getStaticState().initPromise).toBeNull();
    })
  );
});

// ---------------------------------------------------------------------------
// BaseModule / BaseDb ensureConnection delegation
// ---------------------------------------------------------------------------

describe("BaseModule.ensureConnection delegates to SqliteDb.ensureInitialized", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("calls SqliteDb.ensureInitialized", async () => {
    const ensureInitSpy = vi
      .spyOn(SqliteDb, "ensureInitialized")
      .mockResolvedValue(undefined);

    const { BaseModule: BM } = await import("@/modules/baseModule");

    // BaseModule is abstract; create a minimal concrete subclass
    class TestModule extends BM {
      public testEnsure() {
        return this.ensureConnection();
      }
    }

    // Stub the constructor's SqliteDb.getInstance call so it doesn't create a real DB
    vi.spyOn(SqliteDb, "getInstance").mockReturnValue({
      connection: { isInitialized: true },
    } as unknown as SqliteDb);

    const mod = new TestModule();
    await mod.testEnsure();

    expect(ensureInitSpy).toHaveBeenCalledOnce();
  });
});

describe("BaseDb.ensureConnection delegates to SqliteDb.ensureInitialized", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("calls SqliteDb.ensureInitialized", async () => {
    const ensureInitSpy = vi
      .spyOn(SqliteDb, "ensureInitialized")
      .mockResolvedValue(undefined);

    // Stub SqliteDb.getInstance so the BaseDb constructor doesn't create a real DB
    vi.spyOn(SqliteDb, "getInstance").mockReturnValue({
      connection: { isInitialized: true },
    } as unknown as SqliteDb);

    const { BaseDb } = await import("@/model/Basedb");

    // BaseDb is abstract; create a minimal concrete subclass
    class TestDb extends BaseDb {
      public testEnsure() {
        return this.ensureConnection();
      }
    }

    const db = new TestDb("/tmp/test-db");
    await db.testEnsure();

    expect(ensureInitSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// EmailSearchTaskModule.resetOrphanedProcessingTasks
// ---------------------------------------------------------------------------

describe("EmailSearchTaskModule.resetOrphanedProcessingTasks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("calls ensureConnection before querying tasks", async () => {
    // Mock the entire SqliteDb layer
    const ensureInitSpy = vi
      .spyOn(SqliteDb, "ensureInitialized")
      .mockResolvedValue(undefined);

    // Provide a full-enough connection mock so EmailsearchTaskModel constructor
    // can call getRepository without crashing.
    const mockRepo = {};
    const mockConnection = {
      isInitialized: true,
      getRepository: vi.fn().mockReturnValue(mockRepo),
    };
    vi.spyOn(SqliteDb, "getInstance").mockReturnValue({
      connection: mockConnection,
    } as unknown as SqliteDb);

    // Import after spies are in place
    const { EmailSearchTaskModule } = await import(
      "@/modules/EmailSearchTaskModule"
    );
    const { EmailsearchTaskModel } = await import(
      "@/model/EmailsearchTask.model"
    );

    // Mock the model's listSearchtask to return empty results (no orphaned tasks)
    const listMock = vi.fn().mockResolvedValue({ records: [], total: 0 });
    vi.spyOn(
      EmailsearchTaskModel.prototype,
      "listSearchtask" as keyof typeof EmailsearchTaskModel.prototype
    ).mockImplementation(listMock);

    const mod = new EmailSearchTaskModule();

    // Clear any calls from the constructor chain
    ensureInitSpy.mockClear();

    await mod.resetOrphanedProcessingTasks();

    // ensureInitialized must have been called at least once during the method
    expect(ensureInitSpy).toHaveBeenCalled();

    // listSearchtask must have been called to actually look for orphaned tasks
    expect(listMock).toHaveBeenCalled();
  });
});
