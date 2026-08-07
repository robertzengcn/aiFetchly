import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { registerTaskIpcHandlers } from "@/main-process/communication/task-ipc";
import { TaskController } from "@/controller/taskController";
import type { BrowserWindow } from "electron";

// Self-contained electron ipcMain mock. registerValidatedHandler imports
// { ipcMain } from "electron" directly, so the module must be stubbed here
// (the shared mockIpcMain util does not stub the "electron" module). Handlers
// land in `handlers`; tests drive them with fn({}, input) to match
// ipcMain.handle's (event, raw) signature. Each handler returns a
// { status, msg, data } envelope (registerValidatedHandler wraps every return
// and converts thrown errors to { status: false, msg: <err.message> }).
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn);
    },
  },
}));

// Mock TaskController
vi.mock("@/controller/taskController", () => {
  return {
    TaskController: vi.fn().mockImplementation(() => ({
      createTask: vi.fn().mockResolvedValue(1),
      updateTask: vi.fn().mockResolvedValue(true),
      deleteTask: vi.fn().mockResolvedValue(true),
      getTaskList: vi.fn().mockResolvedValue({
        tasks: [],
        total: 0,
        page: 1,
        size: 10,
      }),
      getTaskDetail: vi.fn().mockResolvedValue({
        task: {
          id: 1,
          name: "Test Task",
          status: "pending",
        },
      }),
      runTask: vi.fn().mockResolvedValue(true),
      cancelTask: vi.fn().mockResolvedValue(true),
      getTaskResults: vi.fn().mockResolvedValue({
        results: [],
        total: 0,
        page: 1,
        size: 10,
      }),
    })),
  };
});

interface Envelope<T = unknown> {
  status: boolean;
  msg: string;
  data: T;
}

describe("Task IPC Handlers", () => {
  beforeEach(() => {
    handlers.clear();
    registerTaskIpcHandlers({} as unknown as BrowserWindow);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("task:create handler", () => {
    test("should register task:create handler", () => {
      expect(handlers.has("task:create")).toBe(true);
    });

    test("should handle task creation request", async () => {
      const taskData = {
        name: "Test Task",
        platform: "youtube",
        keywords: ["test"],
        numPages: 10,
        concurrency: 3,
        showBrowser: true,
      };

      const fn = handlers.get("task:create")!;
      const result = (await fn({}, taskData)) as Envelope<number>;
      expect(result.status).toBe(true);
      expect(result.data).toBe(1);
    });

    test("should propagate errors", async () => {
      // registerValidatedHandler catches handler errors and returns them as a
      // failure envelope (msg = err.message) instead of throwing.
      const MockedTaskController = vi.mocked(TaskController);
      MockedTaskController.mockImplementationOnce(() => ({
        createTask: vi.fn().mockRejectedValue(new Error("Creation failed")),
        updateTask: vi.fn(),
        deleteTask: vi.fn(),
        getTaskList: vi.fn(),
        getTaskDetail: vi.fn(),
        runTask: vi.fn(),
        cancelTask: vi.fn(),
        getTaskResults: vi.fn(),
      }) as unknown as TaskController);

      const fn = handlers.get("task:create")!;
      const result = (await fn({}, { name: "Test Task" })) as Envelope<null>;
      expect(result.status).toBe(false);
      expect(result.msg).toBe("Creation failed");
    });
  });

  describe("task:update handler", () => {
    test("should register task:update handler", () => {
      expect(handlers.has("task:update")).toBe(true);
    });

    test("should handle task update request", async () => {
      const fn = handlers.get("task:update")!;
      const result = (await fn({}, { id: 1, name: "Updated Task" })) as Envelope<boolean>;
      expect(result.status).toBe(true);
      expect(result.data).toBe(true);
    });
  });

  describe("task:delete handler", () => {
    test("should register task:delete handler", () => {
      expect(handlers.has("task:delete")).toBe(true);
    });

    test("should handle task deletion request", async () => {
      const fn = handlers.get("task:delete")!;
      const result = (await fn({}, { id: 1 })) as Envelope<boolean>;
      expect(result.status).toBe(true);
      expect(result.data).toBe(true);
    });
  });

  describe("task:list handler", () => {
    test("should register task:list handler", () => {
      expect(handlers.has("task:list")).toBe(true);
    });

    test("should handle task list request", async () => {
      const fn = handlers.get("task:list")!;
      const result = (await fn({}, { page: 1, size: 10 })) as Envelope<{
        tasks: unknown[];
        total: number;
        page: number;
        size: number;
      }>;
      expect(result.status).toBe(true);
      expect(result.data).toMatchObject({
        tasks: [],
        total: 0,
        page: 1,
        size: 10,
      });
    });
  });

  describe("task:detail handler", () => {
    test("should register task:detail handler", () => {
      expect(handlers.has("task:detail")).toBe(true);
    });

    test("should handle task detail request", async () => {
      const fn = handlers.get("task:detail")!;
      const result = (await fn({}, { id: 1 })) as Envelope<{
        task: { id: number; name: string; status: string };
      }>;
      expect(result.status).toBe(true);
      expect(result.data.task.id).toBe(1);
    });
  });

  describe("task:run handler", () => {
    test("should register task:run handler", () => {
      expect(handlers.has("task:run")).toBe(true);
    });

    test("should handle task run request", async () => {
      const fn = handlers.get("task:run")!;
      const result = (await fn({}, { id: 1 })) as Envelope<boolean>;
      expect(result.status).toBe(true);
      expect(result.data).toBe(true);
    });
  });

  describe("task:cancel handler", () => {
    test("should register task:cancel handler", () => {
      expect(handlers.has("task:cancel")).toBe(true);
    });

    test("should handle task cancellation request", async () => {
      const fn = handlers.get("task:cancel")!;
      const result = (await fn({}, { id: 1 })) as Envelope<boolean>;
      expect(result.status).toBe(true);
      expect(result.data).toBe(true);
    });
  });

  describe("task:results handler", () => {
    test("should register task:results handler", () => {
      expect(handlers.has("task:results")).toBe(true);
    });

    test("should handle task results request", async () => {
      const fn = handlers.get("task:results")!;
      const result = (await fn({}, { id: 1, page: 1, size: 10 })) as Envelope<{
        results: unknown[];
        total: number;
        page: number;
        size: number;
      }>;
      expect(result.status).toBe(true);
      expect(result.data).toMatchObject({
        results: [],
        total: 0,
        page: 1,
        size: 10,
      });
    });
  });
});
