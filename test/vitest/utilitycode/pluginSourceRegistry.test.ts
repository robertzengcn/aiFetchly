import { describe, it, expect } from "vitest";
import { PluginSourceRegistry } from "@/service/pluginSources/PluginSourceRegistry";
import type {
  PluginSourceFetcher,
  PluginAcquireResult,
  PluginSourceRequest,
} from "@/service/pluginSources/pluginSourceTypes";

function makeFetcher(
  kind: PluginSourceFetcher["kind"]
): PluginSourceFetcher {
  return {
    kind,
    async acquire(): Promise<PluginAcquireResult> {
      throw new Error("stub");
    },
  };
}

describe("PluginSourceRegistry", () => {
  it("registers and retrieves by kind", () => {
    const reg = new PluginSourceRegistry();
    const f = makeFetcher("git");
    reg.register(f);
    expect(reg.get("git")).toBe(f);
    expect(reg.has("git")).toBe(true);
  });

  it("reports absence for unregistered kind", () => {
    const reg = new PluginSourceRegistry();
    expect(reg.has("git")).toBe(false);
    expect(() => reg.get("git")).toThrow(/no fetcher.*git/i);
  });
});
