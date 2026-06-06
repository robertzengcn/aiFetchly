import { describe, expect, test, vi } from "vitest";
import { SqliteDb } from "@/config/SqliteDb";

describe("SqliteDb", () => {
  test("does not warn when empty path falls back to existing instance", () => {
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
      expect(sqliteDbClass.getInstance("")).toBe(existingInstance);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      sqliteDbClass.instance = previousInstance;
      sqliteDbClass.currentDbPath = previousCurrentDbPath;
      warnSpy.mockRestore();
    }
  });
});
