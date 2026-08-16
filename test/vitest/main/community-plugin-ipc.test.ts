import { describe, it, expect, beforeEach, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
const openExternal = vi.hoisted(() =>
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  vi.fn(async (_url: string): Promise<void> => Promise.resolve())
);

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, fn);
    },
  },
  shell: {
    openExternal,
  },
}));

// Token is consulted by isAiEnabled; the community channels must NOT be
// gated on it, but the value is kept controllable to prove that.
let aiEnabledValue = "false";
vi.mock("@/modules/token", () => ({
  Token: class {
    getValue(): string {
      return aiEnabledValue;
    }
  },
}));

const listCommunityPlugins = vi.fn();
const getCommunityPluginDetail = vi.fn();
const installCommunityPlugin = vi.fn();

vi.mock("@/service/PluginMarketplaceService", () => ({
  PluginMarketplaceService: class {
    async listCommunityPlugins(...args: unknown[]) {
      return await listCommunityPlugins(...args);
    }
    async getCommunityPluginDetail(...args: unknown[]) {
      return await getCommunityPluginDetail(...args);
    }
    async installCommunityPlugin(...args: unknown[]) {
      return await installCommunityPlugin(...args);
    }
  },
}));

vi.mock("@/main-process/communication/aifetchlyConfigEvents", () => ({
  broadcastAifetchlyConfigChanged: vi.fn(),
}));

import { registerCommunityPluginIpcHandlers } from "@/main-process/communication/community-plugin-ipc";
import {
  PLUGIN_COMMUNITY_DETAIL,
  PLUGIN_COMMUNITY_INSTALL,
  PLUGIN_COMMUNITY_LIST,
  PLUGIN_COMMUNITY_OPEN_PLANS,
} from "@/config/channellist";
import { MARKETING_PLANS_URL } from "@/config/pluginHubUrl";

function makeEntry(
  slug: string,
  access: { status: string; installMode: string }
) {
  return {
    slug,
    name: slug,
    displayName: slug,
    description: "",
    access,
    installed: false,
  };
}

describe("community-plugin-ipc", () => {
  beforeEach(() => {
    handlers.clear();
    aiEnabledValue = "false"; // Free user — the catalog must still work.
    listCommunityPlugins.mockReset();
    getCommunityPluginDetail.mockReset();
    installCommunityPlugin.mockReset();
    openExternal.mockClear();
    registerCommunityPluginIpcHandlers();
  });

  it("registers all four channels", () => {
    expect(handlers.has(PLUGIN_COMMUNITY_LIST)).toBe(true);
    expect(handlers.has(PLUGIN_COMMUNITY_DETAIL)).toBe(true);
    expect(handlers.has(PLUGIN_COMMUNITY_INSTALL)).toBe(true);
    expect(handlers.has(PLUGIN_COMMUNITY_OPEN_PLANS)).toBe(true);
  });

  it("list works for Free (AI-disabled) users — NON-AI-gated", async () => {
    const entries = [
      makeEntry("pdf-tools", { status: "allowed", installMode: "direct" }),
      makeEntry("pro-seo", {
        status: "subscription_required",
        installMode: "ticket",
      }),
    ];
    listCommunityPlugins.mockResolvedValueOnce(entries);

    const fn = handlers.get(PLUGIN_COMMUNITY_LIST)!;
    const result = await fn({}, { forceRefresh: true });

    expect(result).toEqual({ status: true, msg: "ok", data: entries });
    expect(listCommunityPlugins).toHaveBeenCalledWith({
      forceRefresh: true,
      category: undefined,
      search: undefined,
    });
  });

  it("rejects list with unknown extra properties (strict schema)", async () => {
    const fn = handlers.get(PLUGIN_COMMUNITY_LIST)!;
    const result = await fn({}, { hackerParam: 1 });
    expect(result).toMatchObject({ status: false, data: null });
    expect(listCommunityPlugins).not.toHaveBeenCalled();
  });

  it("detail returns null data envelope when the slug is unknown", async () => {
    getCommunityPluginDetail.mockResolvedValueOnce(null);
    const fn = handlers.get(PLUGIN_COMMUNITY_DETAIL)!;
    const result = await fn({}, { slug: "ghost" });
    expect(result).toEqual({ status: true, msg: "ok", data: null });
  });

  it("install surfaces service errors (e.g. ticket plugins) as status:false", async () => {
    installCommunityPlugin.mockRejectedValueOnce(
      new Error("This plugin is not installable in this release")
    );
    const fn = handlers.get(PLUGIN_COMMUNITY_INSTALL)!;
    const result = await fn({}, { slug: "pro-seo" });
    expect(result).toMatchObject({ status: false, data: null });
    expect(result).toHaveProperty(
      "msg",
      "This plugin is not installable in this release"
    );
  });

  it("install returns the plugin summary on success", async () => {
    installCommunityPlugin.mockResolvedValueOnce({
      id: 7,
      name: "pdf-tools",
    });
    const fn = handlers.get(PLUGIN_COMMUNITY_INSTALL)!;
    const result = await fn({}, { slug: "pdf-tools" });
    expect(result).toEqual({
      status: true,
      msg: "ok",
      data: { id: 7, name: "pdf-tools" },
    });
  });

  it("open-plans opens the marketing plans URL in the default browser", async () => {
    const fn = handlers.get(PLUGIN_COMMUNITY_OPEN_PLANS)!;
    const result = await fn({}, undefined);
    expect(result).toEqual({ status: true, msg: "ok", data: null });
    expect(openExternal).toHaveBeenCalledWith(MARKETING_PLANS_URL);
  });

  it("open-plans wraps shell failures as a channel error", async () => {
    openExternal.mockRejectedValueOnce(new Error("no default browser"));
    const fn = handlers.get(PLUGIN_COMMUNITY_OPEN_PLANS)!;
    const result = await fn({}, undefined);
    expect(result).toMatchObject({ status: false, msg: "OPEN_PLANS_FAILED" });
  });
});
