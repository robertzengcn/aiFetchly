import { describe, it, expect } from "vitest";
import {
  getPluginMarketplacesRoot,
  getPluginMarketplaceCacheRoot,
  getPluginMarketplaceManifestPath,
  assertPathInsideBase,
} from "@/service/pluginMarketplaces/pluginMarketplacePaths";
import * as path from "path";

describe("pluginMarketplacePaths", () => {
  it("nests under userData/plugins/marketplaces", () => {
    expect(getPluginMarketplacesRoot()).toEqual(
      expect.stringContaining(path.join("plugins", "marketplaces"))
    );
  });

  it("cache root is namespaced by marketplace name", () => {
    expect(getPluginMarketplaceCacheRoot("team-tools")).toEqual(
      expect.stringContaining(path.join("cache", "team-tools"))
    );
  });

  it("manifest path uses .claude-plugin/marketplace.json", () => {
    expect(getPluginMarketplaceManifestPath("team-tools")).toEqual(
      expect.stringContaining(path.join(".claude-plugin", "marketplace.json"))
    );
  });

  it("assertPathInsideBase allows nested paths", () => {
    const base = "/tmp/mkt";
    expect(() => assertPathInsideBase(base, path.join(base, "plugins", "x"))).not.toThrow();
  });

  it("assertPathInsideBase rejects traversal", () => {
    const base = "/tmp/mkt";
    expect(() => assertPathInsideBase(base, "/tmp/elsewhere")).toThrow();
    expect(() => assertPathInsideBase(base, path.join(base, "..", "escape"))).toThrow();
  });
});
