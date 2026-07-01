import { describe, it, expect, beforeEach, vi } from "vitest";

// Test-only ipcMain shim. Captures handlers so tests can invoke them directly.
vi.mock("electron", () => {
  const handlers = new Map<string, (e: unknown, data: unknown) => Promise<unknown>>();
  return {
    ipcMain: {
      handle(channel: string, fn: (e: unknown, data: unknown) => Promise<unknown>) {
        handlers.set(channel, fn);
      },
      _handledChannels: () => Array.from(handlers.keys()),
      _invoke: (channel: string, data: unknown) =>
        (handlers.get(channel) ?? (() => Promise.reject(new Error("no handler"))))(
          undefined,
          data
        ),
      _clear: () => handlers.clear(),
    },
  };
});

// Shared fake instances so tests can spy on the same object the IPC handler uses.
const fakeHook = {
  create: vi.fn().mockResolvedValue({ id: "u1", source: "user" }),
  update: vi.fn().mockResolvedValue({ id: "u1", source: "user" }),
  deleteById: vi.fn().mockResolvedValue(undefined),
  setEnabled: vi.fn().mockResolvedValue({ id: "u1", enabled: true, source: "user" }),
  setTrusted: vi.fn().mockResolvedValue({ id: "u1", trusted: true, source: "user" }),
  listUserHooks: vi.fn().mockResolvedValue([{ id: "u1", source: "user" }]),
  findById: vi.fn().mockResolvedValue(null),
  loadUserHooksIntoRegistry: vi.fn().mockResolvedValue(undefined),
};

const fakeAudit = {
  query: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  recordEntry: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@/modules/HookModule", () => ({
  HookModule: vi.fn(() => fakeHook),
}));

vi.mock("@/modules/HookAuditModule", () => ({
  HookAuditModule: vi.fn(() => fakeAudit),
}));

vi.mock("@/modules/token", () => ({
  Token: vi.fn().mockImplementation(() => ({
    getValue: vi.fn((key: string) => (key === "user_hooks_enabled" ? "true" : "")),
    setValue: vi.fn(),
  })),
}));

vi.mock("@/service/hooks/HookRegistry", () => ({
  HookRegistry: {
    listAll: vi.fn().mockReturnValue([
      {
        id: "b1",
        eventName: "PreToolUse",
        source: "builtin",
        type: "callback",
        enabled: true,
        trusted: true,
      },
    ]),
  },
}));

import { ipcMain } from "electron";
import { registerHooksIpcHandlers } from "@/main-process/communication/hooks-ipc";

// Normalize the mocked ipcMain so test helpers are typed
const mockedIpc = ipcMain as unknown as {
  _handledChannels: () => string[];
  _invoke: (channel: string, data?: unknown) => Promise<unknown>;
  _clear: () => void;
};

describe("hooks-ipc handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set default resolved values because clearAllMocks resets mock implementations
    fakeHook.create.mockResolvedValue({ id: "u1", source: "user" });
    fakeHook.update.mockResolvedValue({ id: "u1", source: "user" });
    fakeHook.deleteById.mockResolvedValue(undefined);
    fakeHook.setEnabled.mockResolvedValue({
      id: "u1",
      enabled: true,
      source: "user",
    });
    fakeHook.setTrusted.mockResolvedValue({
      id: "u1",
      trusted: true,
      source: "user",
    });
    fakeHook.listUserHooks.mockResolvedValue([{ id: "u1", source: "user" }]);
    fakeHook.findById.mockResolvedValue(null);
    fakeHook.loadUserHooksIntoRegistry.mockResolvedValue(undefined);
    fakeAudit.query.mockResolvedValue({ rows: [], total: 0 });
    fakeAudit.recordEntry.mockResolvedValue(undefined);

    mockedIpc._clear();
    registerHooksIpcHandlers();
  });

  it("registers a handler for each HOOKS_* channel", () => {
    const channels = mockedIpc._handledChannels();
    for (const c of [
      "hooks:list",
      "hooks:create",
      "hooks:update",
      "hooks:delete",
      "hooks:setEnabled",
      "hooks:setTrusted",
      "hooks:getGlobalEnable",
      "hooks:setGlobalEnable",
      "hooks:listAudit",
    ]) {
      expect(channels).toContain(c);
    }
  });

  it("hooks:create delegates to HookModule.create", async () => {
    const result = await mockedIpc._invoke("hooks:create", {
      id: "u1",
      eventName: "PreToolUse",
      command: "node x",
    });
    expect(fakeHook.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: "u1", command: "node x" })
    );
    expect((result as { status: boolean }).status).toBe(true);
  });

  it("hooks:delete rejects when HookModule throws", async () => {
    fakeHook.deleteById.mockRejectedValueOnce(
      new Error("Only user hooks can be deleted")
    );
    const result = (await mockedIpc._invoke("hooks:delete", {
      id: "builtin-x",
    })) as { status: boolean; msg: string };
    expect(result.status).toBe(false);
    expect(result.msg).toMatch(/only user hooks/i);
  });

  it("hooks:listAudit delegates to HookAuditModule.query", async () => {
    const result = (await mockedIpc._invoke("hooks:listAudit", {
      limit: 10,
      offset: 0,
    })) as { status: boolean; data: { total: number } };
    expect(fakeAudit.query).toHaveBeenCalled();
    expect(result.status).toBe(true);
    expect(result.data.total).toBe(0);
  });

  it("hooks:setGlobalEnable writes Token and returns the new value", async () => {
    const result = (await mockedIpc._invoke("hooks:setGlobalEnable", {
      enabled: true,
    })) as { status: boolean; data: boolean };
    expect(result.status).toBe(true);
    expect(result.data).toBe(true);
  });
});
