import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_DEFINITION_LIST,
  AGENT_RESUME_TOOL_AFTER_PERMISSION,
  AGENT_TASK_DETAIL,
  AGENT_TASK_LIST,
  AGENT_TASK_TRANSCRIPT,
  AI_CHAT_V2_COMPACT_CONVERSATION,
  AI_CHAT_V2_GET_TOOL_APPROVAL_MODE,
  AI_CHAT_V2_SET_TOOL_APPROVAL_MODE,
  PLUGIN_MARKETPLACE_ADD,
  PLUGIN_MARKETPLACE_AVAILABLE_PLUGINS,
  PLUGIN_MARKETPLACE_GET,
  PLUGIN_MARKETPLACE_GET_PLUGIN,
  PLUGIN_MARKETPLACE_INSTALL_PLUGIN,
  PLUGIN_MARKETPLACE_LIST,
  PLUGIN_MARKETPLACE_REFRESH,
  PLUGIN_MARKETPLACE_REMOVE,
} from "@/config/channellist";

type ExposedApi = {
  invoke: (channel: string, data?: unknown) => Promise<unknown> | undefined;
};

const electronMock = vi.hoisted(() => {
  const exposed = new Map<string, unknown>();
  return {
    exposed,
    ipcRenderer: {
      invoke: vi.fn(async (channel: string, data?: unknown) => ({
        channel,
        data,
      })),
      send: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      removeAllListeners: vi.fn(),
    },
    contextBridge: {
      exposeInMainWorld: vi.fn((key: string, api: unknown) => {
        exposed.set(key, api);
      }),
    },
    webUtils: {
      getPathForFile: vi.fn(() => ""),
    },
  };
});

vi.mock("electron", () => electronMock);

async function loadApi(): Promise<ExposedApi> {
  await import("@/preload");
  const api = electronMock.exposed.get("api");
  if (!api) {
    throw new Error("preload api was not exposed");
  }
  return api as ExposedApi;
}

describe("preload agent runtime invoke allowlist", () => {
  beforeEach(() => {
    vi.resetModules();
    electronMock.exposed.clear();
    electronMock.ipcRenderer.invoke.mockClear();
  });

  it.each([
    AGENT_DEFINITION_LIST,
    AGENT_TASK_DETAIL,
    AGENT_TASK_TRANSCRIPT,
    AGENT_TASK_LIST,
    AGENT_RESUME_TOOL_AFTER_PERMISSION,
  ])("forwards %s through window.api.invoke", async (channel) => {
    const api = await loadApi();
    const payload = JSON.stringify({ agentTaskId: "agt-test" });

    const result = await api.invoke(channel, payload);

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      channel,
      payload
    );
    expect(result).toEqual({ channel, data: payload });
  });
});

describe("preload AI Chat V2 invoke allowlist", () => {
  beforeEach(() => {
    vi.resetModules();
    electronMock.exposed.clear();
    electronMock.ipcRenderer.invoke.mockClear();
  });

  it.each([
    AI_CHAT_V2_COMPACT_CONVERSATION,
    AI_CHAT_V2_GET_TOOL_APPROVAL_MODE,
    AI_CHAT_V2_SET_TOOL_APPROVAL_MODE,
  ])("forwards %s through window.api.invoke", async (channel) => {
    const api = await loadApi();
    const payload = JSON.stringify({ conversationId: "conv-test" });

    const result = await api.invoke(channel, payload);

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      channel,
      payload
    );
    expect(result).toEqual({ channel, data: payload });
  });
});

describe("preload plugin marketplace invoke allowlist", () => {
  beforeEach(() => {
    vi.resetModules();
    electronMock.exposed.clear();
    electronMock.ipcRenderer.invoke.mockClear();
  });

  it.each([
    PLUGIN_MARKETPLACE_LIST,
    PLUGIN_MARKETPLACE_GET,
    PLUGIN_MARKETPLACE_ADD,
    PLUGIN_MARKETPLACE_REFRESH,
    PLUGIN_MARKETPLACE_REMOVE,
    PLUGIN_MARKETPLACE_AVAILABLE_PLUGINS,
    PLUGIN_MARKETPLACE_GET_PLUGIN,
    PLUGIN_MARKETPLACE_INSTALL_PLUGIN,
  ])("forwards %s through window.api.invoke", async (channel) => {
    const api = await loadApi();
    const payload = JSON.stringify({ pluginId: "lead-research@team-tools" });

    const result = await api.invoke(channel, payload);

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(
      channel,
      payload
    );
    expect(result).toEqual({ channel, data: payload });
  });
});
