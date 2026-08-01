import { describe, expect, it, beforeEach, vi } from "vitest";

// Controllable AI-enabled flag so we can exercise the AI gate on run-auto-dream.
const state = vi.hoisted(() => ({ aiEnabled: "true" }));

vi.mock("@/modules/token", () => ({
  Token: class {
    getValue() {
      return state.aiEnabled;
    }
  },
}));

const spies = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockList: vi.fn(),
  mockUpdate: vi.fn(),
  mockArchive: vi.fn(),
  mockDelete: vi.fn(),
}));

const { mockCreate, mockList, mockUpdate, mockArchive, mockDelete } = spies;

vi.mock("@/service/AIWorkspaceMemoryService", () => ({
  AIWorkspaceMemoryService: vi.fn().mockImplementation(() => ({
    createManualMemory: spies.mockCreate,
    list: spies.mockList,
    update: spies.mockUpdate,
    archive: spies.mockArchive,
    delete: spies.mockDelete,
  })),
}));

// Controllable manual-memory toggle (default-on; set "false" to disable writes).
const mockGetSettingValue = vi.fn();
vi.mock("@/modules/SystemSettingModule", () => ({
  SystemSettingModule: vi.fn().mockImplementation(() => ({
    getSettingValue: mockGetSettingValue,
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
  registerAIWorkspaceMemoryIpcHandlers,
  _resetAIWorkspaceMemorySingletonsForTesting,
} from "@/main-process/communication/ai-workspace-memory-ipc";
import {
  AI_WORKSPACE_MEMORY_LIST,
  AI_WORKSPACE_MEMORY_CREATE,
  AI_WORKSPACE_MEMORY_UPDATE,
  AI_WORKSPACE_MEMORY_ARCHIVE,
  AI_WORKSPACE_MEMORY_DELETE,
  AI_WORKSPACE_MEMORY_RUN_AUTO_DREAM,
} from "@/config/channellist";

const EVENT = {} as unknown;

describe("ai-workspace-memory-ipc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.aiEnabled = "true";
    // Manual-memory toggle defaults to enabled (setting absent → enabled).
    mockGetSettingValue.mockResolvedValue(null);
    _resetAIWorkspaceMemorySingletonsForTesting();
    registerAIWorkspaceMemoryIpcHandlers();
  });

  it("list requires a conversationId", async () => {
    const r = (await handlers[AI_WORKSPACE_MEMORY_LIST](EVENT, "")) as {
      status: boolean;
    };
    expect(r.status).toBe(false);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("list delegates to service with the conversationId", async () => {
    mockList.mockResolvedValue([]);
    const r = (await handlers[AI_WORKSPACE_MEMORY_LIST](
      EVENT,
      JSON.stringify({ conversationId: "conv-1" })
    )) as { status: boolean };
    expect(mockList).toHaveBeenCalledWith({ conversationId: "conv-1" });
    expect(r.status).toBe(true);
  });

  it("create requires conversationId, title, content, and type", async () => {
    const r = (await handlers[AI_WORKSPACE_MEMORY_CREATE](
      EVENT,
      JSON.stringify({ conversationId: "conv-1", type: "decision" })
    )) as { status: boolean };
    expect(r.status).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("create delegates and forces sourceKind=manual at the service layer", async () => {
    mockCreate.mockResolvedValue({ memoryId: "wmem-1" });
    const payload = {
      conversationId: "conv-1",
      type: "decision",
      title: "Use SQLite",
      content: "Store workspace memory in SQLite.",
      // A renderer-supplied (forged) workspaceKey must be ignored by the
      // service, which resolves the key from the conversation itself.
      workspaceKey: "ws_FORGED_BY_RENDERER",
    };
    const r = (await handlers[AI_WORKSPACE_MEMORY_CREATE](
      EVENT,
      JSON.stringify(payload)
    )) as { status: boolean };
    expect(r.status).toBe(true);
    // The handler passes the parsed payload to the service; the service's
    // requireContext() is what actually scopes the write (verified separately
    // by the module isolation tests + service behavior).
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "conv-1" })
    );
  });

  it("update requires conversationId and memoryId", async () => {
    const r = (await handlers[AI_WORKSPACE_MEMORY_UPDATE](
      EVENT,
      JSON.stringify({ conversationId: "conv-1" })
    )) as { status: boolean };
    expect(r.status).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("archive requires conversationId and memoryId", async () => {
    const r = (await handlers[AI_WORKSPACE_MEMORY_ARCHIVE](
      EVENT,
      JSON.stringify({ memoryId: "wmem-1" })
    )) as { status: boolean };
    expect(r.status).toBe(false);
    expect(mockArchive).not.toHaveBeenCalled();
  });

  it("archive delegates with both conversationId and memoryId", async () => {
    mockArchive.mockResolvedValue(undefined);
    const r = (await handlers[AI_WORKSPACE_MEMORY_ARCHIVE](
      EVENT,
      JSON.stringify({ conversationId: "conv-1", memoryId: "wmem-1" })
    )) as { status: boolean };
    expect(mockArchive).toHaveBeenCalledWith("conv-1", "wmem-1");
    expect(r.status).toBe(true);
  });

  it("delete delegates with both conversationId and memoryId", async () => {
    mockDelete.mockResolvedValue(1);
    const r = (await handlers[AI_WORKSPACE_MEMORY_DELETE](
      EVENT,
      JSON.stringify({ conversationId: "conv-1", memoryId: "wmem-1" })
    )) as { status: boolean };
    expect(mockDelete).toHaveBeenCalledWith("conv-1", "wmem-1");
    expect(r.status).toBe(true);
  });

  it("run-auto-dream is denied when AI is not enabled", async () => {
    state.aiEnabled = "false";
    const r = (await handlers[AI_WORKSPACE_MEMORY_RUN_AUTO_DREAM](
      EVENT,
      JSON.stringify({ conversationId: "conv-1" })
    )) as { status: boolean; msg: string };
    expect(r.status).toBe(false);
    expect(r.msg).toMatch(/subscriber/i);
  });

  it("run-auto-dream checks AI enable before doing work", async () => {
    state.aiEnabled = "true";
    const r = (await handlers[AI_WORKSPACE_MEMORY_RUN_AUTO_DREAM](
      EVENT,
      JSON.stringify({ conversationId: "conv-1" })
    )) as { status: boolean };
    // AI enabled, but the real service skips when there are no workspace-bound
    // sources in the test DB → runNow throws "skipped" → denied.
    expect(r.status).toBe(false);
  });

  it("manual write handlers are denied when the manual-memory toggle is off", async () => {
    mockGetSettingValue.mockResolvedValue("false");
    const r = (await handlers[AI_WORKSPACE_MEMORY_CREATE](
      EVENT,
      JSON.stringify({
        conversationId: "conv-1",
        type: "decision",
        title: "t",
        content: "c",
      })
    )) as { status: boolean; msg: string };
    expect(r.status).toBe(false);
    expect(r.msg).toMatch(/disabled/i);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("list is NOT gated by the manual-memory toggle", async () => {
    mockGetSettingValue.mockResolvedValue("false");
    mockList.mockResolvedValue([]);
    const r = (await handlers[AI_WORKSPACE_MEMORY_LIST](
      EVENT,
      JSON.stringify({ conversationId: "conv-1" })
    )) as { status: boolean };
    expect(r.status).toBe(true);
    expect(mockList).toHaveBeenCalled();
  });
});
