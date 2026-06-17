import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock electron's ipcMain so we can drive handlers without a real Electron.
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn);
    },
  },
}));

// Mock Token so we can toggle AI-enabled state per test.
let aiEnabledValue = "true";
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return aiEnabledValue;
    }
  },
}));

// Mock the heavy services to avoid hitting the real DB / filesystem.
vi.mock("@/service/PluginImportService", () => ({
  PluginImportService: {
    importFromZip: vi.fn(async () => ({
      success: true,
      plugin: { name: "p", version: "1.0.0", skillCount: 0, mcpServerCount: 0 },
    })),
  },
}));
vi.mock("@/service/MCPToolService", () => ({
  MCPToolService: class {
    async testConnection() {
      return true;
    }
    async discoverTools() {
      return [];
    }
    async toggleToolEnabled() {
      return undefined;
    }
  },
}));
vi.mock("@/service/PluginComponentRegistryService", () => ({
  PluginComponentRegistryService: {
    applyLoadedPlugins: vi.fn(async () => {
      /* noop mock */
    }),
    unregisterPluginCapabilities: vi.fn(async () => {
      /* noop mock */
    }),
    reload: vi.fn(async () => ({ enabled: [], disabled: [], errors: [] })),
  },
}));
vi.mock("@/service/PluginDiagnosticsService", () => ({
  PluginDiagnosticsService: {
    buildBundle: vi.fn(async () => null),
  },
}));
vi.mock("@/service/PluginLoaderService", () => ({
  PluginLoaderService: {
    clearCache: vi.fn(() => {
      /* noop */
    }),
  },
}));

// Import AFTER mocks are registered.
import { registerPluginIpcHandlers } from "@/main-process/communication/plugin-ipc";
import {
  PLUGIN_LIST,
  PLUGIN_IMPORT,
  PLUGIN_TOGGLE,
  PLUGIN_UNINSTALL,
  PLUGIN_RELOAD,
} from "@/config/channellist";

describe("plugin-ipc", () => {
  beforeEach(() => {
    handlers.clear();
    aiEnabledValue = "true";
    registerPluginIpcHandlers();
  });

  it("registers all channels", () => {
    expect(handlers.has(PLUGIN_LIST)).toBe(true);
    expect(handlers.has(PLUGIN_IMPORT)).toBe(true);
    expect(handlers.has(PLUGIN_TOGGLE)).toBe(true);
    expect(handlers.has(PLUGIN_UNINSTALL)).toBe(true);
    expect(handlers.has(PLUGIN_RELOAD)).toBe(true);
  });

  it("returns AI-not-enabled envelope when AI is disabled", async () => {
    aiEnabledValue = "false";
    const fn = handlers.get(PLUGIN_LIST)!;
    const result = await fn({}, undefined);
    expect(result).toEqual({
      status: false,
      msg: expect.stringContaining("not enabled"),
      data: null,
    });
  });

  it("rejects import with path traversal in zipPath", async () => {
    aiEnabledValue = "true";
    const fn = handlers.get(PLUGIN_IMPORT)!;
    const result = await fn({}, { zipPath: "../escape.zip" });
    expect(result).toMatchObject({ status: false });
  });

  it("rejects import with empty zipPath", async () => {
    aiEnabledValue = "true";
    const fn = handlers.get(PLUGIN_IMPORT)!;
    const result = await fn({}, { zipPath: "" });
    expect(result).toMatchObject({ status: false });
  });

  it("rejects toggle with empty name", async () => {
    aiEnabledValue = "true";
    const fn = handlers.get(PLUGIN_TOGGLE)!;
    const result = await fn({}, { name: "", enabled: true });
    expect(result).toMatchObject({ status: false });
  });
});
