import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProxyModel } from "@/model/Proxy.model";
import { ProxyCheckModel } from "@/model/ProxyCheck.model";

const sqliteState = vi.hoisted(() => ({
  initialized: false,
  ensureCalls: 0,
  repositoryRequests: [] as string[],
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
} {
  return {
    createQueryBuilder: vi.fn(() => makeProxyQueryBuilder()),
    find: vi.fn(async () => []),
  };
}

vi.mock("@/config/SqliteDb", () => {
  class MockSqliteDb {
    static instance: MockSqliteDb | null = null;

    connection = {
      getRepository: (entity: { name: string }) => {
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
      sqliteState.initialized = true;
    }
  }

  return { SqliteDb: MockSqliteDb };
});

beforeEach(() => {
  sqliteState.initialized = false;
  sqliteState.ensureCalls = 0;
  sqliteState.repositoryRequests = [];
});

describe("proxy model metadata initialization", () => {
  it("initializes the DataSource before reading ProxyEntity metadata", async () => {
    const model = new ProxyModel("/tmp/aifetchly-proxy-model-test");

    const result = await model.getProxyList(1, 10, "");

    expect(result).toEqual({ total: 0, records: [] });
    expect(sqliteState.ensureCalls).toBe(1);
    expect(sqliteState.repositoryRequests).toEqual(["ProxyEntity"]);
  });

  it("initializes the DataSource before reading ProxyCheckEntity metadata", async () => {
    const model = new ProxyCheckModel("/tmp/aifetchly-proxy-model-test");

    const result = await model.getProxyChecksByIds([1]);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(sqliteState.ensureCalls).toBe(1);
    expect(sqliteState.repositoryRequests).toEqual(["ProxyCheckEntity"]);
  });
});
