import { describe, expect, it } from "vitest";
import {
  isPluginManagerTab,
  parsePluginManagerTab,
  PLUGIN_MANAGER_TABS,
  withPluginManagerTab,
} from "@/views/utils/pluginManagerRoute";

describe("pluginManagerRoute", () => {
  it("exposes the four task-oriented tabs in order", () => {
    expect([...PLUGIN_MANAGER_TABS]).toEqual([
      "discover",
      "installed",
      "sources",
      "issues",
    ]);
  });

  it("parses each valid tab", () => {
    expect(parsePluginManagerTab("discover")).toBe("discover");
    expect(parsePluginManagerTab("installed")).toBe("installed");
    expect(parsePluginManagerTab("sources")).toBe("sources");
    expect(parsePluginManagerTab("issues")).toBe("issues");
  });

  it("defaults to discover for missing or invalid values", () => {
    expect(parsePluginManagerTab(undefined)).toBe("discover");
    expect(parsePluginManagerTab(null)).toBe("discover");
    expect(parsePluginManagerTab("")).toBe("discover");
    expect(parsePluginManagerTab("unknown")).toBe("discover");
    expect(parsePluginManagerTab("Discover")).toBe("discover"); // case-sensitive closed set
  });

  it("handles array-valued query (vue-router repeats keys)", () => {
    // vue-router surfaces ?tab=installed&tab=discover as ["installed","discover"].
    // The helper resolves to the first element.
    expect(parsePluginManagerTab(["installed", "discover"])).toBe("installed");
    // An array whose first element is null/empty falls back to Discover.
    expect(parsePluginManagerTab([null, "installed"])).toBe("discover");
    expect(parsePluginManagerTab([null])).toBe("discover");
  });

  it("withPluginManagerTab sets tab and preserves unrelated query keys", () => {
    const query = { foo: "bar", baz: "qux", tab: "installed" };
    const next = withPluginManagerTab(query, "sources");
    expect(next).toEqual({ foo: "bar", baz: "qux", tab: "sources" });
    // original not mutated
    expect(query.tab).toBe("installed");
  });

  it("withPluginManagerTab adds tab when absent", () => {
    const next = withPluginManagerTab({ foo: "bar" }, "discover");
    expect(next).toEqual({ foo: "bar", tab: "discover" });
  });

  it("isPluginManagerTab guards arbitrary values", () => {
    expect(isPluginManagerTab("discover")).toBe(true);
    expect(isPluginManagerTab("installed")).toBe(true);
    expect(isPluginManagerTab("sources")).toBe(true);
    expect(isPluginManagerTab("issues")).toBe(true);
    expect(isPluginManagerTab("unknown")).toBe(false);
    expect(isPluginManagerTab(undefined)).toBe(false);
    expect(isPluginManagerTab(null)).toBe(false);
    expect(isPluginManagerTab(42)).toBe(false);
  });
});
