import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyModel } from "@/model/Proxy.model";
import { ProxyCheckModel } from "@/model/ProxyCheck.model";
import { AIChatMessageModel } from "@/model/AIChatMessage.model";

const sqliteState = vi.hoisted(() => ({
  initialized: false,
  autoInitialize: true,
  ensureCalls: 0,
  repositoryOperations: 0,
  repositoryRequests: [] as string[],
  resolveInitialization: null as (() => void) | null,
  initializationPromise: null as Promise<void> | null,
}));

function makeProxyQueryBuilder(): {
  where: (condition: string, params: Record<string, string>) => unknown;
  skip: (value: number) => unknown;
  take: (value: number) => unknown;
  orderBy: (field: string, direction: "ASC" | "DESC") => unknown;
  getCount: () => Promise<number>;
  getMany: () => Promise<unknown[]>;
} {
  const queryBuilder = {
    where: vi.fn(() => queryBuilder),
    skip: vi.fn(() => queryBuilder),
    take: vi.fn(() => queryBuilder),
    orderBy: vi.fn(() => queryBuilder),
    getCount: vi.fn(async () => 0),
    getMany: vi.fn(async () => []),
  };
  return queryBuilder;
}

function makeRepository(): {
  createQueryBuilder: (alias: string) => ReturnType<typeof makeProxyQueryBuilder>;
  find: () => Promise<unknown[]>;
  findOne?: () => Promise<null>;
} {
  return {
    createQueryBuilder: vi.fn(() => makeProxyQueryBuilder()),
    find: vi.fn(async () => []),
  };
}

function makeEagerRepository(): { findOne: () => Promise<null> } {
  return {
    findOne: vi.fn(async () => {
      sqliteState.repositoryOperations += 1;
      if (!sqliteState.initialized) {
        throw new Error('No metadata for "AIChatMessageEntity" was found.');
      }
      return null;
    }),
  };
}

vi.mock("@/config/SqliteDb", () => {
  class MockSqliteDb {
    static instance: MockSqliteDb | null = null;

    connection = {
      getRepository: (entity: { name: string }) => {
        if (entity.name === "AIChatMessageEntity") {
          sqliteState.repositoryRequests.push(entity.name);
          return makeEagerRepository();
        }
        if (!sqliteState.initialized) {
          throw new Error(`No metadata for "${entity.name}" was found.`);
        }
        sqliteState.repositoryRequests.push(entity.name);
        return makeRepository();
      },
    };

    static getInstance(): MockSqliteDb {
      if (!MockSqliteDb.instance) {
        MockSqliteDb.instance = new MockSqliteDb();
      }
      return MockSqliteDb.instance;
    }

    static async ensureInitialized(): Promise<void> {
      sqliteState.ensureCalls += 1;
      if (sqliteState.autoInitialize) {
        sqliteState.initialized = true;
        return;
      }
      if (!sqliteState.initializationPromise) {
        sqliteState.initializationPromise = new Promise<void>((resolve) => {
          sqliteState.resolveInitialization = () => {
            sqliteState.initialized = true;
            resolve();
          };
        });
      }
      await sqliteState.initializationPromise;
    }
  }

  return { SqliteDb: MockSqliteDb };
});

beforeEach(() => {
  sqliteState.initialized = false;
  sqliteState.autoInitialize = true;
  sqliteState.ensureCalls = 0;
  sqliteState.repositoryOperations = 0;
  sqliteState.repositoryRequests = [];
  sqliteState.resolveInitialization = null;
  sqliteState.initializationPromise = null;
});

describe("proxy model metadata initialization", () => {
  it("initializes the DataSource before reading ProxyEntity metadata", async () => {
    const model = new ProxyModel("/tmp/aifetchly-proxy-model-test");

    const result = await model.getProxyList(1, 10, "");

    expect(result).toEqual({ total: 0, records: [] });
    expect(sqliteState.ensureCalls).toBeGreaterThanOrEqual(1);
    expect(sqliteState.repositoryRequests).toEqual(["ProxyEntity"]);
  });

  it("initializes the DataSource before reading ProxyCheckEntity metadata", async () => {
    const model = new ProxyCheckModel("/tmp/aifetchly-proxy-model-test");

    const result = await model.getProxyChecksByIds([1]);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(sqliteState.ensureCalls).toBeGreaterThanOrEqual(1);
    expect(sqliteState.repositoryRequests).toEqual(["ProxyCheckEntity"]);
  });

  it("guards legacy eager repositories before their first operation", async () => {
    const model = new AIChatMessageModel("/tmp/aifetchly-ai-chat-model-test");

    const result = await model.getMessageById(1);

    expect(result).toBeNull();
    expect(sqliteState.ensureCalls).toBe(1);
    expect(sqliteState.repositoryRequests).toEqual(["AIChatMessageEntity"]);
  });

  it("awaits concurrent initialization before legacy repository operations", async () => {
    sqliteState.autoInitialize = false;
    const model = new AIChatMessageModel("/tmp/aifetchly-ai-chat-model-test");

    const firstRead = model.getMessageById(1);
    const secondRead = model.getMessageById(2);
    await Promise.resolve();

    expect(sqliteState.repositoryOperations).toBe(0);
    expect(sqliteState.resolveInitialization).not.toBeNull();

    sqliteState.resolveInitialization?.();
    await expect(Promise.all([firstRead, secondRead])).resolves.toEqual([
      null,
      null,
    ]);
    expect(sqliteState.repositoryOperations).toBe(2);
    expect(sqliteState.ensureCalls).toBe(2);
  });
});
