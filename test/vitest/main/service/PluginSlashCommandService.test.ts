import { describe, expect, it, beforeEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { PluginSummary } from "@/entityTypes/pluginTypes";
import type { PluginMarketplaceSummary } from "@/entityTypes/pluginMarketplaceTypes";
import type { PluginSourceRequest } from "@/service/pluginSources/pluginSourceTypes";

const mocks = vi.hoisted(() => ({
  isAiEnabled: vi.fn<() => boolean>(),
  addMarketplace: vi.fn(),
  installMarketplacePlugin: vi.fn(),
  installFromSource: vi.fn(),
  applyLoadedPlugins: vi.fn(),
  broadcastAifetchlyConfigChanged: vi.fn(),
}));

vi.mock("@/service/AiFeatureGate", () => ({
  isAiEnabled: mocks.isAiEnabled,
}));

vi.mock("@/service/PluginMarketplaceService", () => ({
  PluginMarketplaceService: vi.fn().mockImplementation(() => ({
    addMarketplace: mocks.addMarketplace,
    installMarketplacePlugin: mocks.installMarketplacePlugin,
  })),
}));

vi.mock("@/service/PluginInstallService", () => ({
  PluginInstallService: vi.fn().mockImplementation(() => ({
    installFromSource: mocks.installFromSource,
  })),
}));

vi.mock("@/service/PluginComponentRegistryService", () => ({
  PluginComponentRegistryService: {
    applyLoadedPlugins: mocks.applyLoadedPlugins,
  },
}));

vi.mock("@/main-process/communication/aifetchlyConfigEvents", () => ({
  broadcastAifetchlyConfigChanged: mocks.broadcastAifetchlyConfigChanged,
}));

import { PluginSlashCommandService } from "@/service/slashCommands/PluginSlashCommandService";

const marketplaceSummary: PluginMarketplaceSummary = {
  id: 1,
  name: "team-tools",
  ownerName: "Team",
  sourceKind: "local-folder",
  sourceUri: "/tmp/marketplace",
  pluginCount: 2,
  enabled: true,
  autoUpdate: false,
  health: "healthy",
};

const pluginSummary: PluginSummary = {
  id: 2,
  name: "lead-tools",
  version: "1.0.0",
  source: "marketplace",
  enabled: true,
  health: "healthy",
  skillCount: 1,
  mcpServerCount: 0,
  agentCount: 1,
  commandCount: 2,
  hookCount: 1,
  permissions: [],
  lastUpdated: "2026-07-22T00:00:00.000Z",
};

describe("PluginSlashCommandService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAiEnabled.mockReturnValue(true);
    mocks.addMarketplace.mockResolvedValue(marketplaceSummary);
    mocks.installMarketplacePlugin.mockResolvedValue(pluginSummary);
    mocks.installFromSource.mockResolvedValue({
      success: true,
      plugin: pluginSummary,
    });
    mocks.applyLoadedPlugins.mockResolvedValue(undefined);
  });

  it("returns usage without side effects when AI is disabled", async () => {
    mocks.isAiEnabled.mockReturnValue(false);
    const r = await new PluginSlashCommandService().execute(
      "marketplace add /tmp/marketplace"
    );
    expect(r).toMatch(/AI feature is not enabled/i);
    expect(mocks.addMarketplace).not.toHaveBeenCalled();
    expect(mocks.installFromSource).not.toHaveBeenCalled();
  });

  it("adds a marketplace with quoted source, ref, and overwrite flag", async () => {
    const r = await new PluginSlashCommandService().execute(
      'marketplace add "/tmp/team marketplace" --ref main --overwrite'
    );
    expect(mocks.addMarketplace).toHaveBeenCalledWith({
      source: "/tmp/team marketplace",
      ref: "main",
      overwrite: true,
    });
    expect(r).toContain('Marketplace "team-tools" added.');
    expect(r).toContain("Plugins: 2");
  });

  it("installs marketplace plugin identifiers and refreshes runtime components", async () => {
    const r = await new PluginSlashCommandService().execute(
      "install lead-tools@team-tools --overwrite"
    );
    expect(mocks.installMarketplacePlugin).toHaveBeenCalledWith({
      pluginId: "lead-tools@team-tools",
      overwrite: true,
    });
    expect(mocks.applyLoadedPlugins).toHaveBeenCalledTimes(1);
    expect(mocks.broadcastAifetchlyConfigChanged).toHaveBeenCalledWith({
      source: "plugin",
    });
    expect(r).toContain('Plugin "lead-tools" installed from marketplace.');
  });

  it("installs a local folder source when the target is an existing directory", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-slash-"));
    try {
      await new PluginSlashCommandService().execute(`install "${dir}"`);
      expect(mocks.installFromSource).toHaveBeenCalledWith({
        kind: "local-folder",
        folderPath: dir,
      } satisfies PluginSourceRequest);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("infers GitHub owner/repo shorthand for direct source installs", async () => {
    await new PluginSlashCommandService().execute(
      "install owner/repo --ref v1"
    );
    expect(mocks.installFromSource).toHaveBeenCalledWith({
      kind: "github",
      uri: "https://github.com/owner/repo",
      ref: "v1",
    } satisfies PluginSourceRequest);
  });
});
