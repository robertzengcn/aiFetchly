import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveMarketplaceEntrySource } from "@/service/pluginMarketplaces/resolveMarketplaceEntrySource";
import type {
  PluginMarketplaceEntry,
  PluginMarketplaceSource,
} from "@/entityTypes/pluginMarketplaceTypes";

const ctx = (root: string) => ({
  marketplaceName: "team-tools",
  marketplaceRoot: root,
  marketplaceSource: { kind: "git", uri: "https://example.com/mkt.git" } as PluginMarketplaceSource,
  marketplaceVersion: "1.0.0",
});

describe("resolveMarketplaceEntrySource", () => {
  it("resolves a relative source inside root to local-folder", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-resolve-"));
    const pluginDir = path.join(root, "plugins", "foo");
    fs.mkdirSync(pluginDir, { recursive: true });
    const entry = { name: "foo", source: "./plugins/foo" } as PluginMarketplaceEntry;
    const r = resolveMarketplaceEntrySource(entry, ctx(root));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.resolved.request.kind).toBe("local-folder");
      expect(r.resolved.request.folderPath).toBe(pluginDir);
      expect(r.resolved.request.source).toBe("marketplace");
    }
  });

  it("rejects relative source that escapes root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mkt-resolve-"));
    const entry = { name: "bad", source: "./../escape" } as PluginMarketplaceEntry;
    const r = resolveMarketplaceEntrySource(entry, ctx(root));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors.some((e) => e.code === "marketplace-plugin-source-outside-root")).toBe(true);
    }
  });

  it("converts github source to github request, sha over ref", () => {
    const entry = {
      name: "g",
      source: { source: "github", repo: "o/r", ref: "main", sha: "a".repeat(40) },
    } as unknown as PluginMarketplaceEntry;
    const r = resolveMarketplaceEntrySource(entry, ctx("/tmp"));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.resolved.request.kind).toBe("github");
      expect(r.resolved.request.ref).toBe("a".repeat(40));
    }
  });

  it("converts npm source", () => {
    const entry = {
      name: "n",
      source: { source: "npm", package: "pkg", version: "1.0.0" },
    } as unknown as PluginMarketplaceEntry;
    const r = resolveMarketplaceEntrySource(entry, ctx("/tmp"));
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.resolved.request.kind).toBe("npm");
      expect(r.resolved.request.npmPackage).toBe("pkg");
    }
  });

  it("returns unsupported for git-subdir", () => {
    const entry = {
      name: "s",
      source: { source: "git-subdir", url: "https://x.git", path: "p" },
    } as unknown as PluginMarketplaceEntry;
    const r = resolveMarketplaceEntrySource(entry, ctx("/tmp"));
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.errors.some((e) => e.code === "marketplace-plugin-source-unsupported")).toBe(true);
    }
  });

  it("rejects relative source when root has no filesystem tree (URL marketplace)", () => {
    // Simulate a URL marketplace: pass a context whose root does not exist.
    const entry = { name: "x", source: "./plugins/x" } as PluginMarketplaceEntry;
    const urlCtx = {
      ...ctx("/this/path/does/not/exist"),
      marketplaceSource: { kind: "url", uri: "https://example.com/marketplace.json" } as PluginMarketplaceSource,
    };
    const r = resolveMarketplaceEntrySource(entry, urlCtx);
    expect(r.success).toBe(false);
  });
});
