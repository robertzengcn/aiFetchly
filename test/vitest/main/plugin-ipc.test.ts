import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock electron's ipcMain so we can drive handlers without a real Electron.
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
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
      return [
        {
          id: 1,
          name: "demo-plugin",
          displayName: "Demo Plugin",
          version: "1.0.0",
          source: "local",
          enabled: 1,
          health: "healthy",
          permissionsJson: "[]",
          updatedAt: new Date("2026-06-17T00:00:00.000Z"),
          installPath: "/app-data/plugins/installed/demo-plugin",
          sourceKind: "local-folder",
          sourceUri: "/home/user/.aifetchly/plugins/demo-plugin",
          sourceRef: "main",
        },
      ];
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
        installPath: "/app-data/plugins/installed/demo-plugin",
        sourceKind: "local-folder",
        sourceUri: "/home/user/.aifetchly/plugins/demo-plugin",
        sourceRef: "main",
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
          serverName: "demo-plugin__demo-mcp",
          enabled: true,
          transport: "stdio",
          command: "npx",
          tools: JSON.stringify(["search", "fetch"]),
          metadata: JSON.stringify({ pluginServerName: "demo-mcp" }),
        },
      ];
    }
    async toggleServerEnabled() {
      return undefined;
    }
  },
}));
vi.mock("@/modules/AgentDefinitionModule", () => ({
  AgentDefinitionModule: class {
    async findAgentsByPluginName() {
      return [];
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
vi.mock("@/service/PluginInstallService", () => ({
  PluginInstallService: class {
    async installFromSource() {
      return {
        success: true,
        plugin: {
          name: "p",
          version: "1.0.0",
          skillCount: 0,
          mcpServerCount: 0,
        },
      };
    }
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
vi.mock("@/service/UserPluginAutoInstallService", () => ({
  UserPluginAutoInstallService: {
    syncDefaultUserPlugins: vi.fn(async () => ({
      scanned: 0,
      installed: 0,
      skipped: 0,
      errors: [],
    })),
  },
}));

// Import AFTER mocks are registered.
import { registerPluginIpcHandlers } from "@/main-process/communication/plugin-ipc";
import { UserPluginAutoInstallService } from "@/service/UserPluginAutoInstallService";
import { PluginComponentRegistryService } from "@/service/PluginComponentRegistryService";
import { getAIFetchlyConfigManager } from "@/service/aifetchlyConfig/AIFetchlyConfigManager";
import type { SlashCommandDefinition } from "@/entityTypes/slashCommandTypes";
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

  it("syncs user plugin folders before listing installed plugins", async () => {
    const fn = handlers.get(PLUGIN_LIST)!;
    const result = await fn({}, undefined);
    expect(result).toMatchObject({
      status: true,
      data: [
        expect.objectContaining({
          installPath: "/app-data/plugins/installed/demo-plugin",
          sourceKind: "local-folder",
          sourceUri: "/home/user/.aifetchly/plugins/demo-plugin",
          sourceRef: "main",
        }),
      ],
    });
    expect(
      UserPluginAutoInstallService.syncDefaultUserPlugins
    ).toHaveBeenCalled();
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
            serverName: "demo-plugin__demo-mcp",
            enabled: true,
            transport: "stdio",
            health: "healthy",
            toolCount: 2,
          }),
        ],
        installPath: "/app-data/plugins/installed/demo-plugin",
        sourceKind: "local-folder",
        sourceUri: "/home/user/.aifetchly/plugins/demo-plugin",
        sourceRef: "main",
      },
    });
  });

  it("PLUGIN_GET exposes a renderer-safe command list + commandCount (no body/metadata)", async () => {
    // Seed the live registry with one command under plugin:demo-plugin.
    const registry = getAIFetchlyConfigManager().getCommandRegistry();
    const reviewDef: SlashCommandDefinition = {
      id: "plugin:demo-plugin:command:review",
      name: "review",
      description: "Review changes",
      aliases: ["code-review"],
      type: "prompt",
      source: "plugin",
      sourceId: "plugin:demo-plugin",
      sourceLabel: "Plugin",
      argumentHint: "[scope]",
      requiresTrust: false,
      enabled: true,
      // Body/metadata must NEVER reach the renderer (PRD §11.1 / AC-9).
      body: "SECRET PROMPT BODY $ARGUMENTS",
      metadata: { secret: "leak-me" },
    };
    registry.replaceSource("plugin:demo-plugin", [reviewDef]);

    try {
      const fn = handlers.get(PLUGIN_GET)!;
      const result = await fn({}, { name: "demo-plugin" });
      expect(result).toMatchObject({ status: true });
      const data = (
        result as { data: { commands: unknown[]; commandCount: number } }
      ).data;
      expect(data.commandCount).toBe(1);
      expect(data.commands).toHaveLength(1);
      const serialized = JSON.stringify(data.commands);
      // Renderer-safe fields present...
      expect(serialized).toContain('"name":"review"');
      expect(serialized).toContain('"sourceId":"plugin:demo-plugin"');
      expect(serialized).toContain('"argumentHint":"[scope]"');
      // ...raw body + metadata stripped.
      expect(serialized).not.toContain("SECRET PROMPT BODY");
      expect(serialized).not.toContain("leak-me");
    } finally {
      registry.replaceSource("plugin:demo-plugin", []);
    }
  });

  it("PLUGIN_LIST summary carries commandCount from the live registry", async () => {
    const registry = getAIFetchlyConfigManager().getCommandRegistry();
    registry.replaceSource("plugin:demo-plugin", [
      {
        id: "plugin:demo-plugin:command:a",
        name: "a",
        description: "A",
        aliases: [],
        type: "prompt",
        source: "plugin",
        sourceId: "plugin:demo-plugin",
        sourceLabel: "Plugin",
        requiresTrust: false,
        enabled: true,
      },
    ]);

    try {
      const fn = handlers.get(PLUGIN_LIST)!;
      const result = await fn({}, undefined);
      expect(result).toMatchObject({
        status: true,
        data: [expect.objectContaining({ commandCount: 1 })],
      });
    } finally {
      registry.replaceSource("plugin:demo-plugin", []);
    }
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

  it("PLUGIN_IMPORT promotes commands/agents immediately after a successful install (PRD §9.4)", async () => {
    aiEnabledValue = "true";
    const applySpy = vi.mocked(
      PluginComponentRegistryService.applyLoadedPlugins
    );
    applySpy.mockClear();
    const fn = handlers.get(PLUGIN_IMPORT)!;
    const result = await fn({}, { zipPath: "/tmp/plugin.zip" });
    expect(result).toMatchObject({ status: true });
    expect(applySpy).toHaveBeenCalledTimes(1);
  });

  it("PLUGIN_INSTALL_FROM_SOURCE promotes commands/agents immediately after a successful install (PRD §9.4)", async () => {
    aiEnabledValue = "true";
    const applySpy = vi.mocked(
      PluginComponentRegistryService.applyLoadedPlugins
    );
    applySpy.mockClear();
    const fn = handlers.get(PLUGIN_INSTALL_FROM_SOURCE)!;
    const result = await fn(
      {},
      { kind: "local-folder", folderPath: "/tmp/plugin" }
    );
    expect(result).toMatchObject({ status: true });
    expect(applySpy).toHaveBeenCalledTimes(1);
  });

  it("PLUGIN_IMPORT still returns success when post-install promotion throws (recoverable, design §11.3)", async () => {
    aiEnabledValue = "true";
    const applySpy = vi.mocked(
      PluginComponentRegistryService.applyLoadedPlugins
    );
    applySpy.mockClear();
    applySpy.mockRejectedValueOnce(new Error("promotion boom"));
    const fn = handlers.get(PLUGIN_IMPORT)!;
    const result = await fn({}, { zipPath: "/tmp/plugin.zip" });
    // Install itself succeeded; promotion failure must not fail the install.
    expect(result).toMatchObject({ status: true });
    expect(applySpy).toHaveBeenCalledTimes(1);
  });
});
