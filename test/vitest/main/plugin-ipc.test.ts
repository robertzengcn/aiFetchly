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
vi.mock("@/modules/PluginManagementModule", () => ({
  PluginManagementModule: class {
    async listInstalledPlugins() {
      return [];
    }
    async getPluginByName(name: string) {
      if (name !== "demo-plugin") return null;
      return {
        id: 1,
        name,
        displayName: "Demo Plugin",
        version: "1.0.0",
        source: "local",
        enabled: 1,
        health: "healthy",
        permissionsJson: "[]",
        updatedAt: new Date("2026-06-17T00:00:00.000Z"),
        description: "Demo",
        author: "Tester",
        manifestJson: JSON.stringify({ name, version: "1.0.0" }),
      };
    }
    async togglePlugin() {
      return true;
    }
    async uninstallPlugin() {
      return { removedPlugin: true };
    }
  },
}));
vi.mock("@/modules/SkillManagementModule", () => ({
  SkillManagementModule: class {
    async findSkillsByPluginName() {
      return [];
    }
    async toggleSkill() {
      return true;
    }
  },
}));
vi.mock("@/modules/MCPToolModule", () => ({
  MCPToolModule: class {
    async findMcpByPluginName() {
      return [
        {
          id: 42,
          serverName: "demo-mcp",
          enabled: true,
          transport: "stdio",
        },
      ];
    }
    async toggleServerEnabled() {
      return undefined;
    }
  },
}));
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
  PLUGIN_GET,
  PLUGIN_IMPORT,
  PLUGIN_TOGGLE,
  PLUGIN_UNINSTALL,
  PLUGIN_RELOAD,
  PLUGIN_INSTALL_FROM_SOURCE,
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
    expect(handlers.has(PLUGIN_INSTALL_FROM_SOURCE)).toBe(true);
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

  it("includes MCP server ids in plugin detail for component toggles", async () => {
    const fn = handlers.get(PLUGIN_GET)!;
    const result = await fn({}, { name: "demo-plugin" });
    expect(result).toMatchObject({
      status: true,
      data: {
        mcpServers: [
          expect.objectContaining({
            id: 42,
            name: "demo-mcp",
          }),
        ],
      },
    });
  });

  it("PLUGIN_INSTALL_FROM_SOURCE rejects an invalid kind", async () => {
    aiEnabledValue = "true";
    const fn = handlers.get(PLUGIN_INSTALL_FROM_SOURCE)!;
    const result = await fn({}, { kind: "marketplace-typo" });
    expect(result).toMatchObject({
      status: false,
      msg: expect.stringContaining("kind"),
    });
  });

  it("PLUGIN_INSTALL_FROM_SOURCE rejects missing kind", async () => {
    aiEnabledValue = "true";
    const fn = handlers.get(PLUGIN_INSTALL_FROM_SOURCE)!;
    const result = await fn({}, {});
    expect(result).toMatchObject({ status: false });
  });

  it("PLUGIN_INSTALL_FROM_SOURCE rejects CRLF in uri", async () => {
    aiEnabledValue = "true";
    const fn = handlers.get(PLUGIN_INSTALL_FROM_SOURCE)!;
    const result = await fn(
      {},
      {
        kind: "git",
        uri: "https://example.com/x.git\r\n--upload-pack=evil",
      }
    );
    expect(result).toMatchObject({
      status: false,
      msg: expect.stringContaining("Invalid characters"),
    });
  });

  it("PLUGIN_INSTALL_FROM_SOURCE returns AI-not-enabled when AI disabled", async () => {
    aiEnabledValue = "false";
    const fn = handlers.get(PLUGIN_INSTALL_FROM_SOURCE)!;
    const result = await fn({}, { kind: "local-folder", folderPath: "/tmp" });
    expect(result).toEqual({
      status: false,
      msg: expect.stringContaining("not enabled"),
      data: null,
    });
  });
});
