import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Mock pluginPaths.getPluginOptionsFile to point at a tmp dir.
const tmpRoots: string[] = [];
vi.mock("@/service/pluginPaths", () => ({
  getPluginOptionsFile: (pluginName: string) => {
    const tmp = tmpRoots[tmpRoots.length - 1];
    return path.join(tmp, pluginName, "options.json");
  },
}));

import { PluginOptionsStore } from "@/service/pluginCompat/PluginOptionsStore";

describe("PluginOptionsStore", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-options-"));
    tmpRoots.push(tmp);
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns empty map when file does not exist", () => {
    expect(PluginOptionsStore.read("p")).toEqual({});
  });

  it("writes and reads back options", () => {
    PluginOptionsStore.write("p", {
      p__srv: { API_KEY: "secret" },
    });
    expect(PluginOptionsStore.read("p")).toEqual({
      p__srv: { API_KEY: "secret" },
    });
  });

  it("resolves ${VAR} placeholders", () => {
    PluginOptionsStore.write("p", {
      p__srv: { API_KEY: "k", DEBUG: "1" },
    });
    const r = PluginOptionsStore.resolveEnv("p", "p__srv", {
      KEY: "${API_KEY}",
      DBG: "${DEBUG}",
      PLAIN: "literal",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.env).toEqual({ KEY: "k", DBG: "1", PLAIN: "literal" });
  });

  it("returns missing list when placeholder cannot resolve", () => {
    PluginOptionsStore.write("p", { p__srv: {} });
    const r = PluginOptionsStore.resolveEnv("p", "p__srv", {
      KEY: "${MISSING}",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toEqual(["MISSING"]);
  });

  it("setOption merges into existing options", () => {
    PluginOptionsStore.write("p", { p__srv: { A: "1" } });
    PluginOptionsStore.setOption("p", "p__srv", "B", "2");
    expect(PluginOptionsStore.read("p")).toEqual({
      p__srv: { A: "1", B: "2" },
    });
  });

  it("discoverPlaceholders returns var names per server", () => {
    const discovered = PluginOptionsStore.discoverPlaceholders({
      p__a: { KEY: "${API_KEY}", PLAIN: "x", DBG: "${DBG}" },
      p__b: { ONLY_PLAIN: "y" },
    });
    expect(discovered).toEqual({
      p__a: ["API_KEY", "DBG"],
    });
  });
});
