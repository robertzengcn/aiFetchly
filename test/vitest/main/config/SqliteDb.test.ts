import { describe, expect, test, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";

describe("SqliteDb", () => {
  test("throws when empty path is requested even if an instance exists", () => {
    const existingInstance = {
      connection: {},
    } as SqliteDb;
    const sqliteDbClass = SqliteDb as unknown as {
      instance: SqliteDb | null;
      currentDbPath: string | null;
      getInstance(filepath: string): SqliteDb;
    };
    const previousInstance = sqliteDbClass.instance;
    const previousCurrentDbPath = sqliteDbClass.currentDbPath;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    sqliteDbClass.instance = existingInstance;
    sqliteDbClass.currentDbPath = "/tmp/existing-db";

    try {
      expect(() => sqliteDbClass.getInstance("")).toThrow(
        "Cannot create SqliteDb instance with empty filepath"
      );
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      sqliteDbClass.instance = previousInstance;
      sqliteDbClass.currentDbPath = previousCurrentDbPath;
      warnSpy.mockRestore();
    }
  });

  test("destroyInstance clears an existing singleton and initialized connection", async () => {
    const destroy = vi.fn<(...args: []) => Promise<void>>(async () => undefined);
    const existingInstance = {
      connection: {
        isInitialized: true,
        destroy,
      },
    } as unknown as SqliteDb;
    const sqliteDbClass = SqliteDb as unknown as {
      instance: SqliteDb | null;
      currentDbPath: string | null;
      initPromise: Promise<void> | null;
      destroyInstance(): Promise<void>;
    };
    const previousInstance = sqliteDbClass.instance;
    const previousCurrentDbPath = sqliteDbClass.currentDbPath;
    const previousInitPromise = sqliteDbClass.initPromise;

    sqliteDbClass.instance = existingInstance;
    sqliteDbClass.currentDbPath = "/tmp/existing-db";
    sqliteDbClass.initPromise = Promise.resolve();

    try {
      await sqliteDbClass.destroyInstance();

      expect(destroy).toHaveBeenCalledOnce();
      expect(sqliteDbClass.instance).toBeNull();
      expect(sqliteDbClass.currentDbPath).toBeNull();
      expect(sqliteDbClass.initPromise).toBeNull();
    } finally {
      sqliteDbClass.instance = previousInstance;
      sqliteDbClass.currentDbPath = previousCurrentDbPath;
      sqliteDbClass.initPromise = previousInitPromise;
    }
  });
});
