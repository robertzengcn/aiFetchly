import { describe, it, expect, beforeEach, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn);
    },
  },
}));

let aiEnabledValue = "true";
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return aiEnabledValue;
    }
  },
}));

vi.mock("@/service/PluginMarketplaceService", () => ({
  PluginMarketplaceService: class {
    async listMarketplaces() {
      return [
        {
          id: 1,
          name: "team-tools",
          ownerName: "Team",
          sourceKind: "url",
          sourceUri: "https://x/marketplace.json",
          pluginCount: 2,
          enabled: true,
          autoUpdate: false,
          health: "healthy",
        },
      ];
    }
    async getMarketplace() {
      return null;
    }
    async addMarketplace() {
      return {
        id: 2,
        name: "added",
        ownerName: "T",
        sourceKind: "url",
        sourceUri: "",
        pluginCount: 0,
        enabled: true,
        autoUpdate: false,
        health: "healthy",
      };
    }
    async refreshMarketplace() {
      return {
        id: 1,
        name: "team-tools",
        ownerName: "Team",
        sourceKind: "url",
        sourceUri: "",
        pluginCount: 2,
        enabled: true,
        autoUpdate: false,
        health: "healthy",
      };
    }
    async removeMarketplace() {
      return undefined;
    }
    async listAvailablePlugins() {
      return [];
    }
    async getAvailablePlugin() {
      return null;
    }
    async installMarketplacePlugin(req: { pluginId: string }) {
      // Mirror real service: pluginId must be name@marketplace.
      if (!req.pluginId.includes("@")) {
        throw new Error(
          "Invalid plugin identifier. Use plugin-name@marketplace-name."
        );
      }
      return { id: 9, name: "p", version: "1.0.0" };
    }
  },
}));

import { registerPluginMarketplaceIpcHandlers } from "@/main-process/communication/plugin-marketplace-ipc";
import {
  PLUGIN_MARKETPLACE_LIST,
  PLUGIN_MARKETPLACE_ADD,
  PLUGIN_MARKETPLACE_REFRESH,
  PLUGIN_MARKETPLACE_REMOVE,
  PLUGIN_MARKETPLACE_INSTALL_PLUGIN,
} from "@/config/channellist";

describe("plugin-marketplace-ipc", () => {
  beforeEach(() => {
    handlers.clear();
    aiEnabledValue = "true";
    registerPluginMarketplaceIpcHandlers();
  });

  it("registers all channels", () => {
    expect(handlers.has(PLUGIN_MARKETPLACE_LIST)).toBe(true);
    expect(handlers.has(PLUGIN_MARKETPLACE_ADD)).toBe(true);
    expect(handlers.has(PLUGIN_MARKETPLACE_REMOVE)).toBe(true);
    expect(handlers.has(PLUGIN_MARKETPLACE_INSTALL_PLUGIN)).toBe(true);
  });

  it("returns AI-not-enabled envelope when AI is disabled", async () => {
    aiEnabledValue = "false";
    const fn = handlers.get(PLUGIN_MARKETPLACE_LIST)!;
    const result = await fn({}, undefined);
    expect(result).toEqual({
      status: false,
      msg: expect.stringContaining("not enabled"),
      data: null,
    });
  });

  it("rejects add with empty source", async () => {
    const fn = handlers.get(PLUGIN_MARKETPLACE_ADD)!;
    const result = await fn({}, { source: "" });
    expect(result).toMatchObject({ status: false });
  });

  it("rejects install with malformed pluginId (no marketplace)", async () => {
    const fn = handlers.get(PLUGIN_MARKETPLACE_INSTALL_PLUGIN)!;
    const result = await fn({}, { pluginId: "no-at-sign" });
    // schema passes (it's a non-empty string), service throws -> status:false
    expect(result).toMatchObject({ status: false });
  });

  it("remove returns null envelope on success", async () => {
    const fn = handlers.get(PLUGIN_MARKETPLACE_REMOVE)!;
    const result = await fn({}, { name: "team-tools" });
    expect(result).toEqual({ status: true, msg: "ok", data: null });
  });

  it("refresh requires a name", async () => {
    const fn = handlers.get(PLUGIN_MARKETPLACE_REFRESH)!;
    const result = await fn({}, { name: "" });
    expect(result).toMatchObject({ status: false });
  });
});
