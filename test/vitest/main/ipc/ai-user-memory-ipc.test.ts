import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return "true";
    }
  },
}));

const spies = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockList: vi.fn(),
  mockUpdate: vi.fn(),
  mockArchive: vi.fn(),
  mockDelete: vi.fn(),
  mockRunNow: vi.fn(),
  mockGetStatus: vi.fn(),
}));

const {
  mockCreate,
  mockList,
  mockUpdate,
  mockArchive,
  mockDelete,
  mockRunNow,
  mockGetStatus,
} = spies;

vi.mock("@/service/AIUserMemoryService", () => ({
  AIUserMemoryService: vi.fn().mockImplementation(() => ({
    createManualMemory: spies.mockCreate,
    list: spies.mockList,
    update: spies.mockUpdate,
    archive: spies.mockArchive,
    delete: spies.mockDelete,
  })),
}));

vi.mock("@/service/AIAutoDreamService", () => ({
  AIAutoDreamService: vi.fn().mockImplementation(() => ({
    runNow: spies.mockRunNow,
    getStatus: spies.mockGetStatus,
  })),
}));

vi.mock("@/api/aiChatApi", () => ({
  AiChatApi: vi.fn().mockImplementation(() => ({
    openAIChatCompletion: vi.fn(),
  })),
}));

const handlers: Record<string, (e: unknown, data: string) => Promise<unknown>> =
  {};
vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      chan: string,
      h: (e: unknown, data: string) => Promise<unknown>
    ) => {
      handlers[chan] = h;
    },
  },
}));

import {
  registerAIUserMemoryIpcHandlers,
  _resetAIUserMemorySingletonsForTesting,
} from "@/main-process/communication/ai-user-memory-ipc";
import {
  AI_USER_MEMORY_LIST,
  AI_USER_MEMORY_CREATE,
  AI_USER_MEMORY_UPDATE,
  AI_USER_MEMORY_ARCHIVE,
  AI_USER_MEMORY_DELETE,
  AI_USER_MEMORY_RUN_AUTO_DREAM,
  AI_USER_MEMORY_AUTO_DREAM_STATUS,
} from "@/config/channellist";

const EVENT = {} as unknown;

describe("ai-user-memory-ipc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetAIUserMemorySingletonsForTesting();
    registerAIUserMemoryIpcHandlers();
  });

  it("list delegates to service", async () => {
    mockList.mockResolvedValue([]);
    const r = (await handlers[AI_USER_MEMORY_LIST](EVENT, "")) as {
      status: boolean;
    };
    expect(mockList).toHaveBeenCalled();
    expect(r.status).toBe(true);
  });

  it("create validates payload and delegates", async () => {
    mockCreate.mockResolvedValue({ memoryId: "mem-1" });
    const r = (await handlers[AI_USER_MEMORY_CREATE](
      EVENT,
      JSON.stringify({ type: "preference", title: "x", content: "y" })
    )) as { status: boolean };
    expect(mockCreate).toHaveBeenCalled();
    expect(r.status).toBe(true);
  });

  it("create returns denied when payload is missing required fields", async () => {
    const r = (await handlers[AI_USER_MEMORY_CREATE](
      EVENT,
      JSON.stringify({ type: "preference" })
    )) as { status: boolean };
    expect(r.status).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("update requires a memoryId", async () => {
    const r = (await handlers[AI_USER_MEMORY_UPDATE](
      EVENT,
      JSON.stringify({})
    )) as { status: boolean };
    expect(r.status).toBe(false);
  });

  it("archive delegates by memoryId", async () => {
    mockArchive.mockResolvedValue(undefined);
    const r = (await handlers[AI_USER_MEMORY_ARCHIVE](
      EVENT,
      '"mem-1"'
    )) as { status: boolean };
    expect(mockArchive).toHaveBeenCalledWith("mem-1");
    expect(r.status).toBe(true);
  });

  it("delete delegates by memoryId", async () => {
    mockDelete.mockResolvedValue(1);
    const r = (await handlers[AI_USER_MEMORY_DELETE](
      EVENT,
      '"mem-1"'
    )) as { status: boolean };
    expect(r.status).toBe(true);
  });

  it("run-auto-dream delegates to service with force flag", async () => {
    mockRunNow.mockResolvedValue({ runId: "run-1", status: "completed" });
    const r = (await handlers[AI_USER_MEMORY_RUN_AUTO_DREAM](
      EVENT,
      JSON.stringify({ force: true })
    )) as { status: boolean };
    expect(mockRunNow).toHaveBeenCalledWith(
      expect.objectContaining({ force: true })
    );
    expect(r.status).toBe(true);
  });

  it("status returns the auto-dream status view", async () => {
    mockGetStatus.mockResolvedValue({
      aiEnabled: true,
      autoDreamEnabled: false,
    });
    const r = (await handlers[AI_USER_MEMORY_AUTO_DREAM_STATUS](
      EVENT,
      ""
    )) as { data: { aiEnabled: boolean } };
    expect(mockGetStatus).toHaveBeenCalled();
    expect(r.data.aiEnabled).toBe(true);
  });
});
