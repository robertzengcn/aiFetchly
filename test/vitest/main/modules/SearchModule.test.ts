import { afterEach, describe, expect, test, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SqliteDb } from "@/config/SqliteDb";

const testRuntimeDir = path.join(os.tmpdir(), "aifetchly-search-module-test");

vi.mock("electron", () => ({
  utilityProcess: {
    fork: vi.fn(),
  },
  MessageChannelMain: class MessageChannelMain {
    port1 = {};
    port2 = {};
  },
  app: {
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
}));

vi.mock("@/modules/token", () => ({
  Token: class Token {
    getValue(): string {
      return testRuntimeDir;
    }
  },
}));

describe("SearchModule.searchByKeywordAndEngine", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("initializes the database before saving the search task", async () => {
    fs.mkdirSync(testRuntimeDir, { recursive: true });

    vi.spyOn(SqliteDb, "getInstance").mockReturnValue({
      connection: {
        isInitialized: false,
        getRepository: vi.fn().mockReturnValue({}),
      },
    } as unknown as SqliteDb);

    const { SearchModule } = await import("@/modules/SearchModule");
    const events: string[] = [];

    vi.spyOn(SearchModule.prototype, "ensureConnection").mockImplementation(
      async (): Promise<void> => {
        events.push("ensure");
      }
    );
    vi.spyOn(SearchModule.prototype, "saveSearchtask").mockImplementation(
      async (): Promise<number> => {
        events.push("save");
        return 42;
      }
    );
    vi.spyOn(SearchModule.prototype, "updateTaskLog").mockImplementation(
      async (): Promise<void> => {
        events.push("log");
      }
    );
    vi.spyOn(SearchModule.prototype, "runSearchTask").mockImplementation(
      async (): Promise<void> => {
        events.push("run");
      }
    );

    const module = new SearchModule();

    await module.searchByKeywordAndEngine(["test query"], "Bing", {
      accounts: [1],
      notShowBrowser: true,
    });

    expect(events).toEqual(["ensure", "save", "log", "run"]);
  });
});
