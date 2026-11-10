import { describe, it, expect } from "vitest";
import {
  BrowserExecutableResolver,
  enumerateManagedChromeCandidates,
  type ResolverFs,
} from "@/childprocess/managed-browser/BrowserExecutableResolver";
import { PluginBrowserCapabilityService } from "@/service/PluginBrowserCapabilityService";

function makeFs(files: ReadonlyMap<string, string>, dirs: ReadonlyMap<string, readonly string[]>): ResolverFs {
  return {
    existsSync: (p) => files.has(p) || dirs.has(p),
    isFileSync: (p) => files.has(p),
    realpathSync: (p) => p,
    listDirSync: (d) => dirs.get(d) ?? [],
  };
}

describe("enumerateManagedChromeCandidates (B11)", () => {
  it("lists installed Chrome-for-Testing builds newest first for the current platform layout", () => {
    const chromeDir = `test/puppeteer-cache/chrome`;
    const fs = makeFs(new Map(), new Map([
      [chromeDir, ["136.0.7103.48", "126.0.6478.126", "not-a-version", "137.0.7103.94"]],
    ]));
    // Default layout for linux (test platform) is checked; only builds with a
    // parseable version are listed, sorted descending by major.
    const candidates = enumerateManagedChromeCandidates(
      fs,
      "test/puppeteer-cache"
    );
    expect(candidates.length).toBe(6);
    // Newest build first, canonical platform layout before legacy fallback.
    expect(candidates[0]).toContain("137.0.7103.94");
    const newest = candidates.filter((c) => c.includes("137.0.7103.94"));
    expect(newest.length).toBe(2);
    expect(newest[0]).toContain("chrome-linux64");
    const oldest = candidates.filter((c) => c.includes("126.0.6478.126"));
    expect(candidates[candidates.length - 1]).toBe(oldest[oldest.length - 1]);
  });

  it("degrades to an empty list for a missing/unreadable cache directory", () => {
    const fs = makeFs(new Map(), new Map());
    expect(enumerateManagedChromeCandidates(fs, "test/missing-cache/chrome")).toEqual([]);
  });
});

describe("BrowserExecutableResolver managed tier (B11)", () => {
  it("resolves a managed cache-only installation to a validated descriptor", () => {
    const managedPath = "test/puppeteer-cache/chrome/136.0.7103.48/chrome-linux64/chrome";
    const fs = makeFs(
      new Map([[managedPath, "binary"]]),
      new Map([
        ["test/puppeteer-cache/chrome", ["136.0.7103.48"]],
      ])
    );
    const resolver = new BrowserExecutableResolver({
      managedCandidates: enumerateManagedChromeCandidates(
        fs,
        "test/puppeteer-cache"
      ),
      fs,
      platform: "linux",
      readExecutableVersion: () => "Chromium 136.0.7103.48",
    });
    const result = resolver.resolve();
    if (!("descriptor" in result)) {
      throw new Error("expected managed resolution");
    }
    expect(result.descriptor.source).toBe("managed");
    expect(result.descriptor.majorVersion).toBe(136);
  });

  it("still reports a typed missing dependency when no tier has a binary", () => {
    const fs = makeFs(new Map(), new Map());
    const resolver = new BrowserExecutableResolver({
      configuredPath: "test/missing-chrome",
      managedCandidates: enumerateManagedChromeCandidates(
        fs,
        "test/missing-cache"
      ),
      fs,
      platform: "linux",
      readExecutableVersion: () => null,
    });
    const result = resolver.resolve();
    expect("errorCode" in result).toBe(true);
    if (!("errorCode" in result)) {
      throw new Error("expected missing resolution");
    }
    expect(result.searchedPaths.length).toBeGreaterThan(0);
  });
});

describe("PluginBrowserCapabilityService.testBrowserUsable (B11)", () => {
  it("treats a plugin without the browser grant as trivially compatible", () => {
    const service = new PluginBrowserCapabilityService({
      resolver: new BrowserExecutableResolver({
        fs: makeFs(new Map(), new Map()),
        platform: "linux",
        readExecutableVersion: () => null,
      }),
    });
    const usable = service.testBrowserUsable({ browserExecutable: false });
    expect(usable.compatible).toBe(true);
    expect(usable.missing).toBe(false);
  });

  it("flags a missing browser for a browser-declaring plugin", () => {
    const service = new PluginBrowserCapabilityService({
      resolver: new BrowserExecutableResolver({
        configuredPath: "test/gone/chrome",
        fs: makeFs(new Map(), new Map()),
        platform: "linux",
        readExecutableVersion: () => null,
      }),
    });
    const usable = service.testBrowserUsable({ browserExecutable: true });
    expect(usable.compatible).toBe(false);
    expect(usable.missing).toBe(true);
    expect(usable.descriptor).toBeNull();
  });

  it("returns the validated descriptor when the major version satisfies the declared floor", () => {
    const chromePath = "test/system/google-chrome";
    const service = new PluginBrowserCapabilityService({
      resolver: new BrowserExecutableResolver({
        configuredPath: chromePath,
        fs: makeFs(new Map([[chromePath, "binary"]]), new Map()),
        platform: "linux",
        readExecutableVersion: () => "Google Chrome 136.0.7103.94",
      }),
    });
    const usable = service.testBrowserUsable({ browserExecutable: true, minBrowserMajorVersion: 126 });
    expect(usable.compatible).toBe(true);
    expect(usable.outOfRange).toBe(false);
    expect(usable.descriptor?.majorVersion).toBe(136);
  });

  it("flags an out-of-range browser against the declared floor as outOfRange", () => {
    const chromePath = "test/system/google-chrome";
    const service = new PluginBrowserCapabilityService({
      resolver: new BrowserExecutableResolver({
        configuredPath: chromePath,
        fs: makeFs(new Map([[chromePath, "binary"]]), new Map()),
        platform: "linux",
        readExecutableVersion: () => "Google Chrome 120.0.6099.109",
      }),
    });
    const usable = service.testBrowserUsable({ browserExecutable: true, minBrowserMajorVersion: 126 });
    expect(usable.compatible).toBe(false);
    expect(usable.missing).toBe(false);
    expect(usable.outOfRange).toBe(true);
  });
});
