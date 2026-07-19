import { describe, it, expect } from "vitest";
import {
  PluginMarketplaceFetcherRegistry,
  createDefaultMarketplaceFetcherRegistry,
} from "@/service/pluginMarketplaces/PluginMarketplaceFetcherRegistry";
import type {
  PluginMarketplaceFetcher,
  PluginMarketplaceFetchResult,
} from "@/service/pluginMarketplaces/marketplaceFetcherTypes";
import type { PluginMarketplaceSourceKind } from "@/entityTypes/pluginMarketplaceTypes";

describe("PluginMarketplaceFetcherRegistry", () => {
  it("register defaults to the fetcher's own kind", () => {
    const reg = new PluginMarketplaceFetcherRegistry();
    const fake: PluginMarketplaceFetcher = {
      kind: "git",
      async fetch() {
        return { success: false, errors: [] } as PluginMarketplaceFetchResult;
      },
    };
    reg.register(fake);
    expect(reg.get("git")).toBe(fake);
  });

  it("register accepts an explicit alias kind", () => {
    const reg = new PluginMarketplaceFetcherRegistry();
    const fake: PluginMarketplaceFetcher = {
      kind: "local-folder",
      async fetch() {
        return { success: false, errors: [] } as PluginMarketplaceFetchResult;
      },
    };
    reg.register(fake); // local-folder
    reg.register(fake, "local-file"); // alias
    expect(reg.get("local-folder")).toBe(fake);
    expect(reg.get("local-file" as PluginMarketplaceSourceKind)).toBe(fake);
  });

  it("throws for an unregistered kind", () => {
    const reg = new PluginMarketplaceFetcherRegistry();
    expect(() => reg.get("git")).toThrow(/No fetcher registered/);
  });

  it("createDefaultMarketplaceFetcherRegistry registers every source kind (including local-file)", () => {
    const reg = createDefaultMarketplaceFetcherRegistry();
    // Every PluginMarketplaceSourceKind must resolve — this is the regression
    // guard for the bug where local-file was never registered (it reused the
    // local-folder fetcher but register keyed only by fetcher.kind).
    for (const kind of [
      "github",
      "git",
      "local-folder",
      "local-file",
      "url",
    ] as const) {
      expect(() => reg.get(kind)).not.toThrow();
    }
    // local-folder and local-file share the same fetcher instance.
    expect(reg.get("local-folder")).toBe(
      reg.get("local-file" as PluginMarketplaceSourceKind)
    );
  });
});
