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

describe("database-backed module connection guards", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("SearchTaskModule initializes before reading search tasks", async () => {
    vi.spyOn(SqliteDb, "getInstance").mockReturnValue({
      connection: {
        isInitialized: false,
        getRepository: vi.fn().mockReturnValue({}),
      },
    } as unknown as SqliteDb);

    const { SearchTaskModule } = await import("@/modules/SearchTaskModule");
    const { SearchTaskModel } = await import("@/model/SearchTask.model");
    const events: string[] = [];

    vi.spyOn(SearchTaskModule.prototype, "ensureConnection").mockImplementation(
      async (): Promise<void> => {
        events.push("ensure");
      }
    );
    vi.spyOn(SearchTaskModel.prototype, "getTaskEntity").mockImplementation(
      async () => {
        events.push("read");
        return null;
      }
    );

    const module = new SearchTaskModule();
    await module.read(1);

    expect(events).toEqual(["ensure", "read"]);
  });

  test("MCPToolModule initializes before listing enabled MCP tools", async () => {
    vi.spyOn(SqliteDb, "getInstance").mockReturnValue({
      connection: {
        isInitialized: false,
        getRepository: vi.fn().mockReturnValue({}),
      },
    } as unknown as SqliteDb);

    const { MCPToolModule } = await import("@/modules/MCPToolModule");
    const { MCPToolModel } = await import("@/model/MCPTool.model");
    const events: string[] = [];

    vi.spyOn(MCPToolModule.prototype, "ensureConnection").mockImplementation(
      async (): Promise<void> => {
        events.push("ensure");
      }
    );
    vi.spyOn(MCPToolModel.prototype, "getEnabledMCPTools").mockImplementation(
      async () => {
        events.push("list");
        return [];
      }
    );

    const module = new MCPToolModule();
    await module.getEnabledMCPTools();

    expect(events).toEqual(["ensure", "list"]);
  });

  test("YellowPagesResultModule initializes before counting task results", async () => {
    vi.spyOn(SqliteDb, "getInstance").mockReturnValue({
      connection: {
        isInitialized: false,
        getRepository: vi.fn().mockReturnValue({}),
      },
    } as unknown as SqliteDb);

    const { YellowPagesResultModule } = await import(
      "@/modules/YellowPagesResultModule"
    );
    const { YellowPagesResultModel } = await import(
      "@/model/YellowPagesResult.model"
    );
    const events: string[] = [];

    vi.spyOn(
      YellowPagesResultModule.prototype,
      "ensureConnection"
    ).mockImplementation(async (): Promise<void> => {
      events.push("ensure");
    });
    vi.spyOn(
      YellowPagesResultModel.prototype,
      "getResultCountByTaskId"
    ).mockImplementation(async () => {
      events.push("count");
      return 0;
    });

    const module = new YellowPagesResultModule();
    await module.getResultsCountByTaskId(1);

    expect(events).toEqual(["ensure", "count"]);
  });

  test("EmailSearchTaskModule initializes before reading task details", async () => {
    vi.spyOn(SqliteDb, "getInstance").mockReturnValue({
      connection: {
        isInitialized: false,
        getRepository: vi.fn().mockReturnValue({}),
      },
    } as unknown as SqliteDb);

    const { EmailSearchTaskModule } = await import(
      "@/modules/EmailSearchTaskModule"
    );
    const { EmailsearchTaskModel } = await import(
      "@/model/EmailsearchTask.model"
    );
    const events: string[] = [];

    vi.spyOn(
      EmailSearchTaskModule.prototype,
      "ensureConnection"
    ).mockImplementation(async (): Promise<void> => {
      events.push("ensure");
    });
    vi.spyOn(EmailsearchTaskModel.prototype, "getTaskById").mockImplementation(
      async () => {
        events.push("read");
        return undefined;
      }
    );

    const module = new EmailSearchTaskModule();
    await module.getTaskDetail(1);

    expect(events).toEqual(["ensure", "read"]);
  });
});
